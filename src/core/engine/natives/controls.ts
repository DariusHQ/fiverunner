import { defineNative, type NativeDefinition, type Side } from '../../natives/index.ts'
import type { NativeContext } from '../context.ts'
import type { Input } from '../world/input.ts'

/** The input of the game of the client whose script calls a native. */
function inputOf(ctx: NativeContext): Input {
  return ctx.manager.world!.input
}

/** Natives of the controls of the games of clients, and of the keys that resources bind commands to, which only clients have. */
export function controlNatives(side: Side): NativeDefinition<NativeContext>[] {
  if (side === 'server') return []
  /** A native that tells of a control, as `test` does, whatever the index of its pad is. */
  const control = (name: string, hash: bigint, test: (input: Input, control: number) => boolean) =>
    defineNative(
      { name, hash, result: 'BOOL', params: ['int padIndex', 'int control'] },
      (ctx: NativeContext, _pad, action) => test(inputOf(ctx), action),
    )
  return [
    // Players bind no keys of their own, so controls show the button of no key.
    defineNative(
      {
        name: 'GET_CONTROL_INSTRUCTIONAL_BUTTON',
        hash: 0x0499d7b09fc9b407n,
        result: 'char*',
        params: ['int padIndex', 'int control', 'BOOL p2'],
      },
      () => '',
    ),
    defineNative(
      {
        name: 'REGISTER_KEY_MAPPING',
        result: 'void',
        params: [
          'char* commandString',
          'char* description',
          'char* defaultMapper',
          'char* defaultParameter',
        ],
      },
      (ctx: NativeContext, command, description, mapper, key) =>
        inputOf(ctx).map(command ?? '', description ?? '', mapper ?? '', key ?? ''),
    ),
    control('IS_CONTROL_PRESSED', 0xf3a21bcd95725a4an, (input, action) =>
      input.pressed(action, false),
    ),
    control('IS_DISABLED_CONTROL_PRESSED', 0xe2587f8cbbd87b1dn, (input, action) =>
      input.pressed(action, true),
    ),
    // Disabled controls are released.
    control(
      'IS_CONTROL_RELEASED',
      0x648ee3e7f38877ddn,
      (input, action) => !input.pressed(action, false),
    ),
    control(
      'IS_DISABLED_CONTROL_RELEASED',
      0xfb6c4072e9a32e92n,
      (input, action) => !input.pressed(action, true),
    ),
    control('IS_CONTROL_JUST_PRESSED', 0x580417101ddb492fn, (input, action) =>
      input.justPressed(action, false),
    ),
    control('IS_DISABLED_CONTROL_JUST_PRESSED', 0x91aef906bca88877n, (input, action) =>
      input.justPressed(action, true),
    ),
    control('IS_CONTROL_JUST_RELEASED', 0x50f940259d3841e6n, (input, action) =>
      input.justReleased(action, false),
    ),
    control('IS_DISABLED_CONTROL_JUST_RELEASED', 0x305c8dcd79da8b0fn, (input, action) =>
      input.justReleased(action, true),
    ),
    control('IS_CONTROL_ENABLED', 0x1cea6bfdf248e5d9n, (input, action) => input.enabled(action)),
    ...(
      [
        ['GET_CONTROL_NORMAL', 0xec3c9b8d5327b563n, false],
        ['GET_DISABLED_CONTROL_NORMAL', 0x11e65974a982637cn, true],
      ] as const
    ).map(([name, hash, disabled]) =>
      defineNative(
        { name, hash, result: 'float', params: ['int padIndex', 'int control'] },
        (ctx: NativeContext, _pad, action) => inputOf(ctx).normal(action, disabled),
      ),
    ),
    defineNative(
      {
        name: 'DISABLE_CONTROL_ACTION',
        hash: 0xfe99b66d079cf6bcn,
        result: 'void',
        params: ['int padIndex', 'int control', 'BOOL disableRelatedActions'],
      },
      (ctx: NativeContext, _pad, action) => inputOf(ctx).disable(action),
    ),
    defineNative(
      {
        name: 'ENABLE_CONTROL_ACTION',
        hash: 0x351220255d64c155n,
        result: 'void',
        params: ['int padIndex', 'int control', 'BOOL enableRelatedActions'],
      },
      (ctx: NativeContext, _pad, action) => inputOf(ctx).enable(action),
    ),
    defineNative(
      {
        name: 'DISABLE_ALL_CONTROL_ACTIONS',
        hash: 0x5f4b6931816e599bn,
        result: 'void',
        params: ['int padIndex'],
      },
      (ctx: NativeContext) => inputOf(ctx).disableAll(),
    ),
    defineNative(
      {
        name: 'ENABLE_ALL_CONTROL_ACTIONS',
        hash: 0xa5ffe9b05f199de7n,
        result: 'void',
        params: ['int padIndex'],
      },
      (ctx: NativeContext) => inputOf(ctx).enableAll(),
    ),
    // The players of FiveRunner have a keyboard and a mouse, and no pad.
    defineNative(
      {
        name: 'IS_USING_KEYBOARD',
        hash: 0xa571d46727e2b718n,
        result: 'BOOL',
        params: ['int padIndex'],
        aliases: ['IS_USING_KEYBOARD_AND_MOUSE'],
      },
      () => true,
    ),
  ]
}
