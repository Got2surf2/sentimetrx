// lib/dataStory.ts
// The Data Story generator (StoryTime's narrative web evolution): turns a
// dataset's ENGINE output — recountThemes over the substantive base, the same
// numbers TextMine shows — into a self-contained, shareable narrative HTML
// page. Pure functions (payload build + render) so the route stays thin and
// the composition is unit-testable. Every displayed figure comes from the
// payload; the AI writes PROSE ONLY (route-side), never numbers of its own.
//
// 2026-09-02 benchmark upgrade (owner: ea-football-explorer.html): sections
// lead with FINDINGS, not categories — every headline is computed from the
// data with the number in the sentence; new deterministic analytics (theme
// share over time, rating trend, segment drift, numeric-band cross-cut) and
// an embedded verbatim explorer readers can filter and search. The AI may
// rephrase a headline but the deterministic one always exists and always
// carries the same figures.
//
// Branding: Data Stories are outward-facing deliverables → Datanautix (the
// deck/report rule in CLAUDE.md), never Sentimetrx.

import { recountThemes, evenSample, buildKwRegex, type Theme, type ThemeModel, themeSetForField } from '@/lib/themeUtils'
import { isSubstantiveText } from '@/lib/datasetUtils'
import { verbatimSupports, type VerbatimPremise } from '@/lib/verbatimGuard'
import type { SchemaFieldConfig, DatasetAnalytics, NumericSummary } from '@/lib/analyzeTypes'

export const STORY_ROW_CAP = 50_000  // no sampling under 50K (CLAUDE.md); evenSample above
export const EXPLORER_CAP = 360      // verbatims embedded for the reader-driven explorer

export interface StoryThemeRow {
  id: string; name: string; description: string; sentiment: string
  keywords: string[]
  count: number; pct: number; ciLow?: number; ciHigh?: number
  avgRating?: number; ratingDelta?: number; ratingCount?: number
}
export interface StorySegment { label: string; substantive: number; themes: { name: string; pct: number }[] }
export interface StoryQuote { text: string; theme: string; meta: string }

export interface StoryTimelinePoint {
  label: string; count: number; avgRating: number | null
  shares: Record<string, number>   // tracked theme name -> % of the bucket's substantive
}
export interface StoryTimeline {
  fieldLabel: string
  unit: 'week' | 'month' | 'quarter'
  points: StoryTimelinePoint[]
  tracked: string[]
  ratingFrom: number | null
  ratingTo: number | null
  shiftTheme: { name: string; fromPct: number; toPct: number } | null
}
export interface StoryBand {
  label: string; n: number; avgRating: number | null
  topTheme: string | null; topThemePct: number | null
}
export interface StoryBands {
  fieldLabel: string
  bands: StoryBand[]
  lowest: { label: string; avgRating: number } | null
}
export interface StoryDrift {
  theme: string; minSeg: string; minPct: number; maxSeg: string; maxPct: number
}
export interface ExplorerItem {
  t: string                 // excerpt (≤300 chars)
  th: string[]              // matched theme names
  s: string | null          // segment value
  r: number | null          // rating
  d: string | null          // period label (timeline bucket)
}

export interface StoryNarrative {
  headline: string | null    // thesis H1; null → storyTitle fallback
  lede: string
  themesHead: string
  themesIntro: string
  ratingHead: string | null
  ratingIntro: string | null
  segmentHead: string | null
  segmentIntro: string | null
  timelineHead: string | null
  timelineIntro: string | null
  bandsHead: string | null
  bandsIntro: string | null
}
export interface StoryData {
  datasetName: string
  generated: string          // YYYY-MM-DD
  totalRows: number
  analyzedRows: number       // rows the recount ran over (≤ STORY_ROW_CAP)
  substantiveBase: number
  fieldLabel: string
  overallAvgRating: number | null
  ratingFieldLabel: string | null
  segmentFieldLabel: string | null
  themes: StoryThemeRow[]
  segments: StorySegment[]
  drift: StoryDrift | null
  timeline: StoryTimeline | null
  bands: StoryBands | null
  quotes: StoryQuote[]
  explorer: ExplorerItem[]
  narrative: StoryNarrative
}

// ── Field heuristics ────────────────────────────────────────────────────

/** Rating field: numeric schema field with a score-like name (the Key-Driver
 *  heuristic's name-priority tier, simplified). null = no score section. */
export function pickRatingField(fields: SchemaFieldConfig[]): string | null {
  const numeric = fields.filter(f => f.type === 'numeric')
  const byName = (re: RegExp) => numeric.find(f => re.test(f.field) || re.test(f.label || ''))
  const hit = byName(/overall/i) || byName(/rating|stars?\b/i) || byName(/satisf|csat|score/i) || byName(/recommend|nps/i)
  return hit?.field ?? null
}

/** Steam-style score derivation: when no numeric rating exists, a two-value
 *  recommend-style categorical becomes a 0/100 score — so "avg rating" reads
 *  as % recommended, the same %-positive framing the source platform uses.
 *  Strict gate: recommend-ish NAME + boolean-ish VALUES, else null. */
const POS_TOKENS = /^(yes|y|true|1|recommended|positive|would recommend)$/i
const NEG_TOKENS = /^(no|n|false|0|not recommended|negative|would not recommend)$/i
export function deriveScoreField(
  fields: SchemaFieldConfig[], rows: Record<string, unknown>[],
): { field: string; label: string; map: (v: unknown) => number | null } | null {
  const cand = fields.find(f => f.type === 'categorical' && /recommend/i.test(f.field + ' ' + (f.label || '')))
  if (!cand) return null
  const sample = evenSample(rows, 300)
  let pos = 0, neg = 0, other = 0
  for (const r of sample) {
    const v = String(r[cand.field] ?? '').trim()
    if (!v) continue
    if (POS_TOKENS.test(v)) pos++
    else if (NEG_TOKENS.test(v)) neg++
    else other++
  }
  if (pos + neg < 30 || other > (pos + neg) * 0.05) return null
  return {
    field: cand.field, label: '% recommended',
    map: (v: unknown) => {
      const t = String(v ?? '').trim()
      return POS_TOKENS.test(t) ? 100 : NEG_TOKENS.test(t) ? 0 : null
    },
  }
}

/** Segment field: a categorical with 2–6 values covering ≥60% of rows —
 *  a real cohort split (location, product line, wave), not an id-ish column. */
export function pickSegmentField(fields: SchemaFieldConfig[], analytics: DatasetAnalytics | null, totalRows: number): string | null {
  if (!analytics || !totalRows) return null
  let best: { field: string; coverage: number } | null = null
  for (const f of fields) {
    if (f.type !== 'categorical') continue
    const s = analytics.fieldSummaries?.[f.field]
    if (!s || s.type !== 'categorical') continue
    if (s.uniqueCount < 2 || s.uniqueCount > 6) continue
    const coverage = s.nonNull / totalRows
    if (coverage < 0.6) continue
    if (!best || coverage > best.coverage) best = { field: f.field, coverage }
  }
  return best?.field ?? null
}

/** Date field: schema type 'date' wins; else a date-named field where ≥70% of
 *  a sample parses. Powers the timeline section. */
