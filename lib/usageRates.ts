// lib/usageRates.ts
// Pure constants & helpers — safe to import from client components.
// Server-only logging lives in lib/usageLog.ts (which re-exports from here).

/**
 * Per-1M-token rates (USD). Source of truth for both /admin/usage's
 * historical cost computation AND the forward-looking estimator at
 * /admin/estimator. Cost is DERIVED from stored token counts at display time,
 * so correcting a rate here retroactively fixes historical cost too.
 *
 * Snapshot: 2026-07-02 — Anthropic rates verified against the claude-api
 * pricing reference (cache_read ≈ 0.1× input). Prior table had Haiku
 * under-priced ($0.80) and Opus at $15/$75 (old Opus-3-era pricing) — current
 * Opus 4.x is $5/$25, so recording-analysis cost had been logged ~3× high.
 */
export const RATES: Record<string, { input: number; output: number; cache_read: number }> = {
  // Anthropic — current (per 1M tokens)
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00, cache_read: 0.10 },
  'claude-haiku-4-5':          { input: 1.00, output: 5.00, cache_read: 0.10 },
  'claude-sonnet-4-6':         { input: 3.00, output: 15.00, cache_read: 0.30 },
  'claude-opus-4-8':           { input: 5.00, output: 25.00, cache_read: 0.50 },
  'claude-opus-4-7':           { input: 5.00, output: 25.00, cache_read: 0.50 },
  'claude-fable-5':            { input: 10.00, output: 50.00, cache_read: 1.00 },
  // Anthropic — retired snapshot kept for historical rows (Sonnet 4 = $3/$15)
  'claude-sonnet-4-20250514':  { input: 3.00, output: 15.00, cache_read: 0.30 },
  // OpenAI text (via callAI)
  'gpt-4o-mini':               { input: 0.15, output: 0.60, cache_read: 0.075 },
  'gpt-4o':                    { input: 2.50, output: 10.00, cache_read: 1.25 },
  // OpenAI embeddings (lib/embeddings — token-priced, input only, no output/cache)
  'text-embedding-3-small':    { input: 0.02, output: 0.00, cache_read: 0.00 },
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
  // Unknown model → fall back to the STANDARD tier (Sonnet), not the cheapest
  // (Haiku). Defaulting to Haiku silently under-stated any Opus/Sonnet-priced
  // unknown; a new model is far likelier to be standard-or-above than cheapest.
  var rates = RATES[model] || RATES['claude-sonnet-4-6']
  var inputCost = ((input_tokens - cache_read_tokens) / 1_000_000) * rates.input
  var cacheCost = (cache_read_tokens / 1_000_000) * rates.cache_read
  var outputCost = (output_tokens / 1_000_000) * rates.output
  return Math.round((inputCost + cacheCost + outputCost) * 1_000_000) / 1_000_000 // 6 decimal places
}
