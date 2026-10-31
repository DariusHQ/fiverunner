local SPOT = vector4(219.0, -829.0, 30.0, 90.0)
local FEE = 50

RegisterNetEvent('city_garage:takeOut', function()
    local player = source
    if not exports.city:pay(player, -FEE) then return end
    local car = CreateVehicleServerSetter(`adder`, 'automobile', SPOT.x, SPOT.y, SPOT.z, SPOT.w)
    -- The client that owns the car seats its driver, once it has it.
    while NetworkGetEntityOwner(car) == -1 do Wait(0) end
    SetVehicleNumberPlateText(car, 'CITY')
    SetPedIntoVehicle(GetPlayerPed(player), car, -1)
end)
