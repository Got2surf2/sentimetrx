import { describe, it, expect } from 'vitest'
import { verbatimSupports, pickSupportingVerbatim, pickSupportingSentence } from '@/lib/verbatimGuard'

// The four quotes below are REAL — they shipped on the Operational Review deck's
// "What Guests Are Telling You" slide (Cheddar's, 2026-08-18), headed "Verbatim
// 1–3★ reviews from the lowest-rated outlets". Two of the six tiles argued
// against the slide. These are the regression.
const SHIPPED_OFF_PREMISE = [
  'I got seated fast!',
  'So I had a steak, med rare, steak was good.',
]
const SHIPPED_ON_PREMISE = [
  'I sat and waited on A1 Sauce until my steak was cold and could not eat with my family because I had not received all my food.',
  'Waste of time drinks took 30 min came after food but people that came after us got their drinks food and appetizers came at the same time horrible!',
  'Very disappointed.',
  'Definitely not worth the $15+ I paid for it.',
]

describe('verbatimSupports', () => {
  it('rejects the quotes that shipped against their own slide', () => {
    for (const q of SHIPPED_OFF_PREMISE) {
      expect(verbatimSupports(q, 'negative'), q).toBe(false)
    }
  })

  it('keeps the quotes that did support it', () => {
    for (const q of SHIPPED_ON_PREMISE) {
      expect(verbatimSupports(q, 'negative'), q).toBe(true)
    }
  })

  it('a quote with no detectable polarity is not evidence', () => {
    // Silence is not support. "The restaurant is on Main Street" evidences
    // nothing about a problem, so it must not fill a slot on a problems slide.
    expect(verbatimSupports('We came on a Tuesday around six.', 'negative')).toBe(false)
    expect(verbatimSupports('We came on a Tuesday around six.', 'positive')).toBe(false)
  })

  it('handles empty and missing text', () => {
    expect(verbatimSupports('', 'negative')).toBe(false)
    expect(verbatimSupports('   ', 'negative')).toBe(false)
    expect(verbatimSupports(null, 'negative')).toBe(false)
    expect(verbatimSupports(undefined, 'positive')).toBe(false)
  })

  it('is direction-aware — the same quote cannot serve both premises', () => {
    const praise = 'Immaculate as always! I have never ever had an issue with dining with you guys.'
    expect(verbatimSupports(praise, 'positive')).toBe(true)
    expect(verbatimSupports(praise, 'negative')).toBe(false)

    const complaint = 'The steak was cold and the service was terrible.'
    expect(verbatimSupports(complaint, 'negative')).toBe(true)
    expect(verbatimSupports(complaint, 'positive')).toBe(false)
  })

  it('respects negation — "not worth it" is a complaint, not praise', () => {
    expect(verbatimSupports('Definitely not worth the price.', 'negative')).toBe(true)
    expect(verbatimSupports('Definitely not worth the price.', 'positive')).toBe(false)
  })
})

describe('pickSupportingVerbatim', () => {
  it('returns the first candidate that carries the premise, preserving order', () => {
    expect(pickSupportingVerbatim(
      ['I got seated fast!', 'The steak was cold and service was terrible.'],
      'negative',
    )).toBe('The steak was cold and service was terrible.')
  })

  it('returns null rather than an off-premise fallback', () => {
    // The whole point: no quote beats a contradictory one.
    expect(pickSupportingVerbatim(['I got seated fast!', 'Steak was good.'], 'negative')).toBeNull()
    expect(pickSupportingVerbatim([], 'negative')).toBeNull()
    expect(pickSupportingVerbatim([null, undefined, ''], 'negative')).toBeNull()
  })

  it('trims the chosen quote', () => {
    expect(pickSupportingVerbatim(['  The food was cold and awful.  '], 'negative'))
      .toBe('The food was cold and awful.')
  })
})

describe('pickSupportingSentence', () => {
  // The real fix. A 1–3★ review almost always says why — just not always in its
  // first sentence, which is exactly what the deck was printing.
  it('skips a cheerful opening and picks the sentence that carries the complaint', () => {
    const review = 'So I had a steak, med rare, steak was good. But the service was terrible and we waited an hour.'
    expect(pickSupportingSentence(review, 'negative'))
      .toBe('But the service was terrible and we waited an hour.')
  })

  it('picks the STRONGEST carrying sentence, not merely the first qualifying one', () => {
    const review = 'The wait was long. Honestly the food was cold, the server was rude and the place was filthy.'
    expect(pickSupportingSentence(review, 'negative'))
      .toBe('Honestly the food was cold, the server was rude and the place was filthy.')
  })

  it('returns null when the review has no sentence that carries the premise', () => {
    // Dropping beats contradicting. The tile shows one fewer quote.
    expect(pickSupportingSentence('I got seated fast! The steak was good.', 'negative')).toBeNull()
    expect(pickSupportingSentence('', 'negative')).toBeNull()
    expect(pickSupportingSentence(null, 'negative')).toBeNull()
  })

  it('works in the positive direction too', () => {
    const review = 'Parking was a nightmare. The food was delicious and the staff were friendly.'
    expect(pickSupportingSentence(review, 'positive'))
      .toBe('The food was delicious and the staff were friendly.')
  })

  it('strips markup, collapses whitespace and capitalises', () => {
    expect(pickSupportingSentence('<b>the   food</b> was   awful.', 'negative')).toBe('The food was awful.')
  })

  it('truncates a run-on sentence at the limit', () => {
    const long = 'The food was awful ' + 'and cold '.repeat(40) + 'indeed.'
    const out = pickSupportingSentence(long, 'negative', { maxLen: 60 })!
    expect(out.length).toBeLessThanOrEqual(61)
    expect(out.endsWith('…')).toBe(true)
  })

  it('verifies AFTER truncation — a signal cut off by maxLen does not count', () => {
    // The exact leak a real-data sweep found: the sentence qualifies, then
    // maxLen cuts the words that made it qualify, and the neutral fragment ships.
    const leadIn = 'This was our first time eating here and we had been meaning to come by for ages and finally did. '
    const review = leadIn + 'The waiter was wonderful.'
    // As ONE sentence the signal sits past the limit, so it must be rejected…
    expect(pickSupportingSentence(leadIn.replace('. ', ' ') + 'the waiter was wonderful.', 'positive', { maxLen: 60 })).toBeNull()
    // …but when the praise is its own sentence it survives truncation and ships.
    expect(pickSupportingSentence(review, 'positive', { maxLen: 60 })).toBe('The waiter was wonderful.')
  })
})
