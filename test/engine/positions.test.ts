import { describe, expect, it } from 'vitest'

import { clientOf } from './helpers.ts'

/** What a script prints on a client, once the model `adder` loaded. */
async function withModel(script: string) {
  const test = await clientOf()
  test.run(`local adder = GetHashKey('adder')
RequestModel(adder)
CreateThread(function()
    while not HasModelLoaded(adder) do Wait(0) end
    local ped = PlayerPedId()
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

describe('Entities attached to others on clients', () => {
  it('go where those go, at their offsets, until they are detached or those are deleted', async () => {
    const { lines, diagnostics } =
      await withModel(`local car = CreateVehicle(adder, 10.0, 0.0, 0.0, 0.0, false, false)
    local box = CreateObject(adder, 0.0, 0.0, 0.0, false, false, false)
    SetEntityHeading(car, 90.0)
    print(IsEntityAttached(box), GetEntityAttachedTo(box))
    AttachEntityToEntity(box, car, 0, 0.0, 2.0, 1.0, 0.0, 0.0, 0.0, false, false, false, false, 2, true)
    print(IsEntityAttached(box), IsEntityAttachedToEntity(box, car), IsEntityAttachedToAnyVehicle(box), IsEntityAttachedToAnyPed(box), GetEntityAttachedTo(box) == car)
    print(GetEntityCoords(box))
    SetEntityCoords(car, 100.0, 0.0, 0.0, false, false, false, false)
    print(GetEntityCoords(box))
    DetachEntity(box, true, true)
    SetEntityCoords(car, 200.0, 0.0, 0.0, false, false, false, false)
    print(GetEntityCoords(box), IsEntityAttached(box))
    AttachEntityToEntity(box, car, 0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, false, false, false, false, 2, true)
    DeleteEntity(car)
    print(IsEntityAttached(box))`)
    expect(lines).toEqual([
      'false\t0',
      '1\t1\t1\tfalse\ttrue',
      // A heading of 90 turns the y of the offset to the west.
      'vec3(8.000000, 0.000000, 1.000000)',
      'vec3(98.000000, 0.000000, 1.000000)',
      'vec3(98.000000, 0.000000, 1.000000)\tfalse',
      'false',
    ])
    expect(diagnostics).toEqual([])
  })

  it('do not go round, as GTA V keeps entities from it', async () => {
    const { lines, diagnostics } =
      await withModel(`local a = CreateObject(adder, 0.0, 0.0, 0.0, false, false, false)
    local b = CreateObject(adder, 1.0, 0.0, 0.0, false, false, false)
    AttachEntityToEntity(a, b, 0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, false, false, false, false, 2, true)
    AttachEntityToEntity(b, a, 0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, false, false, false, false, 2, true)
    print(IsEntityAttached(a), IsEntityAttached(b))
    SetEntityCoords(b, 5.0, 0.0, 0.0, false, false, false, false)
    print(GetEntityCoords(a))`)
    expect(lines).toEqual(['1\tfalse', 'vec3(5.000000, 0.000000, 0.000000)'])
    expect(diagnostics).toEqual([])
  })
})

describe('Where things are on clients', () => {
  it('has every entity with all its bones, where it is', async () => {
    const { lines, diagnostics } =
      await withModel(`SetEntityCoords(ped, 1.0, 2.0, 3.0, false, false, false, false)
    SetEntityHeading(ped, 90.0)
    print(GetPedBoneIndex(ped, 57005), GetEntityBoneIndexByName(ped, 'boot'), GetEntityBoneIndexByName(0, 'boot'))
    print(GetWorldPositionOfEntityBone(ped, 0), GetPedBoneCoords(ped, 0, 0.0, 1.0, 0.0))`)
    expect(lines).toEqual([
      '57005\t0\t-1',
      'vec3(1.000000, 2.000000, 3.000000)\tvec3(0.000000, 2.000000, 3.000000)',
    ])
    expect(diagnostics).toEqual([])
  })

  it('gives the axes of entities, and offsets from them, the other way', async () => {
    const { lines, diagnostics } =
      await withModel(`SetEntityCoords(ped, 10.0, 0.0, 0.0, false, false, false, false)
    SetEntityHeading(ped, 90.0)
    print(GetEntityMatrix(ped))
    print(GetOffsetFromEntityGivenWorldCoords(ped, 10.0, 3.0, 0.0))`)
    expect(lines).toEqual([
      'vec3(-1.000000, 0.000000, 0.000000)\tvec3(0.000000, 1.000000, 0.000000)\tvec3(0.000000, 0.000000, 1.000000)\tvec3(10.000000, 0.000000, 0.000000)',
      'vec3(3.000000, 0.000000, 0.000000)',
    ])
    expect(diagnostics).toEqual([])
  })

  it('finds the closest entities of those that are near, and has the ground where scripts ask', async () => {
    const { lines, diagnostics } =
      await withModel(`local far = CreateVehicle(adder, 30.0, 0.0, 0.0, 0.0, false, false)
    local near = CreateVehicle(adder, 10.0, 0.0, 0.0, 0.0, false, false)
    local stranger = CreatePed(4, adder, 5.0, 0.0, 0.0, 0.0, false, false)
    print(GetClosestVehicle(0.0, 0.0, 0.0, 50.0, 0, 70) == near, GetClosestVehicle(25.0, 0.0, 0.0, 50.0, adder, 70) == far, GetClosestVehicle(0.0, 0.0, 0.0, 50.0, 1, 70), GetClosestVehicle(0.0, 0.0, 0.0, 5.0, 0, 70))
    local found, closest = GetClosestPed(0.0, 0.0, 0.0, 50.0, true, true, 0, false, false, -1)
    print(found, closest == stranger)
    print(IsAnyVehicleNearPoint(0.0, 0.0, 0.0, 15.0), IsAnyVehicleNearPoint(0.0, 0.0, 0.0, 5.0))
    print(GetGroundZFor_3dCoord(1.0, 2.0, 35.5, false))`)
    expect(lines).toEqual(['true\ttrue\t0\t0', '1\ttrue', '1\tfalse', '1\t35.5'])
    expect(diagnostics).toEqual([])
  })

  it('keeps how entities look and what the player can do, as scripts set them', async () => {
    const { lines, diagnostics } =
      await withModel(`print(GetEntityAlpha(ped), GetEntityCollisionDisabled(ped), GetPlayerInvincible(PlayerId()), IsPlayerControlOn(PlayerId()))
    SetEntityAlpha(ped, 51, false)
    SetEntityCollision(ped, false, false)
    SetPlayerInvincible(PlayerId(), true)
    SetPlayerControl(PlayerId(), false, 0)
    print(GetEntityAlpha(ped), GetEntityCollisionDisabled(ped), GetPlayerInvincible(PlayerId()), IsPlayerControlOn(PlayerId()))
    ResetEntityAlpha(ped)
    print(GetEntityAlpha(ped), IsPedOnFoot(ped), IsPedArmed(ped, 7))
    GiveWeaponToPed(ped, GetHashKey('weapon_pistol'), 10, false, true)
    print(IsPedArmed(ped, 7))`)
    expect(lines).toEqual(['255\tfalse\tfalse\t1', '51\t1\t1\tfalse', '255\t1\tfalse', '1'])
    expect(diagnostics).toEqual([])
  })
})

describe('The assets that scripts wait for on clients', () => {
  it('include movies of scaleform, which load at the next tick', async () => {
    const test = await clientOf()
    expect(
      test.run(`local movie = RequestScaleformMovie('minimap')
print(movie > 0, HasScaleformMovieLoaded(movie), HasScaleformMovieLoaded(99))
CreateThread(function()
    print(HasScaleformMovieLoaded(movie), HasScaleformMovieFilenameLoaded('MINIMAP'))
    print(SetScaleformMovieAsNoLongerNeeded(movie))
end)`),
    ).toEqual(['true\tfalse\tfalse'])
    test.client.tickAt(test.client.time + 10)
    expect(
      test.client
        .take()
        .filter((line) => line.startsWith('[script:run0] '))
        .map((line) => line.slice('[script:run0] '.length)),
    ).toEqual(['1\t1', '0'])
    expect(test.client.diagnostics).toEqual([])
  })

  it('include interiors, audio banks, the textures of ropes and headshots, which are ready at once', async () => {
    const { run, client } = await clientOf()
    expect(
      run(`RopeLoadTextures()
print(IsInteriorReady(0), RequestAmbientAudioBank('DLC', false), HasPtfxAssetLoaded(), RopeAreTexturesLoaded())
local shot = RegisterPedheadshot(PlayerPedId())
print(IsPedheadshotReady(shot), IsPedheadshotValid(shot), GetPedheadshotTxdString(shot))`),
    ).toEqual(['1\t1\t1\t1', '1\t1\tCHAR_DEFAULT'])
    expect(client.diagnostics).toEqual([])
  })
})

describe('Models that FiveRunner knows of on clients', () => {
  it('include the peds of the default maps of FXServer, as spawnmanager asks', async () => {
    const { run, client } = await clientOf()
    expect(
      run(
        `print(IsModelAPed(GetHashKey('a_m_y_skater_01')), IsModelAPed(GetHashKey('a_m_y_hipster_02')), IsModelAVehicle(GetHashKey('a_m_y_skater_01')))`,
      ),
    ).toEqual(['1\t1\tfalse'])
    expect(client.diagnostics).toEqual([])
  })
})

describe('Tasks of peds on clients', () => {
  it('that seat, unseat or turn them happen at once', async () => {
    const { lines, diagnostics } =
      await withModel(`local car = CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, false, false)
    TaskEnterVehicle(ped, car, -1, -1, 1.0, 1, 0)
    print(GetPedInVehicleSeat(car, -1, false) == ped)
    TaskEveryoneLeaveVehicle(car)
    print(IsPedInAnyVehicle(ped, false))
    SetEntityCoords(ped, 0.0, 0.0, 0.0, false, false, false, false)
    TaskTurnPedToFaceCoord(ped, 0.0, -10.0, 0.0, 1000)
    print(GetEntityHeading(ped))
    TaskTurnPedToFaceEntity(ped, car, 1000)
    SetEntityCoords(car, 10.0, 0.0, 0.0, false, false, false, false)
    TaskTurnPedToFaceEntity(ped, car, 1000)
    print(GetEntityHeading(ped))`)
    expect(lines).toEqual(['true', 'false', '180.0', '270.0'])
    expect(diagnostics).toEqual([])
  })
})
