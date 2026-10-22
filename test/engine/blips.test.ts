import { describe, expect, it } from 'vitest'

import { clientOf } from './helpers.ts'

describe('Blips of clients', () => {
  it('are where scripts put them, as they set them', async () => {
    const { run, client } = await clientOf()
    expect(
      run(`local blip = AddBlipForCoord(100.0, 200.0, 30.0)
print(blip, DoesBlipExist(blip), GetBlipCoords(blip), GetBlipSprite(blip), GetBlipColour(blip), GetBlipAlpha(blip))
SetBlipSprite(blip, 357)
SetBlipColour(blip, 3)
SetBlipAlpha(blip, 128)
SetBlipAsShortRange(blip, true)
SetBlipFlashes(blip, true)
SetBlipCoords(blip, 1.0, 2.0, 3.0)
print(GetBlipSprite(blip), GetBlipColour(blip), GetBlipAlpha(blip), IsBlipShortRange(blip), IsBlipFlashing(blip), GetBlipInfoIdCoord(blip))
local radius = AddBlipForRadius(0.0, 0.0, 0.0, 50.0)
print(radius, GetBlipSprite(radius), GetNumberOfActiveBlips())`),
    ).toEqual([
      '1\t1\tvec3(100.000000, 200.000000, 30.000000)\t1\t0\t255',
      '357\t3\t128\t1\t1\tvec3(1.000000, 2.000000, 3.000000)',
      // Blips around coordinates are of their own sprite.
      '257\t9\t2',
    ])
    expect(client.diagnostics).toEqual([])
  })

  it('are named by text commands, on the labels of GTA V and of scripts', async () => {
    const { run, client } = await clientOf()
    run(`AddTextEntry('BLIP_GARAGE', 'Garage ~a~ (~1~ cars)')
local garage = AddBlipForCoord(0.0, 0.0, 0.0)
BeginTextCommandSetBlipName('BLIP_GARAGE')
AddTextComponentSubstringPlayerName('Legion')
AddTextComponentInteger(12)
EndTextCommandSetBlipName(garage)
local shop = AddBlipForCoord(0.0, 0.0, 0.0)
BeginTextCommandSetBlipName('STRING')
AddTextComponentString('Shop')
EndTextCommandSetBlipName(shop)
local unknown = AddBlipForCoord(0.0, 0.0, 0.0)
BeginTextCommandSetBlipName('NOT_A_LABEL')
EndTextCommandSetBlipName(unknown)`)
    expect([...client.manager.world!.blips.all].map(({ name }) => name)).toEqual([
      'Garage Legion (12 cars)',
      'Shop',
      'NULL',
    ])
    expect(
      run(`print(GetLabelText('BLIP_GARAGE'), GetLabelText('STRING'), GetLabelText('NOT_A_LABEL'))
print(DoesTextLabelExist('blip_garage'), DoesTextLabelExist('NOT_A_LABEL'))`),
    ).toEqual(['Garage ~a~ (~1~ cars)\t~a~\tNULL', '1\tfalse'])
  })

  it('follow their entities, and go with them', async () => {
    const { run } = await clientOf()
    expect(
      run(`local ped = PlayerPedId()
local blip = AddBlipForEntity(ped)
SetEntityCoords(ped, 5.0, 6.0, 7.0, false, false, false, false)
print(blip == GetBlipFromEntity(ped), GetBlipInfoIdEntityIndex(blip) == ped, GetBlipCoords(blip))
print(AddBlipForEntity(12345), GetBlipFromEntity(12345))
local adder = GetHashKey('adder')
RequestModel(adder)
CreateThread(function()
    while not HasModelLoaded(adder) do Wait(0) end
    local vehicle = CreateVehicle(adder, 0.0, 0.0, 0.0, 0.0, false, false)
    local car = AddBlipForEntity(vehicle)
    DeleteEntity(vehicle)
    print(DoesBlipExist(car), DoesBlipExist(blip))
end)`),
    ).toEqual(['true\ttrue\tvec3(5.000000, 6.000000, 7.000000)', '0\t0'])
  })

  it('go as scripts remove them, which zeroes their handles', async () => {
    const { run } = await clientOf()
    expect(
      run(`local blip = AddBlipForCoord(0.0, 0.0, 0.0)
RemoveBlip(blip)
print(DoesBlipExist(blip), GetBlipSprite(blip), GetBlipCoords(blip))
SetBlipSprite(blip, 1)
RemoveBlip(blip)
-- The slot of the blip that went is taken again, by a handle of its own.
print(AddBlipForCoord(0.0, 0.0, 0.0) ~= blip)`),
    ).toEqual(['false\t0\tvec3(0.000000, 0.000000, 0.000000)', 'true'])
  })

  it('go with the resources whose scripts created them', async () => {
    const test = await clientOf()
    test.run(`AddBlipForCoord(0.0, 0.0, 0.0)
SetNewWaypoint(10.0, 20.0)`)
    expect(test.run(`print(GetNumberOfActiveBlips())`)).toEqual(['2'])
    test.client.manager.getResource('run0')!.stop()
    expect(
      test.run(
        `print(GetNumberOfActiveBlips(), IsWaypointActive(), GetBlipInfoIdCoord(GetFirstBlipInfoId(8)))`,
      ),
    ).toEqual(['1\t1\tvec3(10.000000, 20.000000, 0.000000)'])
  })

  it('are gone through by their sprites, in the order they were created', async () => {
    const { run } = await clientOf()
    expect(
      run(`local first = AddBlipForCoord(0.0, 0.0, 0.0)
local other = AddBlipForCoord(0.0, 0.0, 0.0)
SetBlipSprite(other, 50)
local second = AddBlipForCoord(0.0, 0.0, 0.0)
local found = {}
local blip = GetFirstBlipInfoId(1)
while DoesBlipExist(blip) do
    found[#found + 1] = blip
    blip = GetNextBlipInfoId(1)
end
print(#found, found[1] == first, found[2] == second, GetFirstBlipInfoId(2))`),
    ).toEqual(['2\ttrue\ttrue\t0'])
  })

  it('have the waypoint of the player, which it moves and turns off', async () => {
    const { run } = await clientOf()
    expect(
      run(`print(IsWaypointActive(), GetFirstBlipInfoId(8))
SetNewWaypoint(100.0, 200.0)
local waypoint = GetFirstBlipInfoId(8)
SetNewWaypoint(300.0, 400.0)
print(IsWaypointActive(), GetFirstBlipInfoId(8) == waypoint, GetBlipInfoIdCoord(waypoint))
SetWaypointOff()
print(IsWaypointActive(), DoesBlipExist(waypoint))
SetNewWaypoint(1.0, 1.0)
DeleteWaypoint()
print(IsWaypointActive())`),
    ).toEqual([
      'false\t0',
      '1\ttrue\tvec3(300.000000, 400.000000, 0.000000)',
      'false\tfalse',
      'false',
    ])
  })
})
