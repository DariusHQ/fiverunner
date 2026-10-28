import { hashString } from '../../natives/index.ts'
import { PedAppearance } from './appearance.ts'
import { Blips } from './blips.ts'
import { Cameras } from './cameras.ts'
import type { Door } from './doors.ts'
import { EntityType, entityTypeOf, NetObjType, type SyncState } from './entity.ts'
import { Input } from './input.ts'
import { Pool } from './pool.ts'
import { decompressQuaternion, fromSector } from './quantize.ts'
import { fromHeading, fromQuaternion, IDENTITY, type Matrix } from './rotation.ts'
import { ScreenFade } from './screen.ts'
import type { ServerClone } from './server.ts'
import { sameState, syncStateOf } from './sync.ts'
import { GameText } from './text.ts'
import { GameClock, Weather } from './weather.ts'
import { UNARMED, type PedWeapon } from './weapons.ts'

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
  /** For clones of entities that other clients own, the net id of their owner, which syncs them. */
  owner: number | undefined = undefined
  /** The creation token of an entity that the client created for its server, which it creates it on its server with. */
  creationToken: number | undefined = undefined
  /** The health of the entity: peds have 200, as GTA V's players do, whatever their models, and other entities 1000. */
  health: number
  /** The most health the entity can have, which it starts with. */
  maxHealth: number
  /** The armour of a ped. */
  armour = 0
  /** The config flags of a ped that scripts set, which are all unset otherwise. */
  readonly configFlags = new Set<number>()
  /** The appearance of a ped, as scripts set it. */
  appearance = new PedAppearance()
  /** The weapons of a ped, by their hashes, and the one in its hands. */
  readonly weapons = new Map<number, PedWeapon>()
  weapon = UNARMED
  /** For peds, the vehicle they are in, if any, and their seat in it: -1 for the driver's, then 0 up for those of passengers. */
  vehicle: ClientEntity | undefined = undefined
  seat = -1
  /** For peds, the vehicle they were last in, which is the one they are in, if they are in one. */
  lastVehicle: ClientEntity | undefined = undefined
  /** For vehicles, the peds in their seats, and those that were last in each seat, by the seats. */
  readonly occupants = new Map<number, ClientEntity>()
  readonly lastOccupants = new Map<number, ClientEntity>()
  /** For vehicles, the text of their number plates, which worlds give the vehicles they add, and its style. */
  plate = ''
  plateIndex = 0
  /** For peds that the client took a sync tree of, the object id of the vehicle that the tree seats them in, -1 for none, and the seat, until the world seats them. */
  syncedVehicle: readonly [objectId: number, seat: number] | undefined = undefined

  constructor(type: NetObjType, model: number) {
    this.type = type
    this.model = model
    this.health = this.maxHealth = entityTypeOf(type) === EntityType.ped ? 200 : 1000
  }

  /** Puts the entity at a position, which natives give in single precision, and the peds in it, if it is a vehicle. */
  moveTo(x: number, y: number, z: number): void {
    this.x = x
    this.y = y
    this.z = z
    for (const ped of this.occupants.values()) ped.moveTo(x, y, z)
  }

  /** Seats a ped in a seat of a vehicle, which the ped that sat there leaves, and puts it where the vehicle is. */
  enterVehicle(vehicle: ClientEntity, seat: number): void {
    this.leaveVehicle()
    vehicle.occupants.get(seat)?.leaveVehicle()
    this.vehicle = this.lastVehicle = vehicle
    this.seat = seat
    vehicle.occupants.set(seat, this)
    vehicle.lastOccupants.set(seat, this)
    this.moveTo(vehicle.x, vehicle.y, vehicle.z)
  }

  /** Takes a ped out of the vehicle that it is in, if it is in one, where the vehicle is. */
  leaveVehicle(): void {
    this.vehicle?.occupants.delete(this.seat)
    this.vehicle = undefined
  }

  /** Puts and turns the entity as a sync tree says, and gives it the model and the health of the tree, if a client synced one. */
  take(state: SyncState): void {
    this.moveTo(...fromSector(state.position))
    const { orientation } = state
    this.rotation =
      orientation.kind === 'heading'
        ? fromHeading((orientation.heading * 180) / Math.PI)
        : fromQuaternion(...decompressQuaternion(orientation.quaternion))
    this.model = state.model
    this.health = state.health ?? this.health
    this.maxHealth = state.maxHealth ?? this.maxHealth
    this.armour = state.armour ?? this.armour
    this.plate = state.plate ?? this.plate
    this.plateIndex = state.plateIndex ?? this.plateIndex
    this.weapon = state.weapon ?? this.weapon
    if (state.vehicle !== undefined) this.syncedVehicle = [state.vehicle, state.vehicleSeat ?? -1]
  }
}