export function pickDateField(fields: SchemaFieldConfig[], rows: Record<string, unknown>[]): string | null {
  const typed = fields.find(f => f.type === 'date')
  if (typed) return typed.field
  const named = fields.filter(f => /date|time(stamp)?|created|posted|submitted/i.test(f.field + ' ' + (f.label || '')))
  for (const f of named) {
    const sample = evenSample(rows, 200)
    let ok = 0, seen = 0
    for (const r of sample) {
      const v = String(r[f.field] ?? '').trim()
      if (!v) continue
      seen++
      if (!isNaN(Date.parse(v))) ok++
    }
    if (seen >= 20 && ok / seen >= 0.7) return f.field
  }
  return null
}

/** Band field: a continuous numeric (not the rating) worth cross-cutting —
 *  the benchmark's "playtime" move. Needs spread (non-discrete or >20 distinct)
 *  and ≥30% coverage. Behavior-named fields win over arbitrary numerics. */
export function pickBandField(
  fields: SchemaFieldConfig[], analytics: DatasetAnalytics | null,
  totalRows: number, ratingField: string | null,
): { field: string; summary: NumericSummary } | null {
  if (!analytics || !totalRows) return null
  const candidates: { field: string; summary: NumericSummary; named: boolean }[] = []
  for (const f of fields) {
    if (f.type !== 'numeric' || f.field === ratingField) continue
    const s = analytics.fieldSummaries?.[f.field]
    if (!s || s.type !== 'numeric') continue
    if (s.isDiscrete && (s.uniqueCount ?? 0) <= 20) continue
    if (s.nonNull / totalRows < 0.3) continue
    candidates.push({
      field: f.field, summary: s,
      named: /playtime|hours|minutes|spend|amount|price|visits|tenure|age|helpful|votes|count/i.test(f.field + ' ' + (f.label || '')),
    })
  }
  candidates.sort((a, b) => Number(b.named) - Number(a.named) || b.summary.nonNull - a.summary.nonNull)
  return candidates[0] ? { field: candidates[0].field, summary: candidates[0].summary } : null
}

// ── Timeline ────────────────────────────────────────────────────────────

