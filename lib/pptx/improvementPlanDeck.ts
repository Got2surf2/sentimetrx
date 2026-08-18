// lib/pptx/improvementPlanDeck.ts
// Flattens the theme predictor (lib/outletPredictor.ts) into a DeckSpec — the
// brand-level "recover your 1–3★ guests" plan as a leave-behind PPTX. The
// in-product /improvement-plan page holds the interactive view; this is the
// Datanautix-branded hand-off artifact (the "why you need us" deck). Same
// predictor object backs both. Every figure is real (no fabricated data).

import type { OutletPredictor } from '@/lib/outletPredictor'
import { verbatimSupports } from '@/lib/verbatimGuard'
import type { DeckSpec, SlideSpec } from './slideRenderer'
import { DN, trunc } from './shared'

const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`
const pct0 = (n: number) => `${Math.round(n * 100)}%`
const rankWord = (p: number) => (p >= 90 ? 'bottom 10%' : 'bottom 25%')
function locOnly(label: string): string {
  const i = label.indexOf(' — ')
  return i >= 0 ? label.slice(i + 3) : label
}

export function buildImprovementPlanDeck(p: OutletPredictor, brand: string): DeckSpec {
  const slides: SlideSpec[] = []
  const m = p.model
  const drivers = p.brandLevers
  const nonDrivers = p.drivers.filter((d) => !d.isDriver && !d.isOutcome && d.nBad >= 20)
  const worst = p.outletSummaries[0]
  const best = p.exemplars[0]
  const hotlist = p.outletSummaries.slice(0, 10)

  // 1. The opportunity — the 1–3★ rate and its spread.
  slides.push({
    type: 'kpi_grid',
    title: 'The Opportunity — Recover Your 1–3★ Guests',
    subtitle: `${p.outletSummaries.length} outlets · ${m.population.toLocaleString()} reviews · brand average ${m.chainAvg.toFixed(2)}★`,
    kpis: [
      { value: pct1(m.lowRate), label: '1–3★ review rate', sub: `${m.lowCount.toLocaleString()} of ${m.population.toLocaleString()}`, color: DN.navy },
      { value: pct1(m.bestLowRate), label: 'Best outlet', sub: best ? trunc(locOnly(best.label), 24) : 'lowest 1–3★', color: DN.green },
      { value: pct1(m.worstLowRate), label: 'Worst outlet', sub: worst ? trunc(locOnly(worst.label), 24) : 'highest 1–3★', color: DN.red },
      { value: pct1(m.targetLowRate), label: 'Best-quartile target', sub: 'an achievable benchmark', color: DN.teal },
      { value: pct1(m.projectedLowRate), label: 'If all hit target', sub: `down from ${pct1(m.lowRate)}`, color: DN.gold },
      { value: String(p.outletSummaries.length), label: 'Outlets analyzed', sub: '≥30 reviews each', color: DN.slate },
    ],
    insight: `1–3★ rates range from ${pct1(m.bestLowRate)} to ${pct1(m.worstLowRate)} across outlets — that spread is operational inconsistency you can close. Pulling every outlet to your best-run quarter (~${pct1(m.targetLowRate)}) would cut the brand's 1–3★ rate to about ${pct1(m.projectedLowRate)}.`,
  })

  // 1b. Recommended actions — the prioritized, de-duplicated playbook.
  if (p.recommendedActions.length) {
    const total = p.recommendedActions[p.recommendedActions.length - 1].cumulative
    slides.push({
      type: 'table',
      title: 'Recommended Actions — Your Prioritized Playbook',
      subtitle: 'Ranked by 1–3★ guests won back at the peer median, de-duplicated so each line is additive',
      columns: ['#', 'Action', 'Scope', 'Win back', 'Cumulative'],
      rows: p.recommendedActions.map((a, i) => [
        String(i + 1),
        a.kind === 'outlet' ? `Turn around ${trunc(locOnly(a.label || ''), 26)}` : `${trunc(a.theme || '', 26)} program${a.trend === 'up' ? ' (▲)' : ''}`,
        a.kind === 'outlet' ? `${a.weaknessThemes?.length} themes` : `${a.cohort} outlets`,
        `+${Math.round(a.recovered)}`,
        String(Math.round(a.cumulative)),
      ]),
      insight: `This sequence wins back ~${Math.round(total)} of ${m.lowCount.toLocaleString()} brand detractors (~${Math.round((total / m.lowCount) * 100)}%) at the peer median — a conservative floor (reviews citing an unaddressed theme aren't counted). Theme programs lead because single-issue complaints aggregate across the worst-quartile cohort; outlet turnarounds mop up the multi-issue stores.`,
    })
  }

  // 2. The systemic driver — over-representation across the whole chain.
  if (drivers.length) {
    slides.push({
      type: 'table',
      title: 'The Systemic Driver',
      subtitle: 'The one theme over-represented in 1–3★ vs 4–5★ reviews chain-wide — your one cross-brand operational issue',
      columns: ['Theme', 'In 1–3★', 'In 4–5★', 'Over-rep.', 'Mentions'],
      rows: drivers.map((d) => [trunc(d.theme, 30), pct0(d.pBad), pct0(d.pGood), `${d.lift.toFixed(1)}×`, String(d.nBad)]),
      insight: `${drivers[0].theme} is the only theme systematically more common in unhappy reviews brand-wide (${drivers[0].lift.toFixed(1)}×).` +
        (p.outcomeSignals.length ? ` ${p.outcomeSignals.map((d) => d.theme).join(', ')} also over-indexes, but that's a lagging OUTCOME, not a lever.${(() => { const c = p.outcomeCorrelations.find((x) => p.outcomeSignals.some((s) => s.theme === x.outcome)); const t = c?.drivers.filter((d) => d.lift >= 1.2).slice(0, 2) || []; return t.length ? ` Brand-wide it travels most with ${t.map((d) => `${d.theme} (${d.lift.toFixed(1)}×)`).join(' and ')} — prioritize those to protect loyalty.` : '' })()}` : '') +
        (nonDrivers.length ? ` Everything else is discussed ~equally by happy and unhappy guests (loud topics, not differentiators). Beyond this one systemic issue, the problems are LOCATION-SPECIFIC — see the per-theme focus slides.` : ''),
    })
  }

  // 3. One slide PER actionable theme — the outlets to focus on (bottom quartile).
  const themeSlides = p.actionableThemes
    .map((t) => ({ theme: t, focus: p.themeFocus[t] || [] }))
    .filter((x) => x.focus.length >= 2)
    .sort((a, b) => b.focus.length - a.focus.length)
  for (const { theme, focus } of themeSlides) {
    const ex = (p.themeExemplars[theme] || []).slice(0, 5).map((e) => locOnly(e.label))
    slides.push({
      type: 'table',
      title: `Where to Focus — ${trunc(theme, 40)}`,
      subtitle: `${focus.length} outlets rank in the bottom quartile on ${trunc(theme, 30)} (vs all locations)`,
      columns: ['Location', '1–3★ rate', 'Problem rate', 'Peer rank'],
      rows: focus.slice(0, 10).map((o) => [
        trunc(locOnly(o.label), 30), pct1(o.lowRate), pct1(o.problemRate), rankWord(o.peerPercentile),
      ]),
      insight: `Problem rate = share of a location's reviews that are 1–3★ and cite this theme — these are the bottom-quartile outlets to coach first.` +
        (ex.length ? ` Learn from the top performers on it: ${ex.join(', ')}.` : ''),
    })
  }

  // 4. Where to start overall — worst outlets by 1–3★ rate + their worst issue.
  slides.push({
    type: 'table',
    title: 'Where to Start — Highest 1–3★ Rates',
    subtitle: `Lowest-performing outlets and the issue they rank worst on (${p.outletSummaries.length} outlets ranked)`,
    columns: ['Location', '1–3★ rate', 'Rating', 'Worst-ranked issue'],
    rows: hotlist.map((o) => [
      trunc(locOnly(o.label), 30), pct1(o.lowRate), o.rating != null ? `${o.rating.toFixed(2)}★` : '—',
      o.topIssue ? trunc(o.topIssue.theme, 24) : 'no single weakness',
    ]),
    insight: 'Start where the 1–3★ rate is highest and review volume is real — those outlets drag the brand average the most. The last column is the theme each ranks worst on vs all locations.',
  })

  // 5. What guests are telling you — real 1–3★ quotes from the worst outlets.
  const seen = new Set<string>()
  const quotes: { text: string; attribution?: string }[] = []
  for (const o of p.outletSummaries) {
    if (quotes.length >= 6) break
    // Premise is the subtitle: "Verbatim 1–3★ reviews from the lowest-rated
    // outlets". A quote that doesn't read as a complaint contradicts it.
    const lever = (p.outletLevers[o.placeId] || []).find((l) => verbatimSupports(l.quote, 'negative'))
    if (!lever?.quote) continue
    const key = lever.quote.slice(0, 60).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    quotes.push({ text: trunc(lever.quote, 180), attribution: `${locOnly(o.label)} · ${o.lowCount} 1–3★ reviews` })
  }
  if (quotes.length >= 2) {
    slides.push({
      type: 'quotes',
      title: 'What Unhappy Guests Are Telling You',
      subtitle: 'Verbatim 1–3★ reviews from the lowest-rated outlets',
      quotes,
    })
  }

  // 6. Who already does it well — the best operators (learn-from).
  if (p.exemplars.length) {
    slides.push({
      type: 'bullets',
      title: 'Who Already Does It Well',
      subtitle: 'Your best operators — lowest 1–3★ rates at real volume',
      bullets: p.exemplars.map((e) =>
        `${locOnly(e.label)} — just ${pct1(e.lowRate)} of its reviews are 1–3★${e.rating != null ? ` (${e.rating.toFixed(2)}★)` : ''}. A best-practice visit or call surfaces what they do differently.`,
      ),
      insight: 'The fastest fixes are usually inside the network — a top-performing outlet is a ready-made playbook for the laggards.',
    })
  }

  // 7. Method & honesty.
  slides.push({
    type: 'bullets',
    title: 'Method & Honesty',
    subtitle: 'How this plan was produced',
    bullets: [
      'Low-rated = 1–3★ reviews (the guests dragging your average down). The opportunity is moving them up.',
      'Systemic driver = a theme over-represented in 1–3★ vs 4–5★ reviews chain-wide (controls for base rate, so loud-but-neutral topics don’t mislead).',
      'Per-theme focus = each location’s peer rank on a theme by its PROBLEM RATE (share of its reviews that are 1–3★ and cite the theme). Bottom quartile = a real, fixable weakness there.',
      'Lagging outcomes (brand loyalty) are reported as signals, not levers — you fix them by fixing the operational drivers. Themes matched by keyword on review text.',
      `Computed from ${m.population.toLocaleString()} rated reviews across ${p.outletSummaries.length} outlets. Associational, not causal — a prioritization signal benchmarking outlets against their peers. Prepared by Datanautix · datanautix.com`,
    ],
  })

  return {
    title: `${brand} — Guest Experience Improvement Plan`,
    subtitle: `${pct1(m.lowRate)} of reviews are 1–3★ · ${p.outletSummaries.length} outlets · ${m.population.toLocaleString()} reviews`,
    slides,
  }
}
