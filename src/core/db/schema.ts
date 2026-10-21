import type {
  AlterAction,
  ColumnDefinition,
  CreateTable,
  DataType,
  Expression,
  KeyPart,
  ReferenceAction,
  TableConstraint,
} from './ast.ts'
import { INTEGER_TYPES } from './ddl.ts'
import { SqlError } from './lexer.ts'
import { unsupported } from './parser.ts'
import type { SqlValue } from './sqlite.ts'
import type { TimeZone } from '../scripting/time.ts'
import { datetimeType, decimalType, timeType, type Type } from './types.ts'
import { BINARY_TYPES, bytesOfText, storeValue, textOf } from './values.ts'

/** The default of a column: a value, the current time, or an expression that inserts evaluate. */
export type ColumnDefault =
  | { readonly kind: 'value'; readonly value: SqlValue; readonly sql: string }
  | { readonly kind: 'now'; readonly fsp: number; readonly sql: string }
  | { readonly kind: 'expression'; readonly expr: Expression; readonly sql: string }

export interface ColumnSchema {
  readonly name: string
  /** The type, with the lengths MariaDB gives types without them, such as INT(11). */
  readonly type: DataType
  readonly nullable: boolean
  readonly default?: ColumnDefault
  /** Whether updates set the column to the current time, as ON UPDATE CURRENT_TIMESTAMP does. */
  readonly onUpdateNow: boolean
  readonly autoIncrement: boolean
  readonly comment: string
  /** The collation of strings of characters, such as utf8mb4_general_ci, or binary. */
  readonly collation: string
}

export interface IndexSchema {
  /** The name, PRIMARY for the primary key. */
  readonly name: string
  readonly kind: 'PRIMARY' | 'UNIQUE' | 'INDEX' | 'FULLTEXT' | 'SPATIAL'
  readonly parts: readonly KeyPart[]
}

export interface ForeignKeySchema {
  readonly name: string
  readonly columns: readonly string[]
  readonly table: string
  readonly referenced: readonly string[]
  readonly onDelete: ReferenceAction
  readonly onUpdate: ReferenceAction
}

export interface CheckSchema {
  readonly name: string
  readonly expr: Expression
  readonly sql: string
}

export interface TableSchema {
  /** The name, in lower case, as MariaDB keeps them on Windows. */
  readonly name: string
  readonly columns: readonly ColumnSchema[]
  /** The keys, with the primary key first. */
  readonly indexes: readonly IndexSchema[]
  readonly foreignKeys: readonly ForeignKeySchema[]
  readonly checks: readonly CheckSchema[]
  readonly engine: string
  readonly charset: string
  readonly collation: string
  readonly comment: string
  /** The value AUTO_INCREMENT gives next. */
  readonly autoIncrement: number
  readonly temporary: boolean
}

/** What building a table needs of the database. */
export interface SchemaContext {
  /** The name of the database, as errors name it. */
  readonly schema: string
  readonly zone: TimeZone
  readonly foreignKeyChecks: boolean
  /** The table of a name, in lower case, if there is one. */
  table(name: string): TableSchema | undefined
}

/** The default collations of character sets. */
const DEFAULT_COLLATIONS: Readonly<Record<string, string>> = {
  utf8mb4: 'utf8mb4_general_ci',
  utf8mb3: 'utf8mb3_general_ci',
  utf8: 'utf8mb3_general_ci',
  latin1: 'latin1_swedish_ci',
  ascii: 'ascii_general_ci',
  ucs2: 'ucs2_general_ci',
  utf16: 'utf16_general_ci',
  utf32: 'utf32_general_ci',
  binary: 'binary',
}

const DEFAULT_CHARSET = 'utf8mb4'
const DEFAULT_COLLATION = 'utf8mb4_general_ci'

/** The character set of a collation, such as utf8mb4 of utf8mb4_bin. */
function charsetOf(collation: string): string {
  if (collation === 'binary') return 'binary'
  const prefix = collation.split('_')[0]!.toLowerCase()
  return prefix === 'utf8' ? 'utf8mb3' : prefix
}

/** Whether a collation compares strings without their case, as those whose names end in _ci do. */
export function isCaseInsensitive(collation: string): boolean {
  return /_ci$/i.test(collation)
}

/** The types of strings of characters, which have collations. */
const TEXT_TYPES: ReadonlySet<string> = new Set([
  'CHAR',
  'VARCHAR',
  'TINYTEXT',
  'TEXT',
  'MEDIUMTEXT',
  'LONGTEXT',
  'ENUM',
  'SET',
  'JSON',
])

/** The types of TEXT and BLOB that a length chooses, from the smallest. */
const TEXT_SIZES = [
  ['TINYTEXT', 255],
  ['TEXT', 65535],
  ['MEDIUMTEXT', 16777215],
  ['LONGTEXT', 4294967295],
] as const
const BLOB_SIZES = [
  ['TINYBLOB', 255],
  ['BLOB', 65535],
  ['MEDIUMBLOB', 16777215],
  ['LONGBLOB', 4294967295],
] as const

/** The widths MariaDB gives integers without them, signed and unsigned. */
const INTEGER_WIDTHS: Readonly<Record<string, readonly [number, number]>> = {
  TINYINT: [4, 3],
  SMALLINT: [6, 5],
  MEDIUMINT: [9, 8],
  INT: [11, 10],
  BIGINT: [20, 20],
}

/** The most characters of VARCHAR in utf8mb4, whose rows hold 65,535 bytes. */
const MAX_VARCHAR = 16383

export function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/** The name a table is kept by: in lower case, as MariaDB keeps them with lower_case_table_names=1. */
export function tableKey(name: string): string {
  return name.toLowerCase()
}

