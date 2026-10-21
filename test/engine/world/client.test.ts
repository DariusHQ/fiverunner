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

/** A tree on the steps that clients sync in, which a client syncs back as it is. */
const ON_STEPS = {
  position: { sectorX: 512, sectorY: 512, sectorZ: 24, x: 0, y: 0, z: 0 },
  orientation: { kind: 'quaternion', quaternion: { largest: 3, a: 1024, b: 1024, c: 1024 } },
  model: 9,
  popType: 7,
  scriptHash: 0,
} as const

const TREE = {
  position: { sectorX: 512, sectorY: 512, sectorZ: 24, x: 10, y: 20, z: 45 },
  orientation: { kind: 'quaternion', quaternion: { largest: 3, a: 1024, b: 1024, c: 1024 } },
  model: 9,
  popType: 7,
  scriptHash: 0,
} as const

describe('Clones in the worlds of clients', () => {
  it('are created where their trees say, and owned by others', () => {
    const world = new ClientWorld()
    world.receiveClones(
      [{ kind: 'create', objectId: 9, type: NetObjType.automobile, state: TREE, owner: 2 }],
      1,
    )
    const clone = world.byObjectId(9)!
    expect([clone.x, clone.y, clone.z, clone.model, clone.owner, clone.script]).toEqual([
      10,
      20,
      1,
      9,
      2,
      undefined,
    ])
    expect(world.sync().clones).toEqual([])
  })

  it('turn peds by their headings', () => {
    const world = new ClientWorld()
    world.receiveClones(
      [
        {
          kind: 'create',
          objectId: 9,
          type: NetObjType.ped,
          state: { ...TREE, orientation: { kind: 'heading', heading: Math.PI / 2 } },
          owner: 2,
        },
      ],
      1,
    )
    // The front of a ped turned to 90 degrees faces west.
    const { rotation } = world.byObjectId(9)!
    expect(rotation[1]).toBeCloseTo(-1, 9)
    expect(rotation[4]).toBeCloseTo(0, 9)
  })

  it('move as their owners sync them', () => {
    const world = new ClientWorld()
    world.receiveClones(
      [{ kind: 'create', objectId: 9, type: NetObjType.automobile, state: TREE, owner: 2 }],
      1,
    )
    world.receiveClones(
      [
        {
          kind: 'sync',
          objectId: 9,
          state: { ...TREE, position: { ...TREE.position, x: 30 }, model: 10 },
          owner: 3,
        },
      ],
      1,
    )
    const clone = world.byObjectId(9)!
    expect([clone.x, clone.model, clone.owner]).toEqual([30, 10, 3])
    world.receiveClones([{ kind: 'sync', objectId: 8, state: TREE, owner: 3 }], 1)
    expect(world.byObjectId(8)).toBeUndefined()
  })

  it('are owned by clients once servers hand them to them, which sync them at once, then as they change', () => {
    const world = new ClientWorld()
    world.receiveClones(
      [{ kind: 'create', objectId: 9, type: NetObjType.automobile, state: ON_STEPS, owner: 1 }],
      1,
    )
    expect(world.byObjectId(9)!.owner).toBeUndefined()
    expect(world.sync().clones).toMatchObject([{ kind: 'sync', objectId: 9 }])
    expect(world.sync().clones).toEqual([])
    world.receiveClones(
      [{ kind: 'create', objectId: 8, type: NetObjType.automobile, state: ON_STEPS, owner: 2 }],
      1,
    )
    world.receiveClones([{ kind: 'sync', objectId: 8, state: ON_STEPS, owner: 1 }], 1)
    expect(world.byObjectId(8)!.owner).toBeUndefined()
    expect(world.sync().clones).toMatchObject([{ kind: 'sync', objectId: 8 }])
  })

  it('are no longer synced by clients that the server took them from', () => {
    const world = new ClientWorld()
    world.receiveClones(
      [{ kind: 'create', objectId: 9, type: NetObjType.automobile, state: TREE, owner: 1 }],
      1,
    )
    world.sync()
    world.receiveClones([{ kind: 'sync', objectId: 9, state: TREE, owner: 2 }], 1)
    world.byObjectId(9)!.moveTo(1, 2, 3)
    expect(world.byObjectId(9)!.owner).toBe(2)
    expect(world.sync().clones).toEqual([])
  })

  it('free no object id of the client as they go, which were not handed to it', () => {
    const world = new ClientWorld()
    world.receiveClones(
      [
        { kind: 'create', objectId: 9, type: NetObjType.automobile, state: TREE, owner: 2 },
        { kind: 'create', objectId: 8, type: NetObjType.automobile, state: TREE, owner: 1 },
      ],
      1,
    )
    world.receiveClones([{ kind: 'remove', objectId: 9 }], 1)
    world.removalTaken(8)
    expect(world.byObjectId(9)).toBeUndefined()
    expect(world.canNetwork).toBe(false)
    world.receiveObjectIds([3])
    world.removalTaken(3)
    expect(world.canNetwork).toBe(true)
  })
})
