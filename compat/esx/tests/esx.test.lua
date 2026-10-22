-- ESX on FiveRunner: es_extended and the resources of its [core], as its
-- release is, with its legacy.sql, on FiveRunner's database.

local ESX = exports.es_extended:getSharedObject()

--- Connects a player with a license, again until ESX, which turns players away until its database is ready, takes it, and waits for its client to spawn it, as ESX saves only players that spawned.
local function join(name)
    local player = fiverunner.connect({ name = name, identifiers = { 'license:' .. name } })
    while not player do
        Wait(100)
        player = fiverunner.connect({ name = name, identifiers = { 'license:' .. name } })
    end
    fiverunner.waitFor(function()
        local xPlayer = ESX.GetPlayerFromId(player.id)
        return xPlayer and xPlayer.spawned
    end, 3000)
    return player
end

--- The lines of `output` that tell of errors of scripts.
local function errors(output)
    local found = {}
    for _, line in ipairs(output) do
        if line:find('SCRIPT ERROR', 1, true) then found[#found + 1] = line end
    end
    return found
end

it('starts the resources without errors', function()
    local ann = join('ann')
    expect(errors(fiverunner.output())).toEqual({})
    expect(errors(ann:output())).toEqual({})
end)

it('loads players, whom the database keeps', function()
    local ann = join('ann')
    local xPlayer = ESX.GetPlayerFromId(ann.id)
    expect(xPlayer.getIdentifier()).toBe('ann')
    local accounts = exports.oxmysql:scalar_async('SELECT accounts FROM users WHERE identifier = ?', { 'ann' })
    expect(json.decode(accounts).bank).toBe(xPlayer.getAccount('bank').money)
end)

it('gives and takes money', function()
    local ann = join('ann')
    local xPlayer = ESX.GetPlayerFromId(ann.id)
    local cash, bank = xPlayer.getMoney(), xPlayer.getAccount('bank').money
    xPlayer.addMoney(250)
    xPlayer.removeAccountMoney('bank', 100)
    xPlayer = ESX.GetPlayerFromId(ann.id)
    expect(xPlayer.getMoney()).toBe(cash + 250)
    expect(xPlayer.getAccount('bank').money).toBe(bank - 100)
end)

it('gives and takes items', function()
    local ann = join('ann')
    local xPlayer = ESX.GetPlayerFromId(ann.id)
    expect(xPlayer.canCarryItem('bread', 3)).toBe(true)
    xPlayer.addInventoryItem('bread', 3)
    xPlayer.removeInventoryItem('bread', 1)
    expect(ESX.GetPlayerFromId(ann.id).getInventoryItem('bread').count).toBe(2)
end)

it('gives players jobs', function()
    local ann = join('ann')
    ESX.GetPlayerFromId(ann.id).setJob('police', 1)
    local job = ESX.GetPlayerFromId(ann.id).getJob()
    expect(job.name).toBe('police')
    expect(job.grade).toBe(1)
end)

it('saves the players that leave', function()
    local ann = join('ann')
    ESX.GetPlayerFromId(ann.id).addAccountMoney('bank', 1000)
    local bank = ESX.GetPlayerFromId(ann.id).getAccount('bank').money
    ann:disconnect('bye')
    fiverunner.waitFor(function()
        local accounts = exports.oxmysql:scalar_async('SELECT accounts FROM users WHERE identifier = ?', { 'ann' })
        return accounts and json.decode(accounts).bank == bank
    end, 2000)
end)
