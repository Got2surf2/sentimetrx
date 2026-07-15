// lib/regressionDesign.ts
// Turns survey fields + themes into a numeric design matrix for regression, so
// the Statistics Regression panel can model a binary outcome from CATEGORICAL
// fields and THEMES, not just raw numeric columns.
//
// Encoding (chosen 2026-07-15):
//   * numeric      → one passthrough column
//   * categorical  → one-hot dummies by default (each level except a reference
//                    baseline = the modal answer, so odds ratios read "vs the
//                    most common response"); OR a single ordinal column when the
//                    field is flagged ordinal (uses its remapping if present,
//                    else the position in its `values` list)
//   * theme        → one 0/1 column: did the response's open text match the
//                    theme's keywords (canonical `commentMatchesTheme`)
//
// A row is kept only if the outcome is defined AND every non-theme predictor is
// present (complete-case). Themes never drop a row — a blank/no-match text is a
// legitimate 0.

import { commentMatchesTheme } from '@/lib/themeUtils'
import type { Theme, ThemeModel } from '@/lib/themeUtils'
import { toNumericOrNull } from '@/lib/numericValue'
import { suggestMapping, isOrdinalScale } from '@/lib/scaleUtils'
import type { SchemaFieldConfig } from '@/lib/analyzeTypes'

export type RegKind = 'numeric' | 'categorical' | 'theme'
export type Encoding = 'onehot' | 'ordinal'

export interface RegVar {
  key: string                 // unique id: the field key, or 'theme:<id>'
  kind: RegKind
  label: string
  field?: string              // data key for numeric/categorical
  values?: string[]           // categorical levels (for ordinal fallback order)
  remapping?: Record<string, number>
  ordinalable?: boolean       // categorical is a recognized ranked scale (usable as quant)
  ordinalMap?: Record<string, number> // resolved value→rank for ordinal encoding
  theme?: Theme
  themeSource?: string        // open-text field key used for theme matching
}

export interface PredictorSpec { v: RegVar; encoding?: Encoding }
export interface OutcomeSpec { v: RegVar; cut?: number; level?: string }

export interface DesignResult {
  y: number[]
  X: number[][]
  colNames: string[]
  n: number; nPos: number; nNeg: number
  outcomeLabel: string
}

// Build the candidate variable list the panel offers.
export function buildRegVars(fields: SchemaFieldConfig[], themeModel: ThemeModel | null | undefined, themeSourceField: string): RegVar[] {
  const out: RegVar[] = []
  for (const f of fields || []) {
    if (f.hidden || f.type === 'id' || f.type === 'ignore') continue
    if (f.type === 'numeric') {
      out.push({ key: f.field, kind: 'numeric', label: f.label || f.field, field: f.field })
    } else if (f.type === 'categorical') {
      var vals = f.values || []
      // A ranked Likert scale (Very Dissatisfied…Very Satisfied, Poor…Excellent,
      // Strongly Disagree…Strongly Agree, etc.) is usable as a quantitative
      // predictor: the field's own remapping wins, else scaleUtils recognizes the
      // scale (suggestMapping) even when the field was never mapped.
      var oMap = f.remapping || suggestMapping(vals) || undefined
      out.push({ key: f.field, kind: 'categorical', label: f.label || f.field, field: f.field, values: vals, remapping: f.remapping, ordinalable: !!oMap || isOrdinalScale(vals), ordinalMap: oMap })
    }
  }
  const themes = themeModel?.themes || []
  for (const t of themes) {
    const id = t.id || t.name
    if (!id) continue
    out.push({ key: 'theme:' + id, kind: 'theme', label: t.name || id, theme: t, themeSource: themeSourceField })
  }
  return out
}

function catValue(row: Record<string, unknown>, field: string): string {
  return String(row[field] == null ? '' : row[field]).trim()
}

// Ordinal score for a categorical value: its resolved rank map (field remapping
// or a recognized Likert scale from scaleUtils), else its index in the declared
// `values` order (last-resort, when the scale isn't recognized).
function ordinalScore(v: RegVar, raw: string): number | null {
  const map = v.ordinalMap || v.remapping
  if (map && map[raw] != null) return map[raw]
  const idx = (v.values || []).indexOf(raw)
  return idx >= 0 ? idx : null
}

