import type { AlterAction, CreateTable, DataType, Statement } from './ast.ts'
import { Scope, type Field, type Source } from './compile.ts'
import type { Connection, Result } from './database.ts'
import { SqlError } from './lexer.ts'
import {
  alterTableSchema,
  buildTable,
  columnType,
  copyTable,
  sameName,
  sqliteCreateIndex,
  sqliteCreateTable,
  sqliteName,
  tableKey,
  type CheckSchema,
  type ColumnSchema,
  type ForeignKeySchema,
  type IndexSchema,
  type TableSchema,
} from './schema.ts'
import type { SqlValue } from './sqlite.ts'
import { formatDateTime, localDateTime } from './temporal.ts'
import type { Type } from './types.ts'
import { foldText, implicitDefault, storeValue, textOf } from './values.ts'

type Ok = Extract<Result, { kind: 'ok' }>

/**
 * Runs what changes a table in a transaction of SQLite, with its foreign
 * keys off, as SQLite needs to rebuild tables, so that it changes all or
 * nothing. Inside a transaction, as temporary tables are created, it runs in
 * a savepoint.
 */
function atomically<T>(connection: Connection, run: () => T): T {
  const { inTransaction, database } = connection
  database.foreignKeys(false)
  connection.run(inTransaction ? 'SAVEPOINT fr_table' : 'BEGIN')
  try {
    const result = run()
    connection.run(inTransaction ? 'RELEASE fr_table' : 'COMMIT')
    return result
  } catch (error) {
    connection.run(inTransaction ? 'ROLLBACK TO fr_table' : 'ROLLBACK')
    if (inTransaction) connection.run('RELEASE fr_table')
    throw error
  } finally {
    database.foreignKeys(connection.foreignKeyChecks)
  }
}

/** The SQL of a check of a table, compiled with its values written in, as SQLite keeps it. */
function checkSql(connection: Connection, table: TableSchema, check: CheckSchema): string {
  const compiler = connection.compiler(check.sql)
  compiler.inline = true
  // SQLite's checks name the table's columns without the table.
  const source: Source = {
    alias: table.name,
    orgTable: table.name,
    table,
    columns: table.columns.map((column) => ({
      name: column.name,
      type: columnType(column),
      sql: sqliteName(column.name),
      json: column.type.name === 'JSON',
      orgTable: table.name,
      orgName: column.name,
      schema: column,
    })),
  }
  return compiler.expression(check.expr, new Scope([source]), 'CHECK').sql
}

/** Whether SQLite can keep a foreign key: when the table it refers to has a unique key of exactly its columns, or does not exist yet. */
function keepsForeignKey(
  connection: Connection,
  table: TableSchema,
  key: ForeignKeySchema,
): boolean {
  const parent = sameName(key.table, table.name) ? table : connection.database.table(key.table)
  if (parent === undefined) return true
  return parent.indexes.some(
    (index) =>
      (index.kind === 'PRIMARY' || index.kind === 'UNIQUE') &&
      index.parts.length === key.referenced.length &&
      index.parts.every(
        (part) =>
          part.length === undefined &&
          key.referenced.some((column) => sameName(column, part.column)),
      ),
  )
}

/** Creates a table in SQLite, with its indexes. */
function createInSqlite(connection: Connection, table: TableSchema, name = table.name): void {
  connection.run(
    sqliteCreateTable(
      table,
      (check) => checkSql(connection, table, check),
      (key) => keepsForeignKey(connection, table, key),
      name,
    ),
  )
  if (name !== table.name) return
  for (const index of table.indexes) {
    if (index.kind !== 'PRIMARY') connection.run(sqliteCreateIndex(table, index))
  }
}

