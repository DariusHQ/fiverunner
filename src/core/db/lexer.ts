/**
 * The tokens of MySQL's SQL, as MariaDB's lexer reads them by default:
 * strings in single or double quotes with backslash escapes, names in
 * backticks, comments that start with --, # or /*, of which those that
 * start with /*! or /*M! are SQL for servers of their versions, and ? for
 * the parameters of prepared statements.
 */
export type Token =
  /** A name that is not quoted, which may be a keyword. */
  | Located<{ readonly kind: 'word'; readonly text: string }>
  /** A name in backticks. */
  | Located<{ readonly kind: 'ident'; readonly text: string }>
  | Located<{ readonly kind: 'string'; readonly text: string; readonly quote: "'" | '"' }>
  | Located<{ readonly kind: 'number'; readonly text: string }>
  /** A literal of bytes, as X'4142' or 0x4142 write them, in hexadecimal. */
  | Located<{ readonly kind: 'hex'; readonly digits: string }>
  /** A literal of bits, as B'101' or 0b101 write them. */
  | Located<{ readonly kind: 'bits'; readonly digits: string }>
  | Located<{ readonly kind: 'param' }>
  /** A variable: @name for those of users, @@name for those of the system. */
  | Located<{ readonly kind: 'variable'; readonly text: string; readonly system: boolean }>
  | Located<{ readonly kind: 'op'; readonly text: string }>
  /** The end of the SQL. */
  | Located<{ readonly kind: 'end' }>

/** Where a token is in the SQL, by the offsets of its first character and the one after its last. */
export type Located<T> = T & { readonly start: number; readonly end: number }

/** An error of MariaDB's, with its number, its SQL state and its message. */
export class SqlError extends Error {
  override readonly name = 'SqlError'
  readonly errno: number
  readonly sqlState: string

  constructor(errno: number, sqlState: string, message: string) {
    super(message)
    this.errno = errno
    this.sqlState = sqlState
  }
}

/**
 * The version that MariaDB compares those of /*! comments with, as its
 * MYSQL_VERSION_ID: 11.4.
 */
export const VERSION_ID = 110400

/** The operators of more than one character, longest first. */
const OPERATORS = ['<=>', '->>', '<<', '>>', '<=', '>=', '<>', '!=', '||', '&&', ':=', '->']

/** What backslashes before characters in strings stand for, but in LIKE patterns, where \% and \_ stay. */
const ESCAPES: Readonly<Record<string, string>> = {
  '0': '\0',
  b: '\b',
  n: '\n',
  r: '\r',
  t: '\t',
  Z: '\x1a',
  '%': '\\%',
  _: '\\_',
}

/** Characters of names that are not quoted: those of ASCII words, and any other than ASCII. */
const NAME = /[A-Za-z0-9_$]|[^\x00-\x7f]/
const DIGIT = /[0-9]/
const HEX = /[0-9a-fA-F]/
const SPACE = /[\s]/

/**
 * Reads the tokens of SQL, which end with one of kind end. Strings and
 * names in backticks that do not end are syntax errors, as are comments
 * that start with /* and do not end, which MariaDB takes for SQL.
 */
