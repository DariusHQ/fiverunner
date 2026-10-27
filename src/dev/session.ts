import {
  Engine,
  MemoryFileSystem,
  type HttpClient,
  type Nui,
  type NuiFrame,
  type Player,
  type PlayerIdentity,
  type PlayerState,
  type ResourceManager,
  type ResourceState,
  SERVER_NET_ID,
  sqliteDatabase,
} from '../core/engine/index.ts'
import { sha1 } from '../core/db/hash.ts'
import { normalizePath } from '../core/engine/glob.ts'
import { pack, type PackedValue } from '../core/engine/msgpack.ts'
import { LuaFatalError, type WatchdogOptions } from '../core/lua/index.ts'
import type { Project } from '../runner/index.ts'
import { LineOutput, type OutputLine } from '../runner/output.ts'
import { describeMap, type DevMap } from './map.ts'
import { describeArgs, describeValue } from './values.ts'

/** Interrupts the scripts that run for 5 seconds without returning, which would hang the session. */
const WATCHDOG: WatchdogOptions = { timeoutMs: 5000 }

const encoder = new TextEncoder()

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

/** A state bag of the server, with its keys and their values, as describe writes them. */
export interface DevBag {
  readonly name: string
  readonly keys: readonly { readonly key: string; readonly value: string }[]
}

/** How the resources, the players and the state bags of the server of a session are. */
export interface DevState {
  readonly resources: readonly { readonly name: string; readonly state: ResourceState }[]
  readonly players: readonly DevPlayer[]
  /** The state bags of the server that have keys, in the order they were created, with their keys in the order of their bytes. */
  readonly bags: readonly DevBag[]
  /** What the map shows: the entities of the server, and the blips of the clients. */
  readonly map: DevMap
}

/** An event that the server and a client sent each other, which the server or the client got. */
export interface NetEvent {
  /** Where the event came from: the server, or the number of the client. */
  readonly from: 'server' | number
  readonly to: 'server' | number
  readonly name: string
  /** The arguments, as describe writes them. */
  readonly args: string
}

/** Where an event that a session triggers goes: to the server from a client, or to a client or all of them from the server. */
export type EventTarget = { readonly from: number } | { readonly to: number | 'everyone' }

/** What a session tells as it happens. */
export type DevEvent =
  | { readonly type: 'output'; readonly line: OutputLine }
  | { readonly type: 'state'; readonly state: DevState }
  | { readonly type: 'crash'; readonly message: string }
  | { readonly type: 'nui'; readonly client: number; readonly event: NuiEvent }
  | { readonly type: 'net'; readonly event: NetEvent }

