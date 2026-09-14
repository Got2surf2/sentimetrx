// /api/share — create (POST), resolve or list (GET), revoke (DELETE) share
// links. The tenancy gate (caller org vs target org, admin bypass) is the
// behavior under test, so Supabase is the filter-honoring fake with DB-style
// insert defaults for the generated token; auth, rate limit, user events, the
// town-hall adapter and the error envelope are mocked at their boundary.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { makeFakeService, type FakeService, type Row } from '../helpers/fakeSupabase'

const ctx: { user: { id: string } | null } = { user: null }
let svc: FakeService
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({}),
  createServiceRoleClient: () => svc,
  getAuthUser: async () => ctx.user,
}))
const checkRateLimit = vi.fn(async () => ({ limited: false }))
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...(a as [])) }))
const recordUserEvent = vi.fn(async () => {})
vi.mock('@/lib/userEvents', () => ({ recordUserEvent: (...a: unknown[]) => recordUserEvent(...(a as [])), eventContextFromRequest: () => ({ ip: '203.0.113.9', userAgent: 'vitest' }) }))
vi.mock('@/lib/apiError', () => ({ serverError: (err: { message: string }, at: string) => NextResponse.json({ error: err.message, at }, { status: 500 }) }))
const getTownHallAsLegacy = vi.fn()
vi.mock('@/lib/townHallAdapter', () => ({
  getTownHallAsLegacy: (...a: unknown[]) => getTownHallAsLegacy(...a),
  // Same contract as the real pager, one page is plenty for these fixtures.
  fetchAllRows: async (build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null }>) => (await build(0, 999)).data || [],
}))

import { POST, GET, DELETE } from '@/app/api/share/route'

const future = new Date(Date.now() + 86400000).toISOString()
const past = new Date(Date.now() - 86400000).toISOString()
const post = (body: unknown, origin = 'http://localhost:3000') => POST(new NextRequest(origin + '/api/share', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } }))
const get = (qs: string) => GET(new NextRequest('http://localhost:3000/api/share' + qs))
const del = (qs: string) => DELETE(new NextRequest('http://localhost:3000/api/share' + qs, { method: 'DELETE' }))

function tables(): Record<string, Row[]> {
  return {
    users: [
      { id: 'u1', org_id: 'org-1', organizations: { is_admin_org: false }, role: 'member' },
      { id: 'u2', org_id: 'org-2', organizations: [{ is_admin_org: false }], role: 'member' },
      { id: 'adm', org_id: 'org-9', organizations: { is_admin_org: true }, role: 'platform_admin' },
      { id: 'noorg', org_id: null, organizations: null, role: 'member' },
    ],
    studies: [{ id: 'st1', org_id: 'org-1', name: 'Guest Pulse', bot_name: 'Sarina', bot_emoji: '🌊', status: 'active', config: { ratingScale: [{ score: 1, emoji: '😠', label: 'Poor' }], experienceRatingLabel: 'Meal', npsEnabled: false, ratingPrompt: 'How was it?' } }],
    campaigns: [{ id: 'c1', org_id: 'org-1', name: 'Spring push', status: 'live', target_responses: 100, study_url: 'https://x/s/abc', created_at: '2026-03-01' }],
    pulseiq_sessions: [{ id: 'th1', org_id: 'org-1' }],
    datasets: [{ id: 'ds1', org_id: 'org-1', study_id: 'st1', created_at: '2026-01-02' }, { id: 'ds0', org_id: 'org-1', study_id: 'st1', created_at: '2026-01-01' }],
    agents: [{ id: 'bot1', org_id: 'org-1' }],
    responses: [
      { id: 'resp1', study_id: 'st1', studies: { org_id: 'org-1' }, sentiment: 'positive', experience_score: 5, nps_score: 4, status: 'complete', completed_at: '2026-01-03', duration_sec: 60 },
      { id: 'resp2', study_id: 'st1', studies: { org_id: 'org-1' }, sentiment: 'negative', experience_score: 2, nps_score: 1, status: 'complete', completed_at: '2026-01-04', duration_sec: 90 },
    ],
    dataset_state: [{ dataset_id: 'ds1', theme_model: { themes: [{ name: 'Wait', keywords: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], count: 1, description: 'd', sentiment: 'negative', avgRating: 2.5 }, { name: 'Praise', count: 2, percentage: 33 }] } }],
    campaign_respondents: [{ campaign_id: 'c1', status: 'sent' }, { campaign_id: 'c1', status: 'completed' }, { campaign_id: 'c1', status: 'weird' }, { campaign_id: 'other', status: 'sent' }],
    pulseiq_session_conversations: [{ town_hall_id: 'th1', org_id: 'org-1', conversation_id: 'cv1' }],
    conversation_turns: [
      { conversation_id: 'cv1', org_id: 'org-1', role: 'user', content: 'we need more parking spots near the entrance', content_en: null, created_at: '2026-05-01T00:00:01Z' },
      { conversation_id: 'cv1', org_id: 'org-1', role: 'user', content: '[Skipped by user]', content_en: null, created_at: '2026-05-01T00:00:02Z' },
      { conversation_id: 'cv1', org_id: 'org-1', role: 'assistant', content: 'Noted', content_en: null, created_at: '2026-05-01T00:00:03Z' },
    ],
    shared_links: [],
  }
}

