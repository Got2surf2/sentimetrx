// Tests for the project-report aggregation (lib/projectReport.ts) — the
// deterministic roll-up that pools every input's Q&A + commentary by topic with
// source attribution. Synthesis (AI naming/merging) is exercised with
// synthesize:false so the pure grouping + counts are locked without a network call.

import { describe, it, expect } from 'vitest'
import { aggregateRawClusters, buildProjectReportModel, type ProjectInputModel } from '@/lib/projectReport'

const townHall: ProjectInputModel = {
  source: { id: 'd1', kind: 'town_hall', name: 'Meeting 2', date: '2026-06-16', badge: 'Town Hall · Jun 16', rowCount: 19 },
  presentation: { overview: 'Presented the corridor plan.', items: [{ title: 'Corridor', body: 'Phase 1.' }] },
  qa: [
    { question: 'When does Phase 2 start?', answer: 'Q3.', topic: 'Timeline', asker: 'Maria', panelist: 'Hatem', sentiment: 'neutral', source: 'Town Hall · Jun 16' },
    { question: 'Will US-441 be widened?', answer: 'Under review.', topic: 'Roads', asker: 'Tom', panelist: 'Hatem', sentiment: 'negative', source: 'Town Hall · Jun 16' },
  ],
  commentary: [
    { quote: 'The 441 corridor backs up daily.', topic: 'Roads', sentiment: 'negative', speaker: 'Maria', source: 'Town Hall · Jun 16' },
  ],
  themes: [{ label: 'Roads', count: 2, sentiment: 'negative', avgRating: null, samples: [] }],
  entities: [{ name: 'US-441', mentions: 4 }],
  sentiment: { positive: 1, neutral: 2, negative: 3 },
}

const agent: ProjectInputModel = {
  source: { id: 'd2', kind: 'agent', name: 'Sarina', date: '2026-06-20', badge: 'via Sarina', rowCount: 270 },
  presentation: { overview: 'Sarina covers the NOWOCATS program.', items: [] },
  qa: [
    { question: 'How is funding allocated?', answer: 'By corridor.', topic: 'Funding', asker: null, panelist: null, sentiment: 'neutral', source: 'via Sarina' },
  ],
  commentary: [
    { quote: 'We need the 441 fixed sooner.', topic: 'roads', sentiment: 'negative', speaker: null, source: 'via Sarina' },
    { quote: 'Budget keeps slipping.', topic: 'Funding', sentiment: 'negative', speaker: null, source: 'via Sarina' },
  ],
  themes: [{ label: 'Funding', count: 1, sentiment: 'negative', avgRating: null, samples: [] }],
  entities: [{ name: 'US-441', mentions: 6 }, { name: 'Kelly Park Rd', mentions: 2 }],
  sentiment: { positive: 2, neutral: 5, negative: 8 },
}

describe('aggregateRawClusters', () => {
  it('pools by topic case-insensitively and sorts by item count', () => {
    const clusters = aggregateRawClusters([townHall, agent])
    const roads = clusters.find(c => c.topic.toLowerCase() === 'roads')!
    // "Roads" (TH: 1 qa + 1 comment) + "roads" (agent: 1 comment) = 3 items, merged
    expect(roads.qa.length + roads.commentary.length).toBe(3)
    expect(roads.sources.size).toBe(2)
    // Roads (3) is the largest cluster → first
    expect(clusters[0].topic.toLowerCase()).toBe('roads')
  })
})

describe('buildProjectReportModel (deterministic / synthesize:false)', () => {
  it('computes reconciling totals', async () => {
    const m = await buildProjectReportModel('NOWOCATS', [townHall, agent], '2026-06-28T00:00:00Z', { synthesize: false })
    expect(m.totals.sources).toBe(2)
    expect(m.totals.townHalls).toBe(1)
    expect(m.totals.agents).toBe(1)
    expect(m.totals.qa).toBe(3)        // 2 + 1
    expect(m.totals.comments).toBe(3)  // 1 + 2
  })

  it('falls back to one theme per raw topic when not synthesizing, sorted by count', async () => {
    const m = await buildProjectReportModel('NOWOCATS', [townHall, agent], 'x', { synthesize: false })
    expect(m.themes[0].title.toLowerCase()).toBe('roads')
    expect(m.themes[0].count).toBe(3)
    expect(m.themes[0].sources.length).toBe(2)
    expect(m.execSummary).toBe('')     // no AI → empty
  })

  it('aggregates entities across sources (US-441 = 4 + 6) and lists both sources', async () => {
    const m = await buildProjectReportModel('NOWOCATS', [townHall, agent], 'x', { synthesize: false })
    const us441 = m.entities.find(e => e.name === 'US-441')!
    expect(us441.mentions).toBe(10)
    expect(us441.sources.length).toBe(2)
    expect(m.entities[0].name).toBe('US-441') // highest mentions first
  })

  it('sums sentiment and lists every presentation + every community comment', async () => {
    const m = await buildProjectReportModel('NOWOCATS', [townHall, agent], 'x', { synthesize: false })
    expect(m.sentiment).toEqual({ positive: 3, neutral: 7, negative: 11 })
    expect(m.presentations.length).toBe(2)
    expect(m.commentary.length).toBe(3)
    expect(m.commentary.every(c => !!c.source)).toBe(true) // source-attributed
  })
})
