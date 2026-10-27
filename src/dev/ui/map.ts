import type { DevBlip, DevEntity, DevMap } from '../map.ts'
import type { DevPlayer } from '../session.ts'

/** What the map does in the session. */
export interface MapActions {
  /** Puts the ped of the player of a client at coordinates of the world, at the height it has unless one is given. */
  teleport(client: number, x: number, y: number, z?: number): void
  /** Sets the waypoint of the player of a client at coordinates of the world. */
  waypoint(client: number, x: number, y: number): void
}

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

/** The sprite of the waypoint of players. */
const WAYPOINT = 8

/** Where the world of GTA V is, which the map shows while nothing is on it. */
const WORLD = { left: -4000, right: 4500, bottom: -4000, top: 8000 }

/** How far apart the lines of the grid may be, in metres. */
const STEPS = [10, 25, 50, 100, 250, 500, 1000, 2000]

/** The colour of a blip of a colour id: the map's own for those it names, and a hue of their own for others. */
function blipColour(colour: number): string {
  return BLIP_COLOURS[colour] ?? `hsl(${(colour * 137.5) % 360} 70% 62%)`
}

function playerColour(client: number): string {
  return PLAYER_COLOURS[(client - 1) % PLAYER_COLOURS.length]!
}

/** What the map drew at a point of its canvas, which the cursor hovers and drags. */
type Item = { readonly key: string; readonly sx: number; readonly sy: number } & (
  | { readonly kind: 'blip'; readonly blip: DevBlip }
  | { readonly kind: 'entity'; readonly entity: DevEntity }
)

/**
 * A map of the world of the session: a grid of metres, the entities of the
 * server where their owners synced them, the peds of players, which the
 * cursor drags to put them elsewhere, and the blips of the maps of the
 * players, which a double click adds the waypoint of a player to.
 */
export class WorldMap {
  readonly element: HTMLElement
  readonly #canvas: HTMLCanvasElement
  readonly #context: CanvasRenderingContext2D
  readonly #tooltip: HTMLElement
  readonly #whose: HTMLSelectElement
  readonly #actions: MapActions
  #map: DevMap = { entities: [], blips: [] }
  #players: readonly DevPlayer[] = []
  /** The point of the world at the centre of the canvas, and how many pixels a metre takes. */
  #centreX = (WORLD.left + WORLD.right) / 2
  #centreY = (WORLD.bottom + WORLD.top) / 2
  #scale = 0.05
  /** Whether the user zoomed or moved the map, which then keeps where they put it, where it fits what is on it until then. */
  #moved = false
  #items: Item[] = []
  /** The key of what the cursor hovers. */
  #hover: string | undefined
  #drag:
    | {
        readonly kind: 'pan'
        readonly x: number
        readonly y: number
        readonly cx: number
        readonly cy: number
      }
    | { readonly kind: 'player'; readonly client: number; x: number; y: number }
    | undefined

