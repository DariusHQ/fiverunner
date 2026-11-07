// Puts the built pages of the repositories of BUILT_PAGES, from the latest
// release of each, where the playground's site serves them, with their
// licenses and where their sources are, as the playground deploys:
//
//   node scripts/vendor-pages.ts dist-playground/vendor
//
// Needs gh, signed in or given GH_TOKEN, and unzip.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BUILT_PAGES } from '../src/playground/github.ts'

const [out] = process.argv.slice(2)
if (out === undefined) throw new Error('usage: node scripts/vendor-pages.ts <directory>')

/** The paths of the files under `directory`, with slashes, in order. */
function filesOf(directory: string, prefix = ''): string[] {
  return readdirSync(join(directory, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      return entry.isDirectory() ? filesOf(directory, path) : [path]
    })
    .sort()
}

for (const [repository, name] of Object.entries(BUILT_PAGES)) {
  const temporary = mkdtempSync(join(tmpdir(), 'fiverunner-pages-'))
  try {
    const tag = execFileSync(
      'gh',
      ['release', 'view', '--repo', repository, '--json', 'tagName', '--jq', '.tagName'],
      { encoding: 'utf8' },
    ).trim()
    execFileSync('gh', [
      'release',
      'download',
      tag,
      '--repo',
      repository,
      '--pattern',
      `${name}.zip`,
      '--dir',
      temporary,
    ])
    // All of it, as the wildcards of unzip cross directories on some systems and not others.
    execFileSync('unzip', ['-q', join(temporary, `${name}.zip`), '-d', temporary])
    const target = join(out, name)
    rmSync(target, { recursive: true, force: true })
    mkdirSync(target, { recursive: true })
    cpSync(join(temporary, name, 'web', 'build'), join(target, 'build'), { recursive: true })
    cpSync(join(temporary, name, 'LICENSE'), join(target, 'LICENSE'))
    const files = filesOf(join(target, 'build'))
    writeFileSync(
      join(target, 'files.json'),
      `${JSON.stringify({ repository, tag, files }, null, 2)}\n`,
    )
    writeFileSync(
      join(target, 'SOURCE.txt'),
      `These are the built pages of ${repository} ${tag}, from its release, under its license, in LICENSE.\n` +
        `Their source is at https://github.com/${repository}/tree/${tag}/web\n` +
        `FiveRunner's playground serves them for ${name}, whose repository has only their source.\n`,
    )
    console.log(`${repository} ${tag}: ${files.length} files`)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}
