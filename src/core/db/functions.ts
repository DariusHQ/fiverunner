import type { TimeZone } from '../scripting/time.ts'
import { UTC } from '../scripting/time.ts'
import type { IntervalUnit } from './ast.ts'
import { crc32, md5, sha1, sha2 } from './hash.ts'
import {
  changeJson,
  compactJson,
  detailedJson,
  jsonContains,
  jsonDepth,
  jsonKeys,
  jsonType,
  matchPath,
  mergePatch,
  mergePreserve,
  nodeText,
  parseJsonPath,
  quoteJson,
  removeJson,
  searchJson,
  tryParseJson,
  unquoteJson,
  writeNode,
  type JsonChange,
  type JsonNode,
} from './json.ts'
import { SqlError } from './lexer.ts'
import type { Sqlite, SqliteDatabase, SqlValue } from './sqlite.ts'
import {
  addInterval,
  dateFormat,
  dateTimeOfNumber,
  dayName,
  dayNumber,
  dayOfYear,
  daysInMonth,
  epochOf,
  formatDate,
  formatDateTime,
  formatTime,
  fromDayNumber,
  intervalOf,
  localDateTime,
  microsBetween,
  microsOfTime,
  monthName,
  monthsBetween,
  parseDateTime,
  parseTime,
  timeOfMicros,
  truncateFraction,
  week,
  weekday,
  type DateTime,
  type Time,
} from './temporal.ts'
import {
  bytesOfText,
  decimalOf,
  doubleText,
  foldText,
  numberPrefix,
  roundDecimal,
  sqliteInteger,
  textOf,
  textOfBytes,
} from './values.ts'

/** What the functions of FiveRunner's database read of the database and the session that runs them. */
export interface FunctionHost {
  /** When the statement that runs started: milliseconds since the epoch, maybe with a fraction. */
  statementTime(): number
  /** The time zone of the session, which NOW() and FROM_UNIXTIME() give local time in. */
  zone(): TimeZone
  /** Fails the statement with a MariaDB error. */
  fail(error: SqlError): never
  warn(code: number, message: string): void
  userVariable(name: string): SqlValue
  setUserVariable(name: string, value: SqlValue): void
  systemVariable(name: string): SqlValue
  lastInsertId(): number | bigint
  setLastInsertId(value: number | bigint): void
  foundRows(): number
  rowCount(): number
  database(): string | null
  readonly version: string
  connectionId(): number
  user(): string
  random(): number
}

type Fn = (...args: SqlValue[]) => SqlValue

/** A number of a value, as MariaDB reads values as numbers: strings by the number they start with. */
function numberOf(value: SqlValue): number | null {
  if (value === null) return null
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  return numberPrefix(typeof value === 'string' ? value : textOfBytes(value)).value
}

/** An integer of a value, rounded half away from zero, as MariaDB reads values as integers. */
function integerOf(value: SqlValue): number | null {
  const number = numberOf(value)
  if (number === null) return null
  return Math.sign(number) * Math.round(Math.abs(number))
}

function bytesArg(value: SqlValue): Uint8Array | null {
  if (value === null) return null
  return value instanceof Uint8Array ? value : bytesOfText(textOf(value))
}

/** A datetime of a value: of a string as dates are written, or of a number of its digits. */
function dateTimeOf(value: SqlValue): DateTime | null {
  if (value === null) return null
  if (typeof value === 'number' || typeof value === 'bigint')
    return dateTimeOfNumber(Number(value)) ?? null
  return parseDateTime(textOf(value)) ?? null
}

/** A time of a value: of a time, or of the time of a datetime. */
function timeOf(value: SqlValue): Time | null {
  if (value === null) return null
  if (typeof value === 'number' || typeof value === 'bigint')
    return parseTime(String(value)) ?? null
  const text = textOf(value)
  const datetime = /\d[-/.]\d/.test(text.trim().slice(0, 10)) ? parseDateTime(text) : undefined
  if (datetime !== undefined)
    return {
      negative: false,
      hours: datetime.hour,
      minute: datetime.minute,
      second: datetime.second,
      micro: datetime.micro,
    }
  return parseTime(text) ?? null
}

/** Whether a string holds a time of day, beyond a date. */
function hasTime(value: SqlValue): boolean {
  if (typeof value === 'number' || typeof value === 'bigint') return String(value).length > 8
  return value !== null && /\d[^\d]+\d{1,2}[^\d]\d{1,2}/.test(textOf(value).trim().slice(10))
}

/** Characters of a string or bytes of binary strings, which the functions of strings count by. */
function units(value: string, binary: boolean): string[] {
  return binary ? [...bytesOfText(value)].map((byte) => String.fromCharCode(byte)) : [...value]
}

function joinUnits(parts: string[], binary: boolean): SqlValue {
  if (!binary) return parts.join('')
  return Uint8Array.from(parts, (part) => part.charCodeAt(0))
}

/** A string in upper or lower case, character by character, as MariaDB changes case: ß stays ß. */
function changeCase(text: string, upper: boolean): string {
  let changed = ''
  for (const char of text) {
    const other = upper ? char.toUpperCase() : char.toLowerCase()
    changed += [...other].length === 1 ? other : char
  }
  return changed
}

/** A string without case and accents, as _ci collations compare them, but keeping trailing spaces. */
function foldCase(text: string): string {
  const stripped = /[^\x00-\x7f]/.test(text) ? text.normalize('NFD').replace(/\p{M}/gu, '') : text
  return stripped.toLowerCase()
}

const likeCache = new Map<string, RegExp>()

/**
 * Whether a string matches a LIKE pattern: % for any characters, _ for one,
 * and the escape character, \ by default, before either for itself. With
 * `ci`, it compares without case and accents, as _ci collations do.
 */
export function like(value: string, pattern: string, escape: string, ci: boolean): boolean {
  const key = `${ci ? 1 : 0}${escape}\u0000${pattern}`
  let regex = likeCache.get(key)
  if (regex === undefined) {
    let source = '^'
    const chars = [...(ci ? foldCase(pattern) : pattern)]
    for (let i = 0; i < chars.length; i++) {
      const char = chars[i]!
      if (char === escape && i + 1 < chars.length) {
        source += chars[++i]!.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')
      } else if (char === '%') source += '[\\s\\S]*'
      else if (char === '_') source += '[\\s\\S]'
      else source += char.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')
    }
    regex = new RegExp(`${source}$`, 'u')
    if (likeCache.size > 1000) likeCache.clear()
    likeCache.set(key, regex)
  }
  return regex.test(ci ? foldCase(value) : value)
}

const regexpCache = new Map<string, RegExp>()

function regexpOf(pattern: string, ci: boolean, global: boolean, host: FunctionHost): RegExp {
  const key = `${ci ? 'i' : ''}${global ? 'g' : ''}\u0000${pattern}`
  let regex = regexpCache.get(key)
  if (regex === undefined) {
    try {
      regex = new RegExp(pattern, `u${ci ? 'i' : ''}${global ? 'g' : ''}`)
    } catch (error) {
      host.fail(new SqlError(1139, '42000', `Got error '${(error as Error).message}' from regexp`))
    }
    if (regexpCache.size > 1000) regexpCache.clear()
    regexpCache.set(key, regex)
  }
  regex.lastIndex = 0
  return regex
}

/** The datetime of a value for comparisons and the like: as text in the form MariaDB writes datetimes. */
function canonicalDateTime(value: SqlValue, kind: string): string | null {
  if (kind === 'time') {
    const time = timeOf(value)
    return time === null ? null : formatTime(time, 6)
  }
  const datetime = dateTimeOf(value)
  if (datetime === null) return null
  return kind === 'date'
    ? formatDate(datetime)
    : formatDateTime(datetime, datetime.micro > 0 ? 6 : 0)
}

/** The number of a temporal value's digits, as MariaDB reads them in arithmetic: 20240506070809. */
function temporalNumber(value: SqlValue, kind: string): number | null {
  if (kind === 'time') {
    const time = timeOf(value)
    if (time === null) return null
    const number = time.hours * 10000 + time.minute * 100 + time.second + time.micro / 1e6
    return time.negative ? -number : number
  }
  const datetime = dateTimeOf(value)
  if (datetime === null) return null
  const date = datetime.year * 10000 + datetime.month * 100 + datetime.day
  if (kind === 'date') return date
  return (
    date * 1_000_000 +
    datetime.hour * 10000 +
    datetime.minute * 100 +
    datetime.second +
    datetime.micro / 1e6
  )
}

/** The local datetime of the session at the statement's time. */
function now(host: FunctionHost, zone = host.zone()): DateTime {
  const ms = host.statementTime()
  const whole = Math.floor(ms)
  return localDateTime(whole, zone, Math.round((ms - whole) * 1000))
}

