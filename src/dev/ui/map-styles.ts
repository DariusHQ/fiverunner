import { HAIR_COLOURS } from '../../core/engine/world/appearance.ts'
import type { DevBlip, DevEntity, DevLook } from '../map.ts'
import { drawIcon, iconOf } from './map-icons.ts'

/** The colours that the map gives the colour ids of blips: FiveRunner's own, near those that GTA V names. */
const BLIP_COLOURS: readonly string[] = [
  '#f0f0f0',
  '#e04646',
  '#6fcf6f',
  '#5a9ef0',
  '#f0f0f0',
  '#f0d24a',
  '#e57373',
  '#b07ee0',
  '#f080c0',
  '#f0b070',
  '#c8a070',
  '#90e090',
  '#80c8f0',
  '#c8a0f0',
  '#7050b0',
  '#50d0d0',
  '#f0e090',
  '#f09030',
  '#6aa8f0',
  '#c05090',
  '#c0a030',
  '#d07020',
  '#b0b0b0',
  '#f0b0d0',
  '#c0e050',
  '#3a8a3a',
  '#4060f0',
  '#a040f0',
  '#806050',
  '#304090',
  '#208080',
  '#b09070',
  '#90c0f0',
  '#f0e8a0',
  '#f0a8c0',
  '#f08080',
  '#e0d0a0',
  '#f4f4f4',
  '#3c78e0',
  '#c0c0c0',
  '#606060',
  '#f06080',
  '#4c8ce0',
  '#a0e0a0',
  '#f0c080',
  '#f8f8f8',
  '#e0b030',
  '#f08c28',
  '#f050a0',
  '#d83c3c',
  '#9070d0',
  '#f09080',
  '#2c7a3c',
  '#a0d8f0',
  '#3c6e7a',
  '#c0c8d0',
  '#8a5a30',
  '#4a80e0',
  '#4a5a8a',
  '#e04848',
  '#f0b040',
  '#c04890',
  '#d0d0d0',
  '#3a7aa0',
  '#c86020',
  '#8a7a9a',
  '#f0b440',
  '#4a88e8',
  '#5090e8',
  '#58c058',
  '#f0b848',
  '#f0bc4c',
  '#202020',
  '#f0b040',
  '#4888e0',
  '#e04040',
  '#a02828',
  '#4888e8',
  '#5090f0',
  '#284080',
  '#505050',
  '#f0d840',
  '#a0e040',
  '#9050c0',
  '#4878d8',
  '#484848',
]

/** The colours of the players of the session, by their numbers. */
const PLAYER_COLOURS: readonly string[] = [
  '#f0a030',
  '#4fd6e0',
  '#d070f0',
  '#5fd068',
  '#ff5c5c',
  '#5c8dff',
]

/** The sprite of the waypoint of players. */
export const WAYPOINT = 8

/** How far apart the lines of the grid may be, in metres. */
const STEPS = [10, 25, 50, 100, 250, 500, 1000, 2000]

/** The fonts of the styles, of the system, as the dev UI loads none: a condensed one for GTA V, a round one for the cartoon. */
const CONDENSED =
  "Bahnschrift, 'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', Arial, sans-serif"
const ROUNDED = "'Nunito', 'Varela Round', 'Segoe UI', system-ui, sans-serif"

