import { defineNative, hashString, type NativeDefinition, type Side } from '../../natives/index.ts'
import type { NativeContext } from '../context.ts'
import type { GameClock, Weather } from '../world/weather.ts'

/** The clock of the game of the client whose script calls a native. */
function clockOf(ctx: NativeContext): GameClock {
  return ctx.manager.world!.clock
}

/** The weather of the game of the client whose script calls a native. */
function weatherOf(ctx: NativeContext): Weather {
  return ctx.manager.world!.weather
}

/** Natives of the time of day and of the weather of the games of clients, which only clients have. */
export function weatherNatives(side: Side): NativeDefinition<NativeContext>[] {
  if (side === 'server') return []
  /** A native that sets the time of day, as `then` sets the clock after. */
  const setTime = (name: string, hash: bigint, then: (clock: GameClock) => void = () => {}) =>
    defineNative(
      { name, hash, result: 'void', params: ['int hours', 'int minutes', 'int seconds'] },
      (ctx: NativeContext, hours, minutes, seconds) => {
        clockOf(ctx).set(hours, minutes, seconds, ctx.manager.time())
        then(clockOf(ctx))
      },
    )
  /** A native that gives a part of the time of day, of `unit` seconds out of `of`. */
  const getTime = (name: string, hash: bigint, unit: number, of: number) =>
    defineNative(
      { name, hash, result: 'int', params: [] },
      (ctx: NativeContext) => Math.floor(clockOf(ctx).seconds(ctx.manager.time()) / unit) % of,
    )
  /** Turns the weather of a client to a type of a name over `seconds`, if the name is one. */
  const turn = (ctx: NativeContext, type: string | null, seconds: number) => {
    if (type) weatherOf(ctx).turn(hashString(type), seconds * 1000, ctx.manager.time())
  }
  /** A native that turns the weather to the type it is given at once. */
  const turnNow = (name: string, hash: bigint) =>
    defineNative(
      { name, hash, result: 'void', params: ['char* weatherType'] },
      (ctx: NativeContext, type) => turn(ctx, type, 0),
    )
  return [
    setTime('NETWORK_OVERRIDE_CLOCK_TIME', 0xe679e3e06e363892n, (clock) => {
      clock.overridden = true
    }),
    setTime('SET_CLOCK_TIME', 0x47c3b5848c3e45d8n),
    // There are no dates for the clock to move through.
    setTime('ADVANCE_CLOCK_TIME_TO', 0xc8ca9670b9d83b3bn),
    defineNative(
      {
        name: 'ADD_TO_CLOCK_TIME',
        hash: 0xd716f30d8c8980e2n,
        result: 'void',
        params: ['int hours', 'int minutes', 'int seconds'],
      },
      (ctx: NativeContext, hours, minutes, seconds) =>
        clockOf(ctx).add(hours, minutes, seconds, ctx.manager.time()),
    ),
    defineNative(
      {
        name: 'NETWORK_CLEAR_CLOCK_TIME_OVERRIDE',
        hash: 0xd972df67326f966en,
        result: 'void',
        params: [],
      },
      (ctx: NativeContext) => {
        clockOf(ctx).overridden = false
      },
    ),
    defineNative(
      {
        name: 'NETWORK_IS_CLOCK_TIME_OVERRIDDEN',
        hash: 0xd7c95d322ff57522n,
        result: 'BOOL',
        params: [],
      },
      (ctx: NativeContext) => clockOf(ctx).overridden,
    ),
    defineNative(
      { name: 'PAUSE_CLOCK', hash: 0x4055e40bd2dbec1dn, result: 'void', params: ['BOOL toggle'] },
      (ctx: NativeContext, paused) => clockOf(ctx).pause(paused, ctx.manager.time()),
    ),
    defineNative(
      {
        name: 'NETWORK_OVERRIDE_CLOCK_MILLISECONDS_PER_GAME_MINUTE',
        result: 'void',
        params: ['int ms'],
      },
      (ctx: NativeContext, ms) => clockOf(ctx).setMsPerMinute(ms, ctx.manager.time()),
    ),
    defineNative(
      {
        name: 'GET_MILLISECONDS_PER_GAME_MINUTE',
        hash: 0x2f8b4d1c595b11dbn,
        result: 'int',
        params: [],
      },
      (ctx: NativeContext) => clockOf(ctx).msPerMinute,
    ),
    getTime('GET_CLOCK_HOURS', 0x25223ca6b4d20b7fn, 3600, 24),
    getTime('GET_CLOCK_MINUTES', 0x13d2b8add79640f2n, 60, 60),
    getTime('GET_CLOCK_SECONDS', 0x494e97c2ef27c470n, 1, 60),
    turnNow('SET_WEATHER_TYPE_NOW_PERSIST', 0xed712ca327900c8an),
    turnNow('SET_WEATHER_TYPE_NOW', 0x29b487c359e19889n),
    turnNow('SET_WEATHER_TYPE_PERSIST', 0x704983df373b198fn),
    defineNative(
      {
        name: 'SET_WEATHER_TYPE_OVERTIME_PERSIST',
        hash: 0xfb5045b7c42b75bfn,
        result: 'void',
        params: ['char* weatherType', 'float time'],
      },
      (ctx: NativeContext, type, time) => turn(ctx, type, time),
    ),
    // There is no cycle of weathers to go back to.
    defineNative(
      { name: 'CLEAR_WEATHER_TYPE_PERSIST', hash: 0xccc39339bef76cf5n, result: 'void', params: [] },
      () => {},
    ),
    defineNative(
      {
        name: 'SET_OVERRIDE_WEATHER',
        hash: 0xa43d5c6fe51adbefn,
        result: 'void',
        params: ['char* weatherType'],
      },
      (ctx: NativeContext, type) => {
        if (type) weatherOf(ctx).override = hashString(type)
      },
    ),
    defineNative(
      { name: 'CLEAR_OVERRIDE_WEATHER', hash: 0x338d2e3477711050n, result: 'void', params: [] },
      (ctx: NativeContext) => {
        weatherOf(ctx).override = undefined
      },
    ),
    defineNative(
      {
        name: 'GET_PREV_WEATHER_TYPE_HASH_NAME',
        hash: 0x564b884a05ec45a3n,
        result: 'Hash',
        params: [],
      },
      (ctx: NativeContext) => weatherOf(ctx).previous(ctx.manager.time()),
    ),
    defineNative(
      {
        name: 'GET_NEXT_WEATHER_TYPE_HASH_NAME',
        hash: 0x711327cd09c8f162n,
        result: 'Hash',
        params: [],
      },
      (ctx: NativeContext) => weatherOf(ctx).next,
    ),
    defineNative(
      {
        name: 'IS_PREV_WEATHER_TYPE',
        hash: 0x44f28f86433b10a9n,
        result: 'BOOL',
        params: ['char* weatherType'],
      },
      (ctx: NativeContext, type) =>
        hashString(type ?? '') === weatherOf(ctx).previous(ctx.manager.time()),
    ),
    defineNative(
      {
        name: 'IS_NEXT_WEATHER_TYPE',
        hash: 0x2faa3a30bec0f25dn,
        result: 'BOOL',
        params: ['char* weatherType'],
      },
      (ctx: NativeContext, type) => hashString(type ?? '') === weatherOf(ctx).next,
    ),
  ]
}
