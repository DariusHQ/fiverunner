import type { DevInspection, DevProcess, DevResource } from '../inspection.ts'
import type { DevPlayer } from '../session.ts'
import { keepHistory } from './console.ts'

/** How often the inspector asks for what it shows, in ms. */
const INTERVAL = 1000

/** What the inspector needs of the dev UI. */
export interface InspectorHost {
  /** Asks what `process` has, which comes back to Inspector.show. */
  inspect(process: DevProcess): void
  /** Runs `code` in a resource of `process`. */
  evaluate(process: DevProcess, resource: string, code: string): void
}

/** The elements of the inspector. */
export interface InspectorElements {
  readonly process: HTMLSelectElement
  readonly resources: HTMLElement
  readonly details: HTMLElement
  readonly filter: HTMLInputElement
  readonly convars: HTMLElement
  readonly form: HTMLFormElement
  readonly code: HTMLInputElement
}

/** The lists that the inspector shows of a resource, by their titles. */
const LISTS: readonly (readonly [string, (resource: DevResource) => readonly string[]])[] = [
  ['Exports', ({ exports }) => exports],
  ['Events', ({ events }) => events],
  ['NUI callbacks', ({ nuiCallbacks }) => nuiCallbacks],
  ['Commands', ({ commands }) => commands],
  ['Key mappings', ({ keyMappings }) => keyMappings],
  ['KVP', ({ kvp }) => kvp.map(({ key, value }) => `${key} = ${value}`)],
]

/** The value of the select of a process. */
const valueOf = (process: DevProcess) => String(process)

/**
 * The inspector: what the resources of a process have, the time their
 * scripts take, its convars, and a box that runs code in a resource, as
 * one of its scripts would, whose console tells what it gives.
 */
export class Inspector {
  readonly #host: InspectorHost
  readonly #elements: InspectorElements
  readonly #rows = new Map<string, HTMLButtonElement>()
  #last: DevInspection | undefined
  #chosen: string | undefined
  #detailsJson = ''
  #convarsJson = ''

  constructor(elements: InspectorElements, host: InspectorHost) {
    this.#elements = elements
    this.#host = host
    const { process, form, code, filter } = elements
    this.players([])
    process.addEventListener('change', () => {
      this.#last = undefined
      this.#inspect()
    })
    const remember = keepHistory(code)
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      if (code.value.trim() === '' || this.#chosen === undefined) return
      host.evaluate(this.#process, this.#chosen, code.value)
      remember(code.value)
      code.value = ''
    })
    filter.addEventListener('input', () => this.#filterConvars())
    setInterval(() => this.#inspect(), INTERVAL)
  }

  /** Takes the players whose processes can be inspected, keeping what it had chosen. */
  players(players: readonly DevPlayer[]): void {
    const { process } = this.#elements
    const chosen = process.value
    const options: (readonly [string, string])[] = [
      ['server', 'Server'],
      ...players
        .filter(({ state }) => state === 'joined')
        .map(({ client, name }) => [valueOf(client), name] as const),
    ]
    process.replaceChildren(
      ...options.map(([value, label]) => {
        const option = document.createElement('option')
        option.value = value
        option.textContent = label
        return option
      }),
    )
    process.value = options.some(([value]) => value === chosen) ? chosen : 'server'
  }

  /** Shows what a process has, if it is the one that is chosen. */
  show(inspection: DevInspection): void {
    if (inspection.process !== this.#process) return
    this.#showResources(inspection)
    this.#last = inspection
    this.#showDetails()
    const json = JSON.stringify(inspection.convars)
    if (json === this.#convarsJson) return
    this.#convarsJson = json
    this.#elements.convars.replaceChildren(
      ...inspection.convars.flatMap(({ name, value }) => {
        const term = document.createElement('dt')
        term.textContent = name
        const description = document.createElement('dd')
        description.textContent = value
        return [term, description]
      }),
    )
    this.#filterConvars()
  }

  get #process(): DevProcess {
    const { value } = this.#elements.process
    return value === 'server' ? value : Number(value)
  }

  #inspect(): void {
    if (!document.hidden) this.#host.inspect(this.#process)
  }

  /** Shows the resources, with the time each tick took them since it last showed them. */
  #showResources({ resources, ticks }: DevInspection): void {
    const list = this.#elements.resources
    const names = resources.map(({ name }) => name)
    if (names.join() !== [...this.#rows.keys()].join()) {
      this.#rows.clear()
      list.replaceChildren(...names.map((name) => this.#row(name)))
    }
    const before = this.#last
    for (const resource of resources) {
      const row = this.#rows.get(resource.name)!
      row.classList.toggle('stopped', resource.state !== 'started')
      row.classList.toggle('chosen', resource.name === this.#chosen)
      const old = before?.resources.find(({ name }) => name === resource.name)
      const elapsed = ticks - (before?.ticks ?? 0)
      if (old !== undefined && elapsed > 0) {
        row.lastElementChild!.textContent = `${((resource.cpu - old.cpu) / elapsed).toFixed(2)} ms`
      }
    }
  }

  #row(name: string): HTMLButtonElement {
    const row = document.createElement('button')
    row.type = 'button'
    const label = document.createElement('span')
    label.textContent = name
    row.append(label, document.createElement('span'))
    row.addEventListener('click', () => {
      this.#chosen = name
      for (const [other, element] of this.#rows) element.classList.toggle('chosen', other === name)
      this.#showDetails()
    })
    this.#rows.set(name, row)
    return row
  }

  #showDetails(): void {
    const resource = this.#last?.resources.find(({ name }) => name === this.#chosen)
    const { details, code } = this.#elements
    code.disabled = resource === undefined
    code.placeholder =
      resource === undefined
        ? 'Pick a resource to run code in it'
        : `Code to run in ${resource.name}, such as GetNumResources()`
    const json = JSON.stringify(resource && { ...resource, cpu: 0 })
    if (json === this.#detailsJson) return
    this.#detailsJson = json ?? ''
    if (resource === undefined) {
      details.textContent = 'Pick a resource'
      return
    }
    details.replaceChildren(
      ...LISTS.flatMap(([title, items]) => {
        const shown = items(resource)
        if (shown.length === 0) return []
        const heading = document.createElement('h3')
        heading.textContent = `${title} (${shown.length})`
        const list = document.createElement('ul')
        list.replaceChildren(
          ...shown.map((text) => {
            const item = document.createElement('li')
            item.textContent = text
            return item
          }),
        )
        return [heading, list]
      }),
    )
  }

  /** Hides the convars whose names do not have what the filter says. */
  #filterConvars(): void {
    const { convars, filter } = this.#elements
    const wanted = filter.value.trim().toLowerCase()
    for (const term of convars.querySelectorAll('dt')) {
      const hidden = !term.textContent.toLowerCase().includes(wanted)
      term.hidden = hidden
      ;(term.nextElementSibling as HTMLElement).hidden = hidden
    }
  }
}
