import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    // Default to node. Component tests should opt into jsdom via the
    // `// @vitest-environment jsdom` directive at the top of the file.
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['lib/**/*.ts', 'app/api/**/*.ts'],
      exclude: ['**/*.test.*', 'tests/**'],
      // Ratcheting floor — set just below the current baseline so unrelated
      // churn doesn't redden CI, but no regression is allowed. Bump these up
      // as each batch of tests lands (governance Tests-score progression plan).
      // Ratcheted 2026-08-16: 20/15/20/20 → 30/23/33/30. The old floor sat ~10pp
      // under the real numbers, so it would have passed a 30% regression without
      // complaint — a floor that far below actual isn't a gate, it's decoration.
      // Measured: statements 30.7 · branches 24.07 · functions 33.79 · lines 31.26.
      thresholds: {
        statements: 30,
        branches: 23,
        functions: 33,
        lines: 30,
      },
    },
  },
})
