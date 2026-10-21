import type { StateBag, StateBags } from '../statebags.ts'
import type { SyncEntity } from './entity.ts'

/**
 * Gives an entity of a server the state bag of a name, which goes with the
 * entity, and which the game state routes to the slots of the clients that
 * have the entity, as FiveM's server does once a script or a client asked
 * for it. The bag takes keys from the slot of the owner of the entity
 * alone from the next time it changes owners, or from that of no client
 * when none owns it.
 */
export function bindEntityBag(states: StateBags, name: string, entity: SyncEntity): StateBag {
  const bag = states.register(name)
  entity.bag = {
    route: (client) => bag.addRoutingTarget(client.slot!),
    unroute: (client) => bag.removeRoutingTarget(client.slot!),
    own: (owner) => {
      bag.owner = owner === undefined ? -1 : owner.slot!
    },
    remove: () => states.remove(name),
  }
  return bag
}
