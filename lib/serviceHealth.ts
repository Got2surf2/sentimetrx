import 'server-only'

// lib/serviceHealth.ts
//
// Platform service-credit / health monitor. Single source of truth for
// "are we out of credits on any vendor". Backs /admin/health and the
// service-balance cron. See sql/126_service_health.sql.
//
// Two tiers (see SERVICES):
//   tier 1 — vendor exposes a balance API → probeBalances() polls it.
//   tier 2 — no balance API → recordCreditError() captures the last failed
//            call (402/429/"credit balance too low") from the client code.
//
// Every write is best-effort and NEVER throws: a monitoring write must not
// break the request path it's observing (it's wrapped in try/catch and
// swallows). createServiceRoleClient is used directly — this is platform
// state, not org-scoped data.

import { createServiceRoleClient } from '@/lib/supabase/server'
import { maybeAlertCreditError } from '@/lib/serviceAlerts'
import { logError } from '@/lib/log'

export type ServiceKey =
  | 'dataforseo' | 'deepgram' | 'twilio'
  | 'anthropic' | 'openai' | 'resend' | 'google_places'

export type ServiceStatus = 'ok' | 'low' | 'critical' | 'error' | 'unknown'

interface ServiceMeta {
  key: ServiceKey
  name: string
  tier: 1 | 2
  /** USD thresholds for tier-1 balance probes. */
  warn?: number
  crit?: number
}

// The vendor accounts we watch. Tier-1 thresholds are deliberately generous
// for paid pilots — a low warn fires while there's still runway to top up.
export const SERVICES: ServiceMeta[] = [
  { key: 'dataforseo',    name: 'DataForSEO',           tier: 1, warn: 50, crit: 5 },
  { key: 'deepgram',      name: 'Deepgram (ASR)',       tier: 1, warn: 25, crit: 2 },
  { key: 'twilio',        name: 'Twilio (SMS)',         tier: 1, warn: 20, crit: 2 },
  { key: 'anthropic',     name: 'Anthropic (Claude)',   tier: 2 },
  { key: 'openai',        name: 'OpenAI / Azure OpenAI', tier: 2 },
  { key: 'resend',        name: 'Resend (email)',       tier: 2 },
  { key: 'google_places', name: 'Google Places',        tier: 2 },
]

const META: Record<string, ServiceMeta> = Object.fromEntries(SERVICES.map(s => [s.key, s]))

export interface ServiceHealthRow {
  service: string
  display_name: string
  tier: number
  balance_usd: number | null
  status: ServiceStatus
  checked_at: string | null
  last_error_at: string | null
  last_error_code: string | null
  last_error_msg: string | null
  last_alerted_at: string | null
  updated_at: string | null
}

/** Shape of a persisted `service_health` row as read back from the DB. */
type StoredServiceRow = Partial<ServiceHealthRow> & { service: string }

/** Severity ordering for sorting/alerting (higher = worse). */
export const STATUS_RANK: Record<ServiceStatus, number> = {
  critical: 4, error: 3, low: 2, unknown: 1, ok: 0,
}

export function statusForBalance(key: ServiceKey, usd: number | null): ServiceStatus {
  if (usd == null || Number.isNaN(usd)) return 'unknown'
  const m = META[key]
  if (m?.crit != null && usd <= m.crit) return 'critical'
  if (m?.warn != null && usd <= m.warn) return 'low'
  return 'ok'
}

/** Heuristic: does this error look like an out-of-credit / quota failure? */
export function isCreditError(status?: number, message?: string): boolean {
  if (status === 402) return true
  const m = (message || '').toLowerCase()
  if (status === 429 && /credit|quota|balance|billing|insufficient|exceeded/.test(m)) return true
  return /credit balance is too low|insufficient (funds|credit|balance|quota)|payment required|quota exceeded|billing/.test(m)
}

// ── Writes (best-effort, never throw) ────────────────────────────────────

/** Record the most recent credit/quota failure for a service (tier-1 or -2). */
export async function recordCreditError(
  key: ServiceKey,
  opts: { code?: string | number; message?: string } = {},
): Promise<void> {
  try {
    const meta = META[key]
    if (!meta) return
    const svc = createServiceRoleClient()
    const now = new Date().toISOString()
    await svc.from('service_health').upsert({
      service: key,
      display_name: meta.name,
      tier: meta.tier,
      status: 'error',
      last_error_at: now,
      last_error_code: opts.code != null ? String(opts.code) : null,
      last_error_msg: (opts.message || '').slice(0, 500) || 'credit/quota error',
      updated_at: now,
    }, { onConflict: 'service' })
    // Hitting a limit emails the platform admin IMMEDIATELY (throttled ~daily
    // per service; claim-then-send, so a burst of 402s yields one email) —
    // the 6h service-balance cron is the backstop, not the pager.
    await maybeAlertCreditError(key)
  } catch { /* monitoring must never break the caller */ }
}

/** Record a polled balance for a tier-1 service and derive its status. */
export async function recordBalance(
  key: ServiceKey,
  balanceUsd: number,
  raw?: unknown,
): Promise<ServiceStatus> {
  const status = statusForBalance(key, balanceUsd)
  try {
    const meta = META[key]
    if (!meta) return status
    const svc = createServiceRoleClient()
    const now = new Date().toISOString()
    await svc.from('service_health').upsert({
      service: key,
      display_name: meta.name,
      tier: meta.tier,
      balance_usd: balanceUsd,
      balance_raw: (raw ?? null),
      status,
      checked_at: now,
      updated_at: now,
    }, { onConflict: 'service' })
  } catch { /* swallow */ }
  return status
}