function bucketKey(dt: Date, unit: StoryTimeline['unit']): { key: number; label: string } {
  const y = dt.getUTCFullYear(), m = dt.getUTCMonth()
  if (unit === 'quarter') { const q = Math.floor(m / 3); return { key: y * 10 + q, label: 'Q' + (q + 1) + ' ' + y } }
  if (unit === 'month') {
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return { key: y * 100 + m, label: MON[m] + ' ' + y }
  }
  // week: bucket by the Monday of the ISO week
  const d = new Date(Date.UTC(y, m, dt.getUTCDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() - day + 1)
  return { key: d.getTime(), label: d.toISOString().slice(5, 10) }
}

/** Theme share over time + rating trend — the benchmark's strongest move,
 *  computed deterministically. Tracks the top non-neutral themes (≤3). */
export function buildTimeline(
  rows: Record<string, unknown>[], dateField: string, ratingField: string | null,
  themes: Theme[], fieldNames: string[],
): StoryTimeline | null {
  const dated: { dt: Date; r: Record<string, unknown> }[] = []
  for (const r of rows) {
    const v = String(r[dateField] ?? '').trim()
    if (!v) continue
    const t = Date.parse(v)
    if (isNaN(t)) continue
    dated.push({ dt: new Date(t), r })
  }
  if (dated.length < 100) return null
  const times = dated.map(d => d.dt.getTime())
  const spanDays = (Math.max(...times) - Math.min(...times)) / 86_400_000
  const unit: StoryTimeline['unit'] = spanDays >= 1100 ? 'quarter' : spanDays >= 150 ? 'month' : 'week'

  const tracked = [...themes]
    .filter(t => t.sentiment !== 'neutral' && t.keywords?.length)
    .sort((a, b) => b.count - a.count).slice(0, 3)
  const regexes = new Map(tracked.map(t => [t.name, t.keywords.map(buildKwRegex)]))

  const buckets = new Map<number, { label: string; count: number; rSum: number; rN: number; sub: number; hits: Map<string, number> }>()
  for (const { dt, r } of dated) {
    const { key, label } = bucketKey(dt, unit)
    let b = buckets.get(key)
    if (!b) { b = { label, count: 0, rSum: 0, rN: 0, sub: 0, hits: new Map() }; buckets.set(key, b) }
    b.count++
    if (ratingField) {
      const v = parseFloat(String(r[ratingField] ?? ''))
      if (!isNaN(v)) { b.rSum += v; b.rN++ }
    }
    const text = fieldNames.map(f => String(r[f] ?? '')).join(' ')
    if (fieldNames.some(f => isSubstantiveText(String(r[f] ?? '')))) {
      b.sub++
      for (const [name, res] of regexes) {
        if (res.some(re => re.test(text))) b.hits.set(name, (b.hits.get(name) || 0) + 1)
      }
    }
  }

  const keys = [...buckets.keys()].sort((a, b) => a - b)
  const points: StoryTimelinePoint[] = keys.map(k => {
    const b = buckets.get(k)!
    const shares: Record<string, number> = {}
    for (const t of tracked) shares[t.name] = b.sub ? Math.round((b.hits.get(t.name) || 0) / b.sub * 1000) / 10 : 0
    return { label: b.label, count: b.count, avgRating: b.rN ? Math.round(b.rSum / b.rN * 100) / 100 : null, shares }
  }).filter(p => p.count >= 20)
  if (points.length < 4) return null

  // Rating trend: first third vs last third (weighted by rated counts is
  // overkill for a story — simple means over the point averages).
  const third = Math.max(1, Math.floor(points.length / 3))
  const mean = (ps: StoryTimelinePoint[], f: (p: StoryTimelinePoint) => number | null) => {
    const vs = ps.map(f).filter((v): v is number => v != null)
    return vs.length ? Math.round(vs.reduce((a, b) => a + b, 0) / vs.length * 100) / 100 : null
  }
  const first = points.slice(0, third), last = points.slice(-third)
  const ratingFrom = mean(first, p => p.avgRating)
  const ratingTo = mean(last, p => p.avgRating)

  let shiftTheme: StoryTimeline['shiftTheme'] = null
  for (const t of tracked) {
    const fromPct = mean(first, p => p.shares[t.name] ?? null)
    const toPct = mean(last, p => p.shares[t.name] ?? null)
    if (fromPct == null || toPct == null) continue
    if (!shiftTheme || Math.abs(toPct - fromPct) > Math.abs(shiftTheme.toPct - shiftTheme.fromPct)) {
      shiftTheme = { name: t.name, fromPct: Math.round(fromPct * 10) / 10, toPct: Math.round(toPct * 10) / 10 }
    }
  }

  return { fieldLabel: dateField, unit, points, tracked: tracked.map(t => t.name), ratingFrom, ratingTo, shiftTheme }
}

// ── Numeric bands ───────────────────────────────────────────────────────

/** Quartile cross-cut on a behavior numeric ("the angriest reviewers are not
 *  the ones who bounced"): avg rating + dominant negative theme per band. */
export function buildBands(
  rows: Record<string, unknown>[], bandField: string, _summary: NumericSummary,
  ratingField: string | null, themes: Theme[], fieldNames: string[],
): StoryBands | null {
  // Quartiles from the rows themselves — the stored analytics percentiles can
  // be stale or degenerate (ea_football: p25 = median = p75), and the rows
  // are already in memory.
  const vals = rows.map(r => parseFloat(String(r[bandField] ?? ''))).filter(v => !isNaN(v)).sort((a, b) => a - b)
  if (vals.length < 200) return null
  const q = (f: number) => vals[Math.floor(f * (vals.length - 1))]
  const cuts = [q(0.25), q(0.5), q(0.75)]
  if (cuts[0] === cuts[2]) return null
  const fmtCut = (v: number) => Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : String(Math.round(v * 10) / 10)
  const labels = [
    '≤ ' + fmtCut(cuts[0]),
    fmtCut(cuts[0]) + '–' + fmtCut(cuts[1]),
    fmtCut(cuts[1]) + '–' + fmtCut(cuts[2]),
    '> ' + fmtCut(cuts[2]),
  ]
  const negThemes = themes.filter(t => (t.sentiment === 'negative' || t.sentiment === 'mixed') && t.keywords?.length)
    .sort((a, b) => b.count - a.count).slice(0, 5)
  const regexes = new Map(negThemes.map(t => [t.name, t.keywords.map(buildKwRegex)]))

  const bands = labels.map(label => ({ label, n: 0, rSum: 0, rN: 0, sub: 0, hits: new Map<string, number>() }))
  for (const r of rows) {
    const v = parseFloat(String(r[bandField] ?? ''))
    if (isNaN(v)) continue
    const i = v <= cuts[0] ? 0 : v <= cuts[1] ? 1 : v <= cuts[2] ? 2 : 3
    const b = bands[i]
    b.n++
    if (ratingField) {
      const rv = parseFloat(String(r[ratingField] ?? ''))
      if (!isNaN(rv)) { b.rSum += rv; b.rN++ }
    }
    if (fieldNames.some(f => isSubstantiveText(String(r[f] ?? '')))) {
      b.sub++
      const text = fieldNames.map(f => String(r[f] ?? '')).join(' ')
      for (const [name, res] of regexes) {
        if (res.some(re => re.test(text))) b.hits.set(name, (b.hits.get(name) || 0) + 1)
      }
    }
  }
  if (bands.some(b => b.n < 50)) return null

  const out: StoryBand[] = bands.map(b => {
    let topTheme: string | null = null, topThemePct: number | null = null
    for (const [name, n] of b.hits) {
      const pct = b.sub ? Math.round(n / b.sub * 1000) / 10 : 0
      if (topThemePct == null || pct > topThemePct) { topTheme = name; topThemePct = pct }
    }
    return {
      label: b.label, n: b.n,
      avgRating: b.rN ? Math.round(b.rSum / b.rN * 100) / 100 : null,
      topTheme, topThemePct,
    }
  })
  const rated = out.filter(b => b.avgRating != null)
  const lowest = rated.length >= 2
    ? rated.reduce((a, b) => (b.avgRating as number) < (a.avgRating as number) ? b : a)
    : null
  return {
    fieldLabel: bandField,
    bands: out,
    lowest: lowest ? { label: lowest.label, avgRating: lowest.avgRating as number } : null,
  }
}

/** No-rating fallback finding for the bands section: the negative theme whose
 *  share spreads widest across the bands. */
export function bandThemeSpread(b: StoryBands): { theme: string; minBand: string; minPct: number; maxBand: string; maxPct: number } | null {
  const withTheme = b.bands.filter(x => x.topTheme != null && x.topThemePct != null)
  if (withTheme.length < 2) return null
  const byTheme = new Map<string, { band: string; pct: number }[]>()
  for (const band of withTheme) {
    const arr = byTheme.get(band.topTheme as string) || []
    arr.push({ band: band.label, pct: band.topThemePct as number })
    byTheme.set(band.topTheme as string, arr)
  }
  let best: { theme: string; minBand: string; minPct: number; maxBand: string; maxPct: number } | null = null
  for (const [theme, arr] of byTheme) {
    if (arr.length < 2) continue
    const min = arr.reduce((a, c) => c.pct < a.pct ? c : a)
    const max = arr.reduce((a, c) => c.pct > a.pct ? c : a)
    if (!best || max.pct - min.pct > best.maxPct - best.minPct) {
      best = { theme, minBand: min.band, minPct: min.pct, maxBand: max.band, maxPct: max.pct }
    }
  }
  return best && best.maxPct - best.minPct >= 5 ? best : null
}

// ── Segment drift ───────────────────────────────────────────────────────

/** Which theme's share varies most across the segments — the finding that
 *  turns "How it differs by X" into a headline. */
export function computeDrift(segments: StorySegment[]): StoryDrift | null {
  if (segments.length < 2) return null
  const byTheme = new Map<string, { seg: string; pct: number }[]>()
  for (const s of segments) for (const t of s.themes) {
    const arr = byTheme.get(t.name) || []
    arr.push({ seg: s.label, pct: t.pct })
    byTheme.set(t.name, arr)
  }
  let best: StoryDrift | null = null
  for (const [theme, arr] of byTheme) {
    if (arr.length < 2) continue
    const min = arr.reduce((a, b) => b.pct < a.pct ? b : a)
    const max = arr.reduce((a, b) => b.pct > a.pct ? b : a)
    if (!best || (max.pct - min.pct) > (best.maxPct - best.minPct)) {
      best = { theme, minSeg: min.seg, minPct: min.pct, maxSeg: max.seg, maxPct: max.pct }
    }
  }
  return best && best.maxPct - best.minPct >= 5 ? best : null
}

// ── Explorer ────────────────────────────────────────────────────────────

/** Bounded raw-browse corpus for the reader: evenly-sampled substantive
 *  excerpts tagged with matched themes / segment / rating / period. Raw
 *  browsing, not curated evidence — the curated quotes keep the verbatim
 *  guard; this is "read the responses yourselves". */
export function buildExplorer(
  substantive: Record<string, unknown>[], fieldNames: string[], themes: Theme[],
  segmentField: string | null, ratingField: string | null,
  dateField: string | null, unit: StoryTimeline['unit'] | null,
): ExplorerItem[] {
  const sample = evenSample(substantive, EXPLORER_CAP)
  const regexes = themes.filter(t => t.keywords?.length)
    .map(t => ({ name: t.name, res: t.keywords.map(buildKwRegex) }))
  return sample.map(r => {
    const text = fieldNames.map(f => String(r[f] ?? '')).filter(Boolean).join(' ').trim()
    const th = regexes.filter(t => t.res.some(re => re.test(text))).map(t => t.name)
    let d: string | null = null
    if (dateField && unit) {
      const t = Date.parse(String(r[dateField] ?? ''))
      if (!isNaN(t)) d = bucketKey(new Date(t), unit).label
    }
    const rv = ratingField ? parseFloat(String(r[ratingField] ?? '')) : NaN
    return {
      t: text.length > 300 ? text.slice(0, 297).trimEnd() + '…' : text,
      th,
      s: segmentField ? (String(r[segmentField] ?? '').trim() || null) : null,
      r: isNaN(rv) ? null : rv,
      d,
    }
  }).filter(e => e.t.length >= 40)
}

// ── Payload ─────────────────────────────────────────────────────────────

export interface BuildStoryOpts {
  rows: Record<string, unknown>[]
  themeModel: ThemeModel
  datasetName: string
  totalRows: number
  fields: SchemaFieldConfig[]
  analytics: DatasetAnalytics | null
}

export function buildStoryPayload(opts: BuildStoryOpts): Omit<StoryData, 'narrative'> {
  const { themeModel, datasetName, totalRows, fields, analytics } = opts
  const fieldNames = themeModel.fieldNames?.length ? themeModel.fieldNames : [themeModel.fieldName]
  const baseThemes = (themeSetForField(themeModel, fieldNames) || themeModel).themes
  let ratingField = pickRatingField(fields)
  let ratingLabel: string | null = ratingField
  let rows = opts.rows.length > STORY_ROW_CAP ? evenSample(opts.rows, STORY_ROW_CAP) : opts.rows
  let scoreSourceField: string | null = null
  if (!ratingField) {
    const derived = deriveScoreField(fields, rows)
    if (derived) {
      rows = rows.map(r => ({ ...r, __score: derived.map(r[derived.field]) }))
      ratingField = '__score'
      ratingLabel = derived.label
      scoreSourceField = derived.field
    }
  }
  const segmentField = pickSegmentField(
    fields.filter(f => f.field !== ratingField && f.field !== scoreSourceField), analytics, totalRows)
  const themed = recountThemes(baseThemes, rows, fieldNames, ratingField)
  const substantive = rows.filter(r => fieldNames.some(f => isSubstantiveText(String(r[f] ?? ''))))

  // Overall avg rating over ALL analyzed rows (recountThemes' own baseline rule).
  let overallAvgRating: number | null = null
  if (ratingField) {
    let sum = 0, n = 0
    for (const r of rows) { const v = parseFloat(String(r[ratingField] ?? '')); if (!isNaN(v)) { sum += v; n++ } }
    overallAvgRating = n ? Math.round((sum / n) * 100) / 100 : null
  }

  // Per-segment theme profiles through the SAME recount.
  const segments: StorySegment[] = []
  if (segmentField) {
    const values = [...new Set(substantive.map(r => String(r[segmentField] ?? '').trim()).filter(Boolean))].slice(0, 6)
    for (const v of values) {
      const srs = rows.filter(r => String(r[segmentField] ?? '').trim() === v)
      const sSub = srs.filter(r => fieldNames.some(f => isSubstantiveText(String(r[f] ?? '')))).length
      if (sSub < 30) continue // too thin to profile honestly
      const st = recountThemes(baseThemes, srs, fieldNames, null)
      segments.push({
        label: v, substantive: sSub,
        themes: [...st].sort((a, b) => b.percentage - a.percentage).slice(0, 4)
          .map(t => ({ name: t.name, pct: t.percentage })),
      })
    }
    segments.sort((a, b) => b.substantive - a.substantive)
  }
  const keptSegments = segments.length >= 2 ? segments : []

  const dateField = pickDateField(fields, rows)
  const timeline = dateField ? buildTimeline(rows, dateField, ratingField, themed, fieldNames) : null

  const bandPick = pickBandField(fields, analytics, totalRows, ratingField)
  const bands = bandPick ? buildBands(rows, bandPick.field, bandPick.summary, ratingField, themed, fieldNames) : null

  const quotesRatingField = scoreSourceField ? null : ratingField
  const quotes = pickQuotes(themed, substantive, fieldNames, segmentField, quotesRatingField)
  const explorer = buildExplorer(substantive, fieldNames, themed, keptSegments.length ? segmentField : null,
    quotesRatingField, timeline ? dateField : null, timeline?.unit ?? null)

  return {
    datasetName,
    generated: new Date().toISOString().slice(0, 10),
    totalRows,
    analyzedRows: rows.length,
    substantiveBase: substantive.length,
    fieldLabel: fieldNames.join(' + '),
    overallAvgRating,
    ratingFieldLabel: ratingField ? ratingLabel : null,
    segmentFieldLabel: keptSegments.length ? segmentField : null,
    themes: themed.map(t => ({
      id: t.id, name: t.name, description: t.description, sentiment: t.sentiment,
      keywords: (t.keywords || []).slice(0, 8),
      count: t.count, pct: t.percentage, ciLow: t.ciLow, ciHigh: t.ciHigh,
      avgRating: t.avgRating, ratingDelta: t.ratingDelta, ratingCount: t.ratingCount,
    })),
    segments: keptSegments,
    drift: computeDrift(keptSegments),
    timeline,
    bands,
    quotes,
    explorer,
  }
}

/** Verbatim rule (CLAUDE.md, owner 2026-08-18): a quote may only illustrate a
 *  premise its own displayed text carries. Sentence must contain the theme
 *  keyword AND pass verbatimSupports for the theme's sentiment. Neutral
 *  themes get no quote rather than an unverifiable one. */
function pickQuotes(
  themes: Theme[], substantive: Record<string, unknown>[], fieldNames: string[],
  segmentField: string | null, ratingField: string | null,
): StoryQuote[] {
  const out: StoryQuote[] = []
  const seen = new Set<string>()
  for (const t of [...themes].sort((a, b) => b.count - a.count)) {
    const premise: VerbatimPremise | null =
      t.sentiment === 'negative' || t.sentiment === 'mixed' ? 'negative'
      : t.sentiment === 'positive' ? 'positive' : null
    if (!premise || !t.keywords?.length) continue
    const regexes = t.keywords.map(k => new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'i'))
    let picked = 0
    for (const r of substantive) {
      if (picked >= 2) break
      const text = fieldNames.map(f => String(r[f] ?? '')).join(' ').trim()
      if (text.length < 60 || text.length > 800) continue
      const sent = text.split(/(?<=[.!?])\s+/).find(s =>
        s.length >= 40 && s.length <= 220 && regexes.some(re => re.test(s)))
      if (!sent || !verbatimSupports(sent, premise)) continue
      const key = sent.trim().toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const metaBits: string[] = [t.name]
      if (segmentField && String(r[segmentField] ?? '').trim()) metaBits.push(String(r[segmentField]).trim())
      if (ratingField && String(r[ratingField] ?? '').trim()) metaBits.push(String(r[ratingField]).trim() + '★')
      out.push({ text: sent.trim(), theme: t.name, meta: metaBits.join(' · ') })
      picked++
    }
  }
  return out.slice(0, 10)
}

