// lib/usageLog.ts
// Fire-and-forget AI usage logging for cost tracking and pricing.
// Call after any callAI() where you know the org/resource context.
//
// SERVER-ONLY: this file imports lib/supabase/server which uses next/headers.
// The pure rate constants live in lib/usageRates.ts so client code can import
// them safely; both /admin/usage and /admin/estimator share that source of truth.

import { createServiceRoleClient } from '@/lib/supabase/server'
import { waitUntil } from '@vercel/functions'
import type { AIUsage } from '@/lib/ai'

// Re-export the pure constants so existing server callers don't need to update imports.
export { RATES, TIER_DEFAULT_MODEL, estimateCost } from '@/lib/usageRates'

// Keep the function alive until the insert lands. logUsage is called right before
// a handler returns its response; on Fluid Compute the instance can freeze on
// response-flush and drop an un-awaited insert, systematically under-counting AI
// spend under load. waitUntil defers shutdown until the promise settles. Guarded:
// outside a request context (some cron/script paths) waitUntil throws — fall back
// to letting the promise run best-effort.
function persist(p: PromiseLike<unknown>): void {
  const promise = Promise.resolve(p)
  try { waitUntil(promise) } catch { void promise }
}

export interface UsageContext {
  org_id?: string
  resource_type: 'bot' | 'townhall' | 'social' | 'dataset' | 'study' | 'recording' | 'system'
  resource_id?: string
  event_type: string   // 'chat', 'persona', 'demographics', 'intent', 'deflect', 'summary', 'theme_detect', 'knowledge_classify', 'ai_reply', 'report', 'translate', 'research', 'ana', 'study_suggest', 'clarify', 'recording_extract', 'recording_curate', 'recording_transcribe'
}

/**
 * Log AI token usage. Fire-and-forget — never blocks or throws.
 */
export function logUsage(context: UsageContext, usage: AIUsage | undefined): void {
  if (!usage) return
  if (usage.input_tokens === 0 && usage.output_tokens === 0) return

  try {
    var service = createServiceRoleClient()
    persist(service.from('usage_logs').insert({
      org_id: context.org_id || null,
      resource_type: context.resource_type,
      resource_id: context.resource_id || null,
      event_type: context.event_type,
      model: usage.model,
      provider: usage.provider,
      tier: usage.tier,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_tokens: usage.cache_read_tokens,
      cache_creation_tokens: usage.cache_creation_tokens,
    }).then(function(r: any) {
      if (r.error) console.error('[usage] log failed:', r.error.message)
    }))
  } catch (e: any) {
    // Never block the caller
    console.error('[usage] log error:', e?.message)
  }
}

/**
 * Log a flat, non-token cost (e.g. an ASR transcription vendor charge) so it
 * appears in the accounting dashboard alongside token-based AI usage. The row
 * carries 0 tokens and a `cost_cents` figure the dashboard adds directly.
 * `model` is NOT NULL in the schema, so we stamp a descriptive label.
 * Fire-and-forget — never blocks or throws.
 */
export function logFlatCost(
  context: UsageContext,
  costCents: number,
  opts: { model?: string; provider?: string } = {},
): void {
  if (!costCents || costCents <= 0) return

  try {
    var service = createServiceRoleClient()
    persist(service.from('usage_logs').insert({
      org_id: context.org_id || null,
      resource_type: context.resource_type,
      resource_id: context.resource_id || null,
      event_type: context.event_type,
      model: opts.model || 'flat',
      provider: opts.provider || 'flat',
      tier: 'flat',
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      cost_cents: Math.round(costCents),
    }).then(function(r: any) {
      if (r.error) console.error('[usage] flat-cost log failed:', r.error.message)
    }))
  } catch (e: any) {
    console.error('[usage] flat-cost log error:', e?.message)
  }
}

