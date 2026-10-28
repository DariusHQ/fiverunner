import type { DevBlip, DevEntity } from '../map.ts'
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

/** The colours of the cars of the cartoon map, by the ids of the vehicles. */
const CAR_COLOURS: readonly string[] = [
  '#e85d5d',
  '#4c8df0',
  '#f2c14e',
  '#5cc98a',
  '#b07ee0',
  '#f08a4b',
]

/** The sprite of the waypoint of players. */
export const WAYPOINT = 8

/** How far apart the lines of the grid may be, in metres. */
const STEPS = [10, 25, 50, 100, 250, 500, 1000, 2000]

/** The colour of a blip of a colour id: the map's own for those it names, and a hue of their own for others. */
export function blipColour(colour: number): string {
  return BLIP_COLOURS[colour] ?? `hsl(${(colour * 137.5) % 360} 70% 62%)`
}

export function playerColour(client: number): string {
  return PLAYER_COLOURS[(client - 1) % PLAYER_COLOURS.length]!
}

/** What a style draws the map on: its canvas, where the map looks, and the time of the frame, in milliseconds. */
export interface Painter {
  readonly context: CanvasRenderingContext2D
  readonly width: number
  readonly height: number
  /** How many pixels a metre takes. */
  readonly scale: number
  readonly time: number
  toScreen(x: number, y: number): [number, number]
  toWorld(sx: number, sy: number): [number, number]
}

/** How a style draws the world of the session, from the ground up. */
export interface MapStyle {
  readonly name: string
  /** Whether it moves of itself, which redraws the map at each frame. */
  readonly animated: boolean
  background(p: Painter): void
  area(p: Painter, blip: DevBlip, sx: number, sy: number): void
  route(
    p: Painter,
    from: readonly [number, number],
    to: readonly [number, number],
    colour: string,
  ): void
  /** Draws a blip, named if `named`. */
  blip(p: Painter, blip: DevBlip, sx: number, sy: number, named: boolean): void
  /** Draws an entity, the ped of a player with its colour and name, which moves if `moving`. */
  entity(
    p: Painter,
    entity: DevEntity,
    sx: number,
    sy: number,
    moving: boolean,
    player?: { readonly colour: string; readonly name: string | undefined },
  ): void
  /** Draws what goes over the map, such as a legend of its blips. */
  overlay?(p: Painter, blips: readonly DevBlip[]): void
}

/** The grid of metres of a map, in its colours. */
function grid(
  p: Painter,
  colours: { readonly line: string; readonly axis: string; readonly text: string },
  font: string,
  dash: readonly number[] = [],
): void {
  const { context, width, height } = p
  const step = STEPS.find((each) => each * p.scale >= 70) ?? STEPS.at(-1)!
  const [left, top] = p.toWorld(0, 0)
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
    context.fillText(String(x), sx + 3, 12)
  }
  for (let y = Math.ceil(bottom / step) * step; y <= top; y += step) {
    const [, sy] = p.toScreen(0, y)
    context.strokeStyle = y === 0 ? colours.axis : colours.line
    context.beginPath()
    context.moveTo(0, Math.round(sy) + 0.5)
    context.lineTo(width, Math.round(sy) + 0.5)
    context.stroke()
    context.fillText(String(y), 3, sy - 3)
  }
  context.setLineDash([])
}

/** Writes `text` outlined, so that it reads over anything. */
function outlined(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fill: string,
  outline: string,
  font: string,
  align: CanvasTextAlign = 'left',
): void {
  context.font = font
  context.textAlign = align
  context.lineJoin = 'round'
  context.lineWidth = 3
  context.strokeStyle = outline
  context.strokeText(text, x, y)
  context.fillStyle = fill
  context.fillText(text, x, y)
  context.lineWidth = 1
  context.textAlign = 'left'
}

