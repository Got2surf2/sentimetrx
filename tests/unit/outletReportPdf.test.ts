// lib/outletReportPdf.ts — the three composed outlet documents (deep-dive,
// leaderboard, hierarchy rung) typeset from the payload the PAGE posts back.
// Pure string builders, so the tests read the HTML they emit: every figure the
// payload carries lands once, guarded verbatims obey lib/verbatimGuard, empty
// blocks say so instead of vanishing, and client-supplied text is escaped.
import { describe, it, expect } from 'vitest'
import { buildOutletReportHtml, buildLeaderboardHtml, buildHierarchyRungHtml } from '@/lib/outletReportPdf'
import type { OutletPdfPayload, LeaderboardPdfPayload, HierarchyPdfPayload } from '@/lib/outletPdfPayload'
import type { OutletSnapshot, TrendPoint } from '@/lib/outletReport'
import type { OutletSummary, PredictorModel, WhatIfView } from '@/lib/outletPredictor'

const snapshot = (over: Partial<OutletSnapshot> = {}): OutletSnapshot => ({
  asOf: 'May 2026', dateRange: 'Apr 2021 – May 2026',
  distribution: [
    { star: 5, count: 120, pct: 0.6, net: { min: 0.3, avg: 0.5, max: 0.7 } },
    { star: 4, count: 40, pct: 0.2, net: { min: 0.1, avg: 0.25, max: 0.4 } },
    { star: 3, count: 20, pct: 0.1, net: { min: 0.05, avg: 0.1, max: 0.2 } },
    { star: 2, count: 12, pct: 0.06, net: { min: 0.02, avg: 0.06, max: 0.1 } },
    { star: 1, count: 8, pct: 0.04, net: { min: 0.01, avg: 0.05, max: 0.15 } },
  ],
  fiveStarShare: 0.6, detractorShare: 0.1, ownerResponseRate: 0.35, ownerResponseBand: 'Below network',
  recent: { count: 30, avg: 4.4, direction: 'up' },
  fleet: { rank: 3, total: 40, band: 'Top quartile', peerNoun: 'stores ≥200 reviews' },
  themeTable: [
    { theme: 'Service', mentions: 80, avgStar: 4.5, pctNegative: 0.1, read: 'STRENGTH' },
    { theme: 'Wait Time', mentions: 50, avgStar: 3.1, pctNegative: 0.5, read: 'FIX' },
  ],
  praiseChips: ['Service', 'Food'],
  praiseVerbatims: [
    { theme: 'Service', rating: 5, quote: 'Our server was wonderful and attentive' },
    { theme: 'Food', rating: 5, quote: 'It was terrible and cold' },   // rating says praise, the sentence does not → guard drops it
  ],
  ...over,
})

const TREND: TrendPoint[] = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03'].map((month, i) => ({ month, outletAvg: i === 2 ? null : 4.0 + i * 0.05, networkAvg: 4.0 }))

const SUMMARY = { gapToTarget: 0.04, lowRate: 0.1, lowCount: 20, lowRateRank: 4 } as unknown as OutletSummary
const MODEL = { lowRate: 0.08, bestLowRate: 0.03 } as unknown as PredictorModel
const WHATIF: WhatIfView = {
  themes: ['Wait Time', 'Cleanliness'], reviews13: [[0], [0, 1], [1], []],
  currentRate: [0.12, 0.05], medianRate: [0.06, 0.06], bestRate: [0.03, 0.02], worstRate: [0.2, 0.1],
  totalReviews: 200, ratedReviews: 200, lowCount: 20, lowRate: 0.1, avg: 4.3, detractorAvg: 2.0, happyAvg: 4.8,
  otherRatings: [4.5, 4.0, 4.2], currentRank: 2, outletCount: 4,
  trends: [{ direction: 'up', recentRate: 0.13, priorRate: 0.1 }, null], trendBasis: { recent: 'Q2 2026', prior: 'Q1 2026' },
}

