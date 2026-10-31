import { defineNative, type NativeDefinition, type Side } from '../../natives/index.ts'
import { localTime } from '../../scripting/time.ts'
import type { NativeContext } from '../context.ts'

/** How UPDATE_ONSCREEN_KEYBOARD tells that the player cancelled, as there is no keyboard to type on. */
const KEYBOARD_CANCELLED = 2

/** The screen of the game of FiveRunner's clients. */
const SCREEN_WIDTH = 1920
const SCREEN_HEIGHT = 1080

const toRadians = (degrees: number) => (degrees * Math.PI) / 180
const toDegrees = (radians: number) => (radians * 180) / Math.PI

/** The heading of a direction, as GTA V counts them: from north, anticlockwise, from 0 to 360. */
function headingOf(dx: number, dy: number): number {
  return (toDegrees(Math.atan2(-dx, dy)) + 360) % 360
}

/** Natives of GTA V's arithmetic, its time and its random numbers, which only clients have. */
export function miscNatives(side: Side): NativeDefinition<NativeContext>[] {
  if (side === 'server') return []
  return [
    // GTA V draws random numbers that a seed sets; FiveRunner's start the same on every run.
    defineNative(
      {
        name: 'GET_RANDOM_INT_IN_RANGE',
        hash: 0xd53343aa4fb7dd28n,
        result: 'int',
        params: ['int startRange', 'int endRange'],
      },
      (ctx: NativeContext, start, end) =>
        start + Math.floor(ctx.manager.world!.random() * (end - start)),
    ),
    defineNative(
      {
        name: 'GET_RANDOM_FLOAT_IN_RANGE',
        hash: 0x313ce5879ceb6fcdn,
        result: 'float',
        params: ['float startRange', 'float endRange'],
      },
      (ctx: NativeContext, start, end) => start + ctx.manager.world!.random() * (end - start),
    ),
    defineNative(
      { name: 'SET_RANDOM_SEED', hash: 0x444d98f98c11f3ecn, result: 'void', params: ['int seed'] },
      (ctx: NativeContext, seed) => ctx.manager.world!.seedRandom(seed),
    ),
    // Angles are in degrees, as in GTA V.
    ...(
      [
        ['ABSF', 0x73d57cffdd12c355n, Math.abs],
        ['SQRT', 0x71d93b57d07f9804n, Math.sqrt],
        ['COS', 0xd0ffb162f40a139cn, (value: number) => Math.cos(toRadians(value))],
        ['SIN', 0x0badbfa3b172435fn, (value: number) => Math.sin(toRadians(value))],
        ['TAN', 0x632106cc96e82e91n, (value: number) => Math.tan(toRadians(value))],
        ['ACOS', 0x1d08b970013c34b6n, (value: number) => toDegrees(Math.acos(value))],
        ['ASIN', 0xc843060b5765dce7n, (value: number) => toDegrees(Math.asin(value))],
        ['ATAN', 0xa9d1795cd5043663n, (value: number) => toDegrees(Math.atan(value))],
      ] as const
    ).map(([name, hash, of]) =>
      defineNative({ name, hash, result: 'float', params: ['float value'] }, (_ctx, value) =>
        of(value),
      ),
    ),
    ...(
      [
        ['FLOOR', 0xf34ee736cf047844n, Math.floor],
        ['CEIL', 0x11e019c8f43acc8an, Math.ceil],
        // Halves go away from zero, where Math.round takes them up.
        ['ROUND', 0xf2db717a73826179n, (x: number) => Math.sign(x) * Math.round(Math.abs(x))],
      ] as const
    ).map(([name, hash, of]) =>
      defineNative({ name, hash, result: 'int', params: ['float value'] }, (_ctx, value) =>
        of(value),
      ),
    ),
    defineNative(
      { name: 'ABSI', hash: 0xf0d31ad191a74f87n, result: 'int', params: ['int value'] },
      (_ctx, value) => Math.abs(value),
    ),
    defineNative(
      {
        name: 'ATAN2',
        hash: 0x8927cbf9d22261a4n,
        result: 'float',
        params: ['float p0', 'float p1'],
      },
      (_ctx, y, x) => toDegrees(Math.atan2(y, x)),
    ),
    defineNative(
      {
        name: 'POW',
        hash: 0xe3621cc40f31fe2en,
        result: 'float',
        params: ['float base', 'float exponent'],
      },
      (_ctx, base, exponent) => base ** exponent,
    ),
    defineNative(
      {
        name: 'SHIFT_LEFT',
        hash: 0xedd95a39e5544de8n,
        result: 'int',
        params: ['int value', 'int bitShift'],
      },
      (_ctx, value, shift) => value << shift,
    ),
    defineNative(
      {
        name: 'SHIFT_RIGHT',
        hash: 0x97ef1e5bce9dc075n,
        result: 'int',
        params: ['int value', 'int bitShift'],
      },
      (_ctx, value, shift) => value >> shift,
    ),
    ...(
      [
        ['VDIST', 0x2a488c176d52cca5n, (d: number) => Math.sqrt(d)],
        ['VDIST2', 0xb7a628320eff8e47n, (d: number) => d],
      ] as const
    ).map(([name, hash, of]) =>
      defineNative(
        {
          name,
          hash,
          result: 'float',
          params: ['float x1', 'float y1', 'float z1', 'float x2', 'float y2', 'float z2'],
        },
        (_ctx, x1, y1, z1, x2, y2, z2) => of((x2 - x1) ** 2 + (y2 - y1) ** 2 + (z2 - z1) ** 2),
      ),
    ),
    ...(
      [
        ['VMAG', 0x652d2eeef1d3e62cn, (d: number) => Math.sqrt(d)],
        ['VMAG2', 0xa8ceacb4f35ae058n, (d: number) => d],
      ] as const
    ).map(([name, hash, of]) =>
      defineNative(
        { name, hash, result: 'float', params: ['float x', 'float y', 'float z'] },
        (_ctx, x, y, z) => of(x ** 2 + y ** 2 + z ** 2),
      ),
    ),
    defineNative(
      {
        name: 'GET_DISTANCE_BETWEEN_COORDS',
        hash: 0xf1b760881820c952n,
        result: 'float',
        params: [
          'float x1',
          'float y1',
          'float z1',
          'float x2',
          'float y2',
          'float z2',
          'BOOL useZ',
        ],
      },
      (_ctx, x1, y1, z1, x2, y2, z2, useZ) => Math.hypot(x2 - x1, y2 - y1, useZ ? z2 - z1 : 0),
    ),
    defineNative(
      {
        name: 'GET_ANGLE_BETWEEN_2D_VECTORS',
        hash: 0x186fc4be848e1c92n,
        result: 'float',
        params: ['float x1', 'float y1', 'float x2', 'float y2'],
      },
      (_ctx, x1, y1, x2, y2) => {
        const lengths = Math.hypot(x1, y1) * Math.hypot(x2, y2)
        return lengths === 0 ? 0 : toDegrees(Math.acos((x1 * x2 + y1 * y2) / lengths))
      },
    ),
    defineNative(
      {
        name: 'GET_HEADING_FROM_VECTOR_2D',
        hash: 0x2ffb6b224f4b2926n,
        result: 'float',
        params: ['float dx', 'float dy'],
      },
      (_ctx, dx, dy) => headingOf(dx, dy),
    ),
    // Time.
    defineNative(
      {
        name: 'GET_LOCAL_TIME',
        hash: 0x50c7a99057a69748n,
        result: 'void',
        params: ['int* year', 'int* month', 'int* day', 'int* hour', 'int* minute', 'int* second'],
      },
      (ctx: NativeContext, year, month, day, hour, minute, second) => {
        const seconds = Math.floor(ctx.manager.wallClock() / 1000)
        const time = localTime(seconds, ctx.manager.timeZone)
        if (time === undefined) return
        year.set(time.year)
        month.set(time.mon + 1)
        day.set(time.mday)
        hour.set(time.hour)
        minute.set(time.min)
        second.set(time.sec)
      },
    ),
    defineNative(
      { name: 'GET_NETWORK_TIME', hash: 0x7a5487fe9faa6b48n, result: 'int', params: [] },
      (ctx: NativeContext) => Math.trunc(ctx.manager.time()) | 0,
    ),
    defineNative(
      {
        name: 'GET_TIME_DIFFERENCE',
        hash: 0xa2c6fc031d46fff0n,
        result: 'int',
        params: ['int timeA', 'int timeB'],
      },
      (_ctx, timeA, timeB) => timeA - timeB,
    ),
    defineNative(
      {
        name: 'GET_TIME_OFFSET',
        hash: 0x017008ccdad48503n,
        result: 'int',
        params: ['int timeA', 'int timeB'],
      },
      (_ctx, timeA, timeB) => timeA + timeB,
    ),
    // The screen, and the keyboard of the game, which scripts draw for players: there are none.
    defineNative(
      {
        name: 'GET_ACTUAL_SCREEN_RESOLUTION',
        hash: 0x873c9f3104101dd3n,
        result: 'void',
        params: ['int* x', 'int* y'],
      },
      (_ctx, x, y) => {
        x.set(SCREEN_WIDTH)
        y.set(SCREEN_HEIGHT)
      },
    ),
    defineNative(
      { name: 'UPDATE_ONSCREEN_KEYBOARD', hash: 0x0cf2b696bbf945aen, result: 'int', params: [] },
      () => KEYBOARD_CANCELLED,
    ),
  ]
}
