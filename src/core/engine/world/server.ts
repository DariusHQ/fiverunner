import type { PackedValue } from '../msgpack.ts'
import { NetObjType, SyncEntity, type GameStateClient, type SyncState } from './entity.ts'
import { Pool } from './pool.ts'
import { fromSector } from './quantize.ts'

/** How many object ids FiveM's server keeps track of, from 0 up. */
const MAX_OBJECT_ID = (1 << 16) - 1

/** What script handles add to the handles of the script GUIDs of entities. */
const SCRIPT_HANDLE_BASE = 0x20000

/** How many script GUIDs FiveM's server makes room for at first. */
const GUID_POOL_SIZE = 1500

/** The square of how far from the peds of players, on the ground, FiveM's server culls entities by default. */
const CULLING_RADIUS_SQUARED = Math.fround(424 * 424)

/** What the server last told a client of an entity: the net id of its owner, and its tree. */
interface Known {
  readonly owner: number
  readonly state: string
}

/** Whether an entity is within 424 metres of a position on the ground, in single precision. */
function near(entity: SyncEntity, [x, y]: readonly number[]): boolean {
  const [ex, ey] = fromSector(entity.state.position)
  const dx = Math.fround(ex - x!)
  const dy = Math.fround(ey - y!)
  return Math.fround(Math.fround(dx * dx) + Math.fround(dy * dy)) < CULLING_RADIUS_SQUARED
}

/** What a server tells a client of the entities that it knows of, as FiveM's servers send clones. */
export type ServerClone =
  | {
      readonly kind: 'create'
      readonly objectId: number
      readonly type: NetObjType
      readonly state: SyncState
      /** The net id of the client that owns the entity. */
      readonly owner: number
    }
  | {
      readonly kind: 'sync'
      readonly objectId: number
      readonly state: SyncState
      readonly owner: number
    }
  | { readonly kind: 'remove'; readonly objectId: number }

/** What the game state of a server needs of its process. */
export interface GameStateHost {
  /** Queues an event for the resources, as FiveM's QueueEvent2 does. */
  queue(name: string, args: readonly PackedValue[]): void
  /** Triggers an event for the resources at once, as FiveM's TriggerEvent2 does, and returns whether no handler canceled it. */
  trigger(name: string, args: readonly PackedValue[]): boolean
  /** Runs `fn` on the main thread once its tick is done, as FiveM's sync thread has it run what scripts see. */
  onMainThread(fn: () => void): void
  /** Sends a client what changed in the entities that it knows of, which it takes at its next tick. */
  sendClones(client: GameStateClient, clones: readonly ServerClone[]): void
}

/**
 * The game state of a FiveM server with OneSync, as its ServerGameState
 * keeps it: the entities of the session by their object ids, which are
 * their network ids, the object ids it handed out, and the script GUIDs
 * that scripts know entities by. The server takes the object ids of the
 * entities it creates from the top, from 65534 in OneSync's big mode,
 * which has the length hack, and from 8191 without it, and hands those of
 * clients out from 1 up. Clients create entities with the object ids that
 * they were handed, then sync them, and the server sends each client the
 * entities near the ped of its player, which a client owns if no other
 * does.
 *
 * FiveM's game state runs on a thread of its own, the sync thread, which
 * this one's ticks stand for.
 */
export class ServerGameState {
  readonly #host: GameStateHost
  readonly #lengthHack: boolean
  readonly #byId = new Map<number, SyncEntity>()
  /** The entities in the order they were created. */
  readonly #entities = new Set<SyncEntity>()
  /** The object ids that the server handed out, to clients or to its own entities. */
  readonly #sent = new Set<number>()
  /** The object ids of entities. */
  readonly #used = new Set<number>()
  /** The object ids that the server took for its own entities. */
  readonly #stolen = new Set<number>()
  /** The object ids that the server handed each client. */
  readonly #objectIds = new Map<GameStateClient, Set<number>>()
  /** The entities that each client knows of, in the order clients joined, with what the server last told it of their owners and their trees. */
  readonly #known = new Map<GameStateClient, Map<SyncEntity, Known>>()
  /** The entities of the players of clients, which the server bound to them. */
  readonly #players = new Map<GameStateClient, SyncEntity>()
  readonly #guids = new Pool<SyncEntity>(GUID_POOL_SIZE)
  /** The object ids of the entities that scripts or clients deleted, which the sync thread starts deleting. */
  readonly #deletes: number[] = []

  /** The game state of a server, with OneSync's length hack, as its big mode has, or without it. */
  constructor(host: GameStateHost, lengthHack: boolean) {
    this.#host = host
    this.#lengthHack = lengthHack
  }

  /** The entities, in the order they were created, those that are being deleted too. */
  get entities(): IterableIterator<SyncEntity> {
    return this.#entities.values()
  }

