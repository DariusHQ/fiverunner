import { defineNative, type NativeDefinition, type Side } from '../../natives/index.ts'
import type { NativeContext } from '../context.ts'
import { EntityType, entityTypeOf } from '../world/entity.ts'
import { NO_MOD_KIT, type Rgb, type VehicleParts } from '../world/vehicle.ts'
import { clientEntityOf } from './entities.ts'

/** The mods of each type that vehicles have to pick from, as FiveRunner has no models to read them from. */
const MODS_OF_A_TYPE = 10

/** The window tints of GTA V. */
const WINDOW_TINTS = 7

/** The doors of vehicles, as they are automobiles, whatever their models: four, the hood and the trunk. */
const DOORS = 6

/** The seats of vehicles, as they are automobiles, whatever their models. */
const SEATS = 4

/** The keys of the values of a type that the parts of a vehicle keep. */
type KeysOf<T> = {
  [K in keyof VehicleParts]: VehicleParts[K] extends T ? K : never
}[keyof VehicleParts]

/** The hash of a native, which CFX natives give none of, for their definitions. */
const hashed = (hash: bigint | undefined) => (hash === undefined ? {} : { hash })

/** The parts of the vehicle of a handle on a client, if it names one. */
function partsOf(ctx: NativeContext, handle: number): VehicleParts | undefined {
  const found = clientEntityOf(ctx, handle)
  return found !== undefined && entityTypeOf(found.type) === EntityType.vehicle
    ? found.parts
    : undefined
}

/** The natives that read and set a float of the parts of vehicles. */
function float(
  getter: string,
  getterHash: bigint | undefined,
  setter: string,
  setterHash: bigint | undefined,
  key: KeysOf<number>,
): NativeDefinition<NativeContext>[] {
  return [
    defineNative(
      { name: getter, ...hashed(getterHash), result: 'float', params: ['Vehicle vehicle'] },
      (ctx: NativeContext, vehicle) => partsOf(ctx, vehicle)?.[key] ?? 0,
    ),
    defineNative(
      {
        name: setter,
        ...hashed(setterHash),
        result: 'void',
        params: ['Vehicle vehicle', 'float value'],
      },
      (ctx: NativeContext, vehicle, value) => {
        const parts = partsOf(ctx, vehicle)
        if (parts !== undefined) parts[key] = value
      },
    ),
  ]
}

/** The natives that read and set an int of the parts of vehicles. */
function int(
  getter: string,
  getterHash: bigint,
  setter: string,
  setterHash: bigint,
  key: KeysOf<number>,
): NativeDefinition<NativeContext>[] {
  return [
    defineNative(
      { name: getter, hash: getterHash, result: 'int', params: ['Vehicle vehicle'] },
      (ctx: NativeContext, vehicle) => partsOf(ctx, vehicle)?.[key] ?? 0,
    ),
    defineNative(
      {
        name: setter,
        hash: setterHash,
        result: 'void',
        params: ['Vehicle vehicle', 'int value'],
      },
      (ctx: NativeContext, vehicle, value) => {
        const parts = partsOf(ctx, vehicle)
        if (parts !== undefined) parts[key] = value
      },
    ),
  ]
}

/** The natives that read and set a flag of the parts of vehicles, which may have getters of their own. */
function flag(
  getter: string,
  getterHash: bigint | undefined,
  setter: string,
  setterHash: bigint,
  key: KeysOf<boolean>,
): NativeDefinition<NativeContext>[] {
  return [
    defineNative(
      { name: getter, ...hashed(getterHash), result: 'BOOL', params: ['Vehicle vehicle'] },
      (ctx: NativeContext, vehicle) => partsOf(ctx, vehicle)?.[key] ?? false,
    ),
    defineNative(
      {
        name: setter,
        hash: setterHash,
        result: 'void',
        params: ['Vehicle vehicle', 'BOOL toggle'],
      },
      (ctx: NativeContext, vehicle, toggle) => {
        const parts = partsOf(ctx, vehicle)
        if (parts !== undefined) parts[key] = toggle
      },
    ),
  ]
}

/** The natives that read two ints of the parts of vehicles through pointers, and set them. */
function pair(
  getter: string,
  getterHash: bigint,
  setter: string,
  setterHash: bigint,
  first: KeysOf<number>,
  second: KeysOf<number>,
): NativeDefinition<NativeContext>[] {
  return [
    defineNative(
      {
        name: getter,
        hash: getterHash,
        result: 'void',
        params: ['Vehicle vehicle', 'int* first', 'int* second'],
      },
      (ctx: NativeContext, vehicle, one, two) => {
        const parts = partsOf(ctx, vehicle)
        one.set(parts?.[first] ?? 0)
        two.set(parts?.[second] ?? 0)
      },
    ),
    defineNative(
      {
        name: setter,
        hash: setterHash,
        result: 'void',
        params: ['Vehicle vehicle', 'int first', 'int second'],
      },
      (ctx: NativeContext, vehicle, one, two) => {
        const parts = partsOf(ctx, vehicle)
        if (parts === undefined) return
        parts[first] = one
        parts[second] = two
      },
    ),
  ]
}

