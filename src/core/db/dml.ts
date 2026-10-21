import type { Delete, Expression, Insert, OrderItem, Update } from './ast.ts'
import { Scope, tableSource, type Compiled, type Compiler } from './compile.ts'
import type { Connection, Result } from './database.ts'
import { SqlError } from './lexer.ts'
import { unsupported } from './parser.ts'
import {
  columnType,
  sameName,
  sqliteName,
  tableKey,
  type ColumnSchema,
  type ForeignKeySchema,
  type IndexSchema,
  type TableSchema,
} from './schema.ts'
import type { SqlValue } from './sqlite.ts'
import { formatDateTime, localDateTime } from './temporal.ts'
import { implicitDefault, storeValue, textOf } from './values.ts'

type Ok = Extract<Result, { kind: 'ok' }>

/** The most characters of the values that errors of duplicate entries quote. */
const MAX_ENTRY = 192

/** Whether two stored values are the same, byte for byte, as InnoDB tells whether an update changed a row. */
function sameValue(a: SqlValue, b: SqlValue): boolean {
  if (a === null || b === null) return a === b
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length)
      return false
    return a.every((byte, i) => byte === b[i])
  }
  if (typeof a === 'bigint' || typeof b === 'bigint')
    return BigInt(a as number) === BigInt(b as number)
  return a === b
}

/** A key's values as MariaDB's errors of duplicate entries quote them: joined by dashes. */
function entryText(values: readonly SqlValue[]): string {
  const text = values.map((value) => (value === null ? 'NULL' : textOf(value))).join('-')
  return [...text].slice(0, MAX_ENTRY).join('')
}

function duplicateEntry(values: readonly SqlValue[], index: IndexSchema): SqlError {
  return new SqlError(
    1062,
    '23000',
    `Duplicate entry '${entryText(values)}' for key '${index.name}'`,
  )
}

