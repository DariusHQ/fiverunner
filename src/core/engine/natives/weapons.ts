import { defineNative, type NativeDefinition, type Side } from '../../natives/index.ts'
import type { NativeContext } from '../context.ts'
import type { ClientEntity } from '../world/client.ts'
import { EntityType, entityTypeOf } from '../world/entity.ts'
import { UNARMED, type PedWeapon } from '../world/weapons.ts'
import { clientEntityOf, entityOf } from './entities.ts'

/** The ped of a handle on a client, if it names one. */
function pedOf(ctx: NativeContext, handle: number): ClientEntity | undefined {
  const found = clientEntityOf(ctx, handle)
  return found !== undefined && entityTypeOf(found.type) === EntityType.ped ? found : undefined
}

/** The weapon of a hash that the ped of a handle has, if it has it. */
function weaponOf(ctx: NativeContext, handle: number, hash: number): PedWeapon | undefined {
  return pedOf(ctx, handle)?.weapons.get(hash)
}

/** Natives of the weapons of peds, which nothing shoots. */
export function weaponNatives(side: Side): NativeDefinition<NativeContext>[] {
  return side === 'server' ? serverNatives() : clientNatives()
}

function clientNatives(): NativeDefinition<NativeContext>[] {
  return [
    defineNative(
      {
        name: 'GIVE_WEAPON_TO_PED',
        hash: 0xbf0fd6e56c964fcbn,
        result: 'void',
        params: [
          'Ped ped',
          'Hash weaponHash',
          'int ammoCount',
          'BOOL isHidden',
          'BOOL bForceInHand',
        ],
      },
      (ctx: NativeContext, ped, hash, ammo, _hidden, inHand) => {
        const found = pedOf(ctx, ped)
        if (found === undefined || hash === 0 || hash === UNARMED) return
        // A ped that has the weapon gets its ammunition.
        const weapon = found.weapons.get(hash)
        if (weapon !== undefined) weapon.ammo += ammo
        else found.weapons.set(hash, { ammo, components: new Set(), tint: 0 })
        if (inHand) found.weapon = hash
      },
    ),
    defineNative(
      {
        name: 'REMOVE_WEAPON_FROM_PED',
        hash: 0x4899cb088edf59b8n,
        result: 'void',
        params: ['Ped ped', 'Hash weaponHash'],
      },
      (ctx: NativeContext, ped, hash) => {
        const found = pedOf(ctx, ped)
        if (found?.weapons.delete(hash) && found.weapon === hash) found.weapon = UNARMED
      },
    ),
    defineNative(
      {
        name: 'REMOVE_ALL_PED_WEAPONS',
        hash: 0xf25df915fa38c5f3n,
        result: 'void',
        params: ['Ped ped', 'BOOL p1'],
      },
      (ctx: NativeContext, ped) => {
        const found = pedOf(ctx, ped)
        found?.weapons.clear()
        if (found !== undefined) found.weapon = UNARMED
      },
    ),
    defineNative(
      {
        name: 'SET_CURRENT_PED_WEAPON',
        hash: 0xadf692b254977c0cn,
        result: 'void',
        params: ['Ped ped', 'Hash weaponHash', 'BOOL bForceInHand'],
      },
      (ctx: NativeContext, ped, hash) => {
        const found = pedOf(ctx, ped)
        if (found !== undefined && (hash === UNARMED || found.weapons.has(hash)))
          found.weapon = hash
      },
    ),
    defineNative(
      {
        name: 'GET_SELECTED_PED_WEAPON',
        hash: 0x0a6db4965674d243n,
        result: 'Hash',
        params: ['Ped ped'],
      },
      (ctx: NativeContext, ped) => pedOf(ctx, ped)?.weapon ?? 0,
    ),
    defineNative(
      {
        name: 'GET_CURRENT_PED_WEAPON',
        hash: 0x3a87e44bb9a01d54n,
        result: 'BOOL',
        params: ['Ped ped', 'Hash* weaponHash', 'BOOL doDeadCheck'],
      },
      (ctx: NativeContext, ped, hash) => {
        const weapon = pedOf(ctx, ped)?.weapon ?? 0
        hash.set(weapon)
        return weapon !== 0 && weapon !== UNARMED
      },
    ),
    // Peds have their fists, which are no weapon of theirs.
    defineNative(
      {
        name: 'HAS_PED_GOT_WEAPON',
        hash: 0x8decb02f88f428bcn,
        result: 'BOOL',
        params: ['Ped ped', 'Hash weaponHash', 'BOOL p2'],
      },
      (ctx: NativeContext, ped, hash) => weaponOf(ctx, ped, hash) !== undefined,
    ),
    defineNative(
      {
        name: 'GET_AMMO_IN_PED_WEAPON',
        hash: 0x015a522136d7f951n,
        result: 'int',
        params: ['Ped ped', 'Hash weaponhash'],
      },
      (ctx: NativeContext, ped, hash) => weaponOf(ctx, ped, hash)?.ammo ?? 0,
    ),
    defineNative(
      {
        name: 'SET_PED_AMMO',
        hash: 0x14e56bc5b5db6a19n,
        result: 'void',
        params: ['Ped ped', 'Hash weaponHash', 'int ammo'],
      },
      (ctx: NativeContext, ped, hash, ammo) => {
        const weapon = weaponOf(ctx, ped, hash)
        if (weapon !== undefined) weapon.ammo = ammo
      },
    ),
    defineNative(
      {
        name: 'ADD_AMMO_TO_PED',
        hash: 0x78f0424c34306220n,
        result: 'void',
        params: ['Ped ped', 'Hash weaponHash', 'int ammo'],
      },
      (ctx: NativeContext, ped, hash, ammo) => {
        const weapon = weaponOf(ctx, ped, hash)
        if (weapon !== undefined) weapon.ammo += ammo
      },
    ),
    defineNative(
      {
        name: 'GIVE_WEAPON_COMPONENT_TO_PED',
        hash: 0xd966d51aa5b28bb9n,
        result: 'void',
        params: ['Ped ped', 'Hash weaponHash', 'Hash componentHash'],
      },
      (ctx: NativeContext, ped, hash, component) =>
        weaponOf(ctx, ped, hash)?.components.add(component),
    ),
    defineNative(
      {
        name: 'REMOVE_WEAPON_COMPONENT_FROM_PED',
        hash: 0x1e8be90c74fb4c09n,
        result: 'void',
        params: ['Ped ped', 'Hash weaponHash', 'Hash componentHash'],
      },
      (ctx: NativeContext, ped, hash, component) =>
        weaponOf(ctx, ped, hash)?.components.delete(component),
    ),
    defineNative(
      {
        name: 'HAS_PED_GOT_WEAPON_COMPONENT',
        hash: 0xc593212475fae340n,
        result: 'BOOL',
        params: ['Ped ped', 'Hash weaponHash', 'Hash componentHash'],
      },
      (ctx: NativeContext, ped, hash, component) =>
        weaponOf(ctx, ped, hash)?.components.has(component) ?? false,
    ),
    defineNative(
      {
        name: 'SET_PED_WEAPON_TINT_INDEX',
        hash: 0x50969b9b89ed5738n,
        result: 'void',
        params: ['Ped ped', 'Hash weaponHash', 'int tintIndex'],
      },
      (ctx: NativeContext, ped, hash, tint) => {
        const weapon = weaponOf(ctx, ped, hash)
        if (weapon !== undefined) weapon.tint = tint
      },
    ),
    defineNative(
      {
        name: 'GET_PED_WEAPON_TINT_INDEX',
        hash: 0x2b9eedc07bd06b9fn,
        result: 'int',
        params: ['Ped ped', 'Hash weaponHash'],
      },
      (ctx: NativeContext, ped, hash) => weaponOf(ctx, ped, hash)?.tint ?? -1,
    ),
    // Nothing shoots, so ammunition lasts, and nothing picks pickups up.
    ...(
      [
        ['SET_PED_INFINITE_AMMO', 0x3edcb0505123623bn, ['Ped ped', 'BOOL toggle']],
        ['SET_PED_INFINITE_AMMO_CLIP', 0x183dadc6aa953186n, ['Ped ped', 'BOOL toggle']],
        ['SET_PED_CURRENT_WEAPON_VISIBLE', 0x0725a4ccfded9a70n, ['Ped ped', 'BOOL visible']],
        ['_0xF92099527DB8E2A7', 0xf92099527db8e2a7n, ['int rewardType', 'BOOL suppress']],
      ] as const
    ).map(([name, hash, params]) => defineNative({ name, hash, result: 'void', params }, () => {})),
    defineNative(
      { name: 'IS_PED_SHOOTING', hash: 0x34616828cd07f1a1n, result: 'BOOL', params: ['Ped ped'] },
      () => false,
    ),
  ]
}

/** The natives of FiveM's server of the weapons of peds, which read the trees of peds: nothing of those that their owners did not sync yet. */
function serverNatives(): NativeDefinition<NativeContext>[] {
  const weapon = (ctx: NativeContext, ped: number) => {
    const found = entityOf(ctx, ped)
    return found !== undefined && entityTypeOf(found.type) === EntityType.ped
      ? (found.state.weapon ?? 0)
      : 0
  }
  return [
    defineNative(
      { name: 'GET_SELECTED_PED_WEAPON', result: 'Hash', params: ['Ped ped'] },
      (ctx: NativeContext, ped) => weapon(ctx, ped),
    ),
    defineNative(
      { name: 'GET_CURRENT_PED_WEAPON', result: 'Hash', params: ['Ped ped'] },
      (ctx: NativeContext, ped) => weapon(ctx, ped),
    ),
  ]
}
