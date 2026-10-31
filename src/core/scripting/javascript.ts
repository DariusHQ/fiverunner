import quickjsVariant from '@jitl/quickjs-wasmfile-release-sync'
import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core'

import type { LuaRuntime, LuaValue } from '../lua/index.ts'
import type { DatabaseError } from '../db/client.ts'
import { md5, sha1, sha2 } from '../db/hash.ts'
import { normalizePath } from '../engine/glob.ts'
import type { DirectValue } from '../natives/direct.ts'
import citizenSource from './js/citizen.js?raw'
import nodeSource from './js/node.js?raw'
import {
  unimplementedDiagnosis,
  type ResourceRuntime,
  type ScriptHost,
  type StackFrame,
} from './runtime.ts'

export type { QuickJSWASMModule }

/** The stack that the scripts of a resource get, which Webpack's bundles go deep in. */
const STACK_SIZE = 4 * 1024 * 1024

/** The most memory that the scripts of a resource take, as a limit on what runs away. */
const MEMORY_LIMIT = 1024 * 1024 * 1024

const decoder = new TextDecoder()

/** Loads QuickJS, which runs the scripts of JavaScript, from its compiled module. */
export function loadJavaScript(wasm: WebAssembly.Module): Promise<QuickJSWASMModule> {
  return newQuickJSWASMModuleFromVariant(newVariant(quickjsVariant, { wasmModule: wasm }))
}

/** The digest of `bytes` in hexadecimal, by the name that Node's crypto gives its algorithm. */
function digestOf(algorithm: string, bytes: Uint8Array): string | undefined {
  if (algorithm === 'md5') return md5(bytes)
  if (algorithm === 'sha1') return sha1(bytes)
  const bits = /^sha(224|256|384|512)$/.exec(algorithm)?.[1]
  return bits === undefined ? undefined : sha2(bytes, Number(bits))
}

/** The bytes of a typed array as an ArrayBuffer of their own. */
function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer
}

/**
 * The JavaScript runtime of one resource on one side, set up like FiveM's: a
 * context of its own for the scripts of the resource, whose global scope they
 * share, with the natives, events, exports, timers and state bags of
 * js/citizen.js. It runs in QuickJS, on the host's WebAssembly, so that it
 * runs the same in Node and in a browser, and each tick runs the jobs of the
 * promises that scripts left.
 */
export class JavaScriptRuntime implements ResourceRuntime {
  readonly host: ScriptHost
  readonly #runtime: QuickJSRuntime
  readonly #vm: QuickJSContext
  /** The functions that js/citizen.js gives the host. */
  #tick!: QuickJSHandle
  #event!: QuickJSHandle
  #callRef!: QuickJSHandle
  #duplicateRef!: QuickJSHandle
  #deleteRef!: QuickJSHandle
  /** Natives without an implementation that the scripts called, by hash. */
  readonly #unimplemented = new Set<bigint>()
  /** The natives that the scripts loaded, by the ids they call them by. */
  readonly #natives: unknown[] = []

  private constructor(runtime: QuickJSRuntime, vm: QuickJSContext, host: ScriptHost) {
    this.#runtime = runtime
    this.#vm = vm
    this.host = host
  }

  static create(module: QuickJSWASMModule, host: ScriptHost): JavaScriptRuntime {
    const runtime = module.newRuntime()
    runtime.setMaxStackSize(STACK_SIZE)
    runtime.setMemoryLimit(MEMORY_LIMIT)
    const vm = runtime.newContext()
    const script = new JavaScriptRuntime(runtime, vm, host)
    try {
      script.#init()
      return script
    } catch (error) {
      vm.dispose()
      runtime.dispose()
      throw error
    }
  }

  get lua(): LuaRuntime {
    throw new Error('A JavaScript runtime has no memory of Lua')
  }

