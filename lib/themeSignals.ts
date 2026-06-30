// lib/themeSignals.ts
//
// Build AlertSignals (for the Heads-Up alert engine) from a dataset's THEMES —
// the organic/emergent topics, as a third lens alongside Dimensions and the
// numeric variables. Two things the persisted theme model can't give us, both
// computed here by re-matching keywords over the actual rows:
//
//   • real pos/neg — themes store a single coarse `sentiment` label, not a
//     distribution. When a rating field exists we derive an honest per-theme
//     %-positive + avg ★ from the RATED rows that mention the theme (rating ≥4
//     = positive, ≤2 = negative, 3 = neutral). No rating → posPct stays null
//     (we never invent precision from a one-word label).
//   • trends — re-match each theme's keywords inside the recent vs prior window
//     (dynamic cadence via lib/trendWindows) so a theme can fire 📉/📈/📈heating.
//
// Pure + unit-tested (the only impurity is the same buildKwRegex/deriveTrendWindows
// the rest of the pipeline uses). When dates are present the emitted signal
// represents the RECENT window (with `prior` attached) — same contract as
// buildQuantSignals; without dates it's the full-period snapshot.

import { deriveTrendWindows } from '@/lib/trendWindows'
import { buildKwRegex } from '@/lib/themeUtils'
import type { ThemeSignalInput } from '@/lib/insightAlerts'

export interface ThemeSpec { label: string; keywords: string[] }

const MIN_N = 8   // floor per window before a theme trend is honest

function ratingPolarity(v: number): 'pos' | 'neg' | null {
  if (v >= 4) return 'pos'
  if (v <= 2) return 'neg'
  return null   // 3 = neutral
}

// Per-theme accumulator over one window (or the full set).
interface Acc { count: number; ratS: number; ratN: number; pos: number; neg: number }
const newAcc = (): Acc => ({ count: 0, ratS: 0, ratN: 0, pos: 0, neg: 0 })
function addHit(a: Acc, rating: number | null): void {
  a.count++
  if (rating != null) {
    a.ratS += rating; a.ratN++
    const p = ratingPolarity(rating)
    if (p === 'pos') a.pos++; else if (p === 'neg') a.neg++
  }
}
function posPctOf(a: Acc): number | null {
  return (a.pos + a.neg) > 0 ? Math.round(100 * a.pos / (a.pos + a.neg)) : null
}
function avgOf(a: Acc): number | null {
  return a.ratN > 0 ? +(a.ratS / a.ratN).toFixed(1) : null
}

export function buildThemeSignals(opts: {
  themes: ThemeSpec[]
  rows: Record<string, unknown>[]
  textKeys: string[]              // resolved row keys for the theme text fields
  ratingKey?: string | null       // resolved rating key (enables real pos/neg + avg ★)
  dateKey?: string | null         // resolved date key (enables recent-vs-prior trends)
}): { signals: ThemeSignalInput[]; windowLabel: string | null } {
  const { themes, rows, textKeys, ratingKey, dateKey } = opts
  if (!themes.length || !rows.length || !textKeys.length) return { signals: [], windowLabel: null }

  // Pre-join each row's theme text + rating + timestamp ONCE (not per theme).
  const docs = rows.map(r => {
    const text = textKeys.map(k => String(r[k] ?? '')).join('  ').toLowerCase()
    const rv = ratingKey ? Number(r[ratingKey]) : NaN
    const t = dateKey ? Date.parse(String(r[dateKey] ?? '')) : NaN
    return { text, rating: ratingKey && isFinite(rv) ? rv : null, t: isFinite(t) ? t : null }
  }).filter(d => d.text.trim().length > 0)

  const total = docs.length || 1

  // Derive recent/prior windows from the in-view date range.
  let win: ReturnType<typeof deriveTrendWindows> | null = null
  const ms = docs.map(d => d.t).filter((x): x is number => x != null)
  if (ms.length >= MIN_N) {
    let min = Infinity, max = -Infinity
    for (const t of ms) { if (t < min) min = t; if (t > max) max = t }
    if (max > min) win = deriveTrendWindows(min, max)
  }
  const inWin = (t: number | null, w: { startMs: number; endMs: number } | null): boolean =>
    !!w && t != null && t >= w.startMs && t < w.endMs

  const signals: ThemeSignalInput[] = []
  for (const theme of themes) {
    const regexes = (theme.keywords || []).map(buildKwRegex)
    if (!regexes.length) continue
    const full = newAcc(), recent = newAcc(), prior = newAcc()
    for (const d of docs) {
      if (!regexes.some(re => re.test(d.text))) continue
      addHit(full, d.rating)
      if (win) {
        if (inWin(d.t, win.recent)) addHit(recent, d.rating)
        else if (inWin(d.t, win.prior)) addHit(prior, d.rating)
      }
    }
    if (full.count === 0) continue

    const trended = !!win && recent.count >= MIN_N && prior.count >= MIN_N
    const main = trended ? recent : full   // recent window is the "now" when we can trend
    const sig: ThemeSignalInput = {
      label: theme.label,
      count: main.count,
      rate: +(100 * main.count / total).toFixed(1),
      posPct: posPctOf(main),
      avgRating: avgOf(main),
      prior: trended
        ? { count: prior.count, rate: +(100 * prior.count / total).toFixed(1), posPct: posPctOf(prior), avgRating: avgOf(prior) }
        : null,
    }
    signals.push(sig)
  }
  return { signals, windowLabel: win?.windowLabel ?? null }
}
