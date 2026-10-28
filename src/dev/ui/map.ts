import type { DevBlip, DevEntity, DevMap } from '../map.ts'
import type { DevPlayer } from '../session.ts'
import {
  blipColour,
  CARTOON,
  CLASSIC,
  gtaStyle,
  type MapImage,
  type MapStyle,
  type Painter,
  playerColour,
  WAYPOINT,
} from './map-styles.ts'

/** What the map does in the session. */
export interface MapActions {
  /** Puts the ped of the player of a client at coordinates of the world, at the height it has unless one is given. */
  teleport(client: number, x: number, y: number, z?: number): void
  /** Sets the waypoint of the player of a client at coordinates of the world. */
  waypoint(client: number, x: number, y: number): void
}

/** Where the world of GTA V is, which the map shows while nothing is on it. */
const WORLD = { left: -4000, right: 4500, bottom: -4000, top: 8000 }

/** How long an entity of an animated style takes to go where it moved, in milliseconds. */
const GLIDE = 450

/** Where the map keeps, in the storage of the browser, the style that the user chose and the edges of their image. */
const STYLE_KEY = 'fiverunner:map-style'
const IMAGE_KEY = 'fiverunner:map-image'

/** Reads what the map keeps in the storage of the browser, which may have none. */
function stored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // The map works without its storage, as it does in private windows.
  }
}

/** What the map drew at a point of its canvas, which the cursor hovers and drags. */
type Item = { readonly key: string; readonly sx: number; readonly sy: number } & (
  | { readonly kind: 'blip'; readonly blip: DevBlip }
  | { readonly kind: 'entity'; readonly entity: DevEntity }
)

/** An entity going from where it was to where it moved, as animated styles show it. */
interface Glide {
  readonly fromX: number
  readonly fromY: number
  readonly toX: number
  readonly toY: number
  readonly start: number
}

/**
 * A map of the world of the session: a grid of metres, the entities of the
 * server where their owners synced them, the peds of players, which the
 * cursor drags to put them elsewhere, and the blips of the maps of the
 * players, which a double click adds the waypoint of a player to. Its
 * styles draw it: classic, a cartoon, or as the pause menu of GTA V, over
 * an image of the world that the user gives it.
 */