// ── Narrative ───────────────────────────────────────────────────────────

/** Deterministic narrative + FINDINGS-LED section heads — used when the AI
 *  call fails, and the baseline the AI version replaces. Every headline is a
 *  claim with its number; states only payload facts. */
export function deterministicNarrative(d: Omit<StoryData, 'narrative'>): StoryNarrative {
  const top = [...d.themes].sort((a, b) => b.count - a.count)[0]
  const worst = d.overallAvgRating != null
    ? [...d.themes].filter(t => t.ratingDelta != null && (t.ratingCount || 0) >= 30).sort((a, b) => (a.ratingDelta || 0) - (b.ratingDelta || 0))[0]
    : undefined
  const tl = d.timeline
  const ratingMoved = tl && tl.ratingFrom != null && tl.ratingTo != null && Math.abs(tl.ratingTo - tl.ratingFrom) >= 0.05
  const themeShift = tl?.shiftTheme && Math.abs(tl.shiftTheme.toPct - tl.shiftTheme.fromPct) >= 3 ? tl.shiftTheme : null
  const timelineHead = tl
    ? (themeShift
        ? `“${themeShift.name}” moved from ${themeShift.fromPct}% to ${themeShift.toPct}% of the conversation`
        : ratingMoved
          ? `The average ${d.ratingFieldLabel || 'score'} moved ${tl.ratingFrom} → ${tl.ratingTo} over the period`
          : `The pattern holds steady across ${tl.points.length} ${tl.unit}s`)
    : null
  const spread = d.bands ? bandThemeSpread(d.bands) : null
  const bandsHead = d.bands?.lowest && d.overallAvgRating != null
    ? `The ${d.bands.lowest.label} ${d.bands.fieldLabel} band rates lowest — ${d.bands.lowest.avgRating} vs ${d.overallAvgRating} overall`
    : spread
      ? `“${spread.theme}” hits ${spread.maxPct}% in the ${spread.maxBand} ${d.bands!.fieldLabel} band, ${spread.minPct}% in the ${spread.minBand}`
      : null
  return {
    headline: null,
    lede: `${d.substantiveBase.toLocaleString('en-US')} of ${d.totalRows.toLocaleString('en-US')} responses carry substantive written feedback. ${d.themes.length} themes describe what they talk about.`,
    themesHead: top ? `“${top.name}” dominates — ${top.pct}% of substantive responses` : 'What the responses talk about',
    themesIntro: top ? `“${top.name}” leads the conversation, appearing in ${top.pct}% of substantive responses (${top.count.toLocaleString('en-US')} mentions).` : '',
    ratingHead: worst && worst.ratingDelta != null
      ? `“${worst.name}” drags the score hardest: ${worst.avgRating} vs ${d.overallAvgRating} overall`
      : null,
    ratingIntro: worst && worst.ratingDelta != null
      ? `Responses mentioning “${worst.name}” average ${worst.avgRating} — ${Math.abs(worst.ratingDelta).toFixed(2)} below the ${d.overallAvgRating} overall average.`
      : null,
    segmentHead: d.drift
      ? `“${d.drift.theme}” splits the ${d.segmentFieldLabel}s: ${d.drift.minPct}% at ${d.drift.minSeg}, ${d.drift.maxPct}% at ${d.drift.maxSeg}`
      : d.segments.length >= 2 ? `How it differs by ${d.segmentFieldLabel}` : null,
    segmentIntro: d.segments.length >= 2
      ? (d.drift
          ? `The widest gap is “${d.drift.theme}” — ${d.drift.maxPct}% of ${d.drift.maxSeg}'s substantive responses versus ${d.drift.minPct}% at ${d.drift.minSeg}.`
          : `The mix shifts by ${d.segmentFieldLabel}: each segment leads with its own dominant theme.`)
      : null,
    timelineHead,
    timelineIntro: tl
      ? (themeShift
          ? `Between the start and end of the period, “${themeShift.name}” went from ${themeShift.fromPct}% to ${themeShift.toPct}% of substantive responses.`
          : ratingMoved
            ? `Averaging the first and last stretches of the period, the ${d.ratingFieldLabel || 'score'} moved from ${tl.ratingFrom} to ${tl.ratingTo}.`
            : `Volume and sentiment stay broadly stable across the ${tl.points.length} ${tl.unit}s observed.`)
      : null,
    bandsHead,
    bandsIntro: d.bands?.lowest
      ? `Split by ${d.bands.fieldLabel} quartile, the ${d.bands.lowest.label} band averages ${d.bands.lowest.avgRating}.`
      : spread
        ? `Split by ${d.bands!.fieldLabel} quartile, “${spread.theme}” dominates the ${spread.maxBand} band at ${spread.maxPct}% of its substantive responses, against ${spread.minPct}% in the ${spread.minBand} band.`
        : null,
  }
}

