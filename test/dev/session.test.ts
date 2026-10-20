import { describe, expect, it } from 'vitest'

import { MemoryFileSystem, type HttpClient } from '../../src/core/engine/index.ts'
import type { WatchdogOptions } from '../../src/core/lua/index.ts'
import { DevSession, type DevEvent, type DevState } from '../../src/dev/session.ts'
import { cfxlua } from '../lua/helpers.ts'

const offline: HttpClient = async () => ({ code: 7, message: 'offline' })

const MANIFEST = `fx_version 'cerulean'
game 'gta5'
server_script 'server.lua'
client_script 'client.lua'
ui_page 'index.html'
file 'index.html'
`

/** A session of a server with a resource named bank, whose scripts are `server` and `client`, and what it told. */
async function sessionOf(
  server: string,
  client = '',
  {
    commands = ['ensure bank'],
    http = offline,
    watchdog = { timeoutMs: 2000 },
  }: { commands?: string[]; http?: HttpClient; watchdog?: WatchdogOptions } = {},
) {
  const events: DevEvent[] = []
  const files = {
    'resources/bank/fxmanifest.lua': MANIFEST,
    'resources/bank/server.lua': server,
    'resources/bank/client.lua': client,
    'resources/bank/index.html': '<p>bank</p>',
  }
  const session = await DevSession.start({
    cfxlua: await cfxlua(),
    project: { files: () => new MemoryFileSystem(files), commands },
    http,
    watchdog,
    onEvent: (event) => events.push(event),
  })
  /** What the session told since this was last called. */
  const told = () => events.splice(0)
  return { session, told }
}

/** The lines that processes printed on the console, by their processes and their channels. */
function printed(events: readonly DevEvent[]): string[] {
  return events.flatMap((event) =>
    event.type === 'output' && event.line.kind === 'console'
      ? [`${event.line.process}: [${event.line.channel}] ${event.line.text}`]
      : [],
  )
}

/** The states that a session told. */
function states(events: readonly DevEvent[]): DevState[] {
  return events.flatMap((event) => (event.type === 'state' ? [event.state] : []))
}

/** What NUI did, as a session told it. */
function nuiOf(events: readonly DevEvent[]): DevEvent[] {
  return events.filter((event) => event.type === 'nui')
}

/** A script that runs on and on, catching the errors of the watchdog, which so stops its state. */
const LOOP = 'while true do pcall(function() while true do end end) end'

/** A watchdog that stops such scripts soon. */
const SHORT = { watchdog: { timeoutMs: 20, killAfterMs: 40, interval: 100 } }