/** Runs a statement that changes tables, views or the database. */
export function runTableStatement(connection: Connection, statement: Statement, sql: string): Ok {
  switch (statement.kind) {
    case 'createTable':
      return createTable(connection, statement, sql)
    case 'alterTable': {
      const table = connection.database.table(statement.table.name)
      if (table === undefined) {
        if (statement.ifExists) {
          connection.warn(
            'Note',
            1146,
            `Table '${connection.database.schema}.${tableKey(statement.table.name)}' doesn't exist`,
          )
          return connection.ok(0)
        }
        throw missingTable(connection, statement.table.name)
      }
      return alterTable(connection, table, statement.actions, sql)
    }
    case 'createIndex': {
      const table = connection.database.table(statement.table.name)
      if (table === undefined) throw missingTable(connection, statement.table.name)
      const actions: AlterAction[] = []
      if (
        statement.orReplace &&
        table.indexes.some((index) => sameName(index.name, statement.name))
      ) {
        actions.push({ kind: 'dropIndex', ifExists: true, name: statement.name })
      }
      actions.push({
        kind: 'addConstraint',
        ifNotExists: statement.ifNotExists,
        constraint: {
          kind: statement.unique ? 'UNIQUE' : 'INDEX',
          name: statement.name,
          parts: statement.parts,
        },
      })
      return alterTable(connection, table, actions, sql)
    }
    case 'dropIndex': {
      const table = connection.database.table(statement.table.name)
      if (table === undefined) throw missingTable(connection, statement.table.name)
      const action: AlterAction = sameName(statement.name, 'PRIMARY')
        ? { kind: 'dropPrimaryKey' }
        : { kind: 'dropIndex', ifExists: statement.ifExists, name: statement.name }
      return alterTable(connection, table, [action], sql)
    }
    case 'dropTable':
      return dropTables(
        connection,
        statement.tables.map((table) => table.name),
        statement.ifExists,
      )
    case 'truncate':
      return truncate(connection, statement.table.name)
    case 'renameTable':
      return renameTables(
        connection,
        statement.renames.map(({ from, to }) => ({ from: from.name, to: to.name })),
      )
    case 'createView':
      return createView(connection, statement, sql)
    case 'dropView': {
      const missing = statement.views.filter(
        (view) => connection.database.view(view.name) === undefined,
      )
      if (missing.length > 0 && !statement.ifExists) {
        throw new SqlError(
          4092,
          '42S02',
          `Unknown VIEW: '${missing.map((view) => `${connection.database.schema}.${tableKey(view.name)}`).join(',')}'`,
        )
      }
      for (const view of missing)
        connection.warn(
          'Note',
          4092,
          `Unknown VIEW: '${connection.database.schema}.${tableKey(view.name)}'`,
        )
      for (const view of statement.views) connection.database.deleteView(view.name)
      return connection.ok(0)
    }
    case 'createDatabase':
      return connection.ok(1)
    case 'dropDatabase': {
      // The one database there is is dropped with its tables.
      const names = connection.database.tables().map((table) => table.name)
      for (const view of connection.database.views()) connection.database.deleteView(view.name)
      if (names.length > 0) {
        atomically(connection, () => {
          for (const name of names) connection.run(`DROP TABLE ${sqliteName(name)}`)
        })
      }
      for (const name of names) connection.database.deleteTable(name)
      return connection.ok(names.length)
    }
    default:
      throw new Error(`${statement.kind} changes no table`)
  }
}

function missingTable(connection: Connection, name: string): SqlError {
  return new SqlError(
    1146,
    '42S02',
    `Table '${connection.database.schema}.${tableKey(name)}' doesn't exist`,
  )
}

function exists(connection: Connection, name: string): boolean {
  return (
    connection.database.table(name) !== undefined || connection.database.view(name) !== undefined
  )
}

