import { describe, expect, it } from 'vitest'

import { clientOf } from './helpers.ts'

describe('Screens of clients', () => {
  it('start faded in', async () => {
    const { run } = await clientOf()
    expect(
      run(`print(IsScreenFadedIn(), IsScreenFadedOut(), IsScreenFadingIn(), IsScreenFadingOut())`),
    ).toEqual(['1\tfalse\tfalse\tfalse'])
  })

  it('fade out and in over the durations that scripts ask, in the time of the client', async () => {
    const { run, client } = await clientOf()
    expect(
      run(`DoScreenFadeOut(500)
print(IsScreenFadedIn(), IsScreenFadedOut(), IsScreenFadingIn(), IsScreenFadingOut())
CreateThread(function()
    print('mid', IsScreenFadingOut(), IsScreenFadingIn(), IsScreenFadedOut(), IsScreenFadedIn())
    while not IsScreenFadedOut() do Wait(0) end
    print('out', GetGameTimer(), IsScreenFadingOut())
    DoScreenFadeIn(200)
    print(IsScreenFadedIn(), IsScreenFadingIn(), IsScreenFadedOut(), IsScreenFadingOut())
    while not IsScreenFadedIn() do Wait(0) end
    print('in', GetGameTimer(), IsScreenFadingIn())
end)`),
    ).toEqual(['false\tfalse\tfalse\t1'])
    const printed: string[] = []
    for (const time of [100, 400, 500, 600, 700]) {
      client.tickAt(time)
      printed.push(...client.take().filter((line) => line.startsWith('[script:')))
    }
    expect(printed).toEqual([
      '[script:run0] mid\t1\tfalse\tfalse\tfalse',
      '[script:run0] out\t500\tfalse',
      // The screen is as black as it was, but fades in.
      '[script:run0] false\t1\tfalse\tfalse',
      '[script:run0] in\t700\tfalse',
    ])
  })

  it('fade at once for durations of none', async () => {
    const { run } = await clientOf()
    expect(
      run(`DoScreenFadeOut(0)
print(IsScreenFadedOut(), IsScreenFadingOut())
DoScreenFadeIn(0)
print(IsScreenFadedIn(), IsScreenFadingIn())`),
    ).toEqual(['1\tfalse', '1\tfalse'])
  })

  it('are those of new games once clients leave their sessions', async () => {
    const { run, player, client } = await clientOf()
    run(`DoScreenFadeOut(0)`)
    player.quit()
    client.manager.tick()
    client.add('after', { 'main.lua': `print(IsScreenFadedIn())` }).start()
    expect(client.take().filter((line) => line.startsWith('[script:'))).toEqual([
      '[script:after] 1',
    ])
  })
})
