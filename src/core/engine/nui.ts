import { Hook } from '../hook.ts'
import { compareUtf8, lowerAscii } from '../libc.ts'
import { normalizePath } from './glob.ts'
import type { HttpHeader } from './http.ts'
import type { ResourceManager } from './manager.ts'
import { isFxVersionAtLeast } from './manifest.ts'
import mime from './mime.json' with { type: 'json' }
import { packObject, stringOf, toJson, type MsgpackObject } from './msgpack.ts'
import { msgpackOfJson, rewriteJson } from './rapidjson.ts'
import type { Resource } from './resource.ts'

/** The channel of FiveM's NUI resources component, which traces what goes wrong with NUI. */
const CHANNEL = 'nui-resources'

/**
 * A request that a NUI page makes of http://<resource>/<path> or
 * https://<resource>/<path>, as CEF hands FiveM the requests of pages.
 */
export interface NuiRequest {
  /** The method, of which POST alone carries a body. */
  readonly method: string
  /** The path, from its slash, without its query or its fragment. */
  readonly path: string
  /** The query, without its question mark, or empty. */
  readonly query: string
  /** The headers, by their names as Chromium sends them, such as the Origin of the page. */
  readonly headers: readonly HttpHeader[]
  readonly body: Uint8Array
}

/** What a NUI request gets. */
export interface NuiResponse {
  readonly status: number
  readonly headers: readonly HttpHeader[]
  readonly body: Uint8Array
}

/** The frame of a resource, which shows the page of its ui_page entry. */
export interface NuiFrame {
  readonly resource: string
  /** The URL of the page: https://cfx-nui-<resource>/<page> for manifests from cerulean on, nui://<resource>/<page> for the others, or the page itself where it is a URL. */
  readonly url: string
}

/** A callback of a resource for the requests of a type: an event, a function, or a raw function. */
type Registration =
  { readonly kind: 'event' } | { readonly kind: 'function' | 'raw'; readonly ref: string }

/** What NUI keeps of a resource, as FiveM's resource UI component does. */
interface ResourceUi {
  /** The callbacks by their types, each in the order they came. */
  readonly callbacks: Map<string, Registration[]>
  frame: NuiFrame | undefined
  /** Whether the resource stopped since it last started, which leaves its requests unanswered. */
  dead: boolean
  /** Whether its frame takes requests from its own pages alone. */
  strict: boolean
}

/** What FiveRunner tells of callbacks that answer with what FiveM fails to convert. */
const UNCONVERTED =
  'A NUI callback answered with what FiveM fails to convert, which throws in FiveM, and leaves the request unanswered in FiveRunner.'

const encoder = new TextEncoder()
const NIL: MsgpackObject = { type: 'nil' }

/** The types of files by their extensions, as FiveM's NUI serves them. */
const TYPES = new Map(Object.entries(mime.types))
/** The types whose files FiveM's NUI says are in UTF-8. */
const UTF8_TYPES = new Set(['text/html', 'text/css', 'application/javascript'])

/**
 * The NUI of a client, as FiveM's NUI resources component keeps it: the
 * frames of its resources, which embedders show and which scripts send
 * messages, the focus that scripts give them, and the callbacks that the
 * requests of their pages call.
 */
export class Nui {
  /** Runs as a resource that starts gets its frame. */
  readonly onCreate = new Hook<[frame: NuiFrame]>()
  /** Runs as the frame of a resource that stops goes. */
  readonly onDestroy = new Hook<[resource: string]>()
  /** Runs as a resource sends its frame a message, with its JSON, which the page gets as an object. */
  readonly onMessage = new Hook<[resource: string, json: string]>()
  /** Runs as a resource focuses or blurs its frame. */
  readonly onFrameFocus = new Hook<[resource: string, focused: boolean]>()
  /** Runs as NUI gets or loses the focus, or the cursor. */
  readonly onFocus = new Hook<[focus: boolean, cursor: boolean]>()
  /** Runs as NUI starts or stops leaving input to the game while it has the focus. */
  readonly onKeepInput = new Hook<[keepInput: boolean]>()
  /** Runs as a resource sets the z-index of its frame. */
  readonly onZIndex = new Hook<[resource: string, zIndex: number]>()
  /** Where the cursor is in the game window, in pixels, which embedders move. */
  cursor = { x: 0, y: 0 }
  readonly #manager: ResourceManager
  readonly #resources = new WeakMap<Resource, ResourceUi>()
  /** The names of the resources that ask for the focus, the cursor, and to leave input to the game. */
  readonly #focusVotes = new Set<string>()
  readonly #cursorVotes = new Set<string>()
  readonly #keepInputVotes = new Set<string>()
  #focus = false
  #cursorShown = false
  #keepInput = false

