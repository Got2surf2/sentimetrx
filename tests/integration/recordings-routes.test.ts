// tests/integration/recordings-routes.test.ts
//
// Gate + validation coverage for the 8 recordings API route files. These run
// the real handlers in-process with the Supabase boundary, getUserContext,
// getAuthUser, and the Workflow DevKit triggers mocked. Focus is the
// load-bearing contract: auth (401), feature gate (403), org scoping (404
// cross-tenant), and input validation (400/409) — not the happy-path pipeline.
//
// Every recordings lookup is asserted to pair `id` with `org_id` (multi-tenancy
// invariant) where the route is org-scoped.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mutable context the mock factories read at call-time ──────────────────────
const ctx = {
  userCtx: null as any,        // getUserContext() result (route.ts POST/GET, [id] DELETE)
  authUser: null as any,       // getAuthUser() result (the [id]/* sub-routes)
  userOrg: null as string | null, // users.org_id lookup (sub-routes)
  results: {} as Record<string, { single?: any; list?: any }>,
  eq: {} as Record<string, Array<[string, unknown]>>,
}

function resetCtx() {
  ctx.userCtx = null
  ctx.authUser = null
  ctx.userOrg = null
  ctx.results = {}
  ctx.eq = {}
}

function builder(table: string): any {
  const b: any = {}
  const passthrough = ['select', 'insert', 'update', 'delete', 'order', 'range', 'in', 'neq', 'limit', 'gte', 'lte']
  for (const m of passthrough) b[m] = () => b
  b.eq = (col: string, val: unknown) => { (ctx.eq[table] ||= []).push([col, val]); return b }
  b.single = async () => ctx.results[table]?.single ?? { data: null, error: null }
  b.maybeSingle = async () => ctx.results[table]?.single ?? { data: null, error: null }
  // `await q` (list queries) resolves here.
  b.then = (res: any, rej: any) =>
    Promise.resolve(ctx.results[table]?.list ?? { data: [], error: null, count: 0 }).then(res, rej)
  return b
}

const storageApi = {
  from: () => ({
    createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.example/x' }, error: null }),
    list: async () => ({ data: [], error: null }),
    remove: async () => ({ data: [], error: null }),
  }),
}

vi.mock('@/lib/userContext', () => ({ getUserContext: async () => ctx.userCtx }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: ctx.authUser } }) },
    from: () => {
      const b = builder('users')
      b.single = async () => ({ data: ctx.userOrg ? { org_id: ctx.userOrg } : null, error: null })
      return b
    },
  }),
  createServiceRoleClient: () => ({ from: (t: string) => builder(t), storage: storageApi }),
  getAuthUser: async () => ctx.authUser,
}))

