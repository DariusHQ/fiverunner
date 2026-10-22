import type { TimeZone } from '../scripting/time.ts'
import type { Expression, Select, SetStatement, ShowStatement, Statement } from './ast.ts'
import {
  Compiler,
  Scope,
  type Catalog,
  type Field,
  type Source,
  type ViewSchema,
} from './compile.ts'
import { deleteRows, insertRows, updateRows } from './dml.ts'
import { registerFunctions, zoneOf, like } from './functions.ts'
import { SqlError, VERSION_ID } from './lexer.ts'
import { parseStatement } from './parser.ts'
import {
  sameName,
  showCreateTable,
  sqliteName,
  tableKey,
  type SchemaContext,
  type TableSchema,
} from './schema.ts'
import { columnInformation } from './compile.ts'
import { loadSqlite, type Sqlite, type SqliteDatabase, type SqlValue } from './sqlite.ts'
import { runTableStatement } from './tables.ts'
import { integerType, stringType, type Type } from './types.ts'
import { foldText, textOf } from './values.ts'

/** The version FiveRunner's database gives, as MariaDB's VERSION() does. */
export const VERSION = `${Math.floor(VERSION_ID / 10000)}.${Math.floor(VERSION_ID / 100) % 100}.${VERSION_ID % 100}-MariaDB-FiveRunner`

/** What a statement gives: rows, with the columns MariaDB describes, or what it changed, as MariaDB's OK packet says. */
export type Result =
  | {
      readonly kind: 'rows'
      readonly fields: readonly Field[]
      readonly rows: readonly (readonly SqlValue[])[]
    }
  | {
      readonly kind: 'ok'
      readonly affectedRows: number
      readonly insertId: number | bigint
      readonly info: string
      readonly warningStatus: number
      readonly serverStatus: number
      readonly changedRows: number
    }

export interface Warning {
  readonly level: 'Note' | 'Warning' | 'Error'
  readonly code: number
  readonly message: string
}

export interface DatabaseOptions {
  /** The name of the database, which DATABASE() gives and errors name. */
  readonly name: string
  /** The time zone of the system, which the session's is by default. */
  readonly zone: TimeZone
  /** Milliseconds since the epoch, maybe with a fraction, which NOW() reads. */
  readonly clock: () => number
  /** What RAND() and UUID() take randomness from. */
  readonly random?: () => number
}

/** The flags of MariaDB's OK packets: in a transaction, and with autocommit. */
const SERVER_STATUS_IN_TRANS = 1
const SERVER_STATUS_AUTOCOMMIT = 2

/** The variables of the system that sessions have, with their values by default. */
function defaultVariables(name: string): Map<string, SqlValue> {
  return new Map<string, SqlValue>([
    ['autocommit', 1],
    ['foreign_key_checks', 1],
    ['unique_checks', 1],
    [
      'sql_mode',
      'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION',
    ],
    ['time_zone', 'SYSTEM'],
    ['system_time_zone', 'UTC'],
    ['character_set_client', 'utf8mb4'],
    ['character_set_connection', 'utf8mb4'],
    ['character_set_results', 'utf8mb4'],
    ['character_set_server', 'utf8mb4'],
    ['character_set_database', 'utf8mb4'],
    ['collation_connection', 'utf8mb4_general_ci'],
    ['collation_server', 'utf8mb4_general_ci'],
    ['collation_database', 'utf8mb4_general_ci'],
    ['names', 'utf8mb4'],
    ['transaction_isolation', 'REPEATABLE-READ'],
    ['tx_isolation', 'REPEATABLE-READ'],
    ['transaction_read_only', 0],
    ['tx_read_only', 0],
    ['sql_notes', 1],
    ['sql_warnings', 0],
    ['sql_safe_updates', 0],
    ['sql_quote_show_create', 1],
    ['sql_auto_is_null', 0],
    ['sql_big_selects', 1],
    ['sql_select_limit', 18446744073709551615n],
    ['max_allowed_packet', 16777216],
    ['max_execution_time', 0],
    ['max_statement_time', 0],
    ['net_write_timeout', 60],
    ['net_read_timeout', 30],
    ['wait_timeout', 28800],
    ['interactive_timeout', 28800],
    ['lock_wait_timeout', 86400],
    ['innodb_lock_wait_timeout', 50],
    ['group_concat_max_len', 1048576],
    ['div_precision_increment', 4],
    ['lower_case_table_names', 1],
    ['explicit_defaults_for_timestamp', 1],
    ['version', VERSION],
    ['version_comment', 'FiveRunner'],
    ['version_compile_os', 'Win64'],
    ['hostname', 'localhost'],
    ['port', 3306],
    ['default_storage_engine', 'InnoDB'],
    ['storage_engine', 'InnoDB'],
    ['last_insert_id', 0],
    ['insert_id', 0],
    ['identity', 0],
    ['profiling', 0],
    ['big_tables', 0],
    ['old_passwords', 0],
    ['session_track_schema', 1],
    ['session_track_state_change', 0],
    [
      'session_track_system_variables',
      'autocommit,character_set_client,character_set_connection,character_set_results,time_zone',
    ],
    ['session_track_transaction_info', 'OFF'],
    ['skip_name_resolve', 0],
    ['performance_schema', 0],
    ['secure_file_priv', null],
    ['warning_count', 0],
    ['error_count', 0],
    ['default_week_format', 0],
    ['datadir', `fiverunner:/${name}/`],
  ])
}

