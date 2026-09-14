// lib/agentStudyHtml.ts — the point-in-time HTML bake of an Agent Study served
// inside the sandboxed (script-disabled) /shared/agent-study iframe. Pure
// function: one rich AgentStudy exercises every section and its conditionals
// (health-dot title, KPI gating, the recorded-sessions note, activity chart,
// focuses/entities/commentary, intents+languages, attribution incl. untagged,
// open questions with depth chips, insights, methodology); a minimal study
// pins what is omitted. The two sub-renderers run for real.
import { describe, it, expect } from 'vitest'
import { renderAgentStudyHtml } from '@/lib/agentStudyHtml'
import type { AgentStudy } from '@/lib/agentStudy'

const dayISO = (d: number) => new Date(Date.now() - d * 86400000).toISOString()
function daily(n: number) {
  return Array.from({ length: 30 }, (_, i) => ({ date: dayISO(29 - i).slice(0, 10), conversations: i >= 27 ? i - 26 : 0, opens: i >= 27 ? (i - 26) * 2 : 0 }))
}

function study(over: Partial<AgentStudy> = {}): AgentStudy {
  return {
    bot: { id: 'bot-1', name: 'Sarina' },
    generatedAt: dayISO(0), cacheKey: 'abc',
    health: { conversations7d: 6, conversations30d: 20, conversationsTrendPct: 12, opens7d: 40, responseRatePct: 15, medianPairs: 3, maxPairs: 9, openQuestions: 4, lastActiveAt: dayISO(1), dailyActivity: daily(30), dot: 'green' },
    range: { first: dayISO(40), last: dayISO(1), activeDays: 12 },
    totals: { impressions: 500, totalSessions: 120, initiated: 100, conversations: 80, initiatedNotEntered: 15, abandonedNoInput: 5, flaggedExcluded: 20, openedNotEngaged: 400, totalPairs: 240, medianPairs: 3, answeredPairs: 236, answerRatePct: 98 },
    attribution: [
      { source: 'flyer', medium: 'qr', campaign: 'spring', opens: 300, conversations: 60, conversionPct: 20 },
      { source: null, medium: null, campaign: null, opens: 40, conversations: 20, conversionPct: 50 },
    ],
    depth: [{ bucket: '1', sessions: 30 }, { bucket: '2', sessions: 25 }, { bucket: '3', sessions: 15 }, { bucket: '6–9', sessions: 10 }],
    focuses: [
      { slug: 'timeline', label: 'Timeline', exchanges: 40, sessions: 30, sentiment: { positive: 20, neutral: 15, negative: 5 },
        entities: [{ name: 'SR 429', mentions: 12 }],
        samples: [{ question: 'When does construction start?', answer: 'In 2027.', language: 'en', sentiment: 'neutral' }, { question: '¿Cuándo?', answer: 'En 2027.', language: 'es', sentiment: null }] },
      { slug: 'cost', label: 'Cost', exchanges: 10, sessions: 8, sentiment: { positive: 1, neutral: 4, negative: 5 }, entities: [], samples: [] },
    ],
    entities: [{ name: 'SR 429', mentions: 12, focuses: ['timeline'] }, { name: 'Kelly Park', mentions: 7, focuses: ['timeline', 'cost'] }],
    intents: [{ label: 'Report Issue', detections: 9, sessions: 7, lastAt: dayISO(2) }, { label: 'Silent', detections: 0, sessions: 0, lastAt: null }],
    languages: [{ language: 'en', sessions: 70, pct: 88 }, { language: 'es', sessions: 10, pct: 12 }],
    openQuestions: {
      byClassification: [{ classification: 'unanswered_kb_gap', count: 3 }],
      byStatus: [{ status: 'open', count: 4 }],
      total: 6,
      open: [
        { question: 'Will there be a detour?', context: 'The panel discussed phasing.', after: 'I am not certain about detours.', classification: 'unanswered_kb_gap', language: 'en', suggestedKb: 'Add the detour map', createdAt: dayISO(3), sessionPairs: 8 },
        { question: '¿Habrá desvío?', context: '', after: '', classification: 'other', language: 'es', suggestedKb: null, createdAt: dayISO(4), sessionPairs: 1 },
      ],
    },
    publicComments: [{ quote: 'We need a crosswalk near the school', focus: 'Timeline', sentiment: 'negative', sessionId: 's1', createdAt: dayISO(5) }],
    presentation: { overview: 'Sarina covers the SR 429 corridor study.', items: [{ title: 'Schedule', body: 'Phase 1 begins 2027.' }] },
    insights: { commonQuestions: ['Timeline', 'Cost'], patterns: ['Short chats'], dropOff: 'After the first answer.', knowledgeGaps: ['Detours'], recommendations: ['Add a detour FAQ'], topQuotes: ['This project will change my commute for years to come, I hope'] },
    meta: { classifiedExchanges: 240, excludedZeroPair: 15, method: 'Useful conversations = a real user message; taps excluded.' },
    ...over,
  }
}

