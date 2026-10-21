import type { TimeZone } from '../scripting/time.ts'
import type { DataType } from './ast.ts'
import { SqlError } from './lexer.ts'
import type { SqlValue } from './sqlite.ts'
import {
  dateTimeOfNumber,
  epochOf,
  formatDate,
  formatDateTime,
  formatTime,
  parseDateTime,
  parseTime,
  truncateFraction,
  type DateTime,
} from './temporal.ts'
import type { Type } from './types.ts'

/**
 * A value of JavaScript, as mysql2 gives them and FiveM's JS runtime
 * packs them for Lua: bytes are Buffers, which pack as binary strings.
 */
export type JsValue =
  | null
  | boolean
  | number
  | string
  | Uint8Array
  | readonly JsValue[]
  | { readonly [key: string]: JsValue }

const utf8 = new TextDecoder()
const encoder = new TextEncoder()

/** The text of bytes, as MariaDB reads a binary string as utf8mb4 characters. */
export function textOfBytes(bytes: Uint8Array): string {
  return utf8.decode(bytes)
}

export function bytesOfText(text: string): Uint8Array {
  return encoder.encode(text)
}

/**
 * The text of a double, as MariaDB writes them: the fewest digits that
 * read back as the double, with exponents from 1e15 written as 1e15.
 */
export function doubleText(value: number): string {
  if (Number.isNaN(value)) return 'NaN'
  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf'
  if (Object.is(value, -0)) return '-0'
  const abs = Math.abs(value)
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-4)) {
    return value
      .toExponential()
      .replace('e+', 'e')
      .replace(/\.?0*e/, 'e')
  }
  return String(value)
}

/** An integer as SQLite takes it: a number, a bigint, or the text of those past int64, as BIGINT UNSIGNED holds. */
export function sqliteInteger(value: bigint): SqlValue {
  if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER))
    return Number(value)
  return value > 9223372036854775807n || value < -9223372036854775808n ? value.toString() : value
}

/** The text of a value in a string's place: integers in digits, doubles as MariaDB writes them, bytes as characters. */
export function textOf(value: Exclude<SqlValue, null>): string {
  if (typeof value === 'string') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number')
    return Number.isInteger(value) && Math.abs(value) < 1e15 ? String(value) : doubleText(value)
  return textOfBytes(value)
}

/** The number at the start of a string, as MariaDB reads strings as numbers, and whether the string was all number. */
export interface NumberPrefix {
  /** The digits of the number, as a decimal: sign, digits, point and fraction, with the exponent applied. */
  readonly decimal: string
  readonly value: number
  /** Whether the string had a number at its start. */
  readonly found: boolean
  /** Whether nothing but spaces followed the number. */
  readonly complete: boolean
}

