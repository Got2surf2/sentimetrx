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
}
function reset() {
  ctx.story = null
  ctx.insertError = null
  ctx.inserted = []
  ctx.downloadOk = true
}

function builder(table: string) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'range', 'limit']) b[m] = () => b
  b.maybeSingle = async () => ({ data: table === 'data_stories' ? ctx.story : dataFor(table), error: null })
  b.single = async () => ({ data: dataFor(table), error: null })
  b.insert = (rows: unknown) => {
    if (table === 'data_stories' && !ctx.insertError) ctx.inserted.push(rows as Record<string, unknown>)
    return { error: table === 'data_stories' ? ctx.insertError : null,
      select: () => ({ single: async () => ({ data: null, error: null }) }) }
  }
  b.then = (res: (v: unknown) => unknown) => Promise.resolve({
    data: table === 'dataset_rows_flat'
      ? [{ data: { comment: 'The service was terrible and painfully slow for our whole table tonight.' } },
         { data: { comment: 'Service again — truly awful service, would not recommend this location.' } }]
      : [],
    error: null,
  }).then(res)
  return b
}
function dataFor(table: string): Record<string, unknown> | null {
  if (table === 'datasets') return { id: 'd_1', org_id: 'orgA', name: 'EA Reviews', row_count: 2 }
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
import { POST as generateStory } from '@/app/api/datasets/[datasetId]/story/route'

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
})
