// tests/unit/consensusMining.test.ts
// Stratified + consensus theme mining (lib/consensusMining).
// Pins the two properties the 2026-09-03 EA Football failure demands:
//  1. the mining sample is representative BY CONSTRUCTION (stratified,
//     proportional, deterministic, disjoint across runs), and
//  2. only themes stable across independent runs survive, with honest
//     stability metrics attached.

import { describe, it, expect } from 'vitest'
import {
  ratingBuckets, stratumKeys, stratifiedDisjointSamples, compositionNote,
  keywordJaccard, themeSimilarity, consensusThemes,
} from '@/lib/consensusMining'
import type { MinedTheme } from '@/lib/themeMining'

describe('ratingBuckets', () => {
  it('keeps each raw value as its own bucket when ≤6 distinct (stars, yes/no)', () => {
    expect(ratingBuckets(['5', '1', '5', 'yes', null])).toEqual(['v:5', 'v:1', 'v:5', 'v:yes', 'none'])
  })

  it('falls back to low/mid/high thirds for many-valued numeric scales', () => {
    const vals = Array.from({ length: 11 }, (_, i) => i) // NPS 0..10
    const b = ratingBuckets(vals)
    expect(b[0]).toBe('low')
    expect(b[5]).toBe('mid')
    expect(b[10]).toBe('high')
  })

  it('marks unparseable values none in numeric mode', () => {
    const b = ratingBuckets([0, 1, 2, 3, 4, 5, 6, 'n/a'])
    expect(b[7]).toBe('none')
  })
})

describe('stratifiedDisjointSamples', () => {
  // 80% negative / 20% positive corpus — the EA failure shape.
  const buckets = Array.from({ length: 1000 }, (_, i) => (i % 5 === 0 ? 'v:5' : 'v:1'))

  it('is proportional: each run mirrors the corpus mix instead of drawing it by luck', () => {
    const runs = stratifiedDisjointSamples(buckets, 100, 3)
    for (const run of runs) {
      const pos = run.filter(i => buckets[i] === 'v:5').length
      expect(run.length).toBeGreaterThanOrEqual(95)
      expect(pos).toBeGreaterThanOrEqual(18)
      expect(pos).toBeLessThanOrEqual(22)
    }
  })

  it('is disjoint across runs and deterministic', () => {
    const a = stratifiedDisjointSamples(buckets, 100, 3)
    const b = stratifiedDisjointSamples(buckets, 100, 3)
    expect(a).toEqual(b)
    const seen = new Set<number>()
    for (const run of a) for (const i of run) {
      expect(seen.has(i)).toBe(false)
      seen.add(i)
    }
  })

  it('never fabricates rows when a stratum is too small for k disjoint draws', () => {
    const tiny = ['v:5', 'v:5', 'v:1', 'v:1', 'v:1', 'v:1', 'v:1', 'v:1', 'v:1', 'v:1']
    const runs = stratifiedDisjointSamples(tiny, 4, 3)
    const seen = new Set<number>()
    for (const run of runs) for (const i of run) {
      expect(seen.has(i)).toBe(false)
      seen.add(i)
    }
    expect(seen.size).toBeLessThanOrEqual(tiny.length)
  })

  it('stratumKeys adds a time-quartile axis over input order', () => {
    const keys = stratumKeys(['1', '1', '1', '1'], 4)
    expect(keys).toEqual(['v:1|q0', 'v:1|q1', 'v:1|q2', 'v:1|q3'])
  })
})

describe('compositionNote', () => {
  it('summarizes the mix and instructs against tone collapse', () => {
    const note = compositionNote(['1', '1', '1', '5'], 'rating')
    expect(note).toContain('75% "1"')
    expect(note).toContain('25% "5"')
    expect(note).toContain('minority sentiment')
    expect(note).toContain('EACH side')
  })

  it('returns null when there is only one bucket (nothing to stratify)', () => {
    expect(compositionNote(['5', '5', '5'], 'rating')).toBeNull()
  })
})

// ── Consensus ───────────────────────────────────────────────────────────────

function t(name: string, keywords: string[], sentiment = 'negative'): MinedTheme {
  return { id: name, name, keywords, sentiment }
}

const RUN_A: MinedTheme[] = [
  t('Technical Performance', ['crash', 'freeze', 'lag', 'stutter']),
  t('Microtransactions', ['microtransactions', 'pay to win', 'ultimate team']),
  t('Great Gameplay Feel', ['fun', 'smooth gameplay', 'love'], 'positive'),
]
const RUN_B: MinedTheme[] = [
  t('Stability Issues', ['crashes', 'freezing', 'bugs', 'lagging']),
  t('Pay-to-Win Monetization', ['pay to win', 'card packs', 'microtransaction']),
  t('Fun On-Field Play', ['fun', 'smooth', 'enjoying'], 'positive'),
]
const RUN_C: MinedTheme[] = [
  t('Crashes & Bugs', ['crash', 'bug', 'freeze']),
  t('Monetization Complaints', ['microtransactions', 'pay to win', 'greed']),
  t('Server Downtime', ['servers down', 'outage', 'disconnect']),
]

