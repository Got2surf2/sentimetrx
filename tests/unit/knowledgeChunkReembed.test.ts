// D2 (AGENT_TIERS §2) — editing a knowledge chunk must re-embed it.
// The tsvector auto-refreshes on title/content change via trigger, but the
// pgvector `embedding` did NOT, so a semantic search kept matching the OLD
// text forever. PATCH now regenerates the embedding for the merged new text
// (blocking, one chunk); on embedding failure it clears the embedding rather
// than leave a stale one (the chunk stays findable via the lexical fallback).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const store = {
  chunk: { id: 'c1', title: 'Old Title', content: 'old body' } as { id: string; title: string; content: string },
  update: null as Record<string, unknown> | null,
  embedCalls: [] as string[],
}
let embedResult: number[] | null = [0.1, 0.2, 0.3]
let embedThrows = false

function service() {
  return {
    from(table: string) {
      if (table === 'agents') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'b1', org_id: 'o1' } }) }) }) }
      }
      // agent_knowledge_chunks
      return {
        select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: store.chunk }) }) }) }),
        update: (payload: Record<string, unknown>) => { store.update = payload; return { eq: async () => ({ error: null }) } },
      }
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
  generateEmbedding: async (text: string) => {
    store.embedCalls.push(text)
    if (embedThrows) throw new Error('embed outage')
    return embedResult
  },
}))

import { PATCH } from '@/app/api/bots/[id]/knowledge/[chunkId]/route'

const props = { params: Promise.resolve({ id: 'b1', chunkId: 'c1' }) }
const req = (body: Record<string, unknown>) =>
  new Request('http://x/api/bots/b1/knowledge/c1', { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }) as unknown as NextRequest

beforeEach(() => {
  store.chunk = { id: 'c1', title: 'Old Title', content: 'old body' }
  store.update = null
  store.embedCalls = []
  embedResult = [0.1, 0.2, 0.3]
  embedThrows = false
})

describe('PATCH /knowledge/[chunkId] re-embeds on edit (D2)', () => {
  it('regenerates the embedding for the merged new title+content', async () => {
    const res = await PATCH(req({ content: 'brand new body' }), props)
    expect(res.status).toBe(200)
    // embed input merges the NEW content with the EXISTING title
    expect(store.embedCalls).toEqual(['Old Title\nbrand new body'])
    expect(store.update).toMatchObject({ content: 'brand new body', embedding: JSON.stringify([0.1, 0.2, 0.3]) })
  })

  it('uses the new title when only the title changes', async () => {
    await PATCH(req({ title: 'New Title' }), props)
    expect(store.embedCalls).toEqual(['New Title\nold body'])
  })

  it('clears the embedding (never leaves it stale) when embedding cannot be produced', async () => {
    embedResult = null
    await PATCH(req({ content: 'changed' }), props)
    expect(store.update).toMatchObject({ content: 'changed', embedding: null })
  })

  it('clears the embedding when the embedding call throws (text edit still applies)', async () => {
    embedThrows = true
    const res = await PATCH(req({ content: 'changed' }), props)
    expect(res.status).toBe(200)
    expect(store.update).toMatchObject({ content: 'changed', embedding: null })
  })
})