describe('Dev sessions', () => {
  it('run their projects, and tell what the processes print and how the resources are', async () => {
    const { session, told } = await sessionOf(`print('bank started')`)
    const started = told()
    session.advance(100)
    expect([
      printed(started).filter((line) => line.includes('bank')),
      states(started),
      told(),
    ]).toEqual([
      [
        'server: [citizen-scripting-core] Creating script environments for bank',
        'server: [script:bank] bank started',
        'server: [resources] Started resource bank',
      ],
      [{ resources: [{ name: 'bank', state: 'started' }], players: [] }],
      [],
    ])
  })

  it('run commands on the console of the server, once it ran those of the project', async () => {
    const { session, told } = await sessionOf('')
    told()
    session.command('ensure bank')
    session.command('stop bank')
    session.command('nope')
    const events = told()
    expect([printed(events), states(events)]).toEqual([
      [
        'server: [resources] Stopping resource bank',
        'server: [citizen-scripting-core] Creating script environments for bank',
        'server: [resources] Started resource bank',
        'server: [resources] Stopping resource bank',
        'server: [cmd] No such command nope.',
      ],
      [{ resources: [{ name: 'bank', state: 'stopped' }], players: [] }],
    ])
  })

  it('send the HTTP requests of the scripts of their servers with their clients', async () => {
    const http: HttpClient = async (request) => ({
      status: 200,
      headers: [],
      body: new TextEncoder().encode(`got ${request.url}`),
    })
    const { session, told } = await sessionOf(
      `PerformHttpRequest('https://example.com/', function(code, body) print(code, body) end)`,
      '',
      { http },
    )
    told()
    session.advance(100)
    await new Promise((resolve) => setTimeout(resolve, 0))
    session.advance(100)
    expect(printed(told())).toEqual(['server: [script:bank] 200\tgot https://example.com/'])
  })

  it('connect players, whose NUI they tell of, and quit them', async () => {
    const { session, told } = await sessionOf(
      `AddEventHandler('playerDropped', function(reason) print('dropped', reason) end)`,
      `RegisterNUICallback('greet', function(data, cb) cb('hi ' .. data.name) end)
CreateThread(function()
    SendNUIMessage({ open = true })
    SetNuiFocus(true, true)
    SetNuiFocusKeepInput(true)
    SetNuiZindex(3)
end)`,
    )
    told()
    const client = await session.connect({ name: 'Ann' })
    const connected = states(told())
    session.advance(1000)
    const joined = told()
    const nui = session.nui(client)!
    let answer = ''
    void nui
      .request('bank', {
        method: 'POST',
        path: '/greet',
        query: '',
        headers: [],
        body: new TextEncoder().encode('{"name":"Ann"}'),
      })
      .then(({ body }) => (answer = new TextDecoder().decode(body)))
    session.advance(100)
    await Promise.resolve()
    session.disconnect(client)
    session.disconnect(9)
    session.advance(100)
    const quit = told()
    const event = (event: unknown) => ({ type: 'nui', client: 1, event })
    expect([
      client,
      connected.map(({ players }) => players),
      states(joined).at(-1)!.players,
      nuiOf(joined),
      answer,
      nuiOf(quit),
      states(quit)
        .at(-1)!
        .players.map(({ state }) => state),
      printed(quit).filter((line) => line.includes('dropped')),
      session.nui(2),
    ]).toEqual([
      1,
      [[{ client: 1, name: 'Ann', id: 65536, state: 'connecting' }]],
      [{ client: 1, name: 'Ann', id: 1, state: 'joined' }],
      [
        event({
          type: 'create',
          frame: { resource: 'bank', url: 'https://cfx-nui-bank/index.html' },
        }),
        event({ type: 'message', resource: 'bank', json: '{"open":true}' }),
        event({ type: 'frameFocus', resource: 'bank', focused: true }),
        event({ type: 'focus', focus: true, cursor: true }),
        event({ type: 'keepInput', keepInput: true }),
        event({ type: 'zIndex', resource: 'bank', zIndex: 3 }),
      ],
      '"hi Ann"',
      [
        event({ type: 'destroy', resource: 'bank' }),
        event({ type: 'focus', focus: false, cursor: false }),
        event({ type: 'keepInput', keepInput: false }),
      ],
      ['dropped'],
      ['server: [script:bank] dropped\tExiting'],
      undefined,
    ])
  })

  it('tell of the deferrals of connections, whose cards players submit', async () => {
    const { session, told } =
      await sessionOf(`AddEventHandler('playerConnecting', function(name, setKickReason, deferrals)
    deferrals.defer()
    Wait(0)
    deferrals.update('Checking')
    deferrals.presentCard('{"type":"AdaptiveCard"}', function(data)
        if data.ok then deferrals.done() else deferrals.done('Not ok') end
    end)
end)`)
    const first = await session.connect({ name: 'Ann' })
    const second = await session.connect({ name: 'Bo' })
    session.advance(200)
    const presented = states(told()).at(-1)!.players
    session.submitCard(first, '{"ok":true}')
    session.submitCard(second, '{"ok":false}')
    session.submitCard(3, '{}')
    session.advance(1000)
    expect([presented, states(told()).at(-1)!.players]).toEqual([
      [
        {
          client: 1,
          name: 'Ann',
          id: 65536,
          state: 'connecting',
          message: 'bank: Checking\n',
          card: '{"type":"AdaptiveCard"}',
        },
        {
          client: 2,
          name: 'Bo',
          id: 65537,
          state: 'connecting',
          message: 'bank: Checking\n',
          card: '{"type":"AdaptiveCard"}',
        },
      ],
      [
        expect.objectContaining({ client: 1, id: 1, state: 'joined' }),
        expect.objectContaining({ client: 2, state: 'rejected', rejection: 'Not ok' }),
      ],
    ])
  })

  it('stop as runtimes of their servers crash, in commands', async () => {
    const { session, told } = await sessionOf(
      `RegisterCommand('loop', function() ${LOOP} end, false)
AddEventHandler('playerConnecting', function(name, setKickReason, deferrals)
    deferrals.defer()
    deferrals.presentCard('{}', function() deferrals.done() end)
end)`,
      '',
      SHORT,
    )
    const client = await session.connect({ name: 'Ann' })
    session.advance(1000)
    const presented = states(told())
      .at(-1)!
      .players.map(({ card }) => card)
    session.command('loop')
    const crashed = told().filter(({ type }) => type === 'crash')
    session.advance(100)
    session.command('stop bank')
    session.disconnect(client)
    session.submitCard(client, '{}')
    expect([presented, crashed, session.crash, told()]).toEqual([
      ['{}'],
      [
        {
          type: 'crash',
          message: expect.stringMatching(
            /^A runtime crashed, which stopped the session: Lua state stopped: /,
          ),
        },
      ],
      expect.stringMatching(/^A runtime crashed, which stopped the session: /),
      [],
    ])
  })

  it('stop as runtimes of their servers crash, in frames', async () => {
    const { session, told } = await sessionOf(`CreateThread(function() ${LOOP} end)`, '', SHORT)
    told()
    session.advance(100)
    expect(told().filter(({ type }) => type === 'crash')).toEqual([
      { type: 'crash', message: expect.stringMatching(/^A runtime crashed/) },
    ])
  })

  it('stop as runtimes of their clients crash, with the watchdog they were given', async () => {
    const { session, told } = await sessionOf('', `CreateThread(function() ${LOOP} end)`, SHORT)
    await session.connect({ name: 'Ann' })
    told()
    session.advance(1000)
    expect(told().filter(({ type }) => type === 'crash')).toEqual([
      { type: 'crash', message: expect.stringMatching(/^A runtime crashed/) },
    ])
  })
})