  constructor(manager: ResourceManager) {
    this.#manager = manager
  }

  /**
   * Keeps what NUI has of a resource: a frame once its scripts loaded as it
   * starts, as FiveM creates them, which goes as it stops, with its votes
   * for the focus.
   */
  attach(resource: Resource): void {
    const ui: ResourceUi = { callbacks: new Map(), frame: undefined, dead: false, strict: false }
    this.#resources.set(resource, ui)
    resource.onStart.connect(() => this.#create(resource, ui))
    resource.onStop.connect(() => {
      ui.dead = true
      if (ui.frame !== undefined) {
        ui.frame = undefined
        this.onDestroy.run(resource.name)
      }
      this.#focusVotes.delete(resource.name)
      this.#cursorVotes.delete(resource.name)
      this.#keepInputVotes.delete(resource.name)
      this.#update()
    })
  }

  /** The frames of the resources, in the order the resources were added. */
  get frames(): NuiFrame[] {
    const frames: NuiFrame[] = []
    for (const resource of this.#manager.resources) {
      const frame = this.#resources.get(resource)?.frame
      if (frame !== undefined) frames.push(frame)
    }
    return frames
  }

  /** Whether NUI has the focus. */
  get focused(): boolean {
    return this.#focus
  }

  /** Whether NUI shows the cursor. */
  get cursorShown(): boolean {
    return this.#cursorShown
  }

  /** Whether NUI leaves input to the game while it has the focus. */
  get keepingInput(): boolean {
    return this.#keepInput
  }

  /**
   * Answers a request of a page to http(s)://<host>/..., as FiveM does: by
   * the callbacks of the resource named `host`, whatever the case, for the
   * type that the path names, or else for its first part, at the end of the
   * next tick of the client. Resolves with what a callback answers, or at
   * once with 404 where there is none. A request that no callback answers,
   * as FiveM leaves those to resources that stopped and those whose bodies
   * are no JSON, stays unanswered.
   */
  request(host: string, request: NuiRequest): Promise<NuiResponse> {
    return new Promise((resolve) => {
      const resource = this.#find(host)
      const ui = resource === undefined ? undefined : this.#resources.get(resource)
      const type = request.path.slice(1)
      // A type without callbacks takes those of its first part.
      const key = ui?.callbacks.has(type) === true ? type : type.split('/', 1)[0]!
      const registrations = ui?.callbacks.get(key)?.slice()
      if (resource === undefined || ui === undefined || registrations === undefined) {
        resolve(respond(404, [], new Uint8Array()))
        return
      }
      const origin = originResource(request.headers)
      if (ui.strict && origin !== resource.name) {
        this.#manager.trace(
          CHANNEL,
          `ResourceUI::InvokeCallback: call to '${resource.name}/${type}' from '${origin ?? '(null)'}' has been blocked by NUI Callback Strict Mode\n`,
        )
        resolve(respond(404, [], new Uint8Array()))
        return
      }
      const body = request.method === 'POST' ? request.body : new Uint8Array()
      this.#manager.enqueue(() => {
        if (ui.dead) return
        for (const registration of registrations) {
          this.#call(resource, key, registration, { ...request, body }, type, origin, resolve)
        }
      })
    })
  }

  /**
   * Answers a request of a page for nui://<host>/<path>, or for
   * https://<host>/<path> where the host is cfx-nui-<resource>, as FiveM's
   * NUI does: with a file of the resource named so, whatever its case, from
   * the files of the client, as the type of its extension, or else as HTML.
   * Paths with "..", the manifest, and the client scripts that file entries
   * do not name too get 404, as missing files do.
   */
  file(host: string, path: string): NuiResponse {
    const resource = this.#find(host.startsWith('cfx-nui-') ? host.slice('cfx-nui-'.length) : host)
    const bytes =
      resource === undefined || path.includes('..') || hidden(resource, path)
        ? undefined
        : this.#manager.files.read(normalizePath(`${resource.path}/${path}`))
    const type =
      bytes === undefined
        ? 'text/html'
        : (TYPES.get(path.slice(path.lastIndexOf('.') + 1)) ?? 'text/html')
    return {
      status: bytes === undefined ? 404 : 200,
      headers: sorted([
        ['content-type', UTF8_TYPES.has(type) ? `${type}; charset=utf-8` : type],
        ['access-control-allow-origin', '*'],
        ['access-control-allow-methods', 'GET, OPTIONS'],
        ['cache-control', 'no-cache, must-revalidate'],
      ]),
      body: bytes ?? new Uint8Array(),
    }
  }

  /** Adds a callback of a resource for the requests of `type`, after those it has. */
  register(resource: Resource, type: string, registration: Registration): void {
    const callbacks = this.#resources.get(resource)!.callbacks
    const registrations = callbacks.get(type)
    if (registrations === undefined) callbacks.set(type, [registration])
    else registrations.push(registration)
  }

  /** Removes the callbacks of a resource for the requests of `type`, whatever their kinds. */
  unregister(resource: Resource, type: string): void {
    this.#resources.get(resource)!.callbacks.delete(type)
  }

  /**
   * Sends the frame of a resource the message that `json` holds, as JSON
   * that RapidJSON wrote back, and returns whether it could: not for a
   * resource without a frame, nor with JSON that RapidJSON fails to read,
   * which it traces, nor without JSON, where FiveM crashes.
   */
  send(resource: Resource, json: Uint8Array | null): boolean {
    if (this.#resources.get(resource)?.frame === undefined) {
      this.#manager.trace(CHANNEL, `SEND_NUI_MESSAGE: resource ${resource.name} has no UI frame\n`)
      return false
    }
    if (json === null) {
      this.#manager.output.diagnose(
        resource.name,
        'SendNuiMessage was given no JSON: FiveM would read it from nowhere, and crash. FiveRunner sends nothing.',
      )
      return false
    }
    const rewritten = rewriteJson(json)
    if ('error' in rewritten) {
      this.#manager.trace(
        CHANNEL,
        `SEND_NUI_MESSAGE: invalid JSON passed in frame (rapidjson error code ${rewritten.error})\n`,
      )
      return false
    }
    // FiveM sends frames whose names have quotes nothing, as a last check.
    if (!resource.name.includes('"')) this.onMessage.run(resource.name, rewritten.json)
    return true
  }

  /** Focuses or blurs the frame of a resource that has one, which votes for the focus and the cursor. */
  setFocus(resource: Resource, focus: boolean, cursor: boolean): void {
    if (this.#resources.get(resource)?.frame === undefined || resource.name.includes('"')) return
    this.onFrameFocus.run(resource.name, focus)
    vote(this.#focusVotes, resource.name, focus)
    vote(this.#cursorVotes, resource.name, cursor)
    this.#update()
  }

  /** Votes for a resource to leave input to the game while NUI has the focus. */
  setKeepInput(resource: Resource, keep: boolean): void {
    vote(this.#keepInputVotes, resource.name, keep)
    this.#update()
  }

  /** Sets the z-index of the frame of a resource that has one. */
  setZIndex(resource: Resource, zIndex: number): void {
    if (this.#resources.get(resource)?.frame === undefined || resource.name.includes('"')) return
    this.onZIndex.run(resource.name, zIndex)
  }

  /** The resource named `name` whatever its case, the last of them, as FiveM finds them. */
  #find(name: string): Resource | undefined {
    let found: Resource | undefined
    for (const resource of this.#manager.resources) {
      if (lowerAscii(resource.name) === lowerAscii(name)) found = resource
    }
    return found
  }

  /** Gives a resource that starts its frame, as FiveM creates them, if its manifest has one ui_page. */
  #create(resource: Resource, ui: ResourceUi): void {
    ui.dead = false
    const pages = resource.entries('ui_page')
    if (pages.length === 0) return
    if (pages.length > 1) {
      this.#manager.trace(
        CHANNEL,
        `ResourceUI::Create: more than one ui_page in resource ${resource.name}\n`,
      )
      return
    }
    const page = pages[0]!
    const prefix = isFxVersionAtLeast(resource.metadata, 'cerulean') ? 'https://cfx-nui-' : 'nui://'
    ui.frame = {
      resource: resource.name,
      url: page.includes('://') ? page : `${prefix}${resource.name}/${page}`,
    }
    // FiveM reads the first strict mode entry, and keeps the mode once it is on.
    if (resource.entries('nui_callback_strict_mode')[0] === 'true') ui.strict = true
    this.onCreate.run(ui.frame)
  }

  /** Calls a callback of a resource for a request, as FiveM does for each kind. */
  #call(
    resource: Resource,
    type: string,
    registration: Registration,
    request: NuiRequest,
    requested: string,
    origin: string | undefined,
    resolve: (response: NuiResponse) => void,
  ): void {
    const manager = this.#manager
    if (registration.kind === 'raw') {
      const answer = manager.callbacks.create((args) => {
        const items = args.type === 'array' ? args.items : []
        if (items.length !== 1) return
        const response = rawResponse(items[0]!)
        if (response === undefined) {
          manager.output.diagnose(resource.name, UNCONVERTED)
          return
        }
        resolve(response)
      })
      const path = requested.slice(type.length) + (request.query === '' ? '' : `?${request.query}`)
      const req = rawRequest(request, path, origin)
      manager.invokeFunctionReference(
        registration.ref,
        packObject({ type: 'array', items: [req, { type: 'ext', extension: answer }] }),
      )
      return
    }
    const data = request.body.length === 0 ? NIL : msgpackOfJson(request.body)
    // FiveM leaves the requests whose bodies are no JSON alone.
    if (data === undefined) return
    const answer = manager.callbacks.create((args) => {
      const items = args.type === 'array' ? args.items : []
      if (items.length !== 1) return
      let json: string | undefined
      try {
        json = toJson(items[0]!)
      } catch (error) {
        if (!(error instanceof TypeError)) throw error
        manager.output.diagnose(resource.name, UNCONVERTED)
        return
      }
      // RapidJSON fails to write numbers that are not finite.
      if (json === undefined) return
      resolve(
        respond(200, [['Content-Type', 'application/json; charset=utf-8']], encoder.encode(json)),
      )
    })
    const args = packObject({ type: 'array', items: [data, { type: 'ext', extension: answer }] })
    if (registration.kind === 'event')
      manager.events.queue(`__cfx_nui:${type}`, args, 'nui', resource)
    else manager.invokeFunctionReference(registration.ref, args)
  }

  /** Gives NUI the focus and the cursor that the votes ask for, and tells as they change. */
  #update(): void {
    const focus = this.#focusVotes.size > 0
    const cursor = this.#cursorVotes.size > 0
    if (focus !== this.#focus || cursor !== this.#cursorShown) {
      this.#focus = focus
      this.#cursorShown = cursor
      this.onFocus.run(focus, cursor)
    }
    let keep = false
    for (const name of this.#keepInputVotes) {
      if (this.#focusVotes.has(name) || this.#cursorVotes.has(name)) keep = true
    }
    if (keep !== this.#keepInput) {
      this.#keepInput = keep
      this.onKeepInput.run(keep)
    }
  }
}

