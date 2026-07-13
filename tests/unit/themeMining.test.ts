import { describe, it, expect } from 'vitest'
import {
  scanThemes, pruneDeadKeywords, deficientThemes,
  mergeKeywordAdditions, applyMeasuredCoverage, buildRefinePrompt,
  type MinedTheme,
} from '@/lib/themeMining'

const mk = (id: string, keywords: string[], percentage = 0): MinedTheme =>
  ({ id, name: id.toUpperCase(), keywords, percentage })

const TEXTS = [
  'the chicken was overcooked and dry',
  'our server was slow and forgot the bread',
  'overcooked pasta, really disappointing',
  'nothing to complain about',
  'the portion was tiny for the price',
]

describe('themeMining — scanThemes', () => {
  it('counts matched comments per theme and collects unmatched', () => {
    const themes = [mk('t1', ['overcooked', 'dry']), mk('t2', ['portion size'])]
    const scan = scanThemes(TEXTS, themes)
    expect(scan.perTheme[0]).toBe(2)           // rows 0 and 2
    expect(scan.perTheme[1]).toBe(0)           // "portion size" ≠ "portion was tiny"
    expect(scan.union).toBe(2)
    expect(scan.unmatched).toHaveLength(3)
    expect(scan.kwCounts[0]['overcooked']).toBe(2)
    expect(scan.kwCounts[0]['dry']).toBe(1)
  })
})

describe('themeMining — pruneDeadKeywords', () => {
  it('drops zero-hit keywords but keeps at least minKeep', () => {
    const themes = [mk('t1', ['overcooked', 'dry', 'rubbery', 'tasteless', 'burnt'])]
    const scan = scanThemes(TEXTS, themes)
    const pruned = pruneDeadKeywords(themes, scan)
    expect(pruned[0].keywords).toContain('overcooked')
    expect(pruned[0].keywords).toContain('dry')
    // dead ones pruned, but never below minKeep=3
    expect(pruned[0].keywords.length).toBe(3)
    expect(pruned[0].keywords[0]).toBe('overcooked') // best signal kept first when backfilling
  })

  it('keeps all live keywords when more than minKeep are alive', () => {
    const themes = [mk('t1', ['overcooked', 'dry', 'slow', 'portion', 'nonexistentword'])]
    const scan = scanThemes(TEXTS, themes)
    const pruned = pruneDeadKeywords(themes, scan)
    expect(pruned[0].keywords).toEqual(['overcooked', 'dry', 'slow', 'portion'])
  })
})

describe('themeMining — deficientThemes', () => {
  it('flags themes whose scan coverage is under 60% of the AI estimate', () => {
    const themes = [
      mk('good', ['overcooked'], 40),  // scan 2/5 = 40% ≥ 0.6*40=24 → fine
      mk('bad', ['portion size'], 20), // scan 0% < 12 → deficient
      mk('tiny', ['whatever'], 2),     // estimate <3% → ignored
    ]
    const scan = scanThemes(TEXTS, themes)
    const d = deficientThemes(themes, scan, TEXTS.length)
    expect(d.map(x => x.theme.id)).toEqual(['bad'])
    expect(d[0].estimatePct).toBe(20)
  })
})

describe('themeMining — mergeKeywordAdditions', () => {
  it('dedups case-insensitively and caps the list', () => {
    const themes = [mk('t1', ['overcooked', 'dry'])]
    const merged = mergeKeywordAdditions(themes, [{ id: 't1', keywords: ['Dry', 'tiny', 'price'] }])
    expect(merged[0].keywords).toEqual(['overcooked', 'dry', 'tiny', 'price'])
    const capped = mergeKeywordAdditions(
      [mk('t1', Array.from({ length: 24 }, (_v, i) => 'kw' + i))],
      [{ id: 't1', keywords: ['a', 'b', 'c'] }],
    )
    expect(capped[0].keywords).toHaveLength(25)
  })

  it('leaves themes without additions untouched', () => {
    const themes = [mk('t1', ['x']), mk('t2', ['y'])]
    const merged = mergeKeywordAdditions(themes, [{ id: 't2', keywords: ['z'] }])
    expect(merged[0].keywords).toEqual(['x'])
    expect(merged[1].keywords).toEqual(['y', 'z'])
  })
})

describe('themeMining — applyMeasuredCoverage', () => {
  it('restates count/percentage from the scan, one decimal', () => {
    const themes = [mk('t1', ['overcooked'], 99)]
    const scan = scanThemes(TEXTS, themes)
    const out = applyMeasuredCoverage(themes, scan, TEXTS.length)
    expect(out[0].count).toBe(2)
    expect(out[0].percentage).toBe(40)
  })
})

describe('themeMining — buildRefinePrompt', () => {
  it('names each deficient theme with its gap and includes unmatched texts', () => {
    const p = buildRefinePrompt(
      [{ theme: mk('t1', ['portion size'], 20), scanPct: 1.5, estimatePct: 20 }],
      ['the portion was tiny for the price'],
    )
    expect(p).toContain('t1')
    expect(p).toContain('20%')
    expect(p).toContain('1.5%')
    expect(p).toContain('portion was tiny')
    expect(p).toContain('"additions"')
  })
})