// ── Tier-1 balance probes ────────────────────────────────────────────────
// Each returns a USD number or throws. Missing creds → throw (caller marks
// the service 'unknown', i.e. "not configured", rather than 'error').

// Deepgram scopes the balance endpoint behind `billing:read`, which the ASR
// key deliberately lacks (it only needs `usage:write`). Prefer a dedicated
// billing-scoped key; fall back to the ASR key so the probe still reports
// something on accounts where one key carries both scopes.
async function probeDeepgramBalance(): Promise<number> {
  const key = process.env.DEEPGRAM_BILLING_KEY || process.env.DEEPGRAM_API_KEY
  if (!key) throw new Error('DEEPGRAM_BILLING_KEY / DEEPGRAM_API_KEY not set')
  const h = { Authorization: `Token ${key}` }
  const projRes = await fetch('https://api.deepgram.com/v1/projects', { headers: h, cache: 'no-store' })
  if (!projRes.ok) throw new Error(`Deepgram projects HTTP ${projRes.status}`)
  const projId = (await projRes.json())?.projects?.[0]?.project_id
  if (!projId) throw new Error('Deepgram: no project found')
  const balRes = await fetch(`https://api.deepgram.com/v1/projects/${projId}/balances`, { headers: h, cache: 'no-store' })
  if (balRes.status === 403) throw new Error('Deepgram balances HTTP 403 — key lacks billing:read (set DEEPGRAM_BILLING_KEY)')
  if (!balRes.ok) throw new Error(`Deepgram balances HTTP ${balRes.status}`)
  const balances: Array<{ amount?: number | string | null }> = (await balRes.json())?.balances ?? []
  // `amount` is the remaining USD value per balance bucket; sum across buckets.
  return balances.reduce((sum: number, b) => sum + (Number(b?.amount) || 0), 0)
}

async function probeTwilioBalance(): Promise<number> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set')
  const auth = 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64')
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Balance.json`, {
    headers: { Authorization: auth }, cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Twilio Balance HTTP ${res.status}`)
  const bal = Number((await res.json())?.balance)
  if (Number.isNaN(bal)) throw new Error('Twilio: no balance in response')
  return bal
}

/**
 * Poll every tier-1 balance, persist each, and return the per-service outcome.
 * DataForSEO is dynamically imported to avoid a static import cycle
 * (lib/dataforseo.ts imports recordCreditError from here).
 */
export async function probeBalances(): Promise<Array<{ key: ServiceKey; status: ServiceStatus; balance?: number; error?: string }>> {
  const probes: Array<{ key: ServiceKey; fn: () => Promise<number> }> = [
    { key: 'dataforseo', fn: async () => (await import('./dataforseo')).getDataForSeoBalance() },
    { key: 'deepgram',   fn: probeDeepgramBalance },
    { key: 'twilio',     fn: probeTwilioBalance },
  ]
  const out: Array<{ key: ServiceKey; status: ServiceStatus; balance?: number; error?: string }> = []
  for (const p of probes) {
    try {
      const bal = await p.fn()
      const status = await recordBalance(p.key, bal)
      out.push({ key: p.key, status, balance: bal })
    } catch (e) {
      const msg = (e instanceof Error ? e.message : '') || 'probe failed'
      // A 402/credit error → flag as out-of-credit; anything else (missing
      // creds, network) → leave the row's existing state, report 'unknown'.
      if (isCreditError(undefined, msg)) {
        await recordCreditError(p.key, { code: 402, message: msg })
        out.push({ key: p.key, status: 'critical', error: msg })
      } else {
        out.push({ key: p.key, status: 'unknown', error: msg })
      }
    }
  }
  return out
}

// ── Read (for /admin/health) ─────────────────────────────────────────────

/**
 * All watched services with their current health, every SERVICES entry
 * present even if never written (so the page lists the full roster).
 * Sorted worst-status-first.
 */
export async function getServiceHealthRows(): Promise<ServiceHealthRow[]> {
  let stored: Record<string, StoredServiceRow> = {}
  try {
    const svc = createServiceRoleClient()
    const { data, error: healthErr } = await svc.from('service_health').select('*')
    if (healthErr) void logError('serviceHealth.getServiceHealthRows', healthErr)
    stored = Object.fromEntries((data ?? []).map((r: StoredServiceRow) => [r.service, r]))
  } catch { /* fall through to defaults */ }

  const rows: ServiceHealthRow[] = SERVICES.map(s => {
    const r = stored[s.key]
    return {
      service: s.key,
      display_name: s.name,
      tier: s.tier,
      balance_usd: r?.balance_usd ?? null,
      status: (r?.status as ServiceStatus) ?? 'unknown',
      checked_at: r?.checked_at ?? null,
      last_error_at: r?.last_error_at ?? null,
      last_error_code: r?.last_error_code ?? null,
      last_error_msg: r?.last_error_msg ?? null,
      last_alerted_at: r?.last_alerted_at ?? null,
      updated_at: r?.updated_at ?? null,
    }
  })
  rows.sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || a.display_name.localeCompare(b.display_name))
  return rows
}
