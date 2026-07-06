import { describe, it, expect } from 'vitest'
import { detectEmotionAssertions } from '@/lib/emotionFlags'
import { buildFieldBlock } from '@/lib/taxonomyEmbed'

const subs = (text: string, opts?: Parameters<typeof detectEmotionAssertions>[1]) =>
  detectEmotionAssertions(text, opts).map(a => a.sub).sort()

describe('detectEmotionAssertions', () => {
  it('returns nothing for empty or plain text', () => {
    expect(detectEmotionAssertions('')).toEqual([])
    expect(detectEmotionAssertions('   ')).toEqual([])
    expect(subs('Great steak, wonderful service, we loved everything.')).toEqual([])
  })

  it('flags disappointment language (validated patterns)', () => {
    expect(subs('I was really disappointed with the filet.')).toEqual(['disappointment'])
    expect(subs('Expected much better for a place like this.')).toEqual(['disappointment'])
    expect(subs('The sides were not up to par at all.')).toEqual(['disappointment'])
    expect(subs('Honestly it fell short of the hype.')).toEqual(['disappointment'])
    expect(subs('This place used to be better.')).toEqual(['disappointment'])
  })

  it('does NOT flag negated disappointment ("won\'t be disappointed")', () => {
    expect(subs('Order the ribeye — you will not be disappointed!')).toEqual([])
    expect(subs("You won't be disappointed with the service here.")).toEqual([])
    expect(subs('This place never disappoints.')).toEqual([])
  })

  it('flags churn-intent language', () => {
    expect(subs('Never coming back after tonight.')).toEqual(['churn intent'])
    expect(subs("We won't be returning. Period.")).toEqual(['churn intent'])
    expect(subs('First and last time at this location.')).toEqual(['churn intent'])
  })

  it('suppresses churn intent for captive verticals', () => {
    expect(subs('Never coming back here.', { suppressChurn: true })).toEqual([])
  })

  it('flags blame language, including third-party "should have"', () => {
    expect(subs('Whoever decided to cut the bread service made a poor decision.')).toEqual(['blame'])
    expect(subs('The manager should have comped the meal.')).toEqual(['blame'])
    expect(subs('Why would they seat us next to the kitchen?')).toEqual(['blame'])
  })

  it('routes passive/impersonal "should have" to disappointment, not blame or regret', () => {
    // done TO the reviewer — expectation gap
    expect(subs('We should have been told about the wait.')).toEqual(['disappointment'])
    // impersonal subject — the price set the expectation
    expect(subs('A $700 dinner should have come with attentive service.')).toEqual(['disappointment'])
  })

  it('keeps regret dark: first-person "should have" emits NOTHING', () => {
    expect(subs('I should have ordered the ribeye instead.')).toEqual([])
    expect(subs("We should've gone somewhere else.")).toEqual([])
    expect(subs('I wish I had picked another restaurant.')).toEqual([])
  })

  it('emits at most one assertion per sub, each with an evidence span', () => {
    const out = detectEmotionAssertions(
      'Disappointed, so disappointed. Expected better. Never again, never coming back.',
    )
    expect(out.map(a => a.sub).sort()).toEqual(['churn intent', 'disappointment'])
    for (const a of out) {
      expect(a.axis).toBe('emotion')
      expect(a.polarity).toBe('neg')
      expect(a.evidence && a.evidence.length > 0).toBe(true)
      expect(a.source).toBe('keyword')
    }
  })

  it('co-occurrence: one review can carry all three flags', () => {
    expect(subs(
      'Expected way more for the price. The manager should have stepped in. Never going back.',
    )).toEqual(['blame', 'churn intent', 'disappointment'])
  })
})

describe('emotion axis in the embedded block', () => {
  it('buildFieldBlock groups emotion assertions under a.emotion', () => {
    const assertions = detectEmotionAssertions('So disappointing. Never coming back.')
    const block = buildFieldBlock(assertions, { version: 'v4', by: 'keyword', model: 'keyword-tier' })
    expect(block.a.emotion).toEqual(['churn intent', 'disappointment'])
    expect(block.al).toEqual([]) // normal severity — never an alert
  })
})
