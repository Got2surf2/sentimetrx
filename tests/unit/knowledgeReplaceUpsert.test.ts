// D3 (AGENT_TIERS §2) — editor save is an atomic diff-upsert, not a KB wipe.
// The old save did DELETE-all-then-POST, so any mid-save failure left the agent
// with zero/partial knowledge and every save re-embedded the entire KB. POST now
// accepts `replace: true`: it inserts only new/changed chunks, deletes only the
// chunks whose content disappeared, leaves unchanged chunks untouched (no
// re-embed), and prunes the old chunks only AFTER the new ones commit.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = {
  existing: [] as { id: string; content: string }[],
  inserted: [] as { title: string; content: string }[],
  deletedIds: [] as string[],
  embedInputs: [] as string[],
  insertError: null as { message: string } | null,
}

function chunkTable() {
  return {
    // existing fetch: .select('id, content').eq('bot_id', id) → resolves directly
    select: () => ({ eq: async () => ({ data: store.existing.map((c) => ({ id: c.id, content: c.content })) }) }),
    insert: (rows: { title: string; content: string }[]) => ({
      select: async () => {
        if (store.insertError) return { data: null, error: store.insertError }
        const ins = rows.map((r, i) => ({ id: 'new-' + i, title: r.title, content: r.content }))
        store.inserted.push(...ins)
        return { data: ins, error: null }
      },
    }),
    update: () => ({ eq: async () => ({ error: null }) }),
    delete: () => ({ in: (_c: string, ids: string[]) => ({ eq: async () => { store.deletedIds.push(...ids); return { error: null } } }) }),
  }
}

function service() {
  return {
    from(table: string) {
      if (table === 'agents') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'b1', org_id: 'o1', subject: null, opponents: null } }) }) }) }
      }
      return chunkTable()
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: 'o1', organizations: { is_admin_org: false } } }) }) }) }),
  }),
  createServiceRoleClient: () => service(),
  getAuthUser: async () => ({ id: 'u1', email: 't@example.com' }),
}))
vi.mock('@/lib/embeddings', () => ({
  generateEmbeddings: async (texts: string[]) => { store.embedInputs.push(...texts); return texts.map(() => [0.1, 0.2]) },
}))
vi.mock('@/lib/ai', () => ({ callAI: async () => ({ text: '', usage: {} }) }))
vi.mock('@/lib/usageLog', () => ({ logUsage: () => {} }))
vi.mock('@/lib/auditLog', () => ({ logBotChange: async () => {} }))

import { POST } from '@/app/api/bots/[id]/knowledge/route'

const props = { params: Promise.resolve({ id: 'b1' }) }
const req = (body: Record<string, unknown>) =>
  new Request('http://x/api/bots/b1/knowledge', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  store.existing = []
  store.inserted = []
  store.deletedIds = []
  store.embedInputs = []
  store.insertError = null
})

// Two headings → two chunks: "Alpha section body ..." and "Beta section body ...".
const bodyFor = (alpha: string, beta: string) =>
  `## Alpha\n${alpha}\n\n## Beta\n${beta}`

describe('POST /knowledge replace = diff-upsert (D3)', () => {
  it('inserts only changed chunks and deletes only removed ones; unchanged chunks are untouched', async () => {
    // Existing KB: the two current chunk bodies.
    store.existing = [
      { id: 'old-alpha', content: 'alpha body that stays the same here' },
      { id: 'old-beta', content: 'beta body that will be edited away now' },
    ]
    // New save: Alpha unchanged, Beta rewritten.
    const res = await POST(
      req({ text: bodyFor('alpha body that stays the same here', 'beta body rewritten with fresh content'), replace: true }),
      props,
    )
    const data = await res.json()

    // only the changed (Beta) chunk was inserted + embedded — Alpha was NOT re-embedded
    expect(store.inserted.map((c) => c.content)).toEqual(['beta body rewritten with fresh content'])
    expect(store.embedInputs).toHaveLength(1)
    // only the now-absent old Beta was pruned; unchanged Alpha kept
    expect(store.deletedIds).toEqual(['old-beta'])
    expect(data).toMatchObject({ stored: 1, removed: 1 })
  })

  it('prunes chunks the editor dropped even when nothing new is inserted', async () => {
    store.existing = [
      { id: 'old-alpha', content: 'alpha body that stays the same here' },
      { id: 'old-gone', content: 'a chunk the user deleted from the editor now' },
    ]
    // New save keeps only Alpha (identical) — no Beta heading at all.
    const res = await POST(req({ text: `## Alpha\nalpha body that stays the same here`, replace: true }), props)
    const data = await res.json()

    expect(store.inserted).toHaveLength(0) // nothing new → no re-embed
    expect(store.deletedIds).toEqual(['old-gone'])
    expect(data).toMatchObject({ stored: 0, removed: 1 })
  })

  it('does NOT delete anything without replace (plain append semantics preserved)', async () => {
    store.existing = [{ id: 'old-x', content: 'some other existing chunk content here' }]
    await POST(req({ text: bodyFor('brand new alpha content here', 'brand new beta content here') }), props)
    expect(store.inserted).toHaveLength(2)
    expect(store.deletedIds).toEqual([]) // append never prunes
  })

  it('leaves the OLD KB intact when the insert fails (no zero-knowledge window)', async () => {
    store.existing = [{ id: 'old-keep', content: 'existing content to preserve on failure now' }]
    store.insertError = { message: 'insert boom' }
    const res = await POST(req({ text: bodyFor('new alpha content here', 'new beta content here'), replace: true }), props)
    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(store.deletedIds).toEqual([]) // prune never ran → old KB fully intact
  })
})
