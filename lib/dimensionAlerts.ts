// lib/dimensionAlerts.ts
//
// "Heads-Up / Watch List" — turns a Dimensions (ABSA taxonomy) rollup into a
// ranked set of exception alerts: the few aspects a reader should actually act
// on. Pure + unit-tested (no I/O) so it's deterministic and grounded — every
// alert carries its mention count `n` and the metric that triggered it, never a
// fabricated claim.
//
// Two tiers:
//   STATIC  (current rollup only)  — 🔴 pain points, 🟢 bright spots, ⚠️ safety.
//   TREND   (recent vs prior pass) — 📉 deteriorating, 📈 heating up, ✨ improving.
// Trend tier is optional; when no dated reviews exist the alerts are still
// useful from the static tier alone.

import type { TaxonomyRollup, SubStat } from './taxonomyRollup'

export type DimensionAlertKind =
  | 'safety' | 'pain' | 'bright' | 'deteriorating' | 'heating' | 'improving'

export interface DimensionAlert {
  kind:     DimensionAlertKind
  icon:     string
  severity: number   // ranking score; higher = more urgent
  axis?:    string
  title:    string   // human aspect name (e.g. "Wait time")
  detail:   string   // grounded one-liner with n + the triggering metric
  n:        number
}

const ICON: Record<DimensionAlertKind, string> = {
  safety: '⚠️', pain: '🔴', bright: '🟢', deteriorating: '📉', heating: '📈', improving: '✨',
}

// Tunables — conservative so we don't over-flag thin data.
const PAIN_POSPCT      = 45    // ≤ this % positive = a pain point
const BRIGHT_POSPCT    = 80    // ≥ this % positive = a bright spot
const RATING_DRAG      = 0.7   // ★ this far below the overall avg = drag
const TREND_POSPCT_D   = 12    // pts swing (recent vs prior) to call a trend
const TREND_RATING_D   = 0.4   // ★ swing (recent vs prior) to call a trend
const HEATING_MULT     = 1.5   // mention-share must rise ≥ this multiple…
const HEATING_DELTA_PP = 3     // …AND by at least this many points

function titleCase(s: string): string {
  return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim()
}

function subDetail(s: SubStat): string {
  const bits = [`${s.count} mention${s.count === 1 ? '' : 's'}`]
  if (s.posPct != null) bits.push(`${s.posPct}% positive`)
  if (s.avgRating != null) bits.push(`★${s.avgRating}`)
  return bits.join(' · ')
}

// Show whichever metric moved most, with the before→after and window.
function trendDetail(prior: SubStat, recent: SubStat, win: string): string {
  const dPos = (prior.posPct != null && recent.posPct != null) ? recent.posPct - prior.posPct : null
  const dRat = (prior.avgRating != null && recent.avgRating != null) ? recent.avgRating - prior.avgRating : null
  if (dPos != null && (dRat == null || Math.abs(dPos) >= Math.abs(dRat) * 25)) {
    return `${prior.posPct}%→${recent.posPct}% positive (${win}) · ${recent.count} mentions`
  }
  if (dRat != null) {
    return `★${prior.avgRating}→★${recent.avgRating} (${win}) · ${recent.count} mentions`
  }
  return subDetail(recent)
}

/**
 * Build the ranked alert list. `opts.trend` enables the trend tier — pass the
 * recent + prior window rollups (each computed by `aggregateTaxonomy` over the
 * date-partitioned rows) plus a human window label (e.g. "last 2 quarters").
 */
