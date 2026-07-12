// Service credit alerting (lib/serviceAlerts, 2026-07-12) — emails the
// platform admin when a vendor is CLOSE TO (low) or HAS HIT (critical/error)
// a credit limit. pickAlertWorthy is the shared throttle; maybeAlertCreditError
// is the real-time claim-then-send path recordCreditError fires on a 402.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ServiceHealthRow } from '@/lib/serviceHealth'

const sendSpy = vi.fn(async () => ({ ok: true }))
vi.mock('@/lib/email/provider', () => ({ getEmailProvider: () => ({ send: sendSpy }) }))

const db = { claimed: [] as unknown[], updates: 0 }
vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      update: () => { db.updates++; return { eq: () => ({ or: () => ({ select: async () => ({ data: db.claimed }) }) }) } },
    }),
  }),
}))

import { pickAlertWorthy, maybeAlertCreditError, REALERT_BAD_MS, REALERT_LOW_MS } from '@/lib/serviceAlerts'

const NOW = 1_800_000_000_000
const row = (status: ServiceHealthRow['status'], lastAlertedAgoMs: number | null): ServiceHealthRow => ({
  service: 's', display_name: 'Svc', tier: 1, balance_usd: 3,
  status, checked_at: null, last_error_at: null, last_error_code: null,
  last_error_msg: 'credit balance is too low',
  last_alerted_at: lastAlertedAgoMs == null ? null : new Date(NOW - lastAlertedAgoMs).toISOString(),
  updated_at: null,
})

beforeEach(() => {
  sendSpy.mockClear()
  db.claimed = []
  db.updates = 0
  process.env.CREDITS_ALERT_TO = 'admin@example.com'
})

describe('pickAlertWorthy — per-status re-alert windows', () => {
  it('low ("close to the limit") alerts, on a ~3-day window', () => {
    expect(pickAlertWorthy([row('low', null)], NOW)).toHaveLength(1)
    expect(pickAlertWorthy([row('low', REALERT_LOW_MS + 1000)], NOW)).toHaveLength(1)
    expect(pickAlertWorthy([row('low', REALERT_LOW_MS - 1000)], NOW)).toHaveLength(0) // still inside the window
  })

  it('critical/error alert on the ~daily window', () => {
    expect(pickAlertWorthy([row('error', null)], NOW)).toHaveLength(1)
    expect(pickAlertWorthy([row('critical', REALERT_BAD_MS + 1000)], NOW)).toHaveLength(1)
    expect(pickAlertWorthy([row('error', REALERT_BAD_MS - 1000)], NOW)).toHaveLength(0)
  })

  it('ok/unknown never alert', () => {
    expect(pickAlertWorthy([row('ok', null), row('unknown', null)], NOW)).toHaveLength(0)
  })
})

describe('maybeAlertCreditError — real-time claim-then-send', () => {
  it('sends one email per recipient when the claim wins', async () => {
    db.claimed = [row('error', null)]
    process.env.CREDITS_ALERT_TO = 'a@example.com, b@example.com'
    const sent = await maybeAlertCreditError('anthropic')
    expect(sent).toBe(true)
    expect(sendSpy).toHaveBeenCalledTimes(2) // one per recipient
    const first = sendSpy.mock.calls[0][0] as { subject: string; to: string }
    expect(first.subject).toContain('Service credits')
  })

  it('skips silently when another concurrent caller already claimed the window', async () => {
    db.claimed = [] // atomic claim matched zero rows
    const sent = await maybeAlertCreditError('anthropic')
    expect(sent).toBe(false)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('is a no-op without recipients (no DB write either)', async () => {
    process.env.CREDITS_ALERT_TO = ''
    process.env.SENTRY_ALERT_TO = ''
    const sent = await maybeAlertCreditError('anthropic')
    expect(sent).toBe(false)
    expect(db.updates).toBe(0)
    expect(sendSpy).not.toHaveBeenCalled()
  })
})
