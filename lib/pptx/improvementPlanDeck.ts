// lib/pptx/improvementPlanDeck.ts
// Flattens the theme predictor (lib/outletPredictor.ts) into a DeckSpec — the
// brand-level "recover your 1–3★ guests" plan as a leave-behind PPTX. The
// in-product /improvement-plan page holds the interactive view; this is the
// Datanautix-branded hand-off artifact (the "why you need us" deck). Same
// predictor object backs both. Every figure is real (no fabricated data).

import type { OutletPredictor } from '@/lib/outletPredictor'
import type { DeckSpec, SlideSpec } from './slideRenderer'
import { DN, trunc } from './shared'

const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`
const pct0 = (n: number) => `${Math.round(n * 100)}%`
function locOnly(label: string): string {
  const i = label.indexOf(' — ')
  return i >= 0 ? label.slice(i + 3) : label
}

export function buildImprovementPlanDeck(p: OutletPredictor, brand: string): DeckSpec {
  const slides: SlideSpec[] = []
  const m = p.model
  const drivers = p.brandLevers
  const nonDrivers = p.drivers.filter((d) => !d.isDriver && d.nBad >= 20)
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
    insight: `1–3★ rates range from ${pct1(m.bestLowRate)} to ${pct1(m.worstLowRate)} across outlets — that spread is operational inconsistency you can close. Pulling every outlet to your best-run quarter (~${pct1(m.targetLowRate)}) would cut the brand’s 1–3★ rate to about ${pct1(m.projectedLowRate)}.`,
  })

  // 2. What drives unhappy guests — over-representation, not raw frequency. A
  // table (not a bar chart) because the story is a multiple, not a distribution.
  if (drivers.length) {
    slides.push({
      type: 'table',
      title: 'What Drives Your Unhappy Guests',
      subtitle: 'Themes over-represented in 1–3★ reviews vs 4–5★ reviews — the real drivers, not the loudest topics',
      columns: ['Theme', 'In 1–3★', 'In 4–5★', 'Over-rep.', 'Mentions'],
      rows: drivers.map((d) => [trunc(d.theme, 30), pct0(d.pBad), pct0(d.pGood), `${d.lift.toFixed(1)}×`, String(d.nBad)]),
      insight: `“Over-rep.” = how many times more likely the theme is in an unhappy review than a happy one — ${drivers[0].theme} leads at ${drivers[0].lift.toFixed(1)}×.` +
        (nonDrivers.length ? ` Loud-but-neutral topics (≈1×, discussed equally by happy and unhappy guests) are NOT drivers: ${nonDrivers.map((d) => `${d.theme} ${d.lift.toFixed(1)}×`).join(', ')}.` : ''),
    })
  }

  // 4. Where to start — outlet hot-list by 1–3★ rate.
  slides.push({
    type: 'table',
    title: 'Where to Start — Highest 1–3★ Rates',
    subtitle: `Lowest-performing outlets and what their unhappy guests cite (${p.outletSummaries.length} outlets ranked)`,
    columns: ['Location', '1–3★ rate', 'Rating', 'Unhappy guests cite'],
    rows: hotlist.map((o) => [
      trunc(locOnly(o.label), 30),
      pct1(o.lowRate),
      o.rating != null ? `${o.rating.toFixed(2)}★` : '—',
      o.topDriver ? trunc(o.topDriver.theme, 24) : 'diffuse',
    ]),
    insight: 'Start where the 1–3★ rate is highest and review volume is real — those outlets drag the brand average the most.',
  })

  // 5. What guests are telling you — real 1–3★ quotes from the worst outlets.
  const seen = new Set<string>()
  const quotes: { text: string; attribution?: string }[] = []
  for (const o of p.outletSummaries) {
    if (quotes.length >= 6) break
    const lever = (p.outletLevers[o.placeId] || [])[0]
    if (!lever?.quote) continue
    const key = lever.quote.slice(0, 60).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    // Attribute to the location only — keyword matching ties a quote to a theme
    // loosely, so we don't claim a quote exemplifies a specific driver.
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
      'A theme’s “driver” strength = its over-representation: P(theme | 1–3★) ÷ P(theme | 4–5★). This controls for base rate, so a frequently-discussed but neutral topic doesn’t masquerade as a problem.',
      'Outlet 1–3★ rates and the best-quartile target are straight counts — no modeling. Themes are matched by keyword on the review text.',
      `Computed from ${m.population.toLocaleString()} rated reviews across ${p.outletSummaries.length} outlets. Associational, not causal — a prioritization signal that benchmarks outlets against their own peers.`,
      'Prepared by Datanautix · datanautix.com',
    ],
  })

  return {
    title: `${brand} — Guest Experience Improvement Plan`,
    subtitle: `${pct1(m.lowRate)} of reviews are 1–3★ · ${p.outletSummaries.length} outlets · ${m.population.toLocaleString()} reviews`,
    slides,
  }
}
