import { describe, it, expect } from 'vitest'
import { scoreBrandMatch } from '@/lib/brandMatch'
import type { DfsLocation } from '@/lib/dataforseo'

// Build a minimal DfsLocation — only name + review_count matter for scoring.
function loc(name: string, review_count = 100): DfsLocation {
  return {
    place_id: name + ':' + Math.random(),
    name,
    address: null, city: null, state: null, zip: null,
    rating: 4.2, review_count,
    phone: null, latitude: null, longitude: null,
  }
}

describe('scoreBrandMatch', () => {
  it('scores an exact name match as a strong 100', () => {
    const [result] = scoreBrandMatch('Chuy\'s', [loc('Chuy\'s')])
    expect(result.matchScore).toBe(100)
    expect(result.matchStrength).toBe('strong')
  })

  it('flags a look-alike with extra qualifier words as weak', () => {
    const scored = scoreBrandMatch('Chuy\'s', [loc('Chuy\'s'), loc('Chuy\'s de Mexico')])
    const real = scored.find((l) => l.name === 'Chuy\'s')!
    const lookalike = scored.find((l) => l.name === 'Chuy\'s de Mexico')!
    expect(real.matchStrength).toBe('strong')
    expect(lookalike.matchStrength).toBe('weak')
    expect(real.matchScore).toBeGreaterThan(lookalike.matchScore)
  })

  it('uses chain consensus so a loose keyword still ranks the real chain strong', () => {
    // User typed "Chuy's" but the chain is actually "Chuy's Tex-Mex" — the
    // large same-named cluster should be treated as the brand.
    const locations = [
      ...Array.from({ length: 8 }, () => loc('Chuy\'s Tex-Mex')),
      loc('Chuy\'s de Mexico'),
      loc('Chuy\'s de Mexico'),
    ]
    const scored = scoreBrandMatch('Chuy\'s', locations)
    const chain = scored.filter((l) => l.name === 'Chuy\'s Tex-Mex')
    const lookalike = scored.filter((l) => l.name === 'Chuy\'s de Mexico')
    expect(chain.every((l) => l.matchStrength === 'strong')).toBe(true)
    expect(lookalike.every((l) => l.matchStrength === 'weak')).toBe(true)
  })

  it('treats a single location with a leading "The" as a strong match', () => {
    const [result] = scoreBrandMatch('Capital Grille Boston', [loc('The Capital Grille')])
    expect(result.matchStrength).toBe('strong')
  })

  it('scores a wholly unrelated business as a weak 0 and sorts it last', () => {
    const scored = scoreBrandMatch('Chuy\'s', [loc('Chuy\'s'), loc('Joe\'s Crab Shack')])
    const unrelated = scored[scored.length - 1]
    expect(unrelated.name).toBe('Joe\'s Crab Shack')
    expect(unrelated.matchScore).toBe(0)
    expect(unrelated.matchStrength).toBe('weak')
  })

  it('returns results sorted strongest-first', () => {
    const scored = scoreBrandMatch('Chuy\'s', [
      loc('Joe\'s Crab Shack'),
      loc('Chuy\'s de Mexico'),
      loc('Chuy\'s'),
    ])
    expect(scored.map((l) => l.name)).toEqual(['Chuy\'s', 'Chuy\'s de Mexico', 'Joe\'s Crab Shack'])
  })

  it('does not let a large unrelated cluster hijack the ranking', () => {
    // A search for "Chuy's" that somehow returns mostly "Starbucks" must not
    // promote Starbucks to the brand just because the cluster is big.
    const locations = [
      ...Array.from({ length: 10 }, () => loc('Starbucks')),
      loc('Chuy\'s'),
    ]
    const scored = scoreBrandMatch('Chuy\'s', locations)
    expect(scored[0].name).toBe('Chuy\'s')
    expect(scored.find((l) => l.name === 'Starbucks')!.matchStrength).toBe('weak')
  })
})