/** Variables of MySQL's that MariaDB lacks, which SET takes and changes nothing with, as dumps of MySQL set them. */
const IGNORED_VARIABLES = new Set([
  'sql_require_primary_key',
  'default_table_encryption',
  'information_schema_stats_expiry',
  'gtid_purged',
  'gtid_next',
  'sql_log_bin',
  'check_constraint_checks',
  'optimizer_switch',
  'innodb_strict_mode',
  'old_alter_table',
])

/** The rows that SQLite gives for a statement, by its values. */
export interface SqliteAccess {
  all(sql: string, params?: readonly SqlValue[]): SqlValue[][]
  run(sql: string, params?: readonly SqlValue[]): number
}

/**
 * A database of MariaDB, which FiveRunner keeps in SQLite: its statements
 * read as MariaDB reads MySQL's SQL, run as SQLite, and give what MariaDB
 * gives, with its errors. There is one database, which every name of a
 * database names, and tables are named in lower case, as on Windows.
 */
/**
 * The statements that lock nothing, reads and those of the session, which
 * run beside the transactions of other connections, as MariaDB's readers
 * run beside its writers.
 */
const LOCK_FREE: ReadonlySet<Statement['kind']> = new Set([
  'set',
  'use',
  'select',
  'showTables',
  'showColumns',
  'showIndex',
  'showCreateTable',
  'showDatabases',
  'showVariables',
  'showWarnings',
])

/** Whether `sql` locks nothing, or fails to parse, so that it waits for no transaction of another connection. */
export function locksNothing(sql: string): boolean {
  try {
    return LOCK_FREE.has(parseStatement(sql).kind)
  } catch {
    return true
  }
}

export class MariaDb implements Catalog, SqliteAccess {
  readonly sqlite: Sqlite
  readonly db: SqliteDatabase
  readonly schema: string
  readonly zone: TimeZone
  readonly clock: () => number
  readonly random: () => number
  readonly #tables = new Map<string, TableSchema>()
  readonly #views = new Map<string, ViewSchema>()
  #connections = 0
  /** The connection whose statement runs. */
  current: Connection | undefined
  /** The connection whose transaction is open, which others wait for. */
  transactionOwner: Connection | undefined
  /** The error a function of FiveRunner's failed the statement with, which SQLite reports as its own. */
  pendingError: SqlError | undefined
  /** Whether SQLite checks foreign keys, as the session whose statement runs has foreign_key_checks. */
  #foreignKeys = true

  private constructor(sqlite: Sqlite, options: DatabaseOptions) {
    this.sqlite = sqlite
    this.db = new sqlite.oo1.DB(':memory:', 'c')
    this.schema = options.name
    this.zone = options.zone
    this.clock = options.clock
    this.random = options.random ?? Math.random
  }

  /** Starts a database in SQLite's WebAssembly, which the host compiled from sqlite3.wasm. */
  static async create(module: WebAssembly.Module, options: DatabaseOptions): Promise<MariaDb> {
    const sqlite = await loadSqlite(module)
    const database = new MariaDb(sqlite, options)
    database.#setUp()
    return database
  }

