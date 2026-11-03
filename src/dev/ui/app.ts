/**
 * The dev UI: the console of the server, its resources, the events that
 * the server and its clients send each other, its state bags, a map of its
 * world, an inspector of its processes, and the players that connect to it,
 * each with a screen that shows the frames of its NUI.
 * Its worker runs the engine, and its platform says how the requests of
 * the pages of frames reach the worker, and where projects come from.
 */
import './style.css'

import type { OutputLine } from '../../runner/output.ts'
import type { Answer } from '../answers.ts'
import type { FromWorker, ToWorker } from '../protocol.ts'
import type { DevPlayer, DevState, NuiEvent } from '../session.ts'
import { cardForm } from './card.ts'
import { Console, keepHistory } from './console.ts'
import { Events, showBags } from './inspect.ts'
import { Inspector } from './inspector.ts'
import { WorldMap } from './map.ts'
import type { Platform } from './platform.ts'
import { Screen } from './screen.ts'

/** The element with the id `id`, which the page has. */
function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

/** Starts the dev UI on `platform`, in the page that has the elements of index.html. */
export function startApp({ worker, frames, project: given, watch }: Platform): void {
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
  const map = new WorldMap(byId('map'), {
    teleport: (client, x, y, z) =>
      send({ type: 'teleport', client, x, y, ...(z === undefined ? {} : { z }) }),
    waypoint: (client, x, y) => send({ type: 'waypoint', client, x, y }),
    // The worlds behind the screens of players are in the style of the map.
    styled: (name) => {
      for (const view of players.values()) view.screen.world.use(name)
    },
  })

  const inspector = new Inspector(
    {
      process: byId('inspected'),
      resources: byId('inspected-resources'),
      details: byId('inspected-details'),
      filter: byId('convar-filter'),
      convars: byId('convars'),
      form: byId('evaluate'),
      code: byId('code'),
    },
    {
      inspect: (process) => send({ type: 'inspect', process }),
      evaluate: (process, resource, code) => {
        const console = process === 'server' ? server : playerView(process).console
        console.note(`${resource}> ${code}`)
        send({ type: 'evaluate', process, resource, code })
      },
    },
  )

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

  /** What the pages of frames asked, by the ids that the worker answers by. */
  const asked = new Map<number, (answer: Answer) => void>()
  let asks = 0
  frames.listen((client, host, ask, respond) => {
    const id = asks++
    asked.set(id, respond)
    send({ type: 'ask', id, client, host, ask })
  })

  function setStatus(text: string, kind: 'running' | 'starting' | 'failed'): void {
    status.textContent = text
    status.className = kind
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
    const enlarge = document.createElement('button')
    enlarge.textContent = 'Enlarge'
    enlarge.addEventListener('click', () => {
      const large = element.classList.toggle('large')
      enlarge.textContent = large ? 'Shrink' : 'Enlarge'
    })
    const quit = document.createElement('button')
    quit.textContent = 'Disconnect'
    quit.addEventListener('click', () => send({ type: 'disconnect', client }))
    header.append(info, enlarge, quit)
    const card = document.createElement('div')
    card.className = 'card'
    card.hidden = true
    const screen = new Screen(client, {
      frame: (url) => frames.url(url, client),
      ready: (url) => frames.ready(url),
      cursor: (x, y) => send({ type: 'cursor', client, x, y }),
      key: (name, down) => send({ type: 'key', client, key: name, down }),
    })
    const output = document.createElement('div')
    output.className = 'console small'
    element.append(header, screen.element, card, output)
    playerList.append(element)
    view = { element, info, card, screen, console: new Console(output), cardJson: undefined }
    players.set(client, view)
    return view
  }

  /** Shows the deferral card of a player as a form, or as JSON, with a box for what its Action.Submit gives, if it has what the dev UI does not know. */
  function showCard(client: number, view: PlayerView, player: DevPlayer): void {
    // Cards stay with players, but go as they join.
    const card = player.state === 'connecting' ? player.card : undefined
    if (view.cardJson === card) return
    view.cardJson = card
    view.card.replaceChildren()
    view.card.hidden = card === undefined
    if (card === undefined) return
    const adaptive = cardForm(card, (json) => send({ type: 'submitCard', client, json }))
    if (adaptive !== undefined) {
      view.card.append(adaptive)
      return
    }
    const shown = document.createElement('pre')
    shown.textContent = card
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
    inspector.players(state.players)
    showBags(bags, state.bags)
    map.show(state.map, state.players)
    for (const player of state.players) {
      const view = playerView(player.client)
      const gone = player.state === 'dropped' || player.state === 'rejected'
      const said = player.state === 'connecting' ? player.message?.trim() : undefined
      const reason = player.rejection ?? said
      view.info.textContent = `${player.name} (id ${player.id}) ${player.state}${reason ? `: ${reason}` : ''}`
      view.element.classList.toggle('gone', gone)
      view.screen.world.show(state.map, state.players)
      view.screen.fade(player.fade ?? 0)
      view.screen.blur(player.blurred === true)
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
    const next = given()
    send({ type: 'start', ...(next === undefined ? {} : { project: next }) })
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
      case 'inspection':
        inspector.show(message.inspection)
        break
      case 'answer':
        asked.get(message.id)?.(message.answer)
        asked.delete(message.id)
        break
    }
  })

  addEventListener('message', (event: MessageEvent) => {
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
    rememberCommand(line)
    server.note(`> ${line}`)
    send({ type: 'command', line })
    input.value = ''
  })

  const rememberCommand = keepHistory(byId<HTMLInputElement>('command-line'))

  byId<HTMLFormElement>('connect').addEventListener('submit', (event) => {
    event.preventDefault()
    const name = byId<HTMLInputElement>('player-name').value.trim()
    send({ type: 'connect', name: name === '' ? 'Player' : name })
  })

  byId<HTMLButtonElement>('restart').addEventListener('click', () => restart('Restarted'))

  watch((paths) => send({ type: 'change', paths }))

  restart('Started')
}
