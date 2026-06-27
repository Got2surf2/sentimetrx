// tests/unit/correction/rollup.test.ts
//
// Shared brand-correction layer, Phase 3 (bot→brand rollup). The DB-touching
// resolve/upsert is exercised at the route layer; here we lock the pure merge
// rules in mergeBotEntitiesIntoBrand: additive union, never trample a
// hand-curated or hidden brand row, first-canonical-wins, sample_count
// accumulates.

import { describe, it, expect } from 'vitest'
import { mergeBotEntitiesIntoBrand, type CatalogEntity } from '@/lib/correction/rollup'

const NOW = '2026-06-27T00:00:00.000Z'
const COL = 'col-1'

const ent = (canonical: string, over: Partial<CatalogEntity> = {}): CatalogEntity => ({
  canonical,
  slug: over.slug ?? canonical.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  category: over.category ?? 'organization',
  aliases: over.aliases ?? [],
  sample_count: over.sample_count ?? 1,
  source: over.source ?? 'discovered',
  hidden: over.hidden ?? false,
  provenance: over.provenance,
})

describe('mergeBotEntitiesIntoBrand', () => {
  it('seeds a brand row from a bot entity not yet in the brand catalog', () => {
    const out = mergeBotEntitiesIntoBrand(COL, [], [ent('NOWOCATS', { aliases: ['No What Cats'], sample_count: 5 })], NOW)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ scope_type: 'collection', scope_id: COL, canonical: 'NOWOCATS', slug: 'nowocats', sample_count: 5, source: 'discovered', hidden: false })
    expect(out[0].aliases).toContain('No What Cats')
    // bot canonical equals brand canonical → not folded in as a redundant alias
    expect(out[0].aliases.map(a => a.toLowerCase())).not.toContain('nowocats')
  })

  it('an authoritative bot entity (document) corrects a UGC-owned brand canonical', () => {
    // a brand row whose canonical came from review-text discovery
    const brand = [ent('No What Cats', { slug: 'nowocats', source: 'review', sample_count: 9 })]
    const bot = [ent('NOWOCATS', { slug: 'nowocats', source: 'document', sample_count: 2 })]
    const out = mergeBotEntitiesIntoBrand(COL, brand, bot, NOW)
    expect(out[0].canonical).toBe('NOWOCATS')   // official spelling wins
    expect(out[0].source).toBe('document')
    expect(out[0].aliases.map(a => a.toLowerCase())).toContain('no what cats')  // UGC surface demoted to alias
  })

  it('a UGC-owned brand canonical is NOT overwritten by a lower bot authority', () => {
    const brand = [ent('Official Name', { slug: 'x', source: 'document' })]
    const bot = [ent('offishul name', { slug: 'x', source: 'discovered' })]
    const out = mergeBotEntitiesIntoBrand(COL, brand, bot, NOW)
    expect(out[0].canonical).toBe('Official Name')
    expect(out[0].source).toBe('document')
  })

  it('merges provenance trails from bot into brand', () => {
    const brand = [ent('US 441', { slug: 'us-441', source: 'document', provenance: { document: { count: 1, refs: [] } } })]
    const bot = [ent('US 441', { slug: 'us-441', source: 'crawl', provenance: { crawl: { count: 2, refs: [{ url: 'https://x' }] } } })]
    const out = mergeBotEntitiesIntoBrand(COL, brand, bot, NOW)
    expect(out[0].provenance.document.count).toBe(1)
    expect(out[0].provenance.crawl.count).toBe(2)
    expect(out[0].provenance.crawl.refs).toEqual([{ url: 'https://x' }])
  })

  it('first canonical/category wins; aliases union; sample_count accumulates', () => {
    const brand = [ent('Kelly Park Road', { category: 'place', aliases: ['Kelly Parke Road'], sample_count: 3 })]
    const bot = [ent('Kelly Park Rd', { slug: 'kelly-park-road', category: 'other', aliases: ['Kelley Park Road'], sample_count: 4 })]
    const out = mergeBotEntitiesIntoBrand(COL, brand, bot, NOW)
    expect(out).toHaveLength(1)
    expect(out[0].canonical).toBe('Kelly Park Road')   // brand canonical kept
    expect(out[0].category).toBe('place')               // brand category kept
    expect(out[0].sample_count).toBe(7)                 // 3 + 4
    // the bot's differing canonical is folded in as a brand alias
    expect(out[0].aliases).toEqual(expect.arrayContaining(['Kelly Parke Road', 'Kelley Park Road', 'Kelly Park Rd']))
  })

  it('never overwrites a hand-curated (manual) brand row', () => {
    const brand = [ent('Orange County', { source: 'manual' })]
    const bot = [ent('Orange Cnty', { slug: 'orange-county' })]
    expect(mergeBotEntitiesIntoBrand(COL, brand, bot, NOW)).toEqual([])
  })

  it('never resurfaces a hidden (soft-deleted) brand row', () => {
    const brand = [ent('Noise Term', { hidden: true })]
    const bot = [ent('Noise Term')]
    expect(mergeBotEntitiesIntoBrand(COL, brand, bot, NOW)).toEqual([])
  })

  it('skips bot entities with no slug', () => {
    const out = mergeBotEntitiesIntoBrand(COL, [], [ent('', { slug: '' })], NOW)
    expect(out).toEqual([])
  })

  it('stamps last_seen_at and the collection scope on every row', () => {
    const out = mergeBotEntitiesIntoBrand(COL, [], [ent('US 441')], NOW)
    expect(out[0].last_seen_at).toBe(NOW)
    expect(out[0].scope_type).toBe('collection')
    expect(out[0].scope_id).toBe(COL)
  })
})