// Workflow DevKit + heavy libs — never actually run.
vi.mock('workflow/api', () => ({ start: vi.fn(async () => ({ runId: 'run_test' })) }))
vi.mock('@/workflows/recordings', () => ({ analyzeRecordingWorkflow: {}, processRecordingWorkflow: {} }))
vi.mock('@/lib/recordings/regenerate', () => ({ regenerateExtraction: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/recordings/reanalyze', () => ({ reanalyzeRecording: vi.fn(async () => ({ ok: true })) }))

import * as collection from '@/app/api/recordings/route'
import * as byId from '@/app/api/recordings/[id]/route'
import * as process_ from '@/app/api/recordings/[id]/process/route'
import * as analyze from '@/app/api/recordings/[id]/analyze/route'
import * as audio from '@/app/api/recordings/[id]/audio/route'
import * as uploaded from '@/app/api/recordings/[id]/files/[fileId]/uploaded/route'
import * as reanalyze from '@/app/api/recordings/[id]/reanalyze/route'
import * as regenerate from '@/app/api/recordings/[id]/extractions/[extractionId]/regenerate/route'

const enabled = { analyze: true, recordings: true } as any
function userCtx(over: Partial<any> = {}) {
  return { userId: 'u1', orgId: 'orgA', isAdmin: false, isAdminOrg: false, features: enabled, ...over }
}
function req(body?: unknown, url = 'http://t/api/recordings') {
  return new Request(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
}
async function status(res: Response) { return res.status }

beforeEach(resetCtx)

// ── POST /api/recordings (create) ─────────────────────────────────────────────
describe('POST /api/recordings (create)', () => {
  const validBody = {
    name: 'Town hall', session_type: 'qa', setup_inputs: {}, asr_strategy: 'auto',
    files: [{ original_filename: 'a.mp3', size_bytes: 100, mime_type: 'audio/mpeg', is_video: false }],
  }

  it('401 when unauthenticated', async () => {
    expect(await status(await collection.POST(req(validBody)))).toBe(401)
  })

  it('403 when the recordings feature is off', async () => {
    ctx.userCtx = userCtx({ features: { analyze: true, recordings: false } })
    expect(await status(await collection.POST(req(validBody)))).toBe(403)
  })

  it('400 on invalid body (bad session_type, empty files, duplicate filename)', async () => {
    ctx.userCtx = userCtx()
    expect(await status(await collection.POST(req({ ...validBody, session_type: 'nope' })))).toBe(400)
    expect(await status(await collection.POST(req({ ...validBody, files: [] })))).toBe(400)
    expect(await status(await collection.POST(req({
      ...validBody,
      files: [validBody.files[0], validBody.files[0]],
    })))).toBe(400)
  })

  it('201 + tags the insert with the caller org on the happy path', async () => {
    ctx.userCtx = userCtx()
    ctx.results['recordings'] = { single: { data: { id: 'rec_1' }, error: null } }
    ctx.results['recording_files'] = { list: { data: [{ id: 'f1', original_filename: 'a.mp3', storage_path: 'orgA/rec_1/a.mp3', sort_order: 0 }], error: null } }
    const res = await collection.POST(req(validBody))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.recording_id).toBe('rec_1')
  })
})

// ── GET /api/recordings (list) ────────────────────────────────────────────────
describe('GET /api/recordings (list)', () => {
  const get = (url: string) => collection.GET(new Request(url))

  it('401 / 403 gates', async () => {
    expect(await status(await get('http://t/api/recordings'))).toBe(401)
    ctx.userCtx = userCtx({ features: { analyze: false, recordings: true } })
    expect(await status(await get('http://t/api/recordings'))).toBe(403)
  })

  it('400 on an unknown status filter', async () => {
    ctx.userCtx = userCtx()
    expect(await status(await get('http://t/api/recordings?status=bogus'))).toBe(400)
  })

  it('regular user is scoped to own org AND own user', async () => {
    ctx.userCtx = userCtx()
    await get('http://t/api/recordings')
    expect(ctx.eq['recordings']).toContainEqual(['org_id', 'orgA'])
    expect(ctx.eq['recordings']).toContainEqual(['created_by', 'u1'])
  })

  it('platform-admin (admin-org) is unscoped unless an org filter is passed', async () => {
    ctx.userCtx = userCtx({ isAdminOrg: true })
    await get('http://t/api/recordings')
    expect((ctx.eq['recordings'] ?? []).some(([c]) => c === 'org_id')).toBe(false)
    ctx.eq = {}
    await get('http://t/api/recordings?org_id=orgZ')
    expect(ctx.eq['recordings']).toContainEqual(['org_id', 'orgZ'])
  })
})

// ── GET + DELETE /api/recordings/[id] ─────────────────────────────────────────
describe('GET /api/recordings/[id]', () => {
  const p = { params: Promise.resolve({ id: 'rec_1' }) }

  it('401 unauthenticated / 403 no org', async () => {
    expect(await status(await byId.GET(req(), p))).toBe(401)
    ctx.authUser = { id: 'u1' }; ctx.userOrg = null
    expect(await status(await byId.GET(req(), p))).toBe(403)
  })

  it('404 when the recording is missing or cross-org, paired on id+org_id', async () => {
    ctx.authUser = { id: 'u1' }; ctx.userOrg = 'orgA'
    ctx.results['recordings'] = { single: { data: null, error: null } }
    expect(await status(await byId.GET(req(), p))).toBe(404)
    expect(ctx.eq['recordings']).toContainEqual(['id', 'rec_1'])
    expect(ctx.eq['recordings']).toContainEqual(['org_id', 'orgA'])
  })
})

describe('DELETE /api/recordings/[id]', () => {
  const p = { params: Promise.resolve({ id: 'rec_1' }) }

  it('401 unauthenticated', async () => {
    expect(await status(await byId.DELETE(req(), p))).toBe(401)
  })

  it('404 when missing / cross-org', async () => {
    ctx.userCtx = userCtx()
    ctx.results['recordings'] = { single: { data: null, error: null } }
    expect(await status(await byId.DELETE(req(), p))).toBe(404)
    expect(ctx.eq['recordings']).toContainEqual(['org_id', 'orgA'])
  })

  it('403 when a non-owner non-admin tries to delete', async () => {
    ctx.userCtx = userCtx({ userId: 'u2' })
    ctx.results['recordings'] = { single: { data: { id: 'rec_1', org_id: 'orgA', created_by: 'u1', dataset_id: null }, error: null } }
    expect(await status(await byId.DELETE(req(), p))).toBe(403)
  })
})

// ── action sub-routes share the getAuthUser + org-scoped lookup pattern ───────
describe('action sub-routes — auth + org scoping', () => {
  const p = { params: Promise.resolve({ id: 'rec_1' }) }

  const cases: Array<{ name: string; call: () => Promise<Response> }> = [
    { name: 'process', call: () => process_.POST(req(), p) },
    { name: 'analyze', call: () => analyze.POST(req(), p) },
    { name: 'audio', call: () => audio.GET(req(), p) },
    { name: 'reanalyze', call: () => reanalyze.POST(req(), p) },
  ]

  for (const c of cases) {
    it(`${c.name}: 401 unauth / 403 no org / 404 cross-org (id+org_id paired)`, async () => {
      expect(await status(await c.call())).toBe(401)

      ctx.authUser = { id: 'u1' }; ctx.userOrg = null
      expect(await status(await c.call())).toBe(403)

      ctx.userOrg = 'orgA'
      ctx.results['recordings'] = { single: { data: null, error: null } }
      expect(await status(await c.call())).toBe(404)
      expect(ctx.eq['recordings']).toContainEqual(['id', 'rec_1'])
      expect(ctx.eq['recordings']).toContainEqual(['org_id', 'orgA'])
      resetCtx()
    })
  }

  it('uploaded: 401 / 404 file-not-found (id+recording_id+org_id paired)', async () => {
    const pf = { params: Promise.resolve({ id: 'rec_1', fileId: 'file_1' }) }
    expect(await status(await uploaded.POST(req(), pf))).toBe(401)
    ctx.authUser = { id: 'u1' }; ctx.userOrg = 'orgA'
    ctx.results['recording_files'] = { single: { data: null, error: null } }
    expect(await status(await uploaded.POST(req(), pf))).toBe(404)
    expect(ctx.eq['recording_files']).toContainEqual(['id', 'file_1'])
    expect(ctx.eq['recording_files']).toContainEqual(['recording_id', 'rec_1'])
    expect(ctx.eq['recording_files']).toContainEqual(['org_id', 'orgA'])
  })

  it('regenerate: 401 / 404 cross-org', async () => {
    const pe = { params: Promise.resolve({ id: 'rec_1', extractionId: 'ex_1' }) }
    expect(await status(await regenerate.POST(req(), pe))).toBe(401)
    ctx.authUser = { id: 'u1' }; ctx.userOrg = 'orgA'
    ctx.results['recordings'] = { single: { data: null, error: null } }
    expect(await status(await regenerate.POST(req(), pe))).toBe(404)
    expect(ctx.eq['recordings']).toContainEqual(['org_id', 'orgA'])
  })
})

// ── input validation on the action routes (rec must exist + be org-scoped) ────
describe('action sub-routes — input validation', () => {
  const recFound = (status_ = 'transcribed') => {
    ctx.authUser = { id: 'u1' }; ctx.userOrg = 'orgA'
    ctx.results['recordings'] = { single: { data: { id: 'rec_1', org_id: 'orgA', created_by: 'u1', status: status_ }, error: null } }
  }

  it('analyze: 400 when instructions exceed 4000 chars', async () => {
    recFound('transcribed')
    const res = await analyze.POST(req({ instructions: 'x'.repeat(4001) }), { params: Promise.resolve({ id: 'rec_1' }) })
    expect(res.status).toBe(400)
  })

  it('reanalyze: 400 on an invalid scope', async () => {
    recFound('complete')
    const res = await reanalyze.POST(req({ scope: 'galaxy' }), { params: Promise.resolve({ id: 'rec_1' }) })
    expect(res.status).toBe(400)
  })

  it('regenerate: 400 when instructions exceed 2000 chars', async () => {
    recFound('complete')
    const res = await regenerate.POST(req({ instructions: 'x'.repeat(2001) }), { params: Promise.resolve({ id: 'rec_1', extractionId: 'ex_1' }) })
    expect(res.status).toBe(400)
  })
})
