import { defineNative, type NativeDefinition, type Side } from '../../natives/index.ts'
import type { NativeContext } from '../context.ts'
import type { ClientEntity } from '../world/client.ts'
import { EntityType, entityTypeOf, type SyncEntity } from '../world/entity.ts'
import { clientEntityOf, entityOf, gameStateOf } from './entities.ts'

/** The entity of a handle on a client, if it is of an entity type. */
function clientOfType(ctx: NativeContext, handle: number, type: number): ClientEntity | undefined {
  const found = clientEntityOf(ctx, handle)
  return found !== undefined && entityTypeOf(found.type) === type ? found : undefined
}

/** The handle of an entity on a client, or 0 for none. */
function handleOf(entity: ClientEntity | undefined): number {
  return entity?.handle ?? 0
}

/** The entity that a handle names on a server, if it is of an entity type, as FiveM's server finds the nodes of peds and vehicles. */
function serverOfType(ctx: NativeContext, handle: number, type: number): SyncEntity | undefined {
  const found = entityOf(ctx, handle)
  return found !== undefined && entityTypeOf(found.type) === type ? found : undefined
}

/** The script handle of the entity of an object id on a server, or 0 for none. */
function serverHandleOf(ctx: NativeContext, objectId: number): number {
  const gameState = gameStateOf(ctx)
  const found = objectId === 0 ? undefined : gameState.byObjectId(objectId)
  return found === undefined ? 0 : gameState.handleOf(found)
}

/** Natives of the seats of vehicles, which peds are in, and of their plates. */
export function vehicleNatives(side: Side): NativeDefinition<NativeContext>[] {
  return side === 'server' ? serverNatives() : clientNatives()
}

