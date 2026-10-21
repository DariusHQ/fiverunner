import {
  defineNative,
  hashString,
  NativeError,
  type NativeDefinition,
  type Side,
  type Vector3Like,
} from '../../natives/index.ts'
import type { NativeContext } from '../context.ts'
import { pack } from '../msgpack.ts'
import {
  EntityType,
  entityTypeOf,
  NetObjType,
  VEHICLE_TYPES,
  type SyncEntity,
  type SyncState,
} from '../world/entity.ts'
import {
  decompressQuaternion,
  fromSector,
  quaternionRotation,
  radiansToDegrees,
} from '../world/quantize.ts'
import { ClientEntity } from '../world/client.ts'
import { apply, fromEuler, fromHeading, headingOf, toEuler } from '../world/rotation.ts'
import type { ServerGameState } from '../world/server.ts'
import { objectState, pedState, vehicleState } from '../world/setters.ts'
import { checkArgument } from './events.ts'
import { localPlayerIndex, withOneSync } from './players.ts'
import { entityHandle } from './rpc.ts'

const encoder = new TextEncoder()

/** The entity types of the pools that GET_GAME_POOL takes the names of; others are those of no entity type. */
const POOLS: ReadonlyMap<string, number> = new Map([
  ['CPed', EntityType.ped],
  ['CVehicle', EntityType.vehicle],
  ['CObject', EntityType.object],
  ['CNetObject', EntityType.object],
])

/** The game state of the server whose script calls a native. */
function gameStateOf(ctx: NativeContext): ServerGameState {
  return ctx.manager.gameState!
}

/**
 * The entity that the first argument of a native of entities names, as
 * FiveM's makeEntityFunction finds it: 0 names none, for which natives give
 * their default value, and a handle of no entity fails the call. It finds
 * entities that are being deleted too.
 */
function entityOf(ctx: NativeContext, handle: number): SyncEntity | undefined {
  if (handle === 0) return undefined
  const entity = gameStateOf(ctx).byHandle(handle)
  if (entity === undefined) throw new NativeError(`Tried to access invalid entity: ${handle}`)
  return entity
}

/** The rotation of an entity in degrees, as FiveM's server gives it: peds turn about z alone. */
function rotationOf(entity: SyncEntity): Vector3Like {
  const { orientation } = entity.state
  if (orientation.kind === 'heading') {
    return { x: 0, y: 0, z: radiansToDegrees(orientation.heading) }
  }
  const [x, y, z] = quaternionRotation(...decompressQuaternion(orientation.quaternion))
  return { x, y, z }
}

/** The script handles of the valid entities of an entity type, as FiveM's server lists those of its pools. */
function handlesOf(ctx: NativeContext, type: number): Uint8Array {
  const gameState = gameStateOf(ctx)
  const handles: number[] = []
  for (const entity of gameState.entities) {
    if (entity.valid && entityTypeOf(entity.type) === type) handles.push(gameState.handleOf(entity))
  }
  return pack(handles)
}

/** The hash of the name of the resource whose script calls a native, which entities it creates keep. */
function scriptHashOf(ctx: NativeContext): number {
  return hashString(ctx.resource.name)
}

/** Creates an entity for a server setter and returns its handle, or 0 when the server has no object id left. */
function create(ctx: NativeContext, type: NetObjType, state: SyncState): number {
  const gameState = gameStateOf(ctx)
  const entity = gameState.create(type, state)
  return entity === undefined ? 0 : gameState.handleOf(entity)
}

/** The entity of a handle on a client, if there is one: GTA V's natives give their default values for no entity. */
function clientEntityOf(ctx: NativeContext, handle: number): ClientEntity | undefined {
  return ctx.manager.world!.byHandle(handle)
}

/** The vector of x, y and z, which natives give in single precision, as GTA V does. */
function vector([x, y, z]: readonly [number, number, number]): Vector3Like {
  return { x, y, z }
}

const ZERO: Vector3Like = { x: 0, y: 0, z: 0 }

/** How many searches of the pools of clients FiveM's FIND_FIRST natives keep at once. */
const FIND_HANDLES = 64

/** The pools of the games of clients that GET_GAME_POOL names, by the entity types of their entities. */
const CLIENT_POOLS: ReadonlyMap<string, number> = new Map([
  ['CPed', EntityType.ped],
  ['CVehicle', EntityType.vehicle],
  ['CObject', EntityType.object],
  ['CNetObject', EntityType.object],
  ['CPickup', EntityType.none],
])

/**
 * Creates an entity of a client, as GTA V does for scripts: owned by their
 * script as a mission entity, networked with OneSync if they ask, and
 * turned to a heading. Returns its handle, or 0 when its model is not
 * loaded, which GTA V creates nothing of, or when the client has no object
 * id for it to network it with.
 */