beforeEach(() => {
  svc = makeFakeService({ tables: tables(), defaults: { shared_links: (_r, i) => ({ id: 'sl' + i, token: 'tok' + i, created_at: new Date().toISOString(), last_accessed_at: null }) } })
  ctx.user = { id: 'u1' }
  checkRateLimit.mockReset().mockResolvedValue({ limited: false })
  recordUserEvent.mockClear()
  getTownHallAsLegacy.mockReset()
})

describe('POST /api/share — create', () => {
  it('401 unauthenticated, 429 rate limited, 400 bad JSON / missing fields / bad type', async () => {
    ctx.user = null
    expect((await post({ type: 'study', target_id: 'st1' })).status).toBe(401)
    ctx.user = { id: 'u1' }
    checkRateLimit.mockResolvedValue({ limited: true })
    expect((await post({ type: 'study', target_id: 'st1' })).status).toBe(429)
    checkRateLimit.mockResolvedValue({ limited: false })
    expect((await post('{not json')).status).toBe(400)
    expect((await post({ type: 'study' })).status).toBe(400)
    expect((await post({ type: 'deck', target_id: 'x' })).status).toBe(400)
    expect(checkRateLimit).toHaveBeenCalledWith('share:create:u1', 30, 3600000)
  })

  it('tenancy gate: no org → 401, unknown target → 404, other org → 403, admin crosses orgs', async () => {
    ctx.user = { id: 'noorg' }
    expect((await post({ type: 'study', target_id: 'st1' })).status).toBe(401)
    ctx.user = { id: 'u1' }
    expect((await post({ type: 'study', target_id: 'nope' })).status).toBe(404)
    ctx.user = { id: 'u2' }
    expect((await post({ type: 'campaign', target_id: 'c1' })).status).toBe(403)
    ctx.user = { id: 'adm' }
    expect((await post({ type: 'townhall', target_id: 'th1' })).status).toBe(201)
  })

  it('creates a default (study) link: 7-day expiry, org of the TARGET, URL from the request origin, event recorded', async () => {
    const res = await post({ type: 'study', target_id: 'st1' }, 'https://preview.example.com')
    expect(res.status).toBe(201)
    const b = await res.json()
    expect(b.url).toBe('https://preview.example.com/shared/tok0')
    expect(b.token).toBe('tok0')
    const row = svc.tables.shared_links[0]
    expect(row).toMatchObject({ type: 'study', target_id: 'st1', org_id: 'org-1', created_by: 'u1' })
    const hours = (new Date(row.expires_at as string).getTime() - Date.now()) / 3600000
    expect(hours).toBeGreaterThan(167); expect(hours).toBeLessThan(169)
    expect(recordUserEvent).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', orgId: 'org-1', event: 'share_created', metadata: { type: 'study', target_id: 'st1' }, ip: '203.0.113.9' }))
  })

  it('expiry presets: 24h and 30d', async () => {
    await post({ type: 'campaign', target_id: 'c1', expires_in: '24h' })
    await post({ type: 'campaign', target_id: 'c1', expires_in: '30d' })
    const [a, b] = svc.tables.shared_links.map(r => (new Date(r.expires_at as string).getTime() - Date.now()) / 3600000)
    expect(Math.round(a)).toBe(24); expect(Math.round(b)).toBe(720)
  })

  it('conversation share stores the HTML; the labeled variant only for a platform admin; resolves a bot id or a response id', async () => {
    const r1 = await post({ type: 'conversation', target_id: 'bot1', html: '<p>chat</p>', html_labeled: '<p>labeled</p>' })
    expect(r1.status).toBe(201)
    expect((await r1.json()).url).toBe('http://localhost:3000/shared/conversation/tok0')
    expect(svc.tables.shared_links[0].metadata).toEqual({ html: '<p>chat</p>' })     // u1 is not platform_admin → labeled dropped
    ctx.user = { id: 'adm' }
    const r2 = await post({ type: 'conversation', target_id: 'resp1', html: '<p>c</p>', html_labeled: '<p>l</p>', expires_in: '24h' })
    expect(r2.status).toBe(201)
    expect(svc.tables.shared_links[1].metadata).toEqual({ html: '<p>c</p>', html_labeled: '<p>l</p>' })
    expect(svc.tables.shared_links[1].org_id).toBe('org-1')                          // resolved through responses → studies
    ctx.user = { id: 'u1' }
    expect((await post({ type: 'conversation', target_id: 'nope', html: 'x' })).status).toBe(404)
  })

  it('agent_study share bakes the report HTML with a 30-day default; analytics share stores the filter metadata', async () => {
    const as = await post({ type: 'agent_study', target_id: 'bot1', html: '<h1>report</h1>' })
    expect(as.status).toBe(201)
    expect((await as.json()).url).toBe('http://localhost:3000/shared/agent-study/tok0')
    expect(Math.round((new Date(svc.tables.shared_links[0].expires_at as string).getTime() - Date.now()) / 3600000)).toBe(720)
    const an = await post({ type: 'analytics', target_id: 'ds1', metadata: { dataset_id: 'ds1', filters: {} } })
    expect(an.status).toBe(201)
    expect((await an.json()).url).toBe('http://localhost:3000/shared/tok1')
    expect(svc.tables.shared_links[1].metadata).toEqual({ dataset_id: 'ds1', filters: {} })
    // agent_study WITHOUT html and analytics WITHOUT metadata fall through to a plain link
    const plain = await post({ type: 'agent_study', target_id: 'bot1' })
    expect((await plain.json()).url).toBe('http://localhost:3000/shared/tok2')
  })

  it('an insert failure returns the error envelope', async () => {
    svc.errors.shared_links = { message: 'permission denied for table shared_links' }
    const res = await post({ type: 'study', target_id: 'st1' })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'permission denied for table shared_links', at: 'share.create' })
  })
})

