/**
 * The compositor of the demo of FiveRunner, which runs in Chrome. It draws
 * the video at 60 frames a second: scenes of its own, a title, the tests of
 * a recipe in a terminal and an end, and between them the frames that the
 * recorder took of the dev UI, in a window that a camera moves over, with
 * the cursor, the captions and the cards of chapters that the cues of the
 * recorder call for. It encodes the video, and a soundtrack of its own, for
 * the recorder to put in an MP4.
 */
import { soundtrack, type Sounds } from './soundtrack.ts'

export const WIDTH = 1920
export const HEIGHT = 1080
export const FPS = 60

/** What the recorder did in the dev UI, at a time in milliseconds of its recording, in the pixels of its viewport. */
export type Cue = { readonly time: number } & (
  | {
      readonly kind: 'cursor'
      readonly x: number
      readonly y: number
      readonly duration: number
      /** How far the path of the cursor bows to a side, of its length, as a hand moves a mouse: none for drags. */
      readonly bow?: number
    }
  | { readonly kind: 'click' }
  | { readonly kind: 'press'; readonly down: boolean }
  | { readonly kind: 'key'; readonly label: string }
  | { readonly kind: 'type' }
  | {
      readonly kind: 'caption'
      readonly title?: string
      readonly detail?: string
      readonly right?: boolean
    }
  | {
      readonly kind: 'focus'
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
      readonly duration: number
    }
  | {
      readonly kind: 'chapter'
      readonly number: string
      readonly title: string
      readonly detail: string
    }
  | { readonly kind: 'wipe'; readonly x: number; readonly y: number }
)

/** What the recorder hands the compositor. */
export interface Timeline {
  /** When the recorder took each frame of the dev UI, in milliseconds of its recording after its cuts, and the number of its file. */
  readonly frames: readonly (readonly [time: number, file: number])[]
  readonly cues: readonly Cue[]
  /** How long the recording of the dev UI lasts, after its cuts. */
  readonly length: number
  /** The size of the viewport of the dev UI, in its pixels. */
  readonly viewport: { readonly width: number; readonly height: number }
  /** What the tests of the recipe printed, and the command that ran them. */
  readonly tests: string
  readonly command: string
  /** The address of the dev UI, which its window shows. */
  readonly url: string
}

/** The encoded video and audio, which the compositor posts to /video and /audio, and what the MP4 needs of them. */
export interface Encoded {
  readonly video: {
    readonly description: number[]
    readonly colorSpace: VideoColorSpaceInit
    readonly samples: readonly { readonly size: number; readonly key: boolean }[]
  }
  readonly audio: {
    readonly description: number[]
    readonly sampleRate: number
    readonly channels: number
    readonly samples: readonly number[]
  }
}

const SANS = "'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif"
const TEXT = "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
const MONO = "Consolas, 'Cascadia Mono', ui-monospace, monospace"
const NUMBERS = "Bahnschrift, 'Segoe UI', sans-serif"
const ACCENT = '#f0a030'
const GREEN = '#5fd068'
const MUTED = '#9aa6b8'

/** How long the scenes of the compositor last, and how long each blends into the next, in milliseconds. */
const INTRO = 5600
const OUTRO = 7600
const BLEND = 700
/** How long a card of a chapter shows. */
export const CHAPTER = 1800

const clamp = (value: number, low = 0, high = 1) => Math.min(Math.max(value, low), high)
/** How far through `duration` milliseconds from `start` the time `t` is, from 0 to 1. */
const progress = (t: number, start: number, duration: number) => clamp((t - start) / duration)
const easeOut = (x: number) => 1 - (1 - x) ** 3
export const easeInOut = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2)
const easeBack = (x: number) => 1 + 2.4 * (x - 1) ** 3 + 1.4 * (x - 1) ** 2
const mix = (a: number, b: number, x: number) => a + (b - a) * x

type Context = OffscreenCanvasRenderingContext2D

/** The dark of the backdrop of every scene, with glows that drift and a field of dots. */
function backdrop(c: Context, t: number): void {
  const base = c.createRadialGradient(
    WIDTH / 2,
    HEIGHT * 0.42,
    0,
    WIDTH / 2,
    HEIGHT * 0.42,
    WIDTH * 0.75,
  )
  base.addColorStop(0, '#161c29')
  base.addColorStop(1, '#07090d')
  c.fillStyle = base
  c.fillRect(0, 0, WIDTH, HEIGHT)
  for (const [x, y, radius, colour, phase] of [
    [0.22, 0.28, 620, '240, 160, 48', 0],
    [0.8, 0.74, 680, '79, 214, 224', 2.1],
    [0.62, 0.12, 420, '208, 112, 240', 4.2],
  ] as const) {
    const gx = WIDTH * x + Math.sin(t / 5200 + phase) * 60
    const gy = HEIGHT * y + Math.cos(t / 6100 + phase) * 40
    const glow = c.createRadialGradient(gx, gy, 0, gx, gy, radius)
    glow.addColorStop(0, `rgba(${colour}, 0.13)`)
    glow.addColorStop(1, `rgba(${colour}, 0)`)
    c.fillStyle = glow
    c.fillRect(0, 0, WIDTH, HEIGHT)
  }
  c.fillStyle = 'rgba(255, 255, 255, 0.045)'
  for (let y = 18; y < HEIGHT; y += 36) {
    for (let x = 18; x < WIDTH; x += 36) {
      const fade = 1 - Math.hypot(x / WIDTH - 0.5, y / HEIGHT - 0.5) * 1.6
      if (fade <= 0) continue
      c.globalAlpha = fade
      c.fillRect(x - 1, y - 1, 2, 2)
    }
  }
  c.globalAlpha = 1
}

