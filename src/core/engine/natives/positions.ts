import { LuaVector } from '../../lua/index.ts'
import { defineNative, type NativeDefinition, type Side } from '../../natives/index.ts'
import type { NativeContext } from '../context.ts'
import type { ClientEntity } from '../world/client.ts'
import { EntityType, entityTypeOf } from '../world/entity.ts'
import { apply } from '../world/rotation.ts'
import { clientEntityOf } from './entities.ts'
import { playerPed } from './players.ts'

const ZERO = { x: 0, y: 0, z: 0 } as const

const vector = ([x, y, z]: readonly [number, number, number]) => ({ x, y, z })

/** The closest entity of a type to somewhere, within a radius, of those that `fits`. */
function closest(
  ctx: NativeContext,
  type: number,
  x: number,
  y: number,
  z: number,
  radius: number,
  fits: (entity: ClientEntity) => boolean,
): ClientEntity | undefined {
  let found: ClientEntity | undefined
  let best = radius
  for (const entity of ctx.manager.world!.entities) {
    if (entityTypeOf(entity.type) !== type || !fits(entity)) continue
    const distance = Math.hypot(entity.x - x, entity.y - y, entity.z - z)
    if (distance <= best) {
      best = distance
      found = entity
    }
  }
  return found
}

/** Natives of where entities are and what they are attached to, in a world that has no map, no models and so no bones. */
export function positionNatives(side: Side): NativeDefinition<NativeContext>[] {
  if (side === 'server') return []
  /** Whether an entity is attached to an entity of a type. */
  const attachedToAny = (name: string, hash: bigint, type: number) =>
    defineNative(
      { name, hash, result: 'BOOL', params: ['Entity entity'] },
      (ctx: NativeContext, entity) => {
        const to = clientEntityOf(ctx, entity)?.attachedTo
        return to !== undefined && entityTypeOf(to.type) === type
      },
    )
  /** The position of a bone of an entity, which is where the entity is, as it has no bones. */
  const bonePosition = (name: string, hash: bigint) =>
    defineNative(
      { name, hash, result: 'Vector3', params: ['Entity entity', 'int boneIndex'] },
      (ctx: NativeContext, entity) => {
        const found = clientEntityOf(ctx, entity)
        return found === undefined ? ZERO : vector([found.x, found.y, found.z])
      },
    )
  return [
    defineNative(
      {
        name: 'ATTACH_ENTITY_TO_ENTITY',
        hash: 0x6b9bbd38ab0796dfn,
        result: 'void',
        params: [
          'Entity entity1',
          'Entity entity2',
          'int boneIndex',
          'float xPos',
          'float yPos',
          'float zPos',
          'float xRot',
          'float yRot',
          'float zRot',
          'BOOL p9',
          'BOOL useSoftPinning',
          'BOOL collision',
          'BOOL isPed',
          'int rotationOrder',
          'BOOL syncRot',
        ],
      },
      (ctx: NativeContext, entity, to, _bone, x, y, z) => {
        const found = clientEntityOf(ctx, entity)
        const parent = clientEntityOf(ctx, to)
        if (found !== undefined && parent !== undefined) found.attachTo(parent, x, y, z)
      },
    ),
    defineNative(
      {
        name: 'DETACH_ENTITY',
        hash: 0x961ac54bf0613f5dn,
        result: 'void',
        params: ['Entity entity', 'BOOL dynamic', 'BOOL collision'],
      },
      (ctx: NativeContext, entity) => clientEntityOf(ctx, entity)?.detach(),
    ),
    defineNative(
      {
        name: 'IS_ENTITY_ATTACHED',
        hash: 0xb346476ef1a64897n,
        result: 'BOOL',
        params: ['Entity entity'],
      },
      (ctx: NativeContext, entity) => clientEntityOf(ctx, entity)?.attachedTo !== undefined,
    ),
    defineNative(
      {
        name: 'IS_ENTITY_ATTACHED_TO_ENTITY',
        hash: 0xefbe71898a993728n,
        result: 'BOOL',
        params: ['Entity from', 'Entity to'],
      },
      (ctx: NativeContext, from, to) => {
        const parent = clientEntityOf(ctx, from)?.attachedTo
        return parent !== undefined && parent.handle === to
      },
    ),
    attachedToAny('IS_ENTITY_ATTACHED_TO_ANY_PED', 0xb1632e9a5f988d11n, EntityType.ped),
    attachedToAny('IS_ENTITY_ATTACHED_TO_ANY_VEHICLE', 0x26aa915ad89bfb4bn, EntityType.vehicle),
    attachedToAny('IS_ENTITY_ATTACHED_TO_ANY_OBJECT', 0xcf511840ceede0ccn, EntityType.object),
    defineNative(
      {
        name: 'GET_ENTITY_ATTACHED_TO',
        hash: 0x48c2bed9180fe123n,
        result: 'Entity',
        params: ['Entity entity'],
      },
      (ctx: NativeContext, entity) => clientEntityOf(ctx, entity)?.attachedTo?.handle ?? 0,
    ),
    // Bones: every entity has all of them, where it is.
    defineNative(
      {
        name: 'GET_PED_BONE_INDEX',
        hash: 0x3f428d08be5aae31n,
        result: 'int',
        params: ['Ped ped', 'int boneId'],
      },
      (ctx: NativeContext, ped, bone) => (clientEntityOf(ctx, ped) === undefined ? -1 : bone),
    ),
    defineNative(
      {
        name: 'GET_ENTITY_BONE_INDEX_BY_NAME',
        hash: 0xfb71170b7e76acban,
        result: 'int',
        params: ['Entity entity', 'char* boneName'],
      },
      (ctx: NativeContext, entity) => (clientEntityOf(ctx, entity) === undefined ? -1 : 0),
    ),
    bonePosition('GET_WORLD_POSITION_OF_ENTITY_BONE', 0x44a8fcb8ed227738n),
    bonePosition('_GET_ENTITY_BONE_POSITION_2', 0x46f8696933a63c9bn),
    defineNative(
      {
        name: 'GET_PED_BONE_COORDS',
        hash: 0x17c07fc640e86b4en,
        result: 'Vector3',
        params: ['Ped ped', 'int boneId', 'float offsetX', 'float offsetY', 'float offsetZ'],
      },
      (ctx: NativeContext, ped, _bone, offsetX, offsetY, offsetZ) => {
        const found = clientEntityOf(ctx, ped)
        if (found === undefined) return ZERO
        const [x, y, z] = apply(found.rotation, offsetX, offsetY, offsetZ)
        return vector([found.x + x, found.y + y, found.z + z])
      },
    ),
    defineNative(
      {
        name: 'GET_ENTITY_MATRIX',
        hash: 0xecb2fc7235a7d137n,
        result: 'void',
        params: [
          'Entity entity',
          'Vector3* forwardVector',
          'Vector3* rightVector',
          'Vector3* upVector',
          'Vector3* position',
        ],
      },
      (ctx: NativeContext, entity, forward, right, up, position) => {
        const found = clientEntityOf(ctx, entity)
        if (found === undefined) return
        forward.set(new LuaVector('vector3', ...apply(found.rotation, 0, 1, 0)))
        right.set(new LuaVector('vector3', ...apply(found.rotation, 1, 0, 0)))
        up.set(new LuaVector('vector3', ...apply(found.rotation, 0, 0, 1)))
        position.set(new LuaVector('vector3', found.x, found.y, found.z))
      },
    ),
    defineNative(
      {
        name: 'GET_OFFSET_FROM_ENTITY_GIVEN_WORLD_COORDS',
        hash: 0x2274bc1c4885e333n,
        result: 'Vector3',
        params: ['Entity entity', 'float posX', 'float posY', 'float posZ'],
      },
      (ctx: NativeContext, entity, posX, posY, posZ) => {
        const found = clientEntityOf(ctx, entity)
        if (found === undefined) return ZERO
        const [x, y, z] = [posX - found.x, posY - found.y, posZ - found.z]
        // The inverse of a rotation is its transpose.
        const m = found.rotation
        return vector([
          m[0]! * x + m[3]! * y + m[6]! * z,
          m[1]! * x + m[4]! * y + m[7]! * z,
          m[2]! * x + m[5]! * y + m[8]! * z,
        ])
      },
    ),
    // There is no map to find the ground in, so the ground is where scripts ask for it.
    defineNative(
      {
        name: 'GET_GROUND_Z_FOR_3D_COORD',
        hash: 0xc906a7dab05c8d2bn,
        result: 'BOOL',
        params: ['float x', 'float y', 'float z', 'float* groundZ', 'BOOL includeWater'],
      },
      (_ctx, _x, _y, z, groundZ) => {
        groundZ.set(z)
        return true
      },
    ),
    defineNative(
      {
        name: 'PLACE_OBJECT_ON_GROUND_PROPERLY',
        hash: 0x58a850eaee20faa3n,
        result: 'BOOL',
        params: ['Object object'],
      },
      (ctx: NativeContext, object) => clientEntityOf(ctx, object) !== undefined,
    ),
    // What is near.
    defineNative(
      {
        name: 'GET_CLOSEST_VEHICLE',
        hash: 0xf73eb622c4f1689bn,
        result: 'Vehicle',
        params: ['float x', 'float y', 'float z', 'float radius', 'Hash modelHash', 'int flags'],
      },
      (ctx: NativeContext, x, y, z, radius, model) =>
        closest(
          ctx,
          EntityType.vehicle,
          x,
          y,
          z,
          radius,
          (vehicle) => model === 0 || vehicle.model === model,
        )?.handle ?? 0,
    ),
    defineNative(
      {
        name: 'GET_CLOSEST_PED',
        hash: 0xc33ab876a77f8164n,
        result: 'BOOL',
        params: [
          'float x',
          'float y',
          'float z',
          'float radius',
          'BOOL p4',
          'BOOL p5',
          'Ped* outPed',
          'BOOL p7',
          'BOOL p8',
          'int pedType',
        ],
      },
      (ctx: NativeContext, x, y, z, radius, _p4, _p5, outPed) => {
        const { playerPed: player } = ctx.manager.world!
        const found = closest(ctx, EntityType.ped, x, y, z, radius, (ped) => ped !== player)
        outPed.set(found?.handle ?? 0)
        return found !== undefined
      },
    ),
    defineNative(
      {
        name: 'IS_ANY_VEHICLE_NEAR_POINT',
        hash: 0x61e1dd6125a3eee6n,
        result: 'BOOL',
        params: ['float x', 'float y', 'float z', 'float radius'],
      },
      (ctx: NativeContext, x, y, z, radius) =>
        closest(ctx, EntityType.vehicle, x, y, z, radius, () => true) !== undefined,
    ),
    // What entities are like.
    defineNative(
      {
        name: 'GET_ENTITY_ALPHA',
        hash: 0x5a47b3b5e63e94c6n,
        result: 'int',
        params: ['Entity entity'],
      },
      (ctx: NativeContext, entity) => clientEntityOf(ctx, entity)?.alpha ?? 0,
    ),
    defineNative(
      {
        name: 'SET_ENTITY_ALPHA',
        hash: 0x44a0870b7e92d7c0n,
        result: 'void',
        params: ['Entity entity', 'int alphaLevel', 'BOOL skin'],
      },
      (ctx: NativeContext, entity, alpha) => {
        const found = clientEntityOf(ctx, entity)
        if (found !== undefined) found.alpha = alpha
      },
    ),
    defineNative(
      {
        name: 'RESET_ENTITY_ALPHA',
        hash: 0x9b1e824ffbb7027an,
        result: 'void',
        params: ['Entity entity'],
      },
      (ctx: NativeContext, entity) => {
        const found = clientEntityOf(ctx, entity)
        if (found !== undefined) found.alpha = 255
      },
    ),
    defineNative(
      {
        name: 'SET_ENTITY_COLLISION',
        hash: 0x1a9205c1b9ee827fn,
        result: 'void',
        params: ['Entity entity', 'BOOL toggle', 'BOOL keepPhysics'],
      },
      (ctx: NativeContext, entity, toggle) => {
        const found = clientEntityOf(ctx, entity)
        if (found !== undefined) found.collision = toggle
      },
    ),
    defineNative(
      {
        name: 'GET_ENTITY_COLLISION_DISABLED',
        hash: 0xccf1e97befdae480n,
        result: 'BOOL',
        params: ['Entity entity'],
      },
      (ctx: NativeContext, entity) => clientEntityOf(ctx, entity)?.collision === false,
    ),
    // Players.
    defineNative(
      {
        name: 'SET_PLAYER_INVINCIBLE',
        hash: 0x239528eacdc3e7den,
        result: 'void',
        params: ['Player player', 'BOOL bInvincible'],
      },
      (ctx: NativeContext, _player, invincible) => {
        ctx.manager.world!.playerInvincible = invincible
      },
    ),
    defineNative(
      {
        name: 'GET_PLAYER_INVINCIBLE',
        hash: 0xb721981b2b939e07n,
        result: 'BOOL',
        params: ['Player player'],
      },
      (ctx: NativeContext) => ctx.manager.world!.playerInvincible,
    ),
    defineNative(
      {
        name: 'SET_PLAYER_CONTROL',
        hash: 0x8d32347d6d4c40a2n,
        result: 'void',
        params: ['Player player', 'BOOL bHasControl', 'int flags'],
      },
      (ctx: NativeContext, _player, control) => {
        ctx.manager.world!.playerControl = control
      },
    ),
    defineNative(
      {
        name: 'IS_PLAYER_CONTROL_ON',
        hash: 0x49c32d60007afa47n,
        result: 'BOOL',
        params: ['Player player'],
      },
      (ctx: NativeContext) => ctx.manager.world!.playerControl,
    ),
    defineNative(
      {
        name: '_NETWORK_GET_PLAYER_COORDS',
        hash: 0x125e6d638b8605d4n,
        result: 'Vector3',
        params: ['Player player'],
      },
      (ctx: NativeContext, player) => {
        const found = clientEntityOf(ctx, playerPed(ctx, player))
        return found === undefined ? ZERO : vector([found.x, found.y, found.z])
      },
    ),
  ]
}