function createOnClient(
  ctx: NativeContext,
  native: string,
  type: NetObjType,
  model: number,
  [x, y, z]: readonly [number, number, number],
  heading: number,
  isNetwork: boolean,
): number {
  const world = ctx.manager.world!
  if (!world.loaded(model)) {
    ctx.diagnose(
      `${native} was given a model that is not loaded, so it created nothing and returned 0, as GTA V does: request it with RequestModel, then wait until HasModelLoaded says it loaded.`,
    )
    return 0
  }
  const networks = isNetwork && withOneSync(ctx)
  if (networks && !world.canNetwork) {
    ctx.diagnose(
      `${native} was asked to network the entity, but the client has no object id left to network it with, so it created nothing and returned 0: clients get 4 object ids as they join, and 6 more at their next tick each time they have fewer than 4.`,
    )
    return 0
  }
  const entity = new ClientEntity(type, model)
  entity.moveTo(x, y, z)
  entity.rotation = fromHeading(heading)
  entity.script = ctx.resource.name
  world.add(entity)
  if (networks) world.network(entity)
  return entity.handle
}

/** Natives of entities: those of the game state on servers, and those of the world on clients. */
export function entityNatives(side: Side): NativeDefinition<NativeContext>[] {
  return side === 'client' ? clientEntityNatives() : serverEntityNatives()
}