/** A foreign key as MariaDB's errors of foreign keys write it. */
function foreignKeyText(schema: string, table: string, key: ForeignKeySchema): string {
  let text = `\`${schema}\`.\`${table}\`, CONSTRAINT \`${key.name}\` FOREIGN KEY (${key.columns.map((column) => `\`${column}\``).join(', ')}) REFERENCES \`${key.table}\` (${key.referenced.map((column) => `\`${column}\``).join(', ')})`
  if (key.onDelete !== 'RESTRICT') text += ` ON DELETE ${key.onDelete}`
  if (key.onUpdate !== 'RESTRICT') text += ` ON UPDATE ${key.onUpdate}`
  return text
}

function columnOf(table: TableSchema, name: string): ColumnSchema {
  const column = table.columns.find((candidate) => sameName(candidate.name, name))
  if (column === undefined)
    throw new SqlError(1054, '42S22', `Unknown column '${name}' in 'field list'`)
  return column
}

/** The SQL that tells whether a row's key has values, for a part of a key that may be of a prefix. */
function keyPartSql(table: TableSchema, part: IndexSchema['parts'][number], param: string): string {
  const column = columnOf(table, part.column)
  if (part.length !== undefined)
    return `substr(${sqliteName(column.name)}, 1, ${part.length}) = substr(${param}, 1, ${part.length})`
  return `${sqliteName(column.name)} = ${param}`
}

/** The rows of a table, other than `except`, whose values of a unique key are those of `row`. */
function conflicts(
  connection: Connection,
  table: TableSchema,
  row: ReadonlyMap<ColumnSchema, SqlValue>,
  except?: number | bigint,
): { index: IndexSchema; rowid: number; values: SqlValue[] }[] {
  const found: { index: IndexSchema; rowid: number; values: SqlValue[] }[] = []
  for (const index of table.indexes) {
    if (index.kind !== 'PRIMARY' && index.kind !== 'UNIQUE') continue
    const values = index.parts.map((part) => row.get(columnOf(table, part.column)) ?? null)
    // NULLs are never duplicates.
    if (values.some((value) => value === null)) continue
    const conditions = index.parts.map((part, i) => keyPartSql(table, part, `?${i + 1}`))
    const params = [...values]
    if (except !== undefined) {
      conditions.push(`rowid <> ?${params.length + 1}`)
      params.push(except)
    }
    const [hit] = connection.all(
      `SELECT rowid FROM ${sqliteName(table.name)} WHERE ${conditions.join(' AND ')} LIMIT 1`,
      params,
    )
    if (hit !== undefined) {
      const shown = index.parts.map((part, i) =>
        part.length === undefined
          ? values[i]!
          : [...textOf(values[i]!)].slice(0, part.length).join(''),
      )
      found.push({ index, rowid: Number(hit[0]), values: shown })
    }
  }
  return found
}

/** Fails, or warns and gives false when leniently, for the first foreign key of a row whose parent row does not exist. */
function checkParents(
  connection: Connection,
  table: TableSchema,
  row: ReadonlyMap<ColumnSchema, SqlValue>,
  lenient: boolean,
  columns?: ReadonlySet<ColumnSchema>,
): boolean {
  if (!connection.foreignKeyChecks) return true
  for (const key of table.foreignKeys) {
    const keyColumns = key.columns.map((name) => columnOf(table, name))
    if (columns !== undefined && !keyColumns.some((column) => columns.has(column))) continue
    const values = keyColumns.map((column) => row.get(column) ?? null)
    if (values.some((value) => value === null)) continue
    const parent = connection.database.table(key.table)
    let exists = false
    if (parent !== undefined) {
      const conditions = key.referenced.map(
        (name, i) => `${sqliteName(columnOf(parent, name).name)} = ?${i + 1}`,
      )
      exists =
        connection.all(
          `SELECT 1 FROM ${sqliteName(parent.name)} WHERE ${conditions.join(' AND ')} LIMIT 1`,
          values,
        ).length > 0
    }
    if (!exists) {
      const message = `Cannot add or update a child row: a foreign key constraint fails (${foreignKeyText(connection.database.schema, table.name, key)})`
      if (!lenient) throw new SqlError(1452, '23000', message)
      connection.warn('Warning', 1452, message)
      return false
    }
  }
  return true
}

/** Fails for the first foreign key that refers to rows of `rowids` with rows that RESTRICT, as InnoDB checks parent rows. */
function checkChildren(
  connection: Connection,
  table: TableSchema,
  rowids: readonly number[],
  action: 'delete' | 'update',
  changed?: ReadonlySet<ColumnSchema>,
): void {
  if (!connection.foreignKeyChecks || rowids.length === 0) return
  for (const child of connection.database.tables()) {
    for (const key of child.foreignKeys) {
      if (!sameName(key.table, table.name)) continue
      const rule = action === 'delete' ? key.onDelete : key.onUpdate
      if (rule !== 'RESTRICT' && rule !== 'NO ACTION') continue
      const referenced = key.referenced.map((name) => columnOf(table, name))
      if (changed !== undefined && !referenced.some((column) => changed.has(column))) continue
      const join = key.columns
        .map(
          (name, i) =>
            `c.${sqliteName(columnOf(child, name).name)} = p.${sqliteName(referenced[i]!.name)}`,
        )
        .join(' AND ')
      const sql = `SELECT 1 FROM ${sqliteName(child.name)} AS c JOIN ${sqliteName(table.name)} AS p ON ${join} WHERE p.rowid IN (SELECT value FROM json_each(?1))${sameName(child.name, table.name) ? ' AND c.rowid NOT IN (SELECT value FROM json_each(?1))' : ''} LIMIT 1`
      if (connection.all(sql, [JSON.stringify(rowids)]).length > 0) {
        throw new SqlError(
          1451,
          '23000',
          `Cannot delete or update a parent row: a foreign key constraint fails (${foreignKeyText(connection.database.schema, child.name, key)})`,
        )
      }
    }
  }
}

/** The current time, as a column of `fsp` digits of seconds stores it as its default. */
function nowValue(connection: Connection, fsp: number): string {
  const ms = connection.statementTime
  const whole = Math.floor(ms)
  return formatDateTime(localDateTime(whole, connection.zone, Math.round((ms - whole) * 1000)), fsp)
}

/** Maps SQLite's errors of CHECK constraints of a table to MariaDB's. */
function checked<T>(connection: Connection, table: TableSchema, run: () => T): T {
  try {
    return run()
  } catch (error) {
    if (error instanceof SqlError) throw error
    const message = (error as Error).message
    const check = /CHECK constraint failed: (.*)$/.exec(message)
    if (check !== null) {
      throw new SqlError(
        4025,
        '23000',
        `CONSTRAINT \`${check[1]}\` failed for \`${connection.database.schema}\`.\`${table.name}\``,
      )
    }
    if (/FOREIGN KEY constraint failed/.test(message)) {
      throw new SqlError(
        1451,
        '23000',
        'Cannot delete or update a parent row: a foreign key constraint fails',
      )
    }
    throw error
  }
}