function clientNatives(): NativeDefinition<NativeContext>[] {
  const pedOf = (ctx: NativeContext, handle: number) => clientOfType(ctx, handle, EntityType.ped)
  const vehicleOf = (ctx: NativeContext, handle: number) =>
    clientOfType(ctx, handle, EntityType.vehicle)
  /** A native that seats a ped in a seat of a vehicle at once, which -2 makes the first seat of passengers that no ped has. */
  const seat = (name: string, hash: bigint) =>
    defineNative(
      { name, hash, result: 'void', params: ['Ped ped', 'Vehicle vehicle', 'int seatIndex'] },
      (ctx: NativeContext, ped, vehicle, seatIndex) => {
        const found = pedOf(ctx, ped)
        const into = vehicleOf(ctx, vehicle)
        if (found === undefined || into === undefined || seatIndex < -2) return
        let at = seatIndex === -2 ? 0 : seatIndex
        while (seatIndex === -2 && into.occupants.has(at)) at++
        found.enterVehicle(into, at)
      },
    )
  /** Whether a ped is in a vehicle, or in any for none: peds get in and sit down at once. */
  const isIn = (ctx: NativeContext, ped: number, vehicle?: number) => {
    const found = pedOf(ctx, ped)?.vehicle
    return found !== undefined && (vehicle === undefined || found.handle === vehicle)
  }
  return [
    seat('SET_PED_INTO_VEHICLE', 0xf75b0d629e1c063dn),
    seat('TASK_WARP_PED_INTO_VEHICLE', 0x9a7d091411c5f684n),
    defineNative(
      {
        name: 'TASK_LEAVE_VEHICLE',
        hash: 0xd3dbce61a490be02n,
        result: 'void',
        params: ['Ped ped', 'Vehicle vehicle', 'int flags'],
      },
      (ctx: NativeContext, ped, vehicle) => {
        const found = pedOf(ctx, ped)
        if (found?.vehicle !== undefined && found.vehicle.handle === vehicle) found.leaveVehicle()
      },
    ),
    defineNative(
      {
        name: 'TASK_LEAVE_ANY_VEHICLE',
        hash: 0x504d54df3f6f2247n,
        result: 'void',
        params: ['Ped ped', 'int delayTime', 'int flags'],
      },
      (ctx: NativeContext, ped) => pedOf(ctx, ped)?.leaveVehicle(),
    ),
    defineNative(
      {
        name: 'SET_PED_COORDS_KEEP_VEHICLE',
        hash: 0x9afeff481a85ab2en,
        result: 'void',
        params: ['Ped ped', 'float posX', 'float posY', 'float posZ'],
      },
      (ctx: NativeContext, ped, x, y, z) => {
        const found = pedOf(ctx, ped)
        ;(found?.vehicle ?? found)?.moveTo(x, y, z)
      },
    ),
    defineNative(
      {
        name: 'GET_VEHICLE_PED_IS_IN',
        hash: 0x9a9112a0fe9a4713n,
        result: 'Vehicle',
        params: ['Ped ped', 'BOOL includeLastVehicle'],
      },
      (ctx: NativeContext, ped, last) => {
        const found = pedOf(ctx, ped)
        return handleOf(last ? found?.lastVehicle : found?.vehicle)
      },
    ),
    defineNative(
      {
        name: 'GET_VEHICLE_PED_IS_USING',
        hash: 0x6094ad011a2ea87dn,
        result: 'Vehicle',
        params: ['Ped ped'],
      },
      (ctx: NativeContext, ped) => handleOf(pedOf(ctx, ped)?.vehicle),
    ),
    // Peds get into vehicles at once, so none is getting into one.
    defineNative(
      {
        name: 'GET_VEHICLE_PED_IS_TRYING_TO_ENTER',
        hash: 0x814fa8be5449445dn,
        result: 'Vehicle',
        params: ['Ped ped'],
      },
      () => 0,
    ),
    defineNative(
      {
        name: 'GET_VEHICLE_PED_IS_ENTERING',
        hash: 0xf92691aed837a5fcn,
        result: 'Vehicle',
        params: ['Ped ped'],
      },
      () => 0,
    ),
    defineNative(
      {
        name: 'IS_PED_GETTING_INTO_A_VEHICLE',
        hash: 0xbb062b2b5722478en,
        result: 'BOOL',
        params: ['Ped ped'],
      },
      () => false,
    ),
    defineNative(
      {
        name: 'GET_PLAYERS_LAST_VEHICLE',
        hash: 0xb6997a7eb3f5c8c0n,
        result: 'Vehicle',
        params: [],
      },
      (ctx: NativeContext) => handleOf(ctx.manager.world!.playerPed.lastVehicle),
    ),
    defineNative(
      {
        name: 'IS_PED_IN_ANY_VEHICLE',
        hash: 0x997abd671d25ca0bn,
        result: 'BOOL',
        params: ['Ped ped', 'BOOL atGetIn'],
      },
      (ctx: NativeContext, ped) => isIn(ctx, ped),
    ),
    defineNative(
      {
        name: 'IS_PED_IN_VEHICLE',
        hash: 0xa3ee4a07279bb9dbn,
        result: 'BOOL',
        params: ['Ped ped', 'Vehicle vehicle', 'BOOL atGetIn'],
      },
      (ctx: NativeContext, ped, vehicle) => isIn(ctx, ped, vehicle),
    ),
    defineNative(
      {
        name: 'IS_PED_SITTING_IN_ANY_VEHICLE',
        hash: 0x826aa586edb9fef8n,
        result: 'BOOL',
        params: ['Ped ped'],
      },
      (ctx: NativeContext, ped) => isIn(ctx, ped),
    ),
    defineNative(
      {
        name: 'IS_PED_SITTING_IN_VEHICLE',
        hash: 0xa808aa1d79230fc2n,
        result: 'BOOL',
        params: ['Ped ped', 'Vehicle vehicle'],
      },
      (ctx: NativeContext, ped, vehicle) => isIn(ctx, ped, vehicle),
    ),
    defineNative(
      {
        name: 'GET_PED_IN_VEHICLE_SEAT',
        hash: 0xbb40dd2270b65366n,
        result: 'Ped',
        params: ['Vehicle vehicle', 'int seatIndex', 'BOOL p2'],
      },
      (ctx: NativeContext, vehicle, seatIndex) =>
        handleOf(vehicleOf(ctx, vehicle)?.occupants.get(seatIndex)),
    ),
    defineNative(
      {
        name: 'GET_LAST_PED_IN_VEHICLE_SEAT',
        hash: 0x83f969aa1ee2a664n,
        result: 'Ped',
        params: ['Vehicle vehicle', 'int seatIndex'],
      },
      (ctx: NativeContext, vehicle, seatIndex) =>
        handleOf(vehicleOf(ctx, vehicle)?.lastOccupants.get(seatIndex)),
    ),
    defineNative(
      {
        name: 'IS_VEHICLE_SEAT_FREE',
        hash: 0x22ac59a870e6a669n,
        result: 'BOOL',
        params: ['Vehicle vehicle', 'int seatIndex', 'BOOL isTaskRunning'],
      },
      (ctx: NativeContext, vehicle, seatIndex) => {
        const found = vehicleOf(ctx, vehicle)
        return found !== undefined && !found.occupants.has(seatIndex)
      },
    ),
    // Plates hold 8 characters.
    defineNative(
      {
        name: 'SET_VEHICLE_NUMBER_PLATE_TEXT',
        hash: 0x95a88f0b409cda47n,
        result: 'void',
        params: ['Vehicle vehicle', 'char* plateText'],
      },
      (ctx: NativeContext, vehicle, text) => {
        const found = vehicleOf(ctx, vehicle)
        if (found !== undefined) found.plate = (text ?? '').slice(0, 8)
      },
    ),
    defineNative(
      {
        name: 'GET_VEHICLE_NUMBER_PLATE_TEXT',
        hash: 0x7ce1ccb9b293020en,
        result: 'char*',
        params: ['Vehicle vehicle'],
      },
      (ctx: NativeContext, vehicle) => vehicleOf(ctx, vehicle)?.plate ?? null,
    ),
    defineNative(
      {
        name: 'SET_VEHICLE_NUMBER_PLATE_TEXT_INDEX',
        hash: 0x9088eb5a43ffb0a1n,
        result: 'void',
        params: ['Vehicle vehicle', 'int plateIndex'],
      },
      (ctx: NativeContext, vehicle, index) => {
        const found = vehicleOf(ctx, vehicle)
        if (found !== undefined) found.plateIndex = index
      },
    ),
    defineNative(
      {
        name: 'GET_VEHICLE_NUMBER_PLATE_TEXT_INDEX',
        hash: 0xf11bc2dd9a3e7195n,
        result: 'int',
        params: ['Vehicle vehicle'],
      },
      (ctx: NativeContext, vehicle) => vehicleOf(ctx, vehicle)?.plateIndex ?? 0,
    ),
  ]
}

