import type { TimeZone } from '../scripting/time.ts'
import type { IntervalUnit } from './ast.ts'

/**
 * Dates, times and their arithmetic as MariaDB has them: dates of the
 * proleptic Gregorian calendar from year 0 to 9999, which may have zero
 * months and days, times of up to 838 hours either way, and microseconds.
 */
export interface DateTime {
  readonly year: number
  /** The month, from 1, or 0 in dates with zero months. */
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
  readonly micro: number
}

/** A time of day, or a duration, of up to 838:59:59.999999 either way. */
export interface Time {
  readonly negative: boolean
  readonly hours: number
  readonly minute: number
  readonly second: number
  readonly micro: number
}

const MS_PER_DAY = 86_400_000
const MICROS_PER_DAY = 86_400_000_000

/** The most hours of a TIME. */
const MAX_TIME_HOURS = 838

const ZERO_DATETIME: DateTime = {
  year: 0,
  month: 0,
  day: 0,
  hour: 0,
  minute: 0,
  second: 0,
  micro: 0,
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

export function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0
}

/** Milliseconds since the epoch of midnight, UTC, at the start of a date, for any year of the calendar. */
function utcMidnight(year: number, month: number, day: number): number {
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  return date.getTime()
}

/** The number of a day, as TO_DAYS counts them: from year 0, so that 1970-01-01 is day 719528. */
export function dayNumber(year: number, month: number, day: number): number {
  if (year === 0 && month === 0) return 0
  return Math.round(utcMidnight(year, month, day) / MS_PER_DAY) + 719_528
}

/** The date of a day's number, as FROM_DAYS has it. */
export function fromDayNumber(days: number): { year: number; month: number; day: number } {
  const date = new Date((days - 719_528) * MS_PER_DAY)
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}

/** The day of the week of a date, from 0 for Monday, as WEEKDAY gives it. */
export function weekday(year: number, month: number, day: number): number {
  return (dayNumber(year, month, day) + 5) % 7
}

export function dayOfYear(year: number, month: number, day: number): number {
  return dayNumber(year, month, day) - dayNumber(year, 1, 1) + 1
}

/** Whether a date's parts make a date of MariaDB's, which may have zero months and days. */
function isValidDate(year: number, month: number, day: number): boolean {
  if (year < 0 || year > 9999 || month < 0 || month > 12 || day < 0 || day > 31) return false
  if (month === 0 || day === 0) return true
  return day <= daysInMonth(year, month)
}

function isValidTimeOfDay(hour: number, minute: number, second: number): boolean {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59
}

/** The year of a year of two digits, as MariaDB reads them: 70 to 99 in the 1900s, 0 to 69 in the 2000s. */
function fullYear(digits: string): number {
  const year = Number(digits)
  if (digits.length > 2) return year
  return year < 70 ? 2000 + year : 1900 + year
}

/** Microseconds of a fraction's digits, of which those after the sixth are cut, as MariaDB does. */
function microsOf(fraction: string): number {
  return Number(fraction.slice(0, 6).padEnd(6, '0'))
}

/**
 * Reads a date, maybe with a time, as MariaDB does from strings: with any
 * punctuation between the parts, a space or a T between the date and the
 * time, or with no delimiters, as in 20240506070809. Years of two digits
 * are of 1970 to 2069. Gives undefined for what is no date.
 */
export function parseDateTime(text: string): DateTime | undefined {
  const trimmed = text.trim()
  // Without delimiters: YYYYMMDDHHMMSS, YYMMDDHHMMSS, YYYYMMDD and YYMMDD, maybe with a fraction.
  const compact = /^(\d+)(?:\.(\d*))?$/.exec(trimmed)
  if (compact !== null) return compactDateTime(compact[1]!, compact[2] ?? '')
  const match =
    /^(\d{1,4})[^\d\s](\d{1,2})[^\d\s](\d{1,2})(?:(?:[T ]|\s+)(\d{1,2})(?:[^\d\s](\d{1,2})(?:[^\d\s](\d{1,2})(?:\.(\d*))?)?)?)?\s*$/.exec(
      trimmed,
    )
  if (match === null) return undefined
  const [, y, mo, d, h = '0', mi = '0', s = '0', fraction = ''] = match
  const year = fullYear(y!)
  const month = Number(mo)
  const day = Number(d)
  const hour = Number(h)
  const minute = Number(mi)
  const second = Number(s)
  if (!isValidDate(year, month, day) || !isValidTimeOfDay(hour, minute, second)) return undefined
  return { year, month, day, hour, minute, second, micro: microsOf(fraction) }
}

