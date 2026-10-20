import { describe, expect, it } from 'vitest'

import type { NativeContext, Nui, NuiRequest, NuiResponse } from '../../src/core/engine/index.ts'
import { pack } from '../../src/core/engine/msgpack.ts'
import { defineNative } from '../../src/core/natives/index.ts'
import { createProcess, type TestProcess } from './helpers.ts'

/** Starts a resource running `source` and returns the lines written but those of every start. */
function start(proc: TestProcess, name: string, source: string): string[] {
  proc.add(name, { 'main.lua': source }).start()
  const starting = [
    `[citizen-scripting-core] Creating script environments for ${name}`,
    `[resources] Started resource ${name}`,
  ]
  return proc.take().filter((line) => !starting.includes(line))
}

describe('NUI callbacks', () => {
  it('are registered with RegisterNuiCallback, which reports their errors', async () => {
    const registered: string[] = []
    const register = defineNative(
      {
        name: 'REGISTER_NUI_CALLBACK',
        result: 'void',
        params: ['char* callbackType', 'func callback'],
      },
      (_ctx: NativeContext, type, callback) => {
        registered.push(`${type} ${callback}`)
      },
    )
    const proc = await createProcess({ side: 'client', natives: [register] })
    start(
      proc,
      'a',
      `RegisterNuiCallback('greet', function(body, cb)
    print('greeted', body.name, cb)
end)
RegisterNuiCallback('fail', function()
    error('broken')
end)`,
    )
    expect(registered).toEqual(['greet a:41:0', 'fail a:41:1'])
    proc.manager.invokeFunctionReference('a:41:0', pack([{ name: 'x' }]))
    proc.manager.invokeFunctionReference('a:41:1', pack([{}]))
    expect(proc.take()).toEqual([
      '[script:a] greeted\tx\tnil',
      '[script:a] error during NUI callback fail: @a/main.lua:5: broken',
    ])
  })

  it('are named callback in stack traces, as in FiveM', async () => {
    const register = defineNative(
      {
        name: 'REGISTER_NUI_CALLBACK',
        result: 'void',
        params: ['char* callbackType', 'func callback'],
      },
      () => {},
    )
    const proc = await createProcess({ side: 'client', natives: [register] })
    start(proc, 'b', `AddEventHandler('fail', function() error('boom') end)`)
    start(
      proc,
      'a',
      `RegisterNuiCallback('notify', function()
    TriggerEvent('fail')
end)`,
    )
    proc.manager.invokeFunctionReference('a:18467:0', pack([{}]))
    expect(proc.take()).toEqual([
      '[script:b] ^1SCRIPT ERROR: @b/main.lua:1: boom^7',
      '[script:b] ^3> callback^7 (^5@a/main.lua^7:2)',
    ])
  })

  it('are events with RegisterNUICallback, which registers their type', async () => {
    const types: string[] = []
    const registerType = defineNative(
      { name: 'REGISTER_NUI_CALLBACK_TYPE', result: 'void', params: ['char* callbackType'] },
      (_ctx: NativeContext, type) => {
        types.push(type!)
      },
    )
    const proc = await createProcess({ side: 'client', natives: [registerType] })
    start(
      proc,
      'a',
      `RegisterNUICallback('greet', function(body, cb)
    cb(body.name .. '!')
end)
RegisterNUICallback('fail', function(body, cb)
    cb(body.missing.name)
end)`,
    )
    expect(types).toEqual(['greet', 'fail'])
    start(
      proc,
      'b',
      `Citizen.GetFunctionReference(function(result)
    print('answered', result)
end)`,
    )
    // NUI requests go only to the resource of the callback, with a function to answer them.
    const a = proc.manager.getResource('a')!
    const answer = [...new TextEncoder().encode('b:18467:0')]
    const request = (body: Uint8Array) =>
      new Uint8Array([0x92, ...body, 0xc7, answer.length, 0x0a, ...answer])
    proc.manager.events.trigger('__cfx_nui:greet', request(pack({ name: 'x' })), '', a)
    proc.manager.events.trigger('__cfx_nui:fail', request(pack({})), '', a)
    expect(proc.take()).toEqual([
      '[script:b] answered\tx!',
      "[script:a] error during NUI callback fail: @a/main.lua:5: attempt to index a nil value (field 'missing')",
    ])
  })

  it('send messages to NUI as JSON with SendNUIMessage', async () => {
    const messages: string[] = []
    const send = defineNative(
      { name: 'SEND_NUI_MESSAGE', result: 'BOOL', params: ['char* jsonString'] },
      (_ctx: NativeContext, json) => {
        messages.push(json!)
        return true
      },
    )
    const proc = await createProcess({ side: 'client', natives: [send] })
    expect(start(proc, 'a', `print(SendNUIMessage({ type = 'open', items = { 1, 2 } }))`)).toEqual([
      '[script:a] ',
    ])
    expect(messages.map((message) => JSON.parse(message) as unknown)).toEqual([
      { type: 'open', items: [1, 2] },
    ])
  })

  it('are only on clients', async () => {
    const proc = await createProcess()
    expect(
      start(
        proc,
        'a',
        `print(RegisterNUICallback, SendNUIMessage, rawget(_G, 'RegisterNuiCallback'))`,
      ),
    ).toEqual(['[script:a] nil\tnil\tnil'])
  })
})

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * A client with a resource named bank, whose client script is `script`, with
 * an index page that its manifest names as ui_page, unless `entries` say
 * otherwise, and what NUI tells as it happens.
 */
