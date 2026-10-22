import { describe, expect, it } from 'vitest'

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

/** A client of a server whose resource `srv` runs `server`, and whose client then runs `client`. */
async function session(server: string, client: string, options: { oneSync?: boolean } = {}) {
  const test = await clientOf(options)
  test.server.add('srv', { 'main.lua': server }).start()
  const lines = test.server.take().filter((line) => line.includes('[script:'))
  lines.push(...test.run(client).map((line) => `client ${line}`))
  return { ...test, lines }
}

/** Lua of clients that loads the model of adder, then runs `code` in a thread. */
function withAdder(code: string): string {
  return `local adder = GetHashKey('adder')
RequestModel(adder)
CreateThread(function()
    while not HasModelLoaded(adder) do Wait(0) end
${code}
end)`
}

describe('Entities that clients network', () => {
  it('are found by servers by their network ids once clients synced them, owned by their clients', async () => {
    const test = await session(
      `RegisterNetEvent('vehicle', function(netId)
    local vehicle = NetworkGetEntityFromNetworkId(netId)
    print(source, netId, vehicle, DoesEntityExist(vehicle), GetEntityModel(vehicle) == GetHashKey('adder'), GetEntityType(vehicle))
    print(GetEntityCoords(vehicle), GetEntityHeading(vehicle), NetworkGetEntityOwner(vehicle), NetworkGetFirstEntityOwner(vehicle), GetEntityPopulationType(vehicle))
end)`,
      withAdder(`local vehicle = CreateVehicle(adder, 100.0, 200.0, 30.0, 45.0, true, false)
    local netId = NetworkGetNetworkIdFromEntity(vehicle)
    print(vehicle, netId, NetworkGetEntityOwner(vehicle), NetworkGetEntityIsNetworked(vehicle))
    Wait(0)
    TriggerServerEvent('vehicle', netId)`),
    )
    expect([...step(test), ...step(test), ...step(test)]).toEqual([
      'client [script:run0] 257\t2\t128\t1',
      // The vehicle is where its client synced it to: in steps of its sector, and turned by a quaternion in 11 bits.
      'server [script:srv] 1\t2\t131329\t1\ttrue\t2',
      'server [script:srv] vec3(99.995605, 199.991211, 29.987549)\t44.964492797852\t1\t1\t7',
    ])
  })

  it('are created on servers with entityCreating, which handlers cancel, then entityCreated', async () => {
    const test = await session(
      `AddEventHandler('entityCreating', function(entity)
    print('creating', entity, GetEntityType(entity))
    if GetEntityType(entity) == 2 then CancelEvent() end
end)
AddEventHandler('entityCreated', function(entity) print('created', entity) end)
AddEventHandler('entityRemoved', function(entity) print('removed', entity) end)`,
      withAdder(`local vehicle = CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, true, false)
    local ped = CreatePed(4, adder, 0.0, 0.0, 0.0, 0.0, true, false)
    print('created', vehicle, ped)
    Wait(0)
    Wait(0)
    print('kept', DoesEntityExist(vehicle), DoesEntityExist(ped))`),
    )
    expect([...step(test), ...step(test), ...step(test), ...step(test)]).toEqual([
      'client [script:run0] created\t257\t513',
      // The ped of the player was created before the resource started.
      'server [script:srv] created\t131073',
      'server [script:srv] creating\t131329\t2',
      'server [script:srv] creating\t131585\t1',
      // entityCreated is queued for the next tick, which removes the vehicle at its end.
      'server [script:srv] created\t131585',
      'server [script:srv] removed\t131329',
      // The client removes the vehicle that the server removed.
      'client [script:run0] kept\tfalse\t1',
    ])
  })

  it('are the peds of players, which servers find with GetPlayerPed, where clients put them', async () => {
    const test = await session(
      `RegisterCommand('ped', function()
    local ped = GetPlayerPed('1')
    print(ped, NetworkGetNetworkIdFromEntity(ped), NetworkGetEntityOwner(ped), GetEntityType(ped), GetEntityModel(ped) == GetHashKey('player_zero'))
    print(GetEntityCoords(ped), GetEntityHeading(ped), GetEntityPopulationType(ped), GetPlayerPed('2'), GetPlayerPed('x'))
end, false)`,
      `print(NetworkGetNetworkIdFromEntity(PlayerPedId()), NetworkGetEntityOwner(PlayerPedId()))
SetEntityCoords(PlayerPedId(), 10.0, 20.0, 30.0, false, false, false, false)
SetEntityHeading(PlayerPedId(), 90.0)`,
    )
    test.server.manager.console.commands.invoke('ped', '')
    const before = test.server.take().filter((line) => line.includes('[script:'))
    step(test)
    test.server.manager.console.commands.invoke('ped', '')
    expect([
      ...test.lines,
      ...before,
      ...test.server.take().filter((line) => line.includes('[script:')),
    ]).toEqual([
      'client 1\t128',
      '[script:srv] 131073\t1\t1\t1\ttrue',
      // 0 is 44 metres into its sector of z, which 12 bits take as 43.99487.
      '[script:srv] vec3(0.000000, 0.000000, -0.005127)\t0.0\t0\t0\t0',
      '[script:srv] 131073\t1\t1\t1\ttrue',
      // The heading of a ped comes in 8 bits, which turn it up to 3 degrees less.
      '[script:srv] vec3(9.995605, 19.991209, 29.987549)\t87.874015808105\t0\t0\t0',
    ])
  })

  it('are peds turned from -180 to 180 degrees, as GTA V keeps their headings', async () => {
    const test = await session(
      `RegisterCommand('heading', function() print(GetEntityHeading(GetPlayerPed('1')), GetEntityRotation(GetPlayerPed('1')).z) end, false)`,
      `RegisterCommand('turn', function(_, args) SetEntityHeading(PlayerPedId(), tonumber(args[1]) + 0.0) end, false)`,
    )
    const headings: string[] = []
    for (const heading of [270, 180, 181]) {
      test.client.manager.console.commands.invoke(`turn ${heading}`, '')
      step(test)
      test.server.manager.console.commands.invoke('heading', '')
      headings.push(...test.server.take().filter((line) => line.includes('[script:')))
    }
    expect(headings).toEqual([
      '[script:srv] 272.1259765625\t-87.874015808105',
      '[script:srv] 178.58268737793\t178.58268737793',
      '[script:srv] 181.41731262207\t-178.58268737793',
    ])
  })

  it('sync the health of peds and of vehicles, and the armour of peds', async () => {
    const test = await session(
      `RegisterNetEvent('vehicle', function(netId)
    local vehicle = NetworkGetEntityFromNetworkId(netId)
    local ped = GetPlayerPed(source)
    print(GetEntityHealth(ped), GetEntityMaxHealth(ped), GetPedArmour(ped))
    print(GetEntityHealth(vehicle), GetEntityMaxHealth(vehicle), GetPedArmour(vehicle))
end)`,
      withAdder(`SetEntityHealth(PlayerPedId(), 150)
    SetPedArmour(PlayerPedId(), 25)
    local vehicle = CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, true, false)
    SetEntityHealth(vehicle, 900)
    Wait(0)
    TriggerServerEvent('vehicle', NetworkGetNetworkIdFromEntity(vehicle))`),
    )
    expect([...step(test), ...step(test), ...step(test)]).toEqual([
      'server [script:srv] 150\t200\t25',
      // Vehicles sync no most health, and have no armour.
      'server [script:srv] 900\t0\t0',
    ])
  })

  it('are removed on servers as their clients delete them, and their object ids are free once servers took it', async () => {
    const test = await session(
      `AddEventHandler('entityRemoved', function(entity) print('removed', entity, NetworkGetNetworkIdFromEntity(entity)) end)
RegisterCommand('find', function(_, args) print('found', NetworkGetEntityFromNetworkId(tonumber(args[1]))) end, false)`,
      withAdder(`local vehicle = CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, true, false)
    Wait(0)
    DeleteEntity(vehicle)
    print('deleted', vehicle, DoesEntityExist(vehicle), NetworkDoesNetworkIdExist(2))
    local again = CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, true, false)
    print('again', NetworkGetNetworkIdFromEntity(again))`),
    )
    expect([...step(test), ...step(test), ...step(test)]).toEqual([
      'client [script:run0] deleted\t257\tfalse\tfalse',
      // The object id 2 is not free until the server took the removal.
      'client [script:run0] again\t3',
      'server [script:srv] removed\t131329\t2',
    ])
    test.server.manager.console.commands.invoke('find 2', '')
    expect(test.server.take().filter((line) => line.includes('[script:'))).toEqual([
      '[script:srv] found\t0',
    ])
  })

  it('are removed on clients as scripts of servers delete them', async () => {
    const test = await session(
      `RegisterCommand('delete', function(_, args) DeleteEntity(NetworkGetEntityFromNetworkId(tonumber(args[1]))) end, false)
AddEventHandler('entityRemoved', function(entity) print('removed', entity) end)`,
      withAdder(`local vehicle = CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, true, false)
    RegisterCommand('exists', function() print('exists', DoesEntityExist(vehicle), NetworkDoesNetworkIdExist(2)) end, false)`),
    )
    step(test)
    step(test)
    test.server.manager.console.commands.invoke('delete 2', '')
    expect(step(test)).toEqual(['server [script:srv] removed\t131329'])
    test.client.manager.console.commands.invoke('exists', '')
    expect(test.client.take().filter((line) => line.includes('[script:'))).toEqual([
      '[script:run0] exists\t1\t1',
    ])
    step(test)
    test.client.manager.console.commands.invoke('exists', '')
    expect(test.client.take().filter((line) => line.includes('[script:'))).toEqual([
      '[script:run0] exists\tfalse\tfalse',
    ])
  })

  it('go with the players that drop, as no other client takes them', async () => {
    const test = await session(
      `AddEventHandler('entityRemoved', function(entity) print('removed', entity, GetEntityType(entity)) end)`,
      withAdder(`CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, true, false)`),
    )
    step(test)
    step(test)
    test.player.quit()
    expect(step(test)).toEqual([
      'server [script:srv] removed\t131073\t1',
      'server [script:srv] removed\t131329\t2',
    ])
  })

  it('get object ids as their clients join, and more each time they have few', async () => {
    const test = await session(
      '',
      withAdder(`local ids = {}
    for i = 1, 10 do
        local vehicle = CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, true, false)
        ids[i] = vehicle == 0 and 0 or NetworkGetNetworkIdFromEntity(vehicle)
    end
    print(table.concat(ids, ','))`),
    )
    expect(step(test)).toEqual(['client [script:run0] 2,3,4,5,6,7,8,9,10,0'])
    expect(test.client.diagnostics).toEqual([
      'run0: CreateVehicle was asked to network the entity, but the client has no object id left to network it with, so it created nothing and returned 0: clients get 4 object ids as they join, and 6 more at their next tick each time they have fewer than 4.',
    ])
  })

  it('are known to their scripts by network ids, as natives of the network tell', async () => {
    const test = await session(
      '',
      withAdder(`local vehicle = CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, true, false)
    local ped = CreatePed(4, adder, 0.0, 0.0, 0.0, 0.0, true, false)
    local object = CreateObject(adder, 0.0, 0.0, 0.0, true, false, false)
    local v, p, o = VehToNet(vehicle), PedToNet(ped), ObjToNet(object)
    print(v, p, o, VehToNet(ped), PedToNet(object), ObjToNet(vehicle))
    print(NetToVeh(v), NetToPed(p), NetToObj(o), NetToEnt(v), NetToVeh(p), NetToPed(o), NetToObj(v), NetToEnt(0), NetToEnt(99))
    print(NetworkDoesNetworkIdExist(v), NetworkDoesEntityExistWithNetworkId(p), NetworkDoesNetworkIdExist(99), NetworkDoesNetworkIdExist(0))
    print(NetworkGetEntityFromNetworkId(o), NetworkGetEntityFromNetworkId(1) == PlayerPedId(), NetworkGetEntityFromNetworkId(99))
    print(NetworkHasControlOfEntity(vehicle), NetworkRequestControlOfEntity(vehicle), NetworkHasControlOfNetworkId(v), NetworkRequestControlOfNetworkId(v), NetworkHasControlOfEntity(0))`),
    )
    expect(step(test)).toEqual([
      'client [script:run0] 2\t3\t4\t0\t0\t0',
      'client [script:run0] 257\t513\t769\t257\t0\t0\t0\t0\t0',
      'client [script:run0] 1\t1\tfalse\tfalse',
      'client [script:run0] 769\ttrue\t0',
      'client [script:run0] 1\t1\t1\t1\tfalse',
    ])
  })

  it('have no network ids until scripts network them', async () => {
    const test = await session(
      `RegisterCommand('find', function(_, args) print('found', DoesEntityExist(NetworkGetEntityFromNetworkId(tonumber(args[1])))) end, false)`,
      withAdder(`local vehicle = CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, false, false)
    print(NetworkGetNetworkIdFromEntity(vehicle), NetworkGetEntityIsNetworked(vehicle), NetworkGetEntityOwner(vehicle))
    NetworkRegisterEntityAsNetworked(vehicle)
    NetworkRegisterEntityAsNetworked(vehicle)
    print(NetworkGetNetworkIdFromEntity(vehicle), NetworkGetEntityIsNetworked(vehicle), NetworkGetEntityOwner(vehicle))`),
    )
    expect(step(test)).toEqual([
      'client [script:run0] 0\tfalse\t-1',
      'client [script:run0] 2\t1\t128',
    ])
    expect(test.client.diagnostics).toEqual([
      'run0: NetworkGetNetworkIdFromEntity was given an entity that is not networked, which has no network id: FiveRunner returns 0.',
    ])
    step(test)
    test.server.manager.console.commands.invoke('find 2', '')
    expect(test.server.take().filter((line) => line.includes('[script:'))).toEqual([
      '[script:srv] found\t1',
    ])
  })

  it('know the resources whose scripts created them on servers too', async () => {
    const test = await clientOf()
    test.server
      .add('shared', {
        'fxmanifest.lua': `fx_version 'cerulean'\ngame 'gta5'\nclient_script 'client.lua'\nserver_script 'server.lua'`,
        'client.lua': withAdder(
          `TriggerServerEvent('made', NetworkGetNetworkIdFromEntity(CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, true, false)))`,
        ),
        'server.lua': `RegisterNetEvent('made', function(netId)
    SetTimeout(0, function() print('script', GetEntityScript(NetworkGetEntityFromNetworkId(netId))) end)
end)`,
      })
      .start()
    const lines: string[] = []
    for (let i = 0; i < 6; i++) lines.push(...step(test))
    expect(lines).toEqual(['server [script:shared] script\tshared'])
  })
})

