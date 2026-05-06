// lib/usageLog.ts
// Fire-and-forget AI usage logging for cost tracking and pricing.
// Call after any callAI() where you know the org/resource context.

import { createServiceRoleClient } from '@/lib/supabase/server'
import type { AIUsage } from '@/lib/ai'

export interface UsageContext {
  org_id?: string
  resource_type: 'bot' | 'townhall' | 'social' | 'dataset' | 'system'
  resource_id?: string
  event_type: string   // 'chat', 'persona', 'demographics', 'intent', 'deflect', 'summary', 'theme_detect', 'knowledge_classify', 'ai_reply', 'report', 'translate', 'research', 'ana'
}

/**
 * Log AI token usage. Fire-and-forget — never blocks or throws.
 */
export function logUsage(context: UsageContext, usage: AIUsage | undefined): void {
  if (!usage) return
  if (usage.input_tokens === 0 && usage.output_tokens === 0) return

  try {
    var service = createServiceRoleClient()
    service.from('usage_logs').insert({
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
    })
  } catch (e: any) {
    // Never block the caller
    console.error('[usage] log error:', e?.message)
  }
}

/**
 * Per-1M-token rates (USD). Source of truth for both the dashboard's
 * historical cost computation AND the forward-looking cost estimator at
 * /admin/estimator. Update this table when provider prices change and both
 * surfaces stay in sync.
 *
 * Snapshot: May 2025.
 */
export const RATES: Record<string, { input: number; output: number; cache_read: number }> = {
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00, cache_read: 0.08 },
  'claude-sonnet-4-20250514':  { input: 3.00, output: 15.00, cache_read: 0.30 },
  'claude-sonnet-4-6':         { input: 3.00, output: 15.00, cache_read: 0.30 },
  'gpt-4o-mini':               { input: 0.15, output: 0.60, cache_read: 0.075 },
  'gpt-4o':                    { input: 2.50, output: 10.00, cache_read: 1.25 },
}

/**
 * Tier → default model used for forward estimation. Mirrors lib/ai.ts:MODEL_MAP
 * for the Anthropic provider (the most-used tier in this codebase).
 */
export const TIER_DEFAULT_MODEL: Record<'fast' | 'standard' | 'advanced', string> = {
  fast:     'claude-haiku-4-5-20251001',
  standard: 'claude-sonnet-4-20250514',
  advanced: 'claude-sonnet-4-6',
}

export function estimateCost(model: string, input_tokens: number, output_tokens: number, cache_read_tokens: number): number {
  var rates = RATES[model] || RATES['claude-haiku-4-5-20251001']
  var inputCost = ((input_tokens - cache_read_tokens) / 1_000_000) * rates.input
  var cacheCost = (cache_read_tokens / 1_000_000) * rates.cache_read
  var outputCost = (output_tokens / 1_000_000) * rates.output
  return Math.round((inputCost + cacheCost + outputCost) * 1_000_000) / 1_000_000 // 6 decimal places
}
