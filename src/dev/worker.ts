/**
 * The worker of the dev UI of the dev server, whose project it reads of the
 * server, as the engine needs its files.
 */
import { MemoryFileSystem } from '../core/engine/index.ts'
import { runWorker } from './engine-worker.ts'
import type { ProjectInfo } from './protocol.ts'
import { API, API_HEADER, getSync, proxiedHttp, RemoteSource } from './remote.ts'

const decoder = new TextDecoder()

/** Posts `body` to `url` of the dev server, and resolves with what it answered. */
async function post(url: string, body: string): Promise<string> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { [API_HEADER]: '1', 'Content-Type': 'application/json' },
    body,
  })
  return response.text()
}

runWorker({
  cfxlua: () =>
    WebAssembly.compileStreaming(fetch(`${API}cfxlua.wasm`, { headers: { [API_HEADER]: '1' } })),
  project() {
    const fetched = getSync(`${API}project`)
    if (fetched.status !== 200) throw new Error(decoder.decode(fetched.body))
    const info = JSON.parse(decoder.decode(fetched.body)) as ProjectInfo
    const source = new RemoteSource(getSync)
    return {
      info,
      files: () => {
        const files = new MemoryFileSystem()
        files.mount(info.mount, source)
        return files
      },
    }
  },
  http: proxiedHttp(post),
})
