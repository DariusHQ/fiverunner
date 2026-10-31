import { readFileSync } from 'node:fs'

import { LuaRuntime, type LuaRuntimeOptions } from '../../src/core/lua/index.ts'
import { loadJavaScript, type QuickJSWASMModule } from '../../src/core/scripting/javascript.ts'

let compiled: Promise<WebAssembly.Module> | undefined

let quickjsModule: Promise<QuickJSWASMModule> | undefined

/** QuickJS, loaded once per test file. */
export function quickjs(): Promise<QuickJSWASMModule> {
  quickjsModule ??= WebAssembly.compile(
    readFileSync(
      new URL(
        '../../node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm',
        import.meta.url,
      ),
    ),
  ).then(loadJavaScript)
  return quickjsModule
}

/** cfxlua.wasm, compiled once per test file. */
export function cfxlua(): Promise<WebAssembly.Module> {
  compiled ??= WebAssembly.compile(
    readFileSync(new URL('../../src/core/lua/cfxlua.wasm', import.meta.url)),
  )
  return compiled
}

export async function createRuntime(options: LuaRuntimeOptions = {}): Promise<LuaRuntime> {
  return LuaRuntime.create(await cfxlua(), { output: () => {}, ...options })
}

/** Runs `fn` and returns what it throws, failing if it returns. */
export function thrown(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  throw new Error('Expected the function to throw')
}
