/**
 * Records the demo of FiveRunner, demo/fiverunner.mp4, and the pictures of
 * the README, docs/media/*.png, on a deployment of the Stable recipe of
 * Qbox for txAdmin: its tests in a terminal, then the dev UI, where a
 * player registers a character, the map shows the city in the style of GTA
 * V and as a cartoon, in which she is dragged to a garage, presses E and
 * takes a car out, with captions. Chrome records the page and
 * encodes the video itself. The demo puts the tests of the Qbox Stable
 * suite of compat, and a resource of its own in scripts/demo, in the
 * deployment.
 *
 *   npm run build && node scripts/record-demo.ts <deployment>
 */
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'

import { Chrome, findChrome, type Page } from '../test/e2e/chrome.ts'

const root = resolve(import.meta.dirname, '..')
const project = resolve(process.argv[2] ?? '.')
const scripts = join(root, 'scripts', 'demo')
const tool = join(root, 'dist', 'fiverunner.js')
const media = join(root, 'docs', 'media')
const demo = join(root, 'demo')

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

const STYLE = `
:root { --background: #111318; --panel: #1a1d24; --border: #2b2f39; --text: #d7dae0; --muted: #8a909c; --accent: #f0a030; --green: #5fd068; }
html, body { margin: 0; height: 100%; background: radial-gradient(circle at 50% 35%, #1d2230, #0b0d12 70%); color: var(--text); font-family: 'Segoe UI', system-ui, sans-serif; overflow: hidden; }
@keyframes rise { from { opacity: 0; transform: translateY(28px); } to { opacity: 1; transform: none; } }
`

/** The cards before and after the demo, with what they say. */
function card(lines: string): string {
  return `<!doctype html><meta charset="utf-8"><style>${STYLE}
body { display: grid; place-items: center; text-align: center; }
.name { font-size: 140px; font-weight: 800; color: var(--accent); letter-spacing: -3px; animation: rise .8s ease both; }
.line { font-size: 44px; margin-top: 18px; animation: rise .8s ease both; }
.line:nth-child(3) { animation-delay: .5s; } .line:nth-child(4) { animation-delay: 1s; } .line:nth-child(5) { animation-delay: 1.5s; }
code { font-family: Consolas, 'Cascadia Mono', monospace; color: var(--green); }
.muted { color: var(--muted); font-size: 34px; }
</style><div><div class="name">FiveRunner</div>${lines}</div>`
}

/** A terminal that types `commands` and prints what they printed, line by line. */
function terminal(
  commands: readonly { command: string; output: string }[],
  caption: string,
): string {
  return `<!doctype html><meta charset="utf-8"><style>${STYLE}
body { display: grid; place-items: center; }
.window { width: 1500px; height: 720px; background: #0c0e13; border: 1px solid var(--border); border-radius: 14px; box-shadow: 0 30px 80px #000a; overflow: hidden; animation: rise .6s ease both; }
.bar { height: 46px; background: var(--panel); display: flex; align-items: center; gap: 10px; padding: 0 18px; }
.bar i { width: 14px; height: 14px; border-radius: 50%; background: #ff5f57; } .bar i:nth-child(2) { background: #febc2e; } .bar i:nth-child(3) { background: #28c840; }
pre { margin: 0; padding: 26px 32px; font: 30px/1.45 Consolas, 'Cascadia Mono', monospace; white-space: pre-wrap; }
.prompt { color: var(--accent); } .pass { color: var(--green); } .total { font-weight: 700; }
.caption { position: fixed; left: 50%; bottom: 60px; transform: translateX(-50%); font-size: 40px; font-weight: 600; opacity: 0; transition: opacity .6s; white-space: nowrap; }
</style>
<div class="window"><div class="bar"><i></i><i></i><i></i></div><pre id="out"></pre></div>
<div class="caption" id="caption">${caption}</div>
<script>
const commands = ${JSON.stringify(commands)}
const out = document.getElementById('out')
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const add = (text, kind) => { const span = document.createElement('span'); if (kind) span.className = kind; span.textContent = text; out.append(span) }
window.play = async () => {
  for (const { command, output } of commands) {
    add('qbox $ ', 'prompt')
    for (const char of command) { add(char); await sleep(55) }
    add('\\n'); await sleep(500)
    for (const line of output.split('\\n')) {
      add(line + '\\n', line.startsWith('✓') ? 'pass' : line.startsWith('Test') ? 'total' : '')
      await sleep(90)
    }
    document.getElementById('caption').style.opacity = 1
    await sleep(2600)
  }
}
</script>`
}

