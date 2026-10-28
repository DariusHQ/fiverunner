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