/** The turn of an entity on the canvas, in radians, clockwise from the north. */
const turnOf = (entity: DevEntity) => (-entity.heading * Math.PI) / 180

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
  blip(p, blip, sx, sy, named) {
    const { context } = p
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
    if (named && blip.name !== undefined) {
      outlined(
        context,
        blip.name,
        sx + 8,
        sy + 4,
        '#c8ccd4',
        '#0b0c10',
        '12px system-ui, sans-serif',
      )
    }
  },
  entity(p, entity, sx, sy, _moving, player) {
    const { context } = p
    if (entity.kind === 'player') {
      const colour = player?.colour ?? '#d7dae0'
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
      // Under the arrow, off the labels of the blips that players stand on.
      if (player?.name !== undefined) {
        outlined(
          context,
          player.name,
          sx,
          sy + 22,
          colour,
          '#0b0c10',
          '12px system-ui, sans-serif',
          'center',
        )
      }
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
  },
}

/** A number of its own for a cell of the world, from 0 to 1, which stays the same as the map moves. */
function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return n - Math.floor(n)
}

/** A little character of the cartoon map, standing at the origin: its feet there, its head above. */
function character(
  context: CanvasRenderingContext2D,
  time: number,
  moving: boolean,
  clothes: string,
  heading: number,
  size: number,
): void {
  const bob = moving ? Math.abs(Math.sin(time / 90)) * -2 : Math.sin(time / 350) * 1.2
  const step = moving ? Math.sin(time / 90) * 2.5 : 0
  context.save()
  context.scale(size, size)
  // Its shadow stays on the ground as it bobs.
  context.fillStyle = 'rgba(30, 60, 20, 0.28)'
  context.beginPath()
  context.ellipse(0, 1, 9, 3.5, 0, 0, Math.PI * 2)
  context.fill()
  context.translate(0, bob)
  context.lineWidth = 1.5
  context.strokeStyle = '#3b2a20'
  context.fillStyle = '#4a4f6a'
  for (const [x, offset] of [
    [-3.2, step],
    [3.2, -step],
  ] as const) {
    context.beginPath()
    context.roundRect(x - 2, -7 + offset * 0.3, 4, 7 - offset * 0.3, 2)
    context.fill()
    context.stroke()
  }
  context.fillStyle = clothes
  context.beginPath()
  context.roundRect(-7, -17, 14, 11, 5)
  context.fill()
  context.stroke()
  context.fillStyle = '#f6cfa4'
  context.beginPath()
  context.arc(0, -24, 8, 0, Math.PI * 2)
  context.fill()
  context.stroke()
  context.fillStyle = '#5a3a22'
  context.beginPath()
  context.arc(0, -25.5, 8, Math.PI * 1.05, Math.PI * 1.95)
  context.closePath()
  context.fill()
  // Its eyes look the way it faces, as far as a face seen from the front can.
  const look = Math.sin((heading * Math.PI) / 180) * -2
  context.fillStyle = '#2a1f1a'
  for (const x of [-2.8, 2.8]) {
    context.beginPath()
    context.arc(x + look, -23.5, 1.2, 0, Math.PI * 2)
    context.fill()
  }
  context.restore()
}

/** A name on a bubble, above what it names. */
function bubble(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  border: string,
): void {
  context.font = '700 12px system-ui, sans-serif'
  const width = context.measureText(text).width + 14
  context.fillStyle = '#ffffff'
  context.strokeStyle = border
  context.lineWidth = 2
  context.beginPath()
  context.roundRect(x - width / 2, y - 18, width, 18, 9)
  context.fill()
  context.stroke()
  context.fillStyle = '#2d3142'
  context.textAlign = 'center'
  context.fillText(text, x, y - 5)
  context.textAlign = 'left'
  context.lineWidth = 1
}

