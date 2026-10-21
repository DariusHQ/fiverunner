import type {
  BinaryOperator,
  Expression,
  OrderItem,
  QueryBody,
  Select,
  SelectCore,
  SelectItem,
  TableName,
  TableRef,
} from './ast.ts'
import { compileCall } from './calls.ts'
import { SqlError } from './lexer.ts'
import { unsupported } from './parser.ts'
import {
  columnType,
  isCaseInsensitive,
  sameName,
  sqliteName,
  tableKey,
  type ColumnSchema,
  type TableSchema,
} from './schema.ts'
import type { SqlValue } from './sqlite.ts'
import {
  aggregateType,
  arithmeticType,
  BIGINT_TYPE,
  BOOLEAN_RESULT,
  comparesWithoutCase,
  DATE_TYPE,
  datetimeType,
  decimalType,
  divisionType,
  DOUBLE_TYPE,
  integerType,
  isDateType,
  isNumeric,
  isString,
  isTemporal,
  NULL_TYPE,
  numericOf,
  stringType,
  timeType,
  type Type,
} from './types.ts'
import { bytesOfText } from './values.ts'

/** A view, by the query that defines it. */
export interface ViewSchema {
  readonly name: string
  readonly columns?: readonly string[]
  readonly select: Select
  /** The SQL of the query. */
  readonly sql: string
}

/** What the compiler reads of the database: its name, and its tables and views. */
export interface Catalog {
  readonly schema: string
  table(name: string): TableSchema | undefined
  view(name: string): ViewSchema | undefined
  tables(): readonly TableSchema[]
  views(): readonly ViewSchema[]
  /** The number of rows of a table, which information_schema.TABLES gives. */
  rowCount?(table: string): number
}

/** A column of a result, as MariaDB describes them to clients. */
export interface Field {
  readonly name: string
  readonly table: string
  readonly orgTable: string
  readonly orgName: string
  readonly type: Type
}

/** A query compiled for SQLite: its SQL, the values of its parameters, and the columns of its rows. */
export interface CompiledQuery {
  readonly sql: string
  readonly params: SqlValue[]
  readonly fields: Field[]
}

/** An expression compiled for SQLite, with its type in MariaDB. */
export interface Compiled {
  readonly sql: string
  readonly type: Type
  /** Whether the value is JSON, as values of JSON columns and of JSON's functions are, which they nest as JSON. */
  readonly json?: boolean
  /** The column the expression is, which SQLite compares by its collation. */
  readonly column?: SourceColumn
  /** Whether the expression aggregates rows, as COUNT does. */
  readonly aggregate?: boolean
  /** The value of a literal. */
  readonly constant?: SqlValue
  /** The bytes of a hexadecimal or bit literal, which are numbers where numbers are taken. */
  readonly literalBytes?: Uint8Array
}

/** A column of a table that a query reads. */
export interface SourceColumn {
  readonly name: string
  readonly type: Type
  /** How SQLite refers to it, as "alias"."column". */
  readonly sql: string
  readonly json: boolean
  readonly orgTable: string
  readonly orgName: string
  readonly schema?: ColumnSchema
}

/** A table that a query reads: a table, a view, a derived table or a common table expression. */
export interface Source {
  /** The name queries qualify its columns with: its alias, or its name. */
  readonly alias: string
  readonly orgTable: string
  readonly columns: readonly SourceColumn[]
  readonly table?: TableSchema
}

/** The clauses MariaDB names in errors about columns. */
export type Clause =
  | 'field list'
  | 'where clause'
  | 'on clause'
  | 'group statement'
  | 'having clause'
  | 'order clause'
  | 'IN/ALL/ANY subquery'
  | 'CHECK'

/** What names in an expression may refer to. */
export class Scope {
  readonly sources: Source[]
  readonly parent: Scope | undefined
  /** Columns that USING and NATURAL joins merged, which their names without tables refer to. */
  readonly merged = new Map<string, SourceColumn>()
  /** The columns of both sides that USING and NATURAL joins merged. */
  readonly joined = new Set<SourceColumn>()
  /** The expressions of the items of a SELECT, by their names, for ORDER BY, GROUP BY and HAVING. */
  aliases: readonly {
    readonly name: string
    readonly compiled: Compiled
    readonly position: number
  }[] = []
  /** Columns whose values an UPDATE already assigned, which later assignments read as assigned. */
  readonly assigned = new Map<string, Compiled>()
  /** The values of VALUES(column) in ON DUPLICATE KEY UPDATE, by column. */
  values: ReadonlyMap<string, Compiled> | undefined
  /** Whether aggregates are allowed, which they are not in WHERE and ON. */
  aggregates = true
  /** The table that INSERT inserts into, whose columns DEFAULT(column) reads the defaults of. */
  table: TableSchema | undefined

  constructor(sources: Source[] = [], parent?: Scope) {
    this.sources = sources
    this.parent = parent
  }
}

/** What the compiler reads of the session. */
export interface CompileSession {
  userVariable(name: string): SqlValue
  systemVariable(name: string): SqlValue | undefined
}

/** How names in ORDER BY, GROUP BY and HAVING find the items of the SELECT: before columns, after them, or not. */
type AliasMode = 'first' | 'after' | 'none'

/** The most characters of the names MariaDB gives columns of expressions. */
const MAX_NAME = 256

/** SQLite's text of a literal number. */
function numberSql(text: string): string {
  return text.startsWith('.') ? `0${text}` : text
}

/** A value as SQLite's SQL writes it. */
function sqliteLiteral(value: SqlValue): string {
  if (value === null) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Uint8Array)
    return `X'${[...value].map((byte) => byte.toString(16).padStart(2, '0')).join('')}'`
  return `'${value.replace(/'/g, "''")}'`
}

/** A string of bytes, of hexadecimal digits. */
function bytesOfHex(digits: string): Uint8Array {
  return Uint8Array.from(digits.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))
}

/** The integer of the bytes of a literal, big-endian, as hexadecimal literals are where numbers are taken. */
function integerOfBytes(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return value
}

/** The type of a value bound as a parameter, as mysql2 sends them to execute. */
function parameterType(value: SqlValue): Type {
  if (value === null) return NULL_TYPE
  if (typeof value === 'bigint') return BIGINT_TYPE
  if (typeof value === 'number') return Number.isInteger(value) ? BIGINT_TYPE : DOUBLE_TYPE
  if (value instanceof Uint8Array)
    return { field: 'BLOB', length: value.length, decimals: 0, binary: true }
  return stringType([...value].length)
}

/** The type of a variable's value, as MariaDB keeps those of users: integers, doubles, decimals or strings. */
function valueType(value: SqlValue): Type {
  if (value === null) return { ...stringType(0, true), field: 'BLOB' }
  if (typeof value === 'number' && !Number.isInteger(value)) return DOUBLE_TYPE
  if (typeof value === 'number' || typeof value === 'bigint') return BIGINT_TYPE
  if (value instanceof Uint8Array)
    return { field: 'BLOB', length: value.length, decimals: 0, binary: true }
  return { field: 'BLOB', length: value.length, decimals: 0 }
}

/**
 * Compiles MySQL's SQL, as trees, to SQLite's, with the types MariaDB gives
 * its values. Names resolve as MariaDB resolves them, with its errors.
 * Strings and bytes are parameters, which `params` collects.
 */
export class Compiler {
  readonly catalog: Catalog
  /** The SQL the trees were read from, whose text names columns of expressions. */
  readonly sql: string
  readonly session: CompileSession
  /** The values of the ? of the statement, given to execute, or undefined when they were written into it. */
  readonly bound: readonly SqlValue[] | undefined
  readonly params: SqlValue[] = []
  /** Common table expressions, by name, from the innermost WITH. */
  #commonTables: Map<string, Source>[] = []
  /** Whether division by zero fails, as it does in INSERT and UPDATE with MariaDB's default sql_mode. */
  strictDivision = false
  #aliasCount = 0

  constructor(catalog: Catalog, sql: string, session: CompileSession, bound?: readonly SqlValue[]) {
    this.catalog = catalog
    this.sql = sql
    this.session = session
    this.bound = bound
  }

  /**
   * Whether values are written into the SQL rather than bound, as the SQL
   * of tables that SQLite keeps, such as their checks, needs them.
   */
  inline = false

  /** Binds a value as a parameter, and returns the SQL that refers to it, or writes it as SQLite's literal when inline. */
  bind(value: SqlValue): string {
    if (this.inline) return sqliteLiteral(value)
    this.params.push(value)
    return `?${this.params.length}`
  }

  /** A name for SQLite that no name of a query has. */
  uniqueAlias(prefix: string): string {
    return `fr_${prefix}_${++this.#aliasCount}`
  }

  // Queries

  /** Compiles a query, with the columns of its rows. */
  query(select: Select, scope?: Scope): CompiledQuery {
    const { sql, fields } = this.select(select, scope)
    return { sql, params: this.params, fields }
  }

