import type { TimeZone } from '../scripting/time.ts'
import { MariaDb, type Connection, type Result } from './database.ts'
import { SqlError } from './lexer.ts'
import { parseScript } from './parser.ts'
import type { SqlValue } from './sqlite.ts'
import { format } from './sqlstring.ts'
import { readValue, type JsValue, type ReadMode } from './values.ts'

/** An error of a statement, as mysql2 gives them: with MariaDB's code, number and SQL state, and the SQL. */
export interface DatabaseError extends Error {
  readonly code: string
  readonly errno: number
  readonly sqlState: string
  readonly sqlMessage: string
  readonly sql: string
}

/** The names of MariaDB's errors, which mysql2 gives as their codes. */
const CODES: Readonly<Record<number, string>> = {
  1005: 'ER_CANT_CREATE_TABLE',
  1048: 'ER_BAD_NULL_ERROR',
  1050: 'ER_TABLE_EXISTS_ERROR',
  1051: 'ER_BAD_TABLE_ERROR',
  1052: 'ER_NON_UNIQ_ERROR',
  1054: 'ER_BAD_FIELD_ERROR',
  1060: 'ER_DUP_FIELDNAME',
  1061: 'ER_DUP_KEYNAME',
  1062: 'ER_DUP_ENTRY',
  1064: 'ER_PARSE_ERROR',
  1065: 'ER_EMPTY_QUERY',
  1067: 'ER_INVALID_DEFAULT',
  1068: 'ER_MULTIPLE_PRI_KEY',
  1072: 'ER_KEY_COLUMN_DOES_NOT_EXITS',
  1075: 'ER_WRONG_AUTO_KEY',
  1091: 'ER_CANT_DROP_FIELD_OR_KEY',
  1110: 'ER_FIELD_SPECIFIED_TWICE',
  1111: 'ER_INVALID_GROUP_FUNC_USE',
  1136: 'ER_WRONG_VALUE_COUNT_ON_ROW',
  1146: 'ER_NO_SUCH_TABLE',
  1193: 'ER_UNKNOWN_SYSTEM_VARIABLE',
  1205: 'ER_LOCK_WAIT_TIMEOUT',
  1210: 'ER_WRONG_ARGUMENTS',
  1235: 'ER_NOT_SUPPORTED_YET',
  1241: 'ER_OPERAND_COLUMNS',
  1264: 'ER_WARN_DATA_OUT_OF_RANGE',
  1265: 'WARN_DATA_TRUNCATED',
  1292: 'ER_TRUNCATED_WRONG_VALUE',
  1305: 'ER_SP_DOES_NOT_EXIST',
  1364: 'ER_NO_DEFAULT_FOR_FIELD',
  1365: 'ER_DIVISION_BY_ZERO',
  1366: 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD',
  1406: 'ER_DATA_TOO_LONG',
  1451: 'ER_ROW_IS_REFERENCED_2',
  1452: 'ER_NO_REFERENCED_ROW_2',
  1582: 'ER_WRONG_PARAMCOUNT_TO_NATIVE_FCT',
  4025: 'ER_CONSTRAINT_FAILED',
}

/** The error of a statement, as mysql2 throws it. */
export function databaseError(error: SqlError, sql: string): DatabaseError {
  return Object.assign(new Error(error.message), {
    code: CODES[error.errno] ?? 'ER_UNKNOWN_ERROR',
    errno: error.errno,
    sqlState: error.sqlState,
    sqlMessage: error.message,
    sql,
  })
}

/** What a statement gives: rows as objects, or what it changed, as mysql2's ResultSetHeader has it. */
export type QueryResult = JsValue

/** A connection of a database, as mysql2's connections of a pool are. */
export interface DatabaseConnection {
  readonly threadId: number
  /** Runs a statement as mysql2's query does: with its values written into its SQL. */
  query(sql: string, values?: unknown): QueryResult | Promise<QueryResult>
  /** Runs a statement as mysql2's execute does, with its values bound, as oxmysql's typeCastExecute reads them. */
  execute(sql: string, values?: readonly unknown[]): QueryResult | Promise<QueryResult>
  /** Whether a statement would wait for the transaction of another connection to end. */
  blocked(): boolean
  /** Gives the connection back to the pool, rolling back the transaction it has open. */
  release(): void
}

/** A database, as oxmysql's pool of mysql2 connects to it. */
export interface DatabaseClient {
  /** What VERSION() gives, as oxmysql shows it as it connects. */
  readonly version: string
  /** A connection of the pool, which keeps the session it had when it was given back. */
  connection(): DatabaseConnection | Promise<DatabaseConnection>
  /** Runs the statements of a .sql file, as importing it does, and gives the errors of those that failed. */
  seed?(path: string, sql: string): string[]
}

