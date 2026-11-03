/**
 * The editor of the playground: the files of its project, which the next
 * run takes as they are, with a box that shows the one picked. Files that
 * are bytes, such as the pictures of pages, go with the rest, unshown.
 */
export class Editor {
  readonly #original: Readonly<Record<string, string>>
  readonly #bytes: Readonly<Record<string, Uint8Array>>
  #files: Record<string, string>
  #open: string
  readonly #list = document.createElement('nav')
  readonly #text = document.createElement('textarea')

  /**
   * Shows the editor at the start of `parent`, with `files`, the first that
   * is text open, `tools` in its toolbar after its buttons, and has `run`
   * run them.
   */
  constructor(
    parent: HTMLElement,
    files: Readonly<Record<string, string | Uint8Array>>,
    tools: readonly Node[],
    run: () => void,
  ) {
    const entries = Object.entries(files)
    this.#original = Object.fromEntries(
      entries.filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
    this.#bytes = Object.fromEntries(
      entries.filter((entry): entry is [string, Uint8Array] => typeof entry[1] !== 'string'),
    )
    this.#files = { ...this.#original }
    this.#open = Object.keys(this.#original)[0] ?? ''
    const section = document.createElement('section')
    section.className = 'editor'
    const toolbar = document.createElement('div')
    toolbar.className = 'toolbar'
    const title = document.createElement('h2')
    title.textContent = 'Files'
    const runButton = document.createElement('button')
    runButton.id = 'run'
    runButton.textContent = 'Run'
    runButton.addEventListener('click', run)
    const reset = document.createElement('button')
    reset.textContent = 'Reset'
    reset.addEventListener('click', () => {
      this.#files = { ...this.#original }
      this.#show(this.#open)
      run()
    })
    toolbar.append(title, runButton, reset, ...tools)
    this.#text.spellcheck = false
    this.#text.ariaLabel = 'The file'
    this.#text.addEventListener('input', () => {
      this.#files[this.#open] = this.#text.value
    })
    const columns = document.createElement('div')
    columns.className = 'columns'
    columns.append(this.#list, this.#text)
    section.append(toolbar, columns)
    parent.prepend(section)
    this.#list.replaceChildren(...Object.keys(this.#original).map((path) => this.#entry(path)))
    this.#show(this.#open)
  }

  /** The files as they are now, those of bytes too. */
  get files(): Readonly<Record<string, string | Uint8Array>> {
    return { ...this.#bytes, ...this.#files }
  }

  #entry(path: string): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = path.replace(/^resources\//, '')
    button.dataset.path = path
    button.addEventListener('click', () => this.#show(path))
    return button
  }

  #show(path: string): void {
    this.#open = path
    this.#text.value = this.#files[path] ?? ''
    for (const button of this.#list.querySelectorAll('button')) {
      button.classList.toggle('chosen', button.dataset.path === path)
    }
  }
}
