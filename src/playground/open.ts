/**
 * What the playground shows of its links to repositories of GitHub: what a
 * link would run, which it runs once its visitor says so, how loading it
 * goes, and, once it runs, what it loaded, with a badge for its README.
 */
import {
  badgeMarkdown,
  formatRepository,
  loadProject,
  parseRepository,
  RepositoryError,
  type Project,
  type Repository,
} from './github.ts'

/** The repositories that a link names: gh, and with, a list split by commas. */
export interface Link {
  readonly main: Repository
  readonly also: readonly Repository[]
}

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = '',
  className = '',
): HTMLElementTagNameMap[K] => {
  const made = document.createElement(tag)
  made.textContent = text
  if (className !== '') made.className = className
  return made
}

/** The link to `repository` on github.com, at its ref and directory. */
function githubLink({ owner, name, ref, path }: Repository, text: string): HTMLAnchorElement {
  const link = element('a', text)
  const at = ref === 'HEAD' && path === '' ? '' : `/tree/${encodeURIComponent(ref)}/${path}`
  link.href = `https://github.com/${owner}/${name}${at.replace(/\/$/, '')}`
  link.target = '_blank'
  link.rel = 'noopener'
  return link
}

/** The link of the page, if its parameters name repositories, or why they name none that it takes. */
export function readLink(params: URLSearchParams): Link | { readonly problem: string } | undefined {
  const spec = params.get('gh')
  if (spec === null) return undefined
  const main = parseRepository(spec)
  if (main === undefined) return { problem: `This link names no repository of GitHub: ${spec}.` }
  const also: Repository[] = []
  for (const other of (params.get('with') ?? '').split(',').filter((part) => part.trim() !== '')) {
    const repository = parseRepository(other)
    if (repository === undefined)
      return { problem: `This link names no repository of GitHub: ${other}.` }
    also.push(repository)
  }
  return { main, also }
}

/** A card at the start of `parent`, as the playground shows what a link would run. */
function card(parent: HTMLElement, title: string, text: string): HTMLElement {
  const shown = element('section', '', 'gate')
  shown.append(element('h2', title), element('p', text))
  parent.prepend(shown)
  document.getElementById('status')!.textContent = 'Waiting'
  return shown
}

const back = () => {
  const link = element('a', 'Back to the city')
  link.href = './'
  return link
}

/** Tells the visitor why the link runs nothing. */
export function showProblem(parent: HTMLElement, problem: string): void {
  const shown = card(
    parent,
    'Nothing to run',
    `${problem} Links name them as owner/repo, with @ and a branch or a tag, and the directory of a resource after a slash, such as overextended/ox_target.`,
  )
  const actions = element('div', '', 'actions')
  actions.append(back())
  shown.append(actions)
}

/**
 * Asks the visitor whether to run what `link` names, in `parent`, then
 * loads it, telling them how it goes, and resolves with its project. A
 * failure says why, and lets them try again.
 */
export function confirmAndLoad(parent: HTMLElement, link: Link): Promise<Project> {
  const names = [link.main, ...link.also].map(formatRepository)
  const shown = card(
    parent,
    `Run ${names[0]}`,
    `FiveRunner runs the scripts of ${names.join(', ')} in this page, and the pages of their NUI in frames of it, with the resources that they need, from GitHub. Run only repositories that you trust.`,
  )
  const actions = element('div', '', 'actions')
  const run = element('button', 'Run')
  run.type = 'button'
  actions.append(run, back())
  const status = element('p', '', 'status')
  status.setAttribute('role', 'status')
  shown.append(actions, status)
  return new Promise((resolve) => {
    run.addEventListener('click', async () => {
      run.disabled = true
      status.classList.remove('error')
      try {
        const project = await loadProject(link.main, link.also, (label, read, of) => {
          status.textContent = `Reading ${label} from GitHub: ${read} of ${of} files`
        })
        shown.remove()
        resolve(project)
      } catch (error) {
        status.textContent =
          error instanceof RepositoryError ? error.message : `Loading failed: ${String(error)}`
        status.classList.add('error')
        run.disabled = false
        run.textContent = 'Try again'
      }
    })
  })
}

/** What the toolbar of the editor says of the city. */
export function aboutCity(): Node[] {
  const hint = element(
    'span',
    'A small city, running in this page: connect a player, answer the card, and walk with W, A, S and D. Edit its files, then press Run. ',
    'hint',
  )
  const link = element('a', 'FiveRunner on GitHub')
  link.href = 'https://github.com/DariusHQ/fiverunner'
  hint.append(link)
  return [hint]
}

/** What the toolbar of the editor says of a project of a link: what it loaded, with a button that copies a badge of it. */
export function aboutProject(project: Project, link: Link, base: string): Node[] {
  const [first = '', ...others] = project.loaded
  const hint = element('span', '', 'hint')
  hint.append(githubLink(link.main, first), ' from GitHub')
  if (others.length > 0) hint.append(`, with ${others.join(', ')}`)
  hint.append('. ')
  if (project.left > 0) {
    hint.append(
      `It left out ${project.left} ${project.left === 1 ? 'file' : 'files'} that nothing runs here: what only the game or git reads, and the sources of pages that are not built. `,
    )
  }
  if (project.unbuilt.length > 0) {
    hint.append(
      `The pages of ${project.unbuilt.join(', ')} are built from sources, which their repositories do not have, so they show nothing here. `,
    )
  }
  if (project.missing.length > 0) {
    hint.append(
      `Nothing here has ${project.missing.join(', ')}, which its resources need: add them to the link with &with=owner/repo. `,
    )
  }
  hint.append('Connect a player to run its client scripts and their pages. ')
  const copy = element('button', 'Copy a badge for its README')
  copy.type = 'button'
  copy.addEventListener('click', async () => {
    const markdown = badgeMarkdown(link.main, base)
    try {
      await navigator.clipboard.writeText(markdown)
      copy.textContent = 'Copied'
      setTimeout(() => (copy.textContent = 'Copy a badge for its README'), 2000)
    } catch {
      prompt('The Markdown of the badge', markdown)
    }
  })
  return [hint, copy]
}

/** A form that opens a repository of GitHub in the playground. */
export function openForm(): HTMLFormElement {
  const form = element('form', '', 'open')
  const input = element('input')
  input.placeholder = 'owner/repo'
  input.ariaLabel = 'A repository of GitHub to open'
  input.autocomplete = 'off'
  input.spellcheck = false
  const button = element('button', 'Open')
  form.append(input, button)
  input.addEventListener('input', () => input.setCustomValidity(''))
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const repository = parseRepository(input.value)
    if (repository === undefined) {
      input.setCustomValidity('A repository of GitHub, such as overextended/ox_target')
      input.reportValidity()
      return
    }
    location.search = `?gh=${encodeURI(formatRepository(repository))}`
  })
  return form
}
