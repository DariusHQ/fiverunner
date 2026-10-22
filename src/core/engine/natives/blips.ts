import { defineNative, hashString, type NativeDefinition, type Side } from '../../natives/index.ts'
import type { NativeContext } from '../context.ts'
import { Blip, type BlipShape, type Blips } from '../world/blips.ts'

/** The blips of the map of the client whose script calls a native. */
function blipsOf(ctx: NativeContext): Blips {
  return ctx.manager.world!.blips
}

/** Creates a blip for the script of a native, at coordinates, and returns its handle. */
function create(ctx: NativeContext, shape: BlipShape, x = 0, y = 0, z = 0): number {
  const blip = new Blip(shape, ctx.resource.name)
  blip.x = x
  blip.y = y
  blip.z = z
  return blipsOf(ctx).add(blip)
}

/** The properties of blips that natives set, and give, by their names. */
type BlipProperty =
  | 'sprite'
  | 'colour'
  | 'alpha'
  | 'scale'
  | 'display'
  | 'shortRange'
  | 'category'
  | 'route'
  | 'routeColour'
  | 'rotation'
  | 'flashes'

/** Natives of the blips of the maps of clients, and of the text of their names, which only clients have. */
export function blipNatives(side: Side): NativeDefinition<NativeContext>[] {
  if (side === 'server') return []
  /** A native that sets a property of a blip, which does nothing for handles of no blip. */
  const setter = (
    name: string,
    hash: bigint,
    param: 'int' | 'float' | 'BOOL',
    property: BlipProperty,
  ) =>
    defineNative(
      { name, hash, result: 'void', params: ['Blip blip', `${param} value`] },
      (ctx: NativeContext, blip, value) => {
        const found = blipsOf(ctx).get(blip)
        if (found !== undefined) (found[property] as number | boolean) = value
      },
    )
  /** A native that gives a property of a blip, or the zero value of its type for handles of no blip. */
  const getter = (
    name: string,
    hash: bigint,
    result: 'int' | 'BOOL',
    property: 'sprite' | 'colour' | 'alpha' | 'shortRange' | 'flashes',
  ) =>
    defineNative(
      { name, hash, result, params: ['Blip blip'] },
      (ctx: NativeContext, blip) =>
        blipsOf(ctx).get(blip)?.[property] ?? (result === 'BOOL' ? false : 0),
    )
  /** The coordinates of a blip, or 0, 0, 0 for handles of no blip. */
  const coordsOf = (ctx: NativeContext, blip: number) => {
    const [x, y, z] = blipsOf(ctx).get(blip)?.coords ?? [0, 0, 0]
    return { x, y, z }
  }
  return [
    defineNative(
      {
        name: 'ADD_BLIP_FOR_COORD',
        hash: 0x5a039bb0bca604b6n,
        result: 'Blip',
        params: ['float x', 'float y', 'float z'],
      },
      (ctx: NativeContext, x, y, z) => create(ctx, { kind: 'coord' }, x, y, z),
    ),
    defineNative(
      {
        name: 'ADD_BLIP_FOR_RADIUS',
        hash: 0x46818d79b1f7499an,
        result: 'Blip',
        params: ['float posX', 'float posY', 'float posZ', 'float radius'],
      },
      (ctx: NativeContext, x, y, z, radius) => create(ctx, { kind: 'radius', radius }, x, y, z),
    ),
    defineNative(
      {
        name: 'ADD_BLIP_FOR_AREA',
        hash: 0xce5d0e5e315db238n,
        result: 'Blip',
        params: ['float x', 'float y', 'float z', 'float width', 'float height'],
      },
      (ctx: NativeContext, x, y, z, width, height) =>
        create(ctx, { kind: 'area', width, height }, x, y, z),
    ),
    defineNative(
      {
        name: 'ADD_BLIP_FOR_ENTITY',
        hash: 0x5cde92c702a8fce7n,
        result: 'Blip',
        params: ['Entity entity'],
      },
      (ctx: NativeContext, entity) => {
        const found = ctx.manager.world!.byHandle(entity)
        return found === undefined ? 0 : create(ctx, { kind: 'entity', entity: found })
      },
    ),
    defineNative(
      { name: 'REMOVE_BLIP', hash: 0x86a652570e5f25ddn, result: 'void', params: ['Blip* blip'] },
      (ctx: NativeContext, blip) => {
        const found = blipsOf(ctx).get(blip.get())
        if (found !== undefined) blipsOf(ctx).remove(found)
        blip.set(0)
      },
    ),
    defineNative(
      { name: 'DOES_BLIP_EXIST', hash: 0xa6db27d19ecbb7dan, result: 'BOOL', params: ['Blip blip'] },
      (ctx: NativeContext, blip) => blipsOf(ctx).get(blip) !== undefined,
    ),
    defineNative(
      {
        name: 'GET_BLIP_FROM_ENTITY',
        hash: 0xbc8dbdca2436f7e8n,
        result: 'Blip',
        params: ['Entity entity'],
      },
      (ctx: NativeContext, entity) => {
        const found = ctx.manager.world!.byHandle(entity)
        return found === undefined ? 0 : (blipsOf(ctx).ofEntity(found)?.handle ?? 0)
      },
    ),
    defineNative(
      {
        name: 'GET_BLIP_INFO_ID_ENTITY_INDEX',
        hash: 0x4ba4e2553afedc2cn,
        result: 'Entity',
        params: ['Blip blip'],
      },
      (ctx: NativeContext, blip) => {
        const shape = blipsOf(ctx).get(blip)?.shape
        return shape?.kind === 'entity' ? shape.entity.handle : 0
      },
    ),
    defineNative(
      {
        name: 'GET_BLIP_COORDS',
        hash: 0x586afe3ff72d996en,
        result: 'Vector3',
        params: ['Blip blip'],
      },
      coordsOf,
    ),
    defineNative(
      {
        name: 'GET_BLIP_INFO_ID_COORD',
        hash: 0xfa7c7f0aadf25d09n,
        result: 'Vector3',
        params: ['Blip blip'],
      },
      coordsOf,
    ),
    defineNative(
      {
        name: 'SET_BLIP_COORDS',
        hash: 0xae2af67e9d9af65dn,
        result: 'void',
        params: ['Blip blip', 'float posX', 'float posY', 'float posZ'],
      },
      (ctx: NativeContext, blip, x, y, z) => {
        const found = blipsOf(ctx).get(blip)
        if (found === undefined) return
        found.x = x
        found.y = y
        found.z = z
      },
    ),
    getter('GET_BLIP_SPRITE', 0x1fc877464a04fc4fn, 'int', 'sprite'),
    setter('SET_BLIP_SPRITE', 0xdf735600a4696dafn, 'int', 'sprite'),
    getter('GET_BLIP_COLOUR', 0xdf729e8d20cf7327n, 'int', 'colour'),
    setter('SET_BLIP_COLOUR', 0x03d7fb09e75d6b7en, 'int', 'colour'),
    getter('GET_BLIP_ALPHA', 0x970f608f0ee6c885n, 'int', 'alpha'),
    setter('SET_BLIP_ALPHA', 0x45ff974eee1c8734n, 'int', 'alpha'),
    setter('SET_BLIP_SCALE', 0xd38744167b2fa257n, 'float', 'scale'),
    setter('SET_BLIP_DISPLAY', 0x9029b2f3da924928n, 'int', 'display'),
    getter('IS_BLIP_SHORT_RANGE', 0xda5f8727eb75b926n, 'BOOL', 'shortRange'),
    setter('SET_BLIP_AS_SHORT_RANGE', 0xbe8be4fe60e27b72n, 'BOOL', 'shortRange'),
    setter('SET_BLIP_CATEGORY', 0x234cdd44d996fd9an, 'int', 'category'),
    setter('SET_BLIP_ROUTE', 0x4f7d8a9bfb0b43e9n, 'BOOL', 'route'),
    setter('SET_BLIP_ROUTE_COLOUR', 0x837155cd2f63da09n, 'int', 'routeColour'),
    setter('SET_BLIP_ROTATION', 0xf87683cdf73c3f6en, 'int', 'rotation'),
    getter('IS_BLIP_FLASHING', 0xa5e41fd83ad6cef0n, 'BOOL', 'flashes'),
    setter('SET_BLIP_FLASHES', 0xb14552383d39ce3en, 'BOOL', 'flashes'),
    defineNative(
      {
        name: 'GET_FIRST_BLIP_INFO_ID',
        hash: 0x1bede233e6cd2a1fn,
        result: 'Blip',
        params: ['int blipSprite'],
      },
      (ctx: NativeContext, sprite) => blipsOf(ctx).first(sprite)?.handle ?? 0,
    ),
    defineNative(
      {
        name: 'GET_NEXT_BLIP_INFO_ID',
        hash: 0x14f96aa50d6fbea7n,
        result: 'Blip',
        params: ['int blipSprite'],
      },
      (ctx: NativeContext, sprite) => blipsOf(ctx).next(sprite)?.handle ?? 0,
    ),
    defineNative(
      { name: 'GET_NUMBER_OF_ACTIVE_BLIPS', hash: 0x9a3ff3de163034e8n, result: 'int', params: [] },
      (ctx: NativeContext) => [...blipsOf(ctx).all].length,
    ),
    defineNative(
      {
        name: 'SET_NEW_WAYPOINT',
        hash: 0xfe43368d2aa4f2fcn,
        result: 'void',
        params: ['float x', 'float y'],
      },
      (ctx: NativeContext, x, y) => blipsOf(ctx).setWaypoint(x, y),
    ),
    defineNative(
      { name: 'IS_WAYPOINT_ACTIVE', hash: 0x1dd1f58f493f1da5n, result: 'BOOL', params: [] },
      (ctx: NativeContext) => blipsOf(ctx).waypoint !== undefined,
    ),
    ...(
      [
        ['SET_WAYPOINT_OFF', 0xa7e4e2d361c2627fn],
        ['DELETE_WAYPOINTS_FROM_THIS_PLAYER', 0xd8e694757bcea8e9n],
      ] as const
    ).map(([name, hash]) =>
      defineNative({ name, hash, result: 'void', params: [] }, (ctx: NativeContext) => {
        const { waypoint } = blipsOf(ctx)
        if (waypoint !== undefined) blipsOf(ctx).remove(waypoint)
      }),
    ),
    defineNative(
      {
        name: 'BEGIN_TEXT_COMMAND_SET_BLIP_NAME',
        hash: 0xf9113a30de5c6670n,
        result: 'void',
        params: ['char* textLabel'],
      },
      (ctx: NativeContext, label) => ctx.manager.world!.text.begin(label ?? ''),
    ),
    defineNative(
      {
        name: 'END_TEXT_COMMAND_SET_BLIP_NAME',
        hash: 0xbc38b49bcb83bc9bn,
        result: 'void',
        params: ['Blip blip'],
      },
      (ctx: NativeContext, blip) => {
        const name = ctx.manager.world!.text.end()
        const found = blipsOf(ctx).get(blip)
        if (found !== undefined) found.name = name
      },
    ),
  ]
}

