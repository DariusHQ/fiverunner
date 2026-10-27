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
    ...assetNatives('anim', 'char* animDict', {
      request: ['REQUEST_ANIM_DICT', 0xd3bd40951412fef6n],
      loaded: ['HAS_ANIM_DICT_LOADED', 0xd031a9162d01088cn],
      remove: ['REMOVE_ANIM_DICT', 0xf66a602f829e2a06n],
      exists: ['DOES_ANIM_DICT_EXIST', 0x2da49c3b79856961n],
    }),
    ...assetNatives('animset', 'char* animSet', {
      request: ['REQUEST_ANIM_SET', 0x6ea47dae7fad0eedn],
      loaded: ['HAS_ANIM_SET_LOADED', 0xc4ea073d86fb29b0n],
      remove: ['REMOVE_ANIM_SET', 0x16350528f93024b3n],
    }),
    ...assetNatives('clipset', 'char* clipSet', {
      request: ['REQUEST_CLIP_SET', 0xd2a71e1a77418a49n],
      loaded: ['HAS_CLIP_SET_LOADED', 0x318234f4f3738af3n],
      remove: ['REMOVE_CLIP_SET', 0x01f73a131c18cd94n],
    }),
    ...assetNatives(
      'texture',
      'char* textureDict',
      {
        request: ['REQUEST_STREAMED_TEXTURE_DICT', 0xdfa2ef8e04127dd5n],
        loaded: ['HAS_STREAMED_TEXTURE_DICT_LOADED', 0x0145f696aaaad2e4n],
        remove: ['SET_STREAMED_TEXTURE_DICT_AS_NO_LONGER_NEEDED', 0xbe2caccf5a8aa805n],
      },
      ['BOOL p1'],
    ),
    ...assetNatives('ptfx', 'char* fxName', {
      request: ['REQUEST_NAMED_PTFX_ASSET', 0xb80d8756b4668ab6n],
      loaded: ['HAS_NAMED_PTFX_ASSET_LOADED', 0x8702416e512ec454n],
      remove: ['REMOVE_NAMED_PTFX_ASSET', 0x5f61ebbe1a00f96dn],
    }),
    ...assetNatives(
      'weapon',
      'Hash weaponHash',
      {
        request: ['REQUEST_WEAPON_ASSET', 0x5443438f033e29c3n],
        loaded: ['HAS_WEAPON_ASSET_LOADED', 0x36e353271f0e90een],
        remove: ['REMOVE_WEAPON_ASSET', 0xaa08ef13f341c8fcn],
      },
      ['int p1', 'int p2'],
    ),
    defineNative(
      { name: 'REQUEST_IPL', hash: 0x41b4893843bbdb74n, result: 'void', params: ['char* iplName'] },
      (ctx: NativeContext, ipl) => {
        if (ipl) ctx.manager.world!.ipls.add(ipl.toLowerCase())
      },
    ),
    defineNative(
      { name: 'REMOVE_IPL', hash: 0xee6c5ad3ece0a82dn, result: 'void', params: ['char* iplName'] },
      (ctx: NativeContext, ipl) => {
        ctx.manager.world!.ipls.delete((ipl ?? '').toLowerCase())
      },
    ),
    defineNative(
      {
        name: 'IS_IPL_ACTIVE',
        hash: 0x88a741e44a2b3495n,
        result: 'BOOL',
        params: ['char* iplName'],
      },
      (ctx: NativeContext, ipl) => ctx.manager.world!.ipls.has((ipl ?? '').toLowerCase()),
    ),
  ]
}

/**
 * The natives that request assets of a kind, tell whether they loaded, let
 * go of them, and tell whether they exist: every asset but those of no name
 * or of hash 0 exists, and loads at the next tick once a script requests it,
 * which it stays, as models do.
 */
function assetNatives(
  kind: string,
  param:
    | 'char* animDict'
    | 'char* animSet'
    | 'char* clipSet'
    | 'char* textureDict'
    | 'char* fxName'
    | 'Hash weaponHash',
  natives: {
    readonly request: readonly [string, bigint]
    readonly loaded: readonly [string, bigint]
    readonly remove: readonly [string, bigint]
    readonly exists?: readonly [string, bigint]
  },
  requestParams: readonly ('BOOL p1' | 'int p1' | 'int p2')[] = [],
): NativeDefinition<NativeContext>[] {
  const nameOf = (asset: string | number | null) =>
    typeof asset === 'number' ? (asset === 0 ? '' : String(asset >>> 0)) : (asset ?? '')
  const [request, requestHash] = natives.request
  const [loaded, loadedHash] = natives.loaded
  const [remove, removeHash] = natives.remove
  return [
    defineNative(
      { name: request, hash: requestHash, result: 'void', params: [param, ...requestParams] },
      (ctx: NativeContext, asset) => {
        const name = nameOf(asset)
        if (name !== '') ctx.manager.world!.requestAsset(kind, name)
      },
    ),
    defineNative(
      { name: loaded, hash: loadedHash, result: 'BOOL', params: [param] },
      (ctx: NativeContext, asset) => ctx.manager.world!.assetLoaded(kind, nameOf(asset)),
    ),
    defineNative({ name: remove, hash: removeHash, result: 'void', params: [param] }, () => {}),
    ...(natives.exists === undefined
      ? []
      : [
          defineNative(
            { name: natives.exists[0], hash: natives.exists[1], result: 'BOOL', params: [param] },
            (_ctx: NativeContext, asset) => nameOf(asset) !== '',
          ),
        ]),
  ]
}
