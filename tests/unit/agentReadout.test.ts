// lib/agentReadout.ts — "What We Heard": hybrid theming of what people asked
// (declared focus first, emergent label otherwise) and what they raised beyond
// their questions, with emergent labels consolidated and sample verbatims
// polished. Runs on the REAL agentStudy loaders over the fake Supabase; the
// three AI passes and the correction layer are mocked at their boundaries.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeFakeService, type FakeService, type Row } from '../helpers/fakeSupabase'

const callAI = vi.fn()
vi.mock('@/lib/ai', () => ({ callAI: (...a: unknown[]) => callAI(...a) }))
vi.mock('@/lib/usageLog', () => ({ logUsage: vi.fn() }))
import { logError } from '@/lib/log'
vi.mock('@/lib/log', () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn(), errMessage: (e: unknown) => String(e) }))
let svc: FakeService
vi.mock('@/lib/supabase/server', () => ({ createServiceRoleClient: () => svc }))
const polishVerbatims = vi.fn(async (texts: string[]) => texts.map(t => t + ' ✓'))
vi.mock('@/lib/correction/polish', () => ({ polishVerbatims: (...a: unknown[]) => polishVerbatims(...(a as [string[]])) }))
vi.mock('@/lib/correction/glossary', () => ({ resolveBrandGlossary: async () => [{ canonical: 'SR 429', variants: ['429'] }], glossaryTerms: () => ['SR 429'] }))

import { getAgentReadout } from '@/lib/agentReadout'

let n = 0
const at = (min: number) => new Date(Date.now() - min * 60000).toISOString()
function turn(session_id: string, role: 'user' | 'assistant', content: string, over: Row = {}): Row {
  return { bot_id: 'bot-1', session_id, turn_number: n++, role, content, content_en: null, language: 'en', source: 'normal', sentiment: null, content_flags: null, created_at: at(60 - n), ...over }
}
function tables(): Record<string, Row[]> {
  n = 0
  return {
    agents: [{ id: 'bot-1', name: 'Ana', org_id: 'org-1', focuses: [{ slug: 'timeline', label: 'Timeline' }, { slug: 'cost', label: 'Cost', enabled: false }], config: { readoutTitle: '  Kelly Park — What Residents Said  ' } }],
    bot_conversation_turns: [
      turn('s1', 'user', 'When does construction start on the 429?', { sentiment: 'neutral' }),
      turn('s1', 'assistant', 'In 2027.'),
      turn('s1', 'user', 'The queue at Kelly Park backs up with no signal every morning', { sentiment: 'negative' }),
      turn('s1', 'assistant', 'Thanks, noted.'),
      turn('s2', 'user', 'How bad is traffic on Rock Springs Road at rush hour?', { sentiment: 'negative' }),
      turn('s2', 'assistant', 'It is congested 7–9am.'),
      turn('s3', 'user', 'Is there congestion near the school in the afternoon?', { sentiment: 'neutral' }),
      turn('s3', 'assistant', 'Yes.'),
      turn('s3', 'user', 'hello there friend', { sentiment: 'positive' }),      // small talk → not a question theme
      turn('s3', 'assistant', 'Hello!'),
      turn('s4', 'user', 'ok'),                                                     // trivial → no exchanges → not a conversation
      turn('s5', 'user', 'you idiots ruined my commute with this stupid project', { content_flags: ['profanity'] }),  // excluded by the gate
      turn('s5', 'assistant', '...'),
    ],
    conversation_reviews: [],
    agent_readout_cache: [],
  }
}

function routeAI() {
  callAI.mockImplementation(async (opts: { system: string; messages: { content: string }[] }) => {
    const usage = { input_tokens: 1, output_tokens: 1 }
    if (opts.system.includes('organizing what people said')) {
      const lines = opts.messages[0].content.split('\n').filter(l => /^\[\d+\] USER:/.test(l))
      const tags = lines.map(l => {
        const i = Number(l.match(/^\[(\d+)\]/)![1]); const q = l.toLowerCase()
        if (q.includes('construction')) return { i, focus: 'timeline', q_label: 'Construction Timeline', comment: null, c_label: null }
        if (q.includes('queue at kelly park')) return { i, focus: null, q_label: null, comment: 'The queue at Kelly Park backs up with no signal every morning', c_label: 'Traffic Operations' }
        if (q.includes('rock springs')) return { i, focus: 'cost', q_label: 'Congestion Patterns', comment: 'Rock Springs Road is gridlocked at rush hour', c_label: 'Congestion Patterns' }  // disabled focus → emergent
        if (q.includes('near the school')) return { i, focus: null, q_label: 'Traffic Operations', comment: 'We need a signal by the school', c_label: null }  // comment with no label → Other
        return { i, focus: null, q_label: null, comment: null, c_label: null }
      })
      return { text: JSON.stringify(tags), usage }
    }
    if (opts.system.includes('draft question topic labels')) return { text: JSON.stringify({ 'Congestion Patterns': 'Traffic & Congestion', 'Traffic Operations': 'Traffic & Congestion' }), usage }
    if (opts.system.includes('draft comment topic labels')) return { text: '```json\n' + JSON.stringify({ 'Traffic Operations': 'Traffic & Congestion', 'Congestion Patterns': 'Traffic & Congestion' }) + '\n```', usage }
    if (opts.system.includes('writing the opening of a readout')) return { text: JSON.stringify({ overview: 'People asked about timing and raised traffic.', takeaways: ['Traffic dominates', 7, 'Timeline is the top question'] }), usage }
    throw new Error('unexpected AI call: ' + opts.system.slice(0, 50))
  })
}

beforeEach(() => { callAI.mockReset(); polishVerbatims.mockClear(); svc = makeFakeService({ tables: tables() }); routeAI() })

