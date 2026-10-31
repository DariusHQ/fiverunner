/** The chunks of the scripts of resources, as ScriptRuntime names them: @@resource/path. */
const SCRIPT_CHUNK = /^@@([^/:]+)\/(.+)$/

/** The lines of a file: how many times each ran, 0 for those that could. */
type Lines = Map<number, number>

/**
 * The lines of Lua of the resources of a project that tests ran, on their
 * servers and clients, which LuaState.watchLines tells of.
 */
export class Coverage {
  readonly #files = new Map<string, Lines>()
  /** The lines of each chunk, or null for those of no file of the project. */
  readonly #chunks = new Map<string, Lines | null>()

  /**
   * Counts `line` of `chunk`: a line that runs, or that could if it is
   * negative. `resourcePath` gives the directory of a resource of the
   * project, or undefined for those that are not its own.
   */
  add(chunk: string, line: number, resourcePath: (name: string) => string | undefined): void {
    let lines = this.#chunks.get(chunk)
    if (lines === undefined) {
      lines = this.#linesOf(chunk, resourcePath)
      this.#chunks.set(chunk, lines)
    }
    if (lines === null) return
    if (line > 0) lines.set(line, (lines.get(line) ?? 0) + 1)
    else if (!lines.has(-line)) lines.set(-line, 0)
  }

  #linesOf(chunk: string, resourcePath: (name: string) => string | undefined): Lines | null {
    const [, resource = '', file = ''] = SCRIPT_CHUNK.exec(chunk) ?? []
    const directory = resource === '' ? undefined : resourcePath(resource)
    if (directory === undefined) return null
    const path = `${directory}/${file}`
    let lines = this.#files.get(path)
    if (lines === undefined) {
      lines = new Map()
      this.#files.set(path, lines)
    }
    return lines
  }

  /** The lines that ran and those that could, of all files. */
  get totals(): { readonly hit: number; readonly found: number } {
    const counts = [...this.#files.values()].flatMap((lines) => [...lines.values()])
    return { hit: counts.filter((count) => count > 0).length, found: counts.length }
  }

  /** The report of the lines in the format of lcov, with paths relative to `mount`, if the files are under it. */
  lcov(mount: string): string {
    const prefix = mount === '' ? '' : `${mount}/`
    const records = [...this.#files].sort(([a], [b]) => (a < b ? -1 : 1))
    return records
      .map(([path, lines]) => {
        const sorted = [...lines].sort(([a], [b]) => a - b)
        const hit = sorted.filter(([, count]) => count > 0).length
        return [
          'TN:',
          `SF:${path.startsWith(prefix) ? path.slice(prefix.length) : path}`,
          ...sorted.map(([line, count]) => `DA:${line},${count}`),
          `LF:${sorted.length}`,
          `LH:${hit}`,
          'end_of_record',
          '',
        ].join('\n')
      })
      .join('')
  }
}