export class WorldMap {
  readonly element: HTMLElement
  readonly #canvas: HTMLCanvasElement
  readonly #context: CanvasRenderingContext2D
  readonly #tooltip: HTMLElement
  readonly #whose: HTMLSelectElement
  readonly #imageControls: HTMLElement
  readonly #actions: MapActions
  readonly #styles: readonly MapStyle[]
  #style: MapStyle
  #image: MapImage | undefined
  #map: DevMap = { entities: [], blips: [] }
  #players: readonly DevPlayer[] = []
  /** The point of the world at the centre of the canvas, and how many pixels a metre takes. */
  #centreX = (WORLD.left + WORLD.right) / 2
  #centreY = (WORLD.bottom + WORLD.top) / 2
  #scale = 0.05
  /** Whether the user zoomed or moved the map, which then keeps where they put it, where it fits what is on it until then. */
  #moved = false
  #items: Item[] = []
  /** The entities of animated styles that are going where they moved, and where each was last told to be, by their ids. */
  readonly #glides = new Map<number, Glide>()
  readonly #last = new Map<number, readonly [number, number]>()
  /** Whether a frame of the animation of the style is due. */
  #animating = false
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
    this.#styles = [CLASSIC, CARTOON, gtaStyle(() => this.#image)]
    this.#style = this.#styles.find(({ name }) => name === stored(STYLE_KEY)) ?? CLASSIC
    const toolbar = document.createElement('div')
    toolbar.className = 'toolbar'
    const title = document.createElement('h2')
    title.textContent = 'Map'
    this.#whose = document.createElement('select')
    this.#whose.setAttribute('aria-label', 'Whose blips the map shows')
    this.#whose.addEventListener('change', () => this.#draw())
    const style = document.createElement('select')
    style.setAttribute('aria-label', 'How the map looks')
    style.append(...this.#styles.map(({ name }) => new Option(name, name)))
    style.value = this.#style.name
    style.addEventListener('change', () => this.#use(style.value))
    const fit = document.createElement('button')
    fit.type = 'button'
    fit.textContent = 'Fit'
    fit.addEventListener('click', () => {
      this.#moved = false
      this.#fit()
    })
    this.#imageControls = this.#imageForm()
    const hint = document.createElement('span')
    hint.className = 'hint'
    hint.textContent = 'Drag a player to move them, double-click to set their waypoint'
    toolbar.append(title, this.#whose, style, fit, this.#imageControls, hint)
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
    this.#use(this.#style.name)
  }

  /** Shows the world of the session as it is now, with its players. */
  show(map: DevMap, players: readonly DevPlayer[]): void {
    const now = performance.now()
    for (const entity of map.entities) {
      const last = this.#last.get(entity.id)
      if (
        this.#style.animated &&
        last !== undefined &&
        (last[0] !== entity.x || last[1] !== entity.y)
      ) {
        const [fromX, fromY] = this.#position(entity.id, last, now)
        this.#glides.set(entity.id, { fromX, fromY, toX: entity.x, toY: entity.y, start: now })
      }
      this.#last.set(entity.id, [entity.x, entity.y])
    }
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

  /** Draws the map in a style of a name, which the map keeps for the next time. */
  #use(name: string): void {
    this.#style = this.#styles.find((style) => style.name === name) ?? CLASSIC
    store(STYLE_KEY, this.#style.name)
    this.#glides.clear()
    this.#imageControls.hidden = this.#style.name !== 'GTA'
    this.#draw()
    this.#animate()
  }

  /** Redraws the map at each frame while its style moves of itself, until it no longer does. */
  #animate(): void {
    if (this.#animating || !this.#style.animated) return
    this.#animating = true
    const frame = () => {
      if (!this.#style.animated) {
        this.#animating = false
        return
      }
      this.#draw()
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }

  /** The form that puts an image of the world under the map, with the coordinates of the world at its edges. */
  #imageForm(): HTMLElement {
    const form = document.createElement('details')
    form.className = 'map-image'
    const summary = document.createElement('summary')
    summary.textContent = 'Map image'
    const file = document.createElement('input')
    file.type = 'file'
    file.accept = 'image/*'
    file.setAttribute('aria-label', 'An image of the world to show under the map')
    const edges = (JSON.parse(stored(IMAGE_KEY) ?? 'null') as number[] | null) ?? [
      WORLD.left,
      WORLD.top,
      WORLD.right,
      WORLD.bottom,
    ]
    const inputs = ['Left', 'Top', 'Right', 'Bottom'].map((label, index) => {
      const input = document.createElement('input')
      input.type = 'number'
      input.value = String(edges[index])
      input.setAttribute(
        'aria-label',
        `The ${label.toLowerCase()} edge of the image, in metres of the world`,
      )
      input.title = `${label} edge, in metres`
      return input
    })
    let picture: HTMLImageElement | undefined
    const apply = () => {
      const [left, top, right, bottom] = inputs.map((input) => Number(input.value))
      store(IMAGE_KEY, JSON.stringify([left, top, right, bottom]))
      this.#image =
        picture === undefined
          ? undefined
          : { image: picture, left: left!, top: top!, right: right!, bottom: bottom! }
      this.#draw()
    }
    file.addEventListener('change', () => {
      const chosen = file.files?.[0]
      if (chosen === undefined) return
      const image = new Image()
      image.addEventListener('load', () => {
        picture = image
        apply()
      })
      image.src = URL.createObjectURL(chosen)
    })
    for (const input of inputs) input.addEventListener('change', apply)
    form.append(summary, file, ...inputs)
    return form
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

  /** Where an entity is drawn at `now`: on its way to where it moved, or where it is. */
  #position(id: number, at: readonly [number, number], now: number): [number, number] {
    const glide = this.#glides.get(id)
    if (glide === undefined) return [at[0], at[1]]
    const t = Math.min((now - glide.start) / GLIDE, 1)
    if (t === 1) this.#glides.delete(id)
    const ease = 1 - (1 - t) ** 3
    return [
      glide.fromX + (glide.toX - glide.fromX) * ease,
      glide.fromY + (glide.toY - glide.fromY) * ease,
    ]
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
    const now = performance.now()
    const painter: Painter = {
      context,
      width,
      height,
      scale: this.#scale,
      time: now,
      toScreen: (x, y) => this.#toScreen(x, y),
      toWorld: (sx, sy) => this.#toWorld(sx, sy),
    }
    const style = this.#style
    style.background(painter)
    this.#items = []
    const blips = this.#blips
    const entities = this.#map.entities.map((entity) => {
      const moving = this.#glides.has(entity.id)
      const [x, y] = this.#position(entity.id, [entity.x, entity.y], now)
      return { entity, moving, at: this.#toScreen(x, y) }
    })
    // Areas under the rest, then the routes to blips, then blips, then entities over them, the nearest of the north the furthest back.
    for (const blip of blips) {
      if (blip.shape === 'radius' || blip.shape === 'area') {
        style.area(painter, blip, ...this.#toScreen(blip.x, blip.y))
      }
    }
    for (const blip of blips) {
      if (!blip.route) continue
      const ped = entities.find(
        ({ entity }) => entity.kind === 'player' && entity.owner === blip.client,
      )
      if (ped !== undefined) {
        style.route(painter, ped.at, this.#toScreen(blip.x, blip.y), blipColour(blip.colour))
      }
    }
    for (const blip of blips) {
      const [sx, sy] = this.#toScreen(blip.x, blip.y)
      const key = `blip ${blip.client} ${blip.handle}`
      this.#items.push({ key, kind: 'blip', blip, sx, sy })
      style.blip(painter, blip, sx, sy, this.#scale >= 0.12 || this.#hover === key)
    }
    for (const { entity, moving, at } of [...entities].sort((a, b) => a.at[1] - b.at[1])) {
      const [sx, sy] = at
      const player =
        entity.kind === 'player' && entity.owner !== undefined
          ? {
              colour: playerColour(entity.owner),
              name: this.#players.find(({ client }) => client === entity.owner)?.name,
            }
          : undefined
      style.entity(painter, entity, sx, sy, moving, player)
      this.#items.push({ key: `entity ${entity.id}`, kind: 'entity', entity, sx, sy })
    }
    style.overlay?.(painter, blips)
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