/** Prompt for the AI narrative pass. The composition rule is strict: prose may
 *  reference ONLY figures present in the payload summary — content rules
 *  (CLAUDE.md: no fabricated data) enforced by instruction + the fact that
 *  every chart renders from the payload regardless of what the prose says. */
export function narrativePrompt(d: Omit<StoryData, 'narrative'>): { system: string; user: string } {
  const facts = {
    datasetName: d.datasetName, totalRows: d.totalRows, substantiveBase: d.substantiveBase,
    overallAvgRating: d.overallAvgRating,
    themes: d.themes.map(t => ({ name: t.name, pct: t.pct, count: t.count, sentiment: t.sentiment, avgRating: t.avgRating, ratingDelta: t.ratingDelta })),
    segments: d.segments,
    drift: d.drift,
    timeline: d.timeline ? {
      unit: d.timeline.unit, tracked: d.timeline.tracked,
      ratingFrom: d.timeline.ratingFrom, ratingTo: d.timeline.ratingTo,
      shiftTheme: d.timeline.shiftTheme,
      points: d.timeline.points,
    } : null,
    bands: d.bands,
  }
  return {
    system:
      'You write the narrative for a data story published to a client — the register of good data journalism: ' +
      'every headline is a FINDING (a claim with its number in it), never a category label. Respond with ONLY raw JSON: ' +
      '{"headline":"...","lede":"...","themesHead":"...","themesIntro":"...","ratingHead":...,"ratingIntro":...,' +
      '"segmentHead":...,"segmentIntro":...,"timelineHead":...,"timelineIntro":...,"bandsHead":...,"bandsIntro":...} ' +
      '— fields marked null in the instructions must be null; heads are one sentence, no terminal period; intros 2–3 sentences. ' +
      'HARD RULES: "headline" is the page H1 — the single most important tension in the data, stated as an argument ' +
      '(like "Three seasons in, the drive is going backwards"), ≤ 90 characters, no dataset-name repetition. ' +
      'Use ONLY numbers that appear verbatim in the provided facts — never compute, extrapolate, or invent a figure. ' +
      'Never mention data you were not given. No exclamation marks. Plain confident prose, no headline-speak clichés.',
    user: 'Facts:\n' + JSON.stringify(facts, null, 1) +
      '\n\nWrite: headline (thesis H1), lede (what this corpus is and the single most important pattern), ' +
      'themesHead + themesIntro (what dominates the conversation), ' +
      (d.overallAvgRating != null ? 'ratingHead + ratingIntro (which themes sit above/below the overall average and what that implies), ' : 'ratingHead and ratingIntro must be null, ') +
      (d.segments.length >= 2 ? 'segmentHead + segmentIntro (the widest segment gap and what it means), ' : 'segmentHead and segmentIntro must be null, ') +
      (d.timeline ? 'timelineHead + timelineIntro (what moved over time — lead with the biggest shift), ' : 'timelineHead and timelineIntro must be null, ') +
      (d.bands ? `bandsHead + bandsIntro (how ${d.bands.fieldLabel} bands differ — is the pattern what a reader would expect?).` : 'bandsHead and bandsIntro must be null.'),
  }
}

export function parseNarrative(text: string, fallback: StoryNarrative): StoryNarrative {
  try {
    const m = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').match(/\{[\s\S]*\}/)
    if (!m) return fallback
    const j = JSON.parse(m[0]) as Partial<StoryNarrative>
    const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
    return {
      headline: s(j.headline) ?? fallback.headline,
      lede: s(j.lede) || fallback.lede,
      themesHead: s(j.themesHead) || fallback.themesHead,
      themesIntro: s(j.themesIntro) || fallback.themesIntro,
      ratingHead: s(j.ratingHead) ?? fallback.ratingHead,
      ratingIntro: s(j.ratingIntro) ?? fallback.ratingIntro,
      segmentHead: s(j.segmentHead) ?? fallback.segmentHead,
      segmentIntro: s(j.segmentIntro) ?? fallback.segmentIntro,
      timelineHead: s(j.timelineHead) ?? fallback.timelineHead,
      timelineIntro: s(j.timelineIntro) ?? fallback.timelineIntro,
      bandsHead: s(j.bandsHead) ?? fallback.bandsHead,
      bandsIntro: s(j.bandsIntro) ?? fallback.bandsIntro,
    }
  } catch { return fallback }
}

// ── Renderer ────────────────────────────────────────────────────────────

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const fmt = (n: number) => n.toLocaleString('en-US')

// Categorical palette validated with the dataviz six-checks (2026-09-02):
// #089A9E #E85A1A #4A6FD0 #B8860B on the paper surface — all PASS.
const SEG_COLORS = ['#089A9E', '#E85A1A', '#4A6FD0', '#B8860B', '#5C6B64', '#7A4FBF']

