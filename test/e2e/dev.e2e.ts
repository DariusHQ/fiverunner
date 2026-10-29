import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Chrome, findChrome, type Page } from './chrome.ts'

const TOOL = fileURLToPath(new URL('../../dist/fiverunner.js', import.meta.url))
const chromePath = findChrome()

/** A resource with a page, which a server command opens on every client, and which closes through a callback, and a table of oxmysql. */
const FILES: Record<string, string> = {
  'fxmanifest.lua': `fx_version 'cerulean'
game 'gta5'
server_script '@oxmysql/lib/MySQL.lua'
server_script 'server.lua'
client_script 'client.lua'
ui_page 'html/index.html'
files { 'html/index.html', 'html/app.js', 'html/logo.svg' }
`,
  'bank.sql': `CREATE TABLE accounts (id INT AUTO_INCREMENT PRIMARY KEY);
INSERT INTO accounts VALUES (), ();
`,
  'server.lua': `print('bank server started')
MySQL.ready(function() print('bank accounts', MySQL.scalar.await('SELECT COUNT(*) FROM accounts')) end)
GlobalState.bank = 'open'
RegisterNetEvent('bank:ping', function(value) print('ping', source, value) end)
RegisterCommand('open', function()
    TriggerClientEvent('bank:open', -1, 'Opened by the server')
end, false)
RegisterCommand('fade', function(_, args)
    TriggerClientEvent('bank:fade', -1, args[1] == 'out')
end, false)
`,
  'client.lua': `local blip = AddBlipForCoord(300.0, -300.0, 10.0)
SetBlipColour(blip, 2)
RegisterKeyMapping('where', 'Tells where the player is', 'keyboard', 'F6')
RegisterCommand('where', function() print('at', GetEntityCoords(PlayerPedId())) end, false)
RegisterKeyMapping('+bankmenu', 'Opens the bank', 'keyboard', 'F5')
RegisterCommand('+bankmenu', function() print('bank menu opened') end, false)
RegisterCommand('-bankmenu', function() print('bank menu closed') end, false)
RegisterNetEvent('bank:open', function(text)
    SendNUIMessage({ type = 'open', text = text })
    SetNuiFocus(true, true)
end)
RegisterNetEvent('bank:fade', function(out)
    if out then DoScreenFadeOut(0) else DoScreenFadeIn(0) end
end)
RegisterNUICallback('close', function(data, cb)
    print('closed with', data.reason)
    SetNuiFocus(false, false)
    cb({ closed = true })
end)
`,
  'html/index.html': `<!DOCTYPE html>
<html>
<body>
<p id="text">waiting</p>
<p id="name"></p>
<p id="answer"></p>
<button id="close" style="position: absolute; left: 100px; top: 100px; width: 300px; height: 100px">Close</button>
<img id="logo" src="nui://bank/html/logo.svg">
<script src="nui://game/ui/jquery.js"></script>
<script src="app.js"></script>
</body>
</html>
`,
  'html/logo.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="teal"/></svg>
`,
  'html/app.js': `const badge = document.createElement('div')
badge.id = 'badge'
badge.style.backgroundImage = 'url(nui://bank/html/logo.svg)'
document.body.append(badge)
fetch('nui://bank/html/logo.svg').then((response) => response.text()).then((text) => { badge.dataset.fetched = String(text.startsWith('<svg')) })
document.getElementById('name').textContent = GetParentResourceName() + ' ' + (localStorage.getItem('seen') ?? 'new')
localStorage.setItem('seen', 'seen')
window.addEventListener('message', (event) => {
  if (event.data.type === 'open') document.getElementById('text').textContent = event.data.text
})
document.getElementById('close').addEventListener('click', async () => {
  const response = await fetch('https://' + GetParentResourceName() + '/close', { method: 'POST', body: JSON.stringify({ reason: 'click' }) })
  document.getElementById('answer').textContent = await response.text()
})
`,
}

let root: string
let project: string
let tool: ChildProcess
let url: string
let chrome: Chrome
let page: Page

/** The origins of the frames of the players, from the first player on. */
function frameOrigins(): Promise<string[]> {
  return page.evaluate<string[]>(
    `[...document.querySelectorAll('.viewport iframe')].map((frame) => new URL(frame.src).origin)`,
  )
}

/** An expression of where the pixels of a colour are on the canvas of the map, in the pixels of the page, or null if it drew none. */
function pixelsOf([r, g, b]: readonly [number, number, number]): string {
  return `(() => {
    const canvas = document.querySelector('#map canvas')
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let x = 0, y = 0, count = 0
    for (let i = 0; i < data.length; i += 4) {
      if (Math.abs(data[i] - ${r}) < 6 && Math.abs(data[i + 1] - ${g}) < 6 && Math.abs(data[i + 2] - ${b}) < 6) {
        x += (i / 4) % canvas.width
        y += Math.floor(i / 4 / canvas.width)
        count++
      }
    }
    const rect = canvas.getBoundingClientRect()
    const ratio = canvas.width / rect.width
    return count === 0 ? null : [rect.left + x / count / ratio, rect.top + y / count / ratio]
  })()`
}

/** Has the mouse do `type` at `x`, `y` of the page, on the canvas of the map. */
function mouse(type: string, x: number, y: number): Promise<unknown> {
  return page.evaluate(
    `document.querySelector('#map canvas').dispatchEvent(new MouseEvent('${type}', { clientX: ${x}, clientY: ${y}, bubbles: true }))`,
  )
}

// Without Chrome or a build, the tests run only in CI, where they must.
const missing = chromePath === undefined || !existsSync(TOOL)

describe.skipIf(missing && process.env.CI === undefined)('The dev UI in Chrome', () => {
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'fiverunner-e2e-'))
    project = join(root, 'bank')
    for (const [path, text] of Object.entries(FILES)) {
      mkdirSync(dirname(join(project, path)), { recursive: true })
      writeFileSync(join(project, path), text)
    }
    tool = spawn(process.execPath, [TOOL, 'dev', '--port', '0'], { cwd: project })
    url = await new Promise<string>((resolve, reject) => {
      let text = ''
      tool.stdout!.on('data', (chunk: Buffer) => {
        text += chunk.toString()
        const found = /at (http:\/\/\S+)/.exec(text)
        if (found !== null) resolve(found[1]!)
      })
      tool.on('exit', () => reject(new Error(`The tool exited: ${text}`)))
    })
    chrome = await Chrome.launch(chromePath!)
    page = await chrome.open(url)
  }, 60000)

  afterAll(() => {
    chrome?.close()
    tool?.kill()
    rmSync(root, { recursive: true, force: true, maxRetries: 5 })
  })

  it('runs the server of the project, with its tables in the database of oxmysql', async () => {
    await page.until(`document.getElementById('status').textContent === 'Running'`)
    const console = await page.until<string>(
      `document.getElementById('console').innerText.includes('bank accounts') && document.getElementById('console').innerText`,
    )
    expect(console).toContain('[script:bank] bank server started')
    expect(console).toContain('[script:bank] bank accounts	2')
  })

  it('connects players, each with the frames of their NUI at origins of their own', async () => {
    await page.evaluate(`document.querySelector('#connect button').click()`)
    await page.evaluate(`document.querySelector('#connect button').click()`)
    await page.until(`document.querySelectorAll('.viewport iframe').length === 2`)
    const origins = await frameOrigins()
    const names = await Promise.all(
      origins.map((origin) =>
        page.until<string>(`document.getElementById('name').textContent`, origin),
      ),
    )
    expect([origins.map((origin) => /\.c(\d)\./.exec(origin)?.[1]), names]).toEqual([
      ['1', '2'],
      ['bank new', 'bank new'],
    ])
  })

  it('gives pages the files of resources at nui://, which browsers have no scheme for, and jQuery as FiveM does', async () => {
    const [first] = await frameOrigins()
    expect(
      await page.until(
        `(() => {
          const logo = document.getElementById('logo')
          const badge = document.getElementById('badge')
          return logo.complete && badge.dataset.fetched !== undefined && [logo.naturalWidth, logo.getAttribute('src'), badge.style.backgroundImage, badge.dataset.fetched, jQuery.fn.jquery]
        })()`,
        first,
      ),
    ).toEqual([
      40,
      'https://cfx-nui-bank/html/logo.svg',
      'url("https://cfx-nui-bank/html/logo.svg")',
      'true',
      '2.1.1',
    ])
  })

  it('passes the messages of scripts on to frames, and their requests back to callbacks', async () => {
    await page.evaluate(`(() => {
      const input = document.getElementById('command-line')
      input.value = 'open'
      input.form.requestSubmit()
    })()`)
    const [first] = await frameOrigins()
    await page.until(
      `document.getElementById('text').textContent === 'Opened by the server'`,
      first,
    )
    await page.until(`document.querySelector('.screen').classList.contains('nui-cursor')`)
    // The button of the page, which is laid out at 1920 by 1080, on the screen of the first player.
    const [x, y] = await page.evaluate<[number, number]>(`(() => {
      document.querySelector('.screen').scrollIntoView({ block: 'center' })
      const rect = document.querySelector('.screen').getBoundingClientRect()
      const scale = rect.width / 1920
      return [rect.x + 250 * scale, rect.y + 150 * scale]
    })()`)
    await page.click(x, y)
    expect([
      await page.until<string>(`document.getElementById('answer').textContent`, first),
      await page.until<string>(
        `document.querySelector('.player .console').innerText.includes('closed with') && document.querySelector('.player .console').innerText`,
      ),
    ]).toEqual(['{"closed":true}', expect.stringContaining('[script:bank] closed with\tclick')])
  })

  it('triggers events as the network does, which it shows with the state bags of the server', async () => {
    await page.evaluate(`(() => {
      const form = document.getElementById('emit')
      form.elements.target.value = 'from:1'
      form.elements.name.value = 'bank:ping'
      form.elements.args.value = '[7]'
      form.requestSubmit()
    })()`)
    expect([
      await page.until<string>(
        `document.getElementById('console').innerText.includes('[script:bank] ping') && document.getElementById('console').innerText`,
      ),
      await page.until<string>(
        `document.getElementById('events').innerText.includes('bank:ping') && document.getElementById('events').innerText`,
      ),
      await page.evaluate<string>(`document.getElementById('bags').innerText`),
    ]).toEqual([
      expect.stringContaining('[script:bank] ping\t1\t7'),
      expect.stringContaining('[Player -> server] bank:ping(7)'),
      expect.stringMatching(/global\s+bank\s+"open"/),
    ])
  })

  it('shows the players and the blips of their maps on its map, and moves the players that it drags', async () => {
    const GREEN = [0x6f, 0xcf, 0x6f] as const
    const ORANGE = [0xf0, 0xa0, 0x30] as const
    const CYAN = [0x4f, 0xd6, 0xe0] as const
    await page.evaluate(`document.getElementById('map').scrollIntoView()`)
    // The blips of the players are green, and their peds, at the start of the world, orange and cyan, the second over the first, whose name makes way for that of the second, under them.
    const [x, y] = await page.until<[number, number]>(pixelsOf(CYAN))
    const name = await page.evaluate<[number, number] | null>(pixelsOf(ORANGE))
    expect([
      await page.evaluate(`${pixelsOf(GREEN)} !== null`),
      name !== null && name[1] > y + 10,
    ]).toEqual([true, true])
    await mouse('mousedown', x, y)
    await mouse('mousemove', x - 120, y + 60)
    await mouse('mouseup', x - 120, y + 60)
    // The client of the second player syncs its ped where it was dropped, which uncovers that of the first.
    const [movedX, movedY] = await page.until<[number, number]>(
      `(() => { const point = ${pixelsOf(CYAN)}; return point !== null && Math.abs(point[0] - ${x}) > 60 && point })()`,
    )
    // The name of the player, in its colour, goes under it, which moves the centre of its pixels a little.
    expect([Math.abs(movedX - x + 120) < 10, Math.abs(movedY - y - 60) < 20]).toEqual([true, true])
    const uncovered = await page.evaluate<[number, number]>(pixelsOf(ORANGE))
    expect(uncovered[1]).toBeLessThan(name![1] - 3)
  })

  it('puts the players that it drops on blips where the blips are, at their heights', async () => {
    /** Where a point of the world is on the page, as the view of the map says. */
    const onPage = (x: number, y: number) =>
      page.evaluate<[number, number]>(`(() => {
      const canvas = document.querySelector('#map canvas')
      const [cx, cy, scale] = canvas.dataset.view.split(' ').map(Number)
      const r = canvas.getBoundingClientRect()
      return [r.left + (${x} - cx) * scale + r.width / 2, r.top + (cy - ${y}) * scale + r.height / 2]
    })()`)
    // The first player is where it started, and drops a few pixels off the blip of the bank.
    const [fromX, fromY] = await onPage(0, 0)
    const [toX, toY] = await onPage(300, -300)
    await mouse('mousedown', fromX, fromY)
    await mouse('mousemove', toX + 5, toY + 4)
    await mouse('mouseup', toX + 5, toY + 4)
    await page.evaluate(`(() => {
      const screen = document.querySelector('.screen')
      screen.focus()
      for (const type of ['keydown', 'keyup']) {
        screen.dispatchEvent(new KeyboardEvent(type, { code: 'F6', bubbles: true, cancelable: true }))
      }
    })()`)
    await page.until(
      `document.querySelector('.player .console').innerText.includes('at\\tvec3(300.000000, -300.000000, 10.000000)')`,
    )
  })

  it('draws the map as a cartoon or as GTA V does, which it keeps for the next time', async () => {
    const choose = (style: string) =>
      page.evaluate(`(() => {
      const select = [...document.querySelectorAll('#map select')].find((s) => [...s.options].some((o) => o.value === 'GTA'))
      select.value = '${style}'
      select.dispatchEvent(new Event('change'))
    })()`)
    /** The colour of the map on average, as red, green and blue, which what it scatters on its ground leaves as it is. */
    const average = () =>
      page.evaluate<[number, number, number]>(`(() => {
      const canvas = document.querySelector('#map canvas')
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
      const sum = [0, 0, 0]
      for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += data[i + c]
      return sum.map((total) => total / (data.length / 4))
    })()`)
    await choose('Cartoon')
    // The grass of the cartoon, then the dark blue of the sea of GTA V.
    expect(await page.evaluate(`localStorage.getItem('fiverunner:map-style')`)).toBe('Cartoon')
    const [r, g, b] = await average()
    expect(g - Math.max(r, b)).toBeGreaterThan(40)
    await choose('GTA')
    const [sr, sg, sb] = await average()
    expect(sb).toBeGreaterThan(sr)
    expect(sr + sg + sb).toBeLessThan(200)
    await choose('Classic')
    expect(await page.evaluate(`localStorage.getItem('fiverunner:map-style')`)).toBe('Classic')
  })

  it('shows the world round the peds of players behind their screens, faded as their games are', async () => {
    const command = (line: string) =>
      page.evaluate(`(() => {
        const input = document.getElementById('command-line')
        input.value = '${line}'
        input.form.requestSubmit()
      })()`)
    const fade = `getComputedStyle(document.querySelector('.player .screen .fade')).opacity`
    await command('fade out')
    await page.until(`${fade} === '1'`)
    await command('fade in')
    await page.until(`${fade} === '0'`)
    expect(
      await page.evaluate(`(() => {
        const canvas = document.querySelector('.player .screen .world canvas')
        const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
        let drawn = 0
        for (let i = 3; i < data.length; i += 4) if (data[i] > 0) drawn++
        return [canvas.width > 0, drawn > 0]
      })()`),
    ).toEqual([true, true])
  })

  it('gives the games of players the keys of their screens, which run the commands bound to them', async () => {
    await page.evaluate(`(() => {
      const screen = document.querySelector('.screen')
      screen.focus()
      for (const type of ['keydown', 'keyup']) {
        screen.dispatchEvent(new KeyboardEvent(type, { code: 'F5', bubbles: true, cancelable: true }))
      }
    })()`)
    const console = await page.until<string>(
      `document.querySelector('.player .console').innerText.includes('bank menu closed') && document.querySelector('.player .console').innerText`,
    )
    expect(console).toContain('[script:bank] bank menu opened')
  })

  it('restarts the resources whose files change, with the players they had, whose frames keep their storage', async () => {
    writeFileSync(join(project, 'server.lua'), `print('bank server changed')\n`)
    await page.until(`document.getElementById('console').innerText.includes('bank server changed')`)
    await page.until(`document.querySelectorAll('.viewport iframe').length === 2`)
    const origins = await frameOrigins()
    const names = await Promise.all(
      origins.map((origin) =>
        page.until<string>(
          `document.getElementById('name').textContent === 'bank seen' && document.getElementById('name').textContent`,
          origin,
        ),
      ),
    )
    expect(names).toEqual(['bank seen', 'bank seen'])
  })

  it('logs no errors', () => {
    const errors = chrome.logged.filter(({ text }) => /^(error|exception)/.test(text))
    expect(errors).toEqual([])
  })
})
