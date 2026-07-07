import { describe, it, expect, vi, beforeEach } from 'vitest'

const callAI = vi.fn()

vi.mock('@/lib/ai', () => ({
  callAI: (...args: unknown[]) => callAI(...args),
}))

vi.mock('@/lib/usageLog', () => ({
  logUsage: vi.fn(),
}))

import { extractPersona, mergePersona, personaToPromptContext } from '@/lib/personaExtractor'

describe('extractPersona', () => {
  beforeEach(() => {
    callAI.mockReset()
  })

  it('returns empty object on empty input', async () => {
    const result = await extractPersona([])
    expect(result).toEqual({})
    expect(callAI).not.toHaveBeenCalled()
  })

  it('parses well-formed JSON from the AI response', async () => {
    callAI.mockResolvedValue({
      text: '{"life_stage":{"value":"working parent","source":"explicit","confidence":"high"},"concerns":{"values":["traffic","schools"],"source":"explicit","confidence":"medium"}}',
    })
    const result = await extractPersona(['I have two kids and work full time'])
    expect(result.life_stage?.value).toBe('working parent')
    expect(result.concerns?.values).toEqual(['traffic', 'schools'])
  })

  it('handles missing fields without throwing', async () => {
    callAI.mockResolvedValue({ text: '{}' })
    const result = await extractPersona(['hello'])
    expect(result).toEqual({})
  })

  it('returns empty object when the AI returns non-JSON', async () => {
    callAI.mockResolvedValue({ text: 'sorry, I cannot do that' })
    const result = await extractPersona(['hello'])
    expect(result).toEqual({})
  })

  it('returns empty object when callAI rejects', async () => {
    callAI.mockRejectedValue(new Error('timeout'))
    const result = await extractPersona(['hello'])
    expect(result).toEqual({})
  })
})

describe('mergePersona / personaToPromptContext', () => {
  it('explicit fields override inferred ones', () => {
    const merged = mergePersona(
      { occupation: { value: 'engineer', source: 'inferred', confidence: 'low' } },
      { occupation: { value: 'nurse', source: 'explicit', confidence: 'high' } },
    )
    expect(merged.occupation?.value).toBe('nurse')
  })

  it('produces a readable prompt context block', () => {
    const ctx = personaToPromptContext({
      life_stage: { value: 'retiree', source: 'explicit', confidence: 'high' },
    })
    expect(ctx).toContain('Life stage: retiree')
    expect(ctx).toContain('USER PROFILE')
  })

  it('returns empty string when no fields are set', () => {
    expect(personaToPromptContext({})).toBe('')
  })
})
