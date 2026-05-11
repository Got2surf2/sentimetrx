import { describe, it, expect } from 'vitest'
import { scoreSentimentFull } from '@/lib/contentGuard'

// Sanity checks for the modern slang lexicon + the negation valence-shifter
// that wraps AFINN. The negation handling is shared so any new lexicon
// term automatically inherits "not <term>" flipping behavior.

describe('sentiment: Gen-Z slang base scoring', () => {
  it('scores positive slang as positive', () => {
    expect(scoreSentimentFull('the show was lit').label).toBe('positive')
    expect(scoreSentimentFull('she really ate that performance').label).toBe('positive')
    expect(scoreSentimentFull('this is straight fire').label).toBe('positive')
    expect(scoreSentimentFull('the vibes are immaculate').label).toBe('positive')
  })

  it('scores negative slang as negative', () => {
    expect(scoreSentimentFull('the food was mid').label).toBe('negative')
    expect(scoreSentimentFull('that take is cringe').label).toBe('negative')
    expect(scoreSentimentFull('he is so salty').label).toBe('negative')
    expect(scoreSentimentFull('the menu is kinda sus').label).toBe('negative')
  })
})

describe('sentiment: negation flips slang polarity', () => {
  it('flips positive slang when negated', () => {
    expect(scoreSentimentFull('the show was not lit').label).toBe('negative')
    expect(scoreSentimentFull("she didn't slay that").label).toBe('negative')
    expect(scoreSentimentFull('these vibes are no good').label).toBe('negative')
  })

  it('flips negative slang when negated', () => {
    expect(scoreSentimentFull('the food was not mid').label).toBe('positive')
    expect(scoreSentimentFull("that take isn't cringe").label).toBe('positive')
  })
})

describe('sentiment: standard AFINN negation still works', () => {
  it('flips classic AFINN words', () => {
    expect(scoreSentimentFull('this is good').label).toBe('positive')
    expect(scoreSentimentFull('this is not good').label).toBe('negative')
    expect(scoreSentimentFull('I am never disappointed').label).toBe('positive')
    expect(scoreSentimentFull('no problems here').label).toBe('positive')
  })

  it('neutral on truly mixed/neutral content', () => {
    expect(scoreSentimentFull('the building has three floors').label).toBe('neutral')
    expect(scoreSentimentFull('').label).toBe('neutral')
  })
})
