import { defineConfig, devices } from '@playwright/test'

// Separate from the main e2e config: this one runs N browsers in parallel
// against an already-running target (no built-in webServer). Use it alongside
// the k6 script to load-test the participant flow with real browser rendering.
//
// Run:
//   SESSION_ID=<uuid-or-slug> TARGET_BASE_URL=https://staging.example.com \
//     BROWSERS=5 npx playwright test --config=tests/loadtest/playwright.config.ts

const baseURL = process.env.TARGET_BASE_URL || 'http://localhost:3000'
const workers = parseInt(process.env.BROWSERS || '5', 10)

export default defineConfig({
  testDir: '.',
  testMatch: 'townhall.spec.ts',
  timeout: 5 * 60_000,
  fullyParallel: true,
  retries: 0,
  workers,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
