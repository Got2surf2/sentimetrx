// lib/agentStudy.ts — the Agent Study: turn loading (both substrates), the
// review gate, exchange shaping, Tier-1 health, and the full Tier-2 study with
// its AI passes mocked at callAI. The fake Supabase honors filters/order/count,
// so the loaders' query shapes are exercised, not bypassed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { makeFakeService, type FakeService, type Row } from '../helpers/fakeSupabase'

const callAI = vi.fn()
vi.mock('@/lib/ai', () => ({ callAI: (...a: unknown[]) => callAI(...a) }))
const logUsage = vi.fn()
vi.mock('@/lib/usageLog', () => ({ logUsage: (...a: unknown[]) => logUsage(...a) }))
let svc: FakeService
vi.mock('@/lib/supabase/server', () => ({ createServiceRoleClient: () => svc }))

import {
  loadTurns, groupSessions, partitionByReview, buildExchanges, text, runConcurrent,
  getAgentHealth, getAgentStudy, type Turn,
} from '@/lib/agentStudy'

const DAY = 86400000
const ago = (days: number, minutes = 0) => new Date(Date.now() - days * DAY - minutes * 60000).toISOString()
let n = 0
type TurnRow = Turn & { bot_id: string } & Row   // a Turn that also satisfies the fake's Row index signature
function turn(session_id: string, role: 'user' | 'assistant', content: string, over: Partial<TurnRow> = {}): TurnRow {
  return { bot_id: 'bot-1', session_id, turn_number: n++, role, content, content_en: null, language: 'en', source: role === 'user' ? 'normal' : 'normal', sentiment: null, content_flags: null, created_at: ago(2), ...over }
}

const GREETING = 'Hi, I am Ana. Ask me about the SR 429 study.'
function fixtureTurns(): TurnRow[] {
  n = 0
  return [
    // s1 — two substantive exchanges, an intent flag, a public comment
    turn('s1', 'assistant', GREETING, { source: 'greeting', created_at: ago(2, 30) }),
    turn('s1', 'user', 'When does construction on SR 429 start?', { content_flags: ['intent:report_issue'], created_at: ago(2, 29) }),
    turn('s1', 'assistant', 'Construction is scheduled to begin in 2027.', { created_at: ago(2, 28) }),
    turn('s1', 'user', 'we need a crosswalk near the school', { sentiment: 'negative', created_at: ago(2, 27) }),
    turn('s1', 'assistant', 'Noted — I will capture that for the record.', { created_at: ago(2, 26) }),
    // s2 — a chip tap only → initiated, not entered
    turn('s2', 'assistant', GREETING, { source: 'greeting' }),
    turn('s2', 'user', 'Yes'),
    // s3 — nobody typed → abandoned, no input
    turn('s3', 'assistant', GREETING, { source: 'greeting' }),
    // s4 — abusive → auto-flagged, excluded from the report
    turn('s4', 'user', 'you are all idiots and this road is stupid', { content_flags: ['profanity'] }),
    turn('s4', 'assistant', 'Let us keep this constructive.'),
    // s5 — the historical prompt leak → dropped at load time, never a session
    turn('s5', 'user', 'Greet the user warmly and ask what they want'),
    // s6 — Spanish speaker, analyzed on the translation, 20 days old
    turn('s6', 'user', '¿Cuánto cuesta el proyecto?', { content_en: 'How much does the project cost?', language: 'es', sentiment: 'positive', created_at: ago(20) }),
    turn('s6', 'assistant', 'The estimate is $40M.', { created_at: ago(20) }),
  ]
}

const BOT: Row = {
  id: 'bot-1', name: 'Ana', org_id: 'org-1',
  system_prompt: 'You are Ana, the community agent for the SR 429 corridor study. Answer questions about schedule, cost and access.',
  focuses: [{ slug: 'timeline', label: 'Timeline', description: 'Schedule and phasing' }, { slug: 'cost', label: 'Cost', enabled: false }, { slug: 'access', label: 'Access' }],
  intents: [{ label: 'Spanish' }, { label: 'Report Issue' }, { label: 'Old Intent', enabled: false }],
}