/** Natives of the text of the games of clients: labels, and the components of text commands. */
export function textNatives(side: Side): NativeDefinition<NativeContext>[] {
  if (side === 'server') return []
  const textOf = (ctx: NativeContext) => ctx.manager.world!.text
  return [
    defineNative(
      {
        name: 'ADD_TEXT_COMPONENT_SUBSTRING_PLAYER_NAME',
        hash: 0x6c188be134e074aan,
        result: 'void',
        params: ['char* text'],
      },
      (ctx: NativeContext, text) => textOf(ctx).add(text ?? ''),
    ),
    defineNative(
      {
        name: 'ADD_TEXT_COMPONENT_SUBSTRING_TEXT_LABEL',
        hash: 0xc63cd5d2920acbe7n,
        result: 'void',
        params: ['char* labelName'],
      },
      (ctx: NativeContext, label) => textOf(ctx).add(textOf(ctx).label(label ?? '') ?? 'NULL'),
    ),
    defineNative(
      {
        name: 'ADD_TEXT_COMPONENT_INTEGER',
        hash: 0x03b504cf259931bcn,
        result: 'void',
        params: ['int value'],
      },
      (ctx: NativeContext, value) => textOf(ctx).add(String(value)),
    ),
    defineNative(
      {
        name: 'ADD_TEXT_COMPONENT_FLOAT',
        hash: 0xe7dcb5b874bcd96en,
        result: 'void',
        params: ['float value', 'int decimalPlaces'],
      },
      (ctx: NativeContext, value, decimals) =>
        textOf(ctx).add(value.toFixed(Math.min(Math.max(decimals, 0), 20))),
    ),
    defineNative(
      { name: 'ADD_TEXT_ENTRY', result: 'void', params: ['char* entryKey', 'char* entryText'] },
      (ctx: NativeContext, key, text) => textOf(ctx).addLabel(hashString(key ?? ''), text ?? ''),
    ),
    defineNative(
      {
        name: 'ADD_TEXT_ENTRY_BY_HASH',
        result: 'void',
        params: ['Hash entryKey', 'char* entryText'],
      },
      (ctx: NativeContext, key, text) => textOf(ctx).addLabel(key, text ?? ''),
    ),
    defineNative(
      {
        name: 'GET_FILENAME_FOR_AUDIO_CONVERSATION',
        hash: 0x7b5280eba9840c72n,
        result: 'char*',
        params: ['char* labelName'],
      },
      // GTA V gives NULL for the labels that it does not have.
      (ctx: NativeContext, label) => textOf(ctx).label(label ?? '') ?? 'NULL',
    ),
    defineNative(
      {
        name: 'DOES_TEXT_LABEL_EXIST',
        hash: 0xac09ca973c564252n,
        result: 'BOOL',
        params: ['char* gxt'],
      },
      (ctx: NativeContext, label) => textOf(ctx).label(label ?? '') !== undefined,
    ),
  ]
}
