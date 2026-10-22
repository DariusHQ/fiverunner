import {
  SqliteClient,
  type DatabaseClient,
  type DatabaseConnection,
  type DatabaseError,
} from '../db/client.ts'
import type { TimeZone } from '../scripting/time.ts'
import { isJsFunction, jsonOf, type JsValue } from './javascript.ts'
import mysqlSource from './lua/MySQL.lua?raw'

/** The event that gives FiveRunner's script of oxmysql the results of what its exports started. */
export const OXMYSQL_EVENT = '__fiverunner_internal:oxmysqlResponse'

/** The names of oxmysql, and those it provides, which FiveRunner's own oxmysql answers to. */
export const OXMYSQL_NAMES: ReadonlySet<string> = new Set([
  'oxmysql',
  'mysql-async',
  'ghmattimysql',
])

/** The version of oxmysql that FiveRunner emulates, which its own oxmysql says it is. */
export const OXMYSQL_VERSION = '2.14.3'

/** Opens the database of a connection string, which the server's clock and time zone are those of. */
export type DatabaseOpener = (options: {
  readonly connectionString: string
  readonly zone: TimeZone
  readonly clock: () => number
}) => Promise<DatabaseClient>

/** The files of FiveRunner's own oxmysql: its manifest, and its lib/MySQL.lua, which resources include. */
export function oxmysqlFiles(): Record<string, string> {
  const manifest = `fx_version 'cerulean'
game 'common'
lua54 'yes'

name 'oxmysql'
author 'FiveRunner'
version '${OXMYSQL_VERSION}'
description "FiveRunner's own oxmysql, which runs on its database"

provide 'mysql-async'
provide 'ghmattimysql'
`
  return { 'fxmanifest.lua': manifest, 'lib/MySQL.lua': mysqlSource }
}

/**
 * The name of the database of a connection string, as oxmysql reads them:
 * the path of mysql:// URLs, or the database or db of key=value pairs.
 */