/** The mark of FiveRunner, `size` pixels wide, centred on `x`, `y`: a run of two chevrons on a rounded square. */
function mark(c: Context, x: number, y: number, size: number): void {
  const s = size / 100
  c.save()
  c.translate(x, y)
  c.scale(s, s)
  c.shadowColor = 'rgba(240, 140, 30, 0.45)'
  c.shadowBlur = 40
  c.shadowOffsetY = 10
  const face = c.createLinearGradient(-50, -50, 50, 50)
  face.addColorStop(0, '#ffc15c')
  face.addColorStop(1, '#f0781e')
  c.fillStyle = face
  c.beginPath()
  c.roundRect(-50, -50, 100, 100, 26)
  c.fill()
  c.shadowColor = 'transparent'
  const shine = c.createLinearGradient(0, -50, 0, 10)
  shine.addColorStop(0, 'rgba(255, 255, 255, 0.35)')
  shine.addColorStop(1, 'rgba(255, 255, 255, 0)')
  c.fillStyle = shine
  c.beginPath()
  c.roundRect(-50, -50, 100, 60, [26, 26, 0, 0])
  c.fill()
  c.fillStyle = '#ffffff'
  for (const [dx, alpha] of [
    [-14, 0.55],
    [12, 1],
  ] as const) {
    c.globalAlpha = alpha
    c.beginPath()
    c.moveTo(dx - 12, -26)
    c.lineTo(dx + 16, 0)
    c.lineTo(dx - 12, 26)
    c.lineTo(dx - 2, 0)
    c.closePath()
    c.fill()
  }
  c.globalAlpha = 1
  c.restore()
}

/** Writes `text` with \`code\` in it, as it marks code, from `x`, `y`, and gives how wide it was. */
function rich(
  c: Context,
  text: string,
  x: number,
  y: number,
  size: number,
  colour: string,
  measure = false,
): number {
  let at = x
  text.split('`').forEach((part, index) => {
    const code = index % 2 === 1
    c.font = code ? `500 ${size * 0.92}px ${MONO}` : `400 ${size}px ${TEXT}`
    if (!measure) {
      c.fillStyle = code ? ACCENT : colour
      c.fillText(part, at, y)
    }
    at += c.measureText(part).width
  })
  return at - x
}

/** The title: the mark, the name and what FiveRunner does, which come in in turn. */
function intro(c: Context, t: number): void {
  backdrop(c, t)
  const push = 1 + progress(t, 0, INTRO) * 0.03
  c.save()
  c.translate(WIDTH / 2, HEIGHT / 2)
  c.scale(push, push)
  c.translate(-WIDTH / 2, -HEIGHT / 2)
  c.font = `700 124px ${SANS}`
  c.letterSpacing = '-3px'
  const name = 'FiveRunner'
  const nameWidth = c.measureText(name).width
  const group = 150 + 36 + nameWidth
  const left = (WIDTH - group) / 2
  const markIn = easeBack(progress(t, 200, 700))
  c.globalAlpha = progress(t, 200, 300)
  mark(c, left + 75, 430, 150 * Math.max(markIn, 0.01))
  c.globalAlpha = 1
  // The name, uncovered from its left.
  const reveal = easeOut(progress(t, 650, 800))
  c.save()
  c.beginPath()
  c.rect(left + 186, 300, nameWidth * reveal + 10, 260)
  c.clip()
  c.fillStyle = '#ffffff'
  c.textBaseline = 'middle'
  c.fillText(name, left + 186 + (1 - reveal) * -40, 436)
  c.restore()
  c.letterSpacing = '0px'
  c.textBaseline = 'alphabetic'
  // What it does, then what it needs none of.
  const line = easeOut(progress(t, 1400, 700))
  c.globalAlpha = line
  c.fillStyle = '#c9d1dc'
  c.font = `400 44px ${TEXT}`
  c.textAlign = 'center'
  c.fillText('Run FiveM resources in your browser and in CI.', WIDTH / 2, 600 + (1 - line) * 24)
  c.textAlign = 'left'
  c.globalAlpha = 1
  const pills = ['No GTA V', 'No FXServer', 'No restarts']
  c.font = `500 30px ${TEXT}`
  const widths = pills.map((pill) => c.measureText(pill).width + 76)
  let x = (WIDTH - widths.reduce((total, width) => total + width, 0) - 24 * (pills.length - 1)) / 2
  pills.forEach((pill, index) => {
    const show = easeOut(progress(t, 2300 + index * 170, 500))
    const width = widths[index]!
    c.globalAlpha = show
    const y = 680 + (1 - show) * 20
    c.fillStyle = 'rgba(18, 23, 33, 0.9)'
    c.strokeStyle = 'rgba(255, 255, 255, 0.1)'
    c.lineWidth = 1.5
    c.beginPath()
    c.roundRect(x, y, width, 60, 30)
    c.fill()
    c.stroke()
    c.strokeStyle = ACCENT
    c.lineWidth = 3.5
    c.lineCap = 'round'
    c.beginPath()
    c.moveTo(x + 26, y + 31)
    c.lineTo(x + 33, y + 38)
    c.lineTo(x + 46, y + 23)
    c.stroke()
    c.lineCap = 'butt'
    c.fillStyle = '#e8edf3'
    c.font = `500 30px ${TEXT}`
    c.fillText(pill, x + 58, y + 40)
    x += width + 24
  })
  c.globalAlpha = 1
  c.restore()
}

/** A card of a chapter over a scene: its number, its title and what it shows, which come and go in turn, `t` from its start. */
function chapter(c: Context, t: number, number: string, title: string, detail: string): void {
  const out = 1 - easeInOut(progress(t, CHAPTER - 420, 420))
  c.fillStyle = `rgba(6, 8, 12, ${0.9 * easeOut(progress(t, 0, 260)) * out})`
  c.fillRect(0, 0, WIDTH, HEIGHT)
  c.save()
  const grow = 1 + (1 - out) * 0.03
  c.translate(WIDTH / 2, HEIGHT / 2)
  c.scale(grow, grow)
  c.translate(-WIDTH / 2, -HEIGHT / 2)
  c.font = `600 170px ${NUMBERS}`
  const numberWidth = c.measureText(number).width
  c.font = `700 96px ${SANS}`
  const titleWidth = c.measureText(title).width
  const detailWidth = rich(c, detail, 0, 0, 36, MUTED, true)
  const group = numberWidth + 70 + Math.max(titleWidth, detailWidth)
  const left = (WIDTH - group) / 2
  const rise = easeOut(progress(t, 0, 420))
  c.globalAlpha = rise * out
  c.lineWidth = 3
  c.strokeStyle = ACCENT
  c.font = `600 170px ${NUMBERS}`
  c.strokeText(number, left, 600 + (1 - rise) * 36)
  c.globalAlpha = out
  const bar = easeOut(progress(t, 150, 420))
  c.fillStyle = 'rgba(255, 255, 255, 0.18)'
  c.fillRect(left + numberWidth + 34, 540 - 90 * bar, 2, 180 * bar)
  const reveal = easeOut(progress(t, 260, 520))
  c.save()
  c.beginPath()
  c.rect(left + numberWidth + 70, 400, titleWidth * reveal + 8, 180)
  c.clip()
  c.fillStyle = '#ffffff'
  c.font = `700 96px ${SANS}`
  c.fillText(title, left + numberWidth + 70, 548)
  c.restore()
  c.globalAlpha = easeOut(progress(t, 480, 420)) * out
  rich(c, detail, left + numberWidth + 72, 612, 36, MUTED)
  c.globalAlpha = 1
  c.restore()
}