function payload(over: Partial<OutletPdfPayload> = {}, sel: Partial<OutletPdfPayload['selected']> = {}): OutletPdfPayload {
  return {
    outlet: 'p1', brand: 'Cheddars', networkSize: 40, outletCount: 40, unitLabel: 'location',
    selected: {
      placeId: 'p1', name: 'Tampa, FL', address: '1 Main St', location: 'Tampa', reviews: 200, rating: 4.3, chainRating: 4.1, ratingDelta: 0.2,
      percentile: 80, rank: 3, outletCount: 40, narrative: 'Runs ahead of the network on service.', trend: TREND,
      themes: { available: false, analyzedReviews: 0, strengths: [], weaknesses: [] },
      dimensions: { available: true, analyzedReviews: 150,
        strengths: [{ sub: 'server', axis: 'touchpoint', label: 'Server', category: 'service', outletNet: 0.6, chainNet: 0.4, delta: 0.2, n: 70, quote: 'The server was great' }],
        weaknesses: [{ sub: 'wait', axis: 'touchpoint', label: 'Wait', category: 'service', outletNet: -0.2, chainNet: 0.1, delta: -0.3, n: 1, quote: 'Waited an hour' }] },
      snapshot: snapshot(), lowQuotes: [],
      ...sel,
    },
    plan: { priorities: [
      { tag: 'BIGGEST LEVER', title: 'Cut the wait', theme: 'Wait Time', diagnosis: 'Half the mentions are negative.', verbatims: [{ rating: 2, quote: 'Waited forever' }], actions: ['Add a host', 'Text when ready'] },
      { tag: 'NEXT', title: 'Keep service sharp', theme: 'Not In Table', diagnosis: 'No anchor row.', verbatims: [], actions: [] },
    ], keepDoing: 'Service is a genuine strength.', generatedAt: '2026-05-01' },
    levers: [
      { theme: 'Wait Time', problemRate: 0.12, peerPercentile: 80, shareInBad: 0.5, cohortSize: 10, soloRecovery: 3.4, quote: 'Waited an hour for a table, awful',
        exemplars: [{ placeId: 'x', label: 'Cheddars — Orlando, FL', lowRate: 0.05, rating: 4.6 }, { placeId: 'y', label: 'Cheddars — Ocala, FL', lowRate: 0.06, rating: null }] },
      { theme: 'Cleanliness', problemRate: 0.05, peerPercentile: 78, shareInBad: 0.2, cohortSize: 1, soloRecovery: 0.3, quote: 'It was great', exemplars: [] },
    ],
    strengths: [{ theme: 'Service', problemRate: 0.02, peerPercentile: 8, shareInBad: 0.1, cohortSize: 10, soloRecovery: 0, quote: 'Wonderful staff, so friendly', exemplars: [] }],
    summary: SUMMARY, model: MODEL, brandDrivers: ['Wait Time', 'Cleanliness'], whatIf: WHATIF,
    ...over,
  }
}