/** The value of each item of a row, by a SELECT of their SQL. */
function evaluate(
  connection: Connection,
  compiler: Compiler,
  values: readonly Compiled[],
  from = '',
): SqlValue[] | undefined {
  if (values.length === 0) return []
  const [row] = connection.all(
    `SELECT ${values.map((value) => value.sql).join(', ')}${from}`,
    compiler.params,
  )
  return row
}

/** The table that a statement changes, or MariaDB's error for one that does not exist or is a view. */
function targetTable(connection: Connection, name: string, statement: string): TableSchema {
  const { database } = connection
  const table = database.table(name)
  if (table !== undefined) return table
  if (database.view(name) !== undefined) {
    throw new SqlError(
      1471,
      'HY000',
      `The target table ${tableKey(name)} of the ${statement} is not insertable-into`,
    )
  }
  throw new SqlError(1146, '42S02', `Table '${database.schema}.${tableKey(name)}' doesn't exist`)
}

/** What a column stores for a row that gives it no value: its default, the current time, or a value the auto-increment gives. */
function defaultValue(
  connection: Connection,
  table: TableSchema,
  column: ColumnSchema,
  sql: string,
  bound: readonly SqlValue[] | undefined,
  row: number,
  lenient: boolean,
): SqlValue | undefined {
  const value = column.default
  if (column.autoIncrement) return undefined
  if (value === undefined) {
    if (column.nullable) return null
    const message = `Field '${column.name}' doesn't have a default value`
    if (!lenient) throw new SqlError(1364, 'HY000', message)
    connection.warn('Warning', 1364, message)
    return implicitDefault(column.type)
  }
  if (value.kind === 'value') return value.value
  if (value.kind === 'now') return nowValue(connection, column.type.length ?? 0)
  const compiler = connection.compiler(sql, bound)
  const compiled = compiler.expression(value.expr, new Scope(), 'field list')
  const [result = null] = evaluate(connection, compiler, [compiled]) ?? []
  return store(connection, table, column, result, row, lenient)
}

function store(
  connection: Connection,
  table: TableSchema,
  column: ColumnSchema,
  value: SqlValue,
  row: number,
  lenient: boolean,
): SqlValue {
  return storeValue(
    value,
    {
      schema: connection.database.schema,
      table: table.name,
      column: column.name,
      type: column.type,
      nullable: column.nullable,
    },
    {
      lenient,
      row,
      zone: connection.database.zone,
      warn: (code, message) => connection.warn('Warning', code, message),
    },
  )
}

/** A scope in which the columns of a table are what a row of VALUES gives them so far: their defaults, until values are given. */
function valuesScope(compiler: Compiler, table: TableSchema): Scope {
  const scope = new Scope([])
  scope.table = table
  for (const column of table.columns) {
    scope.assigned.set(column.name.toLowerCase(), compiler.columnDefault(column))
  }
  return scope
}

/**
 * Inserts rows as MariaDB's INSERT and REPLACE do, row by row: values the
 * rows leave out are the columns' defaults, AUTO_INCREMENT counts on from
 * the table's counter, and rows that duplicate a unique key fail, are
 * skipped by IGNORE, replace those they duplicate with REPLACE, or update
 * them with ON DUPLICATE KEY UPDATE.
 */