/** A caption at the bottom left, or the top left, or on the right of either, of a title and a detail, which slides in, `t` from when it came, and out, `gone` from when it went. */
function caption(
  c: Context,
  t: number,
  gone: number,
  title: string,
  detail: string | undefined,
  top = false,
  right = false,
): void {
  const show = easeOut(progress(t, 0, 380)) * (1 - easeInOut(progress(gone, 0, 220)))
  if (show <= 0) return
  c.font = `600 38px ${SANS}`
  const width =
    Math.max(
      c.measureText(title).width,
      detail === undefined ? 0 : rich(c, detail, 0, 0, 27, MUTED, true),
    ) + 70
  const height = detail === undefined ? 86 : 128
  const x = right ? WIDTH - 88 - width + (1 - show) * 28 : 88 - (1 - show) * 28
  const y = top ? 84 : HEIGHT - 84 - height
  c.globalAlpha = show
  c.fillStyle = 'rgba(0, 0, 0, 0.35)'
  c.beginPath()
  c.roundRect(x, y + 8, width, height, 18)
  c.fill()
  c.fillStyle = 'rgba(12, 15, 22, 0.92)'
  c.strokeStyle = 'rgba(255, 255, 255, 0.09)'
  c.lineWidth = 1.5
  c.beginPath()
  c.roundRect(x, y, width, height, 18)
  c.fill()
  c.stroke()
  c.fillStyle = ACCENT
  c.beginPath()
  c.roundRect(x + 18, y + 22, 5, height - 44, 2.5)
  c.fill()
  c.fillStyle = '#ffffff'
  c.font = `600 38px ${SANS}`
  c.fillText(title, x + 44, y + 58)
  if (detail !== undefined) rich(c, detail, x + 44, y + 100, 27, MUTED)
  c.globalAlpha = 1
}

/** The lines of what the tests printed, in the colours a terminal shows them in. */
function shade(line: string): { colour: string; weight: number } {
  if (/^\s*[✓√]/.test(line)) return { colour: GREEN, weight: 400 }
  if (/^\s*[✗×]/.test(line)) return { colour: '#ff6b6b', weight: 400 }
  if (/^Test/.test(line)) return { colour: '#ffffff', weight: 700 }
  return { colour: '#c4ccd8', weight: 400 }
}

/** Where the terminal of the scene of the tests is, and how big. */
const TERMINAL = { x: 270, y: 160, width: 1380, height: 580 }

/** How long the scene of the tests takes for its output: its card, the command typed, its lines and a hold. */
function terminalLength(timeline: Timeline): number {
  return timesOf(timeline).done + 3300
}

/** When, in the scene of the tests, the terminal comes in, its command is typed and run, and its output is done. */
function timesOf(timeline: Timeline): { start: number; typing: number; run: number; done: number } {
  const start = BLEND + CHAPTER - 200
  const typing = start + 700
  const run = typing + timeline.command.length * 55 + 450
  return { start, typing, run, done: run + timeline.tests.split('\n').length * 120 + 300 }
}

/** The tests of the recipe, run in a terminal, after the card of their chapter. */
function terminal(c: Context, t: number, timeline: Timeline, shadows: Shadows): void {
  backdrop(c, t)
  const { start, typing, run, done } = timesOf(timeline)
  const rise = easeOut(progress(t, start, 600))
  const push = 1 + progress(t, start, 12000) * 0.035
  c.save()
  c.translate(WIDTH / 2, HEIGHT / 2)
  c.scale(push, push)
  c.translate(-WIDTH / 2, -HEIGHT / 2)
  c.globalAlpha = rise
  const x = TERMINAL.x
  const y = TERMINAL.y + (1 - rise) * 40
  const w = TERMINAL.width
  const h = TERMINAL.height
  c.drawImage(shadows.terminal, x - SHADE, y - SHADE)
  c.fillStyle = '#0c0f15'
  c.beginPath()
  c.roundRect(x, y, w, h, 18)
  c.fill()
  c.save()
  c.beginPath()
  c.roundRect(x, y, w, h, 18)
  c.clip()
  c.fillStyle = '#161b24'
  c.fillRect(x, y, w, 56)
  c.fillStyle = 'rgba(255, 255, 255, 0.06)'
  c.fillRect(x, y + 56, w, 1)
  c.restore()
  c.strokeStyle = 'rgba(255, 255, 255, 0.08)'
  c.lineWidth = 1.5
  c.beginPath()
  c.roundRect(x, y, w, h, 18)
  c.stroke()
  for (const [index, colour] of ['#ff5f57', '#febc2e', '#28c840'].entries()) {
    c.fillStyle = colour
    c.beginPath()
    c.arc(x + 30 + index * 24, y + 28, 7.5, 0, Math.PI * 2)
    c.fill()
  }
  c.fillStyle = '#8a93a3'
  c.font = `500 20px ${TEXT}`
  c.textAlign = 'center'
  c.fillText(`qbox — ${timeline.command}`, x + w / 2, y + 35)
  c.textAlign = 'left'
  // The command, typed, then what it printed, line by line.
  const typed = Math.floor(clamp((t - typing) / 55, 0, timeline.command.length))
  const lines = timeline.tests.split('\n')
  const shown = Math.floor(clamp((t - run) / 120, 0, lines.length))
  c.font = `400 32px ${MONO}`
  const left = x + 48
  let row = y + 118
  c.fillStyle = ACCENT
  c.fillText('qbox $ ', left, row)
  const prompt = c.measureText('qbox $ ').width
  c.fillStyle = '#ffffff'
  c.fillText(timeline.command.slice(0, typed), left + prompt, row)
  const caret =
    t < run ? left + prompt + c.measureText(timeline.command.slice(0, typed)).width : left
  for (const line of lines.slice(0, shown)) {
    row += 50
    const { colour, weight } = shade(line)
    c.fillStyle = colour
    c.font = `${weight} 32px ${MONO}`
    c.fillText(line, left, row)
  }
  c.font = `400 32px ${MONO}`
  if (Math.floor(t / 530) % 2 === 0) {
    c.fillStyle = 'rgba(230, 235, 242, 0.85)'
    c.fillRect(caret + 2, (t < run ? y + 118 : row + 50) - 26, 16, 32)
  }
  c.restore()
  const took = /Duration: ([\d.]+) s/.exec(timeline.tests)?.[1]
  if (t >= done) {
    caption(
      c,
      t - done,
      -1,
      `Tested in ${took} seconds`,
      "Qbox's whole txAdmin recipe, and a car out of its garage",
    )
  }
  if (t >= BLEND && t < BLEND + CHAPTER) {
    chapter(c, t - BLEND, '01', 'Test', '`npx fiverunner test`, in CI or on your machine')
  }
}

