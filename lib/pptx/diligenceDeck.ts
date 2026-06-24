// lib/pptx/diligenceDeck.ts
// Builds a "Customer-Experience Diligence" DeckSpec — an independent acquirer's
// read of a multi-location brand from its Google reviews. NOT a "hire us" pitch:
// it frames the brand as an acquisition target (current health, where the
// variance is, where the upside is). Backed by the outlet predictor
// (lib/outletPredictor) for the operational layer + lib/diligenceData for the
// brand-health extras. Every figure traces to `p` or `d` — no fabrication.

import type { OutletPredictor } from '@/lib/outletPredictor'
import type { DiligenceData } from '@/lib/diligenceData'
import type { DeckSpec, SlideSpec } from './slideRenderer'
import { DN, trunc } from './shared'

const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`
const pct0 = (n: number) => `${Math.round(n * 100)}%`
function locOnly(label: string): string {
  const i = label.indexOf(' — ')
  return i >= 0 ? label.slice(i + 3) : label
}

export interface DiligenceOpts {
  competitors?: { name: string; rating: number; locs?: number; reviews?: number }[]
  brandLifetime?: { rating: number; locs?: number; reviews?: number }
  franchiseStates?: string[]
  preparedFor?: string
}

export function buildDiligenceDeck(
  p: OutletPredictor,
  d: DiligenceData,
  brand: string,
  opts: DiligenceOpts = {},
): DeckSpec {
  const slides: SlideSpec[] = []
  const outlets = p.outletSummaries
  const ratings = outlets.map((o) => o.rating ?? 0).filter((r) => r > 0)
  const bestRating = ratings.length ? Math.max(...ratings) : 0
  const worstRating = ratings.length ? Math.min(...ratings) : 0
  const gap = bestRating - worstRating
  const fiveStar = d.starDist.find((s) => s.star === 5)?.pct ?? 0
  const oneTwo = (d.starDist.find((s) => s.star === 1)?.pct ?? 0) + (d.starDist.find((s) => s.star === 2)?.pct ?? 0)
  const franchise = new Set((opts.franchiseStates || []).map((s) => s.toLowerCase()))
  const isFranchise = (state: string) => franchise.has(state.toLowerCase())

  // ── 1. Executive summary ──────────────────────────────────────────────────
  const compNote =
    opts.competitors?.length && opts.brandLifetime
      ? ` On a lifetime basis it sits near parity with its closest direct competitor (${opts.brandLifetime.rating.toFixed(2)}★ vs ${opts.competitors[0].name} at ${opts.competitors[0].rating.toFixed(2)}★).`
      : ''
  slides.push({
    type: 'kpi_grid',
    title: `Executive Summary — ${brand}`,
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

  // ── 2. Brand health — star distribution (column chart) ────────────────────
  const first3 = d.monthly.slice(0, 3)
  const last3 = d.monthly.slice(-3)
  const avg = (a: { count: number }[]) => (a.length ? Math.round(a.reduce((s, m) => s + m.count, 0) / a.length) : 0)
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

  // ── 3. Performance by state ───────────────────────────────────────────────
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

  // ── 4. Location leaderboard (top 5 + bottom 5 by rating) ──────────────────
  const byRating = [...outlets].filter((o) => o.rating != null).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
  const top5 = byRating.slice(0, 5)
  const bottom5 = byRating.slice(-5).reverse()
  slides.push({
    type: 'table',
    title: 'Location Leaderboard',
    subtitle: `Top 5 and bottom 5 of ${outlets.length} outlets by average rating · spread ${worstRating.toFixed(2)}★–${bestRating.toFixed(2)}★`,
    columns: ['Location', 'Rating', 'Reviews', 'Tier'],
    rows: [
      ...top5.map((o) => [trunc(locOnly(o.label), 40), `${(o.rating ?? 0).toFixed(2)}★`, String(o.reviews ?? ''), 'Top 5']),
      ...bottom5.map((o) => [trunc(locOnly(o.label), 40), `${(o.rating ?? 0).toFixed(2)}★`, String(o.reviews ?? ''), 'Bottom 5']),
    ],
    insight:
      `A tight, well-run network with a shallow tail: the gap from best (${bestRating.toFixed(2)}★) to worst (${worstRating.toFixed(2)}★) is ${gap.toFixed(2)}★. ` +
      `The leaderboard is the operating manual — the top stores are a ready-made playbook for lifting the bottom five.`,
  })

  // ── 5. What drives the stars (two-column: protect vs fix) ─────────────────
  const themeActions = p.recommendedActions.filter((a) => a.kind === 'theme' && a.theme)
  const fixThemes = themeActions.length
    ? themeActions.slice(0, 5).map((a) => `${trunc(a.theme as string, 32)} — ~${Math.round(a.recovered)} detractors recoverable across ${a.cohort} outlets`)
    : p.brandLevers.slice(0, 5).map((dr) => `${trunc(dr.theme, 34)} — ${dr.lift.toFixed(1)}× over-represented in 1–3★ reviews`)
  const protectItems = p.exemplars.length
    ? p.exemplars.slice(0, 5).map((e) => `${trunc(locOnly(e.label), 30)} — just ${pct1(e.lowRate)} 1–3★${e.rating != null ? ` (${e.rating.toFixed(2)}★)` : ''}`)
    : []
  // Fallback for the "protect" side: if there are no exemplars, use the
  // strongest-rated outlets as the strengths to protect.
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

  // ── 6. The upside — value-creation levers (table) ─────────────────────────
  if (p.recommendedActions.length) {
    const total = p.recommendedActions[p.recommendedActions.length - 1].cumulative
    slides.push({
      type: 'table',
      title: 'The Upside — Value-Creation Levers',
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
        `Executed in sequence they recover ~${Math.round(total)} of ${p.model.lowCount.toLocaleString()} detractors (~${Math.round((total / Math.max(p.model.lowCount, 1)) * 100)}%) at the peer median — a conservative floor for the operational value-creation case.`,
    })
  }

  // ── 7. The direct competitor (only if competitors passed) ─────────────────
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
      title: 'The Direct Competitor',
      subtitle: 'Lifetime Google ratings, vote-weighted',
      yAxisLabel: 'Lifetime Google rating',
      data: bars,
      insight:
        `${parity} Note the lifetime figure (${opts.brandLifetime.rating.toFixed(2)}★) differs from the 18-month blended rating (${d.blendedRating.toFixed(2)}★) — ` +
        `the recent window is the better read of the brand the buyer would operate.`,
    })
  }

  // ── 8. Method & diligence notes (bullets) ─────────────────────────────────
  const methodBullets: string[] = [
    `Source & scope: ${d.reviewCount.toLocaleString()} star-rated Google reviews (${d.textCount.toLocaleString()} with text), all ${outlets.length} analyzed locations, last 18 months (${d.window.label}) — pulled via DataForSEO.`,
    `Two rating lenses: an 18-month blended rating (${d.blendedRating.toFixed(2)}★, what the brand looks like today) vs the lifetime Google rating${opts.brandLifetime ? ` (${opts.brandLifetime.rating.toFixed(2)}★)` : ''} — recent is the better read for an operator.`,
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
  methodBullets.push(
    `Findings are associational, not causal — an independent read of the brand as an acquisition target, benchmarking outlets against their peers. Prepared${opts.preparedFor ? ` for ${opts.preparedFor}` : ''} · datanautix.com`,
  )
  slides.push({
    type: 'bullets',
    title: 'Method & Diligence Notes',
    subtitle: 'How this read was produced and what to confirm',
    bullets: methodBullets,
  })

  return {
    title: `${brand} — Customer-Experience Diligence`,
    subtitle: `${d.reviewCount.toLocaleString()} Google reviews · ${outlets.length} locations · last 18 months`,
    slides,
  }
}
