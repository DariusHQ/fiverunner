import { describe, expect, it } from 'vitest'

import { Session, type PlayerIdentity } from '../../src/core/engine/index.ts'
import { clientOf, createProcess, join, runCommand, type TestProcess } from './helpers.ts'

/** A manifest for clients that runs main.lua, with natives FiveRunner has. */
const CLIENT_SCRIPT = [
  ['fx_version', 'cerulean'],
  ['client_script', 'main.lua'],
] as const

interface TestSession {
  readonly server: TestProcess
  readonly clients: TestProcess[]
  readonly session: Session
  /** Runs Lua code on the server in a resource of its own, and returns what it printed. */
  run(code: string): string[]
  /** Runs Lua code on the server in a resource of its own, and returns what all scripts printed. */
  runAll(code: string): string[]
}

/** A server whose clients connected as `identities`. */
async function sessionOf(
  options: { oneSync?: boolean },
  ...identities: PlayerIdentity[]
): Promise<TestSession> {
  const server = await createProcess(options)
  const session = new Session(server.manager)
  const clients: TestProcess[] = []
  for (const identity of identities) {
    const client = await createProcess({ side: 'client' })
    session.connect(client.manager, identity)
    clients.push(client)
  }
  // The server lets them connect at its next tick, and gives them their net ids at the one after.
  server.manager.tick()
  server.manager.tick()
  let count = 0
  const runAll = (code: string) => {
    server.add(`run${count++}`, { 'main.lua': code }).start()
    return server.take().filter((line) => line.startsWith('[script:'))
  }
  const run = (code: string) => {
    const prefix = `[script:run${count}] `
    return runAll(code)
      .filter((line) => line.startsWith(prefix))
      .map((line) => line.slice(prefix.length))
  }
  return { server, clients, session, run, runAll }
}

const ANN: PlayerIdentity = {
  name: 'Ann',
  guid: '110000100000001',
  identifiers: ['license2:bb', 'license:aa', 'ip:10.0.0.1'],
  tokens: ['3:xx', '4:yy'],
  endpoint: '10.0.0.1',
}

