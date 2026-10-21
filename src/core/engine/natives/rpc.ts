import { stoi, stoiError } from '../../libc.ts'
import {
  hashString,
  luaName,
  NativeError,
  type NativeDefinition,
  type ParamType,
  type Side,
} from '../../natives/index.ts'
import { parseParam } from '../../natives/registry.ts'
import type { NativeContext, NativeRuntime } from '../context.ts'
import { RPC_NATIVES, type RpcArg, type RpcCall, type RpcNative } from '../rpc.ts'
import type { Player } from '../session.ts'
import type { GameStateClient } from '../world/entity.ts'
import { fromSector } from '../world/quantize.ts'
import { checkArgument } from './events.ts'

/** What script handles of entities start at, below which FiveM's RPC natives take net ids of players. */
const SCRIPT_HANDLE_BASE = 0x20000

/** The types of the parameters of GTA V's natives that name entities. */
const ENTITY_TYPES: ReadonlySet<string> = new Set(['Entity', 'Ped', 'Vehicle'])

/** The natives that servers have clients run, which only servers have. */
export function rpcNatives(side: Side): NativeDefinition<NativeContext>[] {
  return side === 'server' ? RPC_NATIVES.map(serverRpcNative) : []
}

/**
 * A native that a server has clients run: it takes players by their net
 * ids, as text, and those that create entities give their handles.
 */
function serverRpcNative(native: RpcNative): NativeDefinition<NativeContext> {
  const params = native.params.map(parseParam)
  /** The runtimes that were told that the server runs the native on no client without OneSync. */
  const told = new WeakSet<NativeRuntime>()
  return {
    name: native.name,
    hash: BigInt(hashString(native.name)),
    result: native.kind === 'create' ? 'Entity' : 'void',
    params: params.map(({ type, name }) => ({ type: type === 'Player' ? 'char*' : type, name })),
    luaName: luaName(native.name),
    aliases: [],
    impl: (ctx: NativeContext, ...values: unknown[]) => {
      if (ctx.manager.oneSync) {
        return native.kind === 'create'
          ? createOnClient(ctx, native, values)
          : runOnClient(ctx, native, values)
      }
      if (told.has(ctx.runtime)) return undefined
      told.add(ctx.runtime)
      ctx.diagnose(
        `${luaName(native.name)} is one of the natives that FiveM's server has clients run, which it does with OneSync alone: without it, FiveM's server has no handler for it, so it does nothing.`,
      )
      return undefined
    },
  }
}

/**
 * Has the client of the entity or the player that the first argument names
 * run a native, as FiveM's server does with OneSync: the client that owns
 * the entity, or the next that takes it once it has it, or the client that
 * creates it for the server, or the client of the player. Natives that
 * name entities or players that there are not run nowhere.
 */
function runOnClient(ctx: NativeContext, native: RpcNative, values: readonly unknown[]): void {
  const { manager } = ctx
  const session = manager.session
  const gameState = manager.gameState!
  const args = rpcArgs(ctx, native, values)
  if (args === undefined) return
  const call: RpcCall = { hash: native.hash, resource: ctx.resource.name, args }
  const first = args[0]!
  if (first.kind === 'player') {
    session!.sendRpc(session!.player(first.netId)!, call)
    return
  }
  const handle = entityHandle(ctx, values[0] as number)
  const pending = gameState.pendingOf(handle)
  if (pending !== undefined) {
    // FiveM's server keeps where SetEntityCoords puts what clients create for it, which GetEntityCoords gives.
    if (native.name === 'SET_ENTITY_COORDS') {
      pending.coords = values.slice(1, 4) as [number, number, number]
    }
    sendTo(ctx, pending.client, call)
    return
  }
  const entity = gameState.byHandle(handle)!
  const owner = entity.owner
  // The client that takes an entity that no client owns runs it once it has the entity.
  if (owner === undefined) entity.onOwned.push((client) => sendTo(ctx, client, call))
  else sendTo(ctx, owner, call)
}

/**
 * Has a client create an entity for the server, as FiveM's server does with
 * OneSync: the client whose player is the nearest to where it goes, or for
 * natives that take no position, the first of those whose players have
 * peds, or all of them when none has. Returns the handle that the entity
 * takes once the client syncs it, or 0 when there is no client to create it.
 */