  constructor(element: HTMLElement, actions: MapActions) {
    this.element = element
    this.#actions = actions
    const toolbar = document.createElement('div')
    toolbar.className = 'toolbar'
    const title = document.createElement('h2')
    title.textContent = 'Map'
    this.#whose = document.createElement('select')
    this.#whose.setAttribute('aria-label', 'Whose blips the map shows')
    this.#whose.addEventListener('change', () => this.#draw())
    const fit = document.createElement('button')
    fit.type = 'button'
    fit.textContent = 'Fit'
    fit.addEventListener('click', () => {
      this.#moved = false
      this.#fit()
    })
    const hint = document.createElement('span')
    hint.className = 'hint'
    hint.textContent = 'Drag a player to move them, double-click to set their waypoint'
    toolbar.append(title, this.#whose, fit, hint)
    const view = document.createElement('div')
    view.className = 'view'
    this.#canvas = document.createElement('canvas')
    this.#context = this.#canvas.getContext('2d')!
    this.#tooltip = document.createElement('div')
    this.#tooltip.className = 'tooltip'
    this.#tooltip.hidden = true
    view.append(this.#canvas, this.#tooltip)
    element.append(toolbar, view)
    new ResizeObserver(() => this.#draw()).observe(view)
    this.#listen()
  }

  /** Shows the world of the session as it is now, with its players. */
  show(map: DevMap, players: readonly DevPlayer[]): void {
    this.#map = map
    if (
      players.map(({ client, name }) => `${client} ${name}`).join() !==
      this.#players.map(({ client, name }) => `${client} ${name}`).join()
    ) {
      const selected = this.#whose.value
      this.#whose.replaceChildren(
        new Option('Blips of every player', ''),
        ...players.map(
          ({ client, name }) => new Option(`Blips of ${name} (${client})`, String(client)),
        ),
      )
      this.#whose.value = players.some(({ client }) => String(client) === selected) ? selected : ''
    }
    this.#players = players
    if (!this.#moved) this.#fit()
    else this.#draw()
  }

  /** The blips of the players that the map shows. */
  get #blips(): readonly DevBlip[] {
    const whose = this.#whose.value
    return whose === ''
      ? this.#map.blips
      : this.#map.blips.filter(({ client }) => String(client) === whose)
  }

  /** The player whose waypoint a double click sets: the one whose blips the map shows, or the first that joined. */
  get #player(): number | undefined {
    const whose = this.#whose.value
    if (whose !== '') return Number(whose)
    return this.#players.find(({ state }) => state === 'joined')?.client
  }

  /** Centres the map on what is on it, or on the world of GTA V while nothing is. */
  #fit(): void {
    const points = [...this.#blips, ...this.#map.entities]
    const { width, height } = this.#canvas.getBoundingClientRect()
    if (width === 0 || height === 0) return
    let left = WORLD.left
    let right = WORLD.right
    let bottom = WORLD.bottom
    let top = WORLD.top
    if (points.length > 0) {
      left = Math.min(...points.map(({ x }) => x))
      right = Math.max(...points.map(({ x }) => x))
      bottom = Math.min(...points.map(({ y }) => y))
      top = Math.max(...points.map(({ y }) => y))
    }
    const margin = Math.max(right - left, top - bottom, 200) * 0.15
    this.#centreX = (left + right) / 2
    this.#centreY = (bottom + top) / 2
    this.#scale = Math.min(
      width / (right - left + 2 * margin),
      height / (top - bottom + 2 * margin),
    )
    this.#draw()
  }

  /** Where a point of the world is on the canvas, in its pixels. */
  #toScreen(x: number, y: number): [number, number] {
    const { width, height } = this.#canvas.getBoundingClientRect()
    return [
      (x - this.#centreX) * this.#scale + width / 2,
      (this.#centreY - y) * this.#scale + height / 2,
    ]
  }

  /** Where a pixel of the canvas is in the world. */
  #toWorld(sx: number, sy: number): [number, number] {
    const { width, height } = this.#canvas.getBoundingClientRect()
    return [
      (sx - width / 2) / this.#scale + this.#centreX,
      this.#centreY - (sy - height / 2) / this.#scale,
    ]
  }

