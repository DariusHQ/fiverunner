/** The dev UI that the dev server serves, which runs the project of the server. */
import { API } from '../remote.ts'
import { startApp } from './app.ts'
import { BridgedFrames } from './bridged.ts'

startApp({
  worker: new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' }),
  frames: new BridgedFrames(document.getElementById('bridges')!),
  project: () => undefined,
  watch(changed) {
    const changes = new EventSource(`${API}events`)
    changes.addEventListener('change', (event) =>
      changed(JSON.parse((event as MessageEvent<string>).data) as string[] | null),
    )
  },
})
