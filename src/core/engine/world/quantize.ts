/**
 * The numbers of FiveM's sync trees: positions in sectors and compressed
 * quaternions, as FiveM's server reads and writes them, in single
 * precision, as its floats are.
 */

const f = Math.fround

/** A position as sync trees keep it: the sector it is in, and where in the sector. */
export interface SectorPosition {
  readonly sectorX: number
  readonly sectorY: number
  readonly sectorZ: number
  readonly x: number
  readonly y: number
  readonly z: number
}

/**
 * A position in sectors of 54 by 54 by 69 metres, which start 1700 metres
 * below zero, as FiveM's server puts those of the entities it creates.
 */
export function toSector(x: number, y: number, z: number): SectorPosition {
  const sectorX = Math.trunc(f(f(x / 54) + 512))
  const sectorY = Math.trunc(f(f(y / 54) + 512))
  const sectorZ = Math.trunc(f(f(z + 1700) / 69))
  return {
    sectorX,
    sectorY,
    sectorZ,
    x: f(x - f(f(sectorX - 512) * 54)),
    y: f(y - f(f(sectorY - 512) * 54)),
    z: f(z - f(f(sectorZ * 69) - 1700)),
  }
}

/** The position that a sector position stands for, as FiveM's server calculates it. */
export function fromSector(position: SectorPosition): [x: number, y: number, z: number] {
  return [
    f(f(f(position.sectorX - 512) * 54) + position.x),
    f(f(f(position.sectorY - 512) * 54) + position.y),
    f(f(f(position.sectorZ * 69) + position.z) - 1700),
  ]
}

/**
 * A float as clients sync it in `bits` bits, of 0 up to `divisor`, and as
 * FiveM's server reads it: truncated to a step, as FiveM writes floats.
 */
export function syncFloat(bits: number, divisor: number, value: number): number {
  const max = f((1 << bits) - 1)
  return f(f(Math.trunc(f(f(value / divisor) * max)) / max) * divisor)
}

/**
 * A float as clients sync it in `bits` bits with a sign, of -`divisor` to
 * `divisor`, and as FiveM's server reads it: truncated to a step toward 0.
 */
export function syncSignedFloat(bits: number, divisor: number, value: number): number {
  const max = f((1 << (bits - 1)) - 1)
  return f(f(Math.trunc(f(f(value / divisor) * max)) / max) * divisor)
}

/** A position as clients sync it: its sector, and where in it in 12 bits of 54 metres for x and y and of 69 for z. */
export function syncSector(x: number, y: number, z: number): SectorPosition {
  const exact = toSector(x, y, z)
  return {
    ...exact,
    x: syncFloat(12, 54, exact.x),
    y: syncFloat(12, 54, exact.y),
    z: syncFloat(12, 69, exact.z),
  }
}

/** The single precision two pi that the sync trees of FiveM take the headings of peds in. */
const TWO_PI = f(6.28318548)

/** A heading in radians, from -pi to pi, as clients sync those of peds: in 8 bits. */
export function syncHeading(radians: number): number {
  return syncSignedFloat(8, TWO_PI, radians)
}

/** A quaternion compressed as its smallest three components, in 11 bits each, and which one was largest. */
export interface CompressedQuaternion {
  readonly largest: number
  readonly a: number
  readonly b: number
  readonly c: number
}

/** The bounds of the smallest three components of a unit quaternion: plus or minus one over the root of two. */
const MINIMUM = f(-1 / 1.414214)
const MAXIMUM = f(1 / 1.414214)

