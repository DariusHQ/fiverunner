import { describe, expect, it } from 'vitest'

import { clientOf, createProcess, join, runCommand, type TestClient } from './helpers.ts'

/** Ticks the client, then the server, and returns what scripts printed, marked with their sides. */
function step(test: TestClient): string[] {
  test.client.tickAt(test.client.time + 10)
  test.server.tickAt(test.server.time + 10)
  return [
    ...test.client.take().map((line) => `client ${line}`),
    ...test.server.take().map((line) => `server ${line}`),
  ].filter((line) => line.includes('[script:'))
}

/** Runs a command of the server, as its console. */
function command(test: TestClient, line: string): void {
  test.server.manager.console.commands.invoke(line, '')
}

/** Lua of servers that put players and entities in routing buckets, and tell of them. */
const SERVER = `local vehicle = CreateVehicleServerSetter('adder', 'automobile', 10.0, 0.0, 1.0, 0.0)
AddEventHandler('onPlayerBucketChange', function(...) print('player', ...) end)
AddEventHandler('onEntityBucketChange', function(...) print('entity', ...) end)
AddEventHandler('playerEnteredScope', function(data) print('entered', data.player, data['for']) end)
AddEventHandler('playerLeftScope', function(data) print('left', data.player, data['for']) end)
RegisterCommand('player', function(_, args) SetPlayerRoutingBucket(args[1], tonumber(args[2])) end, false)
RegisterCommand('vehicle', function(_, args) SetEntityRoutingBucket(vehicle, tonumber(args[1])) end, false)
RegisterCommand('ped', function(_, args) SetEntityRoutingBucket(GetPlayerPed(args[1]), tonumber(args[2])) end, false)
RegisterCommand('owner', function() print('owner', NetworkGetEntityOwner(NetworkGetEntityFromNetworkId(2))) end, false)
RegisterCommand('lockdown', function(_, args) SetRoutingBucketEntityLockdownMode(tonumber(args[1]), args[2]) end, false)
RegisterCommand('buckets', function()
    print('buckets', GetPlayerRoutingBucket(1), GetPlayerRoutingBucket(2), GetPlayerRoutingBucket(99), GetEntityRoutingBucket(vehicle), GetEntityRoutingBucket(GetPlayerPed(2)), GetEntityRoutingBucket(0))
end, false)`

/** Lua of clients that tell of the vehicle of the server, and of the players they know. */
const CLIENT = `RegisterCommand('know', function()
    print('know', NetworkDoesNetworkIdExist(65534), json.encode(GetActivePlayers()), DoesEntityExist(PlayerPedId()), NetworkDoesNetworkIdExist(2))
end, false)`

/** A test whose server runs SERVER, with Ann and Bob, who run CLIENT, near each other and the vehicle. */
async function twoOf() {
  const test = await clientOf()
  test.server.add('srv', { 'main.lua': SERVER }).start()
  test.run(CLIENT)
  const bob = await createProcess({ side: 'client' })
  join(test.session, bob.manager, { name: 'Bob' })
  bob.add('bob', { 'main.lua': CLIENT }).start()
  /** Ticks Ann, the server and Bob, and returns what their scripts printed, marked with whose they are. */
  const tick = () => {
    const lines = step(test)
    bob.tickAt(test.client.time)
    return [
      ...lines,
      ...bob
        .take()
        .filter((line) => line.includes('[script:'))
        .map((line) => `bob ${line}`),
    ]
  }
  for (let i = 0; i < 4; i++) tick()
  test.server.take()
  /** What Ann and Bob know, marked with whose it is. */
  const know = () => {
    test.client.manager.console.commands.invoke('know', '')
    bob.manager.console.commands.invoke('know', '')
    return [
      ...test.client.take().filter((line) => line.includes('[script:')),
      ...bob
        .take()
        .filter((line) => line.includes('[script:'))
        .map((line) => `bob ${line}`),
    ]
  }
  return { ...test, bob, tick, know }
}

