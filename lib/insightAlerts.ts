// lib/insightAlerts.ts
//
// The "Heads-Up / Watch List" — a lens-agnostic exception-alert engine. Turns
// the things a report measures into a single ranked set of alerts: the few
// signals a reader should actually act on, across THREE lenses:
//
//   • theme      — organic/emergent topics (count + sentiment + rating)
//   • dimension  — fixed ABSA taxonomy sub-aspects (count + sentiment + rating)
//   • quant      — numeric variables (rating minimally, plus any other numeric
//                  field): an average that can drift and a low-score tail
//
// Pure + unit-tested (no I/O) so it's deterministic and grounded — every alert
// carries either its mention count `n` or an explicit before→after, never a
// fabricated claim. Two tiers per lens: STATIC (current snapshot) and TREND
// (recent vs prior, supplied via `prior` on each signal).

import type { TaxonomyRollup, SubStat } from './taxonomyRollup'

export type AlertLens = 'theme' | 'dimension' | 'quant'
export type AlertKind =
  | 'safety' | 'pain' | 'bright' | 'deteriorating' | 'heating' | 'improving'

export interface Alert {
  kind:     AlertKind
  lens:     AlertLens
  icon:     string
  severity: number   // ranking score; higher = more urgent
  title:    string
  detail:   string   // grounded one-liner: n + the triggering metric / before→after
  n:        number
}

// Count/sentiment lens (themes + dimensions share this shape).
export interface AlertSignal {
  lens:      'theme' | 'dimension'
  key:       string                 // dedupe key, e.g. 'dimension:product:steak'
  label:     string
  count:     number
  rate:      number                 // % share of comments
  posPct:    number | null
  avgRating: number | null
  prior?:    { count: number; rate: number; posPct: number | null; avgRating: number | null } | null
}

// Quant lens — a numeric variable's average (+ optional low-score tail).
export interface QuantSignal {
  key:        string
  label:      string                // "Overall rating", "NPS", a survey scale…
  avg:        number
  n:          number
  unit?:      string                // '★' for star ratings, '' otherwise
  isRating?:  boolean               // 1–5 star: enables absolute thresholds + tail framing
  prior?:     { avg: number; n: number } | null
  lowPctRecent?: number | null      // share of 1–2★ (or bottom-box) recently
  lowPctPrior?:  number | null
}

export interface SafetyFlag { tag: string; count: number }

const ICON: Record<AlertKind, string> = {
  safety: '⚠️', pain: '🔴', bright: '🟢', deteriorating: '📉', heating: '📈', improving: '✨',
}

// Tunables — conservative so thin data doesn't over-flag.
const PAIN_POSPCT      = 45
const BRIGHT_POSPCT    = 80
const RATING_DRAG      = 0.7
const TREND_POSPCT_D   = 12
const TREND_RATING_D   = 0.4
const HEATING_MULT     = 1.5
const HEATING_DELTA_PP = 3
const QUANT_RATING_D   = 0.2    // ★ move on a 1–5 scale that counts as a trend
const QUANT_REL_D      = 0.08   // 8% relative move for non-rating numerics
const QUANT_TAIL_D     = 8      // pts rise in the low-score share

function titleCase(s: string): string {
  return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim()
}

function fmt(v: number, unit?: string): string {
  const n = Math.round(v * 10) / 10
  return unit === '★' ? `★${n}` : `${n}${unit || ''}`
}

function countDetail(s: AlertSignal): string {
  const bits = [`${s.count} mention${s.count === 1 ? '' : 's'}`]
  if (s.posPct != null) bits.push(`${s.posPct}% positive`)
  if (s.avgRating != null) bits.push(`★${s.avgRating}`)
  return bits.join(' · ')
}

function trendDetail(prior: AlertSignal['prior'], recent: AlertSignal, win: string): string {
  if (!prior) return countDetail(recent)
  const dPos = (prior.posPct != null && recent.posPct != null) ? recent.posPct - prior.posPct : null
  const dRat = (prior.avgRating != null && recent.avgRating != null) ? recent.avgRating - prior.avgRating : null
  if (dPos != null && (dRat == null || Math.abs(dPos) >= Math.abs(dRat) * 25)) {
    return `${prior.posPct}%→${recent.posPct}% positive (${win}) · ${recent.count} mentions`
  }
  if (dRat != null) return `★${prior.avgRating}→★${recent.avgRating} (${win}) · ${recent.count} mentions`
  return countDetail(recent)
}