async function clientWithBank(
  script: string,
  { entries = `ui_page 'html/index.html'`, version = 'cerulean', files = {} } = {},
) {
  const proc = await createProcess({ side: 'client' })
  const nui = proc.manager.nui!
  const seen: string[] = []
  nui.onCreate.connect(({ resource, url }) => {
    seen.push(`create ${resource} ${url}`)
  })
  nui.onDestroy.connect((resource) => {
    seen.push(`destroy ${resource}`)
  })
  nui.onMessage.connect((resource, json) => {
    seen.push(`message ${resource} ${json}`)
  })
  nui.onFrameFocus.connect((resource, focused) => {
    seen.push(`frame ${resource} ${focused}`)
  })
  nui.onFocus.connect((focus, cursor) => {
    seen.push(`focus ${focus} ${cursor}`)
  })
  nui.onKeepInput.connect((keep) => {
    seen.push(`keep ${keep}`)
  })
  nui.onZIndex.connect((resource, zIndex) => {
    seen.push(`z ${resource} ${zIndex}`)
  })
  const bank = proc.add('bank', {
    'fxmanifest.lua': `fx_version '${version}'
game 'gta5'
client_script 'client.lua'
file 'html/index.html'
${entries}`,
    'client.lua': script,
    'html/index.html': '<p>bank</p>',
    ...files,
  })
  return { proc, nui, seen, bank }
}

/** The lines that a process wrote, but those that tell that resources start. */
function written(proc: TestProcess): string[] {
  return proc.take().filter((line) => !line.includes('Creating script environments'))
}

/**
 * Asks NUI for `path` of `host`, with `body`, and returns what tells what
 * the request got, once it did.
 */
function ask(nui: Nui, host: string, path: string, body = '', request: Partial<NuiRequest> = {}) {
  const [pathname, query = ''] = path.split('?')
  let response: NuiResponse | undefined
  void nui
    .request(host, {
      method: 'POST',
      path: pathname!,
      query,
      headers: [],
      body: encoder.encode(body),
      ...request,
    })
    .then((answered) => {
      response = answered
    })
  return () =>
    response === undefined
      ? undefined
      : { status: response.status, body: decoder.decode(response.body), headers: response.headers }
}

/** What FiveRunner tells of callbacks that answer with what FiveM fails to convert. */
const UNCONVERTED =
  'A NUI callback answered with what FiveM fails to convert, which throws in FiveM, and leaves the request unanswered in FiveRunner.'

