import { describe, expect, it } from 'vitest'

import {
  compressQuaternion,
  decompressQuaternion,
  fromSector,
  headingQuaternion,
  quaternionRotation,
  radiansToDegrees,
  syncFloat,
  syncHeading,
  syncSector,
  syncSignedFloat,
  toSector,
} from '../../../src/core/engine/world/quantize.ts'

const HALF = Math.SQRT1_2

/** The quaternion of a rotation by `degrees` about an axis, as x, y, z and w. */
function about(x: number, y: number, z: number, degrees: number): number[] {
  const half = (degrees * Math.PI) / 360
  return [x * Math.sin(half), y * Math.sin(half), z * Math.sin(half), Math.cos(half)]
}

/** The product of two quaternions: the rotation of `b`, then that of `a`. */
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

describe('Sector positions', () => {
  it('are in sectors of 54 by 54 by 69 metres, which start 1700 metres below zero', () => {
    // 100 / 54 + 512 is 513.85, 200 / 54 + 512 is 515.7 and (30 + 1700) / 69 is 25.07.
    expect(toSector(100, 200, 30)).toEqual({
      sectorX: 513,
      sectorY: 515,
      sectorZ: 25,
      x: 46,
      y: 38,
      z: 5,
    })
    expect(fromSector(toSector(100, 200, 30))).toEqual([100, 200, 30])
  })

  it('start where positions are whole sectors away from 0, 0 and -1700', () => {
    // 1070 / 54 + 512 is 531.81, -1070 / 54 + 512 is 492.19 and (25 + 1700) / 69 is 25.
    expect(toSector(1070, -1070, 25)).toEqual({
      sectorX: 531,
      sectorY: 492,
      sectorZ: 25,
      x: 44,
      y: 10,
      z: 0,
    })
    expect(toSector(54, -54, -1700)).toEqual({
      sectorX: 513,
      sectorY: 511,
      sectorZ: 0,
      x: 0,
      y: 0,
      z: 0,
    })
  })

  it('truncate the sectors of negative positions toward 512 and toward zero', () => {
    // -100.5 / 54 + 512 is 510.14, -0.25 / 54 + 512 is 511.995 and (-50 + 1700) / 69 is 23.9.
    expect(toSector(-100.5, -0.25, -50)).toEqual({
      sectorX: 510,
      sectorY: 511,
      sectorZ: 23,
      x: 7.5,
      y: 53.75,
      z: 63,
    })
    expect(fromSector(toSector(-100.5, -0.25, -50))).toEqual([-100.5, -0.25, -50])
  })

  it('lose what single precision rounds off as it adds the sectors back', () => {
    const [x, y, z] = [-1.1, 0.1, 30.1].map(Math.fround) as [number, number, number]
    const position = toSector(x, y, z)
    // -1.1 + 54 and 30.1 + 1700 are rounded to the floats nearest them.
    expect(position).toEqual({
      sectorX: 511,
      sectorY: 512,
      sectorZ: 25,
      x: 52.900001525878906,
      y: 0.10000000149011612,
      z: 5.100000381469727,
    })
    expect(fromSector(position)).toEqual([-1.0999984741210938, y, 30.0999755859375])
  })
})

describe('Floats that clients sync', () => {
  it('are truncated to the steps of their bits', () => {
    // 46 / 54 * 4095 is 3488.33, and 3488 / 4095 * 54 is 45.9956.
    expect(syncFloat(12, 54, 46)).toBe(45.99560546875)
    expect(syncFloat(12, 54, 54)).toBe(54)
    expect(syncFloat(12, 54, 0)).toBe(0)
    expect(syncFloat(1, 1, 0.99)).toBe(0)
  })

  it('with signs are truncated toward 0', () => {
    // -0.5 * 127 is -63.5.
    expect(syncSignedFloat(8, 1, -0.5)).toBe(Math.fround(-63 / 127))
    expect(syncSignedFloat(8, 1, 0.5)).toBe(Math.fround(63 / 127))
  })

  it('give positions in steps of 54 / 4095 and 69 / 4095 metres in their sectors', () => {
    expect(syncSector(100, 200, 30)).toEqual({
      sectorX: 513,
      sectorY: 515,
      sectorZ: 25,
      x: 45.99560546875,
      y: 37.9912109375,
      z: 4.987545967102051,
    })
    expect(fromSector(syncSector(100, 200, 30))).toEqual([
      99.99560546875, 199.9912109375, 29.987548828125,
    ])
  })

  it('give the headings of peds in 8 bits, which turn them up to 3 degrees less', () => {
    // A quarter of a turn is 31.75 of the 127 steps of a half turn.
    expect(radiansToDegrees(syncHeading(Math.fround(Math.PI / 2)))).toBe(87.87401580810547)
    expect(radiansToDegrees(syncHeading(Math.fround(-Math.PI / 2)))).toBe(-87.87401580810547)
    expect(syncHeading(Math.fround(Math.PI))).toBe(
      Math.fround(Math.fround(63 / 127) * Math.fround(6.28318548)),
    )
    expect(syncHeading(0)).toBe(0)
  })
})