/** The map as a cartoon: little characters and cars, round badges for blips, on grass. */
export const CARTOON: MapStyle = {
  name: 'Cartoon',
  animated: true,
  background(p) {
    const { context, width, height } = p
    const ground = context.createLinearGradient(0, 0, 0, height)
    ground.addColorStop(0, '#b4e08f')
    ground.addColorStop(1, '#9ed27a')
    context.fillStyle = ground
    context.fillRect(0, 0, width, height)
    // Tufts of grass, in cells of the world so that they move with it.
    const cell = 46 / p.scale
    const [left, top] = p.toWorld(0, 0)
    const [right, bottom] = p.toWorld(width, height)
    context.strokeStyle = '#86bd62'
    context.lineWidth = 2
    context.lineCap = 'round'
    for (let cx = Math.floor(left / cell); cx <= right / cell; cx++) {
      for (let cy = Math.floor(bottom / cell); cy <= top / cell; cy++) {
        const r = hash(cx, cy)
        if (r < 0.45) continue
        const [sx, sy] = p.toScreen((cx + hash(cy, cx)) * cell, (cy + r) * cell)
        if (r > 0.94) {
          context.fillStyle = ['#ffffff', '#ffe066', '#ff8fab'][Math.floor(r * 300) % 3]!
          context.beginPath()
          context.arc(sx, sy, 2.5, 0, Math.PI * 2)
          context.fill()
          continue
        }
        context.beginPath()
        for (const dx of [-3, 0, 3]) {
          context.moveTo(sx + dx, sy)
          context.lineTo(sx + dx * 1.6, sy - 5 - Math.abs(dx) * -0.3)
        }
        context.stroke()
      }
    }
    context.lineCap = 'butt'
    grid(
      p,
      {
        line: 'rgba(255, 255, 255, 0.35)',
        axis: 'rgba(255, 255, 255, 0.7)',
        text: 'rgba(40, 80, 30, 0.75)',
      },
      '700 11px system-ui, sans-serif',
      [2, 7],
    )
  },
  area(p, blip, sx, sy) {
    const { context } = p
    context.fillStyle = blipColour(blip.colour)
    context.strokeStyle = blipColour(blip.colour)
    context.globalAlpha = (blip.alpha / 255) * 0.3
    context.beginPath()
    if (blip.shape === 'radius') context.arc(sx, sy, (blip.radius ?? 0) * p.scale, 0, Math.PI * 2)
    else {
      const w = (blip.width ?? 0) * p.scale
      const h = (blip.height ?? 0) * p.scale
      context.roundRect(sx - w / 2, sy - h / 2, w, h, 12)
    }
    context.fill()
    context.globalAlpha = 0.8
    context.setLineDash([6, 6])
    context.lineWidth = 2
    context.stroke()
    context.setLineDash([])
    context.globalAlpha = 1
    context.lineWidth = 1
  },
  route(p, from, to, colour) {
    const { context } = p
    const length = Math.hypot(to[0] - from[0], to[1] - from[1])
    // Dots that walk along the route.
    const offset = (p.time / 40) % 14
    context.fillStyle = colour
    for (let d = offset; d < length; d += 14) {
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
    }
  },
  blip(p, blip, sx, sy, named) {
    const { context } = p
    const colour = blipColour(blip.colour)
    context.globalAlpha = Math.max(blip.alpha / 255, 0.35)
    if (blip.sprite === WAYPOINT) {
      const sway = Math.sin(p.time / 300) * 0.12
      context.save()
      context.translate(sx, sy)
      context.fillStyle = 'rgba(30, 60, 20, 0.28)'
      context.beginPath()
      context.ellipse(0, 0, 6, 2.5, 0, 0, Math.PI * 2)
      context.fill()
      context.translate(0, -10)
      context.rotate(sway)
      context.fillStyle = '#ef476f'
      context.strokeStyle = '#ffffff'
      drawIcon(context, 'flag', 22, true)
      context.restore()
    } else if (blip.shape !== 'radius' && blip.shape !== 'area') {
      const pop = 1 + Math.sin(p.time / 500 + blip.handle) * 0.04
      context.save()
      context.translate(sx, sy)
      context.scale(pop, pop)
      context.fillStyle = 'rgba(30, 60, 20, 0.25)'
      context.beginPath()
      context.ellipse(0, 11, 8, 3, 0, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = '#ffffff'
      context.strokeStyle = colour === '#f0f0f0' ? '#8d99ae' : colour
      context.lineWidth = 3
      context.beginPath()
      context.arc(0, 0, 11, 0, Math.PI * 2)
      context.fill()
      context.stroke()
      const icon = iconOf(blip.sprite)
      context.fillStyle = colour === '#f0f0f0' ? '#5c677d' : colour
      if (icon !== undefined) drawIcon(context, icon, 14)
      else {
        context.font = '800 12px system-ui, sans-serif'
        context.textAlign = 'center'
        context.fillText((blip.name ?? '•').slice(0, 1).toUpperCase(), 0, 4.5)
        context.textAlign = 'left'
      }
      context.restore()
    }
    context.globalAlpha = 1
    if (named && blip.name !== undefined) bubble(context, blip.name, sx, sy + 34, '#ffffff')
  },
  entity(p, entity, sx, sy, moving, player) {
    const { context, time } = p
    if (entity.kind === 'player' || entity.kind === 'ped') {
      const colour = player?.colour ?? '#8d99ae'
      // An arrow on the ground, round its feet, points the way it faces.
      const turn = turnOf(entity)
      context.save()
      context.translate(sx + Math.sin(turn) * 13, sy - Math.cos(turn) * 5 + 1)
      context.rotate(turn)
      context.fillStyle = colour
      context.strokeStyle = '#ffffff'
      context.lineWidth = 1.5
      context.beginPath()
      context.moveTo(0, -5)
      context.lineTo(4.5, 2)
      context.lineTo(-4.5, 2)
      context.closePath()
      context.stroke()
      context.fill()
      context.restore()
      context.lineWidth = 1
      context.save()
      context.translate(sx, sy)
      character(
        context,
        time + entity.id * 137,
        moving,
        colour,
        entity.heading,
        entity.kind === 'ped' ? 0.75 : 1,
      )
      context.restore()
      if (player?.name !== undefined) bubble(context, player.name, sx, sy - 34, player.colour)
    } else if (entity.kind === 'vehicle') {
      const size = Math.min(Math.max(p.scale * 2.2, 0.6), 2.2)
      const bounce = moving ? Math.sin(time / 60) * 0.6 : 0
      context.save()
      context.translate(sx, sy + bounce)
      context.rotate(turnOf(entity))
      context.scale(size, size)
      context.fillStyle = 'rgba(30, 60, 20, 0.28)'
      context.beginPath()
      context.roundRect(-8, -12, 18, 28, 7)
      context.fill()
      context.fillStyle = '#26262e'
      for (const [x, y] of [
        [-8, -9],
        [5, -9],
        [-8, 5],
        [5, 5],
      ] as const) {
        context.beginPath()
        context.roundRect(x, y, 3, 6, 1.5)
        context.fill()
      }
      context.fillStyle = CAR_COLOURS[entity.id % CAR_COLOURS.length]!
      context.strokeStyle = '#2d3142'
      context.lineWidth = 1.5
      context.beginPath()
      context.roundRect(-6.5, -13, 13, 26, 6)
      context.fill()
      context.stroke()
      context.fillStyle = '#bfe6ff'
      context.beginPath()
      context.roundRect(-4.5, -8, 9, 5, 2)
      context.fill()
      context.beginPath()
      context.roundRect(-4.5, 5, 9, 4, 2)
      context.fill()
      context.fillStyle = '#ffe066'
      for (const x of [-4, 2.5]) {
        context.beginPath()
        context.roundRect(x, -13, 1.6, 2, 0.8)
        context.fill()
      }
      context.restore()
      context.lineWidth = 1
    } else {
      context.save()
      context.translate(sx, sy)
      context.fillStyle = '#c08a52'
      context.strokeStyle = '#6b4423'
      context.lineWidth = 1.5
      context.beginPath()
      context.roundRect(-5, -5, 10, 10, 2)
      context.fill()
      context.stroke()
      context.beginPath()
      context.moveTo(-5, -5)
      context.lineTo(5, 5)
      context.moveTo(5, -5)
      context.lineTo(-5, 5)
      context.stroke()
      context.restore()
      context.lineWidth = 1
    }
  },
}

/** An image of the world that the user gave the map, and the coordinates of the world at its edges. */
export interface MapImage {
  readonly image: CanvasImageSource
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** The map as the pause menu of GTA V shows one: glyphs on the dark of the sea, magenta routes and a legend. */
export function gtaStyle(image: () => MapImage | undefined): MapStyle {
  const MAGENTA = '#c65ad8'
  const font = (size: number) => `700 ${size}px 'Segoe UI', 'Arial Narrow', Arial, sans-serif`
  return {
    name: 'GTA',
    animated: true,
    background(p) {
      const { context, width, height } = p
      const sea = context.createRadialGradient(
        width / 2,
        height / 2,
        0,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.7,
      )
      sea.addColorStop(0, '#203245')
      sea.addColorStop(1, '#0d1823')
      context.fillStyle = sea
      context.fillRect(0, 0, width, height)
      const map = image()
      if (map !== undefined) {
        const [x0, y0] = p.toScreen(map.left, map.top)
        const [x1, y1] = p.toScreen(map.right, map.bottom)
        context.drawImage(map.image, x0, y0, x1 - x0, y1 - y0)
      }
      grid(
        p,
        {
          line: 'rgba(120, 160, 200, 0.10)',
          axis: 'rgba(120, 160, 200, 0.28)',
          text: 'rgba(170, 195, 220, 0.55)',
        },
        font(10),
      )
    },
    area(p, blip, sx, sy) {
      const { context } = p
      context.globalAlpha = (blip.alpha / 255) * 0.32
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
    route(p, from, to) {
      const { context } = p
      context.lineCap = 'round'
      for (const [colour, width] of [
        ['#1a0f20', 8],
        [MAGENTA, 5],
      ] as const) {
        context.strokeStyle = colour
        context.lineWidth = width
        context.beginPath()
        context.moveTo(...from)
        context.lineTo(...to)
        context.stroke()
      }
      context.lineCap = 'butt'
      context.lineWidth = 1
    },
    blip(p, blip, sx, sy, named) {
      const { context } = p
      context.globalAlpha = Math.max(blip.alpha / 255, 0.3)
      context.strokeStyle = '#000000'
      context.save()
      context.translate(sx, sy)
      if (blip.sprite === WAYPOINT) {
        context.fillStyle = MAGENTA
        context.translate(0, -8)
        drawIcon(context, 'flag', 18, true)
      } else if (blip.shape !== 'radius' && blip.shape !== 'area') {
        const icon = iconOf(blip.sprite)
        context.fillStyle = blipColour(blip.colour)
        if (icon !== undefined) drawIcon(context, icon, 16, true)
        else {
          context.lineWidth = 2
          context.beginPath()
          context.arc(0, 0, 5, 0, Math.PI * 2)
          context.stroke()
          context.fill()
        }
      }
      context.restore()
      context.globalAlpha = 1
      if (named && blip.name !== undefined) {
        outlined(context, blip.name.toUpperCase(), sx + 11, sy + 4, '#ffffff', '#000000', font(11))
      }
    },
    entity(p, entity, sx, sy, _moving, player) {
      const { context, time } = p
      if (entity.kind === 'player') {
        const colour = player?.colour ?? '#ffffff'
        context.save()
        context.translate(sx, sy)
        context.rotate(turnOf(entity))
        // The cone of what the player sees, which pulses as the radar of GTA V does.
        const cone = context.createRadialGradient(0, 0, 0, 0, 0, 34)
        cone.addColorStop(0, 'rgba(255, 255, 255, 0.35)')
        cone.addColorStop(1, 'rgba(255, 255, 255, 0)')
        context.fillStyle = cone
        context.globalAlpha = 0.75 + Math.sin(time / 400) * 0.25
        context.beginPath()
        context.moveTo(0, 0)
        context.arc(0, 0, 34, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6)
        context.closePath()
        context.fill()
        context.globalAlpha = 1
        context.fillStyle = colour
        context.strokeStyle = '#000000'
        context.lineWidth = 2
        context.lineJoin = 'round'
        context.beginPath()
        context.moveTo(0, -11)
        context.lineTo(8, 8)
        context.lineTo(0, 4)
        context.lineTo(-8, 8)
        context.closePath()
        context.stroke()
        context.fill()
        context.restore()
        context.lineWidth = 1
        if (player?.name !== undefined) {
          outlined(
            context,
            player.name.toUpperCase(),
            sx,
            sy + 24,
            colour,
            '#000000',
            font(12),
            'center',
          )
        }
      } else if (entity.kind === 'vehicle') {
        context.save()
        context.translate(sx, sy)
        context.rotate(turnOf(entity))
        context.fillStyle = '#dfe6ee'
        context.strokeStyle = '#000000'
        context.lineWidth = 2
        context.beginPath()
        context.roundRect(-4.5, -8, 9, 16, 3)
        context.stroke()
        context.fill()
        context.restore()
        context.lineWidth = 1
      } else {
        context.fillStyle = entity.kind === 'ped' ? '#e05252' : '#9aa5b1'
        context.strokeStyle = '#000000'
        context.beginPath()
        context.arc(sx, sy, entity.kind === 'ped' ? 4 : 3, 0, Math.PI * 2)
        context.stroke()
        context.fill()
      }
    },
    overlay(p, blips) {
      const { context, width } = p
      // A legend of what the map shows, as the pause menu of GTA V lists it.
      const names = new Map<string, DevBlip>()
      for (const blip of blips)
        if (blip.name !== undefined && !names.has(blip.name)) names.set(blip.name, blip)
      if (names.size === 0) return
      const sorted = [...names.values()].sort((a, b) => a.name!.localeCompare(b.name!))
      const rows = sorted.slice(0, 12)
      const more = sorted.length - rows.length
      context.font = font(12)
      // As wide as its longest name, up to a third of the map, whose longer names it cuts.
      const most = Math.min(Math.max(width / 3, 160), 320)
      const text = (name: string) => {
        let shown = name.toUpperCase()
        while (shown.length > 1 && context.measureText(shown).width > most - 52)
          shown = shown.slice(0, -1)
        return shown === name.toUpperCase() ? shown : `${shown.trimEnd()}…`
      }
      const panel = Math.min(
        Math.max(...rows.map(({ name }) => context.measureText(text(name!)).width)) + 52,
        most,
      )
      const x = width - panel - 14
      const y = 14
      context.fillStyle = 'rgba(0, 0, 0, 0.62)'
      context.beginPath()
      context.roundRect(x, y, panel, 34 + (rows.length + (more > 0 ? 1 : 0)) * 22, 4)
      context.fill()
      context.fillStyle = '#ffffff'
      context.font = font(13)
      context.fillText('LEGEND', x + 12, y + 22)
      rows.forEach((blip, index) => {
        const ry = y + 44 + index * 22
        context.save()
        context.translate(x + 22, ry - 4)
        context.fillStyle = blipColour(blip.colour)
        context.strokeStyle = '#000000'
        const icon = iconOf(blip.sprite)
        if (icon !== undefined) drawIcon(context, icon, 14, true)
        else {
          context.beginPath()
          context.arc(0, 0, 4.5, 0, Math.PI * 2)
          context.fill()
        }
        context.restore()
        context.fillStyle = '#e8eef4'
        context.font = font(12)
        context.fillText(text(blip.name!), x + 40, ry)
      })
      if (more > 0) {
        context.fillStyle = '#9fb0c0'
        context.fillText(`AND ${more} MORE`, x + 40, y + 44 + rows.length * 22)
      }
    },
  }
}