/** Adds the vote of `name`, or takes it back. */
function vote(votes: Set<string>, name: string, yes: boolean): void {
  if (yes) votes.add(name)
  else votes.delete(name)
}

/**
 * Whether pages do not get a file of a resource, as FiveM hides them: its
 * manifest, and the client scripts that no file entry names, by the path
 * without the slashes that start it or follow others.
 */
function hidden(resource: Resource, path: string): boolean {
  const normal = path.replace(/^\/+|\/(?=\/)/g, '')
  if (matches(normal, 'fxmanifest.lua') || matches(normal, '__resource.lua')) return true
  return (
    resource.globEntries('client_script').some((script) => matches(normal, script)) &&
    !resource.globEntries('file').some((file) => matches(normal, file))
  )
}

/** Whether a path names `name`, or what is in a directory it names, as FiveM matches the files of NUI. */
function matches(path: string, name: string): boolean {
  return path === name || path.startsWith(`${name}/`)
}

/** Headers in the order of the bytes of their names, as Chromium gets them from FiveM's maps. */
function sorted(headers: HttpHeader[]): HttpHeader[] {
  return headers.sort(([a], [b]) => compareUtf8(a, b))
}

/** The resource whose frame a request comes from, by its Origin, as FiveM reads it from nui:// and https://cfx-nui- URLs. */
function originResource(headers: readonly HttpHeader[]): string | undefined {
  const origin = headers.find(([name]) => name === 'Origin')?.[1]
  for (const prefix of ['nui://', 'https://cfx-nui-']) {
    if (origin?.startsWith(prefix)) return origin.slice(prefix.length)
  }
  return undefined
}