export function computeDimensionAlerts(
  rollup: TaxonomyRollup,
  opts: {
    trend?: { recent: TaxonomyRollup; prior: TaxonomyRollup; windowLabel: string }
    minMentions?: number
    max?: number
  } = {},
): DimensionAlert[] {
  // Adaptive floor: at least 8, or ~2% of classified rows — keeps a 5-mention
  // blip from becoming a headline on a big dataset.
  const minN = opts.minMentions ?? Math.max(8, Math.round(rollup.classifiedRows * 0.02))
  const overall = rollup.overallAvgRating
  const out: DimensionAlert[] = []

  // ── ⚠️ Safety — severity tags always surface, ranked above everything ──
  for (const a of rollup.alerts) {
    out.push({
      kind: 'safety', icon: ICON.safety, severity: 1e6 + a.count,
      title: titleCase(a.tag),
      // Tag name is already the Aspect column — keep the detail short so it
      // doesn't clip in the table cell.
      detail: `flagged in ${a.count} review${a.count === 1 ? '' : 's'} — review first`,
      n: a.count,
    })
  }

  // ── 🔴 Pain / 🟢 Bright (static, from the current rollup) ──
  for (const s of rollup.subs) {
    if (s.count < minN) continue
    const ratingGap = (overall != null && s.avgRating != null) ? overall - s.avgRating : 0
    const isPain   = (s.posPct != null && s.posPct <= PAIN_POSPCT) || ratingGap >= RATING_DRAG
    const isBright = s.posPct != null && s.posPct >= BRIGHT_POSPCT && (s.avgRating == null || overall == null || s.avgRating >= overall)
    if (isPain) {
      out.push({
        kind: 'pain', icon: ICON.pain, axis: s.axis, title: titleCase(s.sub),
        severity: s.count * (1 - (s.posPct ?? 50) / 100) + ratingGap * 50,
        detail: subDetail(s), n: s.count,
      })
    } else if (isBright) {
      out.push({
        kind: 'bright', icon: ICON.bright, axis: s.axis, title: titleCase(s.sub),
        severity: s.count * ((s.posPct ?? 80) / 100) * 0.6,   // bright ranks below pain at equal volume
        detail: subDetail(s), n: s.count,
      })
    }
  }

  // ── 📉 Deteriorating / 📈 Heating / ✨ Improving (trend tier) ──
  if (opts.trend) {
    const priorBy = new Map(opts.trend.prior.subs.map(s => [s.axis + ':' + s.sub, s]))
    for (const r of opts.trend.recent.subs) {
      const p = priorBy.get(r.axis + ':' + r.sub)
      const pRate = p?.rate ?? 0

      // Heating up: mention-share climbing (newly prominent). Pair with sentiment.
      if (r.count >= minN && r.rate >= pRate * HEATING_MULT && (r.rate - pRate) >= HEATING_DELTA_PP) {
        const skew = r.posPct == null ? '' : r.posPct < 50 ? ', skewing negative' : ', mostly positive'
        out.push({
          kind: 'heating', icon: ICON.heating, axis: r.axis, title: titleCase(r.sub),
          severity: r.count + (r.rate - pRate) * 20,
          detail: `newly prominent — ${pRate}%→${r.rate}% of reviews (${opts.trend.windowLabel})${skew}`,
          n: r.count,
        })
      }

      // Sentiment swings need adequate volume in BOTH windows.
      if (!p || p.count < minN || r.count < minN) continue
      const dPos = (p.posPct != null && r.posPct != null) ? r.posPct - p.posPct : 0
      const dRat = (p.avgRating != null && r.avgRating != null) ? r.avgRating - p.avgRating : 0
      if (dPos <= -TREND_POSPCT_D || dRat <= -TREND_RATING_D) {
        out.push({
          kind: 'deteriorating', icon: ICON.deteriorating, axis: r.axis, title: titleCase(r.sub),
          severity: 500 + r.count + Math.abs(dPos) * 5 + Math.abs(dRat) * 50,   // trends rank near the top
          detail: trendDetail(p, r, opts.trend.windowLabel), n: r.count,
        })
      } else if (dPos >= TREND_POSPCT_D || dRat >= TREND_RATING_D) {
        out.push({
          kind: 'improving', icon: ICON.improving, axis: r.axis, title: titleCase(r.sub),
          severity: 200 + r.count + dPos * 3 + dRat * 30,
          detail: trendDetail(p, r, opts.trend.windowLabel), n: r.count,
        })
      }
    }
  }

  // Rank, then dedupe to one alert per aspect (highest-severity framing wins),
  // keeping every safety flag.
  out.sort((a, b) => b.severity - a.severity)
  const seen = new Set<string>()
  const deduped = out.filter(a => {
    if (a.kind === 'safety') return true
    const key = (a.axis || '') + ':' + a.title
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const max = opts.max ?? 8
  const safety = deduped.filter(a => a.kind === 'safety')
  const rest = deduped.filter(a => a.kind !== 'safety').slice(0, Math.max(0, max - safety.length))
  return [...safety, ...rest]
}
