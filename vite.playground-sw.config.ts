import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

const path = (file: string) => fileURLToPath(new URL(file, import.meta.url))

/** Builds the service worker of the playground: dist-playground/sw.js. */
export default defineConfig({
  build: {
    outDir: path('dist-playground'),
    emptyOutDir: false,
    target: 'es2023',
    copyPublicDir: false,
    lib: {
      entry: path('src/playground/sw.ts'),
      formats: ['iife'],
      name: 'FiveRunnerPlayground',
      fileName: () => 'sw.js',
    },
  },
})
