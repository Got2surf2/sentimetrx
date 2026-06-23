// lib/pptx/outletPlanDeck.ts
// Per-outlet "GM action plan" as a Datanautix-branded leave-behind PPTX — the
// single-store-manager counterpart to the brand improvement plan. Mirrors the
// Action Plan tab for ONE outlet: where it stands, what to work on (its
// bottom-quartile themes + who to learn from), guests' own words, and what it
// does best. Same predictor object backs both. Every figure is real.

import type { OutletPredictor } from '@/lib/outletPredictor'
import type { DeckSpec, SlideSpec } from './slideRenderer'
import { DN, trunc } from './shared'

const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`
const rankWord = (p: number) => (p >= 90 ? 'bottom 10%' : 'bottom 25%')
const topWord = (p: number) => (p <= 10 ? 'top 10%' : 'top 25%')
function locOnly(label: string): string {
  const i = label.indexOf(' — ')
  return i >= 0 ? label.slice(i + 3) : label
}

export function buildOutletPlanDeck(p: OutletPredictor, placeId: string, brand: string): DeckSpec | null {
  const o = p.outletSummaries.find((x) => x.placeId === placeId)
  if (!o) return null
  const m = p.model
  const weaknesses = p.outletLevers[placeId] || []
  const strengths = p.outletStrengths[placeId] || []
  const driver = p.brandLevers[0]?.theme
  const driverState = !driver ? null
    : weaknesses.some((w) => w.theme === driver) ? 'weak'
    : strengths.some((w) => w.theme === driver) ? 'strong' : 'mid'
  const loc = locOnly(o.label)
  const slides: SlideSpec[] = []

  // 1. Where you stand.
  slides.push({
    type: 'kpi_grid',
    title: `Where ${trunc(loc, 34)} Stands`,
    subtitle: `${o.reviews.toLocaleString()} reviews · ${o.rating != null ? `${o.rating.toFixed(2)}★` : ''}`,
    kpis: [
      { value: pct1(o.lowRate), label: '1–3★ review rate', sub: `${o.lowCount} of ${o.reviews}`, color: DN.navy },
      { value: `#${o.lowRateRank} of ${p.outletSummaries.length}`, label: 'Rank (1 = worst)', sub: 'on 1–3★ rate', color: o.lowRateRank <= p.outletSummaries.length / 3 ? DN.red : DN.slate },
      { value: pct1(m.lowRate), label: 'Brand average', sub: 'all outlets', color: DN.slate },
      { value: pct1(m.bestLowRate), label: 'Best outlet', sub: 'the bar to aim for', color: DN.green },
      { value: o.rating != null ? `${o.rating.toFixed(2)}★` : '—', label: 'Star rating', color: DN.teal },
      { value: String(o.weaknessCount), label: 'Themes to work on', sub: 'bottom-quartile vs peers', color: DN.orange },
    ],
    insight: driverState
      ? `The chain's one systemic issue is ${driver} — ${driverState === 'weak' ? "and you're bottom-quartile on it, so it's your highest-leverage fix." : driverState === 'strong' ? "and you're top-quartile on it. One less thing to worry about." : "you're middle-of-the-pack on it."}`
      : undefined,
  })

  // 2. What to work on — weaknesses (bottom-quartile themes).
  if (weaknesses.length) {
    slides.push({
      type: 'table',
      title: 'What to Work On',
      subtitle: `Themes where ${trunc(loc, 28)} ranks among the worst vs all ${p.outletSummaries.length} outlets`,
      columns: ['Theme', 'Your rank', 'Problem rate', 'Learn from'],
      rows: weaknesses.slice(0, 6).map((w) => [
        trunc(w.theme, 28), rankWord(w.peerPercentile), pct1(w.problemRate),
        w.exemplars.slice(0, 3).map((e) => locOnly(e.label)).join(', ') || '—',
      ]),
      insight: 'Ranked worst-first. "Problem rate" = share of this outlet’s reviews that are 1–3★ and cite the theme. "Learn from" = the top-performing outlets on each — worth a call.',
    })
  } else {
    slides.push({
      type: 'bullets',
      title: 'What to Work On',
      subtitle: 'Peer-relative weaknesses',
      bullets: ['No theme puts this location in the bottom quartile vs its peers — it’s a model outlet. Hold the line and keep sharing what works.'],
    })
  }

  // 3. In guests' words — the complaints behind the weaknesses.
  const wq = weaknesses.filter((w) => w.quote).slice(0, 6).map((w) => ({ text: trunc(w.quote!, 180), attribution: w.theme }))
  if (wq.length >= 2) {
    slides.push({ type: 'quotes', title: 'What Your Unhappy Guests Said', subtitle: 'Verbatim 1–3★ reviews behind the themes above', quotes: wq })
  }

  // 4. What you do best — strengths with praise quotes.
  if (strengths.length) {
    const sq = strengths.filter((sx) => sx.quote)
    if (sq.length >= 2) {
      slides.push({
        type: 'quotes',
        title: 'What You Do Best',
        subtitle: `Top-quartile vs all outlets — protect these`,
        quotes: sq.slice(0, 6).map((sx) => ({ text: trunc(sx.quote!, 180), attribution: `${sx.theme} · ${topWord(sx.peerPercentile)}` })),
      })
    } else {
      slides.push({
        type: 'bullets',
        title: 'What You Do Best',
        subtitle: 'Top-quartile vs all outlets — protect these',
        bullets: strengths.slice(0, 6).map((sx) => `${sx.theme} — ${topWord(sx.peerPercentile)} of locations (only ${pct1(sx.problemRate)} of reviews here flag it).`),
      })
    }
  }

  // 5. How to use this.
  slides.push({
    type: 'bullets',
    title: 'How to Use This',
    subtitle: 'A peer-relative read of your guest experience',
    bullets: [
      `Your 1–3★ rate (${pct1(o.lowRate)}) is the share of reviews rating 1–3 stars — the guests to win back. The brand averages ${pct1(m.lowRate)}; your best sister location runs ${pct1(m.bestLowRate)}.`,
      '"What to work on" = themes where this outlet ranks in the worst quarter of all locations. Start at the top.',
      'For each, the "learn from" outlets are top performers on that exact theme — a ready-made playbook a call away.',
      '"What you do best" = themes where you’re in the best quarter. Protect them — they’re what guests reward.',
      'Peer-relative and associational — a prioritization guide, not a guaranteed star change. Prepared by Datanautix · datanautix.com',
    ],
  })

  return {
    title: `${loc} — Guest Experience Action Plan`,
    subtitle: `${brand} · ${pct1(o.lowRate)} 1–3★ rate · #${o.lowRateRank} of ${p.outletSummaries.length} outlets`,
    slides,
  }
}
