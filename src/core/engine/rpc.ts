import type { LuaRuntime, LuaValue } from '../lua/index.ts'
import { hashString, luaName, type ParamSpec, type RegisteredNative } from '../natives/index.ts'
import { unimplementedDiagnosis } from '../scripting/runtime.ts'
import { NativeContext, type NativeRuntime } from './context.ts'
import type { ResourceManager } from './manager.ts'
import type { Resource } from './resource.ts'
import type { ClientEntity } from './world/client.ts'

/**
 * A native that FiveM's servers have clients run, as its RPC natives are:
 * by the client that owns the entity, or that is the player, which its
 * first argument names, or to create an entity, by a client near where it
 * goes.
 */
export interface RpcNative {
  /** The name that servers declare it by, whose hash names it there. */
  readonly name: string
  readonly kind: 'context' | 'create'
  /** The hash of the native of GTA V that clients run. */
  readonly hash: bigint
  /**
   * Its parameters, as GTA V declares them. Servers take players by their
   * net ids, and entities by their handles or the net ids of the players
   * whose peds they are.
   */
  readonly params: readonly ParamSpec[]
}

/** An argument of a native that a server has a client run, as it goes to the client. */
export type RpcArg =
  | { readonly kind: 'entity'; readonly objectId: number }
  /** An entity that the client creates for the server, by its creation token. */
  | { readonly kind: 'created'; readonly token: number }
  | { readonly kind: 'player'; readonly netId: number }
  | { readonly kind: 'hash'; readonly hash: number }
  | { readonly kind: 'value'; readonly value: number | boolean | string }

/** A native that a server has a client run for a resource, which the client runs for its resource of that name. */
export interface RpcCall {
  readonly hash: bigint
  readonly resource: string
  /** The creation token of the entity that the native creates, for those that create one. */
  readonly token?: number
  readonly args: readonly RpcArg[]
}

function context(name: string, hash: bigint, params: readonly ParamSpec[]): RpcNative {
  return { name, kind: 'context', hash, params }
}

function create(name: string, hash: bigint, params: readonly ParamSpec[]): RpcNative {
  return { name, kind: 'create', hash, params }
}

/**
 * The natives that FiveM's servers have clients run, by the names of its
 * list of them: those of entities, players, peds, weapons, tasks and
 * vehicles, and those that create entities, but CreatePed and
 * CreateObjectNoOffset, which servers create themselves. Those of blips
 * are not there yet.
 */
