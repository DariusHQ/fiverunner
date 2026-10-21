import { hashString } from '../../natives/index.ts'
import { EntityType, entityTypeOf, NetObjType, type SyncState } from './entity.ts'
import { Pool } from './pool.ts'
import { IDENTITY, type Matrix } from './rotation.ts'
import { ScreenFade } from './screen.ts'
import { sameState, syncStateOf } from './sync.ts'

/** The model of the ped that GTA V's player has until scripts change it: player_zero, Michael. */
export const PLAYER_ZERO = hashString('player_zero')

/** How few object ids FiveM's clients in OneSync's big mode keep before they ask their servers for more. */
const FEW_OBJECT_IDS = 4

/**
 * An entity in the world of a client, as GTA V keeps it: where it is, how
 * it turns, its model, the script that owns it, as mission entities have,
 * and the object id of its network object, which networked entities have.
 * Nothing moves it but scripts.
 */
export class ClientEntity {
  readonly type: NetObjType
  model: number
  /** The handle that scripts know the entity by, which its world gives it. */
  handle = 0
  x = 0
  y = 0
  z = 0
  rotation: Matrix = IDENTITY
  frozen = false
  visible = true
  /** The object id of the network object of the entity, which is its network id, if it is networked. */
  objectId: number | undefined = undefined
  /** The resource whose script owns the entity, which makes it a mission entity, if any. */
  script: string | undefined = undefined

  constructor(type: NetObjType, model: number) {
    this.type = type
    this.model = model
  }

  /** Puts the entity at a position, which natives give in single precision. */
  moveTo(x: number, y: number, z: number): void {
    this.x = x
    this.y = y
    this.z = z
  }
}

/** What a client tells its server of the entities it owns, as FiveM's clients send clones. */
export type CloneMessage =
  | {
      readonly kind: 'create'
      readonly objectId: number
      readonly type: NetObjType
      readonly state: SyncState
    }
  | { readonly kind: 'sync'; readonly objectId: number; readonly state: SyncState }
  | { readonly kind: 'remove'; readonly objectId: number }

/** What a client sends its server as a tick of its world ends. */
export interface WorldSync {
  readonly clones: readonly CloneMessage[]
  /** Whether the client asks for more object ids. */
  readonly requestObjectIds: boolean
}

/**
 * The world of a client: the entities that it knows of, by the handles
 * that scripts know them by, which come from a pool of script GUIDs as GTA
 * V's do, the ped of its player, which it starts with, the models that it
 * streamed in, and the object ids that its server handed it for the
 * entities it networks, which it uses first in, first out.
 */
export class ClientWorld {
  readonly #guids = new Pool<ClientEntity>(0)
  /** The entities, in the order they were created. */
  readonly #entities = new Set<ClientEntity>()
  /** The models that the world has loaded, those of its entities too. */
  readonly #loaded = new Set<number>()
  /** The models that scripts requested, which the world loads at its next tick. */
  readonly #requested = new Set<number>()
  /** The entity types of the models that the world learned of, as scripts created entities of them. */
  readonly #kinds = new Map<number, number>()
  /** The object ids that the world may network entities with. */
  readonly #objectIds: number[] = []
  /** Whether the world asked for object ids, which it has not got yet. */
  #askedForObjectIds = false
  /** What the world last told its server of each networked entity that it told of. */
  readonly #synced = new Map<ClientEntity, SyncState>()
  /** The object ids of the networked entities that scripts removed, which the world tells its server of. */
  readonly #removed: number[] = []
  /** The ped of the local player: player_zero, at 0, 0, 0. */
  readonly playerPed = new ClientEntity(NetObjType.player, PLAYER_ZERO)
  /** The fade of the screen of the game. */
  readonly screen = new ScreenFade()

  constructor() {
    this.add(this.playerPed)
  }

  /** The entities, in the order they were created. */
  get entities(): IterableIterator<ClientEntity> {
    return this.#entities.values()
  }

