import { describe, it, expect } from 'vitest'
import {
  isInputSafe,
  isOutputSafe,
  isOutputClean,
  looksLikeAIRefusal,
  cleanDeflectResponse,
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

// CRITICAL — these check the deflection-response sanitizer. Anything that
// returns `deflection: <text>` from cleanDeflectResponse lands verbatim in
// the bot's reply to an end user. Treat the failure mode like a security
// incident; if a meta-prompt phrase slips past, expand the regex and add
// the exact phrase here so regressions stay caught.
describe('cleanDeflectResponse — meta-prompt leakage prevention', () => {
  it('treats NONE as no deflection', () => {
    expect(cleanDeflectResponse('NONE').deflection).toBeNull()
    expect(cleanDeflectResponse('  NONE  ').deflection).toBeNull()
    expect(cleanDeflectResponse('NONE — user gave clear feedback').deflection).toBeNull()
  })

  it('passes through a legitimate redirect message', () => {
    const out = cleanDeflectResponse("Got it. Let's bring it back to the season schedule.")
    // Phrase still trimmed/cleaned but a deflection should come back non-null.
    expect(out.deflection).not.toBeNull()
    expect(out.deflection?.length).toBeGreaterThan(5)
  })

  // 2026-05-11 incident: TGL bot leaked an evaluator-style response into
  // the chat. This exact phrase must be filtered.
  it("blocks the 2026-05-11 TGL incident phrase", () => {
    expect(cleanDeflectResponse(
      "I'm ready to help. Please provide the user's message that needs evaluation."
    ).deflection).toBeNull()
  })

  it('blocks meta-prompt scaffolding phrases', () => {
    const phrases = [
      "I'm ready to help. Please provide the user's message.",
      'Please provide the message you want me to evaluate.',
      'Awaiting your input.',
      'I am ready to evaluate the message.',
      'Share the message you want classified.',
      'Here is the message to evaluate.',
      'Paste the message you want analyzed.',
    ]
    for (const p of phrases) {
      expect(cleanDeflectResponse(p).deflection, p).toBeNull()
    }
  })
})
