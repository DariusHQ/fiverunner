import { hashString } from '../../natives/index.ts'

/** The milliseconds of the time of a client that a minute of the clock of GTA V takes, unless scripts say otherwise. */
export const MS_PER_GAME_MINUTE = 2000

const DAY = 24 * 60 * 60

/**
 * The clock of the game of a client: the time of day, in seconds, which
 * moves on a minute in each `msPerMinute` milliseconds of the time of the
 * client, unless scripts pause it. Clocks start at noon.
 */
export class GameClock {
  /** The time of day when the clock was last set, in seconds since midnight. */
  #at = 12 * 60 * 60
  /** When the clock was last set, in the time of the client. */
  #since = 0
  #msPerMinute = MS_PER_GAME_MINUTE
  #paused = false
  /** Whether scripts override the time of the session, as NetworkOverrideClockTime does. */
  overridden = false

  /** The time of day at `now`, in whole seconds since midnight. */
  seconds(now: number): number {
    const moved = this.#paused ? 0 : Math.floor(((now - this.#since) * 60) / this.#msPerMinute)
    return (((this.#at + moved) % DAY) + DAY) % DAY
  }

  /** Sets the time of day at `now`, which wraps around midnight. */
  set(hours: number, minutes: number, seconds: number, now: number): void {
    this.#at = (hours * 60 + minutes) * 60 + seconds
    this.#since = now
  }

  /** Moves the clock on by a time, or back, from where it is at `now`. */
  add(hours: number, minutes: number, seconds: number, now: number): void {
    this.set(hours, minutes, seconds + this.seconds(now), now)
  }

  get msPerMinute(): number {
    return this.#msPerMinute
  }

  /** Has a minute take `ms` milliseconds from `now` on, but for none or less. */
  setMsPerMinute(ms: number, now: number): void {
    if (ms <= 0) return
    this.set(0, 0, this.seconds(now), now)
    this.#msPerMinute = ms
  }

  pause(paused: boolean, now: number): void {
    this.set(0, 0, this.seconds(now), now)
    this.#paused = paused
  }
}

/**
 * The weather of the game of a client, by the hashes of the names of its
 * types: the one it was, and the one it turns to over a time, which it is
 * once that passed, unless scripts override both. Games start CLEAR, and
 * there is no cycle of weathers for them to move on to.
 */
export class Weather {
  #from = hashString('CLEAR')
  #to = this.#from
  /** When the weather began to turn, in the time of the client. */
  #since = 0
  /** How long the weather takes to turn, in milliseconds. */
  #duration = 0
  /** The type of weather that scripts override the weather with, if they do. */
  override: number | undefined

  /** The type of weather that the weather was, or is once it turned. */
  previous(now: number): number {
    return this.override ?? this.#current(now)
  }

  /** The type of weather that the weather turns to, or is. */
  get next(): number {
    return this.override ?? this.#to
  }

  /** Turns the weather to a type over `duration` milliseconds from `now`, or at once for none, from where it is. */
  turn(type: number, duration: number, now: number): void {
    this.#from = duration > 0 ? this.#current(now) : type
    this.#to = type
    this.#since = now
    this.#duration = Math.max(duration, 0)
  }

  #current(now: number): number {
    return now - this.#since >= this.#duration ? this.#to : this.#from
  }
}
