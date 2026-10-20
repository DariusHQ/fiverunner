import {
  Engine,
  type HttpClient,
  type Nui,
  type NuiFrame,
  type Player,
  type PlayerIdentity,
  type PlayerState,
  type ResourceManager,
  type ResourceState,
} from '../core/engine/index.ts'
import { LuaFatalError, type WatchdogOptions } from '../core/lua/index.ts'
import type { Project } from '../runner/index.ts'
import { LineOutput, type OutputLine } from '../runner/output.ts'

/** Interrupts the scripts that run for 5 seconds without returning, which would hang the session. */
const WATCHDOG: WatchdogOptions = { timeoutMs: 5000 }

/** What the NUI of a client tells as it happens. */
export type NuiEvent =
  | { readonly type: 'create'; readonly frame: NuiFrame }
  | { readonly type: 'destroy'; readonly resource: string }
  | { readonly type: 'message'; readonly resource: string; readonly json: string }
  | { readonly type: 'frameFocus'; readonly resource: string; readonly focused: boolean }
  | { readonly type: 'focus'; readonly focus: boolean; readonly cursor: boolean }
  | { readonly type: 'keepInput'; readonly keepInput: boolean }
  | { readonly type: 'zIndex'; readonly resource: string; readonly zIndex: number }

/** A player of a session, by the client that connected as it. */
export interface DevPlayer {
  /** The number of the client: 1 for the first that connected, 2 for the next, and on. */
  readonly client: number
  readonly name: string
  /** The net id of the player: a temporary one, from 65536 on, until it joined. */
  readonly id: number
  readonly state: PlayerState
  /** What the deferrals of the connection last said. */
  readonly message?: string
  /** The adaptive card that the deferrals of the connection last presented, as its JSON. */
  readonly card?: string
  /** Why the server refused the player. */
  readonly rejection?: string
}

/** How the resources of the server and the players of a session are. */
export interface DevState {
  readonly resources: readonly { readonly name: string; readonly state: ResourceState }[]
  readonly players: readonly DevPlayer[]
}

/** What a session tells as it happens. */
export type DevEvent =
  | { readonly type: 'output'; readonly line: OutputLine }
  | { readonly type: 'state'; readonly state: DevState }
  | { readonly type: 'crash'; readonly message: string }
  | { readonly type: 'nui'; readonly client: number; readonly event: NuiEvent }

export interface DevSessionOptions {
  /** cfxlua.wasm, compiled. */
  readonly cfxlua: WebAssembly.Module
  readonly project: Project
  /** What sends the HTTP requests of the scripts of the server. */
  readonly http: HttpClient
  /** What interrupts the scripts that run too long without returning: 5 seconds by default. */
  readonly watchdog?: WatchdogOptions
  /** Called with what happens in the session, as it happens. */
  readonly onEvent: (event: DevEvent) => void
}

/** A client of a session, and the player it connected as. */
interface Client {
  readonly manager: ResourceManager
  readonly player: Player
}

/**
 * A server that runs a project as a developer works on it: on the clock of
 * the host, with the players that connect to it, whose NUI embedders show.
 * It tells what happens through `onEvent`: what the processes print, how
 * the resources and the players are whenever that changes, what NUI does,
 * and what crashed a runtime of its server or of its clients, which stops it.
 */
export class DevSession {
  readonly #engine: Engine
  readonly #options: DevSessionOptions
  readonly #clients: Client[] = []
  /** The JSON of the state that the session last told. */
  #told = ''
  #crash: string | undefined

  private constructor(engine: Engine, options: DevSessionOptions) {
    this.#engine = engine
    this.#options = options
  }

