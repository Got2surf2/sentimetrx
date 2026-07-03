// tests/integration/recordings-townhall-routes-gate.test.ts
//
// Phase 1 — org-scoping gates for the Town Hall (recordings) + PulseIQ
// (townhall_sessions) routes NOT already covered by recordings-routes.test.ts:
//   - recordings/[id]/files              POST          (attach media)
//   - recordings/[id]/live-summary       POST
//   - recordings/[id]/live-token         POST
//   - recordings/[id]/live-transcript    POST
//   - recordings/[id]/report/pdf         POST
//   - recordings/[id]/report/send        POST
//   - recordings/[id]/signoff            POST / DELETE
//   - recordings/[id]/versions           GET / POST
//   - recordings/extract-setup           POST          (stateless, feature-gated)
//   - townhall/sessions/[id]             GET/PATCH/DELETE (gateSessionAccess)
//   - townhall/sessions/[id]/analyze     POST
//
// All verified correctly gated — no fixes. Each resolves the caller org (via
// getUserContext or getAuthUser+users) and refuses a recording/session not in
// the caller's org (paired id+org_id → 404 on null, or a JS org_id check).

import { describe, it, expect, beforeEach, vi } from 'vitest'

const ctx = {
  authUser: null as any,
  userContext: null as any,
  callerCtx: { userId: null, orgId: null, isAdmin: false } as any,
  results: {} as Record<string, any>,
}
function reset() {
  ctx.authUser = null
  ctx.userContext = null
  ctx.callerCtx = { userId: null, orgId: null, isAdmin: false }
  ctx.results = {}
}

function builder(table: string): any {
  const b: any = {}
  for (const m of ['select', 'eq', 'order', 'in', 'limit', 'neq', 'range', 'gt', 'lte', 'like', 'update', 'delete', 'insert', 'upsert']) b[m] = () => b
  b.single = async () => ctx.results[table] ?? { data: null, error: null }
  b.maybeSingle = async () => ctx.results[table] ?? { data: null, error: null }
  b.then = (res: any, rej: any) => Promise.resolve(ctx.results[table] ?? { data: [], error: null }).then(res, rej)
  return b
}
const client = () => ({ from: (t: string) => builder(t), storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: { signedUrl: 'x' }, error: null }), remove: async () => ({}) }) } })

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => client(),
  createServiceRoleClient: () => client(),
  getAuthUser: async () => ctx.authUser,
}))
vi.mock('@/lib/userContext', () => ({ getUserContext: async () => ctx.userContext }))
vi.mock('@/lib/auth/orgAccess', () => ({ getCallerOrgContext: async () => ctx.callerCtx }))
// Heavy / external libs — only invoked past the gate, so empty factories suffice.
vi.mock('@/lib/asr/deepgram', () => ({}))
vi.mock('@/lib/recordings/reportPdf', () => ({}))
vi.mock('@/lib/recordings/reportEmail', () => ({}))
vi.mock('@/lib/recordings/setupExtract', () => ({ extractSetupFromPdf: async () => ({}) }))
vi.mock('@/lib/email/provider', () => ({}))
vi.mock('@/lib/ai', () => ({}))
vi.mock('@/lib/townHallAdapter', () => ({
  // analyze (tranche 2) resolves pulseiq_sessions via the adapter — serve the
  // same ctx.results fixture the raw-table mocks use.
  resolveTownHall: async () => ctx.results['pulseiq_sessions']?.data ?? null,
}))
vi.mock('@/lib/townhallActivationGate', () => ({}))
vi.mock('@/lib/recordings/configVersion', () => ({}))
vi.mock('@/lib/orgTransfer', () => ({ recordAdminCrossOrgAction: async () => {} }))
vi.mock('@/lib/auth/logDeckDownload', () => ({}))
vi.mock('@/lib/userEvents', () => ({ recordUserEvent: async () => {}, eventContextFromRequest: () => ({ ip: null, userAgent: null }) }))

import * as files from '@/app/api/recordings/[id]/files/route'
import * as liveSummary from '@/app/api/recordings/[id]/live-summary/route'
import * as liveToken from '@/app/api/recordings/[id]/live-token/route'
import * as liveTranscript from '@/app/api/recordings/[id]/live-transcript/route'
import * as reportPdf from '@/app/api/recordings/[id]/report/pdf/route'
import * as reportSend from '@/app/api/recordings/[id]/report/send/route'
import * as signoff from '@/app/api/recordings/[id]/signoff/route'
import * as versions from '@/app/api/recordings/[id]/versions/route'
import * as extractSetup from '@/app/api/recordings/extract-setup/route'
import * as thSession from '@/app/api/townhall/sessions/[id]/route'
import * as thAnalyze from '@/app/api/townhall/sessions/[id]/analyze/route'