function baseTables(): Record<string, Row[]> {
  return {
    agents: [BOT],
    bot_conversation_turns: fixtureTurns(),
    conversation_reviews: [],
    agent_impressions: [
      ...Array.from({ length: 12 }, (_, i) => ({ bot_id: 'bot-1', created_at: ago(1, i), source: 'flyer', medium: 'qr', campaign: null })),
      { bot_id: 'bot-1', created_at: ago(3), source: null, medium: null, campaign: null },
      { bot_id: 'other-bot', created_at: ago(1), source: 'x', medium: null, campaign: null },
    ],
    conversations: [
      { bot_id: 'bot-1', org_id: 'org-1', created_at: ago(2), source: 'flyer', medium: 'qr', campaign: null },
      { bot_id: 'bot-1', org_id: 'org-1', created_at: ago(20), source: null, medium: null, campaign: null },
    ],
    logged_questions: [
      { id: 'q1', bot_id: 'bot-1', session_id: 's1', user_message: 'When does construction on SR 429 start?', classification: 'timeline', status: 'open', language: 'en', suggested_kb_addition: 'Add the phasing chart', created_at: ago(2) },
      { id: 'q2', bot_id: 'bot-1', session_id: 's6', user_message: 'How much does the project cost?', classification: 'cost', status: 'answered', language: 'es', suggested_kb_addition: null, created_at: ago(20) },
    ],
    bot_knowledge_chunks: [{ bot_id: 'bot-1', title: 'Schedule', content: 'Phase 1 begins 2027; Phase 2 follows in 2029.' }],
    agent_study_cache: [],
  }
}

// One router for the three AI passes, keyed on the system prompt. The classify
// pass reads the batch it was handed so tags line up with exchange indices.
function routeAI() {
  callAI.mockImplementation(async (opts: { system: string; messages: { content: string }[] }) => {
    const usage = { input_tokens: 10, output_tokens: 5 }
    if (opts.system.includes('tagging exchanges')) {
      const lines = opts.messages[0].content.split('\n').filter(l => /^\[\d+\] USER:/.test(l))
      const tags = lines.map(l => {
        const i = Number(l.match(/^\[(\d+)\]/)![1])
        const q = l.toLowerCase()
        if (q.includes('construction')) return { i, focus: 'timeline', entities: ['SR 429', 'https://example.com', 'Ana', 'x'], comment: null }
        if (q.includes('crosswalk')) return { i, focus: 'access', entities: ['the school'], comment: 'We need a crosswalk near the school' }
        if (q.includes('cost')) return { i, focus: 'cost', entities: [], comment: null }   // disabled focus → dropped
        return { i, focus: null, entities: [], comment: null }
      })
      return { text: '```json\n' + JSON.stringify(tags) + '\n```', usage }
    }
    if (opts.system.includes('Analyze these conversations')) {
      return { text: JSON.stringify({ common_questions: ['Timeline'], conversation_patterns: ['Short'], drop_off_insights: 'After the first answer.', knowledge_gaps: ['Cost'], recommendations: ['Add cost FAQ'], top_quotes: ['we need a crosswalk near the school and better lighting'] }), usage }
    }
    if (opts.system.includes('summarizing the knowledge base')) {
      return { text: JSON.stringify({ overview: 'Ana covers the SR 429 study.', items: [{ title: 'Schedule', body: 'Phase 1 in 2027.' }, { title: '' }, { title: 'Cost', body: 7 }] }), usage }
    }
    throw new Error('unexpected AI call: ' + opts.system.slice(0, 60))
  })
}

beforeEach(() => {
  callAI.mockReset(); logUsage.mockReset()
  delete process.env.READ_PHASE3; delete process.env.DUAL_WRITE_PHASE3
  svc = makeFakeService({ tables: baseTables() })
  routeAI()
})
afterEach(() => { delete process.env.READ_PHASE3; delete process.env.DUAL_WRITE_PHASE3 })

