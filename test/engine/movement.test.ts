import { describe, expect, it } from 'vitest'

import { clientOf, type TestClient } from './helpers.ts'

/** Ticks the client `milliseconds` after its last tick, with the keys that are held. */
function hold(test: TestClient, milliseconds: number): void {
  test.client.tickAt(test.client.time + milliseconds)
}

/** Lets scripts that the last tick woke run, and returns what they printed. */
function printed(test: TestClient): string[] {
  hold(test, 0)
  return test.client
    .take()
    .filter((line) => line.startsWith('[script:'))
    .map((line) => line.slice(line.indexOf('] ') + 2))
}

const worldOf = (test: TestClient) => test.client.manager.world!

/** What the script `code` prints, once it ran. */
function run(test: TestClient, code: string): string[] {
  test.run(`CreateThread(function()\n${code}\nend)`)
  return printed(test)
}

describe('The ped of the player of a client', () => {
  it('runs where its keys say, with the north up, and faces that way', async () => {
    const test = await clientOf()
    const ped = worldOf(test).playerPed
    worldOf(test).input.keyDown('W')
    hold(test, 1000)
    expect([ped.x, ped.y]).toEqual([0, 5])
    expect(
      run(
        test,
        `print(GetEntityHeading(PlayerPedId()), GetEntitySpeed(PlayerPedId()), IsPedRunning(PlayerPedId()), IsPedStill(PlayerPedId()))`,
      ),
    ).toEqual(['0.0\t5.0\t1\tfalse'])
    worldOf(test).input.keyUp('W')
    worldOf(test).input.keyDown('D')
    hold(test, 1000)
    expect([ped.x, ped.y]).toEqual([5, 5])
    expect(run(test, `print(GetEntityHeading(PlayerPedId()))`)).toEqual(['270.0'])
    worldOf(test).input.keyUp('D')
    hold(test, 1000)
    expect([ped.x, ped.y]).toEqual([5, 5])
    expect(
      run(
        test,
        `print(GetEntitySpeed(PlayerPedId()), IsPedStill(PlayerPedId()), IsPedStopped(PlayerPedId()))`,
      ),
    ).toEqual(['0.0\t1\t1'])
    expect(test.client.diagnostics).toEqual([])
  })

  it('goes no faster on the diagonals, and sprints while its key is held', async () => {
    const test = await clientOf()
    const ped = worldOf(test).playerPed
    worldOf(test).input.keyDown('W')
    worldOf(test).input.keyDown('D')
    hold(test, 1000)
    expect(Math.hypot(ped.x, ped.y)).toBeCloseTo(5, 4)
    worldOf(test).input.keyUp('D')
    worldOf(test).input.keyDown('LSHIFT')
    const { y } = ped
    hold(test, 1000)
    expect(ped.y).toBeCloseTo(y + 7, 4)
    expect(run(test, `print(IsPedSprinting(PlayerPedId()), IsPedRunning(PlayerPedId()))`)).toEqual([
      '1\tfalse',
    ])
  })

  it('stays where it is while scripts disable the controls of moving, freeze it or take its control', async () => {
    const test = await clientOf()
    const ped = worldOf(test).playerPed
    test.run(`local disabled = true
RegisterCommand('allow', function() disabled = false end, false)
CreateThread(function()
    while disabled do
        DisableControlAction(0, 31, true)
        Wait(0)
    end
end)`)
    worldOf(test).input.keyDown('W')
    hold(test, 0)
    hold(test, 1000)
    expect(ped.y).toBe(0)
    test.client.manager.console.commands.invoke('allow', '')
    hold(test, 0)
    hold(test, 1000)
    expect(ped.y).toBe(5)
    run(test, `FreezeEntityPosition(PlayerPedId(), true)`)
    hold(test, 1000)
    expect(ped.y).toBe(5)
    run(
      test,
      `FreezeEntityPosition(PlayerPedId(), false)
SetPlayerControl(PlayerId(), false, 0)`,
    )
    hold(test, 1000)
    expect(ped.y).toBe(5)
    run(
      test,
      `SetPlayerControl(PlayerId(), true, 0)
SetEntityHealth(PlayerPedId(), 0)`,
    )
    hold(test, 1000)
    expect(ped.y).toBe(5)
  })

  it('leaves its keys to the pages that have the focus, unless they keep input', async () => {
    const test = await clientOf()
    const ped = worldOf(test).playerPed
    test.client
      .add('page', {
        'fxmanifest.lua': `fx_version 'cerulean'
game 'gta5'
ui_page 'index.html'
client_script 'main.lua'`,
        'main.lua': `CreateThread(function() SetNuiFocus(true, true) end)
RegisterCommand('keep', function() SetNuiFocusKeepInput(true) end, false)`,
        'index.html': '<html></html>',
      })
      .start()
    hold(test, 10)
    worldOf(test).input.keyDown('W')
    hold(test, 1000)
    expect(ped.y).toBe(0)
    test.client.manager.console.commands.invoke('keep', '')
    hold(test, 1000)
    expect(ped.y).toBe(5)
  })

  it('tells its server where it runs, as the map shows it', async () => {
    const test = await clientOf()
    worldOf(test).input.keyDown('W')
    hold(test, 1000)
    hold(test, 10)
    test.server.tickAt(test.server.time + 50)
    test.server
      .add('where', {
        'main.lua': `print(GetEntityCoords(GetPlayerPed(${test.player.netId})).y > 4.9)`,
      })
      .start()
    expect(test.server.take()).toContain('[script:where] true')
  })
})

