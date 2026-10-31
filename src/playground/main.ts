/**
 * The playground: the dev UI on a static site, with no dev server, which
 * runs the city of examples/city, as its visitors edit it, in their page.
 */
import { startApp } from '../dev/ui/app.ts'
// After the styles of the dev UI, which it changes.
import './style.css'

import { Editor } from './editor.ts'
import { SharedOriginFrames } from './frames.ts'

const DIRECTORY = '../../examples/city/'

const sources = import.meta.glob(
  ['../../examples/city/server.cfg', '../../examples/city/resources/**/*'],
  { query: '?raw', import: 'default', eager: true },
) as Readonly<Record<string, string>>

/** The files of the city, by their paths in it, those that scripts run first. */
const files = Object.fromEntries(
  Object.entries(sources)
    .map(([path, text]) => [path.slice(DIRECTORY.length), text] as const)
    .sort(([a], [b]) => a.localeCompare(b)),
)

const editor = new Editor(document.querySelector('main')!, files, () =>
  document.getElementById('restart')!.click(),
)

startApp({
  worker: new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
  frames: new SharedOriginFrames(),
  project: () => editor.files,
  watch() {},
})
