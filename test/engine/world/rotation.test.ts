import { describe, expect, it } from 'vitest'

import {
  apply,
  fromEuler,
  fromHeading,
  headingOf,
  IDENTITY,
  toEuler,
  type Matrix,
} from '../../../src/core/engine/world/rotation.ts'

const RADIANS = Math.PI / 180

/** The matrix of a rotation about an axis, written out as textbooks have it. */
function axis(name: 'x' | 'y' | 'z', degrees: number): Matrix {
  const c = Math.cos(degrees * RADIANS)
  const s = Math.sin(degrees * RADIANS)
  if (name === 'x') return [1, 0, 0, 0, c, -s, 0, s, c]
  if (name === 'y') return [c, 0, s, 0, 1, 0, -s, 0, c]
  return [c, -s, 0, s, c, 0, 0, 0, 1]
}

function product(...matrices: Matrix[]): Matrix {
  return matrices.reduce((a, b) =>
    [0, 1, 2].flatMap((row) =>
      [0, 1, 2].map((column) =>
        [0, 1, 2].reduce((sum, i) => sum + a[row * 3 + i]! * b[i * 3 + column]!, 0),
      ),
    ),
  )
}

/** The matrix of a unit quaternion, x, y, z and w. */
function ofQuaternion(x: number, y: number, z: number, w: number): Matrix {
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - w * z),
    2 * (x * z + w * y),
    2 * (x * y + w * z),
    1 - 2 * (x * x + z * z),
    2 * (y * z - w * x),
    2 * (x * z - w * y),
    2 * (y * z + w * x),
    1 - 2 * (x * x + y * y),
  ]
}

/** The quaternion of a rotation by `degrees` about an axis. */
function quaternion(x: number, y: number, z: number, degrees: number): number[] {
  const s = Math.sin((degrees * RADIANS) / 2)
  return [x * s, y * s, z * s, Math.cos((degrees * RADIANS) / 2)]
}

/** The product of quaternions: the rotation of `b`, then that of `a`. */
function times(a: number[], b: number[]): number[] {
  const [ax, ay, az, aw] = a as [number, number, number, number]
  const [bx, by, bz, bw] = b as [number, number, number, number]
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

function expectClose(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 9))
}

describe('Rotations of entities', () => {
  it('in the order 2 turn about z, then x, then y, as FiveM rotates the quaternions of its server', () => {
    // FiveM's server reads the quaternion of z, then x, then y as these angles, which the tests of its quaternions check.
    const [x, y, z, w] = times(
      times(quaternion(0, 0, 1, 30), quaternion(1, 0, 0, 20)),
      quaternion(0, 1, 0, 10),
    ) as [number, number, number, number]
    expectClose(fromEuler(20, 10, 30, 2), ofQuaternion(x, y, z, w))
  })

  it('multiply their axes in the orders that GTA V numbers 0 to 5', () => {
    const [pitch, roll, yaw] = [20, -35, 130]
    const [rx, ry, rz] = [axis('x', pitch), axis('y', roll), axis('z', yaw)]
    expectClose(fromEuler(pitch, roll, yaw, 0), product(rz, ry, rx))
    expectClose(fromEuler(pitch, roll, yaw, 1), product(ry, rz, rx))
    expectClose(fromEuler(pitch, roll, yaw, 2), product(rz, rx, ry))
    expectClose(fromEuler(pitch, roll, yaw, 3), product(rx, rz, ry))
    expectClose(fromEuler(pitch, roll, yaw, 4), product(ry, rx, rz))
    expectClose(fromEuler(pitch, roll, yaw, 5), product(rx, ry, rz))
  })

  it('take orders that GTA V does not number as 2', () => {
    expectClose(fromEuler(20, -35, 130, 6), fromEuler(20, -35, 130, 2))
    expectClose(fromEuler(20, -35, 130, -1), fromEuler(20, -35, 130, 2))
    expectClose(toEuler(fromEuler(20, -35, 130, 2), 9), [20, -35, 130])
  })

  it('give back the angles they were made of, in each order', () => {
    for (let order = 0; order < 6; order++) {
      for (const angles of [
        [20, -35, 130],
        [-80, 170, -10],
        [5, 0, -179],
      ]) {
        // The middle axis of each order is the one that turns by at most 90 degrees.
        const middle = [[1], [2], [0], [2], [0], [1]][order]![0]!
        const [x, y, z] = angles.map((angle, index) => (index === middle ? angle / 2 : angle))
        expectClose(toEuler(fromEuler(x!, y!, z!, order), order), [x!, y!, z!])
      }
    }
  })

  it('give the angles of any rotation in each order', () => {
    const rotation = product(axis('z', 47), axis('x', -12), axis('y', 101), axis('z', 8))
    for (let order = 0; order < 6; order++) {
      expectClose(fromEuler(...toEuler(rotation, order), order), rotation)
    }
  })

  it('give 90 degrees for rotations that rounding takes a little past them', () => {
    const rotation = [...fromEuler(90, 0, 0, 2)]
    // A rotation that products of matrices rounded: what gives its pitch is a little more than 1.
    rotation[7] = 1 + Number.EPSILON
    expectClose(toEuler(rotation, 2), [90, 0, 0])
    const down = [...fromEuler(-90, 0, 0, 2)]
    down[7] = -1 - Number.EPSILON
    expectClose(toEuler(down, 2), [-90, 0, 0])
  })

  it('give yaws from -180 to 180, and no negative zeros', () => {
    expectClose(toEuler(fromEuler(0, 0, 200, 2), 2), [0, 0, -160])
    expectClose(toEuler(fromEuler(0, 0, -270, 2), 2), [0, 0, 90])
    for (const angle of toEuler(IDENTITY, 2)) expect(Object.is(angle, 0)).toBe(true)
  })

  it('have headings from 0 up to 360, the yaws of where they turn the front', () => {
    expect(headingOf(IDENTITY)).toBe(0)
    expect(headingOf(fromHeading(90))).toBeCloseTo(90, 9)
    expect(headingOf(fromHeading(-90))).toBeCloseTo(270, 9)
    expect(headingOf(fromHeading(180))).toBeCloseTo(180, 9)
    expect(headingOf(fromHeading(725))).toBeCloseTo(5, 9)
    // Pitch does not change where the front points on the ground.
    expect(headingOf(fromEuler(30, 0, 45, 2))).toBeCloseTo(45, 9)
    expect(Object.is(headingOf(fromHeading(-0)), 0)).toBe(true)
  })

  it('turn the front of entities, y, to their headings', () => {
    // GTA V's heading 90 faces west.
    expectClose(apply(fromHeading(90), 0, 1, 0), [-1, 0, 0])
    expectClose(apply(fromHeading(90), 2, 0, 3), [0, 2, 3])
    expectClose(apply(IDENTITY, 1, 2, 3), [1, 2, 3])
  })
})