export function databaseName(connectionString: string): string | undefined {
  if (connectionString.includes('mysql://')) {
    const match = /^(?:[^:/?#.]+:)?(?:\/\/(?:[^/?#]*@)?[^/?#:]*(?::[0-9]+)?)?([^?#]+)?/.exec(
      connectionString,
    )
    const name = match?.[1]?.replace(/^\/+/, '')
    return name === undefined || name === '' ? undefined : decodeURIComponent(name)
  }
  let name: string | undefined
  for (const pair of connectionString.split(';')) {
    const [key, value] = pair.split('=')
    if (key !== undefined && /^\s*(?:database|db)\s*$/i.test(key) && value !== undefined)
      name = value
  }
  return name === '' ? undefined : name
}

/**
 * FiveRunner's emulation of oxmysql, the resource that FiveM's resources
 * reach MySQL by: what its exports do with the arguments they get, as its
 * JavaScript does, the queries they run, and what they give back, print
 * and trigger. FiveRunner's own script of oxmysql, which takes the place of
 * oxmysql's JavaScript, hands what the exports get to this and calls back.
 */

/** What a query gives its callback: the rows, the first row, the first value, the insert id, or the rows changed. */
export type QueryType = 'query' | 'single' | 'scalar' | 'insert' | 'update'

/** The pattern of placeholders oxmysql's patched named-placeholders finds: ?, and :name and @name not after a quote. */
const NAMED = /(?:\?)|(?:(?<!["'])[:@](\d+|(?:[a-zA-Z][a-zA-Z0-9_]*)))/g

/** The texts between the placeholders of a query, and the placeholders: the indexes of ? and the names of the others. */
function parseNamed(query: string): [string[], (number | string)[]] | [string] {
  const parts: string[] = []
  const tokens: (number | string)[] = []
  let inQuote = false
  let escape = false
  let quote = 0
  let start = 0
  let cursor = 0
  let lastEnd = 0
  let unnamed = 0
  NAMED.lastIndex = 0
  for (let match = NAMED.exec(query); match !== null; match = NAMED.exec(query)) {
    const end = match.index
    for (let i = cursor; i < end; i++) {
      const char = query.charCodeAt(i)
      if (char === 92) escape = !escape
      else {
        if (escape) {
          escape = false
          continue
        }
        if (inQuote && char === quote) {
          // A quote twice stands for one.
          if (query.charCodeAt(i + 1) === quote) {
            i++
            continue
          }
          inQuote = false
        } else if (!inQuote && (char === 34 || char === 39)) {
          inQuote = true
          quote = char
        }
      }
    }
    if (!inQuote) {
      parts.push(query.substring(start, end))
      tokens.push(match[0].length === 1 ? unnamed++ : match[1]!)
      start = end + match[0].length
      lastEnd = start
    }
    cursor = end + match[0].length
  }
  if (tokens.length === 0) return [query]
  if (cursor < query.length) parts.push(query.substring(lastEnd))
  return [parts, tokens]
}

/** A part without the : or @ it ends with, which ::name and @@name leave before their placeholders. */
function withoutPrefix(part: string): string {
  const last = part.slice(-1)
  return last === ':' || last === '@' ? part.slice(0, -1) : part
}

/**
 * A query with named placeholders as one of ?, with the values of the
 * names, as oxmysql's patched named-placeholders converts them: :name and
 * @name are ?, ::name and @@name are ??, keys of the parameters may start
 * with : or @ too, and names without values are NULL.
 */
export function convertNamedPlaceholders(
  query: string,
  parameters: { [key: string]: JsValue },
): [string, JsValue[]] {
  const tree = parseNamed(query)
  if (tree.length === 1) return [query, []]
  const [parts, tokens] = tree
  let sql = withoutPrefix(parts[0]!)
  for (let i = 1; i < parts.length; i++) {
    if (/[:@]$/.test(parts[i - 1]!)) sql += '?'
    sql += '?'
    sql += withoutPrefix(parts[i]!)
  }
  if (parts.length === tokens.length) {
    if (/[:@]$/.test(parts.at(-1)!)) sql += '?'
    sql += '?'
  }
  // The patch takes keys without the prefixes that their names in the query lack.
  for (const key of Object.keys(parameters)) {
    if (key.startsWith('@') || key.startsWith(':')) {
      parameters[key.slice(1)] = parameters[key]
      delete parameters[key]
    }
  }
  return [sql, tokens.map((token) => parameters[token] ?? null)]
}

function isObject(value: JsValue): value is { [key: string]: JsValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a value is falsy in JavaScript, as oxmysql's checks of arguments take it. */
export function isFalsy(value: JsValue): boolean {
  return (
    value === null ||
    value === undefined ||
    value === false ||
    value === 0 ||
    value === '' ||
    Number.isNaN(value)
  )
}

/**
 * The query and its values as oxmysql's parseArguments gives them: named
 * placeholders of parameters that are an object become ?, an object for ?
 * gives its values by their numbers from 1, values that ? lack are NULL,
 * and more values than ? fail.
 */
export function parseArguments(query: JsValue, given: JsValue): [string, JsValue[]] {
  if (typeof query !== 'string')
    throw new Error(`Expected query to be a string but received ${typeofJs(query)} instead.`)
  let sql = query
  let parameters: JsValue = given
  if (isObject(parameters) && (sql.includes(':') || sql.includes('@'))) {
    ;[sql, parameters] = convertNamedPlaceholders(sql, parameters)
  }
  if (isFalsy(parameters) || isJsFunction(parameters)) parameters = []
  const placeholders = sql.match(/\?(?!\?)/g)?.length ?? 0
  if (!Array.isArray(parameters)) {
    // Values that are no object, such as strings, give what JavaScript indexes of them.
    const object = parameters as unknown as { [key: number]: JsValue }
    const values: JsValue[] = []
    for (let i = 0; i < placeholders; i++) values[i] = object[i + 1] ?? null
    return [sql, values]
  }
  if (placeholders > 0) {
    const missing = placeholders - parameters.length
    if (missing > 0) return [sql, [...parameters, ...new Array<JsValue>(missing).fill(null)]]
    if (missing < 0)
      throw new Error(`Expected ${placeholders} parameters, but received ${parameters.length}.`)
  }
  return [sql, parameters]
}

/** The name typeof gives a value in JavaScript. */
export function typeofJs(value: JsValue): string {
  if (value === null) return 'object'
  return typeof value
}

/** What oxmysql's prepare and rawExecute give their callbacks, by the first word of their query. */
export function executeType(query: JsValue): QueryType | null {
  if (typeof query !== 'string')
    throw new Error(`Expected query to be a string but received ${typeofJs(query)} instead.`)
  switch (query.substring(0, query.indexOf(' '))) {
    case 'INSERT':
      return 'insert'
    case 'UPDATE':
    case 'DELETE':
      return 'update'
    default:
      return null
  }
}

/** The values of each run of a prepared statement, as oxmysql's parseExecute reads them: an array of arrays, or of one. */
export function parseExecute(placeholders: number, given: JsValue): JsValue[][] {
  if (isFalsy(given) || typeof given !== 'object' || given === null) return []
  let parameters: JsValue[]
  if (!Array.isArray(given)) {
    // Objects give their values by their numbers from 1, as sparse arrays.
    parameters = []
    for (const [key, value] of Object.entries(given as object))
      parameters[Number.parseInt(key, 10) - 1] = value as JsValue
  } else parameters = given
  if (parameters.every((item) => Array.isArray(item))) return parameters as JsValue[][]
  if (parameters.every((item) => typeof item === 'object')) {
    return parameters.map((item) => {
      let row: JsValue[] = new Array<JsValue>(placeholders)
      if (!Array.isArray(item)) {
        if (item === null || item === undefined)
          throw new TypeError('Cannot convert undefined or null to object')
        for (const [key, value] of Object.entries(item as object))
          row[Number.parseInt(key, 10) - 1] = value as JsValue
      } else row = item
      for (let i = 0; i < placeholders; i++) if (row[i] === undefined) row[i] = null
      return row
    })
  }
  return [[...parameters]]
}

/** A query of a transaction, as oxmysql's parseTransaction reads them. */
export interface TransactionQuery {
  readonly query: string
  readonly params: JsValue[]
}

/** A property of a value, as JavaScript reads it: strings give their characters, and null and undefined fail. */
function property(value: JsValue, key: string | number): JsValue {
  if (value === null || value === undefined)
    throw new TypeError(`Cannot read properties of ${String(value)} (reading '${key}')`)
  if (typeof value !== 'string' && typeof value !== 'object') return undefined
  return (value as unknown as { [key: string]: JsValue })[key]
}

/**
 * The queries of a transaction, as oxmysql's parseTransaction reads them:
 * an array of queries and parameters, of objects with them, or of queries
 * that share parameters. The format of the first query is that of all, so
 * that others fail as they do in JavaScript.
 */
export function parseTransaction(queries: JsValue, given: JsValue): TransactionQuery[] {
  if (!Array.isArray(queries))
    throw new Error(`Transaction queries must be array, received '${typeofJs(queries)}'.`)
  const parameters: JsValue = isFalsy(given) || isJsFunction(given) ? [] : given
  if (Array.isArray(queries[0])) {
    return queries.map((item) => {
      const values = property(item, 1)
      if (typeofJs(values) !== 'object') {
        throw new Error(
          `Transaction parameters must be array or object, received '${typeofJs(values)}'.`,
        )
      }
      const [sql, params] = parseArguments(property(item, 0), values)
      return { query: sql, params }
    })
  }
  return queries.map((item) => {
    const isQuery = property(item, 'query') !== undefined
    const [sql, params] = parseArguments(
      isQuery ? property(item, 'query') : item,
      isQuery ? property(item, 'parameters') || property(item, 'values') : parameters,
    )
    return { query: sql, params }
  })
}

/** What a query's callback gets of its result, as oxmysql's parseResponse gives it. */
export function parseResponse(type: QueryType | null, result: JsValue): JsValue {
  const object = (value: JsValue) => (isObject(value) ? value : undefined)
  switch (type) {
    case 'insert':
      return object(result)?.insertId ?? null
    case 'update':
      return object(result)?.affectedRows ?? null
    case 'single':
      return (Array.isArray(result) ? result[0] : undefined) ?? null
    case 'scalar': {
      const row = Array.isArray(result) ? object(result[0] ?? null) : undefined
      return (row && Object.values(row)[0]) ?? null
    }
    default:
      return result ?? null
  }
}

/** The message of an error, as oxmysql's logError takes it: of errors, or strings without the place of FiveM's scripts. */
function messageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null) return String((error as Error).message)
  return String(error ?? '').replace(/SCRIPT ERROR: citizen:[\w/.]+:\d+[:\s]+/, '')
}

/** The values of an error's own properties, as msgpack-lite packs errors: mysql2's code, errno and the like. */
function errorObject(error: unknown): JsValue {
  if (typeof error !== 'object' || error === null)
    return error === undefined ? undefined : String(error)
  const object: { [key: string]: JsValue } = {}
  for (const [key, value] of Object.entries(error)) object[key] = value as JsValue
  return object
}

/** What a database operation needs of the server: its console, its events and convars, and the database. */
export interface OxMysqlHost {
  /** Opens the database of a connection string. */
  open(connectionString: string): Promise<DatabaseClient>
  /** Prints to oxmysql's console, as its JavaScript's console.log does. */
  print(text: string): void
  /** Triggers an event on the server, as oxmysql's TriggerEvent does. */
  trigger(name: string, args: JsValue[]): void
  /** Calls back the script of oxmysql with the result of an operation, at once. */
  complete(token: number, ok: boolean, value: JsValue): void
  convar(name: string, fallback: string): string
  /** Milliseconds by the clock of the server, which times out what waits. */
  now(): number
  /** Milliseconds by a clock of the host, which times queries for oxmysql's slow query warnings. */
  measure(): number
  /** The .sql files of the server's resources, which FiveRunner's own database starts with, by their paths. */
  seeds(): { readonly path: string; readonly sql: string }[]
  diagnose(message: string): void
}

/** An operation that waits for a connection: for the database to be connected, or a transaction of another to end. */
interface Waiting {
  /** When it found the connections blocked first, which its wait for their lock times out from. */
  since: number | undefined
  /** The SQL it runs, by which those that lock nothing wait for no transaction, or none for operations that write. */
  readonly sql: string | undefined
  readonly run: (connection: DatabaseConnection) => void
  readonly fail: (error: unknown) => void
}

/** An operation that starts, with what it completed with as it did. */
interface Starting {
  readonly token: number
  result: [boolean, JsValue] | undefined
}

/** What a callback is, as oxmysql's exports have them: whether there is one, and whether it awaits, as .await's does. */
export interface Callback {
  readonly given: boolean
  readonly isPromise: boolean
}

/** innodb_lock_wait_timeout, in milliseconds. */
const LOCK_WAIT_TIMEOUT = 50_000

/** How long oxmysql waits before it tries to connect again, in milliseconds. */
const RECONNECT_DELAY = 30_000

/**
 * How many round trips to the database a tick of the server makes room
 * for, as if each took a millisecond of its 50: the operations that the
 * callbacks of others start run in the same tick, as those of oxmysql
 * would, up to that many one after another.
 */
const ROUND_TRIPS = 50

/** The steps of an operation: a generator whose yields await what they yield, as the awaits of async functions do. */
type Steps = Generator<unknown, void, unknown>

/**
 * Runs the steps of an operation as an async function runs, each yield an
 * await: at once when what it yields is no promise, as what SQLite answers
 * is, so that operations run whole and in the order they came, and once it
 * settles when it is one, as what MySQL answers is. It calls `failed` with
 * what the steps threw, and `finished` after them either way.
 */
function drive(steps: Steps, failed: (error: unknown) => void, finished?: () => void): void {
  const resume = (value: unknown, threw: boolean): void => {
    for (;;) {
      let step: IteratorResult<unknown, void>
      try {
        step = threw ? steps.throw(value) : steps.next(value)
      } catch (error) {
        failed(error)
        finished?.()
        return
      }
      if (step.done === true) {
        finished?.()
        return
      }
      if (step.value instanceof Promise) {
        step.value.then(
          (result: unknown) => resume(result, false),
          (error: unknown) => resume(error, true),
        )
        return
      }
      value = step.value
      threw = false
    }
  }
  resume(undefined, false)
}

/**
 * The server's oxmysql: its connection to the database, as its pool, and
 * the operations its exports start, which run at the server's next tick,
 * as they would once mysql2 heard from the server, and complete for the
 * script of oxmysql at that tick's events.
 */
export class OxMysql {
  readonly #host: OxMysqlHost
  #client: DatabaseClient | undefined
  #connecting = false
  /** The tokens of the connections the script of oxmysql asked for, which complete once it is connected. */
  readonly #connects: number[] = []
  #retryAt: number | undefined
  /** What VERSION() gave, as oxmysql shows it before its messages. */
  #version = ''
  /** The operations that the exports started since the last tick, which run at the next, in the order they came. */
  readonly #queued: (() => void)[] = []
  readonly #waiting: Waiting[] = []
  /** The connections of the transactions of startTransaction, by their tokens. */
  readonly #transactions = new Map<number, { connection: DatabaseConnection; resource: string }>()
  #nextToken = 1
  /** The operation that starts, which completes as it returns from starting. */
  #starting: Starting | undefined

  constructor(host: OxMysqlHost) {
    this.#host = host
  }

  get ready(): boolean {
    return this.#client !== undefined
  }

  /** The prefix of oxmysql's messages, the version of the server in brackets. */
  get #prefix(): string {
    return `^5[${this.#version}]`
  }

  /**
   * Starts an operation of the exports with a token of its own, and gives
   * the token, whether the operation completes later, as `operation` says,
   * and what it completed with as it started, if it did: as oxmysql's
   * exports call back at once with what fails before they await.
   */
  start(operation: (token: number) => boolean): JsValue[] {
    const token = this.#nextToken++
    const outer = this.#starting
    const starting: Starting = { token, result: undefined }
    this.#starting = starting
    let later: boolean
    try {
      later = operation(token)
    } finally {
      this.#starting = outer
    }
    return starting.result === undefined ? [token, later] : [token, false, ...starting.result]
  }

  /** Completes an operation for the script of oxmysql: at once, or as it returns from starting it. */
  #complete(token: number, ok: boolean, value: JsValue): void {
    const starting = this.#starting
    if (starting?.token === token) starting.result = [ok, value]
    else this.#host.complete(token, ok, value)
  }

  /**
   * Connects to the database, as oxmysql does once it started, and again
   * every 30 seconds until it can, and completes once it is, at the next
   * tick. A script of oxmysql that started again connects again, as its
   * pool would, to the database it had.
   */
  connect(token?: number): boolean {
    if (this.#client !== undefined) {
      this.#host.print(`${this.#prefix} ^2Database server connection established!^0`)
      if (token !== undefined) this.#complete(token, true, true)
      return false
    }
    if (token !== undefined) this.#connects.push(token)
    if (this.#connecting) return true
    this.#connecting = true
    const connectionString =
      this.#host.convar('mysql_connection_string', '') || 'mysql://root@localhost'
    this.#host.open(connectionString).then(
      (client) => {
        this.#connecting = false
        // FiveRunner's own database starts with the tables of the .sql files of the resources.
        const seed = client.seed?.bind(client)
        if (seed !== undefined) {
          const seeds = this.#host.seeds()
          for (const error of seed(seeds)) {
            this.#host.diagnose(`FiveRunner's database failed to run a statement: ${error}`)
          }
          if (seeds.length > 0) {
            this.#host.diagnose(
              `FiveRunner's database starts empty, with the tables of the .sql files of the resources, which it ran: ${seeds.map(({ path }) => path).join(', ')}.`,
            )
          }
        }
        this.#client = client
        this.#version = client.version
        this.#host.print(`${this.#prefix} ^2Database server connection established!^0`)
        const connects = this.#connects.splice(0)
        this.#queued.push(() => {
          for (const waiting of connects) this.#complete(waiting, true, true)
        })
      },
      (error: unknown) => {
        this.#connecting = false
        const failure = error as Partial<DatabaseError>
        const message = String(failure.message ?? error).includes('auth_gssapi_client')
          ? 'Requested authentication using unknown plugin auth_gssapi_client.'
          : String(failure.message ?? error)
        this.#host.print(
          `^3Unable to establish a connection to the database (${failure.code})!\n^1Error${failure.errno === undefined ? '' : ` ${failure.errno}`}: ${message}^0`,
        )
        this.#host.print(
          'See https://github.com/overextended/oxmysql/issues/154 for more information.',
        )
        this.#retryAt = this.#host.now() + RECONNECT_DELAY
      },
    )
    return true
  }

  /**
   * Runs the operations that the exports started since the last tick, in
   * the order they came, then those that wait for connections once they
   * are free, and fails those that waited too long for a lock, round after
   * round while callbacks start more. It connects again once it is time to.
   */
  tick(): void {
    const now = this.#host.now()
    if (this.#retryAt !== undefined && now >= this.#retryAt) {
      this.#retryAt = undefined
      this.connect()
    }
    for (let round = 0; round < ROUND_TRIPS; round++) {
      for (const run of this.#queued.splice(0)) run()
      if (this.#client !== undefined) this.#runWaiting(this.#client, now)
      if (this.#queued.length === 0) return
    }
  }

  /** Runs the operations that wait for connections once they are free, and fails those that waited too long for a lock. */
  #runWaiting(client: DatabaseClient, now: number): void {
    for (const waiting of [...this.#waiting]) {
      const index = this.#waiting.indexOf(waiting)
      if (index === -1) continue
      const connection = client.connection()
      if (connection instanceof Promise) {
        this.#waiting.splice(index, 1)
        connection.then(waiting.run, waiting.fail)
        continue
      }
      if (!connection.blocked(waiting.sql)) {
        this.#waiting.splice(index, 1)
        waiting.run(connection)
        continue
      }
      connection.release()
      waiting.since ??= now
      if (now - waiting.since >= LOCK_WAIT_TIMEOUT) {
        this.#waiting.splice(index, 1)
        waiting.fail(
          Object.assign(new Error('Lock wait timeout exceeded; try restarting transaction'), {
            code: 'ER_LOCK_WAIT_TIMEOUT',
            errno: 1205,
            sqlState: 'HY000',
            sqlMessage: 'Lock wait timeout exceeded; try restarting transaction',
          }),
        )
      }
    }
  }

  /** Runs the steps of an operation, as drive() does, with the emulation as their this. */
  #drive(
    steps: (this: OxMysql) => Steps,
    failed: (error: unknown) => void,
    finished?: () => void,
  ): void {
    drive(steps.call(this), failed, finished)
  }

  /** Runs the steps of `run` on a connection of the pool once there is one, which it gives back after. */
  #withConnection(
    run: (this: OxMysql, connection: DatabaseConnection) => Steps,
    failed: (error: unknown) => void,
    sql?: string,
  ): void {
    this.#acquire(
      (connection) =>
        this.#drive(
          () => run.call(this, connection),
          failed,
          () => connection.release(),
        ),
      failed,
      sql,
    )
  }

  /**
   * Takes a connection of the pool for `go` once there is one: once the
   * database is connected, and once no transaction of another connection
   * is open, unless `sql` locks nothing, as those of SQLite keep the writes
   * of others waiting, in the order they came.
   */
  #acquire(
    go: (connection: DatabaseConnection) => void,
    failed: (error: unknown) => void,
    sql?: string,
  ): void {
    const client = this.#client
    if (client !== undefined && this.#waiting.length === 0) {
      const connection = client.connection()
      if (connection instanceof Promise) {
        connection.then(go, failed)
        return
      }
      if (!connection.blocked(sql)) {
        go(connection)
        return
      }
      connection.release()
      this.#waiting.push({ since: this.#host.now(), sql, run: go, fail: failed })
      return
    }
    this.#waiting.push({ since: undefined, sql, run: go, fail: failed })
  }

  /** The settings of oxmysql's convars, which it reads every second, so as they are. */
  #settings() {
    const host = this.#host
    let debug: boolean | JsValue = false
    const debugText = host.convar('mysql_debug', 'false')
    if (debugText !== 'false') {
      try {
        debug = JSON.parse(debugText) as JsValue
      } catch {
        debug = true
      }
    }
    const integer = (name: string, fallback: number) => {
      const value = Number.parseInt(host.convar(name, String(fallback)), 10)
      return Number.isNaN(value) ? fallback : value
    }
    return {
      debug,
      slow: integer('mysql_slow_query_warning', 200),
      resultSetWarning: integer('mysql_resultset_warning', 1000),
    }
  }

  /** Prints a query that took long or that mysql_debug asks for, as oxmysql's logQuery does. */
  #logQuery(resource: string, query: string, time: number, parameters: JsValue): void {
    const { debug, slow } = this.#settings()
    const debugged = debug !== false && (!Array.isArray(debug) || debug.includes(resource))
    if (time >= slow || debugged) {
      const params = parameters === undefined || parameters === null ? '' : ` ${jsonOf(parameters)}`
      this.#host.print(
        `${this.#prefix} ^3${resource} took ${time.toFixed(4)}ms to execute a query!\n${query}${params}^0`,
      )
    }
  }

  /** Warns of a result of more rows than mysql_resultset_warning, as oxmysql's validateResultSet does. */
  #validateResultSet(resource: string, query: string, result: JsValue): void {
    const length = Array.isArray(result) ? result.length : 0
    if (length < this.#settings().resultSetWarning) return
    this.#host.print(
      `^3Warning: ${resource} executed a query with an oversized result set (${length} results)!\n${query}^7`,
    )
  }

  /**
   * Reports an error of a query, as oxmysql's logError does: it triggers
   * oxmysql:error, and gives the message to a callback that awaits, or
   * prints it as an error.
   */
  #logError(
    token: number,
    resource: string,
    callback: Callback,
    error: unknown,
    query?: string,
    parameters?: JsValue,
    includeParameters = false,
  ): void {
    const message = messageOf(error)
    const output = `${resource} was unable to execute a query!${query ? `\nQuery: ${query}` : ''}${includeParameters ? `\n${jsonOf(parameters ?? undefined)}` : ''}\n${message}`
    this.#host.trigger('oxmysql:error', [
      { query, parameters, message, err: errorObject(error), resource },
    ])
    if (callback.given && callback.isPromise) {
      this.#complete(token, false, output)
      return
    }
    this.#host.print(`^1Error: ${output}^7`)
  }

  /**
   * Runs a query of query, single, scalar, insert and update, as oxmysql's
   * rawQuery does: its arguments fail at once, as they do before rawQuery
   * awaits, and the query runs at the next tick.
   */
  query(
    token: number,
    type: QueryType | null,
    resource: string,
    query: JsValue,
    given: JsValue,
    callback: Callback,
  ): boolean {
    let sql: string
    let parameters: JsValue[]
    try {
      ;[sql, parameters] = parseArguments(query, given)
    } catch (error) {
      this.#logError(
        token,
        resource,
        callback,
        error,
        typeof query === 'string' ? query : undefined,
        given,
      )
      return false
    }
    this.#queued.push(() =>
      this.#withConnection(
        function* (connection) {
          const start = this.#host.measure()
          let result: JsValue
          try {
            result = (yield connection.query(sql, parameters)) as JsValue
          } catch (error) {
            this.#logError(token, resource, callback, error, sql, parameters, true)
            return
          }
          this.#logQuery(resource, sql, this.#host.measure() - start, parameters)
          this.#validateResultSet(resource, sql, result)
          if (callback.given) this.#complete(token, true, parseResponse(type, result))
        },
        (error) => this.#logError(token, resource, callback, error, sql, parameters, true),
        sql,
      ),
    )
    return true
  }

  /** Runs a prepared statement, as oxmysql's rawExecute does, once for each set of values, which prepare unpacks. */
  execute(
    token: number,
    resource: string,
    query: JsValue,
    given: JsValue,
    callback: Callback,
    unpack: boolean,
  ): boolean {
    let type: QueryType | null
    let runs: JsValue[][]
    let placeholders: number
    try {
      type = executeType(query)
      placeholders = (query as string).split('?').length - 1
      runs = parseExecute(placeholders, given)
    } catch (error) {
      this.#logError(
        token,
        resource,
        callback,
        error,
        typeof query === 'string' ? query : undefined,
        given,
      )
      return false
    }
    const sql = query as string
    this.#queued.push(() =>
      this.#withConnection(
        function* (connection) {
          const responses: JsValue[] = []
          try {
            for (let index = 0; index < Math.max(runs.length, 1); index++) {
              const values = runs[index]
              if (values !== undefined)
                for (let i = values.length; i < placeholders; i++) values[i] = null
              const start = this.#host.measure()
              const result = (yield connection.execute(sql, values)) as JsValue
              responses.push(unpack ? parseResponse(type, result) : result)
              this.#logQuery(resource, sql, this.#host.measure() - start, values)
              this.#validateResultSet(resource, sql, result)
            }
          } catch (error) {
            this.#logError(token, resource, callback, error, sql, runs)
            return
          }
          if (!callback.given) return
          if (responses.length === 1) {
            const [response] = responses
            if (unpack && type === null) {
              const first = Array.isArray(response) ? response[0] : undefined
              if (
                first !== undefined &&
                first !== null &&
                isObject(first) &&
                Object.keys(first).length === 1
              ) {
                this.#complete(token, true, Object.values(first)[0] ?? null)
              } else this.#complete(token, true, first ?? null)
            } else this.#complete(token, true, response ?? null)
          } else this.#complete(token, true, responses)
        },
        (error) => this.#logError(token, resource, callback, error, sql, runs),
        sql,
      ),
    )
    return true
  }

  /** Runs queries in a transaction, as oxmysql's rawTransaction does: true once it commits, false if a query fails. */
  transaction(
    token: number,
    resource: string,
    queries: JsValue,
    given: JsValue,
    callback: Callback,
  ): boolean {
    let transactions: TransactionQuery[]
    try {
      transactions = parseTransaction(queries, given)
    } catch (error) {
      this.#logError(token, resource, callback, error)
      return false
    }
    const done = (response: boolean) => {
      if (callback.given) this.#complete(token, true, response)
    }
    const failed = (error: unknown) => {
      const failure = error as Partial<DatabaseError>
      const text =
        failure.sql ??
        `${transactions.map((query) => `${query.query} ${jsonOf(query.params)}`).join('\n')}\n${jsonOf(given ?? undefined)}`
      this.#host.print(
        `^1Error: ${resource} was unable to complete a transaction!\n${text}\n${failure.message}^7`,
      )
      this.#host.trigger('oxmysql:transaction-error', [
        {
          query: text,
          parameters: given,
          message: failure.message,
          err: errorObject(error),
          resource,
        },
      ])
      done(false)
    }
    this.#queued.push(() =>
      this.#withConnection(function* (connection) {
        try {
          yield connection.query('START TRANSACTION')
          for (const { query, params } of transactions) {
            const start = this.#host.measure()
            yield connection.query(query, params)
            this.#logQuery(resource, query, this.#host.measure() - start, params)
          }
          yield connection.query('COMMIT')
        } catch (error) {
          try {
            yield connection.query('ROLLBACK')
          } catch {
            // oxmysql ignores failures to roll back.
          }
          failed(error)
          return
        }
        done(true)
      }, failed),
    )
    return true
  }

  /** Starts a transaction of startTransaction on a connection of its own, which it keeps until the transaction ends. */
  begin(token: number, resource: string): boolean {
    const failed = (error: unknown) => {
      this.#logError(token, resource, { given: false, isPromise: false }, error)
      this.#complete(token, false, messageOf(error))
    }
    this.#queued.push(() =>
      this.#acquire((connection) => {
        this.#drive(
          function* () {
            yield connection.query('START TRANSACTION')
            this.#transactions.set(token, { connection, resource })
            this.#complete(token, true, token)
          },
          (error) => {
            connection.release()
            failed(error)
          },
        )
      }, failed),
    )
    return true
  }

  /** Runs a query of a transaction of startTransaction, which fails as its runQuery does, with the query and its values. */
  transactionQuery(
    token: number,
    transaction: number,
    closed: boolean,
    query: JsValue,
    given: JsValue,
  ): boolean {
    let sql: string
    let parameters: JsValue[]
    try {
      ;[sql, parameters] = parseArguments(query, given)
    } catch (error) {
      this.#complete(token, false, messageOf(error))
      return false
    }
    const fail = (error: unknown) =>
      this.#complete(token, false, `Query: ${sql}\n${jsonOf(parameters)}\n${messageOf(error)}`)
    this.#queued.push(() => {
      const entry = this.#transactions.get(transaction)
      if (closed || entry === undefined) {
        fail(new Error('Connection used by transaction timed out after 30 seconds.'))
        return
      }
      this.#drive(function* () {
        const result = (yield entry.connection.query(sql, parameters)) as JsValue
        this.#complete(token, true, result)
      }, fail)
    })
    return true
  }

  /** Ends a transaction of startTransaction, committing it or rolling it back, and gives its connection back. */
  end(token: number, transaction: number, commit: boolean, error?: string): boolean {
    this.#queued.push(() => {
      const entry = this.#transactions.get(transaction)
      if (entry === undefined) {
        this.#complete(token, true, false)
        return
      }
      this.#transactions.delete(transaction)
      const { connection, resource } = entry
      const finish = (response: boolean) => {
        connection.release()
        this.#complete(token, true, response)
      }
      this.#drive(
        function* () {
          try {
            yield connection.query(commit && error === undefined ? 'COMMIT' : 'ROLLBACK')
          } catch (failure) {
            try {
              yield connection.query('ROLLBACK')
            } catch {
              // oxmysql ignores failures to roll back.
            }
            this.#logError(token, resource, { given: false, isPromise: false }, failure)
            finish(false)
            return
          }
          if (error !== undefined) {
            this.#logError(token, resource, { given: false, isPromise: false }, error)
            finish(false)
          } else finish(commit)
        },
        (failure) => this.#logError(token, resource, { given: false, isPromise: false }, failure),
      )
    })
    return true
  }
}

/**
 * FiveRunner's own database, in SQLite's WebAssembly, which the host
 * compiled, as what opens oxmysql's: named as its connection string names
 * its database, or fiverunner.
 */
export function sqliteDatabase(module: WebAssembly.Module): DatabaseOpener {
  return ({ connectionString, zone, clock }) =>
    SqliteClient.create(module, {
      name: databaseName(connectionString) ?? 'fiverunner',
      zone,
      clock,
    })
}