function themeBarsSvg(themes: StoryThemeRow[], base: number): string {
  const rows = [...themes].sort((a, b) => b.count - a.count)
  const labW = 300, maxW = 380, rowH = 40
  const maxPct = Math.max(35, ...rows.map(t => t.pct))
  let s = `<svg viewBox="0 0 860 ${rows.length * rowH + 10}" role="img" aria-label="Theme prevalence">`
  rows.forEach((t, i) => {
    const y = 8 + i * rowH
    const w = Math.max(4, t.pct / maxPct * maxW)
    s += `<text x="${labW - 10}" y="${y + 15}" text-anchor="end" font-size="13" fill="#1A2421">${esc(t.name)}</text>` +
      `<rect x="${labW}" y="${y}" width="${w}" height="22" rx="4" fill="#089A9E"><title>${esc(t.name)}: ${fmt(t.count)} of ${fmt(base)} (${t.pct}%)</title></rect>` +
      `<text x="${labW + w + 8}" y="${y + 15}" font-size="12.5" fill="#1A2421">${t.pct}% · ${fmt(t.count)}</text>`
  })
  return s + '</svg>'
}

function ratingDotsSvg(themes: StoryThemeRow[], overall: number): string {
  const rows = themes.filter(t => t.avgRating != null && (t.ratingCount || 0) >= 30)
    .sort((a, b) => (a.ratingDelta || 0) - (b.ratingDelta || 0))
  if (!rows.length) return ''
  const labW = 300, x0 = labW, x1 = 800, rowH = 38
  const vals = rows.map(t => t.avgRating as number).concat(overall)
  const lo = Math.min(...vals) - 0.15, hi = Math.max(...vals) + 0.15
  const X = (v: number) => x0 + (v - lo) / (hi - lo || 1) * (x1 - x0)
  const H = rows.length * rowH + 30
  let s = `<svg viewBox="0 0 860 ${H}" role="img" aria-label="Average rating by theme">` +
    `<line x1="${X(overall)}" y1="4" x2="${X(overall)}" y2="${H - 24}" stroke="#9AA7A1" stroke-width="1.5" stroke-dasharray="4 3"/>` +
    `<text x="${X(overall)}" y="${H - 8}" text-anchor="middle" font-size="11.5" fill="#5C6B64">overall ${overall}</text>`
  rows.forEach((t, i) => {
    const y = 20 + i * rowH
    const below = (t.ratingDelta || 0) < 0
    s += `<text x="${labW - 10}" y="${y + 4}" text-anchor="end" font-size="13" fill="#1A2421">${esc(t.name)}</text>` +
      `<line x1="${X(overall)}" y1="${y}" x2="${X(t.avgRating as number)}" y2="${y}" stroke="#D8DEDB" stroke-width="2"/>` +
      `<circle cx="${X(t.avgRating as number)}" cy="${y}" r="7" fill="${below ? '#E85A1A' : '#089A9E'}" stroke="#FCFCFB" stroke-width="2">` +
      `<title>${esc(t.name)}: avg ${t.avgRating} over ${fmt(t.ratingCount || 0)} rated mentions (${(t.ratingDelta || 0) > 0 ? '+' : ''}${t.ratingDelta} vs overall)</title></circle>` +
      `<text x="${X(t.avgRating as number) + 13}" y="${y + 4}" font-size="12.5" fill="#1A2421">${t.avgRating}</text>`
  })
  return s + '</svg>'
}

/** One-axis line chart over the timeline buckets (dataviz rule: never dual
 *  axis — rating and theme-share render as separate figures). */
function timelineLinesSvg(
  points: StoryTimelinePoint[], series: { name: string; color: string; get: (p: StoryTimelinePoint) => number | null }[],
  unitLabel: string, pctAxis: boolean,
): string {
  const W = 860, H = 240, padL = 44, padR = 120, padY = 18
  const vals: number[] = []
  for (const s of series) for (const p of points) { const v = s.get(p); if (v != null) vals.push(v) }
  if (!vals.length) return ''
  let lo = Math.min(...vals), hi = Math.max(...vals)
  if (hi - lo < (pctAxis ? 4 : 0.3)) { const mid = (hi + lo) / 2, half = (pctAxis ? 2 : 0.15); lo = mid - half; hi = mid + half }
  const X = (i: number) => padL + (points.length === 1 ? 0 : i / (points.length - 1)) * (W - padL - padR)
  const Y = (v: number) => padY + (1 - (v - lo) / (hi - lo)) * (H - padY * 2 - 20)
  const fmtV = (v: number) => pctAxis ? Math.round(v * 10) / 10 + '%' : String(Math.round(v * 100) / 100)
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend by ${esc(unitLabel)}">`
  // recessive gridlines at lo/mid/hi
  for (const v of [lo, (lo + hi) / 2, hi]) {
    s += `<line x1="${padL}" y1="${Y(v)}" x2="${W - padR}" y2="${Y(v)}" stroke="#E4EAE8" stroke-width="1"/>` +
      `<text x="${padL - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="#5C6B64">${fmtV(v)}</text>`
  }
  for (const ser of series) {
    const pts = points.map((p, i) => ({ i, v: ser.get(p) })).filter(p => p.v != null) as { i: number; v: number }[]
    if (pts.length < 2) continue
    const poly = pts.map(p => X(p.i) + ',' + Y(p.v)).join(' ')
    const last = pts[pts.length - 1]
    s += `<polyline points="${poly}" fill="none" stroke="${ser.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` +
      pts.map(p => `<circle cx="${X(p.i)}" cy="${Y(p.v)}" r="3.5" fill="${ser.color}"><title>${esc(ser.name)} · ${esc(points[p.i].label)}: ${fmtV(p.v)} (${fmt(points[p.i].count)} responses)</title></circle>`).join('') +
      `<text x="${X(last.i) + 10}" y="${Y(last.v) + 4}" font-size="12" fill="${ser.color}">${esc(ser.name.length > 16 ? ser.name.slice(0, 15) + '…' : ser.name)}</text>`
  }
  // x labels: first, middle, last
  const idxs = [0, Math.floor((points.length - 1) / 2), points.length - 1]
  for (const i of [...new Set(idxs)]) {
    s += `<text x="${X(i)}" y="${H - 4}" text-anchor="middle" font-size="11" fill="#5C6B64">${esc(points[i].label)}</text>`
  }
  return s + '</svg>'
}

function bandsGrid(b: StoryBands, overall: number | null, ratingLabel: string | null): string {
  return b.bands.map(band => {
    const color = band.avgRating != null && overall != null && band.avgRating < overall ? '#E85A1A' : '#089A9E'
    return `<div class="sgcard"><div class="sgname">${esc(band.label)}</div>` +
      `<div class="sgsub">${fmt(band.n)} responses</div>` +
      (band.avgRating != null ? `<div class="bandavg" style="color:${color}">${band.avgRating}</div><div class="sgsub">average ${esc(ratingLabel || 'rating')}</div>` : '') +
      (band.topTheme ? `<div class="sglbl" style="margin-top:8px">Top complaint: ${esc(band.topTheme)} (${band.topThemePct}%)</div>` : '') +
      `</div>`
  }).join('')
}

