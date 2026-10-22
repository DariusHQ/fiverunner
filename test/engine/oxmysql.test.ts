import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { format } from '../../src/core/db/sqlstring.ts'
import type { JsValue } from '../../src/core/engine/javascript.ts'
import {
  convertNamedPlaceholders,
  databaseName,
  parseArguments,
  parseExecute,
  parseResponse,
  parseTransaction,
  sqliteDatabase,
  type DatabaseOpener,
} from '../../src/core/engine/oxmysql.ts'
import { UTC } from '../../src/core/scripting/time.ts'
import { createProcess, type TestProcess } from './helpers.ts'

const sqlite = WebAssembly.compile(
  readFileSync(
    new URL('../../node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm', import.meta.url),
  ),
)

/** 2024-05-06 07:08:09 UTC, when the servers' clocks start. */
const NOW = Date.UTC(2024, 4, 6, 7, 8, 9)

describe("oxmysql's arguments", () => {
  it('convert named placeholders as its patched named-placeholders does', () => {
    expect(
      convertNamedPlaceholders('SELECT * FROM t WHERE a = @a AND b = :b AND c = @c', {
        '@a': 1,
        b: 'x',
      }),
    ).toEqual(['SELECT * FROM t WHERE a = ? AND b = ? AND c = ?', [1, 'x', null]])
    // Names in strings are left as they are, and those of system variables are names of columns.
    expect(convertNamedPlaceholders('SELECT \':a\', "@a", @a', { a: 2 })).toEqual([
      'SELECT \':a\', "@a", ?',
      [2],
    ])
    expect(convertNamedPlaceholders('SELECT @@version', {})).toEqual(['SELECT ??', [null]])
    expect(convertNamedPlaceholders('SELECT 1', { a: 1 })).toEqual(['SELECT 1', []])
  })

  it('give queries their values as parseArguments does', () => {
    expect(parseArguments('SELECT ?, ?', [1])).toEqual(['SELECT ?, ?', [1, null]])
    expect(parseArguments('SELECT ?', { 1: 'x' })).toEqual(['SELECT ?', ['x']])
    expect(parseArguments('SELECT ?', 'abc')).toEqual(['SELECT ?', ['b']])
    expect(parseArguments('SELECT 1', undefined)).toEqual(['SELECT 1', []])
    expect(() => parseArguments('SELECT ?', [1, 2])).toThrow(
      'Expected 1 parameters, but received 2.',
    )
    expect(() => parseArguments(5, [])).toThrow(
      'Expected query to be a string but received number instead.',
    )
  })

  it('give prepared statements their runs as parseExecute does', () => {
    expect(parseExecute(2, [1, 2])).toEqual([[1, 2]])
    expect(parseExecute(2, [[1, 2], [3]])).toEqual([[1, 2], [3]])
    expect(parseExecute(2, [{ 1: 'a' }, { 2: 'b' }])).toEqual([
      ['a', null],
      [null, 'b'],
    ])
    expect(parseExecute(1, undefined)).toEqual([])
  })

  it('give transactions their queries as parseTransaction does', () => {
    expect(
      parseTransaction(
        [
          ['INSERT INTO t VALUES (?)', [1]],
          ['DELETE FROM t WHERE a = :a', { a: 2 }],
        ] as JsValue,
        undefined,
      ),
    ).toEqual([
      { query: 'INSERT INTO t VALUES (?)', params: [1] },
      { query: 'DELETE FROM t WHERE a = ?', params: [2] },
    ])
    expect(
      parseTransaction(
        [
          { query: 'DELETE FROM t WHERE a = :a', parameters: { a: 2 } },
          { query: 'INSERT INTO t VALUES (?)', values: [3] },
        ] as JsValue,
        undefined,
      ),
    ).toEqual([
      { query: 'DELETE FROM t WHERE a = ?', params: [2] },
      { query: 'INSERT INTO t VALUES (?)', params: [3] },
    ])
    // The format of the first query is that of all.
    expect(() =>
      parseTransaction([['SELECT 1', []], { query: 'SELECT 2' }] as JsValue, undefined),
    ).toThrow("Transaction parameters must be array or object, received 'undefined'.")
    expect(() => parseTransaction([['SELECT 1', []], 'SELECT 2'] as JsValue, undefined)).toThrow(
      "Transaction parameters must be array or object, received 'string'.",
    )
    expect(parseTransaction(['UPDATE t SET a = ?', 'UPDATE u SET b = ?'], [5])).toEqual([
      { query: 'UPDATE t SET a = ?', params: [5] },
      { query: 'UPDATE u SET b = ?', params: [5] },
    ])
    expect(() => parseTransaction('UPDATE t', undefined)).toThrow(
      "Transaction queries must be array, received 'string'.",
    )
  })

  it('give callbacks what parseResponse gives them', () => {
    const rows = [{ count: 0, name: 'x' }]
    expect(parseResponse('scalar', rows)).toBe(0)
    expect(parseResponse('single', rows)).toEqual({ count: 0, name: 'x' })
    expect(parseResponse('single', [])).toBe(null)
    expect(parseResponse('insert', { insertId: 5 })).toBe(5)
    expect(parseResponse('update', { affectedRows: 2 })).toBe(2)
  })

  it('are written into SQL as mysql2 writes them', () => {
    expect(
      format('SELECT * FROM t WHERE a IN (?) AND b = ? AND ?? = ?', [
        [1, 'x'],
        "it's",
        't.c',
        null,
      ]),
    ).toBe("SELECT * FROM t WHERE a IN (1, 'x') AND b = 'it\\'s' AND `t`.`c` = NULL")
    expect(format('UPDATE t SET ?', [{ a: 1, b: true, c: [1, 2] }])).toBe(
      'UPDATE t SET `a` = 1, `b` = true, `c` = 1, 2',
    )
    expect(
      format('INSERT INTO t VALUES ?', [
        [
          [1, 2],
          [3, 4],
        ],
      ]),
    ).toBe('INSERT INTO t VALUES (1, 2), (3, 4)')
    expect(format("SELECT '?', ?", [1])).toBe("SELECT '1', ?")
  })

  it('name databases as connection strings do', () => {
    expect(databaseName('mysql://root:pass@localhost:3306/qbox?charset=utf8mb4')).toBe('qbox')
    expect(databaseName('mysql://root@localhost')).toBeUndefined()
    expect(databaseName('server=127.0.0.1;uid=root;database=es_extended')).toBe('es_extended')
  })
})