/**
 * A type with what MariaDB gives types without it, such as INT(11) and
 * DECIMAL(10,0), and the TEXT or BLOB that a length chooses for TEXT(n).
 * Lengths that do not fit fail with MariaDB's errors.
 */
function normalizeType(type: DataType, column: string): DataType {
  const name = type.name
  if (INTEGER_TYPES.has(name)) {
    const [signed, unsigned] = INTEGER_WIDTHS[name]!
    return { ...type, length: type.length ?? (type.unsigned === true ? unsigned : signed) }
  }
  switch (name) {
    case 'DECIMAL': {
      const length = type.length ?? 10
      const scale = type.scale ?? 0
      if (length > 65)
        throw new SqlError(
          1426,
          '42000',
          `Too big precision ${length} specified for '${column}'. Maximum is 65`,
        )
      if (scale > 38)
        throw new SqlError(
          1425,
          '42000',
          `Too big scale ${scale} specified for '${column}'. Maximum is 38`,
        )
      if (scale > length) {
        throw new SqlError(
          1427,
          '42000',
          `For float(M,D), double(M,D) or decimal(M,D), M must be >= D (column '${column}')`,
        )
      }
      return { ...type, length: Math.max(length, 1), scale }
    }
    case 'FLOAT':
    case 'DOUBLE':
      if (type.scale !== undefined && type.length !== undefined && type.scale > type.length) {
        throw new SqlError(
          1427,
          '42000',
          `For float(M,D), double(M,D) or decimal(M,D), M must be >= D (column '${column}')`,
        )
      }
      return type
    case 'BIT': {
      const length = type.length ?? 1
      if (length > 64)
        throw new SqlError(1439, '42000', `Display width out of range for '${column}' (max = 64)`)
      return { ...type, length }
    }
    case 'CHAR':
    case 'BINARY': {
      const length = type.length ?? 1
      if (length > 255)
        throw new SqlError(
          1074,
          '42000',
          `Column length too big for column '${column}' (max = 255); use BLOB or TEXT instead`,
        )
      return { ...type, length }
    }
    case 'VARCHAR':
      if ((type.length ?? 0) > MAX_VARCHAR) {
        throw new SqlError(
          1074,
          '42000',
          `Column length too big for column '${column}' (max = ${MAX_VARCHAR}); use BLOB or TEXT instead`,
        )
      }
      return type
    case 'VARBINARY':
      if ((type.length ?? 0) > 65532) {
        throw new SqlError(
          1074,
          '42000',
          `Column length too big for column '${column}' (max = 65532); use BLOB or TEXT instead`,
        )
      }
      return type
    case 'TEXT':
    case 'BLOB': {
      if (type.length === undefined) return type
      const bytes = name === 'TEXT' ? type.length * 4 : type.length
      const sizes = name === 'TEXT' ? TEXT_SIZES : BLOB_SIZES
      const chosen = sizes.find(([, limit]) => bytes <= limit)?.[0] ?? sizes[3][0]
      const { length: _length, ...rest } = type
      return { ...rest, name: chosen }
    }
    case 'TIME':
    case 'DATETIME':
    case 'TIMESTAMP': {
      const fsp = type.length ?? 0
      if (fsp > 6)
        throw new SqlError(
          1426,
          '42000',
          `Too big precision ${fsp} specified for '${column}'. Maximum is 6`,
        )
      return { ...type, length: fsp }
    }
    case 'YEAR':
      return { ...type, length: 4 }
    default:
      return type
  }
}

/** The collation of a column, from its own, its character set's, or its table's. */
function columnCollation(type: DataType, tableCollation: string): string {
  if (BINARY_TYPES.has(type.name)) return 'binary'
  if (type.name === 'JSON') return 'utf8mb4_bin'
  if (!TEXT_TYPES.has(type.name)) return 'binary'
  if (type.collation !== undefined) return type.collation.toLowerCase()
  if (type.charset !== undefined) {
    const charset = type.charset.toLowerCase()
    return DEFAULT_COLLATIONS[charset] ?? `${charset}_general_ci`
  }
  return tableCollation
}

/** The type of the values of a column, as MariaDB tells clients. */
export function columnType(column: ColumnSchema): Type {
  const { type } = column
  const unsigned = type.unsigned === true ? { unsigned: true } : {}
  const length = type.length ?? 0
  switch (type.name) {
    case 'TINYINT':
      return { field: 'TINY', length, decimals: 0, ...unsigned }
    case 'SMALLINT':
      return { field: 'SHORT', length, decimals: 0, ...unsigned }
    case 'MEDIUMINT':
      return { field: 'INT24', length, decimals: 0, ...unsigned }
    case 'INT':
      return { field: 'LONG', length, decimals: 0, ...unsigned }
    case 'BIGINT':
      return { field: 'LONGLONG', length, decimals: 0, ...unsigned }
    case 'DECIMAL':
      return decimalType(length, type.scale ?? 0, type.unsigned === true)
    case 'FLOAT':
      return { field: 'FLOAT', length: type.length ?? 12, decimals: type.scale ?? 39, ...unsigned }
    case 'DOUBLE':
      return { field: 'DOUBLE', length: type.length ?? 22, decimals: type.scale ?? 39, ...unsigned }
    case 'BIT':
      return { field: 'BIT', length, decimals: 0, unsigned: true, binary: true }
    case 'YEAR':
      return { field: 'YEAR', length: 4, decimals: 0, unsigned: true }
    case 'DATE':
      return { field: 'DATE', length: 10, decimals: 0 }
    case 'TIME':
      return timeType(length)
    case 'DATETIME':
      return datetimeType(length)
    case 'TIMESTAMP':
      return { ...datetimeType(length), field: 'TIMESTAMP' }
    case 'CHAR':
    case 'ENUM':
    case 'SET':
    case 'UUID':
    case 'INET4':
    case 'INET6':
      return {
        field: 'STRING',
        length: type.name === 'CHAR' ? length : 0,
        decimals: 0,
        ...caseOf(column),
      }
    case 'BINARY':
      return { field: 'STRING', length, decimals: 0, binary: true }
    case 'VARCHAR':
      return { field: 'VAR_STRING', length, decimals: 0, ...caseOf(column) }
    case 'VARBINARY':
      return { field: 'VAR_STRING', length, decimals: 0, binary: true }
    default: {
      const binary = BINARY_TYPES.has(type.name)
      return { field: 'BLOB', length: 0, decimals: 0, ...(binary ? { binary } : caseOf(column)) }
    }
  }
}

