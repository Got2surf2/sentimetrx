// AGENT_TIERS Phase 2 — multi-query retrieval merge (lib/multiQueryRetrieval).
// Super agents union the raw-query and rewrite-query result sets: dedup by id
// (keep the higher-confidence hit), re-rank by confidence, take top-K.
import { describe, it, expect } from 'vitest'
import { mergeRankedChunks } from '@/lib/multiQueryRetrieval'

type C = { id?: string | null; confidence?: number | null; title?: string }

describe('mergeRankedChunks', () => {
  it('dedups by id keeping the higher-confidence hit, re-ranks by confidence', () => {
    const raw: C[] = [
      { id: 'a', confidence: 0.4, title: 'A' },
      { id: 'b', confidence: 0.9, title: 'B' },
    ]
    const rewrite: C[] = [
      { id: 'a', confidence: 0.7, title: 'A' }, // higher than raw's 0.4 → wins
      { id: 'c', confidence: 0.5, title: 'C' },
    ]
    const out = mergeRankedChunks([raw, rewrite], 12)
    expect(out.map((c) => c.id)).toEqual(['b', 'a', 'c']) // 0.9, 0.7, 0.5
    expect(out.find((c) => c.id === 'a')!.confidence).toBe(0.7)
  })

  it('takes only the top-K after merging', () => {
    const set: C[] = [
      { id: 'a', confidence: 0.1 },
      { id: 'b', confidence: 0.9 },
      { id: 'c', confidence: 0.5 },
    ]
    const out = mergeRankedChunks([set], 2)
    expect(out.map((c) => c.id)).toEqual(['b', 'c'])
  })

  it('keeps id-less chunks (keyword fallback) rather than dropping them', () => {
    const out = mergeRankedChunks([[{ confidence: 0.3, title: 'X' }], [{ confidence: 0.6, title: 'Y' }]], 12)
    expect(out).toHaveLength(2)
    expect(out[0].title).toBe('Y') // higher confidence first
  })

  it('tolerates null/undefined sets and missing confidences', () => {
    const out = mergeRankedChunks([null, undefined, [{ id: 'a' }, { id: 'b', confidence: 0.2 }]], 12)
    expect(out.map((c) => c.id)).toEqual(['b', 'a']) // 0.2 outranks missing (0)
  })

  it('limit <= 0 returns the full merged list', () => {
    const out = mergeRankedChunks([[{ id: 'a', confidence: 0.1 }, { id: 'b', confidence: 0.2 }]], 0)
    expect(out).toHaveLength(2)
  })
})
