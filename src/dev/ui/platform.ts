import type { Answer, Ask } from '../answers.ts'
import type { GivenProject } from '../protocol.ts'

/** How the frames of the screens of players are served. */
export interface Frames {
  /** Where the frame of `client` shows the page that FiveM has at `url`. */
  url(url: string, client: number): string
  /** Resolves once a frame can load `url`, which `url` gave. */
  ready(url: string): Promise<void>
  /** Calls `ask` with what the pages of frames ask of their clients, which `respond` answers. */
  listen(
    ask: (client: number, host: string, question: Ask, respond: (answer: Answer) => void) => void,
  ): void
}

/** What the dev UI runs on. */
export interface Platform {
  /** The worker that runs the engine. */
  readonly worker: Worker
  readonly frames: Frames
  /** The project that the next session runs, or undefined for that of the worker. */
  project(): GivenProject | undefined
  /** Calls `changed` as files of the project change, with their paths, or null if it cannot tell them. */
  watch(changed: (paths: readonly string[] | null) => void): void
}