/** The frames of the dev UI, as bitmaps, which the compositor fetches as it needs them, the next ones ahead of time. */
class Frames {
  readonly #timeline: Timeline
  readonly #bitmaps = new Map<number, Promise<ImageBitmap>>()
  #pinned: [number, Promise<ImageBitmap>] | undefined

  constructor(timeline: Timeline) {
    this.#timeline = timeline
  }

  /** The index of the frame that shows at `time` of the recording: the last that came by then. */
  indexAt(time: number): number {
    const { frames } = this.#timeline
    let low = 0
    let high = frames.length - 1
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (frames[middle]![0] <= time) low = middle
      else high = middle - 1
    }
    return low
  }

  /** The bitmap of a frame, and those of the frames after it, which it starts to decode, as it lets go of those behind it. */
  at(index: number): Promise<ImageBitmap> {
    for (let next = index; next < Math.min(index + 4, this.#timeline.frames.length); next++) {
      if (!this.#bitmaps.has(next)) this.#bitmaps.set(next, this.#load(next))
    }
    for (const [kept, bitmap] of this.#bitmaps) {
      if (kept < index - 1 || kept > index + 8) {
        this.#bitmaps.delete(kept)
        void bitmap.then((done) => done.close())
      }
    }
    return this.#bitmaps.get(index)!
  }

  /** The bitmap of a frame that stays as others come and go, such as the one that a wipe goes from. */
  pinned(index: number): Promise<ImageBitmap> {
    if (this.#pinned?.[0] !== index) {
      void this.#pinned?.[1].then((done) => done.close())
      this.#pinned = [index, this.#load(index)]
    }
    return this.#pinned[1]
  }

  #load(index: number): Promise<ImageBitmap> {
    return fetch(`/frame/${this.#timeline.frames[index]![1]}`)
      .then((response) => response.blob())
      .then((blob) => createImageBitmap(blob))
  }
}

/** Where the camera of the dev UI looks, at a point of the window in the pixels of the viewport, and how far it zooms in. */
interface Camera {
  readonly x: number
  readonly y: number
  readonly zoom: number
}

/** The window of the dev UI: its bar, of the pixels of the viewport, above its viewport, and how big the whole window shows when the camera does not zoom. */
const BAR = 46
const FIT = 0.92

/** Where the cursor is at `time`, as its cues move it, eased along a slight curve. */
function cursorAt(cues: readonly Cue[], time: number): [number, number] {
  let at: [number, number] = [1450, 760]
  for (const cue of cues) {
    if (cue.time > time) break
    if (cue.kind !== 'cursor') continue
    const from = at
    const x = easeInOut(progress(time, cue.time, cue.duration))
    const bow =
      Math.sin(x * Math.PI) * Math.hypot(cue.x - from[0], cue.y - from[1]) * (cue.bow ?? 0.08)
    const angle = Math.atan2(cue.y - from[1], cue.x - from[0]) - Math.PI / 2
    at = [
      mix(from[0], cue.x, x) + Math.cos(angle) * bow,
      mix(from[1], cue.y, x) + Math.sin(angle) * bow,
    ]
  }
  return at
}

/** Where the camera looks at `time`, as the cues of focus move it, between the whole window and what they frame. */
function cameraAt(cues: readonly Cue[], time: number, viewport: Timeline['viewport']): Camera {
  const whole: Camera = { x: viewport.width / 2, y: (viewport.height - BAR) / 2, zoom: 1 }
  let camera = whole
  for (const cue of cues) {
    if (cue.time > time) break
    if (cue.kind !== 'focus') continue
    const target = framing(cue, viewport)
    const from = camera
    const x = easeInOut(progress(time, cue.time, cue.duration))
    camera = {
      x: mix(from.x, target.x, x),
      y: mix(from.y, target.y, x),
      zoom: Math.exp(mix(Math.log(from.zoom), Math.log(target.zoom), x)),
    }
  }
  return camera
}

/** The camera that frames a rectangle of the viewport, as near as its pixels stay sharp, and inside the window. */
function framing(cue: Extract<Cue, { kind: 'focus' }>, viewport: Timeline['viewport']): Camera {
  const zoom = clamp(
    Math.min((WIDTH * 0.86) / (FIT * cue.width), (HEIGHT * 0.78) / (FIT * cue.height)),
    1,
    2.05,
  )
  const halfWidth = WIDTH / 2 / (FIT * zoom)
  const halfHeight = HEIGHT / 2 / (FIT * zoom)
  const keep = (value: number, low: number, high: number, half: number) =>
    high - low <= half * 2 ? (low + high) / 2 : clamp(value, low + half, high - half)
  return {
    x: keep(cue.x + cue.width / 2, 0, viewport.width, halfWidth),
    y: keep(cue.y + cue.height / 2, -BAR, viewport.height, halfHeight),
    zoom,
  }
}

/** The arrow of the cursor, its tip at the origin, a little smaller while it presses. */
function pointer(c: Context, pressed: boolean): void {
  c.save()
  if (pressed) c.scale(0.88, 0.88)
  c.shadowColor = 'rgba(0, 0, 0, 0.45)'
  c.shadowBlur = 8
  c.shadowOffsetY = 3
  c.beginPath()
  c.moveTo(0, 0)
  c.lineTo(0, 30)
  c.lineTo(7.5, 23.5)
  c.lineTo(12.5, 34.5)
  c.lineTo(17.5, 32.5)
  c.lineTo(12.5, 21.5)
  c.lineTo(22, 21.5)
  c.closePath()
  c.fillStyle = '#ffffff'
  c.fill()
  c.shadowColor = 'transparent'
  c.lineWidth = 1.8
  c.lineJoin = 'round'
  c.strokeStyle = '#11131a'
  c.stroke()
  c.restore()
}

