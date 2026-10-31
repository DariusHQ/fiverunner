import { LuaVector } from '../lua/index.ts'
import type { NativeCaller, PreparedNative } from './invoker.ts'
import { hashString } from './names.ts'
import { typeInfo, type NativePointer, type ResultType, type TypeInfo } from './types.ts'

/** The values that a runtime other than Lua passes natives and gets back. */
export type DirectValue =
  null | undefined | boolean | number | string | Uint8Array | readonly number[]

const decoder = new TextDecoder()
const encoder = new TextEncoder()

/** A pointer to a value that a native reads and writes, which is no memory of Lua. */
class DirectPointer<T> implements NativePointer<T> {
  readonly valid = true
  #value: T

  constructor(value: T) {
    this.#value = value
  }

  get(): T {
    return this.#value
  }

  set(value: T): void {
    this.#value = value
  }
}

/** What a value of a kind reads as, where nothing set it. */
function zeroOf(info: TypeInfo): unknown {
  switch (info.kind) {
    case 'bool':
      return false
    case 'vector3':
      return new LuaVector('vector3', 0, 0, 0)
    case 'string':
      return null
    default:
      return 0
  }
}

/** A vector that a script passes as an array or as an object with x, y and z. */
function vectorOf(value: DirectValue): LuaVector {
  const [x = 0, y = 0, z = 0] = Array.isArray(value) ? (value as readonly number[]) : []
  return new LuaVector('vector3', x, y, z)
}

/** The bytes of a value, as natives of strings and objects take them. */
function bytesOf(value: DirectValue): Uint8Array | null {
  if (value === null || value === undefined) return null
  return value instanceof Uint8Array ? value : encoder.encode(String(value))
}

/** What the implementation of a native takes for a value that a script passed. */
function argumentOf(info: TypeInfo, value: DirectValue): unknown {
  switch (info.kind) {
    case 'int': {
      // Hashes may be given by their names, as FiveM's natives take them.
      const number = typeof value === 'string' ? hashString(value) : Number(value ?? 0)
      return info.unsigned ? number >>> 0 : number | 0
    }
    case 'long':
    case 'float':
      return Number(value ?? 0)
    case 'bool':
      return Boolean(value)
    case 'string':
    case 'func':
      return value === null || value === undefined ? null : String(value)
    case 'bytes':
    case 'buffer':
    case 'object':
      return bytesOf(value)
    case 'vector3':
      return vectorOf(value)
  }
}

/** What a script gets of a value that a native wrote or returned. */
function resultOf(info: TypeInfo, value: unknown): DirectValue {
  if (value === undefined) value = zeroOf(info)
  switch (info.kind) {
    case 'vector3': {
      const { x, y, z } = value as LuaVector
      return [x, y, z]
    }
    case 'bool':
      return Boolean(value)
    case 'string':
    case 'func':
      return value instanceof Uint8Array ? decoder.decode(value) : (value as string | null)
    case 'object':
      return (value as Uint8Array | null) ?? new Uint8Array(0)
    case 'int':
      return Number(value) | 0
    default:
      return Number(value)
  }
}

/** The type that the result of a native has, if it has one. */
function resultInfo(result: ResultType): TypeInfo | undefined {
  if (result === 'void') return undefined
  return typeInfo(result === 'Any*' ? 'long' : result)
}

/**
 * Runs a native for a script of a runtime that has no memory of Lua to
 * marshal a call in, with the values it passed for the parameters that are no
 * pointers, as the natives of FiveM's JavaScript take them, and gives its
 * results: what it returned, if it returns something, then what it wrote
 * through its pointers. A native with just one pointer, as its last
 * parameter, takes its initial value as an argument, as in Lua.
 */
export function invokeDirectly<Ctx extends NativeCaller>(
  ctx: Ctx,
  native: PreparedNative<Ctx>,
  args: readonly DirectValue[],
): DirectValue[] {
  const { paramTypes } = native
  const pointers = paramTypes.filter((info) => info.pointer)
  const initial = pointers.length === 1 && paramTypes.at(-1)!.pointer
  const values: unknown[] = []
  const written: (readonly [TypeInfo, DirectPointer<unknown>])[] = []
  let next = 0
  for (const info of paramTypes) {
    if (!info.pointer) {
      values.push(argumentOf(info, args[next++]))
      continue
    }
    const pointer = new DirectPointer(initial ? argumentOf(info, args[next++]) : zeroOf(info))
    written.push([info, pointer])
    values.push(pointer)
  }
  let result: unknown
  if (native.impl === null) ctx.unimplemented(native.name, native.hash)
  else result = (native.impl as (ctx: Ctx, ...args: unknown[]) => unknown)(ctx, ...values)
  const type = resultInfo(native.sets ?? native.result)
  return [
    ...(type === undefined ? [] : [resultOf(type, result)]),
    ...written.map(([info, pointer]) => resultOf(info, pointer.get())),
  ]
}
