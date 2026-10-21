/**
 * Rotations of the entities of clients, as matrices that turn column
 * vectors, by rows, and as the Euler angles that natives take and give: in
 * degrees about x, y and z, the pitch, the roll and the yaw, in one of the
 * orders that GTA V numbers 0 to 5.
 */

/** A rotation matrix, by rows: `m[row * 3 + column]`. */
export type Matrix = readonly number[]

/** The rotation that turns nothing. */
export const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/**
 * The axes of the orders of rotations, as GTA V numbers them, by the order
 * their matrices multiply in: ROT_ZXY, 2, which scripts use the most, turns
 * about z, then about the new x, then about the newer y.
 */
const ORDERS: readonly (readonly [number, number, number])[] = [
  [2, 1, 0],
  [1, 2, 0],
  [2, 0, 1],
  [0, 2, 1],
  [1, 0, 2],
  [0, 1, 2],
]

/** The order that natives take for orders that GTA V does not number. */
const DEFAULT_ORDER = 2

const RADIANS = Math.PI / 180

function axesOf(order: number): readonly [number, number, number] {
  return ORDERS[order] ?? ORDERS[DEFAULT_ORDER]!
}

/** The matrix of a rotation by `degrees` about an axis: 0 for x, 1 for y and 2 for z. */
function about(axis: number, degrees: number): Matrix {
  const c = Math.cos(degrees * RADIANS)
  const s = Math.sin(degrees * RADIANS)
  switch (axis) {
    case 0:
      return [1, 0, 0, 0, c, -s, 0, s, c]
    case 1:
      return [c, 0, s, 0, 1, 0, -s, 0, c]
    default:
      return [c, -s, 0, s, c, 0, 0, 0, 1]
  }
}

/** The product of two matrices: the rotation of `b`, then that of `a`. */
function multiply(a: Matrix, b: Matrix): Matrix {
  const m: number[] = []
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      let sum = 0
      for (let i = 0; i < 3; i++) sum += a[row * 3 + i]! * b[i * 3 + column]!
      m.push(sum)
    }
  }
  return m
}

/** The matrix of a rotation by the angles in degrees about x, y and z, in an order of GTA V. */
export function fromEuler(x: number, y: number, z: number, order: number): Matrix {
  const angles = [x, y, z]
  const [i, j, k] = axesOf(order)
  return multiply(multiply(about(i, angles[i]!), about(j, angles[j]!)), about(k, angles[k]!))
}

/**
 * The angles in degrees about x, y and z of a rotation, in an order of GTA
 * V: those of its middle axis from -90 to 90, the others from -180 to 180.
 */
export function toEuler(m: Matrix, order: number): [x: number, y: number, z: number] {
  const [i, j, k] = axesOf(order)
  // The orders whose axes go round as x, y and z do have their signs, the others the opposite.
  const sign = (j - i + 3) % 3 === 1 ? 1 : -1
  const at = (row: number, column: number) => m[row * 3 + column]!
  const angles = [0, 0, 0]
  angles[j] = Math.asin(Math.max(-1, Math.min(1, sign * at(i, k))))
  angles[i] = Math.atan2(-sign * at(j, k), at(k, k))
  angles[k] = Math.atan2(-sign * at(i, j), at(i, i))
  // Adding 0 turns -0 into 0.
  const [ax, ay, az] = angles.map((radians) => radians / RADIANS + 0) as [number, number, number]
  return [ax, ay, az]
}

/** What a matrix turns a vector into. */
export function apply(m: Matrix, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0]! * x + m[1]! * y + m[2]! * z,
    m[3]! * x + m[4]! * y + m[5]! * z,
    m[6]! * x + m[7]! * y + m[8]! * z,
  ]
}

/**
 * The heading in degrees of a rotation, from 0 up to 360, as GTA V tells
 * those of entities: the yaw of where it turns their front, which y is.
 */
export function headingOf(m: Matrix): number {
  const heading = Math.atan2(-m[1]!, m[4]!) / RADIANS
  return (heading < 0 ? heading + 360 : heading) + 0
}

/** The rotation about z alone by `heading` degrees, as GTA V turns entities to their headings. */
export function fromHeading(heading: number): Matrix {
  return about(2, heading)
}
