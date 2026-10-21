import type { LuaRuntime, LuaValue } from '../lua/index.ts'
import type { NativeCaller } from '../natives/index.ts'
import type { ResourceManager } from './manager.ts'
import type { Resource } from './resource.ts'

/**
 * What natives take of what runs them: the script runtime of a resource, or
 * what runs the natives that servers have clients run.
 */
export interface NativeRuntime extends NativeCaller {
  readonly host: { readonly instanceId: number }
  /** Reports a warning of FiveM's own code on `channel`. */
  emitWarning(channel: string, message: string): void
}

/**
 * What FiveRunner's natives run with: the runtime that called them, the
 * resource it belongs to and the process around them.
 */
export class NativeContext implements NativeCaller {
  readonly runtime: NativeRuntime
  readonly resource: Resource

  constructor(runtime: NativeRuntime, resource: Resource) {
    this.runtime = runtime
    this.resource = resource
  }

  get manager(): ResourceManager {
    return this.resource.manager
  }

  get lua(): LuaRuntime {
    return this.runtime.lua
  }

  deserialize(bytes: Uint8Array): LuaValue {
    return this.runtime.deserialize(bytes)
  }

  trace(text: string): void {
    this.runtime.trace(text)
  }

  diagnose(message: string): void {
    this.runtime.diagnose(message)
  }

  unimplemented(name: string, hash: bigint): void {
    this.runtime.unimplemented(name, hash)
  }
}
