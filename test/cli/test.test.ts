import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { main, type CliHost } from '../../src/cli/main.ts'
import { sqlite } from '../db/helpers.ts'
import { cfxlua } from '../lua/helpers.ts'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fiverunner-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Writes `files` in the directory at `path` in the root, by their paths there, and returns its path. */
function write(path: string, files: Record<string, string>): string {
  const directory = join(root, path)
  mkdirSync(directory, { recursive: true })
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, file)), { recursive: true })
    writeFileSync(join(directory, file), text)
  }
  return directory
}

/** Runs fiverunner init in `cwd`, and returns its exit code with what it wrote. */
async function init(cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = ''
  let stderr = ''
  const code = await main(['init'], {
    cwd,
    env: {},
    stdout: (text) => {
      stdout += text
    },
    stderr: (text) => {
      stderr += text
    },
    color: false,
    cfxlua,
    sqlite,
    wasm: () => new Uint8Array(),
    assets: '',
    interrupted: () => Promise.resolve(),
    now: () => 0,
  })
  return { code, stdout, stderr }
}

/** Runs fiverunner test with `args` in `cwd`, and returns its exit code with what it wrote. */
async function test(
  cwd: string,
  args: readonly string[] = [],
  host: Partial<CliHost> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = ''
  let stderr = ''
  let time = 1000
  const code = await main(['test', ...args], {
    cwd,
    env: {},
    stdout: (text) => {
      stdout += text
    },
    stderr: (text) => {
      stderr += text
    },
    color: false,
    cfxlua,
    sqlite,
    wasm: () => new Uint8Array(),
    assets: '',
    interrupted: () => Promise.resolve(),
    // The run takes a second and a quarter.
    now: () => (time += 625),
    ...host,
  })
  return { code, stdout, stderr }
}

const MANIFEST = `fx_version 'cerulean'
game 'gta5'
server_script 'server.lua'`

/** A resource named bank, with a balance that its export gives, and `tests`. */
function bank(tests: Record<string, string>): string {
  return write('bank', {
    'fxmanifest.lua': MANIFEST,
    'server.lua': `exports('balance', function() return 500 end)`,
    ...tests,
  })
}

