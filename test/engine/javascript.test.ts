import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { sqliteDatabase } from '../../src/core/engine/oxmysql.ts'
import { clientOf, createProcess, runCommand, type TestProcess } from './helpers.ts'

const sqlite = WebAssembly.compile(
  readFileSync(
    new URL('../../node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm', import.meta.url),
  ),
)

/** Starts a resource of one server script of JavaScript. */
function start(process: TestProcess, source: string, name = 'js'): void {
  process
    .add(name, {
      'fxmanifest.lua': `fx_version 'cerulean'\ngame 'gta5'\nserver_script 'main.js'`,
      'main.js': source,
    })
    .start()
}

/** What a resource of one server script of JavaScript prints as it starts. */
function run(process: TestProcess, source: string): string[] {
  start(process, source)
  return printed(process)
}

function printed(process: TestProcess, name = 'js'): string[] {
  const prefix = `[script:${name}] `
  return process
    .take()
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length))
}

describe('Scripts of JavaScript', () => {
  it('run in a global scope that the scripts of their resource share', async () => {
    const server = await createProcess()
    server
      .add('js', {
        'fxmanifest.lua': `fx_version 'cerulean'
game 'gta5'
server_scripts { 'a.js', 'b.js' }`,
        'a.js': `var shared = 'var'
const lexical = 'const'
function hello() { return 'function' }`,
        'b.js': `console.log(shared, lexical, hello())`,
      })
      .start()
    expect(printed(server)).toEqual(['var const function'])
  })

  it('call natives by the names of their globals, with the values of JavaScript', async () => {
    const server = await createProcess()
    expect(
      run(
        server,
        `console.log(GetCurrentResourceName(), IsDuplicityVersion(), GetConvar('missing', 'fallback'))
console.log(typeof GetCurrentResourceName, typeof NoSuchNative, GetHashKey('adder'))`,
      ),
    ).toEqual(['js true fallback', 'function undefined -1216765807'])
    expect(server.diagnostics).toEqual([])
  })

  it('format what the console prints, as FiveM does', async () => {
    const server = await createProcess()
    expect(
      run(
        server,
        `console.log('%s is %d', 'one', 1, { a: [1, 2] })
console.info('info')
console.warn('warn')
console.error('error')
console.log(null, undefined, [1], new Map([[1, 2]]).size)`,
      ),
    ).toEqual([
      'one is 1 {',
      '  "a": [',
      '    1,',
      '    2',
      '  ]',
      '}',
      'Info: info',
      '^3Warning: warn^7',
      '^1Error: error^7',
      'null undefined [',
      '  1',
      '] 1',
    ])
  })

  it('wait with timers, by the clock of the process, and run the jobs of promises', async () => {
    const server = await createProcess()
    start(
      server,
      `const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
;(async () => {
  console.log('before')
  await delay(100)
  console.log('after', GetGameTimer())
})()
let ticks = 0
const tick = setTick(() => {
  if (++ticks === 2) {
    console.log('ticked twice')
    clearTick(tick)
  }
})
const every = setInterval(() => console.log('interval'), 50)
setTimeout(() => clearInterval(every), 120)`,
    )
    server.tickAt(10)
    server.tickAt(20)
    server.tickAt(60)
    server.tickAt(110)
    server.tickAt(130)
    server.tickAt(170)
    expect(server.take().filter((line) => line.startsWith('[script:js]'))).toEqual([
      '[script:js] before',
      '[script:js] ticked twice',
      '[script:js] interval',
      // The jobs of promises run once the timers of the tick did.
      '[script:js] interval',
      '[script:js] after 110',
    ])
  })

  it('report errors as FiveM does, without stopping what comes next', async () => {
    const server = await createProcess()
    start(
      server,
      `on('boom', () => { throw new Error('in a listener') })
on('boom', () => console.log('still here'))
emit('boom')`,
    )
    const lines = server.take().filter((line) => line.startsWith('[script:js]'))
    expect(lines[0]).toBe("[script:js] ^1SCRIPT ERROR in event `boom': Error: in a listener^7")
    expect(lines).toContain('[script:js] still here')
  })

  it('that fail to load say so', async () => {
    const server = await createProcess()
    start(server, `syntax error here`)
    expect(server.take().join('\n')).toContain('Failed to load script main.js.')
  })

  it('read dates by the wall clock of the process', async () => {
    const now = Date.UTC(2026, 9, 31, 22, 5, 7)
    const server = await createProcess({ wallClock: () => now })
    expect(
      run(
        server,
        `console.log(Date.now(), new Date().toISOString(), new Date(0).toISOString())
console.log(new Date() instanceof Date, new Date().constructor === Date, typeof Date())
console.log(new Date(2020, 1, 2).getFullYear(), Date.UTC(1970, 0, 2))`,
      ),
    ).toEqual([
      `${now} 2026-10-31T22:05:07.000Z 1970-01-01T00:00:00.000Z`,
      'true true string',
      '2020 86400000',
    ])
  })

  it('queue microtasks to run before timers, and report what they throw', async () => {
    const server = await createProcess()
    start(
      server,
      `setTimeout(() => console.log('timer'), 1)
queueMicrotask(() => console.log('microtask'))
queueMicrotask(() => { throw new Error('in a microtask') })
console.log('script')`,
    )
    server.tickAt(10)
    const lines = printed(server)
    expect(lines.slice(0, 3)).toEqual([
      'script',
      'microtask',
      '^1SCRIPT ERROR in microtask: Error: in a microtask^7',
    ])
    expect(lines.at(-1)).toBe('timer')
  })
})

