import { describe, expect, it } from 'vitest'

import type { NativeContext } from '../../src/core/engine/context.ts'
import { RPC_NATIVES } from '../../src/core/engine/rpc.ts'
import {
  defineNative,
  luaName,
  NativeError,
  type NativeDefinition,
} from '../../src/core/natives/index.ts'
import { clientOf, createProcess, type TestClient } from './helpers.ts'

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