export interface DevSessionOptions {
  /** cfxlua.wasm, compiled. */
  readonly cfxlua: WebAssembly.Module
  /** sqlite3.wasm, compiled, the database of oxmysql on the server. None by default. */
  readonly sqlite?: WebAssembly.Module
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
  /** The descriptions of the values of the keys of state bags, by the bytes that bags keep, which they replace as keys change. */
  readonly #values = new WeakMap<Uint8Array, string>()
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
        ...(options.sqlite === undefined ? {} : { database: sqliteDatabase(options.sqlite) }),
      },
    })
    const session = new DevSession(engine, options)
    engine.server.events.onTrigger.connect((name, payload, source) => {
      // The events of clients come from net: and the net ids of their players.
      const id = /^net:(\d+)$/.exec(source)?.[1]
      const from = id === undefined ? undefined : session.#clientOf(Number(id))
      if (from !== undefined) {
        session.#net({ from, to: 'server', name, args: describeArgs(payload) })
      }
    })
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
   * Restarts the started resources that files changed in, at these paths of
   * the server, as `restart` does, with the players that are connected, and
   * gives their names; or none when what changed needs the project run anew:
   * a manifest, a .sql file, or a file of no resource, such as server.cfg.
   */
  restartChanged(paths: readonly string[]): string[] | undefined {
    if (this.#crash !== undefined) return undefined
    const resources = [...this.#engine.server.resources]
    const names = new Set<string>()
    for (const path of paths) {
      const file = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
      if (file === 'fxmanifest.lua' || file === '__resource.lua' || file.endsWith('.sql')) {
        return undefined
      }
      const resource = resources.find((each) => path.startsWith(`${normalizePath(each.path)}/`))
      if (resource === undefined) return undefined
      if (resource.state === 'started') names.add(resource.name)
    }
    const { files } = this.#engine.server
    if (files instanceof MemoryFileSystem) for (const path of paths) files.refresh(path)
    for (const name of names) this.command(`restart "${name}"`)
    return [...names]
  }

  /**
   * Starts a client and connects it to the server with `identity`, and
   * returns its number, by which the session tells of it, and which its
   * process is named by: client 1, client 2 and on.
   */
  async connect(identity: PlayerIdentity = {}): Promise<number> {
    const watchdog = this.#options.watchdog ?? WATCHDOG
    // Players of FiveM have the license of their Rockstar account, which frameworks turn players away without: here, one of their names.
    const identifiers = identity.identifiers ?? [
      `license:${sha1(encoder.encode(identity.name ?? 'player'))}`,
    ]
    const { client, player } = await this.#engine.connect(
      { ...identity, identifiers },
      { watchdog },
    )
    this.#clients.push({ manager: client, player })
    const number = this.#clients.length
    client.events.onTrigger.connect((name, payload, source) => {
      // Clients get the events of the network from the server alone, whose latent ones come from net:0.
      if (!source.startsWith('net:')) return
      this.#net({ from: 'server', to: number, name, args: describeArgs(payload) })
    })
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

  /**
   * Triggers `name` with `args` as the network does: on the server, as the
   * player of the client `from` does with TriggerServerEvent, or on the
   * client `to`, or on every client of a player that joined, as the server
   * does with TriggerClientEvent. Handlers get it at the next tick.
   */
  emit(name: string, args: readonly PackedValue[], target: EventTarget): void {
    if (this.#crash !== undefined) return
    const payload = pack(args)
    if ('from' in target) {
      const player = this.#clients[target.from - 1]?.player
      if (player !== undefined) {
        this.#engine.server.events.queue(name, payload, `net:${player.netId}`)
      }
      return
    }
    const clients = target.to === 'everyone' ? this.#clients : [this.#clients[target.to - 1]]
    for (const client of clients) {
      if (client?.player.state === 'joined') {
        client.manager.events.queue(name, payload, `net:${SERVER_NET_ID}`)
      }
    }
  }

  /**
   * Puts the ped of the player of the client `client` at `x`, `y`, at the
   * height `z`, or that it has, with the vehicle it is in, as
   * SetPedCoordsKeepVehicle would in a script of the client, which syncs it.
   */
  teleport(client: number, x: number, y: number, z?: number): void {
    const found = this.#clients[client - 1]
    const ped = found?.manager.world?.playerPed
    if (ped === undefined || this.#crash !== undefined) return
    const moved = ped.vehicle ?? ped
    moved.moveTo(Math.fround(x), Math.fround(y), z === undefined ? moved.z : Math.fround(z))
    this.#tell()
  }

  /** Sets the waypoint of the player of the client `client` at `x`, `y`, as the map of the game does. */
  waypoint(client: number, x: number, y: number): void {
    const world = this.#clients[client - 1]?.manager.world
    if (world === undefined || this.#crash !== undefined) return
    world.blips.setWaypoint(Math.fround(x), Math.fround(y))
    this.#tell()
  }

  /**
   * Has a key of the keyboard of the client `client` go down or up, which
   * presses the controls of its game, and runs the commands that resources
   * bound to it on its console, as FiveM's key mappings do.
   */
  key(client: number, key: string, down: boolean): void {
    const manager = this.#clients[client - 1]?.manager
    const input = manager?.world?.input
    if (manager === undefined || input === undefined || this.#crash !== undefined) return
    const commands = down ? input.keyDown(key) : input.keyUp(key)
    this.#survive(() => {
      for (const command of commands) manager.console.commands.invoke(command, '')
    })
    this.#tell()
  }

  /** The NUI of the client `client`, which pages make their requests of. */
  nui(client: number): Nui | undefined {
    return this.#clients[client - 1]?.manager.nui
  }

  /** Tells the state of the session, if it changed since it last told it. */
  #tell(): void {
    const bags = [...this.#engine.server.states.bags].filter((bag) => bag.keys().length > 0)
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
      bags: bags.map((bag) => ({
        name: bag.name,
        keys: bag.keys().map((key) => ({ key, value: this.#describe(bag.get(key)!) })),
      })),
      map: describeMap(
        this.#engine.server,
        this.#clients.map(({ manager }) => manager),
        (netId) => this.#clientOf(netId),
      ),
    }
    const json = JSON.stringify(state)
    if (json === this.#told) return
    this.#told = json
    this.#options.onEvent({ type: 'state', state })
  }

  /** The value of a key of a state bag, as describe writes it, which it keeps while the key keeps the bytes. */
  #describe(bytes: Uint8Array): string {
    let described = this.#values.get(bytes)
    if (described === undefined) {
      described = describeValue(bytes)
      this.#values.set(bytes, described)
    }
    return described
  }

  /** The number of the client whose player has the net id `id`. */
  #clientOf(id: number): number | undefined {
    const index = this.#clients.findIndex(({ player }) => player.netId === id)
    return index === -1 ? undefined : index + 1
  }

  #net(event: NetEvent): void {
    this.#options.onEvent({ type: 'net', event })
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
