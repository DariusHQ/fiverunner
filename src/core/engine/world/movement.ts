import type { ClientEntity } from './client.ts'
import type { Input } from './input.ts'
import { apply, fromHeading, headingOf } from './rotation.ts'

/** The controls that move players, as GTA V numbers them. */
const MOVE_LEFT_RIGHT = 30
const MOVE_UP_DOWN = 31
const SPRINT = 21
const VEHICLE_ACCELERATE = 71
const VEHICLE_BRAKE = 72
const VEHICLE_STEER = 59

/** How fast players run and sprint, near how fast those of GTA V do, in metres a second. */
export const RUN_SPEED = 5
export const SPRINT_SPEED = 7

/** How cars of no model drive, in metres a second, and in those per second. */
const TOP_SPEED = 35
const REVERSE_SPEED = 10
const ACCELERATION = 6
const BRAKING = 14
const COASTING = 2

/** How fast cars turn at speed, in degrees a second, and the speed they turn that fast from. */
const TURN_RATE = 80
const TURNING_SPEED = 5

/** Moves `value` towards `target`, by no more than `step`. */
function towards(value: number, target: number, step: number): number {
  return value < target ? Math.min(value + step, target) : Math.max(value - step, target)
}

/**
 * Has the player run where its keys say, with the north up, as the
 * screens of players show the world, and turns its ped that way.
 */
function run(ped: ClientEntity, input: Input, seconds: number): void {
  const x = input.normal(MOVE_LEFT_RIGHT, false)
  const y = -input.normal(MOVE_UP_DOWN, false)
  if ((x === 0 && y === 0) || ped.frozen) {
    ped.speed = 0
    return
  }
  ped.speed = input.pressed(SPRINT, false) ? SPRINT_SPEED : RUN_SPEED
  const step = (ped.speed * seconds) / Math.hypot(x, y)
  ped.rotation = fromHeading((Math.atan2(-x, y) * 180) / Math.PI)
  ped.moveTo(Math.fround(ped.x + x * step), Math.fround(ped.y + y * step), ped.z)
}

/** Has the player drive the vehicle that it sits at the wheel of, as an arcade would. */
function drive(vehicle: ClientEntity, input: Input, seconds: number): void {
  const { parts } = vehicle
  const running = parts.engineOn && !parts.undriveable && parts.engineHealth > 0 && !vehicle.frozen
  const accelerator = running && input.pressed(VEHICLE_ACCELERATE, false)
  const brake = running && input.pressed(VEHICLE_BRAKE, false)
  let { speed } = vehicle
  if (parts.handbrake) speed = towards(speed, 0, BRAKING * seconds)
  else if (accelerator && !brake) {
    speed = towards(speed, TOP_SPEED, (speed < 0 ? BRAKING : ACCELERATION) * seconds)
  } else if (brake && !accelerator) {
    speed = towards(speed, -REVERSE_SPEED, (speed > 0 ? BRAKING : ACCELERATION) * seconds)
  } else speed = towards(speed, 0, COASTING * seconds)
  vehicle.speed = speed
  if (speed === 0) return
  // Cars turn as they roll, and the wheel turns them the other way as they back up.
  const grip = Math.min(Math.abs(speed) / TURNING_SPEED, 1) * Math.sign(speed)
  const turn = input.normal(VEHICLE_STEER, false) * TURN_RATE * grip * seconds
  vehicle.rotation = fromHeading(headingOf(vehicle.rotation) - turn)
  const [x, y] = apply(vehicle.rotation, 0, speed * seconds, 0)
  vehicle.moveTo(Math.fround(vehicle.x + x), Math.fround(vehicle.y + y), vehicle.z)
}

/**
 * Moves the ped of the player as the keys that it held in the last frame
 * say, with the controls that scripts disabled for that frame: on foot, or
 * at the wheel of a vehicle, which rolls on by itself once they let go of it.
 */
export function moveWithKeys(ped: ClientEntity, input: Input, seconds: number): void {
  const { vehicle } = ped
  if (vehicle === undefined) run(ped, input, seconds)
  else if (ped.seat === -1) drive(vehicle, input, seconds)
}
