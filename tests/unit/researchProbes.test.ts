import { describe, it, expect } from 'vitest'
import {
  enabledProbes, probeHashBucket, inFieldWindow, assignProbe, isEligibleNow,
  buildProbeInstruction, detectVerbatimDelivery, classifyProbeAnswer, codeYesNo,
  type ResearchProbe,
} from '@/lib/researchProbes'

const probe = (over: Partial<ResearchProbe> = {}): ResearchProbe => ({
  id: 'renewal_feeling',
  version: 1,
  mode: 'verbatim',
  question: 'If you were starting this season over today, would you get the games the same way?',
  sampling: { sample_pct: 100 },
  ...over,
})

const NOW = new Date('2026-07-06T12:00:00Z')

describe('enabledProbes', () => {
  it('filters malformed and disabled entries', () => {
    const bot = { research_probes: [
      probe(),
      probe({ id: 'off', enabled: false }),
      { id: 'no_question', version: 1, mode: 'verbatim' },
      { question: 'orphan', mode: 'verbatim' },
      'junk', null,
    ] }
    expect(enabledProbes(bot as never).map(p => p.id)).toEqual(['renewal_feeling'])
  })
  it('handles missing/non-array column', () => {
    expect(enabledProbes({})).toEqual([])
    expect(enabledProbes({ research_probes: 'nope' } as never)).toEqual([])
  })
})

describe('probeHashBucket / assignProbe', () => {
  it('is deterministic and in 0..99', () => {
    for (const sid of ['a', 'session-123', 'bs_xyz_999']) {
      const b = probeHashBucket(sid, 'p1')
      expect(b).toBe(probeHashBucket(sid, 'p1'))
      expect(b).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThan(100)
    }
    expect(probeHashBucket('s1', 'p1')).not.toBe(probeHashBucket('s1', 'p2')) // probe id shifts the draw
  })
  it('sample_pct 0 assigns nobody, 100 everybody', () => {
    expect(assignProbe([probe({ sampling: { sample_pct: 0 } })], 's1', NOW)).toBeNull()
    expect(assignProbe([probe({ sampling: { sample_pct: 100 } })], 's1', NOW)?.id).toBe('renewal_feeling')
  })
  it('roughly honors the sampling rate', () => {
    const p = probe({ sampling: { sample_pct: 25 } })
    let wins = 0
    for (let i = 0; i < 1000; i++) if (assignProbe([p], 'session-' + i, NOW)) wins++
    expect(wins).toBeGreaterThan(150)
    expect(wins).toBeLessThan(350)
  })
  it('first hash-winning probe in config order wins', () => {
    const a = probe({ id: 'a', sampling: { sample_pct: 100 } })
    const b = probe({ id: 'b', sampling: { sample_pct: 100 } })
    expect(assignProbe([a, b], 's1', NOW)?.id).toBe('a')
  })
  it('respects the field window', () => {
    expect(inFieldWindow(probe({ sampling: { sample_pct: 100, field_start: '2026-08-01' } }), NOW)).toBe(false)
    expect(inFieldWindow(probe({ sampling: { sample_pct: 100, field_end: '2026-07-01' } }), NOW)).toBe(false)
    expect(inFieldWindow(probe({ sampling: { sample_pct: 100, field_start: '2026-07-01', field_end: '2026-07-31' } }), NOW)).toBe(true)
    expect(assignProbe([probe({ sampling: { sample_pct: 100, field_start: '2026-08-01' } })], 's1', NOW)).toBeNull()
  })
})

describe('isEligibleNow', () => {
  const base = { userTurnCount: 5, lastSentimentNegative: false, topics: new Set<string>(), channel: 'web' }
  it('enforces min_user_turns (default 3)', () => {
    expect(isEligibleNow(probe(), { ...base, userTurnCount: 2 })).toBe(false)
    expect(isEligibleNow(probe(), { ...base, userTurnCount: 3 })).toBe(true)
    expect(isEligibleNow(probe({ eligibility: { min_user_turns: 1 } }), { ...base, userTurnCount: 1 })).toBe(true)
  })
  it('sentiment gate defaults ON, can be disabled', () => {
    expect(isEligibleNow(probe(), { ...base, lastSentimentNegative: true })).toBe(false)
    expect(isEligibleNow(probe({ eligibility: { sentiment_gate: false } }), { ...base, lastSentimentNegative: true })).toBe(true)
  })
  it('topic triggers require a hit; exclusions veto', () => {
    expect(isEligibleNow(probe({ eligibility: { topic_triggers: ['renewal'] } }), base)).toBe(false)
    expect(isEligibleNow(probe({ eligibility: { topic_triggers: ['renewal'] } }), { ...base, topics: new Set(['renewal']) })).toBe(true)
    expect(isEligibleNow(probe({ eligibility: { topic_exclusions: ['complaint'] } }), { ...base, topics: new Set(['complaint']) })).toBe(false)
  })
  it('channel allow-list', () => {
    expect(isEligibleNow(probe({ eligibility: { channels: ['kiosk'] } }), base)).toBe(false)
    expect(isEligibleNow(probe({ eligibility: { channels: ['web', 'kiosk'] } }), base)).toBe(true)
  })
})

describe('buildProbeInstruction', () => {
  it('verbatim pins the exact sentence; follow_up toggles the rule', () => {
    const s = buildProbeInstruction(probe({ follow_up: 1 }))
    expect(s).toContain('EXACTLY')
    expect(s).toContain(probe().question)
    expect(s).toContain('ONE short neutral clarifying follow-up')
    expect(buildProbeInstruction(probe())).toContain('Do NOT ask any follow-up')
  })
  it('concept mode hands over the construct', () => {
    const s = buildProbeInstruction(probe({ mode: 'concept', construct: 'latent regret about auto-renewal' }))
    expect(s).toContain('latent regret about auto-renewal')
    expect(s).toContain('adapt freely')
  })
})

describe('detectVerbatimDelivery', () => {
  const q = probe().question
  it('matches through punctuation/case/whitespace noise', () => {
    expect(detectVerbatimDelivery('Mind if I ask one quick thing? ' + q, q)).toBe(true)
    expect(detectVerbatimDelivery(q.toUpperCase().replace('?', '??'), q)).toBe(true)
    expect(detectVerbatimDelivery('Thanks!  If you were starting this   season over today, would you get the games the same way? Anyway…', q)).toBe(true)
  })
  it('rejects paraphrases', () => {
    expect(detectVerbatimDelivery('Would you buy the games the same way again next season?', q)).toBe(false)
    expect(detectVerbatimDelivery('', q)).toBe(false)
  })
})

describe('classifyProbeAnswer / codeYesNo', () => {
  it('splits declines from answers', () => {
    expect(classifyProbeAnswer("I'd rather not say")).toBe('asked_declined')
    expect(classifyProbeAnswer('no thanks')).toBe('asked_declined')
    expect(classifyProbeAnswer('why do you ask?')).toBe('asked_declined')
    expect(classifyProbeAnswer('Honestly, probably not — the resale market was cheaper.')).toBe('asked_answered')
    expect(classifyProbeAnswer('')).toBe('asked_declined')
  })
  it('codes clear yes/no, null when unclear', () => {
    expect(codeYesNo('Yes, absolutely.')).toBe(true)
    expect(codeYesNo('nope, never again')).toBe(false)
    expect(codeYesNo('It depends on the schedule really')).toBeNull()
  })
})
