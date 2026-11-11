import { defineConfig } from 'vitest/config'

// Integration tests: boot a real Payload instance (dev/payload.config.ts) on a throw-away SQLite file.
export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    hookTimeout: 120_000,
    include: ['test/int/**/*.int.spec.ts'],
    testTimeout: 60_000,
  },
})
