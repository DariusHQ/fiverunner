import { describe, expect, it } from 'vitest'

import { clientOf } from './helpers.ts'

describe('The door system of clients', () => {
  it('has the doors that scripts add, as they lock them and open them, until they remove them', async () => {
    const { run, client } = await clientOf()
    expect(
      run(`local door, model = GetHashKey('mrpd_front'), GetHashKey('v_ilev_ph_door01')
print(IsDoorRegisteredWithSystem(door), DoorSystemGetDoorState(door), IsDoorClosed(door))
AddDoorToSystem(door, model, 434.7, -980.6, 30.8, false, false, false)
DoorSystemSetDoorState(door, 1, false, false)
DoorSystemSetAutomaticRate(door, 2.0, false, false)
DoorSystemSetAutomaticDistance(door, 5.0, false, false)
DoorSystemSetHoldOpen(door, true)
local found, hash = DoorSystemFindExistingDoor(434.5, -980.5, 30.8, model)
print(IsDoorRegisteredWithSystem(door), DoorSystemGetDoorState(door), DoorSystemGetDoorPendingState(door), DoorSystemGetAutomaticDistance(door), IsDoorClosed(door), found, hash == door, DoorSystemGetIsPhysicsLoaded(door))
DoorSystemSetOpenRatio(door, 0.5, false, false)
print(DoorSystemGetOpenRatio(door), IsDoorClosed(door), DoorSystemFindExistingDoor(436.0, -980.5, 30.8, model))
RemoveDoorFromSystem(door)
print(IsDoorRegisteredWithSystem(door), DoorSystemGetDoorState(door))`),
    ).toEqual([
      'false\t0\t1',
      '1\t1\t1\t5.0\t1\t1\ttrue\t1',
      // A door more than half a metre away is not found.
      '0.5\tfalse\tfalse\t0',
      'false\t0',
    ])
    expect(client.diagnostics).toEqual([])
  })
})
