import { defineNative, type NativeDefinition, type Side } from '../../natives/index.ts'
import type { NativeContext } from '../context.ts'
import type { Door } from '../world/doors.ts'

/** The door of a hash in the door system of the client whose script calls a native, if it has one. */
function doorOf(ctx: NativeContext, hash: number): Door | undefined {
  return ctx.manager.world!.doors.get(hash)
}

/** Natives of the door system of the games of clients, whose doors stay as scripts set them. */
export function doorNatives(side: Side): NativeDefinition<NativeContext>[] {
  if (side === 'server') return []
  /** A native that sets a property of a door, if the door system has it. */
  const set = <K extends 'state' | 'automaticRate' | 'automaticDistance' | 'openRatio'>(
    name: string,
    hash: bigint,
    key: K,
  ) =>
    defineNative(
      {
        name,
        hash,
        result: 'void',
        params: [
          'Hash doorHash',
          key === 'state' ? 'int state' : 'float value',
          'BOOL requestDoor',
          'BOOL forceUpdate',
        ],
      },
      (ctx: NativeContext, door, value) => {
        const found = doorOf(ctx, door)
        if (found !== undefined) found[key] = value
      },
    )
  return [
    defineNative(
      {
        name: 'ADD_DOOR_TO_SYSTEM',
        hash: 0x6f8838d03d1dc226n,
        result: 'void',
        params: ['Hash doorHash', 'Hash modelHash', 'float x', 'float y', 'float z'],
      },
      (ctx: NativeContext, door, model, x, y, z) => {
        ctx.manager.world!.doors.set(door, {
          model,
          x,
          y,
          z,
          state: 0,
          automaticRate: 0,
          automaticDistance: 0,
          openRatio: 0,
          holdOpen: false,
          springRemoved: false,
        })
      },
    ),
    defineNative(
      {
        name: 'REMOVE_DOOR_FROM_SYSTEM',
        hash: 0x464d8e1427156fe4n,
        result: 'void',
        params: ['Hash doorHash'],
      },
      (ctx: NativeContext, door) => ctx.manager.world!.doors.delete(door),
    ),
    defineNative(
      {
        name: 'IS_DOOR_REGISTERED_WITH_SYSTEM',
        hash: 0xc153c43ea202c8c1n,
        result: 'BOOL',
        params: ['Hash doorHash'],
      },
      (ctx: NativeContext, door) => doorOf(ctx, door) !== undefined,
    ),
    set('DOOR_SYSTEM_SET_DOOR_STATE', 0x6bab9442830c7f53n, 'state'),
    set('DOOR_SYSTEM_SET_AUTOMATIC_RATE', 0x03c27e13b42a0e82n, 'automaticRate'),
    set('DOOR_SYSTEM_SET_AUTOMATIC_DISTANCE', 0x9ba001cb45cbf627n, 'automaticDistance'),
    set('DOOR_SYSTEM_SET_OPEN_RATIO', 0xb6e6fba95c7324acn, 'openRatio'),
    // Doors take the states that scripts set at once, so none is pending.
    ...(
      [
        ['DOOR_SYSTEM_GET_DOOR_STATE', 0x160aa1b32f6139b8n],
        ['DOOR_SYSTEM_GET_DOOR_PENDING_STATE', 0x4bc2854478f3a749n],
      ] as const
    ).map(([name, hash]) =>
      defineNative(
        { name, hash, result: 'int', params: ['Hash doorHash'] },
        (ctx: NativeContext, door) => doorOf(ctx, door)?.state ?? 0,
      ),
    ),
    defineNative(
      {
        name: 'DOOR_SYSTEM_GET_AUTOMATIC_DISTANCE',
        hash: 0xe851471aefc3374fn,
        result: 'float',
        params: ['Hash doorHash'],
      },
      (ctx: NativeContext, door) => doorOf(ctx, door)?.automaticDistance ?? 0,
    ),
    defineNative(
      {
        name: 'DOOR_SYSTEM_GET_OPEN_RATIO',
        hash: 0x65499865fca6e5ecn,
        result: 'float',
        params: ['Hash doorHash'],
      },
      (ctx: NativeContext, door) => doorOf(ctx, door)?.openRatio ?? 0,
    ),
    defineNative(
      {
        name: 'DOOR_SYSTEM_SET_HOLD_OPEN',
        hash: 0xd9b71952f78a2640n,
        result: 'void',
        params: ['Hash doorHash', 'BOOL toggle'],
      },
      (ctx: NativeContext, door, toggle) => {
        const found = doorOf(ctx, door)
        if (found !== undefined) found.holdOpen = toggle
      },
    ),
    defineNative(
      {
        name: 'DOOR_SYSTEM_SET_SPRING_REMOVED',
        hash: 0xc485e07e4f0b7958n,
        result: 'void',
        params: ['Hash doorHash', 'BOOL removed'],
      },
      (ctx: NativeContext, door, removed) => {
        const found = doorOf(ctx, door)
        if (found !== undefined) found.springRemoved = removed
      },
    ),
    // Nothing pushes doors, so they are as open as scripts set them.
    defineNative(
      {
        name: 'IS_DOOR_CLOSED',
        hash: 0xc531ee8a1145a149n,
        result: 'BOOL',
        params: ['Hash doorHash'],
      },
      (ctx: NativeContext, door) => (doorOf(ctx, door)?.openRatio ?? 0) === 0,
    ),
    defineNative(
      {
        name: 'DOOR_SYSTEM_GET_IS_PHYSICS_LOADED',
        hash: 0xdf97cdd4fc08fd34n,
        result: 'BOOL',
        params: ['Any p0'],
      },
      () => true,
    ),
    // GTA V finds the doors of a model within half a metre.
    defineNative(
      {
        name: 'DOOR_SYSTEM_FIND_EXISTING_DOOR',
        hash: 0x589f80b325cc82c5n,
        result: 'BOOL',
        params: ['float x', 'float y', 'float z', 'Hash modelHash', 'Hash* outDoorHash'],
      },
      (ctx: NativeContext, x, y, z, model, out) => {
        for (const [hash, door] of ctx.manager.world!.doors) {
          if (door.model === model && Math.hypot(door.x - x, door.y - y, door.z - z) <= 0.5) {
            out.set(hash)
            return true
          }
        }
        return false
      },
    ),
  ]
}
