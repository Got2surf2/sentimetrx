import 'server-only'

// Anthropic Usage & Cost Admin API — month-to-date spend for the Claude API
// account. There is NO Anthropic endpoint for *remaining* prepaid balance
// (verified against the docs 2026-07-07); the Cost API reports spend only, so
// this shows burn rate, not what's left. The real "credits ran out" signal is
// the reactive credit-error path in lib/ai.ts → recordCreditError('anthropic').
//
// Requires an Admin API key (sk-ant-admin01-…, distinct from the app's regular
// ANTHROPIC_API_KEY) in ANTHROPIC_ADMIN_KEY. Absent → { configured: false }.
// Docs: https://platform.claude.com/docs/en/api/admin-api/usage-cost/get-cost-report

type CostBucket = { starting_at: string; results: { amount: string }[] }
type CostReport = { data: CostBucket[]; has_more: boolean; next_page: string | null }

export interface AnthropicSpend {
  configured: boolean
  mtdUsd: number | null   // month-to-date spend, USD
  last7Usd: number | null // trailing-7-day spend, USD
  asOf: string | null     // ISO timestamp the figure was computed
  error: string | null
}

// The Cost API returns `amount` in the currency's lowest unit (cents) as a
// decimal string — "123.45" USD is $1.23. Sum, then divide by 100.
function sumCents(buckets: CostBucket[], sinceMs = 0): number {
  let cents = 0
  for (const b of buckets) {
    if (sinceMs && new Date(b.starting_at).getTime() < sinceMs) continue
    for (const r of b.results) cents += parseFloat(r.amount) || 0
  }
  return cents / 100
}

export async function getAnthropicSpend(): Promise<AnthropicSpend> {
  const key = process.env.ANTHROPIC_ADMIN_KEY
  if (!key) return { configured: false, mtdUsd: null, last7Usd: null, asOf: null, error: null }

  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const sevenDaysAgoMs = now.getTime() - 7 * 86400_000

  try {
    // One month is ≤31 daily buckets, so a single page (limit 31) covers MTD.
    const url = `https://api.anthropic.com/v1/organizations/cost_report?starting_at=${encodeURIComponent(monthStart)}&bucket_width=1d&limit=31`
    const res = await fetch(url, {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      cache: 'no-store',
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return {
        configured: true, mtdUsd: null, last7Usd: null, asOf: null,
        error: `Cost API ${res.status}${body ? ` — ${body.slice(0, 120)}` : ''}`,
      }
    }
    const report = await res.json() as CostReport
    const buckets = report.data || []
    return {
      configured: true,
      mtdUsd: sumCents(buckets),
      last7Usd: sumCents(buckets, sevenDaysAgoMs),
      asOf: now.toISOString(),
      error: null,
    }
  } catch (e) {
    return {
      configured: true, mtdUsd: null, last7Usd: null, asOf: null,
      error: e instanceof Error ? e.message : 'Cost API unreachable',
    }
  }
}