describe('buildOutletReportHtml — full payload', () => {
  const html = buildOutletReportHtml(payload())

  it('header + snapshot KPIs come straight from the payload', () => {
    expect(html).toContain('<h1>Tampa, FL</h1>')
    expect(html).toContain('Cheddars')
    expect(html).toContain('1 Main St · 200 Google reviews (Apr 2021 – May 2026) · full 40-store network')
    expect(html).toContain('May 2026')
    expect(html).toContain('4.30'); expect(html).toContain('4.40★ recent (up)')
    expect(html).toContain('Rank #3 of 40')
    expect(html).toContain('60%'); expect(html).toContain('Detractors 10%')
    expect(html).toContain('35%'); expect(html).toContain('Below network')
    expect(html).toContain('Top quartile'); expect(html).toContain('#3 of 40 stores ≥200 reviews')
  })
  it('distribution bars carry count, share, and the network spread markers', () => {
    expect(html).toContain('5★'); expect(html).toContain('<b>120</b> · 60%')
    expect(html).toContain('style="left:30%"'); expect(html).toContain('style="left:70%"'); expect(html).toContain('style="left:50%"')
    expect(html).toContain('1★'); expect(html).toContain('<b>8</b> · 4%')
  })
  it('theme table with READ pills; praise verbatims filtered by the verbatim guard', () => {
    expect(html).toContain('What guests talk about — and how it scores')
    expect(html).toMatch(/Wait Time<\/td>[\s\S]*?<td class="num">50<\/td>[\s\S]*?3\.10[\s\S]*?50%[\s\S]*?>FIX</)
    expect(html).toContain('>STRENGTH<')
    expect(html).toContain('Our server was wonderful and attentive')
    expect(html).not.toContain('It was terrible and cold')
    expect(html).toContain('>Service</span>'); expect(html).toContain('>Food</span>')
  })
  it('trend chart is an inline SVG over the dated points, skipping months with no outlet average', () => {
    expect(html).toContain('<svg viewBox="0 0 660 210"')
    expect((html.match(/<polyline/g) || []).length).toBe(2)
    expect(html).toContain('This location'); expect(html).toContain('Network avg')
  })
  it('action plan cards anchor to their theme row; a priority without a row gets no stats', () => {
    expect(html).toContain('Action plan — what to work on next')
    expect(html).toContain('AI-generated from 200 guest reviews')
    expect(html).toContain('<h3>Cut the wait</h3>')
    expect(html).toContain('<b>3.10★</b> · <b>50%</b> negative · 50 mentions')
    expect(html).toContain('“Waited forever”'); expect(html).toContain('<li>Add a host</li>')
    expect(html).toContain('<h3>Keep service sharp</h3>')
    expect(html).toContain('Service is a genuine strength.')
    expect((html.match(/<span class="pri-stats">/g) || []).length).toBe(1)   // the class name also appears in the stylesheet
  })
  it('dimensions block: signed deltas, singular mention, and one quote per side framed as "a review mentioning"', () => {
    expect(html).toContain('Dimensions — how this location compares to the network')
    expect(html).toContain('+20'); expect(html).toContain('−30')
    expect(html).toContain('<b>60%</b> net · 70 mentions'); expect(html).toContain('<b>−20%</b> net · 1 mention')
    expect(html).toContain('a review mentioning each')
    expect(html).toContain('“The server was great”'); expect(html).toContain('“Waited an hour”')
    expect(html).toContain('across all 40 locations')
  })
  it('narrative, recovery block and the systemic-driver callout', () => {
    expect(html).toContain('Runs ahead of the network on service.')
    expect(html).toContain('<b>10.0%</b> of Tampa, FL’s reviews are 1–3★ (20 of 200)')
    expect(html).toContain('<b>#4</b> highest 1–3★ rate of 40 outlets')
    expect(html).toContain('<b>8.0%</b> brand average and <b>3.0%</b> at your best location')
    expect(html).toContain('Below are the themes where this location ranks among the worst in the brand')
    expect(html).toContain('systemic</b> issues are <b>Wait Time and Cleanliness</b>')
    expect(html).toContain('You’re <b>bottom-quartile</b> on all 2.')
    expect(html).toContain('class="callout weak"')
  })
  it('lever cards: rank, recovery words, guarded quote, exemplars; strengths use the top-quartile wording', () => {
    expect(html).toContain('Work these — biggest win first')
    expect(html).toContain('<span class="rank">1</span><b>Wait Time</b>')
    expect(html).toContain('<b>12.0%</b> of all reviews here are 1–3★ and cite this (50.0% of its 1–3★ reviews). You’re one of <b>10</b> outlets in the bottom quartile here.')
    expect(html).toContain('about 3 unhappy guests')
    expect(html).toContain('“Waited an hour for a table, awful”')
    expect(html).toContain('Learn from</b> Orlando, FL (4.6★), Ocala, FL')
    expect(html).toContain('under 1 unhappy guest — it almost always arrives alongside another complaint')
    expect(html).not.toContain('“It was great”')          // a positive sentence cannot illustrate a weakness
    expect(html).toContain('What this location does best — top quartile vs all outlets')
    expect(html).toContain('top 10% of locations')
    expect(html).toContain('“Wonderful staff, so friendly”')
    expect(html).toContain('peer-ranked')
  })
  it('what-if: biggest gap first, trend cells, the peer-median scenario resolved with projectRecovery', () => {
    const wi = html.slice(html.indexOf('What-if'))
    expect(wi.indexOf('Wait Time')).toBeLessThan(wi.indexOf('Cleanliness'))
    expect(wi).toContain('12.0%'); expect(wi).toContain('6.0%'); expect(wi).toContain('3.0%')
    expect(wi).toContain('▲ worsening'); expect(wi).toContain('→ flat')
    expect(wi).toContain('ok-mark')                           // Cleanliness is already at/under the median
    expect(wi).toContain('Detractors recovered')
    expect(wi).toMatch(/~\d+<\/div>/)
    expect(wi).toContain('from 10.0%'); expect(wi).toContain('rank #2 →')
    expect(wi).toContain('Trend is brand-wide quarter-over-quarter (Q1 2026 → Q2 2026)')
  })
})

