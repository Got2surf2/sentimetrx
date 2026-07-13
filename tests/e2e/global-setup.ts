// tests/e2e/global-setup.ts
// Seeds the throwaway e2e user + smoke dataset and writes an authenticated
// Playwright storageState — one sign-in for the whole suite (repeated UI
// logins trip Supabase auth rate limiting). Without real TEST-project creds
// it writes {skip:true} and every smoke test self-skips (same env-gating
// contract as the rest of the suite; see docs/TESTING.md).

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { FullConfig } from '@playwright/test'
import { e2eEnv, seedE2E, mintCookies } from './helpers/e2eSeed'

export const E2E_STATE_PATH = join(__dirname, '.state', 'e2e-state.json')
export const E2E_STORAGE_PATH = join(__dirname, '.state', 'storage-state.json')

export default async function globalSetup(config: FullConfig) {
  mkdirSync(dirname(E2E_STATE_PATH), { recursive: true })
  const env = e2eEnv()
  if (!env) {
    writeFileSync(E2E_STATE_PATH, JSON.stringify({ skip: true }))
    writeFileSync(E2E_STORAGE_PATH, JSON.stringify({ cookies: [], origins: [] }))
    console.log('[e2e] no TEST Supabase creds — smoke suite will skip')
    return
  }

  const ids = await seedE2E(env)
  const baseURL = config.projects[0]?.use?.baseURL || 'http://localhost:3000'
  const domain = new URL(baseURL).hostname
  const cookies = await mintCookies(env, ids.password, domain)

  writeFileSync(E2E_STORAGE_PATH, JSON.stringify({ cookies, origins: [] }))
  writeFileSync(E2E_STATE_PATH, JSON.stringify({
    skip: false, orgId: ids.orgId, userId: ids.userId, datasetId: ids.datasetId,
  }))
  console.log(`[e2e] seeded org=${ids.orgId} dataset=${ids.datasetId}`)
}
