import { describe, expect, it } from 'vitest'

import { clientOf } from './helpers.ts'

describe('The cameras of clients', () => {
  it('are those that scripts create, of which the active one that became active last renders once scripts render theirs', async () => {
    const test = await clientOf()
    const lines =
      test.run(`cam = CreateCamWithParams('DEFAULT_SCRIPTED_CAMERA', 1.0, 2.0, 3.0, -10.0, 0.0, 90.0, 60.0, false, 2)
print(DoesCamExist(cam), IsCamActive(cam), IsCamRendering(cam), GetRenderingCam(), GetCamCoord(cam), GetCamRot(cam, 2), GetCamFov(cam))
SetCamActive(cam, true)
RenderScriptCams(true, false, 1, true, true)
print(IsCamActive(cam), IsCamRendering(cam), GetRenderingCam() == cam, GetFinalRenderedCamCoord(), GetFinalRenderedCamRot(2))
local other = CreateCam('DEFAULT_SCRIPTED_CAMERA', true)
print(IsCamRendering(other), IsCamRendering(cam), GetCamFov(other))
SetCamActiveWithInterp(cam, other, 1000, 1, 1)
print(IsCamRendering(cam), IsCamActive(other), IsCamInterpolating(cam))
SetCamCoord(cam, 4.0, 5.0, 6.0)
SetCamFov(cam, 40.0)
SetCamDofStrength(cam, 1.0)
PointCamAtCoord(cam, 0.0, 0.0, 0.0)
print(GetCamCoord(cam), GetCamFov(cam))
RenderScriptCams(false, false, 0, true, true)
SetEntityHeading(PlayerPedId(), 270.0)
print(GetRenderingCam(), GetGameplayCamRot(2), GetGameplayCamCoord(), GetGameplayCamFov(), GetFinalRenderedCamRot(2))
DestroyCam(other, false)
print(DoesCamExist(other), DoesCamExist(cam), cam)`)
    const handle = lines.at(-1)!.split('\t').at(-1)!
    const running = test.run(`print(DoesCamExist(${handle}))`)
    test.client.manager.getResource('run0')!.stop()
    expect([lines, running, test.run(`print(DoesCamExist(${handle}))`)]).toEqual([
      [
        '1\tfalse\tfalse\t-1\tvec3(1.000000, 2.000000, 3.000000)\tvec3(-10.000000, 0.000000, 90.000000)\t60.0',
        '1\t1\ttrue\tvec3(1.000000, 2.000000, 3.000000)\tvec3(-10.000000, 0.000000, 90.000000)',
        // The camera that became active last renders.
        '1\tfalse\t50.0',
        '1\tfalse\tfalse',
        'vec3(4.000000, 5.000000, 6.000000)\t40.0',
        // The gameplay camera looks the way the ped of the player faces.
        '-1\tvec3(0.000000, 0.000000, -90.000000)\tvec3(0.000000, 0.000000, 0.000000)\t50.0\tvec3(0.000000, 0.000000, -90.000000)',
        'false\t1\t1',
      ],
      // The cameras of a resource that is running are its own, which others see too.
      ['1'],
      // Those of a resource that stops go with it.
      ['false'],
    ])
    expect(test.client.diagnostics).toEqual([])
  })
})
