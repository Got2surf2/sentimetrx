import { describe, it, expect } from 'vitest'
import {
  lexiconScore, classifySentiment, buildKwRegex, commentMatchesTheme,
  sampleSize95, evenSample, highlightKeywords,
  sentColor, sentBg, ratingColor, ratingBg, getThemeColor, getRowText,
  THEME_PALETTE,
  themeFieldKey, themeModelKey, stripFieldEntries, themeFieldEntries, mergeThemeModelWrite, themeSetsForExport,
  type Theme, type ThemeModel,
} from '@/lib/themeUtils'

const theme = (keywords: string[]): Theme => ({
  id: 't', name: 'T', description: '', keywords, sentiment: 'neutral',
  count: 0, percentage: 0, relatedThemes: [],
})

describe('themeUtils — lexicon sentiment', () => {
  it('scores positive and negative words', () => {
    expect(lexiconScore('good great').pos).toBeGreaterThan(0)
    expect(lexiconScore('bad terrible').neg).toBeGreaterThan(0)
  })

  it('flips polarity under a preceding negator', () => {
    const s = lexiconScore('not good')
    expect(s.neg).toBeGreaterThanOrEqual(1)
    expect(s.pos).toBe(0)
  })

  it('classifySentiment buckets by positive ratio with a minimum sample', () => {
    expect(classifySentiment(8, 2)).toBe('positive')
    expect(classifySentiment(2, 8)).toBe('negative')
    expect(classifySentiment(5, 5)).toBe('mixed')
    expect(classifySentiment(1, 1)).toBe('insufficient')   // total < 5
  })
})

describe('themeUtils — keyword matching', () => {
  it('buildKwRegex matches the keyword and its suffixed forms', () => {
    const re = buildKwRegex('wait')
    expect(re.test('we had to wait forever')).toBe(true)
    expect(re.test('still waiting')).toBe(true)
    expect(re.test('completely unrelated')).toBe(false)
  })

  it('commentMatchesTheme returns true on any keyword hit', () => {
    const t = theme(['wait', 'slow'])
    expect(commentMatchesTheme('the service was slow', t)).toBe(true)
    expect(commentMatchesTheme('great food, fast service', t)).toBe(false)
    expect(commentMatchesTheme('anything', theme([]))).toBe(false)
  })

  it('highlightKeywords preserves the full text and marks matches', () => {
    const parts = highlightKeywords('the food was great', ['food'])
    expect(parts.map(p => p.text).join('')).toBe('the food was great')
    expect(parts.some(p => p.matched && /food/.test(p.text))).toBe(true)
    // no keywords → single unmatched segment
    expect(highlightKeywords('abc', [])).toEqual([{ text: 'abc', matched: false }])
  })
})