export function lex(sql: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  /** Whether the lexer is in a /*! comment, whose end it skips. */
  let executing = false
  while (i < sql.length) {
    const char = sql[i]!
    const next = sql[i + 1] ?? ''
    if (executing && char === '*' && next === '/') {
      executing = false
      i += 2
    } else if (SPACE.test(char)) {
      i++
    } else if (char === '#' || (char === '-' && next === '-' && isCommentSpace(sql[i + 2]))) {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? sql.length : end + 1
    } else if (char === '/' && next === '*') {
      const executable = /^\/\*(M?)!(\d{5,6})?/.exec(sql.slice(i, i + 10))
      const version = executable?.[2]
      if (executable !== null && !executing) {
        if (version === undefined || Number(version) <= VERSION_ID) {
          // What the comment holds is SQL, from after its version.
          executing = true
          i += executable[0].length
          continue
        }
      }
      const end = sql.indexOf('*/', i + 2)
      if (end === -1) throw syntaxError(sql, i)
      i = end + 2
    } else if (char === "'" || char === '"') {
      const end = readString(sql, i)
      tokens.push({ kind: 'string', text: end.text, quote: char, start: i, end: end.end })
      i = end.end
    } else if (char === '`') {
      let text = ''
      let j = i + 1
      for (;;) {
        const end = sql.indexOf('`', j)
        if (end === -1) throw syntaxError(sql, i)
        text += sql.slice(j, end)
        j = end + 1
        // `` stands for a backtick.
        if (sql[j] !== '`') break
        text += '`'
        j++
      }
      tokens.push({ kind: 'ident', text, start: i, end: j })
      i = j
    } else if ((char === 'x' || char === 'X' || char === 'b' || char === 'B') && next === "'") {
      const end = sql.indexOf("'", i + 2)
      if (end === -1) throw syntaxError(sql, i)
      const digits = sql.slice(i + 2, end)
      const hex = char === 'x' || char === 'X'
      // MariaDB takes X'' with an odd number of digits, or others, for a syntax error.
      if (
        hex ? digits.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(digits) : !/^[01]*$/.test(digits)
      ) {
        throw syntaxError(sql, i)
      }
      tokens.push(
        hex
          ? { kind: 'hex', digits, start: i, end: end + 1 }
          : { kind: 'bits', digits, start: i, end: end + 1 },
      )
      i = end + 1
    } else if (
      char === '0' &&
      (next === 'x' || next === 'b') &&
      isLiteralOf(sql, i + 2, next === 'x' ? HEX : /[01]/)
    ) {
      let j = i + 2
      while (j < sql.length && (next === 'x' ? HEX : /[01]/).test(sql[j]!)) j++
      const digits = sql.slice(i + 2, j)
      tokens.push(
        next === 'x'
          ? {
              kind: 'hex',
              digits: digits.length % 2 === 0 ? digits : `0${digits}`,
              start: i,
              end: j,
            }
          : { kind: 'bits', digits, start: i, end: j },
      )
      i = j
    } else if (DIGIT.test(char) || (char === '.' && DIGIT.test(next) && !followsName(tokens, i))) {
      let j = i
      while (j < sql.length && DIGIT.test(sql[j]!)) j++
      if (sql[j] === '.') {
        j++
        while (j < sql.length && DIGIT.test(sql[j]!)) j++
      }
      if (
        (sql[j] === 'e' || sql[j] === 'E') &&
        (DIGIT.test(sql[j + 1] ?? '') ||
          (/[+-]/.test(sql[j + 1] ?? '') && DIGIT.test(sql[j + 2] ?? '')))
      ) {
        j += 2
        while (j < sql.length && DIGIT.test(sql[j]!)) j++
      }
      if (j < sql.length && NAME.test(sql[j]!) && !sql.slice(i, j).includes('.')) {
        // Names may start with digits, as 1st does.
        while (j < sql.length && NAME.test(sql[j]!)) j++
        tokens.push({ kind: 'word', text: sql.slice(i, j), start: i, end: j })
      } else {
        tokens.push({ kind: 'number', text: sql.slice(i, j), start: i, end: j })
      }
      i = j
    } else if (NAME.test(char)) {
      let j = i + 1
      while (j < sql.length && NAME.test(sql[j]!)) j++
      tokens.push({ kind: 'word', text: sql.slice(i, j), start: i, end: j })
      i = j
    } else if (char === '@') {
      const system = next === '@'
      let j = i + (system ? 2 : 1)
      let text: string
      if (sql[j] === '`' || sql[j] === "'" || sql[j] === '"') {
        const quote = sql[j]!
        const end = quote === '`' ? sql.indexOf('`', j + 1) : -2
        if (end === -1) throw syntaxError(sql, j)
        const read =
          quote === '`' ? { text: sql.slice(j + 1, end), end: end + 1 } : readString(sql, j)
        text = read.text
        j = read.end
      } else {
        const from = j
        while (j < sql.length && (/[A-Za-z0-9_$.]/.test(sql[j]!) || /[^\x00-\x7f]/.test(sql[j]!)))
          j++
        text = sql.slice(from, j)
      }
      tokens.push({ kind: 'variable', text, system, start: i, end: j })
      i = j
    } else if (char === '?') {
      tokens.push({ kind: 'param', start: i, end: i + 1 })
      i++
    } else {
      const op = OPERATORS.find((candidate) => sql.startsWith(candidate, i)) ?? char
      tokens.push({ kind: 'op', text: op, start: i, end: i + op.length })
      i += op.length
    }
  }
  if (executing) throw syntaxError(sql, sql.length)
  tokens.push({ kind: 'end', start: sql.length, end: sql.length })
  return tokens
}

/** Whether MariaDB takes -- before `char` for a comment: before whitespace, a control character or the end. */
function isCommentSpace(char: string | undefined): boolean {
  return char === undefined || char <= ' '
}

/** Whether the digits of a literal of the kind that `digit` matches start at `at` and run to the end of a name. */
function isLiteralOf(sql: string, at: number, digit: RegExp): boolean {
  let j = at
  while (j < sql.length && digit.test(sql[j]!)) j++
  return j > at && (j === sql.length || !NAME.test(sql[j]!))
}

/** Whether a dot at `at` follows a name, as in t.1, where it qualifies the name that comes after it. */
function followsName(tokens: readonly Token[], at: number): boolean {
  const last = tokens.at(-1)
  return last !== undefined && last.end === at && (last.kind === 'word' || last.kind === 'ident')
}

/** Reads a string in single or double quotes that starts at `start`: its text and where it ends. */
function readString(sql: string, start: number): { text: string; end: number } {
  const quote = sql[start]!
  let text = ''
  let i = start + 1
  while (i < sql.length) {
    const char = sql[i]!
    if (char === '\\' && i + 1 < sql.length) {
      const escaped = sql[i + 1]!
      text += ESCAPES[escaped] ?? escaped
      i += 2
    } else if (char === quote) {
      // A quote twice stands for one.
      if (sql[i + 1] !== quote) return { text, end: i + 1 }
      text += quote
      i += 2
    } else {
      text += char
      i++
    }
  }
  throw syntaxError(sql, start)
}

/** The line that the character at `at` is on, from 1. */
function lineAt(sql: string, at: number): number {
  let line = 1
  for (let i = 0; i < at && i < sql.length; i++) if (sql[i] === '\n') line++
  return line
}

/** MariaDB's error for SQL it cannot read from `at`, which quotes what follows, up to 80 characters. */
export function syntaxError(sql: string, at: number): SqlError {
  const near = [...sql.slice(at)].slice(0, 80).join('')
  return new SqlError(
    1064,
    '42000',
    `You have an error in your SQL syntax; check the manual that corresponds to your MariaDB server version for the right syntax to use near '${near}' at line ${lineAt(sql, at)}`,
  )
}