/** The frames a second of the video. */
const FPS = 30

/**
 * Encodes the frames of the recording as H.264, `count` of them at `fps` a
 * second, each the last that came by its time, posts the encoded frames to
 * /video, and gives their sizes, which are key frames, the avcC of the
 * stream and its colors. Unlike MediaRecorder, which drops what it cannot keep up with, it takes its time.
 * A constant quantizer keeps text sharp, where Chrome's bitrates spend megabytes on what stands still.
 */
const ENCODER = `<!doctype html><meta charset="utf-8">
<script>
window.encode = async (times, count, fps) => {
  const config = { codec: 'avc1.640028', width: 1920, height: 1080, bitrateMode: 'quantizer', framerate: fps, avc: { format: 'avc' } }
  if (!(await VideoEncoder.isConfigSupported(config)).supported) throw new Error('This Chrome cannot encode H.264 at a constant quantizer')
  const samples = []
  const data = []
  let description
  let colorSpace
  let failure
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      const avcc = metadata?.decoderConfig?.description
      if (avcc !== undefined) {
        description = Array.from(ArrayBuffer.isView(avcc) ? new Uint8Array(avcc.buffer, avcc.byteOffset, avcc.byteLength) : new Uint8Array(avcc))
        colorSpace = metadata.decoderConfig.colorSpace
      }
      const bytes = new Uint8Array(chunk.byteLength)
      chunk.copyTo(bytes)
      data.push(bytes)
      samples.push({ size: chunk.byteLength, key: chunk.type === 'key' })
    },
    error: (error) => (failure = error),
  })
  encoder.configure(config)
  const image = async (i) => createImageBitmap(await (await fetch('/frame/' + i)).blob())
  let shown = 0
  let bitmap = await image(0)
  for (let k = 0; k < count && failure === undefined; k++) {
    let due = shown
    while (due + 1 < times.length && times[due + 1] <= (k * 1000) / fps) due++
    if (due !== shown) {
      bitmap.close()
      bitmap = await image(due)
      shown = due
    }
    const frame = new VideoFrame(bitmap, { timestamp: Math.round((k * 1000000) / fps) })
    encoder.encode(frame, { keyFrame: k % (5 * fps) === 0, avc: { quantizer: 26 } })
    frame.close()
    while (encoder.encodeQueueSize > 4) await new Promise((done) => encoder.addEventListener('dequeue', done, { once: true }))
  }
  if (failure === undefined) await encoder.flush()
  bitmap.close()
  if (failure !== undefined) throw failure
  await fetch('/video', { method: 'POST', body: new Blob(data) })
  return { description, colorSpace, samples }
}
window.check = () => new Promise((done, failed) => {
  const video = document.createElement('video')
  video.muted = true
  video.onerror = () => failed(new Error('Chrome cannot play the video: ' + video.error.message))
  video.onloadedmetadata = () => {
    video.onseeked = () => done([video.duration, video.videoWidth, video.videoHeight])
    video.currentTime = video.duration - 0.5
  }
  video.src = '/fiverunner.mp4'
})
</script>`

