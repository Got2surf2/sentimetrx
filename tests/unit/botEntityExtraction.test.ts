// Tests for the pure helpers in lib/botEntityExtraction.ts.
//
// The Haiku call + DB UPSERT are integration concerns and are exercised by
// the route-level tests. Here we cover the chunk-batching boundary logic
// and the aggregation/dedupe rules.

import { describe, it, expect } from 'vitest'
import {
  batchChunksForExtraction,
  aggregateExtractedEntities,
  classifyChunkSource,
  BOT_ENTITY_CATEGORIES,
} from '@/lib/botEntityExtraction'

describe('classifyChunkSource (provenance)', () => {
  it('classifies a URL-origin chunk as an authoritative crawl', () => {
    expect(classifyChunkSource({ source: 'https://brand.com/about', source_type: 'url' }))
      .toEqual({ kind: 'crawl', ref: { url: 'https://brand.com/about', source_type: 'url' } })
    expect(classifyChunkSource({ source_type: 'crawl' }).kind).toBe('crawl')
  })
  it('classifies an uploaded file / text chunk as an authoritative document', () => {
    expect(classifyChunkSource({ source: 'Brand Style Guide.pdf', source_type: 'file' }))
      .toEqual({ kind: 'document', ref: { source: 'Brand Style Guide.pdf', source_type: 'file' } })
    expect(classifyChunkSource({}).kind).toBe('document')         // no metadata → document (KB is official)
    expect(classifyChunkSource(null).kind).toBe('document')
  })
})

describe('batchChunksForExtraction', () => {
  it('returns no batches for empty input', () => {
    expect(batchChunksForExtraction([])).toEqual([])
  })

  it('groups up to 5 small chunks into one batch', () => {
    const chunks = Array.from({ length: 5 }, (_, i) => ({ title: 't' + i, content: 'a'.repeat(100) }))
    const batches = batchChunksForExtraction(chunks)
    expect(batches.length).toBe(1)
    expect(batches[0].length).toBe(5)
  })

  it('splits when CHUNKS_PER_BATCH is exceeded', () => {
    const chunks = Array.from({ length: 6 }, (_, i) => ({ title: 't' + i, content: 'a'.repeat(100) }))
    const batches = batchChunksForExtraction(chunks)
    expect(batches.length).toBe(2)
    expect(batches[0].length).toBe(5)
    expect(batches[1].length).toBe(1)
  })

  it('splits when MAX_CHARS_PER_BATCH is exceeded', () => {
    // Each chunk is 5000 chars — two of them already overflow the 6000 budget.
    const chunks = [
      { title: 'a', content: 'a'.repeat(5000) },
      { title: 'b', content: 'b'.repeat(5000) },
      { title: 'c', content: 'c'.repeat(5000) },
    ]
    const batches = batchChunksForExtraction(chunks)
    expect(batches.length).toBe(3)
    expect(batches.every(b => b.length === 1)).toBe(true)
  })

  it('always keeps at least one chunk per batch (even if it overflows alone)', () => {
    // Single chunk larger than the char budget: must still emit one batch
    // with that single chunk, not infinitely loop or split.
    const chunks = [{ title: 'huge', content: 'a'.repeat(20000) }]
    const batches = batchChunksForExtraction(chunks)
    expect(batches.length).toBe(1)
    expect(batches[0].length).toBe(1)
  })
})

describe('aggregateExtractedEntities', () => {
  it('returns an empty map for empty input', () => {
    expect(aggregateExtractedEntities([]).size).toBe(0)
    expect(aggregateExtractedEntities([[]]).size).toBe(0)
  })

  it('dedupes by slug across batches', () => {
    const result = aggregateExtractedEntities([
      [{ canonical: 'Plymouth Sorrento', category: 'place' }],
      [{ canonical: 'Plymouth Sorrento', category: 'place' }],
    ])
    expect(result.size).toBe(1)
    expect(result.get('plymouth_sorrento')?.count).toBe(2)
  })

  it('merges variant surface forms as aliases (case-insensitive)', () => {
    const result = aggregateExtractedEntities([
      [{ canonical: 'Plymouth Sorrento Road', category: 'place' }],
      [{ canonical: 'plymouth sorrento road', category: 'place' }],
    ])
    const entry = result.get('plymouth_sorrento_road')
    expect(entry?.canonical).toBe('Plymouth Sorrento Road')
    expect(entry?.aliases).toEqual([])
  })

  it('captures distinct surface forms in aliases', () => {
    const result = aggregateExtractedEntities([
      [{ canonical: 'NW Orange', category: 'place' }],
      [{ canonical: 'NWO', category: 'place' }],
    ])
    // Different canonicals slugify differently — these become separate entries.
    expect(result.size).toBe(2)
    expect(result.has('nw_orange')).toBe(true)
    expect(result.has('nwo')).toBe(true)
  })

  it('resolves category by majority vote', () => {
    const result = aggregateExtractedEntities([
      [{ canonical: 'Foundations Project', category: 'program' }],
      [{ canonical: 'Foundations Project', category: 'program' }],
      [{ canonical: 'Foundations Project', category: 'organization' }],
    ])
    expect(result.get('foundations_project')?.category).toBe('program')
  })

  it('preserves first-seen category for ties', () => {
    const result = aggregateExtractedEntities([
      [{ canonical: 'Sarina', category: 'person' }],
      [{ canonical: 'Sarina', category: 'product' }],
    ])
    expect(result.get('sarina')?.category).toBe('person')
  })

  it('skips items with no canonical', () => {
    const result = aggregateExtractedEntities([
      [{ canonical: '', category: 'other' }],
      [{ canonical: 'Real Entity', category: 'place' }],
    ])
    expect(result.size).toBe(1)
    expect(result.has('real_entity')).toBe(true)
  })
})

describe('BOT_ENTITY_CATEGORIES', () => {
  it('exposes exactly the 8 categories (incl. policy per § 9.y open Q2)', () => {
    expect(BOT_ENTITY_CATEGORIES).toEqual([
      'person', 'place', 'organization', 'product', 'program', 'event', 'policy', 'other',
    ])
  })
})
