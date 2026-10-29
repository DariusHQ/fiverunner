import { describe, expect, it } from 'vitest'

import { clientOf } from './helpers.ts'

describe('Assets that clients stream in', () => {
  it('exist but for those of no name or of hash 0, and load at the next tick once scripts request them, which they stay', async () => {
    const test = await clientOf()
    const loaded = `HasAnimDictLoaded('missheist'), HasAnimSetLoaded('missheist'), HasClipSetLoaded('move_m@drunk'), HasStreamedTextureDictLoaded('CommonMenu'), HasNamedPtfxAssetLoaded('core'), HasWeaponAssetLoaded(GetHashKey('weapon_pistol')), HasAnimDictLoaded(''), HasWeaponAssetLoaded(0)`
    const now = test.run(`RequestAnimDict('MissHeist')
RequestClipSet('move_m@drunk')
RequestStreamedTextureDict('commonmenu', false)
RequestNamedPtfxAsset('core')
RequestWeaponAsset(GetHashKey('weapon_pistol'), 31, 0)
RequestAnimDict('')
RequestWeaponAsset(0, 31, 0)
print(${loaded})
print(DoesAnimDictExist('missheist'), DoesAnimDictExist(''))
CreateThread(function()
    print(${loaded})
    RemoveAnimDict('missheist')
    print(HasAnimDictLoaded('MISSHEIST'))
end)`)
    test.client.tickAt(test.client.time + 10)
    const next = test.client
      .take()
      .filter((line) => line.startsWith('[script:run0] '))
      .map((line) => line.slice('[script:run0] '.length))
    expect([now, next]).toEqual([
      ['false\tfalse\tfalse\tfalse\tfalse\tfalse\tfalse\tfalse', '1\tfalse'],
      ['1\tfalse\t1\t1\t1\t1\tfalse\tfalse', '1'],
    ])
    expect(test.client.diagnostics).toEqual([])
  })

  it('include the interior placements of the map that scripts request, until they remove them', async () => {
    const { run } = await clientOf()
    expect(
      run(`RequestIpl('Bh1_47_Joshhse_UnBurnt')
RequestIpl('')
print(IsIplActive('bh1_47_joshhse_unburnt'), IsIplActive('bh1_47_joshhse_burnt'), IsIplActive(''))
RemoveIpl('BH1_47_JOSHHSE_UNBURNT')
print(IsIplActive('bh1_47_joshhse_unburnt'))`),
    ).toEqual(['1\tfalse\tfalse', 'false'])
  })
})

describe('Natives of the game that FiveRunner has no game for', () => {
  it('do nothing without a diagnosis, and give what a game with nothing of theirs gives', async () => {
    const test = await clientOf({ gameBuild: 2944 })
    expect(
      test.run(`SetPedDensityMultiplierThisFrame(0.0)
SetDiscordAppId('123')
DisplayRadar(false)
SetAudioFlag('PoliceScannerDisabled', true)
ShutdownLoadingScreenNui()
DrawMarker(1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 255, 0, 0, 255, false, false, 2, false, nil, nil, false)
SetEntityInvincible(PlayerPedId(), true)
DrawRect(0.5, 0.5, 0.1, 0.1, 255, 0, 0, 255, false)
SetScriptGfxDrawOrder(4)
SetTextRenderId(1)
SetUseHiDof()
StopAllAlarms(true)
HudWeaponWheelIgnoreSelection()
DisablePlayerVehicleRewards(PlayerId())
TaskStandStill(PlayerPedId(), -1)
NetworkSetFriendlyFireOption(true)
SetCanAttackFriendly(PlayerPedId(), true, false)
SetFuelConsumptionRateMultiplier(10.0)
HideHudAndRadarThisFrame()
DisablePlayerFiring(PlayerId(), true)
SetPlayerHealthRechargeMultiplier(PlayerId(), 0.0)
SetPlayerHealthRechargeLimit(PlayerId(), 0.5)
print(IsPauseMenuActive(), GetAspectRatio(false), StartAudioScene('x'), RequestScriptAudioBank('x', false, -1), IsPedBeingStunned(PlayerPedId(), 0))
print(CreateAudioSubmix('a'), CreateAudioSubmix('b'), GetGameBuildNumber(), PrepareAlarm('x'), GetDisplayNameFromVehicleModel(GetHashKey('adder')))
print(GetPedParachuteState(PlayerPedId()), IsEntityInWater(PlayerPedId()), GetPlayerSprintStaminaRemaining(PlayerId()), IsPlayerSwitchInProgress(), IsPlayerTeleportActive())
print(IsPedSwimming(PlayerPedId()), TriggerScreenblurFadeIn(50.0), IsScreenblurFadeRunning(), TriggerScreenblurFadeOut(50.0))`),
    ).toEqual([
      'false\t1.7777777910233\t1\t1\tfalse',
      '0\t1\t2944\t1\tCARNOTFOUND',
      '-1\tfalse\t0.0\tfalse\tfalse',
      'false\t1\tfalse\t1',
    ])
    expect(test.client.diagnostics).toEqual([])
  })
})
