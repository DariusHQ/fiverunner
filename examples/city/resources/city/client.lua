local SQUARE = vector3(200.0, -850.0, 30.0)

CreateThread(function()
    SetEntityCoords(PlayerPedId(), SQUARE.x, SQUARE.y, SQUARE.z, false, false, false, false)
    TriggerServerEvent('city:arrived')
end)

RegisterNetEvent('city:citizen', function(citizen)
    SendNUIMessage({ name = citizen.name, money = citizen.money })
end)

RegisterNetEvent('city:money', function(money)
    SendNUIMessage({ money = money })
end)

--- Tells the player what a key does where they stand, or nothing.
exports('hint', function(text)
    SendNUIMessage({ hint = text or '' })
end)

--- Watches a place: `action` runs as the player presses E within 3 metres of it, as `hint` tells them.
exports('place', function(coords, hint, action)
    CreateThread(function()
        local near = false
        while true do
            local isNear = #(GetEntityCoords(PlayerPedId()) - coords) < 3.0
            if isNear ~= near then
                near = isNear
                SendNUIMessage({ hint = near and hint or '' })
            end
            if near and IsControlJustReleased(0, 38) then action() end
            Wait(0)
        end
    end)
end)

--- A blip of the map.
exports('blip', function(coords, sprite, colour, label)
    local blip = AddBlipForCoord(coords.x, coords.y, coords.z)
    SetBlipSprite(blip, sprite)
    SetBlipColour(blip, colour)
    BeginTextCommandSetBlipName('STRING')
    AddTextComponentSubstringPlayerName(label)
    EndTextCommandSetBlipName(blip)
end)
