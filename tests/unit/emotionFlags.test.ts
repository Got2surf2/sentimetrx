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

// ── anger + threat ascribed (added 2026-09-03, ANES-validated constructs) ──

describe('anger', () => {
  it('flags expressed anger language', () => {
    expect(subs('This whole experience makes me so angry.')).toContain('anger')
    expect(subs("I'm furious about the way we were treated.")).toContain('anger')
    expect(subs('Absolutely outrageous pricing for what you get.')).toContain('anger')
    expect(subs("Fed up with the constant mistakes here.")).toContain('anger')
    expect(subs('Sick and tired of waiting an hour every time.')).toContain('anger')
  })

  it('routes fear-mongering ACCUSATIONS to anger, never threat (the tactic rule)', () => {
    const out = detectEmotionAssertions('He just plays on people\'s fears to win votes.')
    expect(out.map(a => a.sub)).toContain('anger')
    expect(out.map(a => a.sub)).not.toContain('threat ascribed')
    expect(subs('Pure fear-mongering and scare tactics.')).toContain('anger')
  })

  it('negation-guards: "never angry" / "not mad" do not flag', () => {
    expect(subs('The staff were great — I was never angry once.')).not.toContain('anger')
    expect(subs("I'm not angry, just confused by the menu.")).not.toContain('anger')
  })
})

describe('threat ascribed', () => {
  it('flags third-party danger claims', () => {
    expect(subs('The parking lot at night is dangerous.')).toContain('threat ascribed')
    expect(subs('This policy is a threat to small businesses.')).toContain('threat ascribed')
    expect(subs('Leaving the gate open puts children at risk.')).toContain('threat ascribed')
    expect(subs('The whole area felt unsafe after dark.')).toContain('threat ascribed')
  })

  it('first-person fear and worry stay DARK (worry ≠ exit; lexicon-bias hold)', () => {
    expect(subs("I'm afraid the quality has slipped.")).toEqual([])
    expect(subs('I worry about where this country is headed.')).toEqual([])
    expect(subs('Scared to even ask for the bill.')).toEqual([])
  })

  it('negation-guards: "not dangerous" does not flag', () => {
    expect(subs('The trail is not dangerous at all, great for kids.')).not.toContain('threat ascribed')
  })

  it('anger and threat fire independently and never merge', () => {
    const out = subs('This intersection is dangerous and it makes me so angry that nothing is done.')
    expect(out).toContain('anger')
    expect(out).toContain('threat ascribed')
  })
})
