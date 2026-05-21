import { describe, expect, it } from 'vitest'
import {
  DEFLECTION_QUESTION_SIGNALS,
  hitsSensitiveTopic,
  evaluateDeflection,
} from '@/lib/deflectionRouter'

// FEEDBACK_SIGNALS regex used by the bots route. Mirrors the regex left inline
// at app/api/bots/[id]/chat/route.ts; kept here as a fixture so the unit tests
// exercise evaluateDeflection with a realistic feedback regex.
const BOT_FEEDBACK_SIGNALS = /\b(good|great|bad|terrible|love|hate|like|dislike|think|thinking|feel|feeling|believe|wish|hope|want|need|prefer|enjoy|annoyed|frustrated|frustrating|happy|disappointed|amazing|awful|horrible|excellent|worst|best|opinion|suggest|recommend|improve|issue|problem|concern|stress|stressed|struggling|burnout|overwhelm|exhausted|tired|anxious|depressed|worried|scared|afraid|angry|upset|hurt|suffering|difficult|tough|hard|important|critical|essential|ridiculous|absurd|outrageous|unfair|fair|wrong|right|better|worse|enough|lack|missing)\b/i

describe('DEFLECTION_QUESTION_SIGNALS', () => {
  it.each([
    'what is your stance on housing?',
    'How do I sign up',
    'why did you say that',
    'Can you tell me more',
    'will you support this',
    '  who runs the meeting',
  ])('matches %j', (text) => {
    expect(DEFLECTION_QUESTION_SIGNALS.test(text)).toBe(true)
  })

  it.each([
    'I love what they did',           // 'what' appears mid-sentence → no match
    'good morning',
    'thanks',
    'this is great',
    'tell me about it',               // imperative, not a question word
  ])('does not match %j', (text) => {
    expect(DEFLECTION_QUESTION_SIGNALS.test(text)).toBe(false)
  })
})

describe('hitsSensitiveTopic', () => {
  it('returns false for empty / missing topic lists', () => {
    expect(hitsSensitiveTopic('anything goes', [])).toBe(false)
    expect(hitsSensitiveTopic('anything goes', null)).toBe(false)
    expect(hitsSensitiveTopic('anything goes', undefined)).toBe(false)
  })

  it('matches whole words case-insensitively', () => {
    expect(hitsSensitiveTopic('I want to talk about ABORTION rights', ['abortion'])).toBe(true)
    expect(hitsSensitiveTopic('the candidate on gun control', ['gun control'])).toBe(true)
  })

  it('does not match partial-word hits', () => {
    expect(hitsSensitiveTopic('the assassination of caesar', ['ass'])).toBe(false)
    expect(hitsSensitiveTopic('I love classical music', ['class'])).toBe(false)
  })

  it('escapes regex metacharacters in the topic list', () => {
    expect(hitsSensitiveTopic('what about a.b.c', ['a.b.c'])).toBe(true)
    expect(hitsSensitiveTopic('what about axbxc', ['a.b.c'])).toBe(false)
  })

  it('matches when at least one topic in the list hits', () => {
    expect(hitsSensitiveTopic('I worry about crime', ['housing', 'crime', 'taxes'])).toBe(true)
  })
})

describe('evaluateDeflection', () => {
  it('attempts when sensitive topic hits, even with feedback words', () => {
    const r = evaluateDeflection('I think abortion is bad', ['abortion'], BOT_FEEDBACK_SIGNALS)
    expect(r.shouldAttempt).toBe(true)
    expect(r.hitsSensitive).toBe(true)
  })

  it('does NOT attempt when message has feedback signal and no sensitive hit', () => {
    const r = evaluateDeflection('I love this idea', [], BOT_FEEDBACK_SIGNALS)
    expect(r.shouldAttempt).toBe(false)
    expect(r.hitsSensitive).toBe(false)
  })

  it('does NOT attempt when message has feedback signal even if it starts with a question word', () => {
    // "why" is a question signal but "love" is feedback — feedback wins.
    const r = evaluateDeflection('Why do I love this so much', [], BOT_FEEDBACK_SIGNALS)
    expect(r.shouldAttempt).toBe(false)
  })

  it('attempts when message has no feedback signal AND starts with a question word', () => {
    const r = evaluateDeflection('What time does city hall open?', [], BOT_FEEDBACK_SIGNALS)
    expect(r.shouldAttempt).toBe(true)
    expect(r.hitsSensitive).toBe(false)
  })

  it('does NOT attempt when message lacks both feedback and question signals', () => {
    // Short conversational filler like "ok" / "sure" should not trigger deflection.
    const r = evaluateDeflection('ok', [], BOT_FEEDBACK_SIGNALS)
    expect(r.shouldAttempt).toBe(false)
  })

  it('does NOT attempt when question word appears mid-sentence', () => {
    // QUESTION_SIGNALS is anchored to the start, so this is treated as feedback.
    const r = evaluateDeflection('I told them what to do', [], BOT_FEEDBACK_SIGNALS)
    expect(r.shouldAttempt).toBe(false)
  })
})
