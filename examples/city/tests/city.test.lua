-- Citizens move in through a card, buy food, take a car out and write to each other.

--- The last message that the client of `player` sent the page of `resource` with `key`.
local function sent(player, resource, key)
    local messages = player:nuiMessages(resource)
    for i = #messages, 1, -1 do
        if messages[i][key] ~= nil then return messages[i][key] end
    end
end

--- A player who moved in, with what they answer the card with.
local function moveIn(name)
    local player = fiverunner.connect({
        name = name,
        identifiers = { 'license:' .. name },
        card = { name = name .. ' Lee', rules = 'true' },
    })
    fiverunner.waitFor(function() return sent(player, 'city', 'name') end, 3000)
    return player
end

--- Has `player` stand at `x`, `y`.
local function walkTo(player, x, y)
    player:run('local x, y = ... SetEntityCoords(PlayerPedId(), x, y, 30.0, false, false, false, false)', x, y)
end

--- Has `player` press E where a hint tells them to.
local function pressAt(player, x, y, hint)
    walkTo(player, x, y)
    fiverunner.waitFor(function() return sent(player, 'city', 'hint') == hint end, 1000)
    player:press('E')
end

it('keeps out who does not agree to keep the peace', function()
    local player, reason = fiverunner.connect({
        name = 'Bo',
        identifiers = { 'license:bo' },
        card = { name = 'Bo', rules = 'false' },
    })
    expect(player).toBeNil()
    expect(reason).toBe('Pick a name, and agree to keep the peace')
end)

it('lets citizens in, with their money, and keeps them in the database', function()
    local ann = moveIn('Ann')
    expect(sent(ann, 'city', 'name')).toBe('Ann Lee')
    expect(sent(ann, 'city', 'money')).toBe(500)
    local saved = exports.oxmysql:single_async('SELECT name, money FROM citizens WHERE license = ?', { 'license:Ann' })
    expect(saved).toEqual({ name = 'Ann Lee', money = 500 })
end)

it('sells food, which citizens carry and eat', function()
    local ann = moveIn('Ann')
    pressAt(ann, 185.0, -835.0, 'E - Buy a sandwich for $12')
    fiverunner.waitFor(function() return sent(ann, 'city', 'money') == 488 end, 1000)
    ann:press('I')
    local items = fiverunner.waitFor(function() return sent(ann, 'city_inventory', 'items') end, 1000)
    expect(items[1].label).toBe('Sandwich')
    expect(items[1].amount).toBe(1)
    expect(ann:nuiFocus()).toBe(true)
    ann:nuiCallback('city_inventory', 'use', { item = 'sandwich' })
    ann:nuiCallback('city_inventory', 'close', {})
    expect(ann:nuiFocus()).toBe(false)
    fiverunner.waitFor(function() return #sent(ann, 'city_inventory', 'items') == 0 end, 1000)
end)

it('lends cars, for a fee', function()
    local ann = moveIn('Ann')
    pressAt(ann, 215.0, -835.0, 'E - Take a car out for $50')
    fiverunner.waitFor(function() return ann:run('return IsPedInAnyVehicle(PlayerPedId(), false)') end, 2000)
    expect(ann:run('return GetVehicleNumberPlateText(GetVehiclePedIsIn(PlayerPedId(), false))')).toBe('CITY')
    expect(sent(ann, 'city', 'money')).toBe(450)
end)

it('carries messages between citizens, in JavaScript', function()
    local ann = moveIn('Ann')
    local bob = moveIn('Bob')
    ann:press('M')
    local phone = fiverunner.waitFor(function() return sent(ann, 'city_phone', 'phone') end, 1000)
    expect(phone.contacts[1].name).toBe('Bob Lee')
    ann:nuiCallback('city_phone', 'send', { receiver = 'Bob Lee', text = 'Hi Bob' })
    local message = fiverunner.waitFor(function() return sent(bob, 'city_phone', 'message') end, 1000)
    expect(message).toEqual({ sender = 'Ann Lee', text = 'Hi Bob' })
    local saved = exports.oxmysql:single_async('SELECT sender, text FROM messages WHERE receiver = ?', { 'Bob Lee' })
    expect(saved).toEqual({ sender = 'Ann Lee', text = 'Hi Bob' })
end)
