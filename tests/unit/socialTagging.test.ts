// lib/socialTagging.ts — the shared tagging pipeline for social comments
// (sentiment, moderation actions by sensitivity, spam, intents, topics,
// off-topic, emotion) and the response router. The content guard is driven at
// its boundary so the moderation matrix is exercised deterministically; every
// regex rule in this module runs for real.
import { describe, it, expect, vi } from 'vitest'

type Audit = { flags: string[]; maxSeverity: string | null; bleeped: string }
const AUDIT: Record<string, Audit> = {
  'I will hurt you': { flags: ['threat'], maxSeverity: 'severe', bleeped: 'I will hurt you' },
  'you people are the worst': { flags: ['slur'], maxSeverity: 'severe', bleeped: '***' },
  'graphic severe thing': { flags: ['sexual'], maxSeverity: 'severe', bleeped: '***' },
  'shut up idiot': { flags: ['insult'], maxSeverity: 'rude', bleeped: 'shut up ****' },
}
const SENT: Record<string, { label: 'positive' | 'negative' | 'neutral'; score: number }> = {
  'Thank you for all you do!': { label: 'positive', score: 0.6 },
  'This is terrible and I am furious': { label: 'negative', score: -0.7 },
  'I love this campaign and want to volunteer this weekend': { label: 'positive', score: 0.5 },
  'Happy to donate to the campaign, where do I chip in?': { label: 'positive', score: 0.4 },
  'Thank you for all you do for the city!': { label: 'positive', score: 0.6 },
  'I love the new bike lane downtown': { label: 'positive', score: 0.5 },
  'The traffic downtown is terrible and I am furious': { label: 'negative', score: -0.7 },
}
vi.mock('@/lib/contentGuard', () => ({
  auditContent: (t: string) => AUDIT[t] || { flags: [], maxSeverity: null, bleeped: t },
  scoreSentimentFull: (t: string) => SENT[t] || { label: 'neutral', score: 0 },
  scoreSentiment: (t: string) => (SENT[t] || { label: 'neutral' }).label,
}))

import { tagComment, routeResponse, scoreSentiment, type TagResult } from '@/lib/socialTagging'

const types = (r: TagResult) => r.flags.map(f => f.type)
const action = (r: TagResult, type: string) => r.flags.find(f => f.type === type)?.action