describe('Players', () => {
  it('have the names, GUIDs, identifiers, tokens and endpoints of their clients', async () => {
    const { run } = await sessionOf({}, ANN, {})
    expect(
      run(`print(GetPlayerName('1'), GetPlayerGuid(1), GetPlayerEndpoint('1st'))
print(GetNumPlayerIdentifiers(1), table.concat(GetPlayerIdentifiers(1), ','))
print(GetPlayerIdentifier(1, -1), GetPlayerIdentifier(1, 3))
print(GetPlayerIdentifierByType(1, 'license'), GetPlayerIdentifierByType(1, 'license:'))
print(GetPlayerIdentifierByType(1, 'ip'), GetPlayerIdentifierByType(1, 'discord'), GetPlayerIdentifierByType(1, 'bb'))
print(GetNumPlayerTokens(1), table.concat(GetPlayerTokens(1), ','), GetPlayerToken(1, 2))
print(GetPlayerName(2), GetPlayerGuid(2), GetPlayerEndpoint(2), GetNumPlayerIdentifiers(2))
print(GetPlayerName(9), GetPlayerGuid(9), GetPlayerEndpoint(9), GetNumPlayerIdentifiers(9))
print(GetPlayerIdentifier(9, 0), GetPlayerIdentifierByType(9, nil), GetNumPlayerTokens(9))
print(pcall(GetPlayerIdentifierByType, 1, nil))
print(pcall(GetPlayerName, nil))`),
    ).toEqual([
      'Ann\t110000100000001\t10.0.0.1',
      '3\tlicense2:bb,license:aa,ip:10.0.0.1',
      'nil\tnil',
      // FiveM takes the first identifier that starts with the type.
      'license2:bb\tlicense:aa',
      'ip:10.0.0.1\tnil\tnil',
      '2\t3:xx,4:yy\tnil',
      // By default, players have the temporary net ids they connected with for GUIDs.
      'player\t65537\t127.0.0.1\t0',
      'nil\tnil\tnil\t0',
      'nil\tnil\t0',
      'false\tnative 00000000a61c8fc6: Argument at index 1 was null.',
      'false\tnative 00000000406b4b20: Argument at index 0 was null.',
    ])
  })

  it('are known to clients by their indices, which natives of the same names take', async () => {
    const { clients } = await sessionOf({}, ANN)
    const client = clients[0]!
    client
      .add('c', { 'main.lua': `print(GetPlayerName(1), GetPlayerName(PlayerId()))` }, CLIENT_SCRIPT)
      .start()
    expect(client.take().filter((line) => line.startsWith('[script:'))).toEqual([
      '[script:c] **Invalid**\tAnn',
    ])
    expect(client.diagnostics).toEqual([])
  })

  it('exist by their net ids, as atoi reads them', async () => {
    const { run } = await sessionOf({}, {})
    expect(run(`print(DoesPlayerExist('1'), DoesPlayerExist('1st'), DoesPlayerExist(2))`)).toEqual([
      '1\t1\tfalse',
    ])
  })

  it('are listed as GetNumPlayerIndices last listed them, but for those that dropped since', async () => {
    const { run, session } = await sessionOf({}, {}, {}, {})
    expect(run(`print(table.concat(GetPlayers(), ','))`)).toEqual(['1,2,3'])
    session.player(2)!.quit()
    expect(
      run(`print(GetPlayerFromIndex(0), GetPlayerFromIndex(1), GetPlayerFromIndex(2), GetPlayerFromIndex(3), GetPlayerFromIndex(-1))
print(table.concat(GetPlayers(), ','))`),
    ).toEqual(['1\tnil\t3\tnil\tnil', '1,3'])
  })

  it('tell how long they are online, and since the server last heard from them', async () => {
    const { server, clients, session, run } = await sessionOf({})
    server.time = 1000
    const client = await createProcess({ side: 'client' })
    const player = join(session, client.manager)
    clients.push(client)
    server.time = 1500
    // The server heard from the client as it connected.
    expect(run(`print(GetPlayerLastMsg(1), GetPlayerTimeOnline(1))`)).toEqual(['500\t0'])
    server.time = 3500
    client.manager.tick()
    server.time = 4000
    player.ping = 30
    expect(
      run(`print(GetPlayerLastMsg(1), GetPlayerTimeOnline(1), GetPlayerPing(1))
print(GetPlayerLastMsg(9), GetPlayerTimeOnline(9), GetPlayerPing(9))`),
    ).toEqual(['500\t2\t30', '2147483647\t0\t0'])
  })

  it('may access what their principals may: their identifiers, then their net id', async () => {
    const { server, run } = await sessionOf({}, ANN, {})
    for (const line of [
      'add_ace identifier.license:aa command.a allow',
      'add_ace player.2 command.b allow',
      'add_principal player.2 group.admin',
      'add_ace group.admin command.c allow',
    ]) {
      runCommand(server.manager, line, 'system.console')
    }
    expect(
      run(`print(IsPlayerAceAllowed(1, 'command.a'), IsPlayerAceAllowed(1, 'command.b'))
print(IsPlayerAceAllowed(2, 'command.b'), IsPlayerAceAllowed(2, 'command.c'), IsPlayerAceAllowed(2, 'command.a'))
print(IsPlayerAceAllowed(9, 'command.a'), IsPlayerAceAllowed(9, nil))
print(pcall(IsPlayerAceAllowed, 1, nil))`),
    ).toEqual([
      '1\tfalse',
      '1\t1\tfalse',
      'false\tfalse',
      'false\tnative 00000000dedae23d: Argument at index 1 was null.',
    ])
    expect(server.manager.session!.player(1)!.principals).toEqual([
      'identifier.license2:bb',
      'identifier.license:aa',
      'identifier.ip:10.0.0.1',
      'player.1',
    ])
  })
})