/** Reads the digits of a date without delimiters, as parseDateTime does. */
function compactDateTime(digits: string, fraction: string): DateTime | undefined {
  let parts: string[]
  switch (digits.length) {
    case 14:
      parts = [
        digits.slice(0, 4),
        digits.slice(4, 6),
        digits.slice(6, 8),
        digits.slice(8, 10),
        digits.slice(10, 12),
        digits.slice(12),
      ]
      break
    case 12:
      parts = [
        digits.slice(0, 2),
        digits.slice(2, 4),
        digits.slice(4, 6),
        digits.slice(6, 8),
        digits.slice(8, 10),
        digits.slice(10),
      ]
      break
    case 8:
      parts = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6)]
      break
    case 6:
      parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)]
      break
    default:
      return undefined
  }
  const [y, mo, d, h = '0', mi = '0', s = '0'] = parts
  const year = fullYear(y!)
  const month = Number(mo)
  const day = Number(d)
  const hour = Number(h)
  const minute = Number(mi)
  const second = Number(s)
  if (!isValidDate(year, month, day) || !isValidTimeOfDay(hour, minute, second)) return undefined
  return { year, month, day, hour, minute, second, micro: microsOf(fraction) }
}

/**
 * Reads a date or datetime from a number, as MariaDB does: by its digits,
 * YYYYMMDDHHMMSS or YYMMDD and the like, with those of fewer digits
 * padded as MariaDB pads them.
 */
export function dateTimeOfNumber(value: number): DateTime | undefined {
  if (!Number.isFinite(value) || value < 0) return undefined
  const whole = Math.trunc(value)
  const fraction = value - whole
  let digits = String(whole)
  if (whole === 0) return ZERO_DATETIME
  // MariaDB reads numbers of 5 and 7 digits with a zero before them, and those of 9 to 11 and 13 as datetimes.
  if (digits.length === 5 || digits.length === 7) digits = `0${digits}`
  else if (digits.length >= 9 && digits.length <= 11) digits = digits.padStart(12, '0')
  else if (digits.length === 13) digits = digits.padStart(14, '0')
  const parsed = compactDateTime(digits, fraction > 0 ? String(fraction).slice(2) : '')
  return parsed
}

/**
 * Reads a time as MariaDB does from strings: [-][D ]HH:MM:SS.ffffff,
 * HH:MM, or digits without delimiters, HHMMSS, MMSS or SS.
 */
