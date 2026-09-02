// lib/dataStory.ts
// The Data Story generator (StoryTime's narrative web evolution): turns a
// dataset's ENGINE output — recountThemes over the substantive base, the same
// numbers TextMine shows — into a self-contained, shareable narrative HTML
// page. Pure functions (payload build + render) so the route stays thin and
// the composition is unit-testable. Every displayed figure comes from the
// payload; the AI writes PROSE ONLY (route-side), never numbers of its own.
//
// Branding: Data Stories are outward-facing deliverables → Datanautix (the
// deck/report rule in CLAUDE.md), never Sentimetrx.

import { recountThemes, evenSample, type Theme, type ThemeModel, themeSetForField } from '@/lib/themeUtils'
import { isSubstantiveText } from '@/lib/datasetUtils'
import { verbatimSupports, type VerbatimPremise } from '@/lib/verbatimGuard'
import type { SchemaFieldConfig, DatasetAnalytics } from '@/lib/analyzeTypes'

export const STORY_ROW_CAP = 50_000  // no sampling under 50K (CLAUDE.md); evenSample above

export interface StoryThemeRow {
  id: string; name: string; description: string; sentiment: string
  keywords: string[]
  count: number; pct: number; ciLow?: number; ciHigh?: number
  avgRating?: number; ratingDelta?: number; ratingCount?: number
}
export interface StorySegment { label: string; substantive: number; themes: { name: string; pct: number }[] }
export interface StoryQuote { text: string; theme: string; meta: string }
export interface StoryNarrative {
  lede: string
  themesIntro: string
  ratingIntro: string | null
  segmentIntro: string | null
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
  quotes: StoryQuote[]
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
  const ratingField = pickRatingField(fields)
  const segmentField = pickSegmentField(fields.filter(f => f.field !== ratingField), analytics, totalRows)

  const rows = opts.rows.length > STORY_ROW_CAP ? evenSample(opts.rows, STORY_ROW_CAP) : opts.rows
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

  const quotes = pickQuotes(themed, substantive, fieldNames, segmentField, ratingField)

