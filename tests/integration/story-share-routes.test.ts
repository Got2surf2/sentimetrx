// tests/integration/story-share-routes.test.ts
//
// The Data Story short-link lifecycle (sql/198):
//   - GET /story/[slug] — the public viewer: live → 200 text/html; revoked /
//     expired → 410 with distinct copy; unknown or malformed slug → 404.
//     The slug is the sole capability; no cookies are consulted.
//   - POST /datasets/[id]/story — returns the /story/<slug> short link when
//     the data_stories insert lands, and FALLS BACK to the signed-token
//     /api/story link when the table is missing (deploy-order safety for a
//     DB that has not run sql/198).

import { describe, it, expect, beforeEach, vi } from 'vitest'

const ctx = {
  story: null as Record<string, unknown> | null,
  insertError: null as { message: string } | null,
  inserted: [] as Record<string, unknown>[],
  downloadOk: true,
  datasetOrg: 'orgA',
  storyList: [] as Record<string, unknown>[],
  updates: [] as { patch: Record<string, unknown>; filters: Record<string, unknown> }[],
}
function reset() {
  ctx.story = null
  ctx.insertError = null
  ctx.inserted = []
  ctx.downloadOk = true
  ctx.datasetOrg = 'orgA'
  ctx.storyList = []
  ctx.updates = []
}

function builder(table: string) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'order', 'range', 'limit']) b[m] = () => b
  b.eq = () => b
  b.maybeSingle = async () => ({ data: table === 'data_stories' ? ctx.story : dataFor(table), error: null })
  b.single = async () => ({ data: dataFor(table), error: null })
  b.insert = (rows: unknown) => {
    if (table === 'data_stories' && !ctx.insertError) ctx.inserted.push(rows as Record<string, unknown>)
    return { error: table === 'data_stories' ? ctx.insertError : null,
      select: () => ({ single: async () => ({ data: null, error: null }) }) }
  }
  b.update = (patch: Record<string, unknown>) => {
    const entry = { patch, filters: {} as Record<string, unknown> }
    if (table === 'data_stories') ctx.updates.push(entry)
    const u: Record<string, unknown> = {}
    u.eq = (col: string, val: unknown) => { entry.filters[col] = val; return u }
    u.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res)
    return u
  }
  b.then = (res: (v: unknown) => unknown) => Promise.resolve({
    data: table === 'dataset_rows_flat'
      ? [{ data: { comment: 'The service was terrible and painfully slow for our whole table tonight.' } },
         { data: { comment: 'Service again — truly awful service, would not recommend this location.' } }]
      : table === 'data_stories' ? ctx.storyList : [],
    error: null,
  }).then(res)
  return b
}
function dataFor(table: string): Record<string, unknown> | null {
  if (table === 'datasets') return { id: 'd_1', org_id: ctx.datasetOrg, name: 'EA Reviews', row_count: 2 }
  if (table === 'dataset_state') return {
    theme_model: { themes: [{ id: 't1', name: 'Service', description: '', keywords: ['service'], sentiment: 'negative', count: 0, percentage: 0, relatedThemes: [] }], summary: '', fieldName: 'comment' },
    schema_config: { fields: [{ field: 'comment', label: 'Comment', type: 'open-ended' }] },
    analytics: null,
  }
  return null
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: (t: string) => builder(t) }),
  createServiceRoleClient: () => ({
    from: (t: string) => builder(t),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        createSignedUrl: async () => ({ data: { signedUrl: 'https://x.supabase.co/storage/v1/object/sign/report-exports/p.html?token=tok123' }, error: null }),
        download: async () => (ctx.downloadOk
          ? { data: new Blob(['<html>story</html>'], { type: 'text/html' }), error: null }
          : { data: null, error: { message: 'not found' } }),
      }),
    },
  }),
}))
vi.mock('@/lib/auth/orgAccess', () => ({ getCallerOrgContext: async () => ({ userId: 'u1', orgId: 'orgA', isAdmin: false }) }))
vi.mock('@/lib/ai', () => ({ callAI: async () => ({ text: '{"lede":"L.","themesIntro":"T.","ratingIntro":null,"segmentIntro":null}' }) }))
vi.mock('@/lib/usageLog', () => ({ logUsage: () => {} }))

import { GET as viewStory } from '@/app/story/[slug]/route'
import { POST as generateStory, GET as listStories, PATCH as manageStory } from '@/app/api/datasets/[datasetId]/story/route'

const view = (slug: string) => viewStory(new Request('http://t/x'), { params: Promise.resolve({ slug }) })
const generate = () => generateStory(new Request('http://t/x', { method: 'POST' }), { params: Promise.resolve({ datasetId: 'd_1' }) })
const future = new Date(Date.now() + 86400e3).toISOString()
const past = new Date(Date.now() - 60e3).toISOString()

beforeEach(reset)

describe('GET /story/[slug] — public viewer', () => {
  it('serves a live story as text/html with no-store + noindex', async () => {
    ctx.story = { storage_path: 'reports/d_1/s.html', expires_at: future, revoked_at: null }
    const res = await view('Abc123XYZ456')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
    expect(await res.text()).toContain('story')
  })

  it('410 with distinct copy for revoked vs expired', async () => {
    ctx.story = { storage_path: 'p', expires_at: future, revoked_at: new Date().toISOString() }
    const revoked = await view('Abc123XYZ456')
    expect(revoked.status).toBe(410)
    expect(await revoked.text()).toContain('revoked')

    ctx.story = { storage_path: 'p', expires_at: past, revoked_at: null }
    const expired = await view('Abc123XYZ456')
    expect(expired.status).toBe(410)
    expect(await expired.text()).toContain('expired')
  })

  it('404 for an unknown slug and for malformed slugs without touching the DB shape', async () => {
    expect((await view('Abc123XYZ456')).status).toBe(404)     // no row
    expect((await view('short')).status).toBe(404)            // under 8 chars
    expect((await view('has-illegal-chars!')).status).toBe(404)
  })

  it('404 when the row is live but the storage object was deleted (the hard kill)', async () => {
    ctx.story = { storage_path: 'p', expires_at: future, revoked_at: null }
    ctx.downloadOk = false
    expect((await view('Abc123XYZ456')).status).toBe(404)
  })
})