/** The JS value of a result, as mysql2 reads it, with oxmysql's typeCast for `mode`. */
function jsOfResult(result: Result, mode: ReadMode, zone: TimeZone): QueryResult {
  if (result.kind === 'rows') {
    return result.rows.map((row) => {
      const object: Record<string, JsValue> = {}
      result.fields.forEach((field, i) => {
        object[field.name] = readValue(row[i] ?? null, field.type, mode, zone)
      })
      return object
    })
  }
  const integer = (value: number | bigint): number | string =>
    typeof value === 'bigint'
      ? value <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(value)
        : value.toString()
      : value
  return {
    fieldCount: 0,
    affectedRows: result.affectedRows,
    insertId: integer(result.insertId),
    info: result.info,
    serverStatus: result.serverStatus,
    warningStatus: result.warningStatus,
    changedRows: result.changedRows,
  }
}

/** A value bound to a parameter, as mysql2's execute sends them: booleans as integers, objects as JSON. */
function boundValue(value: unknown): SqlValue {
  if (value === undefined || value === null) return null
  switch (typeof value) {
    case 'boolean':
      return value ? 1n : 0n
    case 'number':
    case 'bigint':
    case 'string':
      return value
    case 'function':
      throw new TypeError(
        'Bind parameters must not contain function(s). To pass the body of a function as a string call .toString() first',
      )
    case 'object':
      if (value instanceof Uint8Array) return value
      if (value instanceof Date) {
        const pad = (n: number, width = 2) => String(n).padStart(width, '0')
        return `${pad(value.getFullYear(), 4)}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}.${pad(value.getMilliseconds(), 3)}`
      }
      return JSON.stringify(value) ?? null
    default:
      return String(value)
  }
}

/** A connection of FiveRunner's database, a session of its own. */
class SqliteConnection implements DatabaseConnection {
  readonly #client: SqliteClient
  readonly #connection: Connection

  constructor(client: SqliteClient, connection: Connection) {
    this.#client = client
    this.#connection = connection
  }

  get threadId(): number {
    return this.#connection.id
  }

  query(sql: string, values?: unknown): QueryResult {
    const formatted = values === undefined ? sql : format(sql, values)
    return this.#run(formatted, () => this.#connection.query(formatted), 'query')
  }

  execute(sql: string, values: readonly unknown[] = []): QueryResult {
    const bound = values.map(boundValue)
    return this.#run(sql, () => this.#connection.execute(sql, bound), 'execute')
  }

  blocked(): boolean {
    const owner = this.#connection.database.transactionOwner
    return owner !== undefined && owner !== this.#connection
  }

  release(): void {
    if (this.#connection.inTransaction) this.#connection.query('ROLLBACK')
    this.#client.give(this)
  }

  #run(sql: string, run: () => Result, mode: ReadMode): QueryResult {
    try {
      return jsOfResult(run(), mode, this.#client.zone)
    } catch (error) {
      if (error instanceof SqlError) throw databaseError(error, sql)
      throw error
    }
  }
}

/** FiveRunner's own database, in SQLite, as a client of a pool of connections. */
export class SqliteClient implements DatabaseClient {
  readonly #database: MariaDb
  readonly #idle: SqliteConnection[] = []
  readonly zone: TimeZone
  readonly version: string

  private constructor(database: MariaDb, zone: TimeZone) {
    this.#database = database
    this.zone = zone
    this.version = String(database.connect().systemVariable('version'))
  }

  static async create(
    module: WebAssembly.Module,
    options: { readonly name: string; readonly zone: TimeZone; readonly clock: () => number },
  ): Promise<SqliteClient> {
    const database = await MariaDb.create(module, options)
    return new SqliteClient(database, options.zone)
  }

  /** The database, for those that read it outside of connections, as tests do. */
  get database(): MariaDb {
    return this.#database
  }

  connection(): DatabaseConnection {
    // The pool gives back the connection it last took back, as mysql2's does, which keeps its session.
    return this.#idle.pop() ?? new SqliteConnection(this, this.#database.connect())
  }

  /** Takes a connection back into the pool. */
  give(connection: SqliteConnection): void {
    if (!this.#idle.includes(connection)) this.#idle.push(connection)
  }

  seed(path: string, sql: string): string[] {
    let script: ReturnType<typeof parseScript>
    try {
      script = parseScript(sql)
    } catch (error) {
      if (!(error instanceof SqlError)) throw error
      return [`${path}: ${error.message}`]
    }
    const connection = this.#database.connect()
    const errors: string[] = []
    for (const entry of script) {
      try {
        if ('error' in entry) throw entry.error
        connection.runStatement(entry.statement, sql)
      } catch (error) {
        if (!(error instanceof SqlError)) throw error
        const line = sql.slice(0, entry.start).split('\n').length
        errors.push(`${path}:${line}: ${error.message} (${[...entry.text].slice(0, 80).join('')})`)
      }
    }
    connection.close()
    return errors
  }
}
