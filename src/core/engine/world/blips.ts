import type { ClientEntity } from './client.ts'
import { Pool } from './pool.ts'

/** The sprite of the waypoint that players set on the map of the game. */
export const WAYPOINT_SPRITE = 8

/** The sprite of blips around coordinates, as GTA V gives them. */
const RADIUS_SPRITE = 9

/** What a blip marks: coordinates, a circle or an area around them, or an entity, which it follows. */
export type BlipShape =
  | { readonly kind: 'coord' }
  | { readonly kind: 'radius'; readonly radius: number }
  | { readonly kind: 'area'; readonly width: number; readonly height: number }
  | { readonly kind: 'entity'; readonly entity: ClientEntity }

/** A blip on the map of a client, as scripts set it. */
export class Blip {
  /** The handle that scripts know the blip by. */
  handle = 0
  readonly shape: BlipShape
  /** The resource whose script created the blip, which takes it with it as it stops: none for the waypoint. */
  readonly script: string | undefined
  x = 0
  y = 0
  z = 0
  sprite: number
  colour = 0
  alpha = 255
  scale = 1
  display = 2
  shortRange = false
  category = 0
  route = false
  routeColour = 0
  rotation = 0
  flashes = false
  /** The name that a script gave the blip, if one did. */
  name: string | undefined = undefined

  constructor(shape: BlipShape, script: string | undefined, sprite?: number) {
    this.shape = shape
    this.script = script
    this.sprite = sprite ?? (shape.kind === 'radius' ? RADIUS_SPRITE : 1)
  }

  /** Where the blip is: where its entity is, for the blips of entities. */
  get coords(): readonly [x: number, y: number, z: number] {
    const { shape } = this
    return shape.kind === 'entity'
      ? [shape.entity.x, shape.entity.y, shape.entity.z]
      : [this.x, this.y, this.z]
  }
}

/**
 * The blips of the map of a client, in the order they were created, by
 * handles from a pool of their own, with the waypoint of the player, which
 * no script owns.
 */
export class Blips {
  readonly #pool = new Pool<Blip>(0)
  readonly #blips = new Set<Blip>()
  /** The blips of each sprite that GET_FIRST_BLIP_INFO_ID went through, and how far GET_NEXT_BLIP_INFO_ID got. */
  readonly #searches = new Map<number, { readonly blips: readonly Blip[]; next: number }>()

  /** The blips, in the order they were created. */
  get all(): IterableIterator<Blip> {
    return this.#blips.values()
  }

  /** Adds a blip, which gets a handle of its own, and returns the handle. */
  add(blip: Blip): number {
    blip.handle = this.#pool.add(blip)
    this.#blips.add(blip)
    return blip.handle
  }

  /** The blip of a handle, if there is one. */
  get(handle: number): Blip | undefined {
    return this.#pool.get(handle)
  }

  /** Removes a blip, which frees its handle. */
  remove(blip: Blip): void {
    this.#blips.delete(blip)
    this.#pool.delete(blip.handle)
  }

  /** The first blip of an entity, if it has one. */
  ofEntity(entity: ClientEntity): Blip | undefined {
    for (const blip of this.#blips) {
      if (blip.shape.kind === 'entity' && blip.shape.entity === entity) return blip
    }
    return undefined
  }

  /** Removes the blips of an entity that went from the world. */
  forget(entity: ClientEntity): void {
    for (const blip of this.#blips) {
      if (blip.shape.kind === 'entity' && blip.shape.entity === entity) this.remove(blip)
    }
  }

  /** Removes the blips of the script of a resource, which stopped. */
  release(script: string): void {
    for (const blip of this.#blips) if (blip.script === script) this.remove(blip)
  }

  /** The waypoint of the player, if it set one. */
  get waypoint(): Blip | undefined {
    for (const blip of this.#blips) {
      if (blip.script === undefined && blip.sprite === WAYPOINT_SPRITE) return blip
    }
    return undefined
  }

  /** Sets the waypoint of the player, where it is or anew, at a height of 0. */
  setWaypoint(x: number, y: number): void {
    const waypoint = this.waypoint ?? new Blip({ kind: 'coord' }, undefined, WAYPOINT_SPRITE)
    waypoint.x = x
    waypoint.y = y
    if (waypoint.handle === 0) this.add(waypoint)
  }

  /** Starts going through the blips of a sprite, and returns the first. */
  first(sprite: number): Blip | undefined {
    const blips = [...this.#blips].filter((blip) => blip.sprite === sprite)
    this.#searches.set(sprite, { blips, next: 1 })
    return blips[0]
  }

  /** The next of the blips of a sprite that `first` went through, which are still there. */
  next(sprite: number): Blip | undefined {
    const search = this.#searches.get(sprite)
    if (search === undefined) return undefined
    while (search.next < search.blips.length) {
      const blip = search.blips[search.next++]!
      if (this.#blips.has(blip)) return blip
    }
    return undefined
  }
}
