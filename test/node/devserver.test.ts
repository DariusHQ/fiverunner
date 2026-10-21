import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request, createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { HttpClient } from '../../src/core/engine/index.ts'
import { startDevServer, type DevServer } from '../../src/node/devserver.ts'

let root: string
let servers: DevServer[]

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fiverunner-'))
  servers = []
})

afterEach(async () => {
  for (const server of servers) await server.close()
  rmSync(root, { recursive: true, force: true })
})

/** Writes `files` in the directory at `path` in the root, by their paths there, and returns its path. */
function write(path: string, files: Record<string, string>): string {
  const directory = join(root, path)
  mkdirSync(directory, { recursive: true })
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, file)), { recursive: true })
    writeFileSync(join(directory, file), text)
  }
  return directory
}

const WASM = new Uint8Array([0, 0x61, 0x73, 0x6d])

/** Starts the dev server of a resource named bank, with a built dev UI. */
async function start(http?: HttpClient, port = 0) {
  const project = write('bank', {
    'fxmanifest.lua': `fx_version 'cerulean'`,
    'client.lua': 'print(1)',
    'tests/bank.test.lua': '',
    'tests/helper.lua': '',
    'html/img/logo.png': 'png',
  })
  const assets = write('assets', {
    'index.html': '<p>ui</p>',
    'bridge.html': '<p>bridge</p>',
    'sw.js': 'self',
    'assets/ui.js': 'ui()',
    'assets/data.bin': 'data',
  })
  const changes: string[] = []
  const server = await startDevServer({
    root: project,
    assets,
    cfxlua: WASM,
    port,
    ...(http === undefined ? {} : { http }),
    onChange: () => changes.push('changed'),
  })
  servers.push(server)
  return { server, project, changes }
}

interface Got {
  readonly status: number
  readonly headers: IncomingHttpHeaders
  readonly body: string
}

/** Requests `path` of the server at `port` for `host`, which is the dev UI's by default. */
function get(
  port: number,
  path: string,
  options: { host?: string; headers?: Record<string, string>; method?: string; body?: string } = {},
): Promise<Got> {
  return new Promise((resolve, reject) => {
    const sent = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: options.method ?? 'GET',
        headers: { host: options.host ?? `fiverunner.localhost:${port}`, ...options.headers },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () =>
          resolve({
            status: response.statusCode!,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('latin1'),
          }),
        )
      },
    )
    sent.on('error', reject)
    sent.end(options.body)
  })
}

const API = { 'X-FiveRunner': '1' }

