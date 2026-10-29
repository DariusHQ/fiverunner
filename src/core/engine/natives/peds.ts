import { defineNative, hashString, type NativeDefinition, type Side } from '../../natives/index.ts'
import type { NativeContext } from '../context.ts'
import { HAIR_COLOURS, MAKEUP_COLOURS, type PedAppearance } from '../world/appearance.ts'
import type { ClientEntity, PedAnim } from '../world/client.ts'
import { EntityType, entityTypeOf } from '../world/entity.ts'
import { clientEntityOf } from './entities.ts'
import { localPlayerIndex } from './players.ts'

/** The ped of a handle on a client, if it names one. */
function pedOf(ctx: NativeContext, handle: number): ClientEntity | undefined {
  const found = clientEntityOf(ctx, handle)
  return found !== undefined && entityTypeOf(found.type) === EntityType.ped ? found : undefined
}

/** The appearance of the ped of a handle on a client, if it names a ped. */
function appearanceOf(ctx: NativeContext, handle: number): PedAppearance | undefined {
  return pedOf(ctx, handle)?.appearance
}

/** The female freemode model, and the male one, which the characters of GTA Online, Qbox and ESX are. */
const FREEMODE_FEMALE = hashString('mp_f_freemode_01')
const FREEMODE = new Set([hashString('mp_m_freemode_01'), FREEMODE_FEMALE])

/**
 * How many drawables the freemode models have of each of their components
 * and props, near what recent builds of GTA V have, and how many textures
 * each has, as FiveRunner has no metadata of models to count them by. Other
 * models have one drawable of each component, of one texture, and no props.
 */
const FREEMODE_DRAWABLES: readonly number[] = [
  46, 200, 80, 200, 150, 100, 110, 150, 200, 50, 150, 400,
]
const FREEMODE_PROPS: readonly number[] = [180, 40, 40, 0, 0, 0, 40, 15]
const FREEMODE_TEXTURES = 10
const COMPONENTS = 12

/** How many drawables a ped has of a component or of a prop. */
function drawablesOf(ped: ClientEntity | undefined, slot: number, prop: boolean): number {
  if (ped === undefined) return 0
  if (FREEMODE.has(ped.model)) return (prop ? FREEMODE_PROPS : FREEMODE_DRAWABLES)[slot] ?? 0
  return !prop && slot >= 0 && slot < COMPONENTS ? 1 : 0
}

/** How many values GTA V has of each head overlay, from blemishes to the extra blemishes of bodies. */
const HEAD_OVERLAY_VALUES: readonly number[] = [24, 29, 34, 15, 75, 7, 12, 11, 10, 18, 17, 12, 2]

/** The flags of TASK_PLAY_ANIM that keep an anim on, as it loops or holds its last frame, and that play it on the secondary task. */
const ANIM_LOOPING = 1
const ANIM_HOLD_LAST_FRAME = 2
const ANIM_SECONDARY = 32
/** How long the clips that play once, for no set duration, play, as FiveRunner has no clips to know their lengths by. */
const CLIP_LENGTH = 1000

/** Whether an anim is of a clip of an anim dict and plays at a time. */
function plays(anim: PedAnim | undefined, dict: string, name: string, now: number): boolean {
  return (
    anim !== undefined &&
    anim.until > now &&
    anim.dict === dict.toLowerCase() &&
    anim.name === name.toLowerCase()
  )
}