export function insertRows(
  connection: Connection,
  insert: Insert,
  sql: string,
  bound: readonly SqlValue[] | undefined,
): Ok {
  const { database } = connection
  let table = targetTable(connection, insert.table.name, 'INSERT')
  const lenient = insert.ignore || !connection.strict
  const source = insert.source
  // The columns the rows give values of.
  const names =
    insert.columns ??
    (source.kind === 'set'
      ? source.assignments.map((assignment) => assignment.column.name)
      : table.columns.map((column) => column.name))
  const columns = names.map((name) => columnOf(table, name))
  const seen = new Set<ColumnSchema>()
  for (const column of columns) {
    if (seen.has(column))
      throw new SqlError(1110, '42000', `Column '${column.name}' specified twice`)
    seen.add(column)
  }
  /** The values of each row, as SQLite's values, or undefined for DEFAULT. */
  const rows: (SqlValue | undefined)[][] = []
  if (source.kind === 'select') {
    const compiler = connection.compiler(sql, bound)
    const compiled = compiler.query(source.select)
    if (compiled.fields.length !== columns.length)
      throw new SqlError(1136, '21S01', "Column count doesn't match value count at row 1")
    rows.push(...connection.all(compiled.sql, compiled.params))
  } else {
    const valueRows =
      source.kind === 'values'
        ? source.rows
        : [source.assignments.map((assignment) => assignment.value)]
    valueRows.forEach((valueRow, index) => {
      const empty = valueRow.length === 0 && insert.columns === undefined
      if (!empty && valueRow.length !== columns.length) {
        throw new SqlError(
          1136,
          '21S01',
          `Column count doesn't match value count at row ${index + 1}`,
        )
      }
      const compiler = connection.compiler(sql, bound)
      compiler.strictDivision = !lenient
      const scope = valuesScope(compiler, table)
      const compiled: (Compiled | undefined)[] = []
      valueRow.forEach((expr, i) => {
        const column = columns[i]!
        if (expr.kind === 'default' && expr.column === undefined) {
          compiled.push(undefined)
          return
        }
        const value = compileValue(compiler, expr, scope)
        compiled.push(value)
        // Later values read the value of an earlier column, as MariaDB's do.
        scope.assigned.set(column.name.toLowerCase(), value)
      })
      const present = compiled.filter((value): value is Compiled => value !== undefined)
      const values = evaluate(connection, compiler, present) ?? []
      let next = 0
      rows.push(compiled.map((value) => (value === undefined ? undefined : values[next++]!)))
    })
  }
  let affected = 0
  let duplicates = 0
  /** The first AUTO_INCREMENT value of a row inserted, which LAST_INSERT_ID() then gives. */
  let firstGenerated: number | bigint | undefined
  /** The AUTO_INCREMENT value of the first row inserted or updated, which the OK packet gives without generated ones. */
  let insertId: number | bigint | undefined
  const autoColumn = table.columns.find((column) => column.autoIncrement)
  rows.forEach((given, index) => {
    const rowNumber = index + 1
    const row = new Map<ColumnSchema, SqlValue>()
    let generatedValue: number | undefined
    for (const column of table.columns) {
      const at = columns.indexOf(column)
      const raw = at === -1 ? undefined : given[at]
      let value: SqlValue | undefined
      if (raw === undefined)
        value = defaultValue(connection, table, column, sql, bound, rowNumber, lenient)
      else if (column.autoIncrement && raw === null) value = undefined
      else value = store(connection, table, column, raw, rowNumber, lenient)
      if (column.autoIncrement && (value === undefined || value === 0 || value === 0n)) {
        // MariaDB counts AUTO_INCREMENT on from the table's counter, which rows that fail use up too.
        const generated = table.autoIncrement
        table = { ...table, autoIncrement: generated + 1 }
        database.setTable(table)
        value = generated
        generatedValue = generated
      } else if (column.autoIncrement && value !== undefined && value !== null) {
        if (Number(value) >= table.autoIncrement) {
          table = { ...table, autoIncrement: Number(value) + 1 }
          database.setTable(table)
        }
      }
      row.set(column, value ?? null)
    }
    const found = conflicts(connection, table, row)
    if (found.length > 0) {
      if (insert.replace) {
        // REPLACE deletes the rows the new one duplicates.
        const rowids = [...new Set(found.map((conflict) => conflict.rowid))]
        checkChildren(connection, table, rowids, 'delete')
        for (const rowid of rowids)
          connection.run(`DELETE FROM ${sqliteName(table.name)} WHERE rowid = ?1`, [rowid])
        affected += rowids.length
        duplicates += rowids.length
      } else if (insert.onDuplicate !== undefined) {
        const conflict = found[0]!
        const updated = updateDuplicate(
          connection,
          table,
          conflict.rowid,
          row,
          insert,
          sql,
          bound,
          lenient,
          rowNumber,
        )
        duplicates++
        affected += updated.changed ? 2 : 1
        if (autoColumn !== undefined) insertId ??= updated.autoValue
        return
      } else {
        const { index: key, values } = found[0]!
        if (!insert.ignore) throw duplicateEntry(values, key)
        connection.warn('Warning', 1062, duplicateEntry(values, key).message)
        duplicates++
        return
      }
    }
    if (!checkParents(connection, table, row, insert.ignore)) return
    const ordered = table.columns.map((column) => row.get(column) ?? null)
    checked(connection, table, () =>
      connection.run(
        `INSERT INTO ${sqliteName(table.name)} (${table.columns.map((column) => sqliteName(column.name)).join(', ')}) VALUES (${ordered.map((_, i) => `?${i + 1}`).join(', ')})`,
        ordered,
      ),
    )
    affected++
    if (generatedValue !== undefined) firstGenerated ??= generatedValue
    if (autoColumn !== undefined) insertId ??= row.get(autoColumn) as number | bigint
  })
  if (firstGenerated !== undefined) connection.lastInsertId = firstGenerated
  const id = firstGenerated ?? insertId ?? 0
  const multiple = rows.length > 1 || source.kind === 'select'
  const info = multiple
    ? `Records: ${rows.length}  Duplicates: ${duplicates}  Warnings: ${connection.warningCount}`
    : ''
  return connection.ok(affected, autoColumn === undefined ? 0 : id, info)
}

