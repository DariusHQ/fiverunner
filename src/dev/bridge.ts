/**
 * The bridge of an origin of frames of the dev UI, which the UI loads at
 * the origin before the frames: it registers the service worker of the
 * origin, then passes what the worker asks on to the UI, and what the UI
 * answers back.
 */
import type { BridgeMessage, BridgeToUi, UiToBridge } from './protocol.ts'
import { DEV_PATH } from './routes.ts'

/** The origin of the dev UI, at the domain that the names of the origins of frames end in. */
const ui = `${location.protocol}//fiverunner.localhost${location.port === '' ? '' : `:${location.port}`}`
const channel = new BroadcastChannel('fiverunner')

const tell = (message: BridgeToUi) => parent.postMessage(message, ui)

channel.addEventListener('message', (event: MessageEvent<BridgeMessage>) => {
  const message = event.data
  if (message.type !== 'ask') return
  channel.postMessage({ type: 'ack', id: message.id } satisfies BridgeMessage)
  tell({ type: 'fiverunner:ask', id: message.id, ask: message.ask })
})

addEventListener('message', (event: MessageEvent<UiToBridge>) => {
  if (event.source !== parent || event.origin !== ui) return
  const message = event.data
  if (message.type !== 'fiverunner:answer') return
  channel.postMessage({
    type: 'answer',
    id: message.id,
    answer: message.answer,
  } satisfies BridgeMessage)
})

await navigator.serviceWorker.register(`${DEV_PATH}sw.js`, { scope: '/', updateViaCache: 'none' })
await navigator.serviceWorker.ready
tell({ type: 'fiverunner:bridge' })
