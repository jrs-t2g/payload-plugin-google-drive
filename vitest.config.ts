import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['test/int/**', 'node_modules/**'],
    include: ['test/**/*.spec.ts'],
  },
})
