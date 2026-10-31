RegisterCommand(
  'phone',
  () => {
    emitNet('city_phone:open')
    SetNuiFocus(true, true)
  },
  false,
)
RegisterKeyMapping('phone', 'Open the phone', 'keyboard', 'M')

onNet('city_phone:opened', (phone) => SendNUIMessage({ phone }))
onNet('city_phone:message', (message) => SendNUIMessage({ message }))

RegisterNuiCallback('send', ({ receiver, text }, reply) => {
  emitNet('city_phone:send', receiver, text)
  reply({})
})

RegisterNuiCallback('close', (_data, reply) => {
  SetNuiFocus(false, false)
  reply({})
})
