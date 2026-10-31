local ITEMS = {
    water = { label = 'Water', icon = '💧', price = 5 },
    sandwich = { label = 'Sandwich', icon = '🥪', price = 12 },
}

local function citizenOf(player)
    return GetPlayerIdentifierByType(player, 'license')
end

--- What a player carries, as the page of the inventory shows it.
local function itemsOf(player)
    local rows = MySQL.query.await('SELECT item, amount FROM items WHERE citizen = ? ORDER BY item', { citizenOf(player) })
    for _, row in ipairs(rows) do
        row.label = ITEMS[row.item].label
        row.icon = ITEMS[row.item].icon
    end
    return rows
end

local function show(player)
    TriggerClientEvent('city_inventory:items', player, itemsOf(player))
end

local function give(player, item, amount)
    MySQL.prepare.await(
        'INSERT INTO items (citizen, item, amount) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE amount = amount + VALUES(amount)',
        { citizenOf(player), item, amount }
    )
end

RegisterNetEvent('city_inventory:open', function()
    show(source)
end)

RegisterNetEvent('city_inventory:buy', function(item)
    local player = source
    if ITEMS[item] ~= nil and exports.city:pay(player, -ITEMS[item].price) then
        give(player, item, 1)
        show(player)
    end
end)

RegisterNetEvent('city_inventory:use', function(item)
    local player = source
    local citizen = citizenOf(player)
    if MySQL.update.await('UPDATE items SET amount = amount - 1 WHERE citizen = ? AND item = ? AND amount > 0', { citizen, item }) == 0 then
        return
    end
    MySQL.update.await('DELETE FROM items WHERE citizen = ? AND amount = 0', { citizen })
    show(player)
end)

exports('give', give)