/** Compiles a value of a row of INSERT, in which DEFAULT(column) and the columns before it may be read. */
function compileValue(compiler: Compiler, expr: Expression, scope: Scope): Compiled {
  return compiler.expression(expr, scope, 'field list')
}

/** Updates the row that a row to insert duplicates, as ON DUPLICATE KEY UPDATE does, with VALUES() of the row. */
function updateDuplicate(
  connection: Connection,
  table: TableSchema,
  rowid: number,
  row: ReadonlyMap<ColumnSchema, SqlValue>,
  insert: Insert,
  sql: string,
  bound: readonly SqlValue[] | undefined,
  lenient: boolean,
  rowNumber: number,
): { changed: boolean; autoValue: number | bigint | undefined } {
  const compiler = connection.compiler(sql, bound)
  compiler.strictDivision = !lenient
  const scope = new Scope([tableSource(table, table.name)])
  const values = new Map<string, Compiled>()
  for (const column of table.columns) {
    values.set(column.name.toLowerCase(), {
      sql: compiler.bind(row.get(column) ?? null),
      type: columnType(column),
      json: column.type.name === 'JSON',
    })
  }
  scope.values = values
  const assignments = insert.onDuplicate!.map((assignment) => {
    const column = columnOf(table, assignment.column.name)
    if (assignment.column.table !== undefined && !sameName(assignment.column.table, table.name)) {
      throw new SqlError(
        1054,
        '42S22',
        `Unknown column '${assignment.column.table}.${assignment.column.name}' in 'field list'`,
      )
    }
    const value =
      assignment.value.kind === 'default' && assignment.value.column === undefined
        ? compiler.columnDefault(column)
        : compiler.expression(assignment.value, scope, 'field list')
    scope.assigned.set(column.name.toLowerCase(), value)
    return { column, value }
  })
  const evaluated = evaluate(
    connection,
    compiler,
    assignments.map((assignment) => assignment.value),
    ` FROM ${sqliteName(table.name)} WHERE rowid = ${compiler.bind(rowid)}`,
  )!
  const result = applyUpdate(
    connection,
    table,
    rowid,
    assignments.map((assignment, i) => ({
      column: assignment.column,
      value: evaluated[i] ?? null,
    })),
    lenient,
    rowNumber,
    insert.ignore,
  )
  const auto = table.columns.find((column) => column.autoIncrement)
  const autoValue =
    auto === undefined
      ? undefined
      : ((connection.all(
          `SELECT ${sqliteName(auto.name)} FROM ${sqliteName(table.name)} WHERE rowid = ?1`,
          [rowid],
        )[0]?.[0] ?? undefined) as number | bigint | undefined)
  return { changed: result === 'changed', autoValue }
}