/** The #rrggbb of a hue, a saturation and a lightness, the last two from 0 to 1. */
function hsl(hue: number, saturation: number, light: number): string {
  const a = saturation * Math.min(light, 1 - light)
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12
    const value = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

/** The colour of a blip of a colour id: the map's own for those it names, and a hue of their own for others. */
export function blipColour(colour: number): string {
  return BLIP_COLOURS[colour] ?? hsl((colour * 137.5) % 360, 0.7, 0.62)
}

export function playerColour(client: number): string {
  return PLAYER_COLOURS[(client - 1) % PLAYER_COLOURS.length]!
}

/** The red, green and blue of a #rrggbb, from 0 to 255. */
function channels(colour: string): [number, number, number] {
  const n = Number.parseInt(colour.slice(1, 7), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** `colour` lighter by `amount`, from 0 to 1, or darker if it is negative. */
function shade(colour: string, amount: number): string {
  const [r, g, b] = channels(colour).map((value) =>
    Math.round(amount < 0 ? value * (1 + amount) : value + (255 - value) * amount),
  )
  return `rgb(${r} ${g} ${b})`
}

/** How light a colour looks, from 0 for black to 1 for white. */
function lightness(colour: string): number {
  const [r, g, b] = channels(colour).map((value) => (value / 255) ** 2.2)
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** A player of the session, as the map draws them. */
export interface MapPlayer {
  readonly client: number
  readonly name: string | undefined
  readonly colour: string
  /** How the ped of the player looks, if the map has it. */
  readonly look?: DevLook
}

/** What a style draws the map on: its canvas, where the map looks, and the time of the frame, in milliseconds. */
export interface Painter {
  readonly context: CanvasRenderingContext2D
  readonly width: number
  readonly height: number
  /** How many pixels of the screen a pixel of the canvas takes. */
  readonly ratio: number
  /** How many pixels a metre takes. */
  readonly scale: number
  readonly time: number
  toScreen(x: number, y: number): [number, number]
  toWorld(sx: number, sy: number): [number, number]
  /** Takes a rectangle of the canvas for a label, unless another label has it, or the label must show: whether the label may show. */
  claim(x: number, y: number, width: number, height: number, must?: boolean): boolean
  /** How much of a rectangle of the canvas the labels and marks that took room have, in square pixels. */
  crowding(x: number, y: number, width: number, height: number): number
  /** Whether the map draws the world alone, as behind the screens of players, without the labels of its grid. */
  readonly bare?: boolean
}

/** How far into the canvas a style draws over the map from each of its edges, in pixels. */
export interface Insets {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

/** How a style draws the world of the session, from the ground up. */
export interface MapStyle {
  readonly name: string
  /** Whether it moves of itself, which redraws the map at each frame. */
  readonly animated: boolean
  /** Whether it shows how to use the map, as the pause menu of GTA V does, which the toolbar then leaves to it. */
  readonly instructions?: boolean
  /** What it covers of the edges of a canvas of a size, which the map fits what is on it clear of. */
  insets?(width: number, height: number): Insets
  background(p: Painter, blips: readonly DevBlip[]): void
  area(p: Painter, blip: DevBlip, sx: number, sy: number): void
  route(
    p: Painter,
    from: readonly [number, number],
    to: readonly [number, number],
    colour: string,
  ): void
  /** Draws a blip, which the cursor hovers if `hovered`. */
  blip(p: Painter, blip: DevBlip, sx: number, sy: number, hovered: boolean): void
  /** Writes the name of a blip by it, where no other label or mark is, or anyway if it `must`. */
  label(p: Painter, name: string, sx: number, sy: number, must: boolean): void
  /** Writes the name of a player, in their colour, by where they are, which shows whatever else is there. */
  tag(p: Painter, name: string, colour: string, sx: number, sy: number): void
  /**
   * Draws an entity, the ped of a player in their colour, which moves if
   * `moving`, and gives where on the canvas the cursor takes it.
   */
  entity(
    p: Painter,
    entity: DevEntity,
    sx: number,
    sy: number,
    moving: boolean,
    player?: MapPlayer,
  ): readonly [number, number]
  /** Draws a player that the cursor drags from where they are to where it is. */
  dragging?(
    p: Painter,
    from: readonly [number, number],
    to: readonly [number, number],
    player: MapPlayer,
  ): void
  /** Draws what goes over the map, such as a legend of its blips, for its players and the one whose blips it shows, if one. */
  overlay?(
    p: Painter,
    blips: readonly DevBlip[],
    players: readonly MapPlayer[],
    whose: number | undefined,
  ): void
}

/** The grid of metres of a map, in its colours, with the labels of its lines `top` pixels down. */
function grid(
  p: Painter,
  colours: { readonly line: string; readonly axis: string; readonly text: string },
  font: string,
  dash: readonly number[] = [],
  top = 0,
): void {
  const { context, width, height } = p
  const step = STEPS.find((each) => each * p.scale >= 70) ?? STEPS.at(-1)!
  const [left, worldTop] = p.toWorld(0, 0)
  const [right, bottom] = p.toWorld(width, height)
  context.lineWidth = 1
  context.font = font
  context.fillStyle = colours.text
  context.setLineDash(dash)
  for (let x = Math.ceil(left / step) * step; x <= right; x += step) {
    const [sx] = p.toScreen(x, 0)
    context.strokeStyle = x === 0 ? colours.axis : colours.line
    context.beginPath()
    context.moveTo(Math.round(sx) + 0.5, 0)
    context.lineTo(Math.round(sx) + 0.5, height)
    context.stroke()
    if (p.bare !== true) context.fillText(String(x), sx + 3, top + 12)
  }
  for (let y = Math.ceil(bottom / step) * step; y <= worldTop; y += step) {
    const [, sy] = p.toScreen(0, y)
    context.strokeStyle = y === 0 ? colours.axis : colours.line
    context.beginPath()
    context.moveTo(0, Math.round(sy) + 0.5)
    context.lineTo(width, Math.round(sy) + 0.5)
    context.stroke()
    if (sy > top + 20 && p.bare !== true) context.fillText(String(y), 3, sy - 3)
  }
  context.setLineDash([])
}

/**
 * Takes the first of `places`, the top left corners of a label of a size,
 * where no other label or mark is, or the least crowded of them if the
 * label must show: the index of the place that the label takes, if any.
 */
function place(
  p: Painter,
  width: number,
  height: number,
  places: readonly (readonly [number, number])[],
  must: boolean,
): number | undefined {
  const found = places.findIndex(([x, y]) => p.claim(x, y, width, height))
  if (found >= 0) return found
  if (!must) return undefined
  const crowding = places.map(([x, y]) => p.crowding(x, y, width, height))
  const least = crowding.indexOf(Math.min(...crowding))
  p.claim(...places[least]!, width, height, true)
  return least
}

/** Where a label may go by a point, as its baseline and how it aligns there, in the order it tries them. */
type Anchor = readonly [x: number, y: number, align: 'left' | 'center' | 'right']

/** Writes `text` outlined, so that it reads over anything, at the first of its anchors that has room for it, or the least crowded if it must show. */
function outlined(
  p: Painter,
  text: string,
  anchors: readonly Anchor[],
  fill: string,
  outline: string,
  font: string,
  must = false,
): void {
  const { context } = p
  context.font = font
  const width = context.measureText(text).width
  const left = ([x, , align]: Anchor) =>
    align === 'center' ? x - width / 2 : align === 'right' ? x - width : x
  const index = place(
    p,
    width + 4,
    16,
    anchors.map((anchor) => [left(anchor) - 2, anchor[1] - 12]),
    must,
  )
  if (index === undefined) return
  const x = left(anchors[index]!)
  const y = anchors[index]![1]
  context.lineJoin = 'round'
  context.lineWidth = 3
  context.strokeStyle = outline
  context.strokeText(text, x, y)
  context.fillStyle = fill
  context.fillText(text, x, y)
  context.lineWidth = 1
}

/** The turn of an entity on the canvas, in radians, clockwise from the north. */
const turnOf = (entity: DevEntity) => (-entity.heading * Math.PI) / 180

/** A number of its own for a cell of the world, from 0 to 1, which stays the same as the map moves. */
function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return n - Math.floor(n)
}

/** The slopes of the noise at the points of its grid, as cosines then sines, of 256 ways round. */
const SLOPES = Float64Array.from({ length: 512 }, (_, k) => {
  const angle = (Math.floor(k / 2) / 256) * Math.PI * 2
  return k % 2 === 0 ? Math.cos(angle) : Math.sin(angle)
})

/** Which of the slopes a point of the grid of the noise has, from a hash of integers, which is quicker than `hash`. */
function slopeOf(ix: number, iy: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  return ((h ^ (h >>> 13)) & 255) * 2
}

/** Smooth noise of the plane, from about 0 to 1, whose hills are about a unit apart: gradient noise, which shows no grid. */
function noise(x: number, y: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
  const slope = (ix: number, iy: number) => {
    const k = slopeOf(ix, iy)
    return SLOPES[k]! * (x - ix) + SLOPES[k + 1]! * (y - iy)
  }
  const sx = fade(x - x0)
  const sy = fade(y - y0)
  const top = slope(x0, y0) + (slope(x0 + 1, y0) - slope(x0, y0)) * sx
  const bottom = slope(x0, y0 + 1) + (slope(x0 + 1, y0 + 1) - slope(x0, y0 + 1)) * sx
  return 0.5 + (top + (bottom - top) * sy) * 0.75
}

/** Two octaves of noise, the second turned off the axes of the first. */
function terrain(x: number, y: number): number {
  return (
    noise(x, y) * 0.68 + noise((x * 0.8 - y * 0.6) * 2.1 + 31, (x * 0.6 + y * 0.8) * 2.1 - 7) * 0.32
  )
}

/** The size of the cells of the world, a power of two of metres, that take about `pixels` of the canvas: which keeps what a style scatters on the ground where it is as the map zooms, until the size changes. */
function cellOf(p: Painter, pixels: number): number {
  return 2 ** Math.round(Math.log2(pixels / p.scale))
}

/**
 * A layer of a style that changes only as the map moves, such as its
 * ground: it draws once for each place that the map looks at, and for each
 * `key` of what else it shows, at most `sharpness` pixels of the screen
 * to one of the canvas, for what is soft enough to need no more.
 */
function layer(
  sharpness = Infinity,
): (p: Painter, draw: (p: Painter) => void, key?: string) => void {
  let canvas: HTMLCanvasElement | undefined
  let drawn = ''
  return (p, draw, key = '') => {
    const [left, top] = p.toWorld(0, 0)
    const view = `${p.width} ${p.height} ${p.ratio} ${left} ${top} ${p.scale} ${key}`
    canvas ??= document.createElement('canvas')
    if (view !== drawn) {
      const ratio = Math.min(p.ratio, sharpness)
      const width = Math.round(p.width * ratio)
      const height = Math.round(p.height * ratio)
      // Sizing a canvas makes its pixels anew, which it needs only as the map changes size.
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      const context = canvas.getContext('2d')!
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, width, height)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      draw({ ...p, context, ratio })
      drawn = view
    }
    p.context.drawImage(canvas, 0, 0, p.width, p.height)
  }
}

/** What tells the blips of a map apart, for the layers that draw round them. */
function keyOf(blips: readonly DevBlip[]): string {
  let key = blips.length
  for (const { x, y } of blips) key = (key * 31 + Math.round(x) * 7 + Math.round(y)) % 1e9
  return String(key)
}

/** The map as FiveRunner first drew it: dots, arrows and a grid, on the dark of the dev UI. */
export const CLASSIC: MapStyle = {
  name: 'Classic',
  animated: false,
  background(p) {
    p.context.clearRect(0, 0, p.width, p.height)
    grid(
      p,
      { line: '#1f232b', axis: '#3a404c', text: '#5a606c' },
      '11px ui-monospace, Consolas, monospace',
    )
  },
  area(p, blip, sx, sy) {
    const { context } = p
    context.globalAlpha = (blip.alpha / 255) * 0.35
    context.fillStyle = blipColour(blip.colour)
    context.beginPath()
    if (blip.shape === 'radius') context.arc(sx, sy, (blip.radius ?? 0) * p.scale, 0, Math.PI * 2)
    else {
      const w = (blip.width ?? 0) * p.scale
      const h = (blip.height ?? 0) * p.scale
      context.rect(sx - w / 2, sy - h / 2, w, h)
    }
    context.fill()
    context.globalAlpha = 1
  },
  route(p, from, to, colour) {
    const { context } = p
    context.strokeStyle = colour
    context.lineWidth = 2
    context.setLineDash([6, 5])
    context.beginPath()
    context.moveTo(...from)
    context.lineTo(...to)
    context.stroke()
    context.setLineDash([])
    context.lineWidth = 1
  },
  blip(p, blip, sx, sy) {
    const { context } = p
    p.claim(sx - 6, sy - 6, 12, 12, true)
    context.globalAlpha = Math.max(blip.alpha / 255, 0.25)
    if (blip.sprite === WAYPOINT) {
      context.fillStyle = '#d070f0'
      context.beginPath()
      context.moveTo(sx, sy - 9)
      context.lineTo(sx + 7, sy)
      context.lineTo(sx, sy + 9)
      context.lineTo(sx - 7, sy)
      context.closePath()
      context.fill()
    } else if (blip.shape !== 'radius' && blip.shape !== 'area') {
      context.fillStyle = blipColour(blip.colour)
      context.strokeStyle = '#0b0c10'
      context.beginPath()
      context.arc(sx, sy, 5, 0, Math.PI * 2)
      context.fill()
      context.stroke()
    }
    context.globalAlpha = 1
  },
  label(p, name, sx, sy, must) {
    outlined(
      p,
      name,
      [
        [sx + 8, sy + 4, 'left'],
        [sx - 8, sy + 4, 'right'],
      ],
      '#c8ccd4',
      '#0b0c10',
      '12px system-ui, sans-serif',
      must,
    )
  },
  tag(p, name, colour, sx, sy) {
    // Under the arrow, off the labels of the blips that players stand on.
    outlined(
      p,
      name,
      [
        [sx, sy + 22, 'center'],
        [sx, sy - 14, 'center'],
      ],
      colour,
      '#0b0c10',
      '12px system-ui, sans-serif',
      true,
    )
  },
  entity(p, entity, sx, sy, _moving, player) {
    const { context } = p
    if (entity.kind === 'player') {
      const colour = player?.colour ?? '#d7dae0'
      p.claim(sx - 8, sy - 10, 16, 18, true)
      context.save()
      context.translate(sx, sy)
      context.rotate(turnOf(entity))
      context.fillStyle = colour
      context.strokeStyle = '#0b0c10'
      context.beginPath()
      context.moveTo(0, -10)
      context.lineTo(7, 7)
      context.lineTo(0, 3)
      context.lineTo(-7, 7)
      context.closePath()
      context.fill()
      context.stroke()
      context.restore()
    } else if (entity.kind === 'vehicle') {
      context.save()
      context.translate(sx, sy)
      context.rotate(turnOf(entity))
      context.fillStyle = '#8a909c'
      context.fillRect(-4, -7, 8, 14)
      context.restore()
    } else {
      context.fillStyle = entity.kind === 'ped' ? '#a8adb8' : '#5a606c'
      context.beginPath()
      context.arc(sx, sy, entity.kind === 'ped' ? 3.5 : 2.5, 0, Math.PI * 2)
      context.fill()
    }
    return [sx, sy]
  },
}

/** The colours of the cartoon: of its grass and the patches of it, its tufts, its ink and its text. */
const MEADOW = {
  grass: '#8fcf68',
  light: [166, 220, 127],
  dark: [124, 192, 88],
  tuft: '#6eb24c',
  ink: '#2b2d3a',
  text: '#2d3142',
} as const

/** The colours of the cars of the cartoon, of the shirts of its peds, of the skins and the hair of its people, by their ids. */
const CAR_COLOURS = ['#ef5b5b', '#3f8efc', '#ffc145', '#34c38f', '#a66cff', '#ff8a3d', '#f2f4f8']
const SHIRTS = ['#8d99ae', '#e9c46a', '#2a9d8f', '#e76f51', '#9b5de5', '#577590']
const SKINS = ['#f8d5b5', '#eab78e', '#c98d62', '#9c6644', '#6f4630']
const HAIR = ['#3b2a20', '#6b4423', '#d8a93f', '#a0522d', '#23232b', '#c8553d']

/**
 * The colours of the clothes of the characters of the cartoon, which each
 * drawable and texture of a component gets one of, as FiveRunner has none
 * of the clothes of GTA V to see the colours of, and the tones of the skins
 * of the parents of their heads, which their indices take in turn.
 */
const CLOTHES = [
  '#3d4a6b',
  '#e9c46a',
  '#2a9d8f',
  '#e76f51',
  '#9b5de5',
  '#577590',
  '#f4f1de',
  '#ef476f',
  '#118ab2',
  '#06d6a0',
  '#ffd166',
  '#264653',
  '#8d99ae',
  '#f78c6b',
  '#2b2d42',
  '#b5838d',
]
const SKIN_TONES = [
  '#f8d5b5',
  '#f1c6a0',
  '#eab78e',
  '#d9a077',
  '#c98d62',
  '#b07650',
  '#9c6644',
  '#845437',
  '#6f4630',
]

/** What the cartoon dresses a character in: the colours of its skin, hair, top, legs and shoes, and whether its hair is long. */
interface Dress {
  readonly skin: string
  readonly hair: string
  readonly top: string
  readonly legs: string
  readonly shoes: string
  readonly long: boolean
}

/** How the cartoon dresses the character of a ped that looks as `look` says, if it says. */
function dressOf(look: DevLook | undefined): Dress | undefined {
  if (look === undefined) return undefined
  const clothes = ([drawable, texture]: readonly [number, number], offset: number) =>
    CLOTHES[Math.abs(drawable * 5 + texture * 3 + offset) % CLOTHES.length]!
  const tone = (index: number) => channels(SKIN_TONES[Math.abs(index) % SKIN_TONES.length]!)
  const [first, second, mix] = look.skin
  const [a, b] = [tone(first), tone(second)]
  const skin = a.map((value, i) => Math.round(value + (b[i]! - value) * mix))
  const hair = HAIR_COLOURS[look.hair] ?? HAIR_COLOURS[0]!
  return {
    skin: `rgb(${skin.join(' ')})`,
    hair: `#${hair.toString(16).padStart(6, '0')}`,
    top: clothes(look.top, 1),
    legs: clothes(look.legs, 0),
    shoes: clothes(look.shoes, 14),
    long: look.hairStyle % 2 === 1,
  }
}

/** Draws a filled shape and its ink round it, with no lines inside where its parts overlap. */
function inked(context: CanvasRenderingContext2D, path: Path2D, fill: string, width = 1.6): void {
  context.lineWidth = width * 2
  context.strokeStyle = MEADOW.ink
  context.stroke(path)
  context.fillStyle = fill
  context.fill(path)
}

/** The ellipse of a shadow on the ground. */
function shadow(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  alpha = 0.22,
): void {
  context.fillStyle = `rgba(32, 70, 26, ${alpha})`
  context.beginPath()
  context.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
  context.fill()
}

/** A tree of the cartoon, a round one or a pine, standing at `x`, `y`. */
function tree(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  pine: boolean,
  size: number,
): void {
  shadow(context, x + 4 * size, y + 1, 12 * size, 4.5 * size)
  const trunk = new Path2D()
  trunk.roundRect(x - 2.2 * size, y - 9 * size, 4.4 * size, 10 * size, 1.6 * size)
  inked(context, trunk, '#9a6a45', 1.1)
  const crown = new Path2D()
  if (pine) {
    for (const [top, half, bottom] of [
      [-30, 7, -18],
      [-24, 9.5, -12],
      [-18, 11.5, -6],
    ] as const) {
      crown.moveTo(x, y + top * size)
      crown.lineTo(x + half * size, y + bottom * size)
      crown.lineTo(x - half * size, y + bottom * size)
      crown.closePath()
    }
    inked(context, crown, '#3f9a54', 1.1)
    context.fillStyle = 'rgba(255, 255, 255, 0.18)'
    context.beginPath()
    context.moveTo(x, y - 29 * size)
    context.lineTo(x - 5 * size, y - 20 * size)
    context.lineTo(x - 1 * size, y - 20 * size)
    context.closePath()
    context.fill()
    return
  }
  for (const [cx, cy, r] of [
    [-6, -14, 7],
    [6, -14, 7],
    [0, -20, 8.5],
  ] as const) {
    crown.moveTo(x + (cx + r) * size, y + cy * size)
    crown.arc(x + cx * size, y + cy * size, r * size, 0, Math.PI * 2)
  }
  inked(context, crown, '#4caf50', 1.1)
  context.fillStyle = '#7bd06b'
  context.beginPath()
  context.arc(x - 3 * size, y - 22 * size, 3.6 * size, 0, Math.PI * 2)
  context.arc(x - 7.5 * size, y - 15.5 * size, 2.4 * size, 0, Math.PI * 2)
  context.fill()
}

/** What the cartoon scatters on a cell of its grass: a bush, flowers, a rock or a tuft of grass. */
function scatter(context: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  if (r < 0.12) {
    shadow(context, x + 2, y + 1, 9, 3)
    const bush = new Path2D()
    for (const [cx, cy, radius] of [
      [-5, -4, 4.6],
      [4.5, -4, 4.6],
      [0, -7, 5.4],
    ] as const) {
      bush.moveTo(x + cx + radius, y + cy)
      bush.arc(x + cx, y + cy, radius, 0, Math.PI * 2)
    }
    inked(context, bush, '#5cb85c', 1)
    context.fillStyle = '#86d176'
    context.beginPath()
    context.arc(x - 1.5, y - 8.5, 2, 0, Math.PI * 2)
    context.fill()
  } else if (r < 0.19) {
    const [petal, heart] = (
      [
        ['#ffffff', '#ffd23f'],
        ['#ff8fb1', '#fff3b0'],
        ['#ffd23f', '#f08a3c'],
      ] as const
    )[Math.floor(r * 1000) % 3]!
    for (const [dx, dy] of [
      [0, 0],
      [6, 3],
      [-5, 4],
    ] as const) {
      context.fillStyle = petal
      context.beginPath()
      for (let k = 0; k < 5; k++) {
        const angle = (k * Math.PI * 2) / 5
        context.moveTo(x + dx + Math.cos(angle) * 1.8 + 1.5, y + dy + Math.sin(angle) * 1.8)
        context.arc(
          x + dx + Math.cos(angle) * 1.8,
          y + dy + Math.sin(angle) * 1.8,
          1.5,
          0,
          Math.PI * 2,
        )
      }
      context.fill()
      context.fillStyle = heart
      context.beginPath()
      context.arc(x + dx, y + dy, 1.2, 0, Math.PI * 2)
      context.fill()
    }
  } else if (r < 0.215) {
    shadow(context, x + 2, y + 1.5, 7, 2.5)
    const rock = new Path2D()
    rock.ellipse(x, y - 2, 6, 4, 0, 0, Math.PI * 2)
    inked(context, rock, '#c3ccd6', 1)
    context.fillStyle = '#e6ebf0'
    context.beginPath()
    context.ellipse(x - 2, y - 3.6, 2.4, 1.3, -0.3, 0, Math.PI * 2)
    context.fill()
  } else {
    context.strokeStyle = MEADOW.tuft
    context.lineWidth = 1.8
    context.lineCap = 'round'
    context.beginPath()
    for (const dx of [-3, 0, 3]) {
      context.moveTo(x + dx, y)
      context.quadraticCurveTo(x + dx * 1.1, y - 3, x + dx * 1.7, y - 6 + Math.abs(dx) * 0.4)
    }
    context.stroke()
    context.lineCap = 'butt'
  }
}

/** The grass of the cartoon, with patches of lighter and darker green, trees and what grows on it, round the blips of the map. */
function meadow(p: Painter, blips: readonly DevBlip[]): void {
  const { context, width, height } = p
  context.fillStyle = MEADOW.grass
  context.fillRect(0, 0, width, height)
  // Patches of grass, from noise of the world sampled on a small image that the canvas smooths as it stretches it.
  const texel = 16
  const patch = cellOf(p, 380)
  const columns = Math.ceil(width / texel) + 1
  const rows = Math.ceil(height / texel) + 1
  const small = document.createElement('canvas')
  small.width = columns
  small.height = rows
  const smallContext = small.getContext('2d')!
  const image = smallContext.createImageData(columns, rows)
  const [west, north] = p.toWorld(0, 0)
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const n = terrain(
        (west + (i * texel) / p.scale) / patch,
        (north - (j * texel) / p.scale) / patch,
      )
      const light = Math.min(Math.max((n - 0.55) / 0.09, 0), 1)
      const dark = Math.min(Math.max((0.45 - n) / 0.09, 0), 1)
      const [r, g, b] = light > 0 ? MEADOW.light : MEADOW.dark
      const amount = light > 0 ? light : dark
      const at = (j * columns + i) * 4
      image.data[at] = r
      image.data[at + 1] = g
      image.data[at + 2] = b
      image.data[at + 3] = Math.round(amount * 255)
    }
  }
  smallContext.putImageData(image, 0, 0)
  context.imageSmoothingQuality = 'high'
  context.drawImage(small, -texel / 2, -texel / 2, columns * texel, rows * texel)
  // Sand under the blips, where they are places, as they draw near enough to have room.
  const free = new Set<string>()
  const near = 30
  for (const blip of blips) {
    if (blip.shape === 'radius' || blip.shape === 'area') continue
    const [sx, sy] = p.toScreen(blip.x, blip.y)
    if (sx < -near || sy < -near || sx > width + near || sy > height + near) continue
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        free.add(`${Math.floor(sx / near) + dx} ${Math.floor(sy / near) + dy}`)
    if (p.scale >= 0.1 && blip.sprite !== WAYPOINT) {
      context.fillStyle = 'rgba(244, 228, 178, 0.85)'
      context.beginPath()
      context.ellipse(sx, sy + 6, 19, 8.5, 0, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = 'rgba(255, 246, 214, 0.7)'
      context.beginPath()
      context.ellipse(sx, sy + 5, 12, 5, 0, 0, Math.PI * 2)
      context.fill()
    }
  }
  // Trees, bushes, flowers, rocks and tufts, on cells of the world, but by the blips.
  const cell = cellOf(p, 58)
  const level = Math.log2(cell)
  const [left, top] = p.toWorld(-40, -40)
  const [right, bottom] = p.toWorld(width + 40, height + 60)
  const items: [number, number, number][] = []
  for (let cx = Math.floor(left / cell); cx <= right / cell; cx++) {
    for (let cy = Math.floor(bottom / cell); cy <= top / cell; cy++) {
      const r = hash(cx + level * 7.3, cy - level * 3.1)
      if (r > 0.55) continue
      const [sx, sy] = p.toScreen(
        (cx + 0.15 + hash(cy, cx + level) * 0.7) * cell,
        (cy + 0.15 + hash(cx + 3.7, cy - level) * 0.7) * cell,
      )
      if (r < 0.215 && free.has(`${Math.floor(sx / near)} ${Math.floor(sy / near)}`)) continue
      items.push([sx, sy, r])
    }
  }
  // The furthest north first, which those in front of them stand over.
  items.sort((a, b) => a[1] - b[1])
  for (const [sx, sy, r] of items) {
    if (r < 0.07) tree(context, sx, sy, r < 0.025, 0.85 + ((r * 97) % 1) * 0.35)
    else scatter(context, sx, sy, r)
  }
  grid(
    p,
    { line: 'rgba(255, 255, 255, 0.22)', axis: 'rgba(255, 255, 255, 0.6)', text: '#3f6e2c' },
    `800 10px ${ROUNDED}`,
    [2, 6],
  )
}

/** The shadows of clouds that drift over the cartoon. */
function clouds(p: Painter): void {
  const { context, width, height, time } = p
  context.fillStyle = 'rgba(28, 60, 36, 0.05)'
  for (let i = 0; i < 4; i++) {
    const span = width + 600
    const x = ((i * 0.31 * span + time * 0.012) % span) - 300
    const y = ((i * 0.37 + 0.12) % 1) * height + Math.sin(time / 9000 + i) * 24
    context.beginPath()
    for (const [dx, dy, rx, ry] of [
      [0, 0, 120, 52],
      [90, -20, 90, 44],
      [-80, 14, 80, 38],
    ] as const) {
      context.moveTo(x + dx + rx, y + dy)
      context.ellipse(x + dx, y + dy, rx, ry, 0, 0, Math.PI * 2)
    }
    context.fill()
  }
}

/** How wide the tokens of the blips of the cartoon are as the map zooms out, in pixels from their middle. */
function tokenOf(p: Painter): number {
  return p.scale >= 0.1 ? 12.5 : p.scale >= 0.04 ? 10.5 : 8.5
}

/** The colour that marks of a colour show in on white, darker if it is too light to read there. */
function ink(colour: string): string {
  const light = lightness(colour)
  if (light > 0.8) return '#5f6b7d'
  return light > 0.42 ? shade(colour, -0.32) : colour
}

/**
 * A name on a bubble, at the first of `places` that has room for it, or
 * the least crowded if it must show: centred on `sx` and the shift of the place,
 * under what it names from the y of a place that is `below`, else above it
 * to the y of the place.
 */
function bubble(
  p: Painter,
  text: string,
  sx: number,
  places: readonly (readonly [y: number, below: boolean, shift?: number])[],
  fill: string,
  must: boolean,
): void {
  const { context } = p
  context.font = `800 12px ${ROUNDED}`
  const width = Math.ceil(context.measureText(text).width) + 16
  const height = 20
  const tops = places.map(([y, below]) => (below ? y : y - height))
  const index = place(
    p,
    width,
    height + 6,
    places.map(([, , shift = 0], i) => [sx + shift - width / 2, tops[i]! - 3]),
    must,
  )
  if (index === undefined) return
  const top = tops[index]!
  const [, below, shift = 0] = places[index]!
  const x = sx + shift
  const pill = new Path2D()
  pill.roundRect(x - width / 2, top, width, height, height / 2)
  const tail = below ? top : top + height
  pill.moveTo(x - 5, tail)
  pill.lineTo(x, tail + (below ? -5 : 5))
  pill.lineTo(x + 5, tail)
  context.fillStyle = 'rgba(30, 50, 30, 0.18)'
  context.save()
  context.translate(0, 2.5)
  context.fill(pill)
  context.restore()
  context.fillStyle = fill
  context.fill(pill)
  context.fillStyle = MEADOW.text
  context.textAlign = 'center'
  context.fillText(text, x, top + 14.5)
  context.textAlign = 'left'
}

/** Where a character of the cartoon faces on the canvas: away, to the right, towards the user or to the left. */
type Facing = 'back' | 'right' | 'front' | 'left'

function facingOf(turn: number): Facing {
  const quarter = Math.round(((turn % (Math.PI * 2)) + Math.PI * 2) / (Math.PI / 2)) % 4
  return (['back', 'right', 'front', 'left'] as const)[quarter]!
}

/**
 * A little character of the cartoon, standing at the origin, its feet there
 * and its head above, which faces as it turns on the canvas, walks as it
 * moves, breathes, and blinks, as `seed` has it do at its own times. It
 * wears what `dress` says, or a skin and hair of its seed, and `shirt`.
 */
function character(
  context: CanvasRenderingContext2D,
  time: number,
  moving: boolean,
  turn: number,
  shirt: string,
  seed: number,
  lifted = false,
  dress?: Dress,
): void {
  const facing = facingOf(turn)
  const skin = dress?.skin ?? SKINS[seed % SKINS.length]!
  const hair = dress?.hair ?? HAIR[Math.floor(seed / 5) % HAIR.length]!
  const long = dress?.long ?? Math.floor(seed / 3) % 2 === 0
  const phase = time / 105 + seed
  const swing = moving ? Math.sin(phase) : 0
  const bob = moving ? -Math.abs(Math.sin(phase)) * 2 : Math.sin(time / 420 + seed) * 0.5
  if (!lifted) shadow(context, 0, 0.5, 10 - (moving ? Math.abs(swing) : 0), 3.6, 0.26)
  context.save()
  context.translate(0, bob)
  const side = facing === 'left' || facing === 'right'
  const flip = facing === 'left' ? -1 : 1
  // Legs, which step in turn, or dangle while the cursor lifts the character, in their shoes.
  const legs = new Path2D()
  const shoes = new Path2D()
  for (const [x, lift] of [
    [-3, Math.max(0, swing)],
    [3, Math.max(0, -swing)],
  ] as const) {
    const dx = side ? swing * (x < 0 ? 3 : -3) * flip : 0
    const dy = lifted ? 1.5 : -lift * 2.6
    legs.roundRect((side ? x * 0.35 : x) - 2.1 + dx, -8.5 + dy, 4.2, 8.5, 2)
    shoes.roundRect((side ? x * 0.35 + flip : x) - 2.6 + dx, -2.8 + dy, 5.2, 3.2, 1.5)
  }
  inked(context, legs, dress?.legs ?? '#3d4a6b', 1.4)
  inked(context, shoes, dress?.shoes ?? '#2b2d42', 1.2)
  // Arms, which swing against the legs.
  const arms = new Path2D()
  for (const [x, sway] of [
    [-8.2, -swing],
    [8.2, swing],
  ] as const) {
    if (side && x * flip < 0) continue
    const dx = side ? sway * 2.2 * flip : 0
    arms.roundRect((side ? 1.5 * flip : x) - 2 + dx, -18 - (lifted ? 3 : 0) + sway * 1.2, 4, 8.5, 2)
  }
  const body = new Path2D()
  body.roundRect(-7, -20, 14, 12.5, 5)
  inked(context, body, shirt, 1.4)
  context.save()
  context.clip(body)
  context.fillStyle = 'rgba(0, 0, 0, 0.13)'
  context.fillRect(side ? -7 * flip : 2, -20, side ? 6 * flip : 5, 13)
  context.restore()
  inked(context, arms, shade(shirt, -0.08), 1.4)
  // The head, its hair, and the face that it turns as it faces.
  const head = new Path2D()
  head.arc(0, -27.5, 9, 0, Math.PI * 2)
  inked(context, head, skin, 1.4)
  context.save()
  context.clip(head)
  context.fillStyle = hair
  context.beginPath()
  if (facing === 'back') context.rect(-10, -40, 20, 16)
  else if (side) {
    context.ellipse(-3 * flip, -32, 9.5, 6.5, 0, 0, Math.PI * 2)
    context.rect(-10 * flip, -36, 7 * flip, 12)
  } else context.ellipse(0, -33.5, 11, 6.5, 0, 0, Math.PI * 2)
  context.fill()
  context.restore()
  if (long && facing !== 'front') {
    context.fillStyle = hair
    context.strokeStyle = MEADOW.ink
    context.lineWidth = 1.4
    context.beginPath()
    context.roundRect(side ? -9 * flip - 2.5 : -7, -28, 5, 10, 2.5)
    if (!side) context.roundRect(2, -28, 5, 10, 2.5)
    context.fill()
    context.stroke()
  }
  if (facing !== 'back') {
    const blink = (time + seed * 977) % 3800 < 130
    const eyes = side ? [3.6 * flip] : [-3.2, 3.2]
    context.fillStyle = MEADOW.ink
    context.strokeStyle = MEADOW.ink
    context.lineWidth = 1.3
    for (const x of eyes) {
      context.beginPath()
      if (blink) {
        context.moveTo(x - 1.4, -26.5)
        context.lineTo(x + 1.4, -26.5)
        context.stroke()
      } else {
        context.ellipse(x, -26.6, 1.25, 1.6, 0, 0, Math.PI * 2)
        context.fill()
      }
    }
    context.fillStyle = 'rgba(255, 120, 120, 0.35)'
    for (const x of side ? [2 * flip] : [-5.2, 5.2]) {
      context.beginPath()
      context.ellipse(x, -23.4, 1.9, 1.2, 0, 0, Math.PI * 2)
      context.fill()
    }
    if (!side) {
      context.beginPath()
      context.arc(0, -24, 1.8, 0.15 * Math.PI, 0.85 * Math.PI)
      context.stroke()
    }
  }
  context.restore()
}

/** A car of the cartoon, seen from above, its front where it faces, which puffs as it moves. */
function car(
  context: CanvasRenderingContext2D,
  colour: string,
  moving: boolean,
  time: number,
): void {
  const wheels = new Path2D()
  for (const [x, y] of [
    [-9, -11],
    [5.4, -11],
    [-9, 5.5],
    [5.4, 5.5],
  ] as const)
    wheels.roundRect(x, y, 3.6, 6.5, 1.6)
  context.fillStyle = '#23232b'
  context.fill(wheels)
  const body = new Path2D()
  body.roundRect(-8, -15.5, 16, 31, 6.5)
  inked(context, body, colour, 1.3)
  context.save()
  context.clip(body)
  context.fillStyle = 'rgba(255, 255, 255, 0.22)'
  context.fillRect(-8, -15.5, 4, 31)
  context.fillStyle = 'rgba(0, 0, 0, 0.12)'
  context.fillRect(4.5, -15.5, 4, 31)
  context.restore()
  const glass = context.createLinearGradient(0, -9, 0, -3)
  glass.addColorStop(0, '#d9f4ff')
  glass.addColorStop(1, '#7cc6ee')
  context.fillStyle = glass
  context.strokeStyle = MEADOW.ink
  context.lineWidth = 1
  context.beginPath()
  context.roundRect(-6, -9.5, 12, 6, 2)
  context.fill()
  context.stroke()
  context.fillStyle = shade(colour, 0.18)
  context.beginPath()
  context.roundRect(-6, -2.5, 12, 9, 2.5)
  context.fill()
  context.stroke()
  context.fillStyle = '#7cc6ee'
  context.beginPath()
  context.roundRect(-5.5, 7.5, 11, 4, 1.5)
  context.fill()
  context.stroke()
  context.strokeStyle = 'rgba(255, 255, 255, 0.85)'
  context.lineWidth = 1.2
  context.beginPath()
  context.moveTo(-3.5, -8.5)
  context.lineTo(-1, -4.5)
  context.stroke()
  for (const [x, y, light] of [
    [-6, -15.4, '#ffe066'],
    [3.6, -15.4, '#ffe066'],
    [-6, 13.6, '#ff6b6b'],
    [3.6, 13.6, '#ff6b6b'],
  ] as const) {
    context.fillStyle = light
    context.beginPath()
    context.roundRect(x, y, 2.4, 1.8, 0.8)
    context.fill()
  }
  if (moving) {
    for (let k = 0; k < 3; k++) {
      const t = (time / 420 + k / 3) % 1
      context.fillStyle = `rgba(255, 255, 255, ${0.55 * (1 - t)})`
      context.beginPath()
      context.arc(-3 + Math.sin(k * 2.1) * 2, 18 + t * 12, 2 + t * 3, 0, Math.PI * 2)
      context.fill()
    }
  }
}

/** The map as a cartoon: little people and cars, round tokens for blips, on a meadow with trees under drifting clouds, with a ground of its own. */
export function cartoonStyle(): MapStyle {
  const ground = layer()
  return {
    name: 'Cartoon',
    animated: true,
    background(p, blips) {
      ground(p, (q) => meadow(q, blips), keyOf(blips))
      clouds(p)
    },
    area(p, blip, sx, sy) {
      const { context } = p
      const colour = blipColour(blip.colour)
      const shape = new Path2D()
      if (blip.shape === 'radius') shape.arc(sx, sy, (blip.radius ?? 0) * p.scale, 0, Math.PI * 2)
      else {
        const w = (blip.width ?? 0) * p.scale
        const h = (blip.height ?? 0) * p.scale
        shape.roundRect(sx - w / 2, sy - h / 2, w, h, Math.min(16, w / 4, h / 4))
      }
      context.globalAlpha = (blip.alpha / 255) * 0.22
      context.fillStyle = colour
      context.fill(shape)
      context.globalAlpha = Math.max(blip.alpha / 255, 0.4)
      context.strokeStyle = shade(colour, -0.15)
      context.lineWidth = 2.5
      context.setLineDash([8, 6])
      context.lineDashOffset = -p.time / 45
      context.stroke(shape)
      context.setLineDash([])
      context.lineDashOffset = 0
      context.globalAlpha = 1
      context.lineWidth = 1
    },
    route(p, from, to, colour) {
      const { context, time } = p
      context.strokeStyle = colour
      context.globalAlpha = 0.18
      context.lineWidth = 9
      context.lineCap = 'round'
      context.beginPath()
      context.moveTo(...from)
      context.lineTo(...to)
      context.stroke()
      context.globalAlpha = 1
      context.lineCap = 'butt'
      const length = Math.hypot(to[0] - from[0], to[1] - from[1])
      // Dots that walk along the route.
      const offset = (time / 36) % 14
      context.lineWidth = 1.6
      context.strokeStyle = shade(colour, -0.25)
      context.fillStyle = '#ffffff'
      for (let d = offset; d < length - 6; d += 14) {
        const t = d / length
        context.beginPath()
        context.arc(
          from[0] + (to[0] - from[0]) * t,
          from[1] + (to[1] - from[1]) * t,
          3,
          0,
          Math.PI * 2,
        )
        context.fill()
        context.stroke()
      }
      context.lineWidth = 1
    },
    blip(p, blip, sx, sy, hovered) {
      const { context, time } = p
      const colour = blipColour(blip.colour)
      context.globalAlpha = Math.max(blip.alpha / 255, 0.35)
      if (blip.sprite === WAYPOINT) {
        p.claim(sx - 3, sy - 30, 22, 32, true)
        // A flag that waves, over a ring that ripples on the ground.
        const ripple = (time / 1600) % 1
        context.strokeStyle = `rgba(239, 71, 111, ${0.7 * (1 - ripple)})`
        context.lineWidth = 2
        context.beginPath()
        context.ellipse(sx, sy, 6 + ripple * 14, (6 + ripple * 14) * 0.4, 0, 0, Math.PI * 2)
        context.stroke()
        shadow(context, sx + 2, sy, 6, 2.4)
        const pole = new Path2D()
        pole.roundRect(sx - 1.3, sy - 28, 2.6, 28, 1.3)
        inked(context, pole, '#e8e2d4', 1)
        const cloth = new Path2D()
        const wave = (x: number) => Math.sin(time / 160 - x / 4) * 1.6 * (x / 16)
        cloth.moveTo(sx + 1, sy - 27)
        for (let x = 0; x <= 16; x += 2) cloth.lineTo(sx + 1 + x, sy - 27 + wave(x) + x * 0.06)
        for (let x = 16; x >= 0; x -= 2) cloth.lineTo(sx + 1 + x, sy - 17 + wave(x) - x * 0.06)
        cloth.closePath()
        inked(context, cloth, '#ef476f', 1)
      } else if (blip.shape !== 'radius' && blip.shape !== 'area') {
        const radius = tokenOf(p)
        p.claim(sx - radius, sy - radius * 1.35 - 1, radius * 2, radius * 2.1 + 2, true)
        const lift = hovered ? 5 : 0
        const bob = Math.sin(time / 700 + blip.handle * 1.7) * 1.1 - lift
        shadow(context, sx, sy + radius * 0.75, radius * 0.85 - lift * 0.3, radius * 0.32)
        context.save()
        context.translate(sx, sy + bob - radius * 0.35)
        if (hovered) context.scale(1.12, 1.12)
        // A token of a board game: its rim, its face, its ring and the icon of its sprite.
        context.fillStyle = shade(lightness(colour) > 0.8 ? '#9aa5b4' : colour, -0.35)
        context.beginPath()
        context.arc(0, 2.6, radius, 0, Math.PI * 2)
        context.fill()
        context.fillStyle = '#ffffff'
        context.beginPath()
        context.arc(0, 0, radius, 0, Math.PI * 2)
        context.fill()
        context.strokeStyle = lightness(colour) > 0.8 ? '#9aa5b4' : colour
        context.lineWidth = radius > 10 ? 3 : 2.4
        context.beginPath()
        context.arc(0, 0, radius - 1.5, 0, Math.PI * 2)
        context.stroke()
        const icon = iconOf(blip.sprite)
        context.fillStyle = ink(colour)
        if (icon !== undefined) drawIcon(context, icon, radius * 1.18)
        else {
          context.font = `900 ${Math.round(radius)}px ${ROUNDED}`
          context.textAlign = 'center'
          context.fillText((blip.name ?? '•').slice(0, 1).toUpperCase(), 0, radius * 0.36)
          context.textAlign = 'left'
        }
        context.restore()
      }
      context.globalAlpha = 1
      context.lineWidth = 1
    },
    label(p, name, sx, sy, must) {
      const radius = tokenOf(p)
      bubble(
        p,
        name,
        sx,
        [
          [sy + radius * 0.75 + 9, true],
          [sy - radius * 1.45 - 7, false],
        ],
        '#ffffff',
        must,
      )
    },
    tag(p, name, colour, sx, sy) {
      // Over the head, or under the feet, or to a side, of players who stand together.
      bubble(
        p,
        name,
        sx,
        [
          [sy - 47, false],
          [sy + 10, true],
          [sy - 47, false, 48],
          [sy - 47, false, -48],
        ],
        colour,
        true,
      )
    },
    entity(p, entity, sx, sy, moving, player) {
      const { context, time } = p
      if (entity.kind === 'player' || entity.kind === 'ped') {
        const colour = player?.colour ?? SHIRTS[entity.id % SHIRTS.length]!
        const size = entity.kind === 'ped' ? 0.86 : 1.08
        p.claim(sx - 10 * size, sy - 37 * size, 20 * size, 38 * size, true)
        if (player !== undefined) {
          // A ring on the ground round the feet of players, which pulses.
          const pulse = (time / 2200) % 1
          context.strokeStyle = colour
          context.lineWidth = 2.5
          context.beginPath()
          context.ellipse(sx, sy, 14, 5.5, 0, 0, Math.PI * 2)
          context.stroke()
          context.globalAlpha = 1 - pulse
          context.lineWidth = 1.5
          context.beginPath()
          context.ellipse(sx, sy, 14 + pulse * 12, 5.5 + pulse * 4.5, 0, 0, Math.PI * 2)
          context.stroke()
          context.globalAlpha = 1
        }
        context.save()
        context.translate(sx, sy)
        context.scale(size, size)
        const dress = dressOf(entity.look)
        character(
          context,
          time,
          moving,
          turnOf(entity),
          dress?.top ?? colour,
          (player?.client ?? entity.id) * 7,
          false,
          dress,
        )
        context.restore()
        return [sx, sy - 14 * size]
      }
      if (entity.kind === 'vehicle') {
        const size = Math.min(Math.max(p.scale / 6, 0.8), 1.4)
        const turn = turnOf(entity)
        const bounce = moving ? Math.sin(time / 55) * 0.5 : 0
        context.save()
        context.translate(sx + 3 * size, sy + 4 * size)
        context.rotate(turn)
        context.scale(size, size)
        context.fillStyle = 'rgba(32, 70, 26, 0.24)'
        context.beginPath()
        context.roundRect(-9, -15, 18, 31, 7)
        context.fill()
        context.restore()
        context.save()
        context.translate(sx, sy + bounce)
        context.rotate(turn)
        context.scale(size, size)
        car(context, CAR_COLOURS[entity.id % CAR_COLOURS.length]!, moving, time)
        context.restore()
        context.lineWidth = 1
        return [sx, sy]
      }
      // A wooden crate.
      shadow(context, sx + 2, sy + 5, 8, 3)
      const crate = new Path2D()
      crate.roundRect(sx - 6, sy - 6, 12, 12, 2)
      inked(context, crate, '#c8915a', 1.2)
      context.strokeStyle = '#8a5a30'
      context.lineWidth = 1.2
      context.beginPath()
      context.moveTo(sx - 4.5, sy - 4.5)
      context.lineTo(sx + 4.5, sy + 4.5)
      context.moveTo(sx + 4.5, sy - 4.5)
      context.lineTo(sx - 4.5, sy + 4.5)
      context.stroke()
      context.lineWidth = 1
      return [sx, sy]
    },
    dragging(p, from, to, player) {
      const { context, time } = p
      context.fillStyle = '#ffffff'
      const length = Math.hypot(to[0] - from[0], to[1] - from[1])
      for (let d = 8; d < length - 24; d += 12) {
        const t = d / length
        context.beginPath()
        context.arc(
          from[0] + (to[0] - from[0]) * t,
          from[1] + (to[1] - from[1]) * t,
          2.2,
          0,
          Math.PI * 2,
        )
        context.fill()
      }
      // The player, lifted by the cursor, over their shadow on the ground.
      shadow(context, to[0], to[1] + 26, 9, 3.2, 0.3)
      context.save()
      context.translate(to[0], to[1] + 16 + Math.sin(time / 160) * 1.5)
      context.rotate(Math.sin(time / 240) * 0.08)
      const dress = dressOf(player.look)
      character(
        context,
        time,
        false,
        Math.PI,
        dress?.top ?? player.colour,
        player.client * 7,
        true,
        dress,
      )
      context.restore()
    },
    overlay(p) {
      const { context, height, time } = p
      // A compass, whose needle wobbles, and a bar of the scale of the map.
      const x = 34
      const y = height - 34
      context.fillStyle = 'rgba(30, 50, 30, 0.2)'
      context.beginPath()
      context.arc(x, y + 3, 21, 0, Math.PI * 2)
      context.fill()
      const dial = new Path2D()
      dial.arc(x, y, 21, 0, Math.PI * 2)
      inked(context, dial, '#ffffff', 1.2)
      context.save()
      context.translate(x, y)
      context.rotate(Math.sin(time / 900) * 0.07)
      context.fillStyle = '#ef476f'
      context.beginPath()
      context.moveTo(0, -15)
      context.lineTo(4.5, 0)
      context.lineTo(-4.5, 0)
      context.closePath()
      context.fill()
      context.fillStyle = '#b8c2cf'
      context.beginPath()
      context.moveTo(0, 15)
      context.lineTo(4.5, 0)
      context.lineTo(-4.5, 0)
      context.closePath()
      context.fill()
      context.restore()
      context.fillStyle = MEADOW.ink
      context.beginPath()
      context.arc(x, y, 2, 0, Math.PI * 2)
      context.fill()
      context.font = `900 9px ${ROUNDED}`
      context.textAlign = 'center'
      context.fillText('N', x, y - 23 - 3)
      const metres =
        [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000].find((m) => m * p.scale >= 56) ?? 5000
      const bar = metres * p.scale
      const label = metres >= 1000 ? `${metres / 1000} km` : `${metres} m`
      context.font = `800 11px ${ROUNDED}`
      const pill = Math.max(bar, context.measureText(label).width) + 20
      const left = x + 32
      context.fillStyle = 'rgba(30, 50, 30, 0.2)'
      context.beginPath()
      context.roundRect(left, y - 12 + 2.5, pill, 26, 13)
      context.fill()
      context.fillStyle = '#ffffff'
      context.beginPath()
      context.roundRect(left, y - 12, pill, 26, 13)
      context.fill()
      context.fillStyle = MEADOW.text
      context.fillText(label, left + pill / 2, y + 1)
      context.fillStyle = MEADOW.ink
      context.fillRect(left + (pill - bar) / 2, y + 6, bar / 2, 3)
      context.fillStyle = '#b8c2cf'
      context.fillRect(left + pill / 2, y + 6, bar / 2, 3)
      context.textAlign = 'left'
    },
  }
}

/** An image of the world that the user gave the map, and the coordinates of the world at its edges. */
export interface MapImage {
  readonly image: CanvasImageSource
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** The two edges of a cell, of its top, right, bottom and left, that a line of a level crosses, by which of its corners are over the level. */
const CROSSINGS: readonly (readonly (readonly [number, number])[])[] = [
  [],
  [[3, 2]],
  [[2, 1]],
  [[3, 1]],
  [[0, 1]],
  [
    [0, 3],
    [1, 2],
  ],
  [[0, 2]],
  [[0, 3]],
  [[0, 3]],
  [[0, 2]],
  [
    [0, 1],
    [3, 2],
  ],
  [[0, 1]],
  [[3, 1]],
  [[1, 2]],
  [[3, 2]],
  [],
]

/** The lines of depth of a sea floor, from noise of the world, which the map of GTA V shows while it has no image of the world. */
function seabed(p: Painter): void {
  const { context, width, height } = p
  const cell = 9
  const wave = cellOf(p, 520)
  const columns = Math.ceil(width / cell) + 1
  const rows = Math.ceil(height / cell) + 1
  // The canvas is a scale and a shift of the world, which spares asking the map where each sample is.
  const [left, top] = p.toWorld(0, 0)
  const step = cell / p.scale
  const field = new Float32Array(columns * rows)
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      field[j * columns + i] = terrain((left + i * step) / wave, (top - j * step) / wave)
    }
  }
  const first = 0.3
  const gap = 0.04
  const lines = Array.from({ length: 12 }, () => new Path2D())
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < columns - 1; i++) {
      const a = field[j * columns + i]!
      const b = field[j * columns + i + 1]!
      const c = field[(j + 1) * columns + i + 1]!
      const d = field[(j + 1) * columns + i]!
      const high = Math.max(a, b, c, d)
      // Only the levels between the lowest and the highest corner cross the cell.
      for (
        let level = Math.max(Math.ceil((Math.min(a, b, c, d) - first) / gap), 0);
        level < lines.length && first + level * gap <= high;
        level++
      ) {
        const t = first + level * gap
        const at = (edge: number): [number, number] =>
          edge === 0
            ? [(i + (t - a) / (b - a)) * cell, j * cell]
            : edge === 1
              ? [(i + 1) * cell, (j + (t - b) / (c - b)) * cell]
              : edge === 2
                ? [(i + (t - d) / (c - d)) * cell, (j + 1) * cell]
                : [i * cell, (j + (t - a) / (d - a)) * cell]
        const index = (a > t ? 8 : 0) | (b > t ? 4 : 0) | (c > t ? 2 : 0) | (d > t ? 1 : 0)
        for (const [from, to] of CROSSINGS[index]!) {
          lines[level]!.moveTo(...at(from))
          lines[level]!.lineTo(...at(to))
        }
      }
    }
  }
  context.lineWidth = 1
  lines.forEach((line, level) => {
    context.strokeStyle =
      level % 4 === 3 ? 'rgba(150, 200, 235, 0.13)' : 'rgba(150, 200, 235, 0.055)'
    context.stroke(line)
  })
}

