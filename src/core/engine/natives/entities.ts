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
import type { ServerGameState } from '../world/server.ts'
import { objectState, pedState, vehicleState } from '../world/setters.ts'
import { checkArgument } from './events.ts'

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

/** Natives of the entities of servers, which their game state keeps. */
export function entityNatives(side: Side): NativeDefinition<NativeContext>[] {
  if (side === 'client') return []
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
      // The entities of the server have no owner until a client takes them, which none does yet.
      (ctx: NativeContext, entity) => (entityOf(ctx, entity) === undefined ? 0 : -1),
    ),
    defineNative(
      { name: 'GET_ENTITY_COORDS', result: 'Vector3', params: ['Entity entity'] },
      (ctx: NativeContext, entity) => {
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
