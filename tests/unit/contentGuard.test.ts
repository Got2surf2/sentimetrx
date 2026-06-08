import { describe, it, expect, beforeEach } from 'vitest'
import {
  checkMessage, bleepText, isContentSafe, auditContent, auditConversationLog,
  getStrikes, resetStrikes, CONTENT_SAFETY_DEFAULTS,
} from '@/lib/contentGuard'

// Moderation pipeline (severity tiers, strike escalation, self-harm routing,
// audit flags). Sentiment scoring is covered separately in sentiment-slang.test.

describe('contentGuard — checkMessage gating', () => {
  it('passes clean text with a bleeped copy', () => {
    const r = checkMessage('clean', 'I really love this product')
    expect(r.safe).toBe(true)
    expect(r.bleeped).toBe('I really love this product')
  })

  it('rejects empty and over-length input', () => {
    expect(checkMessage('x', '   ').category).toBe('empty')
    expect(checkMessage('x', 'a'.repeat(2000)).category).toBe('too_long')
  })

  it('mild profanity passes but is tagged', () => {
    const r = checkMessage('mild-user', 'this is crap')
    expect(r.safe).toBe(true)
    expect(r.severity).toBe('mild')
  })

  it('rude insults pass with a nudge', () => {
    const r = checkMessage('rude-user', 'you are an idiot')
    expect(r.safe).toBe(true)
    expect(r.severity).toBe('rude')
    expect(r.nudge).toBe(true)
  })
})

describe('contentGuard — strike escalation', () => {
  beforeEach(() => resetStrikes('sev-user'))

  it('escalates severe violations over three strikes to a shutdown', () => {
    const first = checkMessage('sev-user', 'fuck you')
    expect(first.safe).toBe(false)
    expect(first.severity).toBe('severe')
    expect(first.strikes).toBe(1)

    const second = checkMessage('sev-user', 'fuck you')
    expect(second.strikes).toBe(2)
    expect(second.shutdown).toBeFalsy()

    const third = checkMessage('sev-user', 'fuck you')
    expect(third.strikes).toBe(3)
    expect(third.shutdown).toBe(true)
  })

  it('getStrikes / resetStrikes track and clear counts', () => {
    checkMessage('sev-user', 'fuck you')
    expect(getStrikes('sev-user')).toBeGreaterThan(0)
    resetStrikes('sev-user')
    expect(getStrikes('sev-user')).toBe(0)
  })
})

describe('contentGuard — self-harm routing', () => {
  it('returns crisis resources without counting a strike', () => {
    resetStrikes('sh-user')
    const r = checkMessage('sh-user', 'I want to kill myself')
    expect(r.safe).toBe(false)
    expect(r.category).toBe('self_harm')
    expect(r.warning).toMatch(/988/)
    expect(getStrikes('sh-user')).toBe(0)
  })
})

describe('contentGuard — bleepText', () => {
  it('masks the middle of a flagged word', () => {
    expect(bleepText('this is shit')).toBe('this is s**t')
  })

  it('returns text unchanged when safety is disabled', () => {
    expect(bleepText('shit', { ...CONTENT_SAFETY_DEFAULTS, enabled: false })).toBe('shit')
  })
})

describe('contentGuard — isContentSafe (legacy)', () => {
  it('passes clean text and blocks severe content', () => {
    resetStrikes('_anon')
    expect(isContentSafe('a perfectly nice message')).toBe(true)
    expect(isContentSafe('go to hell')).toBe(false)
    resetStrikes('_anon')
  })
})

describe('contentGuard — audit mode', () => {
  it('collects flags and max severity without blocking', () => {
    const r = auditContent('you are an idiot and this is shit')
    expect(r.flags).toContain('insult')
    expect(r.flags).toContain('profanity')
    expect(r.maxSeverity).toBe('rude')
  })

  it('flags severe profanity at the severe tier', () => {
    expect(auditContent('fuck this').maxSeverity).toBe('severe')
  })

  it('returns no flags for trivial input', () => {
    expect(auditContent('').flags).toEqual([])
    expect(auditContent('').maxSeverity).toBeNull()
  })

  it('auditConversationLog scans user turns only', () => {
    const r = auditConversationLog([
      { who: 'user', text: 'you idiot' },
      { who: 'bot', text: 'fuck' },          // bot turn ignored
      { who: 'user', text: 'this is fine' },
    ])
    expect(r.flags).toContain('insult')
    expect(r.flags).not.toContain('profanity')
  })
})
