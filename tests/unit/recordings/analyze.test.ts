// tests/unit/recordingsAnalyze.test.ts
//
// Covers the PM-1-critical logic in lib/recordings/analyze.ts: tolerant parsing
// of the Opus extraction + Sonnet curator JSON, the flag-merge precedence
// (curator flag beats low-confidence), emergent-topic override, and the
// two-pass / single-pass call shape. callAI is mocked — no network, no tokens.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/ai', () => ({ callAI: vi.fn() }))

import { analyzeRecording, overallSentiment, type AnalyzeInput } from '@/lib/recordings/analyze'
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
  // Default for any unmocked call (notably the third synthesis pass, which
  // fires whenever there's ≥1 published pair). '{}' parses to an empty summary
  // with no action items, so tests that don't care about synthesis are
  // unaffected in their extraction assertions.
  mockCallAI.mockResolvedValue(aiResponse('{}'))
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

  it('runs all four passes and adds curator + synthesis + polish budget once reviews come back', async () => {
    const opus = JSON.stringify({ extractions: [opusDraft()] })
    const sonnet = JSON.stringify({ reviews: [{ draft_index: 0, flag: false, topic: 'Parking' }] })
    mockCallAI.mockResolvedValueOnce(aiResponse(opus)).mockResolvedValueOnce(aiResponse(sonnet))
    const { total_cost_cents } = await analyzeRecording(baseInput())
    expect(mockCallAI).toHaveBeenCalledTimes(4)   // Opus + curator + synthesis + polish (1 pair)
    expect(total_cost_cents).toBe(87)             // 17 Opus + 20 curator + 25 synthesis + 25 polish
  })

  it('omits the curator budget when the pass runs but returns no parseable reviews', async () => {
    const opus = JSON.stringify({ extractions: [opusDraft()] })
    mockCallAI.mockResolvedValueOnce(aiResponse(opus)).mockResolvedValueOnce(aiResponse('{"reviews":[]}'))
    const { total_cost_cents } = await analyzeRecording(baseInput())
    expect(mockCallAI).toHaveBeenCalledTimes(4)   // Opus + curator + synthesis + polish
    expect(total_cost_cents).toBe(67)             // 17 Opus + 0 curator (no reviews) + 25 synthesis + 25 polish
  })

  it('still runs synthesis + polish when pairs are flagged (deck must reconcile with the page, which counts flagged pairs)', async () => {
    const opus = JSON.stringify({ extractions: [opusDraft({ confidence: 0.4 })] }) // low-confidence → flagged
    mockCallAI.mockResolvedValueOnce(aiResponse(opus)).mockResolvedValueOnce(aiResponse('{"reviews":[]}'))
    const { analysis_summary } = await analyzeRecording(baseInput())
    expect(mockCallAI).toHaveBeenCalledTimes(4)   // Opus + curator + synthesis + polish — flagged pairs are NOT excluded
    expect(analysis_summary).not.toBeNull()
  })

  it('skips synthesis + polish only when there are no Q&A pairs at all', async () => {
    mockCallAI.mockResolvedValueOnce(aiResponse('{"extractions":[]}'))
    const { analysis_summary } = await analyzeRecording(baseInput())
    expect(mockCallAI).toHaveBeenCalledTimes(1)   // Opus only — no drafts → no curator, synthesis, or polish
    expect(analysis_summary).toBeNull()
  })
})

