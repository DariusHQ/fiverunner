import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { basename, join } from 'node:path'

import { fetchHttpClient, type FileSource, type HttpClient } from '../core/engine/index.ts'
import { DEV_DOMAIN, parseFrameHost } from '../dev/hosts.ts'
import type { ProjectInfo } from '../dev/protocol.ts'
import {
  API,
  API_HEADER,
  fromBase64,
  toBase64,
  type ProxiedRequest,
  type ProxiedResult,
} from '../dev/remote.ts'
import { DEV_PATH } from '../dev/routes.ts'
import { openProject } from './project.ts'
import { watchProject } from './watch.ts'

/** The port that the dev server listens on unless told otherwise, or the next that is free. */
export const DEFAULT_PORT = 30120

export interface DevServerOptions {
  /** The directory of the project, a resource or a server. */
  readonly root: string
  /** The directory of the built dev UI: its page, its bridge, its service worker and their assets. */
  readonly assets: string
  /** The bytes of cfxlua.wasm, which the dev UI runs. */
  readonly cfxlua: Uint8Array
  /** The port to listen on, or 0 for any; the next free one is taken if it is not free. */
  readonly port?: number
  /** What sends the HTTP requests of the scripts of the dev UI: fetch by default. */
  readonly http?: HttpClient
  /** Called as files of the project change, after the dev UIs were told. */
  readonly onChange?: () => void
}

export interface DevServer {
  /** Where the dev UI is. */
  readonly url: string
  readonly port: number
  close(): Promise<void>
}

/** The types of the files of the dev UI, by their extensions. */
const TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  wasm: 'application/wasm',
  svg: 'image/svg+xml',
  png: 'image/png',
}

/**
 * Starts the dev server of a project, which serves the dev UI, at
 * fiverunner.localhost, and what it asks of the server: the project and its
 * files, but its test files, cfxlua.wasm, and the HTTP requests of its
 * scripts, which the server sends; and the service worker and the bridge
 * of the origins of frames, at the names under it. It tells the dev UIs as
 * files of the project change. It listens on the local machine only, and
 * answers only requests for the names of the local machine, which keeps
 * pages of the web from reading through it.
 */