describe('Events of JavaScript', () => {
  it('reach Lua and come back, with their values', async () => {
    const server = await createProcess()
    server
      .add('lua', {
        'fxmanifest.lua': `fx_version 'cerulean'\ngame 'gta5'\nserver_script 'main.lua'`,
        'main.lua': `AddEventHandler('ping', function(number, text, list, map)
    print(number, text, #list, map.key, type(number))
    TriggerEvent('pong', { a = 1, b = { 2, 3 } }, 1.5, true)
end)`,
      })
      .start()
    start(
      server,
      `on('pong', (object, float, flag) => console.log(object.a, JSON.stringify(object.b), float, flag))
emit('ping', 42, 'text', [1, 2, 3], { key: 'value' })`,
    )
    expect(server.take().filter((line) => line.startsWith('[script:'))).toEqual([
      '[script:lua] 42\ttext\t3\tvalue\tnumber',
      '[script:js] 1 [2,3] 1.5 true',
    ])
  })

  it('go over the network, whose source is the player, to events that are safe for it', async () => {
    const test = await clientOf()
    test.server
      .add('js', {
        'fxmanifest.lua': `fx_version 'cerulean'\ngame 'gta5'\nserver_script 'main.js'`,
        'main.js': `onNet('safe', (value) => { console.log('safe', source, value); emitNet('answer', source, value * 2) })
on('unsafe', () => console.log('never'))`,
      })
      .start()
    test.client
      .add('js', {
        'fxmanifest.lua': `fx_version 'cerulean'\ngame 'gta5'\nclient_script 'main.js'`,
        'main.js': `onNet('answer', (value) => console.log('answer', value))
emitNet('safe', 21)
emitNet('unsafe')`,
      })
      .start()
    test.session.tick()
    test.server.tickAt(test.server.time + 10)
    test.session.tick()
    test.client.tickAt(test.client.time + 10)
    expect(printed(test.server)).toEqual([
      `safe ${test.player.netId} 21`,
      '^1Error: Event unsafe was not safe for net^7',
    ])
    expect(printed(test.client)).toEqual(['answer 42'])
  })
})

