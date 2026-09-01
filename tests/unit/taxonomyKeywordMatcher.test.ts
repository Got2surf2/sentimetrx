// lib/taxonomyKeywordMatcher — Tier-1 keyword classifier. Focus: clause-scoped
// sentiment attribution for NEUTRAL mentions (2026-09-02, owner ask: when the
// word is "manager" and the comment is "the manager was nice", the manager
// mention must carry the "nice"). Runs the REAL dictionaries + lexicon.
import { describe, it, expect } from 'vitest'
import { classifyByKeyword } from '@/lib/taxonomyKeywordMatcher'

function polOf(text: string, sub: string): string | undefined {
  return classifyByKeyword(text).assertions.find(a => a.sub === sub)?.polarity
}

describe('clause-scoped sentiment for neutral mentions', () => {
  it('"the manager was nice" → manager mention is POSITIVE', () => {
    expect(polOf('The manager was nice', 'manager')).toBe('pos')
  })

  it('"the manager was rude to us" → negative', () => {
    expect(polOf('The manager was rude to us', 'manager')).toBe('neg')
  })

  it('contrast conjunction bounds the clause — praise cannot leak across "but"', () => {
    expect(polOf('The food was great but the manager was rude', 'manager')).toBe('neg')
    expect(polOf('The manager was great but the food was cold', 'manager')).toBe('pos')
  })

  it('negated sentiment flips: "not helpful" reads negative', () => {
    expect(polOf('The manager was not helpful at all', 'manager')).toBe('neg')
  })

  it('a sentiment-free mention stays NEUTRAL (by-rating fallback preserved)', () => {
    expect(polOf('I spoke to the manager about the reservation', 'manager')).toBe('neu')
  })

  it('sentence boundaries isolate mentions: each person reads their own sentence', () => {
    const t = 'Our server Jessica was amazing. The manager was rude when we asked for help.'
    expect(polOf(t, 'server')).toBe('pos')
    expect(polOf(t, 'manager')).toBe('neg')
  })

  it('polarized dictionary phrases keep their tuned polarity (no clause override)', () => {
    // 'rude' is a polarized phrase — its own polarity, negation-flippable.
    expect(polOf('The staff was rude', 'rude')).toBe('neg')
    expect(polOf('The staff was not rude at all, really friendly', 'rude')).toBe('pos')
  })
})