/** Natives of the entities of the world of clients, as GTA V has them. */
function clientEntityNatives(): NativeDefinition<NativeContext>[] {
  /** A native that tells whether an entity is of an entity type. */
  const isOfType = (name: string, hash: bigint, type: number) =>
    defineNative(
      { name, hash, result: 'BOOL', params: ['Entity entity'] },
      (ctx: NativeContext, entity) => {
        const found = clientEntityOf(ctx, entity)
        return found !== undefined && entityTypeOf(found.type) === type
      },
    )
  /** Puts an entity at a position, as SET_ENTITY_COORDS does without the size of its model, which FiveRunner does not know. */
  const moveTo = (ctx: NativeContext, entity: number, x: number, y: number, z: number) => {
    clientEntityOf(ctx, entity)?.moveTo(x, y, z)
  }
  return [
    defineNative(
      {
        name: 'DOES_ENTITY_EXIST',
        hash: 0x7239b21a38f536ban,
        result: 'BOOL',
        params: ['Entity entity'],
      },
      (ctx: NativeContext, entity) => clientEntityOf(ctx, entity) !== undefined,
    ),
    defineNative(
      {
        name: 'GET_ENTITY_COORDS',
        hash: 0x3fef770d40960d5an,
        result: 'Vector3',
        params: ['Entity entity', 'BOOL alive'],
      },
      (ctx: NativeContext, entity) => {
        const found = clientEntityOf(ctx, entity)
        return found === undefined ? ZERO : { x: found.x, y: found.y, z: found.z }
      },
    ),
    defineNative(
      {
        name: 'SET_ENTITY_COORDS',
        hash: 0x06843da7060a026bn,
        result: 'void',
        params: [
          'Entity entity',
          'float xPos',
          'float yPos',
          'float zPos',
          'BOOL alive',
          'BOOL deadFlag',
          'BOOL ragdollFlag',
          'BOOL clearArea',
        ],
      },
      moveTo,
    ),
    defineNative(
      {
        name: 'SET_ENTITY_COORDS_NO_OFFSET',
        hash: 0x239a3351ac1da385n,
        result: 'void',
        params: [
          'Entity entity',
          'float x',
          'float y',
          'float z',
          'BOOL keepTasks',
          'BOOL keepIK',
          'BOOL doWarp',
        ],
      },
      moveTo,
    ),
    defineNative(
      {
        name: 'GET_ENTITY_HEADING',
        hash: 0xe83d4f9ba2a38914n,
        result: 'float',
        params: ['Entity entity'],
      },
      (ctx: NativeContext, entity) => {
        const found = clientEntityOf(ctx, entity)
        return found === undefined ? 0 : headingOf(found.rotation)
      },
    ),
    defineNative(
      {
        name: 'SET_ENTITY_HEADING',
        hash: 0x8e2530aa8ada980en,
        result: 'void',
        params: ['Entity entity', 'float heading'],
      },
      (ctx: NativeContext, entity, heading) => {
        const found = clientEntityOf(ctx, entity)
        if (found !== undefined) found.rotation = fromHeading(heading)
      },
    ),
    defineNative(
      {
        name: 'GET_ENTITY_ROTATION',
        hash: 0xafbd61cc738d9eb9n,
        result: 'Vector3',
        params: ['Entity entity', 'int rotationOrder'],
      },
      (ctx: NativeContext, entity, rotationOrder) => {
        const found = clientEntityOf(ctx, entity)
        return found === undefined ? ZERO : vector(toEuler(found.rotation, rotationOrder))
      },
    ),
    defineNative(
      {
        name: 'SET_ENTITY_ROTATION',
        hash: 0x8524a8b0171d5e07n,
        result: 'void',
        params: [
          'Entity entity',
          'float pitch',
          'float roll',
          'float yaw',
          'int rotationOrder',
          'BOOL bDeadCheck',
        ],
      },
      (ctx: NativeContext, entity, pitch, roll, yaw, rotationOrder) => {
        const found = clientEntityOf(ctx, entity)
        if (found !== undefined) found.rotation = fromEuler(pitch, roll, yaw, rotationOrder)
      },
    ),
    defineNative(
      {
        name: 'GET_ENTITY_MODEL',
        hash: 0x9f47b058362c84b5n,
        result: 'Hash',
        params: ['Entity entity'],
      },
      (ctx: NativeContext, entity) => clientEntityOf(ctx, entity)?.model ?? 0,
    ),
    defineNative(
      {
        name: 'GET_ENTITY_TYPE',
        hash: 0x8acd366038d14505n,
        result: 'int',
        params: ['Entity entity'],
      },
      (ctx: NativeContext, entity) => {
        const found = clientEntityOf(ctx, entity)
        return found === undefined ? EntityType.none : entityTypeOf(found.type)
      },
    ),
    isOfType('IS_ENTITY_A_PED', 0x524ac5ecea15343en, EntityType.ped),
    isOfType('IS_ENTITY_A_VEHICLE', 0x6ac7003fa6e5575en, EntityType.vehicle),
    isOfType('IS_ENTITY_AN_OBJECT', 0x8d68c8fd0faca94en, EntityType.object),
    defineNative(
      {
        name: 'FREEZE_ENTITY_POSITION',
        hash: 0x428ca6dbd1094446n,
        result: 'void',
        params: ['Entity entity', 'BOOL toggle'],
      },
      (ctx: NativeContext, entity, toggle) => {
        const found = clientEntityOf(ctx, entity)
        if (found !== undefined) found.frozen = toggle
      },
    ),
    defineNative(
      { name: 'IS_ENTITY_POSITION_FROZEN', result: 'BOOL', params: ['Entity entity'] },
      (ctx: NativeContext, entity) => clientEntityOf(ctx, entity)?.frozen ?? false,
    ),
    defineNative(
      {
        name: 'SET_ENTITY_VISIBLE',
        hash: 0xea1c610a04db6bbbn,
        result: 'void',
        params: ['Entity entity', 'BOOL toggle', 'BOOL unk'],
      },
      (ctx: NativeContext, entity, toggle) => {
        const found = clientEntityOf(ctx, entity)
        if (found !== undefined) found.visible = toggle
      },
    ),
    defineNative(
      {
        name: 'IS_ENTITY_VISIBLE',
        hash: 0x47d6f43d77935c75n,
        result: 'BOOL',
        params: ['Entity entity'],
      },
      (ctx: NativeContext, entity) => clientEntityOf(ctx, entity)?.visible ?? false,
    ),
    defineNative(
      {
        name: 'GET_ENTITY_FORWARD_VECTOR',
        hash: 0x0a794a5a57f8df91n,
        result: 'Vector3',
        params: ['Entity entity'],
      },
      (ctx: NativeContext, entity) => {
        const found = clientEntityOf(ctx, entity)
        return found === undefined ? ZERO : vector(apply(found.rotation, 0, 1, 0))
      },
    ),
    defineNative(
      {
        name: 'GET_OFFSET_FROM_ENTITY_IN_WORLD_COORDS',
        hash: 0x1899f328b0e12848n,
        result: 'Vector3',
        params: ['Entity entity', 'float offsetX', 'float offsetY', 'float offsetZ'],
      },
      (ctx: NativeContext, entity, offsetX, offsetY, offsetZ) => {
        const found = clientEntityOf(ctx, entity)
        if (found === undefined) return ZERO
        const [x, y, z] = apply(found.rotation, offsetX, offsetY, offsetZ)
        return vector([found.x + x, found.y + y, found.z + z])
      },
    ),
    defineNative(
      { name: 'NETWORK_GET_ENTITY_OWNER', result: 'int', params: ['Entity entity'] },
      (ctx: NativeContext, entity) => {
        const found = clientEntityOf(ctx, entity)
        // Entities with no network objects have no owners.
        if (found?.objectId === undefined) return -1
        if (found.owner === undefined) return localPlayerIndex(ctx)
        // FiveM's clients give the owners of clones that they know no player of as 255.
        return ctx.manager.world!.indexOf(found.owner) ?? 0xff
      },
    ),
    defineNative(
      {
        name: 'CREATE_VEHICLE',
        hash: 0xaf35d0d2583051b0n,
        result: 'Vehicle',
        params: [
          'Hash modelHash',
          'float x',
          'float y',
          'float z',
          'float heading',
          'BOOL isNetwork',
          'BOOL netMissionEntity',
        ],
      },
      (ctx: NativeContext, modelHash, x, y, z, heading, isNetwork) =>
        createOnClient(
          ctx,
          'CreateVehicle',
          NetObjType.automobile,
          modelHash,
          [x, y, z],
          heading,
          isNetwork,
        ),
    ),
    defineNative(
      {
        name: 'CREATE_PED',
        hash: 0xd49f9b0955c367den,
        result: 'Ped',
        params: [
          'int pedType',
          'Hash modelHash',
          'float x',
          'float y',
          'float z',
          'float heading',
          'BOOL isNetwork',
          'BOOL bScriptHostPed',
        ],
      },
      (ctx: NativeContext, _pedType, modelHash, x, y, z, heading, isNetwork) =>
        createOnClient(ctx, 'CreatePed', NetObjType.ped, modelHash, [x, y, z], heading, isNetwork),
    ),
    ...(
      [
        ['CREATE_OBJECT', 0x509d5878eb39e842n, 'CreateObject'],
        ['CREATE_OBJECT_NO_OFFSET', 0x9a294b2138abb884n, 'CreateObjectNoOffset'],
      ] as const
    ).map(([name, hash, shown]) =>
      defineNative(
        {
          name,
          hash,
          result: 'Object',
          params: [
            'Hash modelHash',
            'float x',
            'float y',
            'float z',
            'BOOL isNetwork',
            'BOOL netMissionEntity',
            'BOOL doorFlag',
          ],
        },
        (ctx: NativeContext, modelHash, x, y, z, isNetwork) =>
          createOnClient(ctx, shown, NetObjType.object, modelHash, [x, y, z], 0, isNetwork),
      ),
    ),
    ...(
      [
        ['DELETE_ENTITY', 0xae3cbe5bf394c9c9n, 'Entity* entity', undefined, 'DeleteEntity'],
        [
          'DELETE_VEHICLE',
          0xea386986e786a54fn,
          'Vehicle* vehicle',
          EntityType.vehicle,
          'DeleteVehicle',
        ],
        ['DELETE_PED', 0x9614299dcb53e54bn, 'Ped* ped', EntityType.ped, 'DeletePed'],
        ['DELETE_OBJECT', 0x539e0ae3e6634b9fn, 'Object* object', EntityType.object, 'DeleteObject'],
      ] as const
    ).map(([name, hash, param, type, shown]) =>
      defineNative(
        { name, hash, result: 'void', params: [param] },
        (ctx: NativeContext, pointer) => {
          const world = ctx.manager.world!
          const found = clientEntityOf(ctx, pointer.get())
          if (found === undefined || (type !== undefined && entityTypeOf(found.type) !== type))
            return
          if (found === world.playerPed) return
          if (found.owner !== undefined) {
            ctx.diagnose(
              `${shown} was given an entity that another client owns, which GTA V does not delete until it has control of it.`,
            )
            return
          }
          if (found.script === undefined) {
            ctx.diagnose(
              `${shown} was given an entity that is no mission entity, which GTA V does not delete: make it one with SetEntityAsMissionEntity(entity, true, true) first.`,
            )
            return
          }
          world.remove(found)
          pointer.set(0)
        },
      ),
    ),
    defineNative(
      {
        name: 'SET_ENTITY_AS_MISSION_ENTITY',
        hash: 0xad738c3085fe7e11n,
        result: 'void',
        params: ['Entity entity', 'BOOL scriptHostObject', 'BOOL bGrabFromOtherScript'],
      },
      (ctx: NativeContext, entity, _scriptHostObject, bGrabFromOtherScript) => {
        const found = clientEntityOf(ctx, entity)
        if (found === undefined || (found.script !== undefined && !bGrabFromOtherScript)) return
        found.script = ctx.resource.name
      },
    ),
    defineNative(
      {
        name: 'IS_ENTITY_A_MISSION_ENTITY',
        hash: 0x0a7b270912999b3cn,
        result: 'BOOL',
        params: ['Entity entity'],
      },
      (ctx: NativeContext, entity) => clientEntityOf(ctx, entity)?.script !== undefined,
    ),
    ...(
      [
        ['SET_ENTITY_AS_NO_LONGER_NEEDED', 0xb736a491e64a32cfn, 'Entity* entity', undefined],
        [
          'SET_VEHICLE_AS_NO_LONGER_NEEDED',
          0x629bfa74418d6239n,
          'Vehicle* vehicle',
          EntityType.vehicle,
        ],
        ['SET_PED_AS_NO_LONGER_NEEDED', 0x2595dd4236549ce3n, 'Ped* ped', EntityType.ped],
        [
          'SET_OBJECT_AS_NO_LONGER_NEEDED',
          0x3ae22deb5ba5a3e6n,
          'Object* object',
          EntityType.object,
        ],
      ] as const
    ).map(([name, hash, param, type]) =>
      defineNative(
        { name, hash, result: 'void', params: [param] },
        (ctx: NativeContext, pointer) => {
          const found = clientEntityOf(ctx, pointer.get())
          if (found === undefined || (type !== undefined && entityTypeOf(found.type) !== type))
            return
          // Scripts let go of the entities that they own.
          if (found.script === ctx.resource.name) found.script = undefined
        },
      ),
    ),
    defineNative(
      {
        name: 'GET_ENTITY_SCRIPT',
        hash: 0xa6e9c38db51d7748n,
        result: 'char*',
        params: ['Entity entity', 'ScrHandle* script'],
      },
      (ctx: NativeContext, entity) => clientEntityOf(ctx, entity)?.script ?? null,
    ),
    defineNative(
      { name: 'GET_GAME_POOL', result: 'object', params: ['char* poolName'] },
      (ctx: NativeContext, poolName) => {
        const name = checkArgument(poolName, 0)
        const type = CLIENT_POOLS.get(name)
        if (type === undefined) throw new NativeError(`Invalid pool: ${name}`)
        const handles: number[] = []
        for (const entity of ctx.manager.world!.entities) {
          if (entityTypeOf(entity.type) !== type) continue
          // CNetObject is the pool of the objects that have network objects.
          if (name === 'CNetObject' && entity.objectId === undefined) continue
          handles.push(entity.handle)
        }
        return pack(handles)
      },
    ),
    ...findNatives(),
    ...clientNetworkNatives(),
    defineNative(
      {
        name: 'HAS_COLLISION_LOADED_AROUND_ENTITY',
        hash: 0xe9676f61bc0b3321n,
        result: 'BOOL',
        params: ['Entity entity'],
      },
      // There is no collision to stream in.
      (ctx: NativeContext, entity) => clientEntityOf(ctx, entity) !== undefined,
    ),
  ]
}

