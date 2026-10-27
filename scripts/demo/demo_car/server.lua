-- A character that has no car gets one in the Motel Parking as it logs in.
AddEventHandler('QBCore:Server:PlayerLoaded', function(player)
    local citizenid = player.PlayerData.citizenid
    if #exports.qbx_vehicles:GetPlayerVehicles({ citizenid = citizenid }) == 0 then
        exports.qbx_vehicles:CreatePlayerVehicle({ model = 'adder', citizenid = citizenid, garage = 'motelgarage' })
    end
end)
