/** A colour, by its red, green and blue, from 0 to 255. */
export type Rgb = readonly [red: number, green: number, blue: number]

/** What a vehicle that scripts gave no mod kit has for one, which takes no mods. */
export const NO_MOD_KIT = 0xffff

/** A mod that a vehicle has on a mod type. */
export interface VehicleMod {
  readonly index: number
  /** Whether it has the custom tyres of its wheels. */
  readonly variation: boolean
}

/**
 * What scripts set of a vehicle, which they read back: its colours, its
 * mods, the state of its engine and of its doors, windows and tyres. Nothing
 * wears it. FiveRunner has no models to read their defaults from, so vehicles
 * start as stock cars do, black, clean and whole.
 */
export class VehicleParts {
  engineOn = false
  /** Whether a driver starts the engine by getting in, which scripts turn off as they turn the engine off for good. */
  autoStart = true
  engineHealth = 1000
  bodyHealth = 1000
  petrolTankHealth = 1000
  dirtLevel = 0
  fuelLevel = 65
  oilLevel = 5
  primaryColour = 0
  secondaryColour = 0
  pearlescentColour = 0
  wheelColour = 0
  interiorColour = 0
  dashboardColour = 0
  customPrimary: Rgb | undefined = undefined
  customSecondary: Rgb | undefined = undefined
  tyreSmoke: Rgb = [255, 255, 255]
  neonColour: Rgb = [255, 0, 255]
  /** The neon lights that are on, by their indices: left, right, front and back. */
  readonly neonLights = new Set<number>()
  xenonColour = 255
  customXenon: Rgb | undefined = undefined
  windowTint = -1
  wheelType = 0
  wheelSize = 0
  wheelWidth = 0
  livery = -1
  roofLivery = -1
  modKit = NO_MOD_KIT
  readonly mods = new Map<number, VehicleMod>()
  /** The mods that are on or off, such as turbo, by their types, which are on. */
  readonly toggledMods = new Set<number>()
  /** The extras that scripts set, by their ids, and whether they are on. */
  readonly extras = new Map<number, boolean>()
  doorLock = 0
  /** The doors that are open and those that are broken, by their indices. */
  readonly openDoors = new Set<number>()
  readonly brokenDoors = new Set<number>()
  /** The windows that are smashed and those that are rolled down, by their indices. */
  readonly smashedWindows = new Set<number>()
  readonly rolledDownWindows = new Set<number>()
  tyresCanBurst = true
  /** The tyres that are burst, by their indices, and whether they are burst to the rims. */
  readonly burstTyres = new Map<number, boolean>()
  /** The health of the wheels that scripts set, by their indices. */
  readonly wheelHealth = new Map<number, number>()
  lights = 0
  siren = false
  alarm = false
  handbrake = false
  undriveable = false
  /** The fields of handling that scripts set, by their names. */
  readonly handling = new Map<string, number>()

  /** Repairs what breaks, as SET_VEHICLE_FIXED does, which leaves its dirt. */
  fix(): void {
    this.engineHealth = this.bodyHealth = this.petrolTankHealth = 1000
    this.brokenDoors.clear()
    this.smashedWindows.clear()
    this.burstTyres.clear()
    this.wheelHealth.clear()
  }
}