/** The type of a column that CREATE TABLE ... SELECT gives a column of a result of a type. */
function columnTypeOf(type: Type): DataType {
  const unsigned = type.unsigned === true ? { unsigned: true } : {}
  switch (type.field) {
    case 'TINY':
      return { name: 'TINYINT', length: type.length, ...unsigned }
    case 'SHORT':
      return { name: 'SMALLINT', length: type.length, ...unsigned }
    case 'INT24':
      return { name: 'MEDIUMINT', length: type.length, ...unsigned }
    case 'LONG':
      return { name: 'INT', length: type.length, ...unsigned }
    case 'LONGLONG':
      return type.length <= 11
        ? { name: 'INT', length: Math.max(type.length, 1), ...unsigned }
        : { name: 'BIGINT', length: type.length, ...unsigned }
    case 'NEWDECIMAL': {
      const digits = Math.max(
        1,
        type.length - (type.decimals > 0 ? 1 : 0) - (type.unsigned === true ? 0 : 1),
      )
      return { name: 'DECIMAL', length: Math.min(digits, 65), scale: type.decimals, ...unsigned }
    }
    case 'FLOAT':
      return { name: 'FLOAT', ...unsigned }
    case 'DOUBLE':
      return { name: 'DOUBLE', ...unsigned }
    case 'BIT':
      return { name: 'BIT', length: type.length }
    case 'YEAR':
      return { name: 'YEAR' }
    case 'DATE':
      return { name: 'DATE' }
    case 'TIME':
      return { name: 'TIME', length: type.decimals }
    case 'DATETIME':
      return { name: 'DATETIME', length: type.decimals }
    case 'TIMESTAMP':
      return { name: 'TIMESTAMP', length: type.decimals }
    case 'NULL':
      return { name: 'BINARY', length: 0 }
    case 'BLOB':
      return { name: type.binary === true ? 'LONGBLOB' : 'LONGTEXT' }
    default:
      if (type.binary === true) return { name: 'VARBINARY', length: Math.max(type.length, 1) }
      return type.length > 16383
        ? { name: 'LONGTEXT' }
        : { name: 'VARCHAR', length: Math.max(type.length, 1) }
  }
}

function createTable(connection: Connection, create: CreateTable, sql: string): Ok {
  const { database } = connection
  const name = tableKey(create.table.name)
  if (exists(connection, name)) {
    if (create.ifNotExists) {
      connection.warn('Note', 1050, `Table '${name}' already exists`)
      return connection.ok(0)
    }
    if (!create.orReplace || database.view(name) !== undefined)
      throw new SqlError(1050, '42S01', `Table '${name}' already exists`)
  }
  const context = connection.schemaContext()
  let table: TableSchema
  let rows: readonly (readonly SqlValue[])[] = []
  let selected: Field[] = []
  if (create.like !== undefined) {
    const source = database.table(create.like.name)
    if (source === undefined) throw missingTable(connection, create.like.name)
    table = copyTable(source, name, create.temporary)
  } else if (create.select !== undefined) {
    const compiler = connection.compiler(sql)
    const query = compiler.query(create.select)
    selected = query.fields
    rows = connection.all(query.sql, query.params)
    // The columns of the definition come first, then those of the query that the definition does not name.
    const defined = new Set(create.columns.map((column) => column.name.toLowerCase()))
    const columns = [
      ...create.columns,
      ...query.fields
        .filter((field) => !defined.has(field.name.toLowerCase()))
        .map((field) => ({
          name: field.name,
          type: columnTypeOf(field.type),
          nullable: true,
          autoIncrement: false,
        })),
    ]
    table = buildTable({ ...create, columns }, sql, context)
  } else {
    table = buildTable(create, sql, context)
  }
  atomically(connection, () => {
    if (create.orReplace && database.table(name) !== undefined) {
      connection.run(`DROP TABLE ${sqliteName(name)}`)
      database.deleteTable(name)
    }
    createInSqlite(connection, table)
    if (create.select !== undefined) {
      rows.forEach((row, index) => {
        const values = table.columns.map((column) => {
          const at = selected.findIndex((field) => sameName(field.name, column.name))
          const value = at === -1 ? null : (row[at] ?? null)
          return storeValue(
            value,
            {
              schema: database.schema,
              table: name,
              column: column.name,
              type: column.type,
              nullable: column.nullable,
            },
            { lenient: !connection.strict, row: index + 1, zone: database.zone },
          )
        })
        connection.run(
          `INSERT INTO ${sqliteName(name)} (${table.columns.map((column) => sqliteName(column.name)).join(', ')}) VALUES (${values.map((_, i) => `?${i + 1}`).join(', ')})`,
          values,
        )
      })
    }
  })
  database.setTable(table)
  if (create.select !== undefined) {
    return connection.ok(
      rows.length,
      0,
      `Records: ${rows.length}  Duplicates: 0  Warnings: ${connection.warningCount}`,
    )
  }
  return connection.ok(0)
}

