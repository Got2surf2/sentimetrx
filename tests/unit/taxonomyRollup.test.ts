import { describe, it, expect } from 'vitest'
import { aggregateTaxonomy, type TaxonomyRow } from '@/lib/taxonomyRollup'
import { resolveDictionary } from '@/lib/taxonomyDictionary'
import { KEYWORD_DICTIONARY } from '@/lib/taxonomyKeywords'

const blank = (): TaxonomyRow => ({
  axis_touchpoint: [], axis_attribute: [], axis_product: [], axis_beverage: [],
  axis_ambiance: [], axis_context: [], axis_outcome: [], alert_tags: [], assertions: [],
})

describe('aggregateTaxonomy', () => {
  it('computes axis/sub rates, sentiment, and alerts over rows', () => {
    const rows: TaxonomyRow[] = [
      { ...blank(),
        axis_product: ['steak'], axis_attribute: ['flavor'],
        assertions: [
          { axis: 'product', sub: 'steak', polarity: 'pos' },
          { axis: 'attribute', sub: 'flavor', polarity: 'pos' },
        ] },
      { ...blank(),
        axis_product: ['steak'], alert_tags: ['food safety'],
        assertions: [
          { axis: 'product', sub: 'steak', polarity: 'neg' },
          { axis: 'attribute', sub: 'pests', polarity: 'neg' },
        ],
        axis_attribute: ['pests'] },
      { ...blank() }, // no signal
    ]
    const r = aggregateTaxonomy(rows)

    expect(r.classifiedRows).toBe(3)
    expect(r.withSignal).toBe(2)            // 2 of 3 rows carry a signal
    expect(r.alertRows).toBe(1)
    expect(r.alerts).toEqual([{ tag: 'food safety', count: 1 }])

    const product = r.axes.find(a => a.axis === 'product')!
    expect(product.count).toBe(2)
    expect(product.rate).toBeCloseTo(66.7, 1)   // 2/3

    const steak = r.subs.find(s => s.sub === 'steak')!
    expect(steak.count).toBe(2)
    expect(steak.pos).toBe(1)
    expect(steak.neg).toBe(1)
    expect(steak.posPct).toBe(50)               // 1 pos / (1 pos + 1 neg)
  })

  it('returns zeros for an empty dataset', () => {
    const r = aggregateTaxonomy([])
    expect(r.classifiedRows).toBe(0)
    expect(r.withSignal).toBe(0)
    expect(r.subs).toEqual([])
    expect(r.axes.every(a => a.rate === 0)).toBe(true)
  })
})

describe('resolveDictionary', () => {
  it('core is the bare hand-written dictionary', () => {
    expect(resolveDictionary('core')).toBe(KEYWORD_DICTIONARY)
  })
  it('a brand overlay strictly extends core (core ⊕ overlay)', () => {
    const core = resolveDictionary('core').length
    const chuys = resolveDictionary('chuys').length
    expect(chuys).toBeGreaterThan(core)
    // first `core` entries are the core dictionary, unchanged
    expect(resolveDictionary('chuys').slice(0, core)).toEqual(KEYWORD_DICTIONARY)
  })
})
