/**
 * The dev UI: the console of the server, its resources, the events that
 * the server and its clients send each other, its state bags, and the
 * players that connect to it, each with a screen that shows the frames of
 * its NUI.
 * Its worker runs the engine, and the bridges of the origins of frames
 * pass the requests of their pages on to it.
 */
import './style.css'

import type { OutputLine } from '../../runner/output.ts'
import { parseFrameHost } from '../hosts.ts'
import type { BridgeToUi, FromWorker, ToWorker, UiToBridge } from '../protocol.ts'
import { API } from '../remote.ts'
import { DEV_PATH } from '../routes.ts'
import type { DevPlayer, DevState, NuiEvent } from '../session.ts'
import { Console } from './console.ts'
import { Events, showBags } from './inspect.ts'
import { Screen } from './screen.ts'

/** The element with the id `id`, which the page has. */
function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

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

const tab = tabId()
const port = location.port
const worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' })
const send = (message: ToWorker) => worker.postMessage(message)

const status = byId<HTMLElement>('status')
const project = byId<HTMLElement>('project')
const server = new Console(byId('console'))
const resources = byId<HTMLUListElement>('resources-list')
const playerList = byId<HTMLElement>('player-list')
const events = new Events(byId('events'), byId<HTMLFormElement>('emit'), {
  emit: (name, args, target) => send({ type: 'emit', name, args, target }),
})
const bags = byId<HTMLElement>('bags')

/** What the dev UI shows of a player. */
interface PlayerView {
  readonly element: HTMLElement
  readonly info: HTMLElement
  readonly card: HTMLElement
  readonly screen: Screen
  readonly console: Console
  cardJson: string | undefined
}

const players = new Map<number, PlayerView>()

/** The bridges of the origins of frames, by their origins, once they are ready. */
const bridges = new Map<string, { frame: HTMLIFrameElement; ready: Promise<void> }>()
const bridgeReady = new Map<string, () => void>()

/** What bridges asked, by the ids that the worker answers by. */
const asked = new Map<
  number,
  { readonly bridge: HTMLIFrameElement; readonly origin: string; readonly id: number }
>()
let asks = 0

function setStatus(text: string, kind: 'running' | 'starting' | 'failed'): void {
  status.textContent = text
  status.className = kind
}

/** Loads the bridge of the origin of `url`, if it is one of the dev UI's, and resolves once it is ready. */
function bridge(url: string): Promise<void> {
  const parsed = new URL(url)
  if (parseFrameHost(parsed.hostname) === undefined) return Promise.resolve()
  const { origin } = parsed
  let found = bridges.get(origin)
  if (found === undefined) {
    const frame = document.createElement('iframe')
    frame.src = `${origin}${DEV_PATH}bridge.html`
    frame.title = 'FiveRunner NUI bridge'
    const ready = new Promise<void>((resolve) => bridgeReady.set(origin, resolve))
    found = { frame, ready }
    bridges.set(origin, found)
    byId('bridges').append(frame)
  }
  return found.ready
}

/** The view of the player of `client`, which it makes the first time. */
function playerView(client: number): PlayerView {
  let view = players.get(client)
  if (view !== undefined) return view
  const element = document.createElement('article')
  element.className = 'player'
  const header = document.createElement('header')
  const info = document.createElement('span')
  info.className = 'info'
  const quit = document.createElement('button')
  quit.textContent = 'Disconnect'
  quit.addEventListener('click', () => send({ type: 'disconnect', client }))
  header.append(info, quit)
  const card = document.createElement('div')
  card.className = 'card'
  card.hidden = true
  const screen = new Screen(client, tab, port, {
    bridge,
    cursor: (x, y) => send({ type: 'cursor', client, x, y }),
  })
  const output = document.createElement('div')
  output.className = 'console small'
  element.append(header, screen.element, card, output)
  playerList.append(element)
  view = { element, info, card, screen, console: new Console(output), cardJson: undefined }
  players.set(client, view)
  return view
}

/** Shows the deferral card of a player, with a box for what its Action.Submit gives. */
function showCard(client: number, view: PlayerView, player: DevPlayer): void {
  if (view.cardJson === player.card) return
  view.cardJson = player.card
  view.card.replaceChildren()
  view.card.hidden = player.card === undefined
  if (player.card === undefined) return
  const shown = document.createElement('pre')
  shown.textContent = player.card
  const form = document.createElement('form')
  const data = document.createElement('textarea')
  data.value = '{}'
  data.setAttribute('aria-label', 'What the card submits, as JSON')
  const submit = document.createElement('button')
  submit.textContent = 'Submit card'
  form.append(data, submit)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    send({ type: 'submitCard', client, json: data.value })
  })
  view.card.append(shown, form)
}

function showState(state: DevState): void {
  resources.replaceChildren(
    ...state.resources.map(({ name, state: resourceState }) => {
      const item = document.createElement('li')
      const label = document.createElement('span')
      label.textContent = name
      const badge = document.createElement('span')
      badge.className = `state ${resourceState}`
      badge.textContent = resourceState
      item.append(label, badge)
      for (const command of resourceState === 'started' ? ['restart', 'stop'] : ['start']) {
        const button = document.createElement('button')
        button.textContent = command
        button.addEventListener('click', () =>
          send({ type: 'command', line: `${command} "${name}"` }),
        )
        item.append(button)
      }
      return item
    }),
  )
  events.players(state.players)
  showBags(bags, state.bags)
  for (const player of state.players) {
    const view = playerView(player.client)
    const gone = player.state === 'dropped' || player.state === 'rejected'
    const reason = player.rejection ?? player.message?.trim()
    view.info.textContent = `${player.name} (id ${player.id}) ${player.state}${reason ? `: ${reason}` : ''}`
    view.element.classList.toggle('gone', gone)
    showCard(player.client, view, player)
  }
}

