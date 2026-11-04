import packageJson from '../../package.json' with { type: 'json' }
import { findTestFiles, openProject } from '../node/project.ts'
import { runFile, type FileResult } from '../runner/index.ts'
import { audit } from './audit.ts'
import type { CliHost } from './main.ts'
import { routine, showLine } from './report.ts'
import { test } from './test.ts'

const USAGE = `Usage: fiverunner mcp

Serves the Model Context Protocol on stdin and stdout, for AI assistants
such as Claude Code, Codex, Cursor and VS Code: its tools run the FiveM
project in the directory that the assistant starts it in, with no GTA V.
It runs until stdin ends.

Options:
  -h, --help  Show this help
`

/** The versions of the protocol that the server speaks, newest first. */
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

const INSTRUCTIONS = `FiveRunner emulates the FiveM server and its clients, so its tools run the FiveM project of the directory that this server runs in, without GTA V or FXServer: describe_project tells what is in it, run_tests runs its *.test.lua files, run_lua runs Lua as a test in a fresh server of it, and audit triggers its events as cheaters do. The guide of tests is https://github.com/DariusHQ/fiverunner/blob/main/docs/testing.md.`

/** The longest output of a server that a tool gives back, in lines: the last ones. */
const MAX_LINES = 400

interface Tool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
}

const TOOLS: readonly Tool[] = [
  {
    name: 'describe_project',
    description:
      'Tells what the FiveM project is, a resource or a server, the resources that its server started and their states, what they printed as they started, such as script errors, and its test files.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'run_tests',
    description:
      'Runs the Lua tests of the project, its *.test.lua files or those in `paths`, each test in a fresh server, and tells which passed and failed, with what the server and players printed for each failure.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Test files, or directories of them, relative to the project',
        },
      },
    },
  },
  {
    name: 'run_lua',
    description: `Runs Lua code as the body of a test, in a fresh server of the project, and tells whether it failed and what the server and players printed. The code runs as a server script of the resource of tests, once the resources of the project started, with exports, events, natives and ExecuteCommand as on a server, and FiveRunner's API:
- fiverunner.connect({ name = 'Ann' }) connects a player, whose client runs the client scripts, and returns it, or nil and why the server refused it
- player:emit(event, ...) triggers a server event from its client; player:run(code, ...) runs Lua in its client; player:received(event) gives what it got of an event; player:nuiCallback(resource, name, data) calls a NUI callback as its page does; player:output() gives what its client printed
- fiverunner.output() gives what the server printed; fiverunner.waitFor(check, timeout) waits until check() is truthy; fiverunner.events() lists the events that resources handle; fiverunner.mock(native, fn) mocks a native
- expect(value).toBe(other), .toEqual(other), .toContain(item), .toBeTruthy() check values, and print(...) shows anything
- Wait(ms) passes time, which takes no real time. Connect players once GetGameTimer() passed 3000, as frameworks expect players to join started servers.`,
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'The Lua code to run' },
        timeout: {
          type: 'number',
          description: 'Milliseconds of game time that the code may take, 60000 by default',
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'audit',
    description:
      'Triggers each event of the server that clients may trigger, from a player logged in with a character, with the arguments that cheaters give, and tells what any client gains, such as money, items or a job, what it changes in the database, and what breaks. It takes minutes on servers of many resources.',
    inputSchema: { type: 'object', properties: {} },
  },
]

/** A request or a notification of JSON-RPC, as clients send them. */
interface Message {
  readonly jsonrpc?: string
  readonly id?: string | number | null
  readonly method?: string
  readonly params?: Record<string, unknown>
}

/** What a tool gives back: its text, and whether it failed to do what it was asked. */
interface ToolResult {
  readonly text: string
  readonly isError?: boolean
}

/** The script that describe_project runs in a server of the project. */
const DESCRIBE = `it('describes the project', function()
    for i = 0, GetNumResources() - 1 do
        local name = GetResourceByFindIndex(i)
        if name ~= 'fiverunner' then print(('resource %s %s'):format(name, GetResourceState(name))) end
    end
end)
`

