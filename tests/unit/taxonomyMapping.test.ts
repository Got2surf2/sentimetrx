// lib/taxonomyMapping.ts — the legacy Classification-label → 7-axis projection
// used for audit trail, LLM validation, and cold-start filtering. Pure, so
// this is table-driven over every label family and quarantine bucket the
// mapper knows, plus the row-level aggregator's dedup.
import { describe, it, expect } from 'vitest'
import { canonicalizeLegacyLabel, mapLegacyLabel, mapLegacyLabels } from '@/lib/taxonomyMapping'

const map = (raw: string) => mapLegacyLabel(raw)
// A single-assertion, non-quarantined mapping — the common case.
const one = (raw: string) => { const r = map(raw); expect(r.quarantine).toBeUndefined(); expect(r.assertions).toHaveLength(1); return r.assertions[0] }

describe('canonicalizeLegacyLabel', () => {
  it('lowercases, normalises the delimiter, collapses whitespace, trims trailing punctuation', () => {
    expect(canonicalizeLegacyLabel('Menu-Salads')).toBe('menu - salads')
    expect(canonicalizeLegacyLabel('  SERV -   Manager. ')).toBe('serv - manager')
    expect(canonicalizeLegacyLabel('Food   -  Temp;')).toBe('food - temp')
    expect(canonicalizeLegacyLabel('T-Bone')).toBe('t - bone')
    expect(canonicalizeLegacyLabel('')).toBe('')
  })
})

describe('mapLegacyLabel — quarantine buckets (win over structure)', () => {
  it.each([
    ['TEST', 'system_tags'], ['Brand Alert', 'system_tags'],
    ['Plateware Test', 'campaign_tags'], ['$10 off', 'campaign_tags'], ['Reopen', 'campaign_tags'], ['Generous Pour Wine', 'campaign_tags'],
    ['LH Menu - Salmon', 'competitor_menu'], ['Darden Rewards', 'competitor_menu'],
    ['', '_unmapped'], ['Gibberish Label', '_unmapped'], ['Food', '_unmapped'],
  ])('%s → %s', (raw, bucket) => {
    const r = map(raw)
    expect(r.quarantine).toBe(bucket)
    expect(r.assertions).toEqual([])
    expect(r.raw).toBe(raw)
  })
})

