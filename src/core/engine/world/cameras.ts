import { Pool } from './pool.ts'
import { IDENTITY, type Matrix } from './rotation.ts'

/** The field of view of the cameras of GTA V that scripts create and of its gameplay camera, in degrees. */
export const DEFAULT_FOV = 50

/** A camera that the script of a resource created, which renders nothing, as there is no game to render. */
export interface Camera {
  handle: number
  readonly script: string
  x: number
  y: number
  z: number
  rotation: Matrix
  fov: number
}

/**
 * The cameras that scripts create on a client, by their handles, which
 * come from a pool of their own, and whether scripts render them: the
 * active camera that became active last renders, as GTA V renders the
 * active camera.
 */
export class Cameras {
  readonly #pool = new Pool<Camera>(0)
  readonly #cameras = new Set<Camera>()
  /** The active cameras, the one that became active last at the end. */
  #active: Camera[] = []
  /** Whether scripts render their cameras, in place of the gameplay camera. */
  rendering = false

  /** Creates a camera of a script at a position, turned, with a field of view, and returns its handle. */
  create(
    script: string,
    x: number,
    y: number,
    z: number,
    rotation = IDENTITY,
    fov = DEFAULT_FOV,
  ): number {
    const camera: Camera = { handle: 0, script, x, y, z, rotation, fov }
    camera.handle = this.#pool.add(camera)
    this.#cameras.add(camera)
    return camera.handle
  }

  get(handle: number): Camera | undefined {
    return this.#pool.get(handle)
  }

  isActive(camera: Camera): boolean {
    return this.#active.includes(camera)
  }

  /** Makes a camera active, or not. */
  activate(camera: Camera, active: boolean): void {
    this.#active = this.#active.filter((other) => other !== camera)
    if (active) this.#active.push(camera)
  }

  destroy(camera: Camera): void {
    this.activate(camera, false)
    this.#cameras.delete(camera)
    this.#pool.delete(camera.handle)
  }

  /** Destroys the cameras of a script, as GTA V does as scripts end, or as they destroy them all. */
  release(script: string): void {
    for (const camera of this.#cameras) if (camera.script === script) this.destroy(camera)
  }

  /** The camera that renders, if scripts render one. */
  get rendered(): Camera | undefined {
    return this.rendering ? this.#active.at(-1) : undefined
  }
}
