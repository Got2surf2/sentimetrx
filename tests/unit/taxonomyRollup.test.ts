import { describe, it, expect } from 'vitest'
import { aggregateTaxonomy, type TaxonomyRow } from '@/lib/taxonomyRollup'
import { resolveDictionary } from '@/lib/taxonomyDictionary'
import { KEYWORD_DICTIONARY } from '@/lib/taxonomyKeywords'

const blank = (): TaxonomyRow => ({
  axis_touchpoint: [], axis_attribute: [], axis_product: [], axis_beverage: [],
  axis_ambiance: [], axis_context: [], axis_outcome: [], axis_emotion: [],
  alert_tags: [], assertions: [],
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

  it('falls back to star ratings for neutral "who" subs with no polarised mentions', () => {
    // Touchpoint entities ("server") are all neutral keyword phrases: they get
    // mention counts but never pos/neg assertions. Sentiment should fall back to
    // the star ratings of the mentioning reviews (share rated ≥4), flagged 'rating'.
    const rows: TaxonomyRow[] = [
      { ...blank(), rating: 5, axis_touchpoint: ['server'] },
      { ...blank(), rating: 4, axis_touchpoint: ['server'] },
      { ...blank(), rating: 2, axis_touchpoint: ['server'] },
    ]
    const server = aggregateTaxonomy(rows).subs.find(s => s.sub === 'server')!
    expect(server.count).toBe(3)
    expect(server.pos).toBe(0)
    expect(server.neg).toBe(0)
    expect(server.posPct).toBe(67)          // 2 of 3 rated ≥4
    expect(server.sentBasis).toBe('rating')
  })

  it('prefers keyword polarity over the rating fallback when both exist', () => {
    const rows: TaxonomyRow[] = [
      { ...blank(), rating: 2, axis_product: ['steak'],
        assertions: [{ axis: 'product', sub: 'steak', polarity: 'pos' }] },
    ]
    const steak = aggregateTaxonomy(rows).subs.find(s => s.sub === 'steak')!
    expect(steak.posPct).toBe(100)          // keyword pos wins, not the 2★ rating
    expect(steak.sentBasis).toBe('keyword')
  })

  it('leaves posPct null when there is neither polarity nor a rating', () => {
    const server = aggregateTaxonomy([{ ...blank(), axis_touchpoint: ['server'] }])
      .subs.find(s => s.sub === 'server')!
    expect(server.posPct).toBeNull()
    expect(server.sentBasis).toBeNull()
  })

  it('returns zeros for an empty dataset', () => {
    const r = aggregateTaxonomy([])
    expect(r.classifiedRows).toBe(0)
    expect(r.withSignal).toBe(0)
    expect(r.subs).toEqual([])
    expect(r.axes.every(a => a.rate === 0)).toBe(true)
  })

  it('omits the emotion axis and summary entirely when no flags fired', () => {
    const r = aggregateTaxonomy([{ ...blank(), axis_product: ['steak'], assertions: [] }])
    expect(r.axes.find(a => a.axis === 'emotion')).toBeUndefined()  // never show "0% emotion"
    expect(r.emotion).toBeUndefined()
  })

  it('aggregates emotion flags with negative-row denominators and co-occurrence', () => {
    const rows: TaxonomyRow[] = [
      { ...blank(), rating: 1, axis_emotion: ['disappointment', 'churn intent'] },
      { ...blank(), rating: 2, axis_emotion: ['disappointment'] },
      { ...blank(), rating: 2, axis_emotion: ['blame'] },
      { ...blank(), rating: 3 },                                   // negative, no flags
      { ...blank(), rating: 5, axis_emotion: ['churn intent'] },   // positive-row hit: counted separately
      { ...blank(), rating: 5 },
    ]
    const r = aggregateTaxonomy(rows)

    expect(r.axes.find(a => a.axis === 'emotion')?.count).toBe(4)
    const e = r.emotion!
    expect(e.negRows).toBe(4)
    expect(e.posRows).toBe(2)

    const disap = e.flags.find(f => f.sub === 'disappointment')!
    expect(disap.count).toBe(2)
    expect(disap.negCount).toBe(2)
    expect(disap.negRate).toBe(50)         // 2 of 4 negative rows

    const churn = e.flags.find(f => f.sub === 'churn intent')!
    expect(churn.negCount).toBe(1)
    expect(churn.posCount).toBe(1)         // the lift comparison needs both splits

    expect(e.disapChurnCount).toBe(1)      // row 1 carries both
    expect(e.disapChurnNegCount).toBe(1)
  })
})

describe('zero-axis suppression (universal emotion tier)', () => {
  it('emotion-only rows yield ONLY the emotion axis — no empty restaurant cards', () => {
    const rows: TaxonomyRow[] = [
      { ...blank(), rating: 2, axis_emotion: ['disappointment'],
        assertions: [{ axis: 'emotion', sub: 'disappointment', polarity: 'neg' }] },
      { ...blank(), rating: 5 },
    ]
    const r = aggregateTaxonomy(rows)
    expect(r.axes.map(a => a.axis)).toEqual(['emotion'])
    expect(r.emotion).toBeTruthy()
  })
  it('a fired ABSA axis still appears; unfired ones are dropped', () => {
    const r = aggregateTaxonomy([{ ...blank(), axis_product: ['steak'],
      assertions: [{ axis: 'product', sub: 'steak', polarity: 'pos' }] }])
    expect(r.axes.map(a => a.axis)).toEqual(['product'])
  })
  it('rating-less emotion rows still count; negRate degrades to null', () => {
    const r = aggregateTaxonomy([
      { ...blank(), axis_emotion: ['churn intent'],
        assertions: [{ axis: 'emotion', sub: 'churn intent', polarity: 'neg' }] },
    ])
    expect(r.emotion?.flags[0].count).toBe(1)
    expect(r.emotion?.flags[0].negRate).toBeNull()
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