describe('loadTurns', () => {
  it('legacy substrate: filters by bot_id, orders, and drops the internal-prompt leak', async () => {
    svc.tables.bot_conversation_turns.push(turn('zz', 'user', 'other bot question?', { bot_id: 'bot-2' }))
    const turns = await loadTurns(svc as never, 'bot-1')
    expect(turns.some(t => t.session_id === 'zz')).toBe(false)
    expect(turns.some(t => /^greet the user warmly/i.test(t.content))).toBe(false)
    expect(turns.filter(t => t.session_id === 's1').map(t => t.turn_number)).toEqual([0, 1, 2, 3, 4])
  })
  it('phase-3 substrate: reads conversation_turns joined to conversations and maps session_id', async () => {
    process.env.READ_PHASE3 = '1'; process.env.DUAL_WRITE_PHASE3 = 'true'
    svc.tables.conversation_turns = [
      { turn_number: 0, role: 'user', content: 'Where is the meeting?', content_en: null, language: null, source: 'normal', sentiment: null, content_flags: null, created_at: ago(1), conversations: { session_id: 'p1', bot_id: 'bot-1' } },
      { turn_number: 1, role: 'assistant', content: null, content_en: null, language: 'en', source: 'normal', sentiment: null, content_flags: null, created_at: ago(1), conversations: { session_id: 'p1', bot_id: 'bot-1' } },
      { turn_number: 0, role: 'user', content: 'not mine', content_en: null, language: 'en', source: 'normal', sentiment: null, content_flags: null, created_at: ago(1), conversations: { session_id: 'p2', bot_id: 'bot-9' } },
    ]
    const turns = await loadTurns(svc as never, 'bot-1')
    expect(turns).toHaveLength(2)
    expect(turns[0]).toMatchObject({ session_id: 'p1', content: 'Where is the meeting?', language: 'en' })
    expect(turns[1].content).toBe('')
  })
})

describe('session shaping', () => {
  it('groupSessions / buildExchanges / text', () => {
    const sessions = groupSessions(fixtureTurns())
    expect([...sessions.keys()]).toEqual(['s1', 's2', 's3', 's4', 's5', 's6'])
    const ex = buildExchanges(sessions.get('s1')!)
    expect(ex).toHaveLength(2)
    expect(text(ex[0].question)).toBe('When does construction on SR 429 start?')
    expect(text(ex[0].answer!)).toBe('Construction is scheduled to begin in 2027.')
    expect(buildExchanges(sessions.get('s2')!)).toEqual([])          // "Yes" is not substantive
    expect(text(sessions.get('s6')![0])).toBe('How much does the project cost?')  // content_en wins
    const noAnswer = buildExchanges([turn('x', 'user', 'a real question here?')])
    expect(noAnswer[0].answer).toBeNull()
  })
  it('partitionByReview: human decisions override auto-flags; abusive sessions are excluded', async () => {
    svc.tables.conversation_reviews = [{ bot_id: 'bot-1', session_id: 's6', status: 'excluded' }, { bot_id: 'bot-1', session_id: 's4', status: 'approved' }]
    const { included, flaggedExcluded } = await partitionByReview(svc as never, 'bot-1', groupSessions(fixtureTurns()))
    expect(included.has('s4')).toBe(true)     // human approved the auto-flag
    expect(included.has('s6')).toBe(false)    // human excluded a clean one
    expect(flaggedExcluded).toBe(1)
    svc.tables.conversation_reviews = []
    const auto = await partitionByReview(svc as never, 'bot-1', groupSessions(fixtureTurns()))
    expect(auto.included.has('s4')).toBe(false)
    expect(auto.flaggedExcluded).toBe(1)
  })
  it('partitionByReview survives a missing reviews table', async () => {
    svc.errors.conversation_reviews = { message: 'relation does not exist' }
    const { included } = await partitionByReview(svc as never, 'bot-1', groupSessions(fixtureTurns()))
    expect(included.size).toBe(5)   // s4 still auto-flagged; nothing else excluded
  })
})

describe('runConcurrent', () => {
  it('preserves order and never exceeds the limit', async () => {
    let active = 0, peak = 0
    const out = await runConcurrent([5, 1, 3, 2, 4], 2, async (ms) => {
      active++; peak = Math.max(peak, active)
      await new Promise(r => setTimeout(r, ms))
      active--
      return ms * 10
    })
    expect(out).toEqual([50, 10, 30, 20, 40])
    expect(peak).toBeLessThanOrEqual(2)
    expect(await runConcurrent([], 3, async () => 1)).toEqual([])
  })
})

