import { describe, it, expect } from 'vitest'
import { themeCountsKey, readThemeCountsCache, type ThemeCountsPayload } from '@/lib/themeCountsCache'

// The theme-counts server cache turns a 33s cold request (three 10-page keyset
// scans over the 50K sample, measured on the 128,619-row Outback dataset) into
// a single state read. That only holds if the key is exact in both directions:
// it must MISS whenever the numbers could have moved, and it must HIT on the
// cosmetic churn that used to force a full recompute.

const THEMES = [
  { id: 'food', keywords: ['cold', 'overcooked'] },
  { id: 'service', keywords: ['slow', 'rude'] },
]
const FIELDS = ['What, if anything, did you like LEAST about your recent experience?']
const BASE = { themes: THEMES, fields: FIELDS, cooccurrence: true, dimensions: true }

const PAYLOAD: ThemeCountsPayload = {
  counts: [{ id: 'food', count: 1962, percentage: 31 }, { id: 'service', count: 784, percentage: 12 }],
  totalNonEmpty: 6269,
  sampled: true,
  sampleSize: 50000,
}

function blobWith(key: string, rowCount: number, payload = PAYLOAD, v = 2) {  // v2 = sql/191 block sample
  return { theme_counts: { [key]: { payload, row_count: rowCount, computed_at: '2026-08-14T00:00:00.000Z', v } } }
}

describe('themeCountsKey', () => {
  it('is stable across a cosmetic reorder of themes and keywords', () => {
    const reordered = {
      ...BASE,
      themes: [
        { id: 'service', keywords: ['rude', 'slow'] },
        { id: 'food', keywords: ['overcooked', 'cold'] },
      ],
    }
    expect(themeCountsKey(reordered)).toBe(themeCountsKey(BASE))
  })

  it('is case-insensitive on keywords (the matcher lowercases anyway)', () => {
    const upper = { ...BASE, themes: [{ id: 'food', keywords: ['COLD', 'Overcooked'] }, THEMES[1]] }
    expect(themeCountsKey(upper)).toBe(themeCountsKey(BASE))
  })

  it('changes when a keyword is added — the counts would move', () => {
    const edited = { ...BASE, themes: [{ id: 'food', keywords: ['cold', 'overcooked', 'burnt'] }, THEMES[1]] }
    expect(themeCountsKey(edited)).not.toBe(themeCountsKey(BASE))
  })

  it('changes when a theme is removed', () => {
    expect(themeCountsKey({ ...BASE, themes: [THEMES[0]] })).not.toBe(themeCountsKey(BASE))
  })

  it('changes when the scanned fields change', () => {
    expect(themeCountsKey({ ...BASE, fields: ['some other question'] })).not.toBe(themeCountsKey(BASE))
  })

  it('changes with each extras flag — they each add a section to the payload', () => {
    expect(themeCountsKey({ ...BASE, dimensions: false })).not.toBe(themeCountsKey(BASE))
    expect(themeCountsKey({ ...BASE, cooccurrence: false })).not.toBe(themeCountsKey(BASE))
    expect(themeCountsKey({ ...BASE, topical: true })).not.toBe(themeCountsKey(BASE))
  })
})

describe('readThemeCountsCache', () => {
  const key = themeCountsKey(BASE)

  it('returns the cached payload on an exact match', () => {
    expect(readThemeCountsCache(blobWith(key, 128619), key, 128619)).toEqual(PAYLOAD)
  })

  it('misses when the row count moved — a sync added or removed rows', () => {
    expect(readThemeCountsCache(blobWith(key, 128619), key, 130000)).toBeNull()
  })

  it('misses on an entry written by an older payload version', () => {
    expect(readThemeCountsCache(blobWith(key, 128619, PAYLOAD, 0), key, 128619)).toBeNull()
  })

  it('misses on a malformed entry rather than serving a broken payload', () => {
    const bad = { theme_counts: { [key]: { payload: { totalNonEmpty: 5 }, row_count: 128619, computed_at: 'x', v: 2 } } }
    expect(readThemeCountsCache(bad, key, 128619)).toBeNull()
  })

  it('misses cleanly when analytics is absent or has no slots', () => {
    expect(readThemeCountsCache(null, key, 128619)).toBeNull()
    expect(readThemeCountsCache({}, key, 128619)).toBeNull()
    expect(readThemeCountsCache({ signal_stats: {} }, key, 128619)).toBeNull()
  })

  it('does not serve one request shape to another', () => {
    const otherKey = themeCountsKey({ ...BASE, dimensions: false })
    expect(readThemeCountsCache(blobWith(key, 128619), otherKey, 128619)).toBeNull()
  })
})
