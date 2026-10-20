import { describe, expect, it } from 'vitest'

import { Extension, pack, packObject, type MsgpackObject } from '../../src/core/engine/msgpack.ts'
import { describe as describeObject, describeArgs, describeValue } from '../../src/dev/values.ts'

const encoder = new TextEncoder()

/** The bytes of a float32 extension of CfxLua's, of `type`, with `parts`. */
function vector(type: number, parts: number[]): Uint8Array {
  const data = new Uint8Array(parts.length * 4)
  parts.forEach((part, index) => new DataView(data.buffer).setFloat32(index * 4, part, true))
  return packObject({ type: 'ext', extension: new Extension(type, data) })
}

describe('Descriptions of values', () => {
  it('write values as Lua code would', () => {
    const map: MsgpackObject = {
      type: 'map',
      entries: [
        [
          { type: 'str', bytes: encoder.encode('name') },
          { type: 'str', bytes: encoder.encode('Ann "A"') },
        ],
        [
          { type: 'str', bytes: encoder.encode('two words') },
          { type: 'boolean', value: true },
        ],
        [{ type: 'positive', value: 1n }, { type: 'nil' }],
        [
          { type: 'str', bytes: encoder.encode('_x1') },
          { type: 'map', entries: [] },
        ],
      ],
    }
    expect([
      describeObject(map),
      describeObject({
        type: 'array',
        items: [
          { type: 'negative', value: -3n },
          { type: 'float64', value: 1 },
        ],
      }),
      describeObject({ type: 'array', items: [] }),
      describeObject({ type: 'float64', value: 0.5 }),
      describeObject({ type: 'float64', value: 1e21 }),
      describeObject({ type: 'float64', value: Number.NaN }),
      describeObject({ type: 'float64', value: Infinity }),
      describeObject({ type: 'float64', value: -Infinity }),
      describeObject({ type: 'float32', value: 0.10000000149011612 }),
      describeObject({ type: 'bin', bytes: new Uint8Array(3) }),
      describeObject({ type: 'boolean', value: false }),
    ]).toEqual([
      '{ [1] = nil, _x1 = {}, name = "Ann \\"A\\"", ["two words"] = true }',
      '{ -3, 1.0 }',
      '{}',
      '0.5',
      '1e+21',
      'nan',
      'inf',
      '-inf',
      '0.1',
      '<3 bytes>',
      'false',
    ])
  })

  it('write the keys of maps in an order of their own, as Lua makes no promise of one', () => {
    const str = (text: string): MsgpackObject => ({ type: 'str', bytes: encoder.encode(text) })
    const value: MsgpackObject = { type: 'nil' }
    const keys: MsgpackObject[] = [
      str('b'),
      { type: 'positive', value: 10n },
      { type: 'boolean', value: true },
      str('ab'),
      { type: 'negative', value: -1n },
      str('a'),
      { type: 'positive', value: 2n },
      { type: 'boolean', value: false },
      { type: 'positive', value: 2n },
      str('a#'),
      str('a"'),
    ]
    expect(describeObject({ type: 'map', entries: keys.map((key) => [key, value]) })).toBe(
      '{ [-1] = nil, [2] = nil, [2] = nil, [10] = nil, a = nil, ["a\\""] = nil, ["a#"] = nil, ab = nil, b = nil, [false] = nil, [true] = nil }',
    )
  })

  it('write the vectors and quaternions of CfxLua as their constructors, and references to functions as such', () => {
    const extension = (type: number, data: Uint8Array) =>
      packObject({ type: 'ext', extension: new Extension(type, data) })
    expect(
      [
        vector(20, [0.1, 2.5]),
        vector(21, [1, 2, 3]),
        vector(22, [1, 2, 3, 4]),
        vector(23, [0, 0, 0, 1]),
        extension(10, encoder.encode('bank:1:0')),
        extension(11, encoder.encode('x')),
        extension(21, new Uint8Array(3)),
        extension(42, new Uint8Array(4)),
      ].map(describeValue),
    ).toEqual([
      'vec2(0.1, 2.5)',
      'vec3(1.0, 2.0, 3.0)',
      'vec4(1.0, 2.0, 3.0, 4.0)',
      'quat(1.0, 0.0, 0.0, 0.0)',
      '<function>',
      '<function>',
      '<extension 21>',
      '<extension 42>',
    ])
  })

  it('write the arguments of events, and cut what runs long', () => {
    const long = 'x'.repeat(2000)
    expect([
      describeArgs(pack([100, 'cash', [1, 2]])),
      describeArgs(new Uint8Array()),
      describeArgs(pack([])),
      describeArgs(pack('one')),
      describeArgs(new Uint8Array([0xc1])),
      describeValue(new Uint8Array([0xc1])),
      describeValue(pack(long)).length,
      describeValue(pack('x'.repeat(999))).length,
      describeValue(pack('x'.repeat(998))).length,
      describeArgs(pack([long])).endsWith('...'),
    ]).toEqual([
      '100, "cash", { 1, 2 }',
      '',
      '',
      '"one"',
      '<no msgpack>',
      '<no msgpack>',
      1003,
      1003,
      1000,
      true,
    ])
  })
})