  /**
   * Creates an entity of the server, as its server setters do: with the
   * first object id from the top that it neither handed out nor used, and
   * queues serverEntityCreated for it. Returns undefined when it has no
   * object id left.
   */
  create(type: NetObjType, state: SyncState): SyncEntity | undefined {
    let id = this.#lengthHack ? MAX_OBJECT_ID - 1 : 8191
    while (id >= 1 && (this.#sent.has(id) || this.#used.has(id))) id--
    if (id < 1) return undefined
    this.#sent.add(id)
    this.#stolen.add(id)
    const entity = this.#add(type, id, state)
    this.#host.queue('serverEntityCreated', [this.handleOf(entity)])
    return entity
  }

  /** Takes a client that joined, which the server then sends entities. */
  addClient(client: GameStateClient): void {
    this.#known.set(client, new Map())
  }

  /**
   * Hands a client object ids for the entities it creates, as FiveM's
   * GetFreeObjectIds does: the first `count` from 1 up that the server
   * neither handed out nor used, or as many as are left.
   */
  grantObjectIds(client: GameStateClient, count: number): number[] {
    const given = this.#objectIds.get(client) ?? new Set<number>()
    this.#objectIds.set(client, given)
    const ids: number[] = []
    for (let id = 1; id < MAX_OBJECT_ID && ids.length < count; id++) {
      if (this.#sent.has(id) || this.#used.has(id)) continue
      this.#sent.add(id)
      given.add(id)
      ids.push(id)
    }
    return ids
  }

  /**
   * Takes an entity that a client created, as FiveM's server takes the
   * clones that clients create: with the object id that the client gave
   * it, owned by the client. The entity of the player of a client binds to
   * the client, which has one. Once the main thread triggered
   * entityCreating for it, which removes it when a handler cancels it but
   * for players, it queues entityCreated. Creates nothing for an object id
   * that an entity has.
   */
  receiveCreate(
    client: GameStateClient,
    objectId: number,
    type: NetObjType,
    state: SyncState,
  ): void {
    if (this.#byId.has(objectId)) return
    if (type === NetObjType.player && this.#players.has(client)) return
    const entity = this.#add(type, objectId, state)
    entity.owner = client
    entity.firstOwner = client
    entity.passedFilter = false
    // The client has the entity, which it created.
    this.#known.get(client)?.set(entity, { owner: client.netId, state: JSON.stringify(state) })
    if (type === NetObjType.player) this.#players.set(client, entity)
    this.#host.onMainThread(() => {
      if (!entity.valid) return
      if (!this.#host.trigger('entityCreating', [this.handleOf(entity)])) {
        if (type !== NetObjType.player) this.#deletes.push(objectId)
        return
      }
      entity.passedFilter = true
      this.#host.queue('entityCreated', [this.handleOf(entity)])
    })
  }

  /** Takes what a client synced of an entity that it owns. */
  receiveSync(client: GameStateClient, objectId: number, state: SyncState): void {
    const entity = this.#byId.get(objectId)
    if (entity?.owner !== client) return
    entity.state = state
    entity.hasSynced = true
  }

  /** Takes the removal of an entity that a client owns, which the sync thread starts deleting. */
  receiveRemove(client: GameStateClient, objectId: number): void {
    const entity = this.#byId.get(objectId)
    if (entity?.owner !== client) return
    // The client removed the entity already, which it need not be told of.
    entity.owner = undefined
    this.#known.get(client)?.delete(entity)
    this.#deletes.push(objectId)
  }

  /** The script handle of the entity of the player of a client, which the server bound to it, or 0. */
  playerHandleOf(client: GameStateClient): number {
    const entity = this.#players.get(client)
    return entity === undefined ? 0 : this.handleOf(entity)
  }

  /**
   * Forgets a client that dropped, as FiveM's server does: the entities it
   * owns go, as no other client takes them, and the object ids that it
   * was handed are free again.
   */
  drop(client: GameStateClient): void {
    for (const entity of this.#entities) {
      if (entity.firstOwner === client) entity.firstOwnerDropped = true
      if (entity.owner !== client) continue
      entity.owner = undefined
      this.#deletes.push(entity.objectId)
    }
    for (const id of this.#objectIds.get(client) ?? []) this.#sent.delete(id)
    this.#objectIds.delete(client)
    this.#known.delete(client)
    this.#players.delete(client)
  }

  /** The script handle of an entity, which it gives the entity the first time it is asked. */
  handleOf(entity: SyncEntity): number {
    entity.guid ??= this.#guids.add(entity)
    return entity.guid + SCRIPT_HANDLE_BASE
  }

  /** The entity of a script handle, if there is one, valid or not. */
  byHandle(handle: number): SyncEntity | undefined {
    return this.#guids.get(handle - SCRIPT_HANDLE_BASE)
  }

  /** The entity of an object id, which FiveM takes in 16 bits, if there is one, valid or not. */
  byObjectId(objectId: number): SyncEntity | undefined {
    return this.#byId.get(objectId & 0xffff)
  }

  /**
   * Deletes an entity, as FiveM's DeleteEntity does but for players: the
   * sync thread starts deleting it, which makes it invalid, and removes it
   * once no client knows of it. Until the sync thread gets to it, the
   * entity exists still.
   */
  delete(entity: SyncEntity): void {
    if (entity.type === NetObjType.player) return
    this.#deletes.push(entity.objectId)
  }

  /**
   * Runs a tick of the sync thread: it starts deleting the entities that
   * scripts and clients deleted, sends each client what changed in the
   * entities near the ped of its player, and the removal of those it knows
   * of that are no longer near it or are being deleted, then removes those
   * that are being deleted, which no client knows of.
   */
  tick(): void {
    for (const id of this.#deletes.splice(0)) {
      const entity = this.#byId.get(id)
      if (entity !== undefined) entity.deleting = true
    }
    for (const [client, known] of this.#known) this.#sync(client, known)
    for (const entity of this.#entities) {
      if (entity.deleting) this.#finalize(entity)
    }
  }

  /**
   * Sends a client what changed in the entities that are relevant to it,
   * as FiveM's server does: the client takes those that no client owns,
   * and is sent no change of those that it owns, which it syncs.
   */
  #sync(client: GameStateClient, known: Map<SyncEntity, Known>): void {
    const player = this.#players.get(client)
    const focus = player === undefined ? undefined : fromSector(player.state.position)
    const clones: ServerClone[] = []
    for (const entity of this.#entities) {
      const sent = known.get(entity)
      if (!this.#relevant(client, entity, focus)) {
        if (sent === undefined) continue
        known.delete(entity)
        clones.push({ kind: 'remove', objectId: entity.objectId })
        continue
      }
      // The first client that an entity is relevant to takes it, and the next one once its owner has it no more.
      if (entity.owner === undefined || (entity.wantsReassign && entity.owner !== client)) {
        entity.owner = client
        entity.wantsReassign = false
      }
      const state = JSON.stringify(entity.state)
      const { objectId, owner } = entity
      if (sent === undefined) {
        clones.push({
          kind: 'create',
          objectId,
          type: entity.type,
          state: entity.state,
          owner: owner.netId,
        })
      } else if (sent.owner !== owner.netId || (owner !== client && sent.state !== state)) {
        clones.push({ kind: 'sync', objectId, state: entity.state, owner: owner.netId })
      }
      known.set(entity, { owner: owner.netId, state })
    }
    if (clones.length > 0) this.#host.sendClones(client, clones)
  }

  /**
   * Whether an entity is relevant to a client, which the client should
   * have, as FiveM's server tells: those that it owns, and those that
   * passed entityCreating, but players, within 424 metres of the ped of
   * its player on the ground. Entities that are being deleted are relevant
   * to no client.
   */
  #relevant(
    client: GameStateClient,
    entity: SyncEntity,
    focus: readonly number[] | undefined,
  ): boolean {
    if (entity.deleting) return false
    const owns = entity.owner === client
    if (entity.type === NetObjType.player) return owns
    if (!owns && !entity.passedFilter) return false
    if (focus !== undefined && near(entity, focus)) {
      if (owns) entity.wantsReassign = false
      return true
    }
    if (!owns) return false
    // The owner of an entity lets it go once it is no longer near, but those that its scripts own, and those it did not sync yet.
    entity.wantsReassign = true
    return !entity.hasSynced || entity.ownedByClientScript
  }

  #add(type: NetObjType, objectId: number, state: SyncState): SyncEntity {
    const entity = new SyncEntity(type, objectId, state)
    this.#used.add(objectId)
    this.#entities.add(entity)
    this.#byId.set(objectId, entity)
    return entity
  }

  /**
   * Removes an entity for good, as FiveM's FinalizeClone does: it is no
   * longer valid, and once the main thread ran entityRemoved for it, its
   * object id and its GUID are free: the object id of an entity of the
   * server for anyone, and that of an entity of a client for the client it
   * was handed to.
   */
  #finalize(entity: SyncEntity): void {
    if (entity.finalizing) return
    entity.finalizing = true
    this.#host.onMainThread(() => {
      const handle = this.handleOf(entity)
      this.#host.trigger('entityRemoved', [handle])
      this.#byId.delete(entity.objectId)
      this.#used.delete(entity.objectId)
      if (this.#stolen.delete(entity.objectId)) this.#sent.delete(entity.objectId)
      this.#entities.delete(entity)
      for (const [client, player] of this.#players) {
        if (player === entity) this.#players.delete(client)
      }
      this.#guids.delete(handle - SCRIPT_HANDLE_BASE)
    })
  }
}
