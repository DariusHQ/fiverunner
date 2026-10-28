import { defineNative, type NativeDefinition, type Side } from '../../natives/index.ts'
import type { NativeContext } from '../context.ts'
import { EntityType, entityTypeOf } from '../world/entity.ts'

/** What the scripts of a client set of interiors and of the targets that they render to. */
interface Interiors {
  /** The entity sets of interiors that are active, by the interiors and the names of the sets, with their tints. */
  readonly entitySets: Map<string, number>
  /** The render ids of the targets that scripts registered, by their names. */
  readonly targets: Map<string, number>
  /** The models whose targets scripts linked. */
  readonly linked: Set<number>
  /** The render id that the next target gets. */
  nextId: number
}

/** Natives of the interiors of the map of GTA V, which FiveRunner knows none of, and of the targets that scripts render to. */
export function interiorNatives(side: Side): NativeDefinition<NativeContext>[] {
  if (side === 'server') return []
  const states = new WeakMap<object, Interiors>()
  const of = (ctx: NativeContext) => {
    let state = states.get(ctx.manager)
    if (state === undefined) {
      state = { entitySets: new Map(), targets: new Map(), linked: new Set(), nextId: 1 }
      states.set(ctx.manager, state)
    }
    return state
  }
  /** A native that finds the interior at somewhere, which is none, as FiveRunner has no map, and says so once to each client. */
  const noInterior = (
    name: string,
    hash: bigint,
    params: readonly ('float x' | 'float y' | 'float z' | 'char* interiorType' | 'Entity entity')[],
    shown: string,
  ) => {
    const told = new WeakSet<object>()
    return defineNative({ name, hash, result: 'Interior', params }, (ctx: NativeContext) => {
      if (!told.has(ctx.manager)) {
        told.add(ctx.manager)
        ctx.diagnose(
          `${shown} found no interior, as FiveRunner has no map of GTA V and knows none of its interiors.`,
        )
      }
      return 0
    })
  }
  const set = (interior: number, name: string | null) => `${interior}:${(name ?? '').toLowerCase()}`
  return [
    noInterior(
      'GET_INTERIOR_AT_COORDS',
      0xb0f7f8663821d9c3n,
      ['float x', 'float y', 'float z'],
      'GetInteriorAtCoords',
    ),
    noInterior(
      'GET_INTERIOR_AT_COORDS_WITH_TYPE',
      0x05b7a89bd78797fcn,
      ['float x', 'float y', 'float z', 'char* interiorType'],
      'GetInteriorAtCoordsWithType',
    ),
    noInterior(
      'GET_INTERIOR_FROM_ENTITY',
      0x2107ba504071a6bbn,
      ['Entity entity'],
      'GetInteriorFromEntity',
    ),
    defineNative(
      {
        name: 'IS_VALID_INTERIOR',
        hash: 0x26b0e73d7eaaf4d3n,
        result: 'BOOL',
        params: ['Interior interior'],
      },
      () => false,
    ),
    defineNative(
      {
        name: 'ACTIVATE_INTERIOR_ENTITY_SET',
        hash: 0x55e86af2712b36a1n,
        result: 'void',
        params: ['Interior interior', 'char* entitySetName'],
      },
      (ctx: NativeContext, interior, name) => {
        const sets = of(ctx).entitySets
        sets.set(set(interior, name), sets.get(set(interior, name)) ?? 0)
      },
    ),
    defineNative(
      {
        name: 'DEACTIVATE_INTERIOR_ENTITY_SET',
        hash: 0x420bd37289eee162n,
        result: 'void',
        params: ['Interior interior', 'char* entitySetName'],
      },
      (ctx: NativeContext, interior, name) => of(ctx).entitySets.delete(set(interior, name)),
    ),
    defineNative(
      {
        name: 'IS_INTERIOR_ENTITY_SET_ACTIVE',
        hash: 0x35f7dd45e8c0a16dn,
        result: 'BOOL',
        params: ['Interior interior', 'char* entitySetName'],
      },
      (ctx: NativeContext, interior, name) => of(ctx).entitySets.has(set(interior, name)),
    ),
    defineNative(
      {
        name: 'SET_INTERIOR_ENTITY_SET_COLOR',
        hash: 0xc1f1920baf281317n,
        result: 'void',
        params: ['Interior interior', 'char* entitySetName', 'int color'],
      },
      (ctx: NativeContext, interior, name, colour) => {
        const sets = of(ctx).entitySets
        if (sets.has(set(interior, name))) sets.set(set(interior, name), colour)
      },
    ),
    // Interiors are drawn, which FiveRunner does not do, as it hides no models of the map and caches no paths.
    ...(
      [
        ['REFRESH_INTERIOR', 0x41f37c3427c75ae0n, ['Interior interior']],
        [
          'CREATE_MODEL_HIDE',
          0x8a97bca30a0ce478n,
          ['float x', 'float y', 'float z', 'float radius', 'Hash modelHash'],
        ],
        [
          'REMOVE_MODEL_HIDE',
          0xd9e3006fb3cbd765n,
          ['float x', 'float y', 'float z', 'float radius', 'Hash modelHash'],
        ],
        ['SET_ALL_PATHS_CACHE_BOUNDINGSTRUCT', 0x228e5c6ad4d74bfdn, ['BOOL toggle']],
      ] as const
    ).map(([name, hash, params]) => defineNative({ name, hash, result: 'void', params }, () => {})),
    // The game of FiveRunner's clients has every DLC of the game build that its server enforces.
    defineNative(
      {
        name: 'IS_DLC_PRESENT',
        hash: 0x812595a0644ce1den,
        result: 'BOOL',
        params: ['Hash dlcHash'],
      },
      () => true,
    ),
    defineNative(
      {
        name: 'REGISTER_NAMED_RENDERTARGET',
        hash: 0x57d9c12635e25ce3n,
        result: 'BOOL',
        params: ['char* name', 'BOOL p1'],
      },
      (ctx: NativeContext, name) => {
        const state = of(ctx)
        const key = (name ?? '').toLowerCase()
        if (key === '' || state.targets.has(key)) return false
        state.targets.set(key, state.nextId++)
        return true
      },
    ),
    defineNative(
      {
        name: 'IS_NAMED_RENDERTARGET_REGISTERED',
        hash: 0x78dcdc15c9f116b4n,
        result: 'BOOL',
        params: ['char* name'],
      },
      (ctx: NativeContext, name) => of(ctx).targets.has((name ?? '').toLowerCase()),
    ),
    defineNative(
      {
        name: 'GET_NAMED_RENDERTARGET_RENDER_ID',
        hash: 0x1a6478b61c6bdc3bn,
        result: 'int',
        params: ['char* name'],
      },
      (ctx: NativeContext, name) => of(ctx).targets.get((name ?? '').toLowerCase()) ?? 0,
    ),
    defineNative(
      {
        name: 'RELEASE_NAMED_RENDERTARGET',
        hash: 0xe9f6ffe837354dd4n,
        result: 'BOOL',
        params: ['char* name'],
      },
      (ctx: NativeContext, name) => of(ctx).targets.delete((name ?? '').toLowerCase()),
    ),
    defineNative(
      {
        name: 'LINK_NAMED_RENDERTARGET',
        hash: 0xf6c09e276aeb3f2dn,
        result: 'void',
        params: ['Hash modelHash'],
      },
      (ctx: NativeContext, model) => of(ctx).linked.add(model),
    ),
    defineNative(
      {
        name: 'IS_NAMED_RENDERTARGET_LINKED',
        hash: 0x113750538fa31298n,
        result: 'BOOL',
        params: ['Hash modelHash'],
      },
      (ctx: NativeContext, model) => of(ctx).linked.has(model),
    ),
    // The objects of the map of GTA V are none of the entities that FiveRunner has, so it finds those of scripts alone.
    defineNative(
      {
        name: 'GET_CLOSEST_OBJECT_OF_TYPE',
        hash: 0xe143fa2249364369n,
        result: 'Object',
        params: ['float x', 'float y', 'float z', 'float radius', 'Hash modelHash'],
      },
      (ctx: NativeContext, x, y, z, radius, model) => {
        let closest = 0
        let best = radius
        for (const entity of ctx.manager.world!.entities) {
          if (entityTypeOf(entity.type) !== EntityType.object || entity.model !== model) continue
          const distance = Math.hypot(entity.x - x, entity.y - y, entity.z - z)
          if (distance <= best) {
            best = distance
            closest = entity.handle
          }
        }
        return closest
      },
    ),
  ]
}