/** A time zone of an offset such as +02:00, as CONVERT_TZ and time_zone take them, or the system's. */
export function zoneOf(text: string, system: TimeZone): TimeZone | undefined {
  if (text.toUpperCase() === 'SYSTEM') return system
  const match = /^([+-])(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (match === null) return undefined
  const minutes = (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '-' ? -1 : 1)
  if (Math.abs(minutes) > 14 * 60) return undefined
  return { offset: () => minutes, standardOffset: minutes, dstBias: 0, names: [text, text] }
}

/** A JSON document, or null with MariaDB's warning for text that is none. */
function documentOf(
  value: SqlValue,
  host: FunctionHost,
  fn: string,
  argument = 1,
): { text: string; node: JsonNode } | null {
  if (value === null) return null
  const text = textOf(value)
  const node = tryParseJson(text)
  if (node === undefined) {
    host.warn(
      4038,
      `Syntax error in JSON text in argument ${argument} to function '${fn}' at position 1`,
    )
    return null
  }
  return { text, node }
}

function pathOf(value: SqlValue, host: FunctionHost, fn: string, argument: number) {
  if (value === null) return null
  const path = parseJsonPath(textOf(value))
  if (path === undefined) {
    host.warn(
      4042,
      `Syntax error in JSON path in argument ${argument} to function '${fn}' at position 1`,
    )
    return null
  }
  return path
}

/** A value as JSON writes it: JSON as it is, numbers as numbers, strings quoted; `json` says which values are JSON. */
function jsonValueText(value: SqlValue, json: boolean): string {
  if (value === null) return 'null'
  if (json) return textOf(value)
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : doubleText(value)
  if (typeof value === 'bigint') return value.toString()
  return quoteJson(textOf(value))
}

/** The digest of a value as hex, as MD5 and SHA give them. */
function digestArg(value: SqlValue): Uint8Array | null {
  return bytesArg(value)
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function toBase64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const [a = 0, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]]
    const n = (a << 16) | (b << 8) | c
    text += BASE64[(n >> 18) & 63]! + BASE64[(n >> 12) & 63]!
    text += i + 1 < bytes.length ? BASE64[(n >> 6) & 63]! : '='
    text += i + 2 < bytes.length ? BASE64[n & 63]! : '='
    // MariaDB breaks lines of base64 every 76 characters.
    if ((i / 3 + 1) % 19 === 0 && i + 3 < bytes.length) text += '\n'
  }
  return text
}

function fromBase64(text: string): Uint8Array | null {
  const clean = text.replace(/\s/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) return null
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of clean.replace(/=+$/, '')) {
    buffer = (buffer << 6) | BASE64.indexOf(char)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  return Uint8Array.from(bytes)
}

/** Groups of digits of a number, as FORMAT writes them in a locale. */
function formatNumber(value: number, decimals: number, locale: string): string {
  const fixed = roundDecimal(decimalOf(value)?.decimal ?? '0', Math.max(0, Math.min(decimals, 38)))
  const negative = fixed.startsWith('-')
  const [integer = '0', fraction] = (negative ? fixed.slice(1) : fixed).split('.')
  const european = /^(de|es|it|nl|pt|ro|tr|da|id|sl|hr|sr|bs|is)_/i.test(locale)
  const group = european ? '.' : ','
  const point = european ? ',' : '.'
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, group)
  return `${negative ? '-' : ''}${grouped}${fraction === undefined ? '' : point + fraction}`
}

/** Rounds a number to `digits` after its point, which may be negative: half away from zero for exact values, half to even for doubles. */
function roundTo(value: number, digits: number, exact: boolean): number {
  if (exact) {
    if (digits >= 0) return Number(roundDecimal(decimalOf(value)!.decimal, digits))
    const scale = 10 ** -digits
    return Math.sign(value) * Math.round(Math.abs(value) / scale) * scale
  }
  const scale = 10 ** digits
  const scaled = value * scale
  const floor = Math.floor(scaled)
  const diff = scaled - floor
  let rounded: number
  if (diff > 0.5) rounded = floor + 1
  else if (diff < 0.5) rounded = floor
  else rounded = floor % 2 === 0 ? floor : floor + 1
  return rounded / scale
}

function truncateTo(value: number, digits: number): number {
  const scale = 10 ** digits
  return Math.trunc(value * scale) / scale
}

/** A version 1 UUID, of the time and a node of its own, as UUID() gives them. */
function uuidV1(ms: number, sequence: number, node: string): string {
  // 100-nanosecond intervals since the Gregorian epoch, 1582-10-15.
  const intervals = BigInt(Math.floor(ms)) * 10000n + 122192928000000000n + BigInt(sequence % 10000)
  const low = (intervals & 0xffffffffn).toString(16).padStart(8, '0')
  const mid = ((intervals >> 32n) & 0xffffn).toString(16).padStart(4, '0')
  const high = (((intervals >> 48n) & 0x0fffn) | 0x1000n).toString(16).padStart(4, '0')
  const clock = (0x8000 | (sequence & 0x3fff)).toString(16).padStart(4, '0')
  return `${low}-${mid}-${high}-${clock}-${node}`
}

/** Reads a string as a date by a format, as STR_TO_DATE does: the parts it has, or null. */
function strToDate(
  text: string,
  format: string,
): { value: DateTime; date: boolean; time: boolean } | null {
  let at = 0
  const parts = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0, micro: 0 }
  let date = false
  let time = false
  let pm: boolean | undefined
  let dayOfYearValue: number | undefined
  const digits = (max: number): number | null => {
    const match = new RegExp(`^\\d{1,${max}}`).exec(text.slice(at))
    if (match === null) return null
    at += match[0].length
    return Number(match[0])
  }
  const word = (names: readonly string[], length?: number): number | null => {
    const rest = text.slice(at).toLowerCase()
    for (let i = 0; i < names.length; i++) {
      const name = (length === undefined ? names[i]! : names[i]!.slice(0, length)).toLowerCase()
      if (rest.startsWith(name)) {
        at += name.length
        return i
      }
    }
    return null
  }
  const months = Array.from({ length: 12 }, (_, i) => monthName(i + 1)!)
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  for (let i = 0; i < format.length; i++) {
    const char = format[i]!
    if (char !== '%' || i === format.length - 1) {
      if (/\s/.test(char)) {
        while (at < text.length && /\s/.test(text[at]!)) at++
        continue
      }
      if (text[at] !== char) return null
      at++
      continue
    }
    const spec = format[++i]!
    let value: number | null
    switch (spec) {
      case 'Y':
        value = digits(4)
        if (value === null) return null
        parts.year = value < 100 && at <= 2 ? (value < 70 ? 2000 + value : 1900 + value) : value
        date = true
        break
      case 'y':
        value = digits(2)
        if (value === null) return null
        parts.year = value < 70 ? 2000 + value : 1900 + value
        date = true
        break
      case 'm':
      case 'c':
        value = digits(2)
        if (value === null) return null
        parts.month = value
        date = true
        break
      case 'M':
      case 'b':
        value = word(months, spec === 'b' ? 3 : undefined)
        if (value === null) return null
        parts.month = value + 1
        date = true
        break
      case 'd':
      case 'e':
        value = digits(2)
        if (value === null) return null
        parts.day = value
        date = true
        break
      case 'D':
        value = digits(2)
        if (value === null) return null
        parts.day = value
        at += /^(st|nd|rd|th)/i.test(text.slice(at)) ? 2 : 0
        date = true
        break
      case 'j':
        value = digits(3)
        if (value === null) return null
        dayOfYearValue = value
        date = true
        break
      case 'H':
      case 'k':
      case 'h':
      case 'I':
      case 'l':
        value = digits(2)
        if (value === null) return null
        parts.hour = value
        time = true
        break
      case 'i':
        value = digits(2)
        if (value === null) return null
        parts.minute = value
        time = true
        break
      case 's':
      case 'S':
        value = digits(2)
        if (value === null) return null
        parts.second = value
        time = true
        break
      case 'f': {
        const match = /^\d{1,6}/.exec(text.slice(at))
        if (match === null) return null
        at += match[0].length
        parts.micro = Number(match[0].padEnd(6, '0'))
        time = true
        break
      }
      case 'p': {
        const marker = text.slice(at, at + 2).toUpperCase()
        if (marker !== 'AM' && marker !== 'PM') return null
        pm = marker === 'PM'
        at += 2
        break
      }
      case 'a':
      case 'W':
        if (word(days, spec === 'a' ? 3 : undefined) === null) return null
        break
      case 'T':
      case 'r': {
        const match = /^(\d{1,2}):(\d{1,2}):(\d{1,2})/.exec(text.slice(at))
        if (match === null) return null
        at += match[0].length
        parts.hour = Number(match[1])
        parts.minute = Number(match[2])
        parts.second = Number(match[3])
        time = true
        if (spec === 'r') {
          while (text[at] === ' ') at++
          const marker = text.slice(at, at + 2).toUpperCase()
          if (marker === 'AM' || marker === 'PM') {
            pm = marker === 'PM'
            at += 2
          }
        }
        break
      }
      case '%':
        if (text[at] !== '%') return null
        at++
        break
      default:
        if (text[at] !== spec) return null
        at++
    }
  }
  if (pm !== undefined) {
    if (parts.hour > 12 || parts.hour === 0) return null
    parts.hour = (parts.hour % 12) + (pm ? 12 : 0)
  }
  if (dayOfYearValue !== undefined) {
    const base = dayNumber(parts.year, 1, 1) + dayOfYearValue - 1
    const { month, day } = fromDayNumber(base)
    parts.month = month
    parts.day = day
  }
  if (
    parts.month > 12 ||
    parts.day > 31 ||
    parts.hour > 23 ||
    parts.minute > 59 ||
    parts.second > 59
  )
    return null
  if (parts.month > 0 && parts.day > daysInMonth(parts.year, parts.month)) return null
  return { value: parts, date, time }
}

