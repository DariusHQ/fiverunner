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
import { checkArgument } from './events.ts'

/** What script handles of entities start at, below which FiveM's RPC natives take net ids of players. */
const SCRIPT_HANDLE_BASE = 0x20000

/** The types of the parameters of GTA V's natives that name entities. */
const ENTITY_TYPES: ReadonlySet<string> = new Set(['Entity', 'Ped', 'Vehicle'])

/** The natives that servers have clients run, which only servers have. */
export function rpcNatives(side: Side): NativeDefinition<NativeContext>[] {
  return side === 'server' ? RPC_NATIVES.map(serverRpcNative) : []
}

/** A native that a server has clients run: it takes players by their net ids, as text. */
function serverRpcNative(native: RpcNative): NativeDefinition<NativeContext> {
  const params = native.params.map(parseParam)
  /** The runtimes that were told that the server runs the native on no client without OneSync. */
  const told = new WeakSet<NativeRuntime>()
  return {
    name: native.name,
    hash: BigInt(hashString(native.name)),
    result: 'void',
    params: params.map(({ type, name }) => ({ type: type === 'Player' ? 'char*' : type, name })),
    luaName: luaName(native.name),
    aliases: [],
    impl: (ctx: NativeContext, ...values: unknown[]) => {
      if (ctx.manager.oneSync) {
        runOnClient(ctx, native, values)
        return
      }
      if (told.has(ctx.runtime)) return
      told.add(ctx.runtime)
      ctx.diagnose(
        `${luaName(native.name)} is one of the natives that FiveM's server has clients run, which it does with OneSync alone: without it, FiveM's server has no handler for it, so it does nothing.`,
      )
    },
  }
}

/**
 * Has the client of the entity or the player that the first argument names
 * run a native, as FiveM's server does with OneSync: the client that owns
 * the entity, or the next that takes it once it has it, or the client of
 * the player. Natives that name entities or players that there are not run
 * nowhere.
 */
function runOnClient(ctx: NativeContext, native: RpcNative, values: readonly unknown[]): void {
  const { manager } = ctx
  const session = manager.session
  const args: RpcArg[] = []
  for (const [i, param] of native.params.entries()) {
    const arg = rpcArg(ctx, parseParam(param).type, values[i], i)
    if (arg === undefined) return
    args.push(arg)
  }
  const call: RpcCall = { hash: native.hash, resource: ctx.resource.name, args }
  const first = args[0]!
  if (first.kind === 'player') {
    session!.sendRpc(session!.player(first.netId)!, call)
    return
  }
  const entity = manager.gameState!.byObjectId((first as EntityArg).objectId)!
  const owner = entity.owner as Player | undefined
  // The client that takes an entity that no client owns runs it once it has the entity.
  if (owner === undefined) entity.onOwned.push((client) => session!.sendRpc(client as Player, call))
  else session!.sendRpc(owner, call)
}

type EntityArg = Extract<RpcArg, { kind: 'entity' }>

/** An argument of a native as it goes to the client that runs it, or undefined for an entity or a player that there is not. */
function rpcArg(
  ctx: NativeContext,
  type: ParamType,
  value: unknown,
  index: number,
): RpcArg | undefined {
  if (ENTITY_TYPES.has(type)) {
    const entity = ctx.manager.gameState!.byHandle(entityHandle(ctx, value as number))
    return entity === undefined ? undefined : { kind: 'entity', objectId: entity.objectId }
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
function entityHandle(ctx: NativeContext, handle: number): number {
  if (handle >= SCRIPT_HANDLE_BASE) return handle
  const player = ctx.manager.session?.player(handle)
  return player === undefined ? handle : ctx.manager.gameState!.playerHandleOf(player)
}
