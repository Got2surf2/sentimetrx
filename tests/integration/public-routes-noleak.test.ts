// tests/integration/public-routes-noleak.test.ts
//
// Phase 1 — the genuinely-public surface. These routes are intentionally
// unauthenticated (participant widgets, webhooks, embeds, demo kiosk). They are
// NOT org-gated; instead each carries a different safety mechanism so it cannot
// leak or forge across tenants. This suite asserts those mechanisms for the
// routes with a clear, testable contract; docs/SECURITY.md § "Public surface"
// documents the full list + why each is safe.
//
//   - campaigns/webhooks/resend  → rejects a request without a valid Svix HMAC
//   - social/webhook             → rejects a request without a valid Meta HMAC
//   - townhall/responses         → anonymous self-write, but only after the
//                                   participant is validated against the session
//   - translate-responses        → translates only caller-supplied body text
//                                   (no tenant read); short-circuits / size-caps

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const ctx = { results: {} as Record<string, any> }
function reset() { ctx.results = {} }

function builder(table: string): any {
  const b: any = {}
  for (const m of ['select', 'eq', 'order', 'in', 'limit', 'update', 'delete', 'insert']) b[m] = () => b
  b.single = async () => ctx.results[table] ?? { data: null, error: null }
  b.maybeSingle = b.single
  b.then = (res: any, rej: any) => Promise.resolve(ctx.results[table] ?? { data: [], count: 0, error: null }).then(res, rej)
  // head:true count queries read `.count`
  Object.defineProperty(b, 'count', { get: () => 0 })
  return b
}
const client = () => ({ from: (t: string) => builder(t) })

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => client(),
  createServiceRoleClient: () => client(),
  getAuthUser: async () => null,
}))
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: async () => ({ limited: false, ok: true, allowed: true }) }))
vi.mock('@/lib/ai', () => ({ callAI: async () => ({ text: '{}', usage: {} }) }))
vi.mock('@/lib/usageLog', () => ({ logUsage: () => {} }))

import * as resendHook from '@/app/api/campaigns/webhooks/resend/route'
import * as socialHook from '@/app/api/social/webhook/route'
import * as thResponses from '@/app/api/townhall/responses/route'
import * as translateResp from '@/app/api/translate-responses/route'

const json = (body: any, headers: Record<string, string> = {}) =>
  new Request('http://t/x', { method: 'POST', body: JSON.stringify(body), headers }) as any

beforeEach(reset)
afterEach(() => vi.unstubAllEnvs())

// ── Webhooks reject forged/unsigned requests ───────────────────────────────
describe('campaigns/webhooks/resend — POST', () => {
  it('401 when the Svix signature headers are absent (secret configured)', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', 'whsec_' + Buffer.from('test-secret').toString('base64'))
    expect((await resendHook.POST(json({ type: 'email.delivered' }))).status).toBe(401)
  })
  it('401 with a bogus signature', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', 'whsec_' + Buffer.from('test-secret').toString('base64'))
    const headers = { 'svix-id': 'msg_1', 'svix-timestamp': String(Math.floor(Date.now() / 1000)), 'svix-signature': 'v1,deadbeef' }
    expect((await resendHook.POST(json({ type: 'email.delivered' }, headers))).status).toBe(401)
  })
})

describe('social/webhook — POST', () => {
  it('rejects a request without a valid Meta signature (not 2xx)', async () => {
    vi.stubEnv('META_APP_SECRET', 'test-app-secret')
    const status = (await socialHook.POST(json({ object: 'page', entry: [] }))).status
    expect(status).toBeGreaterThanOrEqual(400)
  })
})

// ── townhall/responses — anonymous self-write, participant-validated ───────
describe('townhall/responses — POST', () => {
  it('400 when session_id / participant_id are missing', async () => {
    expect((await thResponses.POST(json({}))).status).toBe(400)
  })
  it('404 when the session does not exist (no blind cross-session write)', async () => {
    ctx.results['townhall_sessions'] = { data: null, error: null }
    ctx.results['pulseiq_events'] = { data: null, error: null }
    expect((await thResponses.POST(json({ session_id: 's1', participant_id: 'p1' }))).status).toBe(404)
  })
})

// ── translate-responses — caller-supplied text only ────────────────────────
describe('translate-responses — POST', () => {
  it('short-circuits to empty for an English source (no AI, no tenant read)', async () => {
    const r = await translateResp.POST(json({ fromLanguage: 'en', texts: { a: 'hi' } }))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ texts: {}, customTexts: {} })
  })
  it('400 when the caller-supplied input exceeds the size cap', async () => {
    const big = 'x'.repeat(10001)
    const r = await translateResp.POST(json({ fromLanguage: 'es', texts: { a: big } }))
    expect(r.status).toBe(400)
  })
})
