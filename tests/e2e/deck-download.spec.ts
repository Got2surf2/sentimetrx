/**
 * Playwright e2e — env-gated.
 *
 * Runs only when E2E credentials are set. Locally:
 *   E2E_ADMIN_EMAIL=...
 *   E2E_ADMIN_PASSWORD=...
 *   (optional) E2E_BASE_URL=http://localhost:3000
 *
 * Without those vars the test is skipped — kept off the default CI path
 * because it requires a real Supabase auth flow + a running app.
 */
import { test, expect } from '@playwright/test'

const adminEmail = process.env.E2E_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD

test.describe('admin → investor decks → download pptx', () => {
  test.skip(
    !adminEmail || !adminPassword,
    'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set — see docs/TESTING.md',
  )

  test('logs in, navigates to Investor Decks, downloads a pptx', async ({ page }) => {
    await page.goto('/login')

    // Fill the email + password fields. The login form uses standard input
    // types so we target by `[type=email]` / `[type=password]` to stay
    // resilient to label/placeholder copy changes.
    await page.locator('input[type="email"]').first().fill(adminEmail!)
    await page.locator('input[type="password"]').first().fill(adminPassword!)
    await page.getByRole('button', { name: /sign in|log in/i }).first().click()

    // Wait until we're past /login.
    await page.waitForURL(/^(?!.*\/login).*$/, { timeout: 30_000 })

    // The deck endpoint is a GET that streams pptx bytes — exercise it
    // through the authenticated browser context to confirm the cookie
    // gate accepts the admin session and the response really is a pptx.
    const response = await page.request.get('/api/pitch-deck')
    expect(response.status()).toBe(200)
    const ct = response.headers()['content-type'] || ''
    expect(ct).toContain('officedocument.presentationml.presentation')

    const body = await response.body()
    expect(body.byteLength).toBeGreaterThan(1000)
  })
})
