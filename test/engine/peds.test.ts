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
