import { readFileSync } from 'node:fs'

import { MariaDb, type Connection, type DatabaseOptions } from '../../src/core/db/database.ts'
import type { SqlValue } from '../../src/core/db/sqlite.ts'
import { readValue, type JsValue } from '../../src/core/db/values.ts'
import { UTC } from '../../src/core/scripting/time.ts'

/** sqlite3.wasm, compiled once for the tests. */
const sqliteModule = WebAssembly.compile(
  readFileSync(
    new URL('../../node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm', import.meta.url),
  ),
)

/** 2024-05-06 07:08:09 UTC, a Monday, when the tests' databases are. */
export const NOW = Date.UTC(2024, 4, 6, 7, 8, 9)

/** A database named test, in UTC, whose clock stands at NOW unless the options say otherwise. */
export async function database(options: Partial<DatabaseOptions> = {}): Promise<MariaDb> {
  return MariaDb.create(await sqliteModule, {
    name: 'test',
    zone: UTC,
    clock: () => NOW,
    ...options,
  })
}

/** A connection to a new database, which runs the statements given first. */
export async function connection(...statements: string[]): Promise<Connection> {
  const connection = (await database()).connect()
  for (const statement of statements) connection.query(statement)
  return connection
}

/** The rows of a query as arrays, as mysql2 reads them with oxmysql's typeCast. */
export function rows(
  connection: Connection,
  sql: string,
  params?: readonly SqlValue[],
): JsValue[][] {
  const result = params === undefined ? connection.query(sql) : connection.execute(sql, params)
  if (result.kind !== 'rows') throw new Error(`${sql} gave no rows`)
  const mode = params === undefined ? 'query' : 'execute'
  return result.rows.map((row) =>
    result.fields.map((field, i) => readValue(row[i] ?? null, field.type, mode, UTC)),
  )
}

/** The single value of a query. */
export function value(connection: Connection, sql: string, params?: readonly SqlValue[]): JsValue {
  const [row] = rows(connection, sql, params)
  if (row === undefined || row.length !== 1) throw new Error(`${sql} gave no single value`)
  return row[0]!
}

/** The names of the columns of a query's result. */
export function names(connection: Connection, sql: string): string[] {
  const result = connection.query(sql)
  if (result.kind !== 'rows') throw new Error(`${sql} gave no rows`)
  return result.fields.map((field) => field.name)
}

/** What a statement changed, as its OK packet says. */
export function ok(connection: Connection, sql: string, params?: readonly SqlValue[]) {
  const result = params === undefined ? connection.query(sql) : connection.execute(sql, params)
  if (result.kind !== 'ok') throw new Error(`${sql} gave rows`)
  const { affectedRows, insertId, info, changedRows, warningStatus } = result
  return { affectedRows, insertId, info, changedRows, warningStatus }
}

/** The message of the error a statement fails with. */
export function error(connection: Connection, sql: string, params?: readonly SqlValue[]): string {
  try {
    if (params === undefined) connection.query(sql)
    else connection.execute(sql, params)
  } catch (thrown) {
    return (thrown as Error).message
  }
  throw new Error(`${sql} did not fail`)
}