describe('tagComment — moderation by sensitivity', () => {
  it('threats/slurs: strict deletes, moderate hides, lenient reviews', () => {
    const strict = tagComment('I will hurt you', null, null, 'strict')
    expect(strict.isDeleted).toBe(true); expect(strict.isHidden).toBe(false)
    expect(action(strict, 'auto_delete')).toBe('Auto-deleted: threats/slurs')
    const moderate = tagComment('you people are the worst')                      // default sensitivity
    expect(moderate.isHidden).toBe(true); expect(moderate.isDeleted).toBe(false)
    expect(action(moderate, 'auto_hide')).toBe('Auto-hidden: threats/slurs')
    const lenient = tagComment('I will hurt you', null, null, 'lenient')
    expect(lenient.isHidden).toBe(false); expect(lenient.isDeleted).toBe(false)
    expect(action(lenient, 'review')).toBe('Flagged for review: threats/slurs')
    expect(types(moderate)).toContain('slur')
    expect(moderate.flags.find(f => f.type === 'slur')!.severity).toBe('severe')
  })
  it('severe non-threat content: strict hides, others review; rude → review', () => {
    expect(tagComment('graphic severe thing', null, null, 'strict').isHidden).toBe(true)
    expect(action(tagComment('graphic severe thing'), 'review')).toBe('Flagged for review: severe content')
    expect(action(tagComment('shut up idiot'), 'review')).toBe('Flagged for review')
    expect(tagComment('shut up idiot').isHidden).toBe(false)
  })
  it('AI moderation scores: threat/hate, toxic, borderline, sexual — with the same sensitivity ladder and no double-flagging', () => {
    // ModerationScore has more fields than these tests exercise; build the four
    // we drive and cast through unknown (the module only reads these keys).
    const m = (o: Record<string, number>) => ({ threat: 0, identity: 0, toxicity: 0, sexual: 0, ...o }) as unknown as NonNullable<Parameters<typeof tagComment>[2]>
    expect(tagComment('fine words', null, m({ threat: 0.9 }), 'strict').isDeleted).toBe(true)
    expect(action(tagComment('fine words', null, m({ threat: 0.9 }), 'strict'), 'auto_delete')).toBe('Auto-deleted: threat (AI)')
    const hate = tagComment('fine words', null, m({ identity: 0.6 }))
    expect(hate.isHidden).toBe(true); expect(action(hate, 'auto_hide')).toBe('Auto-hidden: hate speech (AI)')
    expect(action(tagComment('fine words', null, m({ identity: 0.6 }), 'lenient'), 'review')).toBe('Flagged for review: hate speech (AI)')
    expect(tagComment('fine words', null, m({ toxicity: 0.8 }), 'strict').isHidden).toBe(true)
    expect(action(tagComment('fine words', null, m({ toxicity: 0.8 })), 'review')).toBe('Flagged for review: toxic content (AI)')
    expect(action(tagComment('fine words', null, m({ toxicity: 0.5 })), 'review')).toBe('Flagged for review: borderline toxic (AI)')
    // borderline does not add a second review flag when one exists already
    const rudeBorderline = tagComment('shut up idiot', null, m({ toxicity: 0.5 }))
    expect(rudeBorderline.flags.filter(f => f.type === 'review')).toHaveLength(1)
    expect(tagComment('fine words', null, m({ sexual: 0.7 }), 'strict').isHidden).toBe(true)
    expect(action(tagComment('fine words', null, m({ sexual: 0.7 })), 'review')).toBe('Flagged for review: sexual content (AI)')
    // already hidden by the regex guard → the AI pass adds nothing
    const both = tagComment('I will hurt you', null, m({ threat: 0.9 }))
    expect(both.flags.filter(f => f.type === 'auto_hide')).toHaveLength(1)
  })
})

describe('tagComment — spam, competitor, intents, topics, off-topic, emotion', () => {
  it('spam: a URL alone is fine; URL + promo, promo alone, ALL CAPS, or !!!! hide the comment', () => {
    expect(types(tagComment('see https://example.com for the agenda about parking'))).not.toContain('spam')
    const promo = tagComment('Click here https://x.y to buy now')
    expect(types(promo)).toContain('spam'); expect(promo.isHidden).toBe(true)
    expect(types(tagComment('limited time offer on rent'))).toContain('spam')
    expect(types(tagComment('DM me for the proven system'))).toContain('spam')
    expect(types(tagComment('THIS IS THE BEST CANDIDATE EVER SEEN'))).toContain('spam')
    expect(types(tagComment('what????? about parking'))).toContain('spam')
    expect(types(tagComment('short CAPS'))).not.toContain('spam')          // under 20 chars → caps rule skipped
  })
  it('competitor mentions are flagged without moderation', () => {
    const r = tagComment('we used SurveyMonkey for this in the city')
    expect(action(r, 'competitor')).toBe('Competitor mention detected')
    expect(r.isHidden).toBe(false)
  })
  it('intents: donate / volunteer / event, each with a flag', () => {
    const r = tagComment('I want to donate and volunteer at the rally for the city')
    expect(r.intents).toEqual(['donate', 'volunteer', 'event'])
    expect(action(r, 'intent')).toBe('Donate intent detected')
    expect(r.flags.filter(f => f.type === 'intent')).toHaveLength(3)
  })
  it('topics from the keyword lexicon; multi-topic comments list all', () => {
    const r = tagComment('Traffic downtown is awful and the schools need teachers; rent is unaffordable')
    expect(r.topics.sort()).toEqual(['education', 'housing', 'transportation'])
    expect(action(r, 'topics')).toBe('Topics: housing, education, transportation')
    expect(types(r)).not.toContain('off_topic')
  })
  it('off-topic only when no topic, no campaign words, and <2 content words shared with the post; hidden comments are not also off-topic', () => {
    expect(types(tagComment('nice weather today'))).toContain('off_topic')
    expect(types(tagComment('nice weather, vote tomorrow'))).not.toContain('off_topic')              // campaign word
    expect(types(tagComment('great picnic at the lake', 'Join our picnic at the lake this Sunday'))).not.toContain('off_topic')   // 2 shared words
    expect(types(tagComment('great picnic today', 'Join our picnic at the lake this Sunday'))).toContain('off_topic')             // only 1 shared
    expect(types(tagComment('THIS IS OFF TOPIC SPAM CAPS'))).not.toContain('off_topic')             // hidden as spam first
  })
  it('emotion ladder (first match wins) and neutral default', () => {
    expect(tagComment('I love this plan').emotion).toBe('enthusiastic')
    expect(tagComment('I am furious about the hate here').emotion).toBe('angry')
    expect(tagComment('worried about crime').emotion).toBe('worried')
    expect(tagComment('so disappointed by the council').emotion).toBe('frustrated')
    expect(tagComment('curious how this works').emotion).toBe('curious')
    expect(tagComment('I hope the vote passes').emotion).toBe('hopeful')
    const n = tagComment('the meeting is at noon at city hall')
    expect(n.emotion).toBe('neutral'); expect(types(n)).not.toContain('emotion')
    expect(action(tagComment('I love this plan'), 'emotion')).toBe('Emotion: enthusiastic')
  })
  it('carries the guard’s sentiment label and score; the re-export works', () => {
    const r = tagComment('This is terrible and I am furious')
    expect(r.sentiment).toBe('negative'); expect(r.sentimentScore).toBe(-0.7)
    expect(scoreSentiment('Thank you for all you do!')).toBe('positive')
  })
})

