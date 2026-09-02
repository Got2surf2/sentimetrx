// Inline-chart block parsing for Ana's answers: valid bar/line specs parse
// with caps enforced, malformed JSON degrades to visible text (never a broken
// bubble), and an unterminated fence mid-stream yields a pending placeholder.
import { describe, it, expect } from 'vitest'
import { parseAnaChartSpec, splitAnaSegments } from '@/lib/anaChartSpec'

describe('parseAnaChartSpec', () => {
  it('parses a valid bar spec and caps rows at 12', () => {
    const spec = parseAnaChartSpec(JSON.stringify({
      type: 'bar', title: 'Ratings', unit: 'reviews',
      data: Array.from({ length: 20 }, (_, i) => ['v' + i, i]),
    }))
    expect(spec?.type).toBe('bar')
    expect(spec?.data).toHaveLength(12)
    expect(spec?.unit).toBe('reviews')
  })

  it('rejects bad shapes', () => {
    expect(parseAnaChartSpec('not json')).toBeNull()
    expect(parseAnaChartSpec('{"type":"pie","title":"x","data":[["a",1]]}')).toBeNull()
    expect(parseAnaChartSpec('{"type":"bar","title":"","data":[["a",1]]}')).toBeNull()
    expect(parseAnaChartSpec('{"type":"bar","title":"x","data":[["a","NaNish"]]}')).toBeNull()
    expect(parseAnaChartSpec('{"type":"bar","title":"x","data":[]}')).toBeNull()
  })
})

describe('splitAnaSegments', () => {
  it('splits text around a chart block', () => {
    const segs = splitAnaSegments('Intro.\n```chart\n{"type":"bar","title":"T","data":[["a",1]]}\n```\nOutro.')
    expect(segs.map(s => s.kind)).toEqual(['text', 'chart', 'text'])
  })

  it('degrades malformed blocks to visible text', () => {
    const segs = splitAnaSegments('```chart\n{broken\n```')
    expect(segs[0].kind).toBe('text')
  })

  it('unterminated fence yields pending (streaming)', () => {
    const segs = splitAnaSegments('So far...\n```chart\n{"type":"bar"')
    expect(segs.map(s => s.kind)).toEqual(['text', 'pending'])
  })

  it('plain text passes through as one segment', () => {
    expect(splitAnaSegments('just words')).toEqual([{ kind: 'text', text: 'just words' }])
  })
})