/**
 * Serves the Model Context Protocol on the input and the stdout of the
 * host until its input ends, and returns the exit code: 0, or 2 when the
 * arguments make no sense to it or it has no input.
 */
export async function mcp(args: readonly string[], host: CliHost): Promise<number> {
  if (args.length === 1 && (args[0] === '-h' || args[0] === '--help')) {
    host.stdout(USAGE)
    return 0
  }
  if (args.length > 0) {
    host.stderr(`fiverunner: unknown arguments: ${args.join(' ')}\n\n${USAGE}`)
    return 2
  }
  if (host.input === undefined) {
    host.stderr(
      'fiverunner: mcp reads the requests of its client from stdin, which it has none of\n',
    )
    return 2
  }
  const send = (message: Record<string, unknown>) =>
    host.stdout(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
  // Tools run one at a time, as each runs servers, while the rest answers at once.
  let tools: Promise<void> = Promise.resolve()
  const answer = async (message: Message) => {
    const { id, method, params = {} } = message
    // Notifications, such as notifications/initialized, need no answer.
    if (id === undefined) return
    switch (method) {
      case 'initialize': {
        const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
        return send({
          id,
          result: {
            protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
            capabilities: { tools: {} },
            serverInfo: { name: 'fiverunner', version: packageJson.version },
            instructions: INSTRUCTIONS,
          },
        })
      }
      case 'ping':
        return send({ id, result: {} })
      case 'tools/list':
        return send({ id, result: { tools: TOOLS } })
      case 'tools/call': {
        const meta = params._meta as { progressToken?: string | number } | undefined
        const token = meta?.progressToken
        let progress = 0
        const tell = (text: string) => {
          if (token === undefined) return
          for (const line of text.split('\n').filter((line) => line.trim() !== '')) {
            send({
              method: 'notifications/progress',
              params: { progressToken: token, progress: ++progress, message: line.trim() },
            })
          }
        }
        tools = tools.then(async () => {
          const name = typeof params.name === 'string' ? params.name : ''
          const given = (params.arguments ?? {}) as Record<string, unknown>
          if (!TOOLS.some((tool) => tool.name === name)) {
            return send({ id, error: { code: -32602, message: `Unknown tool: ${name}` } })
          }
          let result: ToolResult
          try {
            result = await call(name, given, host, tell)
          } catch (error) {
            const why = error instanceof Error ? error.message : String(error)
            result = { text: `FiveRunner failed: ${why}`, isError: true }
          }
          send({
            id,
            result: {
              content: [{ type: 'text', text: result.text }],
              isError: result.isError === true,
            },
          })
        })
        return tools
      }
      default:
        return send({ id, error: { code: -32601, message: `Method not found: ${String(method)}` } })
    }
  }
  const pending: Promise<void>[] = []
  let buffered = ''
  const decoder = new TextDecoder()
  for await (const chunk of host.input) {
    buffered += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    const lines = buffered.split('\n')
    buffered = lines.pop()!
    for (const line of lines) {
      if (line.trim() === '') continue
      let message: Message
      try {
        message = JSON.parse(line) as Message
      } catch {
        send({ id: null, error: { code: -32700, message: 'Parse error' } })
        continue
      }
      pending.push(answer(message))
    }
  }
  await Promise.all(pending)
  await tools
  return 0
}

/** Runs the tool `name` with `given`, telling `tell` how it goes, as the commands of the tool tell stderr. */
async function call(
  name: string,
  given: Readonly<Record<string, unknown>>,
  host: CliHost,
  tell: (text: string) => void,
): Promise<ToolResult> {
  // The commands write to what the tool gives back, rather than to the protocol of stdout.
  let out = ''
  const captured: CliHost = {
    ...host,
    color: false,
    stdout: (text) => {
      out += text
    },
    stderr: (text) => {
      out += text
      tell(text)
    },
  }
  switch (name) {
    case 'run_tests': {
      const paths = Array.isArray(given.paths) ? given.paths.map(String) : []
      const code = await test(paths, captured)
      return { text: out, isError: code === 2 }
    }
    case 'audit': {
      const code = await audit([], captured)
      return { text: out, isError: code === 2 }
    }
    case 'run_lua': {
      if (typeof given.code !== 'string')
        return { text: 'run_lua needs code, a string', isError: true }
      const timeout = typeof given.timeout === 'number' && given.timeout > 0 ? given.timeout : 60000
      // The code starts on the first line of the file, so lines of failures are its own.
      const source = `it('runs the code', function() ${given.code}\nend, ${Math.trunc(timeout)})\n`
      const result = await runOn(host, '.fiverunner/mcp.test.lua', source)
      if (typeof result === 'string') return { text: result, isError: true }
      return { text: describeRun(result) }
    }
    case 'describe_project': {
      const project = openProject(host.cwd)
      if (project === undefined) return { text: NO_PROJECT, isError: true }
      const result = await runOn(host, '.fiverunner/describe.test.lua', DESCRIBE)
      if (typeof result === 'string') return { text: result, isError: true }
      const output = result.tests.flatMap((test) => test.output)
      const resources = output
        .filter((line) => line.process === 'server' && line.text.startsWith('resource '))
        .map((line) => `  ${line.text.slice('resource '.length)}`)
      const printed = output
        .filter((line) => !routine(line) && !line.text.startsWith('resource '))
        .map(showLine)
      const tests = findTestFiles(project.source)
      return {
        text: [
          project.kind === 'resource'
            ? `A resource, ${project.name}, which tests run in a server of its own.`
            : `A server, which runs ${project.commands.length > 0 ? 'its server.cfg' : 'no server.cfg, so it starts no resource'}.`,
          '',
          'Resources, and their states once the server started:',
          ...(resources.length > 0 ? resources : ['  none']),
          '',
          printed.length > 0
            ? 'What the server printed as it started:'
            : 'The server printed nothing of note as it started.',
          ...printed.slice(-MAX_LINES).map((line) => `  ${line}`),
          '',
          tests.length > 0
            ? `Test files: ${tests.join(', ')}`
            : 'No test files: fiverunner init adds one.',
        ].join('\n'),
      }
    }
    default:
      return { text: `Unknown tool: ${name}`, isError: true }
  }
}

const NO_PROJECT =
  'There is no FiveM project in the directory of the server: a resource has an fxmanifest.lua or a __resource.lua, and a server a resources directory.'

/** Runs a test file of `source` on the project of the host, or tells why it cannot. */
async function runOn(host: CliHost, path: string, source: string): Promise<FileResult | string> {
  const project = openProject(host.cwd)
  if (project === undefined) return NO_PROJECT
  const [cfxlua, sqlite, quickjs] = await Promise.all([
    host.cfxlua(),
    host.sqlite(),
    host.quickjs?.(),
  ])
  return runFile(
    { path, source },
    { cfxlua, sqlite, project, ...(quickjs === undefined ? {} : { quickjs }) },
  )
}

/** What run_lua tells of a run: whether the code failed, and the last lines that the processes printed. */
function describeRun(result: FileResult): string {
  const [ran] = result.tests
  const failures = result.failure !== undefined ? [result.failure] : (ran?.failures ?? [])
  const lines = (ran?.output ?? result.output).filter((line) => !routine(line)).map(showLine)
  const shown = lines.slice(-MAX_LINES)
  return [
    failures.length === 0
      ? 'The code ran without failing.'
      : `The code failed:\n${failures.map((failure) => `  ${failure.message}`).join('\n')}`,
    '',
    lines.length === 0
      ? 'Nothing was printed.'
      : `What the server and players printed${shown.length < lines.length ? `, its last ${shown.length} lines of ${lines.length}` : ''}:`,
    ...shown.map((line) => `  ${line}`),
  ].join('\n')
}