describe('Entities of clients without OneSync', () => {
  it('are not networked, and servers know nothing of them', async () => {
    const test = await session(
      `RegisterCommand('ped', function() print(GetPlayerPed('1')) end, false)`,
      withAdder(`local vehicle = CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, true, false)
    print(vehicle, NetworkGetEntityIsNetworked(vehicle), NetworkGetEntityOwner(vehicle), NetworkGetEntityIsNetworked(PlayerPedId()))`),
      { oneSync: false },
    )
    expect(step(test)).toEqual(['client [script:run0] 257\tfalse\t-1\tfalse'])
    test.server.manager.console.commands.invoke('ped', '')
    expect(test.server.take().filter((line) => line.includes('[script:'))).toEqual([
      '[script:srv] 0',
    ])
  })
})

describe('The sync of clients', () => {
  it('frees the object ids of networked entities once servers took their removal', async () => {
    const test = await session(
      '',
      withAdder(`local first = CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, true, false)
    Wait(0)
    DeleteEntity(first)
    Wait(0)
    local ids = {}
    for i = 1, 9 do ids[i] = NetworkGetNetworkIdFromEntity(CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, true, false)) end
    print(table.concat(ids, ','))`),
    )
    // The object id 2 comes back after the others.
    expect([...step(test), ...step(test), ...step(test)]).toEqual([
      'client [script:run0] 3,4,5,6,7,8,9,10,2',
    ])
  })

  it('takes nothing of clients that dropped before their servers took what they synced', async () => {
    const test = await session(
      `RegisterCommand('find', function() print('found', NetworkGetEntityFromNetworkId(2)) end, false)`,
      withAdder(`CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, true, false)`),
    )
    test.client.tickAt(test.client.time + 10)
    test.player.quit()
    test.server.tickAt(test.server.time + 10)
    test.server.tickAt(test.server.time + 10)
    test.server.manager.console.commands.invoke('find', '')
    expect(test.server.take().filter((line) => line.includes('[script:'))).toEqual([
      '[script:srv] found\t0',
    ])
  })

  it('gives clients that joined another session nothing more of the one they left', async () => {
    const { client, player } = await clientOf()
    // The first server handed the client object ids, which the client takes at its next tick, after it left.
    player.quit()
    const other = await createProcess()
    join(new Session(other.manager), client.manager, { name: 'Ann' })
    client.tickAt(10)
    client
      .add('after', {
        'main.lua': withAdder(
          `print(NetworkGetNetworkIdFromEntity(PlayerPedId()), NetworkGetNetworkIdFromEntity(CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, true, false)))`,
        ),
      })
      .start()
    client.tickAt(20)
    expect(client.take().filter((line) => line.includes('[script:'))).toEqual([
      '[script:after] 1\t2',
    ])
  })
})