/**
 * Stores the new values of a row, as UPDATE does: they are converted as
 * columns store them, and the row is written only if they change it, with
 * the columns that ON UPDATE CURRENT_TIMESTAMP sets. Gives whether it was
 * changed, or skipped for a duplicate key that IGNORE skips.
 */
function applyUpdate(
  connection: Connection,
  table: TableSchema,
  rowid: number,
  assignments: readonly { column: ColumnSchema; value: SqlValue }[],
  lenient: boolean,
  rowNumber: number,
  ignore: boolean,
): 'changed' | 'unchanged' | 'skipped' {
  const [old] = connection.all(
    `SELECT ${table.columns.map((column) => sqliteName(column.name)).join(', ')} FROM ${sqliteName(table.name)} WHERE rowid = ?1`,
    [rowid],
  )
  if (old === undefined) return 'unchanged'
  const row = new Map<ColumnSchema, SqlValue>(
    table.columns.map((column, i) => [column, old[i] ?? null]),
  )
  const changed = new Set<ColumnSchema>()
  for (const { column, value } of assignments) {
    const stored = store(connection, table, column, value, rowNumber, lenient)
    row.set(column, stored)
    if (!sameValue(stored, old[table.columns.indexOf(column)] ?? null)) changed.add(column)
    else changed.delete(column)
  }
  if (changed.size === 0) return 'unchanged'
  for (const column of table.columns) {
    if (column.onUpdateNow && !assignments.some((assignment) => assignment.column === column)) {
      row.set(column, nowValue(connection, column.type.length ?? 0))
      changed.add(column)
    }
  }
  const touchesKey = table.indexes.some(
    (index) =>
      (index.kind === 'PRIMARY' || index.kind === 'UNIQUE') &&
      index.parts.some((part) => changed.has(columnOf(table, part.column))),
  )
  if (touchesKey) {
    const found = conflicts(connection, table, row, rowid)
    if (found.length > 0) {
      const { index, values } = found[0]!
      if (!ignore) throw duplicateEntry(values, index)
      connection.warn('Warning', 1062, duplicateEntry(values, index).message)
      return 'skipped'
    }
  }
  if (!checkParents(connection, table, row, ignore, changed)) return 'skipped'
  checkChildren(connection, table, [rowid], 'update', changed)
  const columns = [...changed]
  checked(connection, table, () =>
    connection.run(
      `UPDATE ${sqliteName(table.name)} SET ${columns.map((column, i) => `${sqliteName(column.name)} = ?${i + 1}`).join(', ')} WHERE rowid = ?${columns.length + 1}`,
      [...columns.map((column) => row.get(column) ?? null), rowid],
    ),
  )
  return 'changed'
}

/** The tables of FROM, flattened from their joins. */
function tablesOf(refs: Update['tables']): Extract<Update['tables'][number], { kind: 'table' }>[] {
  const found: Extract<Update['tables'][number], { kind: 'table' }>[] = []
  const visit = (ref: Update['tables'][number]) => {
    if (ref.kind === 'table') found.push(ref)
    else if (ref.kind === 'join') {
      visit(ref.left)
      visit(ref.right)
    }
  }
  refs.forEach(visit)
  return found
}

