import { defineNative, type NativeDefinition, type Side } from '../../natives/index.ts'
import type { NativeContext } from '../context.ts'
import type { ScreenFade } from '../world/screen.ts'

/** The fade of the screen of the game of the client whose script calls a native. */
function screenOf(ctx: NativeContext): ScreenFade {
  return ctx.manager.world!.screen
}

/** Natives of the fades of the screens of clients, which only clients have. */
export function screenNatives(side: Side): NativeDefinition<NativeContext>[] {
  if (side === 'server') return []
  /** How faded the screen of the client of a native is now. */
  const level = (ctx: NativeContext) => screenOf(ctx).level(ctx.manager.time())
  return [
    defineNative(
      {
        name: 'DO_SCREEN_FADE_OUT',
        hash: 0x891b5b39ac6302afn,
        result: 'void',
        params: ['int duration'],
      },
      (ctx: NativeContext, duration) => screenOf(ctx).fade(1, duration, ctx.manager.time()),
    ),
    defineNative(
      {
        name: 'DO_SCREEN_FADE_IN',
        hash: 0xd4e8e24955024033n,
        result: 'void',
        params: ['int duration'],
      },
      (ctx: NativeContext, duration) => screenOf(ctx).fade(0, duration, ctx.manager.time()),
    ),
    defineNative(
      { name: 'IS_SCREEN_FADED_OUT', hash: 0xb16fce9ddc7ba182n, result: 'BOOL', params: [] },
      (ctx: NativeContext) => screenOf(ctx).fadesTo(1) && level(ctx) === 1,
    ),
    defineNative(
      { name: 'IS_SCREEN_FADED_IN', hash: 0x5a859503b0c08678n, result: 'BOOL', params: [] },
      (ctx: NativeContext) => screenOf(ctx).fadesTo(0) && level(ctx) === 0,
    ),
    defineNative(
      { name: 'IS_SCREEN_FADING_OUT', hash: 0x797ac7cb535ba28fn, result: 'BOOL', params: [] },
      (ctx: NativeContext) => screenOf(ctx).fadesTo(1) && level(ctx) < 1,
    ),
    defineNative(
      { name: 'IS_SCREEN_FADING_IN', hash: 0x5c544bc6c57ac575n, result: 'BOOL', params: [] },
      (ctx: NativeContext) => screenOf(ctx).fadesTo(0) && level(ctx) > 0,
    ),
  ]
}