describe('buildOutletReportHtml — sparse payloads and escaping', () => {
  it('no predictor summary → the deeper-analysis block says why; no plan / no fleet / thin trend each degrade in words', () => {
    const html = buildOutletReportHtml(payload(
      { summary: null, model: null, plan: null, levers: [], strengths: [], whatIf: null, brandDrivers: [] },
      { snapshot: snapshot({ fleet: null, recent: null, praiseChips: [], praiseVerbatims: [], themeTable: [] }), trend: TREND.slice(0, 2), narrative: '', dimensions: { available: false, analyzedReviews: 0, strengths: [], weaknesses: [] } },
    ))
    expect(html).toContain('Not enough rated reviews at this location to build a plan.')
    expect(html).not.toContain('Action plan')
    expect(html).toContain('Under 200 reviews'); expect(html).toContain('>—<')
    expect(html).toContain('Network 4.10★')
    expect(html).toContain('Not enough dated reviews to chart a trend.')
    expect(html).not.toContain('What guests talk about'); expect(html).not.toContain('consistently praise')
    expect(html).not.toContain('Dimensions —'); expect(html).not.toContain('peer-ranked'); expect(html).not.toContain('What-if')
  })
  it('dimensions available but nothing cleared the floor → an explicit empty state', () => {
    const html = buildOutletReportHtml(payload({}, { dimensions: { available: true, analyzedReviews: 10, strengths: [], weaknesses: [] } }))
    expect(html).toContain('No dimension differed from the network by enough to report')
  })
  it('one systemic driver the outlet is strong on → the protect-it wording; at-par outlet gets the hold-the-line closing', () => {
    const html = buildOutletReportHtml(payload({ brandDrivers: ['Service'], levers: [], summary: { ...SUMMARY, gapToTarget: 0 } as unknown as OutletSummary }))
    expect(html).toContain('The chain’s one <b>systemic</b> issue is <b>Service</b>')
    expect(html).toContain('You’re <b>top-quartile</b> on it — protect that.')
    expect(html).toContain('class="callout strong"')
    expect(html).toContain('hold the line and share what’s working')
    expect(html).toContain('class="rec ok"')
  })
  it('no levers, not at par → the spread-across-topics closing; drivers the outlet is mid on → neutral stand', () => {
    const html = buildOutletReportHtml(payload({ brandDrivers: ['Parking'], levers: [] }))
    expect(html).toContain('Work the operational basics.')
    expect(html).toContain('None of them is a bottom-quartile weakness here.')
    expect(html).toContain('class="callout mid"')
  })
  it('client-supplied text is escaped and numbers in CSS positions are clamped', () => {
    const html = buildOutletReportHtml(payload({ brand: '<script>alert(1)</script>' }, { name: 'Tampa <b>FL</b>', snapshot: snapshot({ distribution: [{ star: 5, count: 1, pct: 7, net: { min: -1, avg: Number.NaN, max: 2 } }] }) }))
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('<h1>Tampa &lt;b&gt;FL&lt;/b&gt;</h1>')
    expect(html).toContain('style="width:100%')
    expect(html).toContain('style="left:0%"'); expect(html).toContain('style="left:100%"')
  })
})

