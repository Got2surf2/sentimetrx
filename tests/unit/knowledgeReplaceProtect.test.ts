// P2d — a D3 editor save (replace:true) must NOT prune background bulk-source
// chunks (super-crawl / re-crawl cron, source_type='deep-crawl'). Those live
// outside the editor's authored payload by design, so pruning "anything not in
// the incoming set" would delete a 300-page crawl on the next save.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/embeddings', () => ({ generateEmbeddings: async (arr: string[]) => arr.map(() => null) }))
vi.mock('@/lib/ai', () => ({ callAI: async () => ({ text: '', usage: {} }) }))
vi.mock('@/lib/usageLog', () => ({ logUsage: () => {} }))
vi.mock('@/lib/auditLog', () => ({ logBotChange: () => {} }))

import { ingestKnowledgeText } from '@/lib/botKnowledge/ingest'

const store = {
  existing: [] as { id: string; content: string; metadata: unknown }[],
  deletedIds: [] as string[],
  inserted: [] as { title: string; content: string }[],
}

function service() {
  return {
    from() {
      return {
        select: () => ({ eq: async () => ({ data: store.existing }) }),
        insert: (rows: { title: string; content: string }[]) => ({ select: async () => { const ins = rows.map((r, i) => ({ id: 'n' + i, title: r.title, content: r.content })); store.inserted.push(...ins); return { data: ins, error: null } } }),
        delete: () => ({ in: (_col: string, ids: string[]) => ({ eq: async () => { store.deletedIds.push(...ids); return { error: null } } }) }),
        update: () => ({ eq: async () => ({ error: null }) }),
      }
    },
    rpc: async () => ({ data: null }),
  }
}

const bot = { id: 'b1', org_id: 'o1', subject: null, opponents: null, capability: 'super', capability_config: {} }

beforeEach(() => { store.existing = []; store.deletedIds = []; store.inserted = [] })

describe('ingestKnowledgeText replace protection', () => {
  it('prunes stale AUTHORED chunks but preserves deep-crawl chunks', async () => {
    store.existing = [
      { id: 'authored-old', content: 'Old authored paragraph that the editor removed from the textarea.', metadata: {} },
      { id: 'crawl-1', content: 'A crawled page body from the 300-page deep crawl.', metadata: { source_type: 'deep-crawl' } },
    ]
    // Editor save payload (replace) contains neither existing content, plus one new section.
    const text = '## New Section\n\nThis is brand new authored content in the knowledge box now.'
    const res = await ingestKnowledgeText(service() as never, bot, text, { replace: true })

    // The authored chunk is stale (content gone) → pruned. The crawl chunk is
    // protected → NOT pruned.
    expect(store.deletedIds).toContain('authored-old')
    expect(store.deletedIds).not.toContain('crawl-1')
    expect(res.stored).toBe(1)
    expect(res.removed).toBe(1)
  })

  it('append mode never prunes anything', async () => {
    store.existing = [{ id: 'crawl-1', content: 'crawled body', metadata: { source_type: 'deep-crawl' } }]
    const res = await ingestKnowledgeText(service() as never, bot, '## More\n\nAdditional appended knowledge content here.', { replace: false })
    expect(store.deletedIds).toEqual([])
    expect(res.removed).toBe(0)
  })
})