describe('Dropping players', () => {
  it('triggers playerDropped once, with the reason, the resource and why', async () => {
    const { server, clients, session, runAll } = await sessionOf({}, ANN, {}, {})
    server
      .add('watch', {
        'main.lua': `AddEventHandler('playerDropped', function(...)
    print('dropped', source, ...)
    print('players', table.concat(GetPlayers(), ','))
    DropPlayer(source, 'again')
end)`,
      })
      .start()
    server.take()
    // Declared void, DropPlayer sets whether it dropped, which FiveM's result checks poison.
    expect(
      runAll(`print(pcall(DropPlayer, 1, nil))
print(DropPlayer(9, nil), DropPlayer(1, 'bye'), DropPlayer(9, 'nobody'))`),
    ).toEqual([
      // FiveM checks the reason only once it found the player.
      '[script:run0] false\tnative 00000000ba0613e1: Argument at index 1 was null.',
      '[script:watch] dropped\t1\tbye\trun0\t1',
      '[script:watch] players\t1,2,3',
      '[script:run0] false\t2146290430\tfalse',
    ])
    expect([clients[0]!.manager.session, clients[0]!.manager.player]).toEqual([
      undefined,
      undefined,
    ])
    expect(session.player(1)).toBe(undefined)
    const dropped = runAll(`DropPlayer(2, '')`)
    const third = session.player(3)!
    third.quit()
    third.quit('again')
    expect([...dropped, ...server.take()]).toEqual([
      '[script:watch] dropped\t2\tDropped.\trun1\t1',
      '[script:watch] players\t2,3',
      '[script:watch] dropped\t3\tExiting\t__cfx_internal:client\t2',
      '[script:watch] players\t3',
    ])
    expect(Array.from(session.players)).toEqual([])
  })

  it('drops only the players of its session', async () => {
    const first = await sessionOf({}, {})
    const second = await sessionOf({}, {})
    const player = first.session.player(1)!
    second.session.drop(player, 'not mine')
    expect([first.session.player(1), second.session.player(1)?.dropping]).toEqual([player, false])
    expect(player.dropping).toBe(false)
  })

  it('gives no net id again before it gave all the others', async () => {
    const { session } = await sessionOf({}, {}, {})
    session.player(2)!.quit()
    const client = await createProcess({ side: 'client' })
    expect(join(session, client.manager).netId).toBe(3)
  })

  it('tells the other clients without OneSync, with onPlayerDropped', async () => {
    for (const oneSync of [true, false]) {
      const { server, clients, session } = await sessionOf({ oneSync }, ANN, {})
      clients[1]!
        .add(
          'c',
          {
            'main.lua': `RegisterNetEvent('onPlayerDropped', function(...) print('left', ...) end)`,
          },
          CLIENT_SCRIPT,
        )
        .start()
      // The client downloads what its server has, which is nothing.
      clients[1]!.manager.tick()
      clients[1]!.take()
      session.player(1)!.quit()
      session.tick()
      expect(clients[1]!.take()).toEqual(oneSync ? [] : ['[script:c] left\t1\tAnn\t-1'])
      expect(server.diagnostics).toEqual([])
    }
  })
})