describe('fiverunner test', () => {
  it('runs the tests of a resource, and reports what failed', async () => {
    const directory = bank({
      'tests/bank.test.lua': `describe('bank', function()
    it('gives balances', function() expect(exports.bank:balance()).toBe(500) end)
    it('runs alone', function() end)
    it.skip('waits', function() end)
end)`,
      'tests/broken.test.lua': `it('a', function() end)\nlocal = 1`,
      'tests/fails.test.lua': `describe('bank', function()
    it('fails', function()
        print('checking')
        expect(exports.bank:balance()).toBe(600)
    end)
end)`,
    })
    expect(await test(directory)).toEqual({
      code: 1,
      stdout: `✓ tests/bank.test.lua (3 tests, 1 skipped)
× tests/broken.test.lua (did not load)
× tests/fails.test.lua (1 test, 1 failed)
   × bank > fails

Failed: tests/broken.test.lua
  tests/broken.test.lua:2: <name> expected near '='

Failed: tests/fails.test.lua > bank > fails
  expected 500 to be 600
    at tests/fails.test.lua:4
  Output:
    [script:fiverunner] checking

Test files: 2 failed, 1 passed (3)
Tests: 1 failed, 2 passed, 1 skipped (4)
Duration: 0.63 s
`,
      stderr: '',
    })
  })

  it('shows what the processes printed with what failed, but that resources started', async () => {
    const directory = bank({
      'client.lua': `print('client of bank')`,
      'tests/bank.test.lua': `local function check(value)
    expect(value).toBe(true)
end
it('fails deep', function()
    warn('careful')
    ProfilerIsRecording()
    ExecuteCommand('restart bank')
    CreateThread(function() error('oops') end)
    local ann = fiverunner.connect()
    check(false)
end)`,
    })
    writeFileSync(join(directory, 'fxmanifest.lua'), `${MANIFEST}\nclient_script 'client.lua'`)
    const { stdout } = await test(directory)
    expect(stdout.split('\n\n')[1]).toBe(`Failed: tests/bank.test.lua > fails deep
  expected false to be true
    at tests/bank.test.lua:2 (check)
    at tests/bank.test.lua:10
  Output:
    [fiverunner] Lua warning: careful
    [fiverunner] FiveRunner: ProfilerIsRecording is not implemented in FiveRunner yet: it does nothing and returns zero values.
    [script:fiverunner] SCRIPT ERROR: @fiverunner/tests/bank.test.lua:8: oops
    client 1 [script:bank] client of bank`)
  })

  it('annotates what failed on GitHub Actions, at the paths of the workspace', async () => {
    const directory = bank({
      'tests/fails.test.lua': `it('fails: once, twice', function()\n    expect(1).toBe(2)\nend)`,
      'tests/times out.test.lua': `it('waits', function() Wait(6000) end)`,
      'tests/broken.test.lua': `error('100%\\r\\nbroken')`,
      'tests/syntax.test.lua': `\n\nlocal = 1`,
    })
    const github = { GITHUB_ACTIONS: 'true', GITHUB_WORKSPACE: root }
    const inside = (await test(directory, [], { env: github })).stdout
    const outside = (await test(directory, [], { env: { GITHUB_ACTIONS: 'true' } })).stdout
    const annotations = (stdout: string) =>
      stdout.split('\n').filter((line) => line.startsWith('::'))
    expect([annotations(inside), annotations(outside)[0], inside.split('\n\n')[1]]).toEqual([
      [
        '::error file=bank/tests/broken.test.lua,line=1,title=tests/broken.test.lua::tests/broken.test.lua:1: 100%25%0D%0Abroken',
        '::error file=bank/tests/fails.test.lua,line=2,title=tests/fails.test.lua > fails%3A once%2C twice::expected 1 to be 2',
        "::error file=bank/tests/syntax.test.lua,line=3,title=tests/syntax.test.lua::tests/syntax.test.lua:3: <name> expected near '='",
        '::error file=bank/tests/times out.test.lua,title=tests/times out.test.lua > waits::the test did not end within 5000 ms',
      ],
      '::error file=tests/broken.test.lua,line=1,title=tests/broken.test.lua::tests/broken.test.lua:1: 100%25%0D%0Abroken',
      'Failed: tests/broken.test.lua\n  tests/broken.test.lua:1: 100%\r\n  broken\n    at tests/broken.test.lua:1',
    ])
  })

  it('runs the test files in the paths given, relative to the project', async () => {
    const directory = bank({
      'tests/a.test.lua': `it('a', function() end)`,
      'tests/more/b.test.lua': `it('b', function() end)`,
      'other/c.test.lua': `it('c', function() end)`,
      'notes.txt': '',
    })
    const ran = async (...args: string[]) => {
      const { code, stdout, stderr } = await test(directory, args)
      return [code, stdout.split('\n').filter((line) => line.startsWith('✓')), stderr]
    }
    expect(
      await Promise.all([
        ran('tests'),
        ran('./tests/more/', 'other/c.test.lua'),
        ran('tests/a.test.lua', 'tests'),
        ran('.'),
        ran('missing'),
        ran('tests/missing.test.lua'),
        ran('missing/x.test.lua'),
        ran('notes.txt/x.test.lua'),
        ran('notes.txt'),
        ran('..'),
        ran(join(root, 'elsewhere')),
      ]),
    ).toEqual([
      [0, ['✓ tests/a.test.lua (1 test)', '✓ tests/more/b.test.lua (1 test)'], ''],
      [0, ['✓ other/c.test.lua (1 test)', '✓ tests/more/b.test.lua (1 test)'], ''],
      [0, ['✓ tests/a.test.lua (1 test)', '✓ tests/more/b.test.lua (1 test)'], ''],
      [
        0,
        [
          '✓ other/c.test.lua (1 test)',
          '✓ tests/a.test.lua (1 test)',
          '✓ tests/more/b.test.lua (1 test)',
        ],
        '',
      ],
      [2, [], 'fiverunner: there is no missing\n'],
      [2, [], 'fiverunner: there is no tests/missing.test.lua\n'],
      [2, [], 'fiverunner: there is no missing/x.test.lua\n'],
      [2, [], 'fiverunner: there is no notes.txt/x.test.lua\n'],
      [
        2,
        [],
        'fiverunner: notes.txt is no test file, as the names of test files end in .test.lua\n',
      ],
      [2, [], 'fiverunner: .. is not in the project\n'],
      [2, [], `fiverunner: ${join(root, 'elsewhere')} is not in the project\n`],
    ])
  })

  it('runs the tests of servers, with their server.cfg', async () => {
    const directory = write('server', {
      'server.cfg': 'ensure bank',
      'resources/[local]/bank/fxmanifest.lua': MANIFEST,
      'resources/[local]/bank/server.lua': `exports('balance', function() return 500 end)`,
      'tests/bank.test.lua': `it('gives balances', function() expect(exports.bank:balance()).toBe(500) end)`,
    })
    expect(await test(directory)).toEqual({
      code: 0,
      stdout: `✓ tests/bank.test.lua (1 test)

Test files: 1 passed (1)
Tests: 1 passed (1)
Duration: 0.63 s
`,
      stderr: '',
    })
  })

  it('fails without test files, or without tests in them', async () => {
    const none = await test(bank({}))
    rmSync(join(root, 'bank'), { recursive: true })
    const empty = await test(
      bank({
        'tests/empty.test.lua': '',
        'tests/skipped.test.lua': `it.skip('a', function() end)`,
      }),
    )
    expect([none, empty]).toEqual([
      {
        code: 1,
        stdout: '',
        stderr:
          'fiverunner: there are no test files, whose names end in .test.lua: fiverunner init adds one\n',
      },
      {
        code: 1,
        stdout: `× tests/empty.test.lua (did not load)
↓ tests/skipped.test.lua (1 test, 1 skipped)

Failed: tests/empty.test.lua
  the test file has no tests

Test files: 1 failed, 1 skipped (2)
Tests: 1 skipped (1)
Duration: 0.63 s
`,
        stderr: '',
      },
    ])
  })

  it('fails without a project, with options it does not know, and shows its help', async () => {
    const usage = (await test(root, ['--help'])).stdout
    expect([
      await test(write('nothing', { 'readme.txt': '' })),
      await test(bank({}), ['--bail']),
      await test(bank({}), ['--help', 'tests']),
      await test(root, ['-h']),
      usage.split('\n')[0],
    ]).toEqual([
      {
        code: 2,
        stdout: '',
        stderr:
          'fiverunner: there is no FiveM project here: a resource has an fxmanifest.lua or a __resource.lua, and a server a resources directory\n',
      },
      { code: 2, stdout: '', stderr: `fiverunner: unknown option --bail\n\n${usage}` },
      { code: 2, stdout: '', stderr: `fiverunner: unknown option --help\n\n${usage}` },
      { code: 0, stdout: usage, stderr: '' },
      'Usage: fiverunner test [paths...]',
    ])
  })

  it('writes a JUnit report, with what passed, failed and was skipped', async () => {
    const cwd = bank({
      'tests/bank.test.lua': `describe('bank', function()
    it('<passes>', function() expect(1).toBe(1) end)
    it('fails', function() expect(1).toBe(2) end)
    it.skip('waits', function() end)
end)`,
      'tests/broken.test.lua': `error('<broken>', 0)`,
    })
    const paths = ['--junit', 'reports/junit.xml', 'tests']
    expect((await test(cwd, paths)).code).toBe(1)
    const report = readFileSync(join(cwd, 'reports/junit.xml'), 'utf8')
    expect(report.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n')).toBe(true)
    expect(report).toContain(
      '<testsuite name="tests/bank.test.lua" tests="3" failures="1" skipped="1"',
    )
    expect(report).toContain(
      'classname="tests/bank.test.lua" name="bank &gt; &lt;passes&gt;" time="',
    )
    expect(report).toContain('<failure message="expected 1 to be 2">')
    expect(report).toMatch(/name="bank &gt; waits" time="[\d.]+"><skipped\/><\/testcase>/)
    expect(report).toContain('<testsuite name="tests/broken.test.lua" tests="1" failures="1"')
    expect(report).toContain('name="(did not load)"')
    expect(report).toContain('&lt;broken&gt;')
    const { code, stderr } = await test(cwd, ['--junit'])
    expect(code).toBe(2)
    expect(stderr).toContain('--junit needs a file')
  })

  it('counts the lines of Lua that the tests ran, on servers and clients, in the format of lcov', async () => {
    const cwd = write('coverage', {
      'fxmanifest.lua': `fx_version 'cerulean'
game 'gta5'
server_script 'server.lua'
client_script 'client.lua'`,
      'server.lua': `local function ran()
    return 1
end

-- A comment.
local function never()
    return 2
end

RegisterNetEvent('ping', function()
    ran()
end)`,
      'client.lua': `print('client')`,
      'tests/ran.test.lua': `it('runs', function()
    local ann = fiverunner.connect({ name = 'Ann' })
    ann:emit('ping')
end)`,
    })
    const { code, stdout } = await test(cwd, ['--coverage'])
    expect(code).toBe(0)
    expect(stdout).toContain('Coverage: 87.5% of 8 lines of Lua, in coverage/lcov.info')
    const report = readFileSync(join(cwd, 'coverage/lcov.info'), 'utf8')
    const records = report.split('end_of_record\n').filter((record) => record !== '')
    expect(records.map((record) => record.split('\n').filter(Boolean))).toEqual([
      ['TN:', 'SF:client.lua', 'DA:1,1', 'LF:1', 'LH:1'],
      [
        'TN:',
        'SF:server.lua',
        // The files ran on two servers, which collected the test and ran it, and functions run at their ends.
        'DA:2,1',
        'DA:3,2',
        'DA:7,0',
        'DA:8,2',
        'DA:10,4',
        'DA:11,1',
        'DA:12,5',
        'LF:7',
        'LH:6',
      ],
    ])
  })

  it('runs the tests again as files of the project change, when it watches, until it is interrupted', async () => {
    const directory = bank({
      'tests/a.test.lua': `it('a', function() expect(exports.bank:balance()).toBe(500) end)`,
    })
    let output = ''
    let interrupt = () => {}
    const interrupted = new Promise<void>((resolve) => {
      interrupt = resolve
    })
    const running = test(directory, ['--watch'], {
      stdout: (text) => {
        output += text
      },
      interrupted: () => interrupted,
    })
    const until = async (done: () => boolean) => {
      for (let waited = 0; !done() && waited < 10000; waited += 50) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
    await until(() => output.includes('Watching'))
    writeFileSync(join(directory, 'server.lua'), `exports('balance', function() return 600 end)`)
    // The watcher of the host may tell of the files written before it watched, which runs the tests once more.
    await until(() => output.includes('× a') && output.endsWith('until Ctrl+C\n'))
    interrupt()
    const { code } = await running
    expect([
      code,
      output.startsWith('✓ tests/a.test.lua'),
      output.includes('Files changed: running the tests again'),
      output.includes('expected 600 to be 500'),
    ]).toEqual([1, true, true, true])
  })

  it('fails the files that FiveRunner fails to run', async () => {
    const directory = write('server', {
      'resources/fiverunner/fxmanifest.lua': MANIFEST,
      'tests/a.test.lua': `it('a', function() end)`,
    })
    const { code, stdout } = await test(directory)
    expect([code, stdout.split('\n\n')[1]]).toEqual([
      1,
      'Failed: tests/a.test.lua\n  FiveRunner failed to run the file: The project has a resource named fiverunner, the name of the resource that runs its tests',
    ])
  })

  it('colors what passed, failed and was skipped where the host shows colors', async () => {
    const directory = bank({
      'tests/a.test.lua': `it('a', function() end)`,
      'tests/b.test.lua': `it('b', function() error('b') end)`,
      'tests/c.test.lua': `it.skip('c', function() end)`,
    })
    const { stdout } = await test(directory, [], { color: true })
    expect(stdout.split('\n').slice(0, 4)).toEqual([
      '\x1b[32m✓\x1b[39m tests/a.test.lua \x1b[2m(1 test)\x1b[22m',
      '\x1b[31m×\x1b[39m tests/b.test.lua \x1b[2m(1 test, 1 failed)\x1b[22m',
      '   \x1b[31m×\x1b[39m b',
      '\x1b[33m↓\x1b[39m tests/c.test.lua \x1b[2m(1 test, 1 skipped)\x1b[22m',
    ])
  })
})

describe('fiverunner init', () => {
  it('adds a test of the start of the project, and a workflow at the roots of repositories, over nothing that is there', async () => {
    const resource = bank({ '.git/HEAD': 'ref: refs/heads/main\n' })
    const server = write('server', {
      'resources/shop/fxmanifest.lua': MANIFEST,
      'resources/shop/server.lua': `print('shop')`,
      'server.cfg': 'ensure shop',
    })
    const broken = write('broken', { 'fxmanifest.lua': MANIFEST, 'server.lua': `error('broken')` })
    const run = 'Run the tests with npx fiverunner test\n'
    expect([
      await init(resource),
      (await init(resource)).stdout,
      (await init(server)).stdout,
      (await init(broken)).code,
      readFileSync(join(resource, '.github/workflows/fiverunner.yml'), 'utf8').includes(
        'uses: DariusHQ/fiverunner-action@v1',
      ),
      readFileSync(join(resource, '.fiverunner/fiverunner.lua'), 'utf8').startsWith('---@meta'),
      JSON.parse(readFileSync(join(resource, '.luarc.json'), 'utf8'))['workspace.library'],
      (await test(resource)).code,
      (await test(server)).code,
      (await test(broken)).code,
      (await init(root)).code,
    ]).toEqual([
      {
        code: 0,
        stdout: `Wrote tests/bank.test.lua\nWrote .fiverunner/fiverunner.lua\nWrote .luarc.json\nWrote .github/workflows/fiverunner.yml\n${run}`,
        stderr: '',
      },
      `Kept tests/bank.test.lua, which is there\nKept .fiverunner/fiverunner.lua, which is there\nKept .luarc.json, which is there\nKept .github/workflows/fiverunner.yml, which is there\n${run}`,
      `Wrote tests/server.test.lua\nWrote .fiverunner/fiverunner.lua\nWrote .luarc.json\nWrote no GitHub workflow, as GitHub looks for them at the root of a git repository, which this is not\n${run}`,
      0,
      true,
      true,
      ['.fiverunner'],
      0,
      0,
      1,
      2,
    ])
  })

  it('adds a test that fails on scripts that do not load, and on the client scripts of players', async () => {
    const syntax = write('syntax', { 'fxmanifest.lua': MANIFEST, 'server.lua': 'local = 1' })
    const client = write('client', {
      'fxmanifest.lua': `${MANIFEST}\nclient_script 'client.lua'`,
      'server.lua': `print('server')`,
      'client.lua': `error('broken')`,
    })
    await init(syntax)
    await init(client)
    expect([(await test(syntax)).code, (await test(client)).code]).toEqual([1, 1])
  })

  it('adds a test that logs a player in with a character on servers of Qbox, QBCore and ESX', async () => {
    // Stand-ins of the frameworks, with as much as the logins use, in the categories of their recipes.
    const qbox = {
      'resources/[qbx]/qbx_core/fxmanifest.lua': MANIFEST,
      'resources/[qbx]/qbx_core/server.lua': `exports('Login', function(id, citizenid, data)
    TriggerClientEvent('QBCore:Client:OnPlayerLoaded', id)
    return citizenid == nil and data.charinfo.firstname == 'Ann'
end)`,
    }
    const qbcore = {
      'resources/[qb]/qb-core/fxmanifest.lua': MANIFEST,
      'resources/[qb]/qb-core/server.lua': `local players = {}
local QBCore = { Functions = {}, Player = {} }
function QBCore.Functions.GetPlayer(id) return players[id] end
function QBCore.Player.Login(id, citizenid, data)
    players[id] = { PlayerData = { charinfo = data.charinfo } }
    return true
end
exports('GetCoreObject', function() return QBCore end)`,
    }
    const multicharacter = {
      'resources/[qb]/qb-multicharacter/fxmanifest.lua': `${MANIFEST}\nclient_script 'client.lua'\nui_page 'index.html'`,
      'resources/[qb]/qb-multicharacter/index.html': '<!doctype html>',
      'resources/[qb]/qb-multicharacter/client.lua': `CreateThread(function()
    Wait(0)
    SendNUIMessage({ action = 'ui', toggle = true })
end)
RegisterNUICallback('createNewCharacter', function(data, cb)
    TriggerServerEvent('qb-multicharacter:server:createCharacter', data)
    cb('ok')
end)`,
      'resources/[qb]/qb-multicharacter/server.lua': `RegisterNetEvent('qb-multicharacter:server:createCharacter', function(data)
    exports['qb-core']:GetCoreObject().Player.Login(source, false, { charinfo = data })
end)`,
    }
    const esx = {
      'resources/[core]/es_extended/fxmanifest.lua': MANIFEST,
      'resources/[core]/es_extended/server.lua': `exports('getSharedObject', function()
    return { GetPlayerFromId = function(id) return GetPlayerName(id) and { spawned = true } end }
end)`,
    }
    // A HUD that breaks once a character loads, which only the test that logs in finds.
    const hud = {
      'resources/hud/fxmanifest.lua': `fx_version 'cerulean'\ngame 'gta5'\nclient_script 'client.lua'`,
      'resources/hud/client.lua': `RegisterNetEvent('QBCore:Client:OnPlayerLoaded', function() error('no job') end)`,
    }
    const servers: Record<string, Record<string, string>> = {
      qbox,
      qbcore: { ...qbcore, ...multicharacter },
      'qbcore without qb-multicharacter': qbcore,
      esx,
      'esx with esx_multicharacter': {
        ...esx,
        'resources/[core]/esx_multicharacter/fxmanifest.lua': MANIFEST,
        'resources/[core]/esx_multicharacter/server.lua': '',
      },
      'qbox with a broken hud': { ...qbox, ...hud },
    }
    const results = []
    for (const [name, files] of Object.entries(servers)) {
      const resources = Object.keys(files).flatMap((path) =>
        path.endsWith('/fxmanifest.lua') ? [`ensure ${path.split('/').at(-2)}`] : [],
      )
      const directory = write(name, { ...files, 'server.cfg': resources.join('\n') })
      await init(directory)
      const tests = readFileSync(join(directory, 'tests/server.test.lua'), 'utf8')
      results.push([
        name,
        /logs a player in with a character of (\w+)/.exec(tests)?.[1],
        tests.includes("nuiCallback('qb-multicharacter'"),
        (await test(directory)).stdout.split('\n')[0],
      ])
    }
    const passed = '✓ tests/server.test.lua (2 tests)'
    expect(results).toEqual([
      ['qbox', 'Qbox', false, passed],
      ['qbcore', 'QBCore', true, passed],
      ['qbcore without qb-multicharacter', 'QBCore', false, passed],
      ['esx', 'ESX', false, passed],
      ['esx with esx_multicharacter', undefined, false, '✓ tests/server.test.lua (1 test)'],
      ['qbox with a broken hud', 'Qbox', false, '× tests/server.test.lua (2 tests, 1 failed)'],
    ])
  }, 60000)
})
