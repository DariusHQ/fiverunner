import { describe, expect, it } from 'vitest'

import { clientOf, type TestClient } from './helpers.ts'

/** Ticks the client, and returns what its scripts printed meanwhile. */
function frame(test: TestClient): string[] {
  test.client.tickAt(test.client.time + 10)
  return test.client
    .take()
    .filter((line) => line.startsWith('[script:'))
    .map((line) => line.slice(line.indexOf('] ') + 2))
}

/** A script that prints, at each frame, how the controls of E and of moving up and down are. */
const WATCH = `CreateThread(function()
    while true do
        print(IsControlPressed(0, 38), IsControlJustPressed(0, 51), IsControlJustReleased(0, 46), IsControlReleased(0, 38), GetControlNormal(0, 31))
        Wait(0)
    end
end)`

describe('Controls of clients', () => {
  it('show the button of no key, as players bind no keys of their own', async () => {
    const { run } = await clientOf()
    expect(run(`print(GetControlInstructionalButton(0, 38, true):sub(3) == '')`)).toEqual(['true'])
  })

  it('are pressed by the keys that GTA V binds them to, as of the frame after the keys went down', async () => {
    const test = await clientOf()
    test.run(WATCH)
    const { input } = test.client.manager.world!
    const idle = frame(test)
    input.keyDown('e')
    input.keyDown('W')
    const down = [frame(test), frame(test)]
    input.keyUp('E')
    expect([idle, down, frame(test), frame(test)]).toEqual([
      ['false\tfalse\tfalse\t1\t0.0'],
      [['1\t1\tfalse\tfalse\t-1.0'], ['1\tfalse\tfalse\tfalse\t-1.0']],
      ['false\tfalse\t1\t1\t-1.0'],
      ['false\tfalse\tfalse\t1\t-1.0'],
    ])
    expect(test.client.diagnostics).toEqual([])
  })

  it('are disabled for the frame by scripts, which see them pressed as disabled controls', async () => {
    const test = await clientOf()
    test.run(`CreateThread(function()
    while true do
        DisableControlAction(0, 38, true)
        print(IsControlPressed(0, 38), IsDisabledControlPressed(0, 38), IsControlEnabled(0, 38), IsControlPressed(0, 51))
        Wait(0)
    end
end)`)
    test.client.manager.world!.input.keyDown('E')
    expect([frame(test), frame(test)]).toEqual([['false\t1\tfalse\t1'], ['false\t1\tfalse\t1']])
  })

  it('run the commands that resources bind to keys, +commands as keys go down and -commands as they go up', async () => {
    const test = await clientOf()
    test.run(`RegisterKeyMapping('+radial', 'Opens the radial menu', 'keyboard', 'F1')
RegisterKeyMapping('emotes', 'Opens the emotes', 'KEYBOARD', 'f3')
RegisterKeyMapping('+target', 'Targets', 'mouse_button', 'MOUSE_LEFT')`)
    const { input } = test.client.manager.world!
    expect([
      input.keyDown('F1'),
      input.keyDown('F1'),
      input.keyUp('F1'),
      input.keyDown('F3'),
      input.keyUp('F3'),
      input.keyUp('F3'),
      [...input.mappings.values()].map(({ command, mapper, key }) => `${command} ${mapper} ${key}`),
    ]).toEqual([
      ['+radial'],
      // A key that is held goes down no more.
      [],
      ['-radial'],
      ['emotes'],
      [],
      [],
      ['+radial keyboard F1', 'emotes keyboard F3', '+target mouse_button MOUSE_LEFT'],
    ])
  })
})
