import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { stripTypeScriptTypes } from 'node:module'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Chrome, findChrome, type Page } from './chrome.ts'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const chromePath = findChrome()

/** A page with the style of the cartoon map, from the sources of its modules without their types. */
const PAGE = `<!doctype html><meta charset="utf-8"><script type="module">
import { cartoonStyle } from '/src/dev/ui/map-styles.ts'
window.cartoon = cartoonStyle()
</script>`

function serve(): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://localhost')
    if (pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' }).end(PAGE)
    } else if (/^\/src\/[\w/-]+\.ts$/.test(pathname)) {
      const source = readFileSync(`${ROOT}${pathname.slice(1)}`, 'utf8')
      response.writeHead(200, { 'Content-Type': 'text/javascript' })
      response.end(stripTypeScriptTypes(source))
    } else response.writeHead(404).end()
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` })
    })
  })
}

describe.skipIf(chromePath === undefined && process.env.CI === undefined)(
  'The characters of the cartoon map',
  () => {
    let server: Server
    let chrome: Chrome
    let page: Page

    beforeAll(async () => {
      const served = await serve()
      server = served.server
      chrome = await Chrome.launch(chromePath!)
      page = await chrome.open('about:blank')
      await page.goto(served.url)
      await page.until('window.cartoon !== undefined')
    })

    afterAll(() => {
      chrome?.close()
      server?.close()
    })

    it('face left as the mirror of how they face right, whatever their hair', async () => {
      // How many pixels of a character facing left differ from those of one facing right, mirrored, with short and with long hair.
      const differing = await page.evaluate<number[]>(`(() => {
        const size = 100
        const draw = (heading, hairStyle) => {
          const canvas = document.createElement('canvas')
          canvas.width = canvas.height = size
          const context = canvas.getContext('2d')
          const painter = {
            context, width: size, height: size, ratio: 1, scale: 4, time: 1000, bare: true,
            toScreen: (x, y) => [x, y], toWorld: (x, y) => [x, y], claim: () => true, crowding: () => 0,
          }
          const look = { hair: 12, hairStyle, skin: [0, 0, 0], top: [0, 0], legs: [0, 0], shoes: [0, 0] }
          // Twice as big, its middle on the edge between two columns of pixels, which mirror each other.
          context.scale(2, 2)
          window.cartoon.entity(painter, { id: 3, kind: 'ped', x: 0, y: 0, z: 0, heading, model: 0, look }, size / 4, 45, false)
          return context.getImageData(0, 0, size, size).data
        }
        return [0, 1].map((hairStyle) => {
          const right = draw(270, hairStyle)
          const left = draw(90, hairStyle)
          let count = 0
          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
              const a = (y * size + x) * 4
              const b = (y * size + size - 1 - x) * 4
              if ([0, 1, 2, 3].some((c) => Math.abs(left[a + c] - right[b + c]) > 48)) count++
            }
          }
          return count
        })
      })()`)
      // A few pixels of the edges round differently; a hole in the hair takes over a hundred.
      expect(Math.max(...differing)).toBeLessThan(20)
    })
  },
)