describe('mapLegacyLabel — families', () => {
  it('alerts → attribute with alert severity; unknown alert sub is unmapped', () => {
    expect(one('Alert - Food Safety')).toEqual({ axis: 'attribute', sub: 'food safety', severity: 'alert' })
    expect(one('Alert - Bugs')).toEqual({ axis: 'attribute', sub: 'pests', severity: 'alert' })       // ATTRIBUTE_SUBS bug/bugs → pests
    expect(one('Alert - Rudeness')).toEqual({ axis: 'attribute', sub: 'rude', severity: 'alert' })
    expect(map('Alert - Weather').quarantine).toBe('_unmapped')
  })

  it('service parents: a role resolves to a touchpoint; an attribute yields server + attribute; anything else is server', () => {
    expect(one('SERV - Manager')).toEqual({ axis: 'touchpoint', sub: 'manager', severity: 'normal' })
    expect(one('Serv - Busser Janitor')).toEqual({ axis: 'touchpoint', sub: 'busser', severity: 'normal' })   // combined vendor label → busser
    expect(map('Staff - Friendly').assertions).toEqual([
      { axis: 'touchpoint', sub: 'server', severity: 'normal' },
      { axis: 'attribute', sub: 'friendly', severity: 'normal' },
    ])
    expect(one('Service - Something Vague')).toEqual({ axis: 'touchpoint', sub: 'server', severity: 'normal' })
  })

  it('steak cuts → product steak (+ item when in the closed vocab)', () => {
    expect(one('Steak - Ribeye')).toEqual({ axis: 'product', sub: 'steak', item: 'ribeye', severity: 'normal' })
    expect(one('Steak - All Steak Cuts')).toEqual({ axis: 'product', sub: 'steak', severity: 'normal' })      // mapped to null item → no item
    expect(one('Steak - Wagyu')).toEqual({ axis: 'product', sub: 'steak', severity: 'normal' })               // unknown cut → bare steak
  })

  it('IOR (intent-on-return) → outcome; unknown IOR sub is unmapped', () => {
    expect(one('IOR - Return')).toEqual({ axis: 'outcome', sub: 'return', severity: 'normal' })
    expect(one('IOR - Check in')).toEqual({ axis: 'outcome', sub: 'check-in', severity: 'normal' })
    expect(map('IOR - Nonsense').quarantine).toBe('_unmapped')
  })

  it('context: dayparts, holidays, channels, occasions', () => {
    expect(one('Dayparts - Happy Hour')).toEqual({ axis: 'context', sub: 'happy-hour', severity: 'normal' })
    expect(one('Daypart - Lunch')).toEqual({ axis: 'context', sub: 'lunch', severity: 'normal' })             // singular form matches too
    expect(one('breakfast')).toEqual({ axis: 'context', sub: 'breakfast', severity: 'normal' })
    expect(one('Christmas')).toEqual({ axis: 'context', sub: 'christmas', severity: 'normal' })
    expect(one('To-Go')).toEqual({ axis: 'context', sub: 'to-go', severity: 'normal' })                       // canonicaliser splits the hyphen; CHANNEL_SUBS covers it
    expect(one('Uber-Eats')).toEqual({ axis: 'context', sub: 'uber-eats', severity: 'normal' })
    expect(one('Special Occasions')).toEqual({ axis: 'context', sub: 'special-occasion', severity: 'normal' })
    expect(one('Sporting Event')).toEqual({ axis: 'context', sub: 'sporting-event', severity: 'normal' })
    expect(map('Dayparts - Brunch').quarantine).toBe('_unmapped')
  })

  it('menu family → product (+ item); a food category outside the vocab is unmapped', () => {
    expect(one('Menu - Salads')).toEqual({ axis: 'product', sub: 'salads', severity: 'normal' })
    expect(one('Menu-Apps')).toEqual({ axis: 'product', sub: 'apps', severity: 'normal' })                    // no-space delimiter variant
    expect(one('Menu - Filet')).toEqual({ axis: 'product', sub: 'steak', item: 'filet', severity: 'normal' })
    expect(one('Menu - Salad')).toEqual({ axis: 'product', sub: 'salads', severity: 'normal' })               // singular collapses to plural sub
    expect(map('Menu - Quesadilla').quarantine).toBe('_unmapped')
  })

  it('food - attribute → attribute axis; unknown food sub is unmapped', () => {
    expect(one('Food - Temp')).toEqual({ axis: 'attribute', sub: 'temp', severity: 'normal' })
    expect(one('Food - Flavor')).toEqual({ axis: 'attribute', sub: 'flavor', severity: 'normal' })
    expect(map('Food - Vibes').quarantine).toBe('_unmapped')
  })

  it('ambiance: bare → decor default; sub-labelled → its bucket; unknown → unmapped', () => {
    expect(one('Ambiance')).toEqual({ axis: 'ambiance', sub: 'decor', severity: 'normal' })
    expect(one('Ambiance - Noise')).toEqual({ axis: 'ambiance', sub: 'noise', severity: 'normal' })
    expect(one('Music')).toEqual({ axis: 'ambiance', sub: 'music', severity: 'normal' })                      // bare ambiance label
    expect(map('Ambiance - Feng Shui').quarantine).toBe('_unmapped')
  })

  it('beverage: prefixed or bare → beverage axis; unknown prefixed → unmapped', () => {
    expect(one('Bev - Cocktails')).toEqual({ axis: 'beverage', sub: 'cocktail', severity: 'normal' })
    expect(one('Beverage - Wine List')).toEqual({ axis: 'beverage', sub: 'wine', severity: 'normal' })
    expect(one('Champagne')).toEqual({ axis: 'beverage', sub: 'champagne', severity: 'normal' })              // bare beverage label
    expect(map('Bev - Kombucha').quarantine).toBe('_unmapped')
  })

  it('outcome / value: bare outcome words, Value default, Value - sub, and IOR bare alias', () => {
    expect(one('Loyalty')).toEqual({ axis: 'outcome', sub: 'loyalty', severity: 'normal' })
    expect(one('Value')).toEqual({ axis: 'outcome', sub: 'expensive', severity: 'normal' })                   // coarse legacy default
    expect(one('Value - Affordable')).toEqual({ axis: 'outcome', sub: 'affordable', severity: 'normal' })
    expect(one('Value - Nonsense')).toEqual({ axis: 'outcome', sub: 'expensive', severity: 'normal' })        // unknown value sub → expensive fallback
    expect(one('IOR')).toEqual({ axis: 'outcome', sub: 'return', severity: 'normal' })
  })

  it('bare role, attribute, and ambiance labels (in that resolution order)', () => {
    expect(one('Host')).toEqual({ axis: 'touchpoint', sub: 'host', severity: 'normal' })
    expect(one('Accuracy')).toEqual({ axis: 'attribute', sub: 'accuracy', severity: 'normal' })
    expect(one('Cleanliness')).toEqual({ axis: 'attribute', sub: 'clean', severity: 'normal' })               // clean is in BOTH attribute + ambiance; attribute wins
    expect(one('Odor')).toEqual({ axis: 'ambiance', sub: 'odor', severity: 'normal' })                        // only in ambiance
  })
})

describe('mapLegacyLabels — row aggregation', () => {
  it('aggregates across labels, dedups by (axis, sub, item, severity), and bins each quarantine', () => {
    const r = mapLegacyLabels(['Menu - Salads', 'Menu - Salads', 'SERV - Manager', 'TEST', 'LH Menu - Ribeye', 'Gibberish'])
    expect(r.assertions).toEqual([
      { axis: 'product', sub: 'salads', severity: 'normal' },
      { axis: 'touchpoint', sub: 'manager', severity: 'normal' },
    ])
    expect(r.quarantine.system_tags).toEqual(['test'])
    expect(r.quarantine.competitor_menu).toEqual(['lh menu - ribeye'])
    expect(r.quarantine._unmapped).toEqual(['gibberish'])
    expect(r.quarantine.campaign_tags).toEqual([])
    expect(r.raw).toHaveLength(6)
    expect(r.canonical).toEqual(['menu - salads', 'menu - salads', 'serv - manager', 'test', 'lh menu - ribeye', 'gibberish'])
  })

  it('keeps distinct items on the same sub as separate assertions', () => {
    const r = mapLegacyLabels(['Menu - Filet', 'Steak - Ribeye', 'Steak - Ribeye'])
    expect(r.assertions).toEqual([
      { axis: 'product', sub: 'steak', item: 'filet', severity: 'normal' },
      { axis: 'product', sub: 'steak', item: 'ribeye', severity: 'normal' },
    ])
  })

  it('an empty label list yields no assertions and empty buckets', () => {
    const r = mapLegacyLabels([])
    expect(r.assertions).toEqual([])
    expect(r.quarantine).toEqual({ campaign_tags: [], system_tags: [], competitor_menu: [], _unmapped: [] })
    expect(r.canonical).toEqual([])
  })
})
