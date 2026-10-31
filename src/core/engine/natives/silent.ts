import { catalogNatives } from '../../natives/index.ts'
import type { NativeContext } from '../context.ts'

/**
 * Families of natives by their names in Lua, of what only a player of the
 * game sees or hears, or of how peds fight and move: FiveRunner draws none
 * of it, nothing depends on it, and its natives give what a game with
 * nothing of theirs gives: nothing, and zero values. Unimplemented natives
 * say so, which here would hide those that matter.
 */
const FAMILIES: readonly RegExp[] = [
  // What scripts draw.
  /^Draw|^(Set|Clear)DrawOrigin$|^(Set|Reset)ScriptGfx|^SetEntityDrawOutline/,
  /^SetText[A-Z]|^HideHelpText|^Thefeed|^AddTextComponentSubstring(Keyboard|Time|Website|Phone)/,
  /^(Begin|End)TextCommand(Display|Print|Is|Thefeed|Scaleform|GetWidth|LineCount|Clear|Over)/,
  /ScaleformMovie(Method|Function)|^(Push|Pop|Call|Begin|End)Scaleform/,
  /^(Add|Remove)(Replace)?Texture|^CreateRuntimeT|^SetMinimap|^SetRadarZoom|^SetBigmap/,
  /^(Lock|Unlock)Minimap|MpGamerTag/,
  /^(ShowHeadingIndicator|ShowNumber|HideNumber)OnBlip$|^PulseBlip$|^SetBlip(Show|Bright|Flash|High)/,
  // Effects on the screen and of the camera.
  /ParticleFx|Ptfx|^Animpostfx|Timecycle|^(Set)?Nightvision|^(Set)?Seethrough|^SetFlash$/,
  /^Shake|^StopGameplayCamShaking$|^IsGameplayCamShaking$|^StopCinematicShot$/,
  // What players hear.
  /^PlaySound|^StopSound|^ReleaseSound|^PlayPain|^PlayPedAmbient|^PlayAmbientSpeech|^StopPedSpeaking/,
  /^StopCurrentPlayingSpeech|^SetAudio|^SetVehRadio|^SetRadio|^SetUserRadio|^SetFrontendRadio/,
  /^SetVehicleRadio|^SetMobile|^StartVehicleHorn|^SetHornEnabled|^PrepareAlarm|^TriggerMusicEvent/,
  /^PlayStreamFrom|^StopStream/,
  // How peds fight, move and look, which nothing does.
  /^SetPed(Combat|Flee|Relationship|Hearing|Seeing|Accuracy|Firing|ShootRate|Alertness|KeepTask)/,
  /^SetPed(PathCan|CanPlay|CanRagdoll|CanBe|CanUse|CanEvasive|CanSwitch|MoveRate|Stealth|Strafe)/,
  /^SetPed(Movement|WeaponMovement)Clipset|^ResetPed(Movement|Weapon|Strafe|Stealth)/,
  /^SetPed(MinGround|MaxTimeUnderwater|Drops|Lod|SuffersCritical|Dies|As(Cop|Enemy|GroupMember))/,
  /^SetPedToRagdoll|^SetBlockingOfNonTemporaryEvents|^ClearPed(Blood|Decorations|Damage|Wetness)/,
  /^ClearPed(EnvDirt|LastWeaponDamage)|^ResetPedVisibleDamage/,
  // What players can do that nothing checks.
  /^Set(Player|Swim|Run)[A-Za-z]*(Multiplier|Stamina)|^SetPlayerParachute|^SetPlayerCanLeave/,
  // Ropes, which nothing swings, and the phones, the recordings and the pause menu of the game.
  /Rope(?!AreTexturesLoaded)|^(Create|Destroy)MobilePhone|^CellCam|Recording|RockstarEditor/,
  /HighQualityPhoto|^Set(Frontend|PauseMenu)Active|^SetCursorLocation/,
]

