import { watch, type FSWatcher } from 'node:fs'

/** Milliseconds that the watcher waits for changes to stop before it tells of them. */
const SETTLE = 150

/**
 * Watches the files of the project at `root`, but those of node_modules
 * and of dot directories, and calls `changed` with the paths of those that
 * changed, relative to the root, with slashes, once changes stop for a
 * moment, or with none when the host did not tell which. Gives what stops
 * watching.
 */
export function watchProject(
  root: string,
  changed: (paths: string[] | undefined) => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let paths: Set<string> | undefined = new Set()
  const heard = (file: string | null) => {
    const parts = (file ?? '').split(/[\\/]/)
    if (parts.some((part) => part === 'node_modules' || part.startsWith('.'))) return
    if (file === null) paths = undefined
    else paths?.add(parts.join('/'))
    clearTimeout(timer)
    timer = setTimeout(() => {
      const told = paths === undefined ? undefined : [...paths].sort()
      paths = new Set()
      changed(told)
    }, SETTLE)
  }
  let watcher: FSWatcher | undefined
  try {
    watcher = watch(root, { recursive: true }, (_, file) => heard(file))
    watcher.on('error', () => {})
  } catch {
    watcher = undefined
  }
  return () => {
    clearTimeout(timer)
    watcher?.close()
  }
}
