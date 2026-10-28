import { describe, expect, it } from 'vitest'

import { clientOf } from './helpers.ts'

describe('The weapons of peds', () => {
  it('are those that scripts give them, with the ammunition, components and tints that scripts set', async () => {
    const { run, client } = await clientOf()
    expect(
      run(`local ped = PlayerPedId()
local pistol, rifle, unarmed = GetHashKey('WEAPON_PISTOL'), GetHashKey('WEAPON_CARBINERIFLE'), GetHashKey('WEAPON_UNARMED')
local function held() local armed, weapon = GetCurrentPedWeapon(ped, true) return GetSelectedPedWeapon(ped) == unarmed, armed, weapon == unarmed end
print(held())
GiveWeaponToPed(ped, pistol, 12, false, true)
GiveWeaponToPed(ped, rifle, 30, false, false)
GiveWeaponToPed(ped, pistol, 8, false, false)
print(GetSelectedPedWeapon(ped) == pistol, HasPedGotWeapon(ped, rifle, false), GetAmmoInPedWeapon(ped, pistol), GetAmmoInPedWeapon(ped, rifle))
SetPedAmmo(ped, rifle, 60)
AddAmmoToPed(ped, rifle, 5)
GiveWeaponComponentToPed(ped, pistol, GetHashKey('COMPONENT_AT_PI_FLSH'))
SetPedWeaponTintIndex(ped, pistol, 2)
print(GetAmmoInPedWeapon(ped, rifle), HasPedGotWeaponComponent(ped, pistol, GetHashKey('COMPONENT_AT_PI_FLSH')), GetPedWeaponTintIndex(ped, pistol), GetPedWeaponTintIndex(ped, rifle))
SetCurrentPedWeapon(ped, rifle, true)
RemoveWeaponFromPed(ped, rifle)
print(held())
RemoveAllPedWeapons(ped, true)
print(HasPedGotWeapon(ped, pistol, false), GetSelectedPedWeapon(2), IsPedShooting(ped))`),
    ).toEqual([
      'true\tfalse\ttrue',
      // Peds that have a weapon get its ammunition.
      'true\t1\t20\t30',
      '65\t1\t2\t0',
      // A ped whose weapon is taken from its hands holds its fists.
      'true\tfalse\ttrue',
      'false\t0\tfalse',
    ])
    expect(client.diagnostics).toEqual([])
  })

  it('in their hands sync to servers, which tell of none of the peds that they made', async () => {
    const test = await clientOf()
    test.server
      .add('srv', {
        'main.lua': `RegisterCommand('held', function()
    print(GetSelectedPedWeapon(GetPlayerPed('1')) == GetHashKey('WEAPON_PISTOL'), GetCurrentPedWeapon(CreatePed(4, GetHashKey('a_m_y_skater_01'), 0.0, 0.0, 0.0, 0.0, true, false)))
end, false)`,
      })
      .start()
    test.run(`GiveWeaponToPed(PlayerPedId(), GetHashKey('WEAPON_PISTOL'), 12, false, true)`)
    for (let i = 0; i < 2; i++) {
      test.client.tickAt(test.client.time + 10)
      test.server.tickAt(test.server.time + 10)
    }
    test.server.take()
    test.server.manager.console.commands.invoke('held', '')
    expect(test.server.take().filter((line) => line.includes('[script:'))).toEqual([
      '[script:srv] true\t0',
    ])
  })
})
