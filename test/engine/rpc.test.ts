import { describe, expect, it } from 'vitest'

import type { NativeContext } from '../../src/core/engine/context.ts'
import { RPC_NATIVES } from '../../src/core/engine/rpc.ts'
import {
  defineNative,
  luaName,
  NativeError,
  type NativeDefinition,
} from '../../src/core/natives/index.ts'
import { Session } from '../../src/core/engine/index.ts'
import { clientOf, createProcess, join, type TestClient } from './helpers.ts'

/** Ticks the client, then the server, and returns what scripts printed, marked with their sides. */
function step(test: TestClient): string[] {
  test.client.tickAt(test.client.time + 10)
  test.server.tickAt(test.server.time + 10)
  return [
    ...test.client.take().map((line) => `client ${line}`),
    ...test.server.take().map((line) => `server ${line}`),
  ].filter((line) => line.includes('[script:'))
}

/** A client of a server whose resource `srv` runs `server`, and whose client then runs `client`, and started srv. */
async function session(server: string, client = '', options: Parameters<typeof clientOf>[0] = {}) {
  const test = await clientOf(options)
  test.server.add('srv', { 'main.lua': server }).start()
  test.server.take()
  test.run(client)
  // The client downloads srv, then starts it.
  step(test)
  step(test)
  return test
}

/** Runs a command of the server, as its console. */
function command(test: TestClient, line: string): void {
  test.server.manager.console.commands.invoke(line, '')
}

/** Runs a command of the client, then returns what scripts printed. */
function ask(test: TestClient, line: string): string[] {
  test.client.manager.console.commands.invoke(line, '')
  return test.client.take().filter((line) => line.includes('[script:'))
}

const WHERE = `RegisterCommand('where', function()
    local ped = PlayerPedId()
    print(GetEntityCoords(ped), GetEntityHeading(ped), IsEntityPositionFrozen(ped))
end, false)`

