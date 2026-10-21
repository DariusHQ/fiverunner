/**
 * The types of values in FiveRunner's database, as MariaDB tells clients
 * the types of the columns of results: by the types of its protocol, with
 * a length, digits after the point, and whether integers are unsigned and
 * strings are of bytes. Clients convert values by them, as mysql2 does
 * DECIMAL to strings and TINYINT(1) is a boolean to oxmysql.
 */

/** The types of MariaDB's protocol that FiveRunner's database gives columns. */
export type FieldType =
  | 'TINY'
  | 'SHORT'
  | 'INT24'
  | 'LONG'
  | 'LONGLONG'
  | 'NEWDECIMAL'
  | 'FLOAT'
  | 'DOUBLE'
  | 'BIT'
  | 'YEAR'
  | 'DATE'
  | 'TIME'
  | 'DATETIME'
  | 'TIMESTAMP'
  | 'VAR_STRING'
  | 'STRING'
  | 'BLOB'
  | 'NULL'

export interface Type {
  readonly field: FieldType
  /** The length MariaDB gives columns: their width, in characters for strings. */
  readonly length: number
  /** The digits after the point, of decimals and of fractions of seconds. */
  readonly decimals: number
  readonly unsigned?: boolean
  /** Whether a string is of bytes, which MariaDB gives the binary character set. */
  readonly binary?: boolean
  /** Whether strings of characters compare with their case, as those of binary collations do. */
  readonly caseSensitive?: boolean
}

/** The digits after the point MariaDB gives doubles whose digits are not fixed. */
const NOT_FIXED_DEC = 39

/** The digits MariaDB adds after the point of a quotient, by div_precision_increment. */
export const DIV_PRECISION_INCREMENT = 4

/** The most digits after the point of decimals. */
const MAX_DECIMALS = 38

export const NULL_TYPE: Type = { field: 'NULL', length: 0, decimals: 0 }
export const BIGINT_TYPE: Type = { field: 'LONGLONG', length: 20, decimals: 0 }
export const DOUBLE_TYPE: Type = { field: 'DOUBLE', length: 22, decimals: NOT_FIXED_DEC }
export const DATE_TYPE: Type = { field: 'DATE', length: 10, decimals: 0 }
export const YEAR_TYPE: Type = { field: 'YEAR', length: 4, decimals: 0, unsigned: true }

/** A result of a comparison or of a test: 1, 0 or NULL, as an integer. */
export const BOOLEAN_RESULT: Type = { field: 'LONGLONG', length: 1, decimals: 0 }

/** An integer of `length` digits. */
export function integerType(length: number, unsigned = false): Type {
  return { field: 'LONGLONG', length, decimals: 0, ...(unsigned ? { unsigned } : {}) }
}

/** A decimal of `digits` digits, `decimals` of them after the point. */
export function decimalType(digits: number, decimals: number, unsigned = false): Type {
  const scale = Math.min(decimals, MAX_DECIMALS)
  // The length counts the point and a sign.
  const length = digits + (scale > 0 ? 1 : 0) + (unsigned ? 0 : 1)
  return { field: 'NEWDECIMAL', length, decimals: scale, ...(unsigned ? { unsigned } : {}) }
}

/** A string of `length` characters, or bytes. */
export function stringType(length: number, binary = false): Type {
  return { field: 'VAR_STRING', length, decimals: 0, ...(binary ? { binary } : {}) }
}

/** LONGTEXT, as functions of JSON and the like give. */
export const LONGTEXT_TYPE: Type = { field: 'BLOB', length: 4294967295, decimals: 0 }

export function datetimeType(fsp: number): Type {
  return { field: 'DATETIME', length: fsp > 0 ? 20 + fsp : 19, decimals: fsp }
}

export function timeType(fsp: number): Type {
  return { field: 'TIME', length: fsp > 0 ? 11 + fsp : 10, decimals: fsp }
}

export function isInteger(type: Type): boolean {
  return (
    type.field === 'TINY' ||
    type.field === 'SHORT' ||
    type.field === 'INT24' ||
    type.field === 'LONG' ||
    type.field === 'LONGLONG' ||
    type.field === 'YEAR' ||
    type.field === 'BIT'
  )
}

export function isDecimal(type: Type): boolean {
  return type.field === 'NEWDECIMAL'
}

/** Whether a type is of floating point numbers. */
export function isReal(type: Type): boolean {
  return type.field === 'FLOAT' || type.field === 'DOUBLE'
}

export function isNumeric(type: Type): boolean {
  return isInteger(type) || isDecimal(type) || isReal(type)
}

export function isString(type: Type): boolean {
  return type.field === 'VAR_STRING' || type.field === 'STRING' || type.field === 'BLOB'
}

export function isTemporal(type: Type): boolean {
  return (
    type.field === 'DATE' ||
    type.field === 'DATETIME' ||
    type.field === 'TIMESTAMP' ||
    type.field === 'TIME'
  )
}

/** Whether a type is of dates, maybe with times. */
export function isDateType(type: Type): boolean {
  return type.field === 'DATE' || type.field === 'DATETIME' || type.field === 'TIMESTAMP'
}