/**
 * The natives of FiveM's server of the seats and the plates of vehicles, which read the
 * trees of peds, and the occupants that the server seats in vehicles as
 * it takes them.
 */
function serverNatives(): NativeDefinition<NativeContext>[] {
  const pedOf = (ctx: NativeContext, handle: number) => serverOfType(ctx, handle, EntityType.ped)
  const vehicleOf = (ctx: NativeContext, handle: number) =>
    serverOfType(ctx, handle, EntityType.vehicle)
  /** A native that gives the ped in a seat of a vehicle, of those that `of` gives, which FiveM keeps 32 seats of. */
  const inSeat = (name: string, of: (vehicle: SyncEntity) => readonly number[]) =>
    defineNative(
      { name, result: 'Entity', params: ['Vehicle vehicle', 'int seatIndex'] },
      (ctx: NativeContext, vehicle, seatIndex) => {
        const found = vehicleOf(ctx, vehicle)
        const seat = seatIndex + 2
        return found === undefined || seat < 0 || seat >= 32
          ? 0
          : serverHandleOf(ctx, of(found)[seat]!)
      },
    )
  return [
    defineNative(
      { name: 'GET_VEHICLE_PED_IS_IN', result: 'Entity', params: ['Ped ped', 'BOOL lastVehicle'] },
      (ctx: NativeContext, ped, last) => {
        const found = pedOf(ctx, ped)
        if (found === undefined) return 0
        const vehicle = last ? found.lastVehiclePedWasIn : (found.state.vehicle ?? 0)
        return vehicle === -1 ? 0 : serverHandleOf(ctx, vehicle)
      },
    ),
    inSeat('GET_PED_IN_VEHICLE_SEAT', (vehicle) => vehicle.occupants),
    inSeat('GET_LAST_PED_IN_VEHICLE_SEAT', (vehicle) => vehicle.lastOccupants),
    defineNative(
      { name: 'GET_SEAT_PED_IS_USING', result: 'int', params: ['Ped ped'] },
      (ctx: NativeContext, ped) => {
        const found = pedOf(ctx, ped)
        return found === undefined ? -3 : (found.state.vehicleSeat ?? 0) - 2
      },
    ),
    defineNative(
      { name: 'IS_PED_IN_ANY_VEHICLE', result: 'BOOL', params: ['Ped ped'] },
      (ctx: NativeContext, ped) => {
        const found = pedOf(ctx, ped)
        return found !== undefined && (found.state.vehicleSeat ?? 0) !== -1
      },
    ),
    defineNative(
      { name: 'IS_PED_IN_VEHICLE', result: 'BOOL', params: ['Ped ped', 'Vehicle vehicle'] },
      (ctx: NativeContext, ped, vehicle) => {
        const found = pedOf(ctx, ped)
        if (vehicle === 0 || found === undefined) return false
        const { vehicle: objectId = 0, vehicleSeat = 0 } = found.state
        if (objectId === -1 || objectId === 0 || vehicleSeat === -1) return false
        const into = gameStateOf(ctx).byHandle(vehicle)
        return into !== undefined && into.objectId === objectId
      },
    ),
    // The trees of vehicles that their owners did not sync yet have no plates.
    defineNative(
      { name: 'GET_VEHICLE_NUMBER_PLATE_TEXT', result: 'char*', params: ['Vehicle vehicle'] },
      (ctx: NativeContext, vehicle) => vehicleOf(ctx, vehicle)?.state.plate ?? '',
    ),
    defineNative(
      { name: 'GET_VEHICLE_NUMBER_PLATE_TEXT_INDEX', result: 'int', params: ['Vehicle vehicle'] },
      (ctx: NativeContext, vehicle) => vehicleOf(ctx, vehicle)?.state.plateIndex ?? 0,
    ),
  ]
}
