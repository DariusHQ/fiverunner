import { defineNative, type NativeDefinition } from '../../natives/index.ts'
import type { NativeContext } from '../context.ts'
import type { Nui } from '../nui.ts'
import { checkArgument } from './events.ts'

/** The NUI of the client whose script calls a native. */
function nuiOf(ctx: NativeContext): Nui {
  return ctx.manager.nui!
}

/** Natives of FiveM's NUI resources component, which clients have. */
export function nuiNatives(): NativeDefinition<NativeContext>[] {
  return [
    defineNative(
      { name: 'SEND_NUI_MESSAGE', result: 'BOOL', params: ['bytes jsonString'] },
      (ctx: NativeContext, json) => nuiOf(ctx).send(ctx.resource, json),
    ),
    defineNative(
      { name: 'SEND_LOADING_SCREEN_MESSAGE', result: 'BOOL', params: ['char* jsonString'] },
      (ctx: NativeContext) => {
        // FiveRunner's clients have no loading screens: they shut them down as they join.
        ctx.manager.trace(
          'nui-resources',
          'SEND_LOADING_SCREEN_MESSAGE called while the loading screen was shut down\n',
        )
        return false
      },
    ),
    defineNative(
      {
        name: 'REGISTER_NUI_CALLBACK',
        result: 'void',
        params: ['char* callbackType', 'func callback'],
      },
      (ctx: NativeContext, type, callback) => {
        const name = checkArgument(type, 0)
        const ref = checkArgument(callback, 1)
        nuiOf(ctx).register(ctx.resource, name, { kind: 'function', ref })
      },
    ),
    defineNative(
      { name: 'REGISTER_NUI_CALLBACK_TYPE', result: 'void', params: ['char* callbackType'] },
      (ctx: NativeContext, type) => {
        nuiOf(ctx).register(ctx.resource, checkArgument(type, 0), { kind: 'event' })
      },
    ),
    defineNative(
      {
        name: 'REGISTER_RAW_NUI_CALLBACK',
        result: 'void',
        params: ['char* callbackType', 'func callback'],
      },
      (ctx: NativeContext, type, callback) => {
        const name = checkArgument(type, 0)
        const ref = checkArgument(callback, 1)
        nuiOf(ctx).register(ctx.resource, name, { kind: 'raw', ref })
      },
    ),
    defineNative(
      { name: 'UNREGISTER_RAW_NUI_CALLBACK', result: 'void', params: ['char* callbackType'] },
      (ctx: NativeContext, type) => {
        nuiOf(ctx).unregister(ctx.resource, checkArgument(type, 0))
      },
    ),
    defineNative(
      { name: 'SET_NUI_FOCUS', result: 'void', params: ['BOOL hasFocus', 'BOOL hasCursor'] },
      (ctx: NativeContext, focus, cursor) => {
        nuiOf(ctx).setFocus(ctx.resource, focus, cursor)
      },
    ),
    defineNative(
      { name: 'SET_NUI_FOCUS_KEEP_INPUT', result: 'void', params: ['BOOL keepInput'] },
      (ctx: NativeContext, keep) => {
        nuiOf(ctx).setKeepInput(ctx.resource, keep)
      },
    ),
    defineNative({ name: 'IS_NUI_FOCUSED', result: 'BOOL', params: [] }, (ctx: NativeContext) => {
      return nuiOf(ctx).focused
    }),
    defineNative(
      { name: 'IS_NUI_FOCUS_KEEPING_INPUT', result: 'BOOL', params: [] },
      (ctx: NativeContext) => nuiOf(ctx).keepingInput,
    ),
    defineNative(
      { name: 'SET_NUI_ZINDEX', result: 'void', params: ['int zIndex'] },
      (ctx: NativeContext, zIndex) => {
        nuiOf(ctx).setZIndex(ctx.resource, zIndex)
      },
    ),
    defineNative(
      { name: 'GET_NUI_CURSOR_POSITION', result: 'void', params: ['int* x', 'int* y'] },
      (ctx: NativeContext, x, y) => {
        const { cursor } = nuiOf(ctx)
        x.set(cursor.x)
        y.set(cursor.y)
      },
    ),
  ]
}
