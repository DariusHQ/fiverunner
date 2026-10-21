import { atoi } from '../../libc.ts'
import { defineNative, type NativeDefinition, type Side } from '../../natives/index.ts'
import type { NativeContext } from '../context.ts'
import { pack } from '../msgpack.ts'
import { DropReason, ONESYNC_SLOT, type Player } from '../session.ts'
import type { ClientEntity } from '../world/client.ts'
import { checkArgument } from './events.ts'

/** What FiveM's GET_PLAYER_LAST_MSG gives for no player. */
const NO_LAST_MSG = 0x7fffffff

/**
 * The player that the first argument of a native of players names, as
 * FiveM's MakeClientFunction finds it: by the net id that atoi reads.
 * Natives give their default value for no player.
 */
function playerOf(ctx: NativeContext, playerSrc: string | null): Player | undefined {
  return ctx.manager.session?.player(atoi(checkArgument(playerSrc, 0)))
}

/** The value at `index` of a list of a player, or none out of it, as FiveM's natives of players read them. */
function at(list: readonly string[], index: number): string | null {
  return list[index] ?? null
}

/** What GTA V's GET_PLAYER_NAME gives for no player. */
const INVALID_NAME = '**Invalid**'

/** A player as the client of a player knows it, by its index. */
interface ClientPlayer {
  readonly ped: ClientEntity
  readonly name: string
}

/** The index of the local player of a client: the slot that its server gives it, 128 with OneSync, and 0 otherwise. */
export function localPlayerIndex(ctx: NativeContext): number {
  return ctx.manager.session?.server.oneSync ? ONESYNC_SLOT : 0
}

/** Whether a client is in a network game: whether it joined a session. */
export function inSession(ctx: NativeContext): boolean {
  return ctx.manager.player !== undefined
}

/** The player that an index names on a client, as FiveM's clients take indices: in 8 bits. */
function clientPlayer(ctx: NativeContext, index: number): ClientPlayer | undefined {
  const local = localPlayerIndex(ctx)
  if ((index & 0xff) !== local) return undefined
  const { player, world } = ctx.manager
  return {
    ped: world!.playerPed,
    name: player?.name ?? '',
  }
}

/** The player that an index names among those of the network game of a client, which there are none of out of it. */
function networkPlayer(ctx: NativeContext, index: number): ClientPlayer | undefined {
  return inSession(ctx) ? clientPlayer(ctx, index) : undefined
}

/** The handle of the ped of the player that an index names on a client, -1 for the local player, or 0. */
function playerPed(ctx: NativeContext, index: number): number {
  if (index === -1) return ctx.manager.world!.playerPed.handle
  return clientPlayer(ctx, index)?.ped.handle ?? 0
}

/** Natives of players, which servers know by their net ids and clients by their indices. */
export function playerNatives(side: Side): NativeDefinition<NativeContext>[] {
  return side === 'client' ? clientPlayerNatives() : serverPlayerNatives()
}

