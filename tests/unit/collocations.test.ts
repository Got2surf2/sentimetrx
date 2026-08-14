import { describe, it, expect } from 'vitest'
import { computeCollocates, filterCooccurringRows, splitSentences } from '@/lib/collocations'

const F = 'comment'
const rowsOf = (...texts: string[]) => texts.map(t => ({ comment: t }))

describe('splitSentences', () => {
  it('splits on terminators and newlines, keeps punctuation, drops blanks', () => {
    expect(splitSentences('Great food. Slow service! Why?')).toEqual([
      'Great food.', 'Slow service!', 'Why?',
    ])
    expect(splitSentences('one\n\ntwo')).toEqual(['one', 'two'])
    expect(splitSentences('   ')).toEqual([])
    expect(splitSentences('no terminator')).toEqual(['no terminator'])
  })
})

describe('computeCollocates', () => {
  it('counts comments, not tokens — a repeated word counts once', () => {
    const rows = rowsOf('The food was delicious, delicious, delicious.')
    const r = computeCollocates(rows, F, ['food'], { minCount: 1 })
    expect(r.byCount.find(c => c.word === 'delicious')?.count).toBe(1)
    expect(r.matchedRows).toBe(1)
  })

  it('is sentence-scoped — a word in a different sentence is not context', () => {
    const rows = rowsOf(
      'The food was excellent. Parking was terrible.',
      'The food was excellent. Parking was terrible.',
    )
    const r = computeCollocates(rows, F, ['food'], { minCount: 1 })
    const words = r.byCount.map(c => c.word)
    expect(words).toContain('excellent')
    expect(words).not.toContain('parking')
    expect(words).not.toContain('terrible')
  })

  it('never lists the target as its own context', () => {
    const rows = rowsOf('food food good', 'food good')
    const r = computeCollocates(rows, F, ['food'], { minCount: 1 })
    expect(r.byCount.map(c => c.word)).not.toContain('food')
  })

  it('matches on word boundaries — "seafood" is not "food"', () => {
    const rows = rowsOf('The seafood was fresh.', 'The seafood was fresh.')
    const r = computeCollocates(rows, F, ['food'], { minCount: 1 })
    expect(r.matchedRows).toBe(0)
    expect(r.byCount).toEqual([])
  })

  it('honours minCount', () => {
    const rows = rowsOf('food delicious', 'food delicious', 'food rare')
    const two = computeCollocates(rows, F, ['food'], { minCount: 2 })
    expect(two.byCount.map(c => c.word)).toEqual(['delicious'])
    const one = computeCollocates(rows, F, ['food'], { minCount: 1 })
    expect(one.byCount.map(c => c.word).sort()).toEqual(['delicious', 'rare'])
  })

  it('scores a distinctive partner above an everywhere-word of equal count', () => {
    // "portions" appears ONLY alongside food; "place" appears in every row.
    const rows = [
      ...Array.from({ length: 10 }, () => ({ comment: 'The food had big portions at this place.' })),
      ...Array.from({ length: 40 }, () => ({ comment: 'Nice place overall.' })),
    ]
    const r = computeCollocates(rows, F, ['food'], { minCount: 1 })
    const portions = r.byCount.find(c => c.word === 'portions')!
    const place = r.byCount.find(c => c.word === 'place')!
    expect(portions.count).toBe(place.count) // identical raw frequency...
    expect(portions.score).toBeGreaterThan(place.score) // ...but not identical association
  })

  it('floors the distinctive ranking so a 2-comment word cannot top the list', () => {
    // "unicorn" is perfectly exclusive to food but appears twice — G² alone
    // would rank it first. "quality" is the real partner at 12 comments.
    const rows = [
      ...Array.from({ length: 2 }, () => ({ comment: 'The food here is unicorn.' })),
      ...Array.from({ length: 12 }, () => ({ comment: 'The food quality is high.' })),
      ...Array.from({ length: 60 }, () => ({ comment: 'Parking is high nearby.' })),
    ]
    const r = computeCollocates(rows, F, ['food'], { minCount: 1 })
    expect(r.byCount.map(c => c.word)).toContain('unicorn') // still available by frequency
    expect(r.byDistinctive.map(c => c.word)).not.toContain('unicorn')
    expect(r.byDistinctive[0].word).toBe('quality')
  })

  it('falls back to the unfloored list when the floor would empty it', () => {
    const rows = rowsOf('food delicious', 'food delicious')
    const r = computeCollocates(rows, F, ['food'], { minCount: 1 })
    expect(r.byDistinctive.map(c => c.word)).toEqual(['delicious'])
  })

  it('accepts multiple targets (a theme) and pools their sentences', () => {
    const rows = rowsOf('The steak was cold.', 'The pasta was cold.', 'The room was cold.')
    const r = computeCollocates(rows, F, ['steak', 'pasta'], { minCount: 1 })
    expect(r.matchedRows).toBe(2)
    expect(r.byCount.find(c => c.word === 'cold')?.count).toBe(2)
  })

  it('returns an empty result for no targets and for no matches', () => {
    expect(computeCollocates(rowsOf('anything'), F, []).byCount).toEqual([])
    expect(computeCollocates(rowsOf('anything'), F, ['absent']).matchedRows).toBe(0)
  })

  it('searches every analyzed field', () => {
    const rows = [
      { a: 'the food was great', b: 'unrelated' },
      { a: 'unrelated', b: 'the food was great' },
    ]
    const r = computeCollocates(rows, ['a', 'b'], ['food'], { minCount: 1 })
    expect(r.matchedRows).toBe(2)
    expect(r.byCount.find(c => c.word === 'great')?.count).toBe(2)
  })
})

describe('filterCooccurringRows', () => {
  it('returns exactly the comments behind a collocate count', () => {
    const rows = rowsOf(
      'The food was delicious.',
      'The food was delicious.',
      'The food was cold.',
      'Delicious dessert, no mention of the main.',
    )
    const r = computeCollocates(rows, F, ['food'], { minCount: 1 })
    const count = r.byCount.find(c => c.word === 'delicious')!.count
    const drilled = filterCooccurringRows(rows, F, ['food'], 'delicious')
    expect(drilled.length).toBe(count)
    expect(drilled.length).toBe(2)
  })

  it('requires the same sentence, not merely the same comment', () => {
    const rows = rowsOf('The food was fine. Delicious cocktails though.')
    expect(filterCooccurringRows(rows, F, ['food'], 'delicious')).toEqual([])
  })

  it('returns nothing for an empty target list or empty collocate', () => {
    const rows = rowsOf('The food was delicious.')
    expect(filterCooccurringRows(rows, F, [], 'delicious')).toEqual([])
    expect(filterCooccurringRows(rows, F, ['food'], '')).toEqual([])
  })
})
