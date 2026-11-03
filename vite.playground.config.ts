import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

const path = (file: string) => fileURLToPath(new URL(file, import.meta.url))

const DESCRIPTION =
  'A small FiveM city, in Lua and JavaScript, that runs in this page: edit its files, press Run, and walk around it. No GTA V, no FXServer.'

/** Where visitors who like what they see go. */
const STAR =
  '<a class="star" href="https://github.com/DariusHQ/fiverunner" target="_blank" rel="noopener">&#9733; Star on GitHub</a>'

/** What sites that show links read of the page. */
const CARD = `
    <meta name="description" content="${DESCRIPTION}" />
    <meta property="og:title" content="FiveRunner playground" />
    <meta property="og:description" content="${DESCRIPTION}" />
    <meta property="og:url" content="https://dariushq.github.io/fiverunner/" />
    <meta property="og:image" content="https://raw.githubusercontent.com/DariusHQ/fiverunner/main/docs/media/social.png" />
    <meta name="twitter:card" content="summary_large_image" />`

/**
 * Builds the playground: dist-playground, a static site with the page of
 * the dev UI, on src/playground in place of the dev server, at any path.
 * Its service worker builds on its own, with vite.playground-sw.config.ts.
 */
export default defineConfig({
  root: path('src/dev'),
  base: './',
  build: {
    outDir: path('dist-playground'),
    emptyOutDir: true,
    target: 'es2023',
    rolldownOptions: { input: path('src/dev/index.html') },
  },
  worker: { format: 'es' },
  plugins: [
    {
      name: 'playground-page',
      transformIndexHtml: {
        order: 'pre',
        handler: (html) =>
          html
            .replace('./ui/main.ts', '../playground/main.ts')
            .replace('<title>FiveRunner</title>', `<title>FiveRunner playground</title>${CARD}`)
            .replace('</button>\n    </header>', `</button>\n      ${STAR}\n    </header>`),
      },
    },
  ],
})