  #listen(): void {
    const canvas = this.#canvas
    const at = (event: MouseEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect()
      return [event.clientX - rect.left, event.clientY - rect.top]
    }
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault()
      this.#moved = true
      const [sx, sy] = at(event)
      const [x, y] = this.#toWorld(sx, sy)
      this.#scale = Math.min(Math.max(this.#scale * (event.deltaY < 0 ? 1.25 : 0.8), 0.005), 40)
      // The point under the cursor stays where it is.
      const [nx, ny] = this.#toWorld(sx, sy)
      this.#centreX += x - nx
      this.#centreY += y - ny
      this.#draw()
    })
    canvas.addEventListener('mousedown', (event) => {
      const [sx, sy] = at(event)
      const item = this.#itemAt(sx, sy)
      if (
        item?.kind === 'entity' &&
        item.entity.kind === 'player' &&
        item.entity.owner !== undefined
      ) {
        // The map stays as it is while the user moves players on it.
        this.#moved = true
        this.#drag = { kind: 'player', client: item.entity.owner, x: sx, y: sy }
      } else {
        this.#drag = { kind: 'pan', x: sx, y: sy, cx: this.#centreX, cy: this.#centreY }
      }
    })
    canvas.addEventListener('mousemove', (event) => {
      const [sx, sy] = at(event)
      const drag = this.#drag
      if (drag?.kind === 'pan') {
        this.#moved = true
        this.#centreX = drag.cx - (sx - drag.x) / this.#scale
        this.#centreY = drag.cy + (sy - drag.y) / this.#scale
      } else if (drag?.kind === 'player') {
        drag.x = sx
        drag.y = sy
      } else {
        this.#hover = this.#itemAt(sx, sy)?.key
      }
      this.#draw()
    })
    const drop = (event: MouseEvent) => {
      const drag = this.#drag
      this.#drag = undefined
      if (drag?.kind === 'player') {
        // A player dropped on a blip goes where it is, as garages and shops are where their blips are.
        const onto = this.#itemAt(...at(event), 'blip')
        if (onto?.kind === 'blip') {
          this.#actions.teleport(drag.client, onto.blip.x, onto.blip.y, onto.blip.z)
        } else {
          this.#actions.teleport(drag.client, ...this.#toWorld(...at(event)))
        }
      }
      this.#draw()
    }
    canvas.addEventListener('mouseup', drop)
    canvas.addEventListener('mouseleave', () => {
      this.#drag = undefined
      this.#hover = undefined
      this.#draw()
    })
    canvas.addEventListener('dblclick', (event) => {
      const player = this.#player
      if (player === undefined) return
      const [x, y] = this.#toWorld(...at(event))
      this.#actions.waypoint(player, x, y)
    })
  }

  /** What the map drew nearest to a pixel of its canvas, within 10 pixels of it, of a kind if one is given. */
  #itemAt(sx: number, sy: number, kind?: Item['kind']): Item | undefined {
    let found: Item | undefined
    let best = 10
    for (const item of this.#items) {
      if (kind !== undefined && item.kind !== kind) continue
      const distance = Math.hypot(item.sx - sx, item.sy - sy)
      if (distance <= best) {
        best = distance
        found = item
      }
    }
    return found
  }

  #draw(): void {
    const canvas = this.#canvas
    const { width, height } = canvas.getBoundingClientRect()
    const ratio = devicePixelRatio
    if (
      canvas.width !== Math.round(width * ratio) ||
      canvas.height !== Math.round(height * ratio)
    ) {
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
    }
    // Where the map looks, for tools that drive the dev UI, such as its demo, to find points of the world on it.
    canvas.dataset.view = `${this.#centreX} ${this.#centreY} ${this.#scale}`
    const context = this.#context
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)
    this.#drawGrid(width, height)
    this.#items = []
    const blips = this.#blips
    // Areas under the rest, then the routes to blips, then blips, then entities over them.
    for (const blip of blips)
      if (blip.shape === 'radius' || blip.shape === 'area') this.#drawArea(blip)
    for (const blip of blips) if (blip.route) this.#drawRoute(blip)
    for (const blip of blips) this.#drawBlip(blip)
    for (const entity of this.#map.entities) this.#drawEntity(entity)
    const drag = this.#drag
    if (drag?.kind === 'player') {
      context.strokeStyle = playerColour(drag.client)
      context.setLineDash([4, 4])
      context.beginPath()
      context.arc(drag.x, drag.y, 9, 0, Math.PI * 2)
      context.stroke()
      context.setLineDash([])
    }
    this.#showTooltip()
  }

  #drawGrid(width: number, height: number): void {
    const context = this.#context
    const step = STEPS.find((each) => each * this.#scale >= 70) ?? STEPS.at(-1)!
    const [left, top] = this.#toWorld(0, 0)
    const [right, bottom] = this.#toWorld(width, height)
    context.lineWidth = 1
    context.font = '11px ui-monospace, Consolas, monospace'
    context.fillStyle = '#5a606c'
    for (let x = Math.ceil(left / step) * step; x <= right; x += step) {
      const [sx] = this.#toScreen(x, 0)
      context.strokeStyle = x === 0 ? '#3a404c' : '#1f232b'
      context.beginPath()
      context.moveTo(Math.round(sx) + 0.5, 0)
      context.lineTo(Math.round(sx) + 0.5, height)
      context.stroke()
      context.fillText(String(x), sx + 3, 12)
    }
    for (let y = Math.ceil(bottom / step) * step; y <= top; y += step) {
      const [, sy] = this.#toScreen(0, y)
      context.strokeStyle = y === 0 ? '#3a404c' : '#1f232b'
      context.beginPath()
      context.moveTo(0, Math.round(sy) + 0.5)
      context.lineTo(width, Math.round(sy) + 0.5)
      context.stroke()
      context.fillText(String(y), 3, sy - 3)
    }
  }

  #drawArea(blip: DevBlip): void {
    const context = this.#context
    const [sx, sy] = this.#toScreen(blip.x, blip.y)
    context.globalAlpha = (blip.alpha / 255) * 0.35
    context.fillStyle = blipColour(blip.colour)
    context.beginPath()
    if (blip.shape === 'radius')
      context.arc(sx, sy, (blip.radius ?? 0) * this.#scale, 0, Math.PI * 2)
    else {
      const w = (blip.width ?? 0) * this.#scale
      const h = (blip.height ?? 0) * this.#scale
      context.rect(sx - w / 2, sy - h / 2, w, h)
    }
    context.fill()
    context.globalAlpha = 1
  }

  #drawRoute(blip: DevBlip): void {
    const ped = this.#map.entities.find(
      ({ kind, owner }) => kind === 'player' && owner === blip.client,
    )
    if (ped === undefined) return
    const context = this.#context
    context.strokeStyle = blipColour(blip.colour)
    context.lineWidth = 2
    context.setLineDash([6, 5])
    context.beginPath()
    context.moveTo(...this.#toScreen(ped.x, ped.y))
    context.lineTo(...this.#toScreen(blip.x, blip.y))
    context.stroke()
    context.setLineDash([])
    context.lineWidth = 1
  }

  #drawBlip(blip: DevBlip): void {
    const context = this.#context
    const [sx, sy] = this.#toScreen(blip.x, blip.y)
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
    const key = `blip ${blip.client} ${blip.handle}`
    this.#items.push({ key, kind: 'blip', blip, sx, sy })
    if (blip.name !== undefined && (this.#scale >= 0.12 || this.#hover === key)) {
      this.#label(blip.name, sx + 8, sy + 4, '#c8ccd4')
    }
  }

  #drawEntity(entity: DevEntity): void {
    const context = this.#context
    const [sx, sy] = this.#toScreen(entity.x, entity.y)
    const turn = (-entity.heading * Math.PI) / 180
    if (entity.kind === 'player') {
      const colour = entity.owner === undefined ? '#d7dae0' : playerColour(entity.owner)
      context.save()
      context.translate(sx, sy)
      context.rotate(turn)
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
      const name = this.#players.find(({ client }) => client === entity.owner)?.name
      if (name !== undefined) this.#label(name, sx + 11, sy + 4, colour)
    } else if (entity.kind === 'vehicle') {
      context.save()
      context.translate(sx, sy)
      context.rotate(turn)
      context.fillStyle = '#8a909c'
      context.fillRect(-4, -7, 8, 14)
      context.restore()
    } else {
      context.fillStyle = entity.kind === 'ped' ? '#a8adb8' : '#5a606c'
      context.beginPath()
      context.arc(sx, sy, entity.kind === 'ped' ? 3.5 : 2.5, 0, Math.PI * 2)
      context.fill()
    }
    this.#items.push({ key: `entity ${entity.id}`, kind: 'entity', entity, sx, sy })
  }

  #label(text: string, x: number, y: number, colour: string): void {
    const context = this.#context
    context.font = '12px system-ui, sans-serif'
    context.lineWidth = 3
    context.strokeStyle = '#0b0c10'
    context.strokeText(text, x, y)
    context.fillStyle = colour
    context.fillText(text, x, y)
    context.lineWidth = 1
  }

  #showTooltip(): void {
    const hover = this.#drag === undefined ? this.#hover : undefined
    const item = this.#items.find(({ key }) => key === hover)
    this.#tooltip.hidden = item === undefined
    if (item === undefined) return
    const playerName = (client: number | undefined) =>
      this.#players.find((player) => player.client === client)?.name ?? 'nobody'
    const at = (x: number, y: number) => `${x.toFixed(1)}, ${y.toFixed(1)}`
    this.#tooltip.textContent =
      item.kind === 'blip'
        ? `${item.blip.name ?? (item.blip.sprite === WAYPOINT ? 'Waypoint' : 'Blip')}\n${at(item.blip.x, item.blip.y)}\nsprite ${item.blip.sprite}, colour ${item.blip.colour}\n${item.blip.script ?? 'the player'}, on the map of ${playerName(item.blip.client)}`
        : `${item.entity.kind} ${item.entity.id}, model 0x${(item.entity.model >>> 0).toString(16)}\n${at(item.entity.x, item.entity.y)}, z ${item.entity.z.toFixed(1)}, heading ${item.entity.heading.toFixed(0)}\nowned by ${playerName(item.entity.owner)}`
    this.#tooltip.style.left = `${item.sx + 14}px`
    this.#tooltip.style.top = `${item.sy + 14}px`
  }
}