  select(select: Select, parent?: Scope): { sql: string; fields: Field[]; columns: Compiled[] } {
    let withSql = ''
    if (select.with !== undefined) {
      const tables = new Map<string, Source>()
      this.#commonTables.unshift(tables)
      const parts: string[] = []
      for (const table of select.with.tables) {
        const name = tableKey(table.name)
        if (tables.has(name))
          throw new SqlError(1066, '42000', `Not unique table/alias: '${table.name}'`)
        let compiled: { sql: string; fields: Field[] }
        if (select.with.recursive && selectReferences(table.select, name)) {
          // A recursive table's columns are those of its first SELECT, which does not refer to it.
          const anchor = firstSelect(table.select)
          // A compiler of its own types the first SELECT, whose parameters the query does not take.
          const typing = new Compiler(this.catalog, this.sql, this.session, this.bound)
          typing.#commonTables = this.#commonTables
          const anchorFields = typing.select(
            { kind: 'select', body: anchor, locking: false, start: anchor.start, end: anchor.end },
            parent,
          ).fields
          tables.set(name, this.#cteSource(table.name, table.columns, anchorFields))
          compiled = this.select(table.select, parent)
        } else {
          compiled = this.select(table.select, parent)
        }
        const source = this.#cteSource(table.name, table.columns, compiled.fields)
        tables.set(name, source)
        const columnList = source.columns.map((column) => sqliteName(column.name)).join(', ')
        parts.push(`${sqliteName(name)}(${columnList}) AS (${compiled.sql})`)
      }
      withSql = `WITH ${select.with.recursive ? 'RECURSIVE ' : ''}${parts.join(', ')} `
    }
    try {
      const body = this.#body(select.body, parent, select)
      return { sql: withSql + body.sql, fields: body.fields, columns: body.columns }
    } finally {
      if (select.with !== undefined) this.#commonTables.shift()
    }
  }

  #cteSource(
    name: string,
    columns: readonly string[] | undefined,
    fields: readonly Field[],
  ): Source {
    if (columns !== undefined && columns.length !== fields.length) {
      throw new SqlError(
        1353,
        'HY000',
        `View's SELECT and view's field list have different column counts`,
      )
    }
    const alias = tableKey(name)
    return {
      alias,
      orgTable: alias,
      columns: fields.map((field, i) => {
        const columnName = columns?.[i] ?? field.name
        return {
          name: columnName,
          type: field.type,
          sql: `${sqliteName(alias)}.${sqliteName(columnName)}`,
          json: false,
          orgTable: alias,
          orgName: columnName,
        }
      }),
    }
  }

