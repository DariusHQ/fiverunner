import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { main } from '../../src/cli/main.ts'
import { sqlite } from '../db/helpers.ts'
import { cfxlua } from '../lua/helpers.ts'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fiverunner-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A resource named shop, with a test of its own. */
function shop(): string {
  const files: Record<string, string> = {
    'fxmanifest.lua': `fx_version 'cerulean'
game 'gta5'
server_script 'server.lua'
`,
    'server.lua': `print('the shop opened')
RegisterNetEvent('shop:buy', function(item) print(('%d bought %s'):format(source, item)) end)
`,
    'tests/shop.test.lua': `it('opens', function() expect(GetResourceState('shop')).toBe('started') end)
`,
  }
  const directory = join(root, 'shop')
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, file)), { recursive: true })
    writeFileSync(join(directory, file), text)
  }
  return directory
}

/** What the server answered to `messages`, sent as its client sends them, line by line, by their ids, with its notifications. */
async function serve(
  cwd: string,
  messages: readonly unknown[],
): Promise<{
  code: number
  answers: Map<unknown, Record<string, unknown>>
  notes: Record<string, unknown>[]
}> {
  let stdout = ''
  async function* input() {
    for (const message of messages)
      yield `${typeof message === 'string' ? message : JSON.stringify(message)}\n`
  }
  const code = await main(['mcp'], {
    cwd,
    env: {},
    stdout: (text) => {
      stdout += text
    },
    stderr: () => {},
    input: input(),
    color: false,
    cfxlua,
    sqlite,
    wasm: () => new Uint8Array(),
    assets: '',
    interrupted: () => Promise.resolve(),
    now: () => 0,
  })
  const answers = new Map<unknown, Record<string, unknown>>()
  const notes: Record<string, unknown>[] = []
  for (const line of stdout.split('\n').filter(Boolean)) {
    const message = JSON.parse(line) as Record<string, unknown>
    expect(message.jsonrpc).toBe('2.0')
    if ('id' in message) answers.set(message.id, message)
    else notes.push(message)
  }
  return { code, answers, notes }
}

/** The text that a call of a tool gave back. */
function textOf(answer: Record<string, unknown> | undefined): string {
  const result = answer?.result as { content: { text: string }[] }
  return result.content[0]!.text
}

const call = (id: number, name: string, args: Record<string, unknown> = {}, meta?: object) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name, arguments: args, ...(meta === undefined ? {} : { _meta: meta }) },
})

describe('fiverunner mcp', () => {
  it('says what it speaks, and lists its tools', async () => {
    const { code, answers } = await serve(root, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } },
      { jsonrpc: '2.0', id: 3, method: 'tools/list' },
      { jsonrpc: '2.0', id: 4, method: 'ping' },
    ])
    expect(code).toBe(0)
    expect(answers.get(1)?.result).toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'fiverunner' },
    })
    // A version that it does not speak gets its newest.
    expect(answers.get(2)?.result).toMatchObject({ protocolVersion: '2025-06-18' })
    const { tools } = answers.get(3)?.result as { tools: { name: string }[] }
    expect(tools.map((tool) => tool.name)).toEqual([
      'describe_project',
      'run_tests',
      'run_lua',
      'audit',
    ])
    expect(answers.get(4)?.result).toEqual({})
    // Notifications get no answer.
    expect(answers.size).toBe(4)
  })

  it('runs Lua in a fresh server of the project, and tells what it printed and where it failed', async () => {
    const { answers } = await serve(shop(), [
      call(1, 'run_lua', {
        code: `while GetGameTimer() < 3000 do Wait(100) end
local ann = fiverunner.connect({ name = 'Ann' })
ann:emit('shop:buy', 'water')
Wait(100)
print('done')`,
      }),
      call(2, 'run_lua', { code: "print('before')\nerror('boom')" }),
    ])
    const ran = textOf(answers.get(1))
    expect(ran).toContain('The code ran without failing.')
    expect(ran).toContain('[script:shop] the shop opened')
    expect(ran).toContain('[script:shop] 1 bought water')
    expect(ran).toContain('[script:fiverunner] done')
    const failed = textOf(answers.get(2))
    // The lines of failures are those of the code.
    expect(failed).toContain('The code failed:\n  @fiverunner/.fiverunner/mcp.test.lua:2: boom')
    expect(failed).toContain('[script:fiverunner] before')
  }, 60000)

  it('describes the project, runs its tests, and audits it, telling how far it got', async () => {
    const { answers, notes } = await serve(shop(), [
      call(1, 'describe_project'),
      call(2, 'run_tests'),
      call(3, 'audit', {}, { progressToken: 'audit' }),
    ])
    const described = textOf(answers.get(1))
    expect(described).toContain('A resource, shop, which tests run in a server of its own.')
    expect(described).toContain('  shop started')
    expect(described).toContain('[script:shop] the shop opened')
    expect(described).toContain('Test files: tests/shop.test.lua')
    expect(textOf(answers.get(2))).toContain('Tests: 1 passed (1)')
    expect(textOf(answers.get(3))).toContain('Events: ')
    expect(notes[0]).toMatchObject({
      method: 'notifications/progress',
      params: { progressToken: 'audit', progress: 1 },
    })
  }, 120000)

  it('answers what it does not know with the errors of JSON-RPC', async () => {
    const { answers } = await serve(root, [
      'not json',
      { jsonrpc: '2.0', id: 1, method: 'resources/list' },
      call(2, 'nothing'),
      call(3, 'describe_project'),
    ])
    expect(answers.get(null)?.error).toMatchObject({ code: -32700 })
    expect(answers.get(1)?.error).toMatchObject({ code: -32601 })
    expect(answers.get(2)?.error).toMatchObject({ code: -32602 })
    // The tool runs, and tells that the directory has no project.
    expect(answers.get(3)?.result).toMatchObject({ isError: true })
    expect(textOf(answers.get(3))).toContain('There is no FiveM project')
  })
})