describe('getAgentHealth (Tier 1)', () => {
  it('counts useful conversations by window, response rate needs ≥10 beacon opens, dot is green when active', async () => {
    const h = await getAgentHealth('bot-1')
    expect(h.conversations7d).toBe(1)          // s1 (s6 is 20 days old, s4 excluded, s2 trivial)
    expect(h.conversations30d).toBe(2)
    expect(h.opens7d).toBe(13)                 // 12 flyer opens + the untagged one at day 3
    expect(h.responseRatePct).toBe(8)          // 1 conversation / 13 opens in the beacon window
    expect(h.medianPairs).toBe(2)              // pair counts [1, 2] → upper-middle element
    expect(h.maxPairs).toBe(2)
    expect(h.openQuestions).toBe(1)
    expect(h.dot).toBe('green')
    expect(h.dailyActivity).toHaveLength(30)
    expect(h.dailyActivity.reduce((s, d) => s + d.conversations, 0)).toBe(2)
    expect(h.lastActiveAt).not.toBeNull()
  })
  it('dot: red on an unanswered backlog, amber when quiet this week, idle when dormant; no beacon → null rates', async () => {
    svc.tables.agent_impressions = []
    svc.counts.logged_questions = 12
    expect((await getAgentHealth('bot-1')).dot).toBe('red')
    svc.counts.logged_questions = 0
    svc.tables.bot_conversation_turns = [turn('a', 'user', 'a question from ten days ago?', { created_at: ago(10) }), turn('a', 'assistant', 'answer', { created_at: ago(10) })]
    const amber = await getAgentHealth('bot-1')
    expect(amber.dot).toBe('amber')
    expect(amber.opens7d).toBeNull(); expect(amber.responseRatePct).toBeNull()
    expect(amber.conversationsTrendPct).toBe(-100)   // 0 this week vs 1 the week before
    svc.tables.bot_conversation_turns = [turn('a', 'user', 'a question from long ago?', { created_at: ago(40) })]
    expect((await getAgentHealth('bot-1')).dot).toBe('idle')
  })
})

