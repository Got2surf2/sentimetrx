// lib/quantSignals.ts
//
// Build QuantSignals (for the Heads-Up alert engine) from a dataset's numeric
// fields — rating first, plus any other numerics. The value is the TREND: each
// field's average in the recent window vs the prior window (dynamic cadence via
// lib/trendWindows), plus a low-score-tail surge for ratings. Pure + tested.
// Without usable dates a field yields no trend (quant's whole point is movement).

import { deriveTrendWindows } from '@/lib/trendWindows'
import type { QuantSignal } from '@/lib/insightAlerts'

export interface QuantFieldSpec { key: string; label: string; isRating?: boolean }

const MIN_N = 8   // floor per window before a trend is honest

function numVal(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return isFinite(n) ? n : null
}

export function buildQuantSignals(
  rows: Record<string, unknown>[],
  dateField: string | null,
  fields: QuantFieldSpec[],
): { signals: QuantSignal[]; windowLabel: string | null } {
  // Derive recent/prior windows from the in-view date range.
  let win: ReturnType<typeof deriveTrendWindows> | null = null
  if (dateField) {
    const ms: number[] = []
    for (const r of rows) { const t = Date.parse(String(r[dateField] ?? '')); if (isFinite(t)) ms.push(t) }
    if (ms.length >= MIN_N) {
      let min = Infinity, max = -Infinity
      for (const t of ms) { if (t < min) min = t; if (t > max) max = t }
      if (max > min) win = deriveTrendWindows(min, max)
    }
  }
  const inWin = (r: Record<string, unknown>, w: { startMs: number; endMs: number } | null): boolean => {
    if (!w || !dateField) return false
    const t = Date.parse(String(r[dateField] ?? ''))
    return isFinite(t) && t >= w.startMs && t < w.endMs
  }

  const signals: QuantSignal[] = []
  for (const f of fields) {
    let sum = 0, n = 0, rSum = 0, rN = 0, pSum = 0, pN = 0, rLow = 0, pLow = 0
    for (const r of rows) {
      const v = numVal(r[f.key])
      if (v == null) continue
      sum += v; n++
      if (win) {
        if (inWin(r, win.recent)) { rSum += v; rN++; if (f.isRating && v <= 2) rLow++ }
        else if (inWin(r, win.prior)) { pSum += v; pN++; if (f.isRating && v <= 2) pLow++ }
      }
    }
    if (n < MIN_N) continue
    const sig: QuantSignal = { key: f.key, label: f.label, avg: +(sum / n).toFixed(2), n, isRating: f.isRating }
    if (win && rN >= MIN_N && pN >= MIN_N) {
      sig.avg = +(rSum / rN).toFixed(2)            // recent window = the "now" value
      sig.prior = { avg: +(pSum / pN).toFixed(2), n: pN }
      if (f.isRating) { sig.lowPctRecent = Math.round((rLow / rN) * 100); sig.lowPctPrior = Math.round((pLow / pN) * 100) }
    }
    signals.push(sig)
  }
  return { signals, windowLabel: win?.windowLabel ?? null }
}
