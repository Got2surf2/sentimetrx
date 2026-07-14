// AGENT_TIERS Phase 2b — near-dup dedup + chunk budget on POST /knowledge.
// Near-dup guard (cosine >= 0.95 vs existing, sql/135) runs ONLY on the append
// path — in replace mode it would drop a legitimate edit that resembles the
// about-to-be-pruned old chunk. Chunk budget caps total stored chunks per agent
// (2000 standard / 5000 super).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = {
  existing: [] as { id: string; content: string }[],
  inserted: [] as { title: string; content: string }[],
  nearSim: 0,                    // similarity match_agent_knowledge_embedding returns
  capability: 'standard' as 'standard' | 'super',
}

function service() {
  return {
    from(table: string) {
      if (table === 'agents') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'b1', org_id: 'o1', subject: null, opponents: null, capability: store.capability, capability_config: {} } }) }) }) }
      }
      return {
        select: () => ({ eq: async () => ({ data: store.existing }) }),
        insert: (rows: { title: string; content: string }[]) => ({ select: async () => { const ins = rows.map((r, i) => ({ id: 'n' + i, title: r.title, content: r.content })); store.inserted.push(...ins); return { data: ins, error: null } } }),
        delete: () => ({ in: () => ({ eq: async () => ({ error: null }) }) }),
      }
    },
    rpc: async (name: string) => (name === 'match_agent_knowledge_embedding' ? { data: [{ similarity: store.nearSim }] } : { data: null }),
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: 'o1', organizations: { is_admin_org: false } } }) }) }) }) }),
  createServiceRoleClient: () => service(),
  getAuthUser: async () => ({ id: 'u1', email: 't@example.com' }),
}))
vi.mock('@/lib/embeddings', () => ({ generateEmbeddings: async (texts: string[]) => texts.map(() => [0.1, 0.2]) }))
vi.mock('@/lib/ai', () => ({ callAI: async () => ({ text: '', usage: {} }) }))
vi.mock('@/lib/usageLog', () => ({ logUsage: () => {} }))
vi.mock('@/lib/auditLog', () => ({ logBotChange: async () => {} }))

import { POST } from '@/app/api/bots/[id]/knowledge/route'

const props = { params: Promise.resolve({ id: 'b1' }) }
const req = (body: Record<string, unknown>) =>
  new Request('http://x/api/bots/b1/knowledge', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

// N distinct chunks from N headings
const nChunks = (n: number) => Array.from({ length: n }, (_v, i) => `## Heading ${i}\nThis is distinct body content number ${i} with enough length.`).join('\n\n')

beforeEach(() => {
  store.existing = []
  store.inserted = []
  store.nearSim = 0
  store.capability = 'standard'
})

describe('POST /knowledge near-dup + budget (P2b)', () => {
  it('APPEND: drops candidates that are near-duplicates of existing chunks', async () => {
    store.nearSim = 0.98 // every candidate looks like an existing chunk
    const res = await POST(req({ text: nChunks(3) }), props)
    const data = await res.json()
    expect(data.stored).toBe(0)
    expect(data.near_dup_skipped).toBe(3)
    expect(store.inserted).toHaveLength(0)
  })

  it('APPEND: keeps candidates below the near-dup threshold', async () => {
    store.nearSim = 0.5 // not similar enough to be a dup
    const res = await POST(req({ text: nChunks(3) }), props)
    const data = await res.json()
    expect(data.stored).toBe(3)
    expect(data.near_dup_skipped).toBe(0)
  })

  it('REPLACE: bypasses the near-dup guard (edits are never silently dropped)', async () => {
    store.nearSim = 0.99 // would be a dup on the append path
    const res = await POST(req({ text: nChunks(2), replace: true }), props)
    const data = await res.json()
    expect(data.stored).toBe(2)             // inserted despite high similarity
    expect(data.near_dup_skipped ?? 0).toBe(0)
  })

  it('caps inserts at the chunk budget (super = 5000)', async () => {
    store.capability = 'super'
    // 4,999 existing → only 1 slot of headroom under the 5,000 budget
    store.existing = Array.from({ length: 4999 }, (_v, i) => ({ id: 'e' + i, content: 'existing ' + i }))
    store.nearSim = 0.1
    const res = await POST(req({ text: nChunks(5) }), props)
    const data = await res.json()
    expect(data.stored).toBe(1)
    expect(data.budget_skipped).toBe(4)
  })
})
