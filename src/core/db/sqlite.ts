import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm'

/** A value that SQLite stores: NULL, an integer, a real, text or a blob. */
export type SqlValue = null | number | bigint | string | Uint8Array

export type { Database as SqliteDatabase, Sqlite3Static as Sqlite }

/** How Emscripten's module takes a host's own instance of its WebAssembly. */
interface ModuleOptions {
  readonly print: (text: string) => void
  readonly printErr: (text: string) => void
  readonly instantiateWasm: (
    imports: WebAssembly.Imports,
    done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
  ) => object
}

/**
 * Starts an instance of SQLite's official build for WebAssembly from
 * sqlite3.wasm, which the host compiled, as it does cfxlua.wasm, so that
 * browsers and Node load it alike. SQLite's own warnings, such as for the
 * file systems of browsers it does not use, go nowhere.
 */
export async function loadSqlite(module: WebAssembly.Module): Promise<Sqlite3Static> {
  const quiet = () => {}
  const global = globalThis as { sqlite3ApiConfig?: object }
  global.sqlite3ApiConfig ??= { warn: quiet, error: quiet, log: quiet, debug: quiet }
  const { default: init } = await import('@sqlite.org/sqlite-wasm')
  const options: ModuleOptions = {
    print: quiet,
    printErr: quiet,
    instantiateWasm: (imports, done) => {
      void WebAssembly.instantiate(module, imports).then((instance) => done(instance, module))
      return {}
    },
  }
  return (init as (options: ModuleOptions) => Promise<Sqlite3Static>)(options)
}
