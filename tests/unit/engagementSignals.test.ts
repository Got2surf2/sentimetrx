import { describe, expect, it } from 'vitest'
import {
  countWords,
  isCurtResponse,
  SUBTLE_DISENGAGE,
  isSubtleDisengage,
} from '@/lib/engagementSignals'

describe('countWords', () => {
  it('returns 0 for empty / nullish input', () => {
    expect(countWords('')).toBe(0)
    expect(countWords(null)).toBe(0)
    expect(countWords(undefined)).toBe(0)
    expect(countWords('   ')).toBe(0)
    expect(countWords('\t\n  ')).toBe(0)
  })

  it('counts whitespace-separated tokens', () => {
    expect(countWords('hello')).toBe(1)
    expect(countWords('hello world')).toBe(2)
    expect(countWords('the quick brown fox')).toBe(4)
  })

  it('collapses repeated whitespace and trims edges', () => {
    expect(countWords('  hello   world  ')).toBe(2)
    expect(countWords('hi\tthere\nfriend')).toBe(3)
  })

  it('treats attached punctuation as part of the word', () => {
    expect(countWords("don't worry")).toBe(2)
    expect(countWords('yes!')).toBe(1)
    expect(countWords('Wait... what?')).toBe(2)
  })
})

describe('isCurtResponse', () => {
  it.each(['hi', 'yeah', 'ok thanks', 'I guess so'])('flags %j as curt (≤3 words)', (msg) => {
    expect(isCurtResponse(msg)).toBe(true)
  })

  it.each([
    '',
    null,
    undefined,
    '   ',
    'hello there my friend',          // 4 words — over threshold
    'I have a lot to say about this', // long
  ])('does NOT flag %j as curt', (msg) => {
    expect(isCurtResponse(msg as any)).toBe(false)
  })
})

describe('SUBTLE_DISENGAGE regex', () => {
  it.each([
    'whatever',
    'sure',
    'fine.',
    'ok',
    'OK!',
    'okay?',
    'i guess',
    'idk',
    "i don't know",
    'yeah',
    'YEP',
    'no',
    'nah',
    'not really',
    'i said what i said',
    'all of the above',
    'both',
    'same',
    'agreed',
    'exactly!',
    'absolutely',
    'definitely.',
    'correct',
    'right',
  ])('matches %j as subtle disengagement', (msg) => {
    expect(SUBTLE_DISENGAGE.test(msg)).toBe(true)
  })

  it.each([
    'ok so what about housing',
    'sure, but I want to add',
    'whatever you say but I disagree',
    'I think the answer is no',
    "I don't know what you mean",
    'right, the issue is parking',
    'because I said so',
  ])('does NOT match %j (longer / has substance)', (msg) => {
    expect(SUBTLE_DISENGAGE.test(msg)).toBe(false)
  })
})

describe('isSubtleDisengage', () => {
  it('returns false for empty / nullish input', () => {
    expect(isSubtleDisengage('')).toBe(false)
    expect(isSubtleDisengage(null)).toBe(false)
    expect(isSubtleDisengage(undefined)).toBe(false)
  })

  it('trims surrounding whitespace before matching', () => {
    expect(isSubtleDisengage('  whatever  ')).toBe(true)
    expect(isSubtleDisengage('\tyeah\n')).toBe(true)
  })

  it('matches typical short disengagement', () => {
    expect(isSubtleDisengage('idk')).toBe(true)
    expect(isSubtleDisengage('not really')).toBe(true)
  })

  it('does not match longer or substantive messages', () => {
    expect(isSubtleDisengage('I think we should focus on housing')).toBe(false)
  })
})
