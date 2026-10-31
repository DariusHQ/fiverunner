-- Those who are in the city, by their ids.
local citizens = {}

local CARD = json.encode({
    type = 'AdaptiveCard',
    version = '1.3',
    body = {
        { type = 'TextBlock', size = 'Large', weight = 'Bolder', text = 'Welcome to the city' },
        { type = 'TextBlock', text = 'Pick a name, and keep the peace.', wrap = true },
        { type = 'Input.Text', id = 'name', placeholder = 'Your name', maxLength = 40 },
        { type = 'Input.Toggle', id = 'rules', title = 'I will keep the peace', value = 'false' },
    },
    actions = { { type = 'Action.Submit', title = 'Move in' } },
})

local function licenseOf(player)
    return GetPlayerIdentifierByType(player, 'license')
end

-- Those who are new move in through a card, which keeps out who does not agree.
AddEventHandler('playerConnecting', function(_, _, deferrals)
    local license = licenseOf(source)
    deferrals.defer()
    Wait(0)
    if MySQL.scalar.await('SELECT 1 FROM citizens WHERE license = ?', { license }) then
        deferrals.done()
        return
    end
    deferrals.presentCard(CARD, function(answer)
        if answer.rules ~= 'true' or answer.name == '' then
            deferrals.done('Pick a name, and agree to keep the peace')
            return
        end
        MySQL.insert('INSERT INTO citizens (license, name) VALUES (?, ?)', { license, answer.name }, function()
            deferrals.done()
        end)
    end)
end)

RegisterNetEvent('city:arrived', function()
    local player = source
    citizens[player] = MySQL.single.await('SELECT name, money FROM citizens WHERE license = ?', { licenseOf(player) })
    TriggerClientEvent('city:citizen', player, citizens[player])
end)

AddEventHandler('playerDropped', function()
    citizens[source] = nil
end)

exports('nameOf', function(player)
    return citizens[player] and citizens[player].name
end)

--- Gives a player `amount`, or takes it if it is negative, unless they do not have it.
exports('pay', function(player, amount)
    local citizen = citizens[player]
    if citizen == nil or citizen.money + amount < 0 then return false end
    citizen.money = citizen.money + amount
    MySQL.update('UPDATE citizens SET money = ? WHERE license = ?', { citizen.money, licenseOf(player) })
    TriggerClientEvent('city:money', player, citizen.money)
    return true
end)