/** The column each column of an altered table has its values from, by the renames of the actions. */
function sourcesOf(table: TableSchema, actions: readonly AlterAction[]): Map<string, string> {
  // The name each column of the table has, as the actions rename them, by its old name.
  const current = new Map<string, string>(
    table.columns.map((column) => [column.name.toLowerCase(), column.name]),
  )
  for (const action of actions) {
    if (action.kind === 'changeColumn' && !sameName(action.name, action.column.name)) {
      for (const [old, now] of current)
        if (sameName(now, action.name)) current.set(old, action.column.name)
    } else if (action.kind === 'renameColumn') {
      for (const [old, now] of current) if (sameName(now, action.from)) current.set(old, action.to)
    } else if (action.kind === 'dropColumn') {
      for (const [old, now] of current) if (sameName(now, action.name)) current.delete(old)
    }
  }
  const sources = new Map<string, string>()
  for (const [old, now] of current) sources.set(now.toLowerCase(), old)
  return sources
}

/** Whether SQLite must rebuild a table for a change: of its columns, their types, its primary key, foreign keys or checks. */
function needsRebuild(before: TableSchema, after: TableSchema): boolean {
  if (before.columns.length !== after.columns.length) return true
  for (let i = 0; i < before.columns.length; i++) {
    const a = before.columns[i]!
    const b = after.columns[i]!
    if (
      a.name !== b.name ||
      a.nullable !== b.nullable ||
      a.collation !== b.collation ||
      JSON.stringify(a.type) !== JSON.stringify(b.type)
    )
      return true
  }
  const primary = (table: TableSchema) =>
    JSON.stringify(table.indexes.find((index) => index.kind === 'PRIMARY') ?? null)
  if (primary(before) !== primary(after)) return true
  if (JSON.stringify(before.foreignKeys) !== JSON.stringify(after.foreignKeys)) return true
  return (
    JSON.stringify(before.checks.map((check) => check.sql)) !==
    JSON.stringify(after.checks.map((check) => check.sql))
  )
}

/** The value a column of an altered table gets for an existing row that has none for it: its default. */
function addedValue(connection: Connection, column: ColumnSchema): SqlValue {
  const value = column.default
  if (value === undefined) return column.nullable ? null : implicitDefault(column.type)
  if (value.kind === 'value') return value.value
  if (value.kind === 'now') {
    const ms = connection.statementTime
    return formatDateTime(localDateTime(Math.floor(ms), connection.zone), column.type.length ?? 0)
  }
  const compiler = connection.compiler('')
  const compiled = compiler.expression(value.expr, new Scope(), 'field list')
  const [[result = null] = []] = connection.all(`SELECT ${compiled.sql}`, compiler.params)
  return result
}