describe('Owners of the entities of clients', () => {
  it('are the clients that created them, until they drop', async () => {
    const test = await session(
      `AddEventHandler('playerDropped', function()
    local vehicle = NetworkGetEntityFromNetworkId(12)
    print('dropping', NetworkGetEntityOwner(vehicle), NetworkGetFirstEntityOwner(vehicle))
end)
RegisterCommand('owners', function()
    local vehicle = NetworkGetEntityFromNetworkId(12)
    print('owners', DoesEntityExist(vehicle), NetworkGetEntityOwner(vehicle), NetworkGetFirstEntityOwner(vehicle))
end, false)`,
      '',
    )
    const bob = await createProcess({ side: 'client' })
    const player = join(test.session, bob.manager, { name: 'Bob' })
    bob.tickAt(10)
    bob
      .add('bob', {
        'main.lua': withAdder(
          `print(NetworkGetNetworkIdFromEntity(CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, true, false)))`,
        ),
      })
      .start()
    bob.tickAt(20)
    test.server.tickAt(20)
    test.server.manager.console.commands.invoke('owners', '')
    player.quit()
    test.server.manager.console.commands.invoke('owners', '')
    expect(
      [...bob.take(), ...test.server.take()].filter((line) => line.includes('[script:')),
    ).toEqual([
      '[script:bob] 12',
      '[script:srv] owners\t1\t2\t2',
      // The server lets go of the entities of players once they dropped.
      '[script:srv] dropping\t2\t2',
      '[script:srv] owners\t1\t-1\t-1',
    ])
  })
})