/** A key of the keyboard, as wide as its label, which pops up, goes down as it is pressed, and fades, `t` from when it was. */
function keycap(c: Context, t: number, label: string, x: number, y: number): void {
  const show = easeBack(progress(t, 0, 260)) * (1 - progress(t, 1000, 260))
  if (show <= 0) return
  const down = t > 280 && t < 520 ? 4 : 0
  c.font = `700 ${label.length > 1 ? 28 : 38}px ${SANS}`
  const half = Math.max(36, c.measureText(label).width / 2 + 24)
  c.save()
  c.translate(x + half - 36, y)
  c.scale(show, show)
  c.fillStyle = 'rgba(0, 0, 0, 0.4)'
  c.beginPath()
  c.roundRect(-half - 2, -30, half * 2 + 4, 76, 14)
  c.fill()
  c.fillStyle = '#c9cfd8'
  c.beginPath()
  c.roundRect(-half, -36 + down, half * 2, 72, 14)
  c.fill()
  c.fillStyle = down > 0 ? '#e9edf2' : '#ffffff'
  c.beginPath()
  c.roundRect(-half, -40 + down, half * 2, 66, 14)
  c.fill()
  c.fillStyle = '#1a1d25'
  c.textAlign = 'center'
  c.fillText(label, 0, (label.length > 1 ? 2 : 6) + down)
  c.textAlign = 'left'
  c.restore()
}

/** The dev UI, in its window, under the camera, with the cursor, the captions and the cards that the cues call for. */
async function dev(
  c: Context,
  t: number,
  timeline: Timeline,
  frames: Frames,
  shadows: Shadows,
): Promise<void> {
  backdrop(c, t)
  const { viewport, cues } = timeline
  const camera = cameraAt(cues, t, viewport)
  const scale = FIT * camera.zoom
  /** Where a point of the window, in the pixels of the viewport, is on the video. */
  const toVideo = (x: number, y: number): [number, number] => [
    WIDTH / 2 + (x - camera.x) * scale,
    HEIGHT / 2 + (y - camera.y) * scale,
  ]
  const [left, top] = toVideo(0, -BAR)
  const [right, bottom] = toVideo(viewport.width, viewport.height)
  const rise = easeOut(progress(t, 0, 500))
  c.save()
  c.globalAlpha = rise
  c.translate(0, (1 - rise) * 30)
  // The shadow of the window, blurred once, which the camera scales.
  c.drawImage(
    shadows.dev,
    left - SHADE * scale,
    top - SHADE * scale,
    shadows.dev.width * scale,
    shadows.dev.height * scale,
  )
  const radius = 14 * scale
  c.save()
  c.beginPath()
  c.roundRect(left, top, right - left, bottom - top, radius)
  c.clip()
  c.fillStyle = '#171b23'
  c.fillRect(left, top, right - left, BAR * scale)
  // The frame of the dev UI at this time, or two of them as a wipe goes from one to the other.
  const [vx, vy] = toVideo(0, 0)
  const index = frames.indexAt(t)
  c.imageSmoothingQuality = 'high'
  const wipe = cues.findLast((cue) => cue.kind === 'wipe' && cue.time <= t && t < cue.time + 700)
  if (wipe?.kind === 'wipe') {
    const before = await frames.pinned(Math.max(frames.indexAt(wipe.time - 1), 0))
    c.drawImage(before, vx, vy, viewport.width * scale, viewport.height * scale)
    const [cx, cy] = toVideo(wipe.x, wipe.y)
    const reach = Math.max(
      ...[left, right].flatMap((x) => [top, bottom].map((y) => Math.hypot(x - cx, y - cy))),
    )
    const r = reach * easeInOut(progress(t, wipe.time, 700))
    c.save()
    c.beginPath()
    c.arc(cx, cy, Math.max(r, 0.1), 0, Math.PI * 2)
    c.clip()
    c.drawImage(await frames.at(index), vx, vy, viewport.width * scale, viewport.height * scale)
    c.restore()
    c.strokeStyle = 'rgba(255, 255, 255, 0.7)'
    c.lineWidth = 3
    c.beginPath()
    c.arc(cx, cy, Math.max(r, 0.1), 0, Math.PI * 2)
    c.stroke()
  } else {
    c.drawImage(await frames.at(index), vx, vy, viewport.width * scale, viewport.height * scale)
  }
  c.restore()
  // The bar of the window: its buttons, and where the dev UI is.
  for (const [n, colour] of ['#ff5f57', '#febc2e', '#28c840'].entries()) {
    c.fillStyle = colour
    c.beginPath()
    c.arc(left + (22 + n * 22) * scale, top + (BAR / 2) * scale, 6.5 * scale, 0, Math.PI * 2)
    c.fill()
  }
  const pill = 520 * scale
  c.fillStyle = '#0f1218'
  c.beginPath()
  c.roundRect((left + right) / 2 - pill / 2, top + 9 * scale, pill, (BAR - 18) * scale, 8 * scale)
  c.fill()
  c.fillStyle = '#9aa3b2'
  c.font = `400 ${15 * scale}px ${TEXT}`
  c.textAlign = 'center'
  c.fillText(timeline.url, (left + right) / 2, top + (BAR / 2 + 5) * scale)
  c.textAlign = 'left'
  c.strokeStyle = 'rgba(255, 255, 255, 0.1)'
  c.lineWidth = 1.5
  c.beginPath()
  c.roundRect(left, top, right - left, bottom - top, radius)
  c.stroke()
  c.restore()
  // The cursor, the ripples of its clicks and the keys it presses.
  const [mx, my] = toVideo(...cursorAt(cues, t))
  for (const cue of cues) {
    if (cue.time > t) break
    const age = t - cue.time
    if (cue.kind === 'click' && age < 520) {
      const [x, y] = toVideo(...cursorAt(cues, cue.time))
      const ring = easeOut(age / 520)
      c.strokeStyle = `rgba(240, 160, 48, ${0.95 * (1 - ring)})`
      c.lineWidth = 3.5
      c.beginPath()
      c.arc(x, y, 6 + ring * 30, 0, Math.PI * 2)
      c.stroke()
    }
  }
  const press = cues.findLast((cue) => cue.kind === 'press' && cue.time <= t)
  const pressed =
    (press?.kind === 'press' && press.down) ||
    cues.some((cue) => cue.kind === 'click' && cue.time <= t && t - cue.time < 140)
  c.save()
  c.translate(mx, my)
  pointer(c, pressed)
  c.restore()
  const key = cues.findLast((cue) => cue.kind === 'key' && cue.time <= t && t - cue.time < 1300)
  if (key?.kind === 'key') keycap(c, t - key.time, key.label, mx + 70, my + 40)
  // The caption, as the last cue of captions left it, after the one before it goes, and the card of a chapter.
  const said = cues.filter((cue) => cue.kind === 'caption' && cue.time <= t)
  const last = said.at(-1)
  const before = said.at(-2)
  const replaced = before?.kind === 'caption' && before.title !== undefined
  if (replaced && last !== undefined) {
    caption(
      c,
      t - before.time,
      t - last.time,
      before.title!,
      before.detail,
      topFor(timeline, before),
      before.right,
    )
  }
  if (last?.kind === 'caption' && last.title !== undefined) {
    caption(
      c,
      t - last.time - (replaced ? 200 : 0),
      -1,
      last.title,
      last.detail,
      topFor(timeline, last),
      last.right,
    )
  }
  const card = cues.findLast(
    (cue) => cue.kind === 'chapter' && cue.time <= t && t - cue.time < CHAPTER,
  )
  if (card?.kind === 'chapter') chapter(c, t - card.time, card.number, card.title, card.detail)
}

