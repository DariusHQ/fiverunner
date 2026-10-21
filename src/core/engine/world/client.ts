import { hashString } from '../../natives/index.ts'
import { NetObjType } from './entity.ts'
import { Pool } from './pool.ts'
import { IDENTITY, type Matrix } from './rotation.ts'

/** The model of the ped that GTA V's player has until scripts change it: player_zero, Michael. */
export const PLAYER_ZERO = hashString('player_zero')

/**
 * An entity in the world of a client, as GTA V keeps it: where it is, how
 * it turns, and its model. Nothing moves it but scripts.
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
 * V's do, and the ped of its player, which it starts with.
 */
export class ClientWorld {
  readonly #guids = new Pool<ClientEntity>(0)
  /** The ped of the local player: player_zero, at 0, 0, 0. */
  readonly playerPed = new ClientEntity(NetObjType.player, PLAYER_ZERO)

  constructor() {
    this.add(this.playerPed)
  }

  /** Adds an entity to the world, with a handle of its own. */
  add(entity: ClientEntity): void {
    entity.handle = this.#guids.add(entity)
  }

  /** The entity of a handle, if there is one. */
  byHandle(handle: number): ClientEntity | undefined {
    return this.#guids.get(handle)
  }
}
