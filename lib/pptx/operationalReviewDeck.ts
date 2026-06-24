// lib/pptx/operationalReviewDeck.ts
// Builds the "Operational Review" DeckSpec — ONE merged report that combines the
// independent-acquirer diligence framing (lib/pptx/diligenceDeck.ts) with the
// operator-grade "recover your 1–3★ guests" improvement detail
// (lib/pptx/improvementPlanDeck.ts), plus a NEW Dimensions (aspect-sentiment)
// section sourced from lib/taxonomyRollup.ts. Slide-construction logic is COPIED
// from both existing builders (not imported). Every figure traces to `p`, `d`,
// or `opts.dimensions` — no fabrication.

import type { OutletPredictor } from '@/lib/outletPredictor'
import type { DiligenceData } from '@/lib/diligenceData'
import type { TaxonomyRollup } from '@/lib/taxonomyRollup'
import type { DeckSpec, SlideSpec } from './slideRenderer'
import { DN, trunc } from './shared'
import type { DiligenceOpts } from './diligenceDeck'

const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`
const pct0 = (n: number) => `${Math.round(n * 100)}%`
const rankWord = (p: number) => (p >= 90 ? 'bottom 10%' : 'bottom 25%')
function locOnly(label: string): string {
  const i = label.indexOf(' — ')
  return i >= 0 ? label.slice(i + 3) : label
}

export interface OperationalOpts extends DiligenceOpts {
  dimensions?: TaxonomyRollup | null
}

export function buildOperationalReviewDeck(
  p: OutletPredictor,
  d: DiligenceData,
  brand: string,
  opts: OperationalOpts = {},
): DeckSpec {
  const slides: SlideSpec[] = []
  const m = p.model
  const outlets = p.outletSummaries
  const ratings = outlets.map((o) => o.rating ?? 0).filter((r) => r > 0)
  const bestRating = ratings.length ? Math.max(...ratings) : 0
  const worstRating = ratings.length ? Math.min(...ratings) : 0
  const gap = bestRating - worstRating
  const fiveStar = d.starDist.find((s) => s.star === 5)?.pct ?? 0
  const oneTwo = (d.starDist.find((s) => s.star === 1)?.pct ?? 0) + (d.starDist.find((s) => s.star === 2)?.pct ?? 0)
  const franchise = new Set((opts.franchiseStates || []).map((s) => s.toLowerCase()))
  const isFranchise = (state: string) => franchise.has(state.toLowerCase())

  // ── 1. Executive summary (kpi_grid) — from diligence ──────────────────────
  const compNote =
    opts.competitors?.length && opts.brandLifetime
      ? ` On a lifetime basis it sits near parity with its closest direct competitor (${opts.brandLifetime.rating.toFixed(2)}★ vs ${opts.competitors[0].name} at ${opts.competitors[0].rating.toFixed(2)}★).`
      : ''
  slides.push({
    type: 'kpi_grid',
    title: 'Executive Summary',
    subtitle: `${d.reviewCount.toLocaleString()} Google reviews · ${outlets.length} locations analyzed · last 18 months (${d.window.label})`,
    kpis: [
      { value: `${d.blendedRating.toFixed(2)}★`, label: 'Blended rating', sub: `${d.reviewCount.toLocaleString()} rated reviews`, color: DN.teal },
      { value: pct0(fiveStar / 100), label: 'Five-star share', sub: 'of recent reviews', color: DN.green },
      { value: pct1(oneTwo / 100), label: '1–2★ share', sub: 'the detractor base', color: DN.red },
      { value: String(outlets.length), label: 'Outlets analyzed', sub: '≥30 reviews each', color: DN.navy },
      { value: `${gap.toFixed(2)}★`, label: 'Best→worst store gap', sub: `${bestRating.toFixed(2)}★ to ${worstRating.toFixed(2)}★`, color: DN.gold },
      { value: pct0(d.ownerResponseRate), label: 'Owner-response rate', sub: 'engagement signal', color: DN.slate },
    ],
    insight:
      `The current customer base is healthy: a ${d.blendedRating.toFixed(2)}★ blended rating over the last 18 months with ${pct0(fiveStar / 100)} five-star reviews. ` +
      `The weakness is variance, not the brand — store ratings span ${worstRating.toFixed(2)}★ to ${bestRating.toFixed(2)}★ (a ${gap.toFixed(2)}★ gap), and that spread is geographic and operationally fixable.${compNote} The upside is operational, not a repositioning.`,
  })

  // ── 2. Brand health — star distribution (column chart) — from diligence ────
  const first3 = d.monthly.slice(0, 3)
  const last3 = d.monthly.slice(-3)
  const avg = (a: { count: number }[]) => (a.length ? Math.round(a.reduce((s, mm) => s + mm.count, 0) / a.length) : 0)
  const firstAvg = avg(first3)
  const lastAvg = avg(last3)
  const starColor = (star: number) =>
    star >= 4 ? DN.teal : star === 3 ? DN.slate : star === 2 ? DN.orange : DN.red
  let healthInsight =
    `${pct0(fiveStar / 100)} five-star, ${pct1(oneTwo / 100)} one-or-two over the last 18 months (${d.window.label}); ` +
    `these figures reflect recent reviews only, not each store's full history.`
  if (d.volumeRampFlag) {
    healthInsight +=
      ` Cautionary note: review volume rose sharply over the period (~${firstAvg} → ~${lastAvg}/month), ` +
      `which may indicate an active push to solicit Google reviews — recent averages may be positively skewed.`
  }
  slides.push({
    type: 'column_chart',
    title: 'Brand Health — Last 18 Months',
    subtitle: `Star distribution · ${d.reviewCount.toLocaleString()} rated reviews · ${d.window.label}`,
    data: d.starDist.map((s) => ({
      label: `${s.star}★`,
      value: Math.round(s.pct * 10) / 10,
      color: starColor(s.star),
    })),
    yAxisLabel: '% of reviews',
    insight: healthInsight,
  })

  // ── 3. Performance by state (column chart) — from diligence ────────────────
  if (d.byState.length) {
    const weakest = [...d.byState].sort((a, b) => a.rating - b.rating)[0]
    const franchiseStateRows = d.byState.filter((s) => isFranchise(s.state))
    const franchiseNote = franchiseStateRows.length
      ? ` Franchise states (${franchiseStateRows.map((s) => s.state).join(', ')}) are outside direct corporate control and warrant separate diligence.`
      : ''
    slides.push({
      type: 'column_chart',
      title: 'Performance by State',
      subtitle: `Review-weighted rating by state · stores with ≥15 reviews`,
      yAxisLabel: 'Average Google rating',
      data: d.byState.map((s) => ({
        label: `${s.state}${isFranchise(s.state) ? ' (franchise)' : ''}`,
        value: Math.round(s.rating * 100) / 100,
        color: isFranchise(s.state) ? DN.orange : undefined,
      })),
      insight:
        `Ratings range from ${d.byState[d.byState.length - 1].rating.toFixed(2)}★ to ${d.byState[0].rating.toFixed(2)}★ across states. ` +
        `The weakest state — ${weakest.state} at ${weakest.rating.toFixed(2)}★ — is the diligence focus.${franchiseNote}`,
    })
  }

  // ── 4. Location leaderboard (top 5 + bottom 5 by rating) — from diligence ──
  const byRating = [...outlets].filter((o) => o.rating != null).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
  const top5 = byRating.slice(0, 5)
  const bottom5 = byRating.slice(-5).reverse()
  slides.push({
    type: 'table',
    title: 'Location Leaderboard',
    subtitle: `Top 5 and bottom 5 of ${outlets.length} outlets by average rating · spread ${worstRating.toFixed(2)}★–${bestRating.toFixed(2)}★`,
    columns: ['Location', 'Rating', 'Reviews', 'Tier'],
    rows: [
      ...top5.map((o) => [trunc(locOnly(o.label), 40), `${(o.rating ?? 0).toFixed(2)}★`, String(o.reviews ?? ''), '▲ Top 5']),
      ...bottom5.map((o) => [trunc(locOnly(o.label), 40), `${(o.rating ?? 0).toFixed(2)}★`, String(o.reviews ?? ''), '▼ Bottom 5']),
    ],
    // color-code the two groups: faint green for the top 5, faint red for the bottom 5
    rowTints: [...top5.map(() => 'E4F0E7'), ...bottom5.map(() => 'F8E6DF')],
    insight:
      `A tight, well-run network with a shallow tail: the gap from best (${bestRating.toFixed(2)}★) to worst (${worstRating.toFixed(2)}★) is ${gap.toFixed(2)}★. ` +
      `The leaderboard is the operating manual — the top stores are a ready-made playbook for lifting the bottom five.`,
  })

  // ── 5. Where to start — highest 1–3★ outlets (table) — from improvement plan ─
  const hotlist = outlets.slice(0, 10)
  slides.push({
    type: 'table',
    title: 'Where to Start — Highest 1–3★ Outlets',
    subtitle: `Lowest-performing outlets and the issue they rank worst on (${outlets.length} outlets ranked)`,
    columns: ['Location', '1–3★ rate', 'Rating', 'Worst-ranked issue'],
    rows: hotlist.map((o) => [
      trunc(locOnly(o.label), 30), pct1(o.lowRate), o.rating != null ? `${o.rating.toFixed(2)}★` : '—',
      o.topIssue ? trunc(o.topIssue.theme, 24) : 'no single weakness',
    ]),
    insight: 'Start where the 1–3★ rate is highest and review volume is real — those outlets drag the brand average the most. The last column is the theme each ranks worst on vs all locations.',
  })

  // ── 6. What drives the stars (two-column: protect vs fix) — from diligence ──
  const themeActions = p.recommendedActions.filter((a) => a.kind === 'theme' && a.theme)
  const fixThemes = themeActions.length
    ? themeActions.slice(0, 5).map((a) => `${trunc(a.theme as string, 36)} — ~${Math.round(a.recovered)} recoverable 1–3★ guests`)
    : p.brandLevers.slice(0, 5).map((dr) => `${trunc(dr.theme, 34)} — ${dr.lift.toFixed(1)}× over-represented in 1–3★ reviews`)
  const protectItems = p.exemplars.length
    ? p.exemplars.slice(0, 5).map((e) => `${trunc(locOnly(e.label), 30)} — just ${pct1(e.lowRate)} 1–3★${e.rating != null ? ` (${e.rating.toFixed(2)}★)` : ''}`)
    : []
  const protectBullets = protectItems.length
    ? protectItems
    : top5.map((o) => `${trunc(locOnly(o.label), 30)} — ${(o.rating ?? 0).toFixed(2)}★`)
  slides.push({
    type: 'two_column',
    title: 'What Drives the Stars',
    subtitle: 'Strengths to protect post-close vs the controllable issues that drag the average',
    left: {
      heading: 'Protect — your strongest operators',
      bullets: protectBullets.length ? protectBullets : ['Best operators run consistently at low detractor rates.'],
    },
    right: {
      heading: 'Fix — the themes dragging ratings',
      bullets: fixThemes.length ? fixThemes : ['No single systemic driver — issues are location-specific (see leaderboard).'],
    },
  })

  // ── 7. The systemic driver (table) — from improvement plan (only if drivers) ─
  const drivers = p.brandLevers
  const nonDrivers = p.drivers.filter((dr) => !dr.isDriver && !dr.isOutcome && dr.nBad >= 20)
  if (drivers.length) {
    slides.push({
      type: 'table',
      title: 'The Systemic Driver',
      subtitle: 'The one theme over-represented in 1–3★ vs 4–5★ reviews chain-wide — your one cross-brand operational issue',
      columns: ['Theme', 'In 1–3★', 'In 4–5★', 'Over-rep.', 'Mentions'],
      rows: drivers.map((dr) => [trunc(dr.theme, 30), pct0(dr.pBad), pct0(dr.pGood), `${dr.lift.toFixed(1)}×`, String(dr.nBad)]),
      insight: `${drivers[0].theme} is the only theme systematically more common in unhappy reviews brand-wide (${drivers[0].lift.toFixed(1)}×).` +
        (p.outcomeSignals.length ? ` ${p.outcomeSignals.map((dr) => dr.theme).join(', ')} also over-indexes, but that's a lagging OUTCOME, not a lever.${(() => { const c = p.outcomeCorrelations.find((x) => p.outcomeSignals.some((s) => s.theme === x.outcome)); const t = c?.drivers.filter((dr) => dr.lift >= 1.2).slice(0, 2) || []; return t.length ? ` Brand-wide it travels most with ${t.map((dr) => `${dr.theme} (${dr.lift.toFixed(1)}×)`).join(' and ')} — prioritize those to protect loyalty.` : '' })()}` : '') +
        (nonDrivers.length ? ` Everything else is discussed ~equally by happy and unhappy guests (loud topics, not differentiators). Beyond this one systemic issue, the problems are LOCATION-SPECIFIC — see the per-theme focus slides.` : ''),
    })
  }

  // ── 8. Where to focus — one slide PER actionable theme — from improvement plan ─
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

  // ── 9. Value-creation levers (table, recommended actions) — from diligence ─
  if (p.recommendedActions.length) {
    const total = p.recommendedActions[p.recommendedActions.length - 1].cumulative
    slides.push({
      type: 'table',
      title: 'Value-Creation Levers',
      subtitle: 'Controllable levers ranked by detractors recovered at the peer median, de-duplicated so each line is additive',
      columns: ['#', 'Lever', 'Scope', 'Detractors recovered'],
      rows: p.recommendedActions.map((a, i) => [
        String(i + 1),
        a.kind === 'outlet'
          ? `Turn around ${trunc(locOnly(a.label || ''), 26)}`
          : `${trunc(a.theme || '', 26)} program${a.trend === 'up' ? ' (▲)' : ''}`,
        a.kind === 'outlet' ? `${a.weaknessThemes?.length ?? 0} themes` : `${a.cohort} outlets`,
        `+${Math.round(a.recovered)}`,
      ]),
      insight:
        `Each line is a concrete, controllable lever — no repositioning required. ` +
        `Executed in sequence they recover ~${Math.round(total)} of ${m.lowCount.toLocaleString()} detractors (~${Math.round((total / Math.max(m.lowCount, 1)) * 100)}%) at the peer median — a conservative floor for the operational value-creation case.`,
    })
  }

  // ── 10. Dimensions section (NEW) — only if classified signal exists ─────────
  const dim = opts.dimensions
  if (dim && dim.withSignal > 0) {
    // 10a. Aspect coverage (column_chart) — the 7 axes by mention rate.
    // (column_chart, not bar_chart: bar_chart adds a misleading %-of-total column
    // for a rate metric — the per-axis mention rate IS the value here.)
    slides.push({
      type: 'column_chart',
      title: 'Dimensions — Aspect Coverage',
      subtitle: `Aspect-level ABSA lens · ${dim.withSignal.toLocaleString()} of ${dim.classifiedRows.toLocaleString()} classified reviews carry at least one aspect`,
      yAxisLabel: '% of classified reviews mentioning the axis',
      data: dim.axes.map((a) => ({ label: a.label, value: Math.round(a.rate) })),
      insight:
        `Dimensions are an aspect-level ABSA lens — touchpoint, attribute, product, beverage, ambiance, context, and outcome. ` +
        `Each value is the share of classified reviews that mention the axis (${dim.axes.map((a) => `${a.label} ${Math.round(a.rate)}%`).slice(0, 3).join(', ')}…). ` +
        `This is the lens the parent org tracks.`,
    })

    // 10b. What stands out (table) — top sub-aspects by count.
    const topSubs = [...dim.subs].sort((a, b) => b.count - a.count).slice(0, 10)
    const ranked = topSubs.filter((s) => s.posPct != null)
    const lowest = [...ranked].sort((a, b) => (a.posPct as number) - (b.posPct as number)).slice(0, 3)
    let standOut =
      `Which specific aspects are most positive vs most negative. ` +
      (lowest.length
        ? `The fix list is the lowest %-positive aspects: ${lowest.map((s) => `${s.sub} (${s.posPct}%)`).join(', ')}.`
        : `Sentiment polarity is sparse — counts shown, %-positive where assertions exist.`)
    if (dim.alerts.length) {
      standOut += ` Severity alerts flagged: ${dim.alerts.map((a) => `${a.tag} (${a.count})`).join(', ')} across ${dim.alertRows.toLocaleString()} reviews (food-safety / pests) — review these first.`
    }
    slides.push({
      type: 'table',
      title: 'Dimensions — What Stands Out',
      subtitle: `Top ${topSubs.length} sub-aspects by mention volume · % positive and avg ★ where polarity is available`,
      columns: ['Aspect', 'Axis', 'Mentions', '% Positive', 'Avg ★'],
      rows: topSubs.map((s) => [
        trunc(s.sub, 28),
        s.axis,
        String(s.count),
        s.posPct != null ? `${s.posPct}%` : '—',
        s.avgRating != null ? `${s.avgRating.toFixed(1)}★` : '—',
      ]),
      insight: standOut,
    })
  }

  // ── 11. What guests are telling you (quotes) — from improvement plan ───────
  const seen = new Set<string>()
  const quotes: { text: string; attribution?: string }[] = []
  for (const o of outlets) {
    if (quotes.length >= 6) break
    const lever = (p.outletLevers[o.placeId] || []).find((l) => l.quote)
    if (!lever?.quote) continue
    const key = lever.quote.slice(0, 60).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    quotes.push({ text: trunc(lever.quote, 180), attribution: `${locOnly(o.label)} · ${o.lowCount} 1–3★ reviews` })
  }
  if (quotes.length >= 2) {
    slides.push({
      type: 'quotes',
      title: 'What Guests Are Telling You',
      subtitle: 'Verbatim 1–3★ reviews from the lowest-rated outlets',
      quotes,
    })
  }

  // ── 12. Who already does it well (bullets) — from improvement plan ─────────
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

  // ── 13. Competitive benchmark (column chart) — from diligence (if competitors) ─
  if (opts.competitors?.length && opts.brandLifetime) {
    const bars = [
      { label: brand, value: Math.round(opts.brandLifetime.rating * 100) / 100, color: DN.teal },
      ...opts.competitors.map((c) => ({ label: c.name, value: Math.round(c.rating * 100) / 100, color: DN.slate })),
    ]
    const lead = opts.competitors[0]
    const diff = opts.brandLifetime.rating - lead.rating
    const parity =
      Math.abs(diff) < 0.1
        ? `${brand} sits at near-parity with ${lead.name} (${opts.brandLifetime.rating.toFixed(2)}★ vs ${lead.rating.toFixed(2)}★).`
        : diff > 0
          ? `${brand} leads ${lead.name} by ${diff.toFixed(2)}★ on lifetime ratings (${opts.brandLifetime.rating.toFixed(2)}★ vs ${lead.rating.toFixed(2)}★).`
          : `${brand} trails ${lead.name} by ${Math.abs(diff).toFixed(2)}★ on lifetime ratings (${opts.brandLifetime.rating.toFixed(2)}★ vs ${lead.rating.toFixed(2)}★).`
    slides.push({
      type: 'column_chart',
      title: 'Competitive Benchmark',
      subtitle: 'Lifetime Google ratings, vote-weighted',
      yAxisLabel: 'Lifetime Google rating',
      data: bars,
      insight:
        `${parity} Note the lifetime figure (${opts.brandLifetime.rating.toFixed(2)}★) differs from the 18-month blended rating (${d.blendedRating.toFixed(2)}★) — ` +
        `the recent window is the better read of the brand the buyer would operate.`,
    })
  }

  // ── 14. Method & diligence notes (bullets) — merged ────────────────────────
  const methodBullets: string[] = [
    `Source & scope: ${d.reviewCount.toLocaleString()} star-rated Google reviews (${d.textCount.toLocaleString()} with text), all ${outlets.length} analyzed locations, last 18 months (${d.window.label}) — pulled via DataForSEO.`,
    `Two rating lenses: an 18-month blended rating (${d.blendedRating.toFixed(2)}★, what the brand looks like today) vs the lifetime Google rating${opts.brandLifetime ? ` (${opts.brandLifetime.rating.toFixed(2)}★)` : ''} — recent is the better read for an operator.`,
    `Low-rated = 1–3★ reviews. Systemic driver = a theme over-represented in 1–3★ vs 4–5★ reviews chain-wide (controls for base rate, so loud-but-neutral topics don't mislead); per-theme focus = each location's peer rank on a theme by its problem rate.`,
    `Confirm the franchise split in diligence: ${franchise.size ? `${[...new Set((opts.franchiseStates || []))].join(', ')} appear${(opts.franchiseStates?.length ?? 0) === 1 ? 's' : ''} to be franchised and sit outside direct corporate control` : 'verify which locations are corporate vs franchised before underwriting the operational upside'}.`,
  ]
  if (d.volumeRampFlag) {
    methodBullets.push(
      `Review-volume rise (~${firstAvg} → ~${lastAvg}/month): confirm whether this reflects an active Google-review solicitation program, which would positively skew the recent blended rating.`,
    )
  }
  if (opts.competitors?.length) {
    methodBullets.push(
      `Competitor benchmark (${opts.competitors.map((c) => c.name).join(', ')}) is a one-time live pull for context — a snapshot, not an ongoing feed.`,
    )
  }
  if (dim && dim.withSignal > 0) {
    methodBullets.push(
      `Dimensions = a keyword ABSA taxonomy (v3): each review is classified across seven aspect axes (touchpoint, attribute, product, beverage, ambiance, context, outcome) with polarity per assertion — the aspect-level lens the parent org tracks.`,
    )
  }
  methodBullets.push(
    `Findings are associational, not causal — an independent operational read benchmarking outlets against their peers. Prepared${opts.preparedFor ? ` for ${opts.preparedFor}` : ''} · datanautix.com`,
  )
  slides.push({
    type: 'bullets',
    title: 'Method & Diligence Notes',
    subtitle: 'How this review was produced and what to confirm',
    bullets: methodBullets,
  })

  return {
    title: `${brand} — Operational Review`,
    subtitle: `${d.reviewCount.toLocaleString()} reviews · ${p.outletSummaries.length} outlets · last 18 months`,
    slides,
  }
}