/** What scripts printed on a process since it was last asked. */
function printed(process: TestClient['client']): string[] {
  return process.take().filter((line) => line.includes('[script:'))
}

/** A second client, Bob, that joined the session of a test, which has run a tick. */
async function bobOf(test: TestClient) {
  const bob = await createProcess({ side: 'client' })
  const player = join(test.session, bob.manager, { name: 'Bob' })
  bob.tickAt(test.client.time)
  test.server.tickAt(test.server.time + 10)
  return { bob, player }
}

describe('Entities that servers sync to clients', () => {
  it('are those near the peds of their players, which the first of them owns if no client does', async () => {
    const test = await session(
      `local near = CreateVehicleServerSetter('adder', 'automobile', 10.5, 0.0, 1.0, 90.0)
local far = CreateVehicleServerSetter('adder', 'automobile', 500.0, 0.0, 1.0, 0.0)
RegisterCommand('owners', function() print('owners', NetworkGetEntityOwner(near), NetworkGetEntityOwner(far)) end, false)`,
      `RegisterCommand('clones', function()
    local near, far = NetworkGetEntityFromNetworkId(65534), NetworkGetEntityFromNetworkId(65533)
    print(near, DoesEntityExist(near), GetEntityModel(near) == GetHashKey('adder'), GetEntityCoords(near), GetEntityHeading(near))
    print(IsEntityAVehicle(near), NetworkGetEntityOwner(near), NetworkHasControlOfEntity(near), IsEntityAMissionEntity(near), far)
end, false)`,
    )
    step(test)
    step(test)
    test.client.manager.console.commands.invoke('clones', '')
    test.server.manager.console.commands.invoke('owners', '')
    expect([...printed(test.client), ...printed(test.server)]).toEqual([
      // The server created the vehicle where it was told, and turned it by a quaternion in 11 bits.
      '[script:run0] 257\t1\ttrue\tvec3(10.500000, 0.000000, 1.000000)\t90.000015258789',
      '[script:run0] 1\t128\t1\tfalse\t0',
      '[script:srv] owners\t1\t-1',
    ])
  })

  it('are synced back by the clients that they were handed to', async () => {
    const test = await session(
      `local vehicle = CreateVehicleServerSetter('adder', 'automobile', 10.0, 0.0, 1.0, 0.0)
RegisterCommand('where', function() print('where', GetEntityCoords(vehicle)) end, false)`,
      `RegisterCommand('move', function() SetEntityCoords(NetworkGetEntityFromNetworkId(65534), 20.0, 30.0, 2.0, false, false, false, false) end, false)`,
    )
    step(test)
    step(test)
    test.client.manager.console.commands.invoke('move', '')
    step(test)
    test.server.manager.console.commands.invoke('where', '')
    expect(printed(test.server)).toEqual([
      // 30 / 54 * 4095 is 2275, on a step.
      '[script:srv] where\tvec3(19.991209, 30.000002, 2.000000)',
    ])
  })

  it('come and go as the peds of players come near them and go away', async () => {
    const test = await session(
      `CreateVehicleServerSetter('adder', 'automobile', 450.0, 0.0, 1.0, 0.0)`,
      `RegisterCommand('walk', function(_, args) SetEntityCoords(PlayerPedId(), tonumber(args[1]) + 0.0, 0.0, 1.0, false, false, false, false) end, false)
RegisterCommand('near', function() print('near', NetworkDoesNetworkIdExist(65534)) end, false)`,
    )
    const near = () => {
      test.client.manager.console.commands.invoke('near', '')
      return printed(test.client)
    }
    step(test)
    step(test)
    const away = near()
    test.client.manager.console.commands.invoke('walk 30', '')
    step(test)
    step(test)
    const came = near()
    test.client.manager.console.commands.invoke('walk -30', '')
    step(test)
    step(test)
    // 480 metres away, on the ground.
    expect([...away, ...came, ...near()]).toEqual([
      '[script:run0] near\tfalse',
      '[script:run0] near\t1',
      '[script:run0] near\tfalse',
    ])
  })

  it('are within 424 metres of the peds of players, on the ground', async () => {
    const test = await session(
      `CreateVehicleServerSetter('adder', 'automobile', 0.0, 423.9, 300.0, 0.0)
CreateVehicleServerSetter('adder', 'automobile', 0.0, -424.0, 0.0, 0.0)`,
      `RegisterCommand('near', function() print('near', NetworkDoesNetworkIdExist(65534), NetworkDoesNetworkIdExist(65533)) end, false)`,
    )
    step(test)
    step(test)
    test.client.manager.console.commands.invoke('near', '')
    expect(printed(test.client)).toEqual(['[script:run0] near\t1\tfalse'])
  })

  it('are clones that the clients that own them move, which others do not control', async () => {
    const test = await session(
      '',
      withAdder(`local vehicle = CreateVehicle(adder, 5.0, 0.0, 1.0, 0.0, true, false)
    RegisterCommand('move', function() SetEntityCoords(vehicle, 6.0, 1.0, 2.0, false, false, false, false) end, false)`),
    )
    const { bob } = await bobOf(test)
    bob
      .add('bob', {
        'fxmanifest.lua': `fx_version 'cerulean'\ngame 'gta5'\nclient_script 'main.lua'`,
        'main.lua': `RegisterCommand('clone', function()
    local vehicle = NetworkGetEntityFromNetworkId(2)
    print(vehicle, GetEntityCoords(vehicle), NetworkGetEntityOwner(vehicle), NetworkHasControlOfEntity(vehicle), NetworkRequestControlOfEntity(vehicle), NetworkHasControlOfNetworkId(2), NetworkRequestControlOfNetworkId(2))
    print(DeleteEntity(vehicle), DoesEntityExist(vehicle))
end, false)`,
      })
      .start()
    for (let i = 0; i < 3; i++) {
      step(test)
      bob.tickAt(test.client.time)
    }
    bob.manager.console.commands.invoke('clone', '')
    test.client.manager.console.commands.invoke('move', '')
    for (let i = 0; i < 2; i++) {
      step(test)
      bob.tickAt(test.client.time)
    }
    bob.manager.console.commands.invoke('clone', '')
    expect(printed(bob)).toEqual([
      // Ann synced the vehicle at 5, 0, 1 in steps of its sector, and her ped took the handle before it.
      // Bob has Ann in scope, at 127.
      '[script:bob] 513\tvec3(4.997802, 0.000000, 0.989014)\t127\tfalse\tfalse\tfalse\tfalse',
      '[script:bob] 513\t1',
      '[script:bob] 513\tvec3(6.000000, 0.989011, 2.000000)\t127\tfalse\tfalse\tfalse\tfalse',
      '[script:bob] 513\t1',
    ])
    expect(bob.diagnostics).toEqual([
      'bob: DeleteEntity was given an entity that another client owns, which GTA V does not delete until it has control of it.',
      'bob: DeleteEntity was given an entity that another client owns, which GTA V does not delete until it has control of it.',
    ])
  })

  it('are removed on clients that know of them as servers delete them', async () => {
    const test = await session(
      `local vehicle = CreateVehicleServerSetter('adder', 'automobile', 10.0, 0.0, 1.0, 0.0)
RegisterCommand('delete', function() DeleteEntity(vehicle) end, false)`,
      `RegisterCommand('near', function() print('near', NetworkDoesNetworkIdExist(65534)) end, false)`,
    )
    step(test)
    test.server.manager.console.commands.invoke('delete', '')
    step(test)
    step(test)
    test.client.manager.console.commands.invoke('near', '')
    expect(printed(test.client)).toEqual(['[script:run0] near\tfalse'])
  })
})

