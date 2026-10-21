/**
 * The fade of the screen of the game of a client, from 0, which shows the
 * game, to 1, which is black: it moves to where scripts fade it, at a
 * pace that takes the duration they ask from one end to the other, in the
 * time of the client. Games start faded in.
 */
export class ScreenFade {
  /** How faded the screen was when it last began to fade. */
  #from = 0
  /** Where the screen fades to. */
  #to = 0
  /** When the screen last began to fade. */
  #since = 0
  /** How much the screen fades in a millisecond. */
  #pace = 0

  /** How faded the screen is at `now`. */
  level(now: number): number {
    const moved = (now - this.#since) * this.#pace
    return this.#to > this.#from
      ? Math.min(this.#to, this.#from + moved)
      : Math.max(this.#to, this.#from - moved)
  }

  /** Fades the screen to `to` from where it is at `now`, at the pace of `duration` milliseconds, or at once for none. */
  fade(to: 0 | 1, duration: number, now: number): void {
    this.#from = duration > 0 ? this.level(now) : to
    this.#to = to
    this.#since = now
    this.#pace = duration > 0 ? 1 / duration : 0
  }

  /** Whether the screen fades to `to`, or has. */
  fadesTo(to: 0 | 1): boolean {
    return this.#to === to
  }
}