/** Whether values of a type compare without their case, as strings of _ci collations do. */
export function comparesWithoutCase(type: Type): boolean {
  return isString(type) && type.binary !== true && type.caseSensitive !== true
}

/** The digits before the point of a numeric type. */
function integerDigits(type: Type): number {
  if (isInteger(type)) return type.length
  if (isDecimal(type)) {
    return (
      type.length - (type.decimals > 0 ? 1 : 0) - (type.unsigned === true ? 0 : 1) - type.decimals
    )
  }
  return 0
}

/**
 * The type of the result of + - * and MOD, as MariaDB has it: a double for
 * doubles and strings, which it reads as doubles, a decimal for decimals,
 * and an integer for integers.
 */
export function arithmeticType(op: '+' | '-' | '*' | 'MOD', left: Type, right: Type): Type {
  const a = numericOf(left)
  const b = numericOf(right)
  if (isReal(a) || isReal(b)) return DOUBLE_TYPE
  if (isDecimal(a) || isDecimal(b)) {
    const digits = Math.max(integerDigits(a), integerDigits(b))
    switch (op) {
      case '+':
      case '-': {
        const scale = Math.max(a.decimals, b.decimals)
        return decimalType(Math.min(digits + 1 + scale, 65), scale)
      }
      case '*': {
        const scale = Math.min(a.decimals + b.decimals, MAX_DECIMALS)
        return decimalType(Math.min(integerDigits(a) + integerDigits(b) + scale, 65), scale)
      }
      case 'MOD': {
        const scale = Math.max(a.decimals, b.decimals)
        return decimalType(Math.min(digits + scale, 65), scale)
      }
    }
  }
  const unsigned = a.unsigned === true && b.unsigned === true && op !== '-'
  return integerType(Math.max(a.length, b.length) + 1, unsigned)
}

/** The type of the result of /, which is a decimal with div_precision_increment more digits, or a double. */
export function divisionType(left: Type, right: Type): Type {
  const a = numericOf(left)
  const b = numericOf(right)
  if (isReal(a) || isReal(b)) return DOUBLE_TYPE
  const scale = Math.min((isDecimal(a) ? a.decimals : 0) + DIV_PRECISION_INCREMENT, MAX_DECIMALS)
  const digits = integerDigits(a) + (isDecimal(b) ? b.decimals : 0) + scale
  return decimalType(Math.min(digits, 65), scale)
}

/**
 * The numeric type MariaDB reads values of a type as: strings as doubles,
 * temporal values as numbers of their digits, and NULL as an integer.
 */
export function numericOf(type: Type): Type {
  if (type.field === 'NULL') return integerType(1)
  if (isNumeric(type))
    return type.field === 'BIT' || type.field === 'YEAR' ? integerType(type.length, true) : type
  if (isTemporal(type)) {
    return type.decimals > 0 ? decimalType(14 + type.decimals, type.decimals) : integerType(14)
  }
  return DOUBLE_TYPE
}

/**
 * The type of values of several types together, as the results of CASE,
 * IF, IFNULL, COALESCE, UNION and the like have them: NULL counts for
 * nothing, numbers widen to the widest of them, temporal values of
 * different types and strings with others are strings.
 */
export function aggregateType(types: readonly Type[]): Type {
  const typed = types.filter((type) => type.field !== 'NULL')
  if (typed.length === 0) return types.length > 0 ? stringType(0, true) : NULL_TYPE
  const first = typed[0]!
  if (typed.every((type) => isNumeric(type))) {
    if (typed.some((type) => type.field === 'DOUBLE' || type.field === 'FLOAT')) {
      return typed.every((type) => type.field === 'FLOAT') ? first : DOUBLE_TYPE
    }
    if (typed.some((type) => isDecimal(type))) {
      const scale = Math.max(...typed.map((type) => (isDecimal(type) ? type.decimals : 0)))
      const digits = Math.max(...typed.map((type) => integerDigits(numericOf(type))))
      return decimalType(Math.min(digits + scale, 65), scale)
    }
    if (typed.every((type) => type.field === first.field)) {
      const length = Math.max(...typed.map((type) => type.length))
      return { ...first, length, unsigned: typed.every((type) => type.unsigned === true) }
    }
    const unsigned = typed.every((type) => type.unsigned === true)
    return integerType(Math.max(...typed.map((type) => type.length)), unsigned)
  }
  if (typed.every((type) => isTemporal(type))) {
    if (typed.every((type) => type.field === first.field)) {
      return { ...first, decimals: Math.max(...typed.map((type) => type.decimals)) }
    }
    if (typed.every((type) => isDateType(type))) {
      return datetimeType(Math.max(...typed.map((type) => type.decimals)))
    }
  }
  const binary = typed.some((type) => type.binary === true)
  const length = Math.max(...typed.map((type) => displayLength(type)))
  const result = stringType(length, binary)
  if (!binary && typed.some((type) => isString(type) && type.caseSensitive === true)) {
    return { ...result, caseSensitive: true }
  }
  if (typed.some((type) => type.field === 'BLOB')) return { ...result, field: 'BLOB' }
  return result
}

/** The characters values of a type take as strings at most. */
function displayLength(type: Type): number {
  if (isString(type)) return type.length
  if (isTemporal(type)) return type.length
  if (isReal(type)) return 22
  return type.length
}