/** ORDER BY ... LIMIT ... of UPDATE and DELETE, or the primary key's order, in which InnoDB visits rows. */
function orderSql(
  compiler: Compiler,
  scope: Scope,
  table: TableSchema,
  alias: string,
  orderBy: readonly OrderItem[] | undefined,
  limit: Expression | undefined,
): string {
  let sql = ''
  if (orderBy !== undefined) {
    sql += ` ORDER BY ${orderBy.map((item) => `${compiler.expression(item.expr, scope, 'order clause').sql}${item.descending ? ' DESC' : ''}`).join(', ')}`
  } else {
    const primary = table.indexes.find((index) => index.kind === 'PRIMARY')
    sql +=
      primary === undefined
        ? ` ORDER BY ${sqliteName(alias)}.rowid`
        : ` ORDER BY ${primary.parts.map((part) => `${sqliteName(alias)}.${sqliteName(part.column)}`).join(', ')}`
  }
  if (limit !== undefined) sql += ` LIMIT ${compiler.expression(limit, scope, 'field list').sql}`
  return sql
}

/**
 * Updates rows as MariaDB's UPDATE does, row by row, in the order of the
 * primary key or of ORDER BY: assignments read the values of those before
 * them, values convert as columns store them, rows that the values do not
 * change are matched but not changed, and joins update the rows of one
 * table by those of others.
 */
export function updateRows(
  connection: Connection,
  update: Update,
  sql: string,
  bound: readonly SqlValue[] | undefined,
): Ok {
  const compiler = connection.compiler(sql, bound)
  const lenient = update.ignore || !connection.strict
  compiler.strictDivision = !lenient
  const scope = new Scope()
  const from = compiler.fromClause(update.tables, scope)
  const refs = tablesOf(update.tables)
  // The table whose columns the assignments name.
  const targets = new Set<string>()
  const resolved = update.set.map((assignment) => {
    const name = assignment.column
    const candidates = refs.filter((ref) => {
      const alias = ref.alias ?? ref.table.name
      if (name.table !== undefined) return sameName(alias, name.table)
      const table = connection.database.table(ref.table.name)
      return table?.columns.some((column) => sameName(column.name, name.name)) === true
    })
    const shown = name.table === undefined ? name.name : `${name.table}.${name.name}`
    if (candidates.length === 0)
      throw new SqlError(1054, '42S22', `Unknown column '${shown}' in 'field list'`)
    if (candidates.length > 1)
      throw new SqlError(1052, '23000', `Column '${name.name}' in field list is ambiguous`)
    const ref = candidates[0]!
    const alias = ref.alias ?? ref.table.name
    targets.add(alias.toLowerCase())
    const table = targetTable(connection, ref.table.name, 'UPDATE')
    return { alias, table, column: columnOf(table, name.name), value: assignment.value }
  })
  if (targets.size > 1) throw unsupported('UPDATE of columns of more than one table')
  const { alias, table } = resolved[0]!
  const multiTable = update.tables.length > 1 || update.tables[0]!.kind === 'join'
  if (multiTable && (update.orderBy !== undefined || update.limit !== undefined)) {
    throw new SqlError(
      1221,
      'HY000',
      `Incorrect usage of UPDATE and ${update.orderBy !== undefined ? 'ORDER BY' : 'LIMIT'}`,
    )
  }
  const condition =
    update.where === undefined
      ? undefined
      : compiler.expression(update.where, scope, 'where clause').sql
  const where = condition === undefined ? '' : ` WHERE ${condition}`
  const order = multiTable
    ? ''
    : orderSql(compiler, scope, table, alias, update.orderBy, update.limit)
  const distinct = multiTable ? 'DISTINCT ' : ''
  const rowids = connection
    .all(
      `SELECT ${distinct}${sqliteName(alias)}.rowid FROM ${from}${where}${order}`,
      compiler.params,
    )
    .map(([rowid]) => Number(rowid))
  // The values of the assignments, of the row of the join of each rowid, each reading those before it.
  const values = resolved.map((assignment) => {
    const value =
      assignment.value.kind === 'default' && assignment.value.column === undefined
        ? compiler.columnDefault(assignment.column)
        : compiler.expression(assignment.value, scope, 'field list')
    scope.assigned.set(assignment.column.name.toLowerCase(), value)
    return value
  })
  const rowParam = compiler.bind(0)
  const select = `SELECT ${values.map((value) => value.sql).join(', ')} FROM ${from} WHERE ${sqliteName(alias)}.rowid = ${rowParam}${condition === undefined ? '' : ` AND (${condition})`} LIMIT 1`
  const rowIndex = Number(rowParam.slice(1)) - 1
  let matched = 0
  let changed = 0
  rowids.forEach((rowid, index) => {
    compiler.params[rowIndex] = rowid
    const [row] = connection.all(select, compiler.params)
    if (row === undefined) return
    matched++
    const outcome = applyUpdate(
      connection,
      table,
      rowid,
      resolved.map((assignment, i) => ({ column: assignment.column, value: row[i] ?? null })),
      lenient,
      index + 1,
      update.ignore,
    )
    if (outcome === 'changed') changed++
  })
  return connection.ok(
    matched,
    0,
    `Rows matched: ${matched}  Changed: ${changed}  Warnings: ${connection.warningCount}`,
    changed,
  )
}

