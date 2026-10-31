/**
 * The editor of the playground: the files of its project, which the next
 * run takes as they are, with a box that shows the one picked.
 */
export class Editor {
  readonly #original: Readonly<Record<string, string>>
  #files: Record<string, string>
  #open: string
  readonly #list = document.createElement('nav')
  readonly #text = document.createElement('textarea')

  /** Shows the editor at the start of `parent`, with `files`, the first of them open, and has `run` run them. */
  constructor(parent: HTMLElement, files: Readonly<Record<string, string>>, run: () => void) {
    this.#original = files
    this.#files = { ...files }
    this.#open = Object.keys(files)[0] ?? ''
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
    const hint = document.createElement('span')
    hint.className = 'hint'
    hint.textContent =
      'A small city, running in this page: connect a player, answer the card, and walk with W, A, S and D. Edit its files, then press Run. '
    const link = document.createElement('a')
    link.href = 'https://github.com/DariusHQ/fiverunner'
    link.textContent = 'FiveRunner on GitHub'
    hint.append(link)
    toolbar.append(title, runButton, reset, hint)
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
    this.#list.replaceChildren(...Object.keys(files).map((path) => this.#entry(path)))
    this.#show(this.#open)
  }

  /** The files as they are now. */
  get files(): Readonly<Record<string, string>> {
    return this.#files
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