/** Captions and a cursor over the dev UI, for what happens in it to read in the video. */
const OVERLAY = `(() => {
  const style = document.createElement('style')
  style.textContent = \`
    html { scrollbar-width: none; scroll-behavior: smooth; }
    #demo-caption { position: fixed; left: 50%; bottom: 44px; transform: translateX(-50%); z-index: 2147483647; background: #0b0d12ee; color: #fff; border: 2px solid #f0a030; border-radius: 16px; padding: 18px 34px; font: 600 36px 'Segoe UI', system-ui, sans-serif; white-space: nowrap; box-shadow: 0 20px 60px #000c; transition: opacity .4s; opacity: 0; pointer-events: none; }
    #demo-cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; width: 34px; height: 34px; pointer-events: none; transition: transform .7s cubic-bezier(.4, 0, .2, 1); transform: translate(1700px, 900px); filter: drop-shadow(0 3px 6px #000a); }
    #demo-cursor.click::after { content: ''; position: absolute; left: -22px; top: -22px; width: 44px; height: 44px; border-radius: 50%; border: 3px solid #f0a030; animation: ring .5s ease-out forwards; }
    @keyframes ring { from { opacity: 1; transform: scale(.4); } to { opacity: 0; transform: scale(1.6); } }
  \`
  document.head.append(style)
  const caption = document.createElement('div')
  caption.id = 'demo-caption'
  const cursor = document.createElement('div')
  cursor.id = 'demo-cursor'
  cursor.innerHTML = '<svg viewBox="0 0 24 24" width="34" height="34"><path d="M4 2l16 11-7 1-4 7z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>'
  document.body.append(caption, cursor)
  window.demoCaption = (text) => { caption.style.opacity = text ? 1 : 0; if (text) caption.textContent = text }
  window.demoCursor = (x, y) => { cursor.style.transform = 'translate(' + x + 'px, ' + y + 'px)' }
  window.demoClick = () => { cursor.classList.remove('click'); void cursor.offsetWidth; cursor.classList.add('click') }
  window.demoHide = (hidden) => { caption.style.visibility = cursor.style.visibility = hidden ? 'hidden' : '' }
  return true
})()`

/** Where the Motel Parking of qbx_garages is, which players take their cars out of. */
const GARAGE = [275.58, -344.74] as const

/** The button that enlarges the screen of the player, or shrinks it. */
const ENLARGE = `[...document.querySelectorAll('.player header button')].find((b) => ['Enlarge', 'Shrink'].includes(b.textContent))`

/** Where the ped of the first player is on the page, as the map says where its players are. */
async function playerOnMap(page: Page): Promise<[number, number]> {
  const [x, y] = await page.until<[number, number]>(
    `(() => { const found = JSON.parse(document.querySelector('#map canvas').dataset.players ?? '[]').find(([client]) => client === 1); return found && [found[1], found[2]] })()`,
  )
  return onMap(page, x, y)
}

/** Has the map drawn in a style, as a user would choose it. */
async function useStyle(page: Page, style: string): Promise<void> {
  const select = `[...document.querySelectorAll('#map select')].find((s) => [...s.options].some((o) => o.value === 'GTA'))`
  const [x, y] = await page.evaluate<[number, number]>(
    `(() => { const r = (${select}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()`,
  )
  await page.evaluate(`window.demoCursor(${x}, ${y})`)
  await sleep(800)
  await page.evaluate('window.demoClick()')
  await page.evaluate(
    `(() => { const s = ${select}; s.value = '${style}'; s.dispatchEvent(new Event('change')) })()`,
  )
  await sleep(300)
}

/** The element of a page that has `text` alone, such as an option of a menu. */
const leaf = (text: string) =>
  `[...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent.trim() === '${text}')`

/** The button of a page that says `text`. */
const button = (text: string) =>
  `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '${text}')`

