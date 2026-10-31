local GARAGE = vector3(215.0, -835.0, 30.0)

CreateThread(function()
    exports.city:blip(GARAGE, 357, 3, 'Garage')
    exports.city:place(GARAGE, 'E - Take a car out for $50', function()
        TriggerServerEvent('city_garage:takeOut')
    end)
end)