describe('Exports of JavaScript', () => {
  it('go both ways with Lua, with the functions they take', async () => {
    const server = await createProcess()
    server
      .add('lua', {
        'fxmanifest.lua': `fx_version 'cerulean'\ngame 'gta5'\nserver_script 'main.lua'`,
        'main.lua': `exports('double', function(n) return n * 2 end)
exports('call', function(fn, n) return fn(n) + 1 end)
AddEventHandler('fromJs', function()
    print(exports.js:triple(5), exports.js:callBack(function(n) return n * 10 end))
end)`,
      })
      .start()
    start(
      server,
      `exports('triple', (n) => n * 3)
exports('callBack', (fn) => fn(4))
console.log(exports.lua.double(21), exports.lua.call((n) => n * 100, 2))
emit('fromJs')
try { exports.lua.missing() } catch (error) { console.log(error.message) }`,
    )
    expect(server.take().filter((line) => line.startsWith('[script:'))).toEqual([
      '[script:js] 42 201',
      '[script:lua] 15\t40',
      '[script:js] No such export missing in resource lua',
    ])
  })

  it('that are async give Lua what they resolve to', async () => {
    const server = await createProcess()
    server
      .add('lua', {
        'fxmanifest.lua': `fx_version 'cerulean'\ngame 'gta5'\nserver_script 'main.lua'`,
        'main.lua': `AddEventHandler('go', function()
    CreateThread(function() print('async', exports.js:later(20)) end)
end)`,
      })
      .start()
    start(
      server,
      `exports('later', (n) => new Promise((resolve) => setTimeout(() => resolve(n + 1), 10)))
setTimeout(() => emit('go'), 1)`,
    )
    server.tickAt(10)
    server.tickAt(20)
    server.tickAt(40)
    server.tickAt(60)
    expect(server.take()).toContain('[script:lua] async\t21')
  })
})

describe('State bags of JavaScript', () => {
  it('read and write what Lua reads and writes', async () => {
    const server = await createProcess()
    server
      .add('lua', {
        'fxmanifest.lua': `fx_version 'cerulean'\ngame 'gta5'\nserver_script 'main.lua'`,
        'main.lua': `AddEventHandler('look', function() print(GlobalState.fromJs) GlobalState.fromLua = 'lua' end)`,
      })
      .start()
    start(
      server,
      `GlobalState.fromJs = 'js'
emit('look')
console.log(GlobalState.fromLua, GlobalState.missing)`,
    )
    expect(server.take().filter((line) => line.startsWith('[script:'))).toEqual([
      '[script:lua] js',
      '[script:js] lua null',
    ])
  })
})

describe('Consoles of JavaScript', () => {
  it('run code in the global scope of a resource, and print what it gives', async () => {
    const server = await createProcess()
    const resource = server.add('js', {
      'fxmanifest.lua': `fx_version 'cerulean'\ngame 'gta5'\nserver_script 'main.js'`,
      'main.js': `const balance = 5`,
    })
    resource.start()
    const [runtime] = resource.runtimes
    const evaluate = (code: string) => resource.enter(() => runtime!.evaluate(code), runtime!)
    evaluate('balance + 1')
    evaluate('Promise.resolve(balance * 2)')
    evaluate('undefined')
    evaluate('balance.nope.nope')
    const lines = printed(server)
    expect(lines.slice(0, 2)).toEqual(['6', '10'])
    expect(lines[2]).toContain('SCRIPT ERROR in console: TypeError')
  })
})

describe('A resource of both languages', () => {
  it('has a runtime for each, which stop together', async () => {
    const server = await createProcess()
    const resource = server.add('both', {
      'fxmanifest.lua': `fx_version 'cerulean'\ngame 'gta5'\nserver_scripts { 'a.lua', 'b.js' }`,
      'a.lua': `print('lua')\nAddEventHandler('onResourceStop', function() print('lua stops') end)`,
      'b.js': `console.log('js')\non('onResourceStop', () => console.log('js stops'))`,
    })
    resource.start()
    expect(resource.runtimes).toHaveLength(2)
    resource.stop()
    expect(resource.runtimes).toHaveLength(0)
    expect(printed(server, 'both')).toEqual(['lua', 'js', 'lua stops', 'js stops'])
  })
})