  /** Starts the server of a session: it scans the resources of the project, then runs its commands. */
  static async start(options: DevSessionOptions): Promise<DevSession> {
    const output = new LineOutput((line) => options.onEvent({ type: 'output', line }))
    const engine = await Engine.create({
      cfxlua: options.cfxlua,
      output: ({ name }) => output.of(name),
      server: {
        files: options.project.files(),
        http: options.http,
        watchdog: options.watchdog ?? WATCHDOG,
      },
    })
    const session = new DevSession(engine, options)
    session.#survive(() => {
      const { server } = engine
      server.scanResources()
      for (const command of options.project.commands) {
        server.security.runAs('system.console', () => server.console.commands.invoke(command, ''))
      }
      server.endInitialConfiguration()
    })
    session.#tell()
    return session
  }

  /** What crashed a runtime, if one crashed, which stopped the session. */
  get crash(): string | undefined {
    return this.#crash
  }

  /** Moves the clock of the session forward by `ms`, through the frames that are due. */
  advance(ms: number): void {
    if (this.#crash !== undefined) return
    this.#survive(() => this.#engine.advance(ms))
    this.#tell()
  }

  /** Runs a command line on the console of the server, as its console does. */
  command(line: string): void {
    if (this.#crash !== undefined) return
    const { server } = this.#engine
    this.#survive(() => {
      server.security.runAs('system.console', () => server.console.commands.invoke(line, ''))
    })
    this.#tell()
  }

  /**
   * Starts a client and connects it to the server with `identity`, and
   * returns its number, by which the session tells of it, and which its
   * process is named by: client 1, client 2 and on.
   */
  async connect(identity: PlayerIdentity = {}): Promise<number> {
    const watchdog = this.#options.watchdog ?? WATCHDOG
    const { client, player } = await this.#engine.connect(identity, { watchdog })
    this.#clients.push({ manager: client, player })
    const number = this.#clients.length
    const tell = (event: NuiEvent) => this.#options.onEvent({ type: 'nui', client: number, event })
    const nui = client.nui!
    nui.onCreate.connect((frame) => tell({ type: 'create', frame }))
    nui.onDestroy.connect((resource) => tell({ type: 'destroy', resource }))
    nui.onMessage.connect((resource, json) => tell({ type: 'message', resource, json }))
    nui.onFrameFocus.connect((resource, focused) => {
      tell({ type: 'frameFocus', resource, focused })
    })
    nui.onFocus.connect((focus, cursor) => tell({ type: 'focus', focus, cursor }))
    nui.onKeepInput.connect((keepInput) => tell({ type: 'keepInput', keepInput }))
    nui.onZIndex.connect((resource, zIndex) => tell({ type: 'zIndex', resource, zIndex }))
    this.#tell()
    return number
  }

  /** Quits the client `client`, as its player does when they leave the game. */
  disconnect(client: number, reason = 'Exiting'): void {
    const found = this.#clients[client - 1]
    if (found === undefined || this.#crash !== undefined) return
    this.#survive(() => found.player.quit(reason))
    this.#tell()
  }

  /** Submits the adaptive card that the deferrals of the connection of `client` last presented. */
  submitCard(client: number, json: string): void {
    const found = this.#clients[client - 1]
    if (found === undefined || this.#crash !== undefined) return
    this.#survive(() => found.player.submitCard(json))
    this.#tell()
  }

  /** The NUI of the client `client`, which pages make their requests of. */
  nui(client: number): Nui | undefined {
    return this.#clients[client - 1]?.manager.nui
  }

  /** Tells the state of the session, if it changed since it last told it. */
  #tell(): void {
    const state: DevState = {
      resources: [...this.#engine.server.resources].map(({ name, state }) => ({ name, state })),
      players: this.#clients.map(({ player }, index) => ({
        client: index + 1,
        name: player.name,
        id: player.netId,
        state: player.state,
        ...(player.message === undefined ? {} : { message: player.message }),
        ...(player.card === undefined ? {} : { card: player.card }),
        ...(player.rejection === undefined ? {} : { rejection: player.rejection }),
      })),
    }
    const json = JSON.stringify(state)
    if (json === this.#told) return
    this.#told = json
    this.#options.onEvent({ type: 'state', state })
  }

  /** Runs `fn`, and stops the session if a runtime crashed as it ran. */
  #survive(fn: () => void): void {
    try {
      fn()
    } catch (error) {
      if (!(error instanceof LuaFatalError)) throw error
      this.#crash = `A runtime crashed, which stopped the session: ${error.message}`
      this.#options.onEvent({ type: 'crash', message: this.#crash })
    }
  }
}
