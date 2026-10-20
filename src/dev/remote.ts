import type {
  FileEntry,
  FileSource,
  HttpClient,
  HttpFailure,
  HttpResponse,
} from '../core/engine/index.ts'

/** Where the dev server serves what the dev UI needs of it. */
export const API = '/__fiverunner/api/'

/** The header that requests of the dev UI have, which pages of other origins cannot send without asking. */
export const API_HEADER = 'X-FiveRunner'

/** What a request to the dev server got. */
export interface Fetched {
  readonly status: number
  readonly body: Uint8Array
}

/** Requests `url` of the dev server and waits for what it gets, as workers can. */
export function getSync(url: string): Fetched {
  const request = new XMLHttpRequest()
  request.open('GET', url, false)
  request.responseType = 'arraybuffer'
  request.setRequestHeader(API_HEADER, '1')
  request.send()
  return { status: request.status, body: new Uint8Array(request.response as ArrayBuffer) }
}

const decoder = new TextDecoder()

/**
 * The files of the project of the dev server, which the dev UI runs: the
 * entries of its directories and the bytes of its files, which it asks the
 * server for as the engine first needs them, through `get`.
 */
export class RemoteSource implements FileSource {
  readonly #get: (url: string) => Fetched

  constructor(get: (url: string) => Fetched) {
    this.#get = get
  }

  list(path: string): readonly FileEntry[] {
    return JSON.parse(decoder.decode(this.#fetch('list', path))) as FileEntry[]
  }

  read(path: string): Uint8Array {
    return this.#fetch('read', path)
  }

  /** What the server has at `path`, which it lists or reads, or nothing for what went from its disk. */
  #fetch(what: 'list' | 'read', path: string): Uint8Array {
    const { status, body } = this.#get(`${API}${what}?path=${encodeURIComponent(path)}`)
    if (status === 404) return what === 'list' ? new TextEncoder().encode('[]') : new Uint8Array()
    if (status !== 200) throw new Error(`The dev server failed to ${what} ${path}: ${status}`)
    return body
  }
}

/** A request of a script as it goes to the dev server, with its body in base 64. */
export interface ProxiedRequest {
  readonly method: string
  readonly url: string
  readonly headers: readonly (readonly [string, string])[]
  readonly body: string
  readonly followLocation: boolean
  readonly timeout: number
}

/** What a request of a script got, as it comes from the dev server, with its body in base 64. */
export type ProxiedResult =
  | {
      readonly status: number
      readonly headers: readonly (readonly [string, string])[]
      readonly body: string
    }
  | HttpFailure

/** The bytes in base 64. */
export function toBase64(bytes: Uint8Array): string {
  let text = ''
  for (let at = 0; at < bytes.length; at += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  }
  return btoa(text)
}

/** The bytes that `text` has in base 64. */
export function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
}

/**
 * Sends the HTTP requests of scripts through the dev server, which sends
 * them as the command line tool does, out of the reach of the rules that
 * browsers have for the requests of pages, with `post`.
 */
export function proxiedHttp(post: (url: string, body: string) => Promise<string>): HttpClient {
  return async (request) => {
    const proxied: ProxiedRequest = {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: toBase64(request.body),
      followLocation: request.followLocation,
      timeout: request.timeout,
    }
    const result = JSON.parse(await post(`${API}http`, JSON.stringify(proxied))) as ProxiedResult
    if ('code' in result) return result
    const response: HttpResponse = {
      status: result.status,
      headers: result.headers,
      body: fromBase64(result.body),
    }
    return response
  }
}