describe('Node on servers', () => {
  it('requires what resources carry, and its own modules', async () => {
    const server = await createProcess()
    server
      .add('js', {
        'fxmanifest.lua': `fx_version 'cerulean'\ngame 'gta5'\nserver_script 'main.js'`,
        'main.js': `const one = require('./lib/one')
console.log(one.name, one.two(), require('./lib/one') === one)
console.log(require('./data.json').key, require('pkg'), require('dir'))
console.log(typeof require('node:path').join, typeof require('fs').readFileSync)
console.log(module.exports !== undefined, __filename, __dirname)
try { require('missing') } catch (error) { console.log(error.code, error.message) }`,
        'lib/one.js': `exports.name = __filename
exports.two = () => require('./two')`,
        'lib/two.js': `module.exports = 'two'`,
        'data.json': `{ "key": "value" }`,
        'node_modules/pkg/package.json': `{ "main": "lib/entry" }`,
        'node_modules/pkg/lib/entry.js': `module.exports = 'package'`,
        'node_modules/dir/index.js': `module.exports = 'directory'`,
      })
      .start()
    expect(printed(server)).toEqual([
      'resources/js/lib/one.js two true',
      'value package directory',
      'function function',
      'true resources/js/index.js resources/js',
      "MODULE_NOT_FOUND Cannot find module 'missing'",
    ])
  })

  it('has Buffer, as Node gives it', async () => {
    const server = await createProcess()
    expect(
      run(
        server,
        `const text = Buffer.from('héllo')
console.log(text.length, text.toString('hex'), text.toString('base64'), text.toString('ascii'))
console.log(Buffer.from('aGk=', 'base64').toString(), Buffer.from('6869', 'hex').toString(), Buffer('hi').toString())
console.log(Buffer.concat([Buffer.from('a'), Buffer.from('b')]).toString(), Buffer.concat([Buffer.from('ab'), Buffer.from('c')], 1).toString())
const number = Buffer.alloc(8)
number.writeUInt16LE(513, 0)
number.writeUint32BE(1, 4)
console.log(Array.from(number).join(), number.readUInt8(1), number.readInt32BE(4), Buffer.isBuffer(number))
console.log(Buffer.alloc(5, 'ab').toString(), text.indexOf('llo'), text.includes('x'), text.indexOf(108), text.slice(1, 3).length)
console.log(Buffer.from('a').equals(Buffer.from('a')), Buffer.compare(Buffer.from('a'), Buffer.from('b')), JSON.stringify(Buffer.from([1])))
console.log(Buffer.alloc(70000, 'a').toString('latin1').length)`,
      ),
    ).toEqual([
      '6 68c3a96c6c6f aMOpbGxv hC)llo',
      'hi hi hi',
      'ab a',
      '1,2,0,0,0,0,0,1 2 1 true',
      'ababa 3 false 3 2',
      'true -1 {"type":"Buffer","data":[1]}',
      '70000',
    ])
  })

  it('has events and streams, for classes old and new', async () => {
    const server = await createProcess()
    expect(
      run(
        server,
        `const EventEmitter = require('events')
const { Readable, Transform, Writable } = require('stream')
function Old() { EventEmitter.call(this) }
require('util').inherits(Old, EventEmitter)
const old = new Old()
old.once('one', (value) => console.log('once', value))
old.on('two', (value) => console.log('on', value))
console.log(old.emit('one', 1), old.emit('one', 2), old.emit('two', 3), old.listenerCount('two'))
class New extends EventEmitter {}
try { new New().emit('error', new Error('unhandled')) } catch (error) { console.log(error.message) }
const chunks = []
const out = new Writable({ write(chunk, _encoding, done) { chunks.push(chunk.toString()); done() } })
const upper = new Transform({ transform(chunk, _encoding, done) { done(null, chunk.toString().toUpperCase()) } })
out.on('finish', () => console.log(chunks.join()))
const source = new Readable()
source.pipe(upper).pipe(out)
source.push('a')
source.push('b')
source.push(null)`,
      ),
    ).toEqual(['once 1', 'on 3', 'true false true 1', 'unhandled', 'A,B'])
  })

  it('reads and writes the files of the process', async () => {
    const server = await createProcess()
    start(
      server,
      `const fs = require('fs')
const path = require('path')
const root = path.join(GetResourcePath(GetCurrentResourceName()), 'out')
fs.mkdirSync(root, { recursive: true })
const file = path.join(root, 'file.txt')
fs.writeFileSync(file, 'one')
fs.appendFileSync(file, ' two')
console.log(fs.readFileSync(file, 'utf8'), fs.readFileSync(file).length, fs.existsSync(file), fs.existsSync(file + 'x'))
console.log(fs.readdirSync(root).join(), fs.statSync(root).isDirectory(), fs.statSync(file).size)
try { fs.readFileSync(file + 'x') } catch (error) { console.log(error.code) }
fs.promises.readFile(file, 'utf8').then((text) => console.log('promise', text))
fs.readFile(file, 'utf8', (error, text) => console.log('callback', error, text))`,
    )
    expect(printed(server)).toEqual([
      'one two 7 true false',
      'file.txt true 7',
      'ENOENT',
      'promise one two',
      'callback null one two',
    ])
  })

  it('hashes as its crypto does', async () => {
    const server = await createProcess()
    const hashes = ['md5', 'sha1', 'sha256', 'sha512']
    expect(
      run(
        server,
        `const crypto = require('crypto')
for (const name of ${JSON.stringify(hashes)}) {
  console.log(crypto.createHash(name).update('ab').update('c').digest('hex'))
  console.log(crypto.createHmac(name, 'key').update('abc').digest('base64'))
}
console.log(crypto.createHmac('sha256', 'k'.repeat(100)).update('abc').digest('hex'))
try { crypto.createHash('sha0') } catch (error) { console.log(error.message) }
console.log(crypto.randomBytes(4).length, crypto.randomUUID().length)`,
      ),
    ).toEqual([
      ...hashes.flatMap((name) => [
        createHash(name).update('abc').digest('hex'),
        createHmac(name, 'key').update('abc').digest('base64'),
      ]),
      createHmac('sha256', 'k'.repeat(100)).update('abc').digest('hex'),
      'Digest method not supported',
      '4 36',
    ])
  })

  it('stops at what reaches the machine', async () => {
    const server = await createProcess()
    start(
      server,
      `const socket = require('net').connect(6379, 'localhost')
socket.on('error', (error) => console.log(error.code))
try { require('http').request('http://localhost') } catch (error) { console.log(error.message) }`,
    )
    server.tickAt(10)
    expect(printed(server)).toEqual([
      'FiveRunner does not run http.request for JavaScript resources',
      'ECONNREFUSED',
    ])
  })

  it('is on no client', async () => {
    const test = await clientOf()
    test.client
      .add('js', {
        'fxmanifest.lua': `fx_version 'cerulean'\ngame 'gta5'\nclient_script 'main.js'`,
        'main.js': `console.log(typeof require, typeof Buffer, typeof process, typeof module)`,
      })
      .start()
    expect(printed(test.client)).toEqual(['undefined undefined undefined undefined'])
  })
})