/** Natives of the players of clients: the local player, and the network game it is in. */
function clientPlayerNatives(): NativeDefinition<NativeContext>[] {
  const index = (ctx: NativeContext) => localPlayerIndex(ctx)
  const session = (ctx: NativeContext) => inSession(ctx)
  return [
    defineNative(
      { name: 'PLAYER_ID', hash: 0x4f8644af03d0e0d6n, result: 'Player', params: [] },
      index,
    ),
    defineNative(
      { name: 'GET_PLAYER_INDEX', hash: 0xa5edc40ef369b48dn, result: 'Player', params: [] },
      index,
    ),
    defineNative(
      { name: 'PLAYER_PED_ID', hash: 0xd80958fc74e988a6n, result: 'Ped', params: [] },
      (ctx: NativeContext) => ctx.manager.world!.playerPed.handle,
    ),
    defineNative(
      {
        name: 'GET_PLAYER_PED',
        hash: 0x43a66c31c68491c0n,
        result: 'Ped',
        params: ['Player playerId'],
      },
      playerPed,
    ),
    defineNative(
      {
        name: 'GET_PLAYER_PED_SCRIPT_INDEX',
        hash: 0x50fac3a3e030a6e1n,
        result: 'Ped',
        params: ['Player player'],
      },
      playerPed,
    ),
    defineNative(
      {
        name: 'GET_PLAYER_NAME',
        hash: 0x6d0de6a7b5da71f8n,
        result: 'char*',
        params: ['Player player'],
      },
      (ctx: NativeContext, player) => clientPlayer(ctx, player)?.name ?? INVALID_NAME,
    ),
    // There are no other players yet.
    defineNative(
      { name: 'GET_NUMBER_OF_PLAYERS', hash: 0x407c7f91ddb46c16n, result: 'int', params: [] },
      () => 1,
    ),
    defineNative(
      {
        name: 'IS_PLAYER_PLAYING',
        hash: 0x5e9564d8246b909an,
        result: 'BOOL',
        params: ['Player player'],
      },
      (ctx: NativeContext, player) => clientPlayer(ctx, player) !== undefined,
    ),
    defineNative(
      {
        name: 'NETWORK_IS_PLAYER_ACTIVE',
        hash: 0xb8dfd30d6973e135n,
        result: 'BOOL',
        params: ['Player player'],
      },
      (ctx: NativeContext, player) => networkPlayer(ctx, player) !== undefined,
    ),
    defineNative(
      {
        name: 'NETWORK_IS_PLAYER_CONNECTED',
        hash: 0x93dc1be4e1abe9d1n,
        result: 'BOOL',
        params: ['Player player'],
      },
      (ctx: NativeContext, player) => networkPlayer(ctx, player) !== undefined,
    ),
    defineNative(
      { name: 'NETWORK_IS_SESSION_STARTED', hash: 0x9de624d2fc4b603fn, result: 'BOOL', params: [] },
      session,
    ),
    defineNative(
      { name: 'NETWORK_IS_SESSION_ACTIVE', hash: 0xd83c2b94e7508980n, result: 'BOOL', params: [] },
      session,
    ),
    defineNative(
      { name: 'NETWORK_IS_IN_SESSION', hash: 0xca97246103b63917n, result: 'BOOL', params: [] },
      session,
    ),
    defineNative(
      {
        name: 'NETWORK_GET_PLAYER_INDEX_FROM_PED',
        hash: 0x6c0e2e0125610278n,
        result: 'Player',
        params: ['Ped ped'],
      },
      (ctx: NativeContext, ped) =>
        inSession(ctx) && ped === ctx.manager.world!.playerPed.handle ? localPlayerIndex(ctx) : -1,
    ),
    defineNative(
      { name: 'IS_PED_A_PLAYER', hash: 0x12534c348c6cb68bn, result: 'BOOL', params: ['Ped ped'] },
      (ctx: NativeContext, ped) => ped === ctx.manager.world!.playerPed.handle,
    ),
    defineNative(
      { name: 'GET_PLAYER_SERVER_ID', result: 'int', params: ['Player player'] },
      // FiveM's clients call the net ids of players their server ids.
      (ctx: NativeContext, player) =>
        networkPlayer(ctx, player) === undefined ? 0 : ctx.manager.player!.netId,
    ),
    defineNative(
      { name: 'GET_PLAYER_FROM_SERVER_ID', result: 'Player', params: ['int serverId'] },
      (ctx: NativeContext, serverId) =>
        inSession(ctx) && serverId === ctx.manager.player!.netId ? localPlayerIndex(ctx) : -1,
    ),
    defineNative(
      { name: 'GET_ACTIVE_PLAYERS', result: 'object', params: [] },
      (ctx: NativeContext) => pack(inSession(ctx) ? [localPlayerIndex(ctx)] : []),
    ),
    defineNative(
      { name: 'GET_PLAYER_FROM_STATE_BAG_NAME', result: 'int', params: ['char* bagName'] },
      (ctx: NativeContext, bagName) => {
        const name = checkArgument(bagName, 0)
        const { player, session } = ctx.manager
        // FiveM's clients know the net ids of players, in 16 bits, with OneSync alone.
        if (!name.startsWith('player:') || player === undefined || !session!.server.oneSync) {
          return 0
        }
        return (atoi(name.slice(7)) & 0xffff) === player.netId ? ONESYNC_SLOT : 0
      },
    ),
  ]
}

