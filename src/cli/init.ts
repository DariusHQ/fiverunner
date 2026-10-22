import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { openProject } from '../node/project.ts'
import type { CliHost } from './main.ts'

const USAGE = `Usage: fiverunner init

Adds tests to the project in this directory: a test file, which checks
that the project starts without script errors, and, at the root of a git
repository, a GitHub Actions workflow that runs the tests on each push.
It writes over nothing that is there.

Options:
  -h, --help  Show this help
`

/** The workflow of GitHub Actions that runs the tests of the project on each push. */
const WORKFLOW = `name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: npx fiverunner test
`

/** A test file of `subject`, a Lua expression of the name of the tests, whose test checks the start of the project and what `checks` says. */
function testFile(subject: string, checks: string): string {
  return `-- The tests of the project, which \`npx fiverunner test\` runs:
-- https://github.com/DariusHQ/fiverunner/blob/main/docs/testing.md

describe(${subject}, function()
    it('starts without script errors', function()
${checks}        local errors = {}
        for _, line in ipairs(fiverunner.output()) do
            if line:find('SCRIPT ERROR', 1, true) then errors[#errors + 1] = line end
        end
        expect(errors).toEqual({})
    end)
end)
`
}

/**
 * Adds a test file and a workflow to the project in the directory that
 * the tool runs in, and returns the exit code: 0 once it did, and 2 if the
 * arguments make no sense to it, or there is no project.
 */
export function init(args: readonly string[], host: CliHost): number {
  if (args.length === 1 && (args[0] === '-h' || args[0] === '--help')) {
    host.stdout(USAGE)
    return 0
  }
  if (args.length > 0) {
    host.stderr(`fiverunner: unknown argument ${args[0]}\n\n${USAGE}`)
    return 2
  }
  const project = openProject(host.cwd)
  if (project === undefined) {
    host.stderr(
      'fiverunner: there is no FiveM project here: a resource has an fxmanifest.lua or a __resource.lua, and a server a resources directory\n',
    )
    return 2
  }
  // JSON's strings are Lua's too.
  const files: [string, string][] =
    project.kind === 'resource'
      ? [
          [
            `tests/${project.name}.test.lua`,
            testFile(
              JSON.stringify(project.name),
              `        expect(GetResourceState(${JSON.stringify(project.name)})).toBe('started')\n`,
            ),
          ],
        ]
      : [['tests/server.test.lua', testFile("'the server'", '')]]
  const repository = existsSync(join(host.cwd, '.git'))
  if (repository) files.push(['.github/workflows/fiverunner.yml', WORKFLOW])
  for (const [path, text] of files) {
    const at = join(host.cwd, path)
    if (existsSync(at)) {
      host.stdout(`Kept ${path}, which is there\n`)
      continue
    }
    mkdirSync(dirname(at), { recursive: true })
    writeFileSync(at, text)
    host.stdout(`Wrote ${path}\n`)
  }
  if (!repository) {
    host.stdout(
      'Wrote no GitHub workflow, as GitHub looks for them at the root of a git repository, which this is not\n',
    )
  }
  host.stdout('Run the tests with npx fiverunner test\n')
  return 0
}