/** How far round a window its shadow goes, in the pixels of the window. */
const SHADE = 160

/** Whether a caption goes at the top, as what the camera frames for it is low on the screen, where the caption would cover it. */
function topFor(timeline: Timeline, cue: Cue): boolean {
  const focus = timeline.cues.findLast(
    (each) => each.kind === 'focus' && each.time <= cue.time + 500,
  )
  if (focus?.kind !== 'focus') return false
  const camera = cameraAt(timeline.cues, focus.time + focus.duration, timeline.viewport)
  const middle = focus.y + focus.height / 2
  return HEIGHT / 2 + (middle - camera.y) * FIT * camera.zoom > HEIGHT * 0.62
}

/** The shadow that a window of a size and of round corners casts, blurred once, as the blur of each frame would take long. */
function shadowOf(width: number, height: number, radius: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width + SHADE * 2, height + SHADE * 2)
  const c = canvas.getContext('2d')!
  c.shadowColor = 'rgba(0, 0, 0, 0.72)'
  c.shadowBlur = 70
  c.shadowOffsetY = 30
  c.fillStyle = '#000000'
  c.beginPath()
  c.roundRect(SHADE, SHADE, width, height, radius)
  c.fill()
  // The window covers the shape that cast the shadow, which stays out of it as it fades in.
  c.globalCompositeOperation = 'destination-out'
  c.shadowColor = 'transparent'
  c.beginPath()
  c.roundRect(SHADE, SHADE, width, height, radius)
  c.fill()
  return canvas
}

/** The shadows of the windows of the video. */
interface Shadows {
  readonly terminal: OffscreenCanvas
  readonly dev: OffscreenCanvas
}

/** The end: the mark, the command that starts it all, what FiveRunner does, and where it is. */
function outro(c: Context, t: number): void {
  backdrop(c, t)
  const fade = 1 - easeInOut(progress(t, OUTRO - 900, 900))
  c.save()
  c.globalAlpha = fade
  const show = easeOut(progress(t, 150, 700))
  c.globalAlpha = show * fade
  mark(c, WIDTH / 2 - 170, 286, 92)
  c.fillStyle = '#ffffff'
  c.font = `700 76px ${SANS}`
  c.letterSpacing = '-2px'
  c.textBaseline = 'middle'
  c.fillText('FiveRunner', WIDTH / 2 - 106, 290)
  c.letterSpacing = '0px'
  c.textBaseline = 'alphabetic'
  // The command, typed into a box of code.
  const command = 'npx fiverunner dev'
  const box = easeOut(progress(t, 500, 600))
  c.globalAlpha = box * fade
  c.font = `400 54px ${MONO}`
  const width = c.measureText(`$ ${command}`).width + 110
  const x = (WIDTH - width) / 2
  const y = 420 + (1 - box) * 24
  c.fillStyle = '#0e131c'
  c.strokeStyle = 'rgba(240, 160, 48, 0.55)'
  c.lineWidth = 2
  c.beginPath()
  c.roundRect(x, y, width, 112, 20)
  c.fill()
  c.stroke()
  const typed = Math.floor(clamp((t - 900) / 60, 0, command.length))
  c.fillStyle = ACCENT
  c.fillText('$', x + 50, y + 74)
  c.fillStyle = '#ffffff'
  const prompt = c.measureText('$ ').width
  c.fillText(command.slice(0, typed), x + 50 + prompt, y + 74)
  if (Math.floor(t / 530) % 2 === 0) {
    c.fillStyle = 'rgba(255, 255, 255, 0.8)'
    c.fillRect(x + 50 + prompt + c.measureText(command.slice(0, typed)).width + 4, y + 34, 26, 50)
  }
  // What it does, one after the other.
  const features = [
    'Tests in CI',
    'A dev UI in your browser',
    'Their NUIs, live',
    'Qbox and ESX, as released',
  ]
  c.font = `500 32px ${TEXT}`
  const widths = features.map((feature) => c.measureText(feature).width)
  const gap = 90
  let fx =
    (WIDTH - widths.reduce((total, w) => total + w + 44, 0) - gap * (features.length - 1)) / 2
  features.forEach((feature, index) => {
    const reveal = easeOut(progress(t, 2100 + index * 180, 500))
    c.globalAlpha = reveal * fade
    const fy = 680 + (1 - reveal) * 18
    c.strokeStyle = GREEN
    c.lineWidth = 3.5
    c.lineCap = 'round'
    c.beginPath()
    c.arc(fx + 16, fy - 11, 16, 0, Math.PI * 2)
    c.stroke()
    c.beginPath()
    c.moveTo(fx + 8, fy - 11)
    c.lineTo(fx + 14, fy - 5)
    c.lineTo(fx + 24, fy - 17)
    c.stroke()
    c.lineCap = 'butt'
    c.fillStyle = '#e8edf3'
    c.font = `500 32px ${TEXT}`
    c.fillText(feature, fx + 44, fy)
    fx += widths[index]! + 44 + gap
  })
  c.globalAlpha = easeOut(progress(t, 2900, 600)) * fade
  c.fillStyle = MUTED
  c.font = `400 30px ${TEXT}`
  c.textAlign = 'center'
  c.fillText('github.com/DariusHQ/fiverunner  ·  open source, MIT', WIDTH / 2, 860)
  c.textAlign = 'left'
  c.globalAlpha = 1
  c.restore()
}

