const nameOf = (player) => exports.city.nameOf(player)

/** Those who are in the city, by their names. */
const contacts = () =>
  getPlayers()
    .map(Number)
    .flatMap((player) => {
      const name = nameOf(player)
      return name ? [{ player, name }] : []
    })

const inbox = (name) =>
  exports.oxmysql.query_async(
    'SELECT sender, text FROM messages WHERE receiver = ? ORDER BY id DESC LIMIT 20',
    [name],
  )

onNet('city_phone:open', async () => {
  const player = source
  emitNet('city_phone:opened', player, {
    contacts: contacts().filter((contact) => contact.player !== player),
    messages: await inbox(nameOf(player)),
  })
})

onNet('city_phone:send', async (receiver, text) => {
  const sender = nameOf(source)
  const contact = contacts().find(({ name }) => name === receiver)
  if (!sender || !contact || typeof text !== 'string' || text === '') return
  const saved = text.slice(0, 200)
  await exports.oxmysql.insert_async(
    'INSERT INTO messages (sender, receiver, text) VALUES (?, ?, ?)',
    [sender, receiver, saved],
  )
  emitNet('city_phone:message', contact.player, { sender, text: saved })
})
