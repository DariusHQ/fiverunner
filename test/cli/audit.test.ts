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

/** Writes `files` in the root, by their paths there, and returns its path. */
function write(files: Record<string, string>): string {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  return root
}

/** Runs fiverunner audit with `args` in `cwd`, and returns its exit code with what it wrote. */
async function audit(
  cwd: string,
  args: readonly string[] = [],
): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = ''
  let stderr = ''
  const code = await main(['audit', ...args], {
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

/** A server whose resource trusts what clients send, but for an event that only the server triggers. */
const SERVER = {
  'server.cfg': 'add_ace resource.evil command allow\nensure oxmysql\nensure evil\n',
  'resources/evil/fxmanifest.lua': `fx_version 'cerulean'
game 'gta5'
server_scripts { '@oxmysql/lib/MySQL.lua', 'server.lua' }
`,
  'resources/evil/evil.sql': 'CREATE TABLE logs (line VARCHAR(100));',
  'resources/evil/server.lua': `-- Lets the player who triggers it run every command.
RegisterNetEvent('evil:admin', function()
    ExecuteCommand(('add_ace player.%d command allow'):format(source))
end)

-- Writes what any client sends.
RegisterNetEvent('evil:log', function(line)
    MySQL.insert.await('INSERT INTO logs (line) VALUES (?)', { tostring(line) })
end)

-- Expects a table.
RegisterNetEvent('evil:crash', function(data)
    print(data.field)
end)

-- Only the server triggers it.
AddEventHandler('evil:local', function()
    ExecuteCommand(('add_ace player.%d command allow'):format(source))
end)
`,
}

/**
 * A server with a framework that the audit takes for ESX, small enough for
 * a test: players start with 500 of money, and a shop pays any amount, gives
 * a bonus once, and sells water.
 */
const ESX = {
  'server.cfg': 'ensure es_extended\nensure shop\n',
  'resources/es_extended/fxmanifest.lua': `fx_version 'cerulean'
game 'gta5'
server_script 'server.lua'
`,
  'resources/es_extended/server.lua': `local players = {}

local function data(id)
    if GetPlayerName(id) == nil then return nil end
    players[id] = players[id] or { money = 500, items = {} }
    return players[id]
end

AddEventHandler('playerDropped', function() players[source] = nil end)

exports('getSharedObject', function()
    return {
        Items = { water = { label = 'Water' } },
        GetPlayerFromId = function(id)
            local found = data(id)
            if not found then return nil end
            return {
                spawned = true,
                getAccounts = function() return { money = found.money, bank = 0 } end,
                getInventory = function() return found.items end,
                getJob = function() return { name = 'unemployed', grade = 0 } end,
                getGroup = function() return 'user' end,
            }
        end,
    }
end)

exports('addMoney', function(id, amount) data(id).money = data(id).money + amount end)

exports('buy', function(id, item, price)
    local found = data(id)
    if found.money < price then return end
    found.money = found.money - price
    found.items[item] = (found.items[item] or 0) + 1
end)

exports('addItem', function(id, item)
    local found = data(id)
    if found then found.items[item] = (found.items[item] or 0) + 1 end
end)
`,
  'resources/shop/fxmanifest.lua': `fx_version 'cerulean'
game 'gta5'
server_script 'server.lua'
`,
  'resources/shop/server.lua': `-- Pays what it is asked.
RegisterNetEvent('shop:pay', function(amount)
    if type(amount) == 'number' and amount > 0 then exports.es_extended:addMoney(source, amount) end
end)

-- A bonus of 100, once for each player.
local welcomed = {}
RegisterNetEvent('shop:welcome', function()
    if welcomed[source] then return end
    welcomed[source] = true
    exports.es_extended:addMoney(source, 100)
end)

-- Sells water for 50.
RegisterNetEvent('shop:buy', function()
    exports.es_extended:buy(source, 'water', 50)
end)

-- Gives two bread, one at a time, as loops of scripts do.
RegisterNetEvent('shop:farm', function()
    local id = source
    for _ = 1, 2 do
        Wait(300)
        exports.es_extended:addItem(id, 'bread')
    end
end)

-- Gives nothing: the bread that comes late is shop:farm's.
RegisterNetEvent('shop:look', function() end)
`,
}

describe('fiverunner audit', () => {
  it('tells money that the same arguments bring again, and what players pay for', async () => {
    const { code, stdout } = await audit(write(ESX))
    expect(code).toBe(1)
    expect(stdout).toBe(`The server runs the framework esx, with a character for the player.

High: what any client gains
  shop  shop:pay(1000000)  money +1000000
  shop  shop:farm(-1000000)  item bread +1; later: item bread +6

Medium: what any client changes
  shop  shop:buy()  item water +1; money -50

Events: 11, of which clients may trigger 5. Findings: 2 high, 1 medium, 0 low.
`)
  }, 60000)

  it('triggers what clients may trigger, and tells what any client gains, changes and breaks', async () => {
    const { code, stdout, stderr } = await audit(write(SERVER))
    expect(code).toBe(1)
    // How far it got goes to stderr.
    expect(stderr).toMatch(
      /^Triggering the 3 events that clients may trigger, of the \d+ that the server handles\n$/,
    )
    expect(stdout).toContain(`High: what any client gains
  evil  evil:admin()  every command
`)
    expect(stdout).toContain(`Medium: what any client changes
  evil  evil:log  database: logs
`)
    expect(stdout).toContain(`Low: errors on what clients send
  evil  evil:crash()  error: [script:evil] SCRIPT ERROR: @evil/server.lua:13: attempt to index a nil value (local 'data')
`)
    expect(stdout).not.toContain('evil:local')
  }, 60000)

  it('tells what it found as JSON, and passes a server that trusts no client', async () => {
    const cwd = write({
      'fxmanifest.lua': `fx_version 'cerulean'
game 'gta5'
server_script 'server.lua'
`,
      'server.lua': `RegisterNetEvent('shop:buy', function(item)
    if type(item) ~= 'string' then return end
    print(('%d asked for %s'):format(source, item))
end)
`,
    })
    const { code, stdout } = await audit(cwd, ['--json'])
    expect(code).toBe(0)
    const records = JSON.parse(stdout) as { type: string; event?: string; open?: boolean }[]
    expect(records.filter((record) => record.type === 'finding')).toEqual([])
    expect(records.find((record) => record.event === 'shop:buy')).toMatchObject({
      type: 'event',
      open: true,
    })
    expect(records.at(-1)).toEqual({ type: 'end' })
  }, 60000)

  it('says what it takes, and that it needs a project', async () => {
    expect((await audit(root, ['--help'])).stdout).toContain('Usage: fiverunner audit')
    expect(await audit(root, ['--nope'])).toMatchObject({ code: 2 })
    expect(await audit(root)).toMatchObject({ code: 2 })
  })
})
