/**
 * Values written into SQL as mysql2's query writes them, by sqlstring's
 * rules: ? for an escaped value, ?? for an escaped name, arrays as lists,
 * arrays in arrays as lists in parentheses, objects as `key` = value pairs,
 * and dates in local time.
 */

/** The characters that strings escape, and what they escape them as. */
const ESCAPES: Readonly<Record<string, string>> = {
  '\0': '\\0',
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\r': '\\r',
  '\x1a': '\\Z',
  '"': '\\"',
  "'": "\\'",
  '\\': '\\\\',
}

const ESCAPED = /[\0\b\t\n\r\x1a"'\\]/g

/** A string in quotes, with backslashes before the characters MariaDB reads them before. */
export function escapeString(value: string): string {
  return `'${value.replace(ESCAPED, (char) => ESCAPES[char]!)}'`
}

/** A name in backticks, qualified by its dots, as ?? writes names. */
export function escapeId(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => escapeId(item)).join(', ')
  return `\`${String(value).replace(/`/g, '``').replace(/\./g, '`.`')}\``
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

/** A date as sqlstring writes them, in local time, with milliseconds. */
function dateText(date: Date): string {
  if (Number.isNaN(date.getTime())) return 'NULL'
  const text = `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)} ${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}.${pad(date.getMilliseconds(), 3)}`
  return escapeString(text)
}

function isBuffer(value: unknown): value is Uint8Array {
  // mysql2 writes Node's Buffers as bytes, which FiveRunner's values of bytes stand for.
  return value instanceof Uint8Array
}

/**
 * A value as SQL writes it: NULL for null and undefined, true and false,
 * numbers as JavaScript writes them, strings escaped, bytes as X'hex', and
 * objects as `key` = value pairs, which their objects are written in as
 * strings. Functions are strings of their source, as sqlstring has them.
 */
export function escape(value: unknown, stringifyObjects = false): string {
  if (value === undefined || value === null) return 'NULL'
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
    case 'bigint':
      return String(value)
    case 'object': {
      if (value instanceof Date) return dateText(value)
      if (Array.isArray(value)) return arrayToList(value)
      if (isBuffer(value))
        return `X'${[...value].map((byte) => byte.toString(16).padStart(2, '0')).join('')}'`
      const custom = (value as { toSqlString?: unknown }).toSqlString
      if (typeof custom === 'function') return String(custom.call(value))
      if (stringifyObjects) return escapeString(String(value))
      return objectToValues(value as Record<string, unknown>)
    }
    default:
      return escapeString(String(value))
  }
}

/** Values of an array as a list, with arrays in it as lists in parentheses. */
function arrayToList(array: readonly unknown[]): string {
  return array
    .map((item) => (Array.isArray(item) ? `(${arrayToList(item)})` : escape(item, true)))
    .join(', ')
}

/** The pairs of an object as `key` = value, but for its functions. */
function objectToValues(object: Record<string, unknown>): string {
  const pairs: string[] = []
  for (const key in object) {
    const item = object[key]
    if (typeof item === 'function') continue
    pairs.push(`${escapeId(key)} = ${escape(item, true)}`)
  }
  return pairs.join(', ')
}

/**
 * Writes values into the placeholders of SQL as mysql2's query does: each
 * ? takes the next value and each ?? the next name, wherever they are, in
 * strings too, until there are no more values. Three or more ? in a row
 * are left as they are.
 */
export function format(sql: string, values: unknown): string {
  if (values === undefined || values === null) return sql
  const list = Array.isArray(values) ? values : [values]
  const placeholders = /\?+/g
  let result = ''
  let chunk = 0
  let index = 0
  let match: RegExpExecArray | null
  while (index < list.length && (match = placeholders.exec(sql)) !== null) {
    const length = match[0].length
    if (length > 2) continue
    const value = list[index]
    result += sql.slice(chunk, match.index) + (length === 2 ? escapeId(value) : escape(value))
    chunk = placeholders.lastIndex
    index++
  }
  if (chunk === 0) return sql
  return result + sql.slice(chunk)
}
