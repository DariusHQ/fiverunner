import { describe, expect, it } from 'vitest'

import { clientOf } from './helpers.ts'

describe('The appearance of the peds of clients', () => {
  it('is what scripts set, which they read back as appearance resources save skins', async () => {
    const { run, client } = await clientOf()
    expect(
      run(`local ped = PlayerPedId()
print(GetPedDrawableVariation(ped, 11), GetPedPropIndex(ped, 0), GetPedPropTextureIndex(ped, 0), GetPedHeadOverlayValue(ped, 1), GetPedHairColor(ped), GetPedEyeColor(ped), GetPedFaceFeature(ped, 3))
SetPedComponentVariation(ped, 11, 4, 2, 0)
SetPedPropIndex(ped, 0, 7, 1, true)
SetPedHeadOverlay(ped, 1, 3, 0.5)
SetPedHeadOverlayColor(ped, 1, 1, 12, 13)
SetPedHairColor(ped, 5, 6)
SetPedEyeColor(ped, 8)
SetPedFaceFeature(ped, 3, 0.25)
SetPedHeadBlendData(ped, 21, 2, 0, 3, 4, 0, 0.5, 0.75, 0.0, false)
print(GetPedDrawableVariation(ped, 11), GetPedTextureVariation(ped, 11), GetPedPaletteVariation(ped, 11), GetPedPropIndex(ped, 0), GetPedPropTextureIndex(ped, 0))
print(GetPedHeadOverlayData(ped, 1))
print(GetPedHairColor(ped), GetPedHairHighlightColor(ped), GetPedEyeColor(ped), GetPedFaceFeature(ped, 3))
print(Citizen.InvokeNative(0x2746BD9D88C5C5D0, ped, Citizen.PointerValueIntInitialized(0), Citizen.PointerValueIntInitialized(0), Citizen.PointerValueIntInitialized(0), Citizen.PointerValueIntInitialized(0), Citizen.PointerValueIntInitialized(0), Citizen.PointerValueIntInitialized(0), Citizen.PointerValueFloatInitialized(0), Citizen.PointerValueFloatInitialized(0), Citizen.PointerValueFloatInitialized(0)))
ClearPedProp(ped, 0)
SetPedDefaultComponentVariation(ped)
print(GetPedPropIndex(ped, 0), GetPedDrawableVariation(ped, 11), GetPedHairColor(2), GetPedHeadOverlayValue(2, 1))`),
    ).toEqual([
      // A new ped has the first variation of its components, no props and no head overlays.
      '0\t-1\t-1\t255\t0\t0\t0.0',
      '4\t2\t0\t7\t1',
      '1\t3\t1\t12\t13\t0.5',
      '5\t6\t8\t0.25',
      '21\t2\t0\t3\t4\t0\t0.5\t0.75\t0.0',
      '-1\t0\t-1\t255',
    ])
    expect(client.diagnostics).toEqual([])
  })

  it('have as many variations as the freemode models about have, and of other models one of each component', async () => {
    const test = await clientOf()
    const counts = `GetNumberOfPedDrawableVariations(ped, 11), GetNumberOfPedTextureVariations(ped, 11, 0), GetNumberOfPedTextureVariations(ped, 11, 1), GetNumberOfPedPropDrawableVariations(ped, 0), GetNumberOfPedPropTextureVariations(ped, 0, 0), IsPedMale(ped)`
    const lines = test.run(`local ped = PlayerPedId()
print(${counts})
print(GetPedHeadOverlayNum(1), GetPedHeadOverlayNum(12), GetPedHeadOverlayNum(13), GetNumHairColors(), GetNumMakeupColors(), GetNumberOfPedDrawableVariations(2, 11), IsPedMale(2))
print(GetPedHairRgbColor(0))
print(GetPedHairRgbColor(63))
print(GetPedMakeupRgbColor(3))
print(GetPedMakeupRgbColor(64))
local female = GetHashKey('mp_f_freemode_01')
RequestModel(female)
CreateThread(function()
    while not HasModelLoaded(female) do Wait(0) end
    SetPlayerModel(PlayerId(), female)
    ped = PlayerPedId()
    print(${counts})
    print(GetNumberOfPedTextureVariations(ped, 11, 399), GetNumberOfPedTextureVariations(ped, 11, 400), GetNumberOfPedTextureVariations(ped, 11, -1), GetNumberOfPedPropDrawableVariations(ped, 3), GetNumberOfPedPropDrawableVariations(ped, 7), GetNumberOfPedDrawableVariations(ped, 12))
end)`)
    test.client.tickAt(test.client.time + 10)
    lines.push(
      ...test.client
        .take()
        .filter((line) => line.startsWith('[script:run0] '))
        .map((line) => line.slice('[script:run0] '.length)),
    )
    expect(lines).toEqual([
      // player_zero has one drawable of each component, of one texture, and no props.
      '1\t1\t0\t0\t0\t1',
      '29\t2\t0\t64\t64\t0\tfalse',
      // FiveRunner's own colours: black hair, white hair, a red of makeup, and none past the last.
      '10\t8\t7',
      '243\t243\t241',
      '184\t35\t58',
      '0\t0\t0',
      '400\t10\t10\t180\t10\tfalse',
      '10\t0\t0\t0\t15\t0',
    ])
    expect(test.client.diagnostics).toEqual([])
  })

  it('play the anims of loaded anim dicts, on their tasks, until they end or are stopped', async () => {
    const test = await clientOf()
    const lines = test.run(`local ped = PlayerPedId()
local playing = function(dict, name) return IsEntityPlayingAnim(ped, dict, name, 3) end
TaskPlayAnim(ped, 'mp_arresting', 'idle', 8.0, -8.0, -1, 49, 0, false, false, false)
TaskPlayAnim(ped, 'mp_arresting', 'idle', 8.0, -8.0, -1, 49, 0, false, false, false)
print(playing('mp_arresting', 'idle'))
RequestAnimDict('mp_arresting')
RequestAnimDict('missminuteman_1ig_2')
CreateThread(function()
    while not HasAnimDictLoaded('missminuteman_1ig_2') do Wait(0) end
    -- Upper body and secondary, looping; then once, on the task of the ped.
    TaskPlayAnim(ped, 'mp_arresting', 'idle', 8.0, -8.0, -1, 49, 0, false, false, false)
    TaskPlayAnim(ped, 'missminuteman_1ig_2', 'handsup_enter', 8.0, 8.0, -1, 0, 0, false, false, false)
    print(playing('MP_ARRESTING', 'IDLE'), playing('missminuteman_1ig_2', 'handsup_enter'), playing('mp_arresting', 'other'))
    Wait(1000)
    print(playing('mp_arresting', 'idle'), playing('missminuteman_1ig_2', 'handsup_enter'))
    TaskPlayAnim(ped, 'missminuteman_1ig_2', 'handsup_base', 8.0, 8.0, 500, 1, 0, false, false, false)
    ClearPedSecondaryTask(ped)
    print(playing('mp_arresting', 'idle'), playing('missminuteman_1ig_2', 'handsup_base'))
    Wait(500)
    print(playing('missminuteman_1ig_2', 'handsup_base'))
    -- Holding its last frame, it plays until it is stopped.
    TaskPlayAnim(ped, 'mp_arresting', 'idle', 8.0, -8.0, -1, 2, 0, false, false, false)
    StopAnimTask(ped, 'mp_arresting', 'other', 1.0)
    print(playing('mp_arresting', 'idle'))
    StopAnimTask(ped, 'mp_arresting', 'idle', 1.0)
    print(playing('mp_arresting', 'idle'))
    local adder = GetHashKey('adder')
    RequestModel(adder)
    while not HasModelLoaded(adder) do Wait(0) end
    local car = CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, false, false)
    SetPedIntoVehicle(ped, car, -1)
    TaskPlayAnim(ped, 'mp_arresting', 'idle', 8.0, -8.0, -1, 49, 0, false, false, false)
    ClearPedTasks(ped)
    print(playing('mp_arresting', 'idle'), IsPedInAnyVehicle(ped, false), IsPedInAnyHeli(ped), IsPedInAnyPlane(ped))
    TaskPlayAnim(ped, 'mp_arresting', 'idle', 8.0, -8.0, -1, 1, 0, false, false, false)
    ClearPedTasksImmediately(ped)
    print(playing('mp_arresting', 'idle'), IsPedInAnyVehicle(ped, false), IsEntityPlayingAnim(car, 'mp_arresting', 'idle', 3))
end)`)
    const start = test.client.time
    for (const step of [10, 1010, 1520, 1530]) test.client.tickAt(start + step)
    lines.push(
      ...test.client
        .take()
        .filter((line) => line.startsWith('[script:run0] '))
        .map((line) => line.slice('[script:run0] '.length)),
    )
    expect(lines).toEqual([
      'false',
      '1\t1\tfalse',
      '1\tfalse',
      'false\t1',
      'false',
      '1',
      'false',
      'false\t1\tfalse\tfalse',
      'false\tfalse\tfalse',
    ])
    // Once for each anim dict, of those that scripts play clips of without loading them.
    expect(test.client.diagnostics).toEqual([
      'run0: TaskPlayAnim was given the anim dict mp_arresting, which is not loaded, so the ped played nothing, as in GTA V: request it with RequestAnimDict, then wait until HasAnimDictLoaded says it loaded.',
    ])
  })

  it('are of new peds as SetPlayerModel gives players them, whose old handles name nothing', async () => {
    const { run, client } = await clientOf()
    const lines = run(`local old = PlayerPedId()
local skater = GetHashKey('a_m_y_skater_01')
SetPlayerModel(PlayerId(), skater)
print(PlayerPedId() == old)
SetPedComponentVariation(old, 11, 4, 2, 0)
SetEntityHealth(old, 150)
RequestModel(skater)
CreateThread(function()
    while not HasModelLoaded(skater) do Wait(0) end
    SetPlayerModel(PlayerId(), skater)
    local ped = PlayerPedId()
    print(ped == old, DoesEntityExist(old), GetEntityModel(ped) == skater, GetPedDrawableVariation(ped, 11), GetEntityHealth(ped), IsModelAPed(skater))
end)`)
    client.tickAt(client.time + 10)
    lines.push(
      ...client
        .take()
        .filter((line) => line.startsWith('[script:run0] '))
        .map((line) => line.slice('[script:run0] '.length)),
    )
    expect(lines).toEqual(['true', 'false\tfalse\ttrue\t0\t200\t1'])
    expect(client.diagnostics).toEqual([
      'run0: SetPlayerModel was given a model that is not loaded, so the player kept its ped, as GTA V does: request it with RequestModel, then wait until HasModelLoaded says it loaded.',
    ])
  })
})
