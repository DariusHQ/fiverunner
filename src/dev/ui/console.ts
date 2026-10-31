import type { OutputLine } from '../../runner/output.ts'

/** The colors that the codes ^0 to ^9 give the text after them, by their digits: the default for ^0 and ^7. */
const COLORS = ['', 'red', 'green', 'yellow', 'blue', 'cyan', 'magenta', '', 'orange', 'gray']

/** How many lines a console keeps, dropping the oldest. */
const LIMIT = 2000

/** A console of the dev UI, which shows lines of output with the colors of their codes. */
export class Console {
  readonly element: HTMLElement

  constructor(element: HTMLElement) {
    this.element = element
  }

  /** Shows `line`, keeping the view at the end if it was there. */
  add(line: OutputLine): void {
    this.entry(line.channel, line.text, `kind-${line.kind}`)
  }

  /** Shows `text` on `channel`, with the colors of its codes, as a line of the class `kind`. */
  entry(channel: string, text: string, kind: string): void {
    const element = document.createElement('div')
    element.className = `line ${kind}`
    const label = document.createElement('span')
    label.className = 'channel'
    label.textContent = `[${channel}] `
    element.append(label, ...colored(text))
    this.#append(element)
  }

  /** Shows a note of the dev UI, such as that the session started anew. */
  note(text: string): void {
    const element = document.createElement('div')
    element.className = 'line note'
    element.textContent = text
    this.#append(element)
  }

  #append(element: HTMLElement): void {
    const { element: view } = this
    const atEnd = view.scrollHeight - view.scrollTop - view.clientHeight < 4
    view.append(element)
    while (view.childElementCount > LIMIT) view.firstElementChild!.remove()
    if (atEnd) view.scrollTop = view.scrollHeight
  }
}

/** Has the arrow keys go back through the lines of `input`, and gives what remembers a line that ran. */
export function keepHistory(input: HTMLInputElement): (line: string) => void {
  const lines: string[] = []
  let at = 0
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    at = Math.max(0, Math.min(lines.length, at + (event.key === 'ArrowUp' ? -1 : 1)))
    input.value = lines[at] ?? ''
  })
  return (line) => {
    lines.push(line)
    at = lines.length
  }
}

/** The pieces of `text`, colored as its codes say. */
function colored(text: string): HTMLElement[] {
  const pieces: HTMLElement[] = []
  let color = ''
  for (const [index, part] of text.split(/\^(\d)/).entries()) {
    if (index % 2 === 1) {
      color = COLORS[Number(part)] ?? ''
    } else if (part !== '') {
      const piece = document.createElement('span')
      if (color !== '') piece.className = `color-${color}`
      piece.textContent = part
      pieces.push(piece)
    }
  }
  return pieces
}
