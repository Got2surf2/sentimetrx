import { describe, expect, it } from 'vitest'
import { normalizeChunkConfidence, type RagChunk } from '@/lib/chatCore'

// D1 — Fallback retrieval must not silently suppress the whole KB.
// When the semantic RPC errors, chatCore falls back to search_knowledge_chunks
// (sql/023), which returns `rank` but NO `confidence` column. Before the fix,
// chunks[0].confidence read 0 → below the 0.05 injection floor → the entire
// knowledge base (chunks AND the free-text fallback) was dropped. These tests
// prove a keyword-fallback match now clears the floor, so knowledge is injected.
describe('normalizeChunkConfidence (D1 KB-suppression fix)', () => {
  it('derives confidence from rank when the keyword-fallback RPC omits confidence', () => {
    const chunks: RagChunk[] = [
      { title: 'Hours', content: 'Open 9–5', rank: 3.4 },
      { title: 'Parking', content: 'Lot B', rank: 1.2 },
    ]
    normalizeChunkConfidence(chunks)
    // same normalization the semantic RPC uses: LEAST(rank/8.5, 1)
    expect(chunks[0].confidence).toBeCloseTo(3.4 / 8.5, 5)
    // the whole point: top confidence now clears the 0.05 injection floor,
    // so the semantic-RPC-error path still injects knowledge.
    expect(chunks[0].confidence as number).toBeGreaterThan(0.05)
  })

  it('leaves confidence already supplied by the semantic RPC untouched', () => {
    const chunks: RagChunk[] = [{ title: 'x', content: 'y', rank: 8.5, confidence: 0.9 }]
    normalizeChunkConfidence(chunks)
    expect(chunks[0].confidence).toBe(0.9)
  })

  it('caps derived confidence at 1 and floors a negative rank at 0', () => {
    const chunks: RagChunk[] = [
      { title: 'a', content: 'b', rank: 20 },
      { title: 'c', content: 'd', rank: -1 },
    ]
    normalizeChunkConfidence(chunks)
    expect(chunks[0].confidence).toBe(1)
    expect(chunks[1].confidence).toBe(0)
  })

  it('is a safe no-op on null / empty / rank-less input', () => {
    expect(() => normalizeChunkConfidence(null)).not.toThrow()
    expect(() => normalizeChunkConfidence(undefined)).not.toThrow()
    expect(() => normalizeChunkConfidence([])).not.toThrow()
    const noRank: RagChunk[] = [{ title: 'x', content: 'y' }]
    normalizeChunkConfidence(noRank)
    expect(noRank[0].confidence).toBeUndefined()
  })
})
