/**
 * Playwright e2e — env-gated. Saved Views / Snapshots.
 *
 * Runs only when E2E credentials are set. Locally:
 *   E2E_ADMIN_EMAIL=...
 *   E2E_ADMIN_PASSWORD=...
 *   E2E_DATASET_ID=...        (a dataset the admin can open in /analyze)
 *   (optional) E2E_BASE_URL=http://localhost:3000
 *
 * Without those vars the test is skipped — it needs a real Supabase auth flow,
 * a running app, and the linked DB. It drives the full stack through the authed
 * browser context (cookie gate → route → service-role + RLS → prod DB) and
 * cleans up every row it creates (names are e2e-prefixed + timestamped).
 */
import { test, expect } from '@playwright/test'

const adminEmail = process.env.E2E_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD
const datasetId = process.env.E2E_DATASET_ID

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.locator('input[type="email"]').first().fill(adminEmail!)
  await page.locator('input[type="password"]').first().fill(adminPassword!)
  await page.getByRole('button', { name: /sign in|log in/i }).first().click()
  await page.waitForURL(/^(?!.*\/login).*$/, { timeout: 30_000 })
}

test.describe('Saved Views', () => {
  test.skip(
    !adminEmail || !adminPassword || !datasetId,
    'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD / E2E_DATASET_ID not set — see docs/TESTING.md',
  )

  test('ViewsBar renders on the dataset workspace', async ({ page }) => {
    await login(page)
    await page.goto(`/analyze/${datasetId}`)
    await expect(page.getByTestId('views-bar')).toBeVisible({ timeout: 30_000 })
  })

  test('view + snapshot CRUD round-trip through the authed API', async ({ page }) => {
    await login(page)
    const base = `/api/datasets/${datasetId}/views`
    const stamp = String(Date.now())

    // List works (RLS-scoped) and returns an array.
    let res = await page.request.get(base)
    expect(res.status()).toBe(200)
    expect(Array.isArray((await res.json()).views)).toBe(true)

    // Create a view.
    res = await page.request.post(base, { data: { kind: 'view', name: `_e2e_view_${stamp}`, filter_config: { filters: {} } } })
    expect(res.status()).toBe(201)
    const view = await res.json()
    expect(view.id).toBeTruthy()
    expect(view.kind).toBe('view')
    expect(view.visibility).toBe('private')

    // It shows up in the list.
    res = await page.request.get(base)
    const ids = ((await res.json()).views as { id: string }[]).map((v) => v.id)
    expect(ids).toContain(view.id)

    // Rename (update) works.
    res = await page.request.patch(`${base}/${view.id}`, { data: { name: `_e2e_view_${stamp}_renamed` } })
    expect(res.status()).toBe(200)

    // Freeze a snapshot — default 30-day TTL is stamped.
    res = await page.request.post(base, { data: { kind: 'snapshot', name: `_e2e_snap_${stamp}`, frozen: { filteredRowCount: 0, analytics: { totalRows: 0, computedAt: '', fieldSummaries: {} } } } })
    expect(res.status()).toBe(201)
    const snap = await res.json()
    expect(snap.kind).toBe('snapshot')
    expect(typeof snap.expires_at).toBe('string') // default TTL

    // Snapshot content is immutable: a name edit is rejected.
    res = await page.request.patch(`${base}/${snap.id}`, { data: { name: 'nope' } })
    expect(res.status()).toBe(400)

    // But the retention clock is mutable: keep forever.
    res = await page.request.patch(`${base}/${snap.id}`, { data: { expires_at: null } })
    expect(res.status()).toBe(200)

    // A non-existent item reads as a clean 404 (graceful-deleted path).
    res = await page.request.get(`${base}/00000000-0000-0000-0000-000000000000`)
    expect(res.status()).toBe(404)

    // Cleanup — delete both rows we created.
    expect((await page.request.delete(`${base}/${view.id}`)).status()).toBe(200)
    expect((await page.request.delete(`${base}/${snap.id}`)).status()).toBe(200)
  })
})
