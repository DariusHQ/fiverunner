-- Qbox's Stable recipe of txAdmin on FiveRunner: its resources start, and
-- players take a car out of a garage, pick clothes, and open their inventory
-- and the bank, as players do.

local CHARINFO = {
    firstname = 'Ann',
    lastname = 'Lee',
    birthdate = '1990-01-01',
    gender = 1,
    nationality = 'Romania',
}

--- The errors of scripts in `output`, but those of npwd, whose phone is JavaScript, which FiveRunner does not run.
local function errors(output)
    local found = {}
    for _, line in ipairs(output) do
        if line:find('SCRIPT ERROR', 1, true) and not line:find('npwd', 1, true) then found[#found + 1] = line end
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

--- The data of the last message of `action` that the client of `player` sent the page of ox_lib.
local function shown(player, action)
    return (message(player, 'ox_lib', action) or {}).data
end

--- Clicks the option of the menu of ox_lib whose title is `title`, as its page does.
local function choose(player, title)
    for i, option in ipairs(shown(player, 'showContext').options) do
        if option.title == title then return player:nuiCallback('ox_lib', 'clickContext', i - 1) end
    end
    error(('the menu has no option %s'):format(title))
end

it('starts its resources', function()
    while GetGameTimer() < 3000 do Wait(100) end
    expect(GetResourceState('qbx_garages')).toBe('started')
    expect(errors(fiverunner.output())).toEqual({})
end)

it('lets a player take a car out of a garage', function()
    while GetGameTimer() < 3000 do Wait(100) end
    local player = fiverunner.connect({ name = 'Ann', identifiers = { 'license:ann' } })
    expect(exports.qbx_core:Login(player.id, nil, { charinfo = CHARINFO })).toBe(true)
    local citizenid = exports.qbx_core:GetPlayer(player.id).PlayerData.citizenid
    exports.qbx_vehicles:CreatePlayerVehicle({ model = 'adder', citizenid = citizenid, garage = 'motelgarage' })
    -- The player walks up to the Motel Parking.
    player:run('SetEntityCoords(PlayerPedId(), 275.58, -344.74, 45.17, false, false, false, false)')
    fiverunner.waitFor(function() return shown(player, 'textUi') end, 3000)
    expect(shown(player, 'textUi').text).toBe('E - Open Garage')
    player:press('E')
    fiverunner.waitFor(function()
        local menu = shown(player, 'showContext')
        return menu and menu.title == 'Motel Parking'
    end, 3000)
    choose(player, 'Truffade Adder')
    fiverunner.waitFor(function() return shown(player, 'showContext').options[1].title == 'Information' end, 3000)
    choose(player, 'Take Out')
    local car = fiverunner.waitFor(function()
        for _, vehicle in ipairs(GetAllVehicles()) do
            if Entity(vehicle).state.vehicleid then return vehicle end
        end
    end, 10000)
    -- qbx_garages spawns the car where the Motel Parking has its cars come out.
    expect(#(GetEntityCoords(car) - vec3(271.26, -342.32, 44.7)) < 1).toBe(true)
    expect(errors(fiverunner.output())).toEqual({})
    expect(errors(player:output())).toEqual({})
end, 30000)

it('gives the appearance editor the clothes and the colours of freemode characters to pick from', function()
    while GetGameTimer() < 3000 do Wait(100) end
    local player = fiverunner.connect({ name = 'Ann', identifiers = { 'license:ann' } })
    player:run([[
        CreateThread(function()
            local model = `mp_f_freemode_01`
            RequestModel(model)
            while not HasModelLoaded(model) do Wait(0) end
            SetPlayerModel(PlayerId(), model)
        end)
    ]])
    -- The cache of ox_lib, which illenium-appearance reads the ped of, takes the new ped within a second.
    Wait(1000)
    local settings = player:nuiCallback('illenium-appearance', 'appearance_get_settings', {}).appearanceSettings
    expect({
        settings.components[12].drawable.max,
        settings.components[12].texture.max,
        settings.props[1].drawable.max,
        settings.headOverlays.beard.style.max,
        #settings.headOverlays.lipstick.color.items,
    }).toEqual({ 399, 9, 179, 28, 64 })
    expect(errors(player:output())).toEqual({})
end, 30000)

it('lets a player open the inventory, on its default key, and the bank', function()
    while GetGameTimer() < 3000 do Wait(100) end
    local player = fiverunner.connect({ name = 'Ann', identifiers = { 'license:ann' } })
    -- The client starts its resources, and shows the menu of characters, before the server logs its player in.
    fiverunner.waitFor(function() return shown(player, 'showContext') end, 10000)
    -- The page of ox_inventory tells its client that it loaded, as it does in a browser, which the client waits for.
    player:nuiCallback('ox_inventory', 'uiLoaded', {})
    expect(exports.qbx_core:Login(player.id, nil, { charinfo = CHARINFO })).toBe(true)
    fiverunner.waitFor(function() return message(player, 'ox_inventory', 'init') end, 5000)
    Wait(500)
    player:press('F2')
    local inventory = fiverunner.waitFor(function() return message(player, 'ox_inventory', 'setupInventory') end, 3000)
    expect(inventory.data.leftInventory.label).toBe('Ann Lee')
    player:press('F2')
    TriggerClientEvent('Renewed-Banking:client:openBankUI', player.id, { atm = false })
    fiverunner.waitFor(function() return shown(player, 'progress') or shown(player, 'circleProgress') end, 3000)
    -- The page of ox_lib completes the progress as its bar fills, which takes the bank 5 seconds at most.
    Wait(5000)
    player:nuiCallback('ox_lib', 'progressComplete', {})
    local bank = fiverunner.waitFor(function() return message(player, 'Renewed-Banking', 'setVisible') end, 3000)
    expect({ bank.accounts[1].name, bank.accounts[1].amount }).toEqual({ 'Ann Lee', 5000 })
    expect(errors(fiverunner.output())).toEqual({})
    expect(errors(player:output())).toEqual({})
end, 30000)
