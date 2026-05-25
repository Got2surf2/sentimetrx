import { describe, it, expect, vi, beforeEach } from 'vitest'

const callAI = vi.fn()

vi.mock('@/lib/ai', () => ({
  callAI: (...args: any[]) => callAI(...args),
}))

vi.mock('@/lib/usageLog', () => ({
  logUsage: vi.fn(),
}))

import { classifyProbeFocuses } from '@/lib/probeFocusClassifier'
import type { BotFocus } from '@/lib/focusClassifier'

const FOCUSES: BotFocus[] = [
  { slug: 'fees', label: 'Fees', description: 'Concerns about cost', enabled: true },
  { slug: 'safety', label: 'Safety', description: 'Concerns about physical safety', enabled: true },
  { slug: 'staff', label: 'Staff', description: 'Comments about employees', enabled: true },
] as any

describe('classifyProbeFocuses — gating', () => {
  beforeEach(() => callAI.mockReset())

  it('returns empty without calling AI when no focuses are enabled', async () => {
    const out = await classifyProbeFocuses([], 'this is a substantive user message about fees')
    expect(out).toEqual({ slugs: [], usage: undefined })
    expect(callAI).not.toHaveBeenCalled()
  })

  it('skips disabled focuses but still calls AI if at least one remains', async () => {
    callAI.mockResolvedValue({ text: 'fees' })
    const focusesWithDisabled: BotFocus[] = [
      { slug: 'fees', label: 'Fees', description: 'cost', enabled: true } as any,
      { slug: 'old', label: 'Old', description: 'retired', enabled: false } as any,
    ]
    const out = await classifyProbeFocuses(focusesWithDisabled, 'the fees were higher than I expected')
    expect(out.slugs).toEqual(['fees'])
    expect(callAI).toHaveBeenCalledTimes(1)
  })

  it('returns empty + skips AI when text is under 12 characters', async () => {
    const out = await classifyProbeFocuses(FOCUSES, 'hi there')
    expect(out).toEqual({ slugs: [], usage: undefined })
    expect(callAI).not.toHaveBeenCalled()
  })

  it('returns empty + skips AI when text has fewer than 3 words', async () => {
    const out = await classifyProbeFocuses(FOCUSES, 'aaaaaaaaaaaaaaaaaa') // 18 chars, 1 word
    expect(out).toEqual({ slugs: [], usage: undefined })
    expect(callAI).not.toHaveBeenCalled()
  })
})

describe('classifyProbeFocuses — AI response parsing', () => {
  beforeEach(() => callAI.mockReset())

  it('parses a single-slug response', async () => {
    callAI.mockResolvedValue({ text: 'fees', usage: { model: 'haiku', cost: 0.0001 } as any })
    const out = await classifyProbeFocuses(FOCUSES, 'the fees were way too high for the value')
    expect(out.slugs).toEqual(['fees'])
    expect(out.usage).toEqual({ model: 'haiku', cost: 0.0001 })
  })

  it('parses comma-separated multi-slug responses', async () => {
    callAI.mockResolvedValue({ text: 'fees, staff' })
    const out = await classifyProbeFocuses(FOCUSES, 'the fees were too high and staff were rude')
    expect(out.slugs).toEqual(['fees', 'staff'])
  })

  it('returns empty slugs for explicit NONE (case-insensitive)', async () => {
    callAI.mockResolvedValue({ text: 'NONE' })
    expect((await classifyProbeFocuses(FOCUSES, 'random small talk message')).slugs).toEqual([])

    callAI.mockResolvedValue({ text: 'none' })
    expect((await classifyProbeFocuses(FOCUSES, 'random small talk message')).slugs).toEqual([])
  })

  it('drops slugs that are not in the bot focus catalog', async () => {
    callAI.mockResolvedValue({ text: 'fees, payment, staff' }) // 'payment' is hallucinated
    const out = await classifyProbeFocuses(FOCUSES, 'fees too high and staff unhelpful')
    expect(out.slugs).toEqual(['fees', 'staff'])
  })

  it('dedupes slugs the model may have repeated', async () => {
    callAI.mockResolvedValue({ text: 'fees, fees, safety, fees' })
    const out = await classifyProbeFocuses(FOCUSES, 'fees fees fees and safety stuff')
    expect(out.slugs).toEqual(['fees', 'safety'])
  })

  it('tolerates messy output (brackets, quotes, newlines)', async () => {
    callAI.mockResolvedValue({ text: '["fees", \'safety\']\n' })
    const out = await classifyProbeFocuses(FOCUSES, 'this covers fees and safety concerns clearly')
    expect(out.slugs).toEqual(['fees', 'safety'])
  })

  it('returns empty slugs when AI throws', async () => {
    callAI.mockImplementationOnce(async () => { throw new Error('AI down') })
    const out = await classifyProbeFocuses(FOCUSES, 'this covers fees and safety')
    expect(out).toEqual({ slugs: [], usage: undefined })
  })

  it('returns empty slugs when AI returns whitespace / empty text', async () => {
    callAI.mockResolvedValue({ text: '   ' })
    const out = await classifyProbeFocuses(FOCUSES, 'this covers fees and safety')
    expect(out.slugs).toEqual([])
  })

  it('lowercase-matches even if the AI returns slugs in mixed case', async () => {
    callAI.mockResolvedValue({ text: 'FEES, Safety' })
    const out = await classifyProbeFocuses(FOCUSES, 'fees too high and safety questionable')
    expect(out.slugs).toEqual(['fees', 'safety'])
  })
})