function caseOf(column: ColumnSchema): { caseSensitive?: true } {
  return isCaseInsensitive(column.collation) ? {} : { caseSensitive: true }
}

/** The value of a literal default, as a column stores it, or undefined if the default is no literal. */
function literalValue(expr: Expression): SqlValue | undefined {
  switch (expr.kind) {
    case 'null':
      return null
    case 'boolean':
      return expr.value ? 1 : 0
    case 'number':
      return /^\d+$/.test(expr.text) && Number.isSafeInteger(Number(expr.text))
        ? Number(expr.text)
        : /^\d+$/.test(expr.text)
          ? BigInt(expr.text)
          : expr.text
    case 'string':
      return expr.binary ? bytesOfText(expr.text) : expr.text
    case 'hex':
      return Uint8Array.from(expr.digits.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))
    case 'bits': {
      const bits = BigInt(`0b${expr.digits || '0'}`)
      return bits <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bits) : bits
    }
    case 'unary': {
      if (expr.op !== '-' && expr.op !== '+') return undefined
      const operand = literalValue(expr.operand)
      if (operand === undefined || operand === null || operand instanceof Uint8Array)
        return undefined
      if (expr.op === '+') return operand
      if (typeof operand === 'number') return -operand
      if (typeof operand === 'bigint') return -operand
      return `-${operand}`
    }
    default:
      return undefined
  }
}

/** Whether an expression is CURRENT_TIMESTAMP, or NOW(fsp), and its digits of seconds. */
function nowFsp(expr: Expression): number | undefined {
  if (expr.kind !== 'call' || expr.name !== 'NOW') return undefined
  if (expr.args.length === 0) return 0
  const [arg] = expr.args
  return arg?.kind === 'number' && /^\d$/.test(arg.text) ? Number(arg.text) : undefined
}

/** Builds a column from its definition: its type, default and collation as MariaDB gives them. */
function buildColumn(
  definition: ColumnDefinition,
  sql: string,
  tableCollation: string,
  context: SchemaContext,
  table: string,
): ColumnSchema {
  const { name } = definition
  if (definition.generated !== undefined) throw unsupported('generated columns')
  const type = normalizeType(definition.type, name)
  if (type.name === 'VARCHAR' && type.length === undefined)
    throw new SqlError(1064, '42000', `Invalid column definition for '${name}'`)
  if (
    definition.autoIncrement &&
    !INTEGER_TYPES.has(type.name) &&
    type.name !== 'FLOAT' &&
    type.name !== 'DOUBLE'
  ) {
    throw new SqlError(1063, '42000', `Incorrect column specifier for column '${name}'`)
  }
  const collation = columnCollation(type, tableCollation)
  const nullable = definition.nullable ?? true
  let defaultValue: ColumnDefault | undefined
  if (definition.default !== undefined) {
    const expr = definition.default
    const text = sql.slice(expr.start, expr.end)
    const invalid = () => new SqlError(1067, '42000', `Invalid default value for '${name}'`)
    if (definition.autoIncrement) throw invalid()
    const fsp = nowFsp(expr)
    const literal = literalValue(expr)
    if (fsp !== undefined && (type.name === 'DATETIME' || type.name === 'TIMESTAMP')) {
      defaultValue = { kind: 'now', fsp, sql: text }
    } else if (literal !== undefined) {
      if (literal === null) {
        if (definition.nullable === false) throw invalid()
      } else {
        let value: SqlValue
        try {
          value = storeValue(
            literal,
            { schema: context.schema, table, column: name, type, nullable },
            { lenient: false, row: 1, zone: context.zone },
          )
        } catch (error) {
          if (error instanceof SqlError) throw invalid()
          throw error
        }
        defaultValue = { kind: 'value', value, sql: text }
      }
    } else {
      defaultValue = { kind: 'expression', expr, sql: text }
    }
  }
  if (definition.onUpdate !== undefined && nowFsp(definition.onUpdate) === undefined) {
    throw new SqlError(1294, 'HY000', `Invalid ON UPDATE clause for '${name}' column`)
  }
  return {
    name,
    type,
    nullable,
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
    onUpdateNow: definition.onUpdate !== undefined,
    autoIncrement: definition.autoIncrement,
    comment: definition.comment ?? '',
    collation,
  }
}

/** A table that is being built or altered, whose parts change as its definitions say. */
class TableBuilder {
  readonly name: string
  columns: ColumnSchema[] = []
  indexes: IndexSchema[] = []
  foreignKeys: ForeignKeySchema[] = []
  checks: CheckSchema[] = []
  engine = 'InnoDB'
  charset = DEFAULT_CHARSET
  collation = DEFAULT_COLLATION
  comment = ''
  autoIncrement = 1
  temporary = false
  /** The number of the next unnamed foreign key, which MariaDB names table_ibfk_n. */
  #foreignKeyNumber = 1
  #checkNumber = 1
  readonly #context: SchemaContext

