/**
 * Records the demo of FiveRunner, demo/fiverunner.mp4, and the pictures of
 * the README, docs/media/*.png, on a deployment of the Stable recipe of
 * Qbox for txAdmin: its tests, then the dev UI, where a player registers a
 * character, dresses her in the appearance editor of the recipe, over the
 * world round her ped, opens her inventory and the bank, the map shows the
 * city in the style of GTA V and as a cartoon, in which she is dragged to a
 * garage, presses E and takes a car out. Chrome records the dev UI at twice its pixels, as the recorder
 * notes what it does there, then scripts/demo/compose.ts draws the video
 * from them, between scenes of its own, with a soundtrack of its own, and
 * encodes it, which the recorder puts in an MP4. The demo puts the tests
 * of the Qbox Stable suite of compat, and a resource of its own in
 * scripts/demo, in the deployment.
 *
 *   npm run build && node scripts/record-demo.ts <deployment>
 *
 * The recording stays in demo/, which `--compose` draws the video from
 * again, and `--stills <ms,ms,...>` draws pictures of the video from, at
 * those times, in demo/stills.
 */
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { stripTypeScriptTypes } from 'node:module'
import type { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'

import { Chrome, findChrome, type Page } from '../test/e2e/chrome.ts'
import { CHAPTER, easeInOut, FPS, type Cue, type Encoded, type Timeline } from './demo/compose.ts'

const root = resolve(import.meta.dirname, '..')
const scripts = join(root, 'scripts', 'demo')
const tool = join(root, 'dist', 'fiverunner.js')
const media = join(root, 'docs', 'media')
const demo = join(root, 'demo')
const shots = join(demo, 'frames')
const saved = join(demo, 'timeline.json')

/** The viewport of the dev UI, which Chrome draws at twice its pixels, for the camera of the video to zoom in on. */
const VIEWPORT = { width: 1600, height: 900 }
/** The quantizer of the H.264 of the video, which keeps text sharp. */
const QUANTIZER = 27

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

/** Where the Motel Parking of qbx_garages is, which players take their cars out of. */
const GARAGE = [275.58, -344.74] as const

/** The button that enlarges the screen of the player, or shrinks it, and the screen. */
const ENLARGE = `[...document.querySelectorAll('.player header button')].find((b) => ['Enlarge', 'Shrink'].includes(b.textContent))`
const SCREEN = `document.querySelector('.player .screen')`

/** What the camera frames, in the pixels of the game window, for the window to fill the video, as it leaves room round what it frames. */
const WHOLE_GAME = [142, 123, 1636, 834] as const

/** The element of a page that has `text` alone, such as an option of a menu. */
const leaf = (text: string) =>
  `[...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent.trim() === '${text}')`

/** The button of a page that says `text`. */
const button = (text: string) =>
  `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '${text}')`

/** A button of the box of the appearance editor that `label` heads, by its index: 1 is the next drawable, 3 the next texture. */
const arrowOf = (label: string, index: number) =>
  `[...document.querySelectorAll('span')].find((s) => s.childElementCount === 0 && s.textContent.trim() === '${label}').parentElement.querySelectorAll('button')[${index}]`

/** A colour of the hair of the appearance editor, by its index. */
const swatch = (index: number) =>
  `[...document.querySelectorAll('small')].find((s) => s.textContent.startsWith('Color:')).parentElement.parentElement.querySelectorAll('button')[${index}]`

/** The menu of the styles of the map. */
const STYLES = `[...document.querySelectorAll('#map select')].find((s) => [...s.options].some((o) => o.value === 'GTA'))`

/** The button of the appearance editor that saves the looks, which its icon of a floppy disk tells. */
const SAVE = `[...document.querySelectorAll('button')].find((b) => b.querySelector('svg')?.getAttribute('viewBox') === '0 0 448 512')`

/** A rectangle of the viewport. */
interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** What a cue says, which the director stamps with its time. */
type Said = Cue extends infer C ? (C extends Cue ? Omit<C, 'time'> : never) : never

/**
 * Drives the dev UI as a person would, and notes what it does for the
 * compositor to show: where the cursor goes and clicks, what it types, the
 * keys it presses, the captions, what the camera frames and the cards of
 * chapters, at the times that it does them, and the waits that the video
 * leaves out.
 */
class Director {
  readonly page: Page
  readonly cues: Cue[] = []
  /** The stretches of the recording that the video leaves out, by when they start and end: the waits for what loads. */
  readonly cuts: [from: number, to: number][] = []

  constructor(page: Page) {
    this.page = page
  }

  /** Notes what the director does now, for the compositor to show. */
  note(said: Said): void {
    this.cues.push({ ...said, time: Date.now() } as Cue)
  }

  /** Drags with the mouse from `x`, `y` to `toX`, `toY`, along the path and in the time that the cursor of the video takes. */
  async drag(x: number, y: number, toX: number, toY: number): Promise<void> {
    await this.move(x, y, 900)
    this.note({ kind: 'press', down: true })
    const index = this.cues.length
    this.note({ kind: 'cursor', x: toX, y: toY, duration: 900, bow: 0 })
    const start = Date.now()
    await this.page.drag(x, y, toX, toY, 50, 14, easeInOut)
    // The cursor of the video takes as long as the drag did.
    this.cues[index] = {
      ...(this.cues[index] as Extract<Cue, { kind: 'cursor' }>),
      duration: Date.now() - start,
    }
    this.note({ kind: 'press', down: false })
  }

  /** Moves the cursor to `x`, `y`, and waits until it is there. */
  async move(x: number, y: number, duration = 560): Promise<void> {
    this.note({ kind: 'cursor', x, y, duration })
    await sleep(duration + 120)
  }

  /** Moves the cursor to `x`, `y`, in `duration` milliseconds, and clicks there. */
  async click(x: number, y: number, duration?: number): Promise<void> {
    await this.move(x, y, duration)
    this.note({ kind: 'click' })
    await this.page.click(x, y)
    await sleep(300)
  }

  /** Clicks the middle of the element of the dev UI that `find` finds. */
  async clickOn(find: string): Promise<void> {
    const { x, y, width, height } = await this.rect(find)
    await this.click(x + width / 2, y + height / 2)
  }

  /** Clicks the middle of the element of the frame at `origin` that `find` finds, on the screen of the player. */
  async clickIn(origin: string, find: string, duration?: number): Promise<void> {
    const { x, y, width, height } = await this.rectIn(origin, find)
    await this.click(x + width / 2, y + height / 2, duration)
  }

  /** Clicks a point of the game window of the player, in its pixels, on her screen, which scales its 1920 by 1080. */
  async tapIn(gx: number, gy: number): Promise<void> {
    const { x, y, width } = await this.rect(SCREEN)
    await this.click(x + (gx * width) / 1920, y + (gy * width) / 1920)
  }

  /** Where the element that `find` finds is in the viewport. */
  rect(find: string): Promise<Rect> {
    return this.page.evaluate<Rect>(
      `(() => { const r = (${find}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`,
    )
  }

  /** Has the camera frame a rectangle of the game window of the player, in its pixels. */
  async focusGame(
    x: number,
    y: number,
    width: number,
    height: number,
    duration?: number,
  ): Promise<void> {
    const screen = await this.rect(SCREEN)
    const scale = screen.width / 1920
    this.focus(
      {
        x: screen.x + x * scale,
        y: screen.y + y * scale,
        width: width * scale,
        height: height * scale,
      },
      duration,
    )
  }

  /** Has the camera frame `rect`, or the whole window. */
  focus(rect?: Rect, duration = 1000): void {
    this.note({ kind: 'focus', ...(rect ?? { x: 0, y: 0, ...VIEWPORT }), duration })
  }

  /** Where the elements that `finds` find in the frame at `origin` are on the page, all of them, on the screen of the player. */
  async rectIn(origin: string, ...finds: string[]): Promise<Rect> {
    const rects = await Promise.all(
      finds.map((find) =>
        this.page.evaluate<Rect>(
          `(() => { const r = (${find}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`,
          origin,
        ),
      ),
    )
    const { x: left, y: top, width } = await this.rect(SCREEN)
    const scale = width / 1920
    const x = Math.min(...rects.map((r) => r.x))
    const y = Math.min(...rects.map((r) => r.y))
    const right = Math.max(...rects.map((r) => r.x + r.width))
    const bottom = Math.max(...rects.map((r) => r.y + r.height))
    return {
      x: left + x * scale,
      y: top + y * scale,
      width: (right - x) * scale,
      height: (bottom - y) * scale,
    }
  }

  /** Has the camera frame what `finds` find in the frame at `origin`, with room round it. */
  async focusIn(origin: string, room: number, ...finds: string[]): Promise<void> {
    const { x, y, width, height } = await this.rectIn(origin, ...finds)
    this.focus({ x: x - room, y: y - room, width: width + room * 2, height: height + room * 2 })
  }

  /** Has the camera frame the element that `find` finds, with room round it. */
  async focusOn(find: string, room = 24, duration = 1000): Promise<void> {
    const { x, y, width, height } = await this.rect(find)
    this.focus(
      { x: x - room, y: y - room, width: width + room * 2, height: height + room * 2 },
      duration,
    )
  }

  /** Shows a caption, on the right where what it would cover is on the left, or hides the one there is. */
  caption(title?: string, detail?: string, right = false): void {
    this.note({
      kind: 'caption',
      ...(title === undefined ? {} : { title }),
      ...(detail === undefined ? {} : { detail }),
      ...(right ? { right } : {}),
    })
  }

  /** Has `change` change what the page shows at once, which a wipe from the middle of the window reveals. */
  async wipe(change: () => Promise<void>): Promise<void> {
    this.note({ kind: 'wipe', x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 })
    await change()
    await sleep(700)
  }

  /** Shows the card of a chapter, behind which `meanwhile` does what the video need not show, and waits until it goes. */
  async chapter(
    number: string,
    title: string,
    detail: string,
    meanwhile?: () => Promise<void>,
  ): Promise<void> {
    this.note({ kind: 'chapter', number, title, detail })
    const start = Date.now()
    await meanwhile?.()
    const cut = this.cuts
      .filter(([from]) => from >= start)
      .reduce((total, [from, to]) => total + to - from, 0)
    await sleep(Math.max(CHAPTER + 100 - (Date.now() - start - cut), 0))
  }

  /** Types `text` a character at a time, `pause` milliseconds apart, as a person would. */
  async type(text: string, pause = 75): Promise<void> {
    for (const char of text) {
      this.note({ kind: 'type' })
      await this.page.type(char)
      await sleep(pause)
    }
  }

  /** Presses a key, which the video shows as `label`, on what has the focus. */
  async press(
    label: string,
    code: string,
    key: string,
    keyCode: number,
    text?: string,
  ): Promise<void> {
    this.note({ kind: 'key', label })
    await sleep(280)
    await this.page.press(code, key, keyCode, text)
  }

  /** Waits for what `wait` waits for, which the video leaves out, but for its last 400 milliseconds. */
  async cut<T>(wait: () => Promise<T>): Promise<T> {
    const from = Date.now()
    const result = await wait()
    const to = Date.now() - 400
    if (to > from) this.cuts.push([from, to])
    return result
  }
}

/** Where a point of the world is on the page, as the map says where it looks. */
function onMap(page: Page, x: number, y: number): Promise<[number, number]> {
  return page.evaluate<[number, number]>(`(() => {
    const canvas = document.querySelector('#map canvas')
    const [cx, cy, scale] = canvas.dataset.view.split(' ').map(Number)
    const r = canvas.getBoundingClientRect()
    return [r.left + (${x} - cx) * scale + r.width / 2, r.top + (cy - ${y}) * scale + r.height / 2]
  })()`)
}

/** Where the ped of the first player is in the world, as the map says where its players are. */
function playerAt(page: Page): Promise<[number, number]> {
  return page.until<[number, number]>(
    `(() => { const found = JSON.parse(document.querySelector('#map canvas').dataset.players ?? '[]').find(([client]) => client === 1); return found && [found[1], found[2]] })()`,
  )
}

/** The origin of the frame of the resource whose name has `name`, on the screen of the player. */
function frameOf(page: Page, name: string): Promise<string> {
  return page.until<string>(
    `[...document.querySelectorAll('.viewport iframe')].map((f) => new URL(f.src).origin).find((o) => o.includes('${name}'))`,
  )
}

/** The script that has the map drawn in a style, as its menu of styles does. */
const chooseStyle = (style: string) =>
  `(() => { const s = ${STYLES}; s.value = '${style}'; s.dispatchEvent(new Event('change')) })()`

/** Has the map drawn in a style, as a user would choose it, with a wipe from the menu of styles. */
async function useStyle(director: Director, style: string): Promise<void> {
  const { x, y, width, height } = await director.rect(STYLES)
  await director.move(x + width / 2, y + height / 2)
  director.note({ kind: 'click' })
  await sleep(160)
  director.note({ kind: 'wipe', x: x + width / 2, y: y + height / 2 })
  await director.page.evaluate(chooseStyle(style))
  await sleep(300)
}

/**
 * Zooms the map in on the middle of two points of the world, which stays
 * where it is, by the turns of the wheel that keep both in sight with room
 * round them, each of which zooms it by a quarter.
 */
async function zoomOnBoth(
  director: Director,
  a: readonly [number, number],
  b: readonly [number, number],
): Promise<void> {
  const { page } = director
  const room = 150
  const canvas = await director.rect(`document.querySelector('#map canvas')`)
  const scale = await page.evaluate<number>(
    `Number(document.querySelector('#map canvas').dataset.view.split(' ')[2])`,
  )
  const [mx, my] = await onMap(page, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
  const most = Math.min(
    (Math.min(mx - canvas.x, canvas.x + canvas.width - mx) - room) /
      Math.max(Math.abs(a[0] - b[0]) / 2, 1),
    (Math.min(my - canvas.y, canvas.y + canvas.height - my) - room) /
      Math.max(Math.abs(a[1] - b[1]) / 2, 1),
  )
  const steps = most > scale ? Math.min(Math.floor(Math.log(most / scale) / Math.log(1.25)), 24) : 0
  await director.move(mx, my)
  for (let step = 0; step < steps; step++) {
    await page.wheel(mx, my, -120)
    await sleep(steps > 6 ? 120 : 330)
  }
}

/**
 * Zooms the map in at `x`, `y`, which stays where it is, by turns of the
 * wheel apart enough for Chrome not to merge them, until it takes `scale`
 * pixels a metre.
 */
async function zoomTo(director: Director, x: number, y: number, scale: number): Promise<void> {
  await director.move(x, y)
  const now = () =>
    director.page.evaluate<number>(
      `Number(document.querySelector('#map canvas').dataset.view.split(' ')[2])`,
    )
  for (let step = 0; step < 40 && (await now()) < scale; step++) {
    await director.page.wheel(x, y, -120)
    await sleep(120)
  }
}

/**
 * Enlarges the screen of the player, or shrinks it, as `large` says, with
 * its button in sight, or at once, where nothing shows it, and brings the
 * enlarged screen into sight.
 */
async function largeScreen(director: Director, large: boolean, hidden = false): Promise<void> {
  const { page } = director
  const now = await page.evaluate<boolean>(
    `document.querySelector('.player').classList.contains('large')`,
  )
  if (now !== large) {
    if (hidden) await page.evaluate(`(${ENLARGE}).click()`)
    else {
      await page.evaluate(`(${ENLARGE}).scrollIntoView({ block: 'center' })`)
      await sleep(600)
      await director.clickOn(ENLARGE)
    }
  }
  if (large) {
    await page.evaluate(
      `(${SCREEN}).scrollIntoView({ block: 'center', behavior: '${hidden ? 'instant' : 'smooth'}' })`,
    )
    if (!hidden) await sleep(800)
  }
}

/**
 * Takes a picture for the README of the viewport, or of the element that
 * `find` finds, at the pixels of the viewport, which the video leaves out
 * the time of.
 */
async function shoot(director: Director, name: string, find?: string): Promise<void> {
  await director.cut(async () => {
    const clip = await director.page.evaluate<Rect>(
      find === undefined
        ? `({ x: scrollX, y: scrollY, width: innerWidth, height: innerHeight })`
        : `(() => { const r = (${find}).getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height } })()`,
    )
    writeFileSync(join(media, name), await director.page.screenshot(clip, 0.5))
  })
}

/** What a command of the tool prints in the deployment. */
function output(project: string, args: readonly string[]): Promise<string> {
  return new Promise((done, failed) => {
    const child = spawn(process.execPath, [tool, ...args], { cwd: project })
    let text = ''
    child.stdout.on('data', (chunk: Buffer) => (text += chunk.toString()))
    child.on('error', failed)
    child.on('exit', () => done(text))
  })
}

/** Records the deployment: its tests, then the dev UI, frame by frame, and what the director did in it. */
async function record(project: string, chromePath: string): Promise<Timeline> {
  if (!existsSync(join(project, 'resources', '[qbx]', 'qbx_garages'))) {
    throw new Error(
      `${project} is no deployment of Qbox's Stable recipe of txAdmin: give the directory of one`,
    )
  }
  // The recipe has new characters pick an apartment, of a resource of apartments that it ships none of, so
  // they stay faded out, as in FiveM: the demo starts them where Qbox starts them without one, in the editor
  // of their looks, and puts the recipe back as it was.
  const config = join(project, 'resources', '[qbx]', 'qbx_core', 'config', 'client.lua')
  const recipe = readFileSync(config, 'utf8')
  writeFileSync(config, recipe.replace('startingApartment = true', 'startingApartment = false'))
  try {
    return await recordPatched(project, chromePath)
  } finally {
    writeFileSync(config, recipe)
  }
}

/** Records the deployment, once the recipe starts new characters in the editor of their looks. */
async function recordPatched(project: string, chromePath: string): Promise<Timeline> {
  mkdirSync(media, { recursive: true })
  rmSync(shots, { recursive: true, force: true })
  mkdirSync(shots, { recursive: true })
  // The tests of the demo, and a resource of its own beside the recipe, which gives characters a car.
  mkdirSync(join(project, 'tests'), { recursive: true })
  cpSync(
    join(root, 'compat', 'qbox-stable', 'tests', 'recipe.test.lua'),
    join(project, 'tests', 'qbox-recipe.test.lua'),
  )
  cpSync(join(scripts, 'demo_car'), join(project, 'resources', '[fiverunner-demo]', 'demo_car'), {
    recursive: true,
  })
  const tests = (await output(project, ['test'])).trimEnd()
  if (!tests.includes('passed') || tests.includes('failed')) {
    throw new Error(`The tests of the recipe did not pass:\n${tests}`)
  }

  // The dev server of the recipe, at the port of FiveM's servers.
  const dev = spawn(process.execPath, [tool, 'dev', '--port', '30120'], { cwd: project })
  const chrome = await Chrome.launch(chromePath, [
    '--force-device-scale-factor=2',
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
  ])
  try {
    const devText = await new Promise<string>((done, failed) => {
      let text = ''
      dev.stdout.on('data', (chunk: Buffer) => {
        text += chunk.toString()
        if (text.includes('Ctrl+C')) done(text)
      })
      dev.on('exit', () => failed(new Error(`The dev server exited: ${text}`)))
    })
    const devUrl = /at (http:\/\/\S+)/.exec(devText)![1]!
    const page = await chrome.open('about:blank')
    await page.resize(VIEWPORT.width, VIEWPORT.height, 2)
    const director = new Director(page)
    const frames: [number, number][] = []
    const writes: Promise<void>[] = []
    const stop = await page.record(
      (data, time) => {
        const file = frames.length
        frames.push([time, file])
        writes.push(writeFile(join(shots, `${file}.jpg`), Buffer.from(data, 'base64')))
      },
      VIEWPORT.width * 2,
      VIEWPORT.height * 2,
    )
    const start = Date.now()
    await page.goto(devUrl)
    await director.cut(() =>
      page.until(`document.getElementById('status').textContent === 'Running'`, undefined, 60000),
    )
    await page.evaluate(`(() => {
      const style = document.createElement('style')
      style.textContent = 'html { scrollbar-width: none; scroll-behavior: smooth; }'
      document.head.append(style)
    })()`)
    await story(director, page)
    const end = Date.now()
    await stop()
    await Promise.all(writes)
    // The video leaves out the waits for what loads, and goes on from where they ended.
    const { cuts } = director
    const shift = (time: number) =>
      time -
      start -
      cuts.reduce((total, [from, to]) => total + Math.max(0, Math.min(time, to) - from), 0)
    const timeline: Timeline = {
      frames: frames
        .filter(([time]) => time >= start && !cuts.some(([from, to]) => time > from && time < to))
        .map(([time, file]) => [shift(time), file]),
      cues: director.cues.map((cue) => ({ ...cue, time: shift(cue.time) })),
      length: shift(end),
      viewport: VIEWPORT,
      tests,
      command: 'npx fiverunner test',
      url: new URL(devUrl).host + new URL(devUrl).pathname,
    }
    writeFileSync(saved, JSON.stringify(timeline))
    return timeline
  } finally {
    chrome.close()
    dev.kill()
  }
}

/** What the director does in the dev UI: the chapters of developing, of playing and of the map. */
async function story(director: Director, page: Page): Promise<void> {
  const started = await page.evaluate<number>(
    `document.querySelectorAll('#resources-list .state.started').length`,
  )
  // The world behind the screen of the player is in the style of the map, which starts as a cartoon.
  await page.evaluate(chooseStyle('Cartoon'))
  director.focus(undefined, 10)
  // The card comes once the video has blended into the dev UI.
  await sleep(500)
  await director.chapter(
    '02',
    'Develop',
    '`npx fiverunner dev`: the server and its players, in your browser',
  )
  director.caption(
    `${started} resources, running in your browser`,
    'The console of the server, its resources, its events and its state bags',
  )
  await sleep(600)
  await director.move(1450, 300, 700)
  await sleep(700)

  // A resource of your own, started from the console.
  await director.focusOn(`document.querySelector('.server')`, 16)
  await sleep(600)
  director.caption(
    'Start a resource of your own',
    'Type `ensure demo_car` in the console of the server',
  )
  await director.clickOn(`document.getElementById('command-line')`)
  await director.type('ensure demo_car')
  await director.press('Enter', 'Enter', 'Enter', 13, String.fromCharCode(13))
  await page.until(
    `document.getElementById('console').innerText.includes('Started resource demo_car')`,
  )
  await sleep(1000)

  // A player, who connects and registers a character in the NUI of Qbox.
  director.focus()
  director.caption()
  await page.evaluate(`document.getElementById('player-name').scrollIntoView({ block: 'center' })`)
  await sleep(1000)
  await director.focusOn(`document.getElementById('connect').closest('section')`, 12)
  director.caption('Connect a player', 'Her client runs the client scripts of every resource')
  await sleep(400)
  await director.clickOn(`document.getElementById('player-name')`)
  await page.evaluate(`document.getElementById('player-name').select()`)
  await director.type('Ann')
  await director.clickOn(`document.querySelector('#connect button')`)
  await director.cut(() =>
    page.until(
      `document.querySelector('.player .info')?.textContent.includes('joined')`,
      undefined,
      30000,
    ),
  )
  await director.wipe(() => largeScreen(director, true, true))
  const lib = await frameOf(page, 'ox_lib')
  await director.cut(() =>
    page.until(`document.body.innerText.includes('New Character #1')`, lib, 30000),
  )
  await director.focusIn(lib, 160, leaf('Qbox Multichar'), leaf('New Character #3'))
  director.caption("Qbox's own character menu", 'The NUI of `ox_lib`, on the screen of her game')
  await sleep(1500)
  await director.clickIn(lib, leaf('New Character #1'))
  await page.until(`document.body.innerText.includes('Character Registration')`, lib)
  await director.focusIn(lib, 90, leaf('Character Registration'), button('Confirm'))
  director.caption('Register a character', 'As a player would, from the same pages')
  const input = (label: string) =>
    `document.getElementById([...document.querySelectorAll('label')].find((l) => l.textContent.startsWith('${label}')).htmlFor)`
  for (const [label, text] of [
    ['First Name', 'Ann'],
    ['Last Name', 'Lee'],
  ] as const) {
    await director.clickIn(lib, input(label), 380)
    await director.type(text)
  }
  await director.clickIn(lib, input('Sex'), 380)
  await sleep(300)
  await director.clickIn(
    lib,
    `[...document.querySelectorAll('[role=option], .mantine-Select-item')].find((o) => o.textContent.trim() === 'Female')`,
    320,
  )
  await sleep(400)
  await shoot(director, 'qbox-registration.png', SCREEN)
  await director.clickIn(lib, button('Confirm'), 420)

  // Her first looks, in the appearance editor of the recipe, over the world round her ped.
  director.caption()
  const looks = await frameOf(page, 'illenium')
  await director.chapter(
    '03',
    'Play',
    'The NUIs of the recipe, over the world round her',
    async () => {
      await director.focusGame(...WHOLE_GAME, 10)
      await director.cut(() =>
        page.until(`document.body.innerText.includes('Clothes')`, looks, 30000),
      )
    },
  )
  director.caption(
    'illenium-appearance, as released',
    'Its NUI, over the world round her ped',
    true,
  )
  await sleep(1500)
  await director.clickIn(looks, leaf('Clothes'))
  await sleep(250)
  await director.focusGame(0, 100, 1240, 697)
  director.caption('Dress her', 'She wears what you pick, in the world behind the NUI', true)
  await sleep(500)
  for (const arrow of [1, 1, 1, 3]) {
    await director.clickIn(looks, arrowOf('Jackets', arrow), 320)
    await sleep(420)
  }
  await director.clickIn(looks, leaf('Appearance'), 420)
  await sleep(450)
  director.caption('Her hair, in 64 colours', "FiveRunner's own, as many as GTA V has", true)
  await director.clickIn(looks, arrowOf('Hair', 1), 380)
  await sleep(250)
  await director.clickIn(looks, swatch(28), 380)
  await sleep(1100)
  await shoot(director, 'appearance.png', SCREEN)
  director.caption('Save her looks', 'In the database, as the editor keeps them', true)
  await director.clickIn(looks, SAVE, 420)
  await sleep(450)
  // The button of the editor's dialog that keeps the changes.
  await director.tapIn(859, 611)
  await sleep(1000)

  // Her inventory, on the key that the recipe binds it to.
  const inventory = await frameOf(page, 'ox_inventory')
  await director.focusGame(...WHOLE_GAME)
  director.caption('ox_inventory, as released', '`TAB` opens it, with the pictures of her items')
  await director.tapIn(1500, 900)
  await director.press('TAB', 'Tab', 'Tab', 9)
  await page.until(`document.body.innerText.includes('Ann Lee')`, inventory, 10000)
  await sleep(300)
  await director.focusIn(inventory, 60, leaf('Ann Lee'), button('Close'))
  await sleep(1700)
  await shoot(director, 'inventory.png', SCREEN)
  await director.press('Esc', 'Escape', 'Escape', 27)
  await sleep(500)

  // The bank, which an event of the server opens, as the events panel sends it.
  director.caption()
  await director.wipe(async () => {
    await largeScreen(director, false, true)
    await page.evaluate(
      `document.getElementById('emit').scrollIntoView({ block: 'center', behavior: 'instant' })`,
    )
  })
  await director.focusOn(`document.getElementById('emit').closest('section')`, 12)
  director.caption('Trigger any event', 'To her client, as the server would')
  await director.clickOn(`document.querySelector('#emit select')`)
  await page.evaluate(
    `(() => { const s = document.querySelector('#emit select'); s.value = 'to:1'; s.dispatchEvent(new Event('change')) })()`,
  )
  await director.clickOn(`document.querySelector('#emit [name=name]')`)
  await director.type('Renewed-Banking:client:openBankUI', 40)
  await director.clickOn(`document.querySelector('#emit [name=args]')`)
  await director.type('[{}]')
  await director.press('Enter', 'Enter', 'Enter', 13, String.fromCharCode(13))
  await sleep(400)
  await director.wipe(() => largeScreen(director, true, true))
  await director.focusGame(...WHOLE_GAME)
  await page.until(`document.body.innerText.includes('Opening Bank')`, lib, 10000)
  director.caption('Renewed-Banking, as released', 'Her accounts, from the database of `oxmysql`')
  await sleep(700)
  const bank = await frameOf(page, 'renewed')
  await director.cut(() =>
    page.until(`document.body.innerText.includes('Personal Account')`, bank, 15000),
  )
  await sleep(2000)
  await shoot(director, 'bank.png', SCREEN)
  await director.press('Esc', 'Escape', 'Escape', 27)
  await sleep(500)

  // The map, with the blips that the resources put on hers, in its styles.
  director.caption()
  await director.chapter(
    '04',
    'Map',
    'Every blip of every resource, and the players, who you drag',
    async () => {
      director.focus(undefined, 10)
      await page.evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`)
      await sleep(200)
      await shoot(director, 'dev-ui.png')
      await largeScreen(director, false, true)
      await page.evaluate(
        `document.getElementById('map').scrollIntoView({ block: 'start', behavior: 'instant' })`,
      )
    },
  )
  await director.focusOn(`document.getElementById('map')`, 6)
  director.caption('A map of the server', 'The blips that the resources put on the map of her game')
  await sleep(900)
  // In on her and the garage, which both stay in sight.
  await zoomOnBoth(director, await playerAt(page), GARAGE)
  await sleep(500)
  director.caption(
    "In the style of GTA V's pause menu",
    'With its header, its legend and its buttons',
  )
  await useStyle(director, 'GTA')
  await sleep(1800)
  await shoot(director, 'map-gta.png', `document.getElementById('map')`)
  director.caption('Or as a cartoon', 'Little people who walk, cars and tokens, on a meadow')
  await useStyle(director, 'Cartoon')
  await sleep(1800)
  await shoot(director, 'map-cartoon.png', `document.getElementById('map')`)

  // She is dragged to a garage, and takes her car out of it.
  director.focus()
  await page.evaluate(`window.scrollTo({ top: document.getElementById('map').offsetTop + 300 })`)
  await sleep(1000)
  const [px, py] = await onMap(page, ...(await playerAt(page)))
  const [tx, ty] = await onMap(page, ...GARAGE)
  // The cursor takes her by her middle, over her feet.
  const grab = py - 15
  const around = {
    x: Math.min(px, tx) - 160,
    y: Math.min(grab, ty) - 140,
    width: Math.abs(px - tx) + 320,
    height: Math.abs(grab - ty) + 280,
  }
  director.focus(around)
  director.caption('Drag her to a garage', 'Dropped on a blip, she goes where it is')
  await director.drag(px, grab, tx, ty)
  await page.until(`document.body.innerText.includes('Open Garage')`, lib, 10000)
  await sleep(600)
  // Her screen, with the text UI at its edge, where the cursor gives it the keys.
  const prompt = `[...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent.includes('Open Garage'))`
  const textUi = await director.rectIn(lib, prompt)
  await director.focusOn(SCREEN, 8)
  director.caption(
    "qbx_garages and ox_lib's text UI",
    'On her screen: press `E` to open the garage',
  )
  await sleep(900)
  await director.click(textUi.x - 160, textUi.y + textUi.height / 2)
  await director.press('E', 'KeyE', 'e', 69)
  await page.until(`document.body.innerText.includes('Truffade Adder')`, lib, 10000)
  await director.wipe(() => largeScreen(director, true, true))
  await director.focusIn(lib, 220, leaf('Truffade Adder'))
  director.caption(
    'Her garage, from its database',
    'Of `oxmysql`, in memory, in your browser',
    true,
  )
  await sleep(1300)
  await director.clickIn(lib, leaf('Truffade Adder'))
  await page.until(`document.body.innerText.includes('Take Out')`, lib)
  await sleep(1000)
  await shoot(director, 'garage.png', SCREEN)
  await director.clickIn(lib, leaf('Take Out'), 380)
  await sleep(1000)

  director.caption()
  await director.wipe(async () => {
    await largeScreen(director, false, true)
    await page.evaluate(
      `document.getElementById('map').scrollIntoView({ block: 'start', behavior: 'instant' })`,
    )
  })
  await director.focusOn(`document.getElementById('map')`, 6)
  director.caption('Spawned by the server, synced by her client', 'Her car, by her, at the garage')
  const [cx, cy] = await onMap(page, ...GARAGE)
  await zoomTo(director, cx, cy, 9)
  // The cursor goes out of the way of her and her car, which the camera comes in on.
  await director.move(cx + 330, cy + 120, 700)
  director.focus({ x: cx - 300, y: cy - 190, width: 600, height: 380 }, 1400)
  await sleep(2400)
  director.caption()
  director.focus()
  await sleep(1000)
}

/** Serves the compositor, the frames of the recording, and what the compositor posts back. */
function serve(): Promise<{
  url: string
  posted: Map<string, Buffer>
  close: () => void
  video: (data: Buffer) => void
}> {
  const posted = new Map<string, Buffer>()
  let video: Buffer | undefined
  const page = `<!doctype html><meta charset="utf-8"><body style="margin: 0; background: #000">
<script type="module">
import { compose, stills, testsPicture } from '/compose.ts'
Object.assign(window, { compose, stills, testsPicture })
window.check = () => new Promise((done, failed) => {
  const video = document.createElement('video')
  video.muted = true
  video.onerror = () => failed(new Error('Chrome cannot play the video: ' + video.error.message))
  video.onloadedmetadata = () => {
    video.onseeked = async () => {
      const sound = await new AudioContext().decodeAudioData(await (await fetch('/fiverunner.mp4')).arrayBuffer())
      let peak = 0
      for (let channel = 0; channel < sound.numberOfChannels; channel++) for (const sample of sound.getChannelData(channel)) peak = Math.max(peak, Math.abs(sample))
      done([video.duration, video.videoWidth, video.videoHeight, sound.duration, peak])
    }
    video.currentTime = video.duration - 0.5
  }
  video.src = '/fiverunner.mp4'
})
window.ready = true
</script>`
  const server = createServer((request, response) => {
    const url = request.url ?? '/'
    if (request.method === 'POST') {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        posted.set(url, Buffer.concat(chunks))
        response.end()
      })
      return
    }
    const send = (type: string, body: string | Buffer) => {
      response.writeHead(200, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) })
      response.end(body)
    }
    const frame = /^\/frame\/(\d+)$/.exec(url)
    const module = /^\/(compose|soundtrack)\.ts$/.exec(url)
    if (url === '/compose.html') send('text/html', page)
    else if (module !== null) {
      send(
        'text/javascript',
        stripTypeScriptTypes(readFileSync(join(scripts, `${module[1]}.ts`), 'utf8')),
      )
    } else if (frame !== null) send('image/jpeg', readFileSync(join(shots, `${frame[1]}.jpg`)))
    else if (url === '/fiverunner.mp4' && video !== undefined) send('video/mp4', video)
    else {
      response.writeHead(404)
      response.end()
    }
  })
  return new Promise((done) =>
    server.listen(0, '127.0.0.1', () =>
      done({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        posted,
        close: () => server.close(),
        video: (data) => (video = data),
      }),
    ),
  )
}

async function main(): Promise<void> {
  const chromePath = findChrome()
  if (chromePath === undefined) throw new Error('There is no Chrome: set CHROME_PATH')
  const args = process.argv.slice(2)
  const stillsAt = args.indexOf('--stills')
  const again = args.includes('--compose') || stillsAt >= 0
  if (again && !existsSync(saved))
    throw new Error('There is no recording in demo/ to draw the video from again')
  mkdirSync(demo, { recursive: true })
  const timeline = again
    ? (JSON.parse(readFileSync(saved, 'utf8')) as Timeline)
    : await record(resolve(args[0] ?? '.'), chromePath)

  const server = await serve()
  const chrome = await Chrome.launch(chromePath)
  try {
    const page = await chrome.open('about:blank')
    await page.goto(`${server.url}/compose.html`)
    await page.until('window.ready === true')
    if (stillsAt >= 0) {
      const times = (args[stillsAt + 1] ?? '').split(',').map(Number)
      const out = join(demo, 'stills')
      mkdirSync(out, { recursive: true })
      await page.evaluate(`window.stills(${JSON.stringify(timeline)}, ${JSON.stringify(times)})`)
      times.forEach((time, index) =>
        writeFileSync(join(out, `${time}.png`), server.posted.get(`/still/${index}`)!),
      )
      process.stdout.write(`Drew ${times.length} stills of the video in demo/stills\n`)
      return
    }
    const encoded = await page.evaluate<Encoded>(
      `window.compose(${JSON.stringify(timeline)}, ${QUANTIZER})`,
    )
    const videoData = server.posted.get('/video')!
    const audioData = server.posted.get('/audio')!
    const videoSize = encoded.video.samples.reduce((total, { size }) => total + size, 0)
    const audioSize = encoded.audio.samples.reduce((total, size) => total + size, 0)
    if (
      videoData.length !== videoSize ||
      audioData.length !== audioSize ||
      !encoded.video.samples[0]?.key
    ) {
      throw new Error(
        `Chrome encoded ${videoData.length} bytes of video for ${videoSize}, and ${audioData.length} of audio for ${audioSize}`,
      )
    }
    const file = mp4(encoded, videoData, audioData)
    server.video(file)
    // Chrome reads the file back, to its end, and decodes its sound, as a check of it.
    const [duration, width, height, sound, peak] =
      await page.evaluate<[number, number, number, number, number]>('window.check()')
    const length = encoded.video.samples.length / FPS
    if (
      Math.abs(duration - length) > 0.1 ||
      width !== 1920 ||
      height !== 1080 ||
      sound < length - 0.2 ||
      peak < 0.2
    ) {
      throw new Error(
        `Chrome reads the video as ${duration} s at ${width}x${height}, with ${sound} s of sound that peaks at ${peak}`,
      )
    }
    writeFileSync(join(demo, 'fiverunner.mp4'), file)
    // The picture of the tests for the README, as the video shows them.
    const timelineJson = JSON.stringify(timeline)
    await page.evaluate(
      `(() => { const { time, crop } = window.testsPicture(${timelineJson}); return window.stills(${timelineJson}, [time], crop) })()`,
    )
    writeFileSync(join(media, 'tests.png'), server.posted.get('/still/0')!)
    process.stdout.write(
      `Drew ${encoded.video.samples.length} frames from ${timeline.frames.length}, over ${duration.toFixed(1)} s with sound: demo/fiverunner.mp4, ${(file.length / 1e6).toFixed(1)} MB\n`,
    )
  } finally {
    chrome.close()
    server.close()
  }
}

const u16 = (...values: number[]) => {
  const buffer = Buffer.alloc(2 * values.length)
  values.forEach((value, i) => buffer.writeUInt16BE(value, 2 * i))
  return buffer
}

const u32 = (...values: number[]) => {
  const buffer = Buffer.alloc(4 * values.length)
  values.forEach((value, i) => buffer.writeUInt32BE(value, 4 * i))
  return buffer
}

/** A box of MP4, of `type`, which holds `parts`. */
function box(type: string, ...parts: Uint8Array[]): Buffer {
  const size = parts.reduce((total, part) => total + part.length, 8)
  return Buffer.concat([u32(size), Buffer.from(type, 'latin1'), ...parts])
}

/** A full box of MP4: a box that starts with its version, 0 here, and its flags. */
function fullBox(type: string, flags: number, ...parts: Uint8Array[]): Buffer {
  return box(type, u32(flags), ...parts)
}

/** A descriptor of MPEG-4, of a tag, which holds `parts`, short enough for its size to take a byte. */
function descriptor(tag: number, ...parts: Uint8Array[]): Buffer {
  const body = Buffer.concat(parts)
  if (body.length > 127) throw new Error('The descriptor is too long for its size to take a byte')
  return Buffer.concat([Buffer.of(tag, body.length), body])
}

/** The codes of H.273 for the colors of WebCodecs, which are the same for primaries, transfers and matrices. */
const COLOR_CODES: Record<string, number> = {
  rgb: 0,
  bt709: 1,
  bt470bg: 5,
  smpte170m: 6,
  linear: 8,
  'iec61966-2-1': 13,
}

/** The table of chunks of a track, of the counts of samples in each chunk, which changes only where the count does. */
function chunkTable(counts: readonly number[]): Buffer {
  const entries: number[] = []
  counts.forEach((count, index) => {
    if (index === 0 || count !== counts[index - 1]) entries.push(index + 1, count, 1)
  })
  return fullBox('stsc', 0, u32(entries.length / 3, ...entries))
}

/**
 * An MP4 of a track of 1920 by 1080 H.264 at FPS frames a second and a
 * track of AAC, whose samples are in `video` and `audio`, a second of each
 * in turn. Its moov comes first, as players start it before they have the
 * whole file.
 */
function mp4(encoded: Encoded, video: Buffer, audio: Buffer): Buffer {
  const code = (name: string | null | undefined) => {
    const found = COLOR_CODES[name ?? '']
    if (found === undefined) throw new Error(`The MP4 cannot tell the colors of ${name}`)
    return found
  }
  const { colorSpace } = encoded.video
  // The SPS of Chrome's encoder leaves out the colors, which players would take
  // for those of TV, darker than the sRGB of the frames.
  const colr = box(
    'colr',
    Buffer.from('nclx'),
    u16(code(colorSpace.primaries), code(colorSpace.transfer), code(colorSpace.matrix)),
    Buffer.of(colorSpace.fullRange === true ? 0x80 : 0),
  )
  const frames = encoded.video.samples
  const sounds = encoded.audio.samples
  const rate = encoded.audio.sampleRate
  // A second of video, then the sound of that second, and so on.
  const seconds = Math.ceil(frames.length / FPS)
  const videoCounts: number[] = []
  const audioCounts: number[] = []
  const parts: Buffer[] = []
  const videoChunks: number[] = []
  const audioChunks: number[] = []
  let videoAt = 0
  let audioAt = 0
  let frame = 0
  let sound = 0
  let offset = 0
  for (let second = 0; second < seconds; second++) {
    const videoCount = Math.min(FPS, frames.length - frame)
    const videoBytes = frames
      .slice(frame, frame + videoCount)
      .reduce((total, { size }) => total + size, 0)
    videoChunks.push(offset)
    videoCounts.push(videoCount)
    parts.push(video.subarray(videoAt, videoAt + videoBytes))
    offset += videoBytes
    videoAt += videoBytes
    frame += videoCount
    let audioCount = 0
    while (sound + audioCount < sounds.length && ((sound + audioCount) * 1024) / rate < second + 1)
      audioCount++
    if (second === seconds - 1) audioCount = sounds.length - sound
    if (audioCount > 0) {
      const audioBytes = sounds
        .slice(sound, sound + audioCount)
        .reduce((total, size) => total + size, 0)
      audioChunks.push(offset)
      audioCounts.push(audioCount)
      parts.push(audio.subarray(audioAt, audioAt + audioBytes))
      offset += audioBytes
      audioAt += audioBytes
      sound += audioCount
    }
  }
  const videoMs = Math.round((frames.length * 1000) / FPS)
  const audioMs = Math.round((sounds.length * 1024 * 1000) / rate)
  const matrix = u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000)
  const keys = frames.flatMap(({ key }, i) => (key ? [i + 1] : []))
  const asc = Buffer.from(encoded.audio.description)
  const esds = fullBox(
    'esds',
    0,
    descriptor(
      0x03,
      u16(1),
      Buffer.of(0),
      descriptor(0x04, Buffer.of(0x40, 0x15, 0, 0, 0), u32(192000, 192000), descriptor(0x05, asc)),
      descriptor(0x06, Buffer.of(0x02)),
    ),
  )
  const moov = (at: number) =>
    box(
      'moov',
      fullBox(
        'mvhd',
        0,
        u32(0, 0, 1000, Math.max(videoMs, audioMs), 0x10000),
        u16(0x100, 0),
        u32(0, 0),
        matrix,
        u32(0, 0, 0, 0, 0, 0, 3),
      ),
      box(
        'trak',
        fullBox(
          'tkhd',
          3,
          u32(0, 0, 1, 0, videoMs, 0, 0),
          u16(0, 0, 0, 0),
          matrix,
          u32(1920 << 16, 1080 << 16),
        ),
        box(
          'mdia',
          // A frame lasts 1000 of the 1000 * FPS units of a second.
          fullBox('mdhd', 0, u32(0, 0, FPS * 1000, frames.length * 1000), u16(0x55c4, 0)),
          fullBox(
            'hdlr',
            0,
            u32(0),
            Buffer.from('vide'),
            u32(0, 0, 0),
            Buffer.from('VideoHandler'),
            Buffer.alloc(1),
          ),
          box(
            'minf',
            fullBox('vmhd', 1, u16(0, 0, 0, 0)),
            box('dinf', fullBox('dref', 0, u32(1), fullBox('url ', 1))),
            box(
              'stbl',
              fullBox(
                'stsd',
                0,
                u32(1),
                box(
                  'avc1',
                  Buffer.alloc(6),
                  u16(1),
                  Buffer.alloc(16),
                  u16(1920, 1080),
                  u32(0x480000, 0x480000, 0),
                  u16(1),
                  Buffer.alloc(32),
                  u16(0x18, 0xffff),
                  box('avcC', Buffer.from(encoded.video.description)),
                  colr,
                ),
              ),
              fullBox('stts', 0, u32(1, frames.length, 1000)),
              fullBox('stss', 0, u32(keys.length, ...keys)),
              chunkTable(videoCounts),
              fullBox('stsz', 0, u32(0, frames.length, ...frames.map(({ size }) => size))),
              fullBox(
                'stco',
                0,
                u32(videoChunks.length, ...videoChunks.map((chunk) => at + chunk)),
              ),
            ),
          ),
        ),
      ),
      box(
        'trak',
        fullBox('tkhd', 3, u32(0, 0, 2, 0, audioMs, 0, 0), u16(0, 0, 0x100, 0), matrix, u32(0, 0)),
        box(
          'mdia',
          // A frame of AAC lasts 1024 of the units of a second, as many as its samples.
          fullBox('mdhd', 0, u32(0, 0, rate, sounds.length * 1024), u16(0x55c4, 0)),
          fullBox(
            'hdlr',
            0,
            u32(0),
            Buffer.from('soun'),
            u32(0, 0, 0),
            Buffer.from('SoundHandler'),
            Buffer.alloc(1),
          ),
          box(
            'minf',
            fullBox('smhd', 0, u16(0, 0)),
            box('dinf', fullBox('dref', 0, u32(1), fullBox('url ', 1))),
            box(
              'stbl',
              fullBox(
                'stsd',
                0,
                u32(1),
                box(
                  'mp4a',
                  Buffer.alloc(6),
                  u16(1),
                  u32(0, 0),
                  u16(encoded.audio.channels, 16, 0, 0),
                  u32(rate * 0x10000),
                  esds,
                ),
              ),
              fullBox('stts', 0, u32(1, sounds.length, 1024)),
              chunkTable(audioCounts),
              fullBox('stsz', 0, u32(0, sounds.length, ...sounds)),
              fullBox(
                'stco',
                0,
                u32(audioChunks.length, ...audioChunks.map((chunk) => at + chunk)),
              ),
            ),
          ),
        ),
      ),
    )
  const ftyp = box('ftyp', Buffer.from('isom'), u32(0x200), Buffer.from('isomiso2avc1mp41'))
  const mdat = Buffer.concat(parts)
  return Buffer.concat([ftyp, moov(ftyp.length + moov(0).length + 8), box('mdat', mdat)])
}

await main()
