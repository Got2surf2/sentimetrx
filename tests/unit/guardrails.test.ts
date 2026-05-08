import { describe, it, expect } from 'vitest'
import {
  isInputSafe,
  isOutputSafe,
  isOutputClean,
  looksLikeAIRefusal,
} from '@/lib/guardrails'

describe('guardrails — input', () => {
  it('rejects empty / whitespace input', () => {
    expect(isInputSafe('')).toBe(false)
    expect(isInputSafe('  ')).toBe(false)
  })

  it('rejects input over the max length', () => {
    expect(isInputSafe('a'.repeat(601))).toBe(false)
    expect(isInputSafe('a'.repeat(599))).toBe(true)
  })

  it('rejects profanity / slurs / violence / sexual content', () => {
    expect(isInputSafe('what the fuck is this')).toBe(false)
    expect(isInputSafe('I want to kill the policy')).toBe(false)
    expect(isInputSafe('show me porn')).toBe(false)
  })

  it('rejects URL spam', () => {
    expect(isInputSafe('check out https://malicious.example')).toBe(false)
  })

  it('accepts ordinary feedback', () => {
    expect(isInputSafe('I like the new dashboard but the export is slow')).toBe(true)
  })
})

describe('guardrails — output', () => {
  it('isOutputSafe accepts a clean question', () => {
    expect(isOutputSafe('What did you find most useful about the experience?')).toBe(true)
  })

  it('isOutputSafe rejects non-questions', () => {
    expect(isOutputSafe('You should buy our product right now.')).toBe(false)
  })

  it('isOutputSafe rejects too short / too long output', () => {
    expect(isOutputSafe('Why?')).toBe(false)
    expect(isOutputSafe('a'.repeat(201) + '?')).toBe(false)
  })

  it('isOutputClean accepts a normal sentence under length', () => {
    expect(isOutputClean('Thanks for sharing — that helps a lot.')).toBe(true)
  })

  it('output guards reject content matching skip patterns', () => {
    expect(isOutputSafe('What the fuck did you mean?')).toBe(false)
    expect(isOutputClean('Go shoot something.')).toBe(false)
  })
})

describe('guardrails — AI refusal detection', () => {
  it('flags a typical model refusal', () => {
    expect(
      looksLikeAIRefusal(
        "I appreciate the request, but I can't role-play this character — it conflicts with my values.",
      ),
    ).toBe(true)
  })

  it('flags "as an AI language model" preambles', () => {
    expect(looksLikeAIRefusal('As an AI language model, I cannot help with that.')).toBe(true)
  })

  it('does not flag legitimate community-meeting prose', () => {
    expect(
      looksLikeAIRefusal(
        'I think the new park hours are reasonable, though families with young kids might prefer earlier closing.',
      ),
    ).toBe(false)
  })

  it('returns false for empty input', () => {
    expect(looksLikeAIRefusal('')).toBe(false)
  })
})