/** Reads the number a string starts with, as MariaDB does where strings are numbers: '12abc' is 12, 'abc' is 0. */
export function numberPrefix(text: string): NumberPrefix {
  const match = /^\s*([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?/.exec(text)!
  const [whole, sign = '', digits = '', fraction = '', exponent] = match
  const found = digits.length > 0 || fraction.length > 0
  if (!found) return { decimal: '0', value: 0, found: false, complete: false }
  const complete = text.slice(whole.length).trim() === ''
  let decimal = shiftDecimal(
    `${digits || '0'}`,
    fraction,
    exponent === undefined ? 0 : Number(exponent),
  )
  if (sign === '-' && /[1-9]/.test(decimal)) decimal = `-${decimal}`
  return {
    decimal,
    value: Number(`${sign}${digits || '0'}.${fraction || '0'}e${exponent ?? 0}`),
    found,
    complete,
  }
}

/** Digits with a fraction, as a decimal moved by an exponent. */
function shiftDecimal(digits: string, fraction: string, exponent: number): string {
  let all = digits + fraction
  let point = digits.length + exponent
  if (point < 0) {
    all = '0'.repeat(-point) + all
    point = 0
  }
  if (point > all.length) all = all.padEnd(point, '0')
  const integer = all.slice(0, point).replace(/^0+(?=\d)/, '') || '0'
  const rest = all.slice(point).replace(/0+$/, '')
  return rest === '' ? integer : `${integer}.${rest}`
}

/** The decimal digits of a value, as MariaDB converts values to decimals, or undefined if it holds no number. */
export function decimalOf(
  value: Exclude<SqlValue, null>,
): { decimal: string; complete: boolean } | undefined {
  if (typeof value === 'bigint') return { decimal: value.toString(), complete: true }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined
    const prefix = numberPrefix(String(value))
    return { decimal: prefix.decimal, complete: true }
  }
  const prefix = numberPrefix(typeof value === 'string' ? value : textOfBytes(value))
  if (!prefix.found) return undefined
  return { decimal: prefix.decimal, complete: prefix.complete }
}

/** A decimal rounded to `scale` digits after its point, half away from zero, as MariaDB rounds decimals. */
export function roundDecimal(decimal: string, scale: number): string {
  const negative = decimal.startsWith('-')
  const body = negative ? decimal.slice(1) : decimal
  const [integer = '0', fraction = ''] = body.split('.')
  if (fraction.length <= scale) {
    const padded = scale > 0 ? `${integer}.${fraction.padEnd(scale, '0')}` : integer
    return negative && /[1-9]/.test(padded) ? `-${padded}` : padded
  }
  const kept = integer + fraction.slice(0, scale)
  const roundUp = fraction[scale]! >= '5'
  let digits = kept
  if (roundUp) {
    const chars = [...kept]
    let i = chars.length - 1
    while (i >= 0) {
      if (chars[i] === '9') {
        chars[i] = '0'
        i--
      } else {
        chars[i] = String(Number(chars[i]) + 1)
        break
      }
    }
    digits = (i < 0 ? '1' : '') + chars.join('')
  }
  const integerLength = digits.length - scale
  const whole = digits.slice(0, integerLength).replace(/^0+(?=\d)/, '') || '0'
  const result = scale > 0 ? `${whole}.${digits.slice(integerLength)}` : whole
  return negative && /[1-9]/.test(result) ? `-${result}` : result
}

/** The ranges of the types of integers, signed and unsigned. */
const INTEGER_RANGES: Readonly<Record<string, readonly [bigint, bigint, bigint]>> = {
  TINYINT: [-128n, 127n, 255n],
  SMALLINT: [-32768n, 32767n, 65535n],
  MEDIUMINT: [-8388608n, 8388607n, 16777215n],
  INT: [-2147483648n, 2147483647n, 4294967295n],
  BIGINT: [-9223372036854775808n, 9223372036854775807n, 18446744073709551615n],
}

/** The most bytes of the types of text and blobs. */
const LOB_LIMITS: Readonly<Record<string, number>> = {
  TINYTEXT: 255,
  TEXT: 65535,
  MEDIUMTEXT: 16777215,
  LONGTEXT: 4294967295,
  JSON: 4294967295,
  TINYBLOB: 255,
  BLOB: 65535,
  MEDIUMBLOB: 16777215,
  LONGBLOB: 4294967295,
}

/** The types whose values are bytes. */
export const BINARY_TYPES: ReadonlySet<string> = new Set([
  'BINARY',
  'VARBINARY',
  'TINYBLOB',
  'BLOB',
  'MEDIUMBLOB',
  'LONGBLOB',
])

/** A column that a value is stored in, as errors name it. */
export interface StoreTarget {
  readonly schema: string
  readonly table: string
  readonly column: string
  readonly type: DataType
  readonly nullable: boolean
}

/** How values are stored: strictly, as MariaDB's default sql_mode has it, or leniently, as INSERT IGNORE stores them. */
export interface StoreOptions {
  readonly lenient: boolean
  /** The row of the statement the value is of, from 1, which errors name. */
  readonly row: number
  /** The time zone of the system, which TIMESTAMP values must be in the range of. */
  readonly zone: TimeZone
  /** Counts the warning of a value that is stored as another, when storing leniently. */
  readonly warn?: (code: number, message: string) => void
}

/** The value that MariaDB stores for a NOT NULL column without a value: zero, an empty string, or a zero date. */
export function implicitDefault(type: DataType): SqlValue {
  switch (type.name) {
    case 'CHAR':
    case 'VARCHAR':
    case 'TINYTEXT':
    case 'TEXT':
    case 'MEDIUMTEXT':
    case 'LONGTEXT':
    case 'JSON':
    case 'SET':
    case 'UUID':
    case 'INET4':
    case 'INET6':
      return type.name === 'UUID' ? '00000000-0000-0000-0000-000000000000' : ''
    case 'ENUM':
      return type.values?.[0] ?? ''
    case 'BINARY':
      return new Uint8Array(type.length ?? 1)
    case 'VARBINARY':
    case 'TINYBLOB':
    case 'BLOB':
    case 'MEDIUMBLOB':
    case 'LONGBLOB':
      return new Uint8Array()
    case 'DATE':
      return '0000-00-00'
    case 'DATETIME':
    case 'TIMESTAMP':
      return formatDateTime(
        { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0, micro: 0 },
        type.length ?? 0,
      )
    case 'TIME':
      return formatTime(
        { negative: false, hours: 0, minute: 0, second: 0, micro: 0 },
        type.length ?? 0,
      )
    default:
      return 0
  }
}

/** The characters of a string, as code points. */
function characters(text: string): number {
  let count = 0
  for (const _ of text) count++
  return count
}

function sqlQuote(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/**
 * Converts a value to how a column stores it, as MariaDB does with its
 * default sql_mode, STRICT_TRANS_TABLES: values that do not fit fail with
 * MariaDB's errors, as do NULLs in NOT NULL columns; leniently, they are
 * stored as near as they fit, with warnings.
 */
export function storeValue(value: SqlValue, target: StoreTarget, options: StoreOptions): SqlValue {
  const { type } = target
  const fail = (errno: number, sqlState: string, message: string, fallback: SqlValue): SqlValue => {
    if (!options.lenient) throw new SqlError(errno, sqlState, message)
    options.warn?.(errno, message)
    return fallback
  }
  const at = `at row ${options.row}`
  const qualified = `\`${target.schema}\`.\`${target.table}\`.\`${target.column}\``
  if (value === null) {
    if (target.nullable) return null
    return fail(1048, '23000', `Column '${target.column}' cannot be null`, implicitDefault(type))
  }
  const truncated = (fallback: SqlValue) =>
    fail(1265, '01000', `Data truncated for column '${target.column}' ${at}`, fallback)
  const outOfRange = (fallback: SqlValue) =>
    fail(1264, '22003', `Out of range value for column '${target.column}' ${at}`, fallback)
  const tooLong = (fallback: SqlValue) =>
    fail(1406, '22001', `Data too long for column '${target.column}' ${at}`, fallback)
  const shown = () => sqlQuote(textOf(value))
  switch (type.name) {
    case 'TINYINT':
    case 'SMALLINT':
    case 'MEDIUMINT':
    case 'INT':
    case 'BIGINT': {
      let integer: bigint
      if (typeof value === 'bigint') integer = value
      else if (typeof value === 'number') {
        if (!Number.isFinite(value)) return outOfRange(0)
        integer = BigInt(Math.sign(value) * Math.round(Math.abs(value)))
      } else {
        const decimal = decimalOf(value)
        if (decimal === undefined) {
          return fail(
            1366,
            '22007',
            `Incorrect integer value: '${shown()}' for column ${qualified} ${at}`,
            0,
          )
        }
        integer = BigInt(roundDecimal(decimal.decimal, 0))
        if (!decimal.complete) truncated(0)
      }
      const [min, max, unsignedMax] = INTEGER_RANGES[type.name]!
      const low = type.unsigned === true ? 0n : min
      const high = type.unsigned === true ? unsignedMax : max
      if (integer < low) return outOfRange(Number(low))
      if (integer > high) return outOfRange(sqliteInteger(high))
      return sqliteInteger(integer)
    }
    case 'DECIMAL': {
      const digits = type.length ?? 10
      const scale = type.scale ?? 0
      const decimal = decimalOf(value)
      if (decimal === undefined) {
        return fail(
          1366,
          '22007',
          `Incorrect decimal value: '${shown()}' for column ${qualified} ${at}`,
          0,
        )
      }
      if (!decimal.complete) truncated(0)
      let rounded = roundDecimal(decimal.decimal, scale)
      const integerPart = rounded.replace(/^-/, '').split('.')[0]!.replace(/^0+/, '')
      const negative = rounded.startsWith('-')
      if (integerPart.length > digits - scale || (negative && type.unsigned === true)) {
        const max = `${'9'.repeat(digits - scale) || '0'}${scale > 0 ? `.${'9'.repeat(scale)}` : ''}`
        rounded = negative && type.unsigned !== true ? `-${max}` : negative ? '0' : max
        return outOfRange(Number(rounded))
      }
      return Number(rounded)
    }
    case 'FLOAT':
    case 'DOUBLE': {
      let number: number
      if (typeof value === 'number') number = value
      else if (typeof value === 'bigint') number = Number(value)
      else {
        const prefix = numberPrefix(typeof value === 'string' ? value : textOfBytes(value))
        if (!prefix.found || !prefix.complete) truncated(prefix.value)
        number = prefix.value
      }
      if (!Number.isFinite(number)) return outOfRange(0)
      if (type.scale !== undefined && type.length !== undefined) {
        number = Number(roundDecimal(decimalOf(number)!.decimal, type.scale))
        if (Math.abs(number) >= 10 ** (type.length - type.scale))
          return outOfRange(
            Math.sign(number) * (10 ** (type.length - type.scale) - 10 ** -type.scale),
          )
      }
      if (type.unsigned === true && number < 0) return outOfRange(0)
      if (type.name === 'FLOAT') {
        const single = Math.fround(number)
        if (!Number.isFinite(single)) return outOfRange(Math.sign(number) * 3.4028234663852886e38)
        return single
      }
      return number
    }
    case 'BIT': {
      const bits = type.length ?? 1
      let integer: bigint
      if (typeof value === 'number') integer = BigInt(Math.round(value))
      else if (typeof value === 'bigint') integer = value
      else {
        // Strings are bytes, big-endian.
        const bytes = typeof value === 'string' ? bytesOfText(value) : value
        integer = 0n
        for (const byte of bytes) integer = (integer << 8n) | BigInt(byte)
      }
      if (integer < 0n) integer = BigInt.asUintN(64, integer)
      if (integer >= 1n << BigInt(bits)) return tooLong(Number((1n << BigInt(bits)) - 1n))
      return integer <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(integer) : integer
    }
    case 'YEAR': {
      let year: number
      if (typeof value === 'string' || value instanceof Uint8Array) {
        const text = typeof value === 'string' ? value : textOfBytes(value)
        const prefix = numberPrefix(text)
        if (!prefix.found)
          return fail(
            1366,
            '22007',
            `Incorrect integer value: '${shown()}' for column ${qualified} ${at}`,
            0,
          )
        year = Math.round(prefix.value)
        // The strings '0' and '00' are 2000, where the number 0 is the year 0000.
        if (year >= 0 && year < 70 && text.trim().length <= 2) year += 2000
        else if (year >= 70 && year <= 99 && text.trim().length <= 2) year += 1900
      } else {
        year = Math.round(Number(value))
        if (year > 0 && year < 70) year += 2000
        else if (year >= 70 && year <= 99) year += 1900
      }
      if (year !== 0 && (year < 1901 || year > 2155)) return outOfRange(0)
      return year
    }
    case 'CHAR':
    case 'VARCHAR':
    case 'TINYTEXT':
    case 'TEXT':
    case 'MEDIUMTEXT':
    case 'LONGTEXT':
    case 'JSON': {
      let text = textOf(value)
      if (type.name === 'CHAR' || type.name === 'VARCHAR') {
        const limit = type.length ?? 1
        if (characters(text) > limit) {
          const kept = [...text].slice(0, limit).join('')
          // Spaces past the end are cut without an error.
          if (text.slice(kept.length).trim() !== '') return tooLong(kept)
          text = kept
        }
        if (type.name === 'CHAR') text = text.replace(/ +$/, '')
      } else if (bytesOfText(text).length > LOB_LIMITS[type.name]!) {
        return tooLong(text)
      }
      if (type.name === 'JSON' && !isValidJson(text)) {
        return fail(
          4025,
          '23000',
          `CONSTRAINT \`${target.column}\` failed for \`${target.schema}\`.\`${target.table}\``,
          text,
        )
      }
      return text
    }
    case 'BINARY':
    case 'VARBINARY':
    case 'TINYBLOB':
    case 'BLOB':
    case 'MEDIUMBLOB':
    case 'LONGBLOB': {
      let bytes = value instanceof Uint8Array ? value : bytesOfText(textOf(value))
      const limit =
        type.name === 'BINARY' || type.name === 'VARBINARY'
          ? (type.length ?? 1)
          : LOB_LIMITS[type.name]!
      if (bytes.length > limit) {
        const kept = bytes.slice(0, limit)
        return tooLong(kept)
      }
      if (type.name === 'BINARY' && bytes.length < limit) {
        // BINARY pads with zero bytes.
        const padded = new Uint8Array(limit)
        padded.set(bytes)
        bytes = padded
      }
      return bytes
    }
    case 'ENUM': {
      const members = type.values ?? []
      if (typeof value === 'number' || typeof value === 'bigint') {
        const index = Number(value)
        if (Number.isInteger(index) && index >= 1 && index <= members.length)
          return members[index - 1]!
        return truncated('')
      }
      const text = textOf(value)
      const found = members.find((member) => sameText(member, text))
      if (found === undefined) {
        // Strings of digits are indexes too.
        if (/^\s*\d+\s*$/.test(text) && Number(text) >= 1 && Number(text) <= members.length)
          return members[Number(text) - 1]!
        return truncated('')
      }
      return found
    }
    case 'SET': {
      const members = type.values ?? []
      if (typeof value === 'number' || typeof value === 'bigint') {
        const mask = BigInt(value)
        if (mask < 0n || mask >= 1n << BigInt(members.length)) return truncated('')
        return members.filter((_, i) => (mask >> BigInt(i)) & 1n).join(',')
      }
      const text = textOf(value)
      if (text === '') return ''
      const chosen = new Set<number>()
      for (const part of text.split(',')) {
        const index = members.findIndex((member) => sameText(member, part))
        if (index === -1) return truncated(members.filter((_, i) => chosen.has(i)).join(','))
        chosen.add(index)
      }
      return members.filter((_, i) => chosen.has(i)).join(',')
    }
    case 'DATE':
    case 'DATETIME':
    case 'TIMESTAMP': {
      const what = type.name === 'DATE' ? 'date' : 'datetime'
      let parsed: DateTime | undefined
      if (typeof value === 'number' || typeof value === 'bigint')
        parsed = dateTimeOfNumber(Number(value))
      else parsed = parseDateTime(textOf(value))
      const zero = implicitDefault(type)
      if (parsed === undefined) {
        return fail(
          1292,
          '22007',
          `Incorrect ${what} value: '${shown()}' for column ${qualified} ${at}`,
          zero,
        )
      }
      if (type.name === 'DATE') return formatDate(parsed)
      const fsp = type.length ?? 0
      const kept = truncateFraction(parsed, fsp)
      if (type.name === 'TIMESTAMP' && (kept.year !== 0 || kept.month !== 0 || kept.day !== 0)) {
        // TIMESTAMP holds seconds since the epoch as 32 bits.
        const seconds = epochOf(kept, options.zone) / 1000
        if (kept.month === 0 || kept.day === 0 || seconds < 1 || seconds >= 2 ** 31) {
          return fail(
            1292,
            '22007',
            `Incorrect datetime value: '${shown()}' for column ${qualified} ${at}`,
            zero,
          )
        }
      }
      return formatDateTime(kept, fsp)
    }
    case 'TIME': {
      const parsed =
        typeof value === 'number' || typeof value === 'bigint'
          ? parseTime(String(value))
          : parseTime(textOf(value))
      if (parsed === undefined) {
        return fail(
          1292,
          '22007',
          `Incorrect time value: '${shown()}' for column ${qualified} ${at}`,
          implicitDefault(type),
        )
      }
      return formatTime(truncateFraction(parsed, type.length ?? 0), type.length ?? 0)
    }
    case 'UUID': {
      const text = textOf(value).trim()
      const hex = text.replace(/^\{|\}$/g, '').replace(/-/g, '')
      if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
        return fail(
          1292,
          '22007',
          `Incorrect uuid value: '${shown()}' for column ${qualified} ${at}`,
          implicitDefault(type),
        )
      }
      const lower = hex.toLowerCase()
      return `${lower.slice(0, 8)}-${lower.slice(8, 12)}-${lower.slice(12, 16)}-${lower.slice(16, 20)}-${lower.slice(20)}`
    }
    default:
      return textOf(value)
  }
}

/** Whether two strings are equal as utf8mb4_general_ci compares them: without case, accents and trailing spaces. */
function sameText(a: string, b: string): boolean {
  return foldText(a) === foldText(b)
}

/** A string as case-insensitive collations compare them: without case, accents and trailing spaces. */
export function foldText(text: string): string {
  let folded = text
  if (/[^\x00-\x7f]/.test(folded)) folded = folded.normalize('NFD').replace(/\p{M}/gu, '')
  return folded.toLowerCase().replace(/ +$/, '')
}

/** Whether a text is JSON, as JSON_VALID has it. */
function isValidJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/** How mysql2 reads rows: with query, from text, or with execute, from MariaDB's binary protocol. */
export type ReadMode = 'query' | 'execute'

/** The bytes of a BIT value, big-endian, in as many bytes as its bits take. */
function bitBytes(value: number | bigint, bits: number): Uint8Array {
  const length = Math.max(1, Math.ceil(bits / 8))
  const bytes = new Uint8Array(length)
  let rest = BigInt(value)
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(rest & 0xffn)
    rest >>= 8n
  }
  return bytes
}