describe('Natives that servers have clients run', () => {
  it('run on the clients that own the entities that they name, at their next ticks', async () => {
    const test = await session(
      `RegisterCommand('move', function()
    local ped = GetPlayerPed(1)
    SetEntityCoords(ped, 100.0, 200.0, 30.0, false, false, false, false)
    SetEntityHeading(ped, 90.0)
    FreezeEntityPosition(ped, true)
end, false)
RegisterCommand('seen', function() print('seen', GetEntityCoords(GetPlayerPed(1))) end, false)`,
      WHERE,
    )
    command(test, 'move')
    const before = ask(test, 'where')
    step(test)
    const after = ask(test, 'where')
    step(test)
    command(test, 'seen')
    expect([...before, ...after, ...step(test)]).toEqual([
      // The client moves its ped at its next tick, then syncs it to the server in the steps of its sector.
      '[script:run0] vec3(0.000000, 0.000000, 0.000000)\t0.0\tfalse',
      '[script:run0] vec3(100.000000, 200.000000, 30.000000)\t90.0\t1',
      'server [script:srv] seen\tvec3(99.995605, 199.991211, 29.987549)',
    ])
  })

  it('name the peds of players by the net ids of the players, those that they had too', async () => {
    const test = await session(
      `RegisterCommand('move', function(_, args) SetEntityCoords(tonumber(args[1]), 5.0, 6.0, 7.0, false, false, false, false) end, false)`,
      WHERE,
    )
    command(test, 'move 99')
    step(test)
    const nobody = ask(test, 'where')
    command(test, 'move 1')
    step(test)
    const moved = ask(test, 'where')
    // Ann connected with the temporary net id 65536.
    command(test, 'move 65536')
    test.client.manager.world!.playerPed.moveTo(0, 0, 0)
    step(test)
    expect([...nobody, ...moved, ...ask(test, 'where')]).toEqual([
      // 99 is the net id of no player, and the handle of no entity.
      '[script:run0] vec3(0.000000, 0.000000, 0.000000)\t0.0\tfalse',
      '[script:run0] vec3(5.000000, 6.000000, 7.000000)\t0.0\tfalse',
      '[script:run0] vec3(5.000000, 6.000000, 7.000000)\t0.0\tfalse',
    ])
  })

  it('run for players by their net ids, once the models of their hashes loaded', async () => {
    const test = await session(
      `RegisterCommand('model', function(_, args) SetPlayerModel(args[1], GetHashKey('mp_m_freemode_01')) end, false)`,
      `RegisterCommand('loaded', function() print('loaded', HasModelLoaded(GetHashKey('mp_m_freemode_01'))) end, false)`,
    )
    command(test, 'model 1')
    step(test)
    const first = [...ask(test, 'loaded'), ...test.client.diagnostics]
    step(test)
    expect([...first, ...ask(test, 'loaded'), ...test.client.diagnostics]).toEqual([
      '[script:run0] loaded\tfalse',
      // The model loaded at the next tick, then the client ran the native.
      '[script:run0] loaded\t1',
      'srv: SetPlayerModel is not implemented in FiveRunner yet: it does nothing and returns zero values.',
    ])
  })

  it('fail for players named by what is no number, and for no text, but run nowhere for players that there are not', async () => {
    const test = await session(
      `RegisterCommand('model', function(_, args) print(pcall(SetPlayerModel, args[1], 0)) end, false)
RegisterCommand('anim', function() print(pcall(TaskPlayAnim, GetPlayerPed(1), nil, 'anim', 8.0, -8.0, -1, 49, 0.5, false, false, false)) end, false)`,
    )
    command(test, 'model 99')
    command(test, 'model nobody')
    command(test, 'model 99999999999')
    command(test, 'anim')
    expect([...step(test), ...test.client.diagnostics]).toEqual([
      // 99 is the net id of no player.
      'server [script:srv] true\tfalse',
      // FiveM's server reads the net ids of players with std::stoi.
      'server [script:srv] false\tnative 00000000774a4c54: invalid stoi argument',
      'server [script:srv] false\tnative 00000000774a4c54: stoi argument out of range',
      'server [script:srv] false\tnative 000000005ab552c6: Argument at index 1 was null.',
    ])
  })

  it('wait for clients to own the entities that no client owns, and to have them', async () => {
    const test = await session(
      `local vehicle = CreateVehicleServerSetter('adder', 'automobile', 500.0, 0.0, 1.0, 0.0)
SetEntityHeading(vehicle, 90.0)
RegisterCommand('heading', function() print('heading', NetworkGetEntityOwner(vehicle), GetEntityHeading(vehicle)) end, false)`,
      `RegisterCommand('walk', function() SetEntityCoords(PlayerPedId(), 450.0, 0.0, 1.0, false, false, false, false) end, false)
RegisterCommand('turned', function() print('turned', GetEntityHeading(NetworkGetEntityFromNetworkId(65534))) end, false)`,
    )
    step(test)
    command(test, 'heading')
    const far = step(test)
    test.client.manager.console.commands.invoke('walk', '')
    // The server hands the client the vehicle as it takes the ped there, then the native once the client has it.
    step(test)
    step(test)
    const created = ask(test, 'turned')
    step(test)
    const turned = ask(test, 'turned')
    step(test)
    command(test, 'heading')
    expect([...far, ...created, ...turned, ...step(test)]).toEqual([
      // No client is near the vehicle, which the server turned by a quaternion in 11 bits.
      'server [script:srv] heading\t-1\t0.039567284286022',
      '[script:run0] turned\t0.039567280560732',
      '[script:run0] turned\t90.0',
      'server [script:srv] heading\t1\t90.000015258789',
    ])
  })

  it('say once on clients that they do not implement a native, for the resource that ran it', async () => {
    const test = await session(
      `RegisterCommand('armour', function() SetPedArmour(GetPlayerPed(1), 50) end, false)`,
    )
    command(test, 'armour')
    command(test, 'armour')
    step(test)
    expect([test.client.diagnostics, test.server.diagnostics]).toEqual([
      [
        'srv: SetPedArmour is not implemented in FiveRunner yet: it does nothing and returns zero values.',
      ],
      [],
    ])
  })

  it('run for the resources that clients started alone', async () => {
    const test = await session('', WHERE)
    test.server
      .add('hidden', {
        'fxmanifest.lua': `fx_version 'cerulean'
game 'gta5'
server_only 'yes'
server_script 'main.lua'`,
        'main.lua': `SetEntityCoords(GetPlayerPed(1), 5.0, 6.0, 7.0, false, false, false, false)`,
      })
      .start()
    step(test)
    step(test)
    expect(ask(test, 'where')).toEqual([
      // The server resource hidden is for no client.
      '[script:run0] vec3(0.000000, 0.000000, 0.000000)\t0.0\tfalse',
    ])
  })

  it('run nowhere for entities that there are not, or on servers without OneSync', async () => {
    const seen: string[] = []
    for (const oneSync of [true, false]) {
      const test = await session(
        `RegisterCommand('move', function() SetEntityCoords(0x20000 + 999, 5.0, 6.0, 7.0, false, false, false, false) SetEntityCoords(GetPlayerPed(1), 5.0, 6.0, 7.0, false, false, false, false) end, false)`,
        WHERE,
        { oneSync },
      )
      command(test, 'move')
      step(test)
      command(test, 'move')
      seen.push(...ask(test, 'where'), ...test.server.diagnostics)
    }
    expect(seen).toEqual([
      // With OneSync, the client moves its ped alone, and without it, the server says once that it runs nothing.
      '[script:run0] vec3(5.000000, 6.000000, 7.000000)\t0.0\tfalse',
      '[script:run0] vec3(0.000000, 0.000000, 0.000000)\t0.0\tfalse',
      "srv: SetEntityCoords is one of the natives that FiveM's server has clients run, which it does with OneSync alone: without it, FiveM's server has no handler for it, so it does nothing.",
    ])
  })
})

