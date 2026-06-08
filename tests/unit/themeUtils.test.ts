import { describe, it, expect } from 'vitest'
import {
  lexiconScore, classifySentiment, buildKwRegex, commentMatchesTheme,
  sampleSize95, evenSample, highlightKeywords,
  sentColor, sentBg, ratingColor, ratingBg, getThemeColor, getRowText,
  THEME_PALETTE,
  type Theme,
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
