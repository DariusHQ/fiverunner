import { defineNative, type NativeDefinition, type Side } from '../../natives/index.ts'
import type { NativeContext } from '../context.ts'
import type { PedAppearance } from '../world/appearance.ts'
import { EntityType, entityTypeOf } from '../world/entity.ts'
import { clientEntityOf } from './entities.ts'
import { localPlayerIndex } from './players.ts'

/** The appearance of the ped of a handle on a client, if it names a ped. */
function appearanceOf(ctx: NativeContext, handle: number): PedAppearance | undefined {
  const found = clientEntityOf(ctx, handle)
  return found !== undefined && entityTypeOf(found.type) === EntityType.ped
    ? found.appearance
    : undefined
}

/** Natives of the appearance of the peds of clients and of the models of their players. */
export function pedNatives(side: Side): NativeDefinition<NativeContext>[] {
  if (side === 'server') return []
  return [
    defineNative(
      {
        name: 'SET_PED_COMPONENT_VARIATION',
        hash: 0x262b14f48d29de80n,
        result: 'void',
        params: ['Ped ped', 'int componentId', 'int drawableId', 'int textureId', 'int paletteId'],
      },
      (ctx: NativeContext, ped, component, drawable, texture, palette) =>
        appearanceOf(ctx, ped)?.components.set(component, [drawable, texture, palette]),
    ),
    ...(
      [
        ['GET_PED_DRAWABLE_VARIATION', 0x67f3780dd425d4fcn, 0],
        ['GET_PED_TEXTURE_VARIATION', 0x04a355e041e004e6n, 1],
        ['GET_PED_PALETTE_VARIATION', 0xe3dd5f2a84b42281n, 2],
      ] as const
    ).map(([name, hash, part]) =>
      defineNative(
        { name, hash, result: 'int', params: ['Ped ped', 'int componentId'] },
        (ctx: NativeContext, ped, component) =>
          appearanceOf(ctx, ped)?.components.get(component)?.[part] ?? 0,
      ),
    ),
    defineNative(
      {
        name: 'SET_PED_DEFAULT_COMPONENT_VARIATION',
        hash: 0x45eee61580806d63n,
        result: 'void',
        params: ['Ped ped'],
      },
      (ctx: NativeContext, ped) => appearanceOf(ctx, ped)?.components.clear(),
    ),
    defineNative(
      {
        name: 'SET_PED_PROP_INDEX',
        hash: 0x93376b65a266eb5fn,
        result: 'void',
        params: ['Ped ped', 'int componentId', 'int drawableId', 'int textureId', 'BOOL attach'],
      },
      (ctx: NativeContext, ped, prop, drawable, texture) =>
        appearanceOf(ctx, ped)?.props.set(prop, [drawable, texture]),
    ),
    // A ped wears no prop until scripts give it one, which GTA V tells with -1.
    ...(
      [
        ['GET_PED_PROP_INDEX', 0x898cc20ea75bacd8n, 0],
        ['GET_PED_PROP_TEXTURE_INDEX', 0xe131a28626f81ab2n, 1],
      ] as const
    ).map(([name, hash, part]) =>
      defineNative(
        { name, hash, result: 'int', params: ['Ped ped', 'int componentId'] },
        (ctx: NativeContext, ped, prop) => appearanceOf(ctx, ped)?.props.get(prop)?.[part] ?? -1,
      ),
    ),
    defineNative(
      {
        name: 'CLEAR_PED_PROP',
        hash: 0x0943e5b8e078e76en,
        result: 'void',
        params: ['Ped ped', 'int propId'],
      },
      (ctx: NativeContext, ped, prop) => appearanceOf(ctx, ped)?.props.delete(prop),
    ),
    defineNative(
      {
        name: 'CLEAR_ALL_PED_PROPS',
        hash: 0xcd8a7537a9b52f06n,
        result: 'void',
        params: ['Ped ped'],
      },
      (ctx: NativeContext, ped) => appearanceOf(ctx, ped)?.props.clear(),
    ),
    defineNative(
      {
        name: 'SET_PED_HEAD_OVERLAY',
        hash: 0x48f44967fa05cc1en,
        result: 'void',
        params: ['Ped ped', 'int overlayID', 'int index', 'float opacity'],
      },
      (ctx: NativeContext, ped, index, value, opacity) => {
        const overlay = appearanceOf(ctx, ped)?.overlay(index)
        if (overlay !== undefined) Object.assign(overlay, { value, opacity })
      },
    ),
    defineNative(
      {
        name: 'SET_PED_HEAD_OVERLAY_COLOR',
        hash: 0x497bf74a7b9cb952n,
        result: 'void',
        params: ['Ped ped', 'int overlayID', 'int colorType', 'int colorID', 'int secondColorID'],
      },
      (ctx: NativeContext, ped, index, colourType, firstColour, secondColour) => {
        const overlay = appearanceOf(ctx, ped)?.overlay(index)
        if (overlay !== undefined) Object.assign(overlay, { colourType, firstColour, secondColour })
      },
    ),
    defineNative(
      {
        name: 'GET_PED_HEAD_OVERLAY_VALUE',
        hash: 0xa60ef3b6461a4d43n,
        result: 'int',
        params: ['Ped ped', 'int overlayID'],
      },
      (ctx: NativeContext, ped, index) => appearanceOf(ctx, ped)?.overlay(index).value ?? 255,
    ),
    defineNative(
      {
        name: 'GET_PED_HEAD_OVERLAY_DATA',
        result: 'BOOL',
        params: [
          'Ped ped',
          'int index',
          'int* overlayValue',
          'int* colourType',
          'int* firstColour',
          'int* secondColour',
          'float* overlayOpacity',
        ],
      },
      (ctx: NativeContext, ped, index, value, colourType, firstColour, secondColour, opacity) => {
        const overlay = appearanceOf(ctx, ped)?.overlay(index)
        if (overlay === undefined) return false
        value.set(overlay.value)
        colourType.set(overlay.colourType)
        firstColour.set(overlay.firstColour)
        secondColour.set(overlay.secondColour)
        opacity.set(overlay.opacity)
        return true
      },
    ),
    defineNative(
      {
        name: 'SET_PED_FACE_FEATURE',
        hash: 0x71a5c1dba060049en,
        result: 'void',
        params: ['Ped ped', 'int index', 'float scale'],
      },
      (ctx: NativeContext, ped, index, scale) =>
        appearanceOf(ctx, ped)?.faceFeatures.set(index, scale),
    ),
    defineNative(
      { name: 'GET_PED_FACE_FEATURE', result: 'float', params: ['Ped ped', 'int index'] },
      (ctx: NativeContext, ped, index) => appearanceOf(ctx, ped)?.faceFeatures.get(index) ?? 0,
    ),
    defineNative(
      {
        name: 'SET_PED_HAIR_TINT',
        hash: 0x4cffc65454c93a49n,
        result: 'void',
        params: ['Ped ped', 'int colorID', 'int highlightColorID'],
      },
      (ctx: NativeContext, ped, hair, highlight) => {
        const appearance = appearanceOf(ctx, ped)
        if (appearance !== undefined) Object.assign(appearance, { hair, highlight })
      },
    ),
    // The getters of FiveM give -1 for no ped.
    defineNative(
      { name: 'GET_PED_HAIR_COLOR', result: 'int', params: ['Ped ped'] },
      (ctx: NativeContext, ped) => appearanceOf(ctx, ped)?.hair ?? -1,
    ),
    defineNative(
      { name: 'GET_PED_HAIR_HIGHLIGHT_COLOR', result: 'int', params: ['Ped ped'] },
      (ctx: NativeContext, ped) => appearanceOf(ctx, ped)?.highlight ?? -1,
    ),
    defineNative(
      {
        name: 'SET_PED_EYE_COLOR',
        hash: 0x50b56988b170afdfn,
        result: 'void',
        params: ['Ped ped', 'int index'],
      },
      (ctx: NativeContext, ped, eyes) => {
        const appearance = appearanceOf(ctx, ped)
        if (appearance !== undefined) appearance.eyes = eyes
      },
    ),
    defineNative(
      { name: 'GET_PED_EYE_COLOR', result: 'int', params: ['Ped ped'] },
      (ctx: NativeContext, ped) => appearanceOf(ctx, ped)?.eyes ?? -1,
    ),
    defineNative(
      {
        name: 'SET_PED_HEAD_BLEND_DATA',
        hash: 0x9414e18b9434c2fen,
        result: 'void',
        params: [
          'Ped ped',
          'int shapeFirstID',
          'int shapeSecondID',
          'int shapeThirdID',
          'int skinFirstID',
          'int skinSecondID',
          'int skinThirdID',
          'float shapeMix',
          'float skinMix',
          'float thirdMix',
        ],
      },
      (ctx: NativeContext, ped, ...blend) => {
        const appearance = appearanceOf(ctx, ped)
        if (appearance !== undefined) appearance.headBlend = blend
      },
    ),
    // GTA V writes a struct of fields 8 bytes apart, as many pointers of FiveM's Lua are.
    defineNative(
      {
        name: 'GET_PED_HEAD_BLEND_DATA',
        hash: 0x2746bd9d88c5c5d0n,
        result: 'BOOL',
        params: [
          'Ped ped',
          'int* shapeFirst',
          'int* shapeSecond',
          'int* shapeThird',
          'int* skinFirst',
          'int* skinSecond',
          'int* skinThird',
          'float* shapeMix',
          'float* skinMix',
          'float* thirdMix',
        ],
      },
      (ctx: NativeContext, ped, ...fields) => {
        const appearance = appearanceOf(ctx, ped)
        if (appearance === undefined) return false
        fields.forEach((field, index) => field.set(appearance.headBlend[index]!))
        return true
      },
    ),
    // Tattoos are only drawn, and nothing damages peds to lose their props.
    defineNative(
      {
        name: 'ADD_PED_DECORATION_FROM_HASHES',
        hash: 0x5f5d1665e352a839n,
        result: 'void',
        params: ['Ped ped', 'Hash collection', 'Hash overlay'],
      },
      () => {},
    ),
    defineNative(
      {
        name: 'CLEAR_PED_DECORATIONS',
        hash: 0x0e5173c163976e38n,
        result: 'void',
        params: ['Ped ped'],
      },
      () => {},
    ),
    defineNative(
      {
        name: 'SET_PED_CAN_LOSE_PROPS_ON_DAMAGE',
        hash: 0xe861d0b05c7662b8n,
        result: 'void',
        params: ['Ped ped', 'BOOL toggle'],
      },
      () => {},
    ),
    defineNative(
      { name: 'IS_PED_FALLING', hash: 0xfb92a102f1c4dfa3n, result: 'BOOL', params: ['Ped ped'] },
      () => false,
    ),
    defineNative(
      {
        name: 'SET_PLAYER_MODEL',
        hash: 0x00a1cadd00108836n,
        result: 'void',
        params: ['Player player', 'Hash model'],
      },
      (ctx: NativeContext, player, model) => {
        const world = ctx.manager.world!
        if (player !== localPlayerIndex(ctx) || model === 0) return
        if (!world.loaded(model)) {
          ctx.diagnose(
            'SetPlayerModel was given a model that is not loaded, so the player kept its ped, as GTA V does: request it with RequestModel, then wait until HasModelLoaded says it loaded.',
          )
          return
        }
        world.changePlayerModel(model)
      },
    ),
  ]
}
