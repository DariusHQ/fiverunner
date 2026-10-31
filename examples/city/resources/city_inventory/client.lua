local SHOP = vector3(185.0, -835.0, 30.0)

CreateThread(function()
    exports.city:blip(SHOP, 52, 2, 'Shop')
    exports.city:place(SHOP, 'E - Buy a sandwich for $12', function()
        TriggerServerEvent('city_inventory:buy', 'sandwich')
    end)
end)

RegisterCommand('inventory', function()
    TriggerServerEvent('city_inventory:open')
    SetNuiFocus(true, true)
    SendNUIMessage({ open = true })
end, false)
RegisterKeyMapping('inventory', 'Open the inventory', 'keyboard', 'I')

RegisterNetEvent('city_inventory:items', function(items)
    SendNUIMessage({ items = items })
end)

RegisterNUICallback('use', function(data, reply)
    TriggerServerEvent('city_inventory:use', data.item)
    reply({})
end)

RegisterNUICallback('close', function(_, reply)
    SetNuiFocus(false, false)
    reply({})
end)