/** Checks that no two rows have the same values of a unique key of a table, as MariaDB's errors say. */
function checkUnique(
  table: TableSchema,
  index: IndexSchema,
  rows: readonly (readonly SqlValue[])[],
): void {
  if (index.kind !== 'PRIMARY' && index.kind !== 'UNIQUE') return
  const positions = index.parts.map((part) =>
    table.columns.findIndex((column) => sameName(column.name, part.column)),
  )
  const seen = new Set<string>()
  for (const row of rows) {
    const values = index.parts.map((part, i) => {
      const value = row[positions[i]!] ?? null
      return value !== null && part.length !== undefined
        ? [...textOf(value)].slice(0, part.length).join('')
        : value
    })
    if (values.some((value) => value === null)) continue
    const key = JSON.stringify(
      values.map((value, i) => {
        const column = table.columns[positions[i]!]!
        const text = value instanceof Uint8Array ? [...value].join(',') : textOf(value!)
        return /_ci$/.test(column.collation) ? foldText(text) : `${typeof value}:${text}`
      }),
    )
    if (seen.has(key)) {
      throw new SqlError(
        1062,
        '23000',
        `Duplicate entry '${values.map((value) => textOf(value!)).join('-')}' for key '${index.name}'`,
      )
    }
    seen.add(key)
  }
}

function alterTable(
  connection: Connection,
  table: TableSchema,
  actions: readonly AlterAction[],
  sql: string,
): Ok {
  const { database } = connection
  const context = connection.schemaContext()
  let altered = alterTableSchema(table, actions, sql, context)
  const rename = actions.filter((action) => action.kind === 'renameTable').at(-1)
  const newName = rename === undefined ? table.name : tableKey(rename.to.name)
  if (newName !== table.name && exists(connection, newName))
    throw new SqlError(1050, '42S01', `Table '${newName}' already exists`)
  const options = actions.filter((action) => action.kind === 'options')
  for (const action of options) {
    if (action.options.autoIncrement !== undefined) {
      // The counter goes no lower than past the greatest value the table has.
      const auto = altered.columns.find((column) => column.autoIncrement)
      if (auto !== undefined) {
        const [[max = 0] = []] = connection.all(
          `SELECT MAX(${sqliteName(auto.name)}) FROM ${sqliteName(table.name)}`,
        )
        altered = {
          ...altered,
          autoIncrement: Math.max(action.options.autoIncrement, Number(max ?? 0) + 1),
        }
      }
    }
  }
  let affected = 0
  atomically(connection, () => {
    if (needsRebuild(table, altered)) {
      const sources = sourcesOf(table, actions)
      const old = connection.all(
        `SELECT ${table.columns.map((column) => sqliteName(column.name)).join(', ')} FROM ${sqliteName(table.name)} ORDER BY rowid`,
      )
      const converted = old.map((row, index) =>
        altered.columns.map((column) => {
          const from = sources.get(column.name.toLowerCase())
          const at =
            from === undefined
              ? -1
              : table.columns.findIndex((existing) => sameName(existing.name, from))
          if (at === -1) return addedValue(connection, column)
          const before = table.columns[at]!
          const value = row[at] ?? null
          if (
            JSON.stringify(before.type) === JSON.stringify(column.type) &&
            (column.nullable || value !== null)
          )
            return value
          if (value === null && !column.nullable) {
            if (connection.strict)
              throw new SqlError(
                1265,
                '01000',
                `Data truncated for column '${column.name}' at row ${index + 1}`,
              )
            connection.warn(
              'Warning',
              1265,
              `Data truncated for column '${column.name}' at row ${index + 1}`,
            )
            return implicitDefault(column.type)
          }
          try {
            return storeValue(
              value,
              {
                schema: database.schema,
                table: table.name,
                column: column.name,
                type: column.type,
                nullable: column.nullable,
              },
              {
                lenient: !connection.strict,
                row: index + 1,
                zone: database.zone,
                warn: (code, message) => connection.warn('Warning', code, message),
              },
            )
          } catch (error) {
            // Values that no longer fit are data truncated, as MariaDB's copies of tables have them.
            if (error instanceof SqlError && error.errno === 1406) {
              throw new SqlError(
                1265,
                '01000',
                `Data truncated for column '${column.name}' at row ${index + 1}`,
              )
            }
            throw error
          }
        }),
      )
      for (const index of altered.indexes) checkUnique(altered, index, converted)
      const temporary = `fr_rebuild_${table.name}`
      createInSqlite(connection, altered, temporary)
      for (const row of converted) {
        connection.run(
          `INSERT INTO ${sqliteName(temporary)} (${altered.columns.map((column) => sqliteName(column.name)).join(', ')}) VALUES (${row.map((_, i) => `?${i + 1}`).join(', ')})`,
          row,
        )
      }
      connection.run(`DROP TABLE ${sqliteName(table.name)}`)
      connection.run(`ALTER TABLE ${sqliteName(temporary)} RENAME TO ${sqliteName(table.name)}`)
      for (const index of altered.indexes) {
        if (index.kind !== 'PRIMARY') connection.run(sqliteCreateIndex(altered, index))
      }
      affected = converted.length
    } else {
      // Only keys changed, which SQLite indexes on their own.
      const key = (index: IndexSchema) => JSON.stringify(index)
      const before = new Set(table.indexes.map(key))
      const after = new Set(altered.indexes.map(key))
      for (const index of table.indexes) {
        if (index.kind !== 'PRIMARY' && !after.has(key(index)))
          connection.run(`DROP INDEX ${sqliteName(`${table.name}.${index.name.toLowerCase()}`)}`)
      }
      const added = altered.indexes.filter(
        (index) => index.kind !== 'PRIMARY' && !before.has(key(index)),
      )
      if (added.some((index) => index.kind === 'UNIQUE')) {
        const rows = connection.all(
          `SELECT ${altered.columns.map((column) => sqliteName(column.name)).join(', ')} FROM ${sqliteName(table.name)} ORDER BY rowid`,
        )
        for (const index of added) checkUnique(altered, index, rows)
      }
      for (const index of added) connection.run(sqliteCreateIndex(altered, index))
    }
    if (newName !== table.name) renameInSqlite(connection, altered, newName)
  })
  database.deleteTable(table.name)
  const result = newName === table.name ? altered : { ...altered, name: newName }
  database.setTable(result)
  if (newName !== table.name) renameReferences(connection, table.name, newName)
  return connection.ok(
    0,
    0,
    affected > 0 ? `Records: ${affected}  Duplicates: 0  Warnings: ${connection.warningCount}` : '',
  )
}