export const RPC_NATIVES: readonly RpcNative[] = [
  context('SET_ENTITY_COORDS', 0x06843da7060a026bn, [
    'Entity entity',
    'float xPos',
    'float yPos',
    'float zPos',
    'BOOL alive',
    'BOOL deadFlag',
    'BOOL ragdollFlag',
    'BOOL clearArea',
  ]),
  context('SET_ENTITY_ROTATION', 0x8524a8b0171d5e07n, [
    'Entity entity',
    'float pitch',
    'float roll',
    'float yaw',
    'int rotationOrder',
    'BOOL bDeadCheck',
  ]),
  context('SET_ENTITY_VELOCITY', 0x1c99bb7b6e96d16fn, [
    'Entity entity',
    'float x',
    'float y',
    'float z',
  ]),
  context('SET_ENTITY_HEADING', 0x8e2530aa8ada980en, ['Entity entity', 'float heading']),
  context('FREEZE_ENTITY_POSITION', 0x428ca6dbd1094446n, ['Entity entity', 'BOOL toggle']),
  context('APPLY_FORCE_TO_ENTITY', 0xc5f68be9613e2d18n, [
    'Entity entity',
    'int forceType',
    'float x',
    'float y',
    'float z',
    'float offX',
    'float offY',
    'float offZ',
    'int nComponent',
    'BOOL bLocalForce',
    'BOOL bLocalOffset',
    'BOOL bScaleByMass',
    'BOOL bPlayAudio',
    'BOOL bScaleByTimeWarp',
  ]),
  context('SET_PLAYER_MODEL', 0x00a1cadd00108836n, ['Player player', 'Hash model']),
  context('SET_PLAYER_CONTROL', 0x8d32347d6d4c40a2n, [
    'Player player',
    'BOOL bHasControl',
    'int flags',
  ]),
  context('SET_PLAYER_INVINCIBLE', 0x239528eacdc3e7den, ['Player player', 'BOOL bInvincible']),
  context('SET_PLAYER_WANTED_LEVEL', 0x39ff19c64ef7da5bn, [
    'Player player',
    'int wantedLevel',
    'BOOL delayedResponse',
  ]),
  context('CLEAR_PLAYER_WANTED_LEVEL', 0xb302540597885499n, ['Player player']),
  create('CREATE_PED_INSIDE_VEHICLE', 0x7dd959874c1fd534n, [
    'Vehicle vehicle',
    'int pedType',
    'Hash modelHash',
    'int seat',
    'BOOL isNetwork',
    'BOOL bScriptHostPed',
  ]),
  context('ADD_PED_DECORATION_FROM_HASHES', 0x5f5d1665e352a839n, [
    'Ped ped',
    'Hash collection',
    'Hash overlay',
  ]),
  context('SET_PED_INTO_VEHICLE', 0xf75b0d629e1c063dn, [
    'Ped ped',
    'Vehicle vehicle',
    'int seatIndex',
  ]),
  context('SET_PED_HEAD_BLEND_DATA', 0x9414e18b9434c2fen, [
    'Ped ped',
    'int shapeFirstID',
    'int shapeSecondID',
    'int shapeThirdID',
    'int skinFirstID',
    'int skinSecondID',
    'int skinThirdID',
    'float shapeMix',
    'float skinMix',
    'float thirdMix',
    'BOOL isParent',
  ]),
  context('SET_PED_HEAD_OVERLAY', 0x48f44967fa05cc1en, [
    'Ped ped',
    'int overlayID',
    'int index',
    'float opacity',
  ]),
  context('SET_PED_HAIR_TINT', 0x4cffc65454c93a49n, [
    'Ped ped',
    'int colorID',
    'int highlightColorID',
  ]),
  context('SET_PED_HEAD_OVERLAY_COLOR', 0x497bf74a7b9cb952n, [
    'Ped ped',
    'int overlayID',
    'int colorType',
    'int colorID',
    'int secondColorID',
  ]),
  context('SET_PED_EYE_COLOR', 0x50b56988b170afdfn, ['Ped ped', 'int index']),
  context('SET_PED_FACE_FEATURE', 0x71a5c1dba060049en, ['Ped ped', 'int index', 'float scale']),
  context('SET_PED_DEFAULT_COMPONENT_VARIATION', 0x45eee61580806d63n, ['Ped ped']),
  context('SET_PED_RANDOM_COMPONENT_VARIATION', 0xc8a9481a01e63c28n, ['Ped ped', 'int p1']),
  context('SET_PED_COMPONENT_VARIATION', 0x262b14f48d29de80n, [
    'Ped ped',
    'int componentId',
    'int drawableId',
    'int textureId',
    'int paletteId',
  ]),
  context('CLEAR_PED_PROP', 0x0943e5b8e078e76en, ['Ped ped', 'int propId']),
  context('SET_PED_RANDOM_PROPS', 0xc44aa05345c992c6n, ['Ped ped']),
  context('SET_PED_PROP_INDEX', 0x93376b65a266eb5fn, [
    'Ped ped',
    'int componentId',
    'int drawableId',
    'int textureId',
    'BOOL attach',
  ]),
  context('SET_PED_ARMOUR', 0xcea04d83135264ccn, ['Ped ped', 'int amount']),
  context('SET_PED_CAN_RAGDOLL', 0xb128377056a54e2an, ['Ped ped', 'BOOL toggle']),
  context('SET_PED_CONFIG_FLAG', 0x1913fe4cbf41c463n, ['Ped ped', 'int flagId', 'BOOL value']),
  context('SET_PED_RESET_FLAG', 0xc1e8a365bf3b29f2n, ['Ped ped', 'int flagId', 'BOOL doReset']),
  context('SET_PED_TO_RAGDOLL', 0xae99fb955581844an, [
    'Ped ped',
    'int minTime',
    'int maxTime',
    'int ragdollType',
    'BOOL bAbortIfInjured',
    'BOOL bAbortIfDead',
    'BOOL bForceScriptControl',
  ]),
  context('SET_PED_TO_RAGDOLL_WITH_FALL', 0xd76632d99e4966c8n, [
    'Ped ped',
    'int minTime',
    'int maxTime',
    'int nFallType',
    'float dirX',
    'float dirY',
    'float dirZ',
    'float fGroundHeight',
    'float grab1X',
    'float grab1Y',
    'float grab1Z',
    'float grab2X',
    'float grab2Y',
    'float grab2Z',
  ]),
  context('GIVE_WEAPON_TO_PED', 0xbf0fd6e56c964fcbn, [
    'Ped ped',
    'Hash weaponHash',
    'int ammoCount',
    'BOOL isHidden',
    'BOOL bForceInHand',
  ]),
  context('GIVE_WEAPON_COMPONENT_TO_PED', 0xd966d51aa5b28bb9n, [
    'Ped ped',
    'Hash weaponHash',
    'Hash componentHash',
  ]),
  context('REMOVE_WEAPON_FROM_PED', 0x4899cb088edf59b8n, ['Ped ped', 'Hash weaponHash']),
  context('REMOVE_ALL_PED_WEAPONS', 0xf25df915fa38c5f3n, ['Ped ped', 'BOOL p1']),
  context('REMOVE_WEAPON_COMPONENT_FROM_PED', 0x1e8be90c74fb4c09n, [
    'Ped ped',
    'Hash weaponHash',
    'Hash componentHash',
  ]),
  context('SET_CURRENT_PED_WEAPON', 0xadf692b254977c0cn, [
    'Ped ped',
    'Hash weaponHash',
    'BOOL bForceInHand',
  ]),
  context('SET_PED_AMMO', 0x14e56bc5b5db6a19n, ['Ped ped', 'Hash weaponHash', 'int ammo']),
  context('TASK_REACT_AND_FLEE_PED', 0x72c896464915d1b1n, ['Ped ped', 'Ped fleeTarget']),
  context('TASK_SHOOT_AT_COORD', 0x46a6cc01e0826106n, [
    'Ped ped',
    'float x',
    'float y',
    'float z',
    'int duration',
    'Hash firingPattern',
  ]),
  context('TASK_SHOOT_AT_ENTITY', 0x08da95e8298ae772n, [
    'Entity entity',
    'Entity target',
    'int duration',
    'Hash firingPattern',
  ]),
  context('TASK_COMBAT_PED', 0xf166e48407bac484n, ['Ped ped', 'Ped targetPed', 'int p2', 'int p3']),
  context('TASK_DRIVE_BY', 0x2f8af0e82773a171n, [
    'Ped driverPed',
    'Ped targetPed',
    'Vehicle targetVehicle',
    'float targetX',
    'float targetY',
    'float targetZ',
    'float distanceToShoot',
    'int pedAccuracy',
    'BOOL p8',
    'Hash firingPattern',
  ]),
  context('TASK_ENTER_VEHICLE', 0xc20e50aa46d09ca8n, [
    'Ped ped',
    'Vehicle vehicle',
    'int timeout',
    'int seatIndex',
    'float speed',
    'int flag',
    'Any p6',
  ]),
  context('TASK_WARP_PED_INTO_VEHICLE', 0x9a7d091411c5f684n, [
    'Ped ped',
    'Vehicle vehicle',
    'int seatIndex',
  ]),
  context('TASK_HANDS_UP', 0xf2eab31979a7f910n, [
    'Ped ped',
    'int duration',
    'Ped facingPed',
    'int p3',
    'BOOL p4',
  ]),
  context('TASK_PLAY_ANIM', 0xea47fe3719165b94n, [
    'Ped ped',
    'char* animDictionary',
    'char* animationName',
    'float blendInSpeed',
    'float blendOutSpeed',
    'int duration',
    'int flag',
    'float playbackRate',
    'BOOL lockX',
    'BOOL lockY',
    'BOOL lockZ',
  ]),
  context('TASK_PLAY_ANIM_ADVANCED', 0x83cdb10ea29b370bn, [
    'Ped ped',
    'char* animDictionary',
    'char* animationName',
    'float posX',
    'float posY',
    'float posZ',
    'float rotX',
    'float rotY',
    'float rotZ',
    'float blendInSpeed',
    'float blendOutSpeed',
    'int duration',
    'Any flag',
    'float animTime',
    'Any p14',
    'Any p15',
  ]),
  context('CLEAR_PED_TASKS', 0xe1ef3c1216aff2cdn, ['Ped ped']),
  context('CLEAR_PED_TASKS_IMMEDIATELY', 0xaaa34f8a7cb32098n, ['Ped ped']),
  context('CLEAR_PED_SECONDARY_TASK', 0x176cecf6f920d707n, ['Ped ped']),
  context('TASK_EVERYONE_LEAVE_VEHICLE', 0x7f93691ab4b92272n, ['Vehicle vehicle']),
  context('TASK_LEAVE_ANY_VEHICLE', 0x504d54df3f6f2247n, ['Ped ped', 'int p1', 'int flags']),
  context('TASK_LEAVE_VEHICLE', 0xd3dbce61a490be02n, ['Ped ped', 'Vehicle vehicle', 'int flags']),
  context('TASK_GO_STRAIGHT_TO_COORD', 0xd76b57b44f1e6f8bn, [
    'Ped ped',
    'float x',
    'float y',
    'float z',
    'float speed',
    'int timeout',
    'float targetHeading',
    'float distanceToSlide',
  ]),
  context('TASK_GO_TO_COORD_ANY_MEANS', 0x5bc448cb78fa3e88n, [
    'Ped ped',
    'float x',
    'float y',
    'float z',
    'float fMoveBlendRatio',
    'Vehicle vehicle',
    'BOOL bUseLongRangeVehiclePathing',
    'int drivingFlags',
    'float fMaxRangeToShootTargets',
  ]),
  context('TASK_GO_TO_ENTITY', 0x6a071245eb0d1882n, [
    'Entity entity',
    'Entity target',
    'int duration',
    'float distance',
    'float speed',
    'float p5',
    'int p6',
  ]),
  create('CREATE_VEHICLE', 0xaf35d0d2583051b0n, [
    'Hash modelHash',
    'float x',
    'float y',
    'float z',
    'float heading',
    'BOOL isNetwork',
    'BOOL netMissionEntity',
  ]),
  context('SET_VEHICLE_ALARM', 0xcde5e70c1ddb954cn, ['Vehicle vehicle', 'BOOL state']),
  context('SET_VEHICLE_BODY_HEALTH', 0xb77d05ac8c78aadbn, ['Vehicle vehicle', 'float value']),
  context('SET_VEHICLE_COLOURS', 0x4f1d4be3a7f24601n, [
    'Vehicle vehicle',
    'int colorPrimary',
    'int colorSecondary',
  ]),
  context('SET_VEHICLE_COLOUR_COMBINATION', 0x33e8cd3322e2fe31n, [
    'Vehicle vehicle',
    'int colorCombination',
  ]),
  context('SET_VEHICLE_CUSTOM_PRIMARY_COLOUR', 0x7141766f91d15bean, [
    'Vehicle vehicle',
    'int r',
    'int g',
    'int b',
  ]),
  context('SET_VEHICLE_CUSTOM_SECONDARY_COLOUR', 0x36ced73bfed89754n, [
    'Vehicle vehicle',
    'int r',
    'int g',
    'int b',
  ]),
  context('SET_VEHICLE_DIRT_LEVEL', 0x79d3b596fe44ee8bn, ['Vehicle vehicle', 'float dirtLevel']),
  context('SET_VEHICLE_DOOR_BROKEN', 0xd4d4f6a4ab575a33n, [
    'Vehicle vehicle',
    'int doorIndex',
    'BOOL deleteDoor',
  ]),
  context('SET_VEHICLE_NUMBER_PLATE_TEXT', 0x95a88f0b409cda47n, [
    'Vehicle vehicle',
    'char* plateText',
  ]),
  context('SET_VEHICLE_DOORS_LOCKED', 0xb664292eaecf7fa6n, [
    'Vehicle vehicle',
    'int doorLockStatus',
  ]),
  create('CREATE_OBJECT', 0x509d5878eb39e842n, [
    'Hash modelHash',
    'float x',
    'float y',
    'float z',
    'BOOL isNetwork',
    'BOOL netMissionEntity',
    'BOOL doorFlag',
  ]),
]