  /** Compiles the body of a query with its ORDER BY and LIMIT, which apply to set operations as a whole. */
  #body(
    body: QueryBody,
    parent: Scope | undefined,
    select: Select,
  ): { sql: string; fields: Field[]; columns: Compiled[] } {
    if (body.kind === 'core') return this.#core(body, parent, select.orderBy, select.limit)
    const compiled = this.#setOperation(body, parent)
    let sql = compiled.sql
    if (select.orderBy !== undefined) {
      // ORDER BY of set operations takes the columns of the result, by name or position.
      const scope = new Scope([], parent)
      scope.aliases = compiled.fields.map((field, i) => ({
        name: field.name,
        compiled: { sql: String(i + 1), type: field.type },
        position: i + 1,
      }))
      const terms = select.orderBy.map((item) => {
        const position = this.#position(item.expr, compiled.fields.length, 'order clause')
        if (position !== undefined) return `${position}${item.descending ? ' DESC' : ''}`
        if (item.expr.kind === 'column' && item.expr.table === undefined) {
          const index = compiled.fields.findIndex((field) =>
            sameName(field.name, item.expr.kind === 'column' ? item.expr.name : ''),
          )
          if (index !== -1) return `${index + 1}${item.descending ? ' DESC' : ''}`
        }
        throw new SqlError(
          1054,
          '42S22',
          `Unknown column '${this.#text(item.expr)}' in 'order clause'`,
        )
      })
      sql += ` ORDER BY ${terms.join(', ')}`
    }
    sql += this.#limitSql(select.limit, parent)
    return { sql, fields: compiled.fields, columns: compiled.columns }
  }

  #setOperation(
    body: QueryBody,
    parent: Scope | undefined,
  ): { sql: string; fields: Field[]; columns: Compiled[] } {
    if (body.kind === 'core') return this.#core(body, parent, undefined, undefined)
    if (body.kind === 'parens') {
      const inner = this.select(body.select, parent)
      // SQLite takes no parentheses around the parts of compound queries, but takes subqueries.
      return { sql: `SELECT * FROM (${inner.sql})`, fields: inner.fields, columns: inner.columns }
    }
    const left = this.#setOperation(body.left, parent)
    const right = this.#setOperation(body.right, parent)
    if (left.fields.length !== right.fields.length) {
      throw new SqlError(
        1222,
        '21000',
        'The used SELECT statements have a different number of columns',
      )
    }
    const operator =
      body.kind === 'union' ? 'UNION' : body.kind === 'except' ? 'EXCEPT' : 'INTERSECT'
    if (body.all && body.kind !== 'union') throw unsupported(`${operator} ALL`)
    const fields = left.fields.map((field, i) => ({
      ...field,
      type: aggregateType([field.type, right.fields[i]!.type]),
    }))
    const wrap = (part: string) =>
      /^\s*WITH\b/i.test(part) || / ORDER BY | LIMIT /.test(part) ? `SELECT * FROM (${part})` : part
    return {
      sql: `${wrap(left.sql)} ${operator}${body.all ? ' ALL' : ''} ${wrap(right.sql)}`,
      fields,
      columns: fields.map((field) => ({ sql: sqliteName(field.name), type: field.type })),
    }
  }

  /** The position an ORDER BY or GROUP BY item names, as a whole number does, from 1. */
  #position(expr: Expression, count: number, clause: Clause): number | undefined {
    if (expr.kind !== 'number' || !/^\d+$/.test(expr.text)) return undefined
    const position = Number(expr.text)
    if (position < 1 || position > count)
      throw new SqlError(1054, '42S22', `Unknown column '${expr.text}' in '${clause}'`)
    return position
  }

  #limitSql(limit: Select['limit'], scope: Scope | undefined): string {
    if (limit === undefined) return ''
    const value = (expr: Expression) => {
      if (expr.kind === 'number') return expr.text
      const compiled = this.expression(expr, scope ?? new Scope(), 'field list')
      return compiled.sql
    }
    return ` LIMIT ${value(limit.count)}${limit.offset === undefined ? '' : ` OFFSET ${value(limit.offset)}`}`
  }

  #core(
    core: SelectCore,
    parent: Scope | undefined,
    orderBy: readonly OrderItem[] | undefined,
    limit: Select['limit'],
  ): { sql: string; fields: Field[]; columns: Compiled[] } {
    const scope = new Scope([], parent)
    const from = core.from.length === 0 ? '' : this.fromClause(core.from, scope)
    // The items of the SELECT.
    const fields: Field[] = []
    const columns: Compiled[] = []
    const items: string[] = []
    const aliases: { name: string; compiled: Compiled; position: number }[] = []
    for (const item of core.items) {
      if (item.kind === 'star') {
        const expanded = this.#star(item, scope)
        for (const column of expanded) {
          const compiled: Compiled = {
            sql: column.sql,
            type: column.type,
            json: column.json,
            column,
          }
          items.push(`${column.sql} AS ${sqliteName(column.name)}`)
          fields.push({
            name: column.name,
            table: '',
            orgTable: column.orgTable,
            orgName: column.orgName,
            type: column.type,
          })
          columns.push(compiled)
          aliases.push({ name: column.name, compiled, position: columns.length })
        }
        continue
      }
      const compiled = this.expression(item.expr, scope, 'field list')
      if (compiled.type === ROW_TYPE)
        throw new SqlError(1241, '21000', 'Operand should contain 1 column(s)')
      const name = item.alias ?? this.#itemName(item)
      const value =
        core.distinct && comparesWithoutCase(compiled.type) && compiled.column === undefined
          ? `${compiled.sql} COLLATE fr_ci`
          : compiled.sql
      items.push(`${value} AS ${sqliteName(name)}`)
      fields.push({
        name,
        table: '',
        orgTable: compiled.column?.orgTable ?? '',
        orgName: compiled.column?.orgName ?? '',
        type: compiled.type,
      })
      columns.push(compiled)
      aliases.push({ name, compiled, position: columns.length })
    }
    scope.aliases = aliases
    let sql = `SELECT ${core.distinct ? 'DISTINCT ' : ''}${items.join(', ')}`
    if (from !== '') sql += ` FROM ${from}`
    if (core.where !== undefined) {
      scope.aggregates = false
      const where = this.expression(core.where, scope, 'where clause')
      scope.aggregates = true
      sql += ` WHERE ${this.truth(where)}`
    }
    if (core.groupBy !== undefined) {
      if (core.rollup === true) throw unsupported('WITH ROLLUP')
      const terms = core.groupBy.map((item) => {
        const position = this.#position(item.expr, columns.length, 'group statement')
        const compiled =
          position !== undefined
            ? columns[position - 1]!
            : this.expression(item.expr, scope, 'group statement', 'after')
        if (compiled.aggregate === true)
          throw new SqlError(1056, '42000', `Can't group on '${this.#text(item.expr)}'`)
        return comparesWithoutCase(compiled.type) && compiled.column === undefined
          ? `${compiled.sql} COLLATE fr_ci`
          : compiled.sql
      })
      sql += ` GROUP BY ${terms.join(', ')}`
    }
    if (core.having !== undefined) {
      const having = this.expression(core.having, scope, 'having clause', 'after')
      sql += ` HAVING ${this.truth(having)}`
    }
    if (orderBy !== undefined) {
      const terms = orderBy.map((item) => {
        const position = this.#position(item.expr, columns.length, 'order clause')
        if (position !== undefined) return `${position}${item.descending ? ' DESC' : ''}`
        if (item.expr.kind === 'null') return `NULL`
        const compiled = this.expression(item.expr, scope, 'order clause', 'first')
        const collate =
          comparesWithoutCase(compiled.type) &&
          compiled.column === undefined &&
          !/^\d+$/.test(compiled.sql)
            ? ' COLLATE fr_ci'
            : ''
        return `${compiled.sql}${collate}${item.descending ? ' DESC' : ''}`
      })
      sql += ` ORDER BY ${terms.join(', ')}`
    }
    sql += this.#limitSql(limit, parent)
    return { sql, fields, columns }
  }

  /** The name MariaDB gives an item that has no alias: a column's own, a string's value, or the text of the expression. */
  #itemName(item: Extract<SelectItem, { kind: 'expr' }>): string {
    const { expr } = item
    if (
      expr.kind === 'column' &&
      expr.start === item.start &&
      this.sql.slice(expr.start, expr.end).trim() === this.sql.slice(item.start, item.end).trim()
    ) {
      return expr.name
    }
    if (expr.kind === 'string' && !this.sql.slice(item.start, item.end).trim().startsWith('('))
      return expr.text
    return [...this.sql.slice(item.start, item.end).trim()].slice(0, MAX_NAME).join('')
  }

  #text(expr: Expression): string {
    return this.sql.slice(expr.start, expr.end)
  }

  /** The columns * or t.* select: those of USING and NATURAL joins once, first, then the rest in order. */
  #star(item: Extract<SelectItem, { kind: 'star' }>, scope: Scope): SourceColumn[] {
    if (item.table !== undefined) {
      const source = scope.sources.find((candidate) => sameName(candidate.alias, item.table!.name))
      if (source === undefined)
        throw new SqlError(1051, '42S02', `Unknown table '${item.table.name}'`)
      return [...source.columns]
    }
    if (scope.sources.length === 0) throw new SqlError(1096, 'HY000', 'No tables used')
    const merged = [...scope.merged.values()]
    const rest = scope.sources.flatMap((source) =>
      source.columns.filter((column) => !scope.joined.has(column)),
    )
    return [...merged, ...rest]
  }

  // FROM

  /** Compiles the tables of FROM, which it adds to the scope. */
  fromClause(refs: readonly TableRef[], scope: Scope): string {
    return refs.map((ref) => this.#tableRef(ref, scope)).join(', ')
  }

  #tableRef(ref: TableRef, scope: Scope): string {
    if (ref.kind === 'join') return this.#join(ref, scope)
    const source = this.#source(ref, scope)
    if (scope.sources.some((existing) => sameName(existing.alias, source.source.alias))) {
      throw new SqlError(1066, '42000', `Not unique table/alias: '${source.source.alias}'`)
    }
    scope.sources.push(source.source)
    return source.sql
  }

  #join(ref: Extract<TableRef, { kind: 'join' }>, scope: Scope): string {
    const left = this.#tableRef(ref.left, scope)
    const before = scope.sources.length
    const right = this.#tableRef(ref.right, scope)
    const leftSources = scope.sources.slice(0, before)
    const rightSources = scope.sources.slice(before)
    let using = ref.using
    if (ref.natural) {
      using = leftSources
        .flatMap((source) => source.columns.map((column) => column.name))
        .filter((name) =>
          rightSources.some((source) =>
            source.columns.some((column) => sameName(column.name, name)),
          ),
        )
    }
    const kind =
      ref.join === 'LEFT'
        ? 'LEFT JOIN'
        : ref.join === 'RIGHT'
          ? 'RIGHT JOIN'
          : ref.join === 'CROSS' && ref.on === undefined
            ? 'CROSS JOIN'
            : 'JOIN'
    let condition = ''
    if (using !== undefined && using.length > 0) {
      const equalities = using.map((name) => {
        const find = (sources: Source[]) => {
          const found = sources.flatMap((source) =>
            source.columns.filter((column) => sameName(column.name, name)),
          )
          if (found.length === 0)
            throw new SqlError(1054, '42S22', `Unknown column '${name}' in 'from clause'`)
          if (found.length > 1)
            throw new SqlError(1052, '23000', `Column '${name}' in from clause is ambiguous`)
          return found[0]!
        }
        const a = find(leftSources)
        const b = find(rightSources)
        scope.merged.set(name.toLowerCase(), ref.join === 'RIGHT' ? b : a)
        scope.joined.add(a)
        scope.joined.add(b)
        return this.comparison(
          '=',
          { sql: a.sql, type: a.type, column: a },
          { sql: b.sql, type: b.type, column: b },
        )
      })
      condition = ` ON ${equalities.join(' AND ')}`
    } else if (ref.on !== undefined) {
      const aggregates = scope.aggregates
      scope.aggregates = false
      condition = ` ON ${this.truth(this.expression(ref.on, scope, 'on clause'))}`
      scope.aggregates = aggregates
    }
    return `${left} ${kind} ${right}${condition}`
  }

  /** The source of a table, view, derived table or common table expression, and the SQL of it in FROM. */
  #source(ref: Exclude<TableRef, { kind: 'join' }>, scope: Scope): { source: Source; sql: string } {
    if (ref.kind === 'derived') {
      const compiled = this.select(ref.select, scope.parent)
      return this.#derived(ref.alias, ref.columns, compiled.fields, compiled.sql)
    }
    const { table } = ref
    const alias = ref.alias ?? table.name
    if (table.schema !== undefined && table.schema.toLowerCase() === 'information_schema') {
      return this.#informationSchema(table, alias)
    }
    const key = tableKey(table.name)
    if (table.schema === undefined) {
      for (const tables of this.#commonTables) {
        const common = tables.get(key)
        if (common !== undefined) {
          const columns = common.columns.map((column) => ({
            ...column,
            sql: `${sqliteName(alias)}.${sqliteName(column.name)}`,
          }))
          return {
            source: { ...common, alias, columns },
            sql: `${sqliteName(key)} AS ${sqliteName(alias)}`,
          }
        }
      }
    }
    const schema = this.catalog.table(key)
    if (schema !== undefined) {
      return {
        source: tableSource(schema, alias),
        sql: alias === key ? sqliteName(key) : `${sqliteName(key)} AS ${sqliteName(alias)}`,
      }
    }
    const view = this.catalog.view(key)
    if (view !== undefined) {
      const viewCompiler = new Compiler(this.catalog, view.sql, this.session)
      const compiled = viewCompiler.select(view.select)
      // The view's parameters are this query's, numbered after its own.
      const sql = compiled.sql.replace(/\?(\d+)/g, (_, n: string) =>
        this.bind(viewCompiler.params[Number(n) - 1] ?? null),
      )
      return this.#derived(alias, view.columns, compiled.fields, sql)
    }
    throw new SqlError(1146, '42S02', `Table '${this.catalog.schema}.${key}' doesn't exist`)
  }

  #derived(
    alias: string,
    names: readonly string[] | undefined,
    fields: readonly Field[],
    sql: string,
  ): { source: Source; sql: string } {
    const columnNames = names ?? fields.map((field) => field.name)
    if (columnNames.length !== fields.length) {
      throw new SqlError(
        1353,
        'HY000',
        `In definition of view, derived table or common table expression, SELECT list and column names list have different column counts`,
      )
    }
    const seen = new Set<string>()
    for (const name of columnNames) {
      if (seen.has(name.toLowerCase()))
        throw new SqlError(1060, '42S21', `Duplicate column name '${name}'`)
      seen.add(name.toLowerCase())
    }
    const columns = fields.map((field, i) => ({
      name: columnNames[i]!,
      type: field.type,
      sql: `${sqliteName(alias)}.${sqliteName(columnNames[i]!)}`,
      json: false,
      orgTable: alias,
      orgName: columnNames[i]!,
    }))
    // SQLite names the columns of a subquery after its items, which the derived table's names replace.
    const renamed =
      names === undefined
        ? sql
        : `SELECT ${fields.map((field, i) => `${sqliteName(field.name)} AS ${sqliteName(columnNames[i]!)}`).join(', ')} FROM (${sql})`
    return {
      source: { alias, orgTable: alias, columns },
      sql: `(${renamed}) AS ${sqliteName(alias)}`,
    }
  }

  /** The tables of information_schema, as values of the catalog. */
  #informationSchema(table: TableName, alias: string): { source: Source; sql: string } {
    const name = table.name.toUpperCase()
    const rows = informationSchemaRows(name, this.catalog)
    if (rows === undefined) {
      throw new SqlError(1109, '42S02', `Unknown table '${table.name}' in information_schema`)
    }
    const { columns, values } = rows
    const select =
      values.length === 0
        ? `SELECT ${columns.map(([column]) => `NULL AS ${sqliteName(column)}`).join(', ')} WHERE 0`
        : values
            .map(
              (row) =>
                `SELECT ${row.map((value, i) => `${typeof value === 'number' ? String(value) : value === null ? 'NULL' : this.bind(value)} AS ${sqliteName(columns[i]![0])}`).join(', ')}`,
            )
            .join(' UNION ALL ')
    const source: Source = {
      alias,
      orgTable: name,
      columns: columns.map(([column, type]) => ({
        name: column,
        type: type === 'int' ? integerType(21, true) : { ...stringType(64), caseSensitive: false },
        sql: `${sqliteName(alias)}.${sqliteName(column)}`,
        json: false,
        orgTable: name,
        orgName: column,
      })),
    }
    return { source, sql: `(${select}) AS ${sqliteName(alias)}` }
  }

  // Expressions

  /** SQL that is true where an expression is, as WHERE reads conditions. */
  truth(compiled: Compiled): string {
    return compiled.sql
  }

  /** Compiles an expression that names columns of the scope, in a clause of the statement. */
  expression(
    expr: Expression,
    scope: Scope,
    clause: Clause,
    aliases: AliasMode = 'none',
  ): Compiled {
    switch (expr.kind) {
      case 'null':
        return { sql: 'NULL', type: NULL_TYPE, constant: null }
      case 'boolean':
        return { sql: expr.value ? '1' : '0', type: integerType(1), constant: expr.value ? 1 : 0 }
      case 'number':
        return this.#number(expr.text)
      case 'string': {
        const value = expr.binary ? bytesOfText(expr.text) : expr.text
        return {
          sql: this.bind(value),
          type: expr.binary
            ? { ...stringType(bytesOfText(expr.text).length, true) }
            : stringType([...expr.text].length),
          constant: value,
        }
      }
      case 'hex':
      case 'bits': {
        const bytes =
          expr.kind === 'hex'
            ? bytesOfHex(expr.digits)
            : bytesOfHex(
                BigInt(`0b${expr.digits || '0'}`)
                  .toString(16)
                  .padStart(Math.ceil(expr.digits.length / 8) * 2 || 2, '0'),
              )
        return {
          sql: this.bind(bytes),
          type: stringType(bytes.length, true),
          constant: bytes,
          literalBytes: bytes,
        }
      }
      case 'param': {
        if (this.bound === undefined) {
          throw new SqlError(
            1064,
            '42000',
            `You have an error in your SQL syntax; check the manual that corresponds to your MariaDB server version for the right syntax to use near '?' at line 1`,
          )
        }
        const value = this.bound[expr.index] ?? null
        return { sql: this.bind(value), type: parameterType(value), constant: value }
      }
      case 'column':
        return this.#column(expr, scope, clause, aliases)
      case 'variable': {
        if (!expr.system) {
          const value = this.session.userVariable(expr.name)
          return { sql: `fr_var(${this.bind(expr.name.toLowerCase())})`, type: valueType(value) }
        }
        const value = this.session.systemVariable(expr.name.toLowerCase())
        if (value === undefined)
          throw new SqlError(1193, 'HY000', `Unknown system variable '${expr.name}'`)
        const type =
          typeof value === 'number' || typeof value === 'bigint'
            ? BIGINT_TYPE
            : stringType(value === null ? 0 : String(value).length)
        return {
          sql:
            value === null ? 'NULL' : typeof value === 'number' ? String(value) : this.bind(value),
          type,
          constant: value,
        }
      }
      case 'assign': {
        const value = this.expression(expr.value, scope, clause, aliases)
        return {
          sql: `fr_set_var(${this.bind(expr.name.toLowerCase())}, ${value.sql})`,
          type: value.type,
          ...(value.aggregate === true ? { aggregate: true } : {}),
        }
      }
      case 'unary':
        return this.#unary(expr, scope, clause, aliases)
      case 'binary':
        return this.#binary(expr, scope, clause, aliases)
      case 'is': {
        const operand = this.expression(expr.operand, scope, clause, aliases)
        const test = expr.value === 'UNKNOWN' ? 'NULL' : expr.value
        return {
          sql: `(${operand.sql} IS ${expr.not ? 'NOT ' : ''}${test})`,
          type: BOOLEAN_RESULT,
          ...aggregateOf(operand),
        }
      }
      case 'in':
        return this.#in(expr, scope, clause, aliases)
      case 'inSelect': {
        const operand = this.expression(expr.operand, scope, clause, aliases)
        const sub = this.#subquery(expr.select, scope, operand.type === ROW_TYPE ? undefined : 1)
        const left =
          comparesWithoutCase(operand.type) && operand.column === undefined
            ? `${operand.sql} COLLATE fr_ci`
            : operand.sql
        return {
          sql: `(${left} ${expr.not ? 'NOT IN' : 'IN'} (${sub.sql}))`,
          type: BOOLEAN_RESULT,
          ...aggregateOf(operand),
        }
      }
      case 'quantified': {
        const operand = this.expression(expr.operand, scope, clause, aliases)
        const sub = this.#subquery(expr.select, scope, 1)
        const alias = this.uniqueAlias('q')
        const value: Compiled = {
          sql: `${sqliteName(alias)}.${sqliteName(sub.fields[0]!.name)}`,
          type: sub.fields[0]!.type,
        }
        const test = this.comparison(expr.op, operand, value)
        const sql = expr.all
          ? `NOT EXISTS (SELECT 1 FROM (${sub.sql}) AS ${sqliteName(alias)} WHERE NOT (${test}))`
          : `EXISTS (SELECT 1 FROM (${sub.sql}) AS ${sqliteName(alias)} WHERE ${test})`
        return { sql: `(${sql})`, type: BOOLEAN_RESULT }
      }
      case 'between': {
        const operand = this.expression(expr.operand, scope, clause, aliases)
        const low = this.expression(expr.low, scope, clause, aliases)
        const high = this.expression(expr.high, scope, clause, aliases)
        const sql = `(${this.comparison('>=', operand, low)} AND ${this.comparison('<=', operand, high)})`
        return {
          sql: expr.not ? `(NOT ${sql})` : sql,
          type: BOOLEAN_RESULT,
          ...aggregateOf(operand, low, high),
        }
      }
      case 'like': {
        const operand = this.expression(expr.operand, scope, clause, aliases)
        const pattern = this.expression(expr.pattern, scope, clause, aliases)
        const escape =
          expr.escape === undefined
            ? undefined
            : this.expression(expr.escape, scope, clause, aliases)
        const ci =
          comparesWithoutCase(
            operand.type.field === 'NULL' || isString(operand.type) ? operand.type : stringType(0),
          ) &&
          comparesWithoutCase(
            isString(pattern.type) || pattern.type.field === 'NULL' ? pattern.type : stringType(0),
          )
        const sql = `fr_like(${operand.sql}, ${pattern.sql}, ${escape?.sql ?? "'\\'"}, ${ci ? 1 : 0})`
        return {
          sql: expr.not ? `(NOT ${sql})` : sql,
          type: BOOLEAN_RESULT,
          ...aggregateOf(operand, pattern),
        }
      }
      case 'regexp': {
        const operand = this.expression(expr.operand, scope, clause, aliases)
        const pattern = this.expression(expr.pattern, scope, clause, aliases)
        const ci =
          comparesWithoutCase(isString(operand.type) ? operand.type : stringType(0)) &&
          comparesWithoutCase(isString(pattern.type) ? pattern.type : stringType(0))
        const sql = `fr_regexp(${operand.sql}, ${pattern.sql}, ${ci ? 1 : 0})`
        return {
          sql: expr.not ? `(NOT ${sql})` : sql,
          type: BOOLEAN_RESULT,
          ...aggregateOf(operand, pattern),
        }
      }
      case 'case': {
        const operand =
          expr.operand === undefined
            ? undefined
            : this.expression(expr.operand, scope, clause, aliases)
        const parts: string[] = []
        const results: Compiled[] = []
        const all: Compiled[] = operand === undefined ? [] : [operand]
        for (const { when, then } of expr.whens) {
          const condition = this.expression(when, scope, clause, aliases)
          const result = this.expression(then, scope, clause, aliases)
          all.push(condition, result)
          results.push(result)
          parts.push(
            `WHEN ${operand === undefined ? condition.sql : this.comparison('=', operand, condition)} THEN ${result.sql}`,
          )
        }
        if (expr.else !== undefined) {
          const otherwise = this.expression(expr.else, scope, clause, aliases)
          all.push(otherwise)
          results.push(otherwise)
          parts.push(`ELSE ${otherwise.sql}`)
        }
        const type = aggregateType(results.map((result) => result.type))
        return {
          sql: `(CASE ${parts.join(' ')} END)`,
          type,
          ...(results.every((result) => result.json === true) ? { json: true } : {}),
          ...aggregateOf(...all),
        }
      }
      case 'cast':
        return this.#cast(expr, scope, clause, aliases)
      case 'call':
        return compileCall(this, expr, scope, clause, aliases)
      case 'interval':
        throw syntaxAt(this.sql, expr.start)
      case 'exists': {
        const sub = this.#subquery(expr.select, scope)
        return { sql: `(EXISTS (${sub.sql}))`, type: BOOLEAN_RESULT }
      }
      case 'subquery': {
        const sub = this.#subquery(expr.select, scope, 1)
        return { sql: `(${sub.sql})`, type: sub.fields[0]!.type }
      }
      case 'row': {
        const items = expr.items.map((item) => this.expression(item, scope, clause, aliases))
        return {
          sql: `(${items.map((item) => item.sql).join(', ')})`,
          type: ROW_TYPE,
          ...aggregateOf(...items),
        }
      }
      case 'collate': {
        const operand = this.expression(expr.operand, scope, clause, aliases)
        const collation = expr.collation.toLowerCase()
        const ci = isCaseInsensitive(collation)
        if (!isString(operand.type) && operand.type.field !== 'NULL') {
          throw new SqlError(
            1253,
            '42000',
            `COLLATION '${expr.collation}' is not valid for CHARACTER SET 'binary'`,
          )
        }
        return {
          sql: `(${operand.sql} COLLATE ${ci ? 'fr_ci' : 'BINARY'})`,
          type: ci
            ? { ...operand.type, caseSensitive: false }
            : { ...operand.type, caseSensitive: true },
          ...aggregateOf(operand),
        }
      }
      case 'default': {
        if (expr.column === undefined) throw syntaxAt(this.sql, expr.start)
        const named = expr.column.name
        const ofTable = scope.table?.columns.find((candidate) => sameName(candidate.name, named))
        const column =
          ofTable === undefined
            ? this.#column(
                { kind: 'column', ...expr.column, start: expr.start, end: expr.end },
                scope,
                clause,
                'none',
              )
            : undefined
        const schema = ofTable ?? column?.column?.schema
        if (schema === undefined)
          throw new SqlError(
            1364,
            'HY000',
            `Field '${expr.column.name}' doesn't have a default value`,
          )
        return this.columnDefault(schema)
      }
      case 'values': {
        const value = scope.values?.get(expr.column.name.toLowerCase())
        if (value !== undefined) return value
        if (scope.values !== undefined)
          throw new SqlError(1054, '42S22', `Unknown column '${expr.column.name}' in 'field list'`)
        return { sql: 'NULL', type: NULL_TYPE, constant: null }
      }
    }
  }

  /** The default of a column as a value: its constant, the current time, NULL, or its expression. */
  columnDefault(column: ColumnSchema): Compiled {
    const type = columnType(column)
    const value = column.default
    if (value === undefined) return { sql: 'NULL', type }
    if (value.kind === 'now') return { sql: `fr_now(${value.fsp}, 0)`, type }
    if (value.kind === 'value') {
      if (value.value === null) return { sql: 'NULL', type }
      return {
        sql: typeof value.value === 'number' ? String(value.value) : this.bind(value.value),
        type,
        constant: value.value,
      }
    }
    const compiled = this.expression(value.expr, new Scope(), 'field list')
    return { ...compiled, type }
  }

  #number(text: string): Compiled {
    if (/^\d+$/.test(text)) {
      const digits = text.replace(/^0+(?=\d)/, '')
      const value = BigInt(digits)
      if (value <= 9223372036854775807n) {
        const constant = value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value
        return { sql: digits, type: integerType(Math.max(1, digits.length)), constant }
      }
      if (value <= 18446744073709551615n) {
        return { sql: this.bind(digits), type: integerType(digits.length, true), constant: digits }
      }
      return { sql: `${digits}.0`, type: decimalType(digits.length, 0), constant: Number(digits) }
    }
    if (/[eE]/.test(text))
      return { sql: numberSql(text), type: DOUBLE_TYPE, constant: Number(text) }
    const [integer = '', fraction = ''] = text.split('.')
    const digits = integer.replace(/^0+/, '').length + fraction.length
    return {
      sql: numberSql(text),
      type: decimalType(Math.max(1, digits), fraction.length),
      constant: Number(text),
    }
  }

  #column(
    expr: Extract<Expression, { kind: 'column' }>,
    scope: Scope,
    clause: Clause,
    aliases: AliasMode,
  ): Compiled {
    const shown = expr.table === undefined ? expr.name : `${expr.table}.${expr.name}`
    const fromColumn = (column: SourceColumn): Compiled => ({
      sql: column.sql,
      type: column.type,
      json: column.json,
      column,
    })
    if (expr.table === undefined) {
      const key = expr.name.toLowerCase()
      const assigned = scope.assigned.get(key)
      if (assigned !== undefined) return assigned
      if (aliases === 'first') {
        const alias = scope.aliases.find((candidate) => sameName(candidate.name, expr.name))
        if (alias !== undefined) return aliasReference(alias)
      }
      for (
        let current: Scope | undefined = scope;
        current !== undefined;
        current = current.parent
      ) {
        const merged = current.merged.get(key)
        if (merged !== undefined) return fromColumn(merged)
        const found = current.sources.flatMap((source) =>
          source.columns.filter((column) => sameName(column.name, expr.name)),
        )
        if (found.length > 1)
          throw new SqlError(1052, '23000', `Column '${expr.name}' in ${clause} is ambiguous`)
        if (found.length === 1) return fromColumn(found[0]!)
        if (current === scope && aliases === 'after') {
          const alias = scope.aliases.find((candidate) => sameName(candidate.name, expr.name))
          if (alias !== undefined) return aliasReference(alias)
        }
      }
      throw new SqlError(1054, '42S22', `Unknown column '${shown}' in '${clause}'`)
    }
    for (let current: Scope | undefined = scope; current !== undefined; current = current.parent) {
      const source = current.sources.find((candidate) => sameName(candidate.alias, expr.table!))
      if (source === undefined) continue
      const column = source.columns.find((candidate) => sameName(candidate.name, expr.name))
      if (column === undefined) break
      const assigned = current === scope ? scope.assigned.get(column.name.toLowerCase()) : undefined
      return assigned ?? fromColumn(column)
    }
    throw new SqlError(1054, '42S22', `Unknown column '${shown}' in '${clause}'`)
  }

  /** Compiles a subquery in a scope of its own, whose names may refer to the scope around it. */
  #subquery(select: Select, scope: Scope, columns?: number): { sql: string; fields: Field[] } {
    const compiled = this.select(select, scope)
    if (columns !== undefined && compiled.fields.length !== columns) {
      throw new SqlError(1241, '21000', `Operand should contain ${columns} column(s)`)
    }
    return compiled
  }

  /** SQL that reads a value as a number, as MariaDB does where it takes numbers: temporal values by their digits, literals of bytes as integers. */
  numeric(compiled: Compiled): string {
    if (compiled.literalBytes !== undefined) {
      const value = integerOfBytes(compiled.literalBytes)
      return value.toString()
    }
    if (isTemporal(compiled.type)) {
      const kind =
        compiled.type.field === 'DATE'
          ? 'date'
          : compiled.type.field === 'TIME'
            ? 'time'
            : 'datetime'
      return `fr_temporal_number(${compiled.sql}, '${kind}')`
    }
    return compiled.sql
  }

  /** The type of a value as a number. */
  numericType(compiled: Compiled): Type {
    if (compiled.literalBytes !== undefined) return integerType(20, true)
    return compiled.type
  }

  #unary(
    expr: Extract<Expression, { kind: 'unary' }>,
    scope: Scope,
    clause: Clause,
    aliases: AliasMode,
  ): Compiled {
    const operand = this.expression(expr.operand, scope, clause, aliases)
    const aggregate = aggregateOf(operand)
    switch (expr.op) {
      case '-': {
        const type = numericOf(this.numericType(operand))
        if (
          operand.constant !== undefined &&
          typeof operand.constant === 'number' &&
          isNumeric(operand.type)
        ) {
          return { sql: `(-${operand.sql})`, type: operand.type, constant: -operand.constant }
        }
        return {
          sql: `(-${this.numeric(operand)})`,
          type: isNumeric(type) ? { ...type, unsigned: false } : DOUBLE_TYPE,
          ...aggregate,
        }
      }
      case '+':
        return operand
      case '~':
        return {
          sql: `fr_bit('~', ${this.numeric(operand)})`,
          type: integerType(20, true),
          ...aggregate,
        }
      case 'NOT':
      case '!':
        return { sql: `(NOT ${operand.sql})`, type: BOOLEAN_RESULT, ...aggregate }
      case 'BINARY':
        return {
          sql: `CAST(${operand.sql} AS BLOB)`,
          type: {
            ...stringType(operand.type.length, true),
            field: operand.type.field === 'BLOB' ? 'BLOB' : 'VAR_STRING',
          },
          ...aggregate,
        }
    }
  }

  #binary(
    expr: Extract<Expression, { kind: 'binary' }>,
    scope: Scope,
    clause: Clause,
    aliases: AliasMode,
  ): Compiled {
    const { op } = expr
    // Intervals add to dates.
    if (
      (op === '+' || op === '-') &&
      (expr.right.kind === 'interval' || (op === '+' && expr.left.kind === 'interval'))
    ) {
      const interval =
        expr.right.kind === 'interval'
          ? expr.right
          : (expr.left as Extract<Expression, { kind: 'interval' }>)
      const dateExpr = expr.right.kind === 'interval' ? expr.left : expr.right
      const date = this.expression(dateExpr, scope, clause, aliases)
      const value = this.expression(interval.value, scope, clause, aliases)
      return this.dateAdd(date, value, interval.unit, op === '-' ? -1 : 1)
    }
    const left = this.expression(expr.left, scope, clause, aliases)
    const right = this.expression(expr.right, scope, clause, aliases)
    const aggregate = aggregateOf(left, right)
    switch (op) {
      case 'AND':
      case 'OR':
        return { sql: `(${left.sql} ${op} ${right.sql})`, type: BOOLEAN_RESULT, ...aggregate }
      case 'XOR':
        return {
          sql: `((NOT NOT ${left.sql}) <> (NOT NOT ${right.sql}))`,
          type: BOOLEAN_RESULT,
          ...aggregate,
        }
      case '=':
      case '<=>':
      case '!=':
      case '<':
      case '<=':
      case '>':
      case '>=':
        return { sql: this.comparison(op, left, right), type: BOOLEAN_RESULT, ...aggregate }
      case '+':
      case '-':
      case '*':
        return {
          sql: `(${this.numeric(left)} ${op} ${this.numeric(right)})`,
          type: arithmeticType(
            op,
            numericOf(this.numericType(left)),
            numericOf(this.numericType(right)),
          ),
          ...aggregate,
        }
      case 'MOD':
        return {
          sql: `fr_mod(${this.numeric(left)}, ${this.numeric(right)})`,
          type: arithmeticType(
            'MOD',
            numericOf(this.numericType(left)),
            numericOf(this.numericType(right)),
          ),
          ...aggregate,
        }
      case '/':
        return {
          sql: `fr_div(${this.numeric(left)}, ${this.numeric(right)}, ${this.strictDivision ? 1 : 0})`,
          type: divisionType(this.numericType(left), this.numericType(right)),
          ...aggregate,
        }
      case 'DIV':
        return {
          sql: `fr_intdiv(${this.numeric(left)}, ${this.numeric(right)})`,
          type: integerType(21),
          ...aggregate,
        }
      case '|':
      case '&':
      case '^':
      case '<<':
      case '>>':
        return {
          sql: `fr_bit('${op}', ${this.numeric(left)}, ${this.numeric(right)})`,
          type: integerType(20, true),
          ...aggregate,
        }
    }
  }

  /** Adds an interval to a date, as DATE_ADD and date + INTERVAL do. */
  dateAdd(date: Compiled, value: Compiled, unit: string, sign: number): Compiled {
    const timeUnit = !['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR', 'YEAR_MONTH'].includes(unit)
    const micro =
      unit.includes('MICROSECOND') || (unit === 'SECOND' && !Number.isInteger(value.constant ?? 0))
    let kind: string
    let type: Type
    let fsp = 0
    if (date.type.field === 'DATE') {
      kind = 'date'
      type = timeUnit ? datetimeType(micro ? 6 : 0) : DATE_TYPE
      fsp = micro ? 6 : 0
    } else if (isDateType(date.type)) {
      kind = 'datetime'
      fsp = Math.max(date.type.decimals, micro ? 6 : 0)
      type = datetimeType(fsp)
    } else {
      kind = 'auto'
      type = stringType(29)
    }
    const valueSql =
      value.literalBytes !== undefined ? integerOfBytes(value.literalBytes).toString() : value.sql
    return {
      sql: `fr_date_add(${date.sql}, ${valueSql}, '${unit}', ${sign}, '${kind}', ${fsp})`,
      type,
      ...aggregateOf(date, value),
    }
  }

  /**
   * SQL that compares two values as MariaDB compares them: strings without
   * case and accents unless either is binary or of a binary collation,
   * numbers with strings as numbers, and temporal values with strings as
   * temporal values.
   */
  comparison(op: BinaryOperator, left: Compiled, right: Compiled): string {
    const sqliteOp = op === '<=>' ? 'IS' : op === '!=' ? '<>' : op
    if (left.type === ROW_TYPE || right.type === ROW_TYPE)
      return `(${left.sql} ${sqliteOp} ${right.sql})`
    let a = left.sql
    let b = right.sql
    const temporal = isTemporal(left.type) || isTemporal(right.type)
    if (
      temporal &&
      !(isNumeric(left.type) && left.literalBytes === undefined) &&
      !(isNumeric(right.type) && right.literalBytes === undefined)
    ) {
      // Temporal values compare as such, in the text MariaDB writes them in.
      const kind =
        left.type.field === 'TIME' && (right.type.field === 'TIME' || !isTemporal(right.type))
          ? 'time'
          : right.type.field === 'TIME' && !isTemporal(left.type)
            ? 'time'
            : 'datetime'
      const canonical = (compiled: Compiled) =>
        compiled.type.field === 'NULL'
          ? compiled.sql
          : kind === 'datetime' &&
              (compiled.type.field === 'DATETIME' || compiled.type.field === 'TIMESTAMP') &&
              compiled.type.decimals === 0
            ? compiled.sql
            : `fr_datetime(${compiled.sql}, '${kind}')`
      a = canonical(left)
      b = canonical(right)
      return `(${a} ${sqliteOp} ${b})`
    }
    const leftNumeric = isNumeric(left.type) || left.literalBytes !== undefined
    const rightNumeric = isNumeric(right.type) || right.literalBytes !== undefined
    if (leftNumeric !== rightNumeric && left.type.field !== 'NULL' && right.type.field !== 'NULL') {
      // A number and a string compare as doubles.
      a = leftNumeric ? this.numeric(left) : `CAST(${left.sql} AS REAL)`
      b = rightNumeric ? this.numeric(right) : `CAST(${right.sql} AS REAL)`
      return `(${a} ${sqliteOp} ${b})`
    }
    if (leftNumeric && rightNumeric)
      return `(${this.numeric(left)} ${sqliteOp} ${this.numeric(right)})`
    if (isString(left.type) || isString(right.type)) {
      const binary =
        left.type.binary === true ||
        right.type.binary === true ||
        left.type.caseSensitive === true ||
        right.type.caseSensitive === true
      return `(${a} ${sqliteOp} ${b} COLLATE ${binary ? 'BINARY' : 'fr_ci'})`
    }
    return `(${a} ${sqliteOp} ${b})`
  }

  #in(
    expr: Extract<Expression, { kind: 'in' }>,
    scope: Scope,
    clause: Clause,
    aliases: AliasMode,
  ): Compiled {
    const operand = this.expression(expr.operand, scope, clause, aliases)
    const list = expr.list.map((item) => this.expression(item, scope, clause, aliases))
    const aggregate = aggregateOf(operand, ...list)
    if (operand.type === ROW_TYPE) {
      const tests = list.map((item) => `(${operand.sql} = ${item.sql})`)
      const sql = `(${tests.join(' OR ')})`
      return { sql: expr.not ? `(NOT ${sql})` : sql, type: BOOLEAN_RESULT, ...aggregate }
    }
    const sameClass = list.every(
      (item) =>
        item.type.field === 'NULL' ||
        (isNumeric(item.type) &&
          isNumeric(operand.type) &&
          item.literalBytes === undefined &&
          operand.literalBytes === undefined) ||
        (isString(item.type) && isString(operand.type)),
    )
    if (sameClass) {
      const ci =
        isString(operand.type) &&
        comparesWithoutCase(operand.type) &&
        list.every((item) => item.type.field === 'NULL' || comparesWithoutCase(item.type))
      const left = isString(operand.type)
        ? `${operand.sql} COLLATE ${ci ? 'fr_ci' : 'BINARY'}`
        : operand.sql
      const sql = `(${left} ${expr.not ? 'NOT IN' : 'IN'} (${list.map((item) => item.sql).join(', ')}))`
      return { sql, type: BOOLEAN_RESULT, ...aggregate }
    }
    const tests = list.map((item) => this.comparison('=', operand, item))
    const sql = `(${tests.join(' OR ')})`
    return { sql: expr.not ? `(NOT ${sql})` : sql, type: BOOLEAN_RESULT, ...aggregate }
  }

  #cast(
    expr: Extract<Expression, { kind: 'cast' }>,
    scope: Scope,
    clause: Clause,
    aliases: AliasMode,
  ): Compiled {
    const operand = this.expression(expr.operand, scope, clause, aliases)
    const aggregate = aggregateOf(operand)
    const { type } = expr
    const value =
      operand.literalBytes !== undefined &&
      ['SIGNED', 'UNSIGNED', 'DECIMAL', 'DOUBLE', 'FLOAT'].includes(type.name)
        ? integerOfBytes(operand.literalBytes).toString()
        : operand.sql
    switch (type.name) {
      case 'SIGNED':
      case 'UNSIGNED':
        return {
          sql: `fr_cast_signed(${this.numeric({ ...operand, sql: value })}, ${type.name === 'UNSIGNED' ? 1 : 0})`,
          type: integerType(21, type.name === 'UNSIGNED'),
          ...aggregate,
        }
      case 'CHAR':
        return {
          sql: `fr_cast_char(${operand.sql}, ${type.length ?? 'NULL'})`,
          type: stringType(type.length ?? Math.max(operand.type.length, 0)),
          ...aggregate,
        }
      case 'BINARY':
        return {
          sql: `fr_cast_binary(${operand.sql}, ${type.length ?? 'NULL'})`,
          type: stringType(type.length ?? operand.type.length, true),
          ...aggregate,
        }
      case 'DECIMAL':
        return {
          sql: `fr_cast_decimal(${value}, ${type.length ?? 10}, ${type.scale ?? 0})`,
          type: decimalType(type.length ?? 10, type.scale ?? 0),
          ...aggregate,
        }
      case 'DOUBLE':
      case 'FLOAT':
        return { sql: `fr_cast_double(${value})`, type: DOUBLE_TYPE, ...aggregate }
      case 'DATE':
        return { sql: `fr_cast_temporal(${operand.sql}, 'date', 0)`, type: DATE_TYPE, ...aggregate }
      case 'DATETIME':
        return {
          sql: `fr_cast_temporal(${operand.sql}, 'datetime', ${type.length ?? 0})`,
          type: datetimeType(type.length ?? 0),
          ...aggregate,
        }
      case 'TIME':
        return {
          sql: `fr_cast_temporal(${operand.sql}, 'time', ${type.length ?? 0})`,
          type: timeType(type.length ?? 0),
          ...aggregate,
        }
      case 'JSON':
        throw unsupported('CAST AS JSON')
    }
  }
}