/** Natives of the network objects of the entities of clients, which their object ids name. */
function clientNetworkNatives(): NativeDefinition<NativeContext>[] {
  /** The network id of an entity that a native names, or 0, which it says of entities that are not networked. */
  const networkIdOf = (ctx: NativeContext, native: string, handle: number, type?: number) => {
    const found = clientEntityOf(ctx, handle)
    if (found === undefined || (type !== undefined && entityTypeOf(found.type) !== type)) return 0
    if (found.objectId === undefined) {
      ctx.diagnose(
        `${native} was given an entity that is not networked, which has no network id: FiveRunner returns 0.`,
      )
      return 0
    }
    return found.objectId
  }
  /** The handle of the entity of a network id, of a type if one is given, or 0. */
  const entityOfNetworkId = (ctx: NativeContext, netId: number, type?: number) => {
    const found = ctx.manager.world!.byObjectId(netId)
    if (found === undefined || (type !== undefined && entityTypeOf(found.type) !== type)) return 0
    return found.handle
  }
  const exists = (ctx: NativeContext, netId: number) => entityOfNetworkId(ctx, netId) !== 0
  /** Whether the client controls an entity: one of its own, but no clone of an entity that another owns. */
  const controls = (entity: ClientEntity | undefined) =>
    entity !== undefined && entity.owner === undefined
  return [
    defineNative(
      {
        name: 'NETWORK_GET_NETWORK_ID_FROM_ENTITY',
        hash: 0xa11700682f3ad45cn,
        result: 'int',
        params: ['Entity entity'],
      },
      (ctx: NativeContext, entity) => networkIdOf(ctx, 'NetworkGetNetworkIdFromEntity', entity),
    ),
    ...(
      [
        ['VEH_TO_NET', 0xb4c94523f023419cn, 'Vehicle vehicle', EntityType.vehicle, 'VehToNet'],
        ['PED_TO_NET', 0x0edec3c276198689n, 'Ped ped', EntityType.ped, 'PedToNet'],
        ['OBJ_TO_NET', 0x99bfdc94a603e541n, 'Object object', EntityType.object, 'ObjToNet'],
      ] as const
    ).map(([name, hash, param, type, shown]) =>
      defineNative({ name, hash, result: 'int', params: [param] }, (ctx: NativeContext, entity) =>
        networkIdOf(ctx, shown, entity, type),
      ),
    ),
    defineNative(
      {
        name: 'NETWORK_GET_ENTITY_FROM_NETWORK_ID',
        hash: 0xce4e5d9b0a4ff560n,
        result: 'Entity',
        params: ['int netId'],
      },
      (ctx: NativeContext, netId) => entityOfNetworkId(ctx, netId),
    ),
    ...(
      [
        ['NET_TO_VEH', 0x367b936610ba360cn, 'Vehicle', EntityType.vehicle],
        ['NET_TO_PED', 0xbdcd95fc216a8b3en, 'Ped', EntityType.ped],
        ['NET_TO_OBJ', 0xd8515f5fea14cb3fn, 'Object', EntityType.object],
        ['NET_TO_ENT', 0xbffeab45a9a9094an, 'Entity', undefined],
      ] as const
    ).map(([name, hash, result, type]) =>
      defineNative(
        { name, hash, result, params: ['int netHandle'] },
        (ctx: NativeContext, netHandle) => entityOfNetworkId(ctx, netHandle, type),
      ),
    ),
    defineNative(
      {
        name: 'NETWORK_DOES_NETWORK_ID_EXIST',
        hash: 0x38ce16c96bd11344n,
        result: 'BOOL',
        params: ['int netId'],
      },
      exists,
    ),
    defineNative(
      {
        name: 'NETWORK_DOES_ENTITY_EXIST_WITH_NETWORK_ID',
        hash: 0x18a47d074708fd68n,
        result: 'BOOL',
        params: ['int netId'],
      },
      exists,
    ),
    defineNative(
      {
        name: 'NETWORK_GET_ENTITY_IS_NETWORKED',
        hash: 0xc7827959479dcc78n,
        result: 'BOOL',
        params: ['Entity entity'],
      },
      (ctx: NativeContext, entity) => clientEntityOf(ctx, entity)?.objectId !== undefined,
    ),
    // Clients control the entities of their worlds but the clones of those of others, whose control their owners keep.
    defineNative(
      {
        name: 'NETWORK_HAS_CONTROL_OF_ENTITY',
        hash: 0x01bf60a500e28887n,
        result: 'BOOL',
        params: ['Entity entity'],
      },
      (ctx: NativeContext, entity) => controls(clientEntityOf(ctx, entity)),
    ),
    defineNative(
      {
        name: 'NETWORK_REQUEST_CONTROL_OF_ENTITY',
        hash: 0xb69317bf5e782347n,
        result: 'BOOL',
        params: ['Entity entity'],
      },
      (ctx: NativeContext, entity) => controls(clientEntityOf(ctx, entity)),
    ),
    defineNative(
      {
        name: 'NETWORK_HAS_CONTROL_OF_NETWORK_ID',
        hash: 0x4d36070fe0215186n,
        result: 'BOOL',
        params: ['int netId'],
      },
      (ctx: NativeContext, netId) => controls(ctx.manager.world!.byObjectId(netId)),
    ),
    defineNative(
      {
        name: 'NETWORK_REQUEST_CONTROL_OF_NETWORK_ID',
        hash: 0xa670b3662faffbd0n,
        result: 'BOOL',
        params: ['int netId'],
      },
      (ctx: NativeContext, netId) => controls(ctx.manager.world!.byObjectId(netId)),
    ),
    defineNative(
      {
        name: 'NETWORK_REGISTER_ENTITY_AS_NETWORKED',
        hash: 0x06faacd625d80caan,
        result: 'void',
        params: ['Entity entity'],
      },
      (ctx: NativeContext, entity) => {
        const found = clientEntityOf(ctx, entity)
        // Clients have object ids with OneSync alone.
        if (found !== undefined && found.objectId === undefined) ctx.manager.world!.network(found)
      },
    ),
  ]
}

