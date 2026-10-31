import type { Answer, Ask } from '../answers.ts'
import { devFrameUrl, parseFrameHost } from '../hosts.ts'
import type { BridgeToUi, UiToBridge } from '../protocol.ts'
import { DEV_PATH } from '../routes.ts'
import type { Frames } from './platform.ts'

/** The id of the tab, which it keeps as it reloads, and which keeps its frames to themselves. */
function tabId(): string {
  const key = 'fiverunner:tab'
  try {
    const kept = sessionStorage.getItem(key)
    if (kept !== null && /^[a-z0-9]{1,16}$/.test(kept)) return kept
    const id = Math.random().toString(36).slice(2, 10)
    sessionStorage.setItem(key, id)
    return id
  } catch {
    return Math.random().toString(36).slice(2, 10)
  }
}

type Listener = Parameters<Frames['listen']>[0]

/**
 * Frames at origins of their own, under the domain of the dev UI, as FiveM
 * has them: each origin has a bridge, a hidden frame that the UI loads
 * first, which passes on what the service worker of the origin asks.
 */
export class BridgedFrames implements Frames {
  readonly #tab = tabId()
  readonly #parent: HTMLElement
  readonly #bridges = new Map<string, { frame: HTMLIFrameElement; ready: Promise<void> }>()
  readonly #ready = new Map<string, () => void>()
  #listener: Listener = () => {}

  constructor(parent: HTMLElement) {
    this.#parent = parent
    addEventListener('message', (event: MessageEvent) => {
      const found = this.#bridges.get(event.origin)
      if (found === undefined || event.source !== found.frame.contentWindow) return
      const message = event.data as BridgeToUi
      if (message.type === 'fiverunner:bridge') this.#ready.get(event.origin)?.()
      else if (message.type === 'fiverunner:ask') {
        this.#asked(event.origin, found.frame, message.id, message.ask)
      }
    })
  }

  url(url: string, client: number): string {
    return devFrameUrl(url, client, this.#tab, location.port)
  }

  /** Loads the bridge of the origin of `url`, if it is one of the dev UI's, and resolves once it is ready. */
  ready(url: string): Promise<void> {
    const parsed = new URL(url)
    if (parseFrameHost(parsed.hostname) === undefined) return Promise.resolve()
    const { origin } = parsed
    let found = this.#bridges.get(origin)
    if (found === undefined) {
      const frame = document.createElement('iframe')
      frame.src = `${origin}${DEV_PATH}bridge.html`
      frame.title = 'FiveRunner NUI bridge'
      const ready = new Promise<void>((resolve) => this.#ready.set(origin, resolve))
      found = { frame, ready }
      this.#bridges.set(origin, found)
      this.#parent.append(frame)
    }
    return found.ready
  }

  listen(ask: Listener): void {
    this.#listener = ask
  }

  #asked(origin: string, frame: HTMLIFrameElement, id: number, ask: Ask): void {
    const host = parseFrameHost(new URL(origin).hostname)
    if (host === undefined || host.tab !== this.#tab) return
    this.#listener(host.client, host.host, ask, (answer: Answer) => {
      const reply: UiToBridge = { type: 'fiverunner:answer', id, answer }
      frame.contentWindow?.postMessage(reply, origin)
    })
  }
}
