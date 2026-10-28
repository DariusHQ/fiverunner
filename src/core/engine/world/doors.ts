/**
 * A door of the door system of the game of a client, as scripts add it:
 * its model and where it is, the state it locks in, 0 for unlocked, how
 * fast and from how far it opens of itself, how open it is, which it
 * stays, as nothing pushes doors, and whether it is held open and has no spring.
 */
export interface Door {
  readonly model: number
  readonly x: number
  readonly y: number
  readonly z: number
  state: number
  automaticRate: number
  automaticDistance: number
  openRatio: number
  holdOpen: boolean
  springRemoved: boolean
}
