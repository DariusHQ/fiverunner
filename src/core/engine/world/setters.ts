import { PopType, type SyncState } from './entity.ts'
import { compressQuaternion, headingQuaternion, toSector } from './quantize.ts'

/** What FiveM's server setters turn degrees into radians with, in single precision. */
const RADIANS_PER_DEGREE = Math.fround(0.01745329252)

/**
 * The sync tree of a vehicle that a script of the server creates, as
 * FiveM's server setters build it: where it is exactly, its heading in a
 * compressed quaternion, and the population of missions.
 */
export function vehicleState(
  model: number,
  x: number,
  y: number,
  z: number,
  scriptHash: number,
  heading: number,
): SyncState {
  return {
    position: toSector(x, y, z),
    orientation: {
      kind: 'quaternion',
      quaternion: compressQuaternion(...headingQuaternion(heading)),
    },
    model,
    popType: PopType.mission,
    scriptHash,
  }
}

/** The sync tree of a ped that a script of the server creates, as FiveM's server setters build it: its heading in radians. */
export function pedState(
  model: number,
  x: number,
  y: number,
  z: number,
  scriptHash: number,
  heading: number,
): SyncState {
  return {
    position: toSector(x, y, z),
    orientation: { kind: 'heading', heading: Math.fround(heading * RADIANS_PER_DEGREE) },
    model,
    popType: PopType.mission,
    scriptHash,
  }
}

/**
 * The sync tree of an object that a script of the server creates, as
 * FiveM's server setters build it: with no heading, and no population,
 * which the trees of objects do not have.
 */
export function objectState(
  model: number,
  x: number,
  y: number,
  z: number,
  scriptHash: number,
): SyncState {
  return {
    position: toSector(x, y, z),
    orientation: { kind: 'quaternion', quaternion: compressQuaternion(...headingQuaternion(0)) },
    model,
    popType: PopType.unknown,
    scriptHash,
  }
}