/** Natives of clients that record what they are given, and the resources that they run for, by those of GTA V. */
function recorders(recorded: unknown[][]): NativeDefinition<NativeContext>[] {
  const record =
    (name: string) =>
    (ctx: NativeContext, ...args: unknown[]) => {
      recorded.push([name, ctx.resource.name, ...args])
    }
  return [
    defineNative(
      {
        name: 'RECORD_TASK_PLAY_ANIM',
        hash: 0xea47fe3719165b94n,
        result: 'void',
        params: [
          'Ped ped',
          'char* animDictionary',
          'char* animationName',
          'float blendInSpeed',
          'float blendOutSpeed',
          'int duration',
          'int flag',
          'float playbackRate',
          'BOOL lockX',
          'BOOL lockY',
          'BOOL lockZ',
        ],
      },
      record('anim'),
    ),
    defineNative(
      {
        name: 'RECORD_TASK_SHOOT_AT_ENTITY',
        hash: 0x08da95e8298ae772n,
        result: 'void',
        params: ['Entity entity', 'Entity target', 'int duration', 'Hash firingPattern'],
      },
      record('shoot'),
    ),
    defineNative(
      {
        name: 'RECORD_SET_PLAYER_INVINCIBLE',
        hash: 0x239528eacdc3e7den,
        result: 'void',
        params: ['Player player', 'BOOL bInvincible'],
      },
      record('invincible'),
    ),
    defineNative(
      {
        name: 'RECORD_SET_VEHICLE_DOORS_LOCKED',
        hash: 0xb664292eaecf7fa6n,
        result: 'void',
        params: ['Vehicle vehicle', 'int doorLockStatus'],
      },
      record('locked'),
    ),
    defineNative(
      {
        name: 'RECORD_SET_MODEL_AS_NO_LONGER_NEEDED',
        hash: 0xe532f5d78798daabn,
        result: 'void',
        params: ['Hash model'],
      },
      record('released'),
    ),
    defineNative(
      {
        name: 'FAIL_GIVE_WEAPON_TO_PED',
        hash: 0xbf0fd6e56c964fcbn,
        result: 'void',
        params: [
          'Ped ped',
          'Hash weaponHash',
          'int ammoCount',
          'BOOL isHidden',
          'BOOL bForceInHand',
        ],
      },
      () => {
        throw new NativeError('no weapons here')
      },
    ),
  ]
}

