import { describe, expect, it } from 'vitest'

import { ClientEntity, ClientWorld } from '../../../src/core/engine/world/client.ts'
import { NetObjType } from '../../../src/core/engine/world/entity.ts'
import { fromHeading } from '../../../src/core/engine/world/rotation.ts'

/** A vehicle of a world, networked if it can be. */
function vehicle(world: ClientWorld, networked = true): ClientEntity {
  const entity = new ClientEntity(NetObjType.automobile, 7)
  world.add(entity)
  if (networked) world.network(entity)
  return entity
}

describe('The worlds of clients', () => {
  it('network the ped of their player once they have an object id', () => {
    const world = new ClientWorld()
    expect(world.sync()).toEqual({ clones: [], requestObjectIds: true })
    expect(world.playerPed.objectId).toBeUndefined()
    world.receiveObjectIds([1, 2, 3, 4])
    const { clones, requestObjectIds } = world.sync()
    expect(world.playerPed.objectId).toBe(1)
    expect(clones).toEqual([
      { kind: 'create', objectId: 1, type: NetObjType.player, state: expect.anything() },
    ])
    // Three are fewer than four.
    expect(requestObjectIds).toBe(true)
  })

  it('network entities with their object ids, first in, first out', () => {
    const world = new ClientWorld()
    world.receiveObjectIds([5, 9])
    world.receiveObjectIds([2])
    expect([vehicle(world).objectId, vehicle(world).objectId, vehicle(world).objectId]).toEqual([
      5, 9, 2,
    ])
    expect(world.canNetwork).toBe(false)
    expect(world.byObjectId(9)?.objectId).toBe(9)
    expect(world.byObjectId(4)).toBeUndefined()
  })

  it('ask for object ids once at a time, while they have fewer than four', () => {
    const world = new ClientWorld()
    expect(world.sync().requestObjectIds).toBe(true)
    expect(world.sync().requestObjectIds).toBe(false)
    world.receiveObjectIds([1, 2, 3, 4, 5])
    expect(world.sync().requestObjectIds).toBe(false)
    vehicle(world)
    expect(world.sync().requestObjectIds).toBe(true)
  })

  it('tell their servers of what changed in the entities they network, once', () => {
    const world = new ClientWorld()
    world.receiveObjectIds([1, 2, 3, 4, 5, 6])
    world.sync()
    const car = vehicle(world)
    const local = vehicle(world, false)
    expect(world.sync().clones).toEqual([
      { kind: 'create', objectId: 2, type: NetObjType.automobile, state: expect.anything() },
    ])
    expect(world.sync().clones).toEqual([])
    car.moveTo(1, 2, 3)
    local.moveTo(1, 2, 3)
    const [synced] = world.sync().clones
    expect(synced).toMatchObject({ kind: 'sync', objectId: 2 })
    car.rotation = fromHeading(90)
    expect(world.sync().clones).toMatchObject([{ kind: 'sync', objectId: 2 }])
    car.model = 8
    expect(world.sync().clones).toMatchObject([{ kind: 'sync', objectId: 2 }])
  })

  it('tell their servers of the networked entities that they remove, whose object ids are free once their servers took it', () => {
    const world = new ClientWorld()
    world.receiveObjectIds([1, 2, 3, 4, 5, 6])
    world.sync()
    const car = vehicle(world)
    world.sync()
    world.remove(car)
    expect(world.byHandle(car.handle)).toBeUndefined()
    expect(world.sync().clones).toEqual([{ kind: 'remove', objectId: 2 }])
    expect(world.sync().clones).toEqual([])
    // The object ids 3 to 6 come first, and 2 is not free yet.
    expect([3, 4, 5, 6].map(() => vehicle(world).objectId)).toEqual([3, 4, 5, 6])
    expect(world.canNetwork).toBe(false)
    world.removalTaken(2)
    expect(vehicle(world).objectId).toBe(2)
  })

  it('free the object ids of networked entities that their servers did not know of at once', () => {
    const world = new ClientWorld()
    world.receiveObjectIds([1, 2])
    const car = vehicle(world)
    world.remove(car)
    expect(world.sync().clones).toEqual([
      { kind: 'create', objectId: 2, type: NetObjType.player, state: expect.anything() },
    ])
    expect(vehicle(world).objectId).toBe(1)
  })

  it('free no object id as they remove entities that were not networked', () => {
    const world = new ClientWorld()
    world.remove(vehicle(world, false))
    expect(world.canNetwork).toBe(false)
    expect(world.sync().clones).toEqual([])
  })

  it('remove the entities that their servers removed, and free their object ids', () => {
    const world = new ClientWorld()
    world.receiveObjectIds([1, 2, 3, 4, 5])
    world.sync()
    const car = vehicle(world)
    world.sync()
    world.removedByServer(2)
    world.removedByServer(9)
    expect(world.byHandle(car.handle)).toBeUndefined()
    expect([...world.entities]).toEqual([world.playerPed])
    expect(world.sync().clones).toEqual([])
    expect([3, 4, 5, 2].map(() => vehicle(world).objectId)).toEqual([3, 4, 5, 2])
  })
})
