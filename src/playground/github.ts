/**
 * The repositories of GitHub that the playground runs, as its links name
 * them: ?gh=owner/repo, with a branch, a tag or a commit after @, and a
 * directory of it after a slash. The page reads them through GitHub's API
 * and its raw files, which pages of any origin may read, so the static site
 * needs no server of its own for them.
 */

/** A repository of GitHub, at a ref, and the directory of it that the playground runs. */
export interface Repository {
  readonly owner: string
  readonly name: string
  /** A branch, a tag or a commit, or HEAD for the default branch. */
  readonly ref: string
  /** The directory of the project in the repository, or '' for its root. */
  readonly path: string
}

/** The files of a directory of a repository, by their paths in it: text that is UTF-8, or bytes. */
export type RepositoryFiles = ReadonlyMap<string, string | Uint8Array>

/** What the playground runs of a link: a server, whose server.cfg starts what it loaded. */
export interface Project {
  /** The name of the project, as the dev UI shows it. */
  readonly name: string
  readonly files: Readonly<Record<string, string | Uint8Array>>
  /** The repositories that it loaded, that of the link first, as links name them. */
  readonly loaded: readonly string[]
  /** What its resources need that none of them has, and that the playground does not know where to find. */
  readonly missing: readonly string[]
  /** How many files it left out, as only the game reads them, or they are too big. */
  readonly left: number
  /** The resources whose pages are built from sources, which their repositories do not have. */
  readonly unbuilt: readonly string[]
}

/** A resource of a repository: the path of its directory in it, and its manifest. */
export interface FoundResource {
  readonly directory: string
  readonly manifest: string
}

/** The repositories that the playground loads for the resources that others need, by their names. */
export const KNOWN: Readonly<Record<string, string>> = {
  ox_lib: 'overextended/ox_lib',
  require: 'overextended/cfxlua-require',
  ox_target: 'overextended/ox_target',
  ox_inventory: 'overextended/ox_inventory',
  'qb-core': 'qbcore-fivem/qb-core',
  'qb-target': 'qbcore-fivem/qb-target',
  'qb-weapons': 'qbcore-fivem/qb-weapons',
  'qb-menu': 'qbcore-fivem/qb-menu',
  'qb-input': 'qbcore-fivem/qb-input',
  qbx_core: 'Qbox-project/qbx_core',
  qbx_vehicles: 'Qbox-project/qbx_vehicles',
  es_extended: 'esx-framework/esx_core/[core]/es_extended',
  esx_lib: 'esx-framework/esx_core/[core]/esx_lib',
  PolyZone: 'mkafrin/PolyZone',
}

/** What comes with a known repository that is no resource, such as the tables of ESX. */
const WITH: Readonly<Record<string, string>> = {
  'esx-framework/esx_core/[core]/es_extended': 'esx-framework/esx_core/[SQL]',
}

/**
 * What the playground puts where a resource has its page, when its
 * repository has the sources of the page but not its build: a page that
 * shows nothing, as scripts such as ox_lib's start only once it is there.
 */
const UNBUILT = `<!doctype html>
<meta charset="utf-8" />
<title>Not built</title>
<!-- FiveRunner's playground: this resource builds its page from sources, which its repository has, but not the page. -->
`

/** The names that ox_inventory knows the frameworks it runs with by, which txAdmin's recipes set it. */
const INVENTORY_FRAMEWORKS: Readonly<Record<string, string>> = {
  qbx_core: 'qbx',
  'qb-core': 'qb',
  es_extended: 'esx',
}

/**
 * What server.cfg says for the resources that it starts, by their names:
 * the commands that frameworks run, which the recipes of txAdmin let them
 * run, and that ox_lib keeps its advice to servers that let clients change
 * state bags, which a server in a page has no use for.
 */
const SETTINGS: Readonly<Record<string, readonly string[]>> = {
  'qb-core': ['add_ace resource.qb-core command allow'],
  es_extended: ['add_ace', 'add_principal', 'remove_principal', 'stop'].map(
    (command) => `add_ace resource.es_extended command.${command} allow`,
  ),
  ox_lib: ['set ox:ignoreSecurityAdvisory ["stateBagStrictMode"]'],
}

/** What the known resources need that their manifests do not say, such as the modules of others that their scripts require. */
const IMPLIED: Readonly<Record<string, readonly string[]>> = {
  qbx_core: ['ox_inventory', 'qbx_vehicles'],
  'qb-target': ['qb-core'],
  'qb-menu': ['qb-core'],
}

