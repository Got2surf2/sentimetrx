// "Ana remembers" (sql/197) — lib + route contracts.
// Lib: the prompt block injects ONLY active memories that apply to the open
// dataset, and carries the framing-only invariant; loads pair org_id AND
// user_id explicitly (service-role reads are not bounded by RLS).
// Route: every mutation is scoped to the CALLER's identity — org/user ids are
// stamped from auth, never taken from the body; cross-org dataset scoping is
// refused; PATCH/DELETE 404 rather than touch another user's row.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { memoryPromptBlock, REMEMBER_GUIDANCE, loadAnalystMemories, type AnalystMemory } from '@/lib/analystMemory'

// ── Stateful fake service ──────────────────────────────────────────────────
interface Row {
  id: string; org_id: string; user_id: string; dataset_id: string | null
  source: string; status: string; statement: string; created_at: string; updated_at: string
}
const db = {
  memories: [] as Row[],
  features: [] as Record<string, unknown>[],
  datasets: [{ id: 'ds-1', org_id: 'org-1' }, { id: 'ds-other', org_id: 'org-2' }],
}
let nextId = 1

function matches(row: Record<string, unknown>, filters: [string, unknown][], neqs: [string, unknown][], ilikes: [string, string][] = []) {
  return filters.every(([k, v]) => row[k] === v) && neqs.every(([k, v]) => row[k] !== v)
    && ilikes.every(([k, v]) => String(row[k] ?? '').toLowerCase() === v)
}

function service() {
  return {
    from(table: string) {
      const filters: [string, unknown][] = []
      const neqs: [string, unknown][] = []
      const ilikes: [string, string][] = []
      const b: Record<string, unknown> = {}
      const rowsOf = () => (table === 'analyst_memories' ? db.memories : table === 'datasets' ? db.datasets : db.features) as unknown as Record<string, unknown>[]
      b.select = () => b
      b.eq = (k: string, v: unknown) => { filters.push([k, v]); return b }
      b.neq = (k: string, v: unknown) => { neqs.push([k, v]); return b }
      b.ilike = (k: string, v: string) => {
        ilikes.push([k, v.replace(/\\([\\%_])/g, '$1').toLowerCase()])
        return b
      }
      b.order = () => b
      b.maybeSingle = async () => ({ data: rowsOf().find(r => matches(r, filters, neqs, ilikes)) || null, error: null })
      b.single = async () => ({ data: rowsOf().find(r => matches(r, filters, neqs, ilikes)) || null, error: null })
      b.then = (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: rowsOf().filter(r => matches(r, filters, neqs, ilikes)), error: null }).then(res)
      b.insert = (payload: Record<string, unknown>) => {
        const row = { id: 'm-' + nextId++, created_at: 'now', updated_at: 'now', ...payload } as Row
        db.memories.push(row)
        return { select: () => ({ single: async () => ({ data: row, error: null }) }) }
      }
      b.update = (patch: Record<string, unknown>) => {
        const chain: Record<string, unknown> = {}
        chain.eq = (k: string, v: unknown) => { filters.push([k, v]); return chain }
        chain.select = () => chain
        chain.maybeSingle = async () => {
          const row = db.memories.find(r => matches(r as unknown as Record<string, unknown>, filters, []))
          if (row) Object.assign(row, patch)
          return { data: row || null, error: null }
        }
        return chain
      }
      b.delete = () => {
        const chain: Record<string, unknown> = {}
        chain.eq = (k: string, v: unknown) => { filters.push([k, v]); return chain }
        chain.select = () => chain
        chain.maybeSingle = async () => {
          const i = db.memories.findIndex(r => matches(r as unknown as Record<string, unknown>, filters, []))
          if (i === -1) return { data: null, error: null }
          const [row] = db.memories.splice(i, 1)
          return { data: { id: row.id }, error: null }
        }
        return chain
      }
      b.upsert = async (payload: Record<string, unknown>) => { db.features.push(payload); return { error: null } }
      return b
    },
  }
}

const ctx = { userId: 'user-1' as string | null, orgId: 'org-1' as string | null, isAdmin: false }
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({}),
  createServiceRoleClient: () => service(),
}))
vi.mock('@/lib/auth/orgAccess', () => ({ getCallerOrgContext: async () => ctx }))

import { GET, POST, PATCH, DELETE } from '@/app/api/analyst-memory/route'

const req = (body: Record<string, unknown>) =>
  new Request('http://x/api/analyst-memory', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  db.memories = []
  db.features = []
  ctx.userId = 'user-1'; ctx.orgId = 'org-1'
  nextId = 1
})

// ── Lib ────────────────────────────────────────────────────────────────────
const mem = (over: Partial<AnalystMemory>): AnalystMemory => ({
  id: 'm', dataset_id: null, source: 'interview', status: 'active',
  statement: 'Lead with locations', created_at: 'now', updated_at: 'now', ...over,
})

describe('memoryPromptBlock', () => {
  it('empty and inapplicable memories produce an empty block', () => {
    expect(memoryPromptBlock([], 'ds-1')).toBe('')
    expect(memoryPromptBlock([mem({ status: 'pending' }), mem({ status: 'archived' })], 'ds-1')).toBe('')
    expect(memoryPromptBlock([mem({ dataset_id: 'ds-OTHER' })], 'ds-1')).toBe('')
  })

  it('injects active org-wide + this-dataset memories with the framing-only invariant', () => {
    const block = memoryPromptBlock([
      mem({ statement: 'Lead with locations' }),
      mem({ statement: 'Skip parking', dataset_id: 'ds-1' }),
      mem({ statement: 'WRONG DATASET', dataset_id: 'ds-2' }),
      mem({ statement: 'PENDING', status: 'pending' }),
    ], 'ds-1')
    expect(block).toContain('Lead with locations')
    expect(block).toContain('Skip parking (this dataset only)')
    expect(block).not.toContain('WRONG DATASET')
    expect(block).not.toContain('PENDING')
    expect(block).toContain('never the underlying figures')
    expect(block).toContain('What Ana remembers')
  })

  it('REMEMBER_GUIDANCE routes count-changing corrections to the theme tools', () => {
    expect(REMEMBER_GUIDANCE).toContain('theme tools')
    expect(REMEMBER_GUIDANCE).toContain('never assume it was saved')
  })
})