function segmentGrid(d: StoryData): string {
  return d.segments.map((seg, i) => {
    const color = SEG_COLORS[i % SEG_COLORS.length]
    const bars = seg.themes.map(t =>
      `<div class="sglbl">${esc(t.name)}</div>` +
      `<div class="sgtrack"><div class="sgbar" style="width:${Math.min(100, t.pct / 50 * 100)}%;background:${color}"></div><span>${t.pct}%</span></div>`
    ).join('')
    return `<div class="sgcard"><div class="sgname" style="color:${color}">${esc(seg.label)}</div>` +
      `<div class="sgsub">${fmt(seg.substantive)} substantive responses</div>${bars}</div>`
  }).join('')
}

/** Reader-driven verbatim explorer: filter chips + search over the embedded
 *  excerpt sample. Vanilla JS, self-contained, no external requests. */
function explorerHtml(d: StoryData): string {
  if (d.explorer.length < 40) return ''
  const themes = [...new Set(d.explorer.flatMap(e => e.th))].sort()
  const segs = [...new Set(d.explorer.map(e => e.s).filter((s): s is string => !!s))].sort()
  const json = JSON.stringify(d.explorer).replace(/</g, '\\u003c')
  const opt = (v: string) => `<option value="${esc(v)}">${esc(v)}</option>`
  return `<section><h2>Read the responses yourselves</h2>
<p class="sub">An evenly-drawn sample of ${fmt(d.explorer.length)} substantive responses from the ${fmt(d.substantiveBase)}-response base — filter and search them directly. Raw browsing, not curated evidence.</p>
<div class="xctl">
<select id="xTheme"><option value="">All themes</option>${themes.map(opt).join('')}</select>
${segs.length >= 2 ? `<select id="xSeg"><option value="">All ${esc(d.segmentFieldLabel || 'segments')}</option>${segs.map(opt).join('')}</select>` : ''}
${d.explorer.some(e => e.r != null) ? `<select id="xRate"><option value="">All ratings</option><option value="low">Low (below midpoint)</option><option value="high">High (at/above midpoint)</option></select>` : ''}
<input id="xQ" type="search" placeholder="Search the text…" />
<span id="xCount" class="xcount"></span>
</div>
<div id="xList"></div>
<script>
(function(){
var DATA=${json};
var mid=(function(){var rs=DATA.map(function(e){return e.r}).filter(function(v){return v!=null});if(!rs.length)return null;return (Math.min.apply(null,rs)+Math.max.apply(null,rs))/2})();
var els={t:document.getElementById('xTheme'),s:document.getElementById('xSeg'),r:document.getElementById('xRate'),q:document.getElementById('xQ'),c:document.getElementById('xCount'),l:document.getElementById('xList')};
function escH(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function render(){
var th=els.t?els.t.value:'',sg=els.s?els.s.value:'',rt=els.r?els.r.value:'',q=(els.q?els.q.value:'').toLowerCase().trim();
var hits=DATA.filter(function(e){
if(th&&e.th.indexOf(th)<0)return false;
if(sg&&e.s!==sg)return false;
if(rt&&mid!=null){if(e.r==null)return false;if(rt==='low'&&e.r>=mid)return false;if(rt==='high'&&e.r<mid)return false}
if(q&&e.t.toLowerCase().indexOf(q)<0)return false;
return true});
els.c.textContent=hits.length+' of '+DATA.length+' in view';
els.l.innerHTML=hits.slice(0,60).map(function(e){
var meta=[e.s,e.r!=null?e.r+'\\u2605':null,e.d].filter(Boolean).join(' \\u00b7 ');
var tags=e.th.slice(0,3).map(function(t){return '<span class="xtag">'+escH(t)+'</span>'}).join('');
return '<div class="xrow"><p>'+escH(e.t)+'</p><div class="xmeta">'+tags+(meta?'<span>'+escH(meta)+'</span>':'')+'</div></div>'
}).join('')+(hits.length>60?'<div class="xmore">Showing the first 60 \\u2014 narrow the filters to see the rest.</div>':'');
}
['change','input'].forEach(function(ev){[els.t,els.s,els.r,els.q].forEach(function(el){if(el)el.addEventListener(ev,render)})});
render();
})();
</script>
</section>`
}

/** Page title from the dataset name. Datasets are often named "<Brand> Reviews"
 *  (upload filenames, review syncs), which read awkwardly with the suffix —
 *  and the h1 must not stutter ("… Reviews Reviews"). Collapse an immediately
 *  repeated trailing word and drop a trailing "Reviews"/"Review" before the
 *  suffix; everything else passes through untouched. */
export function storyTitle(datasetName: string): string {
  const deStuttered = datasetName.trim().replace(/\s+(\S+)( \1)+$/i, ' $1')
  const stripped = deStuttered.replace(/\s+reviews?$/i, '')
  if (stripped && stripped !== deStuttered) return stripped + ': what the reviews say'
  return deStuttered + ': what the text says'
}