/** Natives of the players of servers, by their net ids. */
function serverPlayerNatives(): NativeDefinition<NativeContext>[] {
  /** The players as GetNumPlayerIndices last listed them, which GetPlayerFromIndex indexes for all resources. */
  let listed: Player[] = []
  return [
    defineNative(
      { name: 'GET_PLAYER_NAME', result: 'char*', params: ['char* playerSrc'] },
      (ctx: NativeContext, playerSrc) => playerOf(ctx, playerSrc)?.name ?? null,
    ),
    defineNative(
      { name: 'DOES_PLAYER_EXIST', result: 'BOOL', params: ['char* playerSrc'] },
      (ctx: NativeContext, playerSrc) => {
        const player = playerOf(ctx, playerSrc)
        return player !== undefined && player.netId === atoi(playerSrc!)
      },
    ),
    defineNative(
      { name: 'GET_PLAYER_GUID', result: 'char*', params: ['char* playerSrc'] },
      (ctx: NativeContext, playerSrc) => playerOf(ctx, playerSrc)?.guid ?? null,
    ),
    defineNative(
      { name: 'GET_NUM_PLAYER_IDENTIFIERS', result: 'int', params: ['char* playerSrc'] },
      (ctx: NativeContext, playerSrc) => playerOf(ctx, playerSrc)?.identifiers.length ?? 0,
    ),
    defineNative(
      {
        name: 'GET_PLAYER_IDENTIFIER',
        result: 'char*',
        params: ['char* playerSrc', 'int identiferIndex'],
      },
      (ctx: NativeContext, playerSrc, index) => {
        const player = playerOf(ctx, playerSrc)
        return player === undefined ? null : at(player.identifiers, index)
      },
    ),
    defineNative(
      {
        name: 'GET_PLAYER_IDENTIFIER_BY_TYPE',
        result: 'char*',
        params: ['char* playerSrc', 'char* identifierType'],
      },
      (ctx: NativeContext, playerSrc, identifierType) => {
        const player = playerOf(ctx, playerSrc)
        if (player === undefined) return null
        // FiveM takes the first identifier that starts with the type, so license finds license2: too.
        const type = checkArgument(identifierType, 1)
        return player.identifiers.find((identifier) => identifier.startsWith(type)) ?? null
      },
    ),
    defineNative(
      { name: 'GET_NUM_PLAYER_TOKENS', result: 'int', params: ['char* playerSrc'] },
      (ctx: NativeContext, playerSrc) => playerOf(ctx, playerSrc)?.tokens.length ?? 0,
    ),
    defineNative(
      { name: 'GET_PLAYER_TOKEN', result: 'char*', params: ['char* playerSrc', 'int index'] },
      (ctx: NativeContext, playerSrc, index) => {
        const player = playerOf(ctx, playerSrc)
        return player === undefined ? null : at(player.tokens, index)
      },
    ),
    defineNative(
      { name: 'GET_PLAYER_ENDPOINT', result: 'char*', params: ['char* playerSrc'] },
      (ctx: NativeContext, playerSrc) => playerOf(ctx, playerSrc)?.endpoint ?? null,
    ),
    defineNative(
      { name: 'GET_PLAYER_PING', result: 'int', params: ['char* playerSrc'] },
      (ctx: NativeContext, playerSrc) => playerOf(ctx, playerSrc)?.ping ?? 0,
    ),
    defineNative(
      { name: 'GET_PLAYER_LAST_MSG', result: 'int', params: ['char* playerSrc'] },
      (ctx: NativeContext, playerSrc) => {
        const player = playerOf(ctx, playerSrc)
        if (player === undefined) return NO_LAST_MSG
        return Math.trunc(ctx.manager.time()) - player.lastSeen
      },
    ),
    defineNative(
      { name: 'GET_PLAYER_TIME_ONLINE', result: 'int', params: ['char* playerSrc'] },
      (ctx: NativeContext, playerSrc) => {
        const player = playerOf(ctx, playerSrc)
        return player === undefined ? 0 : Math.trunc((player.lastSeen - player.firstSeen) / 1000)
      },
    ),
    // Declared void, it sets whether it dropped the player.
    defineNative(
      {
        name: 'DROP_PLAYER',
        result: 'void',
        sets: 'BOOL',
        params: ['char* playerSrc', 'char* reason'],
      },
      (ctx: NativeContext, playerSrc, reason) => {
        const player = playerOf(ctx, playerSrc)
        // FiveM drops no player that has no net id yet.
        if (player === undefined || !player.connected) return false
        const resource = ctx.manager.currentResource?.name ?? ''
        player.session.drop(player, checkArgument(reason, 1), resource, DropReason.resource)
        return true
      },
    ),
    defineNative(
      {
        name: 'IS_PLAYER_ACE_ALLOWED',
        result: 'BOOL',
        params: ['char* playerSrc', 'char* object'],
      },
      (ctx: NativeContext, playerSrc, object) => {
        const player = playerOf(ctx, playerSrc)
        if (player === undefined) return false
        const what = checkArgument(object, 1)
        // FiveM checks as the player alone, not as those the code runs as.
        const { security } = ctx.manager
        return player.principals.some((principal) => security.checkPrincipal(principal, what))
      },
    ),
    defineNative(
      { name: 'GET_NUM_PLAYER_INDICES', result: 'int', params: [] },
      (ctx: NativeContext) => {
        // FiveM lists the players that have their net ids.
        listed = Array.from(ctx.manager.session?.players ?? []).filter(({ connected }) => connected)
        return listed.length
      },
    ),
    defineNative(
      { name: 'GET_PLAYER_FROM_INDEX', result: 'char*', params: ['int index'] },
      (_ctx: NativeContext, index) => {
        const player = listed[index]
        // The list keeps players that dropped since, which FiveM finds no more.
        if (player === undefined || player.session.player(player.netId) !== player) return null
        return String(player.netId)
      },
    ),
  ]
}