/** A server with FiveRunner's database, whose opening its ticks wait for. */
async function server(): Promise<
  TestProcess & { run(until: string, ticks?: number): Promise<string[]> }
> {
  const opened: Promise<unknown>[] = []
  const open = sqliteDatabase(await sqlite)
  const database: DatabaseOpener = (options) => {
    const promise = open(options)
    opened.push(promise)
    return promise
  }
  let time = 0
  const proc = await createProcess({ database, timeZone: UTC, wallClock: () => NOW + time })
  return Object.assign(proc, {
    /** Ticks every 50 ms until a line has `until`, and gives the lines of the console but those of starts. */
    async run(until: string, ticks = 200): Promise<string[]> {
      const lines: string[] = []
      for (let i = 0; i < ticks; i++) {
        await Promise.allSettled(opened.splice(0))
        time = proc.time + 50
        proc.tickAt(time)
        lines.push(...proc.take())
        if (lines.some((line) => line.includes(until))) break
      }
      return lines.filter((line) => !/Creating script environments|Started resource/.test(line))
    },
  })
}

/** The files of a resource that uses oxmysql's library, with `code` as its server script. */
function app(
  code: string,
  manifest = "dependency 'oxmysql'\nserver_script '@oxmysql/lib/MySQL.lua'\n",
) {
  return {
    'fxmanifest.lua': `fx_version 'cerulean'\ngame 'gta5'\nlua54 'yes'\n${manifest}server_script 'server.lua'\n`,
    'server.lua': code,
  }
}

const CONNECTED =
  '[script:oxmysql] ^5[11.4.0-MariaDB-FiveRunner] ^2Database server connection established!^0'

