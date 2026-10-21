import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { main } from './main.ts'

process.exitCode = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  color: process.stdout.isTTY === true && process.env.NO_COLOR === undefined,
  // The build puts cfxlua.wasm next to the tool.
  cfxlua: () => WebAssembly.compile(readFileSync(new URL('cfxlua.wasm', import.meta.url))),
  wasm: () => readFileSync(new URL('cfxlua.wasm', import.meta.url)),
  sqlite: () => WebAssembly.compile(readFileSync(new URL('sqlite3.wasm', import.meta.url))),
  // The build puts the dev UI next to it too.
  assets: fileURLToPath(new URL('dev/', import.meta.url)),
  interrupted: () =>
    new Promise((resolve) => {
      process.once('SIGINT', () => resolve())
      process.once('SIGTERM', () => resolve())
    }),
  now: () => performance.now(),
})
