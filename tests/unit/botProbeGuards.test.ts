import { describe, expect, it } from 'vitest'
import { isInfoOnlyMessage } from '@/lib/botProbeGuards'

describe('isInfoOnlyMessage', () => {
  it('treats empty / whitespace as info-only', () => {
    expect(isInfoOnlyMessage('')).toBe(true)
    expect(isInfoOnlyMessage(null)).toBe(true)
    expect(isInfoOnlyMessage('   ')).toBe(true)
  })

  it.each([
    'hi',
    'hello',
    'hey there',
    'good morning',
    'thanks',
    'Thank you!',
    'tysm',
    'appreciate it.',
    'ok',
    'Got it',
    'sounds good',
    'makes sense',
    'cool',
    'nice',
    'bye',
    'see ya',
    'np',
    'no worries',
    'haha',
  ])('flags %j as info-only', (msg) => {
    expect(isInfoOnlyMessage(msg)).toBe(true)
  })

  it.each([
    'what is your stance on medicare?',
    'how do you plan to handle immigration',  // 7 words → substantive even without ?
    'tell me about the florida first agenda',
    'I disagree with your housing policy',
    'thanks for the answer about social security',  // longer than 6 words
    'ok but what about Veterans benefits?',  // has ?
    'cool — can you say more about that?',
  ])('does NOT flag %j as info-only', (msg) => {
    expect(isInfoOnlyMessage(msg)).toBe(false)
  })

  it('respects 6-word ceiling regardless of social tokens', () => {
    // "thanks for the response it really helped" = 7 words → substantive
    expect(isInfoOnlyMessage('thanks for the response it really helped')).toBe(false)
  })
})