describe('POST /datasets/[id]/story — short-link minting', () => {
  it('returns a /story/<slug> link and stamps the row from the org-gated dataset', async () => {
    const j = await (await generate()).json()
    expect(j.url).toMatch(/^\/story\/[A-Za-z0-9]{12}$/)
    expect(ctx.inserted).toHaveLength(1)
    expect(ctx.inserted[0]).toMatchObject({ org_id: 'orgA', dataset_id: 'd_1', created_by: 'u1' })
    expect(new Date(ctx.inserted[0].expires_at as string).getTime()).toBeGreaterThan(Date.now())
  })

  it('falls back to the signed-token /api/story link when the table is missing (pre-sql/198 DB)', async () => {
    ctx.insertError = { message: 'relation "data_stories" does not exist' }
    const j = await (await generate()).json()
    expect(j.url).toMatch(/^\/api\/story\/reports\/d_1\/story-.*\?token=tok123$/)
  })

  it('body.fields focuses the story on the UI-selected verbatim when its theme set exists', async () => {
    const res = await generateStory(
      new Request('http://t/x', { method: 'POST', body: JSON.stringify({ fields: ['comment'] }) }),
      { params: Promise.resolve({ datasetId: 'd_1' }) },
    )
    expect(res.status).toBe(200)
    expect((await res.json()).url).toMatch(/^\/story\//)
  })

  it('400s honestly when the selected verbatim was never mined (no story about a different question)', async () => {
    const res = await generateStory(
      new Request('http://t/x', { method: 'POST', body: JSON.stringify({ fields: ['some_other_question'] }) }),
      { params: Promise.resolve({ datasetId: 'd_1' }) },
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/mine themes/i)
  })
})

// ── Share-tab management (GET list · PATCH revoke/extend) ───────────────────

const list = () => listStories(new Request('http://t/x'), { params: Promise.resolve({ datasetId: 'd_1' }) })
const manage = (body: Record<string, unknown>) => manageStory(
  new Request('http://t/x', { method: 'PATCH', body: JSON.stringify(body) }),
  { params: Promise.resolve({ datasetId: 'd_1' }) },
)

describe('GET /datasets/[id]/story — link listing', () => {
  it('returns the dataset\'s stories for an org member', async () => {
    ctx.storyList = [{ id: 's1', slug: 'AbCdEfGhIjKl', title: 'EA Reviews', created_at: past, expires_at: future, revoked_at: null }]
    const res = await list()
    expect(res.status).toBe(200)
    expect((await res.json()).stories).toHaveLength(1)
  })

  it('404s for a caller outside the dataset\'s org', async () => {
    ctx.datasetOrg = 'orgB'
    expect((await list()).status).toBe(404)
  })
})

describe('PATCH /datasets/[id]/story — revoke / extend', () => {
  it('revoke stamps revoked_at through the fully org-scoped update', async () => {
    ctx.story = { id: 's1', expires_at: future, revoked_at: null }
    const res = await manage({ storyId: 's1', action: 'revoke' })
    expect(res.status).toBe(200)
    expect((await res.json()).revoked_at).toBeTruthy()
    expect(ctx.updates).toHaveLength(1)
    expect(ctx.updates[0].filters).toMatchObject({ id: 's1', dataset_id: 'd_1', org_id: 'orgA' })
    expect(ctx.updates[0].patch.revoked_at).toBeTruthy()
  })

  it('extend adds 7 days to a LIVE link\'s current expiry', async () => {
    ctx.story = { id: 's1', expires_at: future, revoked_at: null }
    const j = await (await manage({ storyId: 's1', action: 'extend' })).json()
    const expect7dPastFuture = new Date(future).getTime() + 7 * 86400e3
    expect(Math.abs(new Date(j.expires_at).getTime() - expect7dPastFuture)).toBeLessThan(5000)
  })

  it('extend REVIVES an expired link — 7 days from now, not from the stale expiry', async () => {
    ctx.story = { id: 's1', expires_at: past, revoked_at: null }
    const j = await (await manage({ storyId: 's1', action: 'extend' })).json()
    const expect7dFromNow = Date.now() + 7 * 86400e3
    expect(Math.abs(new Date(j.expires_at).getTime() - expect7dFromNow)).toBeLessThan(5000)
  })

  it('404s for an unknown story and for a caller outside the org', async () => {
    ctx.story = null
    expect((await manage({ storyId: 'nope', action: 'revoke' })).status).toBe(404)
    ctx.datasetOrg = 'orgB'
    ctx.story = { id: 's1', expires_at: future, revoked_at: null }
    expect((await manage({ storyId: 's1', action: 'revoke' })).status).toBe(404)
  })

  it('400s on a missing storyId or unknown action', async () => {
    expect((await manage({ action: 'revoke' })).status).toBe(400)
    expect((await manage({ storyId: 's1', action: 'delete' })).status).toBe(400)
  })
})