describe('Routing buckets', () => {
  it('keep players from those of other buckets, and from their entities, until they come back', async () => {
    const test = await twoOf()
    const before = test.know()
    command(test, 'player 2 1')
    const moved = [...test.tick(), ...test.tick(), ...test.tick()]
    command(test, 'buckets')
    const apart = [...test.tick(), ...test.know()]
    command(test, 'player 2 0')
    expect([
      ...before,
      ...moved,
      ...apart,
      ...test.tick(),
      ...test.tick(),
      ...test.tick(),
      ...test.know(),
    ]).toEqual([
      '[script:run0] know\t1\t[127,128]\t1\tfalse',
      'bob [script:bob] know\t1\t[127,128]\t1\tfalse',
      'server [script:srv] player\t2\t1\t0',
      // Ann and Bob leave the scopes of each other, and Bob the vehicle, which is in the bucket 0.
      'server [script:srv] left\t2\t1',
      'server [script:srv] left\t1\t2',
      'server [script:srv] buckets\t0\t1\t0\t0\t1\t0',
      '[script:run0] know\t1\t[128]\t1\tfalse',
      'bob [script:bob] know\tfalse\t[128]\t1\tfalse',
      'server [script:srv] player\t2\t0\t1',
      'server [script:srv] entered\t2\t1',
      'server [script:srv] entered\t1\t2',
      '[script:run0] know\t1\t[127,128]\t1\tfalse',
      'bob [script:bob] know\t1\t[127,128]\t1\tfalse',
    ])
  })

  it('have entities that their players see alone, which come with the buckets they go to', async () => {
    const test = await twoOf()
    command(test, 'vehicle 1')
    const moved = [...test.tick(), ...test.tick(), ...test.know()]
    command(test, 'player 2 1')
    command(test, 'vehicle -1')
    command(test, 'buckets')
    expect([...moved, ...test.tick(), ...test.tick(), ...test.tick(), ...test.know()]).toEqual([
      'server [script:srv] entity\t131329\t1\t0',
      '[script:run0] know\tfalse\t[127,128]\t1\tfalse',
      'bob [script:bob] know\tfalse\t[127,128]\t1\tfalse',
      'server [script:srv] player\t2\t1\t0',
      // FiveM's server keeps no bucket below 0, but tells of it.
      'server [script:srv] entity\t131329\t-1\t1',
      'server [script:srv] buckets\t0\t1\t0\t1\t1\t0',
      'server [script:srv] left\t2\t1',
      'server [script:srv] left\t1\t2',
      '[script:run0] know\tfalse\t[128]\t1\tfalse',
      'bob [script:bob] know\t1\t[128]\t1\tfalse',
    ])
  })

  it('take no bucket below 0 for players, and tell of none', async () => {
    const test = await twoOf()
    command(test, 'player 2 -1')
    command(test, 'player 99 1')
    command(test, 'buckets')
    expect(test.tick()).toEqual([
      // 99 is the net id of no player, whose bucket is 0.
      'server [script:srv] buckets\t0\t0\t0\t0\t0\t0',
    ])
  })

  it('keep the entities that clients create in the buckets of the clients, and delete those that their lockdown modes keep them from creating', async () => {
    const test = await twoOf()
    test.server
      .add('watch', {
        'main.lua': `AddEventHandler('entityCreating', function(entity) print('creating', entity, GetEntityRoutingBucket(entity)) end)
AddEventHandler('entityRemoved', function(entity) print('removed', entity) end)`,
      })
      .start()
    test.server.take()
    const spawn = `local adder = GetHashKey('adder')
RequestModel(adder)
RegisterCommand('spawn', function() print('spawned', NetworkGetNetworkIdFromEntity(CreateVehicle(adder, 5.0, 0.0, 1.0, 0.0, true, false))) end, false)`
    test.bob.add('spawn', { 'main.lua': spawn }).start()
    command(test, 'player 2 1')
    command(test, 'lockdown 1 strict')
    for (let i = 0; i < 2; i++) test.tick()
    test.bob.manager.console.commands.invoke('spawn', '')
    const strict = [...test.tick(), ...test.tick(), ...test.tick()]
    command(test, 'lockdown 1 no_dummy')
    test.bob.manager.console.commands.invoke('spawn', '')
    const relaxed = [...test.tick(), ...test.tick(), ...test.tick()]
    // The server has Bob, the nearest, create a vehicle in strict lockdown all the same.
    command(test, 'lockdown 1 strict')
    test.client.manager.world!.playerPed.moveTo(1000, 0, 0)
    test.server
      .add('rpc', {
        'main.lua': `RegisterCommand('rpc', function() CreateVehicle(GetHashKey('adder'), 0.0, 0.0, 1.0, 0.0, true, true) end, false)`,
      })
      .start()
    test.server.take()
    for (let i = 0; i < 3; i++) test.tick()
    command(test, 'rpc')
    expect([
      ...strict,
      ...relaxed,
      ...test.tick(),
      ...test.tick(),
      ...test.tick(),
      ...test.tick(),
    ]).toEqual([
      'bob [script:spawn] spawned\t12',
      // Strict lockdown deletes what Bob created, which entityCreating is not triggered for.
      'server [script:watch] removed\t131841',
      'bob [script:spawn] spawned\t13',
      'server [script:watch] creating\t131842\t1',
      'server [script:watch] creating\t132097\t1',
    ])
  })

  it('take the lockdown mode of sv_entityLockdown when they have none of their own', async () => {
    const test = await twoOf()
    test.server
      .add('watch', {
        'main.lua': `AddEventHandler('entityCreating', function(entity) print('creating', entity) end)`,
      })
      .start()
    test.bob
      .add('spawn', {
        'main.lua': `local adder = GetHashKey('adder')
RequestModel(adder)
RegisterCommand('spawn', function() CreateVehicle(adder, 5.0, 0.0, 1.0, 0.0, true, false) end, false)`,
      })
      .start()
    test.server.take()
    runCommand(test.server.manager, 'set sv_entityLockdown relaxed', 'system.console')
    for (let i = 0; i < 2; i++) test.tick()
    test.bob.manager.console.commands.invoke('spawn', '')
    const relaxed = [...test.tick(), ...test.tick()]
    command(test, 'lockdown 0 inactive')
    test.bob.manager.console.commands.invoke('spawn', '')
    expect([...relaxed, ...test.tick(), ...test.tick()]).toEqual([
      // Relaxed lockdown deletes what scripts of clients create, and the bucket 0 has a mode of its own then.
      'server [script:watch] creating\t131842',
    ])
  })

  it('keep the peds of players with them in other buckets, and from others', async () => {
    const test = await twoOf()
    command(test, 'ped 1 1')
    expect([...test.tick(), ...test.tick(), ...test.tick(), ...test.know()]).toEqual([
      'server [script:srv] entity\t131073\t1\t0',
      // Ann keeps her ped, and Bob in her scope, but she leaves his.
      'server [script:srv] left\t1\t2',
      '[script:run0] know\t1\t[127,128]\t1\tfalse',
      'bob [script:bob] know\t1\t[128]\t1\tfalse',
    ])
  })

  it('hand the entities of players that go to other buckets to those near them in the buckets they left', async () => {
    const test = await twoOf()
    test.run(`local adder = GetHashKey('adder')
RequestModel(adder)
RegisterCommand('spawn', function() CreateVehicle(adder, 5.0, 0.0, 1.0, 0.0, true, false) end, false)`)
    for (let i = 0; i < 2; i++) test.tick()
    test.client.manager.console.commands.invoke('spawn', '')
    for (let i = 0; i < 3; i++) test.tick()
    command(test, 'owner')
    const before = test.tick()
    command(test, 'player 1 1')
    for (let i = 0; i < 4; i++) test.tick()
    command(test, 'owner')
    expect([...before, ...test.tick(), ...test.know()]).toEqual([
      'server [script:srv] owner\t1',
      // Ann leaves the vehicle that her script created, which Bob takes.
      'server [script:srv] owner\t2',
      '[script:run0] know\tfalse\t[128]\t1\tfalse',
      'bob [script:bob] know\t1\t[128]\t1\t1',
    ])
  })

  it('keep from players that go to other buckets what their scripts own in the buckets they left', async () => {
    const test = await clientOf()
    test.server.add('srv', { 'main.lua': SERVER }).start()
    test.run(`${CLIENT}
local adder = GetHashKey('adder')
RequestModel(adder)
RegisterCommand('spawn', function() CreateVehicle(adder, 5.0, 0.0, 1.0, 0.0, true, false) end, false)`)
    for (let i = 0; i < 3; i++) step(test)
    test.client.manager.console.commands.invoke('spawn', '')
    for (let i = 0; i < 3; i++) step(test)
    command(test, 'player 1 1')
    for (let i = 0; i < 3; i++) step(test)
    command(test, 'owner')
    test.client.manager.console.commands.invoke('know', '')
    // Ann owns the vehicle still, which no other client takes.
    expect(step(test)).toEqual([
      'client [script:run0] know\tfalse\t[128]\t1\tfalse',
      'server [script:srv] owner\t1',
    ])
  })

  it('take no lockdown mode that FiveM does not know', async () => {
    const test = await twoOf()
    test.server
      .add('watch', {
        'main.lua': `AddEventHandler('entityCreating', function(entity) print('creating', entity) end)`,
      })
      .start()
    test.bob
      .add('spawn', {
        'main.lua': `local adder = GetHashKey('adder')
RequestModel(adder)
RegisterCommand('spawn', function() CreateVehicle(adder, 5.0, 0.0, 1.0, 0.0, true, false) end, false)`,
      })
      .start()
    test.server.take()
    command(test, 'lockdown 0 bogus')
    for (let i = 0; i < 2; i++) test.tick()
    test.bob.manager.console.commands.invoke('spawn', '')
    expect([...test.tick(), ...test.tick()]).toEqual(['server [script:watch] creating\t131841'])
  })
})