/** The bits of values an aggregate folds, by the context SQLite gives each group. */
class Groups<T> {
  readonly #groups = new Map<number, T>()
  readonly #sqlite: Sqlite
  readonly #initial: () => T

  constructor(sqlite: Sqlite, initial: () => T) {
    this.#sqlite = sqlite
    this.#initial = initial
  }

  step(context: number): T {
    const key = this.#sqlite.capi.sqlite3_aggregate_context(context, 8)
    let group = this.#groups.get(key)
    if (group === undefined) {
      group = this.#initial()
      this.#groups.set(key, group)
    }
    return group
  }

  /** The group of a context, which SQLite gives no memory for if no row stepped it, and forgets it. */
  final(context: number): T | undefined {
    const key = this.#sqlite.capi.sqlite3_aggregate_context(context, 0)
    if (key === 0) return undefined
    const group = this.#groups.get(key)
    this.#groups.delete(key)
    return group
  }
}

/** MariaDB's group_concat_max_len, in bytes. */
const GROUP_CONCAT_MAX_LEN = 1_048_576

/** The options of SQLite's functions, as FiveRunner gives them: of any number of arguments, as SQLite's values. */
type FunctionOptions =
  | {
      readonly name: string
      readonly arity: -1
      readonly deterministic: boolean
      readonly xFunc: (context: number, ...args: SqlValue[]) => SqlValue
    }
  | {
      readonly name: string
      readonly arity: -1
      readonly xStep: (context: number, ...args: SqlValue[]) => void
      readonly xFinal: (context: number) => SqlValue
    }