/** The map as the pause menu of GTA V shows one: glyphs on the dark of the sea, magenta routes, a legend and the buttons that it takes. */
export function gtaStyle(image: () => MapImage | undefined): MapStyle {
  const MAGENTA = '#c65ad8'
  const OUTLINE = '#05080b'
  const HEADER = 48
  const BAR = 28
  const LEGEND = 236
  const font = (size: number, weight = 600) => `semi-condensed ${weight} ${size}px ${CONDENSED}`
  /** Whether the canvas is wide enough for the legend. */
  const legendOf = (width: number) => width >= 760
  const sea = layer(1)

  /** The pin of the waypoint, its point at the origin. */
  const pin = (context: CanvasRenderingContext2D) => {
    context.fillStyle = 'rgba(0, 0, 0, 0.4)'
    context.beginPath()
    context.ellipse(0, 0, 4.5, 1.8, 0, 0, Math.PI * 2)
    context.fill()
    const shape = new Path2D()
    shape.moveTo(0, 0)
    shape.bezierCurveTo(-1.8, -5, -7, -8, -7, -13.5)
    shape.arc(0, -13.5, 7, Math.PI, 0)
    shape.bezierCurveTo(7, -8, 1.8, -5, 0, 0)
    shape.closePath()
    context.lineWidth = 3
    context.lineJoin = 'round'
    context.strokeStyle = OUTLINE
    context.stroke(shape)
    context.fillStyle = MAGENTA
    context.fill(shape)
    context.fillStyle = '#ffffff'
    context.beginPath()
    context.arc(0, -13.5, 2.6, 0, Math.PI * 2)
    context.fill()
  }

  /** The arrow of a player, pointing north, in their colour. */
  const arrow = (context: CanvasRenderingContext2D, colour: string) => {
    const shape = new Path2D()
    shape.moveTo(0, -12)
    shape.lineTo(8.5, 9)
    shape.lineTo(0, 4.5)
    shape.lineTo(-8.5, 9)
    shape.closePath()
    context.lineJoin = 'round'
    context.lineWidth = 3.5
    context.strokeStyle = OUTLINE
    context.stroke(shape)
    context.fillStyle = colour
    context.fill(shape)
    context.fillStyle = 'rgba(255, 255, 255, 0.35)'
    context.beginPath()
    context.moveTo(0, -12)
    context.lineTo(0, 4.5)
    context.lineTo(-8.5, 9)
    context.closePath()
    context.fill()
  }

  /** A mouse, `button` of it lit: the left one, the left one twice, or its wheel. */
  const mouse = (
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    button: 'left' | 'twice' | 'wheel',
  ) => {
    context.strokeStyle = '#ffffff'
    context.fillStyle = '#ffffff'
    context.lineWidth = 1.4
    context.beginPath()
    context.roundRect(x, y, 11, 16, 5.5)
    context.stroke()
    context.beginPath()
    context.moveTo(x, y + 6.5)
    context.lineTo(x + 11, y + 6.5)
    context.moveTo(x + 5.5, y)
    context.lineTo(x + 5.5, y + 6.5)
    context.stroke()
    context.beginPath()
    if (button === 'wheel') context.roundRect(x + 4.2, y + 1.8, 2.6, 4, 1.3)
    else {
      context.moveTo(x + 5.5, y + 0.7)
      context.lineTo(x + 5.5, y + 6.5)
      context.lineTo(x + 0.7, y + 6.5)
      context.arc(x + 5.5, y + 5.5, 4.8, Math.PI, Math.PI * 1.5)
    }
    context.fill()
    if (button === 'twice') {
      context.font = font(9, 700)
      context.fillText('2', x + 13, y + 6)
    }
  }

  return {
    name: 'GTA',
    animated: true,
    instructions: true,
    insets: (width) => ({
      top: HEADER,
      right: legendOf(width) ? LEGEND + 24 : 0,
      bottom: BAR + 14,
      left: 0,
    }),
    background(p) {
      const { context, width, height } = p
      const water = context.createRadialGradient(
        width * 0.45,
        height * 0.55,
        0,
        width * 0.45,
        height * 0.55,
        Math.hypot(width, height) * 0.62,
      )
      water.addColorStop(0, '#1d3448')
      water.addColorStop(1, '#0c1824')
      context.fillStyle = water
      context.fillRect(0, 0, width, height)
      const map = image()
      if (map !== undefined) {
        const [x0, y0] = p.toScreen(map.left, map.top)
        const [x1, y1] = p.toScreen(map.right, map.bottom)
        context.drawImage(map.image, x0, y0, x1 - x0, y1 - y0)
      } else sea(p, seabed)
      grid(
        p,
        {
          line: 'rgba(140, 180, 215, 0.09)',
          axis: 'rgba(140, 180, 215, 0.26)',
          text: 'rgba(180, 205, 228, 0.5)',
        },
        font(10),
        [],
        HEADER,
      )
      const vignette = context.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.4,
        width / 2,
        height / 2,
        Math.hypot(width, height) * 0.6,
      )
      vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
      vignette.addColorStop(1, 'rgba(0, 0, 0, 0.45)')
      context.fillStyle = vignette
      context.fillRect(0, 0, width, height)
    },
    area(p, blip, sx, sy) {
      const { context } = p
      const colour = blipColour(blip.colour)
      const shape = new Path2D()
      if (blip.shape === 'radius') shape.arc(sx, sy, (blip.radius ?? 0) * p.scale, 0, Math.PI * 2)
      else {
        const w = (blip.width ?? 0) * p.scale
        const h = (blip.height ?? 0) * p.scale
        shape.rect(sx - w / 2, sy - h / 2, w, h)
      }
      context.globalAlpha = (blip.alpha / 255) * 0.3
      context.fillStyle = colour
      context.fill(shape)
      context.globalAlpha = Math.max(blip.alpha / 255, 0.3) * 0.7
      context.strokeStyle = colour
      context.lineWidth = 1.5
      context.stroke(shape)
      context.globalAlpha = 1
      context.lineWidth = 1
    },
    route(p, from, to) {
      const { context, time } = p
      context.lineCap = 'round'
      for (const [colour, width] of [
        ['#16081c', 8],
        [MAGENTA, 4.5],
      ] as const) {
        context.strokeStyle = colour
        context.lineWidth = width
        context.beginPath()
        context.moveTo(...from)
        context.lineTo(...to)
        context.stroke()
      }
      // Chevrons that run along the route, towards its end.
      const length = Math.hypot(to[0] - from[0], to[1] - from[1])
      const angle = Math.atan2(to[1] - from[1], to[0] - from[0])
      context.strokeStyle = 'rgba(255, 255, 255, 0.8)'
      context.lineWidth = 1.6
      for (let d = (time / 24) % 26; d < length - 14; d += 26) {
        const t = d / length
        context.save()
        context.translate(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t)
        context.rotate(angle)
        context.beginPath()
        context.moveTo(-1.8, -2.6)
        context.lineTo(1.4, 0)
        context.lineTo(-1.8, 2.6)
        context.stroke()
        context.restore()
      }
      context.lineCap = 'butt'
      context.lineWidth = 1
    },
    blip(p, blip, sx, sy, hovered) {
      const { context, time } = p
      if (blip.sprite === WAYPOINT) p.claim(sx - 8, sy - 22, 16, 24, true)
      else if (blip.shape !== 'radius' && blip.shape !== 'area')
        p.claim(sx - 9, sy - 9, 18, 18, true)
      context.globalAlpha = Math.max(blip.alpha / 255, 0.3)
      context.strokeStyle = OUTLINE
      context.save()
      context.translate(sx, sy)
      if (blip.sprite === WAYPOINT) pin(context)
      else if (blip.shape !== 'radius' && blip.shape !== 'area') {
        const icon = iconOf(blip.sprite)
        context.fillStyle = blipColour(blip.colour)
        if (icon !== undefined) drawIcon(context, icon, 17, 1.6)
        else {
          context.lineWidth = 3
          context.beginPath()
          context.arc(0, 0, 5.5, 0, Math.PI * 2)
          context.stroke()
          context.fill()
        }
      }
      context.restore()
      context.globalAlpha = 1
      if (hovered) {
        // The cursor of the map, round what it hovers.
        const radius = 15 + Math.sin(time / 160)
        context.strokeStyle = '#ffffff'
        context.lineWidth = 2
        for (let k = 0; k < 4; k++) {
          const middle = (k * Math.PI) / 2 + Math.PI / 4
          context.beginPath()
          context.arc(sx, sy, radius, middle - 0.42, middle + 0.42)
          context.stroke()
        }
        context.lineWidth = 1
      }
    },
    label(p, name, sx, sy, must) {
      outlined(
        p,
        name.toUpperCase(),
        [
          [sx + 12, sy + 4, 'left'],
          [sx - 12, sy + 4, 'right'],
          [sx, sy + 22, 'center'],
          [sx, sy - 14, 'center'],
        ],
        '#ffffff',
        OUTLINE,
        font(11, 700),
        must,
      )
    },
    tag(p, name, colour, sx, sy) {
      // As GTA Online shows gamertags: white on black, by the colour of the player.
      const { context } = p
      context.font = font(11, 700)
      const text = name.toUpperCase()
      const width = Math.ceil(context.measureText(text).width) + 15
      const spots = [
        [sx - width / 2, sy + 16],
        [sx - width / 2, sy - 33],
        [sx + 15, sy - 8.5],
        [sx - 15 - width, sy - 8.5],
      ] as const
      const at = spots[place(p, width, 17, spots, true)!]!
      context.fillStyle = 'rgba(0, 0, 0, 0.8)'
      context.fillRect(at[0], at[1], width, 17)
      context.fillStyle = colour
      context.fillRect(at[0], at[1], 3, 17)
      context.fillStyle = '#ffffff'
      context.fillText(text, at[0] + 9, at[1] + 12.5)
    },
    entity(p, entity, sx, sy, _moving, player) {
      const { context, time } = p
      if (entity.kind === 'player') {
        const colour = player?.colour ?? '#ffffff'
        p.claim(sx - 10, sy - 12, 20, 22, true)
        context.save()
        context.translate(sx, sy)
        context.rotate(turnOf(entity))
        // The cone of what the player sees, which breathes as the radar of GTA V does.
        const cone = context.createRadialGradient(0, 0, 0, 0, 0, 44)
        cone.addColorStop(0, 'rgba(255, 255, 255, 0.32)')
        cone.addColorStop(1, 'rgba(255, 255, 255, 0)')
        context.fillStyle = cone
        context.globalAlpha = 0.8 + Math.sin(time / 500) * 0.2
        context.beginPath()
        context.moveTo(0, 0)
        context.arc(0, 0, 44, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55)
        context.closePath()
        context.fill()
        context.globalAlpha = 1
        arrow(context, colour)
        context.restore()
        context.lineWidth = 1
      } else if (entity.kind === 'vehicle') {
        context.save()
        context.translate(sx, sy)
        context.rotate(turnOf(entity))
        const body = new Path2D()
        body.roundRect(-5, -9, 10, 18, 3)
        context.lineWidth = 3
        context.strokeStyle = OUTLINE
        context.stroke(body)
        context.fillStyle = '#dbe3ea'
        context.fill(body)
        context.fillStyle = '#2b3743'
        context.beginPath()
        context.roundRect(-3.6, -5, 7.2, 3.4, 1)
        context.roundRect(-3.6, 3.6, 7.2, 2.4, 1)
        context.fill()
        context.restore()
        context.lineWidth = 1
      } else {
        context.lineWidth = 2.5
        context.strokeStyle = OUTLINE
        context.fillStyle = entity.kind === 'ped' ? '#c9d1d9' : '#8b98a5'
        context.beginPath()
        if (entity.kind === 'ped') context.arc(sx, sy, 3.8, 0, Math.PI * 2)
        else context.rect(sx - 3.5, sy - 3.5, 7, 7)
        context.stroke()
        context.fill()
        context.lineWidth = 1
      }
      return [sx, sy]
    },
    dragging(p, from, to, player) {
      const { context } = p
      context.strokeStyle = 'rgba(255, 255, 255, 0.7)'
      context.lineWidth = 1.5
      context.setLineDash([5, 5])
      context.beginPath()
      context.moveTo(...from)
      context.lineTo(...to)
      context.stroke()
      context.setLineDash([])
      context.save()
      context.translate(...to)
      context.globalAlpha = 0.7
      arrow(context, player.colour)
      context.restore()
      context.globalAlpha = 1
      context.lineWidth = 1
    },
    overlay(p, blips, players, whose) {
      const { context, width, height } = p
      // The header of the pause menu: the title, the tab of the map, and who is in the session.
      const band = context.createLinearGradient(0, 0, 0, HEADER)
      band.addColorStop(0, 'rgba(3, 6, 9, 0.94)')
      band.addColorStop(1, 'rgba(3, 6, 9, 0.78)')
      context.fillStyle = band
      context.fillRect(0, 0, width, HEADER)
      context.fillStyle = 'rgba(255, 255, 255, 0.12)'
      context.fillRect(0, HEADER - 1, width, 1)
      context.fillStyle = '#ffffff'
      context.font = `italic ${font(25, 700)}`
      context.fillText('FIVERUNNER', 18, 33)
      const title = context.measureText('FIVERUNNER').width
      const accent = players.find(({ client }) => client === whose)?.colour ?? '#f0a030'
      context.font = font(13, 700)
      const tab = context.measureText('MAP').width + 28
      const tabX = 18 + title + 18
      context.fillStyle = '#ffffff'
      context.fillRect(tabX, 12, tab, 26)
      context.fillStyle = accent
      context.fillRect(tabX, 12, tab, 3)
      context.fillStyle = '#05080b'
      context.fillText('MAP', tabX + 14, 30.5)
      context.textAlign = 'right'
      let right = width - 18
      context.fillStyle = 'rgba(220, 230, 240, 0.7)'
      context.font = font(12, 600)
      const count = `${blips.length} ${blips.length === 1 ? 'BLIP' : 'BLIPS'}`
      context.fillText(count, right, 29)
      right -= context.measureText(count).width + 22
      for (const player of [...players].reverse()) {
        if (player.name === undefined) continue
        const name = player.name.toUpperCase()
        context.font = font(13, 700)
        context.fillStyle =
          whose === undefined || whose === player.client ? '#ffffff' : 'rgba(255, 255, 255, 0.45)'
        context.fillText(name, right, 29)
        const w = context.measureText(name).width
        context.fillStyle = player.colour
        context.beginPath()
        context.arc(right - w - 9, 25, 4, 0, Math.PI * 2)
        context.fill()
        right -= w + 30
        if (right < tabX + tab + 40) break
      }
      context.textAlign = 'left'
      // The legend of what the map shows, as the pause menu lists it.
      if (legendOf(width)) {
        const kinds = new Map<string, { blip: DevBlip; count: number }>()
        for (const blip of blips) {
          if (blip.name === undefined) continue
          const kind = kinds.get(blip.name)
          if (kind === undefined) kinds.set(blip.name, { blip, count: 1 })
          else kind.count++
        }
        if (kinds.size > 0) {
          const sorted = [...kinds.entries()].sort(([a], [b]) => a.localeCompare(b))
          const x = width - LEGEND - 14
          const y = HEADER + 14
          const row = 22
          const fits = Math.max(Math.floor((height - y - BAR - 30 - 36) / row), 1)
          const rows = sorted.length > fits ? sorted.slice(0, fits - 1) : sorted
          const more = sorted.length - rows.length
          const panel = 36 + (rows.length + (more > 0 ? 1 : 0)) * row + 6
          context.fillStyle = 'rgba(3, 6, 9, 0.78)'
          context.fillRect(x, y, LEGEND, panel)
          context.fillStyle = accent
          context.fillRect(x, y, LEGEND, 2)
          context.fillStyle = '#ffffff'
          context.font = font(14, 700)
          context.fillText('LEGEND', x + 12, y + 24)
          context.textAlign = 'right'
          context.fillStyle = 'rgba(220, 230, 240, 0.6)'
          context.font = font(12, 600)
          context.fillText(String(kinds.size), x + LEGEND - 12, y + 24)
          context.textAlign = 'left'
          const most = LEGEND - 90
          rows.forEach(([name, { blip, count }], index) => {
            const ry = y + 36 + index * row
            if (index % 2 === 0) {
              context.fillStyle = 'rgba(255, 255, 255, 0.035)'
              context.fillRect(x, ry, LEGEND, row)
            }
            context.save()
            context.translate(x + 22, ry + row / 2)
            context.fillStyle = blipColour(blip.colour)
            context.strokeStyle = OUTLINE
            const icon = iconOf(blip.sprite)
            if (icon !== undefined) drawIcon(context, icon, 14, 1.2)
            else {
              context.lineWidth = 2.4
              context.beginPath()
              context.arc(0, 0, 4.5, 0, Math.PI * 2)
              context.stroke()
              context.fill()
            }
            context.restore()
            context.font = font(12, 600)
            let shown = name.toUpperCase()
            while (shown.length > 1 && context.measureText(shown).width > most)
              shown = shown.slice(0, -1)
            if (shown !== name.toUpperCase()) shown = `${shown.trimEnd()}…`
            context.fillStyle = '#eef3f8'
            context.fillText(shown, x + 40, ry + 15.5)
            context.textAlign = 'right'
            context.fillStyle = 'rgba(200, 215, 230, 0.55)'
            context.font = font(11, 600)
            context.fillText(`×${count}`, x + LEGEND - 12, ry + 15.5)
            context.textAlign = 'left'
          })
          if (more > 0) {
            context.fillStyle = 'rgba(200, 215, 230, 0.6)'
            context.font = font(11, 700)
            context.fillText(`+ ${more} MORE`, x + 40, y + 36 + rows.length * row + 15.5)
          }
        }
      }
      // The buttons that the map takes, as GTA V shows them at the bottom of its menus.
      const items = [
        ['left', 'MOVE PLAYER'],
        ['twice', 'WAYPOINT'],
        ['wheel', 'ZOOM'],
      ] as const
      context.font = font(11, 700)
      const widths = items.map(([, label]) => context.measureText(label).width + 36)
      let x = width - 14 - widths.reduce((total, each) => total + each, 0) - 8
      const y = height - 14 - BAR
      context.fillStyle = 'rgba(3, 6, 9, 0.78)'
      context.fillRect(x, y, width - 14 - x, BAR)
      x += 12
      items.forEach(([button, label], index) => {
        mouse(context, x, y + 6, button)
        context.fillStyle = '#ffffff'
        context.font = font(11, 700)
        context.fillText(label, x + 22, y + 18.5)
        x += widths[index]!
      })
      context.lineWidth = 1
    },
  }
}