/** The natives that read an int of the parts of vehicles through a pointer, and set it. */
function indirect(
  getter: string,
  getterHash: bigint,
  setter: string,
  setterHash: bigint,
  key: KeysOf<number>,
): NativeDefinition<NativeContext>[] {
  return [
    defineNative(
      {
        name: getter,
        hash: getterHash,
        result: 'void',
        params: ['Vehicle vehicle', 'int* color'],
      },
      (ctx: NativeContext, vehicle, colour) => colour.set(partsOf(ctx, vehicle)?.[key] ?? 0),
    ),
    defineNative(
      {
        name: setter,
        hash: setterHash,
        result: 'void',
        params: ['Vehicle vehicle', 'int color'],
      },
      (ctx: NativeContext, vehicle, colour) => {
        const parts = partsOf(ctx, vehicle)
        if (parts !== undefined) parts[key] = colour
      },
    ),
  ]
}

/** The natives that read and set a colour of the parts of vehicles, of three channels. */
function colour(
  getter: string,
  getterHash: bigint,
  setter: string,
  setterHash: bigint,
  key: 'tyreSmoke' | 'neonColour' | 'customPrimary' | 'customSecondary',
): NativeDefinition<NativeContext>[] {
  return [
    defineNative(
      {
        name: getter,
        hash: getterHash,
        result: 'void',
        params: ['Vehicle vehicle', 'int* r', 'int* g', 'int* b'],
      },
      (ctx: NativeContext, vehicle, red, green, blue) => {
        const [r, g, b] = partsOf(ctx, vehicle)?.[key] ?? ([0, 0, 0] as Rgb)
        red.set(r)
        green.set(g)
        blue.set(b)
      },
    ),
    defineNative(
      {
        name: setter,
        hash: setterHash,
        result: 'void',
        params: ['Vehicle vehicle', 'int r', 'int g', 'int b'],
      },
      (ctx: NativeContext, vehicle, r, g, b) => {
        const parts = partsOf(ctx, vehicle)
        if (parts !== undefined) parts[key] = [r, g, b]
      },
    ),
  ]
}

/** A native that gives a value of vehicles that FiveRunner has no models to read, of those that exist. */
const fixed = (name: string, hash: bigint, value: number) =>
  defineNative(
    { name, hash, result: 'int', params: ['Vehicle vehicle'] },
    (ctx: NativeContext, vehicle) => (partsOf(ctx, vehicle) === undefined ? 0 : value),
  )

