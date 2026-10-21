import { describe, expect, it } from 'vitest'

import { clientOf, createProcess, type TestProcess } from './helpers.ts'

interface TestServer {
  readonly server: TestProcess
  /** Runs Lua code on the server in a resource named `name`, and returns what it printed as it started. */
  run(code: string, name?: string): string[]
  /** Ticks the server, and returns what scripts printed meanwhile. */
  tick(): string[]
}

async function serverOf(options: { oneSync?: boolean } = {}): Promise<TestServer> {
  const server = await createProcess(options)
  let count = 0
  const scripts = () => server.take().filter((line) => line.startsWith('[script:'))
  return {
    server,
    run(code, name = `run${count++}`) {
      server.add(name, { 'main.lua': code }).start()
      return scripts()
    },
    tick() {
      server.tickAt(server.time + 10)
      return scripts()
    },
  }
}

describe('Entities of servers', () => {
  it('are vehicles that server setters create, where they say and turned as their quaternions say', async () => {
    const { run } = await serverOf()
    expect(
      run(
        `local v = CreateVehicleServerSetter('adder', 'automobile', 100.0, 200.0, 30.0, 90.0)
print(v, NetworkGetNetworkIdFromEntity(v), GetEntityModel(v), GetEntityCoords(v))
print(GetEntityHeading(v), GetEntityRotation(v))
print(GetEntityType(v), GetVehicleType(v), GetNetTypeFromEntity(v), GetEntityPopulationType(v), GetEntityScript(v))`,
        'cars',
      ),
    ).toEqual([
      '[script:cars] 131073\t65534\t-1216765807\tvec3(100.000000, 200.000000, 30.000000)',
      // The quaternion of the heading, in 11 bits, gives a little more than 90 degrees, and some pitch.
      '[script:cars] 90.000015258789\tvec3(0.055976, -0.000000, 90.000015)',
      '[script:cars] 2\tautomobile\t0\t7\tcars',
    ])
  })

  it('are vehicles of the types that server setters name', async () => {
    const { run } = await serverOf()
    const types = ['automobile', 'bike', 'boat', 'heli', 'plane', 'submarine', 'trailer', 'train']
    expect(
      run(`for _, type in ipairs(json.decode('${JSON.stringify(types)}')) do
    local v = CreateVehicleServerSetter('adder', type, 0.0, 0.0, 0.0, 0.0)
    print(GetVehicleType(v), GetNetTypeFromEntity(v), GetEntityType(v))
end`),
    ).toEqual(
      [
        'automobile\t0',
        'bike\t1',
        'boat\t2',
        'heli\t4',
        'plane\t9',
        'submarine\t10',
        'trailer\t12',
        'train\t13',
      ].map((line) => `[script:run0] ${line}\t2`),
    )
  })

  it('fail to be vehicles of other types', async () => {
    const { run } = await serverOf()
    expect(
      run(`print(pcall(CreateVehicleServerSetter, 'adder', 'car', 0.0, 0.0, 0.0, 0.0))
print(pcall(CreateVehicleServerSetter, 'adder', 'Automobile', 0.0, 0.0, 0.0, 0.0))
print(pcall(CreateVehicleServerSetter, 'adder', nil, 0.0, 0.0, 0.0, 0.0))
print(json.encode(GetAllVehicles()))`),
    ).toEqual([
      '[script:run0] false\tnative 000000006ae51d4b: CREATE_VEHICLE_SERVER_SETTER: Invalid entity type car',
      '[script:run0] false\tnative 000000006ae51d4b: CREATE_VEHICLE_SERVER_SETTER: Invalid entity type Automobile',
      '[script:run0] false\tnative 000000006ae51d4b: Argument at index 1 was null.',
      '[script:run0] []',
    ])
  })

  it('are peds that turn by their headings in radians', async () => {
    const { run } = await serverOf()
    expect(
      run(`local p = CreatePed(4, 'mp_m_freemode_01', 1.5, 2.5, 3.5, 90.0, true, false)
print(p, NetworkGetNetworkIdFromEntity(p), GetEntityModel(p) == GetHashKey('mp_m_freemode_01'), GetEntityCoords(p))
print(GetEntityHeading(p), GetEntityRotation(p), GetEntityHeading(CreatePed(4, 0, 0.0, 0.0, 0.0, -90.0, true, false)))
print(GetEntityType(p), GetVehicleType(p), GetNetTypeFromEntity(p), GetEntityPopulationType(p), GetEntityScript(p))
print(GetEntityHeading(CreatePed(4, 0, 0.0, 0.0, 0.0, 10.0, true, false)), GetEntityHeading(CreatePed(4, 0, 0.0, 0.0, 0.0, 77.7, true, false)))`),
    ).toEqual([
      '[script:run0] 131073\t65534\ttrue\tvec3(1.500000, 2.500000, 3.500000)',
      '[script:run0] 90.0\tvec3(0.000000, 0.000000, 90.000000)\t270.0',
      '[script:run0] 1\tnil\t6\t7\trun0',
      // Degrees turn into radians and back in single precision.
      '[script:run0] 9.9999990463257\t77.699989318848',
    ])
  })

  it('are objects that do not turn, and have no population', async () => {
    const { run } = await serverOf()
    expect(
      run(`local o = CreateObjectNoOffset('prop_atm_01', 1.0, 2.0, 3.0, true, false, false)
print(o, GetEntityCoords(o), GetEntityModel(o) == GetHashKey('prop_atm_01'))
print(GetEntityHeading(o), GetEntityRotation(o))
print(GetEntityType(o), GetNetTypeFromEntity(o), GetEntityPopulationType(o), GetEntityScript(o))`),
    ).toEqual([
      '[script:run0] 131073\tvec3(1.000000, 2.000000, 3.000000)\ttrue',
      // The identity quaternion, in 11 bits, is a little turned.
      '[script:run0] 0.039567284286022\tvec3(0.039595, 0.039567, 0.039567)',
      '[script:run0] 3\t5\t0\trun0',
    ])
  })

  it('are where single precision puts them', async () => {
    const { run } = await serverOf()
    expect(
      run(
        `print(GetEntityCoords(CreateVehicleServerSetter('adder', 'automobile', -1.1, 0.1, 30.1, 0.0)))`,
      ),
    ).toEqual(['[script:run0] vec3(-1.099998, 0.100000, 30.099976)'])
  })

  it('are in the pools of their types, in the order they were created', async () => {
    const { run } = await serverOf()
    expect(
      run(`local v = CreateVehicleServerSetter('adder', 'automobile', 0.0, 0.0, 0.0, 0.0)
local p = CreatePed(4, 0, 0.0, 0.0, 0.0, 0.0, true, false)
local o = CreateObjectNoOffset(0, 0.0, 0.0, 0.0, true, false, false)
local w = CreateVehicleServerSetter('adder', 'boat', 0.0, 0.0, 0.0, 0.0)
print(json.encode(GetAllVehicles()), json.encode(GetAllPeds()), json.encode(GetAllObjects()))
print(json.encode(GetGamePool('CVehicle')), json.encode(GetGamePool('CPed')))
print(json.encode(GetGamePool('CObject')), json.encode(GetGamePool('CNetObject')), json.encode(GetGamePool('CPickup')))
print(pcall(GetGamePool))`),
    ).toEqual([
      '[script:run0] [131073,131841]\t[131329]\t[131585]',
      '[script:run0] [131073,131841]\t[131329]',
      '[script:run0] [131585]\t[131585]\t[]',
      '[script:run0] false\tnative 000000002b9d4f50: Argument at index 0 was null.',
    ])
  })

  it('are found by their network ids, in 16 bits, and by the names of their state bags', async () => {
    const { run } = await serverOf()
    expect(
      run(`local v = CreateVehicleServerSetter('adder', 'automobile', 0.0, 0.0, 0.0, 0.0)
print(NetworkGetEntityFromNetworkId(65534), NetworkGetEntityFromNetworkId(65534 + 65536), NetworkGetEntityFromNetworkId(65534 - 65536))
print(NetworkGetEntityFromNetworkId(0), NetworkGetEntityFromNetworkId(65536), NetworkGetEntityFromNetworkId(1))
print(GetEntityFromStateBagName('entity:65534'), GetEntityFromStateBagName('entity:65534x'), GetEntityFromStateBagName('entity:1'))
print(GetEntityFromStateBagName('player:65534'), GetEntityFromStateBagName('entity:-2'))`),
    ).toEqual([
      '[script:run0] 131073\t131073\t131073',
      '[script:run0] 0\t0\t0',
      '[script:run0] 131073\t131073\t0',
      '[script:run0] 0\t131073',
    ])
  })

  it('have no owner until a client takes them', async () => {
    const { run } = await serverOf()
    expect(
      run(
        `print(NetworkGetEntityOwner(CreateVehicleServerSetter('adder', 'automobile', 0.0, 0.0, 0.0, 0.0)))`,
      ),
    ).toEqual(['[script:run0] -1'])
  })

  it('give natives their defaults for handle 0', async () => {
    const { run } = await serverOf()
    expect(
      run(`print(DoesEntityExist(0), GetEntityCoords(0), GetEntityRotation(0), GetEntityHeading(0))
print(GetEntityModel(0), GetEntityType(0), GetNetTypeFromEntity(0), GetVehicleType(0), GetEntityScript(0))
print(NetworkGetNetworkIdFromEntity(0), NetworkGetEntityOwner(0), GetEntityPopulationType(0))
DeleteEntity(0)`),
    ).toEqual([
      '[script:run0] false\tvec3(0.000000, 0.000000, 0.000000)\tvec3(0.000000, 0.000000, 0.000000)\t0.0',
      '[script:run0] 0\t0\t-1\tnil\tnil',
      '[script:run0] 0\t0\t0',
    ])
  })

  it('fail natives for handles of no entity', async () => {
    const { run } = await serverOf()
    expect(
      run(`print(DoesEntityExist(5), DoesEntityExist(-1))
print(pcall(GetEntityCoords, 5))
print(pcall(GetEntityModel, -1))
print(pcall(DeleteEntity, 131073))`),
    ).toEqual([
      '[script:run0] false\tfalse',
      '[script:run0] false\tnative 000000001647f1cb: Tried to access invalid entity: 5',
      '[script:run0] false\tnative 00000000dafcb3ec: Tried to access invalid entity: -1',
      '[script:run0] false\tnative 00000000faa3d236: Tried to access invalid entity: 131073',
    ])
  })

  it('are created with serverEntityCreated, which is queued', async () => {
    const { run, tick } = await serverOf()
    expect(
      run(`AddEventHandler('serverEntityCreated', function(entity)
    print('created', entity, DoesEntityExist(entity), GetEntityModel(entity) == GetHashKey('adder'))
end)
print('create', CreateVehicleServerSetter('adder', 'automobile', 0.0, 0.0, 0.0, 0.0))`),
    ).toEqual(['[script:run0] create\t131073'])
    expect(tick()).toEqual(['[script:run0] created\t131073\t1\ttrue'])
  })

  it('exist until the next tick after they are deleted, and are removed at its end', async () => {
    const { run, tick } = await serverOf()
    expect(
      run(`AddEventHandler('entityRemoved', function(entity)
    print('removed', entity, DoesEntityExist(entity), GetEntityCoords(entity))
end)
local v = CreateVehicleServerSetter('adder', 'automobile', 1.0, 2.0, 3.0, 0.0)
DeleteEntity(v)
print('deleted', DoesEntityExist(v), NetworkGetEntityFromNetworkId(65534), json.encode(GetAllVehicles()))
CreateThread(function()
    print('deleting', DoesEntityExist(v), NetworkGetEntityFromNetworkId(65534), json.encode(GetAllVehicles()))
    print('deleting', GetEntityFromStateBagName('entity:65534'), GetEntityCoords(v))
    Wait(0)
    print('gone', pcall(GetEntityCoords, v))
    print('gone', DoesEntityExist(v), GetEntityFromStateBagName('entity:65534'))
end)`),
    ).toEqual(['[script:run0] deleted\t1\t131073\t[131073]'])
    expect(tick()).toEqual([
      '[script:run0] deleting\tfalse\t0\t[]',
      '[script:run0] deleting\t131073\tvec3(1.000000, 2.000000, 3.000000)',
      '[script:run0] removed\t131073\tfalse\tvec3(1.000000, 2.000000, 3.000000)',
    ])
    expect(tick()).toEqual([
      '[script:run0] gone\tfalse\tnative 000000001647f1cb: Tried to access invalid entity: 131073',
      '[script:run0] gone\tfalse\t0',
    ])
  })

  it('take the object ids and the GUIDs of those that were removed', async () => {
    const { run, tick } = await serverOf()
    run(`DeleteEntity(CreateVehicleServerSetter('adder', 'automobile', 0.0, 0.0, 0.0, 0.0))`)
    tick()
    expect(
      run(`local v = CreateVehicleServerSetter('adder', 'automobile', 0.0, 0.0, 0.0, 0.0)
print(v, NetworkGetNetworkIdFromEntity(v), DoesEntityExist(131073))`),
    ).toEqual(['[script:run1] 131074\t65534\tfalse'])
  })

  it('take object ids from 8191 down without OneSync, until there is none left', async () => {
    const { run } = await serverOf({ oneSync: false })
    expect(
      run(`print(NetworkGetNetworkIdFromEntity(CreatePed(4, 0, 0.0, 0.0, 0.0, 0.0, true, false)))
for _ = 2, 8191 do CreateObjectNoOffset(0, 0.0, 0.0, 0.0, true, false, false) end
print(CreateVehicleServerSetter('adder', 'automobile', 0.0, 0.0, 0.0, 0.0), #GetAllObjects())`),
    ).toEqual(['[script:run0] 8191', '[script:run0] 0\t8190'])
  })

  it('know the resources whose scripts created them, stopped or not, by the hash of their names', async () => {
    const { run, server } = await serverOf()
    run(
      `exports('create', function() return CreateVehicleServerSetter('adder', 'automobile', 0.0, 0.0, 0.0, 0.0) end)`,
      'Maker',
    )
    const long = 'a'.repeat(64)
    expect(
      run(
        `print(GetEntityScript(exports.Maker:create()))
print(GetEntityScript(CreateVehicleServerSetter('adder', 'automobile', 0.0, 0.0, 0.0, 0.0)))`,
        long,
      ),
    ).toEqual([
      `[script:${long}] Maker`,
      // FiveM hashes but the first 63 bytes of the names of resources as it looks for them.
      `[script:${long}] nil`,
    ])
    server.manager.getResource('Maker')!.stop()
    expect(run(`print(GetEntityScript(131073), DoesEntityExist(131073))`)).toEqual([
      '[script:run0] Maker	1',
    ])
  })

  it('tell scripts that pass integers for coordinates what FiveM reads them as', async () => {
    const { run, server } = await serverOf()
    run(`CreateVehicleServerSetter('adder', 'automobile', 100, 200.0, 30.0, 0.0)`)
    expect(server.diagnostics).toEqual([
      'run0: CREATE_VEHICLE_SERVER_SETTER: argument 3 (x) is a float, but the script passed the integer 100, which FiveM reads as 1.401298e-43. Write 100.0 instead.',
    ])
  })
})