function showNui(client: number, event: NuiEvent): void {
  const { screen } = playerView(client)
  switch (event.type) {
    case 'create':
      void screen.create(event.frame)
      break
    case 'destroy':
      screen.destroy(event.resource)
      break
    case 'message':
      screen.message(event.resource, event.json)
      break
    case 'frameFocus':
      screen.frameFocus(event.resource, event.focused)
      break
    case 'focus':
      screen.focus(event.focus, event.cursor)
      break
    case 'zIndex':
      screen.zIndex(event.resource, event.zIndex)
      break
    case 'keepInput':
      break
  }
}

function showLine(line: OutputLine): void {
  const client = /^client (\d+)$/.exec(line.process)?.[1]
  if (client === undefined) server.add(line)
  else playerView(Number(client)).console.add(line)
}

/** Starts the session anew, with the players it had. */
function restart(why: string): void {
  setStatus('Starting', 'starting')
  server.note(why)
  events.note(why)
  for (const view of players.values()) view.element.remove()
  players.clear()
  send({ type: 'start' })
}

worker.addEventListener('message', (event: MessageEvent<FromWorker>) => {
  const message = event.data
  switch (message.type) {
    case 'started':
      project.textContent = message.project.name
      document.title = `${message.project.name} - FiveRunner`
      setStatus('Running', 'running')
      break
    case 'failed':
      setStatus(`Failed: ${message.message}`, 'failed')
      server.note(message.message)
      break
    case 'changed':
      if (message.restarted === null) restart('Files changed')
      else if (message.restarted.length > 0)
        server.note(`Files changed: restarted ${message.restarted.join(', ')}`)
      break
    case 'event': {
      const { event: devEvent } = message
      if (devEvent.type === 'output') showLine(devEvent.line)
      else if (devEvent.type === 'state') showState(devEvent.state)
      else if (devEvent.type === 'nui') showNui(devEvent.client, devEvent.event)
      else if (devEvent.type === 'net') events.add(devEvent.event)
      else {
        setStatus('Crashed', 'failed')
        server.note(devEvent.message)
      }
      break
    }
    case 'answer': {
      const found = asked.get(message.id)
      if (found === undefined) break
      asked.delete(message.id)
      const reply: UiToBridge = { type: 'fiverunner:answer', id: found.id, answer: message.answer }
      found.bridge.contentWindow?.postMessage(reply, found.origin)
      break
    }
  }
})

addEventListener('message', (event: MessageEvent) => {
  const found = bridges.get(event.origin)
  if (found !== undefined && event.source === found.frame.contentWindow) {
    const message = event.data as BridgeToUi
    if (message.type === 'fiverunner:bridge') {
      bridgeReady.get(event.origin)?.()
    } else if (message.type === 'fiverunner:ask') {
      const host = parseFrameHost(new URL(event.origin).hostname)
      if (host === undefined || host.tab !== tab) return
      const id = asks++
      asked.set(id, { bridge: found.frame, origin: event.origin, id: message.id })
      send({ type: 'ask', id, client: host.client, host: host.host, ask: message.ask })
    }
    return
  }
  // What the pages of frames tell the dev UI.
  for (const view of players.values()) {
    const resource = view.screen.frameOf(event.source)
    if (resource === undefined) continue
    const data = event.data as {
      type?: unknown
      x?: unknown
      y?: unknown
      native?: unknown
      arg?: unknown
    }
    if (
      data.type === 'fiverunner:cursor' &&
      typeof data.x === 'number' &&
      typeof data.y === 'number'
    ) {
      view.screen.cursorOver(data.x, data.y)
    } else if (data.type === 'fiverunner:invokeNative') {
      view.console.note(
        `${resource} called invokeNative('${String(data.native)}', '${String(data.arg)}')`,
      )
    }
    return
  }
})

byId<HTMLFormElement>('command').addEventListener('submit', (event) => {
  event.preventDefault()
  const input = byId<HTMLInputElement>('command-line')
  const line = input.value
  if (line.trim() === '') return
  history.push(line)
  historyAt = history.length
  server.note(`> ${line}`)
  send({ type: 'command', line })
  input.value = ''
})

/** The commands that were run, which the arrow keys go back through. */
const history: string[] = []
let historyAt = 0
byId<HTMLInputElement>('command-line').addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  event.preventDefault()
  historyAt = Math.max(0, Math.min(history.length, historyAt + (event.key === 'ArrowUp' ? -1 : 1)))
  ;(event.target as HTMLInputElement).value = history[historyAt] ?? ''
})

byId<HTMLFormElement>('connect').addEventListener('submit', (event) => {
  event.preventDefault()
  const name = byId<HTMLInputElement>('player-name').value.trim()
  send({ type: 'connect', name: name === '' ? 'Player' : name })
})

byId<HTMLButtonElement>('restart').addEventListener('click', () => restart('Restarted'))

const changes = new EventSource(`${API}events`)
changes.addEventListener('change', (event) =>
  send({
    type: 'change',
    paths: JSON.parse((event as MessageEvent<string>).data) as string[] | null,
  }),
)

restart('Started')
