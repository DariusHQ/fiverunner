import type { Extension, MsgpackObject } from './msgpack.ts'

/**
 * Values as FiveM's JavaScript runtime has them, which its msgpack-lite
 * unpacks from and packs for the other runtimes, as resources of
 * JavaScript, such as oxmysql, take and give them.
 */
export type JsValue =
  | null
  | undefined
  | boolean
  | number
  | string
  | Uint8Array
  | ArrayBuffer
  | JsFunction
  | JsValue[]
  | { [key: string]: JsValue }

/** A function of another runtime, as FiveM's JavaScript runtime unpacks references to them. */
export type JsFunction = (() => never) & { readonly reference: Extension }

const decoder = new TextDecoder()
const encoder = new TextEncoder()

/** The extensions of references to functions, of the runtimes of resources and of FiveM's own. */
const FUNCTION_REFERENCES = new Set([10, 11])

function jsFunction(reference: Extension): JsFunction {
  const fn = (() => {
    throw new Error('FiveRunner calls no functions of other runtimes from JavaScript')
  }) as unknown as { reference: Extension }
  Object.defineProperty(fn, 'reference', { value: reference })
  return fn as unknown as JsFunction
}

/**
 * The value FiveM's JavaScript runtime unpacks from msgpack, as its codec
 * of msgpack-lite does: integers of 64 bits as doubles, binary strings as
 * ArrayBuffers, maps as objects whose keys are the strings of their keys,
 * and references to functions as functions.
 */
export function jsOfMsgpack(object: MsgpackObject): JsValue {
  switch (object.type) {
    case 'nil':
      return null
    case 'boolean':
      return object.value
    case 'positive':
    case 'negative':
      return Number(object.value)
    case 'float32':
    case 'float64':
      return object.value
    case 'str':
      return decoder.decode(object.bytes)
    case 'bin': {
      const buffer = new ArrayBuffer(object.bytes.length)
      new Uint8Array(buffer).set(object.bytes)
      return buffer
    }
    case 'array':
      return object.items.map(jsOfMsgpack)
    case 'map': {
      const result: { [key: string]: JsValue } = {}
      for (const [key, value] of object.entries) {
        // A key is the string JavaScript makes of it, as properties are.
        result[String(jsOfMsgpack(key))] = jsOfMsgpack(value)
      }
      return result
    }
    case 'ext':
      if (FUNCTION_REFERENCES.has(object.extension.type)) return jsFunction(object.extension)
      return {}
  }
}

function int(value: number): MsgpackObject {
  return value < 0
    ? { type: 'negative', value: BigInt(value) }
    : { type: 'positive', value: BigInt(value) }
}

/**
 * The msgpack FiveM's JavaScript runtime packs a value as, as its codec of
 * msgpack-lite does: numbers that are integers of 32 bits as integers and
 * all others as doubles, Buffers and ArrayBuffers as binary strings, and
 * objects as maps of their own keys, in order. undefined is nil, as in
 * arrays, and functions are nil but those of other runtimes.
 */
export function msgpackOfJs(value: JsValue): MsgpackObject {
  if (value === null || value === undefined) return { type: 'nil' }
  switch (typeof value) {
    case 'boolean':
      return { type: 'boolean', value }
    case 'number':
      // msgpack-lite packs as an integer what (value | 0) leaves as it is.
      return (value | 0) === value ? int(value | 0) : { type: 'float64', value }
    case 'string':
      return { type: 'str', bytes: encoder.encode(value) }
    case 'function': {
      const reference = (value as Partial<JsFunction>).reference
      return reference === undefined ? { type: 'nil' } : { type: 'ext', extension: reference }
    }
    default:
      break
  }
  if (value instanceof Uint8Array) return { type: 'bin', bytes: value }
  if (value instanceof ArrayBuffer) return { type: 'bin', bytes: new Uint8Array(value) }
  if (Array.isArray(value)) return { type: 'array', items: value.map(msgpackOfJs) }
  return {
    type: 'map',
    entries: Object.keys(value).map(
      (key) => [{ type: 'str', bytes: encoder.encode(key) }, msgpackOfJs(value[key])] as const,
    ),
  }
}

/** The JSON of a value, as JSON.stringify writes it, which leaves functions out and gives ArrayBuffers as {}. */
export function jsonOf(value: JsValue): string {
  return JSON.stringify(value) ?? 'undefined'
}

/** Whether a value is a function, as typeof says in JavaScript. */
export function isJsFunction(value: JsValue): value is JsFunction {
  return typeof value === 'function'
}