export function parseTime(text: string): Time | undefined {
  const trimmed = text.trim()
  const negative = trimmed.startsWith('-')
  const body = negative ? trimmed.slice(1) : trimmed
  let days = 0
  let hours: number
  let minute: number
  let second: number
  let fraction = ''
  const delimited = /^(?:(\d+)\s+)?(\d+):(\d{1,2})(?::(\d{1,2})(?:\.(\d*))?)?$/.exec(body)
  if (delimited !== null) {
    days = Number(delimited[1] ?? 0)
    hours = Number(delimited[2])
    minute = Number(delimited[3])
    second = Number(delimited[4] ?? 0)
    fraction = delimited[5] ?? ''
  } else {
    const compact = /^(\d+)(?:\.(\d*))?$/.exec(body)
    if (compact === null) {
      const datetime = parseDateTime(body)
      if (datetime === undefined) return undefined
      return {
        negative: false,
        hours: datetime.hour,
        minute: datetime.minute,
        second: datetime.second,
        micro: datetime.micro,
      }
    }
    const digits = compact[1]!.padStart(6, '0')
    hours = Number(digits.slice(0, -4))
    minute = Number(digits.slice(-4, -2))
    second = Number(digits.slice(-2))
    fraction = compact[2] ?? ''
  }
  if (minute > 59 || second > 59) return undefined
  hours += days * 24
  if (hours > MAX_TIME_HOURS)
    return { negative, hours: MAX_TIME_HOURS, minute: 59, second: 59, micro: 0 }
  return {
    negative: negative && (hours > 0 || minute > 0 || second > 0 || microsOf(fraction) > 0),
    hours,
    minute,
    second,
    micro: microsOf(fraction),
  }
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

/** The digits of a fraction of a second, cut to `fsp` of them. */
function fractionText(micro: number, fsp: number): string {
  return fsp > 0 ? `.${pad(micro, 6).slice(0, fsp)}` : ''
}

export function formatDate(value: DateTime): string {
  return `${pad(value.year, 4)}-${pad(value.month, 2)}-${pad(value.day, 2)}`
}

export function formatDateTime(value: DateTime, fsp = 0): string {
  const time = `${pad(value.hour, 2)}:${pad(value.minute, 2)}:${pad(value.second, 2)}`
  return `${formatDate(value)} ${time}${fractionText(value.micro, fsp)}`
}

export function formatTime(value: Time, fsp = 0): string {
  const sign = value.negative ? '-' : ''
  return `${sign}${pad(value.hours, 2)}:${pad(value.minute, 2)}:${pad(value.second, 2)}${fractionText(value.micro, fsp)}`
}

/** A datetime cut to `fsp` digits of fractions of seconds, as MariaDB cuts them. */
export function truncateFraction<T extends DateTime | Time>(value: T, fsp: number): T {
  const step = 10 ** (6 - fsp)
  return { ...value, micro: value.micro - (value.micro % step) }
}

/** Milliseconds of local time since the epoch, as a datetime's parts read in UTC. */
function wallMs(value: DateTime): number {
  return (
    utcMidnight(value.year, value.month, value.day) +
    ((value.hour * 60 + value.minute) * 60 + value.second) * 1000
  )
}

/** The local time of `zone` at `ms` milliseconds since the epoch, with `micro` microseconds after them. */
export function localDateTime(ms: number, zone: TimeZone, micro = 0): DateTime {
  const whole = Math.floor(ms)
  const local = new Date(whole + zone.offset(whole) * 60_000)
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    second: local.getUTCSeconds(),
    micro: local.getUTCMilliseconds() * 1000 + micro,
  }
}

/**
 * Milliseconds since the epoch of a local time of `zone`. Times that a
 * change of the clocks skips are read with the offset from before it.
 */
export function epochOf(value: DateTime, zone: TimeZone): number {
  const wall = wallMs(value) + Math.floor(value.micro / 1000)
  const guess = wall - zone.offset(wall) * 60_000
  return wall - zone.offset(guess) * 60_000
}

/** Microseconds of a datetime from 0000-00-00, for arithmetic. */
function microsOfDateTime(value: DateTime): number {
  const day = dayNumber(value.year, value.month, value.day)
  return (
    day * MICROS_PER_DAY +
    ((value.hour * 60 + value.minute) * 60 + value.second) * 1_000_000 +
    value.micro
  )
}

/** A datetime of microseconds since 0000-00-00, or undefined outside of years 0 to 9999. */
function dateTimeOfMicros(micros: number): DateTime | undefined {
  const days = Math.floor(micros / MICROS_PER_DAY)
  let rest = micros - days * MICROS_PER_DAY
  if (days < 0 || days > 3_652_424) return undefined
  const { year, month, day } = fromDayNumber(days)
  const hour = Math.floor(rest / 3_600_000_000)
  rest -= hour * 3_600_000_000
  const minute = Math.floor(rest / 60_000_000)
  rest -= minute * 60_000_000
  const second = Math.floor(rest / 1_000_000)
  return { year, month, day, hour, minute, second, micro: rest - second * 1_000_000 }
}

/** An interval, as months and microseconds, which DATE_ADD adds in that order. */
export interface Interval {
  readonly months: number
  readonly micros: number
}