describe('Entities of clients', () => {
  it('start with the ped of the player: player_zero, at 0, 0, 0, turned to the north', async () => {
    const { run } = await clientOf()
    expect(
      run(`local ped = PlayerPedId()
print(DoesEntityExist(ped), GetEntityModel(ped) == GetHashKey('player_zero'), GetEntityType(ped))
print(IsEntityAPed(ped), IsEntityAVehicle(ped), IsEntityAnObject(ped))
print(GetEntityCoords(ped, true), GetEntityHeading(ped), GetEntityRotation(ped, 2))
print(IsEntityVisible(ped), IsEntityPositionFrozen(ped), GetEntityForwardVector(ped))`),
    ).toEqual([
      '1\ttrue\t1',
      '1\tfalse\tfalse',
      'vec3(0.000000, 0.000000, 0.000000)\t0.0\tvec3(0.000000, 0.000000, 0.000000)',
      '1\tfalse\tvec3(0.000000, 1.000000, 0.000000)',
    ])
  })

  it('are where scripts put them, in single precision, without the sizes of models', async () => {
    const { run } = await clientOf()
    expect(
      run(`local ped = PlayerPedId()
SetEntityCoords(ped, 100.5, -200.25, 30.1, false, false, false, true)
print(GetEntityCoords(ped), string.format('%.9f', GetEntityCoords(ped).z))
SetEntityCoordsNoOffset(ped, 1.0, 2.0, 3.0, false, false, false)
print(GetEntityCoords(ped))`),
    ).toEqual([
      'vec3(100.500000, -200.250000, 30.100000)\t30.100000381',
      'vec3(1.000000, 2.000000, 3.000000)',
    ])
  })

  it('turn to headings, which their rotations tell as yaws from -180 to 180', async () => {
    const { run } = await clientOf()
    expect(
      run(`local ped = PlayerPedId()
SetEntityHeading(ped, 270.0)
print(GetEntityHeading(ped), GetEntityRotation(ped, 2))
SetEntityHeading(ped, -45.0)
print(GetEntityHeading(ped), GetEntityRotation(ped, 2))
SetEntityHeading(ped, 450.0)
print(GetEntityHeading(ped))`),
    ).toEqual([
      '270.0\tvec3(0.000000, 0.000000, -90.000000)',
      '315.0\tvec3(0.000000, 0.000000, -45.000000)',
      '90.0',
    ])
  })

  it('turn as their rotations say, in each order, which they give back in another', async () => {
    const { run } = await clientOf()
    expect(
      run(`local ped = PlayerPedId()
SetEntityRotation(ped, 10.0, 20.0, 30.0, 2, false)
print(GetEntityRotation(ped, 2), GetEntityHeading(ped))
print(GetEntityRotation(ped, 0))
SetEntityRotation(ped, 10.0, 20.0, 30.0, 0, false)
print(GetEntityRotation(ped, 0))`),
    ).toEqual([
      'vec3(10.000000, 20.000000, 30.000000)\t30.0',
      'vec3(10.627584, 19.683498, 33.616440)',
      'vec3(10.000000, 20.000000, 30.000000)',
    ])
  })

  it('give where their fronts and their offsets are, as they turn', async () => {
    const { run } = await clientOf()
    expect(
      run(`local ped = PlayerPedId()
SetEntityCoords(ped, 10.0, 20.0, 5.0, false, false, false, false)
SetEntityHeading(ped, 90.0)
print(GetEntityForwardVector(ped))
print(GetOffsetFromEntityInWorldCoords(ped, 0.0, 2.0, 1.0), GetOffsetFromEntityInWorldCoords(ped, 1.0, 0.0, 0.0))`),
    ).toEqual([
      // Heading 90 faces west.
      'vec3(-1.000000, 0.000000, 0.000000)',
      'vec3(8.000000, 20.000000, 6.000000)\tvec3(10.000000, 21.000000, 5.000000)',
    ])
  })

  it('freeze and hide as scripts say', async () => {
    const { run } = await clientOf()
    expect(
      run(`local ped = PlayerPedId()
FreezeEntityPosition(ped, true)
SetEntityVisible(ped, false, false)
print(IsEntityPositionFrozen(ped), IsEntityVisible(ped))
SetEntityCoords(ped, 1.0, 2.0, 3.0, false, false, false, false)
FreezeEntityPosition(ped, false)
SetEntityVisible(ped, true, false)
print(IsEntityPositionFrozen(ped), IsEntityVisible(ped), GetEntityCoords(ped))`),
    ).toEqual(['1\tfalse', 'false\t1\tvec3(1.000000, 2.000000, 3.000000)'])
  })

  it('give natives their defaults for handles of no entity, as GTA V does', async () => {
    const { run, client } = await clientOf()
    expect(
      run(`print(DoesEntityExist(0), DoesEntityExist(2), DoesEntityExist(-1), GetEntityModel(2), GetEntityType(2))
print(GetEntityCoords(2), GetEntityHeading(2), GetEntityRotation(2, 2), GetEntityForwardVector(2))
print(GetOffsetFromEntityInWorldCoords(2, 1.0, 1.0, 1.0), IsEntityAPed(2), IsEntityVisible(2), IsEntityPositionFrozen(2))
SetEntityCoords(2, 1.0, 1.0, 1.0, false, false, false, false)
SetEntityCoordsNoOffset(2, 1.0, 1.0, 1.0, false, false, false)
SetEntityHeading(2, 1.0)
SetEntityRotation(2, 1.0, 1.0, 1.0, 2, false)
FreezeEntityPosition(2, true)
SetEntityVisible(2, false, false)
print(NetworkGetEntityOwner(2))`),
    ).toEqual([
      'false\tfalse\tfalse\t0\t0',
      'vec3(0.000000, 0.000000, 0.000000)\t0.0\tvec3(0.000000, 0.000000, 0.000000)\tvec3(0.000000, 0.000000, 0.000000)',
      'vec3(0.000000, 0.000000, 0.000000)\tfalse\tfalse\tfalse',
      '-1',
    ])
    expect(client.diagnostics).toEqual([])
  })

  it('are owned by the local player in network games, and have no owner out of them', async () => {
    const { run } = await clientOf()
    expect(run(`print(NetworkGetEntityOwner(PlayerPedId()))`)).toEqual(['128'])
    const alone = await createProcess({ side: 'client' })
    alone.add('alone', { 'main.lua': `print(NetworkGetEntityOwner(PlayerPedId()))` }).start()
    expect(alone.take().filter((line) => line.startsWith('[script:'))).toEqual([
      '[script:alone] -1',
    ])
  })

  it('are known to scripts that call natives by the hashes of GTA V', async () => {
    const { run } = await clientOf()
    expect(
      run(`local ped = PlayerPedId()
Citizen.InvokeNative(0x06843DA7060A026B, ped, 4.0, 5.0, 6.0, false, false, false, false)
print(Citizen.InvokeNative(0x3FEF770D40960D5A, ped, true, Citizen.ResultAsVector()), Citizen.InvokeNative(0x7239B21A38F536BA, ped))`),
    ).toEqual(['vec3(4.000000, 5.000000, 6.000000)\t1'])
  })

  it('are those of a new world once the client left its session', async () => {
    const { client, player, session, run } = await clientOf()
    run(`SetEntityCoords(PlayerPedId(), 1.0, 2.0, 3.0, false, false, false, false)`)
    player.quit()
    client.manager.tick()
    client.add('after', { 'main.lua': `print(PlayerId(), GetEntityCoords(PlayerPedId()))` }).start()
    expect(client.take().filter((line) => line.startsWith('[script:'))).toEqual([
      '[script:after] 0\tvec3(0.000000, 0.000000, 0.000000)',
    ])
    expect(session.player(1)).toBeUndefined()
  })

  it('are in the worlds of clients, which servers do not have, as clients have no game state', async () => {
    const { client, server } = await clientOf()
    expect(server.manager.world).toBeUndefined()
    expect(client.manager.gameState).toBeUndefined()
    expect(client.manager.world?.playerPed.handle).toBe(1)
  })
})

