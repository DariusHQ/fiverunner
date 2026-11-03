/** The worker of the playground, which runs the files that its page gives it. */
import { fetchHttpClient, MemoryFileSystem } from '../core/engine/index.ts'
import cfxluaUrl from '../core/lua/cfxlua.wasm?url'
import { runWorker } from '../dev/engine-worker.ts'

runWorker({
  cfxlua: () => WebAssembly.compileStreaming(fetch(cfxluaUrl)),
  project: (given) => ({
    info: {
      name: given?.name ?? 'playground',
      kind: 'server',
      mount: '',
      commands: ['exec server.cfg'],
    },
    files: () => new MemoryFileSystem(given?.files ?? {}),
  }),
  http: fetchHttpClient,
})