export async function startDevServer(options: DevServerOptions): Promise<DevServer> {
  let project = openProject(options.root)
  if (project === undefined) throw new Error(`${options.root} has no FiveM project`)
  const http = options.http ?? fetchHttpClient
  const listeners = new Set<ServerResponse>()
  let port = 0

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const name = /^(.*?)(?::(\d+))?$/.exec(request.headers.host ?? '')
    const hostname = (name?.[1] ?? '').toLowerCase()
    const url = new URL(request.url ?? '/', 'http://local')
    if (name?.[2] !== String(port))
      return reply(response, 403, 'FiveRunner serves the local machine only.')
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
      response.writeHead(302, {
        Location: `http://${DEV_DOMAIN}:${port}${url.pathname}${url.search}`,
      })
      return response.end()
    }
    if (hostname === DEV_DOMAIN) return ui(request, response, url)
    if (parseFrameHost(hostname) !== undefined) return frames(response, url)
    return reply(response, 403, 'FiveRunner serves the local machine only.')
  }

  /** Answers the requests of the dev UI. */
  const ui = async (request: IncomingMessage, response: ServerResponse, url: URL) => {
    const { pathname } = url
    if (pathname === '/') return asset(response, 'index.html')
    if (!pathname.startsWith(API)) {
      if (pathname.startsWith(DEV_PATH)) return asset(response, pathname.slice(DEV_PATH.length))
      return reply(response, 404, 'Not found')
    }
    const what = pathname.slice(API.length)
    if (what === 'events' && request.method === 'GET') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      response.write(': FiveRunner\n\n')
      listeners.add(response)
      request.on('close', () => listeners.delete(response))
      return
    }
    // Pages of other origins cannot send the header without asking, which the server never allows.
    if (request.headers[API_HEADER.toLowerCase()] !== '1') return reply(response, 403, 'Forbidden')
    const current = project!
    if (what === 'project' && request.method === 'GET') {
      const info: ProjectInfo = {
        name: basename(options.root),
        kind: current.kind,
        mount: current.mount,
        commands: current.commands,
      }
      return reply(response, 200, JSON.stringify(info), TYPES.json)
    }
    if ((what === 'list' || what === 'read') && request.method === 'GET') {
      const path = url.searchParams.get('path') ?? ''
      try {
        // Sources read only what they list, which leaves test files out.
        if (!listed(current.visible, path)) return reply(response, 404, 'Not found')
        if (what === 'list') {
          return reply(response, 200, JSON.stringify(current.visible.list(path)), TYPES.json)
        }
        return reply(response, 200, current.visible.read(path), 'application/octet-stream')
      } catch {
        // What went from the disk.
        return reply(response, 404, 'Not found')
      }
    }
    if (what === 'cfxlua.wasm' && request.method === 'GET') {
      return reply(response, 200, options.cfxlua, TYPES.wasm)
    }
    if (what === 'http' && request.method === 'POST') {
      const proxied = JSON.parse(await text(request)) as ProxiedRequest
      const result = await http({ ...proxied, body: fromBase64(proxied.body) })
      const answered: ProxiedResult =
        'code' in result
          ? result
          : { status: result.status, headers: result.headers, body: toBase64(result.body) }
      return reply(response, 200, JSON.stringify(answered), TYPES.json)
    }
    return reply(response, 404, 'Not found')
  }

  /** Answers the requests that reach the server at the origins of frames, which their service workers leave to it. */
  const frames = (response: ServerResponse, url: URL) => {
    const { pathname } = url
    if (pathname.startsWith(DEV_PATH)) {
      const path = pathname.slice(DEV_PATH.length)
      return asset(response, path, path === 'sw.js' ? { 'Service-Worker-Allowed': '/' } : {})
    }
    return reply(response, 503, "This frame of FiveRunner's NUI loads through its dev UI.")
  }

  /** Serves a file of the dev UI, by a path of a URL, which has no dot parts and stays in the assets. */
  const asset = (response: ServerResponse, path: string, headers: Record<string, string> = {}) => {
    let bytes: Uint8Array
    try {
      bytes = readFileSync(join(options.assets, path))
    } catch {
      return reply(response, 404, 'Not found')
    }
    const type = TYPES[path.slice(path.lastIndexOf('.') + 1)] ?? 'application/octet-stream'
    return reply(response, 200, bytes, type, headers)
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      if (!response.headersSent) reply(response, 500, String(error))
      else response.end()
    })
  })
  port = await listen(server, options.port ?? DEFAULT_PORT)

  const stopWatching = watchProject(options.root, (paths) => {
    project = openProject(options.root) ?? project
    const data = JSON.stringify(paths ?? null)
    for (const listener of listeners)
      listener.write(`event: change
data: ${data}

`)
    options.onChange?.()
  })

  return {
    url: `http://${DEV_DOMAIN}:${port}/`,
    port,
    close: () => {
      stopWatching()
      for (const listener of listeners) listener.end()
      return new Promise((resolve) => server.close(() => resolve()))
    },
  }
}

/**
 * Whether the directories of `source` list `path`, and those it is in, as
 * sources list what they read: which no path does with test files, or with
 * parts that are empty, dots, or drives, which would lead out of the
 * project. Parts of paths that are files fail to list.
 */
function listed(source: FileSource, path: string): boolean {
  if (path === '') return true
  let directory = ''
  for (const part of path.split('/')) {
    if (!source.list(directory).some((entry) => entry.name === part)) return false
    directory = directory === '' ? part : `${directory}/${part}`
  }
  return true
}

/** Answers with `status`, `body`, and the type, as what the dev UI gets is never cached. */
function reply(
  response: ServerResponse,
  status: number,
  body: string | Uint8Array,
  type = 'text/plain; charset=utf-8',
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache', ...headers })
  response.end(body)
}

/** The body of a request, as text. */
async function text(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/** Listens on `port` of the local machine, or on the next ports while those are taken, and resolves with the port. */
function listen(server: ReturnType<typeof createServer>, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const attempt = (at: number) => {
      const failed = (error: NodeJS.ErrnoException) => {
        server.off('listening', listening)
        if (error.code === 'EADDRINUSE' && at !== 0 && at < port + 20) attempt(at + 1)
        else reject(error)
      }
      const listening = () => {
        server.off('error', failed)
        resolve((server.address() as AddressInfo).port)
      }
      server.once('error', failed)
      server.once('listening', listening)
      server.listen(at, '127.0.0.1')
    }
    attempt(port)
  })
}
