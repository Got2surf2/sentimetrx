// tests/unit/recordings/brandGlossary.test.ts
//
// Deterministic merge of brand-catalog entities into a meeting's extracted
// entity map (§3.5c). The fetch side (fetchBrandEntities) hits Supabase and is
// covered by the route/integration layer; here we lock the pure merge rules.

import { describe, it, expect } from 'vitest'
import { mergeBrandEntities } from '@/lib/recordings/brandGlossary'
import type { EntityMapEntry } from '@/lib/recordings/types'

const e = (canonical: string, variants: string[], mentions = 1, type: EntityMapEntry['type'] = 'org'): EntityMapEntry =>
  ({ canonical, variants, type, mentions })

describe('mergeBrandEntities', () => {
  it('brand canonical + type win on a slug match; variants union', () => {
    const brand = [e('NOWOCATS', ['NOWOCATS', 'No What Cats'], 1, 'org')]
    const extracted = [e('Nowocats', ['Nowocats', 'Now-o-cats'], 5, 'term')]
    const out = mergeBrandEntities(extracted, brand)
    expect(out).toHaveLength(1)
    expect(out[0].canonical).toBe('NOWOCATS')      // brand spelling wins
    expect(out[0].type).toBe('org')                // brand type wins
    expect(out[0].mentions).toBe(5)                 // takes the meeting's higher count
    // unioned variants, case-insensitively de-duped
    expect(out[0].variants).toEqual(expect.arrayContaining(['NOWOCATS', 'No What Cats', 'Now-o-cats']))
    expect(out[0].variants.filter(v => v.toLowerCase() === 'nowocats')).toHaveLength(1)
  })

  it('keeps meeting-only entities the brand catalog does not have', () => {
    const out = mergeBrandEntities([e('Tom Becker', ['Tom Becker'], 3, 'person')], [e('NOWOCATS', ['NOWOCATS'])])
    expect(out.map(x => x.canonical).sort()).toEqual(['NOWOCATS', 'Tom Becker'])
  })

  it('seeds brand entities not mentioned in the meeting', () => {
    const out = mergeBrandEntities([], [e('Kelly Park Road', ['Kelly Park Road', 'Kelly Parke Road'], 1, 'place')])
    expect(out).toHaveLength(1)
    expect(out[0].canonical).toBe('Kelly Park Road')
    expect(out[0].variants).toContain('Kelly Parke Road')
  })

  it('returns [] for two empty inputs and sorts by mentions desc', () => {
    expect(mergeBrandEntities([], [])).toEqual([])
    const out = mergeBrandEntities([e('A', ['A'], 2), e('B', ['B'], 9)], [])
    expect(out.map(x => x.canonical)).toEqual(['B', 'A'])
  })
})
