import { hashString } from '../../natives/index.ts'
import { EntityType, entityTypeOf, NetObjType } from './entity.ts'
import { Pool } from './pool.ts'
import { IDENTITY, type Matrix } from './rotation.ts'
import { ScreenFade } from './screen.ts'

/** The model of the ped that GTA V's player has until scripts change it: player_zero, Michael. */
export const PLAYER_ZERO = hashString('player_zero')

/**
 * An entity in the world of a client, as GTA V keeps it: where it is, how
 * it turns, its model, and the script that owns it, as mission entities
 * have. Nothing moves it but scripts.
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
  /** Whether the entity has a network object, which entities of network games that scripts want networked have. */
  networked = false
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

/**
 * The world of a client: the entities that it knows of, by the handles
 * that scripts know them by, which come from a pool of script GUIDs as GTA
 * V's do, the ped of its player, which it starts with, and the models that
 * it streamed in.
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

  /** Removes an entity from the world, which frees its handle. */
  remove(entity: ClientEntity): void {
    this.#entities.delete(entity)
    this.#guids.delete(entity.handle)
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
}
