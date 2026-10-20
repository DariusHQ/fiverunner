import type { HttpHeader, Nui, NuiResponse } from '../core/engine/index.ts'
import { fivemOrigin } from './hosts.ts'

/** What the service worker of the frames at a host asks of their client, for a request of their pages. */
export type Ask =
  /** A file of the host, at `path`, as the path of a URL. */
  | { readonly kind: 'file'; readonly path: string }
  /** What FiveM's NUI gives a request over HTTP to another host. */
  | {
      readonly kind: 'url'
      readonly url: string
      readonly method: string
      /** The headers, as browsers give them to service workers: by their names in lower case. */
      readonly headers: readonly HttpHeader[]
      readonly body: Uint8Array
    }

/** What a client answers: a response, or that the request goes to the web. */
export type Answer = { readonly response: NuiResponse } | { readonly network: true }

/**
 * A header name as Chromium sends the names that pages give, which
 * browsers tell service workers in lower case: with each word capitalized,
 * as in Content-Type.
 */
export function chromiumName(name: string): string {
  return name.replace(
    /(^|-)([a-z])/g,
    (_, dash: string, letter: string) => dash + letter.toUpperCase(),
  )
}

/**
 * Answers what the service worker of the frames at `host`, a host of
 * FiveM's, asks of their client, as FiveM's NUI answers the requests of
 * pages: with files, those of the host and of the hosts of cfx-nui- and
 * resources that started, and with what the callbacks of resources that
 * started answer, to requests that have the Origin of the frames. The
 * requests to other hosts go to the web.
 */
export async function answer(nui: Nui, host: string, ask: Ask): Promise<Answer> {
  if (ask.kind === 'file') return { response: nui.file(host, ask.path) }
  const url = new URL(ask.url)
  const scheme = url.protocol === 'https:' ? 'https' : 'http'
  if (!nui.takes(scheme, url.hostname)) return { network: true }
  if (scheme === 'https' && url.hostname.startsWith('cfx-nui-')) {
    return { response: nui.file(url.hostname, url.pathname) }
  }
  const headers: HttpHeader[] = ask.headers
    .filter(([name]) => name !== 'origin')
    .map(([name, value]) => [chromiumName(name), value])
  const response = await nui.request(url.hostname, {
    method: ask.method,
    path: url.pathname,
    query: url.search.slice(1),
    headers: [...headers, ['Origin', fivemOrigin(host)]],
    body: ask.body,
  })
  return { response }
}
