import { createHash } from 'node:crypto'

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
      [
        {
          resources: [{ name: 'bank', state: 'started' }],
          players: [],
          bags: [],
          map: { entities: [], blips: [] },
        },
      ],
      [],
    ])
  })

  it('restart the resources that files changed in, with their players, or tell that they start anew', async () => {
    const files = new MemoryFileSystem({
      'resources/bank/fxmanifest.lua': MANIFEST,
      'resources/bank/server.lua': `print('bank 1')`,
      'resources/bank/client.lua': '',
      'resources/bank/index.html': '<p>bank</p>',
      'resources/idle/fxmanifest.lua': "fx_version 'cerulean'\ngame 'gta5'\n",
    })
    const events: DevEvent[] = []
    const session = await DevSession.start({
      cfxlua: await cfxlua(),
      project: { files: () => files, commands: ['ensure bank'] },
      http: offline,
      onEvent: (event) => events.push(event),
    })
    await session.connect({ name: 'Ann' })
    events.splice(0)
    files.write('resources/bank/server.lua', new TextEncoder().encode(`print('bank 2')`))
    expect(session.restartChanged(['resources/bank/server.lua', 'resources/idle/x.lua'])).toEqual([
      'bank',
    ])
    // The client of the player that stays starts the resource anew at its next ticks.
    session.advance(200)
    expect(printed(events.splice(0)).filter((line) => line.includes('bank'))).toEqual([
      'server: [resources] Stopping resource bank',
      'server: [citizen-scripting-core] Creating script environments for bank',
      'server: [script:bank] bank 2',
      'server: [resources] Started resource bank',
      'client 1: [citizen-legacy-net-resources] Required resources: bank ',
      'client 1: [citizen-scripting-core] Creating script environments for bank',
    ])
    expect([
      session.restartChanged(['resources/bank/fxmanifest.lua']),
      session.restartChanged(['resources/bank/bank.sql']),
      session.restartChanged(['server.cfg']),
    ]).toEqual([undefined, undefined, undefined])
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
      [
        {
          resources: [{ name: 'bank', state: 'stopped' }],
          players: [],
          bags: [],
          map: { entities: [], blips: [] },
        },
      ],
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

  it('connect players with a license of their names, as players of FiveM have the licenses of their accounts', async () => {
    const { session, told } = await sessionOf(
      `AddEventHandler('playerJoining', function() print(GetPlayerIdentifierByType(source, 'license')) end)`,
    )
    await session.connect({ name: 'Ann' })
    session.advance(100)
    expect(printed(told()).filter((line) => line.includes('license:'))).toEqual([
      `server: [script:bank] license:${createHash('sha1').update('Ann').digest('hex')}`,
    ])
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

  it('tell of the events that the server and clients send each other, which they trigger as the network does', async () => {
    const { session, told } = await sessionOf(
      `RegisterNetEvent('bank:deposit', function(amount)
    print('deposit', source, amount)
    TriggerClientEvent('bank:balance', source, 600)
end)`,
      `RegisterNetEvent('bank:balance', function(balance) print('balance', balance) end)
RegisterNetEvent('bank:hello', function(text) print('hello', text) end)
CreateThread(function() TriggerServerEvent('bank:deposit', 100) end)`,
    )
    const ann = await session.connect({ name: 'Ann' })
    const bo = await session.connect({ name: 'Bo' })
    session.advance(1000)
    const sent = told()
    session.emit('bank:deposit', [5], { from: ann })
    session.emit('bank:hello', ['all'], { to: 'everyone' })
    session.emit('bank:hello', ['you'], { to: bo })
    session.emit('bank:hello', ['nobody'], { to: 9 })
    session.emit('bank:deposit', [1], { from: 9 })
    session.advance(100)
    const emitted = told()
    const net = (events: DevEvent[]) =>
      events.flatMap((event) => (event.type === 'net' ? [event.event] : []))
    const event = (from: 'server' | number, to: 'server' | number, name: string, args: string) => ({
      from,
      to,
      name,
      args,
    })
    expect([
      net(sent),
      printed(sent).filter((line) => line.includes('[script:bank]')),
      net(emitted),
      printed(emitted),
    ]).toEqual([
      [
        event('server', 1, 'onPlayerJoining', '1, "Ann", 128'),
        event('server', 2, 'onPlayerJoining', '2, "Bo", 128'),
        event(1, 'server', 'bank:deposit', '100'),
        event(2, 'server', 'bank:deposit', '100'),
        event('server', 1, 'bank:balance', '600'),
        // Ann and Bo come into the scopes of each other, at 0, 0, 0.
        event('server', 1, 'onPlayerJoining', '2, "Bo", 127'),
        event('server', 2, 'bank:balance', '600'),
        event('server', 2, 'onPlayerJoining', '1, "Ann", 127'),
      ],
      [
        'server: [script:bank] deposit\t1\t100',
        'server: [script:bank] deposit\t2\t100',
        'client 1: [script:bank] balance\t600',
        'client 2: [script:bank] balance\t600',
      ],
      [
        event('server', 1, 'bank:hello', '"all"'),
        event('server', 2, 'bank:hello', '"all"'),
        event('server', 2, 'bank:hello', '"you"'),
        event(1, 'server', 'bank:deposit', '5'),
        event('server', 1, 'bank:balance', '600'),
      ],
      [
        'client 1: [script:bank] hello\tall',
        'client 2: [script:bank] hello\tall',
        'client 2: [script:bank] hello\tyou',
        'server: [script:bank] deposit\t1\t5',
        'client 1: [script:bank] balance\t600',
      ],
    ])
  })

  it('tell of latent events, both ways', async () => {
    const { session, told } = await sessionOf(
      `RegisterNetEvent('bank:up', function(text)
    TriggerLatentClientEvent('bank:down', source, 10000, text .. '!')
end)`,
      `RegisterNetEvent('bank:down', function(text) print('down', text) end)
CreateThread(function() TriggerLatentServerEvent('bank:up', 10000, 'hi') end)`,
    )
    await session.connect({ name: 'Ann' })
    session.advance(2000)
    const events = told()
    expect([
      events.flatMap((event) =>
        event.type === 'net' && event.event.name.startsWith('bank:') ? [event.event] : [],
      ),
      printed(events).filter((line) => line.includes('down')),
    ]).toEqual([
      [
        { from: 1, to: 'server', name: 'bank:up', args: '"hi"' },
        { from: 'server', to: 1, name: 'bank:down', args: '"hi!"' },
      ],
      ['client 1: [script:bank] down\thi!'],
    ])
  })

  it('trigger events on the clients of players that joined alone', async () => {
    const { session, told } = await sessionOf(
      `AddEventHandler('playerConnecting', function(name, setKickReason, deferrals) deferrals.defer() end)`,
      `RegisterNetEvent('bank:hello', function() print('hello') end)`,
    )
    const ann = await session.connect({ name: 'Ann' })
    session.advance(1000)
    told()
    session.emit('bank:hello', [], { to: ann })
    session.emit('bank:hello', [], { to: 'everyone' })
    session.advance(100)
    expect(told().filter(({ type }) => type === 'net' || type === 'output')).toEqual([])
  })

  it('tell the state bags of the server, with the values of their keys', async () => {
    const { session, told } = await sessionOf(`GlobalState.open = true
GlobalState.rates = { cash = 1, card = 1.5 }
RegisterNetEvent('bank:deposit', function(amount)
    Player(source).state.deposits = amount
    GlobalState.open = nil
end)`)
    const ann = await session.connect({ name: 'Ann' })
    session.advance(1000)
    const opened = states(told()).at(-1)!.bags
    session.emit('bank:deposit', [5], { from: ann })
    session.advance(100)
    expect([opened, states(told()).at(-1)!.bags]).toEqual([
      [
        {
          name: 'global',
          keys: [
            { key: 'open', value: 'true' },
            { key: 'rates', value: '{ card = 1.5, cash = 1 }' },
          ],
        },
      ],
      [
        { name: 'global', keys: [{ key: 'rates', value: '{ card = 1.5, cash = 1 }' }] },
        { name: 'player:1', keys: [{ key: 'deposits', value: '5' }] },
      ],
    ])
  })

  it('tell where the entities of the server and the blips of the clients are, which they move players and set waypoints on', async () => {
    const { session, told } = await sessionOf(
      '',
      `local blip = AddBlipForRadius(100.0, 200.0, 30.0, 25.0)
SetBlipColour(blip, 3)
SetBlipRoute(blip, true)
BeginTextCommandSetBlipName('STRING')
AddTextComponentSubstringPlayerName('Bank')
EndTextCommandSetBlipName(blip)`,
    )
    await session.connect({ name: 'Ann' })
    session.advance(200)
    session.teleport(1, 50.5, -60.25, 30.5)
    session.waypoint(1, 10, 20)
    session.advance(100)
    expect(states(told()).at(-1)!.map).toEqual({
      entities: [
        // The ped of the player, where its client has it.
        {
          id: 1,
          kind: 'player',
          x: 50.5,
          y: -60.25,
          z: 30.5,
          heading: 0,
          model: 225514697,
          owner: 1,
        },
      ],
      blips: [
        {
          client: 1,
          handle: 1,
          x: 100,
          y: 200,
          z: 30,
          sprite: 9,
          colour: 3,
          alpha: 255,
          shape: 'radius',
          radius: 25,
          name: 'Bank',
          script: 'bank',
          route: true,
        },
        // The waypoint of the player.
        {
          client: 1,
          handle: 257,
          x: 10,
          y: 20,
          z: 0,
          sprite: 8,
          colour: 0,
          alpha: 255,
          shape: 'coord',
          route: false,
        },
      ],
    })
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
