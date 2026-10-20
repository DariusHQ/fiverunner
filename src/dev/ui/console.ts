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
    const element = document.createElement('div')
    element.className = `line kind-${line.kind}`
    const channel = document.createElement('span')
    channel.className = 'channel'
    channel.textContent = `[${line.channel}] `
    element.append(channel, ...colored(line.text))
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
