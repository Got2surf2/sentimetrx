// tests/unit/recordingsAnalyze.test.ts
//
// Covers the PM-1-critical logic in lib/recordings/analyze.ts: tolerant parsing
// of the Opus extraction + Sonnet curator JSON, the flag-merge precedence
// (curator flag beats low-confidence), emergent-topic override, and the
// two-pass / single-pass call shape. callAI is mocked — no network, no tokens.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ai', () => ({ callAI: vi.fn() }))

import { analyzeRecording, type AnalyzeInput } from '@/lib/recordings/analyze'
import { callAI } from '@/lib/ai'
import type { QaSetupInputs, QaPairPayload } from '@/lib/recordings/types'

const mockCallAI = vi.mocked(callAI)

function aiResponse(text: string, input_tokens = 1000, output_tokens = 2000) {
  return {
    text,
    stopReason: 'end_turn' as const,
    usage: {
      input_tokens,
      output_tokens,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      model: 'test',
      provider: 'anthropic' as const,
      tier: 'advanced' as const,
    },
  }
}

const setup: QaSetupInputs = { panel: [{ name: 'Jane' }], agenda: ['Parking', 'Budget'] }

function baseInput(over: Partial<AnalyzeInput> = {}): AnalyzeInput {
  return {
    recording_id: 'rec_1',
    org_id: 'org_1',
    session_type: 'qa',
    setup_inputs: setup,
    transcript: [{ start: 0, end: 5, text: 'hello' }],
    ...over,
  }
}

function opusDraft(over: Record<string, unknown> = {}) {
  const payload: QaPairPayload = {
    question: 'How much parking?', answer: 'Two levels.',
    asker_name: 'Bob', panelist_name: 'Jane', question_typology: 'ask',
  }
  return { topic: 'Parking', payload, start_sec: 10.4, end_sec: 20.6, confidence: 0.9, ...over }
}

beforeEach(() => {
  mockCallAI.mockReset()
})

describe('analyzeRecording — session_type guard', () => {
  it('throws for non-qa session types (v1 only supports qa)', async () => {
    await expect(analyzeRecording(baseInput({ session_type: 'interview' })))
      .rejects.toThrow(/not implemented in v1/)
    expect(mockCallAI).not.toHaveBeenCalled()
  })
})

describe('analyzeRecording — parsing the Opus extraction', () => {
  it('drops drafts with an invalid typology or a missing question/answer', async () => {
    const opus = JSON.stringify({
      extractions: [
        opusDraft(),                                                           // valid
        opusDraft({ payload: { ...opusDraft().payload, question_typology: 'rant' } }), // bad typology
        opusDraft({ payload: { ...opusDraft().payload, answer: '' } }),        // missing answer
      ],
    })
    mockCallAI.mockResolvedValueOnce(aiResponse(opus))           // Opus
                .mockResolvedValueOnce(aiResponse('{"reviews":[]}')) // Sonnet

    const { extractions } = await analyzeRecording(baseInput())
    expect(extractions).toHaveLength(1)
    expect(extractions[0].payload).toMatchObject({ question: 'How much parking?', answer: 'Two levels.' })
  })

  it('tolerates a markdown-fenced JSON response', async () => {
    const fenced = '```json\n' + JSON.stringify({ extractions: [opusDraft()] }) + '\n```'
    mockCallAI.mockResolvedValueOnce(aiResponse(fenced))
                .mockResolvedValueOnce(aiResponse('{"reviews":[]}'))
    const { extractions } = await analyzeRecording(baseInput())
    expect(extractions).toHaveLength(1)
  })

  it('rounds start/end and sets a 0-based sort_order per draft', async () => {
    const opus = JSON.stringify({ extractions: [opusDraft(), opusDraft({ start_sec: 99.9, end_sec: 120.1 })] })
    mockCallAI.mockResolvedValueOnce(aiResponse(opus)).mockResolvedValueOnce(aiResponse('{"reviews":[]}'))
    const { extractions } = await analyzeRecording(baseInput())
    expect(extractions[0]).toMatchObject({ start_sec: 10, end_sec: 21, sort_order: 0 })
    expect(extractions[1]).toMatchObject({ start_sec: 100, end_sec: 120, sort_order: 1 })
  })
})

