import { openProject } from '../node/project.ts'
import { runFile, type FileResult, type OutputLine } from '../runner/index.ts'
import auditSource from './audit.lua?raw'
import type { CliHost } from './main.ts'

const USAGE = `Usage: fiverunner audit

Audits the project in this directory as cheaters would: a player triggers
each event of the server that clients may trigger, with the arguments that
cheaters give, and the audit tells what each changed. A player who gains
money, items, a job or permissions is a finding of high severity, a change
to the database or new entities one of medium, and an error one of low.
The player logs in with a character when Qbox, QBCore or ESX runs.

It exits with 1 when it found anything of high severity, so CI can fail on it.

Options:
  --json      Write what it found as JSON
  -h, --help  Show this help
`

/** What the audit tells, as the lines of JSON that its script prints. */
export type AuditRecord =
  | { type: 'start'; framework?: string; events: number; open: number; loggedIn: boolean }
  | { type: 'refused'; reason?: string }
  | { type: 'event'; event: string; resources: string[]; open: boolean }
  | {
      type: 'finding'
      event: string
      resources: string[]
      /** The arguments that did what the finding tells, unless it is what all of them did together, as changes of the database are. */
      args?: unknown[]
      severity: Severity
      effects: string[]
    }
  | { type: 'dropped'; event: string; resources: string[]; args: unknown[] }
  | { type: 'end' }

export type Severity = 'high' | 'medium' | 'low'

/** What starts the lines of the script of the audit. */
const MARK = 'fiverunner:audit '

/** Where the script of the audit runs from, in the resource of tests. */
const PATH = '.fiverunner/audit.test.lua'

const HEADINGS: Readonly<Record<Severity, string>> = {
  high: 'High: what any client gains',
  medium: 'Medium: what any client changes',
  low: 'Low: errors on what clients send',
}

/**
 * Runs the audit of the project in the directory that the tool runs in, and
 * returns its exit code: 1 when it found anything of high severity or could
 * not run, 0 otherwise, and 2 when the arguments make no sense to it.
 */
export async function audit(args: readonly string[], host: CliHost): Promise<number> {
  if (args.length === 1 && (args[0] === '-h' || args[0] === '--help')) {
    host.stdout(USAGE)
    return 0
  }
  const json = args.includes('--json')
  const unknown = args.find((arg) => arg !== '--json')
  if (unknown !== undefined) {
    host.stderr(`fiverunner: unknown argument ${unknown}\n\n${USAGE}`)
    return 2
  }
  const project = openProject(host.cwd)
  if (project === undefined) {
    host.stderr(
      'fiverunner: there is no FiveM project here: a resource has an fxmanifest.lua or a __resource.lua, and a server a resources directory\n',
    )
    return 2
  }
  const [cfxlua, sqlite, quickjs] = await Promise.all([
    host.cfxlua(),
    host.sqlite(),
    host.quickjs?.(),
  ])
  // How far it got, on stderr, which leaves the JSON of stdout alone.
  let open = 0
  let tried = 0
  const onLine = (line: OutputLine) => {
    const record = recordOf(line)
    if (record?.type === 'start') {
      open = record.open
      const which = open === 1 ? 'event' : `${open} events`
      host.stderr(
        `Triggering the ${which} that clients may trigger, of the ${record.events} that the server handles\n`,
      )
    } else if (record?.type === 'event' && record.open && ++tried % 10 === 0 && tried < open) {
      host.stderr(`  ${tried} of ${open}\n`)
    }
  }
  const result = await runFile(
    { path: PATH, source: auditSource },
    { cfxlua, sqlite, project, onLine, ...(quickjs === undefined ? {} : { quickjs }) },
  )
  const records = recordsOf(result)
  if (json) {
    host.stdout(`${JSON.stringify(records, null, 2)}\n`)
  } else {
    host.stdout(reportOf(records))
  }
  const ended = records.some((record) => record.type === 'end')
  if (!ended) {
    const failure = result.failure ?? result.tests[0]?.failures[0]
    host.stderr(
      `fiverunner: the audit did not end${failure === undefined ? '' : `: ${failure.message}`}\n`,
    )
    return 1
  }
  return records.some((record) => record.type === 'finding' && record.severity === 'high') ? 1 : 0
}

/** What the script of the audit told with a line that the server printed, if it told anything. */
function recordOf({ process, text }: OutputLine): AuditRecord | undefined {
  if (process !== 'server' || !text.startsWith(MARK)) return undefined
  return JSON.parse(text.slice(MARK.length)) as AuditRecord
}

/** What the script of the audit told, from what the server printed as it ran. */
export function recordsOf(result: FileResult): AuditRecord[] {
  return result.tests.flatMap(({ output }) =>
    output.flatMap((line) => {
      const record = recordOf(line)
      return record === undefined ? [] : [record]
    }),
  )
}

/** The arguments that an event got, as a script would give them, if the finding has them. */
function argumentsOf(args: readonly unknown[] | undefined): string {
  if (args === undefined) return ''
  return `(${args.map((arg) => (typeof arg === 'string' ? `'${arg}'` : JSON.stringify(arg))).join(', ')})`
}

/** The report of an audit, as people read it. */
export function reportOf(records: readonly AuditRecord[]): string {
  const lines: string[] = []
  const start = records.find((record) => record.type === 'start')
  const refused = records.find((record) => record.type === 'refused')
  if (refused !== undefined) {
    return `The server refused the player of the audit${refused.reason === undefined ? '' : `: ${refused.reason}`}\n`
  }
  if (start !== undefined) {
    const framework =
      start.framework === undefined ? 'no framework' : `the framework ${start.framework}`
    lines.push(
      `The server runs ${framework}${start.framework === undefined ? '' : start.loggedIn ? ', with a character for the player' : ', but the player has no character'}.`,
    )
  }
  const findings = records.filter((record) => record.type === 'finding')
  for (const severity of ['high', 'medium', 'low'] as const) {
    const found = findings.filter((finding) => finding.severity === severity)
    if (found.length === 0) continue
    lines.push('', HEADINGS[severity])
    for (const finding of found) {
      lines.push(
        `  ${finding.resources.join(', ')}  ${finding.event}${argumentsOf(finding.args)}  ${finding.effects.join('; ')}`,
      )
    }
  }
  const dropped = records.filter((record) => record.type === 'dropped')
  if (dropped.length > 0) {
    lines.push('', 'What dropped the player, or logged it out')
    for (const record of dropped) {
      lines.push(`  ${record.resources.join(', ')}  ${record.event}${argumentsOf(record.args)}`)
    }
  }
  const events = records.filter((record) => record.type === 'event')
  const open = events.filter((record) => record.open).length
  const count = (severity: Severity) =>
    findings.filter((finding) => finding.severity === severity).length
  lines.push(
    '',
    `Events: ${events.length}, of which clients may trigger ${open}. Findings: ${count('high')} high, ${count('medium')} medium, ${count('low')} low.`,
  )
  return `${lines.join('\n')}\n`
}
