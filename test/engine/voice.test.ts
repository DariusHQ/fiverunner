import { describe, expect, it } from 'vitest'

import { clientOf } from './helpers.ts'

describe('The voice chat of clients', () => {
  it('connects to no Mumble server, so its natives do nothing, and nobody talks', async () => {
    const { run, client } = await clientOf()
    expect(
      run(`MumbleSetServerAddress('127.0.0.1', 64738)
MumbleSetTalkerProximity(3.5)
MumbleSetAudioInputIntent(GetHashKey('speech'))
MumbleSetVoiceTarget(1)
MumbleClearVoiceTarget(1)
MumbleAddVoiceTargetChannel(1, 2)
MumbleSetVolumeOverrideByServerId(1, 0.5)
print(MumbleIsConnected(), MumbleGetTalkerProximity(), MumbleIsPlayerTalking(PlayerId()), NetworkIsPlayerTalking(PlayerId()), MumbleGetVoiceChannelFromServerId(1))`),
    ).toEqual(['false\t0.0\tfalse\tfalse\t0'])
    expect(client.diagnostics).toEqual([])
  })
})
