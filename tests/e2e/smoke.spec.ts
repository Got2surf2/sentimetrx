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
})