  /**
   * Loads and runs a script file of the resource in the global scope of its
   * context, as FiveM does, with errors reported to the console. Returns
   * false if it failed to run. `path` is relative to the resource, or names
   * a file of another resource as @resource/file.
   */
  runFile(path: string, source: string | Uint8Array): boolean {
    const name = path.startsWith('@') ? path : `@${this.host.resource}/${path}`
    const text = typeof source === 'string' ? source : decoder.decode(source)
    const result = this.#vm.evalCode(text, name, { type: 'global' })
    if (result.error === undefined) {
      result.value.dispose()
      this.#runJobs()
      return true
    }
    this.#report(`Error loading script ${name} in resource ${this.host.resource}`, result.error)
    result.error.dispose()
    return false
  }

  evaluate(code: string): void {
    this.runFile(
      '@console',
      `Promise.resolve()
  .then(() => (0, eval)(${JSON.stringify(code)}))
  .then((value) => { if (value !== undefined) console.log(value) })
  .catch((error) => printError('console', error))`,
    )
  }

  /** Timers and ticks run as resume() does, by the clock of then, so nothing is taken here. */
  collect(): void {}

  /** Runs the timers and the ticks that are due, then the jobs of promises. */
  resume(): void {
    const now = this.#vm.newNumber(this.host.clock() / 1000)
    try {
      this.#call(this.#tick, 'tick', now)
    } finally {
      now.dispose()
    }
    this.#runJobs()
  }

  /** Gives the listeners of an event its msgpack payload, with its source. */
  triggerEvent(name: string, payload: Uint8Array, source: string): void {
    const vm = this.#vm
    const handles = [vm.newString(name), vm.newArrayBuffer(bufferOf(payload)), vm.newString(source)]
    try {
      this.#call(this.#event, 'event', ...handles)
    } finally {
      for (const handle of handles) handle.dispose()
    }
    this.#runJobs()
  }

  /** Calls the function of the reference at `index` with arguments that msgpack packed, and gives its results packed. */
  callRef(index: number, args: Uint8Array): Uint8Array | null {
    const vm = this.#vm
    const handles = [vm.newNumber(index), vm.newArrayBuffer(bufferOf(args))]
    try {
      const result = this.#call(this.#callRef, 'call reference', ...handles)
      if (result === undefined) return null
      try {
        return this.#bytes(result)
      } finally {
        result.dispose()
      }
    } finally {
      for (const handle of handles) handle.dispose()
      this.#runJobs()
    }
  }

  /** Counts another holder of the reference at `index`, and gives the index it keeps. */
  duplicateRef(index: number): number {
    const handle = this.#vm.newNumber(index)
    try {
      const result = this.#call(this.#duplicateRef, 'system ref duplication', handle)
      if (result === undefined) return -1
      const kept = this.#vm.getNumber(result)
      result.dispose()
      return kept
    } finally {
      handle.dispose()
    }
  }

  /** Takes a holder of the reference at `index` away. */
  deleteRef(index: number): void {
    const handle = this.#vm.newNumber(index)
    try {
      this.#call(this.#deleteRef, 'system ref deletion', handle)?.dispose()
    } finally {
      handle.dispose()
    }
  }

  walkStack(): StackFrame[] {
    return []
  }

  deserialize(): LuaValue {
    throw new Error('A JavaScript runtime deserializes its objects itself')
  }

  trace(text: string): void {
    this.host.log('citizen-scripting-core', text)
  }

  diagnose(message: string): void {
    this.host.diagnose(message)
  }

  emitWarning(channel: string, message: string): void {
    this.host.warn(`[${channel}] ${message}`)
  }

