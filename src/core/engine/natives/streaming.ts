import { defineNative, type NativeDefinition, type Side } from '../../natives/index.ts'
import type { NativeContext } from '../context.ts'
import { EntityType } from '../world/entity.ts'

/** Says once per model that a script asked the type of a model that FiveRunner knows nothing of. */
function unknownModel(ctx: NativeContext, native: string, model: number): void {
  ctx.diagnose(
    `${native} was asked of the model 0x${(model >>> 0).toString(16)}, of which FiveRunner knows nothing: it has no list of the models of GTA V, so it says false. Models are vehicles, peds or objects once scripts created entities of them.`,
  )
}

/** Natives of the models that the game of a client streams in, which only clients have. */
export function streamingNatives(side: Side): NativeDefinition<NativeContext>[] {
  if (side === 'server') return []
  /** A native that tells whether a model is of an entity type, as far as the world of the client learned. */
  const isOfType = (name: string, hash: bigint, type: number, shown: string) => {
    const told = new Set<number>()
    return defineNative(
      { name, hash, result: 'BOOL', params: ['Hash model'] },
      (ctx: NativeContext, model) => {
        const kind = ctx.manager.world!.kindOf(model)
        if (kind === EntityType.none && model !== 0 && !told.has(model)) {
          told.add(model)
          unknownModel(ctx, shown, model)
        }
        return kind === type
      },
    )
  }
  return [
    defineNative(
      { name: 'REQUEST_MODEL', hash: 0x963d27a58df860acn, result: 'void', params: ['Hash model'] },
      (ctx: NativeContext, model) => {
        // FiveRunner's CD image has every model but 0.
        if (model !== 0) ctx.manager.world!.request(model)
      },
    ),
    defineNative(
      {
        name: 'HAS_MODEL_LOADED',
        hash: 0x98a4eb5d89a0c952n,
        result: 'BOOL',
        params: ['Hash model'],
      },
      (ctx: NativeContext, model) => ctx.manager.world!.loaded(model),
    ),
    defineNative(
      {
        name: 'IS_MODEL_IN_CDIMAGE',
        hash: 0x35b9e0803292b641n,
        result: 'BOOL',
        params: ['Hash model'],
      },
      (_ctx: NativeContext, model) => model !== 0,
    ),
    defineNative(
      { name: 'IS_MODEL_VALID', hash: 0xc0296a2edf545e92n, result: 'BOOL', params: ['Hash model'] },
      (_ctx: NativeContext, model) => model !== 0,
    ),
    isOfType('IS_MODEL_A_VEHICLE', 0x19aac8f07bfec53en, EntityType.vehicle, 'IsModelAVehicle'),
    isOfType('_IS_MODEL_A_PED', 0x75816577fea6dad5n, EntityType.ped, 'IsModelAPed'),
    // GTA V keeps the models it no longer needs until it wants their memory, which FiveRunner never does.
    defineNative(
      {
        name: 'SET_MODEL_AS_NO_LONGER_NEEDED',
        hash: 0xe532f5d78798daabn,
        result: 'void',
        params: ['Hash model'],
      },
      () => {},
    ),
  ]
}