describe('The port of MySQL', () => {
  /** What a resource prints that speaks the client end of the protocol of MySQL, with `talk` as its conversation. */
  async function talk(conversation: string, connectionString: string): Promise<string[]> {
    const opened: Promise<unknown>[] = []
    const open = sqliteDatabase(await sqlite)
    const server = await createProcess({
      database: (options) => {
        const promise = open(options)
        opened.push(promise)
        return promise
      },
    })
    runCommand(
      server.manager,
      `set mysql_connection_string "${connectionString}"`,
      'system.console',
    )
    server
      .add('js', {
        'fxmanifest.lua': `fx_version 'cerulean'\ngame 'gta5'\nserver_script 'main.js'`,
        'main.js': `const net = require('net')
const { once } = require('events')
const packet = (sequence, ...parts) => {
  const payload = Buffer.concat(parts.map((part) => Buffer.from(part)))
  const header = Buffer.alloc(4)
  header.writeUInt16LE(payload.length)
  header[3] = sequence
  return Buffer.concat([header, payload])
}
const payloads = (data) => {
  const list = []
  for (let at = 0; at < data.length; at += 4 + data.readUInt16LE(at)) {
    list.push(data.subarray(at + 4, at + 4 + data.readUInt16LE(at)))
  }
  return list
}
const answer = async (socket) => payloads((await once(socket, 'data'))[0])
const ask = async (socket, data) => {
  socket.write(data)
  return answer(socket)
}
;(async () => {
  try {
    ${conversation}
  } catch (error) {
    console.log(error.stack)
  }
})()`,
      })
      .start()
    for (let time = 50; time < 3000; time += 50) {
      await Promise.allSettled(opened.splice(0))
      server.tickAt(time)
    }
    return printed(server)
  }

  it("answers with FiveRunner's database, in text and in binary rows", async () => {
    const lines = await talk(
      `const socket = net.connect(3306, '127.0.0.1')
const [greeting] = await answer(socket)
console.log(greeting[0], greeting.subarray(1, greeting.indexOf(0, 1)).toString())
console.log((await ask(socket, packet(1, Buffer.alloc(40))))[0][0])
console.log((await ask(socket, packet(0, [3], 'CREATE TABLE app (id INT, name TEXT, born DATETIME, price DECIMAL(5,2), ok TINYINT(1))')))[0][0])
console.log((await ask(socket, packet(0, [3], "INSERT INTO app VALUES (7, 'seven', '2000-01-02 03:04:05', 1.5, 1), (8, NULL, NULL, NULL, NULL)")))[0][1])
const text = await ask(socket, packet(0, [3], 'SELECT id, name, born, price, ok FROM app ORDER BY id'))
console.log(text[0][0], text.length, text[1][text[1].length - 6], text[7].toString('latin1'), Array.from(text[8]).join())
const [failed] = await ask(socket, packet(0, [3], 'SELECT * FROM missing'))
console.log(failed[0], failed.readUInt16LE(1))
const [prepared] = await ask(socket, packet(0, [0x16], 'SELECT id, name, born, price, ok, TIME("26:03:04") AS time, 0.5e0 AS half FROM app WHERE id = ?'))
console.log(prepared.readUInt16LE(7))
const execute = [[0x17], prepared.subarray(1, 5), [0, 1, 0, 0, 0], [0, 1, 3, 0, 7, 0, 0, 0]]
const binary = await ask(socket, packet(0, ...execute))
console.log(binary[0][0], binary.length, Array.from(binary[9]).join())`,
      'mysql://root:secret@localhost/app',
    )
    expect(lines).toEqual([
      '10 11.4.0-MariaDB-FiveRunner',
      '0',
      '0',
      '2',
      // Of the column of the int, 3 is the type. Rows of text have text, and 251 for null.
      '5 10 3 \x017\x05seven\x132000-01-02 03:04:05\x041.50\x011 1,56,251,251,251,251',
      '255 1146',
      '1',
      `7 11 ${[
        '0,0,0', // The head of a row, and no nulls among its 7 columns.
        '7,0,0,0', // INT
        '5,115,101,118,101,110', // TEXT
        '7,208,7,1,2,3,4,5', // DATETIME
        '4,49,46,53,48', // DECIMAL
        '1', // TINYINT
        '8,0,1,0,0,0,2,3,4', // TIME
        '0,0,0,0,0,0,224,63', // DOUBLE
      ].join()}`,
    ])
  })

  it('is the one that the connection string names', async () => {
    const lines = await talk(
      `const [greeting] = await answer(net.connect({ port: 3307, host: 'db.example' }))
console.log(greeting[0])
net.connect(3306).on('error', (error) => console.log(error.code))`,
      'mysql://root:3306@db.example:3307/app',
    )
    expect(lines).toEqual(['10', 'ECONNREFUSED'])
  })
})

describe('Natives of JavaScript on clients', () => {
  it('give vectors as arrays, and what they write through pointers', async () => {
    const test = await clientOf()
    test.client
      .add('js', {
        'fxmanifest.lua': `fx_version 'cerulean'\ngame 'gta5'\nclient_script 'main.js'`,
        'main.js': `const ped = PlayerPedId()
SetEntityCoords(ped, 1.5, 2.5, 3.5, false, false, false, false)
console.log(JSON.stringify(GetEntityCoords(ped, false)))
console.log(JSON.stringify(GetGroundZFor_3dCoord(1.0, 2.0, 35.5, false)))
console.log(typeof window, typeof global, GetEntityModel(ped) === GetHashKey('player_zero'))`,
      })
      .start()
    expect(printed(test.client)).toEqual(['[1.5,2.5,3.5]', '[true,35.5]', 'undefined object true'])
    expect(test.client.diagnostics).toEqual([])
  })
})
