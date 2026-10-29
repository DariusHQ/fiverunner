/**
 * The service worker of the frames of an origin of the dev UI, which
 * answers the requests of their pages as FiveM's NUI does: it asks the
 * bridge of the origin, which asks the client of the frames, through the
 * dev UI, and gives the documents of frames FRAME_SCRIPT before their own
 * scripts. What the bridge does not take within a while, as when no dev
 * UI shows the frames, fails.
 */
import type { Answer, Ask } from './answers.ts'
import { FRAME_SCRIPT, withNuiUrls, withScript } from './frame.ts'
import type { BridgeMessage } from './protocol.ts'
import { route } from './routes.ts'

/** The parts of the scope of service workers that this one uses, which the DOM's types do not have. */
interface Scope {
  readonly location: Location
  readonly clients: { claim(): Promise<void> }
  skipWaiting(): Promise<void>
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void
}

interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void
}

interface FetchEvent extends ExtendableEvent {
  readonly request: Request
  respondWith(response: Promise<Response>): void
}

/** Milliseconds within which the bridge must take a request. */
const ACK_TIMEOUT = 5000

const scope = self as unknown as Scope
const channel = new BroadcastChannel('fiverunner')
/** The requests that the bridge was asked, by their ids, with whether it took them. */
const pending = new Map<number, { taken: boolean; resolve: (answer: Answer | undefined) => void }>()
let next = 0

channel.addEventListener('message', (event: MessageEvent<BridgeMessage>) => {
  const message = event.data
  const request = pending.get(message.id)
  if (request === undefined) return
  if (message.type === 'ack') {
    request.taken = true
  } else if (message.type === 'answer') {
    pending.delete(message.id)
    request.resolve(message.answer)
  }
})

/** Asks the bridge `ask`, and resolves with what the client answered, or undefined if the bridge did not take it. */
function bridged(ask: Ask): Promise<Answer | undefined> {
  const id = next++
  return new Promise((resolve) => {
    const request = { taken: false, resolve }
    pending.set(id, request)
    channel.postMessage({ type: 'ask', id, ask } satisfies BridgeMessage)
    setTimeout(() => {
      if (request.taken || !pending.delete(id)) return
      resolve(undefined)
    }, ACK_TIMEOUT)
  })
}

/** The response that an answer stands for, as browsers can give it. */
function responseOf(request: Request, answer: Answer): Response | Promise<Response> {
  if ('network' in answer) return fetch(request)
  const { status, headers, body } = answer.response
  // Browsers give only responses with statuses from 200 to 599, and no bodies for 204, 205 and 304.
  if (status < 200 || status > 599) return Response.error()
  const html = headers.some(
    ([name, value]) => name.toLowerCase() === 'content-type' && value.startsWith('text/html'),
  )
  const bytes =
    request.mode === 'navigate' && html ? withScript(withNuiUrls(body), FRAME_SCRIPT) : body
  try {
    const empty = status === 204 || status === 205 || status === 304
    return new Response(empty ? null : new Uint8Array(bytes), {
      status,
      headers: headers.map(([name, value]) => [name, value]),
    })
  } catch {
    // Headers that browsers do not take, such as those whose values have line breaks.
    return Response.error()
  }
}

/** Answers a request of a page of the frames, which `request` is a copy of. */
async function respond(request: Request, copy: Request, ask: Ask | undefined): Promise<Response> {
  const question: Ask = ask ?? {
    kind: 'url',
    url: copy.url,
    method: copy.method,
    headers: [...copy.headers],
    body: new Uint8Array(await copy.arrayBuffer()),
  }
  const answer = await bridged(question)
  if (answer === undefined) {
    return new Response('No dev UI shows these frames of FiveRunner.', { status: 504 })
  }
  return responseOf(request, answer)
}

scope.addEventListener('install', (event) => event.waitUntil(scope.skipWaiting()))
scope.addEventListener('activate', (event) => event.waitUntil(scope.clients.claim()))
scope.addEventListener('fetch', (event) => {
  const { request } = event
  const found = route(new URL(request.url), scope.location.origin)
  if (found.kind === 'network') return
  const ask: Ask | undefined =
    found.kind === 'file' ? { kind: 'file', path: found.path } : undefined
  event.respondWith(respond(request, request.clone(), ask))
})
