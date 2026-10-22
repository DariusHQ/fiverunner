import { defineNative, type NativeDefinition, type Side } from '../../natives/index.ts'
import type { NativeContext } from '../context.ts'

/** Natives of the controls of the games of clients, which only clients have. */
export function controlNatives(side: Side): NativeDefinition<NativeContext>[] {
  if (side === 'server') return []
  return [
    // FiveRunner knows no key bindings, so controls show the button of no key.
    defineNative(
      {
        name: 'GET_CONTROL_INSTRUCTIONAL_BUTTON',
        hash: 0x0499d7b09fc9b407n,
        result: 'char*',
        params: ['int padIndex', 'int control', 'BOOL p2'],
      },
      () => '',
    ),
  ]
}
