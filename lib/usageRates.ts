// lib/usageRates.ts
// Pure constants & helpers — safe to import from client components.
// Server-only logging lives in lib/usageLog.ts (which re-exports from here).

/**
 * Per-1M-token rates (USD). Source of truth for both /admin/usage's
 * historical cost computation AND the forward-looking estimator at
 * /admin/estimator. Update this table when provider prices change and
 * both surfaces stay in sync.
 *
 * Snapshot: May 2025.
 */
export const RATES: Record<string, { input: number; output: number; cache_read: number }> = {
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00, cache_read: 0.08 },
  'claude-haiku-4-5':          { input: 0.80, output: 4.00, cache_read: 0.08 },
  'claude-sonnet-4-20250514':  { input: 3.00, output: 15.00, cache_read: 0.30 },
  'claude-sonnet-4-6':         { input: 3.00, output: 15.00, cache_read: 0.30 },
  'claude-opus-4-7':           { input: 15.00, output: 75.00, cache_read: 1.50 },
  'gpt-4o-mini':               { input: 0.15, output: 0.60, cache_read: 0.075 },
  'gpt-4o':                    { input: 2.50, output: 10.00, cache_read: 1.25 },
}

/**
 * Tier → Anthropic model. SINGLE SOURCE OF TRUTH for which model each tier
 * calls. lib/ai.ts (MODEL_MAP.anthropic) and every Anthropic call site import
 * from here, so a model swap (e.g. a snapshot retirement) is a one-line change
 * and never goes stale in a route file. Keep raw `claude-*` IDs out of routes.
 *
 * Note: the RATES table above is keyed by every model we've EVER logged (incl.
 * retired snapshots like claude-sonnet-4-20250514) for historical cost accuracy
 * — that is intentionally separate from this "what we call today" map.
 */
export const TIER_DEFAULT_MODEL: Record<'fast' | 'standard' | 'advanced', string> = {
  fast:     'claude-haiku-4-5',
  standard: 'claude-sonnet-4-6',
  advanced: 'claude-sonnet-4-6',
}

export function estimateCost(model: string, input_tokens: number, output_tokens: number, cache_read_tokens: number): number {
  var rates = RATES[model] || RATES['claude-haiku-4-5-20251001']
  var inputCost = ((input_tokens - cache_read_tokens) / 1_000_000) * rates.input
  var cacheCost = (cache_read_tokens / 1_000_000) * rates.cache_read
  var outputCost = (output_tokens / 1_000_000) * rates.output
  return Math.round((inputCost + cacheCost + outputCost) * 1_000_000) / 1_000_000 // 6 decimal places
}