  #setUp(): void {
    const { sqlite, db } = this
    const decoder = new TextDecoder()
    const { capi, wasm } = sqlite
    capi.sqlite3_create_collation_v2(
      db.pointer!,
      'fr_ci',
      capi.SQLITE_UTF8,
      0,
      (_arg: number, length1: number, pointer1: number, length2: number, pointer2: number) => {
        const heap = wasm.heap8u()
        const a = foldText(decoder.decode(heap.subarray(pointer1, pointer1 + length1)))
        const b = foldText(decoder.decode(heap.subarray(pointer2, pointer2 + length2)))
        return a < b ? -1 : a > b ? 1 : 0
      },
      0,
    )
    registerFunctions(db, sqlite, {
      statementTime: () => this.current?.statementTime ?? this.clock(),
      zone: () => this.current?.zone ?? this.zone,
      fail: (error) => {
        this.pendingError = error
        throw error
      },
      warn: (code, message) => this.current?.warn('Warning', code, message),
      userVariable: (name) => this.current?.userVariables.get(name) ?? null,
      setUserVariable: (name, value) => this.current?.userVariables.set(name, value),
      systemVariable: (name) => this.current?.systemVariable(name) ?? null,
      lastInsertId: () => this.current?.lastInsertId ?? 0,
      setLastInsertId: (value) => {
        if (this.current !== undefined) this.current.lastInsertId = value
      },
      foundRows: () => this.current?.foundRows ?? 0,
      rowCount: () => this.current?.rowCount ?? -1,
      database: () => this.schema,
      version: VERSION,
      connectionId: () => this.current?.id ?? 0,
      user: () => 'root@localhost',
      random: () => this.random(),
    })
    db.exec('PRAGMA foreign_keys = ON')
  }

  /**
   * Has SQLite check foreign keys or not, as foreign_key_checks of a session
   * says, which SQLite takes only outside of transactions.
   */
  foreignKeys(on: boolean): void {
    if (this.#foreignKeys === on || this.sqlite.capi.sqlite3_get_autocommit(this.db.pointer!) === 0)
      return
    this.db.exec(`PRAGMA foreign_keys = ${on ? 'ON' : 'OFF'}`)
    this.#foreignKeys = on
  }

  /** Opens a connection, a session of its own with an id, its variables and its transaction. */
  connect(): Connection {
    return new Connection(this, ++this.#connections)
  }

  close(): void {
    this.db.close()
  }

  // The catalog

  table(name: string): TableSchema | undefined {
    return this.#tables.get(tableKey(name))
  }

  view(name: string): ViewSchema | undefined {
    return this.#views.get(tableKey(name))
  }

  tables(): readonly TableSchema[] {
    return [...this.#tables.values()].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )
  }

  views(): readonly ViewSchema[] {
    return [...this.#views.values()].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )
  }

  rowCount(table: string): number {
    const [[count = 0] = []] = this.all(`SELECT COUNT(*) FROM ${sqliteName(tableKey(table))}`)
    return Number(count)
  }

  setTable(table: TableSchema): void {
    this.#tables.set(table.name, table)
  }

  deleteTable(name: string): void {
    this.#tables.delete(tableKey(name))
  }

  setView(view: ViewSchema): void {
    this.#views.set(view.name, view)
  }

  deleteView(name: string): void {
    this.#views.delete(tableKey(name))
  }

  // SQLite

  all(sql: string, params: readonly SqlValue[] = []): SqlValue[][] {
    const statement = this.db.prepare(sql)
    try {
      if (params.length > 0) statement.bind(params as SqlValue[])
      const rows: SqlValue[][] = []
      while (statement.step()) rows.push(statement.get([]) as SqlValue[])
      return rows
    } finally {
      statement.finalize()
    }
  }

  run(sql: string, params: readonly SqlValue[] = []): number {
    const statement = this.db.prepare(sql)
    try {
      if (params.length > 0) statement.bind(params as SqlValue[])
      statement.step()
    } finally {
      statement.finalize()
    }
    return this.db.changes()
  }
}

/** The errors of SQLite, which FiveRunner reports as MariaDB's. */
interface SqliteError extends Error {
  readonly resultCode?: number
}

/**
 * A connection to the database: a session, with its variables, its
 * warnings, its last insert id, and its transaction.
 */
export class Connection implements SqliteAccess {
  readonly database: MariaDb
  readonly id: number
  readonly userVariables = new Map<string, SqlValue>()
  readonly #variables: Map<string, SqlValue>
  lastInsertId: number | bigint = 0
  rowCount = -1
  foundRows = 0
  /** The time of the statement that runs. */
  statementTime = 0
  #warnings: Warning[] = []
  #lastWarnings: Warning[] = []
  /** Whether a transaction is open, by BEGIN or with autocommit off. */
  inTransaction = false
  #closed = false

  constructor(database: MariaDb, id: number) {
    this.database = database
    this.id = id
    this.#variables = defaultVariables(database.schema)
  }

  /** The time zone of the session, which NOW() gives local time in. */
  get zone(): TimeZone {
    const name = String(this.#variables.get('time_zone') ?? 'SYSTEM')
    return zoneOf(name, this.database.zone) ?? this.database.zone
  }

  /** Whether values are stored strictly, as sql_mode with STRICT_TRANS_TABLES or STRICT_ALL_TABLES stores them. */
  get strict(): boolean {
    return /STRICT_(TRANS|ALL)_TABLES/i.test(String(this.#variables.get('sql_mode') ?? ''))
  }

  get foreignKeyChecks(): boolean {
    return Number(this.#variables.get('foreign_key_checks') ?? 1) !== 0
  }

  get #autocommit(): boolean {
    return Number(this.#variables.get('autocommit') ?? 1) !== 0
  }

  systemVariable(name: string): SqlValue | undefined {
    switch (name) {
      case 'last_insert_id':
      case 'identity':
        return this.lastInsertId
      case 'warning_count':
        return this.#lastWarnings.length
      case 'error_count':
        return this.#lastWarnings.filter((warning) => warning.level === 'Error').length
      case 'database':
        return this.database.schema
    }
    return this.#variables.get(name)
  }

  warn(level: Warning['level'], code: number, message: string): void {
    this.#warnings.push({ level, code, message })
  }

  get warningCount(): number {
    return this.#warnings.length
  }

  /** The status MariaDB's OK packets give: whether a transaction is open, and autocommit. */
  get serverStatus(): number {
    return (
      (this.inTransaction ? SERVER_STATUS_IN_TRANS : 0) |
      (this.#autocommit ? SERVER_STATUS_AUTOCOMMIT : 0)
    )
  }

  all(sql: string, params: readonly SqlValue[] = []): SqlValue[][] {
    return this.database.all(sql, params)
  }

  run(sql: string, params: readonly SqlValue[] = []): number {
    return this.database.run(sql, params)
  }

  /** A compiler of the statement's SQL, for this session. */
  compiler(sql: string, bound?: readonly SqlValue[]): Compiler {
    return new Compiler(
      this.database,
      sql,
      {
        userVariable: (name) => this.userVariables.get(name.toLowerCase()) ?? null,
        systemVariable: (name) => this.systemVariable(name),
      },
      bound,
    )
  }

  /** What building tables needs of the database, for this session. */
  schemaContext(): SchemaContext {
    return {
      schema: this.database.schema,
      zone: this.database.zone,
      foreignKeyChecks: this.foreignKeyChecks,
      table: (name) => this.database.table(name),
    }
  }

  /** Runs a statement whose values were written into its SQL, as mysql2's query sends them. */
  query(sql: string): Result {
    return this.#statement(sql, undefined)
  }

  /** Runs a prepared statement with values for its ?, as mysql2's execute sends them. */
  execute(sql: string, params: readonly SqlValue[]): Result {
    return this.#statement(sql, params)
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    if (this.inTransaction) {
      this.#rollbackTransaction()
    }
  }

  /** Runs a statement that parseScript read from `sql`, as statements of .sql files run. */
  runStatement(statement: Statement, sql: string): Result {
    return this.#statement(sql, undefined, statement)
  }

  #statement(sql: string, bound: readonly SqlValue[] | undefined, parsed?: Statement): Result {
    const { database } = this
    if (this.#closed) throw new Error('The connection is closed')
    const previous = database.current
    database.current = this
    this.statementTime = database.clock()
    this.#warnings = []
    database.pendingError = undefined
    let statement: Statement | undefined = parsed
    database.foreignKeys(this.foreignKeyChecks)
    try {
      statement ??= parseStatement(sql)
      const owner = database.transactionOwner
      if (owner !== undefined && owner !== this && !LOCK_FREE.has(statement.kind)) {
        throw new Error(
          `Connection ${this.id} ran a statement while connection ${owner.id} had a transaction open`,
        )
      }
      if (bound !== undefined) {
        const count = countParams(statement)
        if (count !== bound.length) {
          throw new SqlError(1210, 'HY000', `Incorrect arguments to mysqld_stmt_execute`)
        }
      }
      const result = this.#run(statement, sql, bound)
      if (statement.kind !== 'showWarnings') this.#lastWarnings = this.#warnings
      return result
    } catch (error) {
      const mapped = this.#mapError(error)
      // SHOW WARNINGS shows the warnings of the statement before it.
      if (statement?.kind !== 'showWarnings') {
        this.#lastWarnings = [
          ...this.#warnings,
          { level: 'Error', code: mapped.errno, message: mapped.message },
        ]
      }
      throw mapped
    } finally {
      database.current = previous
    }
  }

  /** The MariaDB error of an error a statement failed with. */
  #mapError(error: unknown): SqlError {
    if (error instanceof SqlError) return error
    const pending = this.database.pendingError
    if (pending !== undefined) return pending
    const sqliteError = error as SqliteError
    if (typeof sqliteError.resultCode !== 'number') throw error
    const message = sqliteError.message.replace(/^SQLITE_[A-Z_]+: sqlite3 result code \d+: /, '')
    const check = /^CHECK constraint failed: (.*)$/.exec(message)
    if (check !== null)
      return new SqlError(
        4025,
        '23000',
        `CONSTRAINT \`${check[1]}\` failed for \`${this.database.schema}\`.\`${'table'}\``,
      )
    if (message.startsWith('FOREIGN KEY constraint failed')) {
      return new SqlError(
        1451,
        '23000',
        'Cannot delete or update a parent row: a foreign key constraint fails',
      )
    }
    const notNull = /^NOT NULL constraint failed: [^.]+\.(.*)$/.exec(message)
    if (notNull !== null)
      return new SqlError(1048, '23000', `Column '${notNull[1]}' cannot be null`)
    return new SqlError(1105, 'HY000', `FiveRunner's database failed: ${message}`)
  }

  /**
   * Runs a statement as one: in a savepoint of SQLite, which its failure
   * rolls back, so that statements change all they change or nothing, as
   * InnoDB's do. Statements that change tables commit the transaction
   * before them, as MariaDB's do, and run outside of one.
   */
  #run(statement: Statement, sql: string, bound: readonly SqlValue[] | undefined): Result {
    switch (statement.kind) {
      case 'begin':
        if (this.inTransaction) this.#commitTransaction()
        this.#beginTransaction()
        return this.ok(0)
      case 'commit':
        if (this.inTransaction) this.#commitTransaction()
        return this.ok(0)
      case 'rollback':
        if (this.inTransaction) this.#rollbackTransaction()
        return this.ok(0)
      case 'savepoint':
      case 'release':
      case 'rollbackTo':
        return this.#savepoint(statement.kind, statement.savepoint!)
      case 'createTable':
      case 'alterTable':
      case 'createIndex':
      case 'dropIndex':
      case 'dropTable':
      case 'truncate':
      case 'renameTable':
      case 'createView':
      case 'dropView':
      case 'createDatabase':
      case 'dropDatabase': {
        // Changes of tables commit, as MariaDB's do, but those of temporary tables.
        if (this.inTransaction && !(statement.kind === 'createTable' && statement.temporary))
          this.#commitTransaction()
        const result = runTableStatement(this, statement, sql)
        this.rowCount = 0
        return result
      }
      case 'use':
        return this.ok(0)
      case 'set':
        return this.#set(statement, sql)
      case 'showTables':
      case 'showColumns':
      case 'showIndex':
      case 'showCreateTable':
      case 'showDatabases':
      case 'showVariables':
      case 'showWarnings':
        return this.#show(statement, sql)
      case 'noop':
        return this.#noop(statement)
      case 'do':
        return this.#atomically(() => {
          const compiler = this.compiler(sql, bound)
          const values = statement.expressions.map((expr) =>
            compiler.expression(expr, new Scope(), 'field list'),
          )
          this.all(`SELECT ${values.map((value) => value.sql).join(', ')}`, compiler.params)
          return this.ok(0)
        })
      case 'select':
        return this.#atomically(() => this.#select(statement, sql, bound))
      case 'insert':
        return this.#atomically(() => {
          const result = insertRows(this, statement, sql, bound)
          this.rowCount = result.affectedRows
          return result
        })
      case 'update':
        return this.#atomically(() => {
          const result = updateRows(this, statement, sql, bound)
          this.rowCount = result.affectedRows
          return result
        })
      case 'delete':
        return this.#atomically(() => {
          const result = deleteRows(this, statement, sql, bound)
          if (result.kind === 'ok') this.rowCount = result.affectedRows
          return result
        })
    }
  }

  /** An OK packet of a statement that changed `affectedRows` rows. */
  ok(
    affectedRows: number,
    insertId: number | bigint = 0,
    info = '',
    changedRows = 0,
  ): Extract<Result, { kind: 'ok' }> {
    return {
      kind: 'ok',
      affectedRows,
      insertId,
      info,
      warningStatus: this.#warnings.length,
      serverStatus: this.serverStatus,
      changedRows,
    }
  }

  /** Runs what a statement does in a savepoint, which rolls it back if it fails, in a transaction that autocommit commits. */
  #atomically<T>(run: () => T): T {
    // What runs beside the transaction of another connection starts none of its own.
    const implicit =
      !this.inTransaction && !this.#autocommit && this.database.transactionOwner === undefined
    if (implicit) this.#beginTransaction()
    this.run('SAVEPOINT fr_statement')
    try {
      const result = run()
      this.run('RELEASE fr_statement')
      return result
    } catch (error) {
      this.run('ROLLBACK TO fr_statement')
      this.run('RELEASE fr_statement')
      throw error
    }
  }

  #beginTransaction(): void {
    this.run('BEGIN')
    this.inTransaction = true
    this.database.transactionOwner = this
  }

  #commitTransaction(): void {
    this.run('COMMIT')
    this.inTransaction = false
    this.database.transactionOwner = undefined
  }

  #rollbackTransaction(): void {
    this.run('ROLLBACK')
    this.inTransaction = false
    this.database.transactionOwner = undefined
  }

  #savepoint(kind: 'savepoint' | 'release' | 'rollbackTo', name: string): Result {
    const sqliteSavepoint = sqliteName(`fr_user_${name.toLowerCase()}`)
    if (kind === 'savepoint') {
      if (!this.inTransaction) return this.ok(0)
      this.run(`SAVEPOINT ${sqliteSavepoint}`)
      return this.ok(0)
    }
    if (!this.inTransaction) throw new SqlError(1305, '42000', `SAVEPOINT ${name} does not exist`)
    try {
      if (kind === 'release') this.run(`RELEASE ${sqliteSavepoint}`)
      else this.run(`ROLLBACK TO ${sqliteSavepoint}`)
    } catch {
      throw new SqlError(1305, '42000', `SAVEPOINT ${name} does not exist`)
    }
    return this.ok(0)
  }

  #select(select: Select, sql: string, bound: readonly SqlValue[] | undefined): Result {
    const compiler = this.compiler(sql, bound)
    const compiled = compiler.query(select)
    const rows = this.all(compiled.sql, compiled.params)
    const core = select.body.kind === 'core' ? select.body : undefined
    if (core?.calcFoundRows === true && select.limit !== undefined) {
      const counter = this.compiler(sql, bound)
      const { limit: _limit, ...unlimitedSelect } = select
      const unlimited = counter.query(unlimitedSelect)
      const [[count]] = this.all(`SELECT COUNT(*) FROM (${unlimited.sql})`, unlimited.params) as [
        [number],
      ]
      this.foundRows = Number(count)
    } else {
      this.foundRows = rows.length
    }
    this.rowCount = -1
    return { kind: 'rows', fields: compiled.fields, rows }
  }

  #set(statement: SetStatement, sql: string): Result {
    for (const item of statement.items) {
      if (item.kind === 'transaction') continue
      if (item.kind === 'names') {
        for (const name of [
          'character_set_client',
          'character_set_connection',
          'character_set_results',
        ]) {
          this.#variables.set(name, item.charset.toLowerCase())
        }
        if (item.collation !== undefined)
          this.#variables.set('collation_connection', item.collation.toLowerCase())
        continue
      }
      const name = item.name.toLowerCase()
      if (!item.system) {
        const value = item.value === undefined ? null : this.#evaluate(item.value, sql)
        this.userVariables.set(name, value)
        continue
      }
      if (IGNORED_VARIABLES.has(name)) continue
      if (!this.#variables.has(name))
        throw new SqlError(1193, 'HY000', `Unknown system variable '${item.name}'`)
      if (item.scope === 'GLOBAL') {
        // Global variables change the server's, which a session of FiveRunner's database stands for.
      }
      let value: SqlValue
      if (item.value === undefined) value = defaultVariables(this.database.schema).get(name) ?? null
      else value = this.#evaluate(item.value, sql)
      this.#setSystemVariable(name, value, item.name)
    }
    return this.ok(0)
  }

  /** Sets a variable of the system, with what MariaDB checks of its value. */
  #setSystemVariable(name: string, value: SqlValue, written: string): void {
    const wrong = () =>
      new SqlError(
        1231,
        '42000',
        `Variable '${written}' can't be set to the value of '${value === null ? 'NULL' : textOf(value)}'`,
      )
    const flag = (): number => {
      if (value === null) throw wrong()
      const text = textOf(value).toUpperCase()
      if (text === 'ON' || text === '1' || text === 'TRUE') return 1
      if (text === 'OFF' || text === '0' || text === 'FALSE') return 0
      throw wrong()
    }
    switch (name) {
      case 'autocommit': {
        const on = flag()
        // Turning autocommit on commits the transaction it left open.
        if (on === 1 && this.inTransaction) this.#commitTransaction()
        this.#variables.set(name, on)
        return
      }
      case 'foreign_key_checks':
        this.#variables.set(name, flag())
        this.database.foreignKeys(this.foreignKeyChecks)
        return
      case 'unique_checks':
      case 'sql_notes':
      case 'sql_safe_updates':
      case 'sql_quote_show_create':
      case 'sql_big_selects':
      case 'profiling':
        this.#variables.set(name, flag())
        return
      case 'time_zone': {
        if (value === null || zoneOf(textOf(value), this.database.zone) === undefined) {
          throw new SqlError(
            1298,
            'HY000',
            `Unknown or incorrect time zone: '${value === null ? 'NULL' : textOf(value)}'`,
          )
        }
        this.#variables.set(name, textOf(value))
        return
      }
      case 'sql_mode': {
        const text = value === null ? '' : textOf(value).toUpperCase()
        this.#variables.set(
          name,
          text
            .split(',')
            .map((part) => part.trim())
            .filter((part) => part !== '')
            .join(','),
        )
        return
      }
      default:
        this.#variables.set(name, value)
    }
  }

  /** The value of an expression of SET, which may read variables and run functions. */
  #evaluate(expr: Expression, sql: string): SqlValue {
    const compiler = this.compiler(sql)
    const compiled = compiler.expression(expr, new Scope(), 'field list')
    const [[value = null] = []] = this.all(`SELECT ${compiled.sql}`, compiler.params)
    return value
  }

  #noop(statement: Extract<Statement, { kind: 'noop' }>): Result {
    if (statement.maintenance === undefined) return this.ok(0)
    // OPTIMIZE, ANALYZE, CHECK and REPAIR give a row for each table.
    const { op, tables } = statement.maintenance
    const fields = ['Table', 'Op', 'Msg_type', 'Msg_text'].map((name) => textField(name))
    const rows = tables.map((table) => {
      const exists = this.database.table(table.name) !== undefined
      const message = !exists
        ? `Table '${this.database.schema}.${tableKey(table.name)}' doesn't exist`
        : op === 'optimize'
          ? 'Table does not support optimize, doing recreate + analyze instead'
          : 'OK'
      return [
        `${this.database.schema}.${tableKey(table.name)}`,
        op,
        exists ? (op === 'optimize' ? 'note' : 'status') : 'Error',
        message,
      ]
    })
    return { kind: 'rows', fields, rows }
  }

  #show(statement: ShowStatement, sql: string): Result {
    const { database } = this
    const filter = (rows: SqlValue[][], fields: Field[], column: number): Result => {
      let kept = rows
      if ('like' in statement && statement.like !== undefined) {
        const pattern = this.#evaluate(statement.like, sql)
        kept = rows.filter(
          (row) => pattern !== null && like(textOf(row[column] ?? ''), textOf(pattern), '\\', true),
        )
      }
      if ('where' in statement && statement.where !== undefined)
        kept = this.#filterRows(kept, fields, statement.where, sql)
      return { kind: 'rows', fields, rows: kept }
    }
    switch (statement.kind) {
      case 'showTables': {
        const fields = [textField(`Tables_in_${database.schema}`)]
        if (statement.full) fields.push(textField('Table_type'))
        const rows: SqlValue[][] = [
          ...database
            .tables()
            .map((table) => (statement.full ? [table.name, 'BASE TABLE'] : [table.name])),
          ...database.views().map((view) => (statement.full ? [view.name, 'VIEW'] : [view.name])),
        ].sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1))
        return filter(rows, fields, 0)
      }
      case 'showColumns': {
        const table = this.#tableOf(statement.table.name)
        const fields = ['Field', 'Type']
        if (statement.full) fields.push('Collation')
        fields.push('Null', 'Key', 'Default', 'Extra')
        if (statement.full) fields.push('Privileges', 'Comment')
        const rows = table.columns.map((column) => {
          const info = columnInformation(column, table)
          const shownDefault =
            column.default === undefined
              ? null
              : column.default.kind === 'value'
                ? column.default.value === null
                  ? null
                  : textOf(column.default.value)
                : column.default.kind === 'now'
                  ? 'current_timestamp()'
                  : column.default.sql
          const row: SqlValue[] = [column.name, info.columnType]
          if (statement.full) row.push(info.collation)
          row.push(column.nullable ? 'YES' : 'NO', info.key, shownDefault, info.extra)
          if (statement.full) row.push('select,insert,update,references', column.comment)
          return row
        })
        return filter(
          rows,
          fields.map((name) => textField(name)),
          0,
        )
      }
      case 'showIndex': {
        const table = this.#tableOf(statement.table.name)
        const fields = [
          textField('Table'),
          { ...textField('Non_unique'), type: integerType(1) },
          textField('Key_name'),
          { ...textField('Seq_in_index'), type: integerType(2) },
          textField('Column_name'),
          textField('Collation'),
          { ...textField('Cardinality'), type: integerType(21) },
          { ...textField('Sub_part'), type: integerType(3) },
          textField('Packed'),
          textField('Null'),
          textField('Index_type'),
          textField('Comment'),
          textField('Index_comment'),
          textField('Ignored'),
        ]
        const rows = table.indexes.flatMap((index) =>
          index.parts.map((part, i) => [
            table.name,
            index.kind === 'PRIMARY' || index.kind === 'UNIQUE' ? 0 : 1,
            index.name,
            i + 1,
            part.column,
            part.descending ? 'D' : 'A',
            0,
            part.length ?? null,
            null,
            table.columns.find((column) => sameName(column.name, part.column))?.nullable === true
              ? 'YES'
              : '',
            index.kind === 'FULLTEXT' ? 'FULLTEXT' : 'BTREE',
            '',
            '',
            'NO',
          ]),
        )
        return filter(rows, fields, 2)
      }
      case 'showCreateTable': {
        const key = tableKey(statement.table.name)
        const view = database.view(key)
        if (view !== undefined) {
          return {
            kind: 'rows',
            fields: ['View', 'Create View', 'character_set_client', 'collation_connection'].map(
              (name) => textField(name),
            ),
            rows: [
              [
                view.name,
                `CREATE ALGORITHM=UNDEFINED DEFINER=\`root\`@\`localhost\` SQL SECURITY DEFINER VIEW \`${view.name}\` AS ${view.sql.slice(view.select.start, view.select.end)}`,
                'utf8mb4',
                'utf8mb4_general_ci',
              ],
            ],
          }
        }
        const table = this.#tableOf(key)
        return {
          kind: 'rows',
          fields: [textField('Table'), textField('Create Table')],
          rows: [[table.name, showCreateTable(table)]],
        }
      }
      case 'showDatabases': {
        const rows = [['information_schema'], [database.schema]]
        return filter(rows, [textField('Database')], 0)
      }
      case 'showVariables': {
        const names = [...defaultVariables(database.schema).keys()].sort()
        const rows = names.map((name) => {
          const value = this.systemVariable(name)
          return [name, value === null || value === undefined ? '' : textOf(value)]
        })
        return filter(rows, [textField('Variable_name'), textField('Value')], 0)
      }
      case 'showWarnings':
        return {
          kind: 'rows',
          fields: [
            textField('Level'),
            { ...textField('Code'), type: integerType(4, true) },
            textField('Message'),
          ],
          rows: this.#lastWarnings.map((warning) => [warning.level, warning.code, warning.message]),
        }
    }
  }

  /** The table of a name, or MariaDB's error for one that does not exist. */
  #tableOf(name: string): TableSchema {
    const table = this.database.table(name)
    if (table === undefined)
      throw new SqlError(
        1146,
        '42S02',
        `Table '${this.database.schema}.${tableKey(name)}' doesn't exist`,
      )
    return table
  }

  /** The rows of SHOW that WHERE keeps, as a condition of their columns. */
  #filterRows(
    rows: SqlValue[][],
    fields: readonly Field[],
    where: Expression,
    sql: string,
  ): SqlValue[][] {
    if (rows.length === 0) return rows
    const compiler = this.compiler(sql)
    const alias = 'fr_show'
    const source: Source = {
      alias,
      orgTable: alias,
      columns: fields.map((field) => ({
        name: field.name,
        type: field.type,
        sql: `${sqliteName(alias)}.${sqliteName(field.name)}`,
        json: false,
        orgTable: alias,
        orgName: field.name,
      })),
    }
    const values = rows
      .map(
        (row) =>
          `SELECT ${row.map((value, i) => `${compiler.bind(value)} AS ${sqliteName(fields[i]!.name)}`).join(', ')}`,
      )
      .join(' UNION ALL ')
    const condition = compiler.expression(where, new Scope([source]), 'where clause')
    const kept = this.all(
      `SELECT rowid_order FROM (SELECT *, ROW_NUMBER() OVER () AS rowid_order FROM (${values})) AS ${sqliteName(alias)} WHERE ${condition.sql}`,
      compiler.params,
    )
    return kept.map(([index]) => rows[Number(index) - 1]!)
  }
}

/** A column of text of a result of SHOW. */
function textField(name: string): Field {
  return {
    name,
    table: '',
    orgTable: '',
    orgName: '',
    type: { ...stringType(64), caseSensitive: false } as Type,
  }
}

/** The parameters, ?, of a statement. */
function countParams(statement: Statement): number {
  let count = 0
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    const node = value as Record<string, unknown>
    if (node.kind === 'param' && typeof node.index === 'number')
      count = Math.max(count, node.index + 1)
    Object.values(node).forEach(visit)
  }
  visit(statement)
  return count
}