describe('A vehicle with the player of a client at its wheel', () => {
  /** A client whose player sits in a vehicle, in the seat `seat`. */
  async function inCar(seat = -1, setup = '') {
    const test = await clientOf()
    test.run(`local adder = GetHashKey('adder')
RequestModel(adder)
CreateThread(function()
    while not HasModelLoaded(adder) do Wait(0) end
    local car = CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, false, false)
    ${setup}
    SetPedIntoVehicle(PlayerPedId(), car, ${seat})
end)`)
    hold(test, 10)
    hold(test, 10)
    const car = worldOf(test).playerPed.vehicle!
    return { test, car, ped: worldOf(test).playerPed }
  }

  it('starts as a driver gets in, and speeds up, with the player in it, while its pedal is held', async () => {
    const { test, car, ped } = await inCar()
    expect(car.parts.engineOn).toBe(true)
    worldOf(test).input.keyDown('W')
    for (let i = 0; i < 10; i++) hold(test, 100)
    expect(car.speed).toBeCloseTo(6, 4)
    expect(car.y).toBeGreaterThan(2.5)
    expect([ped.x, ped.y]).toEqual([car.x, car.y])
    expect(
      run(
        test,
        `print(GetEntitySpeed(PlayerPedId()) > 5.9, IsVehicleStopped(GetVehiclePedIsIn(PlayerPedId(), false)))`,
      ),
    ).toEqual(['true\tfalse'])
    expect(test.client.diagnostics).toEqual([])
  })

  it('rolls on by itself, and stops, and backs up on the brake', async () => {
    const { test, car } = await inCar()
    worldOf(test).input.keyDown('W')
    for (let i = 0; i < 10; i++) hold(test, 100)
    worldOf(test).input.keyUp('W')
    hold(test, 1000)
    expect(car.speed).toBeCloseTo(4, 4)
    for (let i = 0; i < 3; i++) hold(test, 1000)
    expect(car.speed).toBe(0)
    worldOf(test).input.keyDown('S')
    for (let i = 0; i < 10; i++) hold(test, 100)
    expect(car.speed).toBeCloseTo(-6, 4)
  })

  it('turns as it rolls, the way its wheel says, and not while it stands', async () => {
    const { test, car } = await inCar()
    const heading = () =>
      run(test, `print(GetEntityHeading(GetVehiclePedIsIn(PlayerPedId(), false)))`)[0]
    worldOf(test).input.keyDown('A')
    hold(test, 1000)
    expect(heading()).toBe('0.0')
    worldOf(test).input.keyDown('W')
    for (let i = 0; i < 20; i++) hold(test, 100)
    expect(Number(heading())).toBeGreaterThan(30)
    expect(car.x).toBeLessThan(0)
  })

  it('goes nowhere with its engine off for good, or for a passenger', async () => {
    const off = await inCar(-1, `SetVehicleEngineOn(car, false, true, true)`)
    expect(off.car.parts.engineOn).toBe(false)
    worldOf(off.test).input.keyDown('W')
    hold(off.test, 1000)
    expect(off.car.speed).toBe(0)
    const passenger = await inCar(0)
    worldOf(passenger.test).input.keyDown('W')
    hold(passenger.test, 1000)
    expect(passenger.car.speed).toBe(0)
  })
})