/** Renames a table in SQLite, with its indexes, which SQLite keeps by names of their own. */
function renameInSqlite(connection: Connection, table: TableSchema, name: string): void {
  for (const index of table.indexes) {
    if (index.kind !== 'PRIMARY')
      connection.run(`DROP INDEX ${sqliteName(`${table.name}.${index.name.toLowerCase()}`)}`)
  }
  connection.run(`ALTER TABLE ${sqliteName(table.name)} RENAME TO ${sqliteName(name)}`)
  const renamed = { ...table, name }
  for (const index of table.indexes) {
    if (index.kind !== 'PRIMARY') connection.run(sqliteCreateIndex(renamed, index))
  }
}

/** Points the foreign keys of the database's tables that refer to a table at its new name. */
function renameReferences(connection: Connection, from: string, to: string): void {
  for (const table of connection.database.tables()) {
    if (!table.foreignKeys.some((key) => sameName(key.table, from))) continue
    connection.database.setTable({
      ...table,
      foreignKeys: table.foreignKeys.map((key) =>
        sameName(key.table, from) ? { ...key, table: to } : key,
      ),
    })
  }
}

/** Fails for a foreign key of another table that refers to one of `names`, as MariaDB keeps parents of foreign keys from going. */
function checkReferenced(
  connection: Connection,
  names: readonly string[],
  error: (child: TableSchema, key: ForeignKeySchema) => SqlError,
): void {
  if (!connection.foreignKeyChecks) return
  for (const child of connection.database.tables()) {
    if (names.some((name) => sameName(name, child.name))) continue
    for (const key of child.foreignKeys) {
      if (names.some((name) => sameName(name, key.table))) throw error(child, key)
    }
  }
}