/**
 * FiveM's natives that search the pools of clients for entities of a type,
 * a search at a time for each of its 64 handles: from the first to the
 * last, as they were when the search began, but for those that went since.
 */
function findNatives(): NativeDefinition<NativeContext>[] {
  const searches: ({ readonly entities: ClientEntity[]; index: number } | undefined)[] = []
  /** The next entity of a search that is still in the world, which it gives the handle of, or -1. */
  const next = (
    ctx: NativeContext,
    search: { readonly entities: ClientEntity[]; index: number },
  ) => {
    const world = ctx.manager.world!
    while (++search.index < search.entities.length) {
      const entity = search.entities[search.index]!
      if (world.byHandle(entity.handle) === entity) return entity.handle
    }
    return -1
  }
  return (
    [
      ['PED', EntityType.ped],
      ['VEHICLE', EntityType.vehicle],
      ['OBJECT', EntityType.object],
      ['PICKUP', EntityType.none],
    ] as const
  ).flatMap(([kind, type]) => [
    defineNative(
      { name: `FIND_FIRST_${kind}`, result: 'int', params: ['Entity* outEntity'] },
      (ctx: NativeContext, outEntity) => {
        let slot = 0
        while (slot < FIND_HANDLES && searches[slot] !== undefined) slot++
        if (slot === FIND_HANDLES) return -1
        const entities = [...ctx.manager.world!.entities].filter(
          (entity) => entityTypeOf(entity.type) === type,
        )
        const search = { entities, index: -1 }
        const found = next(ctx, search)
        outEntity.set(found)
        if (found === -1) return -1
        searches[slot] = search
        return slot
      },
    ),
    defineNative(
      {
        name: `FIND_NEXT_${kind}`,
        result: 'BOOL',
        params: ['int findHandle', 'Entity* outEntity'],
      },
      (ctx: NativeContext, findHandle, outEntity) => {
        const slot = findHandle >>> 0
        if (slot >= FIND_HANDLES) return false
        const search = searches[slot]
        if (search === undefined) {
          ctx.diagnose(
            `FindNext${kind[0]}${kind.slice(1).toLowerCase()} was given the handle of a search that ended, which FiveM's game reads past and crashes on. FiveRunner returns false.`,
          )
          return false
        }
        const found = next(ctx, search)
        outEntity.set(found)
        return found !== -1
      },
    ),
    defineNative(
      { name: `END_FIND_${kind}`, result: 'void', params: ['int findHandle'] },
      (_ctx: NativeContext, findHandle) => {
        const slot = findHandle >>> 0
        if (slot < FIND_HANDLES) searches[slot] = undefined
      },
    ),
  ])
}