/** Registers the functions FiveRunner's compiler calls in SQLite, which take what they need from `host`. */
export function registerFunctions(db: SqliteDatabase, sqlite: Sqlite, host: FunctionHost): void {
  // SQLite gives the functions no ArrayBuffers, which FiveRunner's values leave out.
  const create = (options: FunctionOptions) => db.createFunction(options as never)
  const define = (name: string, fn: Fn, deterministic = true) => {
    create({
      name,
      arity: -1,
      deterministic,
      xFunc: (_context: number, ...args: SqlValue[]) => {
        const result = fn(...args)
        return result === undefined ? null : result
      },
    })
  }
  const aggregate = <T>(
    name: string,
    initial: () => T,
    step: (group: T, ...args: SqlValue[]) => void,
    final: (group: T | undefined) => SqlValue,
  ) => {
    const groups = new Groups(sqlite, initial)
    create({
      name,
      arity: -1,
      xStep: (context: number, ...args: SqlValue[]) => step(groups.step(context), ...args),
      xFinal: (context: number) => final(groups.final(context)) ?? null,
    })
  }

  // Values and variables

  define('fr_var', (name) => host.userVariable(String(name)), false)
  define(
    'fr_set_var',
    (name, value) => {
      host.setUserVariable(String(name), value ?? null)
      return value ?? null
    },
    false,
  )
  define('fr_sysvar', (name) => host.systemVariable(String(name)), false)
  define(
    'fr_last_insert_id',
    (...args) => {
      if (args.length > 0) {
        const value = integerOf(args[0] ?? null)
        host.setLastInsertId(value ?? 0)
        return value
      }
      return host.lastInsertId()
    },
    false,
  )
  define('fr_found_rows', () => host.foundRows(), false)
  define('fr_row_count', () => host.rowCount(), false)
  define('fr_database', () => host.database(), false)
  define('fr_version', () => host.version)
  define('fr_connection_id', () => host.connectionId(), false)
  define('fr_user', () => host.user(), false)
  define('fr_sleep', (seconds) => (seconds === null ? null : 0), false)
  define('fr_lock', () => 1, false)
  define('fr_is_used_lock', () => null, false)

  // Arithmetic and comparisons

  define(
    'fr_div',
    (a, b, strict) => {
      const x = numberOf(a ?? null)
      const y = numberOf(b ?? null)
      if (x === null || y === null) return null
      if (y === 0) {
        if (strict === 1) host.fail(new SqlError(1365, '22012', 'Division by 0'))
        host.warn(1365, 'Division by 0')
        return null
      }
      return x / y
    },
    false,
  )
  define('fr_intdiv', (a, b) => {
    const x = numberOf(a ?? null)
    const y = numberOf(b ?? null)
    if (x === null || y === null || y === 0) return null
    return Math.trunc(x / y)
  })
  define('fr_mod', (a, b) => {
    if (typeof a === 'bigint' || typeof b === 'bigint') {
      if (a === null || b === null || BigInt(b as bigint) === 0n) return null
      return BigInt(a as bigint) % BigInt(b as bigint)
    }
    const x = numberOf(a ?? null)
    const y = numberOf(b ?? null)
    if (x === null || y === null || y === 0) return null
    return x % y
  })
  const unsigned64 = (value: bigint): SqlValue => sqliteInteger(BigInt.asUintN(64, value))
  const bigOf = (value: SqlValue): bigint | null => {
    if (value === null) return null
    if (typeof value === 'bigint') return value
    const number = integerOf(value)
    return number === null ? null : BigInt(number)
  }
  define('fr_bit', (op, a, b) => {
    const x = bigOf(a ?? null)
    if (x === null) return null
    if (op === '~') return unsigned64(~x)
    const y = bigOf(b ?? null)
    if (y === null) return null
    switch (op) {
      case '|':
        return unsigned64(x | y)
      case '&':
        return unsigned64(x & y)
      case '^':
        return unsigned64(x ^ y)
      case '<<':
        return y >= 64n ? 0 : unsigned64(BigInt.asUintN(64, x) << y)
      default:
        return y >= 64n ? 0 : unsigned64(BigInt.asUintN(64, x) >> y)
    }
  })
  define('fr_like', (value, pattern, escape, ci) => {
    if (value === null || pattern === null) return null
    return like(
      textOf(value),
      textOf(pattern),
      escape === null || escape === '' ? '\\' : textOf(escape ?? '\\'),
      ci === 1,
    )
      ? 1
      : 0
  })
  define('fr_regexp', (value, pattern, ci) => {
    if (value === null || pattern === null) return null
    return regexpOf(textOf(pattern), ci === 1, false, host).test(textOf(value)) ? 1 : 0
  })
  define('fr_regexp_replace', (value, pattern, replacement, ci) => {
    if (value === null || pattern === null || replacement === null) return null
    const regex = regexpOf(textOf(pattern), ci === 1, true, host)
    return textOf(value).replace(regex, textOf(replacement ?? '').replace(/\\(\d)/g, '$$$1'))
  })
  define('fr_regexp_substr', (value, pattern, ci) => {
    if (value === null || pattern === null) return null
    return regexpOf(textOf(pattern), ci === 1, false, host).exec(textOf(value))?.[0] ?? ''
  })
  define('fr_regexp_instr', (value, pattern, ci) => {
    if (value === null || pattern === null) return null
    const text = textOf(value)
    const match = regexpOf(textOf(pattern), ci === 1, false, host).exec(text)
    return match === null ? 0 : [...text.slice(0, match.index)].length + 1
  })
  define('fr_datetime', (value, kind) => canonicalDateTime(value ?? null, String(kind)))
  define('fr_temporal_number', (value, kind) => temporalNumber(value ?? null, String(kind)))
  define('fr_greatest', (mode, ...args) => {
    if (args.some((arg) => arg === null)) return null
    const greatest = mode === 'gn' || mode === 'gs' || mode === 'gc'
    const kind = String(mode).slice(1)
    let best = args[0]!
    for (const arg of args.slice(1) as Exclude<SqlValue, null>[]) {
      let order: number
      if (kind === 'n') order = numberOf(arg)! - numberOf(best)!
      else {
        const a = kind === 'c' ? foldText(textOf(arg)) : textOf(arg)
        const b = kind === 'c' ? foldText(textOf(best)) : textOf(best)
        order = a < b ? -1 : a > b ? 1 : 0
      }
      if (greatest ? order > 0 : order < 0) best = arg
    }
    return kind === 'n' ? numberOf(best) : textOf(best)
  })
  define('fr_interval', (n, ...bounds) => {
    const value = numberOf(n ?? null)
    if (value === null) return -1
    let index = 0
    while (index < bounds.length && numberOf(bounds[index] ?? null)! <= value) index++
    return index
  })
  define('fr_field', (ci, needle, ...list) => {
    if (needle === null) return 0
    const numeric = typeof needle === 'number' || typeof needle === 'bigint'
    for (let i = 0; i < list.length; i++) {
      const item = list[i] ?? null
      if (item === null) continue
      const equal = numeric
        ? numberOf(item) === numberOf(needle)
        : ci === 1
          ? foldText(textOf(item)) === foldText(textOf(needle))
          : textOf(item) === textOf(needle)
      if (equal) return i + 1
    }
    return 0
  })
  define('fr_elt', (n, ...list) => {
    const index = integerOf(n ?? null)
    if (index === null || index < 1 || index > list.length) return null
    return list[index - 1] ?? null
  })
  define('fr_tuple', (...values) => {
    if (values.some((value) => value === null)) return null
    return JSON.stringify(
      values.map((value) => (typeof value === 'string' ? foldText(value) : textOf(value!))),
    )
  })

  // Strings

  define('fr_concat', (...args) => {
    if (args.some((arg) => arg === null)) return null
    return args.map((arg) => textOf(arg!)).join('')
  })
  define('fr_concat_ws', (separator, ...args) => {
    if (separator === null) return null
    return args
      .filter((arg) => arg !== null)
      .map((arg) => textOf(arg!))
      .join(textOf(separator))
  })
  define('fr_length', (value) =>
    value === null
      ? null
      : (value instanceof Uint8Array ? value : bytesOfText(textOf(value))).length,
  )
  define('fr_char_length', (value, binary) =>
    value === null ? null : binary === 1 ? bytesArg(value)!.length : [...textOf(value)].length,
  )
  define('fr_lower', (value) => (value === null ? null : changeCase(textOf(value), false)))
  define('fr_upper', (value) => (value === null ? null : changeCase(textOf(value), true)))
  // The length is optional, and NULL gives NULL.
  define('fr_substring', (binary, value, start, length) => {
    if (value === null || start === null || length === null) return null
    const parts = units(textOf(value), binary === 1)
    let from = integerOf(start)!
    if (from === 0 || Math.abs(from) > parts.length) return joinUnits([], binary === 1)
    from = from > 0 ? from - 1 : parts.length + from
    const count = length === undefined ? parts.length : integerOf(length)!
    if (count < 1) return joinUnits([], binary === 1)
    return joinUnits(parts.slice(from, from + count), binary === 1)
  })
  define('fr_left', (value, length, binary) => {
    if (value === null || length === null) return null
    const count = integerOf(length ?? null)!
    return joinUnits(units(textOf(value), binary === 1).slice(0, Math.max(0, count)), binary === 1)
  })
  define('fr_right', (value, length, binary) => {
    if (value === null || length === null) return null
    const count = integerOf(length ?? null)!
    const parts = units(textOf(value), binary === 1)
    return joinUnits(count <= 0 ? [] : parts.slice(Math.max(0, parts.length - count)), binary === 1)
  })
  define('fr_trim', (value, side, remove) => {
    if (value === null || remove === null) return null
    let text = textOf(value)
    const cut = remove === undefined ? ' ' : textOf(remove)
    if (cut === '') return text
    if (side !== 'TRAILING') while (text.startsWith(cut)) text = text.slice(cut.length)
    if (side !== 'LEADING')
      while (text.endsWith(cut) && text.length > 0) text = text.slice(0, -cut.length)
    return text
  })
  define('fr_ltrim', (value) => (value === null ? null : textOf(value).replace(/^ +/, '')))
  define('fr_rtrim', (value) => (value === null ? null : textOf(value).replace(/ +$/, '')))
  define('fr_replace', (value, from, to) => {
    if (value === null || from === null || to === null) return null
    const search = textOf(from)
    return search === '' ? textOf(value) : textOf(value).split(search).join(textOf(to))
  })
  define('fr_reverse', (value, binary) =>
    value === null ? null : joinUnits(units(textOf(value), binary === 1).reverse(), binary === 1),
  )
  define('fr_repeat', (value, count) => {
    if (value === null || count === null) return null
    const times = integerOf(count ?? null)!
    return times <= 0 ? '' : textOf(value).repeat(Math.min(times, 1_000_000))
  })
  define('fr_space', (count) => {
    const times = integerOf(count ?? null)
    return times === null ? null : ' '.repeat(Math.max(0, Math.min(times, 1_000_000)))
  })
  const pad = (value: SqlValue, length: SqlValue, padding: SqlValue, left: boolean): SqlValue => {
    if (value === null || length === null || padding === null) return null
    const target = integerOf(length)!
    if (target < 0) return null
    const text = [...textOf(value)]
    if (text.length >= target) return text.slice(0, target).join('')
    const fill = [...textOf(padding)]
    if (fill.length === 0) return null
    const extra: string[] = []
    while (extra.length < target - text.length) extra.push(fill[extra.length % fill.length]!)
    return left ? extra.join('') + text.join('') : text.join('') + extra.join('')
  }
  define('fr_lpad', (value, length, padding) =>
    pad(value ?? null, length ?? null, padding === undefined ? ' ' : padding, true),
  )
  define('fr_rpad', (value, length, padding) =>
    pad(value ?? null, length ?? null, padding === undefined ? ' ' : padding, false),
  )
  define('fr_locate', (needle, haystack, start, ci) => {
    if (needle === null || haystack === null || start === null) return null
    const fold = (text: string) => (ci === 1 ? foldCase(text) : text)
    const chars = [...fold(textOf(haystack))]
    const search = fold(textOf(needle))
    const from = start === undefined ? 1 : integerOf(start)!
    if (from < 1) return 0
    const index = chars.join('').indexOf(search, chars.slice(0, from - 1).join('').length)
    return index === -1 ? 0 : [...chars.join('').slice(0, index)].length + 1
  })
  define('fr_find_in_set', (needle, list, ci) => {
    if (needle === null || list === null) return null
    const text = textOf(needle)
    if (text.includes(',')) return 0
    const items = textOf(list).split(',')
    const index = items.findIndex((item) =>
      ci === 1 ? foldText(item) === foldText(text) : item === text,
    )
    return textOf(list) === '' ? 0 : index + 1
  })
  define('fr_ascii', (value) => {
    if (value === null) return null
    const bytes = bytesArg(value)!
    return bytes.length === 0 ? 0 : bytes[0]!
  })
  define('fr_ord', (value) => {
    if (value === null) return null
    const char = [...textOf(value)][0]
    if (char === undefined) return 0
    const bytes = bytesOfText(char)
    return bytes.reduce((code, byte) => code * 256 + byte, 0)
  })
  define('fr_char', (...codes) => {
    const bytes: number[] = []
    for (const code of codes) {
      const value = integerOf(code ?? null)
      if (value === null) continue
      const chunk: number[] = []
      let rest = BigInt.asUintN(32, BigInt(value))
      do {
        chunk.unshift(Number(rest & 0xffn))
        rest >>= 8n
      } while (rest > 0n)
      bytes.push(...chunk)
    }
    return Uint8Array.from(bytes)
  })
  define('fr_hex', (value) => {
    if (value === null) return null
    if (typeof value === 'number' || typeof value === 'bigint') {
      const integer =
        typeof value === 'bigint' ? value : BigInt(Math.sign(value) * Math.round(Math.abs(value)))
      return BigInt.asUintN(64, integer).toString(16).toUpperCase()
    }
    return [...bytesArg(value)!]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  })
  define('fr_unhex', (value) => {
    if (value === null) return null
    const text = textOf(value)
    const digits = text.length % 2 === 0 ? text : `0${text}`
    if (!/^[0-9a-fA-F]*$/.test(digits)) return null
    return Uint8Array.from(digits.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))
  })
  define('fr_format', (value, decimals, locale) => {
    const number = numberOf(value ?? null)
    const digits = integerOf(decimals ?? null)
    if (number === null || digits === null) return null
    return formatNumber(
      number,
      digits,
      locale === undefined || locale === null ? 'en_US' : textOf(locale),
    )
  })
  define('fr_insert', (value, start, length, replacement) => {
    if (value === null || start === null || length === null || replacement === null) return null
    const chars = [...textOf(value)]
    const from = integerOf(start)!
    if (from < 1 || from > chars.length) return textOf(value)
    const count = integerOf(length)!
    const end = count < 0 || from - 1 + count > chars.length ? chars.length : from - 1 + count
    return chars.slice(0, from - 1).join('') + textOf(replacement) + chars.slice(end).join('')
  })
  define('fr_strcmp', (a, b, ci) => {
    if (a === null || b === null) return null
    const x = ci === 1 ? foldText(textOf(a)) : textOf(a)
    const y = ci === 1 ? foldText(textOf(b)) : textOf(b)
    return x < y ? -1 : x > y ? 1 : 0
  })
  define('fr_substring_index', (value, delimiter, count) => {
    if (value === null || delimiter === null || count === null) return null
    const text = textOf(value)
    const delim = textOf(delimiter)
    const n = integerOf(count)!
    if (delim === '' || n === 0) return ''
    const parts = text.split(delim)
    return n > 0
      ? parts.slice(0, n).join(delim)
      : parts.slice(Math.max(0, parts.length + n)).join(delim)
  })
  define('fr_quote', (value) => {
    if (value === null) return 'NULL'
    const text = textOf(value)
    return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\0/g, '\\0').replace(/\x1a/g, '\\Z')}'`
  })
  define('fr_md5', (value) => {
    const bytes = digestArg(value ?? null)
    return bytes === null ? null : md5(bytes)
  })
  define('fr_sha1', (value) => {
    const bytes = digestArg(value ?? null)
    return bytes === null ? null : sha1(bytes)
  })
  define('fr_sha2', (value, bits) => {
    const bytes = digestArg(value ?? null)
    const size = integerOf(bits ?? null)
    if (bytes === null || size === null) return null
    return sha2(bytes, size) ?? null
  })
  define('fr_crc32', (value) => {
    const bytes = bytesArg(value ?? null)
    return bytes === null ? null : crc32(bytes)
  })
  define('fr_to_base64', (value) => {
    const bytes = bytesArg(value ?? null)
    return bytes === null ? null : toBase64(bytes)
  })
  define('fr_from_base64', (value) => (value === null ? null : fromBase64(textOf(value))))
  let uuidSequence = 0
  const node = Array.from({ length: 6 }, (_, i) =>
    (i === 0 ? 0x02 : Math.floor(host.random() * 256)).toString(16).padStart(2, '0'),
  ).join('')
  define('fr_uuid', () => uuidV1(host.statementTime(), uuidSequence++, node), false)
  define(
    'fr_uuid_short',
    () => (BigInt(Math.floor(host.statementTime() / 1000)) << 24n) + BigInt(uuidSequence++),
    false,
  )
  define('fr_rand', () => host.random(), false)
  define('fr_bin', (value) => {
    const integer = bigOf(value ?? null)
    return integer === null ? null : BigInt.asUintN(64, integer).toString(2)
  })
  define('fr_oct', (value) => {
    const integer = bigOf(value ?? null)
    return integer === null ? null : BigInt.asUintN(64, integer).toString(8)
  })
  define('fr_conv', (value, from, to) => {
    if (value === null || from === null || to === null) return null
    const source = Math.abs(integerOf(from)!)
    const target = integerOf(to)!
    if (source < 2 || source > 36 || Math.abs(target) < 2 || Math.abs(target) > 36) return null
    const text = textOf(value).trim().toLowerCase()
    const digits = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, source)
    let negative = false
    let rest = text
    if (rest.startsWith('-')) {
      negative = true
      rest = rest.slice(1)
    }
    let number = 0n
    for (const char of rest) {
      const digit = digits.indexOf(char)
      if (digit === -1) break
      number = number * BigInt(source) + BigInt(digit)
    }
    if (negative) number = target < 0 ? -number : BigInt.asUintN(64, -number)
    const sign = number < 0n ? '-' : ''
    return sign + (number < 0n ? -number : number).toString(Math.abs(target)).toUpperCase()
  })
  define('fr_inet_aton', (value) => {
    if (value === null) return null
    const parts = textOf(value).split('.')
    if (parts.length > 4 || parts.some((part) => !/^\d+$/.test(part) || Number(part) > 255))
      return null
    // Fewer than four parts fill from the right, as 127.1 is 127.0.0.1.
    const numbers = parts.map(Number)
    const last = numbers.pop()!
    return numbers.reduce((sum, part, i) => sum + part * 256 ** (3 - i), 0) + last
  })
  define('fr_inet_ntoa', (value) => {
    const number = integerOf(value ?? null)
    if (number === null || number < 0 || number > 0xffffffff) return null
    return [24, 16, 8, 0].map((shift) => Math.floor(number / 2 ** shift) % 256).join('.')
  })

  // Numbers

  define('fr_math', (op, a, b) => {
    if (op === 'pi') return Math.PI
    const x = numberOf(a ?? null)
    if (x === null) return null
    const y = b === undefined ? undefined : numberOf(b)
    if (y === null) return null
    switch (op) {
      case 'abs':
        if (typeof a === 'bigint') return a < 0n ? -a : a
        return Math.abs(x)
      case 'ceil':
        return Math.ceil(x)
      case 'floor':
        return Math.floor(x)
      case 'sign':
        return Math.sign(x)
      case 'sqrt':
        return x < 0 ? null : Math.sqrt(x)
      case 'exp':
        return Math.exp(x)
      case 'ln':
        return x <= 0 ? null : Math.log(x)
      case 'log':
        if (y === undefined) return x <= 0 ? null : Math.log(x)
        return x <= 0 || x === 1 || y <= 0 ? null : Math.log(y) / Math.log(x)
      case 'log2':
        return x <= 0 ? null : Math.log2(x)
      case 'log10':
        return x <= 0 ? null : Math.log10(x)
      case 'pow': {
        const result = x ** y!
        if (!Number.isFinite(result))
          host.fail(
            new SqlError(
              1690,
              '22003',
              `DOUBLE value is out of range in 'pow(${doubleText(x)},${doubleText(y!)})'`,
            ),
          )
        return Number.isNaN(result) ? null : result
      }
      case 'sin':
        return Math.sin(x)
      case 'cos':
        return Math.cos(x)
      case 'tan':
        return Math.tan(x)
      case 'asin':
        return x < -1 || x > 1 ? null : Math.asin(x)
      case 'acos':
        return x < -1 || x > 1 ? null : Math.acos(x)
      case 'atan':
        return y === undefined ? Math.atan(x) : Math.atan2(x, y)
      case 'cot':
        return Math.tan(x) === 0 ? null : 1 / Math.tan(x)
      case 'degrees':
        return (x * 180) / Math.PI
      case 'radians':
        return (x * Math.PI) / 180
      default:
        return null
    }
  })
  define('fr_round', (value, digits, exact) => {
    const x = numberOf(value ?? null)
    const d = digits === undefined ? 0 : integerOf(digits)
    if (x === null || d === null) return null
    return roundTo(x, Math.max(-38, Math.min(d, 38)), exact === 1)
  })
  define('fr_truncate', (value, digits) => {
    const x = numberOf(value ?? null)
    const d = integerOf(digits ?? null)
    if (x === null || d === null) return null
    return truncateTo(x, Math.max(-38, Math.min(d, 38)))
  })

  // Casts

  define('fr_cast_signed', (value, unsigned) => {
    if (value === null) return null
    let integer: bigint
    if (typeof value === 'bigint') integer = value
    else if (typeof value === 'number')
      integer = BigInt(Math.sign(value) * Math.round(Math.abs(value)))
    else {
      const text = typeof value === 'string' ? value : textOfBytes(value)
      const match = /^\s*([+-]?\d+)/.exec(text)
      integer = match === null ? 0n : BigInt(match[1]!)
      if (match === null || text.slice(match[0].length).trim() !== '')
        host.warn(1292, `Truncated incorrect INTEGER value: '${text}'`)
    }
    return sqliteInteger(unsigned === 1 ? BigInt.asUintN(64, integer) : BigInt.asIntN(64, integer))
  })
  define('fr_cast_char', (value, length) => {
    if (value === null) return null
    const text = textOf(value)
    if (length === null || length === undefined) return text
    return [...text].slice(0, Number(length)).join('')
  })
  define('fr_cast_binary', (value, length) => {
    const bytes = bytesArg(value ?? null)
    if (bytes === null) return null
    if (length === null || length === undefined) return bytes
    const size = Number(length)
    const result = new Uint8Array(size)
    result.set(bytes.slice(0, size))
    return result
  })
  define('fr_cast_decimal', (value, digits, scale) => {
    if (value === null) return null
    const decimal = decimalOf(value)?.decimal ?? '0'
    const rounded = roundDecimal(decimal, Number(scale))
    const limit = 10 ** (Number(digits) - Number(scale))
    const number = Number(rounded)
    if (Math.abs(number) >= limit) return Math.sign(number) * (limit - 10 ** -Number(scale))
    return number
  })
  define('fr_cast_double', (value) => numberOf(value ?? null))
  define('fr_cast_temporal', (value, kind, fsp) => {
    if (value === null) return null
    const digits = Number(fsp ?? 0)
    if (kind === 'time') {
      const time = timeOf(value)
      return time === null ? null : formatTime(truncateFraction(time, digits), digits)
    }
    const datetime = dateTimeOf(value)
    if (datetime === null) return null
    return kind === 'date'
      ? formatDate(datetime)
      : formatDateTime(truncateFraction(datetime, digits), digits)
  })

  // Dates and times

  define(
    'fr_now',
    (fsp, utc) => formatDateTime(now(host, utc === 1 ? UTC : host.zone()), Number(fsp ?? 0)),
    false,
  )
  define('fr_curdate', (utc) => formatDate(now(host, utc === 1 ? UTC : host.zone())), false)
  define(
    'fr_curtime',
    (fsp, utc) => {
      const current = now(host, utc === 1 ? UTC : host.zone())
      return formatTime(
        {
          negative: false,
          hours: current.hour,
          minute: current.minute,
          second: current.second,
          micro: current.micro,
        },
        Number(fsp ?? 0),
      )
    },
    false,
  )
  define(
    'fr_unix_timestamp',
    (...args) => {
      if (args.length === 0) return Math.floor(host.statementTime() / 1000)
      const datetime = dateTimeOf(args[0] ?? null)
      if (datetime === null || datetime.month === 0 || datetime.day === 0) return null
      const ms = epochOf(datetime, host.zone())
      if (ms < 0 || ms / 1000 >= 2 ** 31) return null
      const seconds = Math.floor(ms / 1000)
      return datetime.micro > 0 ? seconds + datetime.micro / 1e6 : seconds
    },
    false,
  )
  define(
    'fr_from_unixtime',
    (seconds, fsp, format) => {
      const value = numberOf(seconds ?? null)
      if (value === null || value < 0 || value >= 2 ** 31) return null
      const whole = Math.floor(value)
      const micro = Math.round((value - whole) * 1e6)
      const local = { ...localDateTime(whole * 1000, host.zone()), micro }
      if (format !== undefined && format !== null) return dateFormat(local, textOf(format)) ?? null
      return formatDateTime(local, Number(fsp ?? 0))
    },
    false,
  )
  define('fr_date_add', (date, value, unit, sign, kind, fsp) => {
    if (date === null || value === null) return null
    const interval = intervalOf(
      typeof value === 'number' ? value : textOf(value),
      String(unit) as IntervalUnit,
    )
    const datetime = dateTimeOf(date)
    if (interval === undefined || datetime === null) return null
    const signed =
      Number(sign) < 0 ? { months: -interval.months, micros: -interval.micros } : interval
    const result = addInterval(datetime, signed)
    if (result === undefined) {
      host.warn(1441, 'Datetime function: datetime field overflow')
      return null
    }
    const timeUnit = !['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR', 'YEAR_MONTH'].includes(
      String(unit),
    )
    const asDate =
      kind === 'date' ? !timeUnit : kind === 'auto' ? !timeUnit && !hasTime(date) : false
    if (asDate) return formatDate(result)
    const digits =
      kind === 'auto'
        ? result.micro > 0 || String(unit).includes('MICROSECOND')
          ? 6
          : 0
        : Number(fsp ?? 0)
    return formatDateTime(result, Math.max(digits, String(unit).includes('MICROSECOND') ? 6 : 0))
  })
  define('fr_datediff', (a, b) => {
    const x = dateTimeOf(a ?? null)
    const y = dateTimeOf(b ?? null)
    if (x === null || y === null) return null
    return dayNumber(x.year, x.month, x.day) - dayNumber(y.year, y.month, y.day)
  })
  define('fr_timediff', (a, b) => {
    if (a === null || b === null) return null
    const x = hasTime(a) || !/^\s*-?\d+:/.test(textOf(a)) ? dateTimeOf(a) : null
    const y = hasTime(b) || !/^\s*-?\d+:/.test(textOf(b)) ? dateTimeOf(b) : null
    if (x !== null && y !== null)
      return formatTime(timeOfMicros(microsBetween(y, x)), x.micro > 0 || y.micro > 0 ? 6 : 0)
    if (x !== null || y !== null) return null
    const t1 = timeOf(a)
    const t2 = timeOf(b)
    if (t1 === null || t2 === null) return null
    return formatTime(
      timeOfMicros(microsOfTime(t1) - microsOfTime(t2)),
      t1.micro > 0 || t2.micro > 0 ? 6 : 0,
    )
  })
  const UNIT_SIZES: Readonly<Record<string, number>> = {
    MICROSECOND: 1,
    SECOND: 1e6,
    MINUTE: 6e7,
    HOUR: 3.6e9,
    DAY: 8.64e10,
    WEEK: 6.048e11,
  }
  define('fr_timestampdiff', (unit, a, b) => {
    const x = dateTimeOf(a ?? null)
    const y = dateTimeOf(b ?? null)
    if (x === null || y === null) return null
    const name = String(unit)
    const size = UNIT_SIZES[name]
    if (size !== undefined) return Math.trunc(microsBetween(x, y) / size)
    const months = monthsBetween(x, y)
    return Math.trunc(months / (name === 'MONTH' ? 1 : name === 'QUARTER' ? 3 : 12))
  })
  define('fr_addtime', (value, time, sign) => {
    if (value === null || time === null) return null
    const interval = timeOf(time)
    if (interval === null) return null
    const micros = microsOfTime(interval) * (Number(sign) < 0 ? -1 : 1)
    if (hasTime(value) || /\d[-/.]\d/.test(textOf(value).slice(0, 10))) {
      const datetime = dateTimeOf(value)
      if (datetime === null) return null
      const result = addInterval(datetime, { months: 0, micros })
      return result === undefined ? null : formatDateTime(result, result.micro > 0 ? 6 : 0)
    }
    const base = timeOf(value)
    if (base === null) return null
    const result = timeOfMicros(microsOfTime(base) + micros)
    return formatTime(result, result.micro > 0 ? 6 : 0)
  })
  define('fr_date_format', (value, format) => {
    if (value === null || format === null) return null
    const datetime =
      dateTimeOf(value) ??
      (() => {
        const time = timeOf(value)
        return time === null
          ? null
          : {
              year: 0,
              month: 0,
              day: 0,
              hour: time.hours,
              minute: time.minute,
              second: time.second,
              micro: time.micro,
            }
      })()
    if (datetime === null) return null
    return dateFormat(datetime, textOf(format)) ?? null
  })
  define('fr_time_format', (value, format) => {
    if (value === null || format === null) return null
    const time = timeOf(value)
    if (time === null) return null
    const text = textOf(format)
    if (/%[aDbcdeYyjMUuVvWwXx]/.test(text)) return null
    return (
      dateFormat(
        {
          year: 0,
          month: 0,
          day: 0,
          hour: time.hours,
          minute: time.minute,
          second: time.second,
          micro: time.micro,
        },
        text,
      ) ?? null
    )
  })
  define('fr_str_to_date', (value, format) => {
    if (value === null || format === null) return null
    const parsed = strToDate(textOf(value), textOf(format))
    if (parsed === null) {
      host.warn(1411, `Incorrect datetime value: '${textOf(value)}' for function str_to_date`)
      return null
    }
    if (parsed.date && !parsed.time) return formatDate(parsed.value)
    if (parsed.time && !parsed.date) {
      const { hour, minute, second, micro } = parsed.value
      return formatTime({ negative: false, hours: hour, minute, second, micro }, micro > 0 ? 6 : 0)
    }
    return formatDateTime(parsed.value, parsed.value.micro > 0 ? 6 : 0)
  })
  define('fr_convert_tz', (value, from, to) => {
    if (value === null || from === null || to === null) return null
    const datetime = dateTimeOf(value)
    const source = zoneOf(textOf(from), host.zone())
    const target = zoneOf(textOf(to), host.zone())
    if (datetime === null || source === undefined || target === undefined) return null
    const ms = epochOf(datetime, source)
    return formatDateTime(
      { ...localDateTime(ms, target), micro: datetime.micro },
      datetime.micro > 0 ? 6 : 0,
    )
  })
  define('fr_timestamp', (value, time) => {
    const datetime = dateTimeOf(value ?? null)
    if (datetime === null) return null
    if (time === undefined) return formatDateTime(datetime, datetime.micro > 0 ? 6 : 0)
    const interval = timeOf(time)
    if (interval === null) return null
    const result = addInterval(datetime, { months: 0, micros: microsOfTime(interval) })
    return result === undefined ? null : formatDateTime(result, result.micro > 0 ? 6 : 0)
  })
  define('fr_datepart', (part, value, mode) => {
    if (value === null) return null
    const name = String(part)
    if (['HOUR', 'MINUTE', 'SECOND', 'MICROSECOND', 'TIME_TO_SEC'].includes(name)) {
      const time = timeOf(value)
      if (time === null) return null
      switch (name) {
        case 'HOUR':
          return time.hours
        case 'MINUTE':
          return time.minute
        case 'SECOND':
          return time.second
        case 'MICROSECOND':
          return time.micro
        default: {
          const seconds = time.hours * 3600 + time.minute * 60 + time.second + time.micro / 1e6
          return time.negative ? -seconds : seconds
        }
      }
    }
    const d = dateTimeOf(value)
    if (d === null) return null
    const zero = d.month === 0 || d.day === 0
    switch (name) {
      case 'YEAR':
        return d.year
      case 'MONTH':
        return d.month
      case 'DAY':
        return d.day
      case 'QUARTER':
        return Math.ceil(d.month / 3)
      case 'DAYOFWEEK':
        return zero ? null : ((weekday(d.year, d.month, d.day) + 1) % 7) + 1
      case 'WEEKDAY':
        return zero ? null : weekday(d.year, d.month, d.day)
      case 'DAYOFYEAR':
        return zero ? null : dayOfYear(d.year, d.month, d.day)
      case 'WEEK':
        return zero ? null : week(d.year, d.month, d.day, Number(mode ?? 0)).week
      case 'WEEKOFYEAR':
        return zero ? null : week(d.year, d.month, d.day, 3).week
      case 'YEARWEEK': {
        if (zero) return null
        const result = week(d.year, d.month, d.day, Number(mode ?? 0) | 2)
        return result.year * 100 + result.week
      }
      case 'DAYNAME':
        return zero ? null : dayName(d)
      case 'MONTHNAME':
        return d.month === 0 ? null : monthName(d.month)!
      case 'LAST_DAY':
        return d.month === 0 ? null : formatDate({ ...d, day: daysInMonth(d.year, d.month) })
      case 'TO_DAYS':
        return zero ? null : dayNumber(d.year, d.month, d.day)
      case 'TO_SECONDS':
        return zero
          ? null
          : dayNumber(d.year, d.month, d.day) * 86400 + d.hour * 3600 + d.minute * 60 + d.second
      case 'DATE':
        return formatDate(d)
      default:
        return null
    }
  })
  define('fr_extract', (unit, value) => {
    if (value === null) return null
    const name = String(unit)
    const d = dateTimeOf(value)
    const t = timeOf(value)
    const needsDate = ['YEAR', 'MONTH', 'QUARTER', 'WEEK', 'YEAR_MONTH'].includes(name)
    if (needsDate && d === null) return null
    if (t === null && d === null) return null
    const hour = t?.hours ?? d!.hour
    const minute = t?.minute ?? d!.minute
    const second = t?.second ?? d!.second
    const micro = t?.micro ?? d!.micro
    const day = d?.day ?? 0
    const pad2 = (n: number) => String(n).padStart(2, '0')
    switch (name) {
      case 'YEAR':
        return d!.year
      case 'MONTH':
        return d!.month
      case 'QUARTER':
        return Math.ceil(d!.month / 3)
      case 'WEEK':
        return week(d!.year, d!.month, d!.day, 0).week
      case 'YEAR_MONTH':
        return d!.year * 100 + d!.month
      case 'DAY':
        return day
      case 'HOUR':
        return hour
      case 'MINUTE':
        return minute
      case 'SECOND':
        return second
      case 'MICROSECOND':
        return micro
      case 'DAY_HOUR':
        return Number(`${day}${pad2(hour)}`)
      case 'DAY_MINUTE':
        return Number(`${day}${pad2(hour)}${pad2(minute)}`)
      case 'DAY_SECOND':
        return Number(`${day}${pad2(hour)}${pad2(minute)}${pad2(second)}`)
      case 'DAY_MICROSECOND':
        return Number(
          `${day}${pad2(hour)}${pad2(minute)}${pad2(second)}${String(micro).padStart(6, '0')}`,
        )
      case 'HOUR_MINUTE':
        return Number(`${hour}${pad2(minute)}`)
      case 'HOUR_SECOND':
        return Number(`${hour}${pad2(minute)}${pad2(second)}`)
      case 'HOUR_MICROSECOND':
        return Number(`${hour}${pad2(minute)}${pad2(second)}${String(micro).padStart(6, '0')}`)
      case 'MINUTE_SECOND':
        return Number(`${minute}${pad2(second)}`)
      case 'MINUTE_MICROSECOND':
        return Number(`${minute}${pad2(second)}${String(micro).padStart(6, '0')}`)
      case 'SECOND_MICROSECOND':
        return Number(`${second}${String(micro).padStart(6, '0')}`)
      default:
        return null
    }
  })
  define('fr_from_days', (days) => {
    const n = integerOf(days ?? null)
    if (n === null) return null
    if (n < 366) return '0000-00-00'
    const { year, month, day } = fromDayNumber(n)
    return year > 9999
      ? null
      : formatDate({ year, month, day, hour: 0, minute: 0, second: 0, micro: 0 })
  })
  define('fr_makedate', (year, day) => {
    const y = integerOf(year ?? null)
    const d = integerOf(day ?? null)
    if (y === null || d === null || d <= 0) return null
    const full = y < 70 ? 2000 + y : y < 100 ? 1900 + y : y
    const { year: ry, month, day: rd } = fromDayNumber(dayNumber(full, 1, 1) + d - 1)
    return ry > 9999
      ? null
      : formatDate({ year: ry, month, day: rd, hour: 0, minute: 0, second: 0, micro: 0 })
  })
  define('fr_maketime', (hour, minute, second) => {
    const h = integerOf(hour ?? null)
    const m = integerOf(minute ?? null)
    const s = numberOf(second ?? null)
    if (h === null || m === null || s === null || m < 0 || m > 59 || s < 0 || s >= 60) return null
    const micros = (Math.abs(h) * 3600 + m * 60) * 1e6 + Math.round(s * 1e6)
    const time = timeOfMicros(h < 0 ? -micros : micros)
    return formatTime(time, time.micro > 0 ? 6 : 0)
  })
  define('fr_sec_to_time', (seconds) => {
    const s = numberOf(seconds ?? null)
    if (s === null) return null
    const time = timeOfMicros(Math.round(s * 1e6))
    return formatTime(time, time.micro > 0 ? 6 : 0)
  })
  define('fr_period', (op, a, b) => {
    const x = integerOf(a ?? null)
    const y = integerOf(b ?? null)
    if (x === null || y === null) return null
    const months = (period: number) => {
      let year = Math.floor(period / 100)
      if (year < 70) year += 2000
      else if (year < 100) year += 1900
      return year * 12 + (period % 100) - 1
    }
    if (op === 'add') {
      if (x === 0) return 0
      const total = months(x) + y
      return Math.floor(total / 12) * 100 + (total % 12) + 1
    }
    return months(x) - months(y)
  })

  // JSON

  define('fr_json_valid', (value) =>
    value === null ? null : tryParseJson(textOf(value)) === undefined ? 0 : 1,
  )
  define('fr_json_extract', (document, ...paths) => {
    const doc = documentOf(document ?? null, host, 'json_extract')
    if (doc === null || paths.some((path) => path === null)) return null
    const parsed = paths.map((path, i) => pathOf(path ?? null, host, 'json_extract', i + 2))
    if (parsed.some((path) => path === null)) return null
    const matched = parsed.flatMap((path) => matchPath(doc.node, path!))
    if (matched.length === 0) return null
    if (parsed.length === 1 && !parsed[0]!.wildcard) return nodeText(doc.text, matched[0]!)
    return `[${matched.map((node) => nodeText(doc.text, node)).join(', ')}]`
  })
  define('fr_json_unquote', (value) => (value === null ? null : unquoteJson(textOf(value))))
  define('fr_json_value', (document, path) => {
    const doc = documentOf(document ?? null, host, 'json_value')
    const parsed = pathOf(path ?? null, host, 'json_value', 2)
    if (doc === null || parsed === null) return null
    const [node] = matchPath(doc.node, parsed)
    if (
      node === undefined ||
      node.kind === 'object' ||
      node.kind === 'array' ||
      node.kind === 'null'
    )
      return null
    return node.kind === 'string' ? node.value : nodeText(doc.text, node)
  })
  define('fr_json_query', (document, path) => {
    const doc = documentOf(document ?? null, host, 'json_query')
    const parsed = pathOf(path ?? null, host, 'json_query', 2)
    if (doc === null || parsed === null) return null
    const [node] = matchPath(doc.node, parsed)
    if (node === undefined || (node.kind !== 'object' && node.kind !== 'array')) return null
    return nodeText(doc.text, node)
  })
  define('fr_json_exists', (document, path) => {
    const doc = documentOf(document ?? null, host, 'json_exists')
    const parsed = pathOf(path ?? null, host, 'json_exists', 2)
    if (doc === null || parsed === null) return null
    return matchPath(doc.node, parsed).length > 0 ? 1 : 0
  })
  const change =
    (fn: string, how: JsonChange) =>
    (document: SqlValue, flags: SqlValue, ...pairs: SqlValue[]) => {
      const doc = documentOf(document, host, fn)
      if (doc === null) return null
      let text = doc.text
      const json = String(flags ?? '')
      for (let i = 0; i < pairs.length; i += 2) {
        const path = pathOf(pairs[i] ?? null, host, fn, i + 2)
        if (path === null) return null
        if (path.wildcard) {
          host.fail(
            new SqlError(
              4044,
              '42000',
              `Wildcards or range in JSON path not allowed in argument ${i + 2} to function '${fn}'`,
            ),
          )
        }
        const changed = changeJson(
          text,
          path,
          jsonValueText(pairs[i + 1] ?? null, json[i / 2] === '1'),
          how,
        )
        if (changed === undefined) return null
        text = changed
      }
      return text
    }
  define('fr_json_set', change('json_set', 'set'))
  define('fr_json_insert', change('json_insert', 'insert'))
  define('fr_json_replace', change('json_replace', 'replace'))
  define('fr_json_remove', (document, ...paths) => {
    const doc = documentOf(document ?? null, host, 'json_remove')
    if (doc === null) return null
    let text = doc.text
    for (let i = 0; i < paths.length; i++) {
      const path = pathOf(paths[i] ?? null, host, 'json_remove', i + 2)
      if (path === null) return null
      const removed = removeJson(text, path)
      if (removed === undefined) {
        host.fail(
          new SqlError(
            4044,
            '42000',
            `Wildcards or range in JSON path not allowed in argument ${i + 2} to function 'json_remove'`,
          ),
        )
      }
      text = removed
    }
    return text
  })
  define('fr_json_array_append', (document, flags, ...pairs) => {
    const doc = documentOf(document ?? null, host, 'json_array_append')
    if (doc === null) return null
    let text = doc.text
    const json = String(flags ?? '')
    for (let i = 0; i < pairs.length; i += 2) {
      const path = pathOf(pairs[i] ?? null, host, 'json_array_append', i + 2)
      if (path === null) return null
      const node = matchPath(tryParseJson(text)!, path)[0]
      if (node === undefined) continue
      const value = jsonValueText(pairs[i + 1] ?? null, json[i / 2] === '1')
      if (node.kind === 'array') {
        const insertion = node.items.length === 0 ? value : `, ${value}`
        const at = node.items.length === 0 ? node.start + 1 : node.items.at(-1)!.end
        text = text.slice(0, at) + insertion + text.slice(at)
      } else {
        text = `${text.slice(0, node.start)}[${nodeText(text, node)}, ${value}]${text.slice(node.end)}`
      }
    }
    return text
  })
  define('fr_json_array_insert', (document, flags, ...pairs) => {
    const doc = documentOf(document ?? null, host, 'json_array_insert')
    if (doc === null) return null
    let text = doc.text
    const json = String(flags ?? '')
    for (let i = 0; i < pairs.length; i += 2) {
      const path = pathOf(pairs[i] ?? null, host, 'json_array_insert', i + 2)
      if (path === null) return null
      const last = path.steps.at(-1)
      if (last?.kind !== 'item') return null
      const parent = matchPath(tryParseJson(text)!, {
        steps: path.steps.slice(0, -1),
        wildcard: false,
      })[0]
      if (parent?.kind !== 'array') continue
      const value = jsonValueText(pairs[i + 1] ?? null, json[i / 2] === '1')
      const index = Math.min(
        last.fromEnd ? parent.items.length - 1 - last.index : last.index,
        parent.items.length,
      )
      if (parent.items.length === 0)
        text = `${text.slice(0, parent.start + 1)}${value}${text.slice(parent.start + 1)}`
      else if (index >= parent.items.length) {
        const at = parent.items.at(-1)!.end
        text = `${text.slice(0, at)}, ${value}${text.slice(at)}`
      } else {
        const at = parent.items[Math.max(0, index)]!.start
        text = `${text.slice(0, at)}${value}, ${text.slice(at)}`
      }
    }
    return text
  })
  define('fr_json_object', (flags, ...pairs) => {
    const json = String(flags ?? '')
    const members: string[] = []
    for (let i = 0; i < pairs.length; i += 2) {
      const key = pairs[i] ?? null
      if (key === null)
        host.fail(new SqlError(4069, 'HY000', 'JSON documents may not contain NULL member names'))
      members.push(
        `${quoteJson(textOf(key))}: ${jsonValueText(pairs[i + 1] ?? null, json[i / 2] === '1')}`,
      )
    }
    return `{${members.join(', ')}}`
  })
  define('fr_json_array', (flags, ...values) => {
    const json = String(flags ?? '')
    return `[${values.map((value, i) => jsonValueText(value ?? null, json[i] === '1')).join(', ')}]`
  })
  define('fr_json_quote', (value) => (value === null ? null : quoteJson(textOf(value))))
  define('fr_json_contains', (document, candidate, path) => {
    const doc = documentOf(document ?? null, host, 'json_contains')
    const other = documentOf(candidate ?? null, host, 'json_contains', 2)
    if (doc === null || other === null) return null
    let target = doc.node
    if (path !== undefined) {
      const parsed = pathOf(path, host, 'json_contains', 3)
      if (parsed === null) return null
      const found = matchPath(doc.node, parsed)[0]
      if (found === undefined) return null
      target = found
    }
    return jsonContains(doc.text, target, other.text, other.node) ? 1 : 0
  })
  define('fr_json_contains_path', (document, mode, ...paths) => {
    const doc = documentOf(document ?? null, host, 'json_contains_path')
    if (doc === null || mode === null) return null
    const all = textOf(mode).toLowerCase() === 'all'
    if (!all && textOf(mode).toLowerCase() !== 'one') return null
    const found = paths.map((path, i) => {
      const parsed = pathOf(path ?? null, host, 'json_contains_path', i + 3)
      return parsed === null ? null : matchPath(doc.node, parsed).length > 0
    })
    if (found.some((value) => value === null)) return null
    return (all ? found.every(Boolean) : found.some(Boolean)) ? 1 : 0
  })
  const target = (fn: string, document: SqlValue, path: SqlValue | undefined) => {
    const doc = documentOf(document, host, fn)
    if (doc === null) return null
    if (path === undefined) return { doc, node: doc.node }
    const parsed = pathOf(path, host, fn, 2)
    if (parsed === null) return null
    const node = matchPath(doc.node, parsed)[0]
    return node === undefined ? null : { doc, node }
  }
  define('fr_json_keys', (document, path) => {
    const found = target('json_keys', document ?? null, path)
    return found === null ? null : (jsonKeys(found.node) ?? null)
  })
  define('fr_json_length', (document, path) => {
    const found = target('json_length', document ?? null, path)
    if (found === null) return null
    const { node } = found
    return node.kind === 'object'
      ? node.members.length
      : node.kind === 'array'
        ? node.items.length
        : 1
  })
  define('fr_json_depth', (document) => {
    const found = target('json_depth', document ?? null, undefined)
    return found === null ? null : jsonDepth(found.node)
  })
  define('fr_json_type', (document) => {
    const found = target('json_type', document ?? null, undefined)
    return found === null ? null : jsonType(found.doc.text, found.node)
  })
  define('fr_json_merge', (kind, ...documents) => {
    const docs = documents.map((document, i) =>
      documentOf(
        document ?? null,
        host,
        kind === 'patch' ? 'json_merge_patch' : 'json_merge_preserve',
        i + 1,
      ),
    )
    if (docs.some((doc) => doc === null)) return null
    let text = docs[0]!.text
    let node = docs[0]!.node
    for (const doc of docs.slice(1)) {
      text =
        kind === 'patch'
          ? mergePatch(text, node, doc!.text, doc!.node)
          : mergePreserve(text, node, doc!.text, doc!.node)
      node = tryParseJson(text)!
    }
    return docs.length === 1 ? writeNode(text, node) : text
  })
  define('fr_json_search', (document, mode, search, escape, ...paths) => {
    const doc = documentOf(document ?? null, host, 'json_search')
    if (doc === null || mode === null || search === null) return null
    const all = textOf(mode).toLowerCase() === 'all'
    const escapeChar =
      escape === undefined || escape === null || textOf(escape) === '' ? '\\' : textOf(escape)
    const roots =
      paths.length === 0
        ? [{ node: doc.node, prefix: '$' }]
        : paths.map((path, i) => {
            const parsed = pathOf(path ?? null, host, 'json_search', i + 5)
            return parsed === null
              ? null
              : { node: matchPath(doc.node, parsed)[0], prefix: textOf(path!) }
          })
    if (roots.some((root) => root === null)) return null
    const found = roots.flatMap((root) =>
      root!.node === undefined
        ? []
        : searchJson(root!.node, (text) => like(text, textOf(search), escapeChar, false)).map(
            (path) => root!.prefix + path.slice(1),
          ),
    )
    if (found.length === 0) return null
    if (!all || found.length === 1) return quoteJson(found[0]!)
    return `[${found.map(quoteJson).join(', ')}]`
  })
  define('fr_json_format', (kind, document) => {
    const doc = documentOf(
      document ?? null,
      host,
      kind === 'detailed' ? 'json_detailed' : kind === 'compact' ? 'json_compact' : 'json_loose',
    )
    if (doc === null) return null
    if (kind === 'detailed') return detailedJson(doc.text, doc.node)
    if (kind === 'compact') return compactJson(doc.text, doc.node)
    return writeNode(doc.text, doc.node)
  })

  // Aggregates

  aggregate(
    'fr_group_concat',
    () => ({
      parts: [] as string[],
      seen: new Set<string>(),
      bytes: 0,
      cut: false,
      separator: ',',
    }),
    (group, separator, distinct, ci, ...values) => {
      group.separator = separator === null || separator === undefined ? '' : textOf(separator)
      if (values.some((value) => value === null)) return
      const text = values.map((value) => textOf(value!)).join('')
      if (distinct === 1) {
        const key = ci === 1 ? foldText(text) : text
        if (group.seen.has(key)) return
        group.seen.add(key)
      }
      if (group.cut) return
      group.parts.push(text)
      group.bytes +=
        bytesOfText(text).length +
        (group.parts.length > 1 ? bytesOfText(group.separator).length : 0)
      if (group.bytes > GROUP_CONCAT_MAX_LEN) group.cut = true
    },
    (group) => {
      if (group === undefined || group.parts.length === 0) return null
      const joined = group.parts.join(group.separator)
      if (group.cut) {
        host.warn(1260, `Row ${group.parts.length} was cut by GROUP_CONCAT()`)
        const bytes = bytesOfText(joined).slice(0, GROUP_CONCAT_MAX_LEN)
        return textOfBytes(bytes)
      }
      return joined
    },
  )
  aggregate(
    'fr_json_arrayagg',
    () => ({ items: [] as string[] }),
    (group, json, value) => {
      group.items.push(jsonValueText(value ?? null, json === 1))
    },
    (group) =>
      group === undefined || group.items.length === 0 ? null : `[${group.items.join(', ')}]`,
  )
  aggregate(
    'fr_json_objectagg',
    () => ({ members: [] as string[] }),
    (group, json, key, value) => {
      if (key === null)
        host.fail(new SqlError(4069, 'HY000', 'JSON documents may not contain NULL member names'))
      group.members.push(`${quoteJson(textOf(key!))}: ${jsonValueText(value ?? null, json === 1)}`)
    },
    (group) =>
      group === undefined || group.members.length === 0 ? null : `{${group.members.join(', ')}}`,
  )
  aggregate(
    'fr_bit_agg',
    () => ({ value: undefined as bigint | undefined, op: '' }),
    (group, op, value) => {
      const integer = bigOf(value ?? null)
      group.op = String(op)
      if (integer === null) return
      const unsigned = BigInt.asUintN(64, integer)
      if (group.value === undefined) group.value = unsigned
      else if (op === '&') group.value &= unsigned
      else if (op === '|') group.value |= unsigned
      else group.value ^= unsigned
    },
    (group) => {
      if (group?.value === undefined) return group?.op === '&' ? 18446744073709551615n : 0
      return unsigned64(group.value)
    },
  )
  aggregate(
    'fr_variance',
    () => ({ values: [] as number[], kind: '' }),
    (group, kind, value) => {
      group.kind = String(kind)
      const number = numberOf(value ?? null)
      if (number !== null) group.values.push(number)
    },
    (group) => {
      if (group === undefined || group.values.length === 0) return null
      const { values, kind } = group
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length
      const squares = values.reduce((sum, value) => sum + (value - mean) ** 2, 0)
      const sample = kind.endsWith('samp')
      if (sample && values.length < 2) return null
      const variance = squares / (sample ? values.length - 1 : values.length)
      return kind.startsWith('std') ? Math.sqrt(variance) : variance
    },
  )
}