  unimplemented(name: string, hash: bigint): void {
    if (this.#unimplemented.has(hash)) return
    this.#unimplemented.add(hash)
    this.host.diagnose(unimplementedDiagnosis(name))
  }

  close(): void {
    for (const handle of [
      this.#tick,
      this.#event,
      this.#callRef,
      this.#duplicateRef,
      this.#deleteRef,
    ]) {
      handle.dispose()
    }
    this.#vm.dispose()
    this.#runtime.dispose()
  }

  #init(): void {
    const vm = this.#vm
    const { host } = this
    const bridge = vm.newObject()
    const define = (name: string, fn: (...args: QuickJSHandle[]) => QuickJSHandle | void) => {
      const handle = vm.newFunction(name, fn)
      vm.setProp(bridge, name, handle)
      handle.dispose()
    }
    vm.setProp(bridge, 'server', host.natives.client ? vm.false : vm.true)
    define('trace', (text) => host.trace(vm.getString(text)))
    define('clock', () => vm.newNumber(host.clock() / 1000))
    define('wallClock', () => vm.newNumber(host.wallClock()))
    define('hasNative', (name) => (host.natives.find(vm.getString(name)) ? vm.true : vm.false))
    define('native', (name) => this.#loadNative(vm.getString(name)))
    define('invoke', (id, ...args) => this.#invoke(vm.getNumber(id), args))
    define('canonicalizeRef', (index) =>
      vm.newString(`${host.resource}:${host.instanceId}:${vm.getNumber(index)}`),
    )
    define('invokeFunctionReference', (ref, args) => {
      const results = host.invokeFunctionReference(vm.getString(ref), this.#bytes(args))
      if (results === undefined)
        throw new Error('Execution of function reference in script host failed: ')
      return results === null ? vm.null : vm.newArrayBuffer(bufferOf(results))
    })
    const pathOf = (path: QuickJSHandle) => normalizePath(vm.getString(path))
    define('readPath', (path) => {
      const bytes = host.files.read(pathOf(path))
      return bytes === undefined ? vm.undefined : vm.newArrayBuffer(bufferOf(bytes))
    })
    define('writePath', (path, data) => {
      host.files.write(pathOf(path), this.#bytes(data))
    })
    define('fileSize', (path) => {
      const size = host.files.size(pathOf(path))
      return size === undefined ? vm.undefined : vm.newNumber(size)
    })
    define('listDirectory', (path) => {
      const entries = host.files.list(pathOf(path))
      return entries === undefined
        ? vm.undefined
        : this.#write(entries.map(({ name }) => name) as unknown as DirectValue)
    })
    define('makeDirectory', (path) => host.files.makeDirectory(pathOf(path)))
    define('removePath', (path) => {
      host.files.remove(pathOf(path))
    })
    define('digest', (algorithm, bytes) => {
      const digest = digestOf(vm.getString(algorithm), this.#bytes(bytes))
      return digest === undefined ? vm.undefined : vm.newString(digest)
    })
    define('databaseReady', () => (host.database?.() === undefined ? vm.false : vm.true))
    define('runStatement', (sql, values) => {
      const connection = host.database?.()
      if (connection === undefined) throw new Error('The database is not open')
      const given = JSON.parse(vm.getString(values)) as unknown[]
      try {
        return vm.newString(JSON.stringify(connection.statement(vm.getString(sql), given)))
      } catch (error) {
        const { message, errno, sqlState } = error as DatabaseError
        return vm.newString(JSON.stringify({ error: { message, errno, sqlState } }))
      }
    })
    const resourcePath = vm.newString(host.resourcePath)
    vm.setProp(bridge, 'resourcePath', resourcePath)
    resourcePath.dispose()
    vm.setProp(vm.global, '__fiverunner', bridge)
    try {
      this.#run(citizenSource, 'citizen:/scripting/js/citizen.js')
      if (!host.natives.client) this.#run(nodeSource, 'citizen:/scripting/js/node.js')
      this.#tick = vm.getProp(bridge, 'tick')
      this.#event = vm.getProp(bridge, 'event')
      this.#callRef = vm.getProp(bridge, 'callRef')
      this.#duplicateRef = vm.getProp(bridge, 'duplicateRef')
      this.#deleteRef = vm.getProp(bridge, 'deleteRef')
    } finally {
      bridge.dispose()
    }
    this.#run('delete globalThis.__fiverunner', 'citizen:/scripting/js/end.js')
  }

  /** Runs one of FiveRunner's own scripts, which do not fail. */
  #run(source: string, name: string): void {
    this.#vm.unwrapResult(this.#vm.evalCode(source, name, { type: 'global' })).dispose()
  }

  /** What js/citizen.js needs of a native to load it: its id, the kinds of its arguments, and whether it gives an object. */
  #loadNative(name: string): QuickJSHandle {
    const vm = this.#vm
    const native = this.host.natives.find(name)
    if (native === undefined) return vm.null
    this.#natives.push(native.native)
    const array = vm.newArray()
    const id = vm.newNumber(this.#natives.length - 1)
    const kinds = vm.newString(native.kinds)
    vm.setProp(array, 0, id)
    vm.setProp(array, 1, kinds)
    vm.setProp(array, 2, native.object ? vm.true : vm.false)
    id.dispose()
    kinds.dispose()
    return array
  }

  /** Runs a native with what a script passed, and gives what the script gets. */
  #invoke(id: number, args: QuickJSHandle[]): QuickJSHandle {
    const values = args.map((handle) => this.#read(handle))
    const results = this.host.natives.invokeDirectly(this, this.#natives[id], values)
    return this.#write(
      results.length === 1 ? results[0] : results.length === 0 ? undefined : results,
    )
  }

  #read(handle: QuickJSHandle): DirectValue {
    const vm = this.#vm
    switch (vm.typeof(handle)) {
      case 'number':
        return vm.getNumber(handle)
      case 'string':
        return vm.getString(handle)
      case 'object': {
        const bytes = this.#tryBytes(handle)
        return bytes ?? (vm.dump(handle) as DirectValue)
      }
      default:
        return vm.dump(handle) as DirectValue
    }
  }

  #write(value: DirectValue | DirectValue[]): QuickJSHandle {
    const vm = this.#vm
    if (value === undefined) return vm.undefined
    if (value === null) return vm.null
    switch (typeof value) {
      case 'number':
        return vm.newNumber(value)
      case 'string':
        return vm.newString(value)
      case 'boolean':
        return value ? vm.true : vm.false
      default:
        break
    }
    if (value instanceof Uint8Array) return vm.newArrayBuffer(bufferOf(value))
    const array = vm.newArray()
    ;(value as readonly DirectValue[]).forEach((item, index) => {
      const handle = this.#write(item)
      vm.setProp(array, index, handle)
      handle.dispose()
    })
    return array
  }

  /** The bytes of an ArrayBuffer of the context. */
  #bytes(handle: QuickJSHandle): Uint8Array {
    const lifetime = this.#vm.getArrayBuffer(handle)
    try {
      return lifetime.value.slice()
    } finally {
      lifetime.dispose()
    }
  }

  /** The bytes of a value, if it is an ArrayBuffer. */
  #tryBytes(handle: QuickJSHandle): Uint8Array | undefined {
    try {
      return this.#bytes(handle)
    } catch {
      return undefined
    }
  }

  /** Calls a function of js/citizen.js, and reports what it threw. */
  #call(fn: QuickJSHandle, routine: string, ...args: QuickJSHandle[]): QuickJSHandle | undefined {
    const result = this.#vm.callFunction(fn, this.#vm.undefined, ...args)
    if (result.error === undefined) return result.value
    this.#report(
      `Error running ${routine} function for resource ${this.host.resource}`,
      result.error,
    )
    result.error.dispose()
    return undefined
  }

  /** Runs the jobs of the promises that scripts left, as V8 runs its microtasks. */
  #runJobs(): void {
    const result = this.#runtime.executePendingJobs()
    if (result.error !== undefined) {
      this.#report(`Error running a job of resource ${this.host.resource}`, result.error)
      result.error.dispose()
    }
  }

  #report(where: string, error: QuickJSHandle): void {
    const dumped = this.#vm.dump(error) as { name?: string; message?: string; stack?: string }
    const message =
      typeof dumped === 'object' && dumped !== null
        ? `${dumped.name ?? 'Error'}: ${dumped.message ?? ''}\n${dumped.stack ?? ''}`
        : String(dumped)
    this.host.trace(`${where}: ${message}\n`)
  }
}