/** The type of row values, which only comparisons take. */
export const ROW_TYPE: Type = { field: 'NULL', length: -1, decimals: 0 }

function aggregateOf(...compiled: Compiled[]): { aggregate?: true } {
  return compiled.some((value) => value.aggregate === true) ? { aggregate: true } : {}
}

/** A reference to an item of the SELECT by its alias, as ORDER BY, GROUP BY and HAVING make. */
function aliasReference(alias: { readonly name: string; readonly compiled: Compiled }): Compiled {
  return alias.compiled
}

/** The source of a table, by an alias. */
export function tableSource(table: TableSchema, alias: string): Source {
  return {
    alias,
    orgTable: table.name,
    table,
    columns: table.columns.map((column) => ({
      name: column.name,
      type: columnType(column),
      sql: `${sqliteName(alias)}.${sqliteName(column.name)}`,
      json: column.type.name === 'JSON',
      orgTable: table.name,
      orgName: column.name,
      schema: column,
    })),
  }
}

/** The first SELECT of a query, which recursive common tables start from. */
function firstSelect(select: Select): SelectCore {
  let body: QueryBody = select.body
  for (;;) {
    if (body.kind === 'core') return body
    if (body.kind === 'parens') body = body.select.body
    else body = body.left
  }
}

/** Whether a query refers to a table by name, as recursive common tables refer to themselves. */
function selectReferences(select: Select, name: string): boolean {
  const visit = (value: unknown): boolean => {
    if (value === null || typeof value !== 'object') return false
    if (Array.isArray(value)) return value.some(visit)
    const node = value as Record<string, unknown>
    if (node.kind === 'table' && typeof node.table === 'object' && node.table !== null) {
      const table = node.table as TableName
      if (table.schema === undefined && tableKey(table.name) === name) return true
    }
    return Object.values(node).some(visit)
  }
  return visit(select)
}

