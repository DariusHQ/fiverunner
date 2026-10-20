import type { ProcessOutput } from '../core/engine/index.ts'

/** What a process printed or reported. */
export interface OutputLine {
  /** server, or the client that printed it: client 1, client 2 and on, in the order they connected. */
  readonly process: string
  /**
   * console for what the process printed on its console, warning for the
   * warnings of Lua, and diagnostic for what FiveRunner noticed of how a
   * resource uses FiveM.
   */
  readonly kind: 'console' | 'warning' | 'diagnostic'
  /** The channel of the console, such as script:name, or the resource that warned or was diagnosed. */
  readonly channel: string
  readonly text: string
}

/**
 * Turns what the processes of an engine print and report into lines, which
 * it hands `emit` as they end: prints at their line breaks, and warnings
 * and diagnoses at once.
 */
export class LineOutput {
  readonly #emit: (line: OutputLine) => void
  /** What each process printed on each channel since its last line break. */
  readonly #partial = new Map<string, { process: string; channel: string; text: string }>()

  constructor(emit: (line: OutputLine) => void) {
    this.#emit = emit
  }

  /** Where the process `process` writes. */
  of(process: string): ProcessOutput {
    return {
      write: (channel, text) => {
        const key = `${process}\n${channel}`
        const pieces = ((this.#partial.get(key)?.text ?? '') + text).split('\n')
        this.#partial.set(key, { process, channel, text: pieces.pop()! })
        for (const piece of pieces) this.#emit({ process, kind: 'console', channel, text: piece })
      },
      warn: (resource, message) => {
        this.#emit({ process, kind: 'warning', channel: resource, text: message })
      },
      diagnose: (resource, message) => {
        this.#emit({ process, kind: 'diagnostic', channel: resource, text: message })
      },
    }
  }

  /** What the processes printed after their last line breaks, as lines of their own. */
  get unended(): OutputLine[] {
    return [...this.#partial.values()]
      .filter(({ text }) => text !== '')
      .map(({ process, channel, text }) => ({ process, kind: 'console', channel, text }))
  }
}
