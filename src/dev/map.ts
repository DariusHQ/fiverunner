import type { ResourceManager } from '../core/engine/index.ts'
import {
  EntityType,
  entityTypeOf,
  NetObjType,
  type SyncEntity,
} from '../core/engine/world/entity.ts'
import {
  decompressQuaternion,
  fromSector,
  quaternionRotation,
  radiansToDegrees,
} from '../core/engine/world/quantize.ts'
import type { PedAppearance } from '../core/engine/world/appearance.ts'
import { headingOf as headingOfMatrix } from '../core/engine/world/rotation.ts'

/**
 * How the ped of a player looks, as its appearance has it: the colour of
 * its hair and the drawable of its style, the skins of the parents of its
 * head and how they mix, and the drawables and textures of its top, legs
 * and shoes, which the cartoon dresses its character by.
 */
export interface DevLook {
  readonly hair: number
  readonly hairStyle: number
  readonly skin: readonly [first: number, second: number, mix: number]
  readonly top: readonly [drawable: number, texture: number]
  readonly legs: readonly [drawable: number, texture: number]
  readonly shoes: readonly [drawable: number, texture: number]
}

/** An entity of the game state of the server, where its owner last synced it, or the ped of a player, where its client has it. */
export interface DevEntity {
  /** Its network id, or 0 for the peds of players that are not networked. */
  readonly id: number
  readonly kind: 'player' | 'ped' | 'vehicle' | 'object'
  readonly x: number
  readonly y: number
  readonly z: number
  /** Where it faces, in degrees from the north, anticlockwise, as GTA V turns. */
  readonly heading: number
  readonly model: number
  /** The number of the client that owns it, if one of the session does. */
  readonly owner?: number
  /** For the peds of players, how they look. */
  readonly look?: DevLook
}

/** A blip of the map of a client. */
export interface DevBlip {
  /** The number of the client whose map has it. */
  readonly client: number
  readonly handle: number
  readonly x: number
  readonly y: number
  /** The height of the blip, which players dropped on it go to. */
  readonly z: number
  readonly sprite: number
  readonly colour: number
  readonly alpha: number
  readonly shape: 'coord' | 'radius' | 'area' | 'entity'
  /** The radius of a blip around coordinates, or the width and height of an area. */
  readonly radius?: number
  readonly width?: number
  readonly height?: number
  readonly name?: string
  /** The resource whose script created it: none for the waypoint. */
  readonly script?: string
  readonly route: boolean
}

/** The world that the map of the dev UI shows: the entities of the server, and the blips of its clients. */
export interface DevMap {
  readonly entities: readonly DevEntity[]
  readonly blips: readonly DevBlip[]
}

/** Rounds to centimetres, which the map needs no more than, so that the state changes as little as it can. */
const round = (value: number) => Math.round(value * 100) / 100

/** How a ped looks, of its appearance: its hair, of component 2, its legs, of 4, its shoes, of 6, and its top, of 11. */
function lookOf(appearance: PedAppearance): DevLook {
  const part = (component: number): [number, number] => {
    const [drawable, texture] = appearance.components.get(component) ?? [0, 0]
    return [drawable, texture]
  }
  const [, , , skinFirst, skinSecond, , , skinMix] = appearance.headBlend
  return {
    hair: appearance.hair,
    hairStyle: part(2)[0],
    skin: [skinFirst, skinSecond, round(skinMix)],
    top: part(11),
    legs: part(4),
    shoes: part(6),
  }
}

/** The heading of an entity of the server, in degrees, from its sync tree. */
function headingOf(entity: SyncEntity): number {
  const { orientation } = entity.state
  if (orientation.kind === 'heading') return radiansToDegrees(orientation.heading)
  return quaternionRotation(...decompressQuaternion(orientation.quaternion))[2]
}

/** The kind that the map shows an entity of the server as, other than the peds of players. */
function kindOf(entity: SyncEntity): DevEntity['kind'] {
  const type = entityTypeOf(entity.type)
  return type === EntityType.ped ? 'ped' : type === EntityType.vehicle ? 'vehicle' : 'object'
}

/**
 * What the map shows of a session: the peds of the players, where their
 * clients have them, which needs no OneSync, the other valid entities of
 * the game state of its server, and the blips of the clients, which
 * `clientOf` numbers by the net ids of their players.
 */
export function describeMap(
  server: ResourceManager,
  clients: readonly ResourceManager[],
  clientOf: (netId: number) => number | undefined,
): DevMap {
  const entities: DevEntity[] = []
  clients.forEach((manager, index) => {
    const ped = manager.world?.playerPed
    if (ped === undefined) return
    entities.push({
      id: ped.objectId ?? 0,
      kind: 'player',
      x: round(ped.x),
      y: round(ped.y),
      z: round(ped.z),
      heading: round(headingOfMatrix(ped.rotation)),
      model: ped.model,
      owner: index + 1,
      look: lookOf(ped.appearance),
    })
  })
  for (const entity of server.gameState?.entities ?? []) {
    if (!entity.valid || entity.type === NetObjType.player) continue
    const [x, y, z] = fromSector(entity.state.position)
    const owner = entity.owner === undefined ? undefined : clientOf(entity.owner.netId)
    entities.push({
      id: entity.objectId,
      kind: kindOf(entity),
      x: round(x),
      y: round(y),
      z: round(z),
      heading: round(headingOf(entity)),
      model: entity.state.model,
      ...(owner === undefined ? {} : { owner }),
    })
  }
  const blips: DevBlip[] = []
  clients.forEach((manager, index) => {
    for (const blip of manager.world?.blips.all ?? []) {
      const [x, y, z] = blip.coords
      const { shape } = blip
      blips.push({
        client: index + 1,
        handle: blip.handle,
        x: round(x),
        y: round(y),
        z: round(z),
        sprite: blip.sprite,
        colour: blip.colour,
        alpha: blip.alpha,
        shape: shape.kind,
        ...(shape.kind === 'radius' ? { radius: shape.radius } : {}),
        ...(shape.kind === 'area' ? { width: shape.width, height: shape.height } : {}),
        ...(blip.name === undefined ? {} : { name: blip.name }),
        ...(blip.script === undefined ? {} : { script: blip.script }),
        route: blip.route,
      })
    }
  })
  return { entities, blips }
}