describe('Compressed quaternions', () => {
  it('keep the smallest three components in 11 bits, rounded, and which one was largest', () => {
    // (0.6 + 1 / sqrt(2)) / sqrt(2) * 2047 + 0.5 is 1892.47, and 0 maps to the middle, 1024.
    expect(compressQuaternion(0, 0, 0.6, 0.8)).toEqual({ largest: 3, a: 1024, b: 1024, c: 1892 })
    // (-0.6 + 1 / sqrt(2)) / sqrt(2) * 2047 + 0.5 is 155.53.
    expect(compressQuaternion(0.8, 0, -0.6, 0)).toEqual({ largest: 0, a: 1024, b: 155, c: 1024 })
  })

  it('take the first of the largest components', () => {
    expect(compressQuaternion(0.5, 0.5, 0.5, 0.5).largest).toBe(0)
    expect(compressQuaternion(0, HALF, 0, HALF).largest).toBe(1)
  })

  it('flip the signs of all components when the largest is negative', () => {
    expect(compressQuaternion(0, 0, 0, -1)).toEqual(compressQuaternion(0, 0, 0, 1))
    expect(compressQuaternion(0, 0, 0.6, -0.8)).toEqual({ largest: 3, a: 1024, b: 1024, c: 155 })
  })

  it('come back with the largest component from the others', () => {
    // 1024 / 2047 * sqrt(2) - 1 / sqrt(2) is 0.000345, which the identity comes back with.
    const [x, y, z, w] = decompressQuaternion({ largest: 3, a: 1024, b: 1024, c: 1024 })
    expect([x, y, z]).toEqual([
      0.00034540891647338867, 0.00034540891647338867, 0.00034540891647338867,
    ])
    expect(w).toBe(0.9999998211860657)
    expect(decompressQuaternion(compressQuaternion(0, 0, 0.6, 0.8))).toEqual([
      0.00034540891647338867, 0.00034540891647338867, 0.6000216007232666, 0.7999836802482605,
    ])
  })

  it('put the largest component back where it was', () => {
    const [x, y, z, w] = decompressQuaternion(compressQuaternion(0.8, 0, -0.6, 0))
    expect(x).toBeCloseTo(0.8, 3)
    expect(y).toBeCloseTo(0, 3)
    expect(z).toBeCloseTo(-0.6, 3)
    expect(w).toBeCloseTo(0, 3)
  })
})

describe('Rotations', () => {
  it('of headings in degrees are about z, in single precision', () => {
    expect(headingQuaternion(90)).toEqual([0, 0, Math.fround(HALF), Math.fround(HALF)])
    // Single precision's half pi is a little more than half pi, whose cosine is a little less than 0.
    expect(headingQuaternion(180)).toEqual([0, 0, 1, -4.371138828673793e-8])
  })

  it('of quaternions are pitch, roll and yaw, as GTA V rotates in the order Z, X, Y', () => {
    expect(quaternionRotation(0, 0, 0, 1)).toEqual([0, 0, -0])
    expect(quaternionRotation(HALF, 0, 0, HALF)).toEqual([90, 0, -0])
    expect(quaternionRotation(0, HALF, 0, HALF)).toEqual([0, 90, -0])
    expect(quaternionRotation(0, 0, HALF, HALF)).toEqual([0, 0, 90])
    const [x, y, z] = quaternionRotation(...headingQuaternion(-45))
    expect([x, y]).toEqual([0, 0])
    expect(z).toBeCloseTo(-45, 4)
  })

  it('of quaternions undo rotations about z, then x, then y', () => {
    for (const [pitch, roll, yaw] of [
      [20, 10, 30],
      [-40, 150, -120],
      [75, -170, 5],
    ] as const) {
      const [x, y, z, w] = times(
        times(about(0, 0, 1, yaw), about(1, 0, 0, pitch)),
        about(0, 1, 0, roll),
      ) as [number, number, number, number]
      const rotation = quaternionRotation(x, y, z, w)
      expect(rotation[0]).toBeCloseTo(pitch, 3)
      expect(rotation[1]).toBeCloseTo(roll, 3)
      expect(rotation[2]).toBeCloseTo(yaw, 3)
    }
  })

  it('in radians turn into degrees by the single precision pi', () => {
    expect(radiansToDegrees(Math.fround(Math.PI / 2))).toBe(90)
    // 180 over Math.fround(Math.PI), which is a little more than pi.
    expect(radiansToDegrees(1)).toBe(57.2957763671875)
  })
})