/**
 * A response as FiveM's NUI gives them: with the headers of the callback,
 * which say what it is, or as JSON, and not to cache it, and to let any
 * origin read it with POST, GET and OPTIONS, unless the callback said so.
 */
function respond(status: number, headers: readonly HttpHeader[], body: Uint8Array): NuiResponse {
  const has = (name: string) => headers.some(([header]) => lowerAscii(header) === name)
  const all: HttpHeader[] = [...headers]
  if (!has('content-type')) all.push(['content-type', 'application/json'])
  all.push(['cache-control', 'no-cache, must-revalidate'])
  if (!has('access-control-allow-origin')) all.push(['access-control-allow-origin', '*'])
  if (!has('access-control-allow-methods')) {
    all.push(['access-control-allow-methods', 'POST, GET, OPTIONS'])
  }
  return { status, headers: sorted(all), body }
}

/** The request that a raw callback gets, as FiveM packs it. */
function rawRequest(request: NuiRequest, path: string, origin: string | undefined): MsgpackObject {
  const str = (text: string | Uint8Array): MsgpackObject => ({
    type: 'str',
    bytes: typeof text === 'string' ? encoder.encode(text) : text,
  })
  // FiveM gets the headers ordered by their names, and keeps the first value of each in a std::map.
  const headers = sorted([...request.headers])
  const firsts = new Map<string, string>()
  for (const [name, value] of headers) if (!firsts.has(name)) firsts.set(name, value)
  return {
    type: 'map',
    entries: [
      [
        str('headers'),
        { type: 'map', entries: [...firsts].map(([name, value]) => [str(name), str(value)]) },
      ],
      [
        str('rawHeaders'),
        {
          type: 'array',
          items: headers.map(([key, value]) => ({
            type: 'map',
            entries: [
              [str('key'), str(key)],
              [str('value'), str(value)],
            ],
          })),
        },
      ],
      [str('method'), str(request.body.length === 0 ? 'GET' : 'POST')],
      [str('path'), str(path)],
      [str('body'), str(request.body)],
      [str('resource'), origin === undefined ? NIL : str(origin)],
    ],
  }
}