describe('loadAnalystMemories', () => {
  it('pairs org_id AND user_id and excludes archived', async () => {
    db.memories = [
      { id: 'a', org_id: 'org-1', user_id: 'user-1', dataset_id: null, source: 'interview', status: 'active', statement: 'mine', created_at: '1', updated_at: '1' },
      { id: 'b', org_id: 'org-1', user_id: 'user-2', dataset_id: null, source: 'interview', status: 'active', statement: 'other user', created_at: '1', updated_at: '1' },
      { id: 'c', org_id: 'org-2', user_id: 'user-1', dataset_id: null, source: 'interview', status: 'active', statement: 'other org', created_at: '1', updated_at: '1' },
      { id: 'd', org_id: 'org-1', user_id: 'user-1', dataset_id: null, source: 'interview', status: 'archived', statement: 'archived', created_at: '1', updated_at: '1' },
    ]
    const out = await loadAnalystMemories(service() as never, { userId: 'user-1', orgId: 'org-1' })
    expect(out.map(m => m.statement)).toEqual(['mine'])
  })
})

// ── Route ──────────────────────────────────────────────────────────────────
describe('/api/analyst-memory', () => {
  it('401s without auth on every method', async () => {
    ctx.userId = null
    expect((await GET()).status).toBe(401)
    expect((await POST(req({ statement: 'x', source: 'correction' }))).status).toBe(401)
    expect((await PATCH(req({ id: 'm-1' }))).status).toBe(401)
    expect((await DELETE(req({ id: 'm-1' }))).status).toBe(401)
  })

  it('POST stamps the CALLER identity — body org/user ids are ignored', async () => {
    const res = await POST(req({ statement: 'Lead with locations', source: 'correction', org_id: 'org-EVIL', user_id: 'user-EVIL' }))
    expect(res.status).toBe(200)
    expect(db.memories[0].org_id).toBe('org-1')
    expect(db.memories[0].user_id).toBe('user-1')
  })

  it('POST validates source and requires a statement', async () => {
    expect((await POST(req({ statement: 'x', source: 'telepathy' }))).status).toBe(400)
    expect((await POST(req({ statement: '   ', source: 'correction' }))).status).toBe(400)
  })

  it('POST refuses a dataset scope the caller org does not own', async () => {
    expect((await POST(req({ statement: 'x', source: 'correction', datasetId: 'ds-other' }))).status).toBe(404)
    expect((await POST(req({ statement: 'x', source: 'correction', datasetId: 'ds-1' }))).status).toBe(200)
    expect(db.memories[0].dataset_id).toBe('ds-1')
  })

  it('POST markInterviewed upserts the ana_interviewed flag; GET reports it', async () => {
    expect((await POST(req({ markInterviewed: true }))).status).toBe(200)
    expect(db.features[0]).toMatchObject({ user_id: 'user-1', feature: 'ana_interviewed', enabled: true })
    db.features = [{ user_id: 'user-1', feature: 'ana_interviewed', enabled: true }]
    const j = await (await GET()).json()
    expect(j.interviewed).toBe(true)
  })

  it('POST is idempotent on the statement: a re-proposal returns the existing row, no duplicate', async () => {
    const r1 = await POST(req({ statement: 'Lead with risks and anomalies', source: 'interview' }))
    expect(r1.status).toBe(200)
    const r2 = await POST(req({ statement: 'lead with RISKS and anomalies', source: 'correction' }))
    const j2 = await r2.json()
    expect(j2.deduped).toBe(true)
    expect(db.memories).toHaveLength(1)
  })

  it("PATCH/DELETE cannot touch another user's or org's memory (404, row untouched)", async () => {
    db.memories = [{ id: 'm-x', org_id: 'org-1', user_id: 'user-2', dataset_id: null, source: 'correction', status: 'active', statement: 'not yours', created_at: '1', updated_at: '1' }]
    expect((await PATCH(req({ id: 'm-x', statement: 'hijacked' }))).status).toBe(404)
    expect((await DELETE(req({ id: 'm-x' }))).status).toBe(404)
    expect(db.memories).toHaveLength(1)
    expect(db.memories[0].statement).toBe('not yours')
  })

  it('PATCH edits own statement / confirms pending; DELETE removes own row', async () => {
    db.memories = [{ id: 'm-1', org_id: 'org-1', user_id: 'user-1', dataset_id: null, source: 'observed', status: 'pending', statement: 'old', created_at: '1', updated_at: '1' }]
    const r1 = await PATCH(req({ id: 'm-1', statement: 'new wording', status: 'active' }))
    expect(r1.status).toBe(200)
    expect(db.memories[0]).toMatchObject({ statement: 'new wording', status: 'active' })
    expect((await PATCH(req({ id: 'm-1', status: 'bogus' }))).status).toBe(400)
    expect((await DELETE(req({ id: 'm-1' }))).status).toBe(200)
    expect(db.memories).toHaveLength(0)
  })
})