/** The digits a FLOAT shows: the fewest that read back as the same single-precision float. */
function floatText(value: number): string {
  const single = Math.fround(value)
  for (let digits = 1; digits <= 9; digits++) {
    const text = single.toPrecision(digits)
    if (Math.fround(Number(text)) === single) return String(Number(text))
  }
  return String(single)
}

/**
 * Milliseconds since the epoch of a local datetime, as oxmysql reads them
 * with `new Date(value).getTime()`: NaN for dates with zero months or days.
 */
function dateMs(text: string, zone: TimeZone): number {
  const parsed = parseDateTime(text)
  if (parsed === undefined || parsed.month === 0 || parsed.day === 0) return Number.NaN
  return epochOf(parsed, zone)
}

/**
 * The value of JavaScript that mysql2 reads from a value of a column of a
 * type, as oxmysql sets mysql2 up: with typeCast, which reads DATETIME,
 * TIMESTAMP and DATE as milliseconds since the epoch of their local time,
 * and with query, TINYINT(1) as a boolean, BIT(1) as one and BLOBs as
 * arrays of bytes; with supportBigNumbers, which reads BIGINT values that
 * no double holds as strings; and with jsonStrings and DECIMAL as strings.
 */
export function readValue(value: SqlValue, type: Type, mode: ReadMode, zone: TimeZone): JsValue {
  if (value === null) return null
  switch (type.field) {
    case 'TINY':
    case 'SHORT':
    case 'INT24':
    case 'LONG':
    case 'LONGLONG':
    case 'YEAR': {
      const integer = integerOf(value)
      if (mode === 'query' && type.field === 'TINY' && type.length === 1) {
        // oxmysql's typeCast compares the text of the value with '1'.
        return typeof integer === 'number' ? integer === 1 : false
      }
      return integer
    }
    case 'NEWDECIMAL': {
      const decimal = decimalOf(value)
      return decimal === undefined
        ? roundDecimal('0', type.decimals)
        : roundDecimal(decimal.decimal, type.decimals)
    }
    case 'FLOAT': {
      const number = typeof value === 'number' ? value : Number(textOf(value))
      if (mode === 'query' && type.decimals < 31)
        return Number(Math.fround(number).toFixed(type.decimals))
      return mode === 'query' ? Number(floatText(number)) : Math.fround(number)
    }
    case 'DOUBLE':
      // MariaDB writes doubles of fixed digits, as PI() and DOUBLE(M,D) have, with those digits.
      if (mode === 'query' && type.decimals < 31) {
        const number = typeof value === 'number' ? value : Number(textOf(value))
        return Number(number.toFixed(type.decimals))
      }
      return typeof value === 'number'
        ? value
        : typeof value === 'bigint'
          ? Number(value)
          : numberPrefix(textOf(value)).value
    case 'BIT': {
      const bytes =
        value instanceof Uint8Array ? value : bitBytes(integerOf(value) as number, type.length)
      if (mode === 'execute') return [...bytes]
      return bytes.length === 1 ? bytes[0] === 1 : bytes[0]!
    }
    case 'DATE': {
      const text = textOf(value)
      return text === '' ? null : dateMs(`${text} 00:00:00`, zone)
    }
    case 'DATETIME':
    case 'TIMESTAMP': {
      const text = textOf(value)
      return text === '' ? null : dateMs(text, zone)
    }
    case 'TIME':
      return textOf(value)
    case 'NULL':
      return null
    default: {
      if (type.binary === true) {
        const bytes = value instanceof Uint8Array ? value : bytesOfText(textOf(value))
        // Patched as oxmysql patches mysql2, binary values of execute are arrays of bytes, as BLOBs of query are.
        if (mode === 'execute' || type.field === 'BLOB') return [...bytes]
        return bytes
      }
      return textOf(value)
    }
  }
}

/** The integer a value holds, as mysql2 reads them: a number, or a string for those no double holds. */
function integerOf(value: Exclude<SqlValue, null>): number | string {
  if (
    typeof value === 'string' &&
    /^-?\d{16,}$/.test(value) &&
    !Number.isSafeInteger(Number(value))
  )
    return value
  if (typeof value === 'bigint') {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString()
  }
  if (typeof value === 'number')
    return Number.isInteger(value) ? value : Math.sign(value) * Math.round(Math.abs(value))
  const decimal = decimalOf(value)
  return decimal === undefined ? 0 : Number(roundDecimal(decimal.decimal, 0))
}
