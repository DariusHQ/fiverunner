-- Qbox's Stable recipe of txAdmin on FiveRunner: its resources start, and a
-- player takes a car out of a garage, as players do.

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

--- The last message of `action` that the client of `player` sent the page of ox_lib.
local function shown(player, action)
    local messages = player:nuiMessages('ox_lib')
    for i = #messages, 1, -1 do
        if messages[i].action == action then return messages[i].data end
    end
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
