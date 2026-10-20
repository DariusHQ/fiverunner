import { unpackObject, type MsgpackObject } from '../core/engine/msgpack.ts'
import { compareUtf8 } from '../core/libc.ts'

/** The extensions that CfxLua packs vectors and quaternions in, by their types, with their names. */
const VECTORS: ReadonlyMap<number, string> = new Map([
  [20, 'vec2'],
  [21, 'vec3'],
  [22, 'vec4'],
  [23, 'quat'],
])

/** The extensions that FiveM packs references to functions in. */
const FUNCTIONS = new Set([10, 11])

/** How long a description gets before it is cut. */
const LIMIT = 1000

const decoder = new TextDecoder()

/** A float as Lua writes it, with a fraction where it has none, as in 1.0, and inf and nan as such. */
function number(value: number): string {
  if (Number.isNaN(value)) return 'nan'
  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf'
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return `${value}.0`
  return String(value)
}

/**
 * The order that descriptions give the keys of maps, whose order Lua makes
 * no promise of: integers by their values, then strings by their bytes,
 * then the rest by their descriptions.
 */
function byKey(
  [a]: readonly [MsgpackObject, MsgpackObject],
  [b]: readonly [MsgpackObject, MsgpackObject],
): number {
  const rank = (object: MsgpackObject) =>
    object.type === 'positive' || object.type === 'negative' ? 0 : object.type === 'str' ? 1 : 2
  const ranks = rank(a) - rank(b)
  if (ranks !== 0) return ranks
  if (
    (a.type === 'positive' || a.type === 'negative') &&
    (b.type === 'positive' || b.type === 'negative')
  ) {
    return a.value < b.value ? -1 : a.value > b.value ? 1 : 0
  }
  if (a.type === 'str' && b.type === 'str') return compareBytes(a.bytes, b.bytes)
  return compareUtf8(describe(a), describe(b))
}

/** Orders byte strings as memcmp would, the shorter first where one starts the other. */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let at = 0; at < Math.min(a.length, b.length); at++) {
    if (a[at] !== b[at]) return a[at]! - b[at]!
  }
  return a.length - b.length
}

/** A key of a table as Lua code writes it: a name, or a value in brackets. */
function key(object: MsgpackObject): string {
  if (object.type === 'str') {
    const text = decoder.decode(object.bytes)
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) return text
  }
  return `[${describe(object)}]`
}

/**
 * A msgpack value as Lua code would write it, for people to read: strings
 * in quotes, arrays and maps as tables, with the keys of maps in the order
 * of byKey, vectors and quaternions as their constructors, references to
 * functions as such, and binary data and other extensions by their sizes.
 */
export function describe(object: MsgpackObject): string {
  switch (object.type) {
    case 'nil':
      return 'nil'
    case 'boolean':
      return String(object.value)
    case 'positive':
    case 'negative':
      return String(object.value)
    case 'float32':
      return number(Number(object.value.toPrecision(7)))
    case 'float64':
      return number(object.value)
    case 'str':
      return JSON.stringify(decoder.decode(object.bytes))
    case 'bin':
      return `<${object.bytes.length} bytes>`
    case 'array':
      return object.items.length === 0 ? '{}' : `{ ${object.items.map(describe).join(', ')} }`
    case 'map':
      return object.entries.length === 0
        ? '{}'
        : `{ ${[...object.entries]
            .sort(byKey)
            .map(([name, value]) => `${key(name)} = ${describe(value)}`)
            .join(', ')} }`
    case 'ext': {
      const { type, data } = object.extension
      if (FUNCTIONS.has(type)) return '<function>'
      const vector = VECTORS.get(type)
      if (vector === undefined || data.length % 4 !== 0) return `<extension ${type}>`
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      const parts = Array.from({ length: data.length / 4 }, (_, index) =>
        Number(view.getFloat32(index * 4, true).toPrecision(7)),
      )
      // CfxLua packs quaternions with w last, which their constructor takes first.
      const ordered = vector === 'quat' ? [parts.at(-1)!, ...parts.slice(0, -1)] : parts
      return `${vector}(${ordered.map(number).join(', ')})`
    }
  }
}

/** Cuts a description that runs too long, as three dots. */
function cut(text: string): string {
  return text.length > LIMIT ? `${text.slice(0, LIMIT)}...` : text
}

/** The value of msgpack `bytes`, as describe writes it. */
export function describeValue(bytes: Uint8Array): string {
  try {
    return cut(describe(unpackObject(bytes)))
  } catch {
    return '<no msgpack>'
  }
}

/** The arguments of an event, which its msgpack `payload` holds as an array, as describe writes them. */
export function describeArgs(payload: Uint8Array): string {
  if (payload.length === 0) return ''
  try {
    const args = unpackObject(payload)
    if (args.type !== 'array') return cut(describe(args))
    return cut(args.items.map(describe).join(', '))
  } catch {
    return '<no msgpack>'
  }
}
