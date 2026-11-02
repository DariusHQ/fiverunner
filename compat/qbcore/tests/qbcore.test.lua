-- QBCore's recipe of txAdmin on FiveRunner: its resources start, and players
-- create characters in the page of qb-multicharacter, earn money, carry items,
-- get jobs and are saved as they leave.

local QBCore = exports['qb-core']:GetCoreObject()

local CHARACTER = {
    firstname = 'Ann',
    lastname = 'Lee',
    nationality = 'Romania',
    birthdate = '1990-01-01',
    gender = 'Female',
    cid = 1,
}

--- The errors of scripts in `output`.
local function errors(output)
    local found = {}
    for _, line in ipairs(output) do
        if line:find('SCRIPT ERROR', 1, true) or line:find('Failed to load script', 1, true) then
            found[#found + 1] = line
        end
    end
    return found
end

--- The last message of `action` that the client of `player` sent the page of `resource`.
local function message(player, resource, action)
    local messages = player:nuiMessages(resource)
    for i = #messages, 1, -1 do
        if messages[i].action == action then return messages[i] end
    end
end

--- Connects a player with a license once the server started, as players join started servers, until its character menu shows.
local function join(name)
    while GetGameTimer() < 3000 do Wait(100) end
    local player = fiverunner.connect({ name = name, identifiers = { 'license:' .. name } })
    fiverunner.waitFor(function() return message(player, 'qb-multicharacter', 'ui') end, 10000)
    return player
end

--- Creates a character in the page of qb-multicharacter, as players do, until the server gave it its starter items.
local function login(name)
    local player = join(name)
    player:nuiCallback('qb-multicharacter', 'createNewCharacter', CHARACTER)
    fiverunner.waitFor(function() return message(player, 'qb-spawn', 'showUi') end, 10000)
    return player, QBCore.Functions.GetPlayer(player.id)
end

--- Picks where a new character starts, in the page of qb-spawn, which takes it to its apartment.
local function start(player)
    fiverunner.waitFor(function() return message(player, 'qb-spawn', 'setupAppartements') end, 3000)
    player:nuiCallback('qb-spawn', 'chooseAppa', { appType = 'apartment1' })
end

it('starts the resources without errors', function()
    local player = login('ann')
    expect(GetResourceState('qb-core')).toBe('started')
    expect(errors(fiverunner.output())).toEqual({})
    expect(errors(player:output())).toEqual({})
end, 120000)

it('shows its character menu in the page of qb-multicharacter', function()
    local player = join('ann')
    expect(player:nuiFocus()).toBe(true)
    expect(message(player, 'qb-multicharacter', 'ui').toggle).toBe(true)
    player:nuiCallback('qb-multicharacter', 'setupCharacters', {})
    expect(#fiverunner.waitFor(function() return message(player, 'qb-multicharacter', 'setupCharacters') end, 1000).characters).toBe(0)
end, 120000)

it('keeps the characters that players create in the database', function()
    local _, ann = login('ann')
    expect(ann.PlayerData.charinfo.firstname).toBe('Ann')
    expect(ann.PlayerData.charinfo.gender).toBe(1)
    expect(ann.PlayerData.license).toBe('license:ann')
    local saved = exports.oxmysql:single_async('SELECT license, charinfo FROM players WHERE citizenid = ?', { ann.PlayerData.citizenid })
    expect(saved.license).toBe('license:ann')
    expect(json.decode(saved.charinfo).lastname).toBe('Lee')
end, 120000)

it('gives and takes money', function()
    local _, ann = login('ann')
    local cash, bank = ann.PlayerData.money.cash, ann.PlayerData.money.bank
    expect(ann.Functions.AddMoney('cash', 250, 'test')).toBe(true)
    expect(ann.Functions.RemoveMoney('bank', 100, 'test')).toBe(true)
    expect(ann.Functions.GetMoney('cash')).toBe(cash + 250)
    expect(ann.Functions.GetMoney('bank')).toBe(bank - 100)
    expect(ann.Functions.RemoveMoney('cash', 1000000, 'test')).toBe(false)
end, 120000)

it('gives and takes items', function()
    local player = login('ann')
    expect(exports['qb-inventory']:AddItem(player.id, 'water_bottle', 3, false, false, 'test')).toBe(true)
    expect(exports['qb-inventory']:RemoveItem(player.id, 'water_bottle', 1, false, 'test')).toBe(true)
    expect(exports['qb-inventory']:GetItemCount(player.id, 'water_bottle')).toBe(2)
    expect(exports['qb-inventory']:HasItem(player.id, 'water_bottle', 2)).toBe(true)
end, 120000)

it('gives players jobs', function()
    local player, ann = login('ann')
    expect(ann.Functions.SetJob('police', 2)).toBe(true)
    local job = QBCore.Functions.GetPlayer(player.id).PlayerData.job
    expect(job.name).toBe('police')
    expect(job.grade.level).toBe(2)
end, 120000)

it('saves the characters of players that leave', function()
    local player, ann = login('ann')
    local citizenid = ann.PlayerData.citizenid
    ann.Functions.AddMoney('bank', 1000, 'test')
    local bank = ann.Functions.GetMoney('bank')
    player:disconnect('bye')
    fiverunner.waitFor(function()
        local money = exports.oxmysql:scalar_async('SELECT money FROM players WHERE citizenid = ?', { citizenid })
        return money and json.decode(money).bank == bank
    end, 5000)
end, 120000)

it('takes new characters through the menu of where to start, to their first clothes', function()
    local player = login('ann')
    start(player)
    fiverunner.waitFor(function() return message(player, 'qb-clothing', 'open') end, 15000)
    expect(errors(fiverunner.output())).toEqual({})
    expect(errors(player:output())).toEqual({})
end, 120000)

it('lets a player open the inventory, on the key that binds it, with what the character starts with', function()
    local player = login('ann')
    start(player)
    fiverunner.waitFor(function() return message(player, 'qb-clothing', 'open') end, 15000)
    player:nuiCallback('qb-clothing', 'resetOutfit', {})
    player:nuiCallback('qb-clothing', 'close', {})
    Wait(1000)
    player:press('TAB')
    local inventory = fiverunner.waitFor(function() return message(player, 'qb-inventory', 'open') end, 3000)
    local names = {}
    for _, item in pairs(inventory.inventory) do names[item.name] = true end
    expect(names.phone).toBe(true)
    expect(names.id_card).toBe(true)
    expect(errors(player:output())).toEqual({})
end, 120000)

it('lets a player open the bank, at its counter', function()
    local player = login('ann')
    player:run('SetEntityCoords(PlayerPedId(), 149.91, -1040.74, 29.37, false, false, false, false)')
    fiverunner.waitFor(function() return message(player, 'qb-core', 'DRAW_TEXT') end, 3000)
    player:press('E')
    local open = fiverunner.waitFor(function() return message(player, 'qb-banking', 'openBank') end, 3000)
    expect({ open.accounts[1].account_name, open.accounts[1].account_balance }).toEqual({ 'checking', 5000 })
    expect(open.playerData.charinfo.firstname).toBe('Ann')
    expect(errors(player:output())).toEqual({})
end, 120000)

it('lets a player take a car out of a garage, with all that the database keeps of it', function()
    local player, ann = login('ann')
    local data = ann.PlayerData
    local mods = json.encode({
        plate = 'ANNLEE01',
        model = joaat('adder'),
        color1 = 12,
        color2 = 34,
        modEngine = 3,
        modTurbo = true,
        bodyHealth = 900.0,
        engineHealth = 800.0,
        fuelLevel = 40.0,
        windowTint = 2,
    })
    exports.oxmysql:insert_async(
        'INSERT INTO player_vehicles (license, citizenid, vehicle, hash, mods, plate, garage, fuel, engine, body, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        { data.license, data.citizenid, 'adder', joaat('adder'), mods, 'ANNLEE01', 'motelgarage', 40, 800, 900, 1 }
    )
    -- New characters wait in a routing bucket of their own, as they pick where to start, from which no cars can be seen.
    SetPlayerRoutingBucket(player.id, 0)
    -- The player walks up to the Motel Parking.
    player:run('SetEntityCoords(PlayerPedId(), 274.29, -334.15, 44.92, false, false, false, false)')
    fiverunner.waitFor(function() return message(player, 'qb-core', 'DRAW_TEXT') end, 3000)
    player:press('E')
    local list = fiverunner.waitFor(function() return message(player, 'qb-garages', 'VehicleList') end, 3000)
    expect(list.garageLabel).toBe('Motel Parking')
    local vehicle = list.vehicles[1]
    expect(vehicle.plate).toBe('ANNLEE01')
    player:nuiCallback('qb-garages', 'takeOutVehicle', {
        plate = vehicle.plate,
        vehicle = vehicle.vehicle,
        garage = vehicle.garage,
        index = vehicle.index,
        type = vehicle.type,
        stats = { fuel = vehicle.fuel, engine = vehicle.engine, body = vehicle.body },
    })
    local car = fiverunner.waitFor(function()
        for _, handle in ipairs(GetAllVehicles()) do
            if GetVehicleNumberPlateText(handle) == 'ANNLEE01' then return handle end
        end
    end, 10000)
    local netId = NetworkGetNetworkIdFromEntity(car)
    Wait(1500)
    player:run(([[
        local car = NetworkGetEntityFromNetworkId(%d)
        local primary, secondary = GetVehicleColours(car)
        print('car', primary, secondary, GetVehicleMod(car, 11), IsToggleModOn(car, 18), GetVehicleWindowTint(car), GetVehicleBodyHealth(car), GetVehicleEngineHealth(car), GetVehicleFuelLevel(car))
    ]]):format(netId))
    Wait(100)
    local found
    for _, line in ipairs(player:output()) do
        if line:find('car\t', 1, true) then found = line:match('car\t(.*)') end
    end
    expect(found).toBe('12\t34\t3\t1\t2\t900.0\t800.0\t40.0')
    expect(exports.oxmysql:scalar_async('SELECT state FROM player_vehicles WHERE plate = ?', { 'ANNLEE01' })).toBe(0)
    expect(errors(fiverunner.output())).toEqual({})
    expect(errors(player:output())).toEqual({})
end, 120000)