const UNIT_MICROS: Partial<Record<IntervalUnit, number>> = {
  MICROSECOND: 1,
  SECOND: 1_000_000,
  MINUTE: 60_000_000,
  HOUR: 3_600_000_000,
  DAY: MICROS_PER_DAY,
  WEEK: 7 * MICROS_PER_DAY,
}

/** The parts of the compound units, from the largest, and the size of each in microseconds or months. */
const COMPOUND_UNITS: Partial<
  Record<IntervalUnit, readonly (readonly ['months' | 'micros', number])[]>
> = {
  YEAR_MONTH: [
    ['months', 12],
    ['months', 1],
  ],
  DAY_HOUR: [
    ['micros', MICROS_PER_DAY],
    ['micros', 3_600_000_000],
  ],
  DAY_MINUTE: [
    ['micros', MICROS_PER_DAY],
    ['micros', 3_600_000_000],
    ['micros', 60_000_000],
  ],
  DAY_SECOND: [
    ['micros', MICROS_PER_DAY],
    ['micros', 3_600_000_000],
    ['micros', 60_000_000],
    ['micros', 1_000_000],
  ],
  DAY_MICROSECOND: [
    ['micros', MICROS_PER_DAY],
    ['micros', 3_600_000_000],
    ['micros', 60_000_000],
    ['micros', 1_000_000],
    ['micros', 1],
  ],
  HOUR_MINUTE: [
    ['micros', 3_600_000_000],
    ['micros', 60_000_000],
  ],
  HOUR_SECOND: [
    ['micros', 3_600_000_000],
    ['micros', 60_000_000],
    ['micros', 1_000_000],
  ],
  HOUR_MICROSECOND: [
    ['micros', 3_600_000_000],
    ['micros', 60_000_000],
    ['micros', 1_000_000],
    ['micros', 1],
  ],
  MINUTE_SECOND: [
    ['micros', 60_000_000],
    ['micros', 1_000_000],
  ],
  MINUTE_MICROSECOND: [
    ['micros', 60_000_000],
    ['micros', 1_000_000],
    ['micros', 1],
  ],
  SECOND_MICROSECOND: [
    ['micros', 1_000_000],
    ['micros', 1],
  ],
}

/**
 * The interval of `value` in `unit`, as INTERVAL reads it: numbers of
 * simple units are rounded to whole ones, but seconds, and compound units
 * read their parts from strings with any delimiters, from the right, as in
 * '1:30' HOUR_MINUTE. Gives undefined for values it cannot read.
 */
export function intervalOf(value: number | string, unit: IntervalUnit): Interval | undefined {
  const simple = UNIT_MICROS[unit]
  if (simple !== undefined || unit === 'MONTH' || unit === 'QUARTER' || unit === 'YEAR') {
    let amount = typeof value === 'number' ? value : Number.parseFloat(value)
    if (Number.isNaN(amount)) amount = 0
    if (unit === 'SECOND') {
      // Seconds keep their fractions, to the microsecond.
      return { months: 0, micros: Math.round(amount * 1_000_000) }
    }
    const whole = Math.sign(amount) * Math.round(Math.abs(amount))
    if (simple !== undefined) return { months: 0, micros: whole * simple }
    return { months: whole * (unit === 'MONTH' ? 1 : unit === 'QUARTER' ? 3 : 12), micros: 0 }
  }
  const parts = COMPOUND_UNITS[unit]!
  const text = String(value).trim()
  const negative = text.startsWith('-')
  const numbers = (negative ? text.slice(1) : text).split(/[^0-9]+/).filter((part) => part !== '')
  if (numbers.length === 0) return { months: 0, micros: 0 }
  if (numbers.length > parts.length) return undefined
  // Missing parts are the largest ones.
  const used = parts.slice(parts.length - numbers.length)
  let months = 0
  let micros = 0
  used.forEach(([kind, size], i) => {
    let amount = Number(numbers[i])
    // Microseconds written with fewer than six digits are a fraction.
    if (kind === 'micros' && size === 1 && i === used.length - 1 && i > 0) {
      amount = Number(numbers[i]!.slice(0, 6).padEnd(6, '0'))
    }
    if (kind === 'months') months += amount * size
    else micros += amount * size
  })
  return negative ? { months: -months, micros: -micros } : { months, micros }
}