/** The headers that FiveM's NUI adds to the responses of callbacks, which come ordered by their names. */
const ADDED = [
  ['access-control-allow-methods', 'POST, GET, OPTIONS'],
  ['access-control-allow-origin', '*'],
  ['cache-control', 'no-cache, must-revalidate'],
]

describe('NUI frames', () => {
  it('come with resources that have a ui_page once their scripts loaded, and go as they stop', async () => {
    const { proc, nui, seen, bank } = await clientWithBank(`print('at load', SendNuiMessage('{}'))
CreateThread(function() print('in a thread', SendNuiMessage('{}')) end)`)
    bank.start()
    const frames = nui.frames
    proc.tickAt(1)
    bank.stop()
    expect([seen, frames, nui.frames, written(proc)]).toEqual([
      ['create bank https://cfx-nui-bank/html/index.html', 'message bank {}', 'destroy bank'],
      [{ resource: 'bank', url: 'https://cfx-nui-bank/html/index.html' }],
      [],
      [
        '[nui-resources] SEND_NUI_MESSAGE: resource bank has no UI frame',
        '[script:bank] at load\tfalse',
        '[script:bank] in a thread\t1',
      ],
    ])
  })

  it('show pages at cfx-nui URLs from cerulean on, at nui URLs before, and URLs as they are', async () => {
    const urls = async (version: string, page: string) => {
      const { nui, bank } = await clientWithBank('', { entries: `ui_page '${page}'`, version })
      bank.start()
      return nui.frames.map(({ url }) => url)
    }
    expect([
      await urls('cerulean', 'ui/a.html'),
      await urls('bodacious', 'ui/a.html'),
      await urls('cerulean', 'https://example.com/x'),
    ]).toEqual([
      ['https://cfx-nui-bank/ui/a.html'],
      ['nui://bank/ui/a.html'],
      ['https://example.com/x'],
    ])
  })

  it('are none for resources with more than one ui_page, or none', async () => {
    const two = await clientWithBank('', { entries: `ui_page 'a.html'\nui_page 'b.html'` })
    const none = await clientWithBank('', { entries: '' })
    two.bank.start()
    none.bank.start()
    two.bank.stop()
    none.bank.stop()
    expect([two.seen, written(two.proc), none.seen, written(none.proc)]).toEqual([
      [],
      ['[nui-resources] ResourceUI::Create: more than one ui_page in resource bank'],
      [],
      [],
    ])
  })

  it('get messages as JSON that RapidJSON wrote back, which fail without JSON', async () => {
    const { proc, seen, bank } = await clientWithBank(`CreateThread(function()
    print(SendNuiMessage('{ "b" : 1, "a" : [ 1.0, "x" ] }'))
    print(SendNuiMessage('nope'))
    print(SendNuiMessage(''))
    print(SendNUIMessage({ ok = true }))
    print(SendLoadingScreenMessage('{}'))
end)`)
    bank.start()
    proc.tickAt(1)
    expect([seen, written(proc)]).toEqual([
      [
        'create bank https://cfx-nui-bank/html/index.html',
        'message bank {"b":1,"a":[1.0,"x"]}',
        'message bank {"ok":true}',
      ],
      [
        '[script:bank] 1',
        '[nui-resources] SEND_NUI_MESSAGE: invalid JSON passed in frame (rapidjson error code 3)',
        '[script:bank] false',
        '[nui-resources] SEND_NUI_MESSAGE: invalid JSON passed in frame (rapidjson error code 1)',
        '[script:bank] false',
        '[script:bank] ',
        '[nui-resources] SEND_LOADING_SCREEN_MESSAGE called while the loading screen was shut down',
        '[script:bank] false',
      ],
    ])
  })

  it('are focused as resources vote for it, which they stop doing as they stop', async () => {
    const { proc, nui, seen, bank } = await clientWithBank(`CreateThread(function()
    SetNuiFocus(true, false)
    print(IsNuiFocused(), IsNuiFocusKeepingInput())
    SetNuiFocusKeepInput(true)
    SetNuiFocus(true, true)
    SetNuiZindex(7)
    print(IsNuiFocused(), IsNuiFocusKeepingInput(), GetNuiCursorPosition())
end)`)
    const other = proc.add('other', {
      'client.lua': `CreateThread(function()
    SetNuiFocus(true, true)
    SetNuiZindex(3)
    SetNuiFocusKeepInput(true)
end)`,
    })
    nui.cursor = { x: 640, y: 360 }
    other.start()
    bank.start()
    proc.tickAt(1)
    const focused = [nui.focused, nui.cursorShown, nui.keepingInput]
    bank.stop()
    expect([seen, focused, written(proc)]).toEqual([
      [
        'create bank https://cfx-nui-bank/html/index.html',
        'frame bank true',
        'focus true false',
        'keep true',
        'frame bank true',
        'focus true true',
        'z bank 7',
        'destroy bank',
        'focus false false',
        'keep false',
      ],
      [true, true, true],
      ['[script:bank] 1\tfalse', '[script:bank] 1\t1\t640\t360'],
    ])
  })

  it('leave input to the game for resources that ask for the focus or the cursor, by votes that go as they stop', async () => {
    const { proc, nui, bank } =
      await clientWithBank(`AddEventHandler('vote', function(focus, cursor, keep)
    SetNuiFocus(focus, cursor)
    if keep ~= nil then SetNuiFocusKeepInput(keep) end
end)`)
    bank.start()
    const vote = (...args: boolean[]) => {
      proc.manager.events.trigger('vote', pack(args), '', bank)
      return [nui.focused, nui.cursorShown, nui.keepingInput]
    }
    const cursor = vote(false, true, true)
    bank.stop()
    const stopped = [nui.focused, nui.cursorShown, nui.keepingInput]
    bank.start()
    expect([cursor, stopped, vote(true, false)]).toEqual([
      [false, true, true],
      [false, false, false],
      [true, false, false],
    ])
  })

  it('are left alone by resources whose names have quotes, which FiveM sends no messages', async () => {
    const proc = await createProcess({ side: 'client' })
    const nui = proc.manager.nui!
    const seen: string[] = []
    nui.onMessage.connect((resource) => {
      seen.push(`message ${resource}`)
    })
    nui.onFrameFocus.connect((resource) => {
      seen.push(`frame ${resource}`)
    })
    nui.onZIndex.connect((resource) => {
      seen.push(`z ${resource}`)
    })
    proc
      .add('say"hi', {
        'fxmanifest.lua': `fx_version 'cerulean'\ngame 'gta5'\nclient_script 'client.lua'\nui_page 'a.html'`,
        'client.lua': `CreateThread(function()
    print(SendNuiMessage('{}'))
    SetNuiFocus(true, true)
    SetNuiZindex(2)
    print(IsNuiFocused())
end)`,
      })
      .start()
    proc.tickAt(1)
    expect([nui.frames, seen, written(proc)]).toEqual([
      [{ resource: 'say"hi', url: 'https://cfx-nui-say"hi/a.html' }],
      [],
      ['[script:say"hi] 1', '[script:say"hi] false'],
    ])
  })

  it('check their arguments, and send no message without JSON, where FiveM crashes', async () => {
    const { proc, bank } = await clientWithBank(`CreateThread(function()
    print(SendNuiMessage(nil))
    print(pcall(RegisterNuiCallback, nil, function() end))
    print(pcall(Citizen.InvokeNative, 0xc59b980c, 'x', nil))
    print(pcall(RegisterRawNuiCallback, 'x', nil))
    print(pcall(RegisterRawNuiCallback, nil, function() end))
    print(pcall(RegisterNuiCallbackType, nil))
    print(pcall(UnregisterRawNuiCallback, nil))
end)`)
    bank.start()
    proc.tickAt(1)
    const failures = [
      ['c59b980c', 0],
      ['c59b980c', 1],
      ['a8ae9c2f', 1],
      ['a8ae9c2f', 0],
      ['cd03cda9', 0],
      ['7fb46432', 0],
    ].flatMap(([hash, index]) => {
      const error = `native 00000000${hash}: Argument at index ${index} was null.`
      return [`[citizen-scripting-core] script error in ${error}`, `[script:bank] false\t${error}`]
    })
    expect([written(proc), proc.diagnostics]).toEqual([
      ['[script:bank] false', ...failures],
      [
        'bank: SendNuiMessage was given no JSON: FiveM would read it from nowhere, and crash. FiveRunner sends nothing.',
      ],
    ])
  })
})

