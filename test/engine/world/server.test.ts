import { describe, expect, it } from 'vitest'

import { NetObjType, PopType, type SyncState } from '../../../src/core/engine/world/entity.ts'
import { toSector } from '../../../src/core/engine/world/quantize.ts'
import { ServerGameState, type GameStateHost } from '../../../src/core/engine/world/server.ts'

/** A game state whose host records what it was given, and runs what is for the main thread when asked. */
function gameState(lengthHack = true) {
  const queued: [string, unknown[]][] = []
  const triggered: [string, unknown[]][] = []
  const mainThread: (() => void)[] = []
  const host: GameStateHost = {
    queue: (name, args) => queued.push([name, [...args]]),
    trigger: (name, args) => triggered.push([name, [...args]]),
    onMainThread: (fn) => mainThread.push(fn),
  }
  const state = new ServerGameState(host, lengthHack)
  const runMainThread = () => {
    for (const fn of mainThread.splice(0)) fn()
  }
  return { state, queued, triggered, runMainThread }
}

const STATE: SyncState = {
  position: toSector(1, 2, 3),
  orientation: { kind: 'heading', heading: 0 },
  model: 1,
  popType: PopType.mission,
  scriptHash: 0,
}

describe('The game state of servers', () => {
  it('gives the entities it creates object ids from the top, and handles from their GUIDs', () => {
    const { state, queued } = gameState()
    const a = state.create(NetObjType.automobile, STATE)!
    const b = state.create(NetObjType.ped, STATE)!
    expect([a.objectId, b.objectId]).toEqual([65534, 65533])
    // The first slot of the pool of GUIDs, with the id 1, then the second.
    expect([state.handleOf(a), state.handleOf(b)]).toEqual([0x20001, 0x20101])
    expect(queued).toEqual([
      ['serverEntityCreated', [0x20001]],
      ['serverEntityCreated', [0x20101]],
    ])
    expect([...state.entities]).toEqual([a, b])
  })

  it('takes object ids from 8191 down without the length hack', () => {
    const { state } = gameState(false)
    expect(state.create(NetObjType.object, STATE)!.objectId).toBe(8191)
  })

  it('creates no entity once it has no object id left', () => {
    const { state, queued } = gameState(false)
    for (let id = 8191; id >= 1; id--)
      expect(state.create(NetObjType.object, STATE)!.objectId).toBe(id)
    expect(state.create(NetObjType.object, STATE)).toBeUndefined()
    expect(queued).toHaveLength(8191)
  })

  it('finds entities by their handles and their object ids, in 16 bits', () => {
    const { state } = gameState()
    const entity = state.create(NetObjType.automobile, STATE)!
    expect(state.byHandle(0x20001)).toBe(entity)
    expect(state.byObjectId(65534)).toBe(entity)
    expect(state.byObjectId(65534 + 65536)).toBe(entity)
    for (const handle of [0, 1, 0x20000, 0x20002, 0x20101]) {
      expect(state.byHandle(handle)).toBeUndefined()
    }
    expect(state.byObjectId(65535)).toBeUndefined()
  })

  it('starts deleting entities at its next tick, and removes them once the main thread ran entityRemoved', () => {
    const { state, triggered, runMainThread } = gameState()
    const entity = state.create(NetObjType.automobile, STATE)!
    state.delete(entity)
    expect(entity.valid).toBe(true)
    state.tick()
    expect([entity.deleting, entity.finalizing, entity.valid]).toEqual([true, true, false])
    expect(state.byHandle(0x20001)).toBe(entity)
    expect(triggered).toEqual([])
    runMainThread()
    expect(triggered).toEqual([['entityRemoved', [0x20001]]])
    expect(state.byHandle(0x20001)).toBeUndefined()
    expect(state.byObjectId(65534)).toBeUndefined()
    expect([...state.entities]).toEqual([])
  })

  it('removes entities once, however often they are deleted', () => {
    const { state, triggered, runMainThread } = gameState()
    const entity = state.create(NetObjType.automobile, STATE)!
    state.delete(entity)
    state.delete(entity)
    state.tick()
    state.delete(entity)
    state.tick()
    runMainThread()
    // Deleted once it was removed, it is no longer found.
    state.delete(entity)
    state.tick()
    runMainThread()
    expect(triggered).toEqual([['entityRemoved', [0x20001]]])
  })

  it('hands out the object ids and the GUIDs of entities it removed again', () => {
    const { state, runMainThread } = gameState()
    const a = state.create(NetObjType.automobile, STATE)!
    state.create(NetObjType.automobile, STATE)
    state.delete(a)
    state.tick()
    runMainThread()
    const c = state.create(NetObjType.automobile, STATE)!
    state.tick()
    expect(c.objectId).toBe(65534)
    expect(c.valid).toBe(true)
    // The slot of the GUID is taken again, with the id 2.
    expect(state.handleOf(c)).toBe(0x20002)
    expect(state.byHandle(0x20001)).toBeUndefined()
  })

  it('does not delete players', () => {
    const { state, runMainThread } = gameState()
    const player = state.create(NetObjType.player, STATE)!
    state.delete(player)
    state.tick()
    runMainThread()
    expect(player.valid).toBe(true)
    expect([...state.entities]).toEqual([player])
  })
})
