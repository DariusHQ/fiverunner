import { describe, expect, it } from 'vitest'

import { clientOf } from './helpers.ts'

describe('The seats of vehicles on clients', () => {
  it('take the peds that scripts seat in them at once, which go where their vehicles go until they leave', async () => {
    const test = await clientOf()
    test.run(`local adder = GetHashKey('adder')
RequestModel(adder)
CreateThread(function()
    while not HasModelLoaded(adder) do Wait(0) end
    local ped = PlayerPedId()
    local car = CreateVehicle(adder, 10.0, 20.0, 30.0, 0.0, false, false)
    local other = CreatePed(4, adder, 0.0, 0.0, 0.0, 0.0, false, false)
    print(GetVehiclePedIsIn(ped, false), IsPedInAnyVehicle(ped, false), IsVehicleSeatFree(car, -1, false))
    SetPedIntoVehicle(ped, car, -1)
    print(GetVehiclePedIsIn(ped, false) == car, IsPedInVehicle(ped, car, false), GetPedInVehicleSeat(car, -1, false) == ped, GetEntityCoords(ped))
    TaskWarpPedIntoVehicle(other, car, -2)
    print(GetPedInVehicleSeat(car, 0, false) == other, IsVehicleSeatFree(car, 0, false), IsVehicleSeatFree(car, 1, false))
    SetEntityCoords(car, 1.0, 2.0, 3.0, false, false, false, false)
    print(GetEntityCoords(ped), GetEntityCoords(other))
    SetPedIntoVehicle(other, car, -1)
    print(IsPedInAnyVehicle(ped, false), GetVehiclePedIsIn(ped, true) == car, GetLastPedInVehicleSeat(car, -1) == other, GetPlayersLastVehicle() == car)
    SetPedIntoVehicle(ped, car, 1)
    SetPedCoordsKeepVehicle(ped, 5.0, 6.0, 7.0)
    print(GetEntityCoords(car), IsPedSittingInVehicle(ped, car))
    SetEntityCoords(ped, 0.0, 0.0, 0.0, false, false, false, false)
    print(IsPedInAnyVehicle(ped, false), GetEntityCoords(car))
    TaskLeaveVehicle(other, car, 0)
    print(IsPedInAnyVehicle(other, false), GetVehiclePedIsTryingToEnter(ped))
    SetPedIntoVehicle(ped, car, 0)
    DeleteEntity(car)
    print(IsPedInAnyVehicle(ped, false), GetVehiclePedIsIn(ped, true))
end)`)
    test.client.tickAt(test.client.time + 10)
    const lines = test.client
      .take()
      .filter((line) => line.startsWith('[script:run0] '))
      .map((line) => line.slice('[script:run0] '.length))
    expect(lines).toEqual([
      '0\tfalse\t1',
      'true\t1\ttrue\tvec3(10.000000, 20.000000, 30.000000)',
      // -2 seats peds in the first seat of passengers that no ped has.
      'true\tfalse\t1',
      'vec3(1.000000, 2.000000, 3.000000)\tvec3(1.000000, 2.000000, 3.000000)',
      // A ped seated where another sits takes its place.
      'false\ttrue\ttrue\ttrue',
      'vec3(5.000000, 6.000000, 7.000000)\t1',
      // SetEntityCoords takes peds out of their vehicles.
      'false\tvec3(5.000000, 6.000000, 7.000000)',
      'false\t0',
      'false\t0',
    ])
    expect(test.client.diagnostics).toEqual([])
  })
})
