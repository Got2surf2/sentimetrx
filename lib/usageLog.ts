// lib/usageLog.ts
// Fire-and-forget AI usage logging for cost tracking and pricing.
// Call after any callAI() where you know the org/resource context.
//
// SERVER-ONLY: this file imports lib/supabase/server which uses next/headers.
// The pure rate constants live in lib/usageRates.ts so client code can import
// them safely; both /admin/usage and /admin/estimator share that source of truth.

import { createServiceRoleClient } from '@/lib/supabase/server'
import type { AIUsage } from '@/lib/ai'

// Re-export the pure constants so existing server callers don't need to update imports.
export { RATES, TIER_DEFAULT_MODEL, estimateCost } from '@/lib/usageRates'

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