describe('consensusThemes', () => {
  it('keeps themes recurring across runs and drops single-run noise', () => {
    const res = consensusThemes([RUN_A, RUN_B, RUN_C])
    expect(res.minSupport).toBe(2)
    const names = res.themes.map(x => x.name)
    expect(names.join(' ')).toMatch(/Technical Performance|Stability|Crashes/)
    expect(names.join(' ')).toMatch(/Microtransactions|Monetization|Pay-to-Win/)
    // The positive theme appears in 2 of 3 runs → it MUST survive (the EA bug).
    const positive = res.themes.find(x => x.sentiment === 'positive')
    expect(positive).toBeTruthy()
    expect(positive!.stability.support).toBe(2)
    // Server Downtime appeared once → dropped, and reported as such.
    expect(res.themes.find(x => /Server/.test(x.name))).toBeUndefined()
    expect(res.dropped.some(d => /Server/.test(d.name) && d.support === 1)).toBe(true)
  })

  it('attaches honest stability metrics', () => {
    const res = consensusThemes([RUN_A, RUN_B, RUN_C])
    const perf = res.themes.find(x => /Performance|Stability|Crash/.test(x.name))!
    expect(perf.stability.runs).toBe(3)
    expect(perf.stability.support).toBe(3)
    expect(perf.stability.kwAgreement).toBeGreaterThan(0)
    expect(perf.stability.kwAgreement).toBeLessThanOrEqual(100)
  })

  it('merges keywords by cross-run votes without duplicating stem-equivalents', () => {
    const res = consensusThemes([RUN_A, RUN_B, RUN_C])
    const perf = res.themes.find(x => /Performance|Stability|Crash/.test(x.name))!
    const crashLike = perf.keywords.filter(k => /^crash/i.test(k))
    expect(crashLike.length).toBe(1) // 'crash' and 'crashes' are matcher-equivalent
    expect(perf.keywords.length).toBeLessThanOrEqual(15)
  })

  it('sentiment is decided by majority', () => {
    const res = consensusThemes([
      [t('Value', ['price', 'expensive'], 'negative')],
      [t('Value for Money', ['price', 'cost'], 'mixed')],
      [t('Pricing Value', ['price', 'pricey'], 'negative')],
    ], 2)
    expect(res.themes[0].sentiment).toBe('negative')
  })

  it('total disagreement yields zero consensus themes (caller falls back to a single run)', () => {
    const res = consensusThemes([
      [t('Alpha', ['aardvark', 'abacus'])],
      [t('Beta', ['banjo', 'bugle'])],
      [t('Gamma', ['gizmo', 'gargoyle'])],
    ])
    expect(res.themes.length).toBe(0)
    expect(res.dropped.length).toBe(3)
  })
})

describe('similarity primitives', () => {
  it('keywordJaccard uses the real matcher for equivalence', () => {
    expect(keywordJaccard(['freeze'], ['freezing'])).toBe(1)
    expect(keywordJaccard(['crash'], ['banjo'])).toBe(0)
  })

  it('themeSimilarity lets the strongest signal decide', () => {
    const high = themeSimilarity(t('Crashes', ['crash', 'freeze']), t('Crashing Issues', ['crashes', 'freezing']))
    const low = themeSimilarity(t('Crashes', ['crash', 'freeze']), t('Pricing', ['price', 'cost']))
    expect(high).toBeGreaterThan(0.5)
    expect(low).toBeLessThan(0.1)
  })

  it('description vocabulary rescues a match when runs picked different keyword flavors', () => {
    // The measured TEST EA Football failure: both runs found the crash theme,
    // but with nearly disjoint keywords — the shared description vocabulary
    // must carry the match over the clustering threshold (0.25).
    const a: MinedTheme = { id: 'a', name: 'Technical Performance & Stability', keywords: ['crash', 'freeze', 'bug'], sentiment: 'negative', description: 'Widespread crashes, freezing, and game-breaking bugs make the game unplayable, particularly on PC.' }
    const b: MinedTheme = { id: 'b', name: 'Poor Optimization', keywords: ['lag', 'stutter', 'fps'], sentiment: 'negative', description: 'Players report crashes, freezing, stuttering and bugs that make the game unplayable on PC.' }
    expect(themeSimilarity(a, b)).toBeGreaterThanOrEqual(0.25)
    const res = consensusThemes([[a], [b]], 2)
    expect(res.themes.length).toBe(1)
    expect(res.themes[0].stability.support).toBe(2)
  })
})