/** The scenes of the video, when each starts and how long it lasts, in milliseconds of the video. */
function scenesOf(
  timeline: Timeline,
): { name: 'intro' | 'test' | 'dev' | 'outro'; start: number; length: number }[] {
  const test = terminalLength(timeline)
  const testStart = INTRO - BLEND
  const devStart = testStart + test - BLEND
  const outroStart = devStart + timeline.length - BLEND
  return [
    { name: 'intro', start: 0, length: INTRO },
    { name: 'test', start: testStart, length: test },
    { name: 'dev', start: devStart, length: timeline.length },
    { name: 'outro', start: outroStart, length: OUTRO },
  ]
}

/** Draws the video at `time` on `canvas`, blending the scenes that it is between. */
async function draw(
  canvas: OffscreenCanvas,
  layers: readonly [OffscreenCanvas, OffscreenCanvas],
  time: number,
  timeline: Timeline,
  frames: Frames,
  shadows: Shadows,
): Promise<void> {
  const c = canvas.getContext('2d')!
  const showing = scenesOf(timeline).filter(
    ({ start, length }) => time >= start && time < start + length,
  )
  const paint = async (target: Context, scene: (typeof showing)[number]) => {
    const t = time - scene.start
    if (scene.name === 'intro') intro(target, t)
    else if (scene.name === 'test') terminal(target, t, timeline, shadows)
    else if (scene.name === 'dev') await dev(target, t, timeline, frames, shadows)
    else outro(target, t)
  }
  if (showing.length < 2) {
    if (showing[0] === undefined) {
      c.fillStyle = '#000000'
      c.fillRect(0, 0, WIDTH, HEIGHT)
    } else await paint(c, showing[0])
    return
  }
  // A blend: the scene that ends grows and fades, and the one that starts comes in over it.
  const [from, to] = showing as [(typeof showing)[number], (typeof showing)[number]]
  const x = easeInOut(progress(time, to.start, BLEND))
  await paint(layers[0].getContext('2d')!, from)
  await paint(layers[1].getContext('2d')!, to)
  c.fillStyle = '#000000'
  c.fillRect(0, 0, WIDTH, HEIGHT)
  for (const [layer, alpha, scale] of [
    [layers[0], 1, 1 + x * 0.05],
    [layers[1], x, 0.97 + x * 0.03],
  ] as const) {
    c.save()
    c.globalAlpha = alpha
    c.translate(WIDTH / 2, HEIGHT / 2)
    c.scale(scale, scale)
    c.drawImage(layer, -WIDTH / 2, -HEIGHT / 2)
    c.restore()
  }
}

/** A rectangle of the video, in its pixels. */
export interface Crop {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** When and where the video shows the tests done, for a picture of them: the terminal, with room round it. */
export function testsPicture(timeline: Timeline): { time: number; crop: Crop } {
  const room = 48
  return {
    time:
      scenesOf(timeline).find(({ name }) => name === 'test')!.start + timesOf(timeline).done + 700,
    crop: {
      x: TERMINAL.x - room,
      y: TERMINAL.y - room,
      width: TERMINAL.width + room * 2,
      height: TERMINAL.height + room * 2,
    },
  }
}

/** The length of the video, in milliseconds. */
export function lengthOf(timeline: Timeline): number {
  const last = scenesOf(timeline).at(-1)!
  return last.start + last.length
}

/** What the soundtrack follows: when the scenes change, the clicks, the keys, the typing and the captions, in milliseconds of the video. */
function soundsOf(timeline: Timeline): Sounds {
  const scenes = scenesOf(timeline)
  const dev = scenes.find(({ name }) => name === 'dev')!.start
  const test = scenes.find(({ name }) => name === 'test')!.start
  const at = (kinds: readonly Cue['kind'][]) =>
    timeline.cues.filter(({ kind }) => kinds.includes(kind)).map(({ time }) => dev + time)
  const command = test + timesOf(timeline).typing
  return {
    length: lengthOf(timeline),
    changes: scenes.slice(1).map(({ start }) => start),
    clicks: at(['click']),
    keys: [
      ...at(['type', 'key']),
      ...[...timeline.command].map((_, index) => command + index * 55),
    ],
    whooshes: [...at(['chapter', 'wipe']), test],
    pops: at(['caption']),
  }
}

/** Draws the video at the times of `times`, in milliseconds, and posts each, or `crop` of it, as a PNG to /still/<index>. */
export async function stills(
  timeline: Timeline,
  times: readonly number[],
  crop?: Crop,
): Promise<void> {
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT)
  const layers = [new OffscreenCanvas(WIDTH, HEIGHT), new OffscreenCanvas(WIDTH, HEIGHT)] as const
  const frames = new Frames(timeline)
  const shadows: Shadows = {
    terminal: shadowOf(TERMINAL.width, TERMINAL.height, 18),
    dev: shadowOf(timeline.viewport.width, timeline.viewport.height + BAR, 14),
  }
  const picture = crop === undefined ? canvas : new OffscreenCanvas(crop.width, crop.height)
  for (const [index, time] of times.entries()) {
    await draw(canvas, layers, time, timeline, frames, shadows)
    if (crop !== undefined) picture.getContext('2d')!.drawImage(canvas, -crop.x, -crop.y)
    await fetch(`/still/${index}`, {
      method: 'POST',
      body: await picture.convertToBlob({ type: 'image/png' }),
    })
  }
}