/**
 * Deletes rows as MariaDB's DELETE does: of one table, maybe in an order
 * and up to a limit, or of the tables of a join, with the rows of each
 * found before any goes. RETURNING gives the rows that went.
 */
export function deleteRows(
  connection: Connection,
  statement: Delete,
  sql: string,
  bound: readonly SqlValue[] | undefined,
): Result {
  const compiler = connection.compiler(sql, bound)
  const scope = new Scope()
  const from = compiler.fromClause(statement.from, scope)
  const refs = tablesOf(statement.from)
  const targets = statement.targets ?? [
    refs[0]!.alias === undefined ? refs[0]!.table : { name: refs[0]!.alias },
  ]
  const where =
    statement.where === undefined
      ? ''
      : ` WHERE ${compiler.expression(statement.where, scope, 'where clause').sql}`
  const deletions = targets.map((target) => {
    const ref = refs.find((candidate) =>
      sameName(candidate.alias ?? candidate.table.name, target.name),
    )
    if (ref === undefined)
      throw new SqlError(1109, '42S02', `Unknown table '${target.name}' in MULTI DELETE`)
    const alias = ref.alias ?? ref.table.name
    const table = targetTable(connection, ref.table.name, 'DELETE')
    const order =
      statement.targets === undefined
        ? orderSql(compiler, scope, table, alias, statement.orderBy, statement.limit)
        : ''
    const distinct = statement.targets === undefined ? '' : 'DISTINCT '
    const rowids = connection
      .all(
        `SELECT ${distinct}${sqliteName(alias)}.rowid FROM ${from}${where}${order}`,
        compiler.params,
      )
      .map(([rowid]) => Number(rowid))
    return { table, alias, rowids }
  })
  let returned:
    | { kind: 'rows'; fields: ReturnType<Compiler['query']>['fields']; rows: SqlValue[][] }
    | undefined
  if (statement.returning !== undefined) {
    const { table, alias, rowids } = deletions[0]!
    const returning = connection.compiler(sql, bound)
    const query = returning.query({
      kind: 'select',
      body: {
        kind: 'core',
        distinct: false,
        calcFoundRows: false,
        items: statement.returning,
        from: [{ kind: 'table', table: { name: table.name }, alias, start: 0, end: 0 }],
        start: 0,
        end: 0,
      },
      locking: false,
      start: 0,
      end: 0,
    })
    const rows = connection.all(
      `SELECT * FROM (${query.sql.replace(/^SELECT /, `SELECT ${sqliteName(alias)}.rowid AS fr_rowid, `)}) WHERE fr_rowid IN (SELECT value FROM json_each(?${query.params.length + 1})) ORDER BY fr_rowid`,
      [...query.params, JSON.stringify(rowids)],
    )
    returned = { kind: 'rows', fields: query.fields, rows: rows.map((row) => row.slice(1)) }
  }
  let affected = 0
  for (const { table, rowids } of deletions) {
    if (rowids.length === 0) continue
    checkChildren(connection, table, rowids, 'delete')
    affected += checked(connection, table, () =>
      connection.run(
        `DELETE FROM ${sqliteName(table.name)} WHERE rowid IN (SELECT value FROM json_each(?1))`,
        [JSON.stringify(rowids)],
      ),
    )
  }
  if (returned !== undefined) return returned
  return connection.ok(affected)
}