/** Where a point of the world is on the page, as the map says where it looks. */
function onMap(page: Page, x: number, y: number): Promise<[number, number]> {
  return page.evaluate<[number, number]>(`(() => {
    const canvas = document.querySelector('#map canvas')
    const [cx, cy, scale] = canvas.dataset.view.split(' ').map(Number)
    const r = canvas.getBoundingClientRect()
    return [r.left + (${x} - cx) * scale + r.width / 2, r.top + (cy - ${y}) * scale + r.height / 2]
  })()`)
}

/** Zooms the map in by `steps` turns of the wheel at `x`, `y`, which stays where it is. */
async function zoom(page: Page, x: number, y: number, steps: number): Promise<void> {
  await page.evaluate(`window.demoCursor(${x}, ${y})`)
  await sleep(800)
  for (let step = 0; step < steps; step++) {
    await page.wheel(x, y, -120)
    await sleep(steps > 6 ? 80 : 350)
  }
}

/** The stretches of the recording that the video leaves out, by when they start and end: the waits for what loads. */
const cuts: [from: number, to: number][] = []

/** Waits for what `wait` waits for, which the video leaves out, but for its last half second. */
async function cut<T>(wait: () => Promise<T>): Promise<T> {
  const from = Date.now()
  const result = await wait()
  const to = Date.now() - 500
  if (to > from) cuts.push([from, to])
  return result
}

/** Enlarges the screen of the player, or shrinks it, with its button in sight. */
async function toggleScreen(page: Page): Promise<void> {
  await page.evaluate(`(${ENLARGE}).scrollIntoView({ block: 'center' })`)
  await sleep(600)
  await clickPage(page, ENLARGE)
}

/** Types `text` a character at a time, as a person would. */
async function typeSlowly(page: Page, text: string): Promise<void> {
  for (const char of text) {
    await page.type(char)
    await sleep(110)
  }
}

/** What a command of the tool prints in the deployment, until a line has `until`, when it stops it. */
function output(args: readonly string[], until?: string): Promise<string> {
  return new Promise((done, failed) => {
    const child = spawn(process.execPath, [tool, ...args], { cwd: project })
    let text = ''
    child.stdout.on('data', (chunk: Buffer) => {
      text += chunk.toString()
      if (until !== undefined && text.includes(until)) {
        child.kill()
        done(text)
      }
    })
    child.on('error', failed)
    child.on('exit', () => done(text))
  })
}