describe("FiveRunner's oxmysql", () => {
  it("is the server's oxmysql when it has none, and runs MySQL's methods on FiveRunner's database", async () => {
    const proc = await server()
    proc
      .add(
        'app',
        app(`
MySQL.ready(function()
  MySQL.query.await('CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(20), admin TINYINT(1) DEFAULT 0, created DATETIME DEFAULT CURRENT_TIMESTAMP)')
  local id = MySQL.insert.await('INSERT INTO users (name) VALUES (?)', { 'Bob' })
  print(id, math.type(id))
  local row = MySQL.single.await('SELECT * FROM users WHERE name = @name', { ['@name'] = 'bob' })
  print(row.id, row.name, row.admin, row.created, math.type(row.created))
  print(MySQL.scalar.await('SELECT COUNT(*) FROM users'), MySQL.update.await('UPDATE users SET admin = 1'))
  local rows = MySQL.query.await('SELECT id, admin FROM users')
  print(#rows, rows[1].id, rows[1].admin)
  local result = MySQL.query.await('UPDATE users SET admin = 0 WHERE id = 1')
  print(result.affectedRows, result.changedRows, result.insertId, result.fieldCount, result.serverStatus, result.warningStatus)
  print(result.info)
  print('done')
end)
`),
      )
      .start()
    expect(await proc.run('done')).toEqual([
      CONNECTED,
      '[script:app] 1\tinteger',
      '[script:app] 1\tBob\tfalse\t1714979289000.0\tfloat',
      '[script:app] 1\t1',
      '[script:app] 1\t1\ttrue',
      '[script:app] 1\t1\t0\t0\t2\t0',
      '[script:app] Rows matched: 1  Changed: 1  Warnings: 0',
      '[script:app] done',
    ])
  })

  it('calls back with results, and prints the errors of queries as oxmysql does, which await raises', async () => {
    const proc = await server()
    proc
      .add(
        'app',
        app(`
AddEventHandler('oxmysql:error', function(data)
  print('event', data.resource, data.query, data.message, data.err.code)
end)
MySQL.ready(function()
  MySQL.query('SELECT 1 AS a', {}, function(rows) print('rows', rows[1].a) end)
  MySQL.query('SELECT nope', {}, function() print('never') end)
  print(pcall(MySQL.scalar.await, 'SELEC 1'))
  print(pcall(MySQL.query.await, 'SELECT ?', { 1, 2 }))
  print('done')
end)
`),
      )
      .start()
    expect(await proc.run('done')).toEqual([
      CONNECTED,
      '[script:app] rows\t1',
      "[script:app] event\tapp\tSELECT nope\tUnknown column 'nope' in 'field list'\tER_BAD_FIELD_ERROR",
      '[script:oxmysql] ^1Error: app was unable to execute a query!',
      '[script:oxmysql] Query: SELECT nope',
      '[script:oxmysql] []',
      "[script:oxmysql] Unknown column 'nope' in 'field list'^7",
      "[script:app] event\tapp\tSELEC 1\tYou have an error in your SQL syntax; check the manual that corresponds to your MariaDB server version for the right syntax to use near 'SELEC 1' at line 1\tER_PARSE_ERROR",
      '[script:app] false\tapp was unable to execute a query!',
      '[script:app] Query: SELEC 1',
      '[script:app] []',
      "[script:app] You have an error in your SQL syntax; check the manual that corresponds to your MariaDB server version for the right syntax to use near 'SELEC 1' at line 1",
      '[script:app] event\tapp\tSELECT ?\tExpected 1 parameters, but received 2.\tnil',
      '[script:app] false\tapp was unable to execute a query!',
      '[script:app] Query: SELECT ?',
      '[script:app] Expected 1 parameters, but received 2.',
      '[script:app] done',
    ])
  })

  it('runs the queries that callbacks start in the same tick, as if each took a millisecond', async () => {
    const proc = await server()
    proc
      .add(
        'app',
        app(`
MySQL.ready(function()
  Wait(0)
  for _, count in ipairs({ 10, 100 }) do
    local start = GetGameTimer()
    for i = 1, count do MySQL.scalar.await('SELECT ?', { i }) end
    print(count, GetGameTimer() - start)
    Wait(0)
  end
  print('done')
end)
`),
      )
      .start()
    expect(await proc.run('done')).toEqual([
      CONNECTED,
      '[script:app] 10\t50',
      '[script:app] 100\t100',
      '[script:app] done',
    ])
  })

  it('keeps writes waiting for the transactions of startTransaction, but not reads, which see what they changed', async () => {
    const proc = await server()
    proc
      .add(
        'app',
        app(`
MySQL.ready(function()
  MySQL.query.await('CREATE TABLE t (a INT)')
  local start = GetGameTimer()
  CreateThread(function()
    Wait(100)
    MySQL.insert.await('INSERT INTO t VALUES (2)')
    print('insert', GetGameTimer() - start)
  end)
  print('transaction', MySQL.startTransaction(function(query)
    query('INSERT INTO t VALUES (1)')
    print('read', MySQL.scalar.await('SELECT COUNT(*) FROM t'))
    Wait(1000)
  end), GetGameTimer() - start)
  Wait(100)
  print('rows', MySQL.scalar.await('SELECT COUNT(*) FROM t'))
  CreateThread(function()
    Wait(100)
    print(pcall(MySQL.insert.await, 'INSERT INTO t VALUES (3)'))
    print('late', GetGameTimer() - start)
  end)
  print('long', MySQL.startTransaction(function(query)
    query('INSERT INTO t VALUES (4)')
    Wait(60000)
  end))
  print('done')
end)
`),
      )
      .start()
    expect(await proc.run('done', 1400)).toEqual([
      CONNECTED,
      '[script:app] read\t1',
      '[script:app] transaction\ttrue\t1100',
      '[script:app] insert\t1100',
      '[script:app] rows\t2',
      '[script:app] false\tapp was unable to execute a query!',
      '[script:app] Query: INSERT INTO t VALUES (3)',
      '[script:app] []',
      '[script:app] Lock wait timeout exceeded; try restarting transaction',
      '[script:app] late\t51400',
      '[script:oxmysql] ^1Error: app was unable to execute a query!',
      '[script:oxmysql] Transaction has timed out after 30 seconds.^7',
      '[script:app] long\tfalse',
      '[script:app] done',
    ])
  })

  it('rolls back the transactions of an oxmysql that stops, which keep no other waiting', async () => {
    const proc = await server()
    proc.manager.getResource('oxmysql')!.start()
    proc
      .add(
        'app',
        app(
          `CreateThread(function()
  exports.oxmysql:awaitConnection()
  exports.oxmysql:query_async('CREATE TABLE t (a INT)')
  CreateThread(function()
    MySQL.startTransaction(function(query)
      query('INSERT INTO t VALUES (1)')
      print('holding')
      Wait(100000)
    end)
  end)
  Wait(500)
  local start = GetGameTimer()
  print('insert', exports.oxmysql:query_async('INSERT INTO t VALUES (2)').affectedRows, GetGameTimer() - start)
  print('rows', exports.oxmysql:scalar_async('SELECT COUNT(*) FROM t'))
  print('done')
end)`,
          "server_script '@oxmysql/lib/MySQL.lua'\n",
        ),
      )
      .start()
    expect(await proc.run('holding')).toEqual([CONNECTED, '[script:app] holding'])
    proc.manager.security.runAs('system.console', () =>
      proc.manager.console.commands.invoke('restart oxmysql', ''),
    )
    expect(await proc.run('done')).toEqual([
      '[resources] Stopping resource oxmysql',
      CONNECTED,
      '[script:app] insert\t1\t50',
      '[script:app] rows\t1',
      '[script:app] done',
    ])
  })

  it('runs transactions, which give false and print the error of the query that failed', async () => {
    const proc = await server()
    proc
      .add(
        'app',
        app(`
MySQL.ready(function()
  MySQL.query.await('CREATE TABLE t (a INT)')
  print(MySQL.transaction.await({ { 'INSERT INTO t VALUES (?)', { 1 } }, { 'INSERT INTO t VALUES (:a)', { a = 2 } } }))
  print(MySQL.transaction.await({ 'INSERT INTO t VALUES (3)', 'INSERT INTO nope VALUES (1)' }))
  print(MySQL.startTransaction(function(query)
    query('INSERT INTO t VALUES (?)', { 4 })
    print('inside', query('SELECT COUNT(*) AS c FROM t')[1].c)
    return false
  end))
  print(MySQL.startTransaction(function(query)
    query('INSERT INTO t VALUES (5)')
  end))
  print(json.encode(MySQL.query.await('SELECT a FROM t')))
  print('done')
end)
`),
      )
      .start()
    expect(await proc.run('done')).toEqual([
      CONNECTED,
      '[script:app] true',
      '[script:oxmysql] ^1Error: app was unable to complete a transaction!',
      '[script:oxmysql] INSERT INTO nope VALUES (1)',
      "[script:oxmysql] Table 'fiverunner.nope' doesn't exist^7",
      '[script:app] false',
      '[script:app] inside\t3',
      '[script:app] false',
      '[script:app] true',
      '[script:app] [{"a":1},{"a":2},{"a":5}]',
      '[script:app] done',
    ])
  })

  it('gives the exports of oxmysql, of mysql-async and of ghmattimysql', async () => {
    const proc = await server()
    proc
      .add(
        'app',
        app(
          `
CreateThread(function()
  exports.oxmysql:awaitConnection()
  print(exports.oxmysql:isReady())
  print(json.encode(exports.oxmysql:query_async('SELECT 1 AS a')), exports.oxmysql:scalarSync('SELECT 2'))
  local row = exports.oxmysql:prepare_async('SELECT ? AS a, ? AS b', { 1, 'x' })
  print(row.a, row.b)
  print(json.encode(exports.oxmysql:rawExecute_async('SELECT ? AS a', { { 1 }, { 2 } })))
  exports['mysql-async']:mysql_fetch_scalar('SELECT 3', {}, function(value) print('mysql-async', value) end)
  print('ghmattimysql', exports.ghmattimysql:scalarSync('SELECT 4'))
  Wait(100)
  print('done')
end)
`,
          "dependency 'oxmysql'\n",
        ),
      )
      .start()
    expect(await proc.run('done')).toEqual([
      CONNECTED,
      '[script:app] true',
      '[script:app] [{"a":1}]\t2',
      '[script:app] 1\tx',
      '[script:app] [[{"a":1}],[{"a":2}]]',
      '[script:app] mysql-async\t3',
      '[script:app] ghmattimysql\t4',
      '[script:app] done',
    ])
  })

  it("takes the place of oxmysql's JavaScript, and starts with the tables of the resources' .sql files", async () => {
    const proc = await server()
    proc.add('oxmysql', {
      'fxmanifest.lua': "fx_version 'cerulean'\ngame 'common'\nserver_script 'dist/build.js'\n",
      'dist/build.js': '// oxmysql',
      'lib/MySQL.lua':
        'MySQL = { scalar = { await = function(sql) return exports.oxmysql:scalar_async(sql) end } }',
    })
    proc.add('schema', {
      'fxmanifest.lua': "fx_version 'cerulean'\ngame 'common'\n",
      // The statements that need the tables of a file that comes after run again once it ran.
      'sql/install.sql': "INSERT INTO items VALUES ('water');\n\nNOPE;",
      'sql/tables.sql': 'CREATE TABLE items (name VARCHAR(10));',
    })
    // So do those of categories, as ESX keeps the SQL that installs it.
    proc.manager.files.makeDirectory('resources/[SQL]')
    proc.manager.files.write(
      'resources/[SQL]/legacy.sql',
      new TextEncoder().encode("INSERT INTO items VALUES ('bread');"),
    )
    proc.manager.getResource('oxmysql')!.start()
    proc
      .add(
        'app',
        app(
          `CreateThread(function() Wait(0) print(MySQL.scalar.await('SELECT GROUP_CONCAT(name ORDER BY name) FROM items')) print('done') end)`,
          "server_script '@oxmysql/lib/MySQL.lua'\n",
        ),
      )
      .start()
    expect(await proc.run('done')).toEqual([
      CONNECTED,
      '[script:app] bread,water',
      '[script:app] done',
    ])
    expect(proc.diagnostics).toEqual([
      "oxmysql: FiveRunner runs only Lua scripts, so it skips dist/build.js, and runs its own emulation of oxmysql in its place, which gives oxmysql's exports.",
      "oxmysql: FiveRunner's database failed to run a statement: resources/schema/sql/install.sql:3: You have an error in your SQL syntax; check the manual that corresponds to your MariaDB server version for the right syntax to use near 'NOPE' at line 1 (NOPE)",
      "oxmysql: FiveRunner's database starts empty, with the tables of the .sql files of the resources, which it ran: resources/[SQL]/legacy.sql, resources/schema/sql/install.sql, resources/schema/sql/tables.sql.",
    ])
  })
})
