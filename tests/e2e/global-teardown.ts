// tests/e2e/global-teardown.ts
// Removes the seeded smoke dataset. The throwaway org + user persist across
// runs (find-or-create in setup) — only the data churns. A crashed run is
// self-healing: setup deletes any prior dataset with the same name first.

import { existsSync, readFileSync } from 'node:fs'
import { e2eEnv, cleanupE2E } from './helpers/e2eSeed'
import { E2E_STATE_PATH } from './global-setup'

export default async function globalTeardown() {
  if (!existsSync(E2E_STATE_PATH)) return
  const state = JSON.parse(readFileSync(E2E_STATE_PATH, 'utf8'))
  if (state.skip || !state.datasetId) return
  const env = e2eEnv()
  if (!env) return
  await cleanupE2E(env, { orgId: state.orgId, datasetId: state.datasetId })
  console.log('[e2e] cleaned up seeded dataset')
}