function dropTables(connection: Connection, names: readonly string[], ifExists: boolean): Ok {
  const { database } = connection
  const keys = names.map(tableKey)
  const found = keys.filter((key) => database.table(key) !== undefined)
  const missing = keys.filter((key) => database.table(key) === undefined)
  checkReferenced(
    connection,
    found,
    () =>
      new SqlError(
        1451,
        '23000',
        'Cannot delete or update a parent row: a foreign key constraint fails',
      ),
  )
  if (found.length > 0) {
    atomically(connection, () => {
      for (const key of found) connection.run(`DROP TABLE ${sqliteName(key)}`)
    })
    for (const key of found) database.deleteTable(key)
  }
  if (missing.length > 0) {
    const list = missing.map((key) => `${database.schema}.${key}`).join(',')
    if (!ifExists) throw new SqlError(1051, '42S02', `Unknown table '${list}'`)
    for (const key of missing)
      connection.warn('Note', 1051, `Unknown table '${database.schema}.${key}'`)
  }
  return connection.ok(0)
}

function truncate(connection: Connection, name: string): Ok {
  const { database } = connection
  const table = database.table(name)
  if (table === undefined) throw missingTable(connection, name)
  checkReferenced(connection, [table.name], (child, key) => {
    const text = `\`${database.schema}\`.\`${child.name}\`, CONSTRAINT \`${key.name}\` FOREIGN KEY (${key.columns.map((column) => `\`${column}\``).join(', ')}) REFERENCES \`${database.schema}\`.\`${key.table}\` (${key.referenced.map((column) => `\`${column}\``).join(', ')})`
    return new SqlError(
      1701,
      '42000',
      `Cannot truncate a table referenced in a foreign key constraint (${text})`,
    )
  })
  atomically(connection, () => connection.run(`DELETE FROM ${sqliteName(table.name)}`))
  database.setTable({ ...table, autoIncrement: 1 })
  return connection.ok(0)
}

function renameTables(
  connection: Connection,
  renames: readonly { from: string; to: string }[],
): Ok {
  const { database } = connection
  atomically(connection, () => {
    for (const { from, to } of renames) {
      const source = tableKey(from)
      const target = tableKey(to)
      if (exists(connection, target))
        throw new SqlError(1050, '42S01', `Table '${target}' already exists`)
      const table = database.table(source)
      const view = database.view(source)
      if (table !== undefined) {
        renameInSqlite(connection, table, target)
        database.deleteTable(source)
        database.setTable({ ...table, name: target })
        renameReferences(connection, source, target)
      } else if (view !== undefined) {
        database.deleteView(source)
        database.setView({ ...view, name: target })
      } else {
        throw missingTable(connection, from)
      }
    }
  })
  return connection.ok(0)
}

function createView(
  connection: Connection,
  statement: Extract<Statement, { kind: 'createView' }>,
  sql: string,
): Ok {
  const { database } = connection
  const name = tableKey(statement.view.name)
  if (database.table(name) !== undefined)
    throw new SqlError(1050, '42S01', `Table '${name}' already exists`)
  if (database.view(name) !== undefined && !statement.orReplace) {
    if (statement.ifNotExists) {
      connection.warn('Note', 1050, `Table '${name}' already exists`)
      return connection.ok(0)
    }
    throw new SqlError(1050, '42S01', `Table '${name}' already exists`)
  }
  // The query is checked as it is compiled.
  const compiled = connection.compiler(sql).query(statement.select)
  if (statement.columns !== undefined && statement.columns.length !== compiled.fields.length) {
    throw new SqlError(
      1353,
      'HY000',
      "View's SELECT and view's field list have different column counts",
    )
  }
  const seen = new Set<string>()
  for (const columnName of statement.columns ?? compiled.fields.map((field) => field.name)) {
    if (seen.has(columnName.toLowerCase()))
      throw new SqlError(1060, '42S21', `Duplicate column name '${columnName}'`)
    seen.add(columnName.toLowerCase())
  }
  database.setView({
    name,
    ...(statement.columns === undefined ? {} : { columns: statement.columns }),
    select: statement.select,
    sql,
  })
  return connection.ok(0)
}
