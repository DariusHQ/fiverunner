/**
 * The worker of the dev UI, which runs its engine: a session of a project,
 * on the clock of the host, which it tells the UI the events of, and starts
 * anew, with the players it had, as the UI asks.
 */
import quickjsUrl from '@jitl/quickjs-wasmfile-release-sync/wasm?url'
import sqliteUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url'

import type { HttpClient, MemoryFileSystem } from '../core/engine/index.ts'
import { answer } from './answers.ts'
import type { FromWorker, ProjectInfo, ToWorker } from './protocol.ts'
import { DevSession, type DevState } from './session.ts'

/** How often the worker moves the clock of its session on: 60 times a second, as clients run their frames. */
const STEP = 1000 / 60

/** The longest step it takes at once, so that a tab that the browser held back does not run minutes of frames. */
const MAX_STEP = 1000

/** What the worker needs of where it runs. */
export interface WorkerHost {
  /** Compiles cfxlua.wasm. */
  cfxlua(): Promise<WebAssembly.Module>
  /** The project of a session, with `given`, the files that the UI has, if it has them, and what makes the files of its server. */
  project(given: Readonly<Record<string, string>> | undefined): {
    readonly info: ProjectInfo
    readonly files: () => MemoryFileSystem
  }
  /** What sends the HTTP requests of the scripts of the server. */
  readonly http: HttpClient
}

const tell = (message: FromWorker) => postMessage(message)

let cfxlua: Promise<WebAssembly.Module> | undefined
let quickjs: Promise<WebAssembly.Module> | undefined
let sqlite: Promise<WebAssembly.Module> | undefined
let session: DevSession | undefined
/** Where the server of the session has the files of its project. */
let mount = ''
/** The last state that the session told, whose players a new session connects again. */
let state: DevState | undefined
/** How many sessions the worker started, which tells the events of the last apart. */
let generation = 0
let last = performance.now()

/** Runs the worker on `host`. */
export function runWorker(host: WorkerHost): void {
  /** Starts a session of a project, which takes the place of the one before it. */
  async function start(given: Readonly<Record<string, string>> | undefined): Promise<void> {
    const id = ++generation
    const players = (state?.players ?? []).filter(
      (player) => player.state === 'connecting' || player.state === 'joined',
    )
    session = undefined
    state = undefined
    try {
      const { info: project, files } = host.project(given)
      cfxlua ??= host.cfxlua()
      quickjs ??= WebAssembly.compileStreaming(fetch(quickjsUrl))
      sqlite ??= WebAssembly.compileStreaming(fetch(sqliteUrl))
      const started = await DevSession.start({
        cfxlua: await cfxlua,
        quickjs: await quickjs,
        sqlite: await sqlite,
        project: { files, commands: project.commands },
        http: host.http,
        onEvent: (event) => {
          if (id !== generation) return
          if (event.type === 'state') state = event.state
          tell({ type: 'event', event })
        },
      })
      if (id !== generation) return
      tell({ type: 'started', project })
      session = started
      mount = project.mount
      last = performance.now()
      for (const { name } of players) await started.connect({ name })
    } catch (error) {
      if (id === generation) tell({ type: 'failed', message: String(error) })
    }
  }

  /** Moves the clock of the session on by the time that passed since it last did. */
  function step(): void {
    const now = performance.now()
    const elapsed = Math.min(now - last, MAX_STEP)
    last = now
    if (session === undefined) return
    try {
      session.advance(elapsed)
    } catch (error) {
      session = undefined
      tell({ type: 'failed', message: String(error) })
    }
  }

  addEventListener('message', (event: MessageEvent<ToWorker>) => {
    const message = event.data
    switch (message.type) {
      case 'start':
        void start(message.files)
        break
      case 'command':
        session?.command(message.line)
        break
      case 'change': {
        const { paths } = message
        const restarted =
          paths === null
            ? undefined
            : session?.restartChanged(
                paths.map((path) => (mount === '' ? path : `${mount}/${path}`)),
              )
        tell({ type: 'changed', restarted: restarted ?? null })
        break
      }
      case 'connect':
        void session?.connect({ name: message.name })
        break
      case 'disconnect':
        session?.disconnect(message.client)
        break
      case 'submitCard':
        session?.submitCard(message.client, message.json)
        break
      case 'emit':
        session?.emit(message.name, message.args, message.target)
        break
      case 'teleport':
        session?.teleport(message.client, message.x, message.y, message.z)
        break
      case 'waypoint':
        session?.waypoint(message.client, message.x, message.y)
        break
      case 'key':
        session?.key(message.client, message.key, message.down)
        break
      case 'inspect': {
        const inspection = session?.inspect(message.process)
        if (inspection !== undefined) tell({ type: 'inspection', inspection })
        break
      }
      case 'evaluate':
        session?.evaluate(message.process, message.resource, message.code)
        break
      case 'cursor': {
        const nui = session?.nui(message.client)
        if (nui !== undefined) nui.cursor = { x: message.x, y: message.y }
        break
      }
      case 'ask': {
        const { id, client, host, ask } = message
        const nui = session?.nui(client)
        if (nui === undefined) {
          tell({ type: 'answer', id, answer: { network: true } })
          break
        }
        void answer(nui, host, ask).then((answered) =>
          tell({ type: 'answer', id, answer: answered }),
        )
        break
      }
    }
  })

  setInterval(step, STEP)
}