  /** Adds an entity to the world, with a handle of its own, and learns the type of its model. */
  add(entity: ClientEntity): void {
    entity.handle = this.#guids.add(entity)
    this.#entities.add(entity)
    this.#loaded.add(entity.model)
    this.#kinds.set(entity.model, entityTypeOf(entity.type))
  }

  /** The entity of a handle, if there is one. */
  byHandle(handle: number): ClientEntity | undefined {
    return this.#guids.get(handle)
  }

  /** The entity of an object id, if there is one. */
  byObjectId(objectId: number): ClientEntity | undefined {
    for (const entity of this.#entities) {
      if (entity.objectId === objectId) return entity
    }
    return undefined
  }

  /**
   * Removes an entity from the world, which frees its handle. The object
   * id of a networked entity that the server knows of is free once the
   * server took its removal; those of others are free at once.
   */
  remove(entity: ClientEntity): void {
    const known = this.#forget(entity)
    const { objectId } = entity
    if (objectId === undefined) return
    if (known) this.#removed.push(objectId)
    else this.#objectIds.push(objectId)
  }

  /** Removes the entity of an object id, which the server removed, and frees the object id. */
  removedByServer(objectId: number): void {
    const entity = this.byObjectId(objectId)
    if (entity === undefined) return
    this.#forget(entity)
    this.#objectIds.push(objectId)
  }

  /** Frees the object id of an entity whose removal the server took. */
  removalTaken(objectId: number): void {
    this.#objectIds.push(objectId)
  }

  /** Takes object ids that the server handed the world. */
  receiveObjectIds(ids: readonly number[]): void {
    this.#objectIds.push(...ids)
    this.#askedForObjectIds = false
  }

  /** Whether the world has an object id to network an entity with. */
  get canNetwork(): boolean {
    return this.#objectIds.length > 0
  }

  /** Networks an entity with the first object id that the world has, if it has one. */
  network(entity: ClientEntity): void {
    entity.objectId = this.#objectIds.shift()
  }

  /** Lets go of the entities that the script of a resource owns, as GTA V does as scripts end. */
  release(script: string): void {
    for (const entity of this.#entities) {
      if (entity.script === script) entity.script = undefined
    }
  }

  /** Asks the world to load a model, which it does at its next tick. */
  request(model: number): void {
    if (!this.#loaded.has(model)) this.#requested.add(model)
  }

  /** Whether the world loaded a model. */
  loaded(model: number): boolean {
    return this.#loaded.has(model)
  }

  /** The entity type of a model, as far as the world learned of it. */
  kindOf(model: number): number {
    return this.#kinds.get(model) ?? EntityType.none
  }

  /** Runs a tick of the world: it loads the models that scripts requested. */
  tick(): void {
    for (const model of this.#requested) this.#loaded.add(model)
    this.#requested.clear()
  }

  /**
   * What the world tells its server as a tick ends, in a network game with
   * OneSync: the ped of the player is networked as soon as the world has
   * an object id, the server is told of the networked entities that scripts
   * created, removed or changed since, and the world asks for object ids
   * once it has few.
   */
  sync(): WorldSync {
    if (this.playerPed.objectId === undefined) this.network(this.playerPed)
    const clones: CloneMessage[] = this.#removed
      .splice(0)
      .map((objectId) => ({ kind: 'remove', objectId }))
    for (const entity of this.#entities) {
      const { objectId } = entity
      if (objectId === undefined) continue
      const state = syncStateOf(entity)
      const last = this.#synced.get(entity)
      if (last === undefined) clones.push({ kind: 'create', objectId, type: entity.type, state })
      else if (!sameState(last, state)) clones.push({ kind: 'sync', objectId, state })
      this.#synced.set(entity, state)
    }
    const requestObjectIds = !this.#askedForObjectIds && this.#objectIds.length < FEW_OBJECT_IDS
    if (requestObjectIds) this.#askedForObjectIds = true
    return { clones, requestObjectIds }
  }

  /** Takes an entity out of the world, and returns whether the server knew of it. */
  #forget(entity: ClientEntity): boolean {
    this.#entities.delete(entity)
    this.#guids.delete(entity.handle)
    return this.#synced.delete(entity)
  }
}