describe('Clients that their servers have run natives', () => {
  it('have every one of them, implemented or not', async () => {
    const client = await createProcess({ side: 'client' })
    const { natives } = client.manager
    const missing = RPC_NATIVES.filter(
      ({ hash, name }) =>
        natives.byHash(hash) === undefined && natives.byName(luaName(name)) === undefined,
    )
    expect(missing).toEqual([])
  })

  it('run them with their arguments as the client knows them, for the resources of the server', async () => {
    const recorded: unknown[][] = []
    const test = await session(
      `local far = CreateVehicleServerSetter('adder', 'automobile', 1000.0, 0.0, 1.0, 0.0)
RegisterCommand('anim', function() TaskPlayAnim(GetPlayerPed(1), 'dict', 'anim', 8.0, -8.0, -1, 49, 0.5, false, true, false) end, false)
RegisterCommand('shoot', function() TaskShootAtEntity(GetPlayerPed(1), far, 1000, 0) end, false)`,
      '',
      { clientNatives: recorders(recorded) },
    )
    command(test, 'anim')
    command(test, 'shoot')
    step(test)
    expect(recorded).toEqual([
      // The ped of the player has the handle 1 on its client, which knows no vehicle so far.
      ['anim', 'srv', 1, 'dict', 'anim', 8, -8, -1, 49, 0.5, false, true, false],
      ['shoot', 'srv', 1, -1, 1000, 0],
    ])
  })

  it('load the models of their hashes first, then let them go once the natives ran', async () => {
    const recorded: unknown[][] = []
    const test = await session(
      `RegisterCommand('shoot', function() TaskShootAtEntity(GetPlayerPed(1), GetPlayerPed(1), 1000, GetHashKey('FIRING_PATTERN_FULL_AUTO')) end, false)
RegisterCommand('give', function() GiveWeaponToPed(GetPlayerPed(1), GetHashKey('WEAPON_PISTOL'), 10, false, true) end, false)`,
      '',
      { clientNatives: recorders(recorded) },
    )
    command(test, 'shoot')
    command(test, 'give')
    const traced: string[] = []
    const tick = () => {
      test.client.tickAt(test.client.time + 10)
      traced.push(...test.client.take().filter((line) => line.includes('rpc')))
    }
    tick()
    const first = [...recorded]
    tick()
    expect([first, recorded, traced]).toEqual([
      [],
      [
        ['shoot', 'srv', 1, 1, 1000, 0xc6ee6b4c],
        ['released', 'srv', 0xc6ee6b4c],
      ],
      // The native that failed lets no model go.
      ['[gta-net-five] failure executing native rpc: no weapons here'],
    ])
  })

  it('run them for players by their indices, and not for players that they do not know', async () => {
    const recorded: unknown[][] = []
    const test = await session('', '', { clientNatives: recorders(recorded) })
    test.client.manager.world!.enter(127, 2, 'Bob')
    const rpc = test.client.manager.rpc!
    for (const netId of [1, 2, 3]) {
      rpc.receive({
        hash: 0x239528eacdc3e7den,
        resource: 'srv',
        args: [
          { kind: 'player', netId },
          { kind: 'value', value: true },
        ],
      })
    }
    // Clients take no natives that they do not know their servers to have them run.
    rpc.receive({ hash: 1n, resource: 'srv', args: [{ kind: 'hash', hash: 7 }] })
    step(test)
    step(test)
    expect([recorded, test.client.manager.world!.loaded(7)]).toEqual([
      [
        ['invincible', 'srv', 128, true],
        ['invincible', 'srv', 127, true],
      ],
      false,
    ])
  })

  it('run at once with hashes of 0, which are of no model', async () => {
    const test = await session(
      `RegisterCommand('model', function() SetPlayerModel(1, 0) end, false)`,
    )
    command(test, 'model')
    step(test)
    expect(test.client.diagnostics).toEqual([
      'srv: SetPlayerModel is not implemented in FiveRunner yet: it does nothing and returns zero values.',
    ])
  })

  it('drop what comes for resources that they did not start yet', async () => {
    const test = await session('', WHERE)
    test.server
      .add('late', {
        'main.lua': `RegisterCommand('late', function() SetEntityCoords(GetPlayerPed(1), 5.0, 6.0, 7.0, false, false, false, false) end, false)`,
      })
      .start()
    // The client downloads late at its next tick, and starts it at the one after.
    step(test)
    command(test, 'late')
    step(test)
    step(test)
    expect([test.client.manager.getResource('late')?.state, ...ask(test, 'where')]).toEqual([
      'started',
      '[script:run0] vec3(0.000000, 0.000000, 0.000000)\t0.0\tfalse',
    ])
  })

  it('run them for the last of their resources whose names have the hash of the name given', async () => {
    const test = await session(
      `RegisterCommand('armour', function() SetPedArmour(GetPlayerPed(1), 50) end, false)`,
    )
    test.server.add('SRV', { 'main.lua': '' }).start()
    step(test)
    step(test)
    command(test, 'armour')
    step(test)
    // SRV came after srv, and runs what srv asked for.
    expect(test.client.diagnostics).toEqual([
      'SRV: SetPedArmour is not implemented in FiveRunner yet: it does nothing and returns zero values.',
    ])
  })

  it('run on vehicles for the clients that own them', async () => {
    const test = await session(
      `local vehicle = CreateVehicleServerSetter('adder', 'automobile', 10.0, 0.0, 1.0, 0.0)
RegisterCommand('plate', function() SetVehicleNumberPlateText(vehicle, 'FIVE') end, false)`,
    )
    step(test)
    command(test, 'plate')
    step(test)
    step(test)
    expect(test.client.diagnostics).toEqual([
      'srv: SetVehicleNumberPlateText is not implemented in FiveRunner yet: it does nothing and returns zero values.',
    ])
  })

  it('run once what waited for them to own entities', async () => {
    const recorded: unknown[][] = []
    const test = await session(
      `local vehicle = CreateVehicleServerSetter('adder', 'automobile', 500.0, 0.0, 1.0, 0.0)
SetVehicleDoorsLocked(vehicle, 2)`,
      `RegisterCommand('walk', function() SetEntityCoords(PlayerPedId(), 450.0, 0.0, 1.0, false, false, false, false) end, false)`,
      { clientNatives: recorders(recorded) },
    )
    test.client.manager.console.commands.invoke('walk', '')
    for (let i = 0; i < 5; i++) step(test)
    // The vehicle has the handle 257 on the client.
    expect(recorded).toEqual([['locked', 'srv', 257, 2]])
  })
})

