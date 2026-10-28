import { hashString } from '../../natives/index.ts'

/** The hash of the fists of peds, which they hold when they hold no weapon. */
export const UNARMED = hashString('WEAPON_UNARMED')

/** A weapon that a ped has: its ammunition, the components on it and its tint. */
export interface PedWeapon {
  ammo: number
  readonly components: Set<number>
  tint: number
}