describe('buildLeaderboardHtml', () => {
  const ranked = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `Store ${i + 1}`, net: 0.6 - i * 0.05, n: 40 - i, rating: i % 2 ? null : 4.5 - i * 0.05 }))
  const p: LeaderboardPdfPayload = {
    brand: 'Cheddars', outletCount: 40, k: 3,
    themes: [{ label: 'Service', category: '', chainNet: 0.45, chainN: 900, qualifying: 12, ranked: ranked(12) }],
    dimensions: [{ label: 'Wait', category: 'touchpoint', chainNet: -0.1, chainN: 300, qualifying: 5, ranked: ranked(5) }],
  }
  it('renders top/bottom K per item with the gap vs chain in points, collapsing to a single list when few qualify', () => {
    const html = buildLeaderboardHtml(p)
    expect(html).toContain('<h1>Outlet leaderboard</h1>')
    expect(html).toContain('40 outlets · showing 3 per side')
    expect(html).toContain('<h2>Themes</h2>'); expect(html).toContain('<h2>Dimensions</h2>')
    expect(html).toContain('chain +45% net · 900 mentions · 12 outlets')
    expect(html).toContain('● Top 3'); expect(html).toContain('● Bottom 3')
    expect(html).toContain('6 more outlets in between')
    expect(html).toContain('+15 pts')                                    // Store 1: 60% vs 45%
    expect(html).toContain('−40 pts')                                    // Store 12: 5% vs 45%
    expect(html).toContain('+60% net · 40 · 4.5★')
    expect(html).toContain('>touchpoint</span>')
    expect(html).toContain('All 5 outlets · best → worst')
    expect(html).toContain('chain -10% net')                                 // negative chain figures print the number's own minus
    expect(html).toContain('bold figure is the gap vs the chain average')
  })
  it('an empty axis is omitted and a single hidden outlet is singular', () => {
    const html = buildLeaderboardHtml({ ...p, dimensions: [], themes: [{ ...p.themes[0], qualifying: 7, ranked: ranked(7) }] })
    expect(html).not.toContain('<h2>Dimensions</h2>')
    expect(html).toContain('1 more outlet in between')
  })
})

describe('buildHierarchyRungHtml', () => {
  const p: HierarchyPdfPayload = {
    brand: 'Cheddars', name: 'Southeast', levelLabel: 'Region', childLevelLabel: 'District', crumbs: ['Network', 'Southeast'],
    reviews: 5000, rating: 4.2, outletCount: 25, networkOutlets: 100, strayOutlets: 2,
    snapshot: snapshot({ fleet: null }),
    children: [{ key: 'Tampa', outlets: 10, reviews: 2000, rating: 4.3 }, { key: 'Orlando', outlets: 15, reviews: 3000, rating: null }],
    outlets: [{ label: 'Cheddars — Tampa', sublabel: '4.3★', reviews: 200 }],
  }
  it('leads with the rung snapshot, then children and locations, and flags stray rows', () => {
    const html = buildHierarchyRungHtml(p)
    expect(html).toContain('Cheddars · Region')
    expect(html).toContain('<h1>Southeast</h1>')
    expect(html).toContain('Network › Southeast · 25 locations · 5,000 Google reviews (Apr 2021 – May 2026)')
    expect(html).toContain('Region performance snapshot')
    expect(html).toContain('4.20'); expect(html).toContain('4.40★ recent (up)')
    expect(html).toContain('25 locations')
    expect(html).toContain('Coverage'); expect(html).toContain('Full 100-store network')
    expect(html).toContain('across peer regions')
    expect(html).toContain('Districts under Southeast')
    expect(html).toMatch(/Orlando<\/td>[\s\S]*?<td class="num">15<\/td>[\s\S]*?<td class="num">3,000<\/td>[\s\S]*?>—</)
    expect(html).toContain('<h2>Locations</h2>')
    expect(html).toContain('Cheddars — Tampa')
    expect(html).toContain('⚠ 2 locations had rows disagreeing on their hierarchy path')
  })
  it('a fleet-ranked rung shows Standing; a single-location leaf reads singular; no children/outlets/strays → those blocks are absent', () => {
    const html = buildHierarchyRungHtml({ ...p, crumbs: ['Network'], outletCount: 1, strayOutlets: 0, children: [], outlets: [], rating: 0, snapshot: snapshot({ fleet: { rank: 2, total: 8, band: 'Upper half', peerNoun: 'regions' } }) })
    expect(html).toContain('Standing'); expect(html).toContain('Upper half'); expect(html).toContain('#2 of 8 regions')
    expect(html).toContain('1 location · 5,000 Google reviews')
    expect(html).not.toContain('Network ›')
    expect(html).toContain('>—<')
    expect(html).not.toContain('Districts under'); expect(html).not.toContain('<h2>Locations</h2>'); expect(html).not.toContain('⚠')
  })
})