const SPAWN = `local vehicle
AddEventHandler('entityCreating', function(entity) print('creating', entity) end)
RegisterCommand('spawn', function(_, args)
    vehicle = CreateVehicle(GetHashKey('adder'), tonumber(args[1]) + 0.0, 20.0, 1.0, 90.0, args[2] ~= 'local', true)
    print('spawned', vehicle, DoesEntityExist(vehicle), GetEntityCoords(vehicle))
end, false)
RegisterCommand('check', function()
    print('check', DoesEntityExist(vehicle), GetEntityCoords(vehicle))
    if DoesEntityExist(vehicle) then
        print('check', GetEntityHeading(vehicle), NetworkGetEntityOwner(vehicle), NetworkGetNetworkIdFromEntity(vehicle), GetEntityModel(vehicle) == GetHashKey('adder'), GetEntityScript(vehicle))
    end
end, false)`

/** A second client, Bob, that joined the session of a test, which has run a tick, and runs `code`. */
async function bobOf(test: TestClient, code = '') {
  const bob = await createProcess({ side: 'client' })
  const player = join(test.session, bob.manager, { name: 'Bob' })
  bob.add('bob', { 'main.lua': code }).start()
  bob.tickAt(test.client.time)
  test.server.tickAt(test.server.time + 10)
  return { bob, player }
}