describe('analyzeRecording — flag merge + topic override', () => {
  it('auto-flags low confidence (<0.65) as low_confidence', async () => {
    const opus = JSON.stringify({ extractions: [opusDraft({ confidence: 0.5 })] })
    mockCallAI.mockResolvedValueOnce(aiResponse(opus)).mockResolvedValueOnce(aiResponse('{"reviews":[]}'))
    const { extractions } = await analyzeRecording(baseInput())
    expect(extractions[0]).toMatchObject({ flagged_for_review: true, flag_reason: 'low_confidence' })
  })

  it('curator flag takes precedence over low_confidence', async () => {
    const opus = JSON.stringify({ extractions: [opusDraft({ confidence: 0.5 })] })
    const sonnet = JSON.stringify({ reviews: [{ draft_index: 0, flag: true, reason: 'panel-to-panel', topic: 'Access' }] })
    mockCallAI.mockResolvedValueOnce(aiResponse(opus)).mockResolvedValueOnce(aiResponse(sonnet))
    const { extractions } = await analyzeRecording(baseInput())
    expect(extractions[0]).toMatchObject({ flagged_for_review: true, flag_reason: 'curator_questioned' })
  })

  it('uses the curator emergent topic over the draft topic', async () => {
    const opus = JSON.stringify({ extractions: [opusDraft({ topic: 'Parking' })] })
    const sonnet = JSON.stringify({ reviews: [{ draft_index: 0, flag: false, topic: 'Parking & Access' }] })
    mockCallAI.mockResolvedValueOnce(aiResponse(opus)).mockResolvedValueOnce(aiResponse(sonnet))
    const { extractions } = await analyzeRecording(baseInput())
    expect(extractions[0].topic).toBe('Parking & Access')
    expect(extractions[0].flagged_for_review).toBe(false)
  })
})

describe('analyzeRecording — pass orchestration + cost', () => {
  it('skips the curator pass when there are no drafts', async () => {
    mockCallAI.mockResolvedValueOnce(aiResponse('{"extractions":[]}'))
    const { extractions, total_cost_cents } = await analyzeRecording(baseInput())
    expect(extractions).toEqual([])
    expect(mockCallAI).toHaveBeenCalledTimes(1)   // Opus only
    expect(total_cost_cents).toBe(17)             // Opus tokens only, no curator budget
  })

  it('runs both passes and adds the curator budget once reviews come back', async () => {
    const opus = JSON.stringify({ extractions: [opusDraft()] })
    const sonnet = JSON.stringify({ reviews: [{ draft_index: 0, flag: false, topic: 'Parking' }] })
    mockCallAI.mockResolvedValueOnce(aiResponse(opus)).mockResolvedValueOnce(aiResponse(sonnet))
    const { total_cost_cents } = await analyzeRecording(baseInput())
    expect(mockCallAI).toHaveBeenCalledTimes(2)
    expect(total_cost_cents).toBe(37)             // 17 Opus + 20 curator budget (reviews parsed)
  })

  it('omits the curator budget when the pass runs but returns no parseable reviews', async () => {
    const opus = JSON.stringify({ extractions: [opusDraft()] })
    mockCallAI.mockResolvedValueOnce(aiResponse(opus)).mockResolvedValueOnce(aiResponse('{"reviews":[]}'))
    const { total_cost_cents } = await analyzeRecording(baseInput())
    expect(mockCallAI).toHaveBeenCalledTimes(2)
    expect(total_cost_cents).toBe(17)             // budget is keyed on reviews parsed, not pass run
  })
})
