import type { PackedValue } from '../../core/engine/msgpack.ts'
import type { DevBag, DevPlayer, EventTarget, NetEvent } from '../session.ts'
import { Console } from './console.ts'

/** What the events panel needs of the dev UI. */
export interface EventsHost {
  /** Triggers an event where `target` says, as the network would. */
  emit(name: string, args: PackedValue[], target: EventTarget): void
}

/**
 * The events panel: the events that the server and the clients sent each
 * other, as they got them, and a form that triggers events as the network
 * would, to the server from a player, or to players from the server.
 */
export class Events {
  readonly #log: Console
  readonly #target: HTMLSelectElement
  readonly #names = new Map<number, string>()

  constructor(log: HTMLElement, form: HTMLFormElement, host: EventsHost) {
    this.#log = new Console(log)
    this.#target = form.elements.namedItem('target') as HTMLSelectElement
    const name = form.elements.namedItem('name') as HTMLInputElement
    const args = form.elements.namedItem('args') as HTMLInputElement
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const target = targetOf(this.#target.value)
      if (target === undefined || name.value.trim() === '') return
      let parsed: unknown
      try {
        parsed = JSON.parse(args.value.trim() === '' ? '[]' : args.value)
      } catch (error) {
        this.#log.note(`The arguments are no JSON: ${String(error)}`)
        return
      }
      if (!Array.isArray(parsed)) {
        this.#log.note('The arguments are a JSON array, such as [100, "cash"]')
        return
      }
      host.emit(name.value.trim(), parsed as PackedValue[], target)
    })
    this.players([])
  }

  /** Shows an event that the server or a client got. */
  add({ from, to, name, args }: NetEvent): void {
    this.#log.entry(`${this.#who(from)} -> ${this.#who(to)}`, `${name}(${args})`, 'kind-event')
  }

  /** Shows a note, such as that the session started anew. */
  note(text: string): void {
    this.#log.note(text)
  }

  /** Takes the players that the form can trigger events of and to, keeping what it had chosen. */
  players(players: readonly DevPlayer[]): void {
    this.#names.clear()
    for (const { client, name } of players) this.#names.set(client, name)
    const joined = players.filter(({ state }) => state === 'joined')
    const options: [value: string, label: string][] = [
      ...joined.map(({ client, name }): [string, string] => [
        `from:${client}`,
        `To the server, from ${name}`,
      ]),
      ...joined.map(({ client, name }): [string, string] => [
        `to:${client}`,
        `To ${name}, from the server`,
      ]),
      ['to:everyone', 'To every player, from the server'],
    ]
    const chosen = this.#target.value
    this.#target.replaceChildren(
      ...options.map(([value, label]) => {
        const option = document.createElement('option')
        option.value = value
        option.textContent = label
        return option
      }),
    )
    if (options.some(([value]) => value === chosen)) this.#target.value = chosen
  }

  #who(end: 'server' | number): string {
    return end === 'server' ? 'server' : (this.#names.get(end) ?? `client ${end}`)
  }
}

/** Where a value of the form's select sends events. */
function targetOf(value: string): EventTarget | undefined {
  const [direction, client] = value.split(':')
  if (direction === 'to' && client === 'everyone') return { to: 'everyone' }
  const number = Number(client)
  if (!Number.isInteger(number) || number < 1) return undefined
  return direction === 'from' ? { from: number } : { to: number }
}

/** Shows the state bags of the server, with their keys and values. */
export function showBags(element: HTMLElement, bags: readonly DevBag[]): void {
  if (bags.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'empty'
    empty.textContent = 'No state bag has keys.'
    element.replaceChildren(empty)
    return
  }
  element.replaceChildren(
    ...bags.map(({ name, keys }) => {
      const section = document.createElement('section')
      const title = document.createElement('h3')
      title.textContent = name
      const list = document.createElement('dl')
      for (const { key, value } of keys) {
        const term = document.createElement('dt')
        term.textContent = key
        const description = document.createElement('dd')
        description.textContent = value
        list.append(term, description)
      }
      section.append(title, list)
      return section
    }),
  )
}
