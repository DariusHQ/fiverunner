import { defineNative, type NativeDefinition, type Side } from '../../natives/index.ts'
import type { NativeContext } from '../context.ts'
import { nothing } from './game.ts'

/**
 * Natives of the voice chat of clients, which FiveM's clients talk on to a
 * Mumble server. FiveRunner has none, so its clients connect to none, and
 * these do what FiveM's do unconnected: nothing, and give zero values, so
 * nobody talks.
 */
export function voiceNatives(side: Side): NativeDefinition<NativeContext>[] {
  if (side === 'server') return []
  return [
    defineNative({ name: 'MUMBLE_IS_CONNECTED', result: 'BOOL', params: [] }, () => false),
    defineNative(
      { name: 'MUMBLE_IS_PLAYER_TALKING', result: 'BOOL', params: ['Player player'] },
      () => false,
    ),
    defineNative(
      {
        name: 'NETWORK_IS_PLAYER_TALKING',
        hash: 0x031e11f3d447647en,
        result: 'BOOL',
        params: ['Player player'],
      },
      () => false,
    ),
    defineNative({ name: 'MUMBLE_GET_TALKER_PROXIMITY', result: 'float', params: [] }, () => 0),
    defineNative(
      { name: 'MUMBLE_GET_VOICE_CHANNEL_FROM_SERVER_ID', result: 'int', params: ['int serverId'] },
      () => 0,
    ),
    nothing('MUMBLE_SET_TALKER_PROXIMITY', undefined, ['float value']),
    nothing('MUMBLE_SET_SERVER_ADDRESS', undefined, ['char* address', 'int port']),
    nothing('MUMBLE_SET_AUDIO_INPUT_INTENT', undefined, ['Hash intentHash']),
    nothing('MUMBLE_SET_VOICE_CHANNEL', undefined, ['int channel']),
    nothing('MUMBLE_SET_VOICE_TARGET', undefined, ['int targetId']),
    nothing('MUMBLE_CLEAR_VOICE_TARGET', undefined, ['int targetId']),
    nothing('MUMBLE_CLEAR_VOICE_TARGET_CHANNELS', undefined, ['int targetId']),
    nothing('MUMBLE_CLEAR_VOICE_TARGET_PLAYERS', undefined, ['int targetId']),
    nothing('MUMBLE_ADD_VOICE_TARGET_CHANNEL', undefined, ['int targetId', 'int channel']),
    nothing('MUMBLE_ADD_VOICE_TARGET_PLAYER_BY_SERVER_ID', undefined, [
      'int targetId',
      'int serverId',
    ]),
    nothing('MUMBLE_ADD_VOICE_CHANNEL_LISTEN', undefined, ['int channel']),
    nothing('MUMBLE_REMOVE_VOICE_CHANNEL_LISTEN', undefined, ['int channel']),
    nothing('MUMBLE_SET_VOLUME_OVERRIDE_BY_SERVER_ID', undefined, ['int serverId', 'float volume']),
    nothing('MUMBLE_SET_SUBMIX_FOR_SERVER_ID', undefined, ['int serverId', 'int submixId']),
  ]
}
