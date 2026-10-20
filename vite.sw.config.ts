import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

const path = (file: string) => fileURLToPath(new URL(file, import.meta.url))

/**
 * Builds the service worker of the origins of the frames of the dev UI:
 * dist/dev/sw.js, a classic script of its own, which every browser that
 * has service workers runs.
 */
export default defineConfig({
  build: {
    outDir: path('dist/dev'),
    emptyOutDir: false,
    target: 'es2023',
    copyPublicDir: false,
    lib: {
      entry: path('src/dev/sw.ts'),
      formats: ['iife'],
      name: 'FiveRunnerServiceWorker',
      fileName: () => 'sw.js',
    },
  },
})