describe('routeResponse', () => {
  it('deleted / hidden → silent; review → human; off-topic → redirect template with name and topic injected', () => {
    expect(routeResponse(tagComment('I will hurt you', null, null, 'strict'))).toEqual({ route: 'silent', response: null, reason: 'Auto-deleted' })
    expect(routeResponse(tagComment('you people are the worst'))).toEqual({ route: 'silent', response: null, reason: 'Auto-hidden' })
    expect(routeResponse(tagComment('shut up idiot'))).toEqual({ route: 'review', response: null, reason: 'Flagged for human review' })
    const off = routeResponse(tagComment('nice weather today'), 'Sam', 'parking')
    expect(off.route).toBe('template'); expect(off.reason).toBe('Off-topic redirect')
    expect(off.response).toContain('Sam'); expect(off.response).toContain('parking'); expect(off.response).not.toContain('[')
    const anon = routeResponse(tagComment('nice weather today'))
    expect(anon.response).not.toContain('['); expect(anon.response).not.toMatch(/\s{2,}/); expect(anon.response).not.toMatch(/,\s*!/)
  })
  it('positive + intent → the intent template with a [url] slot; simple positive → acknowledgment; on-topic or negative → AI', () => {
    const donate = routeResponse(tagComment('Happy to donate to the campaign, where do I chip in?'), 'Ana')
    expect(donate).toMatchObject({ route: 'template', reason: 'Positive + intent' })
    expect(donate.response).toContain('[url]'); expect(donate.response).toContain('Ana')
    const vol = routeResponse(tagComment('I love this campaign and want to volunteer this weekend'))
    expect(vol.reason).toBe('Positive + intent'); expect(vol.response).toContain('[url]')
    const ack = routeResponse(tagComment('Thank you for all you do for the city!'), 'Bo')
    expect(ack).toMatchObject({ route: 'template', reason: 'Positive acknowledgment' })
    expect(ack.response).toContain('Bo')
    expect(routeResponse(tagComment('I love the new bike lane downtown'))).toEqual({ route: 'ai', response: null, reason: 'Needs AI: complex/on-topic' })
    expect(routeResponse(tagComment('The traffic downtown is terrible and I am furious'))).toEqual({ route: 'ai', response: null, reason: 'Needs AI: negative sentiment' })   // on-topic → not off_topic → AI
  })
})