/** Natives of the appearance of the peds of clients and of the models of their players. */
export function pedNatives(side: Side): NativeDefinition<NativeContext>[] {
  if (side === 'server') return []
  /** The anim dicts that each client played clips of unloaded, which it is told of once. */
  const unloaded = new WeakMap<object, Set<string>>()
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
    ...(
      [
        ['GET_NUMBER_OF_PED_DRAWABLE_VARIATIONS', 0x27561561732a7842n, 'int componentId'],
        ['GET_NUMBER_OF_PED_PROP_DRAWABLE_VARIATIONS', 0x5faf9754e789fb47n, 'int propId'],
      ] as const
    ).map(([name, hash, slotParam]) =>
      defineNative(
        { name, hash, result: 'int', params: ['Ped ped', slotParam] },
        (ctx: NativeContext, ped, slot) =>
          drawablesOf(pedOf(ctx, ped), slot, slotParam === 'int propId'),
      ),
    ),
    ...(
      [
        ['GET_NUMBER_OF_PED_TEXTURE_VARIATIONS', 0x8f7156a3142a6badn, 'int componentId'],
        ['GET_NUMBER_OF_PED_PROP_TEXTURE_VARIATIONS', 0xa6e7f1ceb523e171n, 'int propId'],
      ] as const
    ).map(([name, hash, slotParam]) =>
      defineNative(
        { name, hash, result: 'int', params: ['Ped ped', slotParam, 'int drawableId'] },
        (ctx: NativeContext, ped, slot, drawable) => {
          const found = pedOf(ctx, ped)
          if (drawable < 0 || drawable >= drawablesOf(found, slot, slotParam === 'int propId')) {
            return 0
          }
          return FREEMODE.has(found!.model) ? FREEMODE_TEXTURES : 1
        },
      ),
    ),
    defineNative(
      {
        name: 'GET_PED_HEAD_OVERLAY_NUM',
        hash: 0xcf1ce768bb43480en,
        result: 'int',
        params: ['int overlayID'],
      },
      (_ctx: NativeContext, overlay) => HEAD_OVERLAY_VALUES[overlay] ?? 0,
    ),
    // The colours of hair and of makeup are FiveRunner's own, as many as GTA V's.
    defineNative(
      { name: '_GET_NUM_HAIR_COLORS', hash: 0xe5c0cf872c2ad150n, result: 'int', params: [] },
      () => HAIR_COLOURS.length,
    ),
    defineNative(
      { name: '_GET_NUM_MAKEUP_COLORS', hash: 0xd1f7ca1535d22818n, result: 'int', params: [] },
      () => MAKEUP_COLOURS.length,
    ),
    ...(
      [
        ['_GET_PED_HAIR_RGB_COLOR', 0x4852fc386e2e1bb5n, 'int hairColorIndex', HAIR_COLOURS],
        ['_GET_PED_MAKEUP_RGB_COLOR', 0x013e5cfc38cd5387n, 'int makeupColorIndex', MAKEUP_COLOURS],
      ] as const
    ).map(([name, hash, index, colours]) =>
      defineNative(
        { name, hash, result: 'void', params: [index, 'int* outR', 'int* outG', 'int* outB'] },
        (_ctx: NativeContext, at, red, green, blue) => {
          const colour = colours[at] ?? 0
          red.set(colour >> 16)
          green.set((colour >> 8) & 0xff)
          blue.set(colour & 0xff)
        },
      ),
    ),
    // FiveRunner has no metadata of models to tell the female ones by, but the female freemode model.
    defineNative(
      { name: 'IS_PED_MALE', hash: 0x6d9f5faa7488ba46n, result: 'BOOL', params: ['Ped ped'] },
      (ctx: NativeContext, ped) => {
        const found = pedOf(ctx, ped)
        return found !== undefined && found.model !== FREEMODE_FEMALE
      },
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
    // Peds play the anims of the anim dicts that are loaded, which only scripts see.
    defineNative(
      {
        name: 'TASK_PLAY_ANIM',
        hash: 0xea47fe3719165b94n,
        result: 'void',
        params: [
          'Ped ped',
          'char* animDictionary',
          'char* animationName',
          'float blendInSpeed',
          'float blendOutSpeed',
          'int duration',
          'int flag',
          'float playbackRate',
          'BOOL lockX',
          'BOOL lockY',
          'BOOL lockZ',
        ],
      },
      (ctx: NativeContext, ped, dict, name, _blendIn, _blendOut, duration, flag) => {
        const found = pedOf(ctx, ped)
        if (found === undefined) return
        if (!ctx.manager.world!.assetLoaded('anim', dict ?? '')) {
          const told = unloaded.get(ctx.manager) ?? new Set<string>()
          unloaded.set(ctx.manager, told)
          const key = (dict ?? '').toLowerCase()
          if (!told.has(key)) {
            told.add(key)
            ctx.diagnose(
              `TaskPlayAnim was given the anim dict ${dict ?? ''}, which is not loaded, so the ped played nothing, as in GTA V: request it with RequestAnimDict, then wait until HasAnimDictLoaded says it loaded.`,
            )
          }
          return
        }
        const held = (flag & (ANIM_LOOPING | ANIM_HOLD_LAST_FRAME)) !== 0
        const anim = {
          dict: (dict ?? '').toLowerCase(),
          name: (name ?? '').toLowerCase(),
          until: ctx.manager.time() + (duration > 0 ? duration : held ? Infinity : CLIP_LENGTH),
        }
        if ((flag & ANIM_SECONDARY) !== 0) found.secondaryAnim = anim
        else found.anim = anim
      },
    ),
    defineNative(
      {
        name: 'IS_ENTITY_PLAYING_ANIM',
        hash: 0x1f0b79228e461ec9n,
        result: 'BOOL',
        params: ['Entity entity', 'char* animDict', 'char* animName', 'int taskFlag'],
      },
      (ctx: NativeContext, entity, dict, name) => {
        const found = pedOf(ctx, entity)
        const now = ctx.manager.time()
        return (
          found !== undefined &&
          (plays(found.anim, dict ?? '', name ?? '', now) ||
            plays(found.secondaryAnim, dict ?? '', name ?? '', now))
        )
      },
    ),
    defineNative(
      {
        name: 'STOP_ANIM_TASK',
        hash: 0x97ff36a1d40ea00an,
        result: 'void',
        params: ['Ped ped', 'char* animDictionary', 'char* animationName', 'float animExitSpeed'],
      },
      (ctx: NativeContext, ped, dict, name) => {
        const found = pedOf(ctx, ped)
        if (found === undefined) return
        const now = ctx.manager.time()
        if (plays(found.anim, dict ?? '', name ?? '', now)) found.anim = undefined
        if (plays(found.secondaryAnim, dict ?? '', name ?? '', now)) found.secondaryAnim = undefined
      },
    ),
    // Clearing the tasks of peds stops their anims, and clearing them at once takes them out of their vehicles too.
    ...(
      [
        ['CLEAR_PED_TASKS', 0xe1ef3c1216aff2cdn, false],
        ['CLEAR_PED_TASKS_IMMEDIATELY', 0xaaa34f8a7cb32098n, true],
      ] as const
    ).map(([name, hash, immediately]) =>
      defineNative(
        { name, hash, result: 'void', params: ['Ped ped'] },
        (ctx: NativeContext, ped) => {
          const found = pedOf(ctx, ped)
          if (found === undefined) return
          found.anim = found.secondaryAnim = undefined
          if (immediately) found.leaveVehicle()
        },
      ),
    ),
    defineNative(
      {
        name: 'CLEAR_PED_SECONDARY_TASK',
        hash: 0x176cecf6f920d707n,
        result: 'void',
        params: ['Ped ped'],
      },
      (ctx: NativeContext, ped) => {
        const found = pedOf(ctx, ped)
        if (found !== undefined) found.secondaryAnim = undefined
      },
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
