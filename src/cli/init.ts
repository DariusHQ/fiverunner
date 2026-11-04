import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { FileSource } from '../core/engine/index.ts'
import { isCategory } from '../core/engine/resource.ts'
import { openProject } from '../node/project.ts'
import type { CliHost } from './main.ts'
import typesSource from './types.lua?raw'

const USAGE = `Usage: fiverunner init

Adds tests to the project in this directory: a test file, which checks
that the project starts without script errors, and on servers of Qbox,
QBCore or ESX that a player logs in with a character, what the Lua language
server needs to know the functions of tests, and, at the root of a git
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
      - uses: DariusHQ/fiverunner-action@v1
`

/** Where the types of tests go, which the settings of the Lua language server name. */
const TYPES = '.fiverunner/fiverunner.lua'

const SETTINGS = `${JSON.stringify(
  {
    'runtime.version': 'Lua 5.4',
    'workspace.library': ['.fiverunner'],
  },
  null,
  2,
)}\n`

/** How the starter test of a server logs a player in with a character, for the framework that it runs: its name, and Lua that has `player` log in. */
interface Login {
  readonly framework: string
  readonly code: string
}

/** The logins of the frameworks, as docs/testing.md tells them. */
const LOGINS = {
  qbx: {
    framework: 'Qbox',
    code: `        expect(exports.qbx_core:Login(player.id, nil, {
            charinfo = { firstname = 'Ann', lastname = 'Lee', birthdate = '1990-01-01', gender = 0, nationality = 'Romania' },
        })).toBe(true)
`,
  },
  qbMulticharacter: {
    framework: 'QBCore',
    code: `        -- The page of qb-multicharacter creates the character once its menu shows, as players do.
        fiverunner.waitFor(function()
            for _, message in ipairs(player:nuiMessages('qb-multicharacter')) do
                if message.action == 'ui' then return true end
            end
        end, 10000)
        player:nuiCallback('qb-multicharacter', 'createNewCharacter', {
            firstname = 'Ann', lastname = 'Lee', nationality = 'Romania', birthdate = '1990-01-01', gender = 'Female', cid = 1,
        })
        local QBCore = exports['qb-core']:GetCoreObject()
        fiverunner.waitFor(function() return QBCore.Functions.GetPlayer(player.id) end, 10000)
`,
  },
  qb: {
    framework: 'QBCore',
    code: `        expect(exports['qb-core']:GetCoreObject().Player.Login(player.id, false, {
            charinfo = { firstname = 'Ann', lastname = 'Lee', birthdate = '1990-01-01', gender = 0, nationality = 'Romania' },
        })).toBe(true)
`,
  },
  esx: {
    framework: 'ESX',
    code: `        -- ESX logs players in as they join, when no multicharacter resource runs.
        local ESX = exports.es_extended:getSharedObject()
        fiverunner.waitFor(function()
            local xPlayer = ESX.GetPlayerFromId(player.id)
            return xPlayer and xPlayer.spawned
        end, 10000)
`,
  },
} satisfies Record<string, Login>

/** The names of the resources of a server, in its resources directory and the categories in it, as FiveM finds them. */
function resourcesOf(source: FileSource): Set<string> {
  const names = new Set<string>()
  const visit = (path: string) => {
    for (const entry of source.list(path)) {
      if (!entry.directory) continue
      const at = `${path}/${entry.name}`
      if (isCategory(entry.name)) {
        visit(at)
      } else if (
        source
          .list(at)
          .some(({ name, directory }) => !directory && /^(fxmanifest|__resource)\.lua$/.test(name))
      ) {
        names.add(entry.name)
      }
    }
  }
  visit('resources')
  return names
}

/** How the starter test logs a player in to the framework that a server has, if it has one that the test knows. */
function loginOf(source: FileSource): Login | undefined {
  const resources = resourcesOf(source)
  if (resources.has('qbx_core')) return LOGINS.qbx
  if (resources.has('qb-core')) {
    return resources.has('qb-multicharacter') ? LOGINS.qbMulticharacter : LOGINS.qb
  }
  // esx_multicharacter has players pick their characters in its page, which the test would have to drive.
  if (resources.has('es_extended') && !resources.has('esx_multicharacter')) return LOGINS.esx
  return undefined
}

/**
 * A test file of `subject`, a Lua expression of the name of the tests, whose
 * test checks the start of the project, on the server and on the client of a
 * player, and what `checks` says, and, with `login`, a test that logs a
 * player in with a character.
 */
function testFile(subject: string, checks: string, login?: Login): string {
  const logs =
    login === undefined
      ? ''
      : `
    it('logs a player in with a character of ${login.framework}', function()
        while GetGameTimer() < 3000 do Wait(100) end
        local player = fiverunner.connect({ name = 'Ann' })
${login.code}        -- Scripts load the character a moment after it logs in.
        Wait(3000)
        expect(errors(fiverunner.output())).toEqual({})
        expect(errors(player:output())).toEqual({})
    end, 120000)
`
  return `-- The tests of the project, which \`npx fiverunner test\` runs:
-- https://github.com/DariusHQ/fiverunner/blob/main/docs/testing.md

local function errors(output)
    local found = {}
    for _, line in ipairs(output) do
        if line:find('SCRIPT ERROR', 1, true) or line:find('Failed to load script', 1, true) then
            found[#found + 1] = line
        end
    end
    return found
end

describe(${subject}, function()
    it('starts without script errors', function()
${checks}        -- Players reach servers once they started, which takes the big ones seconds.
        while GetGameTimer() < 3000 do Wait(100) end
        local player, refused = fiverunner.connect({ name = 'Ann' })
        expect(refused).toBeNil()
        expect(errors(fiverunner.output())).toEqual({})
        expect(errors(player:output())).toEqual({})
    end, 120000)
${logs}end)
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
      : [['tests/server.test.lua', testFile("'the server'", '', loginOf(project.visible))]]
  files.push([TYPES, typesSource], ['.luarc.json', SETTINGS])
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
