/**
 * Playwright e2e — the CI smoke suite.
 *
 * Unlike the legacy specs (which need E2E_ADMIN_* human credentials and
 * therefore skip everywhere), this suite is fully self-contained: global
 * setup mints a throwaway TEST-project login and seeds its own 60-row
 * dataset, so it runs headless in CI against a production build.
 *
 * What it guards (each maps to a real prod incident or invariant):
 *  - authed shell renders (TopNav + SubHeader breadcrumbs)
 *  - /analyze listing shows a dataset card
 *  - dataset tab navigation PAINTS on every hop, including returning to a
 *    previously visited tab (the 2026-07-13 "Schema comes up once, then
 *    never again" wedge class — server 200s meant nothing was caught
 *    server-side; only a browser-level test sees this)
 *  - the Schema tab's editor + "Refresh from data" actually mount
 *  - the Filters modal opens (filter-options round-trip)
 *
 * One authenticated storageState for the whole file — no repeated logins.
 */
import { existsSync, readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { E2E_STATE_PATH, E2E_STORAGE_PATH } from './global-setup'

interface E2EState { skip: boolean; datasetId?: string }
const state: E2EState = existsSync(E2E_STATE_PATH)
  ? JSON.parse(readFileSync(E2E_STATE_PATH, 'utf8'))
  : { skip: true }

test.use({ storageState: E2E_STORAGE_PATH })

test.describe('smoke — authed shell + analyze navigation', () => {
  test.skip(state.skip, 'TEST Supabase creds not set — see docs/TESTING.md')

  test('authed pages render the app shell (TopNav + breadcrumbs)', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.locator('nav').first()).toBeVisible()
    // SubHeader breadcrumb bar (system-wide since 2026-07-12)
    await expect(page.getByRole('link', { name: 'Favorites' }).first()).toBeVisible()
  })

  test('/analyze lists the seeded dataset', async ({ page }) => {
    await page.goto('/analyze')
    await expect(page.getByText('[E2E SMOKE] Diner Feedback').first()).toBeVisible({ timeout: 20_000 })
  })

  test('dataset tabs paint on every hop — including RETURN visits', async ({ page }) => {
    const id = state.datasetId!
    await page.goto(`/analyze/${id}/textmine`)
    await expect(page.getByText('Themes').first()).toBeVisible({ timeout: 30_000 })

    // TextMine → Statistics
    await page.getByRole('link', { name: 'Statistics' }).first().click()
    await expect(page).toHaveURL(new RegExp(`/analyze/${id}/stats`), { timeout: 20_000 })

    // Statistics → Schema (the historical wedge transition)
    await page.getByRole('link', { name: 'Schema' }).first().click()
    await expect(page).toHaveURL(new RegExp(`/analyze/${id}/settings`), { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: 'Schema' }).first()).toBeVisible({ timeout: 20_000 })

    // Leave Schema…
    await page.getByRole('link', { name: 'TextMine' }).first().click()
    await expect(page).toHaveURL(new RegExp(`/analyze/${id}/textmine`), { timeout: 20_000 })

    // …and COME BACK. This is the exact sequence that wedged on prod
    // 2026-07-13: first visit fine, return visit never painted.
    await page.getByRole('link', { name: 'Schema' }).first().click()
    await expect(page.getByRole('heading', { name: 'Schema' }).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: /Refresh from data/ }).first()).toBeVisible()
  })

  test('Filters modal opens and lists filterable fields', async ({ page }) => {
    const id = state.datasetId!
    await page.goto(`/analyze/${id}/textmine`)
    await expect(page.getByText('Themes').first()).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: /Filters/ }).first().click()
    await expect(page.getByText('Location').first()).toBeVisible({ timeout: 20_000 })
  })

  // No unit test renders a chart, so a charting-library upgrade can pass every
  // other gate and still ship blank or untitled charts: Plotly 3 removed
  // string titles and they fail SILENTLY (2026-09-20, Plotly 2.35 → 4.0).
  test('Charts tab draws a real Plotly chart WITH its titles', async ({ page }) => {
    test.setTimeout(150_000)
    const id = state.datasetId!
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(e.message))
    await page.goto(`/analyze/${id}/charts`)
    // The seeded dataset is recreated each run, so analytics start uncomputed.
    const compute = page.getByRole('button', { name: 'Compute analytics' })
    const plot = page.locator('.js-plotly-plot').first()
    await expect(compute.or(plot)).toBeVisible({ timeout: 30_000 })
    if (await compute.isVisible()) await compute.click()
    await expect(plot).toBeVisible({ timeout: 90_000 })
    // Bar / Column over the seeded categorical field: chart title + y-axis title.
    await expect(page.locator('.js-plotly-plot .gtitle').first()).toHaveText('Location', { timeout: 20_000 })
    await expect(page.locator('.js-plotly-plot .ytitle').first()).toHaveText('Count')
    await page.getByRole('button', { name: 'Treemap' }).click()
    await expect(page.locator('.js-plotly-plot .gtitle').first()).toHaveText('Location', { timeout: 20_000 })
    expect(pageErrors).toEqual([])
  })

  // lib/hardNavigate — the deliberate full page load after a mutation. The
  // first Schema save on a new dataset (?new=1) must land on TextMine via a
  // real document load, not a client-side route change.
  test('first Schema save on a new dataset hard-navigates to TextMine', async ({ page }) => {
    const id = state.datasetId!
    await page.goto(`/analyze/${id}/settings?new=1`)
    const save = page.getByRole('button', { name: 'Save Schema' })
    await expect(save).toBeVisible({ timeout: 30_000 })
    // Save stays disabled until the schema is dirty; confirming an
    // auto-detected field is the real first-visit action.
    await page.getByRole('button', { name: '✓', exact: true }).first().click()
    await expect(save).toBeEnabled({ timeout: 10_000 })
    await page.evaluate(() => { (window as unknown as { __beforeNav?: boolean }).__beforeNav = true })
    await save.click()
    await expect(page).toHaveURL(new RegExp(`/analyze/${id}/textmine`), { timeout: 20_000 })
    await expect(page.getByText('Themes').first()).toBeVisible({ timeout: 30_000 })
    // A client-side route change would keep window state; a document load wipes it.
    expect(await page.evaluate(() => (window as unknown as { __beforeNav?: boolean }).__beforeNav)).toBeUndefined()
  })
})