function themeHit(row: Record<string, unknown>, v: RegVar): number {
  const text = String(row[v.themeSource || ''] || '')
  return v.theme && commentMatchesTheme(text, v.theme) ? 1 : 0
}

// Is a predictor value present for this row (drives complete-case filtering)?
function predictorPresent(row: Record<string, unknown>, p: PredictorSpec): boolean {
  const v = p.v
  if (v.kind === 'theme') return true // absence = 0, never a missing case
  if (v.kind === 'numeric') return toNumericOrNull(row[v.field!]) !== null
  const raw = catValue(row, v.field!)
  if (!raw) return false
  if (p.encoding === 'ordinal') return ordinalScore(v, raw) !== null
  return true // one-hot: any non-empty level is present
}

function outcomeValue(row: Record<string, unknown>, o: OutcomeSpec): number | null {
  const v = o.v
  if (v.kind === 'numeric') {
    const n = toNumericOrNull(row[v.field!]); if (n === null) return null
    return n >= (o.cut ?? 0) ? 1 : 0
  }
  if (v.kind === 'theme') return themeHit(row, v)
  const raw = catValue(row, v.field!); if (!raw) return null
  // A ranked Likert categorical can binarize "top-box" by threshold on its rank
  // (stored remapping or recognized scale); otherwise match a chosen level.
  const map = v.ordinalMap || v.remapping
  if (o.cut != null && map) { const m = map[raw]; return m != null && m >= o.cut ? 1 : 0 }
  return raw === o.level ? 1 : 0
}

export function buildDesign(rows: Record<string, unknown>[], outcome: OutcomeSpec, predictors: PredictorSpec[]): DesignResult | null {
  if (!rows.length || !predictors.length) return null
  // Pass 1: complete-case rows (outcome defined + all non-theme predictors present).
  const keep: Record<string, unknown>[] = []
  const y: number[] = []
  for (const r of rows) {
    const yr = outcomeValue(r, outcome); if (yr === null) continue
    let ok = true
    for (const p of predictors) { if (!predictorPresent(r, p)) { ok = false; break } }
    if (!ok) continue
    keep.push(r); y.push(yr)
  }
  if (keep.length < 3) return null // caller enforces the real fit minimums

  // Pass 2: per one-hot categorical, reference = modal level; columns = the rest.
  const cols: { name: string; get: (r: Record<string, unknown>) => number }[] = []
  for (const p of predictors) {
    const v = p.v
    if (v.kind === 'numeric') {
      cols.push({ name: v.label, get: function(r) { return toNumericOrNull(r[v.field!]) ?? 0 } })
    } else if (v.kind === 'theme') {
      cols.push({ name: v.label, get: function(r) { return themeHit(r, v) } })
    } else if (p.encoding === 'ordinal') {
      cols.push({ name: v.label, get: function(r) { return ordinalScore(v, catValue(r, v.field!)) ?? 0 } })
    } else {
      // one-hot
      const freq: Record<string, number> = {}
      for (const r of keep) { const lv = catValue(r, v.field!); if (lv) freq[lv] = (freq[lv] || 0) + 1 }
      const levels = Object.keys(freq)
      if (levels.length < 2) continue // constant → no information
      const ref = levels.slice().sort(function(a, b) { return freq[b] - freq[a] || (a < b ? -1 : 1) })[0]
      const others = levels.filter(function(l) { return l !== ref }).sort()
      for (const lv of others) {
        const level = lv
        cols.push({ name: v.label + ' = ' + level, get: function(r) { return catValue(r, v.field!) === level ? 1 : 0 } })
      }
    }
  }
  if (!cols.length) return null

  const X = keep.map(function(r) { return cols.map(function(c) { return c.get(r) }) })
  const nPos = y.reduce(function(s, val) { return s + val }, 0)
  return {
    y: y, X: X, colNames: cols.map(function(c) { return c.name }),
    n: y.length, nPos: nPos, nNeg: y.length - nPos,
    outcomeLabel: outcome.v.kind === 'theme' ? 'mentions “' + outcome.v.label + '”'
      : outcome.v.kind === 'categorical'
        ? (outcome.cut != null && (outcome.v.ordinalMap || outcome.v.remapping) ? outcome.v.label + ' ≥ ' + outcome.cut + ' (top box)' : outcome.v.label + ' = ' + (outcome.level || '?'))
        : (outcome.v.label + ' ≥ ' + (outcome.cut ?? 0)),
  }
}
