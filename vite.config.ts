import { readFileSync } from 'node:fs'

import { defineConfig } from 'vite'

/**
 * Builds the command line tool: dist/fiverunner.js, which has the Lua
 * sources of the engine and of SQLite in it, with cfxlua.wasm and
 * sqlite3.wasm next to it.
 */
export default defineConfig({
  // The tool depends on nothing once built.
  ssr: { noExternal: ['@sqlite.org/sqlite-wasm'] },
  build: {
    ssr: 'src/cli/bin.ts',
    outDir: 'dist',
    target: 'node22',
    rolldownOptions: {
      output: { entryFileNames: 'fiverunner.js', banner: '#!/usr/bin/env node' },
    },
  },
  plugins: [
    {
      name: 'cfxlua',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'cfxlua.wasm',
          source: readFileSync(new URL('src/core/lua/cfxlua.wasm', import.meta.url)),
        })
        this.emitFile({
          type: 'asset',
          fileName: 'sqlite3.wasm',
          source: readFileSync(
            new URL('node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm', import.meta.url),
          ),
        })
      },
    },
  ],
})