/**
 * A datetime with an interval added, as DATE_ADD adds it: months first,
 * with the day kept but for months that have fewer days, then the rest.
 * Gives undefined outside of years 1 to 9999.
 */
export function addInterval(value: DateTime, interval: Interval): DateTime | undefined {
  let base = value
  if (interval.months !== 0) {
    const total = value.year * 12 + (value.month - 1) + interval.months
    const year = Math.floor(total / 12)
    const month = total - year * 12 + 1
    if (year < 0 || year > 9999) return undefined
    base = { ...value, year, month, day: Math.min(value.day, daysInMonth(year, month)) }
  }
  if (interval.micros === 0) return base.year === 0 && interval.months !== 0 ? undefined : base
  return dateTimeOfMicros(microsOfDateTime(base) + interval.micros)
}

/** Microseconds between two datetimes, the second's after the first's. */
export function microsBetween(from: DateTime, to: DateTime): number {
  return microsOfDateTime(to) - microsOfDateTime(from)
}

/** Whole months between two datetimes, as TIMESTAMPDIFF counts them: only those that passed whole. */
export function monthsBetween(from: DateTime, to: DateTime): number {
  const forward = microsOfDateTime(to) >= microsOfDateTime(from)
  const [a, b] = forward ? [from, to] : [to, from]
  let months = (b.year - a.year) * 12 + (b.month - a.month)
  // A month passed whole once the day and time of the month came again.
  const within = (value: DateTime) =>
    (((value.day * 24 + value.hour) * 60 + value.minute) * 60 + value.second) * 1_000_000 +
    value.micro
  if (within(b) < within(a)) months--
  return forward ? months : -months
}

/** The microseconds of a TIME, which may be negative. */
export function microsOfTime(value: Time): number {
  const micros = ((value.hours * 60 + value.minute) * 60 + value.second) * 1_000_000 + value.micro
  return value.negative ? -micros : micros
}

/** The TIME of microseconds, held to 838:59:59 either way. */
export function timeOfMicros(micros: number): Time {
  const negative = micros < 0
  let rest = Math.abs(micros)
  const max = (MAX_TIME_HOURS * 3600 + 59 * 60 + 59) * 1_000_000
  if (rest > max) rest = max
  const hours = Math.floor(rest / 3_600_000_000)
  rest -= hours * 3_600_000_000
  const minute = Math.floor(rest / 60_000_000)
  rest -= minute * 60_000_000
  const second = Math.floor(rest / 1_000_000)
  return {
    negative: negative && micros !== 0,
    hours,
    minute,
    second,
    micro: rest - second * 1_000_000,
  }
}

/**
 * The week of a date and the year it is a week of, as WEEK and YEARWEEK
 * count them in their eight modes: weeks start on Sunday in even modes and
 * on Monday in odd ones; the first week is the first with a day of its
 * start in the year in modes 0, 2, 5 and 7, and the first with four days
 * in the year in the others; and modes 2, 3, 6 and 7 count weeks from 1,
 * giving the days before the first week to the last week of the year
 * before and those after the last to the first of the year after, where
 * the others count those before from 0.
 */