/** Runs Lua code on a client that joined a server, and returns what it printed as it started and over `ticks` ticks. */
async function onClient(code: string, ticks = 1) {
  const test = await clientOf()
  const lines = test.run(code)
  for (let tick = 0; tick < ticks; tick++) {
    test.client.tickAt(test.client.time + 10)
    for (const line of test.client.take()) {
      if (line.startsWith('[script:run0] ')) lines.push(line.slice('[script:run0] '.length))
    }
  }
  return { ...test, lines }
}

/** Lua that loads the model of adder, then runs `code` in a thread. */
function withAdder(code: string): string {
  return `local adder = GetHashKey('adder')
RequestModel(adder)
CreateThread(function()
    while not HasModelLoaded(adder) do Wait(0) end
${code}
end)`
}

describe('Entities that scripts of clients create', () => {
  it('are of models that are loaded, which load at the next tick once scripts request them', async () => {
    const { lines, client } = await onClient(`local adder = GetHashKey('adder')
print(HasModelLoaded(adder), CreateVehicle(adder, 1.0, 2.0, 3.0, 90.0, true, false))
RequestModel(adder)
print(HasModelLoaded(adder))
CreateThread(function()
    print(HasModelLoaded(adder))
    local vehicle = CreateVehicle(adder, 1.0, 2.0, 3.0, 90.0, true, false)
    print(vehicle, DoesEntityExist(vehicle), GetEntityModel(vehicle) == adder, GetEntityCoords(vehicle), GetEntityHeading(vehicle))
    print(GetEntityType(vehicle), IsEntityAVehicle(vehicle), IsEntityAMissionEntity(vehicle), GetEntityScript(vehicle), NetworkGetEntityOwner(vehicle))
end)`)
    expect(lines).toEqual([
      'false\t0',
      'false',
      '1',
      '257\t1\ttrue\tvec3(1.000000, 2.000000, 3.000000)\t90.0',
      '2\t1\t1\trun0\t128',
    ])
    expect(client.diagnostics).toEqual([
      'run0: CreateVehicle was given a model that is not loaded, so it created nothing and returned 0, as GTA V does: request it with RequestModel, then wait until HasModelLoaded says it loaded.',
    ])
  })

  it('are peds and objects too, networked if scripts ask', async () => {
    const { lines } = await onClient(
      withAdder(`local ped = CreatePed(4, adder, 1.0, 2.0, 3.0, 180.0, false, false)
    local object = CreateObject(adder, 4.0, 5.0, 6.0, true, false, false)
    local placed = CreateObjectNoOffset(adder, 7.0, 8.0, 9.0, false, false, false)
    print(ped, GetEntityType(ped), GetEntityHeading(ped), NetworkGetEntityOwner(ped))
    print(object, GetEntityType(object), GetEntityCoords(object), GetEntityHeading(object), NetworkGetEntityOwner(object))
    print(placed, GetEntityType(placed), GetEntityCoords(placed), NetworkGetEntityOwner(placed))`),
    )
    expect(lines).toEqual([
      '257\t1\t180.0\t-1',
      '513\t3\tvec3(4.000000, 5.000000, 6.000000)\t0.0\t128',
      '769\t3\tvec3(7.000000, 8.000000, 9.000000)\t-1',
    ])
  })

  it('have no network objects out of network games', async () => {
    const client = await createProcess({ side: 'client' })
    client
      .add('alone', {
        'main.lua': withAdder(
          `print(NetworkGetEntityOwner(CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, true, false)))`,
        ),
      })
      .start()
    client.tickAt(10)
    expect(client.take().filter((line) => line.startsWith('[script:'))).toEqual([
      '[script:alone] -1',
    ])
  })

  it('are in the pools of the game of their clients, as GetGamePool names them', async () => {
    const { lines } = await onClient(
      withAdder(`local vehicle = CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, true, false)
    local ped = CreatePed(4, adder, 0.0, 0.0, 0.0, 0.0, true, false)
    local object = CreateObject(adder, 0.0, 0.0, 0.0, false, false, false)
    local networked = CreateObject(adder, 0.0, 0.0, 0.0, true, false, false)
    print(json.encode(GetGamePool('CVehicle')), json.encode(GetGamePool('CPed')), json.encode(GetGamePool('CObject')))
    print(json.encode(GetGamePool('CNetObject')), json.encode(GetGamePool('CPickup')))
    print(pcall(GetGamePool, 'CNetVehicle'))`),
    )
    expect(lines).toEqual([
      '[257]\t[1,513]\t[769,1025]',
      '[1025]\t[]',
      'false\tnative 000000002b9d4f50: Invalid pool: CNetVehicle',
    ])
  })

  it('are searched for, a pool at a time, as they were when searches began', async () => {
    const { lines, client } = await onClient(
      withAdder(`local a = CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, false, false)
    local b = CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, false, false)
    local c = CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, false, false)
    local search, first = FindFirstVehicle()
    DeleteEntity(b)
    CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, false, false)
    print(search, first == a, FindNextVehicle(search))
    print(FindNextVehicle(search))
    EndFindVehicle(search)
    print(FindNextVehicle(search), FindNextVehicle(64), FindNextVehicle(-1))
    local peds, ped = FindFirstPed()
    print(peds, ped == PlayerPedId(), FindNextPed(peds))
    print(FindFirstPickup())`),
    )
    expect(lines).toEqual([
      '0\ttrue\t1\t769',
      'false\t-1',
      // Searches that ended, or that no handle has, leave the entities scripts gave them.
      'false\tfalse\tfalse\t0',
      '0\ttrue\tfalse\t-1',
      '-1\t-1',
    ])
    expect(client.diagnostics).toEqual([
      "run0: FindNextVehicle was given the handle of a search that ended, which FiveM's game reads past and crashes on. FiveRunner returns false.",
    ])
  })

  it('are searched for 64 searches at a time', async () => {
    const { lines } = await onClient(`local searches = {}
for i = 1, 64 do searches[i] = FindFirstPed() end
print(searches[1], searches[64], FindFirstPed(5))
EndFindPed(searches[10])
print(FindFirstPed())
EndFindPed(64)`)
    expect(lines).toEqual(['0\t63\t-1\t5', '9\t1'])
  })

  it('are deleted by scripts as mission entities, which their handles become 0 for', async () => {
    const { lines, client } = await onClient(
      withAdder(`local vehicle = CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, false, false)
    print(DeleteEntity(vehicle), DoesEntityExist(vehicle))
    local released = CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, false, false)
    SetEntityAsNoLongerNeeded(released)
    print(IsEntityAMissionEntity(released), DeleteVehicle(released) == released, DoesEntityExist(released))
    SetEntityAsMissionEntity(released, true, false)
    print(IsEntityAMissionEntity(released), DeleteVehicle(released), DoesEntityExist(released))
    local ped = CreatePed(4, adder, 0.0, 0.0, 0.0, 0.0, false, false)
    print(DeleteVehicle(ped) == ped, DeleteObject(ped) == ped, DoesEntityExist(ped), DeletePed(ped), DoesEntityExist(ped))
    local object = CreateObject(adder, 0.0, 0.0, 0.0, false, false, false)
    print(DeleteObject(object), DoesEntityExist(object))
    print(DeleteEntity(PlayerPedId()) == PlayerPedId(), DoesEntityExist(PlayerPedId()), DeleteEntity(0))
    print(json.encode(GetGamePool('CVehicle')), json.encode(GetGamePool('CPed')), json.encode(GetGamePool('CObject')))`),
    )
    expect(lines).toEqual([
      '0\tfalse',
      'false\ttrue\t1',
      '1\t0\tfalse',
      'true\ttrue\t1\t0\tfalse',
      '0\tfalse',
      'true\t1\t0',
      '[]\t[1]\t[]',
    ])
    expect(client.diagnostics).toEqual([
      'run0: DeleteVehicle was given an entity that is no mission entity, which GTA V does not delete: make it one with SetEntityAsMissionEntity(entity, true, true) first.',
    ])
  })

  it('are let go of by the natives of their types', async () => {
    const { lines } = await onClient(
      withAdder(`local ped = CreatePed(4, adder, 0.0, 0.0, 0.0, 0.0, false, false)
    SetVehicleAsNoLongerNeeded(ped)
    SetObjectAsNoLongerNeeded(ped)
    print(IsEntityAMissionEntity(ped))
    SetPedAsNoLongerNeeded(ped)
    print(IsEntityAMissionEntity(ped), DoesEntityExist(ped))
    local vehicle = CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, false, false)
    local object = CreateObject(adder, 0.0, 0.0, 0.0, false, false, false)
    SetVehicleAsNoLongerNeeded(vehicle)
    SetObjectAsNoLongerNeeded(object)
    print(IsEntityAMissionEntity(vehicle), IsEntityAMissionEntity(object))`),
    )
    expect(lines).toEqual(['1', 'false\t1', 'false\tfalse'])
  })

  it('take the handles of those that were deleted, with new ids', async () => {
    const { lines } = await onClient(
      withAdder(`local vehicle = CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, false, false)
    DeleteEntity(vehicle)
    print(vehicle, CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, false, false))`),
    )
    expect(lines).toEqual(['257\t258'])
  })

  it('belong to the scripts of their resources until those let go of them or stop', async () => {
    const test = await clientOf()
    test.run(`local adder = GetHashKey('adder')
RequestModel(adder)
exports('create', function() return CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, false, false) end)`)
    test.client.tickAt(10)
    expect(
      test.run(`local mine = exports.run0:create()
print(GetEntityScript(mine), IsEntityAMissionEntity(mine))
SetEntityAsNoLongerNeeded(mine)
SetEntityAsMissionEntity(mine, true, false)
print(GetEntityScript(mine))
SetEntityAsMissionEntity(mine, true, true)
print(GetEntityScript(mine))
local theirs = exports.run0:create()
print(GetEntityScript(theirs))
print(mine, theirs)`),
    ).toEqual(['run0\t1', 'run0\t0', 'run1\t0', 'run0\t0', '257\t513'])
    test.client.manager.getResource('run0')!.stop()
    expect(
      test.run(
        `print(GetEntityScript(513), IsEntityAMissionEntity(513), DoesEntityExist(513), GetEntityScript(257))`,
      ),
    ).toEqual(['nil\tfalse\t1\trun1\t0'])
  })

  it('have collision around them, as there is none to load', async () => {
    const { run } = await clientOf()
    expect(
      run(
        `print(HasCollisionLoadedAroundEntity(PlayerPedId()), HasCollisionLoadedAroundEntity(0), HasCollisionLoadedAroundEntity(5))`,
      ),
    ).toEqual(['1\tfalse\tfalse'])
  })
})