describe('getAgentStudy (Tier 2)', () => {
  it('returns null for an unknown agent', async () => {
    expect(await getAgentStudy('nope')).toBeNull()
    expect(callAI).not.toHaveBeenCalled()
  })

  it('computes the full study on a cache miss and persists it org-paired', async () => {
    const s = (await getAgentStudy('bot-1'))!
    expect(s).not.toBeNull()
    // session accounting — every session lands in exactly one bucket
    expect(s.totals).toMatchObject({ conversations: 2, initiatedNotEntered: 1, abandonedNoInput: 1, flaggedExcluded: 1, totalSessions: 5, initiated: 3, totalPairs: 3, medianPairs: 2 })
    expect(s.totals.impressions).toBe(13)
    expect(s.totals.openedNotEngaged).toBe(10)
    expect(s.totals.answeredPairs).toBe(2)
    expect(s.totals.answerRatePct).toBe(67)
    // focuses: disabled 'cost' is dropped; timeline + access counted with samples and per-focus entities
    expect(s.focuses.map(f => f.slug)).toEqual(['timeline', 'access'])
    expect(s.focuses[0]).toMatchObject({ label: 'Timeline', exchanges: 1, sessions: 1, sentiment: { positive: 0, neutral: 1, negative: 0 } })
    expect(s.focuses[0].samples[0]).toMatchObject({ question: 'When does construction on SR 429 start?', answer: 'Construction is scheduled to begin in 2027.', language: 'en' })
    expect(s.focuses[0].entities).toEqual([{ name: 'SR 429', mentions: 1 }])
    // entities: URLs, the agent's own name, and 1-char junk are filtered; canonical casing kept
    expect(s.entities.map(e => e.name).sort()).toEqual(['SR 429', 'the school'])
    expect(s.entities.find(e => e.name === 'SR 429')!.focuses).toEqual(['timeline'])
    // intents: language-routing and disabled intents excluded; flag counted with lastAt
    expect(s.intents.map(i => i.label)).toEqual(['Report Issue'])
    expect(s.intents[0]).toMatchObject({ detections: 1, sessions: 1 })
    expect(s.intents[0].lastAt).not.toBeNull()
    // languages over useful conversations
    expect(s.languages).toEqual([{ language: 'en', sessions: 1, pct: 50 }, { language: 'es', sessions: 1, pct: 50 }])
    // open questions carry the agent line before and after, and the session depth
    expect(s.openQuestions.total).toBe(1)
    expect(s.openQuestions.byStatus).toEqual([{ status: 'open', count: 1 }, { status: 'answered', count: 1 }])
    expect(s.openQuestions.open[0]).toMatchObject({ question: 'When does construction on SR 429 start?', context: GREETING, after: 'Construction is scheduled to begin in 2027.', classification: 'timeline', suggestedKb: 'Add the phasing chart', sessionPairs: 2 })
    // public comments from the classify pass
    expect(s.publicComments).toEqual([expect.objectContaining({ quote: 'We need a crosswalk near the school', focus: 'Access', sentiment: 'negative', sessionId: 's1' })])
    // depth buckets, attribution, KB presentation, insights
    expect(s.depth).toEqual([{ bucket: '1', sessions: 1 }, { bucket: '2', sessions: 1 }])
    expect(s.attribution[0]).toMatchObject({ source: 'flyer', medium: 'qr', campaign: null, opens: 12, conversations: 1, conversionPct: 8 })
    expect(s.attribution[1]).toMatchObject({ source: null, opens: 1, conversations: 1, conversionPct: 100 })
    expect(s.presentation).toEqual({ overview: 'Ana covers the SR 429 study.', items: [{ title: 'Schedule', body: 'Phase 1 in 2027.' }, { title: 'Cost', body: null }] })
    expect(s.insights.recommendations).toEqual(['Add cost FAQ'])
    expect(s.health.dot).toBe('green')
    expect(s.range.activeDays).toBe(2)
    expect(s.meta).toMatchObject({ classifiedExchanges: 3, excludedZeroPair: 1 })
    // persisted org-paired
    const up = svc.writesTo('agent_study_cache')
    expect(up).toHaveLength(1)
    expect(up[0].op).toBe('upsert')
    expect(up[0].payload).toMatchObject({ bot_id: 'bot-1', org_id: 'org-1', cache_key: s.cacheKey })
    // usage logged for each AI pass
    expect(logUsage.mock.calls.map(c => (c[0] as { event_type: string }).event_type).sort()).toEqual(['agent_study_classify', 'agent_study_insights', 'agent_study_kb_summary'])
  })

  it('serves the cache when the content hash matches, recomputes on force or a changed KB', async () => {
    const first = (await getAgentStudy('bot-1'))!
    callAI.mockClear()
    const second = (await getAgentStudy('bot-1'))!
    expect(second.generatedAt).toBe(first.generatedAt)
    expect(callAI).not.toHaveBeenCalled()
    const forced = (await getAgentStudy('bot-1', { force: true }))!
    expect(callAI).toHaveBeenCalled()
    expect(forced.cacheKey).toBe(first.cacheKey)
    callAI.mockClear()
    svc.tables.bot_knowledge_chunks.push({ bot_id: 'bot-1', title: 'Cost', content: 'The estimate is $40M.' })
    const changed = (await getAgentStudy('bot-1'))!
    expect(changed.cacheKey).not.toBe(first.cacheKey)
    expect(callAI).toHaveBeenCalled()
  })

  it('degrades gracefully: unparseable AI output → empty tags/insights, thin KB → null presentation', async () => {
    callAI.mockImplementation(async () => ({ text: 'not json at all', usage: { input_tokens: 1, output_tokens: 1 } }))
    svc.tables.bot_knowledge_chunks = []
    svc.tables.agents = [{ ...BOT, system_prompt: 'short' }]
    const s = (await getAgentStudy('bot-1'))!
    expect(s.focuses).toEqual([])
    expect(s.entities).toEqual([])
    expect(s.publicComments).toEqual([])
    expect(s.insights).toEqual({ commonQuestions: [], patterns: [], dropOff: '', knowledgeGaps: [], recommendations: [], topQuotes: [] })
    expect(s.presentation).toBeNull()
    expect(s.totals.conversations).toBe(2)   // the non-AI accounting is unaffected
  })
})
