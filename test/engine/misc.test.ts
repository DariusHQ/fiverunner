import { describe, expect, it } from 'vitest'

import { catalogNatives } from '../../src/core/natives/index.ts'
import { silentNative, unknownSilentNames } from '../../src/core/engine/natives/silent.ts'
import { clientOf, createProcess } from './helpers.ts'

describe('The arithmetic of GTA V on clients', () => {
  it('gives distances and magnitudes, in the plane or in space', async () => {
    const { run, client } = await clientOf()
    expect(
      run(`print(GetDistanceBetweenCoords(0.0, 0.0, 0.0, 3.0, 4.0, 12.0, true), GetDistanceBetweenCoords(0.0, 0.0, 0.0, 3.0, 4.0, 12.0, false))
print(Vdist(1.0, 1.0, 1.0, 4.0, 5.0, 1.0), Vdist2(1.0, 1.0, 1.0, 4.0, 5.0, 1.0), Vmag(3.0, 4.0, 0.0), Vmag2(3.0, 4.0, 0.0))`),
    ).toEqual(['13.0\t5.0', '5.0\t25.0\t5.0\t25.0'])
    expect(client.diagnostics).toEqual([])
  })

  it('takes and gives angles in degrees, with headings from north, anticlockwise', async () => {
    const { run, client } = await clientOf()
    expect(
      run(`print(Cos(60.0), Sin(30.0), Tan(45.0), Acos(0.0), Asin(1.0), Atan(1.0), Atan2(1.0, 1.0))
print(GetHeadingFromVector_2d(0.0, 1.0), GetHeadingFromVector_2d(-1.0, 0.0), GetHeadingFromVector_2d(0.0, -1.0), GetHeadingFromVector_2d(1.0, 0.0))
print(GetAngleBetween_2dVectors(1.0, 0.0, 0.0, 1.0), GetAngleBetween_2dVectors(0.0, 0.0, 1.0, 0.0))`),
    ).toEqual(['0.5\t0.5\t1.0\t90.0\t90.0\t45.0\t45.0', '0.0\t90.0\t180.0\t270.0', '90.0\t0.0'])
    expect(client.diagnostics).toEqual([])
  })

  it('rounds halves away from zero, and shifts bits', async () => {
    const { run, client } = await clientOf()
    expect(
      run(`print(Round(2.5), Round(-2.5), Round(2.4), Floor(2.9), Floor(-2.1), Ceil(2.1), Absi(-3), Absf(-1.5), Sqrt(16.0), Pow(2.0, 10.0))
print(ShiftLeft(1, 4), ShiftRight(256, 4))`),
    ).toEqual(['3\t-3\t2\t2\t-3\t3\t3\t1.5\t4.0\t1024.0', '16\t16'])
    expect(client.diagnostics).toEqual([])
  })
})

describe('The random numbers of GTA V on clients', () => {
  it('fall in their ranges, of which the end is left out, and start the same on every run', async () => {
    const script = `local inside, seen = true, {}
for _ = 1, 2000 do
    local value = GetRandomIntInRange(1, 4)
    inside = inside and value >= 1 and value < 4
    seen[value] = true
    local float = GetRandomFloatInRange(-2.0, 2.0)
    inside = inside and float >= -2.0 and float < 2.0
end
print(inside, seen[1], seen[2], seen[3], GetRandomIntInRange(5, 5))
print(GetRandomIntInRange(0, 1000000))`
    const first = await clientOf()
    const second = await clientOf()
    const lines = first.run(script)
    expect(lines[0]).toBe('true\ttrue\ttrue\ttrue\t5')
    expect(second.run(script)).toEqual(lines)
  })

  it('follow the seeds that scripts set', async () => {
    const { run } = await clientOf()
    const [same, other] = run(`SetRandomSeed(42)
local first = GetRandomIntInRange(0, 1000000)
SetRandomSeed(42)
print(first == GetRandomIntInRange(0, 1000000))
SetRandomSeed(0)
print(GetRandomIntInRange(0, 1000000) ~= first)`)
    expect([same, other]).toEqual(['true', 'true'])
  })
})

describe('The time of clients', () => {
  it('gives the wall clock, in the time zone of the machine', async () => {
    const zone = { offset: () => 120, standardOffset: 120, dstBias: 0, names: ['X', 'Y'] } as const
    const client = await createProcess({
      side: 'client',
      wallClock: () => Date.UTC(2026, 9, 31, 22, 5, 7),
      timeZone: zone,
    })
    client
      .add('run', {
        'fxmanifest.lua': `fx_version 'cerulean'\ngame 'gta5'\nclient_script 'main.lua'`,
        'main.lua': `print(GetLocalTime())
print(GetTimeDifference(5000, 2000), GetTimeOffset(5000, 2000))`,
      })
      .start()
    expect(client.take().filter((line) => line.startsWith('[script:run] '))).toEqual([
      '[script:run] 2026\t11\t1\t0\t5\t7',
      '[script:run] 3000\t7000',
    ])
  })
})

describe('What only players of the game would see', () => {
  it('does nothing without a diagnosis, where natives that matter tell they do nothing', async () => {
    const { run, client } = await clientOf()
    run(`SetTextFont(4)
SetTextScale(0.35, 0.35)
BeginTextCommandDisplayText('STRING')
AddTextComponentSubstringPlayerName('Hi')
EndTextCommandDisplayText(0.5, 0.5)
DrawLine(0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 255, 0, 0, 255)
UseParticleFxAsset('core')
PlaySoundFrontend(-1, 'SELECT', 'HUD_FRONTEND_DEFAULT_SOUNDSET', true)
print(GetShapeTestResult(StartShapeTestRay(0.0, 0.0, 0.0, 1.0, 1.0, 1.0, -1, 0, 7)))`)
    expect(client.diagnostics).toEqual([])
    run(`TaskGoStraightToCoord(PlayerPedId(), 1.0, 1.0, 1.0, 1.0, -1, 0.0, 0.0)`)
    expect(client.diagnostics).toEqual([
      'run1: TaskGoStraightToCoord is not implemented in FiveRunner yet: it does nothing and returns zero values.',
    ])
  })

  it('has names that the catalog of natives has', () => {
    expect(unknownSilentNames()).toEqual([])
  })

  it('leaves out the natives that peds do tasks with, and natives of no family', () => {
    const hashOf = (name: string) =>
      catalogNatives('client').find((native) => native.luaName === name)!.hash
    expect(silentNative(hashOf('DrawMarker'))).toBe(true)
    expect(silentNative(hashOf('TaskGoStraightToCoord'))).toBe(false)
    expect(silentNative(hashOf('GetVehicleCauseOfDestruction'))).toBe(false)
  })

  it('says nothing of the HUD, the traffic and the models of the game, which FiveRunner has none of, as ESX asks of them as it starts', () => {
    const hashOf = (name: string) =>
      catalogNatives('client').find((native) => native.luaName === name)!.hash
    expect(
      [
        'SetHudComponentPosition',
        'SetHudComponentSize',
        'HideHudComponentThisFrame',
        'SetAmbientVehicleRangeMultiplierThisFrame',
        'SetVehicleDensityMultiplierThisFrame',
        'SetPedDensityMultiplierThisFrame',
        'NetworkSetLocalPlayerSyncLookAt',
        'SetDefaultVehicleNumberPlateTextPattern',
        'GetAllVehicleModels',
      ].filter((name) => !silentNative(hashOf(name))),
    ).toEqual([])
  })
})
