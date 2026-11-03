/**
 * The playground: the dev UI on a static site, with no dev server, which
 * runs the city of examples/city, as its visitors edit it, in their page,
 * or the repository of GitHub that its link names.
 */
import type { GivenProject } from '../dev/protocol.ts'
import { startApp } from '../dev/ui/app.ts'
// After the styles of the dev UI, which it changes.
import './style.css'

import { Editor } from './editor.ts'
import { SharedOriginFrames } from './frames.ts'
import { aboutCity, aboutProject, confirmAndLoad, openForm, readLink, showProblem } from './open.ts'

const DIRECTORY = '../../examples/city/'

const sources = import.meta.glob(
  ['../../examples/city/server.cfg', '../../examples/city/resources/**/*'],
  { query: '?raw', import: 'default', eager: true },
) as Readonly<Record<string, string>>

/** The files of the city, by their paths in it, those that scripts run first. */
const city = Object.fromEntries(
  Object.entries(sources)
    .map(([path, text]) => [path.slice(DIRECTORY.length), text] as const)
    .sort(([a], [b]) => a.localeCompare(b)),
)

/** Runs the project of the link of the page, once its visitor says so, or the city. */
async function run(): Promise<void> {
  const main = document.querySelector('main')!
  const link = readLink(new URLSearchParams(location.search))
  if (link !== undefined && 'problem' in link) return showProblem(main, link.problem)
  let project: GivenProject = { name: 'playground', files: city }
  let about = aboutCity()
  if (link !== undefined) {
    const loaded = await confirmAndLoad(main, link)
    project = loaded
    about = aboutProject(loaded, link, location.href)
  }
  const editor = new Editor(main, project.files, [openForm(), ...about], () =>
    document.getElementById('restart')!.click(),
  )
  startApp({
    worker: new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
    frames: new SharedOriginFrames(),
    project: () => ({ name: project.name, files: editor.files }),
    watch() {},
  })
}

void run()