  constructor(name: string, context: SchemaContext) {
    this.name = name
    this.#context = context
  }

  static of(table: TableSchema, context: SchemaContext): TableBuilder {
    const builder = new TableBuilder(table.name, context)
    builder.columns = [...table.columns]
    builder.indexes = [...table.indexes]
    builder.foreignKeys = [...table.foreignKeys]
    builder.checks = [...table.checks]
    builder.engine = table.engine
    builder.charset = table.charset
    builder.collation = table.collation
    builder.comment = table.comment
    builder.autoIncrement = table.autoIncrement
    builder.temporary = table.temporary
    builder.#foreignKeyNumber =
      Math.max(
        0,
        ...table.foreignKeys.map((key) => Number(/_ibfk_(\d+)$/.exec(key.name)?.[1] ?? 0)),
      ) + 1
    builder.#checkNumber =
      Math.max(
        0,
        ...table.checks.map((check) => Number(/^CONSTRAINT_(\d+)$/.exec(check.name)?.[1] ?? 0)),
      ) + 1
    return builder
  }

  column(name: string): ColumnSchema | undefined {
    return this.columns.find((column) => sameName(column.name, name))
  }

  index(name: string): IndexSchema | undefined {
    return this.indexes.find((index) => sameName(index.name, name))
  }

  /** The name MariaDB gives an unnamed key: its first column's, with _2, _3 and on for those taken. */
  #indexName(column: string): string {
    if (this.index(column) === undefined && !sameName(column, 'PRIMARY')) return column
    for (let n = 2; ; n++) {
      const name = `${column}_${n}`
      if (this.index(name) === undefined) return name
    }
  }

  addColumn(column: ColumnSchema, position?: { first: true } | { after: string }): void {
    if (this.column(column.name) !== undefined)
      throw new SqlError(1060, '42S21', `Duplicate column name '${column.name}'`)
    if (position === undefined) this.columns.push(column)
    else if ('first' in position) this.columns.unshift(column)
    else {
      const at = this.columns.findIndex((existing) => sameName(existing.name, position.after))
      if (at === -1)
        throw new SqlError(1054, '42S22', `Unknown column '${position.after}' in '${this.name}'`)
      this.columns.splice(at + 1, 0, column)
    }
  }

  addConstraint(constraint: TableConstraint, sql: string, ifNotExists = false): void {
    switch (constraint.kind) {
      case 'PRIMARY': {
        if (this.index('PRIMARY') !== undefined)
          throw new SqlError(1068, '42000', 'Multiple primary key defined')
        this.#checkParts(constraint.parts)
        // Columns of primary keys are NOT NULL.
        this.columns = this.columns.map((column) =>
          constraint.parts.some((part) => sameName(part.column, column.name))
            ? { ...column, nullable: false }
            : column,
        )
        this.indexes.unshift({ name: 'PRIMARY', kind: 'PRIMARY', parts: constraint.parts })
        return
      }
      case 'UNIQUE':
      case 'INDEX':
      case 'FULLTEXT':
      case 'SPATIAL': {
        this.#checkParts(constraint.parts)
        const name = constraint.name ?? this.#indexName(constraint.parts[0]!.column)
        if (this.index(name) !== undefined) {
          if (ifNotExists) return
          throw new SqlError(1061, '42000', `Duplicate key name '${name}'`)
        }
        if (constraint.kind !== 'UNIQUE' && constraint.kind !== 'FULLTEXT') {
          for (const part of constraint.parts) {
            const column = this.column(part.column)!
            if (part.length === undefined && /TEXT|BLOB|JSON/.test(column.type.name)) {
              throw new SqlError(
                1170,
                '42000',
                `BLOB/TEXT column '${column.name}' used in key specification without a key length`,
              )
            }
          }
        }
        this.indexes.push({ name, kind: constraint.kind, parts: constraint.parts })
        return
      }
      case 'FOREIGN': {
        const name = constraint.name ?? `${this.name}_ibfk_${this.#foreignKeyNumber++}`
        if (this.foreignKeys.some((key) => sameName(key.name, name))) {
          if (ifNotExists) return
          throw new SqlError(1826, 'HY000', `Duplicate FOREIGN KEY constraint name '${name}'`)
        }
        for (const column of constraint.columns) {
          if (this.column(column) === undefined)
            throw new SqlError(1072, '42000', `Key column '${column}' doesn't exist in table`)
        }
        const referenced = tableKey(constraint.references.table.name)
        if (this.#context.foreignKeyChecks) {
          const parent = sameName(referenced, this.name)
            ? this.#schema()
            : this.#context.table(referenced)
          const formed =
            parent !== undefined &&
            constraint.references.columns.length === constraint.columns.length &&
            constraint.references.columns.every((column) =>
              parent.columns.some((existing) => sameName(existing.name, column)),
            ) &&
            parent.indexes.some((index) =>
              constraint.references.columns.every(
                (column, i) =>
                  index.parts[i] !== undefined && sameName(index.parts[i]!.column, column),
              ),
            )
          if (!formed) {
            throw new SqlError(
              1005,
              'HY000',
              `Can't create table \`${this.#context.schema}\`.\`${this.name}\` (errno: 150 "Foreign key constraint is incorrectly formed")`,
            )
          }
        }
        // MariaDB indexes the columns of a foreign key unless a key starts with them.
        const indexed = this.indexes.some((index) =>
          constraint.columns.every(
            (column, i) => index.parts[i] !== undefined && sameName(index.parts[i]!.column, column),
          ),
        )
        if (!indexed) {
          const indexName =
            constraint.name !== undefined && this.index(constraint.name) === undefined
              ? constraint.name
              : this.#indexName(constraint.columns[0]!)
          this.indexes.push({
            name: indexName,
            kind: 'INDEX',
            parts: constraint.columns.map((column) => ({ column, descending: false })),
          })
        }
        this.foreignKeys.push({
          name,
          columns: constraint.columns,
          table: referenced,
          referenced: constraint.references.columns,
          onDelete: constraint.references.onDelete ?? 'RESTRICT',
          onUpdate: constraint.references.onUpdate ?? 'RESTRICT',
        })
        return
      }
      case 'CHECK': {
        const name = constraint.name ?? `CONSTRAINT_${this.#checkNumber++}`
        if (this.checks.some((check) => sameName(check.name, name))) {
          throw new SqlError(1826, 'HY000', `Duplicate CHECK constraint name '${name}'`)
        }
        this.checks.push({
          name,
          expr: constraint.expr,
          sql: sql.slice(constraint.expr.start, constraint.expr.end),
        })
      }
    }
  }

  #checkParts(parts: readonly KeyPart[]): void {
    for (const part of parts) {
      if (this.column(part.column) === undefined) {
        throw new SqlError(1072, '42000', `Key column '${part.column}' doesn't exist in table`)
      }
    }
  }

  /** Checks that the table has at most one AUTO_INCREMENT column, and that a key starts with it. */
  checkAutoIncrement(): void {
    const auto = this.columns.filter((column) => column.autoIncrement)
    const keyed = auto.every((column) =>
      this.indexes.some((index) => sameName(index.parts[0]!.column, column.name)),
    )
    if (auto.length > 1 || !keyed) {
      throw new SqlError(
        1075,
        '42000',
        'Incorrect table definition; there can be only one auto column and it must be defined as a key',
      )
    }
  }

  #schema(): TableSchema {
    return {
      name: this.name,
      columns: this.columns,
      indexes: this.indexes,
      foreignKeys: this.foreignKeys,
      checks: this.checks,
      engine: this.engine,
      charset: this.charset,
      collation: this.collation,
      comment: this.comment,
      autoIncrement: this.autoIncrement,
      temporary: this.temporary,
    }
  }

  build(): TableSchema {
    this.checkAutoIncrement()
    // MariaDB orders keys: the primary key, unique keys of NOT NULL columns, other unique keys, then the rest.
    const rank = (index: IndexSchema): number => {
      if (index.kind === 'PRIMARY') return 0
      if (index.kind === 'UNIQUE') {
        return index.parts.every((part) => this.column(part.column)?.nullable === false) ? 1 : 2
      }
      return index.kind === 'INDEX' ? 3 : 4
    }
    this.indexes = this.indexes
      .map((index, order) => ({ index, order }))
      .sort((a, b) => rank(a.index) - rank(b.index) || a.order - b.order)
      .map(({ index }) => index)
    return this.#schema()
  }
}