export function renderDataStory(d: StoryData): string {
  const n = d.narrative
  const quotes = d.quotes.map(q =>
    `<div class="q"><p>“${esc(q.text)}”</p><div class="qm">${esc(q.meta)}</div></div>`).join('')
  const tableRows = [...d.themes].sort((a, b) => b.count - a.count).map(t =>
    `<tr><td>${esc(t.name)}</td><td>${fmt(t.count)}</td><td>${t.pct}%</td><td>${t.avgRating ?? '—'}</td></tr>`).join('')
  const sampledNote = d.analyzedRows < d.totalRows
    ? ` Figures are computed over a deterministic ${fmt(d.analyzedRows)}-row sample of the ${fmt(d.totalRows)}-row dataset.` : ''

  const tl = d.timeline
  const timelineSection = tl && n.timelineHead ? (() => {
    const ratingFig = d.ratingFieldLabel && tl.points.some(p => p.avgRating != null)
      ? `<div class="fig">${timelineLinesSvg(tl.points, [{ name: 'avg ' + (d.ratingFieldLabel || 'rating'), color: '#0E7476', get: p => p.avgRating }], tl.unit, false)}
<div class="figcap">Average ${esc(d.ratingFieldLabel || 'rating')} per ${tl.unit}; ${tl.unit}s with fewer than 20 responses are dropped.</div></div>` : ''
    const shareSeries = tl.tracked.slice(0, 3).map((name, i) => ({
      name, color: SEG_COLORS[i % SEG_COLORS.length], get: (p: StoryTimelinePoint) => p.shares[name] ?? null,
    }))
    const shareFig = shareSeries.length
      ? `<div class="fig">${timelineLinesSvg(tl.points, shareSeries, tl.unit, true)}
<div class="figcap">Share of each ${tl.unit}'s substantive responses mentioning the theme. Hover a point for exact figures.</div></div>` : ''
    return `<section><h2>${esc(n.timelineHead)}</h2>
<p class="sub">By ${tl.unit}, from “${esc(tl.fieldLabel)}”.</p>
<p>${esc(n.timelineIntro || '')}</p>
${ratingFig}${shareFig}
</section>`
  })() : ''

  const bandsSection = d.bands && n.bandsHead ? `<section><h2>${esc(n.bandsHead)}</h2>
<p class="sub">Responses split into ${esc(d.bands.fieldLabel)} quartiles — same engine recount within each band.</p>
<p>${esc(n.bandsIntro || '')}</p>
<div class="fig"><div class="sgwrap">${bandsGrid(d.bands, d.overallAvgRating, d.ratingFieldLabel)}</div></div>
</section>` : ''

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.datasetName)} — Data Story</title><meta name="robots" content="noindex">
<style>
:root{--paper:#FCFCFB;--card:#F3F6F5;--ink:#1A2421;--dim:#5C6B64;--hair:rgba(26,36,33,.12);--teal:#0E7476;--orange:#E85A1A}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:17px;line-height:1.6;font-variant-numeric:tabular-nums}
.wrap{max-width:1040px;margin:0 auto;padding:0 26px}p{margin:0 0 15px}
.brand{font-weight:800;font-style:italic;font-size:15px}.brand .d{color:var(--teal)}.brand .n{color:var(--orange)}
.mast{padding:52px 0 8px}h1{font-size:clamp(28px,4.2vw,46px);line-height:1.06;margin:14px 0 12px;font-weight:750;letter-spacing:-.02em}
.kicker{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);margin:18px 0 0;font-weight:600}
.stand{font-size:18px;color:var(--dim);margin:0 0 10px}.stamp{font-size:13.5px;color:var(--dim)}
section{padding:40px 0 8px;border-top:1px solid var(--hair);margin-top:34px}
h2{font-size:clamp(21px,2.7vw,29px);font-weight:720;letter-spacing:-.015em;margin:0 0 6px}
.sub{color:var(--dim);font-size:15.5px;margin:0 0 20px}
.fig{background:var(--card);border-radius:12px;padding:22px;margin:18px 0 8px;overflow-x:auto}
.fig svg{width:100%;height:auto;min-width:640px}
.figcap{font-size:13px;color:var(--dim);margin-top:8px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:20px 0 4px}
.tile{background:var(--card);border-radius:12px;padding:16px 18px}.tile b{display:block;font-size:28px;font-weight:750}.tile span{font-size:13px;color:var(--dim)}
.sgwrap{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:20px}
.sgcard{background:var(--card);border-radius:12px;padding:16px}
.sgname{font-weight:700;font-size:14px}.sgsub{font-size:11.5px;color:var(--dim);margin-bottom:8px}
.sglbl{font-size:12px;margin:7px 0 2px}
.sgtrack{background:#E4EAE8;border-radius:4px;height:14px;position:relative}
.sgtrack span{position:absolute;right:6px;top:-1px;font-size:11px}
.sgbar{height:14px;border-radius:4px}
.bandavg{font-size:30px;font-weight:750;line-height:1.1}
.q{background:var(--card);border-left:4px solid var(--orange);border-radius:0 12px 12px 0;padding:13px 18px;margin:0 0 12px}
.q p{margin:0;font-size:16px}.qm{font-size:12.5px;color:var(--dim);margin-top:6px}
.xctl{display:flex;flex-wrap:wrap;gap:10px;align-items:center;background:var(--card);border-radius:12px;padding:14px 16px;margin:0 0 14px}
.xctl select,.xctl input{font:inherit;font-size:14px;padding:7px 10px;border:1px solid var(--hair);border-radius:8px;background:var(--paper);color:var(--ink)}
.xctl input{flex:1;min-width:180px}
.xcount{font-size:12.5px;color:var(--dim);white-space:nowrap}
.xrow{border-bottom:1px solid var(--hair);padding:12px 2px}
.xrow p{margin:0 0 6px;font-size:15px}
.xmeta{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px;color:var(--dim)}
.xtag{background:var(--card);border-radius:999px;padding:2px 9px;font-size:11.5px}
.xmore{padding:14px 2px;font-size:13px;color:var(--dim)}
details{margin:14px 0;font-size:14px}summary{cursor:pointer;color:var(--dim)}
table{border-collapse:collapse;font-size:13.5px}td,th{padding:5px 14px 5px 0;text-align:left;border-bottom:1px solid var(--hair)}th{color:var(--dim);font-weight:600}
.method{background:var(--card);border-radius:12px;padding:16px 20px;font-size:13.5px;color:var(--dim);margin:28px 0 0}
.foot{margin-top:48px;padding:24px 0 40px;border-top:1px solid var(--hair);font-size:13.5px;color:var(--dim)}
</style></head><body><div class="wrap">
<div class="mast">
<div class="brand"><span class="d">data</span><span class="n">nautix</span></div>
${n.headline ? `<p class="kicker">${esc(storyTitle(d.datasetName))}</p>` : ''}
<h1>${esc(n.headline || storyTitle(d.datasetName))}</h1>
<p class="stand">${esc(n.lede)}</p>
<p class="stamp">Generated ${esc(d.generated)} · every figure computed by the analytics engine${sampledNote ? ' · sampled' : ''}</p>
</div>
<div class="tiles">
<div class="tile"><b>${fmt(d.totalRows)}</b><span>responses in the dataset</span></div>
<div class="tile"><b>${fmt(d.substantiveBase)}</b><span>substantive written responses (the base for every theme figure)</span></div>
<div class="tile"><b>${d.themes.length}</b><span>themes mined from “${esc(d.fieldLabel)}”</span></div>
${d.overallAvgRating != null ? `<div class="tile"><b>${d.overallAvgRating}</b><span>overall average ${esc(d.ratingFieldLabel || 'rating')}</span></div>` : ''}
</div>
<section><h2>${esc(n.themesHead)}</h2>
<p class="sub">Share of the ${fmt(d.substantiveBase)} substantive responses mentioning each theme. A response can carry several.</p>
<p>${esc(n.themesIntro)}</p>
<div class="fig">${themeBarsSvg(d.themes, d.substantiveBase)}
<div class="figcap">Counts and shares from the engine's recount over ${fmt(d.analyzedRows)} rows; hover a bar for the exact figures.</div></div>
</section>
${d.overallAvgRating != null && n.ratingIntro && n.ratingHead ? `<section><h2>${esc(n.ratingHead)}</h2>
<p class="sub">Average ${esc(d.ratingFieldLabel || 'rating')} of responses mentioning each theme, against the ${d.overallAvgRating} overall.</p>
<p>${esc(n.ratingIntro)}</p>
<div class="fig">${ratingDotsSvg(d.themes, d.overallAvgRating)}
<div class="figcap">Themes with ≥30 rated mentions. Orange = below the overall average, teal = at or above.</div></div>
</section>` : ''}
${timelineSection}
${d.segments.length >= 2 && n.segmentIntro ? `<section><h2>${esc(n.segmentHead || `How it differs by ${d.segmentFieldLabel}`)}</h2>
<p class="sub">Top themes within each segment's own substantive responses.</p>
<p>${esc(n.segmentIntro)}</p>
<div class="fig"><div class="sgwrap">${segmentGrid(d)}</div></div>
</section>` : ''}
${bandsSection}
${d.quotes.length ? `<section><h2>In their words</h2>
<p class="sub">Verbatim sentences, each verified to carry the sentiment of the theme it illustrates.</p>
${quotes}</section>` : ''}
${explorerHtml(d)}
<div class="method"><b>Method.</b> ${fmt(d.totalRows)} responses; themes are AI-mined keyword models recounted over every analyzed row — the ${fmt(d.substantiveBase)} responses with substantive text form the denominator for every share shown.${sampledNote} Time and band figures use the same recount within each bucket. Quotes pass an automated check that the displayed sentence supports the point it illustrates; the explorer is an uncurated even sample.</div>
<details><summary>Data table — themes</summary><table><tr><th>Theme</th><th>Responses</th><th>% of base</th><th>Avg ${esc(d.ratingFieldLabel || 'rating')}</th></tr>${tableRows}</table></details>
<div class="foot"><span class="brand"><span class="d">data</span><span class="n">nautix</span></span> · datanautix.com · This link is time-limited and can be revoked by the publisher at any time.</div>
</div></body></html>`
}
