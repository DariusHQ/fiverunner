/** A head overlay of a ped, such as a beard or makeup, as SET_PED_HEAD_OVERLAY and its colours set it. */
export interface HeadOverlay {
  value: number
  opacity: number
  colourType: number
  firstColour: number
  secondColour: number
}

/** The head blend of a ped, as SET_PED_HEAD_BLEND_DATA sets it: the faces and skins of its parents, and how they mix. */
export type HeadBlend = readonly [
  shapeFirst: number,
  shapeSecond: number,
  shapeThird: number,
  skinFirst: number,
  skinSecond: number,
  skinThird: number,
  shapeMix: number,
  skinMix: number,
  thirdMix: number,
]

/**
 * The appearance of a ped, as scripts set it: the drawable, texture and
 * palette of each component, the drawable and texture of each prop, its
 * head overlays, face features, hair and eye colours and head blend. A new
 * ped has the first variation of every component, no props and no head
 * overlays, which GTA V gives the value 255.
 */
export class PedAppearance {
  readonly components = new Map<
    number,
    readonly [drawable: number, texture: number, palette: number]
  >()
  readonly props = new Map<number, readonly [drawable: number, texture: number]>()
  readonly overlays = new Map<number, HeadOverlay>()
  readonly faceFeatures = new Map<number, number>()
  hair = 0
  highlight = 0
  eyes = 0
  headBlend: HeadBlend = [0, 0, 0, 0, 0, 0, 0, 0, 0]

  /** The head overlay of an index, which is none until scripts set it. */
  overlay(index: number): HeadOverlay {
    let found = this.overlays.get(index)
    if (found === undefined) {
      found = { value: 255, opacity: 0, colourType: 0, firstColour: 0, secondColour: 0 }
      this.overlays.set(index, found)
    }
    return found
  }
}

/**
 * The colours of hair, as RGB, which FiveRunner draws its own of, as many as
 * GTA V has, as it has none of GTA V's: natural shades from black through
 * browns to platinum, reds from auburn to strawberry blonde, colours of
 * fashion, then greys up to white.
 */
export const HAIR_COLOURS: readonly number[] = [
  0x0a0807, 0x1a1310, 0x261b15, 0x33241b, 0x3f2c20, 0x4c3626, 0x5a4030, 0x684b37, 0x76563e,
  0x846246, 0x93704f, 0xa27f5b, 0xb08d66, 0xbc9b72, 0xc7a97f, 0xd1b68c, 0xdac39b, 0xe2cfaa,
  0xe9dbbb, 0xefe5cc, 0xf4eedd, 0x3d1a12, 0x52221a, 0x6b2b1c, 0x85341e, 0x9e3f20, 0xb84d24,
  0xcc5f2c, 0xd9773d, 0xe3955e, 0x3b1f4f, 0x55286f, 0x7239a0, 0x9152c7, 0xb57ee0, 0x6d1846,
  0x9c1f5e, 0xc92f7b, 0xe35a9c, 0xf08fbd, 0x1b2c6b, 0x23449e, 0x2f67c9, 0x4f93e3, 0x86bdf0,
  0x0f4f57, 0x157a80, 0x1fa3a3, 0x1d5a2c, 0x2a8a3c, 0x57b947, 0xa4d63e, 0xe8c62a, 0xf0a124,
  0xe86d1f, 0xc9301e, 0x2b2b2d, 0x444547, 0x5f6063, 0x7c7d80, 0x9c9da0, 0xbcbdbf, 0xdadbdc,
  0xf3f3f1,
]

/**
 * The colours of makeup, as RGB, FiveRunner's own, as many as GTA V has: eight
 * shades, dark to light, of each of reds, pinks, corals, nudes, plums,
 * blues, greens and golds.
 */
export const MAKEUP_COLOURS: readonly number[] = [
  0x5a0d14, 0x7a1220, 0x9b1b2a, 0xb8233a, 0xcf3347, 0xe04c5c, 0xec6d77, 0xf39298, 0x6b1438,
  0x8c1d4b, 0xad2a62, 0xc93d7a, 0xdc5891, 0xe877a8, 0xf198c0, 0xf7bad6, 0x7a2a14, 0x9c3a1c,
  0xbf4f26, 0xd96535, 0xe8804c, 0xf09c6b, 0xf5b78f, 0xf9d1b4, 0x3d2419, 0x57352a, 0x74493a,
  0x8f5f4d, 0xa87763, 0xbf907d, 0xd3aa98, 0xe5c6b7, 0x3a1640, 0x522058, 0x6c2c73, 0x87398f,
  0xa04ea8, 0xb76bbd, 0xcb8fd1, 0xdfb6e3, 0x121d4a, 0x1a2c6b, 0x22418f, 0x2d5bb3, 0x4479cc,
  0x6497dd, 0x8ab5ea, 0xb3d1f4, 0x0e3a31, 0x145546, 0x1c705c, 0x258c73, 0x37a68b, 0x5abda4,
  0x86d1bd, 0xb5e4d7, 0x3d2f12, 0x5e481b, 0x806226, 0xa07e35, 0xbf9b4c, 0xd6b66d, 0xe8cf96,
  0xf5e6c4,
]