/** The options of a table that set its character set and collation. */
function tableCollationOf(options: { charset?: string; collation?: string }): {
  charset: string
  collation: string
} {
  if (options.collation !== undefined) {
    const collation = options.collation.toLowerCase()
    return { charset: charsetOf(collation), collation }
  }
  if (options.charset !== undefined) {
    const charset =
      options.charset.toLowerCase() === 'utf8' ? 'utf8mb3' : options.charset.toLowerCase()
    return { charset, collation: DEFAULT_COLLATIONS[charset] ?? `${charset}_general_ci` }
  }
  return { charset: DEFAULT_CHARSET, collation: DEFAULT_COLLATION }
}

/**
 * Builds the table that CREATE TABLE defines, as MariaDB does: with
 * columns' keys as keys of the table, names for keys, foreign keys and
 * checks that have none, and MariaDB's errors for what it rejects.
 */
export function buildTable(create: CreateTable, sql: string, context: SchemaContext): TableSchema {
  const name = tableKey(create.table.name)
  const builder = new TableBuilder(name, context)
  const { charset, collation } = tableCollationOf(create.options)
  builder.charset = charset
  builder.collation = collation
  builder.engine = create.options.engine ?? 'InnoDB'
  builder.comment = create.options.comment ?? ''
  builder.autoIncrement = Math.max(1, create.options.autoIncrement ?? 1)
  builder.temporary = create.temporary
  const columnKeys: TableConstraint[] = []
  for (const definition of create.columns) {
    builder.addColumn(buildColumn(definition, sql, collation, context, name))
    if (definition.key !== undefined) {
      columnKeys.push({
        kind: definition.key,
        parts: [{ column: definition.name, descending: false }],
      })
    }
    if (definition.check !== undefined) {
      columnKeys.push({ kind: 'CHECK', name: definition.name, expr: definition.check })
    }
    if (definition.references !== undefined) {
      columnKeys.push({
        kind: 'FOREIGN',
        columns: [definition.name],
        references: definition.references,
      })
    }
  }
  // MariaDB adds the keys of columns after those of the table, but the primary key goes first.
  for (const constraint of [
    ...create.constraints.filter((c) => c.kind === 'PRIMARY'),
    ...columnKeys.filter((c) => c.kind === 'PRIMARY'),
  ]) {
    builder.addConstraint(constraint, sql)
  }
  for (const constraint of [
    ...columnKeys.filter((c) => c.kind !== 'PRIMARY'),
    ...create.constraints.filter((c) => c.kind !== 'PRIMARY'),
  ]) {
    builder.addConstraint(constraint, sql)
  }
  return builder.build()
}

/** A table like another, as CREATE TABLE ... LIKE copies it: its columns and keys, but not its foreign keys. */
export function copyTable(table: TableSchema, name: string, temporary: boolean): TableSchema {
  return { ...table, name: tableKey(name), foreignKeys: [], autoIncrement: 1, temporary }
}