describe('Entities that servers have clients create', () => {
  it('are created by the clients nearest to where they go, and found by the handles that servers gave once they came', async () => {
    const test = await session(SPAWN)
    command(test, 'spawn 10')
    const lines = [...step(test), ...step(test)]
    command(test, 'check')
    expect([...lines, ...step(test)]).toEqual([
      // The handle names no entity until the client created the vehicle, once the model loaded, and synced it.
      'server [script:srv] spawned\t131329\tfalse\tvec3(0.000000, 0.000000, 0.000000)',
      'server [script:srv] creating\t131329',
      'server [script:srv] check\t1\tvec3(9.995605, 19.991209, 0.989014)',
      'server [script:srv] check\t90.000015258789\t1\t2\ttrue\tsrv',
    ])
  })

  it('are created by the clients whose players are the nearest to where they go, or the first of those as near', async () => {
    const test = await session(SPAWN)
    const { bob } = await bobOf(
      test,
      `RegisterCommand('walk', function() SetEntityCoords(PlayerPedId(), 500.0, 20.0, 1.0, false, false, false, false) end, false)`,
    )
    const tick = () => {
      const lines = step(test)
      bob.tickAt(test.client.time)
      return lines
    }
    for (let i = 0; i < 3; i++) tick()
    // Both are at 0, 0, 0.
    command(test, 'spawn 0')
    for (let i = 0; i < 3; i++) tick()
    command(test, 'check')
    const first = tick()
    bob.manager.console.commands.invoke('walk', '')
    for (let i = 0; i < 3; i++) tick()
    command(test, 'spawn 450')
    for (let i = 0; i < 3; i++) tick()
    command(test, 'check')
    expect([...first, ...tick()]).toEqual([
      // Ann joined first, then Bob, whose object ids come after hers.
      'server [script:srv] check\t1\tvec3(0.000000, 19.991209, 0.989014)',
      'server [script:srv] check\t90.000015258789\t1\t2\ttrue\tsrv',
      'server [script:srv] check\t1\tvec3(450.000000, 19.991209, 0.989014)',
      'server [script:srv] check\t90.000015258789\t2\t12\ttrue\tsrv',
    ])
  })

  it('are created by the clients whose peds are the nearest in all three dimensions, before those whose players have no ped', async () => {
    const server = await createProcess()
    const session = new Session(server.manager)
    server
      .add('srv', {
        'main.lua': `local vehicles = {}
RegisterCommand('spawn', function(_, args)
    vehicles[#vehicles + 1] = CreateVehicle(GetHashKey('adder'), tonumber(args[1]) + 0.0, tonumber(args[2]) + 0.0, tonumber(args[3]) + 0.0, 0.0, true, true)
end, false)
RegisterCommand('owners', function()
    for _, vehicle in ipairs(vehicles) do
        print('owner', vehicle, DoesEntityExist(vehicle) and NetworkGetEntityOwner(vehicle), DoesEntityExist(vehicle) and GetEntityCoords(vehicle))
    end
end, false)
RegisterCommand('ped', function() print('ped', CreatePedInsideVehicle(vehicles[1], 4, GetHashKey('mp_m_freemode_01'), -1, true, true)) end, false)`,
      })
      .start()
    // Xan joins first, but never ticks, so the server knows no ped of his.
    const xan = await createProcess({ side: 'client' })
    join(session, xan.manager, { name: 'Xan' })
    const [ann, bob] = [
      await createProcess({ side: 'client' }),
      await createProcess({ side: 'client' }),
    ]
    join(session, ann.manager, { name: 'Ann' })
    join(session, bob.manager, { name: 'Bob' })
    const tick = () => {
      for (const client of [ann, bob]) client.tickAt(client.time + 10)
      server.tickAt(server.time + 10)
    }
    const owners = () => {
      server.manager.console.commands.invoke('owners', '')
      return server.take().filter((line) => line.includes('[script:'))
    }
    bob.manager.world!.playerPed.moveTo(0, 0, 300)
    for (let i = 0; i < 3; i++) tick()
    // Ann is at 0, 0, 0, as near as Bob on the ground, but further on z.
    server.manager.console.commands.invoke('spawn 0 20 300', '')
    server.manager.console.commands.invoke('spawn 0 -20 0', '')
    for (let i = 0; i < 3; i++) tick()
    const first = owners()
    bob.manager.world!.playerPed.moveTo(0, 290, 50)
    tick()
    server.manager.console.commands.invoke('spawn 0 300 0', '')
    for (let i = 0; i < 3; i++) tick()
    bob.manager.world!.playerPed.moveTo(290, 0, 50)
    tick()
    server.manager.console.commands.invoke('spawn 300 0 0', '')
    for (let i = 0; i < 3; i++) tick()
    server.manager.console.commands.invoke('ped', '')
    tick()
    tick()
    expect([...first, ...owners(), ann.diagnostics, bob.diagnostics]).toEqual([
      // Ann has the net id 2, and Bob 3, whose peds have the handles 131073 and 131329.
      '[script:srv] owner\t131585\t3\tvec3(0.000000, 19.991209, 299.989014)',
      '[script:srv] owner\t131841\t2\tvec3(0.000000, -20.004395, -0.005127)',
      // CreatePedInsideVehicle takes no position, and goes to the first client whose player has a ped: Ann.
      '[script:srv] ped\t132609',
      '[script:srv] owner\t131585\t3\tvec3(0.000000, 19.991209, 299.989014)',
      '[script:srv] owner\t131841\t2\tvec3(0.000000, -20.004395, -0.005127)',
      // Bob is nearer on y and further on z, but nearer in all.
      '[script:srv] owner\t132097\t3\tvec3(0.000000, 300.000000, -0.005127)',
      // And then nearer on x.
      '[script:srv] owner\t132353\t3\tvec3(300.000000, 0.000000, -0.005127)',
      [
        'srv: CreatePedInsideVehicle is not implemented in FiveRunner yet: it does nothing and returns zero values.',
      ],
      [],
    ])
  })

  it('are nothing to servers as clients create them unnetworked, and take no natives of theirs', async () => {
    const test = await session(
      `${SPAWN}
RegisterCommand('turn', function() SetEntityHeading(vehicle, 45.0) end, false)`,
      `RegisterCommand('vehicles', function()
    local vehicles = GetGamePool('CVehicle')
    print(json.encode(vehicles), GetEntityHeading(vehicles[1]))
end, false)`,
    )
    command(test, 'spawn 10 local')
    for (let i = 0; i < 3; i++) step(test)
    command(test, 'turn')
    for (let i = 0; i < 3; i++) step(test)
    command(test, 'check')
    expect([...step(test), ...ask(test, 'vehicles')]).toEqual([
      'server [script:srv] check\tfalse\tvec3(0.000000, 0.000000, 0.000000)',
      // SetEntityHeading waits for a networked vehicle, which never comes.
      '[script:run0] [257]\t90.0',
    ])
  })

  it('take natives that run on them before clients created them, which clients run once they did', async () => {
    const test = await session(
      `RegisterCommand('spawn', function()
    local vehicle = CreateVehicle(GetHashKey('adder'), 10.0, 20.0, 1.0, 90.0, true, true)
    print('before', GetEntityCoords(vehicle))
    SetEntityCoords(vehicle, 1.0, 2.0, 3.0, false, false, false, false)
    SetEntityHeading(vehicle, 45.0)
    print('pending', GetEntityCoords(vehicle))
    CreateThread(function()
        while not DoesEntityExist(vehicle) do Wait(0) end
        print('exists', GetEntityCoords(vehicle), GetEntityHeading(vehicle))
    end)
end, false)`,
    )
    command(test, 'spawn')
    const lines: string[] = []
    for (let i = 0; i < 4; i++) lines.push(...step(test))
    expect(lines).toEqual([
      // The client moved and turned the vehicle as it created it, before it synced it.
      'server [script:srv] before\tvec3(0.000000, 0.000000, 0.000000)',
      'server [script:srv] pending\tvec3(1.000000, 2.000000, 3.000000)',
      'server [script:srv] exists\tvec3(0.989011, 1.991209, 2.994141)\t44.964492797852',
    ])
  })

  it('wait for the models that they are given, which those of 0 never are', async () => {
    const test = await session(
      `RegisterCommand('spawn', function()
    local vehicle = CreateVehicle(0, 10.0, 20.0, 1.0, 90.0, true, true)
    SetTimeout(100, function() print('waited', DoesEntityExist(vehicle)) end)
end, false)`,
      `RegisterCommand('vehicles', function() print(json.encode(GetGamePool('CVehicle'))) end, false)`,
    )
    command(test, 'spawn')
    const lines: string[] = []
    for (let i = 0; i < 12; i++) lines.push(...step(test))
    expect([...lines, ...ask(test, 'vehicles'), ...test.client.diagnostics]).toEqual([
      'server [script:srv] waited\tfalse',
      '[script:run0] []',
    ])
  })

  it('go away as entityCreating cancels them', async () => {
    const test = await session(
      `AddEventHandler('entityCreating', function() CancelEvent() end)
RegisterCommand('spawn', function()
    local vehicle = CreateVehicle(GetHashKey('adder'), 10.0, 20.0, 1.0, 90.0, true, true)
    SetTimeout(100, function() print('gone', DoesEntityExist(vehicle)) end)
end, false)`,
    )
    command(test, 'spawn')
    const lines: string[] = []
    for (let i = 0; i < 12; i++) lines.push(...step(test))
    expect(lines).toEqual(['server [script:srv] gone\tfalse'])
  })

  it('are created by the first clients whose players have peds when they take no position, or by all of them', async () => {
    const test = await session(
      `local vehicle = CreateVehicleServerSetter('adder', 'automobile', 10.0, 0.0, 1.0, 0.0)
RegisterCommand('ped', function() print('ped', CreatePedInsideVehicle(vehicle, 4, GetHashKey('mp_m_freemode_01'), -1, true, true)) end, false)`,
    )
    command(test, 'ped')
    for (let i = 0; i < 3; i++) step(test)
    // Bob joins and starts srv, but the server, which does not tick meanwhile, knows no ped of his.
    const bob = await createProcess({ side: 'client' })
    join(test.session, bob.manager, { name: 'Bob' })
    bob.tickAt(10)
    bob.tickAt(20)
    test.player.quit()
    command(test, 'ped')
    // The model loads first.
    bob.tickAt(30)
    bob.tickAt(40)
    expect([test.client.diagnostics, bob.diagnostics]).toEqual([
      [
        'srv: CreatePedInsideVehicle is not implemented in FiveRunner yet: it does nothing and returns zero values.',
      ],
      [
        'srv: CreatePedInsideVehicle is not implemented in FiveRunner yet: it does nothing and returns zero values.',
      ],
    ])
  })

  it('are created by no client for servers with no player that joined, or without OneSync', async () => {
    const lines: string[] = []
    for (const oneSync of [true, false]) {
      const server = await createProcess({ oneSync })
      server
        .add('srv', {
          'main.lua': `RegisterCommand('create', function()
    local model = GetHashKey('mp_m_freemode_01')
    print(CreateVehicle(GetHashKey('adder'), 0.0, 0.0, 0.0, 0.0, true, true), CreateVehicle(GetHashKey('adder'), 0.0, 0.0, 0.0, 0.0, true, true))
    local vehicle = CreateVehicleServerSetter('adder', 'automobile', 0.0, 0.0, 0.0, 0.0)
    print(CreatePedInsideVehicle(vehicle, 4, model, -1, true, true), CreatePedInsideVehicle(0x20000 + 999, 4, model, -1, true, true))
end, false)`,
        })
        .start()
      server.manager.console.commands.invoke('create', '')
      // Ann connects, which gives her no slot yet.
      const session = new Session(server.manager)
      session.connect((await createProcess({ side: 'client' })).manager, { name: 'Ann' })
      server.manager.console.commands.invoke('create', '')
      lines.push(
        ...server.take().filter((line) => line.includes('[script:')),
        ...server.diagnostics,
      )
    }
    expect(lines).toEqual([
      // With no session, CreatePedInsideVehicle has no client to send to, but gives a handle, as with players that have no ped.
      '[script:srv] 0\t0',
      '[script:srv] 131329\t0',
      // Ann, who connects, has no slot.
      '[script:srv] 0\t0',
      '[script:srv] 131841\t0',
      // Without OneSync, the server says once of each that it has no handler for it.
      '[script:srv] 0\t0',
      '[script:srv] 0\t0',
      '[script:srv] 0\t0',
      '[script:srv] 0\t0',
      "srv: CreateVehicle is one of the natives that FiveM's server has clients run, which it does with OneSync alone: without it, FiveM's server has no handler for it, so it does nothing.",
      "srv: CreatePedInsideVehicle is one of the natives that FiveM's server has clients run, which it does with OneSync alone: without it, FiveM's server has no handler for it, so it does nothing.",
    ])
  })
})

describe('GetEntityCoords on servers with OneSync', () => {
  it('fails for the net ids of players, which give no entity, but gives 0, 0, 0 for others that are no entity', async () => {
    const test = await session(
      `RegisterCommand('coords', function(_, args) print(pcall(GetEntityCoords, tonumber(args[1]))) end, false)`,
    )
    command(test, 'coords 1')
    command(test, 'coords 99')
    command(test, 'coords 200000')
    expect(step(test)).toEqual([
      // FiveM's server takes 1 for the net id of a player, whose ped it then looks for by 1 as a handle.
      'server [script:srv] false\tnative 000000001647f1cb: Tried to access invalid entity: 1',
      'server [script:srv] true\tvec3(0.000000, 0.000000, 0.000000)',
      'server [script:srv] true\tvec3(0.000000, 0.000000, 0.000000)',
    ])
  })

  it('is the native of entities that it is without OneSync', async () => {
    const server = await createProcess({ oneSync: false })
    server.add('srv', { 'main.lua': 'print(pcall(GetEntityCoords, 200000))' }).start()
    expect(server.take().filter((line) => line.includes('[script:'))).toEqual([
      '[script:srv] false\tnative 000000001647f1cb: Tried to access invalid entity: 200000',
    ])
  })
})
