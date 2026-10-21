import { describe, expect, it } from 'vitest'

import {
  NetObjType,
  PopType,
  type GameStateClient,
  type SyncState,
} from '../../../src/core/engine/world/entity.ts'
import { toSector } from '../../../src/core/engine/world/quantize.ts'
import { ServerGameState, type GameStateHost } from '../../../src/core/engine/world/server.ts'

/** A game state whose host records what it was given, and runs what is for the main thread when asked. */
function gameState(lengthHack = true) {
  const queued: [string, unknown[]][] = []
  const triggered: [string, unknown[]][] = []
  const removedOnClients: [GameStateClient, number][] = []
  const mainThread: (() => void)[] = []
  /** The events that handlers cancel. */
  const canceled = new Set<string>()
  const host: GameStateHost = {
    queue: (name, args) => queued.push([name, [...args]]),
    trigger: (name, args) => {
      triggered.push([name, [...args]])
      return !canceled.has(name)
    },
    onMainThread: (fn) => mainThread.push(fn),
    removeOnClient: (client, objectId) => removedOnClients.push([client, objectId]),
  }
  const state = new ServerGameState(host, lengthHack)
  const runMainThread = () => {
    for (const fn of mainThread.splice(0)) fn()
  }
  return { state, queued, triggered, removedOnClients, canceled, runMainThread }
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

const ANN: GameStateClient = { netId: 1 }
const BOB: GameStateClient = { netId: 2 }

const MOVED: SyncState = { ...STATE, position: toSector(4, 5, 6) }

describe('The game state of servers with clients', () => {
  it('hands clients object ids from 1 up, which it then hands no one else', () => {
    const { state } = gameState()
    expect(state.grantObjectIds(ANN, 4)).toEqual([1, 2, 3, 4])
    expect(state.grantObjectIds(BOB, 4)).toEqual([5, 6, 7, 8])
    expect(state.grantObjectIds(ANN, 2)).toEqual([9, 10])
  })

  it('hands out no object id that an entity has, the ids of its own entities from the top too', () => {
    const { state } = gameState(false)
    state.receiveCreate(ANN, 1, NetObjType.automobile, STATE)
    for (let id = 8191; id >= 4; id--) state.create(NetObjType.object, STATE)
    // Clients get the object ids above those of the entities of the server too.
    expect(state.grantObjectIds(BOB, 4)).toEqual([2, 3, 8192, 8193])
  })

  it('creates its own entities with no object id that it handed out or that an entity has', () => {
    const { state } = gameState(false)
    // Clients may create entities with object ids that they were not handed.
    state.receiveCreate(ANN, 8191, NetObjType.automobile, STATE)
    expect(state.create(NetObjType.object, STATE)!.objectId).toBe(8190)
    state.grantObjectIds(BOB, 8189)
    expect(state.create(NetObjType.object, STATE)).toBeUndefined()
  })

  it('takes the entities that clients create, owned by them, which entityCreating lets it keep', () => {
    const { state, triggered, queued, runMainThread } = gameState()
    state.receiveCreate(ANN, 2, NetObjType.automobile, STATE)
    const entity = state.byObjectId(2)!
    expect([entity.owner, entity.firstOwner, entity.valid]).toEqual([ANN, ANN, true])
    expect([triggered, queued]).toEqual([[], []])
    runMainThread()
    expect(triggered).toEqual([['entityCreating', [0x20001]]])
    expect(queued).toEqual([['entityCreated', [0x20001]]])
  })

  it('removes the entities of clients that entityCreating cancels, but players', () => {
    const { state, canceled, queued, removedOnClients, runMainThread } = gameState()
    canceled.add('entityCreating')
    state.receiveCreate(ANN, 2, NetObjType.automobile, STATE)
    state.receiveCreate(ANN, 3, NetObjType.player, STATE)
    runMainThread()
    expect(queued).toEqual([])
    state.tick()
    runMainThread()
    expect(state.byObjectId(2)).toBeUndefined()
    expect(state.byObjectId(3)?.valid).toBe(true)
    // The client is told to remove what the server removed.
    expect(removedOnClients).toEqual([[ANN, 2]])
  })

  it('triggers nothing for the entities of clients that went before the main thread got to them', () => {
    const { state, triggered, runMainThread } = gameState()
    state.receiveCreate(ANN, 2, NetObjType.automobile, STATE)
    state.receiveRemove(ANN, 2)
    state.tick()
    runMainThread()
    expect(triggered).toEqual([['entityRemoved', [0x20001]]])
  })

  it('creates nothing for object ids that entities have', () => {
    const { state } = gameState()
    state.receiveCreate(ANN, 2, NetObjType.automobile, STATE)
    state.receiveCreate(BOB, 2, NetObjType.ped, MOVED)
    expect([state.byObjectId(2)!.type, state.byObjectId(2)!.owner]).toEqual([
      NetObjType.automobile,
      ANN,
    ])
  })

  it('unbinds the entities of players that went', () => {
    const { state, runMainThread } = gameState()
    state.receiveCreate(ANN, 1, NetObjType.player, STATE)
    state.receiveRemove(ANN, 1)
    state.tick()
    runMainThread()
    expect(state.playerHandleOf(ANN)).toBe(0)
  })

  it('binds the entities of the players of clients to them, one each', () => {
    const { state } = gameState()
    expect(state.playerHandleOf(ANN)).toBe(0)
    state.receiveCreate(ANN, 1, NetObjType.player, STATE)
    state.receiveCreate(ANN, 2, NetObjType.player, STATE)
    expect(state.playerHandleOf(ANN)).toBe(0x20001)
    expect(state.byObjectId(2)).toBeUndefined()
    expect(state.playerHandleOf(BOB)).toBe(0)
  })

  it('takes what the owners of entities sync of them, and nothing of others', () => {
    const { state } = gameState()
    state.receiveCreate(ANN, 2, NetObjType.automobile, STATE)
    state.receiveSync(BOB, 2, MOVED)
    expect(state.byObjectId(2)!.state).toBe(STATE)
    state.receiveSync(ANN, 2, MOVED)
    expect(state.byObjectId(2)!.state).toBe(MOVED)
    state.receiveSync(ANN, 3, STATE)
  })

  it('removes the entities that their owners removed, which it need not tell them of', () => {
    const { state, triggered, removedOnClients, runMainThread } = gameState()
    state.receiveCreate(ANN, 2, NetObjType.automobile, STATE)
    runMainThread()
    state.receiveRemove(BOB, 2)
    state.tick()
    expect(state.byObjectId(2)!.valid).toBe(true)
    state.receiveRemove(ANN, 2)
    expect(state.byObjectId(2)!.valid).toBe(true)
    state.tick()
    runMainThread()
    expect(triggered.at(-1)).toEqual(['entityRemoved', [0x20001]])
    expect(state.byObjectId(2)).toBeUndefined()
    expect(removedOnClients).toEqual([])
  })

  it('tells clients to remove the entities of theirs that scripts of the server deleted', () => {
    const { state, removedOnClients, runMainThread } = gameState()
    state.receiveCreate(ANN, 2, NetObjType.automobile, STATE)
    state.delete(state.byObjectId(2)!)
    state.tick()
    runMainThread()
    expect(removedOnClients).toEqual([[ANN, 2]])
  })

  it('keeps the object ids of the entities of clients that went for the clients', () => {
    const { state, runMainThread } = gameState()
    state.grantObjectIds(ANN, 2)
    state.receiveCreate(ANN, 2, NetObjType.automobile, STATE)
    state.receiveRemove(ANN, 2)
    state.tick()
    runMainThread()
    expect(state.grantObjectIds(BOB, 1)).toEqual([3])
  })

  it('forgets the clients that dropped: the entities they own go, and the object ids they were handed are free', () => {
    const { state, triggered, removedOnClients, runMainThread } = gameState()
    expect(state.grantObjectIds(ANN, 2)).toEqual([1, 2])
    expect(state.grantObjectIds(ANN, 1)).toEqual([3])
    state.grantObjectIds(BOB, 1)
    state.receiveCreate(ANN, 1, NetObjType.player, STATE)
    state.receiveCreate(ANN, 2, NetObjType.automobile, STATE)
    state.receiveCreate(BOB, 4, NetObjType.automobile, STATE)
    const server = state.create(NetObjType.automobile, STATE)!
    runMainThread()
    state.drop(ANN)
    expect(state.playerHandleOf(ANN)).toBe(0)
    expect(state.byObjectId(2)!.firstOwnerDropped).toBe(true)
    expect(state.byObjectId(4)!.firstOwnerDropped).toBe(false)
    state.tick()
    runMainThread()
    // The entity of the server took the first GUID as the server created it.
    expect(triggered.filter(([name]) => name === 'entityRemoved')).toEqual([
      ['entityRemoved', [0x20101]],
      ['entityRemoved', [0x20201]],
    ])
    expect(removedOnClients).toEqual([])
    expect([state.byObjectId(4)?.valid, server.valid]).toEqual([true, true])
    expect(state.playerHandleOf(ANN)).toBe(0)
    expect(state.grantObjectIds(BOB, 4)).toEqual([1, 2, 3, 5])
  })
})