export function week(
  year: number,
  month: number,
  day: number,
  mode: number,
): { week: number; year: number } {
  const m = mode & 7
  const mondayFirst = (m & 1) === 1
  const fromOne = m === 2 || m === 3 || m === 6 || m === 7
  const fourDays = m === 1 || m === 3 || m === 4 || m === 6
  const firstDay = mondayFirst ? 0 : 6
  /** The day number the first week of `y` starts on. */
  const start = (y: number): number => {
    const jan1 = dayNumber(y, 1, 1)
    const jan1Weekday = (jan1 + 5) % 7
    // Days from the start of the week that has January 1 in it.
    const back = (jan1Weekday - firstDay + 7) % 7
    const weekStart = jan1 - back
    if (fourDays) return 7 - back >= 4 ? weekStart : weekStart + 7
    return back === 0 ? jan1 : weekStart + 7
  }
  const date = dayNumber(year, month, day)
  const first = start(year)
  if (date < first) {
    if (!fromOne) return { week: 0, year }
    const previous = start(year - 1)
    return { week: Math.floor((date - previous) / 7) + 1, year: year - 1 }
  }
  if (fromOne && date >= start(year + 1)) return { week: 1, year: year + 1 }
  return { week: Math.floor((date - first) / 7) + 1, year }
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function dayName(value: DateTime): string {
  return DAY_NAMES[weekday(value.year, value.month, value.day)]!
}

export function monthName(month: number): string | undefined {
  return MONTH_NAMES[month - 1]
}

/** A day of the month with its English ordinal suffix, as %D writes it: 1st, 2nd, 3rd, 4th, 11th. */
function ordinal(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`
  return `${day}${['th', 'st', 'nd', 'rd'][day % 10] ?? 'th'}`
}

/**
 * Formats a datetime as DATE_FORMAT does, in English: % and a letter for
 * each part, such as %Y-%m-%d %H:%i:%s, and %% for a percent sign; % before
 * another character writes the character. Gives undefined where MariaDB
 * gives NULL, for names of months and days of zero dates.
 */
export function dateFormat(value: DateTime, format: string): string | undefined {
  let text = ''
  const zero = value.month === 0 || value.day === 0
  for (let i = 0; i < format.length; i++) {
    const char = format[i]!
    if (char !== '%' || i === format.length - 1) {
      text += char
      continue
    }
    const spec = format[++i]!
    const hour12 = value.hour % 12 === 0 ? 12 : value.hour % 12
    switch (spec) {
      case 'a':
        if (zero) return undefined
        text += dayName(value).slice(0, 3)
        break
      case 'b':
        if (value.month === 0) return undefined
        text += monthName(value.month)!.slice(0, 3)
        break
      case 'c':
        text += String(value.month)
        break
      case 'D':
        text += ordinal(value.day)
        break
      case 'd':
        text += pad(value.day, 2)
        break
      case 'e':
        text += String(value.day)
        break
      case 'f':
        text += pad(value.micro, 6)
        break
      case 'H':
        text += pad(value.hour, 2)
        break
      case 'h':
      case 'I':
        text += pad(hour12, 2)
        break
      case 'i':
        text += pad(value.minute, 2)
        break
      case 'j':
        if (zero) return undefined
        text += pad(dayOfYear(value.year, value.month, value.day), 3)
        break
      case 'k':
        text += String(value.hour)
        break
      case 'l':
        text += String(hour12)
        break
      case 'M':
        if (value.month === 0) return undefined
        text += monthName(value.month)
        break
      case 'm':
        text += pad(value.month, 2)
        break
      case 'p':
        text += value.hour < 12 ? 'AM' : 'PM'
        break
      case 'r':
        text += `${pad(hour12, 2)}:${pad(value.minute, 2)}:${pad(value.second, 2)} ${value.hour < 12 ? 'AM' : 'PM'}`
        break
      case 'S':
      case 's':
        text += pad(value.second, 2)
        break
      case 'T':
        text += `${pad(value.hour, 2)}:${pad(value.minute, 2)}:${pad(value.second, 2)}`
        break
      case 'U':
      case 'u':
      case 'V':
      case 'v': {
        if (zero) return undefined
        const mode = { U: 0, u: 1, V: 2, v: 3 }[spec]
        text += pad(week(value.year, value.month, value.day, mode).week, 2)
        break
      }
      case 'W':
        if (zero) return undefined
        text += dayName(value)
        break
      case 'w':
        if (zero) return undefined
        text += String((weekday(value.year, value.month, value.day) + 1) % 7)
        break
      case 'X':
      case 'x':
        if (zero) return undefined
        text += pad(week(value.year, value.month, value.day, spec === 'X' ? 2 : 3).year, 4)
        break
      case 'Y':
        text += pad(value.year, 4)
        break
      case 'y':
        text += pad(value.year % 100, 2)
        break
      default:
        text += spec
    }
  }
  return text
}
