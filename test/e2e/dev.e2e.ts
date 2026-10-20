import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Chrome, findChrome, type Page } from './chrome.ts'

const TOOL = fileURLToPath(new URL('../../dist/fiverunner.js', import.meta.url))
const chromePath = findChrome()

/** A resource with a page, which a server command opens on every client, and which closes through a callback. */
const FILES: Record<string, string> = {
  'fxmanifest.lua': `fx_version 'cerulean'
game 'gta5'
server_script 'server.lua'
client_script 'client.lua'
ui_page 'html/index.html'
files { 'html/index.html', 'html/app.js' }
`,
  'server.lua': `print('bank server started')
GlobalState.bank = 'open'
RegisterNetEvent('bank:ping', function(value) print('ping', source, value) end)
RegisterCommand('open', function()
    TriggerClientEvent('bank:open', -1, 'Opened by the server')
end, false)
`,
  'client.lua': `RegisterNetEvent('bank:open', function(text)
    SendNUIMessage({ type = 'open', text = text })
    SetNuiFocus(true, true)
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
<script src="app.js"></script>
</body>
</html>
`,
  'html/app.js': `document.getElementById('name').textContent = GetParentResourceName() + ' ' + (localStorage.getItem('seen') ?? 'new')
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

  it('runs the server of the project', async () => {
    await page.until(`document.getElementById('status').textContent === 'Running'`)
    expect(
      await page.until<string>(
        `document.getElementById('console').innerText.includes('bank server started') && document.getElementById('console').innerText`,
      ),
    ).toContain('[script:bank] bank server started')
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
        `document.getElementById('console').innerText.includes('ping') && document.getElementById('console').innerText`,
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

  it('runs the project anew as its files change, with the players it had, whose frames keep their storage', async () => {
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
