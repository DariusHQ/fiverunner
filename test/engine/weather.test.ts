import { describe, expect, it } from 'vitest'

import { clientOf, type TestClient } from './helpers.ts'

/** Runs the client `ms` milliseconds on, then `code`, and returns what it printed. */
function later(test: TestClient, ms: number, code: string): string[] {
  test.client.tickAt(test.client.time + ms)
  test.client.take()
  return test.run(code)
}

const TIME = `print(GetClockHours(), GetClockMinutes(), GetClockSeconds())`

describe('The clocks of clients', () => {
  it('start at noon, and move on a minute in each 2 seconds, or in the time that scripts give a minute', async () => {
    const test = await clientOf()
    const steps = [
      test.run(`${TIME}
print(GetMillisecondsPerGameMinute(), NetworkIsClockTimeOverridden())
NetworkOverrideClockTime(23, 59, 30)
${TIME}
print(NetworkIsClockTimeOverridden())`),
      later(
        test,
        1000,
        `${TIME}
NetworkOverrideClockMillisecondsPerGameMinute(1000)
NetworkOverrideClockMillisecondsPerGameMinute(0)
print(GetMillisecondsPerGameMinute())`,
      ),
      later(
        test,
        500,
        `${TIME}
PauseClock(true)`,
      ),
      later(
        test,
        5000,
        `${TIME}
PauseClock(false)
AddToClockTime(-1, 0, 0)
${TIME}`,
      ),
      later(
        test,
        2000,
        `${TIME}
SetClockTime(6, 30, 0)
NetworkClearClockTimeOverride()
${TIME}
print(NetworkIsClockTimeOverridden())`,
      ),
    ]
    expect(steps).toEqual([
      ['12\t0\t0', '2000\tfalse', '23\t59\t30', '1'],
      ['0\t0\t0', '1000'],
      ['0\t0\t30'],
      ['0\t0\t30', '23\t0\t30'],
      ['23\t2\t30', '6\t30\t0', 'false'],
    ])
    expect(test.client.diagnostics).toEqual([])
  })
})

describe('The weather of clients', () => {
  it('starts clear, and is what scripts turn it to, over the time they give, or override it with', async () => {
    const test = await clientOf()
    const is = (types: string) =>
      `print(${types
        .split(' ')
        .map((type) => `IsPrevWeatherType('${type}'), IsNextWeatherType('${type}')`)
        .join(', ')})`
    const steps = [
      test.run(`print(GetPrevWeatherTypeHashName() == GetHashKey('CLEAR'), GetNextWeatherTypeHashName() == GetHashKey('CLEAR'))
SetWeatherTypeNowPersist('rain')
${is('RAIN')}
SetWeatherTypeOvertimePersist('THUNDER', 15.0)
${is('RAIN THUNDER')}`),
      later(
        test,
        15000,
        `${is('RAIN THUNDER')}
SetOverrideWeather('XMAS')
${is('THUNDER XMAS')}
ClearOverrideWeather()
SetWeatherTypeNow('')
ClearWeatherTypePersist()
print(GetPrevWeatherTypeHashName() == GetHashKey('THUNDER'), GetNextWeatherTypeHashName() == GetHashKey('THUNDER'))
SetRainLevel(0.5)
SetWind(1.0)
SetArtificialLightsState(true)`,
      ),
    ]
    expect(steps).toEqual([
      ['true\ttrue', '1\t1', '1\tfalse\tfalse\t1'],
      ['false\tfalse\t1\t1', 'false\tfalse\t1\t1', 'true\ttrue'],
    ])
    expect(test.client.diagnostics).toEqual([])
  })
})