/** Natives that are no family, of the same kinds, by their names in Lua. */
const NAMES: readonly string[] = [
  // Vehicles, of what no one sees.
  'SetVehicleHasBeenOwnedByPlayer',
  'SetVehicleNeedsToBeHotwired',
  'SetVehicleDeformationFixed',
  'WashDecalsFromVehicle',
  'SetVehicleAutoRepairDisabled',
  'SetVehicleBoostActive',
  'SetVehicleCheatPowerIncrease',
  'SetOverrideNitrousLevel',
  'SetVehicleSteeringScale',
  'SetVehicleSearchlight',
  'SetVehicleCurrentRpm',
  'SetVehicleForwardSpeed',
  'SetVehicleBrake',
  'SetVehicleBrakeLights',
  'SetVehicleBurnout',
  'SetVehicleAlarmTimeLeft',
  'GetVehicleClass',
  'GetVehicleCurrentGear',
  'GetVehicleCurrentRpm',
  'GetVehicleAcceleration',
  'GetVehicleSteeringAngle',
  'GetModTextLabel',
  'GetModSlotName',
  'GetLiveryName',
  'SetNetworkIdCanMigrate',
  'SetNetworkIdExistsOnAllMachines',
  'NetworkUseHighPrecisionBlending',
  'NetworkSetEntityInvisibleToNetwork',
  'NetworkSetInSpectatorMode',
  'NetworkIsInSpectatorMode',
  // Players and peds.
  'SetPoliceIgnorePlayer',
  'SetEveryoneIgnorePlayer',
  'RestorePlayerStamina',
  'SetPlayerSprint',
  'SetPlayerCanDoDriveBy',
  'ClearPlayerWantedLevel',
  'SetLocalPlayerVisibleLocally',
  'SetEnableScuba',
  'SetPedHelmet',
  'SetPedRandomComponentVariation',
  'ClearEntityLastDamageEntity',
  'GetPedType',
  'GetPedSourceOfDeath',
  'GetPedLastDamageBone',
  'IsPedUsingScenario',
  'IsPedInMeleeCombat',
  'IsPedSwimmingUnderWater',
  'HasPedBeenDamagedByWeapon',
  'IsPedDoingDriveby',
  'IsPedInParachuteFreeFall',
  'IsPlayerFreeAiming',
  'IsPlayerTargettingEntity',
  'GetEntityPlayerIsFreeAimingAt',
  'GetCurrentPedWeaponEntityIndex',
  'NetworkGetEntityKillerOfPlayer',
  'GetIsTaskActive',
  // The world, which has no physics, no map and no fires.
  'ActivatePhysics',
  'ApplyForceToEntity',
  'SetEntityCompletelyDisableCollision',
  'SetEntityVelocity',
  'GetEntityHeightAboveGround',
  'HasEntityClearLosToEntity',
  'HasEntityCollidedWithAnything',
  'IsPositionOccupied',
  'IsObjectNearPoint',
  'ClearAreaOfObjects',
  'ClearAreaOfVehicles',
  'GetModelDimensions',
  'GetZoneAtCoords',
  'StartScriptFire',
  'RemoveScriptFire',
  'AddExplosion',
  'NewLoadSceneStart',
  'NewLoadSceneStop',
  'IsNewLoadSceneActive',
  'IsNetworkLoadingScene',
  'NetworkUpdateLoadScene',
  'SetFocusEntity',
  'SetFocusPosAndVel',
  'EnableExteriorCullModelThisFrame',
  'DisableOcclusionThisFrame',
  'CreateScriptVehicleGenerator',
  'SetScriptVehicleGenerator',
  'DeleteScriptVehicleGenerator',
  'SetAllVehicleGeneratorsActive',
  'CreatePickupRotate',
  'RemovePickup',
  'HasPickupBeenCollected',
  'DeleteCheckpoint',
  // Shape tests, which hit nothing, as nothing has a shape.
  'StartShapeTestRay',
  'StartShapeTestLosProbe',
  'StartExpensiveSynchronousShapeTestLosProbe',
  'StartShapeTestCapsule',
  'GetShapeTestResult',
  'GetShapeTestResultIncludingMaterial',
  // The interiors of the map, which FiveRunner knows none of.
  'PinInteriorInMemory',
  'RequestCollisionAtCoord',
  'RequestAdditionalCollisionAtCoord',
  'RequestCollisionForModel',
  // The camera of the game, and its screen.
  'SetGameplayCamRelativePitch',
  'SetGameplayCamRelativeHeading',
  'GetGameplayCamRelativePitch',
  'GetGameplayCamRelativeHeading',
  'GetFollowPedCamViewMode',
  'GetCamViewModeForContext',
  'GetCamActiveViewModeContext',
  'GetFinalRenderedCamFov',
  'AttachCamToPedBone',
  'InvalidateIdleCam',
  'InvalidateVehicleIdleCam',
  'SetForceVehicleTrails',
  'SetForcePedFootstepsTracks',
  'GetScreenCoordFromWorldCoord',
  'GetProfileSetting',
  'DisplayOnscreenKeyboard',
  'GetOnscreenKeyboardResult',
  'UnregisterPedheadshot',
  'GetSoundId',
  // The blips of the map of the game and the routes it draws.
  'ClearAllBlipRoutes',
  'GetNorthRadarBlip',
  'DoesBlipHaveGpsRoute',
  'GetGpsBlipRouteLength',
  // The stats and the money that the HUD of the game shows.
  'StatSetInt',
  'SetMultiplayerBankCash',
  'SetMultiplayerWalletCash',
  'RemoveMultiplayerBankCash',
  'RemoveMultiplayerWalletCash',
]

let silent: ReadonlySet<bigint> | undefined

/** Whether a native that clients have and that FiveRunner does not implement says nothing of it. */
export function silentNative(hash: bigint): boolean {
  if (silent === undefined) {
    const names = new Set(NAMES)
    silent = new Set(
      catalogNatives<NativeContext>('client')
        .filter(({ luaName, aliases }) =>
          [luaName, ...aliases].some(
            (name) => names.has(name) || FAMILIES.some((family) => family.test(name)),
          ),
        )
        .map(({ hash }) => hash),
    )
  }
  return silent.has(hash)
}

/** The names that no native of the catalog has, of those of this list, for its tests. */
export function unknownSilentNames(): string[] {
  const known = new Set(
    catalogNatives<NativeContext>('client').flatMap(({ luaName, aliases }) => [
      luaName,
      ...aliases,
    ]),
  )
  return NAMES.filter((name) => !known.has(name))
}