async function main(): Promise<void> {
  if (!existsSync(join(project, 'resources', '[qbx]', 'qbx_garages'))) {
    throw new Error(
      `${project} is no deployment of Qbox's Stable recipe of txAdmin: give the directory of one`,
    )
  }
  const chromePath = findChrome()
  if (chromePath === undefined) throw new Error('There is no Chrome: set CHROME_PATH')
  mkdirSync(media, { recursive: true })
  mkdirSync(demo, { recursive: true })
  // The tests of the demo, and a resource of its own beside the recipe, which gives characters a car.
  mkdirSync(join(project, 'tests'), { recursive: true })
  cpSync(
    join(root, 'compat', 'qbox-stable', 'tests', 'recipe.test.lua'),
    join(project, 'tests', 'qbox-recipe.test.lua'),
  )
  cpSync(join(scripts, 'demo_car'), join(project, 'resources', '[fiverunner-demo]', 'demo_car'), {
    recursive: true,
  })
  const tests = (await output(['test'])).trimEnd()
  if (!tests.includes('passed') || tests.includes('failed')) {
    throw new Error(`The tests of the recipe did not pass:\n${tests}`)
  }

  // The dev server of the recipe, at the port of FiveM's servers.
  const dev = spawn(process.execPath, [tool, 'dev', '--port', '30120'], { cwd: project })
  const devText = await new Promise<string>((done, failed) => {
    let text = ''
    dev.stdout.on('data', (chunk: Buffer) => {
      text += chunk.toString()
      if (text.includes('Ctrl+C')) done(text)
    })
    dev.on('exit', () => failed(new Error(`The dev server exited: ${text}`)))
  })
  const devUrl = /at (http:\/\/\S+)/.exec(devText)![1]!

  const frames: { data: string; time: number }[] = []
  let data: Buffer | undefined
  let video: Buffer | undefined
  const pages: Record<string, string> = {
    '/title.html': card(
      `<div class="line">FiveM resources, without GTA V and without FXServer</div>`,
    ),
    '/terminal.html': terminal(
      [{ command: 'npx fiverunner test', output: tests }],
      `Qbox's whole txAdmin recipe, a car out of its garage, tested in ${/Duration: ([\d.]+) s/.exec(tests)![1]} seconds`,
    ),
    '/end.html': card(`<div class="line"><code>npx fiverunner init</code></div>
<div class="line"><code>npx fiverunner test</code> · <code>npx fiverunner dev</code></div>
<div class="line muted">github.com/DariusHQ/fiverunner · open source, MIT</div>`),
    '/encode.html': ENCODER,
  }
  const server = createServer((request, response) => {
    const url = request.url ?? '/'
    if (request.method === 'POST' && url === '/video') {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        data = Buffer.concat(chunks)
        response.end()
      })
      return
    }
    if (url === '/fiverunner.mp4' && video !== undefined) {
      response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': video.length })
      response.end(video)
      return
    }
    const frame = /^\/frame\/(\d+)$/.exec(url)
    if (frame !== null) {
      response.writeHead(200, { 'Content-Type': 'image/jpeg' })
      response.end(Buffer.from(frames[Number(frame[1])]!.data, 'base64'))
      return
    }
    const page = pages[url]
    response.writeHead(page === undefined ? 404 : 200, { 'Content-Type': 'text/html' })
    response.end(page ?? '')
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const local = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const chrome = await Chrome.launch(chromePath)
  try {
    const page = await chrome.open('about:blank')
    await page.resize(1920, 1080)
    const stop = await page.record(frames)

    await page.goto(`${local}/title.html`)
    await sleep(3500)

    await page.goto(`${local}/terminal.html`)
    await sleep(300)
    await page.evaluate('window.play()')
    await page.evaluate(`document.getElementById('caption').style.opacity = 0`)
    writeFileSync(join(media, 'tests.png'), await page.screenshot())

    await page.goto(devUrl)
    await cut(() =>
      page.until(`document.getElementById('status').textContent === 'Running'`, undefined, 60000),
    )
    await page.evaluate(OVERLAY)
    const started = await page.evaluate<number>(
      `document.querySelectorAll('#resources-list .state.started').length`,
    )
    await caption(page, `npx fiverunner dev: its ${started} resources, in your browser`)
    await sleep(2800)
    await caption(page, 'Start a resource of your own, beside them')
    await clickPage(page, `document.getElementById('command-line')`)
    await typeSlowly(page, 'ensure demo_car')
    await page.press('Enter', 'Enter', 13, String.fromCharCode(13))
    await page.until(`document.getElementById('console').innerText.includes('demo_car')`)
    await sleep(1500)

    await caption(page, 'Connect a player: her client runs the client scripts')
    await page.evaluate(
      `document.getElementById('player-name').scrollIntoView({ block: 'center' })`,
    )
    await sleep(1000)
    await clickPage(page, `document.getElementById('player-name')`)
    await page.evaluate(`document.getElementById('player-name').select()`)
    await typeSlowly(page, 'Ann')
    await clickPage(page, `document.querySelector('#connect button')`)
    await cut(() =>
      page.until(
        `document.querySelector('.player .info')?.textContent.includes('joined')`,
        undefined,
        30000,
      ),
    )
    await page.evaluate(`document.querySelector('.player').scrollIntoView({ block: 'start' })`)
    await sleep(1200)
    await toggleScreen(page)
    await page.evaluate(
      `document.querySelector('.player .screen').scrollIntoView({ block: 'center' })`,
    )
    await sleep(1200)
    const lib = await page.until<string>(
      `[...document.querySelectorAll('.viewport iframe')].map((f) => new URL(f.src).origin).find((o) => o.includes('ox_lib'))`,
    )
    await cut(() => page.until(`document.body.innerText.includes('New Character #1')`, lib, 30000))
    await caption(page, "Qbox's own character menu, from the NUI of ox_lib")
    await sleep(2000)
    await clickFrame(page, lib, leaf('New Character #1'))
    await page.until(`document.body.innerText.includes('Character Registration')`, lib)
    await caption(page, 'Register a character, as a player would')
    const input = (label: string) =>
      `document.getElementById([...document.querySelectorAll('label')].find((l) => l.textContent.startsWith('${label}')).htmlFor)`
    for (const [label, text] of [
      ['First Name', 'Ann'],
      ['Last Name', 'Lee'],
    ] as const) {
      await clickFrame(page, lib, input(label))
      await typeSlowly(page, text)
    }
    await clickFrame(page, lib, input('Sex'))
    await sleep(400)
    await clickFrame(
      page,
      lib,
      `[...document.querySelectorAll('[role=option], .mantine-Select-item')].find((o) => o.textContent.trim() === 'Female')`,
    )
    await sleep(800)
    await shoot(page, frames, 'qbox-registration.png', `document.querySelector('.player .screen')`)
    await clickFrame(page, lib, button('Confirm'))
    await cut(() =>
      page.until(`document.getElementById('events').innerText.includes('Ann')`, undefined, 30000),
    )
    await sleep(1500)
    await page.evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`)
    await shoot(page, frames, 'dev-ui.png')

    // The map, with the blips that the resources put on hers, then her screen under it.
    await toggleScreen(page)
    await page.evaluate(`document.getElementById('map').scrollIntoView({ block: 'start' })`)
    await sleep(1200)
    await caption(page, 'A map of the server, with the blips of every resource')
    await sleep(2000)
    const [gx, gy] = await onMap(page, GARAGE[0], GARAGE[1])
    await zoom(page, gx, gy, 3)
    await sleep(1000)
    await caption(page, 'In the style of the pause menu of GTA V')
    await useStyle(page, 'GTA')
    await sleep(2200)
    await shoot(page, frames, 'map-gta.png', `document.getElementById('map')`)
    await caption(page, 'Or as a cartoon')
    await useStyle(page, 'Cartoon')
    await sleep(2200)
    await shoot(page, frames, 'map-cartoon.png', `document.getElementById('map')`)
    await page.evaluate(`window.scrollTo({ top: document.getElementById('map').offsetTop + 320 })`)
    await sleep(1500)
    await caption(page, 'Drag her to a garage on the map')
    const [px, py] = await playerOnMap(page)
    const [tx, ty] = await onMap(page, GARAGE[0], GARAGE[1])
    await page.evaluate(`window.demoCursor(${px}, ${py})`)
    await sleep(900)
    await page.drag(px, py, tx, ty, 45)
    await page.evaluate(`window.demoCursor(${tx}, ${ty})`)
    await page.until(`document.body.innerText.includes('Open Garage')`, lib, 10000)
    await sleep(1200)
    await caption(page, "qbx_garages and ox_lib's text UI: press E")
    await clickPage(page, `document.querySelector('.player .screen')`)
    await sleep(600)
    await page.press('KeyE', 'e', 69)
    await page.until(`document.body.innerText.includes('Truffade Adder')`, lib, 10000)
    await toggleScreen(page)
    await page.evaluate(
      `document.querySelector('.player .screen').scrollIntoView({ block: 'center' })`,
    )
    await caption(page, 'Her garage, from the database of oxmysql')
    await sleep(2000)
    await clickFrame(page, lib, leaf('Truffade Adder'))
    await page.until(`document.body.innerText.includes('Take Out')`, lib)
    await sleep(1500)
    await shoot(page, frames, 'garage.png', `document.querySelector('.player .screen')`)
    await clickFrame(page, lib, leaf('Take Out'))
    await sleep(1500)

    await toggleScreen(page)
    await page.evaluate(`document.getElementById('map').scrollIntoView({ block: 'start' })`)
    await sleep(1200)
    await caption(page, 'Spawned by the server, synced by her client')
    const [cx, cy] = await onMap(page, GARAGE[0], GARAGE[1])
    await zoom(page, cx, cy, 24)
    await sleep(3000)
    await page.evaluate('window.demoCaption()')
    await sleep(1000)

    await page.goto(`${local}/end.html`)
    await sleep(4000)
    await stop()

    // The video leaves out the waits for what loads, and goes on from where they ended.
    const left = (time: number) =>
      cuts.reduce((total, [from, to]) => total + (time >= to ? to - from : 0), 0)
    const shown = frames.filter(({ time }) => !cuts.some(([from, to]) => time > from && time < to))
    frames.splice(
      0,
      frames.length,
      ...shown.map(({ data, time }) => ({ data, time: time - left(time) })),
    )
    const end = Date.now() - left(Date.now())
    const start = frames[0]!.time
    const count = Math.round(((end - start) * FPS) / 1000)
    await page.goto(`${local}/encode.html`)
    const { description, colorSpace, samples } = await page.evaluate<{
      description: number[]
      colorSpace: Colors
      samples: { size: number; key: boolean }[]
    }>(`window.encode(${JSON.stringify(frames.map(({ time }) => time - start))}, ${count}, ${FPS})`)
    const size = samples.reduce((total, sample) => total + sample.size, 0)
    if (samples.length !== count || data?.length !== size || !samples[0]?.key) {
      throw new Error(
        `Chrome encoded ${samples.length} of ${count} frames, in ${data?.length} bytes`,
      )
    }
    video = mp4(Uint8Array.from(description), colorSpace, samples, data)
    // Chrome reads the file back, to its end, as a check of it.
    const [duration, width, height] =
      await page.evaluate<[number, number, number]>('window.check()')
    if (Math.abs(duration - count / FPS) > 0.1 || width !== 1920 || height !== 1080) {
      throw new Error(`Chrome reads the video as ${duration} s at ${width}x${height}`)
    }
    writeFileSync(join(demo, 'fiverunner.mp4'), video)
    process.stdout.write(
      `Recorded ${frames.length} frames as ${count} over ${duration.toFixed(1)} s: demo/fiverunner.mp4, ${(video.length / 1e6).toFixed(1)} MB\n`,
    )
  } finally {
    chrome.close()
    dev.kill()
    server.close()
  }
}

/** Shows `text` as the caption of the dev UI, a moment after the last. */
async function caption(page: Page, text: string): Promise<void> {
  await page.evaluate(`window.demoCaption(${JSON.stringify(text)})`)
  await sleep(600)
}

/**
 * Takes a picture for the README of the page, or of its element that `find`
 * finds, without the caption and the cursor, and drops the frames of the
 * recording that lack them.
 */
async function shoot(page: Page, frames: unknown[], name: string, find?: string): Promise<void> {
  const kept = frames.length
  await page.evaluate('window.demoHide(true)')
  await sleep(100)
  const clip =
    find === undefined
      ? undefined
      : await page.evaluate<{ x: number; y: number; width: number; height: number }>(
          `(() => { const r = (${find}).getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height } })()`,
        )
  writeFileSync(join(media, name), await page.screenshot(clip))
  await page.evaluate('window.demoHide(false)')
  await sleep(200)
  frames.splice(kept)
}

/** Moves the cursor to `x`, `y` and clicks there, as a player would. */
async function clickAt(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(`window.demoCursor(${x}, ${y})`)
  await sleep(800)
  await page.evaluate('window.demoClick()')
  await page.click(x, y)
  await sleep(400)
}

/** Clicks the middle of the element of the dev UI that `find` finds. */
async function clickPage(page: Page, find: string): Promise<void> {
  const [x, y] = await page.evaluate<[number, number]>(
    `(() => { const r = (${find}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()`,
  )
  await clickAt(page, x, y)
}

/** Clicks the middle of the element of the frame at `origin` that `find` finds, on the screen of the player, which scales the game's 1920 by 1080. */
async function clickFrame(page: Page, origin: string, find: string): Promise<void> {
  const [x, y] = await page.evaluate<[number, number]>(
    `(() => { const r = (${find}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()`,
    origin,
  )
  const [left, top, scale] = await page.evaluate<[number, number, number]>(
    `(() => { const r = document.querySelector('.player .screen').getBoundingClientRect(); return [r.x, r.y, r.width / 1920] })()`,
  )
  await clickAt(page, left + x * scale, top + y * scale)
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

/** The colors of a stream, as WebCodecs tells them. */
interface Colors {
  readonly primaries: string | null
  readonly transfer: string | null
  readonly matrix: string | null
  readonly fullRange: boolean | null
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

/**
 * An MP4 of one track of 1920 by 1080 H.264 at FPS frames a second, whose
 * frames are `samples` in `data`, `description` its avcC and `colors` its
 * colors. Its moov comes first, as players start it before they have the whole file.
 */
function mp4(
  description: Uint8Array,
  colors: Colors,
  samples: readonly { size: number; key: boolean }[],
  data: Buffer,
): Buffer {
  const code = (name: string | null) => {
    const found = COLOR_CODES[name ?? '']
    if (found === undefined) throw new Error(`The MP4 cannot tell the colors of ${name}`)
    return found
  }
  // The SPS of Chrome's encoder leaves out the colors, which players would take
  // for those of TV, darker than the sRGB of the frames.
  const colr = box(
    'colr',
    Buffer.from('nclx'),
    u16(code(colors.primaries), code(colors.transfer), code(colors.matrix)),
    Buffer.of(colors.fullRange === true ? 0x80 : 0),
  )
  const ms = Math.round((samples.length * 1000) / FPS)
  const matrix = u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000)
  const keys = samples.flatMap(({ key }, i) => (key ? [i + 1] : []))
  const moov = (offset: number) =>
    box(
      'moov',
      fullBox(
        'mvhd',
        0,
        u32(0, 0, 1000, ms, 0x10000),
        u16(0x100, 0),
        u32(0, 0),
        matrix,
        u32(0, 0, 0, 0, 0, 0, 2),
      ),
      box(
        'trak',
        fullBox(
          'tkhd',
          3,
          u32(0, 0, 1, 0, ms, 0, 0),
          u16(0, 0, 0, 0),
          matrix,
          u32(1920 << 16, 1080 << 16),
        ),
        box(
          'mdia',
          // A frame lasts 1000 of the 1000 * FPS units of a second.
          fullBox('mdhd', 0, u32(0, 0, FPS * 1000, samples.length * 1000), u16(0x55c4, 0)),
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
                  box('avcC', description),
                  colr,
                ),
              ),
              fullBox('stts', 0, u32(1, samples.length, 1000)),
              fullBox('stss', 0, u32(keys.length, ...keys)),
              fullBox('stsc', 0, u32(1, 1, samples.length, 1)),
              fullBox('stsz', 0, u32(0, samples.length, ...samples.map(({ size }) => size))),
              fullBox('stco', 0, u32(1, offset)),
            ),
          ),
        ),
      ),
    )
  const ftyp = box('ftyp', Buffer.from('isom'), u32(0x200), Buffer.from('isomiso2avc1mp41'))
  return Buffer.concat([ftyp, moov(ftyp.length + moov(0).length + 8), box('mdat', data)])
}

await main()
