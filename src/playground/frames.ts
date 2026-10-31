import type { Answer } from '../dev/answers.ts'
import type { BridgeMessage } from '../dev/protocol.ts'
import type { Frames } from '../dev/ui/platform.ts'
import { framePath } from './paths.ts'

/**
 * The frames of the playground, under the directory of its page, as a static
 * site has one origin: the service worker of the site tells them apart by
 * their paths, and the page itself takes what it asks.
 */
export class SharedOriginFrames implements Frames {
  /** Keeps the frames of the tab apart from those of others, as they share the service worker. */
  readonly #tab = Math.random().toString(36).slice(2, 10)
  readonly #channel = new BroadcastChannel('fiverunner')
  readonly #ready = navigator.serviceWorker
    .register('sw.js', { scope: './', updateViaCache: 'none' })
    .then(() => navigator.serviceWorker.ready)
    .then(() => undefined)

  url(url: string, client: number): string {
    const match = /^(?:nui:\/\/|https:\/\/(?=cfx-nui-))([^/?#]*)(.*)$/i.exec(url)
    if (match === null) return url
    const [, host = '', rest = ''] = match
    const path = rest.startsWith('/') ? rest : `/${rest}`
    return framePath({ tab: this.#tab, client, host }, path)
  }

  ready(): Promise<void> {
    return this.#ready
  }

  listen(ask: Parameters<Frames['listen']>[0]): void {
    this.#channel.addEventListener('message', (event: MessageEvent<BridgeMessage>) => {
      const message = event.data
      if (message.type !== 'ask' || message.frame?.tab !== this.#tab) return
      const { id, frame } = message
      this.#channel.postMessage({ type: 'ack', id } satisfies BridgeMessage)
      ask(frame.client, frame.host, message.ask, (answer: Answer) => {
        this.#channel.postMessage({ type: 'answer', id, answer } satisfies BridgeMessage)
      })
    })
  }
}