describe('analyzeRecording — synthesis pass', () => {
  const publishedOpus = JSON.stringify({
    extractions: [
      opusDraft({ topic: 'Parking', payload: { ...opusDraft().payload, sentiment: 'positive' } }),
      opusDraft({ topic: 'Budget', payload: { ...opusDraft().payload, question: 'Why so costly?', answer: 'Inflation.', sentiment: 'negative' } }),
    ],
  })
  const cleanSonnet = JSON.stringify({ reviews: [
    { draft_index: 0, flag: false, topic: 'Parking' },
    { draft_index: 1, flag: false, topic: 'Budget' },
  ] })

  it('populates analysis_summary, appends action_item rows, and counts sentiment deterministically', async () => {
    const synthesis = JSON.stringify({
      executive_summary: 'A meeting about parking and budget.',
      headline: 'Parking up, budget down',
      topic_summaries: [
        { topic: 'Parking', summary: 'Parking went well.', sentiment: 'positive', representative_pair_indexes: [0] },
        // Budget omitted by the model on purpose — code must still emit it (with a fallback exchange).
      ],
      decisions: [{ decision: 'Add a level', topic: 'Parking' }],
      action_items: [{ description: 'Publish the budget', owner: 'Jane', due_date: null, related_agenda_item: 'Budget' }],
    })
    mockCallAI.mockResolvedValueOnce(aiResponse(publishedOpus))
                .mockResolvedValueOnce(aiResponse(cleanSonnet))
                .mockResolvedValueOnce(aiResponse(synthesis))

    const { extractions, analysis_summary } = await analyzeRecording(baseInput())

    // 2 qa_pair + 1 appended action_item
    expect(extractions.filter(e => e.unit_type === 'qa_pair')).toHaveLength(2)
    const actions = extractions.filter(e => e.unit_type === 'action_item')
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ topic: 'Budget' })

    expect(analysis_summary).not.toBeNull()
    expect(analysis_summary!.headline).toBe('Parking up, budget down')
    // Counts come from code, not the model: 1 positive + 1 negative.
    expect(analysis_summary!.sentiment_breakdown).toEqual({ positive: 1, neutral: 0, negative: 1, mixed: 0 })
    // Both topics represented even though the model dropped Budget; qa_count is deterministic.
    expect(analysis_summary!.topic_summaries.map(t => t.topic).sort()).toEqual(['Budget', 'Parking'])
    const parking = analysis_summary!.topic_summaries.find(t => t.topic === 'Parking')!
    const budget = analysis_summary!.topic_summaries.find(t => t.topic === 'Budget')!
    expect(budget.qa_count).toBe(1)
    // Representative exchange is resolved from the real pair (index 0), parties identified.
    expect(parking.representative_exchanges[0]).toMatchObject({ question: 'How much parking?', asker: 'Bob', panelist: 'Jane' })
    // Budget had no model index → code falls back to its first real pair.
    expect(budget.representative_exchanges[0]).toMatchObject({ question: 'Why so costly?' })
    expect(analysis_summary!.decisions).toHaveLength(1)
  })

  it('degrades gracefully to a null summary on unparseable synthesis JSON', async () => {
    mockCallAI.mockResolvedValueOnce(aiResponse(publishedOpus))
                .mockResolvedValueOnce(aiResponse(cleanSonnet))
                .mockResolvedValueOnce(aiResponse('not json at all'))
    const { extractions, analysis_summary } = await analyzeRecording(baseInput())
    expect(analysis_summary).toBeNull()
    expect(extractions.filter(e => e.unit_type === 'action_item')).toHaveLength(0)  // no items on failure
    expect(extractions.filter(e => e.unit_type === 'qa_pair')).toHaveLength(2)      // pairs survive
  })
})

describe('analyzeRecording — polish pass (pass 4)', () => {
  const oneOpus = JSON.stringify({ extractions: [opusDraft()] })
  const cleanReview = JSON.stringify({ reviews: [{ draft_index: 0, flag: false, topic: 'Parking' }] })

  it('writes polished_question/polished_answer onto the pair payload', async () => {
    const polish = JSON.stringify({
      polished: [{ index: 0, question: 'How much parking is available?', answer: 'Two levels, with weekend overflow.' }],
    })
    mockCallAI.mockResolvedValueOnce(aiResponse(oneOpus))      // Opus
                .mockResolvedValueOnce(aiResponse(cleanReview)) // curator
                .mockResolvedValueOnce(aiResponse('{}'))        // synthesis
                .mockResolvedValueOnce(aiResponse(polish))      // polish
    const { extractions } = await analyzeRecording(baseInput())
    const pair = extractions.find(e => e.unit_type === 'qa_pair')!
    const payload = pair.payload as QaPairPayload
    expect(payload.polished_question).toBe('How much parking is available?')
    expect(payload.polished_answer).toBe('Two levels, with weekend overflow.')
    // Verbatim is untouched — record of truth.
    expect(payload.question).toBe('How much parking?')
    expect(payload.answer).toBe('Two levels.')
  })

  it('leaves polished fields unset (verbatim fallback) when polish JSON is unparseable', async () => {
    mockCallAI.mockResolvedValueOnce(aiResponse(oneOpus))
                .mockResolvedValueOnce(aiResponse(cleanReview))
                .mockResolvedValueOnce(aiResponse('{}'))
                .mockResolvedValueOnce(aiResponse('not json'))
    const { extractions } = await analyzeRecording(baseInput())
    const payload = (extractions.find(e => e.unit_type === 'qa_pair')!).payload as QaPairPayload
    expect(payload.polished_answer).toBeUndefined()
    expect(payload.answer).toBe('Two levels.')   // verbatim survives
  })
})

describe('overallSentiment — deterministic majority/mix rule', () => {
  it('empty → neutral', () => {
    expect(overallSentiment({ positive: 0, neutral: 0, negative: 0, mixed: 0 })).toBe('neutral')
  })
  it('clear majority wins', () => {
    expect(overallSentiment({ positive: 5, neutral: 1, negative: 0, mixed: 0 })).toBe('positive')
    expect(overallSentiment({ positive: 0, neutral: 1, negative: 5, mixed: 0 })).toBe('negative')
  })
  it('balanced positive + negative → mixed', () => {
    expect(overallSentiment({ positive: 4, neutral: 2, negative: 4, mixed: 0 })).toBe('mixed')
  })
  it('mostly mixed → mixed', () => {
    expect(overallSentiment({ positive: 1, neutral: 1, negative: 0, mixed: 5 })).toBe('mixed')
  })
})