describe('NUI callbacks of pages', () => {
  const callbacks = `RegisterNUICallback('greet', function(data, cb)
    cb({ hi = data.name, from = source })
end)
RegisterNuiCallback('echo', function(data, cb)
    cb({ data })
end)
RegisterRawNuiCallback('raw', function(req, cb)
    local said = table.concat({ req.method, req.path, req.body, tostring(req.resource), req.headers.Origin }, ' ')
    cb({ status = 201, headers = { ['X-Test'] = { 'a', 'b' } }, body = said })
end)
RegisterNuiCallback('quiet', function(data, cb) end)
RegisterNuiCallback('twice', function(data, cb) cb(1, 2) end)
RegisterNuiCallback('nan', function(data, cb) cb(0/0) end)
RegisterNuiCallback('keys', function(data, cb) cb({ [true] = 1 }) end)
RegisterRawNuiCallback('headers', function(req, cb)
    local raw = {}
    for _, header in ipairs(req.rawHeaders) do raw[#raw + 1] = header.key .. '=' .. header.value end
    cb({ body = table.concat(raw, ' ') .. ' | ' .. req.headers.Accept .. ' ' .. req.method .. ' ' .. req.path })
end)
RegisterRawNuiCallback('answer', function(req, cb) cb(load('return ' .. req.body)()) end)
RegisterRawNuiCallback('rawtwice', function(req, cb) cb({ body = 'a' }, 2) end)
RegisterNuiCallback('grow', function(data, cb)
    print('grew')
    RegisterNuiCallback('grow', function() print('grown') end)
    cb(1)
end)`

  it('answer the requests of pages at the end of the next tick, or at once with 404', async () => {
    const { proc, nui, bank } = await clientWithBank(callbacks)
    bank.start()
    const asked = [
      ask(nui, 'BANK', '/greet', '{"name":"Ann"}'),
      ask(nui, 'bank', '/echo?x=1', '{"x":1}'),
      ask(nui, 'bank', '/echo', '{"x":1}', { method: 'GET' }),
      ask(nui, 'bank', '/greet/more', '{"name":"Bo"}'),
      ask(nui, 'bank', '/raw/sub?x=1', 'hello', { headers: [['Origin', 'https://cfx-nui-bank']] }),
      ask(nui, 'bank', '/nope'),
      ask(nui, 'nobody', '/echo'),
    ]
    await Promise.resolve()
    const early = asked.map((answer) => answer()?.status)
    proc.tickAt(1)
    proc.tickAt(2)
    await Promise.resolve()
    const json = [['Content-Type', 'application/json; charset=utf-8'], ...ADDED]
    const missing = {
      status: 404,
      body: '',
      headers: [...ADDED, ['content-type', 'application/json']],
    }
    expect([early, asked.map((answer) => answer())]).toEqual([
      [undefined, undefined, undefined, undefined, undefined, 404, 404],
      [
        { status: 200, body: '{"from":"nui","hi":"Ann"}', headers: json },
        { status: 200, body: '[{"x":1}]', headers: json },
        { status: 200, body: '[]', headers: json },
        { status: 200, body: '{"from":"nui","hi":"Bo"}', headers: json },
        {
          status: 201,
          body: 'POST /sub?x=1 hello bank https://cfx-nui-bank',
          headers: [
            ...ADDED,
            ['content-type', 'application/json'],
            ['x-test', 'a'],
            ['x-test', 'b'],
          ],
        },
        missing,
        missing,
      ],
    ])
  })

  it('leave requests unanswered for bodies that are no JSON, answers that FiveM does not take, and resources that stopped', async () => {
    const { proc, nui, bank } = await clientWithBank(callbacks)
    bank.start()
    const asked = [
      ask(nui, 'bank', '/echo', 'nope'),
      ask(nui, 'bank', '/quiet'),
      ask(nui, 'bank', '/twice'),
      ask(nui, 'bank', '/nan'),
      ask(nui, 'bank', '/keys'),
      ask(nui, 'bank', '/rawtwice'),
    ]
    proc.tickAt(1)
    // The end of the tick finds the resource stopped, which it stays unanswered by as the resource starts again.
    const stopped = ask(nui, 'bank', '/greet', '{"name":"Ann"}')
    bank.stop()
    proc.tickAt(2)
    bank.start()
    proc.tickAt(3)
    await Promise.resolve()
    expect([[...asked, stopped].map((answer) => answer()), proc.diagnostics]).toEqual([
      [undefined, undefined, undefined, undefined, undefined, undefined, undefined],
      [`bank: ${UNCONVERTED}`],
    ])
  })

  it('call the callbacks that resources had as pages asked, which they keep as they restart', async () => {
    const { proc, nui, bank } =
      await clientWithBank(`RegisterNUICallback('greet', function(data, cb)
    print('greeted')
    cb('hi')
end)
RegisterNuiCallback('grow', function(data, cb)
    print('grew')
    RegisterNuiCallback('grow', function() print('grown') end)
    cb(1)
end)`)
    bank.start()
    bank.stop()
    bank.start()
    const asked = [ask(nui, 'bank', '/greet', '{}'), ask(nui, 'bank', '/grow', '{}')]
    // The resource restarts before the end of the tick, which so finds it started.
    bank.stop()
    bank.start()
    proc.tickAt(1)
    await Promise.resolve()
    // Of the callbacks for grow, only that of the running script answers, and the one it adds waits for later requests.
    const again = ask(nui, 'bank', '/grow', '{}')
    proc.tickAt(2)
    await Promise.resolve()
    expect([asked.map((answer) => answer()?.body), again()?.body, written(proc)]).toEqual([
      ['"hi"', undefined],
      '1',
      ['[script:bank] greeted', '[script:bank] greeted', '[script:bank] grew'],
    ])
  })

  it('give raw callbacks the headers ordered by their names, and take their answers as maps by strings', async () => {
    const { proc, nui, bank } = await clientWithBank(callbacks)
    bank.start()
    const headers: [string, string][] = [
      ['X-B', '1'],
      ['Accept', 'b'],
      ['Origin', 'https://cfx-nui-bank'],
      ['Accept', 'a'],
    ]
    const answered = [
      `{ status = 2147483647 }`,
      `{ status = -2147483648, body = 'b' }`,
      `{ headers = {}, body = 'x' }`,
      `{ headers = { ['Access-Control-Allow-Origin'] = 'x', ['access-control-allow-methods'] = 'GET' } }`,
    ]
    const unanswered = [
      `{ status = 2147483648 }`,
      `{ status = -2147483649 }`,
      `{ status = '201' }`,
      `{ status = 201.0 }`,
      `{ status = 200, 'x' }`,
      `'text'`,
      `{}`,
      `{ body = 5 }`,
      `{ headers = 'x' }`,
      `{ headers = { [1] = 'a', x = 'b' } }`,
      `{ headers = { x = 5 } }`,
      `{ headers = { x = { 'a', 5 } } }`,
    ]
    const asked = [
      ask(nui, 'bank', '/headers', 'ignored', { method: 'GET', headers }),
      ...[...answered, ...unanswered].map((answer) => ask(nui, 'bank', '/answer', answer)),
    ]
    proc.tickAt(1)
    await Promise.resolve()
    const [first, ...rest] = asked.map((answer) => answer())
    expect([
      first?.body,
      rest.map((response) =>
        response === undefined ? undefined : `${response.status} ${response.body}`,
      ),
      rest[3]?.headers,
      proc.diagnostics,
    ]).toEqual([
      'Accept=b Accept=a Origin=https://cfx-nui-bank X-B=1 | b GET ',
      ['2147483647 ', '-2147483648 b', '200 x', '200 ', ...unanswered.map(() => undefined)],
      [
        ['access-control-allow-methods', 'GET'],
        ['access-control-allow-origin', 'x'],
        ['cache-control', 'no-cache, must-revalidate'],
        ['content-type', 'application/json'],
      ],
      unanswered.map(() => `bank: ${UNCONVERTED}`),
    ])
  })

  it('go when the raw callbacks of their type are unregistered, whatever their kinds', async () => {
    const { proc, nui, bank } = await clientWithBank(`${callbacks}
UnregisterRawNuiCallback('echo')`)
    bank.start()
    const answer = ask(nui, 'bank', '/echo', '{}')
    proc.tickAt(1)
    await Promise.resolve()
    expect(answer()?.status).toBe(404)
  })

  it('answer only the pages of their own resources in strict mode', async () => {
    const { proc, nui, bank } = await clientWithBank(callbacks, {
      entries: `ui_page 'html/index.html'\nnui_callback_strict_mode 'true'`,
    })
    bank.start()
    const from = (origin?: string, name = 'Origin') =>
      ask(nui, 'bank', '/echo', '{}', { headers: origin === undefined ? [] : [[name, origin]] })
    const asked = [
      from(),
      from('https://cfx-nui-other'),
      from('https://cfx-nui-bank'),
      from('nui://bank'),
      from('https://cfx-nui-bank', 'origin'),
    ]
    proc.tickAt(1)
    await Promise.resolve()
    expect([asked.map((answer) => answer()?.status), written(proc)]).toEqual([
      [404, 404, 200, 200, 404],
      [
        "[nui-resources] ResourceUI::InvokeCallback: call to 'bank/echo' from '(null)' has been blocked by NUI Callback Strict Mode",
        "[nui-resources] ResourceUI::InvokeCallback: call to 'bank/echo' from 'other' has been blocked by NUI Callback Strict Mode",
        "[nui-resources] ResourceUI::InvokeCallback: call to 'bank/echo' from '(null)' has been blocked by NUI Callback Strict Mode",
      ],
    ])
  })

  it('answer every page unless the first strict mode entry is true', async () => {
    const strict = async (entries: string) => {
      const { proc, nui, bank } = await clientWithBank(callbacks, {
        entries: `ui_page 'html/index.html'\n${entries}`,
      })
      bank.start()
      const answer = ask(nui, 'bank', '/echo', '{}')
      proc.tickAt(1)
      await Promise.resolve()
      return answer()?.status
    }
    expect([
      await strict(`nui_callback_strict_mode 'false'`),
      await strict(`nui_callback_strict_mode 'yes'\nnui_callback_strict_mode 'true'`),
      await strict(`nui_callback_strict_mode 'true'\nnui_callback_strict_mode 'false'`),
    ]).toEqual([200, 200, 404])
  })

  it('go to the last of the resources whose names differ only in case', async () => {
    const proc = await createProcess({ side: 'client' })
    const nui = proc.manager.nui!
    for (const name of ['Bank', 'bank', 'BANK']) {
      proc
        .add(name, {
          'fxmanifest.lua': `fx_version 'cerulean'\ngame 'gta5'\nclient_script 'client.lua'`,
          'client.lua': `RegisterNuiCallback('who', function(data, cb) cb('${name}') end)`,
        })
        .start()
    }
    const answer = ask(nui, 'bank', '/who', '{}')
    proc.tickAt(1)
    await Promise.resolve()
    expect(answer()?.body).toBe('"BANK"')
  })
})