/** Natives of the entities of servers, which their game state keeps. */
function serverEntityNatives(): NativeDefinition<NativeContext>[] {
  return [
    defineNative(
      { name: 'DOES_ENTITY_EXIST', result: 'BOOL', params: ['Entity entity'] },
      (ctx: NativeContext, entity) => gameStateOf(ctx).byHandle(entity)?.valid ?? false,
    ),
    defineNative(
      { name: 'NETWORK_GET_ENTITY_FROM_NETWORK_ID', result: 'Entity', params: ['int netId'] },
      (ctx: NativeContext, netId) => {
        const gameState = gameStateOf(ctx)
        const entity = gameState.byObjectId(netId)
        return entity?.valid ? gameState.handleOf(entity) : 0
      },
    ),
    defineNative(
      { name: 'NETWORK_GET_NETWORK_ID_FROM_ENTITY', result: 'int', params: ['Entity entity'] },
      (ctx: NativeContext, entity) => entityOf(ctx, entity)?.objectId ?? 0,
    ),
    defineNative(
      { name: 'NETWORK_GET_ENTITY_OWNER', result: 'int', params: ['Entity entity'] },
      (ctx: NativeContext, entity) => {
        const found = entityOf(ctx, entity)
        return found === undefined ? 0 : (found.owner?.netId ?? -1)
      },
    ),
    defineNative(
      { name: 'NETWORK_GET_FIRST_ENTITY_OWNER', result: 'int', params: ['Entity entity'] },
      (ctx: NativeContext, entity) => {
        const found = entityOf(ctx, entity)
        if (found === undefined) return 0
        return found.firstOwner === undefined || found.firstOwnerDropped
          ? -1
          : found.firstOwner.netId
      },
    ),
    defineNative(
      { name: 'GET_ENTITY_COORDS', result: 'Vector3', params: ['Entity entity'] },
      (ctx: NativeContext, entity) => {
        // With OneSync, FiveM's server gives what is no entity, as its RPC natives see it, where SetEntityCoords put it.
        const gameState = gameStateOf(ctx)
        const handle = entityHandle(ctx, entity)
        if (ctx.manager.oneSync && gameState.byHandle(handle) === undefined) {
          const [x, y, z] = gameState.pendingOf(handle)?.coords ?? [0, 0, 0]
          return { x, y, z }
        }
        const found = entityOf(ctx, entity)
        if (found === undefined) return { x: 0, y: 0, z: 0 }
        const [x, y, z] = fromSector(found.state.position)
        return { x, y, z }
      },
    ),
    defineNative(
      { name: 'GET_ENTITY_ROTATION', result: 'Vector3', params: ['Entity entity'] },
      (ctx: NativeContext, entity) => {
        const found = entityOf(ctx, entity)
        return found === undefined ? { x: 0, y: 0, z: 0 } : rotationOf(found)
      },
    ),
    defineNative(
      { name: 'GET_ENTITY_HEADING', result: 'float', params: ['Entity entity'] },
      (ctx: NativeContext, entity) => {
        const found = entityOf(ctx, entity)
        if (found === undefined) return 0
        const { z } = rotationOf(found)
        return z < 0 ? Math.fround(360 + z) : z
      },
    ),
    defineNative(
      { name: 'GET_ENTITY_POPULATION_TYPE', result: 'int', params: ['Entity entity'] },
      (ctx: NativeContext, entity) => entityOf(ctx, entity)?.state.popType ?? 0,
    ),
    defineNative(
      { name: 'GET_ENTITY_MODEL', result: 'Hash', params: ['Entity entity'] },
      (ctx: NativeContext, entity) => entityOf(ctx, entity)?.state.model ?? 0,
    ),
    defineNative(
      { name: 'GET_ENTITY_SCRIPT', result: 'char*', params: ['Entity entity'] },
      (ctx: NativeContext, entity) => {
        const found = entityOf(ctx, entity)
        if (found === undefined) return null
        // FiveM hashes the first 63 bytes of the names of resources, though it keeps the hash of all of the name.
        for (const resource of ctx.manager.resources) {
          const name = encoder.encode(resource.name).subarray(0, 63)
          if (hashString(name) === found.state.scriptHash) return resource.name
        }
        return null
      },
    ),
    defineNative(
      { name: 'GET_VEHICLE_TYPE', result: 'char*', params: ['Vehicle vehicle'] },
      (ctx: NativeContext, vehicle) => {
        const found = entityOf(ctx, vehicle)
        if (found === undefined) return null
        for (const [name, type] of VEHICLE_TYPES) if (type === found.type) return name
        return null
      },
    ),
    defineNative(
      { name: 'GET_ENTITY_TYPE', result: 'int', params: ['Entity entity'] },
      (ctx: NativeContext, entity) => {
        const found = entityOf(ctx, entity)
        return found === undefined ? 0 : entityTypeOf(found.type)
      },
    ),
    defineNative(
      { name: 'GET_NET_TYPE_FROM_ENTITY', result: 'int', params: ['Entity entity'] },
      (ctx: NativeContext, entity) => entityOf(ctx, entity)?.type ?? -1,
    ),
    defineNative(
      { name: 'GET_GAME_POOL', result: 'object', params: ['char* poolName'] },
      (ctx: NativeContext, poolName) =>
        handlesOf(ctx, POOLS.get(checkArgument(poolName, 0)) ?? EntityType.none),
    ),
    defineNative({ name: 'GET_ALL_PEDS', result: 'object', params: [] }, (ctx: NativeContext) =>
      handlesOf(ctx, EntityType.ped),
    ),
    defineNative({ name: 'GET_ALL_VEHICLES', result: 'object', params: [] }, (ctx: NativeContext) =>
      handlesOf(ctx, EntityType.vehicle),
    ),
    defineNative({ name: 'GET_ALL_OBJECTS', result: 'object', params: [] }, (ctx: NativeContext) =>
      handlesOf(ctx, EntityType.object),
    ),
    defineNative(
      { name: 'DELETE_ENTITY', result: 'void', params: ['Entity entity'] },
      (ctx: NativeContext, entity) => {
        const found = entityOf(ctx, entity)
        if (found !== undefined) gameStateOf(ctx).delete(found)
      },
    ),
    defineNative(
      {
        name: 'CREATE_VEHICLE_SERVER_SETTER',
        result: 'Vehicle',
        params: ['Hash modelHash', 'char* type', 'float x', 'float y', 'float z', 'float heading'],
      },
      (ctx: NativeContext, modelHash, type, x, y, z, heading) => {
        const name = checkArgument(type, 1)
        const netType = VEHICLE_TYPES.get(name)
        if (netType === undefined) {
          throw new NativeError(`CREATE_VEHICLE_SERVER_SETTER: Invalid entity type ${name}`)
        }
        return create(ctx, netType, vehicleState(modelHash, x, y, z, scriptHashOf(ctx), heading))
      },
    ),
    defineNative(
      {
        name: 'CREATE_PED',
        result: 'Ped',
        params: [
          'int pedType',
          'Hash modelHash',
          'float x',
          'float y',
          'float z',
          'float heading',
          'BOOL isNetwork',
          'BOOL bScriptHostPed',
        ],
      },
      (ctx: NativeContext, _pedType, modelHash, x, y, z, heading) =>
        create(ctx, NetObjType.ped, pedState(modelHash, x, y, z, scriptHashOf(ctx), heading)),
    ),
    defineNative(
      {
        name: 'CREATE_OBJECT_NO_OFFSET',
        result: 'Object',
        params: [
          'Hash modelHash',
          'float x',
          'float y',
          'float z',
          'BOOL isNetwork',
          'BOOL netMissionEntity',
          'BOOL doorFlag',
        ],
      },
      (ctx: NativeContext, modelHash, x, y, z) =>
        create(ctx, NetObjType.object, objectState(modelHash, x, y, z, scriptHashOf(ctx))),
    ),
  ]
}
