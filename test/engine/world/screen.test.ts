import { describe, expect, it } from 'vitest'

import { ScreenFade } from '../../../src/core/engine/world/screen.ts'

describe('Fades of screens', () => {
  it('start faded in', () => {
    const screen = new ScreenFade()
    expect(screen.level(0)).toBe(0)
    expect(screen.level(1000)).toBe(0)
    expect(screen.fadesTo(0)).toBe(true)
    expect(screen.fadesTo(1)).toBe(false)
  })

  it('fade over the durations that scripts ask, then stay', () => {
    const screen = new ScreenFade()
    screen.fade(1, 500, 100)
    expect(screen.fadesTo(1)).toBe(true)
    expect([screen.level(100), screen.level(350), screen.level(600), screen.level(5000)]).toEqual([
      0, 0.5, 1, 1,
    ])
    screen.fade(0, 200, 5000)
    expect([screen.level(5100), screen.level(5200), screen.level(9000)]).toEqual([0.5, 0, 0])
  })

  it('fade at once for durations of none', () => {
    const screen = new ScreenFade()
    screen.fade(1, 0, 100)
    expect(screen.level(100)).toBe(1)
    screen.fade(0, -50, 200)
    expect(screen.level(200)).toBe(0)
  })

  it('turn back from where they are, at the pace of their new durations', () => {
    const screen = new ScreenFade()
    screen.fade(1, 1000, 0)
    screen.fade(0, 1000, 400)
    expect([screen.level(400), screen.level(600), screen.level(800), screen.level(900)]).toEqual([
      0.4, 0.2, 0, 0,
    ])
    screen.fade(1, 1000, 900)
    screen.fade(1, 100, 950)
    expect([screen.level(950), screen.level(1000), screen.level(1100)]).toEqual([0.05, 0.55, 1])
  })
})
