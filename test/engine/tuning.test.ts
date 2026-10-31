import { describe, expect, it } from 'vitest'

import { clientOf } from './helpers.ts'

/** What a script prints on a client with a vehicle `car` and the peds of its player. */
async function onCar(script: string) {
  const test = await clientOf()
  test.run(`local adder = GetHashKey('adder')
RequestModel(adder)
CreateThread(function()
    while not HasModelLoaded(adder) do Wait(0) end
    local car = CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, false, false)
${script}
end)`)
  test.client.tickAt(test.client.time + 10)
  return {
    lines: test.client
      .take()
      .filter((line) => line.startsWith('[script:run0] '))
      .map((line) => line.slice('[script:run0] '.length)),
    diagnostics: test.client.diagnostics,
  }
}

describe('Vehicles on clients', () => {
  it('start as stock cars do, whole and clean', async () => {
    const { lines, diagnostics } =
      await onCar(`print(GetVehicleEngineHealth(car), GetVehicleBodyHealth(car), GetVehiclePetrolTankHealth(car), GetVehicleDirtLevel(car))
    print(GetVehicleColours(car))
    print(GetVehicleMod(car, 11), GetVehicleLivery(car), GetVehicleWindowTint(car), GetVehicleModKit(car))
    print(IsVehicleWindowIntact(car, 0), IsVehicleTyreBurst(car, 0, false), GetVehicleDoorAngleRatio(car, 0), GetIsVehicleEngineRunning(car))
    print(GetVehicleTyreSmokeColor(car))
    print(GetVehicleNeonLightsColour(car))`)
    expect(lines).toEqual([
      '1000.0\t1000.0\t1000.0\t0.0',
      '0\t0',
      '-1\t-1\t-1\t65535',
      '1\tfalse\t0.0\tfalse',
      '255\t255\t255',
      '255\t0\t255',
    ])
    expect(diagnostics).toEqual([])
  })

  it('keep the colours, the mods and the state that scripts set, which they read back', async () => {
    const { lines, diagnostics } = await onCar(`SetVehicleColours(car, 12, 34)
    SetVehicleExtraColours(car, 5, 6)
    SetVehicleCustomPrimaryColour(car, 1, 2, 3)
    SetVehicleInteriorColor(car, 7)
    SetVehicleDashboardColour(car, 8)
    print(GetVehicleColours(car))
    print(GetVehicleExtraColours(car))
    print(GetVehicleCustomPrimaryColour(car))
    print(GetIsVehiclePrimaryColourCustom(car), GetIsVehicleSecondaryColourCustom(car))
    ClearVehicleCustomPrimaryColour(car)
    print(GetIsVehiclePrimaryColourCustom(car), GetVehicleInteriorColor(car), GetVehicleDashboardColour(car))
    SetVehicleModKit(car, 0)
    SetVehicleMod(car, 11, 3, true)
    ToggleVehicleMod(car, 18, true)
    SetVehicleLivery(car, 2)
    SetVehicleWindowTint(car, 4)
    print(GetVehicleMod(car, 11), GetVehicleModVariation(car, 11), IsToggleModOn(car, 18), GetVehicleLivery(car), GetVehicleWindowTint(car), GetNumVehicleMods(car, 11))
    RemoveVehicleMod(car, 11)
    print(GetVehicleMod(car, 11), DoesExtraExist(car, 1))
    SetVehicleExtra(car, 1, false)
    SetVehicleExtra(car, 2, true)
    print(DoesExtraExist(car, 1), IsVehicleExtraTurnedOn(car, 1), IsVehicleExtraTurnedOn(car, 2))
    SetVehicleEngineHealth(car, 500.0)
    SetVehicleDirtLevel(car, 7.5)
    SetVehicleFuelLevel(car, 20.0)
    SetVehicleEngineOn(car, true, true, false)
    SetVehicleDoorsLocked(car, 2)
    SetVehicleNeonLightEnabled(car, 1, true)
    print(GetVehicleEngineHealth(car), GetVehicleDirtLevel(car), GetVehicleFuelLevel(car), GetIsVehicleEngineRunning(car), GetVehicleDoorLockStatus(car), IsVehicleNeonLightEnabled(car, 1), IsVehicleNeonLightEnabled(car, 0))`)
    expect(lines).toEqual([
      '12\t34',
      '5\t6',
      '1\t2\t3',
      '1\tfalse',
      'false\t7\t8',
      '3\t1\t1\t2\t4\t10',
      '-1\tfalse',
      '1\t1\tfalse',
      '500.0\t7.5\t20.0\t1\t2\t1\tfalse',
    ])
    expect(diagnostics).toEqual([])
  })

  it('take no mods without a mod kit, as in GTA V, which FiveRunner says once', async () => {
    const { lines, diagnostics } = await onCar(`SetVehicleMod(car, 11, 3, false)
    SetVehicleMod(car, 12, 3, false)
    print(GetVehicleMod(car, 11))`)
    expect(lines).toEqual(['-1'])
    expect(diagnostics).toEqual([
      'run0: SetVehicleMod does nothing on a vehicle without a mod kit, as in GTA V: call SetVehicleModKit(vehicle, 0) first.',
    ])
  })

  it('have doors, windows and tyres that break, until scripts fix them, which leaves their dirt', async () => {
    const { lines, diagnostics } = await onCar(`SetVehicleDoorOpen(car, 1, false, true)
    print(GetVehicleDoorAngleRatio(car, 1), IsVehicleDoorFullyOpen(car, 1))
    SetVehicleDoorShut(car, 1, true)
    SetVehicleDoorOpen(car, 2, false, true)
    print(GetVehicleDoorAngleRatio(car, 1), GetVehicleDoorAngleRatio(car, 2))
    SetVehicleDoorsShut(car, true)
    SetVehicleDoorBroken(car, 3, true)
    print(GetVehicleDoorAngleRatio(car, 2), IsVehicleDoorDamaged(car, 3), GetIsDoorValid(car, 3), GetIsDoorValid(car, 4), GetIsDoorValid(car, 6))
    SmashVehicleWindow(car, 0)
    SetVehicleTyreBurst(car, 1, false, 1000.0)
    SetVehicleTyreBurst(car, 2, true, 1000.0)
    print(IsVehicleWindowIntact(car, 0), IsVehicleTyreBurst(car, 1, false), IsVehicleTyreBurst(car, 1, true), IsVehicleTyreBurst(car, 2, true))
    SetVehicleBodyHealth(car, 100.0)
    SetVehicleDirtLevel(car, 3.0)
    SetVehicleFixed(car)
    print(GetVehicleBodyHealth(car), IsVehicleDoorDamaged(car, 3), IsVehicleWindowIntact(car, 0), IsVehicleTyreBurst(car, 1, false), GetVehicleDirtLevel(car))
    SetVehicleTyresCanBurst(car, false)
    SetVehicleTyreBurst(car, 1, false, 1000.0)
    print(IsVehicleTyreBurst(car, 1, false), GetVehicleTyresCanBurst(car))`)
    expect(lines).toEqual([
      '1.0\t1',
      '0.0\t1.0',
      '0.0\t1\tfalse\t1\tfalse',
      'false\t1\tfalse\t1',
      '1000.0\tfalse\t1\tfalse\t3.0',
      'false\tfalse',
    ])
    expect(diagnostics).toEqual([])
  })

  it('are automobiles, whatever their models, as FiveRunner has no models to read', async () => {
    const { lines, diagnostics } = await onCar(`local ped = PlayerPedId()
    SetPedIntoVehicle(ped, car, 0)
    print(GetVehicleMaxNumberOfPassengers(car), GetVehicleModelNumberOfSeats(adder), GetVehicleNumberOfPassengers(car), GetVehicleLiveryCount(car))
    print(IsVehicleModel(car, adder), IsVehicleModel(car, 1), IsThisModelACar(adder), IsVehicleOnAllWheels(car), SetVehicleOnGroundProperly(car))`)
    expect(lines).toEqual(['3\t4\t1\t-1', '1\tfalse\t1\t1\t1'])
    expect(diagnostics).toEqual([])
  })

  it('give default values for handles of no vehicle, as natives of GTA V do', async () => {
    const { lines, diagnostics } =
      await onCar(`print(GetVehicleEngineHealth(0), GetVehicleMod(0, 1), GetVehicleColours(0))
    SetVehicleColours(0, 1, 2)
    SetVehicleDoorOpen(ped, 0, false, false)`)
    expect(lines).toEqual(['0.0\t-1\t0\t0'])
    expect(diagnostics).toEqual([])
  })
})
