import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import type { FileSource } from '../core/engine/index.ts'
import { compareUtf8 } from '../core/libc.ts'
import { findTestFiles, openProject, type LocalProject } from '../node/project.ts'
import { watchProject } from '../node/watch.ts'
import { Coverage, runFile, type FileResult } from '../runner/index.ts'
import { junitReport } from './junit.ts'
import type { CliHost } from './main.ts'
import { Reporter } from './report.ts'

const USAGE = `Usage: fiverunner test [paths...]

Runs the tests of the project in this directory: the *.test.lua files in
the paths given, or in the whole project. The project is a resource when
the directory has an fxmanifest.lua or a __resource.lua, and a server when
it has a resources directory, whose server.cfg, if there is one, starts
the resources of the server.

Options:
  -w, --watch     Run the tests again as files of the project change, until Ctrl+C
  --junit <file>  Write a JUnit report of the tests to the file
  --coverage      Write the lines of Lua that the tests ran to coverage/lcov.info
  -h, --help      Show this help
`

/** Where the report of coverage goes, in the project. */
const LCOV = 'coverage/lcov.info'

/** What the options of the command ask of each run. */
interface Reports {
  readonly junit: string | undefined
  readonly coverage: boolean
}

/** What the arguments of the command ask for that the project does not have. */
class UsageError extends Error {}

/**
 * Runs the tests of the project in the directory that the tool runs in,
 * and again as its files change, when it watches, until it is interrupted,
 * and returns the exit code of the last run: 0 if they passed, 1 if any
 * failed, or if there were none, and 2 if the arguments make no sense to
 * it, or there is no project.
 */
export async function test(args: readonly string[], host: CliHost): Promise<number> {
  if (args.length === 1 && (args[0] === '-h' || args[0] === '--help')) {
    host.stdout(USAGE)
    return 0
  }
  const watching = args.some((arg) => arg === '-w' || arg === '--watch')
  const rest = args.filter((arg) => !['-w', '--watch', '--coverage'].includes(arg))
  const at = rest.indexOf('--junit')
  const junit = at === -1 ? undefined : rest[at + 1]
  if (at !== -1 && (junit === undefined || junit.startsWith('-'))) {
    host.stderr(`fiverunner: --junit needs a file\n\n${USAGE}`)
    return 2
  }
  const paths = at === -1 ? rest : rest.toSpliced(at, 2)
  const option = paths.find((arg) => arg.startsWith('-'))
  if (option !== undefined) {
    host.stderr(`fiverunner: unknown option ${option}\n\n${USAGE}`)
    return 2
  }
  const reports = { junit, coverage: args.includes('--coverage') }
  if (!watching) return runTests(paths, reports, host)
  const interrupted = host.interrupted().then(() => false)
  for (;;) {
    // What changes as the tests run runs them again too.
    let stop = () => {}
    const changed = new Promise<boolean>((resolve) => {
      stop = watchProject(host.cwd, () => resolve(true))
    })
    const code = await runTests(paths, reports, host)
    if (code === 2) {
      stop()
      return code
    }
    host.stdout('\nWatching the files of the project, until Ctrl+C\n')
    const again = await Promise.race([changed, interrupted])
    stop()
    if (!again) return code
    host.stdout('\nFiles changed: running the tests again\n\n')
  }
}

/** Runs the tests of the project in the directory that the tool runs in, in `paths`, as test does once. */
async function runTests(
  args: readonly string[],
  { junit, coverage }: Reports,
  host: CliHost,
): Promise<number> {
  const project = openProject(host.cwd)
  if (project === undefined) {
    host.stderr(
      'fiverunner: there is no FiveM project here: a resource has an fxmanifest.lua or a __resource.lua, and a server a resources directory\n',
    )
    return 2
  }
  let paths: string[]
  try {
    paths = testFiles(project, args, host.cwd)
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    host.stderr(`fiverunner: ${error.message}\n`)
    return 2
  }
  if (paths.length === 0) {
    host.stderr('fiverunner: there are no test files, whose names end in .test.lua\n')
    return 1
  }
  const start = host.now()
  const [cfxlua, sqlite, quickjs] = await Promise.all([
    host.cfxlua(),
    host.sqlite(),
    host.quickjs?.(),
  ])
  const reporter = new Reporter(host)
  const results: FileResult[] = []
  const lines = coverage ? new Coverage() : undefined
  for (const path of paths) {
    const result = await run(project, path, cfxlua, sqlite, quickjs, lines)
    results.push(result)
    reporter.file(result)
  }
  if (junit !== undefined) {
    const file = resolve(host.cwd, junit)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, junitReport(results))
  }
  const code = reporter.end(host.now() - start)
  if (lines !== undefined) {
    const file = join(host.cwd, LCOV)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, lines.lcov(project.mount))
    const { hit, found } = lines.totals
    const share = found === 0 ? 0 : (hit / found) * 100
    host.stdout(`Coverage: ${share.toFixed(1)}% of ${found} lines of Lua, in ${LCOV}\n`)
  }
  return code
}

/** Runs the test file at `path` in the project, which fails with what the runner threw, if it did. */
async function run(
  project: LocalProject,
  path: string,
  cfxlua: WebAssembly.Module,
  sqlite: WebAssembly.Module,
  quickjs: WebAssembly.Module | undefined,
  coverage: Coverage | undefined,
): Promise<FileResult> {
  try {
    return await runFile(
      { path, source: project.source.read(path) },
      {
        cfxlua,
        sqlite,
        project,
        ...(quickjs === undefined ? {} : { quickjs }),
        ...(coverage === undefined ? {} : { coverage }),
      },
    )
  } catch (error) {
    const message = `FiveRunner failed to run the file: ${error instanceof Error ? error.message : String(error)}`
    return { path, tests: [], failure: { message, frames: [] }, output: [] }
  }
}

/**
 * The test files in `paths`, which are relative to `cwd`, the directory
 * of the project, or in the whole project without paths, in the order of
 * their bytes.
 */
function testFiles(project: LocalProject, paths: readonly string[], cwd: string): string[] {
  const { source } = project
  if (paths.length === 0) return findTestFiles(source)
  const found = new Set<string>()
  for (const given of paths) {
    const path = relative(cwd, resolve(cwd, given)).split(sep).join('/')
    if (path === '..' || path.startsWith('../') || isAbsolute(path)) {
      throw new UsageError(`${given} is not in the project`)
    }
    const kind = kindOf(source, path)
    if (kind === undefined) throw new UsageError(`there is no ${given}`)
    if (kind === 'directory') {
      for (const file of findTestFiles(source, path)) found.add(file)
    } else if (path.endsWith('.test.lua')) {
      found.add(path)
    } else {
      throw new UsageError(`${given} is no test file, as the names of test files end in .test.lua`)
    }
  }
  return [...found].sort(compareUtf8)
}

/** Whether there is a file or a directory at `path` in a source, if there is anything. */
function kindOf(source: FileSource, path: string): 'file' | 'directory' | undefined {
  if (path === '') return 'directory'
  const slash = path.lastIndexOf('/')
  const parent = slash === -1 ? '' : path.slice(0, slash)
  if (kindOf(source, parent) !== 'directory') return undefined
  const entry = source.list(parent).find(({ name }) => name === path.slice(slash + 1))
  if (entry === undefined) return undefined
  return entry.directory ? 'directory' : 'file'
}