/** Count/sentiment alerts for one theme/dimension signal (may emit 0–1). */
function alertsForSignal(s: AlertSignal, minN: number, overall: number | null, win: string): Alert[] {
  const out: Alert[] = []

  // Trend tier (needs both windows at adequate volume).
  if (s.prior) {
    const p = s.prior
    if (s.count >= minN && s.rate >= (p.rate ?? 0) * HEATING_MULT && (s.rate - (p.rate ?? 0)) >= HEATING_DELTA_PP) {
      const skew = s.posPct == null ? '' : s.posPct < 50 ? ', skewing negative' : ', mostly positive'
      out.push({ kind: 'heating', lens: s.lens, icon: ICON.heating, severity: s.count + (s.rate - (p.rate ?? 0)) * 20,
        title: s.label, detail: `newly prominent — ${p.rate ?? 0}%→${s.rate}% of comments (${win})${skew}`, n: s.count })
    }
    if (s.count >= minN && p.count >= minN) {
      const dPos = (p.posPct != null && s.posPct != null) ? s.posPct - p.posPct : 0
      const dRat = (p.avgRating != null && s.avgRating != null) ? s.avgRating - p.avgRating : 0
      if (dPos <= -TREND_POSPCT_D || dRat <= -TREND_RATING_D) {
        out.push({ kind: 'deteriorating', lens: s.lens, icon: ICON.deteriorating, severity: 500 + s.count + Math.abs(dPos) * 5 + Math.abs(dRat) * 50,
          title: s.label, detail: trendDetail(p, s, win), n: s.count })
      } else if (dPos >= TREND_POSPCT_D || dRat >= TREND_RATING_D) {
        out.push({ kind: 'improving', lens: s.lens, icon: ICON.improving, severity: 200 + s.count + dPos * 3 + dRat * 30,
          title: s.label, detail: trendDetail(p, s, win), n: s.count })
      }
    }
  }

  // Static tier.
  if (s.count >= minN) {
    const ratingGap = (overall != null && s.avgRating != null) ? overall - s.avgRating : 0
    if ((s.posPct != null && s.posPct <= PAIN_POSPCT) || ratingGap >= RATING_DRAG) {
      out.push({ kind: 'pain', lens: s.lens, icon: ICON.pain, severity: s.count * (1 - (s.posPct ?? 50) / 100) + ratingGap * 50,
        title: s.label, detail: countDetail(s), n: s.count })
    } else if (s.posPct != null && s.posPct >= BRIGHT_POSPCT && (s.avgRating == null || overall == null || s.avgRating >= overall)) {
      out.push({ kind: 'bright', lens: s.lens, icon: ICON.bright, severity: s.count * ((s.posPct ?? 80) / 100) * 0.6,
        title: s.label, detail: countDetail(s), n: s.count })
    }
  }
  return out
}

/** Quant alerts for one numeric variable (may emit 0–2: trend + tail surge). */
function alertsForQuant(q: QuantSignal, win: string): Alert[] {
  const out: Alert[] = []
  const unit = q.isRating ? '★' : (q.unit || '')
  if (q.prior && q.n >= 8 && q.prior.n >= 8) {
    const d = q.avg - q.prior.avg
    const meaningful = q.isRating
      ? Math.abs(d) >= QUANT_RATING_D
      : q.prior.avg !== 0 && Math.abs(d / q.prior.avg) >= QUANT_REL_D
    if (meaningful) {
      const kind: AlertKind = d < 0 ? 'deteriorating' : 'improving'
      out.push({ kind, lens: 'quant', icon: ICON[kind], severity: 600 + Math.abs(d) * (q.isRating ? 200 : 40),
        title: q.label, detail: `${fmt(q.prior.avg, unit)}→${fmt(q.avg, unit)} (${win}) · ${q.n} scored`, n: q.n })
    }
  }
  // Low-score tail surge (rating-like only).
  if (q.lowPctRecent != null && q.lowPctPrior != null && (q.lowPctRecent - q.lowPctPrior) >= QUANT_TAIL_D) {
    out.push({ kind: 'pain', lens: 'quant', icon: ICON.pain, severity: 550 + (q.lowPctRecent - q.lowPctPrior) * 6,
      title: `${q.label} — low-score surge`, detail: `bottom-box share ${q.lowPctPrior}%→${q.lowPctRecent}% (${win})`, n: q.n })
  }
  return out
}