const BY_HASH: ReadonlyMap<bigint, RpcNative> = new Map(
  RPC_NATIVES.map((native) => [native.hash, native]),
)

/** The hashes of the natives that clients run as they run those of their servers. */
const REQUEST_MODEL = 0x963d27a58df860acn
const HAS_MODEL_LOADED = 0x98a4eb5d89a0c952n
const SET_MODEL_AS_NO_LONGER_NEEDED = 0xe532f5d78798daabn
const GET_PLAYER_FROM_SERVER_ID = BigInt(hashString('GET_PLAYER_FROM_SERVER_ID'))

/** What a client queues to run for its server, for a resource, once what it waits for is there. */
interface Queued {
  readonly resource: string
  readonly run: () => void
  readonly ready: () => boolean
}

/**
 * The natives that the server of a client has it run, as FiveM's clients
 * run them: in a queue that runs as the client ticks, for the resources of
 * the names that the server gives, while they are started. The models of
 * their hashes load first.
 */
export class ClientRpc {
  readonly #manager: ResourceManager
  readonly #queue: Queued[] = []
  readonly #runtimes = new WeakMap<Resource, RpcRuntime>()

  constructor(manager: ResourceManager) {
    this.#manager = manager
  }

  /** Takes a native that the server has the client run, which it queues after what it needs first. */
  receive(call: RpcCall): void {
    const native = BY_HASH.get(call.hash)
    const resource = this.#resourceOf(call.resource)
    if (native === undefined || resource === undefined) return
    const ready: (() => boolean)[] = []
    const after: (() => void)[] = []
    for (const arg of call.args) {
      // An entity that the client creates for the server is there once the client created it.
      if (arg.kind === 'created') ready.push(() => this.#createdOf(arg.token) !== undefined)
      // FiveRunner's CD image has every model but 0, and clients load the models of what they create, whatever they are.
      if (arg.kind !== 'hash' || (arg.hash === 0 && native.kind !== 'create')) continue
      this.#enqueue(resource, () => this.#invoke(resource, this.#native(REQUEST_MODEL), [arg.hash]))
      ready.push(() => this.#invoke(resource, this.#native(HAS_MODEL_LOADED), [arg.hash]) === true)
      after.push(() =>
        this.#invoke(resource, this.#native(SET_MODEL_AS_NO_LONGER_NEEDED), [arg.hash]),
      )
    }
    this.#enqueue(
      resource,
      () => this.#run(resource, native, call, after),
      () => ready.every((check) => check()),
    )
  }

  /**
   * Runs what the queue holds for the resources that are started, and drops
   * what is for others. What is not ready waits for the next tick.
   */
  tick(): void {
    const waiting: Queued[] = []
    for (let entry = this.#queue.shift(); entry !== undefined; entry = this.#queue.shift()) {
      const resource = this.#manager.getResource(entry.resource, false)
      if (resource?.state !== 'started') continue
      if (entry.ready()) entry.run()
      else waiting.push(entry)
    }
    this.#queue.push(...waiting)
  }

  /** The resource of the client whose name has the hash of `name`, as FiveM's clients find them: the last there is. */
  #resourceOf(name: string): Resource | undefined {
    const hash = hashString(name)
    let found: Resource | undefined
    for (const resource of this.#manager.resources) {
      if (hashString(resource.name) === hash) found = resource
    }
    return found
  }