/** Compresses a quaternion into its smallest three components, in 11 bits each, as FiveM's sync trees do. */
export function compressQuaternion(
  x: number,
  y: number,
  z: number,
  w: number,
): CompressedQuaternion {
  const scale = f((1 << 11) - 1)
  const components = [f(x), f(y), f(z), f(w)]
  let largest = 0
  for (let index = 1; index < 4; index++) {
    if (Math.abs(components[index]!) > Math.abs(components[largest]!)) largest = index
  }
  const sign = components[largest]! >= 0 ? 1 : -1
  const [a, b, c] = components
    .filter((_, index) => index !== largest)
    .map((value) => f(value * sign))
  const integer = (value: number) =>
    Math.floor(f(f(f(f(value - MINIMUM) / f(MAXIMUM - MINIMUM)) * scale) + 0.5))
  return { largest, a: integer(a!), b: integer(b!), c: integer(c!) }
}

/** The quaternion, as x, y, z and w, that a compressed one stands for, as FiveM's sync trees read it. */
export function decompressQuaternion(
  quaternion: CompressedQuaternion,
): [number, number, number, number] {
  const scale = f((1 << 11) - 1)
  const inverse = f(1 / scale)
  const value = (integer: number) => f(f(f(integer * inverse) * f(MAXIMUM - MINIMUM)) + MINIMUM)
  const a = value(quaternion.a)
  const b = value(quaternion.b)
  const c = value(quaternion.c)
  const largest = f(Math.sqrt(f(f(f(1 - f(a * a)) - f(b * b)) - f(c * c))))
  const rest = [a, b, c]
  const components: number[] = []
  for (let index = 0; index < 4; index++) {
    components.push(index === quaternion.largest ? largest : rest.shift()!)
  }
  return components as [number, number, number, number]
}

/** The quaternion of a rotation about z by `heading` degrees, as FiveM makes it for the entities its server creates. */
export function headingQuaternion(heading: number): [number, number, number, number] {
  const half = f(f(heading * f(0.01745329252)) * 0.5)
  return [0, 0, f(Math.sin(half)), f(Math.cos(half))]
}

/**
 * The rotation in degrees, about x, y and z, of a quaternion, as FiveM's
 * server gives entities theirs: by the angles of a rotation in the order
 * Z, X, Y that GLM's extractEulerAngleZXY takes from its matrix.
 */
export function quaternionRotation(
  x: number,
  y: number,
  z: number,
  w: number,
): [x: number, y: number, z: number] {
  // The matrix of the quaternion, as glm::toMat4 makes it, by its columns.
  const xx = f(x * x)
  const yy = f(y * y)
  const zz = f(z * z)
  const xz = f(x * z)
  const xy = f(x * y)
  const yz = f(y * z)
  const wx = f(w * x)
  const wy = f(w * y)
  const wz = f(w * z)
  const m00 = f(1 - f(2 * f(yy + zz)))
  const m01 = f(2 * f(xy + wz))
  const m02 = f(2 * f(xz - wy))
  const m10 = f(2 * f(xy - wz))
  const m11 = f(1 - f(2 * f(xx + zz)))
  const m12 = f(2 * f(yz + wx))
  const m20 = f(2 * f(xz + wy))
  const m21 = f(2 * f(yz - wx))
  const m22 = f(1 - f(2 * f(xx + yy)))
  // GLM's extractEulerAngleZXY, of a matrix M[column][row].
  const t1 = f(Math.atan2(-m10, m11))
  const c2 = f(Math.sqrt(f(f(m02 * m02) + f(m22 * m22))))
  const t2 = f(Math.atan2(m12, c2))
  const s1 = f(Math.sin(t1))
  const c1 = f(Math.cos(t1))
  const t3 = f(Math.atan2(f(f(c1 * m20) + f(s1 * m21)), f(f(c1 * m00) + f(s1 * m01))))
  // glm::degrees, in single precision.
  const degrees = (radians: number) => f(radians * f(57.29577951308232))
  return [degrees(t2), degrees(t3), degrees(t1)]
}

/** The single precision pi of FiveM's server, which it turns radians into degrees with. */
const PI = f(Math.PI)

/** Degrees of an angle in radians, as FiveM's server turns those of peds and of exact rotations, in double precision. */
export function radiansToDegrees(radians: number): number {
  return f((radians * 180) / PI)
}
