import { describe, expect, it } from 'vitest'

import { pack } from '../../src/core/engine/msgpack.ts'
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
async function session(server: string, client = '') {
  const test = await clientOf()
  test.server.add('srv', { 'main.lua': server }).start()
  test.server.take()
  test.run(client)
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

/** Lua of servers with a vehicle of their own, whose fuel commands set and read. */
const SERVER = `local vehicle = CreateVehicleServerSetter('adder', 'automobile', 10.0, 0.0, 1.0, 0.0)
RegisterCommand('fuel', function(_, args) Entity(vehicle).state.fuel = tonumber(args[1]) end, false)
RegisterCommand('read', function() print('fuel', Entity(vehicle).state.fuel, json.encode(GetStateBagKeys('entity:65534'))) end, false)
RegisterCommand('keys', function() print('keys', json.encode(GetStateBagKeys('entity:65534'))) end, false)
RegisterCommand('delete', function() DeleteEntity(vehicle) end, false)`

/** Lua of clients that read and set the fuel of the vehicle of their server, and walk their peds along x. */
const CLIENT = `RegisterCommand('fuel', function(_, args)
    local vehicle = NetworkGetEntityFromNetworkId(65534)
    if args[1] then Entity(vehicle).state:set('fuel', tonumber(args[1]), true) end
    print('fuel', DoesEntityExist(vehicle), Entity(vehicle).state.fuel, json.encode(GetStateBagKeys('entity:65534')))
end, false)
RegisterCommand('walk', function(_, args) SetEntityCoords(PlayerPedId(), tonumber(args[1]) + 0.0, 0.0, 1.0, false, false, false, false) end, false)`

describe('State bags of entities', () => {
  it('reach the clients that have the entities, as the servers set them', async () => {
    const test = await session(SERVER, CLIENT)
    command(test, 'fuel 50')
    const before = ask(test, 'fuel')
    step(test)
    command(test, 'read')
    expect([...before, ...ask(test, 'fuel'), ...step(test)]).toEqual([
      // The client takes what the server set at its next tick.
      '[script:run0] fuel\t1\tnil\t[]',
      '[script:run0] fuel\t1\t50\t["fuel"]',
      'server [script:srv] fuel\t50\t["fuel"]',
    ])
  })

  it('reach the clients that come to have the entities with all of their keys, a tick after the entities, and none that have them no more', async () => {
    const test = await session(SERVER, CLIENT)
    command(test, 'fuel 10')
    step(test)
    const near = ask(test, 'fuel')
    test.client.manager.console.commands.invoke('walk 1000', '')
    for (let i = 0; i < 3; i++) step(test)
    command(test, 'fuel 50')
    step(test)
    const away = ask(test, 'fuel')
    test.client.manager.console.commands.invoke('walk 0', '')
    step(test)
    step(test)
    const created = ask(test, 'fuel')
    step(test)
    expect([...near, ...away, ...created, ...ask(test, 'fuel')]).toEqual([
      '[script:run0] fuel\t1\t10\t["fuel"]',
      '[script:run0] fuel\tfalse\tnil\t[]',
      // The client gets the keys the tick after it gets the vehicle.
      '[script:run0] fuel\t1\tnil\t[]',
      '[script:run0] fuel\t1\t50\t["fuel"]',
    ])
  })

  it('of entities that clients create go to their servers once they took the entities, with the first value of each key until then', async () => {
    const test = await session(
      `RegisterCommand('read', function() print('fuel', Entity(NetworkGetEntityFromNetworkId(2)).state.fuel) end, false)`,
      `local adder = GetHashKey('adder')
RequestModel(adder)
local vehicle
RegisterCommand('create', function()
    vehicle = CreateVehicle(adder, 5.0, 0.0, 1.0, 0.0, true, false)
    Entity(vehicle).state:set('fuel', 50, true)
    Entity(vehicle).state:set('fuel', 60, true)
    print('created', NetworkGetNetworkIdFromEntity(vehicle), Entity(vehicle).state.fuel)
end, false)
RegisterCommand('refuel', function() Entity(vehicle).state:set('fuel', 70, true) end, false)`,
    )
    const lines = ask(test, 'create')
    for (let i = 0; i < 4; i++) lines.push(...step(test))
    command(test, 'read')
    lines.push(...step(test))
    test.client.manager.console.commands.invoke('refuel', '')
    step(test)
    command(test, 'read')
    expect([...lines, ...step(test)]).toEqual([
      '[script:run0] created\t2\t60',
      // FiveM's client held back 50, then sent it once the server took the vehicle, and 70 at once.
      'server [script:srv] fuel\t50',
      'server [script:srv] fuel\t70',
    ])
  })

  it('take keys from the clients that own the entities alone', async () => {
    const test = await session(SERVER, CLIENT)
    const bob = await createProcess({ side: 'client' })
    join(test.session, bob.manager, { name: 'Bob' })
    bob.add('bob', { 'main.lua': CLIENT }).start()
    const tick = () => {
      step(test)
      bob.tickAt(test.client.time)
    }
    for (let i = 0; i < 3; i++) tick()
    // Ann owns the vehicle, which the server gives a bag.
    command(test, 'read')
    test.server.take()
    bob.manager.console.commands.invoke('fuel 20', '')
    for (let i = 0; i < 2; i++) tick()
    command(test, 'read')
    const fromBob = test.server.take().filter((line) => line.includes('[script:'))
    test.client.manager.console.commands.invoke('fuel 10', '')
    for (let i = 0; i < 2; i++) tick()
    command(test, 'read')
    expect([...fromBob, ...test.server.take().filter((line) => line.includes('[script:'))]).toEqual(
      [
        // Bob, who does not own the vehicle, set nothing on the server.
        '[script:srv] fuel\tnil\t[]',
        '[script:srv] fuel\t10\t["fuel"]',
      ],
    )
  })

  it('go with their entities', async () => {
    const test = await session(SERVER, CLIENT)
    command(test, 'fuel 50')
    step(test)
    command(test, 'delete')
    for (let i = 0; i < 3; i++) step(test)
    command(test, 'keys')
    expect([...ask(test, 'fuel'), ...step(test)]).toEqual([
      // Both sides forgot the bag with the vehicle.
      '[script:run0] fuel\tfalse\tnil\t[]',
      'server [script:srv] keys\t[]',
    ])
  })

  it('of entities that are not networked are bags of the clients alone', async () => {
    const test = await session(
      '',
      `local adder = GetHashKey('adder')
RequestModel(adder)
RegisterCommand('create', function()
    local vehicle = CreateVehicle(adder, 5.0, 0.0, 1.0, 0.0, false, false)
    Entity(vehicle).state:set('fuel', 50, true)
    print('local', Entity(vehicle).state.fuel, json.encode(GetStateBagKeys('localEntity:' .. vehicle)))
    -- There is no entity 12345, which has no bag.
    Entity(12345).state:set('fuel', 50, false)
    print('none', Entity(12345).state.fuel)
    DeleteEntity(vehicle)
    print('deleted', json.encode(GetStateBagKeys('localEntity:' .. vehicle)))
end, false)`,
    )
    expect([...ask(test, 'create'), ...test.client.diagnostics]).toEqual([
      '[script:run0] local\t50\t["fuel"]',
      '[script:run0] none\tnil',
      '[script:run0] deleted\t[]',
    ])
  })

  it('take keys from the clients that come to own the entities, and from no client while none does', async () => {
    const test = await session(
      `local vehicle = CreateVehicleServerSetter('adder', 'automobile', 500.0, 0.0, 1.0, 0.0)
RegisterCommand('read', function() print('fuel', Entity(vehicle).state.fuel) end, false)`,
      CLIENT,
    )
    command(test, 'read')
    test.session.receiveStateBag(test.player, 'entity:65534', 'fuel', pack(5))
    step(test)
    command(test, 'read')
    const unowned = step(test)
    // Ann takes the vehicle as she comes near it.
    test.client.manager.console.commands.invoke('walk 480', '')
    for (let i = 0; i < 3; i++) step(test)
    test.client.manager.console.commands.invoke('fuel 15', '')
    step(test)
    command(test, 'read')
    expect([...unowned, ...step(test)]).toEqual([
      'server [script:srv] fuel\tnil',
      'server [script:srv] fuel\t15',
    ])
  })

  it('take keys from any client while the clients that created them own them, which made them as they set keys', async () => {
    const test = await session(
      `RegisterCommand('read', function() print('fuel', Entity(NetworkGetEntityFromNetworkId(2)).state.fuel) end, false)`,
      `local adder = GetHashKey('adder')
RequestModel(adder)
RegisterCommand('create', function() Entity(CreateVehicle(adder, 5.0, 0.0, 1.0, 0.0, true, false)).state:set('fuel', 50, true) end, false)`,
    )
    const bob = await createProcess({ side: 'client' })
    join(test.session, bob.manager, { name: 'Bob' })
    bob
      .add('bob', {
        'main.lua': `RegisterCommand('fuel', function(_, args) Entity(NetworkGetEntityFromNetworkId(2)).state:set('fuel', tonumber(args[1]), true) end, false)`,
      })
      .start()
    const tick = () => {
      step(test)
      bob.tickAt(test.client.time)
    }
    test.client.manager.console.commands.invoke('create', '')
    for (let i = 0; i < 4; i++) tick()
    // The server asks for the bag, which it has from Ann's key.
    command(test, 'read')
    const first = test.server.take().filter((line) => line.includes('[script:'))
    bob.manager.console.commands.invoke('fuel 30', '')
    tick()
    tick()
    command(test, 'read')
    expect([...first, ...test.server.take().filter((line) => line.includes('[script:'))]).toEqual([
      '[script:srv] fuel\t50',
      '[script:srv] fuel\t30',
    ])
  })

  it('reach no client that joins, but those that have the entities', async () => {
    const test = await session(
      `local vehicle = CreateVehicleServerSetter('adder', 'automobile', 500.0, 0.0, 1.0, 0.0)
Entity(vehicle).state.fuel = 50`,
    )
    const bob = await createProcess({ side: 'client' })
    join(test.session, bob.manager, { name: 'Bob' })
    bob.tickAt(10)
    expect(bob.manager.states.get('entity:65534')).toBeUndefined()
  })

  it('come back on clients that deleted the entities as their servers set keys before they took the deletions', async () => {
    const test = await session(
      `RegisterCommand('fuel', function() Entity(NetworkGetEntityFromNetworkId(2)).state.fuel = 20 end, false)`,
      `local adder = GetHashKey('adder')
RequestModel(adder)
local vehicle
RegisterCommand('create', function() vehicle = CreateVehicle(adder, 5.0, 0.0, 1.0, 0.0, true, false) end, false)
RegisterCommand('delete', function() DeleteEntity(vehicle) end, false)
RegisterCommand('keys', function() print(DoesEntityExist(vehicle), json.encode(GetStateBagKeys('entity:2'))) end, false)`,
    )
    test.client.manager.console.commands.invoke('create', '')
    for (let i = 0; i < 3; i++) step(test)
    test.client.manager.console.commands.invoke('delete', '')
    command(test, 'fuel')
    step(test)
    // FiveM's client creates the bags of entities that its server sends keys of.
    expect(ask(test, 'keys')).toEqual(['[script:run0] false\t["fuel"]'])
  })

  it('are created on servers for keys of clients of the entities that their names give, as std::from_chars reads them', async () => {
    const names = ['xentity:1', 'entity:-65535', 'entity:1x', 'entity:4294967297']
    const test = await session(
      `RegisterCommand('keys', function(_, args) for _, name in ipairs(args) do print(name, json.encode(GetStateBagKeys(name))) end end, false)`,
    )
    for (const name of names) test.session.receiveStateBag(test.player, name, 'a', pack(1))
    step(test)
    command(test, `keys ${names.join(' ')}`)
    // -65535 is 1 in 16 bits, the object id of the ped of Ann, and 4294967297 is out of the range of ints.
    expect(step(test)).toEqual([
      'server [script:srv] xentity:1\t[]',
      'server [script:srv] entity:-65535\t["a"]',
      'server [script:srv] entity:1x\t["a"]',
      'server [script:srv] entity:4294967297\t[]',
    ])
  })
})
