import { createServer, type Server } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Chrome, findChrome, type Page } from './chrome.ts'

const SITE = fileURLToPath(new URL('../../dist-playground', import.meta.url))
const chromePath = findChrome()
const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
}

/** The playground as GitHub Pages serves a project: at a directory of its own, and nothing out of it. */
function serve(): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://localhost')
    const path = pathname.startsWith('/fiverunner/')
      ? normalize(pathname.slice('/fiverunner/'.length) || 'index.html')
      : undefined
    const file = path === undefined ? undefined : join(SITE, path)
    if (file === undefined || !existsSync(file)) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'text/plain' })
    response.end(readFileSync(file))
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({ server, url: `http://localhost:${port}/fiverunner/` })
    })
  })
}

/** An expression of the text of an element of the first frame of the resource `resource`, or undefined. */
const inFrame = (resource: string, id: string) =>
  `document.querySelector('.viewport iframe[name="${resource}"]')?.contentDocument?.getElementById('${id}')?.textContent`

describe.skipIf(chromePath === undefined && process.env.CI === undefined)(
  'The playground in Chrome',
  () => {
    let server: Server
    let chrome: Chrome
    let page: Page

    beforeAll(async () => {
      const site = await serve()
      server = site.server
      chrome = await Chrome.launch(chromePath!)
      page = await chrome.open('about:blank')
      await page.goto(site.url)
    }, 60000)

    afterAll(() => {
      chrome.close()
      server.close()
    })

    it('runs the city in the page, from a static site', async () => {
      await page.until(
        `document.getElementById('status').textContent === 'Running'`,
        undefined,
        60000,
      )
      await page.until(
        `document.getElementById('console').innerText.includes('connection established')`,
      )
    }, 90000)

    it('connects players, whose frames share the origin of the page', async () => {
      await page.evaluate(`(() => {
        document.getElementById('player-name').value = 'Ann'
        document.getElementById('connect').requestSubmit()
      })()`)
      await page.until(`document.querySelector('.card form.adaptive') !== null`)
      await page.evaluate(`(() => {
        const form = document.querySelector('.card form.adaptive')
        form.querySelector('input').value = 'Ann Lee'
        form.querySelector('input[type=checkbox]').checked = true
        form.querySelector('button').click()
      })()`)
      await page.until(`${inFrame('city', 'name')} === 'Ann Lee'`)
      expect(await page.evaluate(inFrame('city', 'money'))).toBe('$500')
    }, 30000)

    it('answers the callbacks of pages, and the phone of JavaScript', async () => {
      await page.evaluate(`document.querySelector('.player .screen').focus()`)
      await page.evaluate(`(() => {
        const screen = document.querySelector('.player .screen')
        for (const type of ['keydown', 'keyup']) screen.dispatchEvent(new KeyboardEvent(type, { code: 'KeyM', bubbles: true }))
      })()`)
      await page.until(
        `document.querySelector('.viewport iframe[name="city_phone"]')?.contentDocument?.getElementById('phone')?.hidden === false`,
      )
      const answer = await page.evaluate<string>(`(async () => {
        const frame = document.querySelector('.viewport iframe[name="city_phone"]').contentWindow
        const response = await frame.fetch('https://city_phone/close', { method: 'POST', body: '{}' })
        return String(response.status) + ' ' + await response.text()
      })()`)
      expect(answer).toBe('200 {}')
    }, 30000)

    it('runs the files as visitors edit them', async () => {
      await page.evaluate(`(() => {
        document.querySelector('.editor nav button[data-path="resources/city/server.lua"]').click()
        const text = document.querySelector('.editor textarea')
        text.value = "print('the edited city')\\n" + text.value
        text.dispatchEvent(new Event('input'))
        document.getElementById('run').click()
      })()`)
      await page.until(
        `document.getElementById('console').innerText.includes('the edited city')`,
        undefined,
        60000,
      )
    }, 90000)

    it('logs no errors', () => {
      const errors = chrome.logged.filter(({ text }) => /^(error|exception)/.test(text))
      expect(errors.map(({ text }) => text)).toEqual([])
    })
  },
)