describe('NUI files', () => {
  it('give pages the files of their resources as the types of their extensions, or as HTML', async () => {
    const { nui, bank } = await clientWithBank('', {
      entries: `ui_page 'html/index.html'\nfiles { 'img/logo.png', 'app.js', 'notes.unknown', 'LICENSE' }`,
      files: { 'img/logo.png': 'png', 'app.js': 'js', 'notes.unknown': 'notes', LICENSE: 'MIT' },
    })
    bank.start()
    const read = (host: string, path: string) => {
      const { status, headers, body } = nui.file(host, path)
      const [, type] = headers.find(([name]) => name === 'content-type')!
      return `${status} ${type} ${decoder.decode(body)}`
    }
    expect([
      read('cfx-nui-bank', '/html/index.html'),
      read('BANK', '/img//logo.png'),
      read('bank', '/app.js'),
      read('bank', '/notes.unknown'),
      read('bank', '/LICENSE'),
      read('bank', '/img'),
      read('bank', '/missing.png'),
      read('nobody', '/html/index.html'),
    ]).toEqual([
      '200 text/html; charset=utf-8 <p>bank</p>',
      '200 image/png png',
      '200 application/javascript; charset=utf-8 js',
      '200 text/html; charset=utf-8 notes',
      '200 text/html; charset=utf-8 MIT',
      '404 text/html; charset=utf-8 ',
      '404 text/html; charset=utf-8 ',
      '404 text/html; charset=utf-8 ',
    ])
    expect(nui.file('bank', '/img/logo.png').headers).toEqual([
      ['access-control-allow-methods', 'GET, OPTIONS'],
      ['access-control-allow-origin', '*'],
      ['cache-control', 'no-cache, must-revalidate'],
      ['content-type', 'image/png'],
    ])
  })

  it('give pages no manifests, client scripts that are no files, or paths with two dots', async () => {
    const { proc, nui, bank } = await clientWithBank('', {
      entries: `ui_page 'html/index.html'\nclient_script 'shared.lua'\nfile 'shared.lua'\nclient_script 'lib/*.lua'\nfile 'a..b.txt'`,
      files: { 'shared.lua': 'shared', 'lib/a.lua': 'a', 'a..b.txt': 'dots' },
    })
    const other = proc.add('other', {
      'fxmanifest.lua': `fx_version 'cerulean'\ngame 'gta5'\nfile 'secret.txt'`,
      'secret.txt': 'secret',
    })
    other.start()
    bank.start()
    const paths = [
      '/shared.lua',
      '//shared.lua',
      '/client.lua',
      '//client.lua',
      '/lib//a.lua',
      '/fxmanifest.lua',
      '///fxmanifest.lua',
      '/a..b.txt',
      '/../other/secret.txt',
    ]
    expect(paths.map((path) => nui.file('bank', path).status)).toEqual([
      200, 200, 404, 404, 404, 404, 404, 404, 404,
    ])
  })

  it('hide what manifests name as directories too, but not files whose names only start like them', async () => {
    const proc = await createProcess({ side: 'client' })
    const nui = proc.manager.nui!
    proc
      .add('legacy', {
        '__resource.lua': `ui_page 'a.html'\nfiles { 'a.html', 'fxmanifest.lua/readme.txt', '__resource.lua.bak' }`,
        'a.html': 'a',
        'fxmanifest.lua/readme.txt': 'readme',
        '__resource.lua.bak': 'bak',
      })
      .start()
    const paths = [
      '/a.html',
      '/__resource.lua',
      '/fxmanifest.lua/readme.txt',
      '/__resource.lua.bak',
    ]
    expect(paths.map((path) => nui.file('legacy', path).status)).toEqual([200, 404, 404, 200])
  })

  it('are only on clients', async () => {
    const proc = await createProcess()
    expect(proc.manager.nui).toBe(undefined)
  })
})

describe('NUI hosts', () => {
  it('are those of the resources that started, whatever their manifests, which requests to others pass', async () => {
    const { proc, nui, bank } = await clientWithBank('', { entries: '' })
    proc.add('idle', { 'client.lua': '' })
    proc.add('Shop', { 'client.lua': '' }).start()
    const before = nui.takes('https', 'bank')
    bank.start()
    bank.stop()
    expect([
      before,
      nui.takes('https', 'bank'),
      nui.takes('http', 'BANK'),
      nui.takes('https', 'cfx-nui-bank'),
      nui.takes('http', 'cfx-nui-bank'),
      nui.takes('https', 'idle'),
      nui.takes('https', 'cfx-nui-idle'),
      nui.takes('https', 'example.com'),
      nui.takes('http', 'shop'),
    ]).toEqual([false, true, true, true, false, false, false, false, true])
  })
})
