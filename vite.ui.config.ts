import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

const path = (file: string) => fileURLToPath(new URL(file, import.meta.url))

/**
 * Builds the dev UI: dist/dev, which the dev server serves at
 * /__fiverunner/, with the page of the UI, which runs the engine in a
 * worker, and the bridge of the origins of frames. The service worker of
 * those origins builds on its own, with vite.sw.config.ts.
 */
export default defineConfig({
  root: path('src/dev'),
  base: '/__fiverunner/',
  build: {
    outDir: path('dist/dev'),
    emptyOutDir: true,
    target: 'es2023',
    rolldownOptions: {
      input: { index: path('src/dev/index.html'), bridge: path('src/dev/bridge.html') },
    },
  },
  worker: { format: 'es' },
})