function syntaxAt(sql: string, at: number): SqlError {
  const near = [...sql.slice(at)].slice(0, 80).join('')
  const line = sql.slice(0, at).split('\n').length
  return new SqlError(
    1064,
    '42000',
    `You have an error in your SQL syntax; check the manual that corresponds to your MariaDB server version for the right syntax to use near '${near}' at line ${line}`,
  )
}

/** The columns and rows of a table of information_schema, or undefined for those FiveRunner does not have. */
function informationSchemaRows(
  name: string,
  catalog: Catalog,
): { columns: [string, 'int' | 'text'][]; values: SqlValue[][] } | undefined {
  const schema = catalog.schema
  const columns = (names: string): [string, 'int' | 'text'][] =>
    names.split(' ').map((column) => {
      const [columnName, kind] = column.split(':')
      return [columnName!, kind === 'i' ? 'int' : 'text']
    })
  const nullableOf = (table: TableSchema, column: string) =>
    table.columns.find((candidate) => sameName(candidate.name, column))?.nullable === true
  switch (name) {
    case 'SCHEMATA':
      return {
        columns: columns(
          'CATALOG_NAME SCHEMA_NAME DEFAULT_CHARACTER_SET_NAME DEFAULT_COLLATION_NAME SQL_PATH SCHEMA_COMMENT',
        ),
        values: [
          ['def', 'information_schema', 'utf8mb3', 'utf8mb3_general_ci', null, ''],
          ['def', schema, 'utf8mb4', 'utf8mb4_general_ci', null, ''],
        ],
      }
    case 'TABLES':
      return {
        columns: columns(
          'TABLE_CATALOG TABLE_SCHEMA TABLE_NAME TABLE_TYPE ENGINE VERSION:i ROW_FORMAT TABLE_ROWS:i AVG_ROW_LENGTH:i DATA_LENGTH:i MAX_DATA_LENGTH:i INDEX_LENGTH:i DATA_FREE:i AUTO_INCREMENT:i CREATE_TIME UPDATE_TIME CHECK_TIME TABLE_COLLATION CHECKSUM:i CREATE_OPTIONS TABLE_COMMENT MAX_INDEX_LENGTH:i TEMPORARY',
        ),
        values: [
          ...catalog
            .tables()
            .map((table) => [
              'def',
              schema,
              table.name,
              table.temporary ? 'TEMPORARY' : 'BASE TABLE',
              table.engine,
              10,
              'Dynamic',
              catalog.rowCount?.(table.name) ?? 0,
              0,
              16384,
              0,
              0,
              0,
              table.columns.some((column) => column.autoIncrement) ? table.autoIncrement : null,
              null,
              null,
              null,
              table.collation,
              null,
              '',
              table.comment,
              0,
              table.temporary ? 'Y' : 'N',
            ]),
          ...catalog
            .views()
            .map((view) => [
              'def',
              schema,
              view.name,
              'VIEW',
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              'VIEW',
              null,
              null,
            ]),
        ],
      }
    case 'COLUMNS':
      return {
        columns: columns(
          'TABLE_CATALOG TABLE_SCHEMA TABLE_NAME COLUMN_NAME ORDINAL_POSITION:i COLUMN_DEFAULT IS_NULLABLE DATA_TYPE CHARACTER_MAXIMUM_LENGTH:i CHARACTER_OCTET_LENGTH:i NUMERIC_PRECISION:i NUMERIC_SCALE:i DATETIME_PRECISION:i CHARACTER_SET_NAME COLLATION_NAME COLUMN_TYPE COLUMN_KEY EXTRA PRIVILEGES COLUMN_COMMENT IS_GENERATED GENERATION_EXPRESSION',
        ),
        values: catalog.tables().flatMap((table) =>
          table.columns.map((column, i) => {
            const info = columnInformation(column, table)
            const octets =
              info.characterLength === null
                ? null
                : info.charset === 'utf8mb4'
                  ? Math.min(info.characterLength * 4, 4294967295)
                  : info.characterLength
            return [
              'def',
              schema,
              table.name,
              column.name,
              i + 1,
              info.default,
              column.nullable ? 'YES' : 'NO',
              info.dataType,
              info.characterLength,
              octets,
              info.precision,
              info.scale,
              info.datetimePrecision,
              info.charset,
              info.collation,
              info.columnType,
              info.key,
              info.extra,
              'select,insert,update,references',
              column.comment,
              'NEVER',
              null,
            ]
          }),
        ),
      }
    case 'STATISTICS':
      return {
        columns: columns(
          'TABLE_CATALOG TABLE_SCHEMA TABLE_NAME NON_UNIQUE:i INDEX_SCHEMA INDEX_NAME SEQ_IN_INDEX:i COLUMN_NAME COLLATION CARDINALITY:i SUB_PART:i PACKED NULLABLE INDEX_TYPE COMMENT INDEX_COMMENT IGNORED',
        ),
        values: catalog
          .tables()
          .flatMap((table) =>
            table.indexes.flatMap((index) =>
              index.parts.map((part, i) => [
                'def',
                schema,
                table.name,
                index.kind === 'PRIMARY' || index.kind === 'UNIQUE' ? 0 : 1,
                schema,
                index.name,
                i + 1,
                part.column,
                part.descending ? 'D' : 'A',
                0,
                part.length ?? null,
                null,
                nullableOf(table, part.column) ? 'YES' : '',
                index.kind === 'FULLTEXT' ? 'FULLTEXT' : 'BTREE',
                '',
                '',
                'NO',
              ]),
            ),
          ),
      }
    case 'KEY_COLUMN_USAGE':
      return {
        columns: columns(
          'CONSTRAINT_CATALOG CONSTRAINT_SCHEMA CONSTRAINT_NAME TABLE_CATALOG TABLE_SCHEMA TABLE_NAME COLUMN_NAME ORDINAL_POSITION:i POSITION_IN_UNIQUE_CONSTRAINT:i REFERENCED_TABLE_SCHEMA REFERENCED_TABLE_NAME REFERENCED_COLUMN_NAME',
        ),
        values: catalog
          .tables()
          .flatMap((table) => [
            ...table.indexes
              .filter((index) => index.kind === 'PRIMARY' || index.kind === 'UNIQUE')
              .flatMap((index) =>
                index.parts.map((part, i) => [
                  'def',
                  schema,
                  index.name,
                  'def',
                  schema,
                  table.name,
                  part.column,
                  i + 1,
                  null,
                  null,
                  null,
                  null,
                ]),
              ),
            ...table.foreignKeys.flatMap((key) =>
              key.columns.map((column, i) => [
                'def',
                schema,
                key.name,
                'def',
                schema,
                table.name,
                column,
                i + 1,
                i + 1,
                schema,
                key.table,
                key.referenced[i] ?? null,
              ]),
            ),
          ]),
      }
    case 'TABLE_CONSTRAINTS':
      return {
        columns: columns(
          'CONSTRAINT_CATALOG CONSTRAINT_SCHEMA CONSTRAINT_NAME TABLE_SCHEMA TABLE_NAME CONSTRAINT_TYPE',
        ),
        values: catalog
          .tables()
          .flatMap((table) => [
            ...table.indexes
              .filter((index) => index.kind === 'PRIMARY' || index.kind === 'UNIQUE')
              .map((index) => [
                'def',
                schema,
                index.name,
                schema,
                table.name,
                index.kind === 'PRIMARY' ? 'PRIMARY KEY' : 'UNIQUE',
              ]),
            ...table.foreignKeys.map((key) => [
              'def',
              schema,
              key.name,
              schema,
              table.name,
              'FOREIGN KEY',
            ]),
            ...table.checks.map((check) => [
              'def',
              schema,
              check.name,
              schema,
              table.name,
              'CHECK',
            ]),
          ]),
      }
    case 'REFERENTIAL_CONSTRAINTS':
      return {
        columns: columns(
          'CONSTRAINT_CATALOG CONSTRAINT_SCHEMA CONSTRAINT_NAME UNIQUE_CONSTRAINT_CATALOG UNIQUE_CONSTRAINT_SCHEMA UNIQUE_CONSTRAINT_NAME MATCH_OPTION UPDATE_RULE DELETE_RULE TABLE_NAME REFERENCED_TABLE_NAME',
        ),
        values: catalog.tables().flatMap((table) =>
          table.foreignKeys.map((key) => {
            const parent = catalog.table(key.table)
            const unique = parent?.indexes.find((index) =>
              key.referenced.every(
                (column, i) =>
                  index.parts[i] !== undefined && sameName(index.parts[i]!.column, column),
              ),
            )
            return [
              'def',
              schema,
              key.name,
              'def',
              schema,
              unique?.name ?? null,
              'NONE',
              key.onUpdate,
              key.onDelete,
              table.name,
              key.table,
            ]
          }),
        ),
      }
    case 'CHECK_CONSTRAINTS':
      return {
        columns: columns(
          'CONSTRAINT_CATALOG CONSTRAINT_SCHEMA TABLE_NAME CONSTRAINT_NAME LEVEL CHECK_CLAUSE',
        ),
        values: catalog
          .tables()
          .flatMap((table) => [
            ...table.columns
              .filter((column) => column.type.name === 'JSON')
              .map((column) => [
                'def',
                schema,
                table.name,
                column.name,
                'Column',
                `json_valid(\`${column.name}\`)`,
              ]),
            ...table.checks.map((check) => [
              'def',
              schema,
              table.name,
              check.name,
              'Table',
              check.sql,
            ]),
          ]),
      }
    case 'VIEWS':
      return {
        columns: columns(
          'TABLE_CATALOG TABLE_SCHEMA TABLE_NAME VIEW_DEFINITION CHECK_OPTION IS_UPDATABLE DEFINER SECURITY_TYPE CHARACTER_SET_CLIENT COLLATION_CONNECTION ALGORITHM',
        ),
        values: catalog
          .views()
          .map((view) => [
            'def',
            schema,
            view.name,
            view.sql.slice(view.select.start, view.select.end),
            'NONE',
            'NO',
            'root@localhost',
            'DEFINER',
            'utf8mb4',
            'utf8mb4_general_ci',
            'UNDEFINED',
          ]),
      }
    default:
      return undefined
  }
}