/**
 * What a raw callback answers, as FiveM reads it: a map by strings with a
 * status, an int that is 200 by default, headers, by their names in lower
 * case, with a value or a list of them, and a body. Undefined for what
 * FiveM fails to convert.
 */
function rawResponse(answer: MsgpackObject): NuiResponse | undefined {
  if (answer.type !== 'map') return undefined
  let status = 200
  let body: Uint8Array = new Uint8Array()
  const headers: HttpHeader[] = []
  for (const [key, value] of answer.entries) {
    const name = stringOf(key)
    if (name === undefined) return undefined
    if (name === 'status') {
      if (value.type !== 'positive' && value.type !== 'negative') return undefined
      if (value.value < -0x80000000n || value.value > 0x7fffffffn) return undefined
      status = Number(value.value)
    } else if (name === 'body') {
      if (value.type !== 'str' && value.type !== 'bin') return undefined
      body = value.bytes
    } else if (name === 'headers' && value.type !== 'array') {
      if (value.type !== 'map') return undefined
      for (const [header, values] of value.entries) {
        const headerName = stringOf(header)
        if (headerName === undefined) return undefined
        for (const item of values.type === 'array' ? values.items : [values]) {
          const text = stringOf(item)
          if (text === undefined) return undefined
          headers.push([lowerAscii(headerName), text])
        }
      }
    }
  }
  return respond(status, headers, body)
}
