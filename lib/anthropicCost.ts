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

// ── Live credit probe ────────────────────────────────────────────────────────
// Anthropic exposes spend but not balance, so "have we run out?" can only be
// answered by ASKING: one 1-output-token Haiku call (~$0.00001). A credit-
// exhausted account returns a typed `billing_error` (403) or an
// invalid_request_error mentioning "credit balance" — either way the probe
// reports out_of_credits and the health page shows the re-up pill (owner ask,
// 2026-07-12). Complements the reactive path (recordCreditError from real
// traffic): the probe catches exhaustion even when no traffic is flowing.
// Uses the regular ANTHROPIC_API_KEY (not the admin key) — the probe must
// exercise the same key the app's AI calls use.

export interface ClaudeProbe {
  status: 'ok' | 'out_of_credits' | 'error' | 'unconfigured'
  message: string | null
}

export async function probeClaudeCredits(): Promise<ClaudeProbe> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { status: 'unconfigured', message: null }
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 6000)
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (res.ok) return { status: 'ok', message: null }
    const body = await res.json().catch(() => null) as { error?: { type?: string; message?: string } } | null
    const errType = body?.error?.type || ''
    const errMsg = body?.error?.message || ('HTTP ' + res.status)
    if (errType === 'billing_error' || /credit balance/i.test(errMsg)) {
      return { status: 'out_of_credits', message: errMsg }
    }
    if (res.status === 401) return { status: 'error', message: 'API key invalid (401)' }
    // 429/529 = rate limited/overloaded, not a credit problem — key is alive.
    if (res.status === 429 || res.status === 529) return { status: 'ok', message: null }
    return { status: 'error', message: errType ? errType + ': ' + errMsg : errMsg }
  } catch {
    return { status: 'error', message: 'probe timed out or network error' }
  }
}