describe('GET /api/share — list', () => {
  it('requires auth, a valid list_type, and access to the target; returns only unexpired links newest first', async () => {
    svc.tables.shared_links = [
      { token: 'old', type: 'study', target_id: 'st1', expires_at: past, created_at: '2026-01-01', last_accessed_at: null },
      { token: 'a', type: 'study', target_id: 'st1', expires_at: future, created_at: '2026-01-02', last_accessed_at: '2026-01-03' },
      { token: 'b', type: 'study', target_id: 'st1', expires_at: future, created_at: '2026-01-05', last_accessed_at: null },
      { token: 'c', type: 'campaign', target_id: 'st1', expires_at: future, created_at: '2026-01-06', last_accessed_at: null },
    ]
    ctx.user = null
    expect((await get('?list_type=study&list_target_id=st1')).status).toBe(401)
    ctx.user = { id: 'u1' }
    expect((await get('?list_type=deck&list_target_id=st1')).status).toBe(400)
    ctx.user = { id: 'u2' }
    expect((await get('?list_type=study&list_target_id=st1')).status).toBe(403)
    ctx.user = { id: 'u1' }
    const res = await get('?list_type=study&list_target_id=st1')
    expect(res.status).toBe(200)
    const b = await res.json()
    expect(b.links.map((l: { token: string }) => l.token)).toEqual(['b', 'a'])
    expect(b.links[0].url).toBe('http://localhost:3000/shared/b')
  })
})