describe('The dev server', () => {
  it('serves the dev UI at fiverunner.localhost, which other names of the local machine lead to', async () => {
    const { server } = await start()
    const { port } = server
    const [page, asset, data, upper, missing, outside, local, loopback] = await Promise.all([
      get(port, '/'),
      get(port, '/__fiverunner/assets/ui.js'),
      get(port, '/__fiverunner/assets/data.bin'),
      get(port, '/', { host: `FiveRunner.LocalHost:${port}` }),
      get(port, '/__fiverunner/nope.js'),
      get(port, '/__fiverunner/%2e%2e/bank/client.lua'),
      get(port, '/x?y=1', { host: `localhost:${port}` }),
      get(port, '/', { host: `127.0.0.1:${port}` }),
    ])
    expect([
      server.url,
      [page.status, page.headers['content-type'], page.headers['cache-control'], page.body],
      [asset.status, asset.headers['content-type'], asset.body],
      [data.headers['content-type'], data.body],
      upper.body,
      missing.status,
      outside.status,
      [local.status, local.headers.location],
      loopback.headers.location,
    ]).toEqual([
      `http://fiverunner.localhost:${port}/`,
      [200, 'text/html; charset=utf-8', 'no-cache', '<p>ui</p>'],
      [200, 'text/javascript; charset=utf-8', 'ui()'],
      ['application/octet-stream', 'data'],
      '<p>ui</p>',
      404,
      404,
      [302, `http://fiverunner.localhost:${port}/x?y=1`],
      `http://fiverunner.localhost:${port}/`,
    ])
  })

  it('answers only requests for the names of the local machine at its port', async () => {
    const { server } = await start()
    const { port } = server
    const refused = await Promise.all([
      get(port, '/', { host: `example.com:${port}` }),
      get(port, '/', { host: 'fiverunner.localhost:1' }),
      get(port, '/', { host: 'fiverunner.localhost' }),
      get(port, '/', { host: `fiverunner.localhost.example.com:${port}` }),
    ])
    expect(refused.map(({ status, body }) => `${status} ${body}`)).toEqual(
      refused.map(() => '403 FiveRunner serves the local machine only.'),
    )
  })

  it('gives the dev UI the project and its files, but its test files, only as it asks with its header', async () => {
    const { server } = await start()
    const { port } = server
    const [project, root, tests, read, deep, test, missing, unsafe, wasm, forbidden] =
      await Promise.all([
        get(port, '/__fiverunner/api/project', { headers: API }),
        get(port, '/__fiverunner/api/list?path=', { headers: API }),
        get(port, '/__fiverunner/api/list?path=tests', { headers: API }),
        get(port, '/__fiverunner/api/read?path=client.lua', { headers: API }),
        get(port, '/__fiverunner/api/read?path=html%2Fimg%2Flogo.png', { headers: API }),
        get(port, '/__fiverunner/api/read?path=tests%2Fbank.test.lua', { headers: API }),
        get(port, '/__fiverunner/api/read?path=nope.lua', { headers: API }),
        get(port, '/__fiverunner/api/read?path=..%2Fassets%2Findex.html', { headers: API }),
        get(port, '/__fiverunner/api/cfxlua.wasm', { headers: API }),
        get(port, '/__fiverunner/api/project'),
      ])
    const names = (got: Got) =>
      (JSON.parse(got.body) as { name: string }[]).map(({ name }) => name).sort()
    const unlisted = await Promise.all(
      [
        ['/__fiverunner/api/read?path=', 'GET'],
        ['/__fiverunner/api/read?path=tests', 'GET'],
        ['/__fiverunner/api/read?path=.%2Fclient.lua', 'GET'],
        ['/__fiverunner/api/read?path=tests%2F..%2Fclient.lua', 'GET'],
        ['/__fiverunner/api/read?path=%2Fclient.lua', 'GET'],
        ['/__fiverunner/api/read?path=client.lua%2F', 'GET'],
        ['/__fiverunner/api/list?path=client.lua', 'GET'],
        ['/__fiverunner/api/list?path=client.lua%2Fx', 'GET'],
        ['/__fiverunner/api/list?path=..', 'GET'],
        ['/__fiverunner/api/project', 'POST'],
        ['/__fiverunner/api/list?path=', 'POST'],
        ['/__fiverunner/api/cfxlua.wasm', 'POST'],
        ['/__fiverunner/api/http', 'GET'],
        ['/__fiverunner/api/nope', 'GET'],
      ].map(([path, method]) => get(port, path!, { headers: API, method: method! })),
    )
    const posted = await get(port, '/__fiverunner/api/events', { method: 'POST' })
    expect([
      unlisted.map(({ status }) => status),
      posted.status,
      JSON.parse(project.body),
      names(root),
      names(tests),
      read.body,
      deep.body,
      test.status,
      missing.status,
      unsafe.status,
      [wasm.headers['content-type'], [...Buffer.from(wasm.body, 'latin1')]],
      forbidden.status,
    ]).toEqual([
      unlisted.map(() => 404),
      403,
      { name: 'bank', kind: 'resource', mount: 'resources/bank', commands: ['ensure "bank"'] },
      ['client.lua', 'fxmanifest.lua', 'html', 'tests'],
      ['helper.lua'],
      'print(1)',
      'png',
      404,
      404,
      404,
      ['application/wasm', [...WASM]],
      403,
    ])
  })

  it('sends the HTTP requests of the scripts of the dev UI', async () => {
    const sent: unknown[] = []
    const http: HttpClient = async (request) => {
      sent.push({ ...request, body: new TextDecoder().decode(request.body) })
      return request.url.includes('fail')
        ? { code: 7, message: "Couldn't connect to server" }
        : { status: 200, headers: [['x', 'y']], body: new TextEncoder().encode('ok') }
    }
    const { server } = await start(http)
    const post = (url: string) =>
      get(server.port, '/__fiverunner/api/http', {
        method: 'POST',
        headers: API,
        body: JSON.stringify({
          method: 'GET',
          url,
          headers: [['a', 'b']],
          body: 'aGk=',
          followLocation: false,
          timeout: 100,
        }),
      })
    const [ok, failed] = [await post('https://example.com/'), await post('https://fail/')]
    expect([JSON.parse(ok.body), JSON.parse(failed.body), sent[0]]).toEqual([
      { status: 200, headers: [['x', 'y']], body: 'b2s=' },
      { code: 7, message: "Couldn't connect to server" },
      {
        method: 'GET',
        url: 'https://example.com/',
        headers: [['a', 'b']],
        body: 'hi',
        followLocation: false,
        timeout: 100,
      },
    ])
  })

  it('serves the origins of frames their service worker and their bridge, and nothing else', async () => {
    const { server } = await start()
    const { port } = server
    const host = `cfx-nui-bank.c1.tab.fiverunner.localhost:${port}`
    const [worker, bridge, page, api] = await Promise.all([
      get(port, '/__fiverunner/sw.js', { host }),
      get(port, '/__fiverunner/bridge.html', { host }),
      get(port, '/html/index.html', { host }),
      get(port, '/__fiverunner/api/project', { host, headers: API }),
    ])
    expect([
      [worker.status, worker.headers['service-worker-allowed'], worker.body],
      [bridge.status, bridge.headers['service-worker-allowed'], bridge.body],
      [page.status, page.body],
      api.status,
    ]).toEqual([
      [200, '/', 'self'],
      [200, undefined, '<p>bridge</p>'],
      [503, "This frame of FiveRunner's NUI loads through its dev UI."],
      404,
    ])
  })

  it('tells the dev UIs as files of the project change, but those of node_modules and dot directories, which it then serves', async () => {
    const { server, project, changes } = await start()
    const { port } = server
    const before = await get(port, '/__fiverunner/api/read?path=client.lua', { headers: API })
    write('bank/node_modules', { 'x.js': '' })
    write('bank/.git', { HEAD: '' })
    const events = await new Promise<string>((resolve, reject) => {
      const sent = request(
        {
          host: '127.0.0.1',
          port,
          path: '/__fiverunner/api/events',
          headers: { host: `fiverunner.localhost:${port}` },
        },
        (response) => {
          let text = ''
          let written = false
          response.on('data', (chunk: Buffer) => {
            text += chunk.toString()
            if (text === ': FiveRunner\n\n') {
              // macOS can tell of the files of the project that were written just before the server watched them.
              setTimeout(() => {
                text = ''
                changes.splice(0)
                written = true
                writeFileSync(join(project, 'node_modules', 'x.js'), 'x')
                writeFileSync(join(project, '.git', 'HEAD'), 'x')
                setTimeout(() => writeFileSync(join(project, 'client.lua'), 'print(2)'), 500)
              }, 1000)
            }
            if (written && text.includes('event: change')) {
              sent.destroy()
              resolve(`${response.headers['content-type']} ${JSON.stringify(text)}`)
            }
          })
        },
      )
      sent.on('error', reject)
      sent.end()
    })
    const read = await get(port, '/__fiverunner/api/read?path=client.lua', { headers: API })
    expect([before.body, events, changes, read.body]).toEqual([
      'print(1)',
      'text/event-stream "event: change\\ndata: \\n\\n"',
      ['changed'],
      'print(2)',
    ])
  })

  it('ends what it tells the dev UIs as it closes', async () => {
    const { server } = await start()
    const ended = new Promise<string>((resolve, reject) => {
      const sent = request(
        {
          host: '127.0.0.1',
          port: server.port,
          path: '/__fiverunner/api/events',
          headers: { host: `fiverunner.localhost:${server.port}` },
        },
        (response) => {
          let text = ''
          response.on('data', (chunk: Buffer) => {
            text += chunk.toString()
            void server.close()
          })
          response.on('end', () => resolve(text))
        },
      )
      sent.on('error', reject)
      sent.end()
    })
    servers = []
    expect(await ended).toBe(': FiveRunner\n\n')
  })

  it('listens on the next port while those it is given are taken', async () => {
    const taken = createServer()
    await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve))
    const { port } = taken.address() as AddressInfo
    try {
      const { server } = await start(undefined, port)
      expect(server.port).toBe(port + 1)
    } finally {
      await new Promise((resolve) => taken.close(resolve))
    }
  })

  it('needs a project', async () => {
    await expect(
      startDevServer({ root: write('empty', {}), assets: root, cfxlua: WASM, port: 0 }),
    ).rejects.toThrow('has no FiveM project')
  })
})