/**
 * The table that ALTER TABLE makes of one, as MariaDB alters it, action by
 * action, with its errors for actions it rejects. Renames of the table
 * itself are left to the caller.
 */
export function alterTableSchema(
  table: TableSchema,
  actions: readonly AlterAction[],
  sql: string,
  context: SchemaContext,
): TableSchema {
  const builder = TableBuilder.of(table, context)
  const missing = (kind: string, name: string) =>
    new SqlError(1091, '42000', `Can't DROP ${kind} \`${name}\`; check that it exists`)
  for (const action of actions) {
    switch (action.kind) {
      case 'addColumn': {
        if (action.ifNotExists && builder.column(action.column.name) !== undefined) break
        const column = buildColumn(action.column, sql, builder.collation, context, builder.name)
        builder.addColumn(column, action.position)
        if (action.column.key !== undefined) {
          builder.addConstraint(
            { kind: action.column.key, parts: [{ column: column.name, descending: false }] },
            sql,
          )
        }
        break
      }
      case 'addConstraint':
        builder.addConstraint(action.constraint, sql, action.ifNotExists)
        break
      case 'changeColumn': {
        const existing = builder.column(action.name)
        if (existing === undefined) {
          if (action.ifExists) break
          throw new SqlError(1054, '42S22', `Unknown column '${action.name}' in '${builder.name}'`)
        }
        const column = buildColumn(action.column, sql, builder.collation, context, builder.name)
        const index = builder.columns.indexOf(existing)
        if (!sameName(existing.name, column.name) && builder.column(column.name) !== undefined) {
          throw new SqlError(1060, '42S21', `Duplicate column name '${column.name}'`)
        }
        const inPrimary =
          builder.index('PRIMARY')?.parts.some((part) => sameName(part.column, existing.name)) ===
          true
        const changed = inPrimary ? { ...column, nullable: false } : column
        builder.columns.splice(index, 1)
        if (action.position === undefined) builder.columns.splice(index, 0, changed)
        else builder.addColumn(changed, action.position)
        if (!sameName(existing.name, column.name))
          renameColumnReferences(builder, existing.name, column.name)
        if (action.column.key !== undefined) {
          builder.addConstraint(
            { kind: action.column.key, parts: [{ column: column.name, descending: false }] },
            sql,
          )
        }
        break
      }
      case 'alterDefault': {
        const existing = builder.column(action.name)
        if (existing === undefined)
          throw new SqlError(1054, '42S22', `Unknown column '${action.name}' in '${builder.name}'`)
        const definition: ColumnDefinition = {
          name: existing.name,
          type: existing.type,
          nullable: existing.nullable,
          autoIncrement: existing.autoIncrement,
          comment: existing.comment,
          ...(action.default === undefined ? {} : { default: action.default }),
        }
        const rebuilt = buildColumn(definition, sql, builder.collation, context, builder.name)
        builder.columns[builder.columns.indexOf(existing)] = {
          ...rebuilt,
          collation: existing.collation,
          onUpdateNow: existing.onUpdateNow,
        }
        break
      }
      case 'dropColumn': {
        const existing = builder.column(action.name)
        if (existing === undefined) {
          if (action.ifExists) break
          throw missing('COLUMN', action.name)
        }
        if (builder.columns.length === 1) {
          throw new SqlError(
            1090,
            '42000',
            "You can't delete all columns with ALTER TABLE; use DROP TABLE instead",
          )
        }
        builder.columns = builder.columns.filter((column) => column !== existing)
        // Keys lose the column, and go with their last.
        builder.indexes = builder.indexes
          .map((index) => ({
            ...index,
            parts: index.parts.filter((part) => !sameName(part.column, existing.name)),
          }))
          .filter((index) => index.parts.length > 0)
        builder.foreignKeys = builder.foreignKeys.filter(
          (key) => !key.columns.some((column) => sameName(column, existing.name)),
        )
        break
      }
      case 'dropPrimaryKey':
        if (builder.index('PRIMARY') === undefined) throw missing('INDEX', 'PRIMARY')
        builder.indexes = builder.indexes.filter((index) => index.kind !== 'PRIMARY')
        break
      case 'dropIndex': {
        const existing = builder.index(action.name)
        if (existing === undefined) {
          if (action.ifExists) break
          throw missing('INDEX', action.name)
        }
        builder.indexes = builder.indexes.filter((index) => index !== existing)
        break
      }
      case 'dropForeignKey': {
        const existing = builder.foreignKeys.find((key) => sameName(key.name, action.name))
        if (existing === undefined) {
          if (action.ifExists) break
          throw missing('FOREIGN KEY', action.name)
        }
        builder.foreignKeys = builder.foreignKeys.filter((key) => key !== existing)
        break
      }
      case 'dropConstraint': {
        const check = builder.checks.find((existing) => sameName(existing.name, action.name))
        const key = builder.foreignKeys.find((existing) => sameName(existing.name, action.name))
        const index = builder.index(action.name)
        if (check !== undefined)
          builder.checks = builder.checks.filter((existing) => existing !== check)
        else if (key !== undefined)
          builder.foreignKeys = builder.foreignKeys.filter((existing) => existing !== key)
        else if (index !== undefined && index.kind === 'UNIQUE')
          builder.indexes = builder.indexes.filter((existing) => existing !== index)
        else if (!action.ifExists) throw missing('CONSTRAINT', action.name)
        break
      }
      case 'renameColumn': {
        const existing = builder.column(action.from)
        if (existing === undefined)
          throw new SqlError(1054, '42S22', `Unknown column '${action.from}' in '${builder.name}'`)
        if (!sameName(action.from, action.to) && builder.column(action.to) !== undefined) {
          throw new SqlError(1060, '42S21', `Duplicate column name '${action.to}'`)
        }
        builder.columns[builder.columns.indexOf(existing)] = { ...existing, name: action.to }
        renameColumnReferences(builder, action.from, action.to)
        break
      }
      case 'renameIndex': {
        const existing = builder.index(action.from)
        if (existing === undefined)
          throw new SqlError(
            1176,
            '42000',
            `Key '${action.from}' doesn't exist in table '${builder.name}'`,
          )
        if (builder.index(action.to) !== undefined)
          throw new SqlError(1061, '42000', `Duplicate key name '${action.to}'`)
        builder.indexes[builder.indexes.indexOf(existing)] = { ...existing, name: action.to }
        break
      }
      case 'options': {
        const { options } = action
        if (options.engine !== undefined) builder.engine = options.engine
        if (options.comment !== undefined) builder.comment = options.comment
        if (options.autoIncrement !== undefined)
          builder.autoIncrement = Math.max(1, options.autoIncrement)
        if (options.charset !== undefined || options.collation !== undefined) {
          const { charset, collation } = tableCollationOf(options)
          builder.charset = charset
          builder.collation = collation
        }
        break
      }
      case 'renameTable':
      case 'none':
        break
    }
  }
  return builder.build()
}