/** Lua of clients that tells of the players that come into their scopes and leave them, and walks their peds along x. */
const SCOPES = `RegisterNetEvent('onPlayerJoining', function(serverId, name, slot)
    print('joining', source, serverId, name, slot, GetPlayerServerId(slot), GetPlayerName(slot), GetPlayerPed(slot), GetPlayerFromServerId(serverId))
end)
RegisterNetEvent('onPlayerDropped', function(serverId, name, slot)
    print('dropped', source, serverId, name, slot, GetPlayerServerId(slot), GetPlayerName(slot), GetPlayerPed(slot), GetPlayerFromServerId(serverId))
end)
RegisterCommand('players', function()
    local ped = GetPlayerPed(127)
    print(json.encode(GetActivePlayers()), GetNumberOfPlayers(), NetworkIsPlayerActive(127), IsPlayerPlaying(127), IsPedAPlayer(ped), NetworkGetPlayerIndexFromPed(ped), GetPlayerServerId(127 + 256), #GetGamePool('CPed'))
    print(GetEntityCoords(ped), NetworkGetEntityOwner(ped), NetworkHasControlOfEntity(ped), GetPlayerFromStateBagName('player:' .. GetPlayerServerId(127)))
end, false)
RegisterCommand('walk', function(_, args) SetEntityCoords(PlayerPedId(), tonumber(args[1]) + 0.0, 0.0, 1.0, false, false, false, false) end, false)
RegisterCommand('sethp', function(_, args) LocalPlayer.state:set('hp', tonumber(args[1]), true) end, false)
RegisterCommand('hp', function(_, args) print('hp', Player(tonumber(args[1])).state.hp) end, false)
RegisterCommand('mark', function(_, args)
    local state = Player(tonumber(args[1])).state
    state:set('seen', true, false)
    print('seen', state.seen)
end, false)
RegisterCommand('owner', function(_, args)
    local entity = NetworkGetEntityFromNetworkId(tonumber(args[1]))
    print('owner', DoesEntityExist(entity), NetworkGetEntityOwner(entity), NetworkGetPlayerIndexFromPed(entity), IsPedAPlayer(entity))
end, false)`

