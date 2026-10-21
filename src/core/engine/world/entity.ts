import type { CompressedQuaternion, SectorPosition } from './quantize.ts'

/** The kinds of FiveM's network objects, by the numbers that FiveM gives them for GTA V. */
export const NetObjType = {
  automobile: 0,
  bike: 1,
  boat: 2,
  door: 3,
  heli: 4,
  object: 5,
  ped: 6,
  pickup: 7,
  pickupPlacement: 8,
  plane: 9,
  submarine: 10,
  player: 11,
  trailer: 12,
  train: 13,
} as const

export type NetObjType = (typeof NetObjType)[keyof typeof NetObjType]

/** The kinds of vehicles by the names that CREATE_VEHICLE_SERVER_SETTER takes and GET_VEHICLE_TYPE gives. */
export const VEHICLE_TYPES: ReadonlyMap<string, NetObjType> = new Map([
  ['automobile', NetObjType.automobile],
  ['bike', NetObjType.bike],
  ['boat', NetObjType.boat],
  ['heli', NetObjType.heli],
  ['plane', NetObjType.plane],
  ['submarine', NetObjType.submarine],
  ['trailer', NetObjType.trailer],
  ['train', NetObjType.train],
])

/** The types of entities that natives tell: none, peds, vehicles and objects. */
export const EntityType = { none: 0, ped: 1, vehicle: 2, object: 3 } as const

/** The entity type of a kind of network object, as FiveM's server gives it. */
export function entityTypeOf(type: NetObjType): number {
  switch (type) {
    case NetObjType.automobile:
    case NetObjType.bike:
    case NetObjType.boat:
    case NetObjType.heli:
    case NetObjType.plane:
    case NetObjType.submarine:
    case NetObjType.trailer:
    case NetObjType.train:
      return EntityType.vehicle
    case NetObjType.ped:
    case NetObjType.player:
      return EntityType.ped
    case NetObjType.object:
    case NetObjType.door:
    case NetObjType.pickup:
      return EntityType.object
    default:
      return EntityType.none
  }
}

/** The populations that entities come from, as GTA V's ePopType numbers them. */
export const PopType = { unknown: 0, mission: 7 } as const

/** How the sync tree of an entity holds its orientation. */
export type Orientation =
  /** Vehicles and objects: a quaternion, compressed. */
  | { readonly kind: 'quaternion'; readonly quaternion: CompressedQuaternion }
  /** Peds: their heading, in radians, as the tree read it. */
  | { readonly kind: 'heading'; readonly heading: number }

/**
 * What the sync tree of an entity holds, as FiveM's server reads it:
 * where it is, how it turns, its model, its population, and the hash of the
 * resource whose script created it, which is 0 for none.
 */
export interface SyncState {
  position: SectorPosition
  orientation: Orientation
  model: number
  popType: number
  scriptHash: number
}

/** A client of a server, as its game state knows it. */
export interface GameStateClient {
  readonly netId: number
  /** The slot of the client, which state bags route to, once it joined with OneSync. */
  readonly slot?: number | undefined
}

/** An entity of FiveM's server game state, which its sync tree describes. */
/** The state bag of an entity of a server, which routes to the clients that have the entity, as FiveM's server routes them. */
export interface EntityBag {
  /** Routes the bag to a client that has the entity, which gets all of its keys. */
  route(client: GameStateClient): void
  /** Routes the bag no more to a client that no longer has the entity. */
  unroute(client: GameStateClient): void
  /** Lets the client that owns the entity set the keys of the bag, or the server alone when none does. */
  own(owner: GameStateClient | undefined): void
  /** Removes the bag, which goes with the entity. */
  remove(): void
}

/**
 * An entity that a client creates for a script of the server, as FiveM's
 * server knows it until the client syncs it: by its creation token, with a
 * script GUID of its own, which the entity takes once it comes.
 */
export class PendingEntity {
  readonly token: number
  /** The client that creates the entity, or undefined for all of them. */
  readonly client: GameStateClient | undefined
  /** The handle of the script GUID, without the 0x20000 that scripts get it with. */
  guid = 0
  /** Where SetEntityCoords last put the entity, which GetEntityCoords gives until it exists. */
  coords: readonly [x: number, y: number, z: number] | undefined = undefined

  constructor(token: number, client: GameStateClient | undefined) {
    this.token = token
    this.client = client
  }
}

export class SyncEntity {
  readonly type: NetObjType
  /** The object id of the entity, which is its network id. */
  readonly objectId: number
  /** What the sync tree of the entity holds, which its owner syncs. */
  state: SyncState
  #owner: GameStateClient | undefined = undefined
  /** The client that created the entity, if one did. */
  firstOwner: GameStateClient | undefined = undefined
  /** Whether the client that created the entity dropped. */
  firstOwnerDropped = false
  /** Whether the entity passed entityCreating, which those of the server need not, and clients other than its owner may know of it. */
  passedFilter = true
  /** Whether the owner of the entity synced it since it took it. */
  hasSynced = false
  /** Whether the owner of the entity has it no more, which lets the next client that it is relevant to take it. */
  wantsReassign = false
  /** The handle of the script GUID of the entity, without the 0x20000 that scripts get it with, once it has one. */
  guid: number | undefined
  /** Whether the entity is being deleted, which no native finds it during. */
  deleting = false
  /** Whether the entity is being removed for good. */
  finalizing = false
  /** What waits for a client to own the entity, which runs once the client has it. */
  readonly onOwned: ((owner: GameStateClient) => void)[] = []
  /** The state bag of the entity, once a script or a client asked for one. */
  bag: EntityBag | undefined = undefined

  constructor(type: NetObjType, objectId: number, state: SyncState) {
    this.type = type
    this.objectId = objectId
    this.state = state
  }

  /** The client that owns the entity and syncs it, if any, which the bag of the entity takes keys from as it changes owners. */
  get owner(): GameStateClient | undefined {
    return this.#owner
  }

  set owner(client: GameStateClient | undefined) {
    this.#owner = client
    this.bag?.own(client)
  }

  /** Whether a script of the client that created the entity owns it, which keeps it with its owner. */
  get ownedByClientScript(): boolean {
    return this.firstOwner !== undefined && this.state.scriptHash !== 0
  }

  /** Whether natives may find the entity: it is not being deleted. */
  get valid(): boolean {
    return !this.deleting && !this.finalizing
  }
}