/** Points the keys of a table at a column's new name. */
function renameColumnReferences(builder: TableBuilder, from: string, to: string): void {
  builder.indexes = builder.indexes.map((index) => ({
    ...index,
    parts: index.parts.map((part) =>
      sameName(part.column, from) ? { ...part, column: to } : part,
    ),
  }))
  builder.foreignKeys = builder.foreignKeys.map((key) => ({
    ...key,
    columns: key.columns.map((column) => (sameName(column, from) ? to : column)),
  }))
}

/** The name of a table as SQL writes it in backticks. */
function quoteName(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``
}

/** A column's type as SHOW COLUMNS and information_schema write it, such as int(11) unsigned. */
function typeText(type: DataType): string {
  const name = type.name === 'JSON' ? 'longtext' : type.name.toLowerCase()
  let text = name
  if (type.values !== undefined) {
    text += `(${type.values.map((value) => `'${value.replace(/'/g, "''")}'`).join(',')})`
  } else if (
    type.length !== undefined &&
    !['DATE', 'YEAR'].includes(type.name) &&
    !(type.name.endsWith('TEXT') || type.name.endsWith('BLOB'))
  ) {
    if (['TIME', 'DATETIME', 'TIMESTAMP'].includes(type.name)) {
      if (type.length > 0) text += `(${type.length})`
    } else {
      text += type.scale !== undefined ? `(${type.length},${type.scale})` : `(${type.length})`
    }
  } else if (type.name === 'YEAR') {
    text += '(4)'
  }
  if (type.unsigned === true) text += ' unsigned'
  if (type.zerofill === true) text += ' zerofill'
  return text
}

/** A default as SHOW CREATE TABLE writes it. */
function defaultText(column: ColumnSchema): string | undefined {
  const value = column.default
  if (value === undefined) return column.nullable && !column.autoIncrement ? 'NULL' : undefined
  if (value.kind === 'now')
    return value.fsp > 0 ? `current_timestamp(${value.fsp})` : 'current_timestamp()'
  if (value.kind === 'expression') return value.sql
  if (value.value === null) return 'NULL'
  if (
    column.type.name === 'BIT' &&
    (typeof value.value === 'number' || typeof value.value === 'bigint')
  ) {
    return `b'${BigInt(value.value).toString(2)}'`
  }
  if (typeof value.value === 'number' || typeof value.value === 'bigint') {
    return /INT|DECIMAL|FLOAT|DOUBLE|YEAR|BIT/.test(column.type.name)
      ? String(value.value)
      : `'${value.value}'`
  }
  if (value.value instanceof Uint8Array) return `'${textOf(value.value)}'`
  return `'${value.value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
}

/** A column's definition as SHOW CREATE TABLE writes it. */
function columnText(column: ColumnSchema, table: TableSchema): string {
  let text = `${quoteName(column.name)} ${typeText(column.type)}`
  const charsetDiffers =
    column.collation !== 'binary' &&
    column.collation !== table.collation &&
    column.type.name !== 'JSON'
  if (charsetDiffers) {
    text +=
      charsetOf(column.collation) !== table.charset
        ? ` CHARACTER SET ${charsetOf(column.collation)} COLLATE ${column.collation}`
        : ` COLLATE ${column.collation}`
  }
  if (column.type.name === 'JSON') text += ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'
  if (!column.nullable) text += ' NOT NULL'
  else if (column.type.name === 'TIMESTAMP') text += ' NULL'
  const shown = defaultText(column)
  if (shown !== undefined) text += ` DEFAULT ${shown}`
  if (column.onUpdateNow) {
    const fsp = column.type.length ?? 0
    text += fsp > 0 ? ` ON UPDATE current_timestamp(${fsp})` : ' ON UPDATE current_timestamp()'
  }
  if (column.autoIncrement) text += ' AUTO_INCREMENT'
  if (column.comment !== '') text += ` COMMENT '${column.comment.replace(/'/g, "''")}'`
  if (column.type.name === 'JSON') text += ` CHECK (json_valid(${quoteName(column.name)}))`
  return text
}

function partsText(parts: readonly KeyPart[]): string {
  return parts
    .map(
      (part) =>
        `${quoteName(part.column)}${part.length === undefined ? '' : `(${part.length})`}${part.descending ? ' DESC' : ''}`,
    )
    .join(',')
}