function createOnClient(ctx: NativeContext, native: RpcNative, values: readonly unknown[]): number {
  const { manager } = ctx
  const gameState = manager.gameState!
  const players = [...(manager.session?.players ?? [])]
  const position = positionOf(native, values)
  let client: Player | undefined
  if (position === undefined) {
    client = players.find((player) => gameState.playerHandleOf(player) !== 0)
  } else {
    // The players that joined, by how far their peds are, those as far as others in the order they joined.
    const candidates = players
      .filter((player) => player.slot !== undefined)
      .map((player) => ({ player, distance: distanceSquared(ctx, player, position) }))
      .sort((a, b) => a.distance - b.distance)
    client = candidates[0]?.player
    if (client === undefined) return 0
  }
  const token = gameState.nextCreationToken()
  const args = rpcArgs(ctx, native, values)
  if (args === undefined) return 0
  sendTo(ctx, client, { hash: native.hash, resource: ctx.resource.name, token, args })
  return gameState.pend(token, client)
}

/** Sends a client a native to run, or all clients for none. */
function sendTo(ctx: NativeContext, client: GameStateClient | undefined, call: RpcCall): void {
  const session = ctx.manager.session
  if (session === undefined) return
  const players = client === undefined ? [...session.players] : [client as Player]
  for (const player of players) session.sendRpc(player, call)
}

/**
 * Where an entity that a native creates goes, as FiveM's server finds it at
 * the first three floats in a row that the native takes: its first float
 * and the two after it, for those that take floats.
 */
function positionOf(
  native: RpcNative,
  values: readonly unknown[],
): readonly [number, number, number] | undefined {
  const first = native.params.findIndex((param) => parseParam(param).type === 'float')
  return first === -1 ? undefined : (values.slice(first, first + 3) as [number, number, number])
}

/** The square of how far the ped of a player is from a position, which is infinite for players with no ped. */
function distanceSquared(
  ctx: NativeContext,
  player: Player,
  [x, y, z]: readonly [number, number, number],
): number {
  const ped = ctx.manager.gameState!.byHandle(ctx.manager.gameState!.playerHandleOf(player))
  if (ped === undefined) return Infinity
  const [px, py, pz] = fromSector(ped.state.position)
  return (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2
}

/** The arguments of a native as they go to the client that runs it, or undefined when they name entities or players that there are not. */
function rpcArgs(
  ctx: NativeContext,
  native: RpcNative,
  values: readonly unknown[],
): RpcArg[] | undefined {
  const args: RpcArg[] = []
  for (const [i, param] of native.params.entries()) {
    const arg = rpcArg(ctx, parseParam(param).type, values[i], i)
    if (arg === undefined) return undefined
    args.push(arg)
  }
  return args
}

/** An argument of a native as it goes to the client that runs it, or undefined for an entity or a player that there is not. */
function rpcArg(
  ctx: NativeContext,
  type: ParamType,
  value: unknown,
  index: number,
): RpcArg | undefined {
  if (ENTITY_TYPES.has(type)) {
    const gameState = ctx.manager.gameState!
    const handle = entityHandle(ctx, value as number)
    const entity = gameState.byHandle(handle)
    if (entity !== undefined) return { kind: 'entity', objectId: entity.objectId }
    const pending = gameState.pendingOf(handle)
    return pending === undefined ? undefined : { kind: 'created', token: pending.token }
  }
  switch (type) {
    case 'Player': {
      const player = ctx.manager.session?.player(netIdOf(value, index))
      return player === undefined ? undefined : { kind: 'player', netId: player.netId }
    }
    case 'Hash':
      return { kind: 'hash', hash: value as number }
    case 'char*':
      return { kind: 'value', value: checkArgument(value as string | null, index) }
    default:
      return { kind: 'value', value: value as number | boolean }
  }
}

/** The net id of a player that a native takes as text, as FiveM reads it with std::stoi. */
function netIdOf(value: unknown, index: number): number {
  const text = checkArgument(value as string | null, index)
  const netId = stoi(text)
  if (netId === undefined) throw new NativeError(stoiError(text))
  return netId
}

/** The script handle of an entity that a native takes: those below 0x20000 are net ids of players, whose peds they name. */
export function entityHandle(ctx: NativeContext, handle: number): number {
  if (handle >= SCRIPT_HANDLE_BASE) return handle
  const player = ctx.manager.session?.player(handle)
  return player === undefined ? handle : ctx.manager.gameState!.playerHandleOf(player)
}