  #enqueue(resource: Resource, run: () => void, ready = () => true): void {
    this.#queue.push({ resource: resource.name, run, ready })
  }

  /** Runs a native that the server has the client run, with its arguments as the client knows them, then what comes after it. */
  #run(resource: Resource, rpc: RpcNative, call: RpcCall, after: readonly (() => void)[]): void {
    const world = this.#manager.world!
    const values: (number | boolean | string)[] = []
    for (const arg of call.args) {
      switch (arg.kind) {
        case 'player': {
          // A native of a player that the client does not know of runs not.
          const index = this.#invoke(resource, this.#native(GET_PLAYER_FROM_SERVER_ID), [
            arg.netId,
          ]) as number
          if (index === -1) return
          values.push(index)
          break
        }
        case 'entity':
          values.push(world.byObjectId(arg.objectId)?.handle ?? -1)
          break
        case 'created':
          values.push(this.#createdOf(arg.token)!.handle)
          break
        case 'hash':
          values.push(arg.hash)
          break
        default:
          values.push(arg.value)
      }
    }
    // The client has natives of the catalog by their names alone.
    const { natives } = this.#manager
    const native = natives.byHash(call.hash) ?? natives.byName(luaName(rpc.name))!
    let result: unknown
    try {
      result = this.#invoke(resource, native, values)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.#manager.trace('gta-net-five', `failure executing native rpc: ${message}\n`)
      return
    }
    // The entity that the native created, if any, goes to the server with its creation token once it networked it.
    const created = call.token === undefined ? undefined : world.byHandle(result as number)
    if (created !== undefined) created.creationToken = call.token
    for (const fn of after) fn()
  }

  /** The entity that the client created and networked for its server with a creation token, while there is one. */
  #createdOf(token: number): ClientEntity | undefined {
    for (const entity of this.#manager.world!.entities) {
      if (entity.creationToken === token && entity.objectId !== undefined) return entity
    }
    return undefined
  }

  /** A native that the client implements, by its hash. */
  #native(hash: bigint): RegisteredNative<NativeContext> {
    return this.#manager.natives.byHash(hash)!
  }

  /** Runs a native of the client, with values for its parameters as the native takes them. */
  #invoke(
    resource: Resource,
    native: RegisteredNative<NativeContext>,
    values: readonly (number | boolean | string)[],
  ): unknown {
    const runtime = this.#runtimeOf(resource)
    if (native.impl === null) {
      runtime.unimplemented(native.name, native.hash)
      return undefined
    }
    // The values are of the types that the native declares, as GTA V's declarations of both sides are.
    const impl = native.impl as (ctx: NativeContext, ...args: unknown[]) => unknown
    return impl(new NativeContext(runtime, resource), ...values)
  }

  #runtimeOf(resource: Resource): RpcRuntime {
    let runtime = this.#runtimes.get(resource)
    if (runtime === undefined) {
      runtime = new RpcRuntime(this.#manager, resource.name)
      this.#runtimes.set(resource, runtime)
    }
    return runtime
  }
}

/**
 * What runs the natives that the server of a client has it run, for a
 * resource, as FiveM's dummy script environment does: with no Lua of its
 * own. It says what goes wrong as the scripts of the resource would.
 */
class RpcRuntime implements NativeRuntime {
  readonly host = { instanceId: 1 }
  readonly #manager: ResourceManager
  readonly #resource: string
  readonly #unimplemented = new Set<bigint>()

  constructor(manager: ResourceManager, resource: string) {
    this.#manager = manager
    this.#resource = resource
  }

  get lua(): LuaRuntime {
    throw new Error('Natives that servers have clients run have no Lua state.')
  }

  deserialize(): LuaValue {
    throw new Error('Natives that servers have clients run deserialize nothing.')
  }

  trace(text: string): void {
    this.#manager.log('citizen-scripting-core', text)
  }

  diagnose(message: string): void {
    this.#manager.output.diagnose(this.#resource, message)
  }

  emitWarning(channel: string, message: string): void {
    this.#manager.output.warn(this.#resource, `[${channel}] ${message}`)
  }

  unimplemented(name: string, hash: bigint): void {
    if (this.#unimplemented.has(hash)) return
    this.#unimplemented.add(hash)
    this.diagnose(unimplementedDiagnosis(name))
  }
}