describe('getAgentReadout', () => {
  it('returns null for an unknown agent', async () => {
    expect(await getAgentReadout('nope')).toBeNull()
  })

  it('themes questions (focus first, consolidated emergent otherwise) and volunteered comments, polishes samples, caches org-paired', async () => {
    const r = (await getAgentReadout('bot-1'))!
    expect(r.title).toBe('Kelly Park — What Residents Said')
    expect(r.scope).toEqual({ conversations: 3, questions: 3, beyondComments: 3, focusesConfigured: 1 })
    // question themes: 'Congestion Patterns' + 'Traffic Operations' collapse into one emergent theme (2 questions) that outranks the focus theme (1)
    expect(r.questionThemes.map(t => [t.label, t.source, t.slug, t.questions, t.sessions])).toEqual([
      ['Traffic & Congestion', 'emergent', null, 2, 2],
      ['Timeline', 'focus', 'timeline', 1, 1],
    ])
    expect(r.questionThemes[0].sentiment).toEqual({ positive: 0, neutral: 1, negative: 1 })
    expect(r.questionThemes[1].samples[0]).toMatchObject({ text: 'When does construction start on the 429? ✓', language: 'en', sentiment: 'neutral' })
    // beyond themes: two labelled comments merge; the unlabelled one files under Other
    expect(r.beyondThemes.map(t => [t.label, t.comments, t.sessions])).toEqual([['Traffic & Congestion', 2, 2], ['Other', 1, 1]])
    expect(r.beyondThemes[0].samples.map(s => s.quote)).toEqual(['The queue at Kelly Park backs up with no signal every morning ✓', 'Rock Springs Road is gridlocked at rush hour ✓'])
    expect(r.beyondThemes[1].samples[0]).toEqual({ quote: 'We need a signal by the school ✓', sentiment: 'neutral' })
    // polish received the glossary and every sample exactly once
    expect(polishVerbatims).toHaveBeenCalledTimes(1)
    expect(polishVerbatims.mock.calls[0][0]).toHaveLength(6)
    expect((polishVerbatims.mock.calls[0] as unknown[])[1]).toMatchObject({ glossary: ['SR 429'], usage: expect.objectContaining({ event_type: 'verbatim_polish', org_id: 'org-1' }) })
    // summary keeps only string takeaways
    expect(r.summary).toEqual({ overview: 'People asked about timing and raised traffic.', takeaways: ['Traffic dominates', 'Timeline is the top question'] })
    expect(r.meta.classifiedExchanges).toBe(5)   // 'hello there friend' is ≥3 words → substantive, tagged as no-question
    expect(r.range.activeDays).toBe(1)
    const up = svc.writesTo('agent_readout_cache')
    expect(up).toHaveLength(1)
    expect(up[0].payload).toMatchObject({ bot_id: 'bot-1', org_id: 'org-1', cache_key: r.cacheKey })
  })

  it('cache hit returns the stored readout without AI; force recomputes; a changed title changes the key', async () => {
    const first = (await getAgentReadout('bot-1'))!
    callAI.mockClear()
    expect((await getAgentReadout('bot-1'))!.generatedAt).toBe(first.generatedAt)
    expect(callAI).not.toHaveBeenCalled()
    await getAgentReadout('bot-1', { force: true })
    expect(callAI).toHaveBeenCalled()
    svc.tables.agents[0].config = {}
    const retitled = (await getAgentReadout('bot-1'))!
    expect(retitled.title).toBe('Ana — What We Heard')
    expect(retitled.cacheKey).not.toBe(first.cacheKey)
  })

  it('a polish failure shows raw verbatims; unparseable AI output leaves identity labels and an empty summary', async () => {
    polishVerbatims.mockRejectedValueOnce(new Error('polish down'))
    vi.mocked(logError).mockClear()
    const r = (await getAgentReadout('bot-1'))!
    expect(r.questionThemes[1].samples[0].text).toBe('When does construction start on the 429?')
    expect(logError).toHaveBeenCalled()

    svc = makeFakeService({ tables: tables() })
    callAI.mockImplementation(async (opts: { system: string; messages: { content: string }[] }) => {
      if (opts.system.includes('organizing what people said')) {
        const lines = opts.messages[0].content.split('\n').filter(l => /^\[\d+\] USER:/.test(l))
        return { text: JSON.stringify(lines.map((_l, i) => ({ i, focus: null, q_label: 'Label ' + i, comment: null, c_label: null }))), usage: {} }
      }
      return { text: '<<garbage>>', usage: {} }
    })
    const r2 = (await getAgentReadout('bot-1'))!
    expect(r2.questionThemes.map(t => t.label).sort()).toEqual(['Label 0', 'Label 1', 'Label 2', 'Label 3', 'Label 4'])   // identity map kept
    expect(r2.beyondThemes).toEqual([])
    expect(r2.summary).toEqual({ overview: '', takeaways: [] })
  })

  it('an agent with no focuses themes everything emergently, and no exchanges yields an empty readout', async () => {
    svc.tables.agents[0].focuses = []
    const r = (await getAgentReadout('bot-1'))!
    expect(r.scope.focusesConfigured).toBe(0)
    expect(r.questionThemes.every(t => t.source === 'emergent')).toBe(true)
    svc = makeFakeService({ tables: { ...tables(), bot_conversation_turns: [] } })
    const empty = (await getAgentReadout('bot-1'))!
    expect(empty.scope).toEqual({ conversations: 0, questions: 0, beyondComments: 0, focusesConfigured: 1 })
    expect(empty.summary).toEqual({ overview: '', takeaways: [] })
    expect(empty.range).toEqual({ first: null, last: null, activeDays: 0 })
  })
})
