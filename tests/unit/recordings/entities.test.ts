// Pure-logic coverage for lib/recordings/entities.ts: tolerant parse of the
// extraction JSON, glossary derivation (canonicals ∪ manual), and the
// deterministic variant→canonical transcript normalization. callAI is mocked —
// no network; extractEntities itself isn't exercised here (it's a thin AI wrapper).

import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/ai', () => ({ callAI: vi.fn() }))

import { parseEntities, glossaryFromEntities, normalizeSegments, normalizeText, buildReplacements } from '@/lib/recordings/entities'
import type { EntityMap, TranscriptSegment } from '@/lib/recordings/types'

describe('parseEntities', () => {
  it('parses entries, dedupes variants, ensures canonical is a variant, sorts by mentions', () => {
    const json = JSON.stringify({
      entities: [
        { canonical: 'Babuji', variants: ['Babu G', 'babu g', 'Baboojee'], type: 'person', mentions: 3 },
        { canonical: 'Kelly Park Road', variants: ['Kelly Parke Road'], type: 'place', mentions: 9 },
      ],
    })
    const out = parseEntities(json)
    expect(out.map(e => e.canonical)).toEqual(['Kelly Park Road', 'Babuji'])   // by mentions desc
    const babuji = out.find(e => e.canonical === 'Babuji')!
    expect(babuji.variants).toEqual(['Babuji', 'Babu G', 'Baboojee'])           // canonical prepended, ci-deduped
    expect(babuji.type).toBe('person')
  })

  it('drops entries with no canonical and coerces a bad type to "term"', () => {
    const json = JSON.stringify({ entities: [
      { canonical: '', variants: ['x'], type: 'person', mentions: 2 },
      { canonical: 'NOWOCATS', variants: ['no what cats'], type: 'animal', mentions: 1 },
    ] })
    const out = parseEntities(json)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ canonical: 'NOWOCATS', type: 'term' })
  })

  it('tolerates markdown fences and returns [] on garbage', () => {
    const fenced = '```json\n' + JSON.stringify({ entities: [{ canonical: 'A', variants: [], type: 'org', mentions: 1 }] }) + '\n```'
    expect(parseEntities(fenced)).toHaveLength(1)
    expect(parseEntities('not json')).toEqual([])
  })
})

describe('glossaryFromEntities', () => {
  const map: EntityMap = {
    entities: [
      { canonical: 'Babuji', variants: ['Babuji', 'Babu G'], type: 'person', mentions: 3 },
      { canonical: 'NOWOCATS', variants: ['NOWOCATS'], type: 'org', mentions: 5 },
    ],
    extracted_at: '2026-06-04T00:00:00Z',
  }
  it('returns canonicals ∪ manual, de-duped case-insensitively', () => {
    expect(glossaryFromEntities(map, ['Hatem Abou-Sayed', 'nowocats'])).toEqual(['Babuji', 'NOWOCATS', 'Hatem Abou-Sayed'])
  })
  it('handles a null map (manual only) and empty (undefined)', () => {
    expect(glossaryFromEntities(null, ['Kelly Park Road'])).toEqual(['Kelly Park Road'])
    expect(glossaryFromEntities(null, [])).toBeUndefined()
    expect(glossaryFromEntities(null, undefined)).toBeUndefined()
  })
})

describe('normalizeText / normalizeSegments — deterministic variant→canonical', () => {
  const map: EntityMap = {
    entities: [
      { canonical: 'NOWOCATS', variants: ['NOWOCATS', 'no what cats'], type: 'org', mentions: 4 },
      { canonical: 'Kelly Park Road', variants: ['Kelly Park Road', 'Kelly Parke Road'], type: 'place', mentions: 6 },
    ],
    extracted_at: '2026-06-04T00:00:00Z',
  }
  it('replaces variants with canonical, case-insensitive, word-boundary', () => {
    const repl = buildReplacements(map)
    expect(normalizeText('We discussed no what cats on Kelly Parke Road.', repl))
      .toBe('We discussed NOWOCATS on Kelly Park Road.')
  })
  it('is a no-op for already-correct text', () => {
    const repl = buildReplacements(map)
    expect(normalizeText('NOWOCATS met at Kelly Park Road.', repl)).toBe('NOWOCATS met at Kelly Park Road.')
  })
  it('returns the same segments when there is nothing to replace', () => {
    const segs: TranscriptSegment[] = [{ start: 0, end: 1, text: 'hello world' }]
    expect(normalizeSegments(segs, null)).toBe(segs)   // identity, no allocation
  })
  it('rewrites only the text field of each segment', () => {
    const segs: TranscriptSegment[] = [{ start: 0, end: 2, text: 'no what cats', speaker: 'S1' } as TranscriptSegment]
    const out = normalizeSegments(segs, map)
    expect(out[0].text).toBe('NOWOCATS')
    expect(out[0].start).toBe(0)
  })
})
