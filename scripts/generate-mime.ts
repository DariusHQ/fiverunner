/**
 * Generates the types by which FiveRunner's NUI serves the files of
 * resources (src/core/engine/mime.json) from the standard types of the mime
 * package, at the version package.json pins, which are those FiveM's NUI
 * serves files by.
 *
 *   npm run build:mime               writes the types
 *   npm run build:mime -- --check    fails if they are out of date
 *
 * FiveM keeps every extension that the package lists for a type, including
 * those that it marks with an asterisk as not to be looked up, which FiveM
 * takes as they are: a.*mp3 is audio/mp3 to it.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dir = join(root, 'node_modules', 'mime')
const { version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
  version: string
}
const standard = JSON.parse(readFileSync(join(dir, 'types', 'standard.json'), 'utf8')) as Record<
  string,
  string[]
>
const types = new Map<string, string>()
for (const [type, extensions] of Object.entries(standard)) {
  for (const extension of extensions) {
    const other = types.get(extension)
    if (other !== undefined) throw new Error(`${extension} is both ${other} and ${type}`)
    types.set(extension, type)
  }
}
const sorted = Object.fromEntries([...types].sort(([a], [b]) => (a < b ? -1 : 1)))
const json = `${JSON.stringify({ source: `mime@${version}`, types: sorted }, null, 2)}\n`
const file = 'src/core/engine/mime.json'
const path = join(root, file)
if (process.argv.includes('--check')) {
  if (!existsSync(path) || readFileSync(path, 'utf8') !== json) {
    process.stderr.write(`${file} is out of date: run npm run build:mime\n`)
    process.exitCode = 1
  }
} else {
  writeFileSync(path, json)
  process.stdout.write(`${file}: ${types.size} extensions, from mime@${version}\n`)
}