/** Draws the whole video and encodes it, with its soundtrack, posting them to /video and /audio. */
export async function compose(timeline: Timeline, quantizer: number): Promise<Encoded> {
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT)
  const layers = [new OffscreenCanvas(WIDTH, HEIGHT), new OffscreenCanvas(WIDTH, HEIGHT)] as const
  const frames = new Frames(timeline)
  const shadows: Shadows = {
    terminal: shadowOf(TERMINAL.width, TERMINAL.height, 18),
    dev: shadowOf(timeline.viewport.width, timeline.viewport.height + BAR, 14),
  }
  const count = Math.round((lengthOf(timeline) * FPS) / 1000)
  const config: VideoEncoderConfig = {
    codec: 'avc1.64002A',
    width: WIDTH,
    height: HEIGHT,
    framerate: FPS,
    bitrateMode: 'quantizer',
    avc: { format: 'avc' },
  }
  if (!(await VideoEncoder.isConfigSupported(config)).supported) {
    throw new Error('This Chrome cannot encode H.264 at 60 frames a second at a constant quantizer')
  }
  const chunks: Uint8Array[] = []
  const samples: { size: number; key: boolean }[] = []
  let description: number[] = []
  let colorSpace: VideoColorSpaceInit = {}
  let failure: unknown
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      const config = metadata?.decoderConfig
      if (config?.description !== undefined) {
        const bytes = config.description
        description = Array.from(
          ArrayBuffer.isView(bytes)
            ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
            : new Uint8Array(bytes),
        )
        colorSpace = config.colorSpace ?? {}
      }
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      chunks.push(data)
      samples.push({ size: chunk.byteLength, key: chunk.type === 'key' })
    },
    error: (error) => (failure = error),
  })
  encoder.configure(config)
  for (let k = 0; k < count && failure === undefined; k++) {
    await draw(canvas, layers, (k * 1000) / FPS, timeline, frames, shadows)
    const video = new VideoFrame(canvas, {
      timestamp: Math.round((k * 1e6) / FPS),
      duration: Math.round(1e6 / FPS),
    })
    encoder.encode(video, { keyFrame: k % (2 * FPS) === 0, avc: { quantizer } })
    video.close()
    while (encoder.encodeQueueSize > 6) {
      await new Promise((done) => encoder.addEventListener('dequeue', done, { once: true }))
    }
    if (k % FPS === 0) console.log(`composed ${k / FPS} of ${Math.round(count / FPS)} s`)
  }
  if (failure === undefined) await encoder.flush()
  if (failure !== undefined) throw failure
  await fetch('/video', { method: 'POST', body: new Blob(chunks as BlobPart[]) })
  const audio = await encodeAudio(await soundtrack(soundsOf(timeline)))
  return { video: { description, colorSpace, samples }, audio }
}

/** Encodes `buffer` as AAC, from its sample `from`, and gives its frames and its config, for a decoder. */
async function aac(
  buffer: AudioBuffer,
  config: AudioEncoderConfig,
  from = 0,
): Promise<{ chunks: Uint8Array[]; samples: number[]; description: number[] }> {
  const chunks: Uint8Array[] = []
  const samples: number[] = []
  let description: number[] = []
  let failure: unknown
  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      const bytes = metadata?.decoderConfig?.description
      if (bytes !== undefined) {
        description = Array.from(
          ArrayBuffer.isView(bytes)
            ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
            : new Uint8Array(bytes),
        )
      }
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      chunks.push(data)
      samples.push(chunk.byteLength)
    },
    error: (error) => (failure = error),
  })
  encoder.configure(config)
  const step = 4800
  for (let offset = from; offset < buffer.length && failure === undefined; offset += step) {
    const frames = Math.min(step, buffer.length - offset)
    const planes = new Float32Array(frames * buffer.numberOfChannels)
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      planes.set(buffer.getChannelData(channel).subarray(offset, offset + frames), channel * frames)
    }
    const data = new AudioData({
      format: 'f32-planar',
      sampleRate: buffer.sampleRate,
      numberOfFrames: frames,
      numberOfChannels: buffer.numberOfChannels,
      timestamp: Math.round(((offset - from) * 1e6) / buffer.sampleRate),
      data: planes,
    })
    encoder.encode(data)
    data.close()
  }
  if (failure === undefined) await encoder.flush()
  if (failure !== undefined) throw failure
  return { chunks, samples, description }
}

/**
 * How many samples late the AAC of `config` decodes what it encoded, the
 * priming of its encoder, from where an encoded click comes back: which the
 * soundtrack starts early by, for its sounds to fall on their pictures.
 */
async function primingOf(config: AudioEncoderConfig): Promise<number> {
  const rate = config.sampleRate
  const click = new AudioBuffer({
    length: rate,
    sampleRate: rate,
    numberOfChannels: config.numberOfChannels,
  })
  const at = Math.round(rate / 4)
  for (let channel = 0; channel < click.numberOfChannels; channel++) {
    const data = click.getChannelData(channel)
    for (let i = 0; i < 96; i++)
      data[at + i] = Math.sin((i / 96) * Math.PI) * Math.sin((i / 48) * Math.PI * 2 * 2)
  }
  const { chunks, description } = await aac(click, config)
  const decoded: Float32Array[] = []
  let failure: unknown
  const decoder = new AudioDecoder({
    output: (data) => {
      const plane = new Float32Array(data.numberOfFrames)
      data.copyTo(plane, { planeIndex: 0, format: 'f32-planar' })
      decoded.push(plane)
      data.close()
    },
    error: (error) => (failure = error),
  })
  decoder.configure({
    codec: config.codec,
    sampleRate: rate,
    numberOfChannels: config.numberOfChannels,
    description: new Uint8Array(description),
  })
  let timestamp = 0
  for (const data of chunks) {
    decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp, data }))
    timestamp += Math.round((1024 * 1e6) / rate)
  }
  await decoder.flush()
  if (failure !== undefined) throw failure
  const all = new Float32Array(decoded.reduce((total, plane) => total + plane.length, 0))
  decoded.reduce((offset, plane) => (all.set(plane, offset), offset + plane.length), 0)
  // The middle of the click, where it is loudest, against where it went in.
  let loudest = 0
  for (let i = 0; i < all.length; i++) if (Math.abs(all[i]!) > Math.abs(all[loudest]!)) loudest = i
  let wanted = at
  for (let i = at; i < at + 96; i++)
    if (Math.abs(click.getChannelData(0)[i]!) > Math.abs(click.getChannelData(0)[wanted]!))
      wanted = i
  return Math.max(loudest - wanted, 0)
}

/** Encodes a soundtrack as AAC, early by the priming of its encoder, posting its frames to /audio. */
async function encodeAudio(buffer: AudioBuffer): Promise<Encoded['audio']> {
  const config: AudioEncoderConfig = {
    codec: 'mp4a.40.2',
    sampleRate: buffer.sampleRate,
    numberOfChannels: buffer.numberOfChannels,
    bitrate: 192000,
  }
  if (!(await AudioEncoder.isConfigSupported(config)).supported) {
    throw new Error('This Chrome cannot encode AAC')
  }
  const priming = await primingOf(config)
  console.log(`the encoder of AAC primes ${priming} samples`)
  const { chunks, samples, description } = await aac(buffer, config, priming)
  await fetch('/audio', { method: 'POST', body: new Blob(chunks as BlobPart[]) })
  return { description, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, samples }
}