describe('themeUtils — sampling helpers', () => {
  it('sampleSize95 returns n below the cap and converges to ~384 above it', () => {
    expect(sampleSize95(100)).toBe(100)
    const big = sampleSize95(1_000_000)
    expect(big).toBeGreaterThan(380)
    expect(big).toBeLessThanOrEqual(385)   // converges to ⌈n0⌉ ≈ 385
  })

  it('evenSample spreads picks across the array', () => {
    expect(evenSample([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5)).toEqual([1, 3, 5, 7, 9])
    expect(evenSample([1, 2, 3], 5)).toEqual([1, 2, 3]) // shorter than n → unchanged
  })
})

describe('themeUtils — display helpers', () => {
  it('sentColor / sentBg map known sentiments and fall back', () => {
    expect(sentColor('positive')).toBe('#16a34a')
    expect(sentColor('whatever')).toBe('#6b7280')
    expect(sentBg('negative')).toBe('#fef2f2')
    expect(sentBg('whatever')).toBe('#f9fafb')
  })

  it('ratingColor ramps red→green across the 0..1 range', () => {
    expect(ratingColor(0)).toBe('rgb(220,80,40)')
    expect(ratingColor(1)).toBe('rgb(40,200,40)')
    expect(ratingBg(1)).toBe('rgb(40,200,40)15')
  })

  it('getThemeColor wraps the palette modulo its length', () => {
    expect(getThemeColor(0)).toBe(THEME_PALETTE[0])
    expect(getThemeColor(THEME_PALETTE.length)).toBe(THEME_PALETTE[0])
  })

  it('getRowText joins fields and trims, coercing nullish to empty', () => {
    expect(getRowText({ a: 'hello', b: 'world', c: null }, ['a', 'b', 'c'])).toBe('hello world')
    expect(getRowText({}, ['x'])).toBe('')
  })
})

// ── Per-field theme sets (2026-07-11) ──────────────────────────────────────
const model = (fieldName: string, names: string[], extra?: Partial<ThemeModel>): ThemeModel => ({
  themes: names.map((n, i) => ({
    id: 't' + (i + 1), name: n, description: '', keywords: [n.toLowerCase()],
    sentiment: 'neutral', count: 0, percentage: 0, relatedThemes: [],
  })),
  summary: 's', fieldName, ...extra,
})

describe('themeUtils — per-field theme sets', () => {
  it('themeFieldKey matches the taxonomy convention: sorted " + " join, single field unchanged', () => {
    expect(themeFieldKey(['liked_most'])).toBe('liked_most')
    expect(themeFieldKey(['b_field', 'a_field'])).toBe('a_field + b_field')
    expect(themeFieldKey([])).toBe('')
  })

  it('themeModelKey prefers fieldNames over fieldName and is "" when unbound', () => {
    expect(themeModelKey(model('a', ['X']))).toBe('a')
    expect(themeModelKey({ fieldName: 'a', fieldNames: ['b', 'a'] })).toBe('a + b')
    expect(themeModelKey({ fieldName: '' })).toBe('')
    expect(themeModelKey(null)).toBe('')
  })

  it('themeFieldEntries legacy-wraps a pre-map blob as one entry under its own key', () => {
    const legacy = model('liked_most', ['Food'])
    expect(themeFieldEntries(legacy)).toEqual({ liked_most: legacy })
  })

  it('themeFieldEntries: top level wins over a stale map entry for the same key', () => {
    const stale = model('a', ['Old'])
    const fresh = model('a', ['New'], { fields: { a: stale } })
    expect(themeFieldEntries(fresh).a.themes[0].name).toBe('New')
  })

  it('themeFieldEntries skips empty top levels and malformed entries, and strips nesting', () => {
    const inner = model('b', ['B'], { fields: { b: model('b', ['nested']) } })
    const tm = model('a', [], { fields: { b: inner, junk: { no: 'themes' } as unknown as ThemeModel } })
    const entries = themeFieldEntries(tm)
    expect(Object.keys(entries)).toEqual(['b'])
    expect(entries.b.fields).toBeUndefined()
  })

  it('mergeThemeModelWrite: mining a second field keeps the first field\'s set', () => {
    const stored = model('liked_most', ['Food'])                     // legacy blob
    const incoming = model('liked_least', ['Wait'])
    const merged = mergeThemeModelWrite(incoming, stored)
    expect(merged.fieldName).toBe('liked_least')                     // top = active
    expect(merged.themes[0].name).toBe('Wait')
    expect(merged.fields!.liked_most.themes[0].name).toBe('Food')    // other set kept
    expect(merged.fields!.liked_least.themes[0].name).toBe('Wait')   // mirrored
  })

  it('mergeThemeModelWrite: re-saving the same field overwrites only that entry', () => {
    const stored = mergeThemeModelWrite(model('b', ['Old B']), model('a', ['A']))
    const merged = mergeThemeModelWrite(model('b', ['New B']), stored)
    expect(merged.fields!.b.themes[0].name).toBe('New B')
    expect(merged.fields!.a.themes[0].name).toBe('A')
  })

  it('mergeThemeModelWrite: a keyless incoming write keeps existing entries', () => {
    const stored = mergeThemeModelWrite(model('a', ['A']), null)
    const merged = mergeThemeModelWrite({ themes: [], summary: '', fieldName: '' }, stored)
    expect(merged.fields!.a.themes[0].name).toBe('A')
    expect(merged.themes).toEqual([])
  })

  it('mergeThemeModelWrite: no entries on either side stays a plain blob (no empty map)', () => {
    const merged = mergeThemeModelWrite({ themes: [], summary: '', fieldName: '' }, null)
    expect(merged.fields).toBeUndefined()
  })

  it('stripFieldEntries removes only the map', () => {
    const tm = model('a', ['A'], { fields: { a: model('a', ['A']) } })
    const stripped = stripFieldEntries(tm)
    expect(stripped.fields).toBeUndefined()
    expect(stripped.themes.length).toBe(1)
  })
})

describe('themeUtils — themeSetsForExport', () => {
  it('legacy single blob → one set bound to its own field', () => {
    const sets = themeSetsForExport(model('liked_most', ['Food']))
    expect(sets.length).toBe(1)
    expect(sets[0].key).toBe('liked_most')
    expect(sets[0].fields).toEqual(['liked_most'])
    expect(sets[0].model.themes[0].name).toBe('Food')
  })

  it('active set first, then the other stored sets', () => {
    const stored = mergeThemeModelWrite(model('liked_least', ['Wait']), model('liked_most', ['Food']))
    const sets = themeSetsForExport(stored)
    expect(sets.map(s => s.key)).toEqual(['liked_least', 'liked_most'])
    expect(sets[0].model.themes[0].name).toBe('Wait')
    expect(sets[1].model.themes[0].name).toBe('Food')
  })

  it('combined-selection entries expose their member fields', () => {
    const combo = model('a', ['C'], { fieldNames: ['b', 'a'] })
    const sets = themeSetsForExport(mergeThemeModelWrite(combo, model('a', ['A'])))
    const comboSet = sets.find(s => s.key === 'a + b')
    expect(comboSet!.fields).toEqual(['b', 'a'])
  })

  it('keyless legacy blob → no sets (exporters read its top level directly)', () => {
    expect(themeSetsForExport({ themes: [{ id: 't1', name: 'X', description: '', keywords: ['x'], sentiment: 'neutral', count: 0, percentage: 0, relatedThemes: [] }], summary: '', fieldName: '' })).toEqual([])
    expect(themeSetsForExport(null)).toEqual([])
  })
})
