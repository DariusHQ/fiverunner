import {
  defineNative,
  type NativeDefinition,
  type ParamSpec,
  type Side,
} from '../../natives/index.ts'
import { DEFAULT_GAME_BUILD, parseGameBuild } from '../constraints.ts'
import type { NativeContext } from '../context.ts'

/**
 * Natives of what the games of clients do that FiveRunner has no game for:
 * the population of the world, the rich presence of Discord, the HUD and
 * the cameras of each frame, audio, the loading screen, which clients shut
 * down as they join, the behaviour of peds and their tasks. They do
 * nothing, which is what they would do in FiveRunner were they implemented,
 * and those that give something give what a game with nothing of theirs gives.
 */
export function gameNatives(side: Side): NativeDefinition<NativeContext>[] {
  if (side === 'server') return []
  /** A native that does nothing. */
  const nothing = (name: string, hash: bigint | undefined, params: readonly ParamSpec[]) =>
    defineNative(
      { name, ...(hash === undefined ? {} : { hash }), result: 'void', params },
      () => {},
    )
  /** The ids of the submixes of audio that clients created, which name nothing. */
  const submixes = new WeakMap<object, number>()
  return [
    // The population of the world, which there is none of.
    nothing('SET_PARKED_VEHICLE_DENSITY_MULTIPLIER_THIS_FRAME', 0xeae6dcc7eee3db1dn, [
      'float multiplier',
    ]),
    nothing('SET_PED_DENSITY_MULTIPLIER_THIS_FRAME', 0x95e3d6257b166cf2n, ['float multiplier']),
    nothing('SET_RANDOM_VEHICLE_DENSITY_MULTIPLIER_THIS_FRAME', 0xb3b3359379fe77d3n, [
      'float multiplier',
    ]),
    nothing('SET_SCENARIO_PED_DENSITY_MULTIPLIER_THIS_FRAME', 0x7a556143a1c03898n, [
      'float p0',
      'float p1',
    ]),
    nothing('SET_VEHICLE_DENSITY_MULTIPLIER_THIS_FRAME', 0x245a6883d966d537n, ['float multiplier']),
    nothing('SET_CREATE_RANDOM_COPS', 0x102e68b2024d536dn, ['BOOL toggle']),
    nothing('SET_CREATE_RANDOM_COPS_NOT_ON_SCENARIOS', 0x8a4986851c4ef6e7n, ['BOOL toggle']),
    nothing('SET_CREATE_RANDOM_COPS_ON_SCENARIOS', 0x444cb7d7dbe6973dn, ['BOOL toggle']),
    nothing('SET_GARBAGE_TRUCKS', 0x2afd795eeac8d30dn, ['BOOL toggle']),
    nothing('SET_FAR_DRAW_VEHICLES', 0x26324f33423f3cc3n, ['BOOL toggle']),
    nothing('REMOVE_VEHICLES_FROM_GENERATORS_IN_AREA', 0x46a1e1a299ec4bban, [
      'float x1',
      'float y1',
      'float z1',
      'float x2',
      'float y2',
      'float z2',
      'Any p6',
    ]),
    nothing('SET_VEHICLE_MODEL_IS_SUPPRESSED', 0x0fc2d89ac25a5814n, [
      'Hash model',
      'BOOL suppressed',
    ]),
    nothing('SET_SCENARIO_GROUP_ENABLED', 0x02c8e5b49848664en, [
      'char* scenarioGroup',
      'BOOL enabled',
    ]),
    nothing('SET_SCENARIO_TYPE_ENABLED', 0xeb47ec4e34fb7ee1n, [
      'char* scenarioType',
      'BOOL toggle',
    ]),
    nothing('ENABLE_DISPATCH_SERVICE', 0xdc0f817884cdd856n, ['int dispatchService', 'BOOL toggle']),
    nothing('DISTANT_COP_CAR_SIRENS', 0x552369f549563ad5n, ['BOOL value']),
    nothing('SET_ROADS_IN_ANGLED_AREA', 0x1a5aa1208af5db59n, [
      'float x1',
      'float y1',
      'float z1',
      'float x2',
      'float y2',
      'float z2',
      'float width',
      'BOOL unknown1',
      'BOOL unknown2',
      'BOOL unknown3',
    ]),
    nothing('SET_MAX_WANTED_LEVEL', 0xaa5f02db48d704b9n, ['int maxWantedLevel']),
    nothing('SET_RELATIONSHIP_BETWEEN_GROUPS', 0xbf25eb89375a37adn, [
      'int relationship',
      'Hash group1',
      'Hash group2',
    ]),
    // The rich presence of Discord, which FiveRunner's clients have no Discord for.
    nothing('SET_DISCORD_APP_ID', undefined, ['char* appId']),
    nothing('SET_DISCORD_RICH_PRESENCE_ACTION', undefined, [
      'int index',
      'char* label',
      'char* url',
    ]),
    nothing('SET_DISCORD_RICH_PRESENCE_ASSET', undefined, ['char* assetName']),
    nothing('SET_DISCORD_RICH_PRESENCE_ASSET_SMALL', undefined, ['char* assetName']),
    nothing('SET_DISCORD_RICH_PRESENCE_ASSET_SMALL_TEXT', undefined, ['char* text']),
    nothing('SET_DISCORD_RICH_PRESENCE_ASSET_TEXT', undefined, ['char* text']),
    nothing('SET_RICH_PRESENCE', undefined, ['char* presenceState']),
    // The HUD and the cameras of the frames that the game draws, which it draws none of.
    nothing('HIDE_HUD_COMPONENT_THIS_FRAME', 0x6806c51ad12b83b8n, ['int id']),
    nothing('DISPLAY_AMMO_THIS_FRAME', 0xa5e78ba2b1331c55n, ['BOOL display']),
    nothing('DISABLE_IDLE_CAMERA', undefined, ['BOOL state']),
    nothing('DISABLE_VEHICLE_PASSENGER_IDLE_CAMERA', undefined, ['BOOL state']),
    nothing('SET_TIMECYCLE_MODIFIER', 0x2c933abf17a1df41n, ['char* modifierName']),
    nothing('SET_TIMECYCLE_MODIFIER_STRENGTH', 0x82e7ffcd5b2326b3n, ['float strength']),
    nothing('SET_BIGMAP_ACTIVE', 0x231c8f89d0539d8fn, ['BOOL toggleBigMap', 'BOOL showFullMap']),
    nothing('DISPLAY_RADAR', 0xa0ebb943c300e693n, ['BOOL toggle']),
    nothing('SET_FOLLOW_PED_CAM_VIEW_MODE', 0x5a4f9edf1673f704n, ['int viewMode']),
    nothing('DRAW_MARKER', 0x28477ec23d892089n, ['int type']),
    nothing('DRAW_RECT', 0x3a618a217e5154f0n, [
      'float x',
      'float y',
      'float width',
      'float height',
    ]),
    nothing('SET_SCRIPT_GFX_DRAW_ORDER', 0x61bb1d9b3a95d802n, ['int drawOrder']),
    nothing('SET_TEXT_RENDER_ID', 0x5f15302936e07111n, ['int renderId']),
    nothing('SET_USE_HI_DOF', 0xa13b0222f3d94a94n, []),
    defineNative(
      { name: 'IS_PAUSE_MENU_ACTIVE', hash: 0xb0034a223497ffcbn, result: 'BOOL', params: [] },
      () => false,
    ),
    // The game window of clients is 1920 by 1080 pixels.
    defineNative(
      {
        name: 'GET_ASPECT_RATIO',
        hash: 0xf1307ef624a80d87n,
        result: 'float',
        params: ['BOOL b'],
      },
      () => 1920 / 1080,
    ),
    // What the weather looks like, and the lights of the city.
    nothing('SET_RAIN_LEVEL', 0x643e26ea6e024d92n, ['float intensity']),
    nothing('SET_SNOW_LEVEL', 0x7f06937b0cdcbc1an, ['float level']),
    nothing('SET_WIND', 0xac3a74e8384a9919n, ['float speed']),
    nothing('SET_WIND_SPEED', 0xee09ecedbabe47fcn, ['float speed']),
    nothing('SET_WIND_DIRECTION', 0xeb0f4468467b4528n, ['float direction']),
    nothing('WATER_OVERRIDE_SET_STRENGTH', 0xc54a08c85ae4d410n, ['float strength']),
    nothing('SET_ARTIFICIAL_LIGHTS_STATE', 0x1268615ace24d504n, ['BOOL state']),
    nothing('SET_ARTIFICIAL_LIGHTS_STATE_AFFECTS_VEHICLES', 0xe2b187c0939b3d32n, ['BOOL toggle']),
    // Audio, which FiveRunner plays none of.
    nothing('SET_AUDIO_FLAG', 0xb9efd5c25018725an, ['char* flagName', 'BOOL toggle']),
    defineNative(
      {
        name: 'START_AUDIO_SCENE',
        hash: 0x013a80fc08f6e4f2n,
        result: 'BOOL',
        params: ['char* scene'],
      },
      () => true,
    ),
    defineNative(
      { name: 'CREATE_AUDIO_SUBMIX', result: 'int', params: ['char* name'] },
      (ctx: NativeContext) => {
        const id = submixes.get(ctx.manager) ?? 0
        submixes.set(ctx.manager, id + 1)
        return id
      },
    ),
    nothing('ADD_AUDIO_SUBMIX_OUTPUT', undefined, ['int submixId', 'int outputSubmixId']),
    nothing('SET_AUDIO_SUBMIX_EFFECT_PARAM_INT', undefined, [
      'int submixId',
      'int effectSlot',
      'int paramIndex',
      'int paramValue',
    ]),
    nothing('SET_AUDIO_SUBMIX_EFFECT_RADIO_FX', undefined, ['int submixId', 'int effectSlot']),
    nothing('SET_AUDIO_SUBMIX_OUTPUT_VOLUMES', undefined, [
      'int submixId',
      'int outputSlot',
      'int frontLeftVolume',
      'int frontRightVolume',
      'int rearLeftVolume',
      'int rearRightVolume',
      'int channel5Volume',
      'int channel6Volume',
    ]),
    defineNative(
      {
        name: 'REQUEST_SCRIPT_AUDIO_BANK',
        hash: 0x2f844a8b08d76685n,
        result: 'BOOL',
        params: ['char* audioBank', 'BOOL p1', 'Any p2'],
      },
      () => true,
    ),
    nothing('RELEASE_NAMED_SCRIPT_AUDIO_BANK', 0x77ed170667f50170n, ['char* audioBank']),
    nothing('STOP_ALL_ALARMS', 0x2f794a877add4c92n, ['BOOL stop']),
    defineNative(
      {
        name: 'PREPARE_ALARM',
        hash: 0x9d74ae343db65533n,
        result: 'BOOL',
        params: ['char* alarmName'],
      },
      () => true,
    ),
    // The loading screen, which clients shut down as they join.
    nothing('SHUTDOWN_LOADING_SCREEN', 0x078ebe9809ccd637n, []),
    nothing('SHUTDOWN_LOADING_SCREEN_NUI', undefined, []),
    // The behaviour of peds and of weapons, which nothing drives.
    nothing('SET_WEAPONS_NO_AUTORELOAD', undefined, ['BOOL state']),
    nothing('SET_WEAPONS_NO_AUTOSWAP', undefined, ['BOOL state']),
    nothing('TOGGLE_USE_PICKUPS_FOR_PLAYER', undefined, [
      'int player',
      'Hash pickupHash',
      'BOOL toggle',
    ]),
    // Nothing damages entities.
    nothing('SET_ENTITY_INVINCIBLE', 0x3882114bde571ad4n, ['Entity entity', 'BOOL toggle']),
    nothing('SET_BLOCKING_OF_NON_TEMPORARY_EVENTS', 0x9f8aa94d6d97dbf4n, [
      'Ped ped',
      'BOOL toggle',
    ]),
    nothing('TASK_START_SCENARIO_IN_PLACE', 0x142a02425ff02bd9n, [
      'Ped ped',
      'char* scenarioName',
      'int unkDelay',
      'BOOL playEnterAnim',
    ]),
    defineNative(
      {
        name: 'IS_PED_BEING_STUNNED',
        hash: 0x4fbacce3b4138ee8n,
        result: 'BOOL',
        params: ['Ped ped', 'int p1'],
      },
      () => false,
    ),
    nothing('SET_FUEL_CONSUMPTION_RATE_MULTIPLIER', undefined, ['int multiplier']),
    nothing('SET_FUEL_CONSUMPTION_STATE', undefined, ['BOOL state']),
    // Clients run the game build that their servers enforce, as FiveM's restart into it, or the default one.
    defineNative(
      { name: 'GET_GAME_BUILD_NUMBER', result: 'int', params: [] },
      (ctx: NativeContext) => {
        const enforced = ctx.manager.session?.server.console.variables.find('sv_enforceGameBuild')
        return parseGameBuild(enforced?.value ?? '') || DEFAULT_GAME_BUILD
      },
    ),
  ]
}