/** The statement that creates a table, as SHOW CREATE TABLE writes it. */
export function showCreateTable(table: TableSchema): string {
  const lines = table.columns.map((column) => `  ${columnText(column, table)}`)
  for (const index of table.indexes) {
    const parts = partsText(index.parts)
    if (index.kind === 'PRIMARY') lines.push(`  PRIMARY KEY (${parts})`)
    else if (index.kind === 'UNIQUE') lines.push(`  UNIQUE KEY ${quoteName(index.name)} (${parts})`)
    else if (index.kind === 'INDEX') lines.push(`  KEY ${quoteName(index.name)} (${parts})`)
    else lines.push(`  ${index.kind} KEY ${quoteName(index.name)} (${parts})`)
  }
  for (const key of table.foreignKeys) {
    let text = `  CONSTRAINT ${quoteName(key.name)} FOREIGN KEY (${key.columns.map(quoteName).join(', ')}) REFERENCES ${quoteName(key.table)} (${key.referenced.map(quoteName).join(', ')})`
    if (key.onDelete !== 'RESTRICT') text += ` ON DELETE ${key.onDelete}`
    if (key.onUpdate !== 'RESTRICT') text += ` ON UPDATE ${key.onUpdate}`
    lines.push(text)
  }
  for (const check of table.checks)
    lines.push(`  CONSTRAINT ${quoteName(check.name)} CHECK (${check.sql})`)
  let options = `ENGINE=${table.engine}`
  if (table.columns.some((column) => column.autoIncrement))
    options += ` AUTO_INCREMENT=${table.autoIncrement}`
  options += ` DEFAULT CHARSET=${table.charset} COLLATE=${table.collation}`
  if (table.comment !== '') options += ` COMMENT='${table.comment.replace(/'/g, "''")}'`
  return `CREATE ${table.temporary ? 'TEMPORARY ' : ''}TABLE ${quoteName(table.name)} (\n${lines.join(',\n')}\n) ${options}`
}

/** The SQLite name of an index of a table. */
function sqliteIndexName(table: string, index: string): string {
  return `${table}.${index.toLowerCase()}`
}

/** A name in double quotes, as SQLite takes names. */
export function sqliteName(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** The affinity SQLite stores a column's values with. */
function sqliteAffinity(type: DataType): string {
  if (INTEGER_TYPES.has(type.name) || type.name === 'BIT' || type.name === 'YEAR') return 'INTEGER'
  if (type.name === 'DECIMAL') return 'NUMERIC'
  if (type.name === 'FLOAT' || type.name === 'DOUBLE') return 'REAL'
  if (BINARY_TYPES.has(type.name)) return 'BLOB'
  return 'TEXT'
}

/** The SQLite collation of a column: FiveRunner's of _ci collations, or SQLite's binary one. */
function sqliteCollation(column: ColumnSchema): string {
  return isCaseInsensitive(column.collation) ? 'fr_ci' : 'BINARY'
}

/**
 * The SQLite statement that creates a table, as `name`: its columns with
 * their affinities and collations, its primary key, its checks, and the
 * foreign keys that `foreignKeys` keeps. `checkSql` compiles the
 * expressions of checks, for the table's columns.
 */
export function sqliteCreateTable(
  table: TableSchema,
  checkSql: (check: CheckSchema) => string,
  foreignKeys: (key: ForeignKeySchema) => boolean,
  name = table.name,
): string {
  const definitions = table.columns.map((column) => {
    let text = `${sqliteName(column.name)} ${sqliteAffinity(column.type)}`
    if (!column.nullable) text += ' NOT NULL'
    if (sqliteAffinity(column.type) === 'TEXT') text += ` COLLATE ${sqliteCollation(column)}`
    return text
  })
  const primary = table.indexes.find((index) => index.kind === 'PRIMARY')
  if (primary !== undefined) {
    definitions.push(
      `PRIMARY KEY (${primary.parts.map((part) => sqliteName(part.column)).join(', ')})`,
    )
  }
  for (const key of table.foreignKeys) {
    if (!foreignKeys(key)) continue
    const action = (what: ReferenceAction) => (what === 'NO ACTION' ? 'RESTRICT' : what)
    definitions.push(
      `CONSTRAINT ${sqliteName(key.name)} FOREIGN KEY (${key.columns.map(sqliteName).join(', ')}) REFERENCES ${sqliteName(key.table)} (${key.referenced.map(sqliteName).join(', ')}) ON DELETE ${action(key.onDelete)} ON UPDATE ${action(key.onUpdate)}`,
    )
  }
  for (const check of table.checks)
    definitions.push(`CONSTRAINT ${sqliteName(check.name)} CHECK (${checkSql(check)})`)
  return `CREATE TABLE ${sqliteName(name)} (\n  ${definitions.join(',\n  ')}\n)`
}

/** The SQLite statement that creates an index of a key of a table, which unique keys of prefixes of columns index by the prefixes. */
export function sqliteCreateIndex(table: TableSchema, index: IndexSchema): string {
  const unique = index.kind === 'UNIQUE'
  const parts = index.parts.map((part) => {
    const column = table.columns.find((existing) => sameName(existing.name, part.column))!
    const expression =
      unique && part.length !== undefined
        ? `substr(${sqliteName(column.name)}, 1, ${part.length})`
        : sqliteName(column.name)
    const collation =
      sqliteAffinity(column.type) === 'TEXT' ? ` COLLATE ${sqliteCollation(column)}` : ''
    return `${expression}${collation}${part.descending ? ' DESC' : ''}`
  })
  return `CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${sqliteName(sqliteIndexName(table.name, index.name))} ON ${sqliteName(table.name)} (${parts.join(', ')})`
}