/** Natives of what scripts set of vehicles, which they read back, and what vehicles are like. */
export function tuningNatives(side: Side): NativeDefinition<NativeContext>[] {
  if (side === 'server') return []
  const noKit = new WeakSet<object>()
  /** Says once to each client that SET_VEHICLE_MOD was called on a vehicle of no mod kit, where it does nothing. */
  const toldNoKit = (ctx: NativeContext) => {
    if (noKit.has(ctx.manager)) return
    noKit.add(ctx.manager)
    ctx.diagnose(
      'SetVehicleMod does nothing on a vehicle without a mod kit, as in GTA V: call SetVehicleModKit(vehicle, 0) first.',
    )
  }
  return [
    // Health, dirt and what vehicles run on.
    ...float(
      'GET_VEHICLE_ENGINE_HEALTH',
      0xc45d23baf168aab8n,
      'SET_VEHICLE_ENGINE_HEALTH',
      0x45f6d8eef34abef1n,
      'engineHealth',
    ),
    ...float(
      'GET_VEHICLE_BODY_HEALTH',
      0xf271147eb7b40f12n,
      'SET_VEHICLE_BODY_HEALTH',
      0xb77d05ac8c78aadbn,
      'bodyHealth',
    ),
    ...float(
      'GET_VEHICLE_PETROL_TANK_HEALTH',
      0x7d5dabe888d2d074n,
      'SET_VEHICLE_PETROL_TANK_HEALTH',
      0x70db57649fa8d0d8n,
      'petrolTankHealth',
    ),
    ...float(
      'GET_VEHICLE_DIRT_LEVEL',
      0x8f17bc8ba08da62bn,
      'SET_VEHICLE_DIRT_LEVEL',
      0x79d3b596fe44ee8bn,
      'dirtLevel',
    ),
    ...float('GET_VEHICLE_FUEL_LEVEL', undefined, 'SET_VEHICLE_FUEL_LEVEL', undefined, 'fuelLevel'),
    ...float('GET_VEHICLE_OIL_LEVEL', undefined, 'SET_VEHICLE_OIL_LEVEL', undefined, 'oilLevel'),
    ...float('GET_VEHICLE_WHEEL_SIZE', undefined, 'SET_VEHICLE_WHEEL_SIZE', undefined, 'wheelSize'),
    ...float(
      'GET_VEHICLE_WHEEL_WIDTH',
      undefined,
      'SET_VEHICLE_WHEEL_WIDTH',
      undefined,
      'wheelWidth',
    ),
    defineNative(
      {
        name: 'GET_VEHICLE_WHEEL_HEALTH',
        result: 'float',
        params: ['Vehicle vehicle', 'int wheelIndex'],
      },
      (ctx: NativeContext, vehicle, wheel) => {
        const parts = partsOf(ctx, vehicle)
        return parts === undefined ? 0 : (parts.wheelHealth.get(wheel) ?? 1000)
      },
    ),
    defineNative(
      {
        name: 'SET_VEHICLE_WHEEL_HEALTH',
        result: 'void',
        params: ['Vehicle vehicle', 'int wheelIndex', 'float health'],
      },
      (ctx: NativeContext, vehicle, wheel, health) =>
        partsOf(ctx, vehicle)?.wheelHealth.set(wheel, health),
    ),
    defineNative(
      {
        name: 'SET_VEHICLE_FIXED',
        hash: 0x115722b1b9c14c1cn,
        result: 'void',
        params: ['Vehicle vehicle'],
      },
      (ctx: NativeContext, vehicle) => partsOf(ctx, vehicle)?.fix(),
    ),
    // The engine, and what else is on or off.
    defineNative(
      {
        name: 'SET_VEHICLE_ENGINE_ON',
        hash: 0x2497c4717c8b881en,
        result: 'void',
        params: ['Vehicle vehicle', 'BOOL value', 'BOOL instantly', 'BOOL disableAutoStart'],
      },
      (ctx: NativeContext, vehicle, value, _instantly, disableAutoStart) => {
        const parts = partsOf(ctx, vehicle)
        if (parts === undefined) return
        parts.engineOn = value
        parts.autoStart = !disableAutoStart
      },
    ),
    defineNative(
      {
        name: 'GET_IS_VEHICLE_ENGINE_RUNNING',
        hash: 0xae31e7df9b5b132en,
        result: 'BOOL',
        params: ['Vehicle vehicle'],
      },
      (ctx: NativeContext, vehicle) => partsOf(ctx, vehicle)?.engineOn ?? false,
    ),
    ...flag(
      'IS_VEHICLE_SIREN_ON',
      0x4c9bf537be2634b2n,
      'SET_VEHICLE_SIREN',
      0xf4924635a19eb37dn,
      'siren',
    ),
    ...flag(
      'IS_VEHICLE_ALARM_ACTIVATED',
      0x4319e335b71fff34n,
      'SET_VEHICLE_ALARM',
      0xcde5e70c1ddb954cn,
      'alarm',
    ),
    ...flag(
      'GET_VEHICLE_HANDBRAKE',
      undefined,
      'SET_VEHICLE_HANDBRAKE',
      0x684785568ef26a22n,
      'handbrake',
    ),
    ...flag(
      'GET_VEHICLE_TYRES_CAN_BURST',
      0x678b9bb8c3f58febn,
      'SET_VEHICLE_TYRES_CAN_BURST',
      0xeb9dc3c7d8596c46n,
      'tyresCanBurst',
    ),
    defineNative(
      {
        name: 'SET_VEHICLE_UNDRIVEABLE',
        hash: 0x8aba6af54b942b95n,
        result: 'void',
        params: ['Vehicle vehicle', 'BOOL toggle'],
      },
      (ctx: NativeContext, vehicle, toggle) => {
        const parts = partsOf(ctx, vehicle)
        if (parts !== undefined) parts.undriveable = toggle
      },
    ),
    defineNative(
      {
        name: 'IS_VEHICLE_DRIVEABLE',
        hash: 0x4c241e39b23df959n,
        result: 'BOOL',
        params: ['Vehicle vehicle', 'BOOL isOnFireCheck'],
      },
      (ctx: NativeContext, vehicle) => {
        const parts = partsOf(ctx, vehicle)
        return parts !== undefined && !parts.undriveable && parts.engineHealth > 0
      },
    ),
    defineNative(
      {
        name: 'SET_VEHICLE_LIGHTS',
        hash: 0x34e710ff01247c5an,
        result: 'void',
        params: ['Vehicle vehicle', 'int state'],
      },
      (ctx: NativeContext, vehicle, state) => {
        const parts = partsOf(ctx, vehicle)
        if (parts !== undefined) parts.lights = state
      },
    ),
    // 1 turns them off, 2 on, and 0 and 3 leave them to the game, where they are off at noon.
    defineNative(
      {
        name: 'GET_VEHICLE_LIGHTS_STATE',
        hash: 0xb91b4c20085bd12fn,
        result: 'BOOL',
        params: ['Vehicle vehicle', 'BOOL* lightsOn', 'BOOL* highbeamsOn'],
      },
      (ctx: NativeContext, vehicle, on, high) => {
        const parts = partsOf(ctx, vehicle)
        on.set(parts?.lights === 2)
        high.set(false)
        return parts !== undefined
      },
    ),
    // Colours.
    ...pair(
      'GET_VEHICLE_COLOURS',
      0xa19435f193e081acn,
      'SET_VEHICLE_COLOURS',
      0x4f1d4be3a7f24601n,
      'primaryColour',
      'secondaryColour',
    ),
    ...pair(
      'GET_VEHICLE_EXTRA_COLOURS',
      0x3bc4245933a166f7n,
      'SET_VEHICLE_EXTRA_COLOURS',
      0x2036f561add12e33n,
      'pearlescentColour',
      'wheelColour',
    ),
    ...indirect(
      '_GET_VEHICLE_INTERIOR_COLOR',
      0x7d1464d472d32136n,
      '_SET_VEHICLE_INTERIOR_COLOR',
      0xf40dd601a65f7f19n,
      'interiorColour',
    ),
    ...indirect(
      '_GET_VEHICLE_DASHBOARD_COLOR',
      0xb7635e80a5c31bffn,
      '_SET_VEHICLE_DASHBOARD_COLOR',
      0x6089cdf6a57f326cn,
      'dashboardColour',
    ),
    ...colour(
      'GET_VEHICLE_CUSTOM_PRIMARY_COLOUR',
      0xb64cf2cca9d95f52n,
      'SET_VEHICLE_CUSTOM_PRIMARY_COLOUR',
      0x7141766f91d15bean,
      'customPrimary',
    ),
    ...colour(
      'GET_VEHICLE_CUSTOM_SECONDARY_COLOUR',
      0x8389cd56ca8072dcn,
      'SET_VEHICLE_CUSTOM_SECONDARY_COLOUR',
      0x36ced73bfed89754n,
      'customSecondary',
    ),
    ...colour(
      'GET_VEHICLE_TYRE_SMOKE_COLOR',
      0xb635392a4938b3c3n,
      'SET_VEHICLE_TYRE_SMOKE_COLOR',
      0xb5ba80f839791c0fn,
      'tyreSmoke',
    ),
    ...colour(
      '_GET_VEHICLE_NEON_LIGHTS_COLOUR',
      0x7619eee8c886757fn,
      '_SET_VEHICLE_NEON_LIGHTS_COLOUR',
      0x8e0a582209a62695n,
      'neonColour',
    ),
    ...(
      [
        ['GET_IS_VEHICLE_PRIMARY_COLOUR_CUSTOM', 0xf095c0405307b21bn, 'customPrimary'],
        ['GET_IS_VEHICLE_SECONDARY_COLOUR_CUSTOM', 0x910a32e7aad2656cn, 'customSecondary'],
      ] as const
    ).map(([name, hash, key]) =>
      defineNative(
        { name, hash, result: 'BOOL', params: ['Vehicle vehicle'] },
        (ctx: NativeContext, vehicle) => partsOf(ctx, vehicle)?.[key] !== undefined,
      ),
    ),
    ...(
      [
        ['CLEAR_VEHICLE_CUSTOM_PRIMARY_COLOUR', 0x55e1d2758f34e437n, 'customPrimary'],
        ['CLEAR_VEHICLE_CUSTOM_SECONDARY_COLOUR', 0x5ffbdeec3e8e2009n, 'customSecondary'],
      ] as const
    ).map(([name, hash, key]) =>
      defineNative(
        { name, hash, result: 'void', params: ['Vehicle vehicle'] },
        (ctx: NativeContext, vehicle) => {
          const parts = partsOf(ctx, vehicle)
          if (parts !== undefined) parts[key] = undefined
        },
      ),
    ),
    // Lights.
    defineNative(
      {
        name: '_IS_VEHICLE_NEON_LIGHT_ENABLED',
        hash: 0x8c4b92553e4766a5n,
        result: 'BOOL',
        params: ['Vehicle vehicle', 'int index'],
      },
      (ctx: NativeContext, vehicle, index) => partsOf(ctx, vehicle)?.neonLights.has(index) ?? false,
    ),
    defineNative(
      {
        name: '_SET_VEHICLE_NEON_LIGHT_ENABLED',
        hash: 0x2aa720e4287bf269n,
        result: 'void',
        params: ['Vehicle vehicle', 'int index', 'BOOL toggle'],
      },
      (ctx: NativeContext, vehicle, index, toggle) => {
        const lights = partsOf(ctx, vehicle)?.neonLights
        if (toggle) lights?.add(index)
        else lights?.delete(index)
      },
    ),
    ...int(
      '_GET_VEHICLE_XENON_LIGHTS_COLOR',
      0x3dff319a831e0cdbn,
      '_SET_VEHICLE_XENON_LIGHTS_COLOR',
      0xe41033b25d003a07n,
      'xenonColour',
    ),
    defineNative(
      {
        name: 'GET_VEHICLE_XENON_LIGHTS_CUSTOM_COLOR',
        result: 'BOOL',
        params: ['Vehicle vehicle', 'int* red', 'int* green', 'int* blue'],
      },
      (ctx: NativeContext, vehicle, red, green, blue) => {
        const custom = partsOf(ctx, vehicle)?.customXenon
        const [r, g, b] = custom ?? ([0, 0, 0] as Rgb)
        red.set(r)
        green.set(g)
        blue.set(b)
        return custom !== undefined
      },
    ),
    defineNative(
      {
        name: 'SET_VEHICLE_XENON_LIGHTS_CUSTOM_COLOR',
        result: 'void',
        params: ['Vehicle vehicle', 'int red', 'int green', 'int blue'],
      },
      (ctx: NativeContext, vehicle, r, g, b) => {
        const parts = partsOf(ctx, vehicle)
        if (parts !== undefined) parts.customXenon = [r, g, b]
      },
    ),
    defineNative(
      {
        name: 'CLEAR_VEHICLE_XENON_LIGHTS_CUSTOM_COLOR',
        result: 'void',
        params: ['Vehicle vehicle'],
      },
      (ctx: NativeContext, vehicle) => {
        const parts = partsOf(ctx, vehicle)
        if (parts !== undefined) parts.customXenon = undefined
      },
    ),
    // Mods, liveries and extras.
    ...int(
      'GET_VEHICLE_MOD_KIT',
      0x6325d1a044ae510dn,
      'SET_VEHICLE_MOD_KIT',
      0x1f2aa07f00b3217an,
      'modKit',
    ),
    defineNative(
      {
        name: 'SET_VEHICLE_MOD',
        hash: 0x6af0636ddedcb6ddn,
        result: 'void',
        params: ['Vehicle vehicle', 'int modType', 'int modIndex', 'BOOL customTires'],
      },
      (ctx: NativeContext, vehicle, type, index, variation) => {
        const parts = partsOf(ctx, vehicle)
        if (parts === undefined) return
        if (parts.modKit === NO_MOD_KIT) toldNoKit(ctx)
        else parts.mods.set(type, { index, variation })
      },
    ),
    defineNative(
      {
        name: 'GET_VEHICLE_MOD',
        hash: 0x772960298da26fdbn,
        result: 'int',
        params: ['Vehicle vehicle', 'int modType'],
      },
      (ctx: NativeContext, vehicle, type) => partsOf(ctx, vehicle)?.mods.get(type)?.index ?? -1,
    ),
    defineNative(
      {
        name: 'GET_VEHICLE_MOD_VARIATION',
        hash: 0xb3924ecd70e095dcn,
        result: 'BOOL',
        params: ['Vehicle vehicle', 'int modType'],
      },
      (ctx: NativeContext, vehicle, type) =>
        partsOf(ctx, vehicle)?.mods.get(type)?.variation ?? false,
    ),
    defineNative(
      {
        name: 'REMOVE_VEHICLE_MOD',
        hash: 0x92d619e420858204n,
        result: 'void',
        params: ['Vehicle vehicle', 'int modType'],
      },
      (ctx: NativeContext, vehicle, type) => partsOf(ctx, vehicle)?.mods.delete(type),
    ),
    defineNative(
      {
        name: 'GET_NUM_VEHICLE_MODS',
        hash: 0xe38e9162a2500646n,
        result: 'int',
        params: ['Vehicle vehicle', 'int modType'],
      },
      (ctx: NativeContext, vehicle) => (partsOf(ctx, vehicle) === undefined ? 0 : MODS_OF_A_TYPE),
    ),
    defineNative(
      {
        name: 'TOGGLE_VEHICLE_MOD',
        hash: 0x2a1f4f37f95bad08n,
        result: 'void',
        params: ['Vehicle vehicle', 'int modType', 'BOOL toggle'],
      },
      (ctx: NativeContext, vehicle, type, toggle) => {
        const mods = partsOf(ctx, vehicle)?.toggledMods
        if (toggle) mods?.add(type)
        else mods?.delete(type)
      },
    ),
    defineNative(
      {
        name: 'IS_TOGGLE_MOD_ON',
        hash: 0x84b233a8c8fc8ae7n,
        result: 'BOOL',
        params: ['Vehicle vehicle', 'int modType'],
      },
      (ctx: NativeContext, vehicle, type) => partsOf(ctx, vehicle)?.toggledMods.has(type) ?? false,
    ),
    ...int(
      'GET_VEHICLE_LIVERY',
      0x2bb9230590da5e8an,
      'SET_VEHICLE_LIVERY',
      0x60bf608f1b8cd1b6n,
      'livery',
    ),
    ...int(
      '_GET_VEHICLE_ROOF_LIVERY',
      0x60190048c0764a26n,
      '_SET_VEHICLE_ROOF_LIVERY',
      0xa6d3a8750dc73270n,
      'roofLivery',
    ),
    // Vehicles have no liveries to pick from, which GTA V gives -1 for.
    ...(
      [
        ['GET_VEHICLE_LIVERY_COUNT', 0x87b63e25a529d526n],
        ['_GET_VEHICLE_ROOF_LIVERY_COUNT', 0x5ecb40269053c0d4n],
      ] as const
    ).map(([name, hash]) =>
      defineNative({ name, hash, result: 'int', params: ['Vehicle vehicle'] }, () => -1),
    ),
    ...int(
      'GET_VEHICLE_WINDOW_TINT',
      0x0ee21293dad47c95n,
      'SET_VEHICLE_WINDOW_TINT',
      0x57c51e6bad752696n,
      'windowTint',
    ),
    defineNative(
      {
        name: 'GET_NUM_VEHICLE_WINDOW_TINTS',
        hash: 0x9d1224004b3a6707n,
        result: 'int',
        params: [],
      },
      () => WINDOW_TINTS,
    ),
    ...int(
      'GET_VEHICLE_WHEEL_TYPE',
      0xb3ed1bfb4be636dcn,
      'SET_VEHICLE_WHEEL_TYPE',
      0x487eb21cc7295ba1n,
      'wheelType',
    ),
    // The extras of vehicles are those that scripts set, as FiveRunner has no models to read them from.
    defineNative(
      {
        name: 'DOES_EXTRA_EXIST',
        hash: 0x1262d55792428154n,
        result: 'BOOL',
        params: ['Vehicle vehicle', 'int extraId'],
      },
      (ctx: NativeContext, vehicle, extra) => partsOf(ctx, vehicle)?.extras.has(extra) ?? false,
    ),
    defineNative(
      {
        name: 'IS_VEHICLE_EXTRA_TURNED_ON',
        hash: 0xd2e6822dbfd6c8bdn,
        result: 'BOOL',
        params: ['Vehicle vehicle', 'int extraId'],
      },
      (ctx: NativeContext, vehicle, extra) => partsOf(ctx, vehicle)?.extras.get(extra) ?? false,
    ),
    defineNative(
      {
        name: 'SET_VEHICLE_EXTRA',
        hash: 0x7ee3a3c5e4a40cc9n,
        result: 'void',
        params: ['Vehicle vehicle', 'int extraId', 'BOOL disable'],
      },
      (ctx: NativeContext, vehicle, extra, disable) =>
        partsOf(ctx, vehicle)?.extras.set(extra, !disable),
    ),
    // Doors.
    ...int(
      'GET_VEHICLE_DOOR_LOCK_STATUS',
      0x25bc98a59c2ea962n,
      'SET_VEHICLE_DOORS_LOCKED',
      0xb664292eaecf7fa6n,
      'doorLock',
    ),
    fixed('_GET_NUMBER_OF_VEHICLE_DOORS', 0x92922a607497b14dn, DOORS),
    defineNative(
      {
        name: 'SET_VEHICLE_DOOR_OPEN',
        hash: 0x7c65dac73c35c862n,
        result: 'void',
        params: ['Vehicle vehicle', 'int doorIndex', 'BOOL loose', 'BOOL openInstantly'],
      },
      (ctx: NativeContext, vehicle, door) => partsOf(ctx, vehicle)?.openDoors.add(door),
    ),
    defineNative(
      {
        name: 'SET_VEHICLE_DOOR_SHUT',
        hash: 0x93d9bd300d7789e5n,
        result: 'void',
        params: ['Vehicle vehicle', 'int doorIndex', 'BOOL closeInstantly'],
      },
      (ctx: NativeContext, vehicle, door) => partsOf(ctx, vehicle)?.openDoors.delete(door),
    ),
    defineNative(
      {
        name: 'SET_VEHICLE_DOORS_SHUT',
        hash: 0x781b3d62bb013ef5n,
        result: 'void',
        params: ['Vehicle vehicle', 'BOOL closeInstantly'],
      },
      (ctx: NativeContext, vehicle) => partsOf(ctx, vehicle)?.openDoors.clear(),
    ),
    defineNative(
      {
        name: 'GET_VEHICLE_DOOR_ANGLE_RATIO',
        hash: 0xfe3f9c29f7b32bd5n,
        result: 'float',
        params: ['Vehicle vehicle', 'int doorIndex'],
      },
      (ctx: NativeContext, vehicle, door) => (partsOf(ctx, vehicle)?.openDoors.has(door) ? 1 : 0),
    ),
    defineNative(
      {
        name: 'IS_VEHICLE_DOOR_FULLY_OPEN',
        hash: 0x3e933cff7b111c22n,
        result: 'BOOL',
        params: ['Vehicle vehicle', 'int doorIndex'],
      },
      (ctx: NativeContext, vehicle, door) => partsOf(ctx, vehicle)?.openDoors.has(door) ?? false,
    ),
    defineNative(
      {
        name: 'SET_VEHICLE_DOOR_BROKEN',
        hash: 0xd4d4f6a4ab575a33n,
        result: 'void',
        params: ['Vehicle vehicle', 'int doorIndex', 'BOOL deleteDoor'],
      },
      (ctx: NativeContext, vehicle, door) => {
        const parts = partsOf(ctx, vehicle)
        parts?.brokenDoors.add(door)
        parts?.openDoors.delete(door)
      },
    ),
    defineNative(
      {
        name: 'IS_VEHICLE_DOOR_DAMAGED',
        hash: 0xb8e181e559464527n,
        result: 'BOOL',
        params: ['Vehicle veh', 'int doorID'],
      },
      (ctx: NativeContext, vehicle, door) => partsOf(ctx, vehicle)?.brokenDoors.has(door) ?? false,
    ),
    defineNative(
      {
        name: '_GET_IS_DOOR_VALID',
        hash: 0x645f4b6e8499f632n,
        result: 'BOOL',
        params: ['Vehicle vehicle', 'int doorIndex'],
      },
      (ctx: NativeContext, vehicle, door) => {
        const parts = partsOf(ctx, vehicle)
        return parts !== undefined && door >= 0 && door < DOORS && !parts.brokenDoors.has(door)
      },
    ),
    // Windows.
    defineNative(
      {
        name: 'SMASH_VEHICLE_WINDOW',
        hash: 0x9e5b5e4d2ccd2259n,
        result: 'void',
        params: ['Vehicle vehicle', 'int windowIndex'],
      },
      (ctx: NativeContext, vehicle, window) => partsOf(ctx, vehicle)?.smashedWindows.add(window),
    ),
    defineNative(
      {
        name: 'REMOVE_VEHICLE_WINDOW',
        hash: 0xa711568eedb43069n,
        result: 'void',
        params: ['Vehicle vehicle', 'int windowIndex'],
      },
      (ctx: NativeContext, vehicle, window) => partsOf(ctx, vehicle)?.smashedWindows.add(window),
    ),
    defineNative(
      {
        name: 'FIX_VEHICLE_WINDOW',
        hash: 0x772282ebeb95e682n,
        result: 'void',
        params: ['Vehicle vehicle', 'int windowIndex'],
      },
      (ctx: NativeContext, vehicle, window) => partsOf(ctx, vehicle)?.smashedWindows.delete(window),
    ),
    defineNative(
      {
        name: 'IS_VEHICLE_WINDOW_INTACT',
        hash: 0x46e571a0e20d01f1n,
        result: 'BOOL',
        params: ['Vehicle vehicle', 'int windowIndex'],
      },
      (ctx: NativeContext, vehicle, window) => {
        const parts = partsOf(ctx, vehicle)
        return (
          parts !== undefined &&
          !parts.smashedWindows.has(window) &&
          !parts.rolledDownWindows.has(window)
        )
      },
    ),
    defineNative(
      {
        name: 'ROLL_DOWN_WINDOW',
        hash: 0x7ad9e6ce657d69e3n,
        result: 'void',
        params: ['Vehicle vehicle', 'int windowIndex'],
      },
      (ctx: NativeContext, vehicle, window) => partsOf(ctx, vehicle)?.rolledDownWindows.add(window),
    ),
    defineNative(
      {
        name: 'ROLL_UP_WINDOW',
        hash: 0x602e548f46e24d59n,
        result: 'void',
        params: ['Vehicle vehicle', 'int windowIndex'],
      },
      (ctx: NativeContext, vehicle, window) =>
        partsOf(ctx, vehicle)?.rolledDownWindows.delete(window),
    ),
    // Tyres.
    defineNative(
      {
        name: 'SET_VEHICLE_TYRE_BURST',
        hash: 0xec6a202ee4960385n,
        result: 'void',
        params: ['Vehicle vehicle', 'int index', 'BOOL onRim', 'float p3'],
      },
      (ctx: NativeContext, vehicle, tyre, onRim) => {
        const parts = partsOf(ctx, vehicle)
        if (parts?.tyresCanBurst) parts.burstTyres.set(tyre, onRim)
      },
    ),
    defineNative(
      {
        name: 'SET_VEHICLE_TYRE_FIXED',
        hash: 0x6e13fc662b882d1dn,
        result: 'void',
        params: ['Vehicle vehicle', 'int tyreIndex'],
      },
      (ctx: NativeContext, vehicle, tyre) => partsOf(ctx, vehicle)?.burstTyres.delete(tyre),
    ),
    defineNative(
      {
        name: 'IS_VEHICLE_TYRE_BURST',
        hash: 0xba291848a0815ca9n,
        result: 'BOOL',
        params: ['Vehicle vehicle', 'int wheelID', 'BOOL isBurstToRim'],
      },
      (ctx: NativeContext, vehicle, tyre, toRim) => {
        const burst = partsOf(ctx, vehicle)?.burstTyres.get(tyre)
        return burst !== undefined && (!toRim || burst)
      },
    ),
    // Handling, of no vehicle: what scripts read of it is what they set.
    ...(
      [
        ['GET_VEHICLE_HANDLING_FLOAT', 'float'],
        ['GET_VEHICLE_HANDLING_INT', 'int'],
      ] as const
    ).map(([name, result]) =>
      defineNative(
        { name, result, params: ['Vehicle vehicle', 'char* class_', 'char* fieldName'] },
        (ctx: NativeContext, vehicle, _class, field) =>
          partsOf(ctx, vehicle)?.handling.get(field ?? '') ?? 0,
      ),
    ),
    defineNative(
      {
        name: 'SET_VEHICLE_HANDLING_FLOAT',
        result: 'void',
        params: ['Vehicle vehicle', 'char* class_', 'char* fieldName', 'float value'],
      },
      (ctx: NativeContext, vehicle, _class, field, value) =>
        partsOf(ctx, vehicle)?.handling.set(field ?? '', value),
    ),
    defineNative(
      {
        name: 'SET_VEHICLE_HANDLING_INT',
        result: 'void',
        params: ['Vehicle vehicle', 'char* class_', 'char* fieldName', 'int value'],
      },
      (ctx: NativeContext, vehicle, _class, field, value) =>
        partsOf(ctx, vehicle)?.handling.set(field ?? '', value),
    ),
    // What vehicles are like: automobiles, whatever their models, on the ground.
    defineNative(
      {
        name: 'SET_VEHICLE_ON_GROUND_PROPERLY',
        hash: 0x49733e92263139d1n,
        result: 'BOOL',
        params: ['Vehicle vehicle'],
      },
      (ctx: NativeContext, vehicle) => partsOf(ctx, vehicle) !== undefined,
    ),
    defineNative(
      {
        name: 'IS_VEHICLE_ON_ALL_WHEELS',
        hash: 0xb104cd1babf302e2n,
        result: 'BOOL',
        params: ['Vehicle vehicle'],
      },
      (ctx: NativeContext, vehicle) => partsOf(ctx, vehicle) !== undefined,
    ),
    fixed('GET_VEHICLE_MAX_NUMBER_OF_PASSENGERS', 0xa7c4f2c6e744a550n, SEATS - 1),
    defineNative(
      {
        name: 'GET_VEHICLE_MODEL_NUMBER_OF_SEATS',
        hash: 0x2ad93716f184eda4n,
        result: 'int',
        params: ['Hash modelHash'],
      },
      () => SEATS,
    ),
    defineNative(
      {
        name: 'GET_VEHICLE_NUMBER_OF_PASSENGERS',
        hash: 0x24cb2137731ffe89n,
        result: 'int',
        params: ['Vehicle vehicle'],
      },
      (ctx: NativeContext, vehicle) => {
        const found = clientEntityOf(ctx, vehicle)
        return found === undefined ? 0 : [...found.occupants.keys()].filter((s) => s >= 0).length
      },
    ),
    defineNative(
      {
        name: 'IS_VEHICLE_MODEL',
        hash: 0x423e8de37d934d89n,
        result: 'BOOL',
        params: ['Vehicle vehicle', 'Hash model'],
      },
      (ctx: NativeContext, vehicle, model) => clientEntityOf(ctx, vehicle)?.model === model,
    ),
    defineNative(
      {
        name: 'IS_THIS_MODEL_A_CAR',
        hash: 0x7f6db52eefc96df8n,
        result: 'BOOL',
        params: ['Hash model'],
      },
      (ctx: NativeContext, model) => ctx.manager.world!.kindOf(model) === EntityType.vehicle,
    ),
  ]
}
