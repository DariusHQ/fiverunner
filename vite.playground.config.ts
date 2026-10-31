import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

const path = (file: string) => fileURLToPath(new URL(file, import.meta.url))

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
            .replace('<title>FiveRunner</title>', '<title>FiveRunner playground</title>'),
      },
    },
  ],
})