// The reconciliation note wraps each figure in <strong>; strip inline bold/em
// so "120 sessions recorded" reads as one string. No <b>/<strong> assertion
// in this file depends on the tags surviving.
const decode = (s: string) => s.replace(/<\/?(strong|b|em)>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

describe('renderAgentStudyHtml — rich study', () => {
  const html = renderAgentStudyHtml(study())
  const text = decode(html)

  it('is a self-contained doc: title, Datanautix wordmark, and a print rule that hides drill-down bodies', () => {
    expect(html).toContain('<title>Sarina — Agent Study</title>')
    expect(html).toContain('>data</span><span style="color:#E8632A">nautix<')
    expect(html).toContain('details>:not(summary){display:none!important}')
    expect(html).not.toContain('<script')
    expect(text).toContain('Sarina — Agent Study')
    expect(text).toContain('12 active days')
  })
  it('the health dot carries a plain-English title for its colour', () => {
    expect(text).toContain('Healthy — recently active')
  })
  it('KB presentation card renders from the shared source-summary renderer', () => {
    expect(text).toContain('Knowledge Base')
    expect(text).toContain('Sarina covers the SR 429 corridor study.')
    expect(text).toContain('Schedule')
  })
  it('overview KPIs, with opens/response-rate shown because the beacon has coverage', () => {
    expect(text).toContain('Useful Conversations')
    expect(text).toContain('98%'); expect(text).toContain('236 of 240 answered')
    expect(text).toContain('Response Rate'); expect(text).toContain('Widget Opens')
    expect(text).toContain('Open Questions')
  })
  it('engagement depth bars + the recorded-sessions reconciliation note', () => {
    expect(text).toContain('Engagement & Depth')
    expect(text).toContain('120 sessions recorded')            // 80 + 15 + 5 + 20 (recorded note counts all four, incl. flagged)
    expect(text).toContain('80 useful')
    expect(text).toContain('15 initiated but one-word only')
    expect(text).toContain('20 flagged for review')
    expect(text).toContain('400 widget open')
  })
  it('activity chart, focuses with samples + per-focus entities, and the global entity list', () => {
    expect(text).toContain('Activity Over Time')
    expect(text).toContain('Teal = conversations')
    expect(text).toContain('Areas of Focus')
    expect(text).toContain('Timeline'); expect(text).toContain('When does construction start?')
    expect(text).toContain('Entities here: SR 429 (12)')
    expect(text).toContain('· es')                              // non-English sample badge (raw language code, lowercase)
    expect(text).toContain('Entity Analysis')
    expect(text).toContain('Kelly Park')
  })
  it('commentary card, intents (zero-detection hidden), languages, and attribution incl. an untagged row', () => {
    expect(text).toContain('We need a crosswalk near the school')
    expect(text).toContain('Intents Detected'); expect(text).toContain('Report Issue')
    expect(text).not.toContain('>Silent<')
    expect(text).toContain('Conversations by Language'); expect(text).toContain('EN')
    expect(text).toContain('Where They Came From'); expect(text).toContain('flyer')
    expect(text).toContain('Untagged')
  })
  it('open questions with classification + depth chips + before/after context and suggested KB', () => {
    expect(text).toContain('Open Questions')
    expect(text).toContain('6 open · showing 2 most recent')
    expect(text).toContain('unanswered kb gap')
    expect(text).toContain('💬 8 exchanges')
    expect(text).toContain('SARINA BEFORE'); expect(text).toContain('SARINA AFTER')
    expect(text).toContain('Suggested KB addition:')
    expect(text).toContain('Add the detour map')
  })
  it('insights columns, quotes, methodology and the sentimetrx/datanautix footer', () => {
    expect(text).toContain('Most Common Topics'); expect(text).toContain('Knowledge Gaps'); expect(text).toContain('Recommendations')
    expect(text).toContain('In Their Words')
    expect(text).toContain('This project will change my commute')
    expect(text).toContain('Methodology & Provenance')
    expect(text).toContain('240 Q&A pairs classified; 15 input-less session(s) excluded.')
    expect(text).toContain('sentimetrx.ai')
    expect(text).toContain('datanautix.com')
  })
  it('escapes user/agent-derived text', () => {
    const evil = renderAgentStudyHtml(study({ bot: { id: 'b', name: '<img src=x>' } }))
    expect(evil).not.toContain('<img src=x>')
    expect(evil).toContain('&lt;img src=x&gt;')
  })
})

describe('renderAgentStudyHtml — minimal study omits optional sections', () => {
  const html = renderAgentStudyHtml(study({
    presentation: null,
    totals: { impressions: null, totalSessions: 3, initiated: 3, conversations: 3, initiatedNotEntered: 0, abandonedNoInput: 0, flaggedExcluded: 0, openedNotEngaged: null, totalPairs: 5, medianPairs: 1, answeredPairs: 5, answerRatePct: null },
    health: { conversations7d: 0, conversations30d: 3, conversationsTrendPct: null, opens7d: null, responseRatePct: null, medianPairs: 1, maxPairs: 2, openQuestions: 0, lastActiveAt: dayISO(1), dailyActivity: daily(30).map(d => ({ ...d, opens: 0 })), dot: 'amber' },
    focuses: [], entities: [], intents: [], languages: [{ language: 'en', sessions: 3, pct: 100 }],
    attribution: [], publicComments: [],
    openQuestions: { byClassification: [], byStatus: [], total: 0, open: [] },
    insights: { commonQuestions: [], patterns: [], dropOff: '', knowledgeGaps: [], recommendations: [], topQuotes: [] },
  }))
  const text = decode(html)
  it('drops KB, focuses, entities, commentary, attribution, open-questions, insights, quotes; response-rate KPIs hidden', () => {
    expect(text).not.toContain('Knowledge Base')
    expect(text).not.toContain('Areas of Focus')
    expect(text).not.toContain('Entity Analysis')
    expect(text).not.toContain('Where They Came From')
    expect(text).not.toContain('most recent')                 // the open-questions SECTION (the KPI label of the same name always shows)
    expect(text).not.toContain('Questions the agent couldn')
    expect(text).not.toContain('Most Common Topics')
    expect(text).not.toContain('In Their Words')
    expect(text).not.toContain('Answer Rate')            // answerRatePct null
    expect(text).not.toContain('Widget Opens')           // impressions null → showOpens false
    expect(text).not.toContain('Conversations by Language')   // single language → panel hidden
    expect(text).toContain('Quiet — active earlier')     // amber dot title
    expect(text).toContain('beacon active going forward') // methodology line when opens not shown
  })
})
