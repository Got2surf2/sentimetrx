import 'server-only'

// lib/modelHealth.ts
// Verifies the Anthropic models this app is configured to call still exist.
//
// Why: Anthropic retires dated model snapshots on a published schedule (~1 year
// out). The day a configured snapshot retires, every call to it returns 404 and
// the feature silently breaks (this is exactly how claude-sonnet-4-20250514 took
// down Ask Ana + the `standard` tier on 2026-06-15). This checks each configured
// model against GET /v1/models/{id} so the model-health cron can warn us weeks
// early instead of us finding out on retirement day.
//
// Source of truth for "what we call" is lib/usageRates.ts → TIER_DEFAULT_MODEL.

import { TIER_DEFAULT_MODEL } from '@/lib/usageRates'

export interface ModelHealthResult {
  model: string
  tiers: string[]
  status: 'ok' | 'missing' | 'unknown'
  detail?: string
}

export interface ModelHealthReport {
  ok: boolean
  checked: number
  problems: number
  results: ModelHealthResult[]
}

// Distinct configured models → which tiers use each (for a readable report).
function configuredModels(): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const [tier, model] of Object.entries(TIER_DEFAULT_MODEL)) {
    m.set(model, [...(m.get(model) || []), tier])
  }
  return m
}

export async function checkConfiguredModels(apiKey: string): Promise<ModelHealthReport> {
  const results: ModelHealthResult[] = []

  for (const [model, tiers] of configuredModels()) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/models/' + encodeURIComponent(model), {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      })
      if (res.ok) {
        results.push({ model, tiers, status: 'ok' })
      } else if (res.status === 404) {
        results.push({ model, tiers, status: 'missing', detail: 'retired or unknown model id (HTTP 404)' })
      } else {
        results.push({ model, tiers, status: 'unknown', detail: 'models API returned HTTP ' + res.status })
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : undefined
      results.push({ model, tiers, status: 'unknown', detail: message || 'fetch failed' })
    }
  }

  const problems = results.filter(r => r.status === 'missing').length
  return { ok: problems === 0, checked: results.length, problems, results }
}
