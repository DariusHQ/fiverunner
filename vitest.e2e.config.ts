import { defineConfig } from 'vitest/config'

/** Runs the end-to-end tests: the built command line tool and its dev UI, in Chrome. */
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
})
