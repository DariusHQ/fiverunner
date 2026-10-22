-- QBox on FiveRunner: qbx_core, ox_lib, ox_inventory and qbx_vehicles, as
-- their releases are, on FiveRunner's database.

local CHARINFO = {
    firstname = 'Ann',
    lastname = 'Lee',
    birthdate = '1990-01-01',
    gender = 0,
    nationality = 'Romania',
}

--- Connects a player with a license, and logs it in with a new character.
local function login(name)
    local player = fiverunner.connect({ name = name, identifiers = { 'license:' .. name } })
    expect(exports.qbx_core:Login(player.id, nil, { charinfo = CHARINFO })).toBe(true)
    -- ox_inventory loads the inventory of the character as it logs in.
    fiverunner.waitFor(function() return exports.ox_inventory:GetInventory(player.id) end, 1000)
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
    for _, name in ipairs({ 'ox_lib', 'qbx_core', 'qbx_vehicles', 'ox_inventory' }) do
        expect(GetResourceState(name)).toBe('started')
    end
    local ann = login('ann')
    expect(errors(fiverunner.output())).toEqual({})
    expect(errors(ann:output())).toEqual({})
end)

it('logs players in with characters that the database keeps', function()
    local ann = login('ann')
    local data = exports.qbx_core:GetPlayer(ann.id).PlayerData
    expect(data.charinfo.firstname).toBe('Ann')
    expect(data.license).toBe('license:ann')
    local saved = exports.oxmysql:single_async('SELECT license, charinfo FROM players WHERE citizenid = ?', { data.citizenid })
    expect(saved.license).toBe('license:ann')
    expect(json.decode(saved.charinfo).lastname).toBe('Lee')
end)

it('keeps cash as the money of the inventory', function()
    local ann = login('ann')
    local cash = exports.qbx_core:GetMoney(ann.id, 'cash')
    expect(exports.ox_inventory:GetItemCount(ann.id, 'money')).toBe(cash)
    expect(exports.qbx_core:AddMoney(ann.id, 'cash', 250)).toBe(true)
    expect(exports.qbx_core:GetMoney(ann.id, 'cash')).toBe(cash + 250)
    fiverunner.waitFor(function() return exports.ox_inventory:GetItemCount(ann.id, 'money') == cash + 250 end, 1000)
end)

it('gives and takes items', function()
    local ann = login('ann')
    expect(exports.ox_inventory:AddItem(ann.id, 'water', 3)).toBe(true)
    expect(exports.ox_inventory:RemoveItem(ann.id, 'water', 1)).toBe(true)
    expect(exports.ox_inventory:GetItemCount(ann.id, 'water')).toBe(2)
    expect(exports.ox_inventory:CanCarryItem(ann.id, 'water', 1)).toBe(true)
end)

it('gives players jobs', function()
    local ann = login('ann')
    expect(exports.qbx_core:SetJob(ann.id, 'police', 2)).toBe(true)
    local job = exports.qbx_core:GetPlayer(ann.id).PlayerData.job
    expect(job.name).toBe('police')
    expect(job.grade.level).toBe(2)
end)

it('saves the characters of players that leave', function()
    local ann = login('ann')
    local citizenid = exports.qbx_core:GetPlayer(ann.id).PlayerData.citizenid
    exports.qbx_core:AddMoney(ann.id, 'bank', 1000)
    local bank = exports.qbx_core:GetMoney(ann.id, 'bank')
    ann:disconnect('bye')
    fiverunner.waitFor(function()
        local money = exports.oxmysql:scalar_async('SELECT money FROM players WHERE citizenid = ?', { citizenid })
        return money and json.decode(money).bank == bank
    end, 5000)
end)