describe('Players of clients', () => {
  it('are the local player, which is at index 128 with OneSync', async () => {
    const { run } = await clientOf()
    expect(
      run(`print(PlayerId(), GetPlayerIndex(), PlayerPedId())
print(GetPlayerPed(-1), GetPlayerPed(PlayerId()), GetPlayerPedScriptIndex(PlayerId()), GetPlayerPedScriptIndex(-1))
print(GetPlayerPed(3), GetPlayerPed(127), GetPlayerPed(0))`),
    ).toEqual(['128\t128\t1', '1\t1\t1\t1', '0\t0\t0'])
  })

  it('are found by their indices in 8 bits', async () => {
    const { run } = await clientOf()
    expect(
      run(`print(GetPlayerPed(128 + 256), GetPlayerServerId(128 - 256), NetworkIsPlayerActive(128 + 512))
print(GetPlayerServerId(-1), NetworkIsPlayerActive(-1), GetPlayerName(-1))`),
    ).toEqual(['1\t1\t1', '0\tfalse\t**Invalid**'])
  })

  it('have the names and the net ids that their server gave them', async () => {
    const { run } = await clientOf({}, { name: 'Ann' })
    expect(
      run(`print(GetPlayerName(PlayerId()), GetPlayerName(5), GetPlayerServerId(PlayerId()), GetPlayerServerId(5))
print(GetPlayerFromServerId(1), GetPlayerFromServerId(2), GetPlayerFromServerId(1 + 65536), GetPlayerFromServerId(0))`),
    ).toEqual(['Ann\t**Invalid**\t1\t0', '128\t-1\t-1\t-1'])
  })

  it('have the net ids of the players of their clients, whatever they are', async () => {
    const { session } = await clientOf()
    const bob = await createProcess({ side: 'client' })
    join(session, bob.manager, { name: 'Bob' })
    bob
      .add(
        'c',
        {
          'main.lua': `print(GetPlayerName(PlayerId()), GetPlayerServerId(PlayerId()), GetPlayerFromServerId(2), GetPlayerFromServerId(1))`,
        },
        CLIENT_SCRIPT,
      )
      .start()
    expect(bob.take().filter((line) => line.startsWith('[script:'))).toEqual([
      '[script:c] Bob\t2\t128\t-1',
    ])
  })

  it('play, alone, in a session that started', async () => {
    const { run } = await clientOf()
    expect(
      run(`print(json.encode(GetActivePlayers()), GetNumberOfPlayers(), IsPlayerPlaying(PlayerId()), IsPlayerPlaying(1))
print(NetworkIsPlayerActive(PlayerId()), NetworkIsPlayerConnected(PlayerId()), NetworkIsPlayerActive(1), NetworkIsPlayerConnected(1))
print(NetworkIsSessionStarted(), NetworkIsSessionActive(), NetworkIsInSession())`),
    ).toEqual(['[128]\t1\t1\tfalse', '1\t1\tfalse\tfalse', '1\t1\t1'])
  })

  it('have peds, which natives tell are those of players', async () => {
    const { run } = await clientOf()
    expect(
      run(`local ped = PlayerPedId()
print(IsPedAPlayer(ped), IsPedAPlayer(0), IsPedAPlayer(2), NetworkGetPlayerIndexFromPed(ped), NetworkGetPlayerIndexFromPed(0))`),
    ).toEqual(['1\tfalse\tfalse\t128\t-1'])
  })

  it('are found by the names of their state bags, with OneSync, by their net ids in 16 bits', async () => {
    const { run } = await clientOf()
    expect(
      run(`print(GetPlayerFromStateBagName('player:1'), GetPlayerFromStateBagName('player:' .. (1 + 65536)), GetPlayerFromStateBagName('player:2'))
print(GetPlayerFromStateBagName('entity:1'), GetPlayerFromStateBagName('player:1x'), pcall(GetPlayerFromStateBagName))`),
    ).toEqual([
      '128\t128\t0',
      '0\t128\tfalse\tnative 00000000a56135e0: Argument at index 0 was null.',
    ])
  })

  it('are at index 0 without OneSync, which no state bag names', async () => {
    const { run } = await clientOf({ oneSync: false })
    expect(
      run(`print(PlayerId(), GetPlayerPed(0), GetPlayerServerId(0), GetPlayerFromServerId(1), json.encode(GetActivePlayers()))
print(GetPlayerFromStateBagName('player:1'), NetworkIsPlayerActive(0), GetPlayerPed(128))`),
    ).toEqual(['0\t1\t1\t0\t[0]', '0\t1\t0'])
  })

  it('are a player at index 0, out of network games, before clients join sessions', async () => {
    const client = await createProcess({ side: 'client' })
    client
      .add('alone', {
        'main.lua': `print(PlayerId(), PlayerPedId(), GetPlayerPed(0), GetPlayerName(0), IsPlayerPlaying(0))
print(GetPlayerServerId(0), GetPlayerFromServerId(0), json.encode(GetActivePlayers()), NetworkIsPlayerActive(0), NetworkIsPlayerConnected(0))
print(NetworkIsSessionStarted(), NetworkGetPlayerIndexFromPed(PlayerPedId()), GetPlayerFromStateBagName('player:0'))`,
      })
      .start()
    expect(client.take().filter((line) => line.startsWith('[script:'))).toEqual([
      '[script:alone] 0\t1\t1\t\t1',
      '[script:alone] 0\t-1\t[]\tfalse\tfalse',
      '[script:alone] false\t-1\t0',
    ])
  })

  it('are known to scripts that call natives by the hashes of GTA V', async () => {
    const { run } = await clientOf()
    expect(
      run(`print(Citizen.InvokeNative(0x4F8644AF03D0E0D6, Citizen.ResultAsInteger()), Citizen.InvokeNative(0xD80958FC74E988A6, Citizen.ResultAsInteger()))
print(Citizen.InvokeNative(0x43A66C31C68491C0, -1, Citizen.ResultAsInteger()), Citizen.InvokeNative(0x6D0DE6A7B5DA71F8, 128, Citizen.ResultAsString()))`),
    ).toEqual(['128\t1', '1\tAnn'])
  })
})
