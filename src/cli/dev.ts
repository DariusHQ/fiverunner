import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_PORT, startDevServer } from '../node/devserver.ts'
import { openProject } from '../node/project.ts'
import type { CliHost } from './main.ts'

const USAGE = `Usage: fiverunner dev [options]

Runs the project in this directory in the dev UI, in the browser: its
server, with its console and its resources, and players that connect to
it, each with a screen that shows the frames of its NUI. The dev UI runs
the project anew as its files change. It needs a browser that takes the
names under localhost for the local machine, as Chrome, Edge and Firefox do.

Options:
  -p, --port <port>  Listen on this port, or the next free one (${DEFAULT_PORT} by default)
  -h, --help         Show this help
`

/**
 * Runs the dev server of the project in the directory that the tool runs
 * in until the tool is interrupted, and returns the exit code: 0 once it
 * stopped, and 2 if the arguments make no sense to it, or there is no
 * project.
 */
export async function dev(args: readonly string[], host: CliHost): Promise<number> {
  if (args.length === 1 && (args[0] === '-h' || args[0] === '--help')) {
    host.stdout(USAGE)
    return 0
  }
  const fail = (why: string) => {
    host.stderr(`fiverunner: ${why}\n\n${USAGE}`)
    return 2
  }
  let port = DEFAULT_PORT
  for (let at = 0; at < args.length; at++) {
    const arg = args[at]!
    if (arg !== '-p' && arg !== '--port') return fail(`unknown argument ${arg}`)
    const value = args[++at]
    if (value === undefined || !/^\d{1,5}$/.test(value) || Number(value) > 65535) {
      return fail(`${arg} needs a port, from 0 to 65535`)
    }
    port = Number(value)
  }
  const project = openProject(host.cwd)
  if (project === undefined) {
    host.stderr(
      'fiverunner: there is no FiveM project here: a resource has an fxmanifest.lua or a __resource.lua, and a server a resources directory\n',
    )
    return 2
  }
  if (!existsSync(join(host.assets, 'index.html'))) {
    host.stderr(
      `fiverunner: the dev UI is not built: there is no ${join(host.assets, 'index.html')}\n`,
    )
    return 2
  }
  const server = await startDevServer({
    root: host.cwd,
    assets: host.assets,
    cfxlua: host.wasm(),
    port,
    onChange: () => host.stdout('Files changed: the dev UI runs the project anew\n'),
  })
  const name = project.kind === 'resource' ? `the resource ${project.name}` : 'the server'
  host.stdout(`FiveRunner runs ${name} at ${server.url}\nPress Ctrl+C to stop\n`)
  await host.interrupted()
  await server.close()
  return 0
}
