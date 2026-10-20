import type { PackedValue } from '../msgpack.ts'
import { NetObjType, SyncEntity, type SyncState } from './entity.ts'
import { Pool } from './pool.ts'

/** How many object ids FiveM's server keeps track of, from 0 up. */
const MAX_OBJECT_ID = (1 << 16) - 1

/** What script handles add to the handles of the script GUIDs of entities. */
const SCRIPT_HANDLE_BASE = 0x20000

/** How many script GUIDs FiveM's server makes room for at first. */
const GUID_POOL_SIZE = 1500

/** What the game state of a server needs of its process. */
export interface GameStateHost {
  /** Queues an event for the resources, as FiveM's QueueEvent2 does. */
  queue(name: string, args: readonly PackedValue[]): void
  /** Triggers an event for the resources at once, as FiveM's TriggerEvent2 does. */
  trigger(name: string, args: readonly PackedValue[]): void
  /** Runs `fn` on the main thread once its tick is done, as FiveM's sync thread has it run what scripts see. */
  onMainThread(fn: () => void): void
}

/**
 * The game state of a FiveM server with OneSync, as its ServerGameState
 * keeps it: the entities of the session by their object ids, which are
 * their network ids, and the script GUIDs that scripts know entities by.
 * The server takes the object ids of the entities it creates from the
 * top: from 65534 in OneSync's big mode, which has the length hack, and
 * from 8191 without it.
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
  readonly #guids = new Pool<SyncEntity>(GUID_POOL_SIZE)
  /** The object ids of the entities that scripts deleted, which the sync thread starts deleting. */
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
   * first object id from the top that no entity has, and queues
   * serverEntityCreated for it. Returns undefined when it has no object id
   * left.
   */
  create(type: NetObjType, state: SyncState): SyncEntity | undefined {
    let id = this.#lengthHack ? MAX_OBJECT_ID - 1 : 8191
    while (this.#byId.has(id)) id--
    if (id < 1) return undefined
    const entity = new SyncEntity(type, id, state)
    this.#entities.add(entity)
    this.#byId.set(id, entity)
    this.#host.queue('serverEntityCreated', [this.handleOf(entity)])
    return entity
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
   * scripts deleted, then removes those that are being deleted, which no
   * client knows of.
   */
  tick(): void {
    for (const id of this.#deletes.splice(0)) {
      const entity = this.#byId.get(id)
      if (entity !== undefined) entity.deleting = true
    }
    for (const entity of this.#entities) {
      if (entity.deleting) this.#finalize(entity)
    }
  }

  /**
   * Removes an entity for good, as FiveM's FinalizeClone does: it is no
   * longer valid, and once the main thread ran entityRemoved for it, its
   * object id and its GUID are free.
   */
  #finalize(entity: SyncEntity): void {
    if (entity.finalizing) return
    entity.finalizing = true
    this.#host.onMainThread(() => {
      const handle = this.handleOf(entity)
      this.#host.trigger('entityRemoved', [handle])
      this.#byId.delete(entity.objectId)
      this.#entities.delete(entity)
      this.#guids.delete(handle - SCRIPT_HANDLE_BASE)
    })
  }
}
