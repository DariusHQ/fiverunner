import { hashString } from '../../natives/index.ts'

/** The labels of GTA V's text that FiveRunner knows of, which scripts build text on. */
const GAME_LABELS: ReadonlyMap<number, string> = new Map([
  [hashString('STRING'), '~a~'],
  [hashString('TWOSTRINGS'), '~a~~a~'],
])

/**
 * The text of the game of a client, as GTA V's text commands build it: the
 * labels that scripts add, by the hashes of their names, and the command
 * that a script began, with the components it added since.
 */
export class GameText {
  readonly #labels = new Map<number, string>()
  #command: { readonly label: string; readonly components: string[] } | undefined

  /** Adds a label, or replaces the text of one, as ADD_TEXT_ENTRY does. */
  addLabel(hash: number, text: string): void {
    this.#labels.set(hash >>> 0, text)
  }

  /** The text of a label, if the game or a script has it. */
  label(name: string): string | undefined {
    const hash = hashString(name)
    return this.#labels.get(hash) ?? GAME_LABELS.get(hash)
  }

  /** Begins a command on a label. */
  begin(label: string): void {
    this.#command = { label, components: [] }
  }

  /** Adds a component to the command that a script began, if one did. */
  add(component: string): void {
    this.#command?.components.push(component)
  }

  /**
   * Ends the command that a script began, and gives its text: that of its
   * label, whose ~a~ and ~1~ the components take the places of in order,
   * or NULL for labels that neither the game nor a script has.
   */
  end(): string {
    const command = this.#command
    this.#command = undefined
    if (command === undefined) return ''
    const components = command.components.values()
    return (this.label(command.label) ?? 'NULL').replace(
      /~a~|~1~/g,
      (token) => components.next().value ?? token,
    )
  }
}
