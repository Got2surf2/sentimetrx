import { describe, it, expect, vi, beforeEach } from 'vitest'

const callAI = vi.fn()

vi.mock('@/lib/ai', () => ({
  callAI: (...args: unknown[]) => callAI(...args),
}))

vi.mock('@/lib/usageLog', () => ({
  logUsage: vi.fn(),
}))

import { extractName } from '@/lib/nameExtractor'

const EMPTY = { name: null, source: null, confidence: null }

describe('extractName — input gating', () => {
  beforeEach(() => callAI.mockReset())

  it('returns empty for empty array', async () => {
    expect(await extractName([])).toEqual(EMPTY)
    expect(callAI).not.toHaveBeenCalled()
  })

  it('returns empty when every message is below the 3-char floor', async () => {
    expect(await extractName(['', '  ', 'hi'])).toEqual(EMPTY)
    expect(callAI).not.toHaveBeenCalled()
  })

  it('returns empty when joined corpus is under 10 chars', async () => {
    expect(await extractName(['ok ', 'yes'])).toEqual(EMPTY)
    expect(callAI).not.toHaveBeenCalled()
  })

  it('calls the AI once joined corpus crosses the 10-char threshold', async () => {
    callAI.mockResolvedValue({ text: '{"name":null,"source":null,"confidence":null}' })
    await extractName(['Hello there, this is my long message.'])
    expect(callAI).toHaveBeenCalledTimes(1)
  })
})

describe('extractName — parsing & defense-in-depth', () => {
  beforeEach(() => callAI.mockReset())

  it('returns a clean self-id with source + confidence', async () => {
    callAI.mockResolvedValue({ text: '{"name":"Sarah","source":"self_id","confidence":"high"}' })
    const out = await extractName(["I'm Sarah and I work in finance"])
    expect(out).toEqual({ name: 'Sarah', source: 'self_id', confidence: 'high' })
  })

  it('extracts JSON even when wrapped in markdown fences or prose', async () => {
    callAI.mockResolvedValue({ text: 'Here you go:\n```json\n{"name":"Mike","source":"self_id","confidence":"medium"}\n```' })
    const out = await extractName(['Mike here, just signed up.'])
    expect(out.name).toBe('Mike')
    expect(out.confidence).toBe('medium')
  })

  it('rejects fake names that look right but match the bad-word denylist', async () => {
    callAI.mockResolvedValue({ text: '{"name":"Anonymous","source":"inferred","confidence":"low"}' })
    expect(await extractName(['hi from Anonymous'])).toEqual(EMPTY)
  })

  it('rejects names that fail the capitalized-alpha regex (sentence fragment leakage)', async () => {
    callAI.mockResolvedValue({ text: '{"name":"i am the user","source":"inferred","confidence":"low"}' })
    expect(await extractName(['i am the user'])).toEqual(EMPTY)
  })

  it('rejects names over 30 chars', async () => {
    callAI.mockResolvedValue({ text: '{"name":"Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","source":"self_id","confidence":"low"}' })
    expect(await extractName(['hi from a very long name'])).toEqual(EMPTY)
  })

  it('accepts hyphenated / apostrophe names (lowercase after the punctuation)', async () => {
    // The regex `^[A-Z][a-z'-]{1,29}$` permits hyphen + apostrophe only as
    // ordinary lowercase-class characters. "Mary-jane" matches, but "Mary-Jane"
    // (re-capitalised) does NOT — this codifies the current behaviour.
    callAI.mockResolvedValue({ text: '{"name":"Mary-jane","source":"self_id","confidence":"high"}' })
    expect((await extractName(["My friends call me Mary-jane"])).name).toBe('Mary-jane')

    callAI.mockResolvedValue({ text: '{"name":"O\'brien","source":"self_id","confidence":"high"}' })
    expect((await extractName(["I go by O'brien"])).name).toBe("O'brien")
  })

  it('normalises invalid source / confidence enums to null', async () => {
    callAI.mockResolvedValue({ text: '{"name":"Dave","source":"guess","confidence":"super-high"}' })
    const out = await extractName(['Dave here, signing in for the demo'])
    expect(out.name).toBe('Dave')
    expect(out.source).toBe(null)
    expect(out.confidence).toBe(null)
  })

  it('returns empty when AI returns no JSON object at all', async () => {
    callAI.mockResolvedValue({ text: 'sorry I cannot help' })
    expect(await extractName(['Hello there my name is Sarah'])).toEqual(EMPTY)
  })

  it('returns empty when callAI rejects', async () => {
    callAI.mockImplementationOnce(async () => { throw new Error('timeout') })
    expect(await extractName(['Hello there my name is Sarah'])).toEqual(EMPTY)
  })

  it('returns empty when AI returns malformed JSON', async () => {
    callAI.mockResolvedValue({ text: '{name: "Sarah"' })
    expect(await extractName(['Hello there my name is Sarah'])).toEqual(EMPTY)
  })
})
