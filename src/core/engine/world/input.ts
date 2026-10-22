/**
 * The keys that press the controls of GTA V on the keyboard, as GTA V binds
 * them by default, by the names of the keys of FiveM's keyboard mapper:
 * those of the keys that FiveRunner knows of.
 */
const CONTROL_KEYS: ReadonlyMap<number, readonly string[]> = new Map([
  [0, ['V']],
  [18, ['RETURN', 'SPACE']],
  [19, ['LMENU']],
  [20, ['Z']],
  [21, ['LSHIFT']],
  [22, ['SPACE']],
  [23, ['F']],
  [26, ['C']],
  [29, ['B']],
  [32, ['W']],
  [33, ['S']],
  [34, ['A']],
  [35, ['D']],
  [36, ['LCONTROL']],
  [37, ['TAB']],
  [38, ['E']],
  [44, ['Q']],
  [45, ['R']],
  [46, ['E']],
  [47, ['G']],
  [51, ['E']],
  [52, ['Q']],
  [56, ['F9']],
  [57, ['F10']],
  [73, ['X']],
  [74, ['H']],
  [75, ['F']],
  [140, ['R']],
  [157, ['1']],
  [158, ['2']],
  [159, ['6']],
  [160, ['3']],
  [161, ['7']],
  [162, ['8']],
  [163, ['9']],
  [164, ['4']],
  [165, ['5']],
  [172, ['UP']],
  [173, ['DOWN']],
  [174, ['LEFT']],
  [175, ['RIGHT']],
  [176, ['RETURN']],
  [177, ['BACK', 'ESCAPE']],
  [178, ['DELETE']],
  [182, ['L']],
  [187, ['DOWN']],
  [188, ['UP']],
  [189, ['LEFT']],
  [190, ['RIGHT']],
  [191, ['RETURN']],
  [194, ['BACK']],
  [199, ['P']],
  [200, ['ESCAPE']],
  [201, ['RETURN']],
  [202, ['BACK', 'ESCAPE']],
  [244, ['M']],
  [245, ['T']],
  [246, ['Y']],
  [249, ['N']],
  [288, ['F1']],
  [289, ['F2']],
  [303, ['U']],
  [311, ['K']],
  [322, ['ESCAPE']],
  [344, ['F11']],
])

/** The axes of moving, which keys press both ways, as GTA V binds them by default. */
const AXES: ReadonlyMap<number, readonly [negative: string, positive: string]> = new Map([
  [30, ['A', 'D']],
  [31, ['W', 'S']],
])

/** A command that a resource bound to a key, as RegisterKeyMapping binds them. */
export interface KeyMapping {
  readonly command: string
  readonly description: string
  /** The mapper of the key, such as keyboard, in lower case. */
  readonly mapper: string
  /** The key, by the name that its mapper gives it, in upper case. */
  readonly key: string
}

/**
 * The input of the game of a client: the keys of its keyboard that are
 * held, which press the controls of GTA V, those that went down or up
 * since the frame before, which controls take as they were as each frame
 * starts, the controls that scripts disabled for the frame, and the
 * commands that resources bound to keys.
 */
export class Input {
  readonly #held = new Set<string>()
  #pressed = new Set<string>()
  #released = new Set<string>()
  readonly #comingPressed = new Set<string>()
  readonly #comingReleased = new Set<string>()
  readonly #disabled = new Set<number>()
  #allDisabled = false
  /** The commands that resources bound to keys, by the commands. */
  readonly mappings = new Map<string, KeyMapping>()

  /** Binds a command to a key, as RegisterKeyMapping does: the last binding of a command is the one it has. */
  map(command: string, description: string, mapper: string, key: string): void {
    this.mappings.set(command, {
      command,
      description,
      mapper: mapper.toLowerCase(),
      key: key.toUpperCase(),
    })
  }

  /** A key of the keyboard goes down, unless it is held, and gives the commands that its mappings run. */
  keyDown(key: string): string[] {
    const name = key.toUpperCase()
    if (this.#held.has(name)) return []
    this.#held.add(name)
    this.#comingPressed.add(name)
    return this.#mapped(name).map(({ command }) => command)
  }

  /** A key of the keyboard goes up, if it is held, and gives the commands that its mappings run: -command for those of +command. */
  keyUp(key: string): string[] {
    const name = key.toUpperCase()
    if (!this.#held.delete(name)) return []
    this.#comingReleased.add(name)
    return this.#mapped(name)
      .filter(({ command }) => command.startsWith('+'))
      .map(({ command }) => `-${command.slice(1)}`)
  }

  /** Starts a frame: the keys that went down or up since are those of the frame, and no control is disabled. */
  frame(): void {
    this.#pressed = new Set(this.#comingPressed)
    this.#released = new Set(this.#comingReleased)
    this.#comingPressed.clear()
    this.#comingReleased.clear()
    this.#disabled.clear()
    this.#allDisabled = false
  }

  disable(control: number): void {
    this.#disabled.add(control)
  }

  enable(control: number): void {
    this.#disabled.delete(control)
  }

  disableAll(): void {
    this.#allDisabled = true
  }

  enableAll(): void {
    this.#allDisabled = false
    this.#disabled.clear()
  }

  /** Whether a control is enabled for the frame. */
  enabled(control: number): boolean {
    return !this.#allDisabled && !this.#disabled.has(control)
  }

  /** Whether a key of a control is held, and the control enabled, unless disabled controls count. */
  pressed(control: number, disabled: boolean): boolean {
    return (
      (disabled || this.enabled(control)) && this.#keys(control).some((key) => this.#held.has(key))
    )
  }

  /** Whether a key of a control went down for the frame. */
  justPressed(control: number, disabled: boolean): boolean {
    return (
      (disabled || this.enabled(control)) &&
      this.#keys(control).some((key) => this.#pressed.has(key))
    )
  }

  /** Whether a key of a control went up for the frame. */
  justReleased(control: number, disabled: boolean): boolean {
    return (
      (disabled || this.enabled(control)) &&
      this.#keys(control).some((key) => this.#released.has(key))
    )
  }

  /** How far a control is pressed: 1 for the keys of buttons, and -1 to 1 for the axes of moving. */
  normal(control: number, disabled: boolean): number {
    if (!disabled && !this.enabled(control)) return 0
    const axis = AXES.get(control)
    if (axis !== undefined) {
      return (this.#held.has(axis[1]) ? 1 : 0) - (this.#held.has(axis[0]) ? 1 : 0)
    }
    return this.pressed(control, true) ? 1 : 0
  }

  #keys(control: number): readonly string[] {
    return CONTROL_KEYS.get(control) ?? AXES.get(control) ?? []
  }

  #mapped(key: string): KeyMapping[] {
    return [...this.mappings.values()].filter(
      (mapping) => mapping.mapper === 'keyboard' && mapping.key === key,
    )
  }
}