/** What the world of a client tells of the network objects of its entities, which their state bags follow. */
export interface WorldHooks {
  /** An entity got a network object: one that the client created, or a clone that its server sent. */
  networked(entity: ClientEntity, created: boolean): void
  /** The server took an entity that the client created. */
  taken(entity: ClientEntity): void
  /** An entity went from the world. */
  forgotten(entity: ClientEntity): void
}

const NO_HOOKS: WorldHooks = { networked: () => {}, taken: () => {}, forgotten: () => {} }

/** A player of another client, as a client knows it while it is in its scope. */
export interface RemotePlayer {
  readonly netId: number
  readonly name: string
}

/** What a client tells its server of the entities it owns, as FiveM's clients send clones. */
export type CloneMessage =
  | {
      readonly kind: 'create'
      readonly objectId: number
      readonly type: NetObjType
      readonly state: SyncState
      /** The creation token that the server gave the entity, if the client created it for the server. */
      readonly creationToken?: number
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
  /** The other assets that the world loaded, by their kinds and names in lower case, such as anim:missheist. */
  readonly #assets = new Set<string>()
  /** The other assets that scripts requested, which the world loads at its next tick. */
  readonly #requestedAssets = new Set<string>()
  /** The interior placements of the map that scripts requested, by their names in lower case. */
  readonly ipls = new Set<string>()
  /** The state of the generator of the plates of vehicles. */
  #plateSeed = 1
  /** The entity types of the models that the world learned of, as scripts created entities of them. */
  readonly #kinds = new Map<number, number>()
  /** The object ids that the world may network entities with. */
  readonly #objectIds: number[] = []
  /** The object ids that the server handed the world, which it uses again as their entities go. */
  readonly #granted = new Set<number>()
  /** Whether the world asked for object ids, which it has not got yet. */
  #askedForObjectIds = false
  /** What the world last told its server of each networked entity that it told of. */
  readonly #synced = new Map<ClientEntity, SyncState>()
  /** The object ids of the networked entities that scripts removed, which the world tells its server of. */
  readonly #removed: number[] = []
  /** The entities that the world took from others, which it syncs once to tell its server it has them. */
  readonly #taken = new Set<ClientEntity>()
  /** The players of other clients in the scope of the client, by their indices. */
  readonly #players = new Map<number, RemotePlayer>()
  /** The ped of the local player: player_zero, at 0, 0, 0. */
  readonly playerPed = new ClientEntity(NetObjType.player, PLAYER_ZERO)
  /** The fade of the screen of the game. */
  readonly screen = new ScreenFade()
  /** The blips of the map of the game. */
  readonly blips = new Blips()
  /** The text of the game, which scripts build with text commands. */
  readonly text = new GameText()
  /** The keyboard of the game, the controls it presses, and the commands that resources bound to its keys. */
  readonly input = new Input()
  /** The doors of the door system, by their hashes. */
  readonly doors = new Map<number, Door>()
  /** The cameras that scripts create. */
  readonly cameras = new Cameras()
  /** The time of day of the game. */
  readonly clock = new GameClock()
  readonly weather = new Weather()
  /** Whether the local player is in a solo tutorial session of the game, as character menus put it. */
  tutorial = false

  readonly #hooks: WorldHooks

  constructor(hooks = NO_HOOKS) {
    this.#hooks = hooks
    this.add(this.playerPed)
  }

  /** The entities, in the order they were created. */
  get entities(): IterableIterator<ClientEntity> {
    return this.#entities.values()
  }

  /** The players of other clients in the scope of the client, by their indices. */
  get players(): ReadonlyMap<number, RemotePlayer> {
    return this.#players
  }

  /** Takes a player of another client that came into the scope of the client, at an index. */
  enter(index: number, netId: number, name: string): void {
    this.#players.set(index, { netId, name })
  }

  /**
   * Forgets the player at an index, which left the scope of the client,
   * and its ped, as FiveM's clients delete the peds of the players that
   * leave before their servers remove them.
   */
  leave(index: number): void {
    const player = this.#players.get(index)!
    this.#players.delete(index)
    const ped = this.pedOf(player.netId)
    if (ped !== undefined) this.#forget(ped)
  }

  /** The index of the player of another client of a net id, in the scope of the client, if it is. */
  indexOf(netId: number): number | undefined {
    for (const [index, player] of this.#players) if (player.netId === netId) return index
    return undefined
  }

  /** The ped of the player of another client of a net id, which is the clone of its player that it owns, if the client knows of it. */
  pedOf(netId: number): ClientEntity | undefined {
    for (const entity of this.#entities) {
      if (entity.type === NetObjType.player && entity.owner === netId) return entity
    }
    return undefined
  }

  /** Adds an entity to the world, with a handle of its own, and learns the type of its model. */
  add(entity: ClientEntity): void {
    entity.handle = this.#guids.add(entity)
    this.#entities.add(entity)
    this.#loaded.add(entity.model)
    this.#kinds.set(entity.model, entityTypeOf(entity.type))
    if (entityTypeOf(entity.type) === EntityType.vehicle && entity.plate === '') {
      entity.plate = this.#plate()
    }
  }

  /** A plate as GTA V gives new vehicles: two digits, three letters and three digits, drawn from a minstd_rand seeded with 1. */
  #plate(): string {
    const draw = (count: number) => {
      this.#plateSeed = (this.#plateSeed * 48_271) % 2_147_483_647
      return this.#plateSeed % count
    }
    const digit = () => String(draw(10))
    const letter = () => String.fromCharCode(0x41 + draw(26))
    return digit() + digit() + letter() + letter() + letter() + digit() + digit() + digit()
  }

  /**
   * Gives the local player a new ped of a model, as SetPlayerModel does: its
   * ped gets a handle of its own, which the old one no longer names, and
   * starts where it was as a new ped of a player, but networked as it was.
   */
  changePlayerModel(model: number): void {
    const ped = this.playerPed
    this.blips.forget(ped)
    ped.leaveVehicle()
    ped.lastVehicle = undefined
    this.#guids.delete(ped.handle)
    ped.handle = this.#guids.add(ped)
    ped.model = model
    this.#kinds.set(model, EntityType.ped)
    ped.health = ped.maxHealth = 200
    ped.armour = 0
    ped.configFlags.clear()
    ped.appearance = new PedAppearance()
    ped.weapons.clear()
    ped.weapon = UNARMED
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
    else this.#free(objectId)
  }

  /** Removes the entity of an object id, which the server removed, and frees the object id. */
  removedByServer(objectId: number): void {
    const entity = this.byObjectId(objectId)
    if (entity === undefined) return
    this.#forget(entity)
    this.#free(objectId)
  }

  /** Frees the object id of an entity whose removal the server took. */
  removalTaken(objectId: number): void {
    this.#free(objectId)
  }

  /** Takes object ids that the server handed the world. */
  receiveObjectIds(ids: readonly number[]): void {
    for (const id of ids) this.#granted.add(id)
    this.#objectIds.push(...ids)
    this.#askedForObjectIds = false
  }

  /**
   * Takes what the server sent of the entities of others, as FiveM's
   * clients take clones: the world creates, moves and removes them. Those
   * that the client of the world owns, which the server handed it, it
   * syncs from then on.
   */
  receiveClones(clones: readonly ServerClone[], netId: number): void {
    for (const clone of clones) {
      if (clone.kind === 'remove') {
        this.removedByServer(clone.objectId)
        continue
      }
      let entity = this.byObjectId(clone.objectId)
      if (clone.kind === 'create' && entity === undefined) {
        entity = new ClientEntity(clone.type, clone.state.model)
        entity.objectId = clone.objectId
        this.add(entity)
        this.#hooks.networked(entity, false)
        if (clone.owner === netId) this.#take(entity, clone.state)
        else entity.owner = clone.owner
        entity.take(clone.state)
      } else if (entity !== undefined && clone.owner !== netId) {
        // A clone moves, or an entity that the client owned is another's now.
        entity.owner = clone.owner
        entity.take(clone.state)
      } else if (entity !== undefined) {
        // The client owns a clone that it knew of, which it syncs from then on.
        entity.owner = undefined
        this.#take(entity, clone.state)
        entity.take(clone.state)
      }
    }
    // Peds sit where their trees seat them, once the world has the vehicles, which can come later.
    for (const ped of this.#entities) {
      if (ped.syncedVehicle === undefined) continue
      const [objectId, seat] = ped.syncedVehicle
      const vehicle = objectId === -1 ? undefined : this.byObjectId(objectId)
      if (vehicle === undefined && objectId !== -1) continue
      ped.syncedVehicle = undefined
      if (vehicle === undefined) ped.leaveVehicle()
      else if (ped.vehicle !== vehicle || ped.seat !== seat - 2) ped.enterVehicle(vehicle, seat - 2)
    }
  }

  /** Whether the world has an object id to network an entity with. */
  get canNetwork(): boolean {
    return this.#objectIds.length > 0
  }

  /** Networks an entity with the first object id that the world has, if it has one. */
  network(entity: ClientEntity): void {
    entity.objectId = this.#objectIds.shift()
    this.#hooks.networked(entity, true)
  }

  /** Learns that the server took an entity that the world created, of an object id. */
  creationTaken(objectId: number): void {
    const entity = this.byObjectId(objectId)
    if (entity !== undefined) this.#hooks.taken(entity)
  }

  /** Lets go of the entities that the script of a resource owns, and removes its blips and its cameras, as GTA V does as scripts end. */
  release(script: string): void {
    for (const entity of this.#entities) {
      if (entity.script === script) entity.script = undefined
    }
    this.blips.release(script)
    this.cameras.release(script)
  }

  /** Asks the world to load a model, which it does at its next tick. */
  request(model: number): void {
    if (!this.#loaded.has(model)) this.#requested.add(model)
  }

  /** Asks the world to load an asset other than a model, of a kind, which it does at its next tick. */
  requestAsset(kind: string, name: string): void {
    const key = `${kind}:${name.toLowerCase()}`
    if (!this.#assets.has(key)) this.#requestedAssets.add(key)
  }

  /** Whether the world loaded an asset other than a model, of a kind. */
  assetLoaded(kind: string, name: string): boolean {
    return this.#assets.has(`${kind}:${name.toLowerCase()}`)
  }

  /** Whether the world loaded a model. */
  loaded(model: number): boolean {
    return this.#loaded.has(model)
  }

  /** The entity type of a model, as far as the world learned of it. */
  kindOf(model: number): number {
    return this.#kinds.get(model) ?? EntityType.none
  }

  /** Runs a tick of the world, which starts a frame of its input: it loads the models and the assets that scripts requested. */
  tick(): void {
    this.input.frame()
    for (const model of this.#requested) this.#loaded.add(model)
    this.#requested.clear()
    for (const asset of this.#requestedAssets) this.#assets.add(asset)
    this.#requestedAssets.clear()
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
      // The owners of clones sync them.
      if (objectId === undefined || entity.owner !== undefined) continue
      const state = syncStateOf(entity)
      const last = this.#synced.get(entity)
      if (last === undefined) {
        const { creationToken } = entity
        clones.push({
          kind: 'create',
          objectId,
          type: entity.type,
          state,
          ...(creationToken === undefined ? {} : { creationToken }),
        })
      } else if (this.#taken.has(entity) || !sameState(last, state)) {
        clones.push({ kind: 'sync', objectId, state })
      }
      this.#synced.set(entity, state)
    }
    this.#taken.clear()
    const requestObjectIds = !this.#askedForObjectIds && this.#objectIds.length < FEW_OBJECT_IDS
    if (requestObjectIds) this.#askedForObjectIds = true
    return { clones, requestObjectIds }
  }

  /** Takes an entity that the world owns now, as its server handed it, which it syncs at once. */
  #take(entity: ClientEntity, state: SyncState): void {
    this.#synced.set(entity, state)
    this.#taken.add(entity)
  }

  /** Frees an object id that the server handed the world: those of others are no longer the world's. */
  #free(objectId: number): void {
    if (this.#granted.has(objectId)) this.#objectIds.push(objectId)
  }

  /** Takes an entity out of the world, and returns whether the server knew of it. */
  #forget(entity: ClientEntity): boolean {
    this.#hooks.forgotten(entity)
    this.blips.forget(entity)
    entity.leaveVehicle()
    for (const ped of [...entity.occupants.values()]) ped.leaveVehicle()
    for (const other of this.#entities) {
      if (other.lastVehicle === entity) other.lastVehicle = undefined
      for (const [seat, ped] of other.lastOccupants) {
        if (ped === entity) other.lastOccupants.delete(seat)
      }
    }
    this.#entities.delete(entity)
    this.#guids.delete(entity.handle)
    return this.#synced.delete(entity)
  }
}