/**
 * Build the merged, ranked watch list across all supplied lenses. Pass any of
 * `signals` (themes + dimensions), `quant` (numeric variables), and `safety`
 * (Dimensions severity tags). Returns at most `max` alerts (default 8), always
 * keeping every safety flag, deduped to one alert per title (most-urgent wins).
 */
export function computeInsightAlerts(opts: {
  signals?: AlertSignal[]
  quant?: QuantSignal[]
  safety?: SafetyFlag[]
  overallAvgRating?: number | null
  baselineRows?: number          // floor basis for the min-mention guard
  windowLabel?: string
  minMentions?: number
  max?: number
} = {}): Alert[] {
  const win = opts.windowLabel || 'recent vs prior'
  const minN = opts.minMentions ?? Math.max(8, Math.round((opts.baselineRows ?? 0) * 0.02))
  const overall = opts.overallAvgRating ?? null
  const out: Alert[] = []

  // ⚠️ Safety — always, ranked above everything.
  for (const a of (opts.safety || [])) {
    out.push({ kind: 'safety', lens: 'dimension', icon: ICON.safety, severity: 1e6 + a.count,
      title: titleCase(a.tag), detail: `flagged in ${a.count} review${a.count === 1 ? '' : 's'} — review first`, n: a.count })
  }
  for (const s of (opts.signals || [])) out.push(...alertsForSignal(s, minN, overall, win))
  for (const q of (opts.quant || [])) out.push(...alertsForQuant(q, win))

  out.sort((a, b) => b.severity - a.severity)
  const seen = new Set<string>()
  const deduped = out.filter(a => {
    if (a.kind === 'safety') return true
    const key = a.lens + ':' + a.title
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const max = opts.max ?? 8
  const safety = deduped.filter(a => a.kind === 'safety')
  const rest = deduped.filter(a => a.kind !== 'safety').slice(0, Math.max(0, max - safety.length))
  return [...safety, ...rest]
}

// ── Adapters ────────────────────────────────────────────────────────────────

/** Dimensions rollup → count/sentiment signals (+ optional prior-window rollup). */
export function dimensionsToSignals(rollup: TaxonomyRollup, prior?: TaxonomyRollup | null): AlertSignal[] {
  const priorBy = new Map((prior?.subs || []).map(s => [s.axis + ':' + s.sub, s]))
  return rollup.subs.map(s => {
    const p = priorBy.get(s.axis + ':' + s.sub)
    return {
      lens: 'dimension' as const,
      key: `dimension:${s.axis}:${s.sub}`,
      label: titleCase(s.sub),
      count: s.count, rate: s.rate, posPct: s.posPct, avgRating: s.avgRating,
      prior: p ? { count: p.count, rate: p.rate, posPct: p.posPct, avgRating: p.avgRating } : null,
    }
  })
}

/** A theme row as the engine needs it (decoupled from the persisted shape). */
export interface ThemeSignalInput {
  label: string; count: number; rate: number; posPct: number | null; avgRating: number | null
  prior?: { count: number; rate: number; posPct: number | null; avgRating: number | null } | null
}
export function themesToSignals(themes: ThemeSignalInput[]): AlertSignal[] {
  return themes.map(t => ({
    lens: 'theme' as const,
    key: 'theme:' + t.label.toLowerCase().trim(),
    label: t.label,
    count: t.count, rate: t.rate, posPct: t.posPct, avgRating: t.avgRating,
    prior: t.prior ?? null,
  }))
}

// ── Back-compat: Dimensions-only convenience (used by the StoryTime route until
//    the theme + quant adapters are wired). ──────────────────────────────────
export type DimensionAlertKind = AlertKind
export type DimensionAlert = Alert
export function computeDimensionAlerts(
  rollup: TaxonomyRollup,
  opts: { prior?: TaxonomyRollup | null; windowLabel?: string; minMentions?: number; max?: number } = {},
): Alert[] {
  return computeInsightAlerts({
    signals: dimensionsToSignals(rollup, opts.prior),
    safety: rollup.alerts,
    overallAvgRating: rollup.overallAvgRating,
    baselineRows: rollup.classifiedRows,
    windowLabel: opts.windowLabel,
    minMentions: opts.minMentions,
    max: opts.max,
  })
}