  return {
    datasetName,
    generated: new Date().toISOString().slice(0, 10),
    totalRows,
    analyzedRows: rows.length,
    substantiveBase: substantive.length,
    fieldLabel: fieldNames.join(' + '),
    overallAvgRating,
    ratingFieldLabel: ratingField,
    segmentFieldLabel: segments.length >= 2 ? segmentField : null,
    themes: themed.map(t => ({
      id: t.id, name: t.name, description: t.description, sentiment: t.sentiment,
      keywords: (t.keywords || []).slice(0, 8),
      count: t.count, pct: t.percentage, ciLow: t.ciLow, ciHigh: t.ciHigh,
      avgRating: t.avgRating, ratingDelta: t.ratingDelta, ratingCount: t.ratingCount,
    })),
    segments: segments.length >= 2 ? segments : [],
    quotes,
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

/** Deterministic fallback narrative — used when the AI call fails, and the
 *  baseline the AI version replaces. States only payload facts. */
export function deterministicNarrative(d: Omit<StoryData, 'narrative'>): StoryNarrative {
  const top = [...d.themes].sort((a, b) => b.count - a.count)[0]
  const worst = d.overallAvgRating != null
    ? [...d.themes].filter(t => t.ratingDelta != null && (t.ratingCount || 0) >= 30).sort((a, b) => (a.ratingDelta || 0) - (b.ratingDelta || 0))[0]
    : undefined
  return {
    lede: `${d.substantiveBase.toLocaleString('en-US')} of ${d.totalRows.toLocaleString('en-US')} responses carry substantive written feedback. ${d.themes.length} themes describe what they talk about.`,
    themesIntro: top ? `“${top.name}” leads the conversation, appearing in ${top.pct}% of substantive responses (${top.count.toLocaleString('en-US')} mentions).` : '',
    ratingIntro: worst && worst.ratingDelta != null
      ? `Responses mentioning “${worst.name}” average ${worst.avgRating} — ${Math.abs(worst.ratingDelta).toFixed(2)} below the ${d.overallAvgRating} overall average.`
      : null,
    segmentIntro: d.segments.length >= 2
      ? `The mix shifts by ${d.segmentFieldLabel}: each segment leads with its own dominant theme.`
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
  }
  return {
    system:
      'You write the narrative for a data story published to a client. Respond with ONLY raw JSON: ' +
      '{"lede":"...","themesIntro":"...","ratingIntro":...,"segmentIntro":...} — ratingIntro/segmentIntro are strings or null. ' +
      'HARD RULES: 2–3 sentences per field, plain confident prose, no headline-speak. ' +
      'Use ONLY numbers that appear verbatim in the provided facts — never compute, extrapolate, or invent a figure. ' +
      'Never mention data you were not given. No exclamation marks.',
    user: 'Facts:\n' + JSON.stringify(facts, null, 1) +
      '\n\nWrite: lede (what this corpus is and the single most important pattern), themesIntro (what dominates the conversation), ' +
      (d.overallAvgRating != null ? 'ratingIntro (which themes sit above/below the overall average and what that implies), ' : 'ratingIntro must be null, ') +
      (d.segments.length >= 2 ? 'segmentIntro (how the segments differ).' : 'segmentIntro must be null.'),
  }
}

export function parseNarrative(text: string, fallback: StoryNarrative): StoryNarrative {
  try {
    const m = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').match(/\{[\s\S]*\}/)
    if (!m) return fallback
    const j = JSON.parse(m[0]) as Partial<StoryNarrative>
    const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
    return {
      lede: s(j.lede) || fallback.lede,
      themesIntro: s(j.themesIntro) || fallback.themesIntro,
      ratingIntro: s(j.ratingIntro) ?? fallback.ratingIntro,
      segmentIntro: s(j.segmentIntro) ?? fallback.segmentIntro,
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

export function renderDataStory(d: StoryData): string {
  const n = d.narrative
  const quotes = d.quotes.map(q =>
    `<div class="q"><p>“${esc(q.text)}”</p><div class="qm">${esc(q.meta)}</div></div>`).join('')
  const tableRows = [...d.themes].sort((a, b) => b.count - a.count).map(t =>
    `<tr><td>${esc(t.name)}</td><td>${fmt(t.count)}</td><td>${t.pct}%</td><td>${t.avgRating ?? '—'}</td></tr>`).join('')
  const sampledNote = d.analyzedRows < d.totalRows
    ? ` Figures are computed over a deterministic ${fmt(d.analyzedRows)}-row sample of the ${fmt(d.totalRows)}-row dataset.` : ''

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.datasetName)} — Data Story</title><meta name="robots" content="noindex">
<style>
:root{--paper:#FCFCFB;--card:#F3F6F5;--ink:#1A2421;--dim:#5C6B64;--hair:rgba(26,36,33,.12);--teal:#0E7476;--orange:#E85A1A}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:17px;line-height:1.6;font-variant-numeric:tabular-nums}
.wrap{max-width:920px;margin:0 auto;padding:0 26px}p{margin:0 0 15px}
.brand{font-weight:800;font-style:italic;font-size:15px}.brand .d{color:var(--teal)}.brand .n{color:var(--orange)}
.mast{padding:52px 0 8px}h1{font-size:clamp(28px,4.2vw,46px);line-height:1.06;margin:14px 0 12px;font-weight:750;letter-spacing:-.02em}
.stand{font-size:18px;color:var(--dim);max-width:660px;margin:0 0 10px}.stamp{font-size:13.5px;color:var(--dim)}
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
.q{background:var(--card);border-left:4px solid var(--orange);border-radius:0 12px 12px 0;padding:13px 18px;margin:0 0 12px}
.q p{margin:0;font-size:16px}.qm{font-size:12.5px;color:var(--dim);margin-top:6px}
details{margin:14px 0;font-size:14px}summary{cursor:pointer;color:var(--dim)}
table{border-collapse:collapse;font-size:13.5px}td,th{padding:5px 14px 5px 0;text-align:left;border-bottom:1px solid var(--hair)}th{color:var(--dim);font-weight:600}
.method{background:var(--card);border-radius:12px;padding:16px 20px;font-size:13.5px;color:var(--dim);margin:28px 0 0}
.foot{margin-top:48px;padding:24px 0 40px;border-top:1px solid var(--hair);font-size:13.5px;color:var(--dim)}
</style></head><body><div class="wrap">
<div class="mast">
<div class="brand"><span class="d">data</span><span class="n">nautix</span></div>
<h1>${esc(d.datasetName)}: what the text says</h1>
<p class="stand">${esc(n.lede)}</p>
<p class="stamp">Generated ${esc(d.generated)} · every figure computed by the analytics engine${sampledNote ? ' · sampled' : ''}</p>
</div>
<div class="tiles">
<div class="tile"><b>${fmt(d.totalRows)}</b><span>responses in the dataset</span></div>
<div class="tile"><b>${fmt(d.substantiveBase)}</b><span>substantive written responses (the base for every theme figure)</span></div>
<div class="tile"><b>${d.themes.length}</b><span>themes mined from “${esc(d.fieldLabel)}”</span></div>
${d.overallAvgRating != null ? `<div class="tile"><b>${d.overallAvgRating}</b><span>overall average ${esc(d.ratingFieldLabel || 'rating')}</span></div>` : ''}
</div>
<section><h2>What the responses talk about</h2>
<p class="sub">Share of the ${fmt(d.substantiveBase)} substantive responses mentioning each theme. A response can carry several.</p>
<p>${esc(n.themesIntro)}</p>
<div class="fig">${themeBarsSvg(d.themes, d.substantiveBase)}
<div class="figcap">Counts and shares from the engine's recount over ${fmt(d.analyzedRows)} rows; hover a bar for the exact figures.</div></div>
</section>
${d.overallAvgRating != null && n.ratingIntro ? `<section><h2>What moves the score</h2>
<p class="sub">Average ${esc(d.ratingFieldLabel || 'rating')} of responses mentioning each theme, against the ${d.overallAvgRating} overall.</p>
<p>${esc(n.ratingIntro)}</p>
<div class="fig">${ratingDotsSvg(d.themes, d.overallAvgRating)}
<div class="figcap">Themes with ≥30 rated mentions. Orange = below the overall average, teal = at or above.</div></div>
</section>` : ''}
${d.segments.length >= 2 && n.segmentIntro ? `<section><h2>How it differs by ${esc(d.segmentFieldLabel)}</h2>
<p class="sub">Top themes within each segment's own substantive responses.</p>
<p>${esc(n.segmentIntro)}</p>
<div class="fig"><div class="sgwrap">${segmentGrid(d)}</div></div>
</section>` : ''}
${d.quotes.length ? `<section><h2>In their words</h2>
<p class="sub">Verbatim sentences, each verified to carry the sentiment of the theme it illustrates.</p>
${quotes}</section>` : ''}
<div class="method"><b>Method.</b> ${fmt(d.totalRows)} responses; themes are AI-mined keyword models recounted over every analyzed row — the ${fmt(d.substantiveBase)} responses with substantive text form the denominator for every share shown.${sampledNote} Quotes pass an automated check that the displayed sentence supports the point it illustrates.</div>
<details><summary>Data table — themes</summary><table><tr><th>Theme</th><th>Responses</th><th>% of base</th><th>Avg ${esc(d.ratingFieldLabel || 'rating')}</th></tr>${tableRows}</table></details>
<div class="foot"><span class="brand"><span class="d">data</span><span class="n">nautix</span></span> · datanautix.com · This link is time-limited and can be revoked by the publisher at any time.</div>
</div></body></html>`
}
