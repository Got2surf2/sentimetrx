import { describe, it, expect, vi } from 'vitest'

// entityAnalysis imports callAI (→ server-only, already stubbed in tests/setup),
// but mock the AI module outright so no client is constructed for these pure tests.
vi.mock('@/lib/ai', () => ({ callAI: vi.fn() }))

import { catalogToAggregate, entitySlideSpecs, splitMentions } from '@/lib/entityAnalysis'
import type { EntityGridSlide } from '@/lib/pptx/slideRenderer'

describe('splitMentions', () => {
  it('splits on commas / "and" / "&" / semicolons and drops null-ish tokens', () => {
    expect(splitMentions('Red Cross, Salvation Army and St. Jude; none')).toEqual([
      'Red Cross', 'Salvation Army', 'St. Jude',
    ])
    expect(splitMentions('N/A')).toEqual([])
    expect(splitMentions('')).toEqual([])
  })
})

describe('catalogToAggregate', () => {
  const entities = [
    { canonical: 'American Red Cross', category: 'brand', mentions: 12, aliases: ['the red cross'] },
    { canonical: 'Local Food Bank', category: 'place', mentions: 5, aliases: ['food bank'] },
    { canonical: 'Goodwill', category: 'brand', mentions: 8, aliases: [] },
    { canonical: 'Never Matched', category: 'other', mentions: 0, aliases: [] }, // dropped
  ]
  const categories = [{ category: 'brand', mentions: 20 }, { category: 'place', mentions: 5 }]

  it('sorts by mentions desc, drops zero-mention rows, and rolls up totals', () => {
    const agg = catalogToAggregate(entities, categories)
    expect(agg.sorted.map(e => e.canonical)).toEqual(['American Red Cross', 'Goodwill', 'Local Food Bank'])
    expect(agg.distinctCount).toBe(3)
    expect(agg.totalMentions).toBe(25) // 12 + 8 + 5
    expect(agg.catCounts).toEqual({ brand: 20, place: 5 })
  })

  it('builds one representative quote per category', () => {
    const agg = catalogToAggregate(entities, categories)
    // brand (first by mentions) then place; goodwill (brand) is skipped — same category
    expect(agg.quoteCandidates).toHaveLength(2)
    expect(agg.quoteCandidates[0]).toContain('American Red Cross')
    expect(agg.quoteCandidates[1]).toContain('Local Food Bank')
  })
})

describe('entitySlideSpecs', () => {
  it('emits top-grid + bar + long-tail + quotes when there are >24 entities', () => {
    const entities = Array.from({ length: 30 }, (_, i) => ({
      canonical: 'Org ' + i, category: i % 2 ? 'brand' : 'place', mentions: 30 - i, aliases: ['o' + i],
    }))
    const categories = [{ category: 'brand', mentions: 200 }, { category: 'place', mentions: 150 }]
    const specs = entitySlideSpecs('Charities Donated To', catalogToAggregate(entities, categories))
    expect(specs.map(s => s.type)).toEqual(['entity_grid', 'bar_chart', 'entity_grid', 'quotes'])
    expect(specs[0].title).toContain('Charities Donated To')
    // top grid caps at 24
    expect((specs[0] as EntityGridSlide).entities).toHaveLength(24)
  })

  it('omits the long-tail grid when there are <=24 entities', () => {
    const entities = [{ canonical: 'A', category: 'brand', mentions: 3, aliases: [] }]
    const specs = entitySlideSpecs('Field', catalogToAggregate(entities, [{ category: 'brand', mentions: 3 }]))
    expect(specs.map(s => s.type)).toEqual(['entity_grid', 'bar_chart', 'quotes'])
  })
})