/** What information_schema.COLUMNS and SHOW COLUMNS say of a column. */
export function columnInformation(column: ColumnSchema, table: TableSchema) {
  const { type } = column
  const name = type.name === 'JSON' ? 'longtext' : type.name.toLowerCase()
  const textual = ![
    'TINYINT',
    'SMALLINT',
    'MEDIUMINT',
    'INT',
    'BIGINT',
    'DECIMAL',
    'FLOAT',
    'DOUBLE',
    'BIT',
    'YEAR',
    'DATE',
    'TIME',
    'DATETIME',
    'TIMESTAMP',
  ].includes(type.name)
  const lengths: Record<string, number> = {
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
  const characterLength = textual
    ? (lengths[type.name] ??
      type.length ??
      (type.values === undefined ? null : Math.max(0, ...type.values.map((value) => value.length))))
    : null
  const precisions: Record<string, number> = {
    TINYINT: 3,
    SMALLINT: 5,
    MEDIUMINT: 7,
    INT: 10,
    BIGINT: 19,
  }
  const precision =
    type.name === 'DECIMAL'
      ? (type.length ?? 10)
      : (precisions[type.name] ??
        (type.name === 'FLOAT'
          ? 12
          : type.name === 'DOUBLE'
            ? 22
            : type.name === 'BIT'
              ? (type.length ?? 1)
              : null))
  const scale =
    type.name === 'DECIMAL' ? (type.scale ?? 0) : precisions[type.name] !== undefined ? 0 : null
  const datetimePrecision = ['TIME', 'DATETIME', 'TIMESTAMP'].includes(type.name)
    ? (type.length ?? 0)
    : null
  const primary = table.indexes.find((index) => index.kind === 'PRIMARY')
  const first = (kind: string) =>
    table.indexes.some(
      (index) => index.kind === kind && sameName(index.parts[0]!.column, column.name),
    )
  const key =
    primary?.parts.some((part) => sameName(part.column, column.name)) === true
      ? 'PRI'
      : first('UNIQUE')
        ? 'UNI'
        : table.indexes.some((index) => sameName(index.parts[0]!.column, column.name))
          ? 'MUL'
          : ''
  const extra = [
    column.autoIncrement ? 'auto_increment' : '',
    column.onUpdateNow ? 'on update current_timestamp()' : '',
  ]
    .filter((part) => part !== '')
    .join(' ')
  let shownDefault: SqlValue = null
  if (column.default !== undefined) {
    if (column.default.kind === 'now') shownDefault = 'current_timestamp()'
    else if (column.default.kind === 'expression') shownDefault = column.default.sql
    else if (column.default.value === null) shownDefault = 'NULL'
    else
      shownDefault =
        typeof column.default.value === 'string'
          ? `'${column.default.value}'`
          : String(column.default.value)
  } else if (column.nullable && !column.autoIncrement) shownDefault = 'NULL'
  const charset = textual && column.collation !== 'binary' ? column.collation.split('_')[0]! : null
  const collation = textual && column.collation !== 'binary' ? column.collation : null
  let columnTypeText = name
  if (type.values !== undefined)
    columnTypeText += `(${type.values.map((value) => `'${value}'`).join(',')})`
  else if (
    type.length !== undefined &&
    !name.endsWith('text') &&
    !name.endsWith('blob') &&
    !['date', 'year'].includes(name) &&
    !(['time', 'datetime', 'timestamp'].includes(name) && type.length === 0)
  ) {
    columnTypeText +=
      type.scale !== undefined ? `(${type.length},${type.scale})` : `(${type.length})`
  }
  if (type.unsigned === true) columnTypeText += ' unsigned'
  if (type.zerofill === true) columnTypeText += ' zerofill'
  return {
    dataType: name,
    characterLength,
    precision,
    scale,
    datetimePrecision,
    charset,
    collation,
    columnType: columnTypeText,
    key,
    extra,
    default: shownDefault,
  }
}