describe('Models of the games of clients', () => {
  it('are all in the CD image but 0, which never loads', async () => {
    const { lines } = await onClient(`RequestModel(0)
print(IsModelInCdimage(GetHashKey('anything')), IsModelValid(GetHashKey('anything')), IsModelInCdimage(0), IsModelValid(0))
CreateThread(function() print(HasModelLoaded(0)) end)`)
    expect(lines).toEqual(['1\t1\tfalse\tfalse', 'false'])
  })

  it('stay loaded once scripts no longer need them, as those of entities are', async () => {
    const { lines } = await onClient(
      withAdder(`SetModelAsNoLongerNeeded(adder)
    print(HasModelLoaded(adder), HasModelLoaded(GetEntityModel(PlayerPedId())), HasModelLoaded(GetHashKey('player_one')))`),
    )
    expect(lines).toEqual(['1\t1\tfalse'])
  })

  it('are of the kinds of the entities that scripts created of them, which FiveRunner knows no others of', async () => {
    const { lines, client } = await onClient(
      withAdder(`print(IsModelAVehicle(adder), IsModelAVehicle(adder), IsModelAPed(adder), IsModelAVehicle(0))
    CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, false, false)
    print(IsModelAVehicle(adder), IsModelAPed(adder), IsModelAPed(GetEntityModel(PlayerPedId())))`),
    )
    expect(lines).toEqual(['false\tfalse\tfalse\tfalse', '1\tfalse\t1'])
    expect(client.diagnostics).toEqual([
      'run0: IsModelAVehicle was asked of the model 0xb779a091, of which FiveRunner knows nothing: it has no list of the models of GTA V, so it says false. Models are vehicles, peds or objects once scripts created entities of them.',
      'run0: IsModelAPed was asked of the model 0xb779a091, of which FiveRunner knows nothing: it has no list of the models of GTA V, so it says false. Models are vehicles, peds or objects once scripts created entities of them.',
    ])
  })
})