describe('GET /api/share — resolve a token', () => {
  const link = (over: Row): Row => ({ token: 't', type: 'study', target_id: 'st1', org_id: 'org-1', expires_at: future, metadata: null, ...over })

  it('400 without token, 404 unknown (no-store), 410 expired, 400 unknown type; access is stamped', async () => {
    expect((await get('')).status).toBe(400)
    const nf = await get('?token=zzz')
    expect(nf.status).toBe(404)
    expect(nf.headers.get('Cache-Control')).toContain('no-store')
    svc.tables.shared_links = [link({ token: 'exp', expires_at: past }), link({ token: 'odd', type: 'deck' })]
    expect((await get('?token=exp')).status).toBe(410)
    expect((await get('?token=odd')).status).toBe(400)
    expect(svc.tables.shared_links[1].last_accessed_at).toBeTruthy()
  })

  it('study: study + responses + config-derived labels + themes from the latest dataset', async () => {
    svc.tables.shared_links = [link({ token: 't' })]
    const b = await (await get('?token=t')).json()
    expect(b.type).toBe('study')
    expect(b.study).toMatchObject({ id: 'st1', name: 'Guest Pulse', bot_name: 'Sarina' })
    expect(b.responses).toHaveLength(2)
    expect(b).toMatchObject({ ratingLabel: 'Meal', npsEnabled: false, experienceEnabled: true, ratingPrompt: 'How was it?', npsPrompt: null })
    expect(b.ratingScale).toEqual([{ score: 1, emoji: '😠', label: 'Poor' }])
    expect(b.themes).toEqual([
      { name: 'Wait', description: 'd', keywords: ['a', 'b', 'c', 'd', 'e', 'f'], sentiment: 'negative', count: 1, percentage: 50, avgRating: 2.5, ratingDelta: null },
      { name: 'Praise', description: '', keywords: [], sentiment: 'neutral', count: 2, percentage: 33, avgRating: null, ratingDelta: null },
    ])
    svc.tables.studies = []
    expect((await get('?token=t')).status).toBe(404)
  })

  it('campaign: respondent funnel counts by status', async () => {
    svc.tables.shared_links = [link({ token: 'c', type: 'campaign', target_id: 'c1' })]
    const b = await (await get('?token=c')).json()
    expect(b.campaign).toMatchObject({ id: 'c1', name: 'Spring push' })
    expect(b.stats).toEqual({ total: 3, pending: 0, sent: 1, opened: 0, clicked: 0, completed: 1, bounced: 0, unsubscribed: 0 })
    svc.tables.campaigns = []
    expect((await get('?token=c')).status).toBe(404)
  })

  it('townhall: adapter payload + word stats from user turns (bracketed markers excluded), dismissed themes hidden', async () => {
    svc.tables.shared_links = [link({ token: 'th', type: 'townhall', target_id: 'th1' })]
    getTownHallAsLegacy.mockResolvedValue({
      session: { id: 'th1', org_id: 'org-1', name: 'Budget town hall', status: 'ended', started_at: 's', ended_at: 'e', config: { bot_emoji: '🏛' } },
      themes: [{ label: 'Parking', source: 'ai', state: 'active', keywords: ['parking'], sentiment: 'negative', response_count: 3, mention_count: 4, example_quote: 'no parking' }, { label: 'Gone', state: 'dismissed', response_count: 9 }, { label: 'Trees', state: 'active', response_count: 5 }],
      stats: { joined: 12 },
    })
    const b = await (await get('?token=th')).json()
    expect(getTownHallAsLegacy).toHaveBeenCalledWith(svc, 'th1')
    expect(b.session).toEqual({ name: 'Budget town hall', bot_emoji: '🏛', status: 'ended', started_at: 's', ended_at: 'e' })
    expect(b.stats).toEqual({ participants: 12, responses: 1, avg_words: 8 })
    expect(b.themes.map((t: { label: string }) => t.label)).toEqual(['Trees', 'Parking'])
    expect(b.themes[1]).toEqual({ label: 'Parking', source: 'ai', state: 'active', keywords: ['parking'], sentiment: 'negative', response_count: 3, percentage: 400, example_quote: 'no parking' })
    getTownHallAsLegacy.mockResolvedValue(null)
    expect((await get('?token=th')).status).toBe(404)
  })

  it('analytics: minimal payload — the heavy lifting lives in /api/share/analytics', async () => {
    svc.tables.shared_links = [link({ token: 'an', type: 'analytics', target_id: 'ds1', metadata: { dataset_id: 'ds1' } })]
    const b = await (await get('?token=an')).json()
    expect(b).toEqual({ type: 'analytics', metadata: { dataset_id: 'ds1' }, expires_at: future })
  })
})

describe('DELETE /api/share — revoke', () => {
  beforeEach(() => {
    svc.tables.shared_links = [{ id: 'sl', token: 't', type: 'study', target_id: 'st1', created_by: 'u1', expires_at: future }]
  })
  it('401 / 400 / 404, then allowed for the creator, an org member, or an admin — and forbidden otherwise', async () => {
    ctx.user = null
    expect((await del('?token=t')).status).toBe(401)
    ctx.user = { id: 'u1' }
    expect((await del('')).status).toBe(400)
    expect((await del('?token=nope')).status).toBe(404)
    ctx.user = { id: 'u2' }                                            // other org, not creator
    expect((await del('?token=t')).status).toBe(403)
    expect(svc.tables.shared_links).toHaveLength(1)
    ctx.user = { id: 'u1' }                                            // creator
    expect(await (await del('?token=t')).json()).toEqual({ deleted: true })
    expect(svc.tables.shared_links).toHaveLength(0)
    // org member who did not create it
    svc.tables.shared_links = [{ id: 'sl', token: 't', type: 'study', target_id: 'st1', created_by: 'someone-else', expires_at: future }]
    expect((await del('?token=t')).status).toBe(200)
    // admin from another org
    svc.tables.shared_links = [{ id: 'sl', token: 't', type: 'study', target_id: 'st1', created_by: 'someone-else', expires_at: future }]
    ctx.user = { id: 'adm' }
    expect((await del('?token=t')).status).toBe(200)
  })
})
