import { hashString } from '../../natives/index.ts'
import type { ClientEntity } from './client.ts'
import { EntityType, entityTypeOf, NetObjType, PopType, type SyncState } from './entity.ts'
import { compressQuaternion, syncHeading, syncSector } from './quantize.ts'
import { headingOf, toQuaternion } from './rotation.ts'

/**
 * The sync tree of an entity of a client, as the client syncs it and
 * FiveM's server reads it: its position in steps of its sector, peds
 * turned by their headings in 8 bits and other entities by quaternions
 * in 11, the population of missions for the entities that scripts
 * created, the hash of the name of the resource whose script owns it, and
 * the health of peds and vehicles, with the armour of peds and the
 * networked vehicles they are in.
 */
export function syncStateOf(entity: ClientEntity): SyncState {
  const heading = headingOf(entity.rotation)
  const type = entityTypeOf(entity.type)
  const vehicle = entity.vehicle?.objectId
  return {
    position: syncSector(entity.x, entity.y, entity.z),
    orientation:
      type === EntityType.ped
        ? {
            kind: 'heading',
            // GTA V keeps the headings of peds in radians from -pi to pi.
            heading: syncHeading(
              Math.fround(((heading > 180 ? heading - 360 : heading) * Math.PI) / 180),
            ),
          }
        : { kind: 'quaternion', quaternion: compressQuaternion(...toQuaternion(entity.rotation)) },
    model: entity.model,
    popType: entity.type === NetObjType.player ? PopType.unknown : PopType.mission,
    scriptHash: entity.script === undefined ? 0 : hashString(entity.script),
    ...(type === EntityType.ped
      ? {
          health: entity.health,
          maxHealth: entity.maxHealth,
          armour: entity.armour,
          vehicle: vehicle ?? -1,
          vehicleSeat: vehicle === undefined ? -1 : entity.seat + 2,
        }
      : type === EntityType.vehicle
        ? { health: entity.health }
        : {}),
  }
}

/** Whether two sync trees hold the same, which clients sync no change of. */
export function sameState(a: SyncState, b: SyncState): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