/** The frameworks of servers, by the names of their resources. */
const FRAMEWORKS: readonly string[] = ['qb-core', 'qbx_core', 'es_extended', 'ox_core', 'ND_Core']

/**
 * What scripts use through exports without their manifests saying so, in
 * groups of resources that do the same: a resource of a repository that the
 * playground does not know needs the one of a group that it uses. One that
 * uses several is a bridge, whose config picks one, so it needs none of them.
 */
const ALTERNATIVES: readonly (readonly string[])[] = [FRAMEWORKS, ['ox_target', 'qb-target']]

/** A use of the exports of a resource, exports['name'] or exports.name, with its name in the second or third group. */
const EXPORTS = /\bexports\s*(?:\[\s*(['"])([\w-]+)\1\s*\]|\.\s*([A-Za-z_]\w*))/g

/** What FiveRunner gives servers itself, which no repository needs to bring. */
const BUILT_IN: readonly string[] = ['oxmysql']

/** The repositories that a link loads at most, with those that it needs. */
const MAX_REPOSITORIES = 8
/** The files of a repository that the playground reads at most, and their bytes. */
const MAX_FILES = 4000
const MAX_BYTES = 60 * 1024 * 1024
/** A file bigger than this is an asset of the game, or a build that nothing runs here. */
const MAX_FILE = 8 * 1024 * 1024
/** The files that the playground reads at once. */
const READERS = 12

/** Files whose extensions say that they are text, which the editor shows if they are UTF-8. */
const TEXT = /\.(lua|js|mjs|cjs|ts|json|html?|css|cfg|sql|md|txt|xml|meta|ya?ml|svg|toml)$/i

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const NAME = /^[A-Za-z0-9._-]{1,100}$/
const REF = /^[A-Za-z0-9._-]{1,255}$/

/**
 * The repository that `spec` names, as owner/repo or owner/repo@ref, with a
 * directory after either, or as a URL of github.com, of its tree at a ref
 * too; or undefined if it names none. Refs with slashes are not names that
 * it takes.
 */
export function parseRepository(spec: string): Repository | undefined {
  let text = spec.trim().replace(/\/+$/, '')
  let ref = 'HEAD'
  const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.*)$/i.exec(text)
  if (url !== null) {
    const [owner = '', name = '', kind, at, ...rest] = url[1]!.split('/')
    if (kind !== undefined && (kind !== 'tree' || at === undefined)) return undefined
    if (name.includes('@')) return undefined
    text = [owner, name.replace(/\.git$/, ''), ...rest].join('/')
    if (at !== undefined) ref = decodeURIComponent(at)
  }
  const [owner = '', named = '', ...rest] = text.split('/')
  let name = named
  const sign = name.indexOf('@')
  if (sign !== -1) {
    ref = name.slice(sign + 1)
    name = name.slice(0, sign)
  }
  if (!OWNER.test(owner) || !NAME.test(name) || name === '.' || name === '..') return undefined
  if (!REF.test(ref)) return undefined
  let parts: string[]
  try {
    parts = rest.map((part) => decodeURIComponent(part))
  } catch {
    return undefined
  }
  if (parts.some((part) => part === '' || part === '.' || part === '..' || /[\\\0]/.test(part))) {
    return undefined
  }
  return { owner, name, ref, path: parts.join('/') }
}

/** How links name a repository: owner/repo, @ and its ref unless that is HEAD, and its directory. */
export function formatRepository({ owner, name, ref, path }: Repository): string {
  return `${owner}/${name}${ref === 'HEAD' ? '' : `@${ref}`}${path === '' ? '' : `/${path}`}`
}

/**
 * Why the playground leaves a file of a repository out, by its path in the
 * directory that it loads and its size, or undefined if it keeps it: what is
 * hidden, such as .git, .github and the keys of asset escrow, node_modules,
 * what only the game streams, and files too big to be anything that runs.
 */
export function leftOut(path: string, size: number): string | undefined {
  const parts = path.split('/')
  if (parts.some((part) => part.startsWith('.') || part === 'node_modules')) return 'hidden'
  if (parts.slice(0, -1).some((part) => part.toLowerCase() === 'stream')) return 'streamed'
  if (size > MAX_FILE) return 'too big'
  return undefined
}

/** The text of `bytes` if the path of their file says that it is text and they are UTF-8, or else the bytes. */
export function decodeFile(path: string, bytes: Uint8Array): string | Uint8Array {
  if (!TEXT.test(path)) return bytes
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return bytes
  }
}

/** The strings of the entries `key` of a manifest, whether a string or a table of them follows the key. */
function entriesOf(manifest: string, key: string): string[] {
  const found: string[] = []
  const entry = new RegExp(
    `(?:^|[\\s;(])${key}\\s*\\(?\\s*(\\{[^}]*\\}|'[^'\\n]*'|"[^"\\n]*")`,
    'gm',
  )
  for (const [, value = ''] of manifest.matchAll(entry)) {
    for (const [, , text = ''] of value.matchAll(/(['"])(.*?)\1/g)) found.push(text)
  }
  return found
}

/** Lua without its comments. */
// shortcut: a string with -- in it loses the rest of its line, which costs at most an entry or an export unseen.
const withoutComments = (lua: string) =>
  lua.replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, '').replace(/--[^\n]*/g, '')

/**
 * What a manifest says of its resource: the resources that it needs, by its
 * dependencies and the scripts of others that it loads, @name/file, the
 * names that it provides, and the path of its page, if it has one of its
 * own files.
 */
export function readManifest(manifest: string): {
  needs: string[]
  provides: string[]
  page?: string
} {
  const text = withoutComments(manifest)
  const needs = [...entriesOf(text, 'dependency'), ...entriesOf(text, 'dependencies')]
    .filter((need) => !need.startsWith('/'))
    .map((need) => need.split(/[\s:]/)[0]!)
  for (const [, name = ''] of text.matchAll(/['"]@([^/'"\s]+)\//g)) needs.push(name)
  const page = entriesOf(text, 'ui_page')[0]?.replace(/^(\.?\/)+/, '')
  return {
    needs: [...new Set(needs)],
    provides: entriesOf(text, 'provide'),
    ...(page === undefined || page === '' || /^[a-z]+:/i.test(page) ? {} : { page }),
  }
}

/** The entries of manifests that name the files of their resources that run, or that their scripts load. */
const RUN = ['client_script', 'server_script', 'shared_script', 'file'].flatMap((key) => [
  key,
  `${key}s`,
])

/** What the paths that a glob of a manifest names match: * in a directory, ** across them. */
function globPattern(glob: string): RegExp {
  const source = glob
    .replace(/^(\.?\/)+/, '')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\/|\*\*|\*|\?/g, (wild) =>
      wild === '**/' ? '(?:.*/)?' : wild === '**' ? '.*' : wild === '*' ? '[^/]*' : '[^/]',
    )
  return new RegExp(`^${source}$`)
}

/**
 * What of ALTERNATIVES a resource needs, by what its manifest says that it
 * needs, `needs`, and the exports that the Lua files that it names use, which
 * leaves out examples and addons that nothing runs.
 */
function alternativesNeeded(
  files: RepositoryFiles,
  directory: string,
  manifest: string,
  needs: readonly string[],
): string[] {
  const text = withoutComments(manifest)
  const runs = RUN.flatMap((key) => entriesOf(text, key))
    .filter((entry) => !entry.startsWith('@'))
    .map(globPattern)
  const prefix = directory === '' ? '' : `${directory}/`
  const used = new Set(needs)
  for (const [path, data] of files) {
    if (typeof data !== 'string' || !path.startsWith(prefix) || !/\.lua$/i.test(path)) continue
    const own = path.slice(prefix.length)
    if (!runs.some((pattern) => pattern.test(own))) continue
    for (const [, , quoted, dotted] of withoutComments(data).matchAll(EXPORTS)) {
      used.add(quoted ?? dotted!)
    }
  }
  // qbx_core provides qb-core, whose exports the scripts of Qbox use too.
  if (used.has('qbx_core')) used.delete('qb-core')
  return ALTERNATIVES.flatMap((group) => {
    const members = group.filter((name) => used.has(name))
    return members.length === 1 ? members : []
  })
}

/**
 * The resources of a directory of a repository, as FiveM scans one: those
 * at the root, in directories with a manifest, or in the categories in it,
 * [name], by their names.
 */
function scanResources(files: RepositoryFiles, base: string): Map<string, FoundResource> {
  const found = new Map<string, FoundResource>()
  const prefix = base === '' ? '' : `${base}/`
  for (const [path, data] of files) {
    if (!path.startsWith(prefix)) continue
    const parts = path.slice(prefix.length).split('/')
    const file = parts.pop()!
    const name = parts.pop()
    if (name === undefined || name.startsWith('[') || !parts.every((part) => /^\[.*\]$/.test(part)))
      continue
    // fxmanifest.lua comes before __resource.lua, as FiveM reads it first.
    if (
      file !== 'fxmanifest.lua' &&
      (file !== '__resource.lua' || files.has(`${path.slice(0, -file.length)}fxmanifest.lua`))
    )
      continue
    found.set(name, {
      directory: path.slice(0, -file.length - 1),
      manifest: typeof data === 'string' ? data : new TextDecoder().decode(data),
    })
  }
  return found
}

/** The name of a resource by the path of its directory, or of a repository at its root. */
const lastPart = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/**
 * Where the files of a repository go in a server, and its resources, with
 * their manifests: a resource at the root of the directory goes to
 * resources/ and the name of its directory, which is that of the
 * repository at its root; a server, with a resources directory, keeps its
 * paths; and a directory of resources goes to resources/ as it is.
 */
export function placeRepository(
  repository: Repository,
  files: RepositoryFiles,
): {
  kind: 'resource' | 'server' | 'resources'
  at: string
  resources: Map<string, FoundResource>
} {
  const manifest = files.get('fxmanifest.lua') ?? files.get('__resource.lua')
  if (manifest !== undefined) {
    const name = repository.path === '' ? repository.name : lastPart(repository.path)
    const text = typeof manifest === 'string' ? manifest : new TextDecoder().decode(manifest)
    const found = new Map([[name, { directory: '', manifest: text }]])
    return { kind: 'resource', at: `resources/${name}`, resources: found }
  }
  if ([...files.keys()].some((path) => path.startsWith('resources/'))) {
    return { kind: 'server', at: '', resources: scanResources(files, 'resources') }
  }
  return { kind: 'resources', at: 'resources', resources: scanResources(files, '') }
}

/** A failure to load a repository, with what tells its visitor why. */
export class RepositoryError extends Error {}

/** What reads URLs, which tests give in place of fetch. */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

/** The path of a file in a URL, each of its parts encoded. */
const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

/**
 * Reads the files of a directory of a repository: its tree at its ref, of
 * GitHub's API, then each file that it keeps, raw, a few at once, telling
 * `progress` as it goes: its manifests first, as the sources of the pages
 * that they name, which the repository does not have built, run nothing
 * and are left out. Returns them, by their paths in the directory, with how
 * many files it left out.
 */
export async function readRepository(
  repository: Repository,
  progress: (read: number, of: number) => void,
  request: Fetcher = fetch,
): Promise<{ files: Map<string, string | Uint8Array>; left: number }> {
  const { owner, name, ref, path } = repository
  const label = formatRepository(repository)
  let response: Response
  try {
    response = await request(
      `https://api.github.com/repos/${owner}/${name}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
      { headers: { Accept: 'application/vnd.github+json' } },
    )
  } catch {
    throw new RepositoryError(`GitHub could not be reached for ${label}.`)
  }
  if (!response.ok && response.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(response.headers.get('x-ratelimit-reset') ?? 0) * 1000
    const minutes = Math.max(1, Math.ceil((reset - Date.now()) / 60000))
    throw new RepositoryError(
      `GitHub lets a visitor list 60 repositories an hour without signing in, and this hour's are used: try again in ${minutes} minutes.`,
    )
  }
  if (response.status === 404 || response.status === 409 || response.status === 422) {
    throw new RepositoryError(
      `GitHub has no public repository ${owner}/${name} with ${ref === 'HEAD' ? 'files on its default branch' : `the ref ${ref}`}.`,
    )
  }
  if (!response.ok) throw new RepositoryError(`GitHub answered ${response.status} for ${label}.`)
  const tree = (await response.json()) as {
    truncated?: boolean
    tree?: { path: string; type: string; size?: number }[]
  }
  if (tree.truncated === true || tree.tree === undefined) {
    throw new RepositoryError(
      `${owner}/${name} has more files than GitHub lists at once: link to the directory of a resource in it.`,
    )
  }
  const prefix = path === '' ? '' : `${path}/`
  const wanted: string[] = []
  /** The files that the tree says are empty, which need no request. */
  const empty = new Set<string>()
  let left = 0
  let bytes = 0
  for (const entry of tree.tree) {
    if (entry.type !== 'blob' || !entry.path.startsWith(prefix)) continue
    const relative = entry.path.slice(prefix.length)
    if (leftOut(relative, entry.size ?? 0) !== undefined) {
      left++
      continue
    }
    wanted.push(relative)
    if (entry.size === 0) empty.add(relative)
    bytes += entry.size ?? 0
  }
  if (wanted.length === 0)
    throw new RepositoryError(`${label} has no files that the playground runs.`)
  if (wanted.length > MAX_FILES || bytes > MAX_BYTES) {
    throw new RepositoryError(
      `${label} has ${wanted.length} files, of ${Math.round(bytes / 1048576)} MB, more than the playground reads: link to the directory of a resource in it.`,
    )
  }
  const files = new Map<string, string | Uint8Array>()
  let total = wanted.length
  let failed = false
  const readAll = async (list: readonly string[]) => {
    let next = 0
    const reader = async () => {
      while (next < list.length && !failed) {
        const file = list[next++]!
        if (empty.has(file)) {
          files.set(file, decodeFile(file, new Uint8Array()))
          progress(files.size, total)
          continue
        }
        const url = `https://raw.githubusercontent.com/${owner}/${name}/${encodeURIComponent(ref)}/${encodePath(prefix + file)}`
        let got: Response
        try {
          got = await request(url)
        } catch {
          throw new RepositoryError(`GitHub could not be reached for ${file} of ${label}.`)
        }
        if (!got.ok) {
          throw new RepositoryError(`GitHub answered ${got.status} for ${file} of ${label}.`)
        }
        files.set(file, decodeFile(file, new Uint8Array(await got.arrayBuffer())))
        if (!failed) progress(files.size, total)
      }
    }
    await Promise.all(Array.from({ length: Math.min(READERS, list.length) }, reader)).catch(
      (error: unknown) => {
        // The reads still under way take no more files, and tell nothing that would hide why this failed.
        failed = true
        throw error
      },
    )
  }
  progress(0, total)
  const manifests = wanted.filter((file) => /(^|\/)(fxmanifest|__resource)\.lua$/.test(file))
  await readAll(manifests)
  const has = new Set(wanted)
  const unbuilt: string[] = []
  for (const manifest of manifests) {
    const directory = manifest.includes('/') ? manifest.slice(0, manifest.lastIndexOf('/') + 1) : ''
    const data = files.get(manifest)!
    const { page } = readManifest(typeof data === 'string' ? data : new TextDecoder().decode(data))
    if (page !== undefined && page.includes('/') && !has.has(directory + page)) {
      unbuilt.push(`${directory}${page.slice(0, page.indexOf('/') + 1)}`)
    }
  }
  const rest = wanted.filter(
    (file) => !manifests.includes(file) && !unbuilt.some((sources) => file.startsWith(sources)),
  )
  left += wanted.length - manifests.length - rest.length
  total = manifests.length + rest.length
  await readAll(rest)
  // In the order of the tree, whatever order the files came in.
  const kept = wanted.filter((file) => files.has(file))
  return { files: new Map(kept.map((file) => [file, files.get(file)!])), left }
}

/**
 * Loads the repository of a link, those that it names besides, `also`, and
 * those of the resources that their resources need, which the playground
 * knows of, then lays them out as a server: the files of each, and a
 * server.cfg that starts them, the needed ones first, unless the repository
 * of the link is a server with one of its own, which needs nothing else.
 */
export async function loadProject(
  main: Repository,
  also: readonly Repository[],
  progress: (label: string, read: number, of: number) => void,
  request: Fetcher = fetch,
): Promise<Project> {
  const files: Record<string, string | Uint8Array> = {}
  const names = new Set<string>(BUILT_IN)
  const needs = new Set<string>()
  const loaded: string[] = []
  /** The resources that the server starts, in the order they were loaded, with what each needs. */
  const started = new Map<string, readonly string[]>()
  /** The resource that has each name: its own, or one that it provides. */
  const providers = new Map<string, string>()
  const unbuilt: string[] = []
  let own = false
  let left = 0

  const load = async (repository: Repository): Promise<void> => {
    const label = formatRepository(repository)
    if (loaded.includes(label)) return
    if (loaded.length === MAX_REPOSITORIES) {
      throw new RepositoryError(
        `The playground loads ${MAX_REPOSITORIES} repositories at most for a link.`,
      )
    }
    const read = await readRepository(repository, (done, of) => progress(label, done, of), request)
    const known = Object.values(KNOWN).includes(formatRepository({ ...repository, ref: 'HEAD' }))
    loaded.push(label)
    left += read.left
    const placed = placeRepository(repository, read.files)
    if (repository === main && placed.kind === 'server') own = read.files.has('server.cfg')
    else if (repository === main && placed.resources.size === 0) {
      throw new RepositoryError(
        `${label} has no FiveM resource: no fxmanifest.lua or __resource.lua, and no resources directory.`,
      )
    }
    for (const [path, data] of read.files) {
      const target = placed.at === '' ? path : `${placed.at}/${path}`
      if (Object.hasOwn(files, target)) {
        throw new RepositoryError(`${label} has ${target}, which another repository has too.`)
      }
      files[target] = data
    }
    const place = (path: string) => (placed.at === '' ? path : `${placed.at}/${path}`)
    for (const [name, { directory, manifest }] of placed.resources) {
      const { needs: needed, provides, page } = readManifest(manifest)
      const all = [
        ...needed,
        ...(IMPLIED[name] ?? []),
        ...(known ? [] : alternativesNeeded(read.files, directory, manifest, needed)),
      ]
      for (const need of all) needs.add(need)
      started.set(name, all)
      for (const provided of [name, ...provides]) {
        names.add(provided)
        if (!providers.has(provided)) providers.set(provided, name)
      }
      const at = page === undefined ? undefined : directory === '' ? page : `${directory}/${page}`
      if (at !== undefined && !read.files.has(at)) {
        files[place(at)] = UNBUILT
        unbuilt.push(name)
      }
    }
    const extra = WITH[label]
    if (extra !== undefined) await load(parseRepository(extra)!)
  }

  /** The repositories of what the resources loaded need, which the playground knows of and has not loaded. */
  const stillNeeded = () =>
    [...needs]
      .sort()
      .filter((need) => !names.has(need) && KNOWN[need] !== undefined)
      .map((need) => parseRepository(KNOWN[need]!)!)
      .filter((repository) => !loaded.includes(formatRepository(repository)))
  let pending: readonly Repository[] = [main, ...also]
  while (pending.length > 0) {
    for (const repository of pending) await load(repository)
    // A server brings what it needs; what other links need comes in rounds, as the resources loaded need more.
    pending = own ? [] : stillNeeded()
    if (
      pending.length === 0 &&
      !own &&
      names.has('ox_inventory') &&
      !FRAMEWORKS.some((name) => names.has(name) || needs.has(name))
    ) {
      // With no framework, ox_inventory takes ESX's bridge and fails on its tables: it runs with Qbox's, as in Qbox's recipe.
      needs.add('qbx_core')
      pending = stillNeeded()
    }
  }
  if (!own) {
    const ensured = startOrder(started, providers)
    const framework = Object.keys(INVENTORY_FRAMEWORKS).find((name) => names.has(name))
    files['server.cfg'] = [
      `# Written by the playground for ${loaded[0]}: it starts what it loaded, what the rest needs first.`,
      // Frameworks look for the name of their database in it, as on servers.
      ...(needs.has('oxmysql')
        ? ['set mysql_connection_string "mysql://root@localhost/fiverunner"', 'ensure oxmysql']
        : []),
      ...(names.has('ox_inventory') && framework !== undefined
        ? [`setr inventory:framework "${INVENTORY_FRAMEWORKS[framework]}"`]
        : []),
      ...ensured.flatMap((name) => SETTINGS[name] ?? []),
      ...ensured.map((name) => `ensure "${name}"`),
      '',
    ].join('\n')
  }
  return {
    name: main.path === '' ? main.name : lastPart(main.path),
    // In the order of their paths, as the editor lists them.
    files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
    loaded,
    missing: [...needs].filter((need) => !names.has(need)).sort(),
    left,
    unbuilt,
  }
}

/**
 * The resources in an order that starts each after what it needs, as
 * scripts that load others' with @name/file need those started, whether
 * their manifests say so or not: depth first, in the order they were loaded.
 */
function startOrder(
  started: ReadonlyMap<string, readonly string[]>,
  providers: ReadonlyMap<string, string>,
): string[] {
  const order: string[] = []
  const seen = new Set<string>()
  const visit = (name: string) => {
    if (seen.has(name)) return
    seen.add(name)
    for (const need of started.get(name) ?? []) {
      const provider = providers.get(need)
      if (provider !== undefined) visit(provider)
    }
    order.push(name)
  }
  for (const name of started.keys()) visit(name)
  return order
}

/** The Markdown of a badge for the README of a repository, which opens it in the playground at `base`. */
export function badgeMarkdown(repository: Repository, base: string): string {
  const link = new URL(`?gh=${encodeURI(formatRepository(repository))}`, base)
  return `[![Run in FiveRunner](${new URL('badge.svg', base).href})](${link.href})`
}
