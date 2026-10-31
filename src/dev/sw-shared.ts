/**
 * What the service workers of frames share: they ask the client of the
 * frames for what a request of their pages gets, through whatever bridges
 * the BroadcastChannel of FiveRunner, and give the documents of frames
 * FRAME_SCRIPT before their own scripts. What no bridge takes within a
 * while, as when no page shows the frames, fails.
 */
import type { Answer, Ask } from './answers.ts'
import { FRAME_SCRIPT, withNuiUrls, withScript } from './frame.ts'
import type { AskingFrame, BridgeMessage } from './protocol.ts'

/** The parts of the scope of service workers that this one uses, which the DOM's types do not have. */
interface Scope {
  readonly location: Location
  readonly clients: {
    claim(): Promise<void>
    get(id: string): Promise<{ readonly url: string } | undefined>
  }
  skipWaiting(): Promise<void>
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void
}

interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void
}

export interface FetchEvent extends ExtendableEvent {
  readonly request: Request
  readonly clientId: string
  respondWith(response: Promise<Response>): void
}

/** Milliseconds within which the bridge must take a request. */
const ACK_TIMEOUT = 5000

export const scope = self as unknown as Scope
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

/** Asks the bridge `ask`, for the frame `frame` if it serves frames of many hosts, and resolves with what the client answered, or undefined if the bridge did not take it. */
function bridged(ask: Ask, frame: AskingFrame | undefined): Promise<Answer | undefined> {
  const id = next++
  return new Promise((resolve) => {
    const request = { taken: false, resolve }
    pending.set(id, request)
    channel.postMessage({
      type: 'ask',
      id,
      ask,
      ...(frame === undefined ? {} : { frame }),
    } satisfies BridgeMessage)
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
export async function respond(
  request: Request,
  copy: Request,
  ask: Ask | undefined,
  frame?: AskingFrame,
): Promise<Response> {
  const question: Ask = ask ?? {
    kind: 'url',
    url: copy.url,
    method: copy.method,
    headers: [...copy.headers],
    body: new Uint8Array(await copy.arrayBuffer()),
  }
  const answer = await bridged(question, frame)
  if (answer === undefined) {
    return new Response('No page of FiveRunner shows these frames.', { status: 504 })
  }
  return responseOf(request, answer)
}