/** A test whose server tells of the players that come into scopes and leave them, and whose client Ann and second client Bob run SCOPES. */
async function scopes() {
  const test = await session(
    `AddEventHandler('playerEnteredScope', function(data) print('entered', data.player, data['for']) end)
AddEventHandler('playerLeftScope', function(data) print('left', data.player, data['for']) end)`,
    SCOPES,
  )
  const { bob, player } = await bobOf(test)
  bob
    .add('bob', {
      'fxmanifest.lua': `fx_version 'cerulean'\ngame 'gta5'\nclient_script 'main.lua'`,
      'main.lua': SCOPES,
    })
    .start()
  /** Ticks Ann, the server and Bob, and returns what their scripts printed, marked with whose they are. */
  const tick = () => {
    const lines = step(test)
    bob.tickAt(test.client.time)
    return [...lines, ...printed(bob).map((line) => `bob ${line}`)]
  }
  return { ...test, bob, bobPlayer: player, tick }
}

describe('Players near each other', () => {
  it('come into the scopes of each other, which their clients and servers are told of', async () => {
    const test = await scopes()
    const lines = [...test.tick(), ...test.tick(), ...test.tick()]
    test.client.manager.console.commands.invoke('players', '')
    test.bob.manager.console.commands.invoke('players', '')
    // Ann has the bag of Bob, though he set no key of it.
    test.client.manager.console.commands.invoke('mark 2', '')
    expect([...lines, ...printed(test.client), ...printed(test.bob)]).toEqual([
      // Each knows the other at 127, and the ped of the other by the handle after that of its own.
      'client [script:run0] joining\t65535\t2\tBob\t127\t2\tBob\t257\t127',
      'server [script:srv] entered\t2\t1',
      'server [script:srv] entered\t1\t2',
      'bob [script:bob] joining\t65535\t1\tAnn\t127\t1\tAnn\t257\t127',
      '[script:run0] [127,128]\t2\t1\t1\t1\t127\t2\t2',
      // The ped of Bob is at 0, 0, 0 on the steps of its sector.
      '[script:run0] vec3(0.000000, 0.000000, -0.005127)\t127\tfalse\t127',
      '[script:run0] seen\ttrue',
      '[script:bob] [127,128]\t2\t1\t1\t1\t127\t1\t2',
      '[script:bob] vec3(0.000000, 0.000000, -0.005127)\t127\tfalse\t127',
    ])
  })

  it('leave the scopes of each other as they go away, and come back into them', async () => {
    const test = await scopes()
    for (let i = 0; i < 3; i++) test.tick()
    test.bob.manager.console.commands.invoke('walk 500', '')
    const away = [...test.tick(), ...test.tick(), ...test.tick()]
    test.client.manager.console.commands.invoke('players', '')
    const players = printed(test.client)
    test.bob.manager.console.commands.invoke('walk 0', '')
    expect([...away, ...players, ...test.tick(), ...test.tick(), ...test.tick()]).toEqual([
      'server [script:srv] left\t2\t1',
      'server [script:srv] left\t1\t2',
      // Clients know the players that left their scopes no more as they are told of it.
      'bob [script:bob] dropped\t65535\t1\tAnn\t127\t0\t**Invalid**\t0\t-1',
      'client [script:run0] dropped\t65535\t2\tBob\t127\t0\t**Invalid**\t0\t-1',
      '[script:run0] [128]\t1\tfalse\tfalse\tfalse\t-1\t0\t1',
      '[script:run0] vec3(0.000000, 0.000000, 0.000000)\t-1\tfalse\t0',
      'server [script:srv] entered\t2\t1',
      'server [script:srv] entered\t1\t2',
      // The new clones of the peds take the slots of the old ones in the pools, with other handles.
      'bob [script:bob] joining\t65535\t1\tAnn\t127\t1\tAnn\t258\t127',
      'client [script:run0] joining\t65535\t2\tBob\t127\t2\tBob\t258\t127',
    ])
  })

  it('drop out of the scopes of others as they drop', async () => {
    const test = await scopes()
    for (let i = 0; i < 3; i++) test.tick()
    test.bobPlayer.quit()
    // The ped of Bob goes with him, before the server removes it.
    const lines = test.tick()
    test.client.manager.console.commands.invoke('players', '')
    expect([...lines, ...printed(test.client)]).toEqual([
      // The server queues no playerLeftScope for players that drop.
      'client [script:run0] dropped\t65535\t2\tBob\t127\t0\t**Invalid**\t0\t-1',
      '[script:run0] [128]\t1\tfalse\tfalse\tfalse\t-1\t0\t1',
      '[script:run0] vec3(0.000000, 0.000000, 0.000000)\t-1\tfalse\t0',
    ])
  })

  it('have the state bags of each other while they are in scope', async () => {
    const test = await scopes()
    test.bob.manager.console.commands.invoke('sethp 100', '')
    const hp = () => {
      test.client.manager.console.commands.invoke('hp 2', '')
      return printed(test.client)
    }
    const before = hp()
    for (let i = 0; i < 3; i++) test.tick()
    const near = hp()
    test.bob.manager.console.commands.invoke('walk 500', '')
    for (let i = 0; i < 3; i++) test.tick()
    test.bob.manager.console.commands.invoke('sethp 50', '')
    for (let i = 0; i < 3; i++) test.tick()
    const away = hp()
    test.bob.manager.console.commands.invoke('walk 0', '')
    for (let i = 0; i < 3; i++) test.tick()
    expect([...before, ...near, ...away, ...hp()]).toEqual([
      // Ann gets what Bob set while he was away as he comes back.
      '[script:run0] hp\tnil',
      '[script:run0] hp\t100',
      '[script:run0] hp\tnil',
      '[script:run0] hp\t50',
    ])
  })

  it('tell clients that joined another session nothing more of the players of the one they left', async () => {
    const test = await scopes()
    // The server brought Bob into the scope of Ann, which her client takes at its next tick, after it left.
    test.player.quit()
    const other = await createProcess()
    join(new Session(other.manager), test.client.manager, { name: 'Ann' })
    const lines = test.run(SCOPES)
    test.client.tickAt(test.client.time + 10)
    test.client.manager.console.commands.invoke('players', '')
    // The client of Ann knows herself alone in the new session.
    expect([...lines, ...printed(test.client)]).toEqual([
      '[script:run1] joining\t65535\t1\tAnn\t128\t1\tAnn\t1\t128',
      '[script:run1] [128]\t1\tfalse\tfalse\tfalse\t-1\t0\t1',
      '[script:run1] vec3(0.000000, 0.000000, 0.000000)\t-1\tfalse\t0',
    ])
  })

  it('are listed by their indices', async () => {
    const test = await scopes()
    const cid = await createProcess({ side: 'client' })
    join(test.session, cid.manager, { name: 'Cid' })
    for (let i = 0; i < 3; i++) {
      test.tick()
      cid.tickAt(test.client.time)
    }
    test.client.manager.console.commands.invoke('players', '')
    // Bob came first, at 127, then Cid, at 126.
    expect(printed(test.client)).toEqual([
      '[script:run0] [126,127,128]\t3\t1\t1\t1\t127\t2\t3',
      '[script:run0] vec3(0.000000, 0.000000, -0.005127)\t127\tfalse\t127',
    ])
  })

  it('own clones that others know by the slots that they are at, or as 255 out of their scopes', async () => {
    const test = await scopes()
    for (let i = 0; i < 3; i++) test.tick()
    test.run(withAdder(`CreateVehicle(adder, 400.0, 0.0, 1.0, 0.0, true, false)`))
    const owner = () => {
      for (let i = 0; i < 4; i++) test.tick()
      test.bob.manager.console.commands.invoke('owner 2', '')
      return printed(test.bob)
    }
    const near = owner()
    // Bob goes 800 metres away from Ann, and the vehicle is 400 metres from both.
    test.bob.manager.console.commands.invoke('walk 800', '')
    expect([...near, ...owner()]).toEqual([
      '[script:bob] owner\t1\t127\t-1\tfalse',
      '[script:bob] owner\t1\t255\t-1\tfalse',
    ])
  })
})