const idP = { params: Promise.resolve({ id: 'r_1' }) } as any
const thP = { params: Promise.resolve({ id: 's_1' }) } as any
const req = (method = 'POST', body: any = {}) =>
  new Request('http://t/x', { method, body: method === 'GET' ? undefined : JSON.stringify(body) }) as any

// All auth shapes populated so whichever a route uses resolves to orgA.
function authAs(orgId: string, isAdmin = false) {
  ctx.authUser = { id: 'u1', email: 'u1@x' }
  ctx.results['users'] = { data: { org_id: orgId, organizations: { is_admin_org: isAdmin } }, error: null }
  ctx.userContext = { userId: 'u1', orgId, isAdmin, features: { analyze: true, recordings: true } }
  ctx.callerCtx = { userId: 'u1', orgId, isAdmin }
}

beforeEach(reset)

// Every [id] route: cross-org / missing → 404; unauthenticated → 401.
const idRoutes: { name: string; call: () => Promise<any> }[] = [
  { name: 'files POST', call: () => files.POST(req('POST', { files: [{ original_filename: 'a.mp3', size_bytes: 1, mime_type: 'audio/mpeg', is_video: false }] }), idP) },
  { name: 'live-summary POST', call: () => liveSummary.POST(req('POST'), idP) },
  { name: 'live-token POST', call: () => liveToken.POST(req('POST'), idP) },
  { name: 'live-transcript POST', call: () => liveTranscript.POST(req('POST', {}), idP) },
  { name: 'report/pdf POST', call: () => reportPdf.POST(req('POST'), idP) },
  { name: 'report/send POST', call: () => reportSend.POST(req('POST', { recipients: ['a@b.com'] }), idP) },
  { name: 'signoff POST', call: () => signoff.POST(req('POST', {}), idP) },
  { name: 'signoff DELETE', call: () => signoff.DELETE(req('DELETE'), idP) },
  { name: 'versions GET', call: () => versions.GET(req('GET'), idP) },
  { name: 'versions POST', call: () => versions.POST(req('POST', {}), idP) },
  { name: 'townhall/sessions/[id] GET', call: () => thSession.GET(req('GET'), thP) },
  { name: 'townhall/sessions/[id] PATCH', call: () => thSession.PATCH(req('PATCH', { status: 'paused' }), thP) },
  { name: 'townhall/sessions/[id] DELETE', call: () => thSession.DELETE(req('DELETE'), thP) },
]

describe.each(idRoutes)('$name', ({ call }) => {
  it('401 unauthenticated', async () => {
    expect((await call()).status).toBe(401)
  })

  it('404 when the record is cross-org / not found', async () => {
    authAs('orgA')
    // No recording/session results set → every paired lookup returns null → 404.
    expect((await call()).status).toBe(404)
  })
})

// The JS org-check routes specifically: a row owned by another org → 404
// (proves the org_id comparison, not just "not found").
describe('JS org-check routes — cross-org row → 404', () => {
  it('report/pdf', async () => {
    authAs('orgA')
    ctx.results['recordings'] = { data: { id: 'r_1', org_id: 'orgB', status: 'complete' }, error: null }
    expect((await reportPdf.POST(req('POST'), idP)).status).toBe(404)
  })
  it('report/send', async () => {
    authAs('orgA')
    ctx.results['recordings'] = { data: { id: 'r_1', org_id: 'orgB', status: 'complete' }, error: null }
    expect((await reportSend.POST(req('POST', { recipients: ['a@b.com'] }), idP)).status).toBe(404)
  })
  it('townhall/sessions/[id] GET (legacy substrate)', async () => {
    authAs('orgA')
    ctx.results['townhall_sessions'] = { data: { org_id: 'orgB' }, error: null }
    expect((await thSession.GET(req('GET'), thP)).status).toBe(404)
  })
})

// townhall/sessions/[id]/analyze — gate on the town hall's org (tranche 2:
// pulseiq_sessions only).
describe('townhall/sessions/[id]/analyze — POST', () => {
  it('401 unauthenticated', async () => {
    expect((await thAnalyze.POST(req('POST'), thP)).status).toBe(401)
  })
  it('404 when the session belongs to another org (non-admin)', async () => {
    authAs('orgA')
    ctx.results['pulseiq_sessions'] = { data: { id: 's_1', org_id: 'orgB', cohort_config: {}, discussion_guide: [] }, error: null }
    expect((await thAnalyze.POST(req('POST'), thP)).status).toBe(404)
  })
})

// extract-setup is stateless (no recording lookup) — gate is auth + feature flag.
describe('recordings/extract-setup — POST', () => {
  it('401 unauthenticated', async () => {
    expect((await extractSetup.POST(req('POST'))).status).toBe(401)
  })
  it('403 when the org lacks the recordings feature', async () => {
    ctx.userContext = { userId: 'u1', orgId: 'orgA', isAdmin: false, features: { analyze: true, recordings: false } }
    expect((await extractSetup.POST(req('POST'))).status).toBe(403)
  })
})
