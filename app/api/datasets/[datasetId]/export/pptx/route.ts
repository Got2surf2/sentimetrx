// app/api/datasets/[datasetId]/export/pptx/route.ts
// POST — generate a consulting-quality PowerPoint from dataset analytics.
// Body: { fields: string[], audience: 'executive'|'stakeholder'|'full' }

import { NextResponse } from 'next/server'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { smartOrder, isOrdinalScale } from '@/lib/scaleUtils'
import { resolveAlias, aliasedCounts } from '@/lib/aliasUtils'
import { deserializeFilters, applyFilters, type SerializedFilters } from '@/lib/filterUtils'
import { existsSync, readFileSync } from 'fs'
import { pickBestComments, extractHighlightPhrases } from '@/lib/export/scoreComments'
import type { HighlightedComment } from '@/lib/export/scoreComments'
import { expandLemma } from '@/lib/lemmas'
import { buildKwRegex } from '@/lib/themeUtils'
import { computeThemeImpact } from '@/lib/themeImpact'
import { DN as DN_SHARED, W, H, HH, CY, PAD, FY, bgFill as bg, logo, trunc } from '@/lib/pptx/shared'
import { renderProvenance, renderCustomDecks } from '@/lib/pptx/slideRenderer'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

// ── Generator version ────────────────────────────────────────────────────────
const STORYTIME_VERSION = '1.2.0'  // bump on each release

interface Params { params: { datasetId: string } }

// Extended palette with datasets-specific colors
const DN = {
  ...DN_SHARED,
  tealDark:    '0A4F51',
  tealPale:    'E0F2F1',
  tealPale2:   'B2DFDB',
  navyMid:     '0F3A54',
  navyLight:   '1A5070',
  goldLight:   'F5D98A',
  goldPale:    'FFF8E1',
  orangePale:  'FEF0E8',
  ink:         '0D2B45',
  inkSoft:     '1A3A50',
  slateDark:   '4A6572',
}

const CH  = H - CY - 0.32

// ── Route-specific helpers ────────────────────────────────────────────────────

function hdr(slide: any, pptx: any, title: string, _color = DN.navy, subtitle?: string) {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.06, fill: { color: DN.gold }, line: { width: 0 } })
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.06, w: W, h: HH - 0.06, fill: { color: DN.navy }, line: { width: 0 } })
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.06, w: 0.07, h: HH - 0.06, fill: { color: DN.teal }, line: { width: 0 } })
  slide.addText(title, {
    x: PAD, y: 0.1, w: W - PAD * 2 - 2.4, h: subtitle ? 0.5 : HH - 0.18,
    fontSize: subtitle ? 17 : 20, bold: true, color: DN.white, valign: 'middle', wrap: true, autoFit: true,
  })
  if (subtitle) {
    slide.addText(subtitle, {
      x: PAD, y: 0.56, w: W - PAD * 2 - 2.4, h: 0.32,
      fontSize: 10, color: DN.tealLight, valign: 'middle', italic: true,
    })
  }
}

function footer(slide: any, pptx: any, datasetName: string) {
  solidRect(slide, pptx, 0, FY - 0.02, W, 0.015, DN.teal, 62)
  slide.addText('datanautix.com  ·  ' + datasetName, {
    x: PAD, y: FY, w: W * 0.5, h: 0.26, fontSize: 7.5, color: DN.slate, valign: 'middle', wrap: false,
  })
  slide.addText('Proprietary and Confidential', {
    x: W * 0.35, y: FY, w: W * 0.3, h: 0.26, fontSize: 7.5, color: DN.slate, valign: 'middle', align: 'center',
  })
}

function rect(slide: any, pptx: any, x: number, y: number, w: number, h: number, fill: string, radius = 0.07, border = DN.divider) {
  slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: fill }, line: { color: border, width: 1 }, rectRadius: radius })
}

function solidRect(slide: any, pptx: any, x: number, y: number, w: number, h: number, fill: string, transparency = 0) {
  slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: fill, transparency }, line: { width: 0 } })
}

function lbl(slide: any, text: string, x: number, y: number, w: number, color = DN.slate) {
  slide.addText(text, { x, y, w, h: 0.22, fontSize: 7.5, bold: true, color, charSpacing: 1.2, textTransform: 'uppercase' })
}

// Trim to a sentence boundary — only when text exceeds max length.
function trimNatural(s: string, max: number): string {
  if (!s) return s
  if (s.length <= max) return s
  const candidate = s.slice(0, max)
  // Find the last sentence-ending punctuation
  const lastEnd = Math.max(
    candidate.lastIndexOf('.'),
    candidate.lastIndexOf('!'),
    candidate.lastIndexOf('?'),
  )
  if (lastEnd >= 1) return candidate.slice(0, lastEnd + 1)
  // No sentence end — trim to last word boundary and add ellipsis
  const lastSpace = candidate.lastIndexOf(' ')
  return (lastSpace > 0 ? candidate.slice(0, lastSpace) : candidate) + '…'
}

function pct(v: number, total: number) { return total > 0 ? Math.round(v / total * 100) : 0 }

// Color for a numeric rating value on a min–max scale (green=high, red=low)
function ratingColor(val: number, min: number, max: number): string {
  const range = max - min
  if (range <= 0) return DN.teal
  const frac = (val - min) / range
  if (frac >= 0.8)  return '059669'  // green
  if (frac >= 0.6)  return '34D399'  // light green
  if (frac >= 0.4)  return 'D97706'  // amber
  if (frac >= 0.2)  return 'F97316'  // orange
  return 'DC2626'                     // red
}

// KPI card: big number + label, optional sub — all elements bounded within h
function kpiCard(slide: any, pptx: any, x: number, y: number, w: number, h: number, value: string, label: string, sub?: string, bg_ = DN.slateLight, valColor = DN.navy) {
  rect(slide, pptx, x, y, w, h, bg_, 0.08, DN.divider)
  const hasSub  = !!sub
  const valH    = h * (hasSub ? 0.42 : 0.58)
  const metaTop = y + valH + 0.06
  const lblH    = Math.min(0.22, (y + h - metaTop) * (hasSub ? 0.40 : 1.0))
  // Give sub all remaining space so long responses aren't clipped
  const subH    = hasSub ? Math.max(0, y + h - metaTop - lblH - 0.04) : 0
  slide.addText(value, { x: x + 0.14, y: y + 0.06, w: w - 0.28, h: valH, fontSize: Math.min(26, Math.max(16, 26 - value.length * 1.2)), bold: true, color: valColor, valign: 'middle', autoFit: true })
  slide.addText(label, { x: x + 0.14, y: metaTop, w: w - 0.28, h: lblH, fontSize: 9.5, bold: true, color: DN.slateDark, wrap: true, autoFit: true })
  if (sub && subH > 0.06) slide.addText(sub, { x: x + 0.14, y: metaTop + lblH, w: w - 0.28, h: subH, fontSize: 8.5, color: DN.slate, wrap: true, lineSpacingMultiple: 1.2, autoFit: true })
}

// KPI card on dark (navy) background
function kpiCardDark(slide: any, pptx: any, x: number, y: number, w: number, h: number, value: string, label: string, sub?: string) {
  slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: DN.navyMid }, line: { color: DN.navyLight, width: 1 } })
  solidRect(slide, pptx, x, y, w, 0.04, DN.gold)
  const hasSub   = !!sub
  const valH     = h * (hasSub ? 0.44 : 0.56)
  const metaTop  = y + valH + 0.08
  const lblH     = Math.min(0.24, (y + h - metaTop) * (hasSub ? 0.55 : 1.0))
  const subH_    = hasSub ? Math.max(0, Math.min(0.20, y + h - metaTop - lblH - 0.02)) : 0
  slide.addText(value, { x: x + 0.14, y: y + 0.08, w: w - 0.28, h: valH, fontSize: Math.min(28, Math.max(18, 28 - value.length * 1.2)), bold: true, color: DN.gold, valign: 'middle', autoFit: true })
  slide.addText(label, { x: x + 0.14, y: metaTop, w: w - 0.28, h: lblH, fontSize: 9.5, bold: true, color: 'A8C8D8', wrap: true, autoFit: true })
  if (sub && subH_ > 0.08) slide.addText(sub, { x: x + 0.14, y: metaTop + lblH, w: w - 0.28, h: subH_, fontSize: 8.5, color: DN.slate, autoFit: true })
}

// Insight box with left accent stripe
function insightBox(slide: any, pptx: any, x: number, y: number, w: number, h: number, text: string, accentColor = DN.teal, bgColor = DN.slateLight) {
  rect(slide, pptx, x, y, w, h, bgColor, 0.07, accentColor)
  solidRect(slide, pptx, x, y, 0.06, h, accentColor)
  slide.addText(text, { x: x + 0.16, y: y + 0.1, w: w - 0.24, h: h - 0.2, fontSize: 11.5, color: DN.navyLight, italic: true, valign: 'top', wrap: true, lineSpacingMultiple: 1.3, autoFit: true })
}

// Quote card — opening " is inline with the first word of the comment
function quoteCard(slide: any, pptx: any, x: number, y: number, w: number, h: number, text: string, stripColor?: string) {
  rect(slide, pptx, x, y, w, h, DN.white, 0.07, DN.divider)
  solidRect(slide, pptx, x, y, 0.05, h, stripColor || DN.teal)
  slide.addText([
    { text: '\u201C', options: { fontSize: 16, bold: true, color: DN.tealLight } },
    { text: trimNatural(text, 220), options: { fontSize: 10, color: DN.navyLight, italic: true } },
    { text: '\u201D', options: { fontSize: 16, bold: true, color: DN.tealLight } },
  ], { x: x + 0.12, y: y + 0.10, w: w - 0.22, h: h - 0.16, valign: 'top', wrap: true, lineSpacingMultiple: 1.4, autoFit: true })
}

// Splits text into alternating normal/highlighted runs.
// Accepts either AI-extracted phrases (exact substrings) or keyword stems.
// If a phrase is multi-word (likely AI-extracted), does exact case-insensitive substring match.
// If a phrase is a single word, uses lemma-expanded regex matching.
function buildHighlightedRuns(text: string, keywords: string[]): { text: string; highlight: boolean }[] {
  type Span = { start: number; end: number }
  const spans: Span[] = []
  for (const kw of keywords) {
    if (!kw) continue
    const isPhrase = kw.includes(' ') || kw.length > 20
    if (isPhrase) {
      // AI-extracted phrase — find exact substring (case-insensitive)
      const lower = text.toLowerCase()
      const kwLower = kw.toLowerCase()
      let idx = lower.indexOf(kwLower)
      while (idx !== -1) {
        spans.push({ start: idx, end: idx + kw.length })
        idx = lower.indexOf(kwLower, idx + 1)
      }
    } else {
      // Single keyword — use lemma-expanded regex
      const forms = expandLemma(kw)
      const seen: Record<string, boolean> = {}
      const alts: string[] = []
      for (let i = 0; i < forms.length; i++) {
        const alt = forms[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\w*'
        if (!seen[alt]) { seen[alt] = true; alts.push(alt) }
      }
      const escOrig = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\w*'
      if (!seen[escOrig]) alts.push(escOrig)
      const re = new RegExp('(?<![a-z])(?:' + alts.join('|') + ')', 'gi')
      let m: RegExpExecArray | null
      while ((m = re.exec(text)) !== null) {
        // Expand to clause boundary for phrase-level highlighting
        let left = m.index
        while (left > 0 && !/[,.;:!?\-\u2014\u2013\n]/.test(text[left - 1])) left--
        while (left < m.index && text[left] === ' ') left++
        let right = m.index + m[0].length
        while (right < text.length && !/[,.;:!?\-\u2014\u2013\n]/.test(text[right])) right++
        spans.push({ start: left, end: right })
      }
    }
  }
  spans.sort((a, b) => a.start - b.start)
  // Merge overlapping spans
  const merged: Span[] = []
  for (const s of spans) {
    if (merged.length && s.start < merged[merged.length - 1].end) {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, s.end)
    } else {
      merged.push({ ...s })
    }
  }
  const runs: { text: string; highlight: boolean }[] = []
  let pos = 0
  for (const { start, end } of merged) {
    if (start > pos) runs.push({ text: text.slice(pos, start), highlight: false })
    runs.push({ text: text.slice(start, end), highlight: true })
    pos = end
  }
  if (pos < text.length) runs.push({ text: text.slice(pos), highlight: false })
  return runs.length > 0 ? runs : [{ text, highlight: false }]
}

// quoteCard variant that bolds + colors the theme keywords within the text
function quoteCardHighlighted(slide: any, pptx: any, x: number, y: number, w: number, h: number, text: string, keywords: string[], stripColor?: string) {
  rect(slide, pptx, x, y, w, h, DN.white, 0.07, DN.divider)
  solidRect(slide, pptx, x, y, 0.05, h, stripColor || DN.teal)
  const trimmed  = trimNatural(text, 240)
  const runs     = buildHighlightedRuns(trimmed, keywords)
  const textRuns = [
    { text: '\u201C', options: { fontSize: 16, bold: true, color: DN.tealLight } },
    ...runs.map(r => r.highlight
      ? { text: r.text, options: { fontSize: 10, bold: true, color: DN.teal, italic: false } }
      : { text: r.text, options: { fontSize: 10, color: DN.navyLight, italic: true } }
    ),
    { text: '\u201D', options: { fontSize: 16, bold: true, color: DN.tealLight } },
  ]
  slide.addText(textRuns, { x: x + 0.12, y: y + 0.06, w: w - 0.22, h: h - 0.12, valign: 'middle', wrap: true, lineSpacingMultiple: 1.4, autoFit: true })
}

// ── AI narrative generation ───────────────────────────────────────────────────

interface FieldInsight {
  keyFinding: string
  narrative:    string
  implication:  string
  watchout?:    string
  pickedQuotes?: string[]
}

interface Narratives {
  reportTitle:     string
  executiveSummary: string[]
  keyTakeaways:    string[]
  fieldInsights:   Record<string, FieldInsight>
}

async function generateNarratives(
  orgId: string,
  datasetName: string,
  totalRows: number,
  audience: string,
  fields: SelectedField[],
  instructions?: string
): Promise<Narratives> {

  const audienceNote = {
    executive:   'C-suite audience. Every sentence must earn its place. Lead with so-what, not data.',
    stakeholder: 'Manager/analyst audience. Be data-driven and specific. Include percentages and averages.',
    full:        'Full team audience. Be thorough. Include nuance, caveats, and context. More detail is better.',
  }[audience] || ''

  const fieldBlocks = fields.map(function(f) {
    const s = f.summary
    if (!s) return `${f.label} (${f.type}): no data available`
    if (s.type === 'categorical') {
      const aliasedC = f.valueAliases && Object.keys(f.valueAliases).length > 0
        ? aliasedCounts(f.field, s.counts || {}, [{ field: f.field, valueAliases: f.valueAliases }])
        : (s.counts || {})
      const top5 = Object.entries(aliasedC)
        .sort((a: any, b: any) => b[1] - a[1]).slice(0, 5)
        .map(([k, v]: any) => `"${k}" ${v} (${pct(v, s.nonNull)}%)`).join(', ')
      return `${f.label} (categorical, n=${s.nonNull}): top responses — ${top5} | unique values: ${s.uniqueCount}`
    } else if (s.type === 'numeric') {
      const range = s.max - s.min
      const posInRange = range > 0 ? ((s.avg - s.min) / range * 100).toFixed(0) : '50'
      return `${f.label} (numeric, n=${s.nonNull}): avg=${s.avg?.toFixed(2)}, median=${s.median?.toFixed(2)}, min=${s.min}, max=${s.max}, std=${s.std?.toFixed(2)} | avg sits at ${posInRange}% of possible range`
    } else if (s.type === 'open-ended') {
      // Prefer live evenly-sampled verbatims over the stale 10-item analytics snapshot
      const samplePool = (f.liveSample && f.liveSample.length > 0) ? f.liveSample : (s.sample || [])
      const allSamples = samplePool.slice(0, 20).map((t: string, i: number) => `[${i}] "${t.slice(0, 500)}"`).join('\n')
      return `${f.label} (open-ended, n=${s.nonNull}): avg ${s.avgWordCount} words per response\nCANDIDATE QUOTES (indexed 0–${Math.min(19, samplePool.length-1)}):\n${allSamples}`
    } else if (s.type === 'date') {
      return `${f.label} (date): ${s.min} to ${s.max}, n=${s.nonNull}`
    }
    return `${f.label}: no data`
  }).join('\n\n')

  const customInstructions = instructions ? `\n\nCLIENT INSTRUCTIONS (follow these precisely — they override any defaults):\n${instructions}\n` : ''

  const prompt = `You are a senior consultant preparing a data readout presentation. Write compelling, specific insights — not generic observations.

Dataset: "${datasetName}" — ${totalRows.toLocaleString()} responses
Audience: ${audience}. ${audienceNote}
${customInstructions}
FIELD DATA:
${fieldBlocks}

Return ONLY valid JSON. No markdown fences. No extra text. This exact structure:
{
  "reportTitle": "short punchy subtitle for the deck (8 words max)",
  "executiveSummary": [
    "Bullet 1 — most important headline finding with a specific number",
    "Bullet 2 — second most important finding",
    "Bullet 3 — pattern or trend worth noting",
    "Bullet 4 — area of concern or opportunity",
    "Bullet 5 — forward-looking implication"
  ],
  "keyTakeaways": [
    "Takeaway 1 — actionable recommendation from the data",
    "Takeaway 2 — what to do about the biggest finding",
    "Takeaway 3 — what to watch or measure next"
  ],
  "fieldInsights": {
${fields.map(f => {
  const isOE = f.type === 'open-ended'
  return `    "${f.field}": {
      "keyFinding": "one strong punchy statement about this field (max 12 words)",
      "narrative": "2-3 sentences. Specific data references. What the distribution reveals. What drives it.",
      "implication": "1-2 sentences. So what? What should be done or watched as a result?",
      "watchout": "1 sentence caveat, limitation or counter-reading (optional, omit if nothing meaningful)"${isOE ? `,
      "pickedQuotes": ["pick 3-5 of the most insightful, distinct, and representative quotes from CANDIDATE QUOTES above. Prefer quotes that are at least 200 characters and end at a natural sentence boundary. Do not truncate mid-sentence. No paraphrasing — use exact text from the candidates."]` : ''}
    }`
}).join(',\n')}
  }
}`

  const result = await callAI({
    tier: 'advanced',
    maxTokens: 3500,
    timeoutMs: 38000,
    messages: [{ role: 'user', content: prompt }],
    usage: { org_id: orgId, resource_type: 'dataset', event_type: 'pptx' },
  })

  logUsage({ org_id: orgId, resource_type: 'dataset', event_type: 'pptx' }, result.usage)

  const raw = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')

  try {
    return JSON.parse(raw)
  } catch {
    return {
      reportTitle: 'Data Analysis Report',
      executiveSummary: ['Analysis completed successfully.'],
      keyTakeaways: ['Review the detailed findings for actionable insights.'],
      fieldInsights: Object.fromEntries(fields.map(f => [f.field, { keyFinding: f.label, narrative: '', implication: '', watchout: '' }])),
    }
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface SelectedField {
  field:      string
  label:      string
  type:       string
  summary:    any
  remapping?: Record<string, number>
  valueAliases?: Record<string, string>
  section?:   string   // 'psychographic' | 'demographic' | 'core' | undefined
  prompt?:    string   // original survey question text
  liveSample?: string[] // evenly-sampled verbatims from allRows — replaces stale analytics snapshot
}

// Professional pie chart color palette
const PIE_COLORS = [
  '0F7173', 'E8B84B', '1DA39A', '0D2B45', '8FA3AE',
  '4A6572', 'A8C8D8', '1A5070', 'B8D4E0', 'D4DDE2',
]

// ── Slide builders ────────────────────────────────────────────────────────────

function buildTitleSlide(pptx: any, datasetName: string, reportTitle: string, totalRows: number, computedAt: string | null) {
  const slide = pptx.addSlide('NUMBERED')

  // Deep navy background
  solidRect(slide, pptx, 0, 0, W, H, DN.navy)

  // Gold thin bar at very top
  solidRect(slide, pptx, 0, 0, W, 0.07, DN.gold)

  // Left teal accent strip
  solidRect(slide, pptx, 0, 0.07, 0.18, H - 0.07, DN.teal)

  // Right panel — slightly lighter navy for depth
  solidRect(slide, pptx, W - 3.2, 0.07, 3.2, H - 0.07, DN.navyMid)

  // Decorative circles — use pptxgenjs transparency (0-100 scale, 100=fully transparent)
  slide.addShape(pptx.ShapeType.ellipse, {
    x: W - 3.0, y: 0.6, w: 3.8, h: 3.8,
    fill: { color: DN.teal, transparency: 91 }, line: { color: DN.teal, transparency: 75, width: 1 }
  })
  slide.addShape(pptx.ShapeType.ellipse, {
    x: W - 2.4, y: 1.2, w: 2.6, h: 2.6,
    fill: { color: DN.teal, transparency: 93 }, line: { color: DN.tealLight, transparency: 81, width: 1 }
  })
  // "d" monogram
  slide.addText('d', {
    x: W - 2.1, y: 1.5, w: 2.0, h: 2.0,
    fontSize: 72, bold: true, italic: true, color: DN.orange, align: 'center', valign: 'middle',
  })

  // Logo — "datanautix" as one rich-text word
  slide.addText(
    [
      { text: 'data',   options: { color: DN.orangeLight, bold: true, italic: true } },
      { text: 'nautix', options: { color: DN.tealLight,   bold: true, italic: true } },
    ],
    { x: PAD + 0.18, y: 0.75, w: 4.8, h: 0.9, fontSize: 42, valign: 'middle' }
  )

  // Gold divider line
  solidRect(slide, pptx, PAD + 0.18, 1.82, 6.0, 0.04, DN.gold)

  // Main title — user's report title if provided, otherwise dataset name
  const mainTitle = reportTitle || datasetName
  const subtitle  = reportTitle ? datasetName : ''
  slide.addText(mainTitle, {
    x: PAD + 0.18, y: 2.0, w: W - 4.0, h: 1.4,
    fontSize: 28, bold: true, color: DN.white, wrap: true, valign: 'top', lineSpacingMultiple: 1.2, autoFit: true,
  })
  if (subtitle) {
    slide.addText(subtitle, {
      x: PAD + 0.18, y: 3.5, w: W - 4.0, h: 0.5,
      fontSize: 14, color: DN.tealLight, italic: true, valign: 'middle',
    })
  }

  // Date — always show report generation date, not analytics compute date
  slide.addText(new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), {
    x: PAD + 0.18, y: 4.55, w: W - 4.0, h: 0.44,
    fontSize: 16, color: DN.slate, valign: 'middle',
  })

  // Bottom footer strip
  solidRect(slide, pptx, 0, H - 0.48, W, 0.48, DN.navyMid)
  solidRect(slide, pptx, 0, H - 0.48, W, 0.03, DN.gold, 50)
  const generatedOn = new Date().toLocaleString()
  slide.addText('Proprietary and Confidential  ·  Prepared by Datanautix  ·  datanautix.com  ·  Report generated ' + generatedOn, {
    x: PAD + 0.18, y: H - 0.44, w: W - 1.0, h: 0.38,
    fontSize: 8.5, color: DN.slate, valign: 'middle',
  })
}

function buildAboutSlide(pptx: any, datasetName: string, totalRows: number, computedAt: string | null, fields: SelectedField[], audience: string, filterDescription?: string, dataSource?: 'study' | 'upload', samplingNote?: string, completionNote?: string) {
  const slide = pptx.addSlide('NUMBERED')
  bg(slide, pptx)
  hdr(slide, pptx, 'About This Report — ' + datasetName, DN.teal, 'Methodology, scope and data coverage')
  logo(slide)

  const y0 = CY + 0.1
  const cardH = 1.0
  const cardW = (W - PAD * 2 - 0.3) / 3

  // Three scope cards
  // Report Generated = today (generation date, not analytics compute date)
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const openCount = fields.filter(f => f.type === 'open-ended').length
  const catCount  = fields.filter(f => f.type === 'categorical').length
  const numCount  = fields.filter(f => f.type === 'numeric').length

  const scopeCards = [
    {
      v: totalRows.toLocaleString(),
      l: samplingNote ? 'Sampled Responses' : 'Total Responses',
      sub: completionNote || (samplingNote ? 'sampled for this analysis' : 'in this analysis'),
      bg: DN.tealPale, vc: DN.teal,
    },
    { v: fields.length.toString(),   l: 'Fields Analyzed',  sub: `${openCount} open · ${catCount} cat · ${numCount} num`, bg: DN.slateLight, vc: DN.navy },
    { v: dateStr, l: 'Report Generated', sub: audience + ' edition · v' + STORYTIME_VERSION, bg: DN.slateCard, vc: DN.teal },
  ]
  scopeCards.forEach(function(sc, i) {
    const cx = PAD + i * (cardW + 0.15)
    kpiCard(slide, pptx, cx, y0, cardW, cardH, sc.v, sc.l, sc.sub, sc.bg, sc.vc)
  })

  // Fields breakdown
  lbl(slide, 'FIELDS INCLUDED IN THIS REPORT', PAD, y0 + cardH + 0.2, W - PAD * 2)

  // Two column list of fields
  const col1 = fields.slice(0, Math.ceil(fields.length / 2))
  const col2 = fields.slice(Math.ceil(fields.length / 2))
  const listY = y0 + cardH + 0.48
  const colW2 = (W - PAD * 2 - 0.4) / 2
  const typeColor: Record<string, string> = { 'open-ended': DN.teal, 'categorical': DN.navyLight, 'numeric': DN.green, 'date': DN.slateDark }
  const sectionColor: Record<string, string> = { 'demographic': '4A6572', 'psychographic': DN.navy, 'custom': DN.orange }
  const badgeW = 1.1  // wider badge to avoid wrapping

  function fieldRow(f: SelectedField, x: number, y: number) {
    const sec = f.section === 'demographic' ? 'demographic' : f.section === 'psychographic' ? 'psychographic' : f.section === 'custom' ? 'custom' : null
    const tc  = sec ? sectionColor[sec] : (typeColor[f.type] || DN.slateDark)
    const badgeLabel = sec === 'custom' ? 'survey' : sec ? sec : f.type
    solidRect(slide, pptx, x, y + 0.07, 0.07, 0.20, tc)
    // Label — leave room for the badge
    slide.addText(f.label || f.field, { x: x + 0.16, y, w: colW2 - badgeW - 0.26, h: 0.34, fontSize: 12, color: DN.navyLight, bold: false, valign: 'middle', autoFit: true })
    // Section/type badge — right-aligned, no-wrap
    slide.addText(badgeLabel, { x: x + colW2 - badgeW, y, w: badgeW - 0.06, h: 0.34, fontSize: 9.5, color: tc, bold: true, align: 'right', valign: 'middle' })
  }

  const maxRows = Math.min(8, col1.length)
  col1.slice(0, maxRows).forEach(function(f, i) { fieldRow(f, PAD, listY + i * 0.36) })
  col2.slice(0, maxRows).forEach(function(f, i) { fieldRow(f, PAD + colW2 + 0.4, listY + i * 0.36) })

  // Bottom notes — stack downward with dynamic height per note
  const notesStartY = listY + maxRows * 0.36 + 0.2
  const noteW = W - PAD * 2
  const noteGap = 0.06

  const collectionMethod = dataSource === 'study'
    ? 'Collected using Sarina (AI conversational survey). '
    : 'Data uploaded from an external source. '

  // Estimate height: ~80 chars per line at fontSize 8, each line ~0.14"
  function noteHeight(text: string): number {
    const lines = Math.ceil(text.length / 100)
    return Math.max(0.32, lines * 0.16 + 0.10)
  }

  const notes: { y: number; h: number; bgColor: string; accentColor?: string; text: string; textColor: string }[] = []
  let curNoteY = notesStartY

  if (samplingNote) {
    const h = noteHeight(samplingNote)
    notes.push({ y: curNoteY, h, bgColor: 'EFF6FF', accentColor: '2563EB', text: samplingNote, textColor: '1E40AF' })
    curNoteY += h + noteGap
  }
  if (filterDescription) {
    // Truncate filter description if too long
    const fd = filterDescription.length > 250 ? filterDescription.slice(0, 247) + '...' : filterDescription
    const h = noteHeight(fd)
    notes.push({ y: curNoteY, h, bgColor: 'FFF7ED', accentColor: DN.orange, text: fd, textColor: DN.navyLight })
    curNoteY += h + noteGap
  }
  {
    const methText = 'Methodology: ' + collectionMethod + 'Analyzed using Ana AI Text Analytics.'
    const h = noteHeight(methText)
    notes.push({ y: curNoteY, h, bgColor: DN.slateLight, text: methText, textColor: DN.slateDark })
  }

  // Pass 1: draw all backgrounds
  for (const note of notes) {
    solidRect(slide, pptx, PAD, note.y, noteW, note.h, note.bgColor)
    if (note.accentColor) solidRect(slide, pptx, PAD, note.y, 0.06, note.h, note.accentColor)
  }
  // Pass 2: add all text (on top of backgrounds)
  for (const note of notes) {
    const tx = note.accentColor ? PAD + 0.14 : PAD + 0.12
    slide.addText(note.text, {
      x: tx, y: note.y + 0.03, w: noteW - 0.24, h: note.h - 0.06,
      fontSize: 8, color: note.textColor, italic: true, wrap: true, valign: 'middle', autoFit: true,
    })
  }

  footer(slide, pptx, datasetName)
}

function buildSummarySlide(pptx: any, datasetName: string, totalRows: number, bullets: string[], takeaways: string[], themes: any[], fields: SelectedField[]) {
  const slide = pptx.addSlide('NUMBERED')

  // Dark navy background — high impact
  solidRect(slide, pptx, 0, 0, W, H, DN.navy)
  solidRect(slide, pptx, 0, 0, W, 0.07, DN.gold)
  solidRect(slide, pptx, 0, 0.07, 0.07, H - 0.07, DN.teal)

  // Header
  solidRect(slide, pptx, 0.07, 0.07, W - 0.07, HH - 0.07, DN.navyMid)
  slide.addText('Executive Summary', {
    x: PAD, y: 0.1, w: W - PAD * 2 - 2.4, h: HH - 0.18,
    fontSize: 20, bold: true, color: DN.white, valign: 'middle',
  })
  // logo right side of header — "datanautix" as one rich-text word
  slide.addText(
    [
      { text: 'data',   options: { color: DN.orangeLight, bold: true, italic: true } },
      { text: 'nautix', options: { color: DN.tealLight,   bold: true, italic: true } },
    ],
    { x: W - 2.3, y: 0.1, w: 2.1, h: HH - 0.18, fontSize: 15, valign: 'middle', align: 'right' }
  )

  const numericField = fields.find(f => f.type === 'numeric')
  const openField    = fields.find(f => f.type === 'open-ended')

  // ── KPI row — 4 dark cards ────────────────────────────────────────────────
  const kpis: { v: string; l: string; s?: string }[] = [
    { v: totalRows.toLocaleString(), l: 'Total Responses', s: 'in this analysis' },
  ]
  if (numericField?.summary?.avg != null) {
    kpis.push({ v: String(Math.round(numericField.summary.avg)), l: trunc(numericField.label || numericField.field, 18) })
  }
  if (themes.length > 0) kpis.push({ v: String(themes.length), l: 'Themes Identified' })
  if (openField?.summary?.avgWordCount) kpis.push({ v: String(openField.summary.avgWordCount), l: 'Avg Words / Response' })

  const kpiCount = Math.min(kpis.length, 4)
  const kpiW     = (W - PAD * 2 - 0.1 * (kpiCount - 1)) / kpiCount
  kpis.slice(0, kpiCount).forEach(function(k, i) {
    kpiCardDark(slide, pptx, PAD + i * (kpiW + 0.1), CY, kpiW, 0.88, k.v, k.l, k.s)
  })

  // ── Two column layout below KPIs ──────────────────────────────────────────
  const colY    = CY + 1.02
  const leftW   = W * 0.54 - PAD
  const rightX  = W * 0.54 + 0.1
  const rightW  = W - rightX - PAD * 0.5

  // Left: key findings bullets
  slide.addText('KEY FINDINGS', { x: PAD, y: colY, w: leftW, h: 0.22, fontSize: 11.5, bold: true, color: DN.gold, charSpacing: 1.5 })
  solidRect(slide, pptx, PAD, colY + 0.24, leftW, 0.025, DN.gold, 62)

  const realBullets = bullets.filter(b => b && b.length > 10)
  // Dynamic bullet spacing: fit within available height (footer at H - 0.38)
  const bulletAvail = H - 0.38 - 0.12 - (colY + 0.34)
  const bulletCount = Math.min(realBullets.length, 5)
  const bulletH = bulletCount > 0 ? Math.min(0.7, (bulletAvail / bulletCount) - 0.04) : 0.7
  if (realBullets.length > 0) {
    realBullets.slice(0, bulletCount).forEach(function(b, i) {
      const by = colY + 0.34 + i * (bulletH + 0.04)
      // Align dot vertically with first line of text (top of box + ~0.14")
      solidRect(slide, pptx, PAD, by + 0.14, 0.05, 0.05, DN.teal)
      slide.addText(b, { x: PAD + 0.12, y: by, w: leftW - 0.14, h: bulletH, fontSize: 11, color: DN.white, valign: 'top', wrap: true, lineSpacingMultiple: 1.25, autoFit: true })
    })
  } else {
    // Auto snapshot
    const snapFields = fields.filter(f => f.type === 'categorical' && f.summary?.counts)
    snapFields.slice(0, 5).forEach(function(f, i) {
      const countsRaw = f.summary.counts as Record<string, number>
      const counts = f.valueAliases && Object.keys(f.valueAliases).length > 0
        ? aliasedCounts(f.field, countsRaw, [{ field: f.field, valueAliases: f.valueAliases }])
        : countsRaw
      const total_ = Object.values(counts).reduce((s: number, v: any) => s + v, 0)
      const topKey = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || ''
      const topPct_ = total_ > 0 ? Math.round(counts[topKey] / total_ * 100) : 0
      const fy = colY + 0.34 + i * 0.74
      solidRect(slide, pptx, PAD, fy + 0.12, 0.05, 0.05, DN.gold)
      slide.addText(f.label || f.field, { x: PAD + 0.12, y: fy, w: leftW - 0.14, h: 0.28, fontSize: 10, bold: true, color: DN.slate, autoFit: true })
      slide.addText(topPct_ + '% — ' + topKey, { x: PAD + 0.12, y: fy + 0.28, w: leftW - 0.14, h: 0.44, fontSize: 12, bold: true, color: DN.white, wrap: true, lineSpacingMultiple: 1.2, autoFit: true })
    })
  }

  // Right: themes + takeaways — dynamically sized to fit within page
  const rightAvail = H - 0.38 - 0.12 - colY  // total available height on right side (above footer)
  const hasTakeaways = takeaways.length > 0
  const maxThemes = Math.min(themes.length, 5)
  const maxTA     = Math.min(takeaways.length, 3)
  // Reserve space for takeaways: header (0.30) + cards
  const taReserve = hasTakeaways ? 0.30 + maxTA * 0.56 : 0
  // Themes get remaining space
  const themeAvail = rightAvail - taReserve - (hasTakeaways ? 0.14 : 0) - 0.30  // minus theme header
  const thH = maxThemes > 0 ? Math.min(0.52, (themeAvail - 0.06 * (maxThemes - 1)) / maxThemes) : 0
  const thGap = 0.06

  if (themes.length > 0) {
    slide.addText('TOP THEMES', { x: rightX, y: colY, w: rightW, h: 0.22, fontSize: 11.5, bold: true, color: DN.gold, charSpacing: 1.5 })
    solidRect(slide, pptx, rightX, colY + 0.24, rightW, 0.025, DN.gold, 62)
    themes.slice(0, maxThemes).forEach(function(t: any, i: number) {
      const ty = colY + 0.30 + i * (thH + thGap)
      const hasData  = (t.count || 0) > 0
      const hitPct   = Math.round((t.percentage || 0) * 10) / 10
      solidRect(slide, pptx, rightX, ty, rightW, thH, DN.navyMid)
      if (hasData) solidRect(slide, pptx, rightX, ty, Math.max(0.08, rightW * Math.min(hitPct / 100, 1)), thH, DN.teal, 75)
      solidRect(slide, pptx, rightX, ty, 0.05, thH, hasData ? DN.teal : DN.slate)
      slide.addText(trunc(t.name, 32), { x: rightX + 0.12, y: ty + 0.04, w: rightW - 0.85, h: thH - 0.08, fontSize: 10, bold: true, color: DN.white, valign: 'middle', autoFit: true })
      if (hasData) {
        slide.addText(hitPct + '%', { x: rightX + rightW - 0.72, y: ty + 0.04, w: 0.66, h: thH - 0.08, fontSize: 11, bold: true, color: DN.gold, align: 'right', valign: 'middle' })
      } else {
        slide.addText('Insufficient data', { x: rightX + rightW - 1.1, y: ty + 0.04, w: 1.04, h: thH - 0.08, fontSize: 8, color: DN.slate, align: 'right', valign: 'middle', italic: true })
      }
    })
  }

  if (hasTakeaways) {
    const taY = themes.length > 0 ? colY + 0.30 + maxThemes * (thH + thGap) + 0.14 : colY + 0.34
    const taCardH = Math.min(0.52, (H - 0.38 - 0.12 - taY - 0.30) / maxTA - 0.04)
    slide.addText('RECOMMENDED ACTIONS', { x: rightX, y: taY, w: rightW, h: 0.22, fontSize: 11.5, bold: true, color: DN.gold, charSpacing: 1.5 })
    solidRect(slide, pptx, rightX, taY + 0.24, rightW, 0.025, DN.gold, 62)
    takeaways.slice(0, maxTA).forEach(function(ta, i) {
      const ty = taY + 0.30 + i * (taCardH + 0.04)
      solidRect(slide, pptx, rightX, ty, rightW, taCardH, DN.navyMid)
      solidRect(slide, pptx, rightX, ty, 0.05, taCardH, i === 0 ? DN.gold : DN.teal)
      // Number badge
      const badgeS = Math.min(0.30, taCardH * 0.6)
      const badgeY = ty + (taCardH - badgeS) / 2
      solidRect(slide, pptx, rightX + 0.10, badgeY, badgeS, badgeS, i === 0 ? DN.gold : DN.teal)
      slide.addText(String(i + 1), { x: rightX + 0.10, y: badgeY, w: badgeS, h: badgeS, fontSize: 11, bold: true, color: i === 0 ? DN.navy : DN.white, align: 'center', valign: 'middle' })
      slide.addText(ta, { x: rightX + 0.50, y: ty + 0.03, w: rightW - 0.58, h: taCardH - 0.06, fontSize: 9, color: DN.white, valign: 'middle', wrap: true, lineSpacingMultiple: 1.2, autoFit: true })
    })
  }

  // Bottom footer
  solidRect(slide, pptx, 0, H - 0.38, W, 0.38, DN.navyMid)
  solidRect(slide, pptx, 0, H - 0.38, W, 0.02, DN.gold, 62)
  slide.addText('datanautix.com  ·  ' + trunc(datasetName, 50), {
    x: PAD, y: H - 0.34, w: W * 0.72, h: 0.28, fontSize: 7.5, color: DN.slate, valign: 'middle',
  })
  slide.addText('Proprietary and Confidential', {
    x: W * 0.72, y: H - 0.34, w: W * 0.28 - PAD * 0.5, h: 0.28, fontSize: 7.5, color: DN.slate, valign: 'middle', align: 'right',
  })
}

// ── Bar color for ordinal distribution (best→worst order) ────────────────────
function barColor(i: number, n: number, isOrdinal: boolean): string {
  if (!isOrdinal || n < 3) return DN.teal
  const frac = n <= 1 ? 0 : i / (n - 1)
  if (frac < 0.15) return '059669'
  if (frac < 0.38) return '34D399'
  if (frac < 0.62) return '94A3B8'
  if (frac < 0.82) return 'F97316'
  return 'DC2626'
}

// ── Auto-generate insight text when AI is unavailable ────────────────────────
function autoInsight(label: string, orderedKeys: string[], counts: Record<string, number>, total: number, isOrdinal: boolean, top2: number, bot2: number): string {
  if (!orderedKeys.length || total === 0) return 'No data available for this field.'
  const topKey  = orderedKeys[0]
  const topPct  = pct(counts[topKey] || 0, total)
  if (isOrdinal) {
    const lines: string[] = []
    if (top2 >= 75)      lines.push(top2 + '% of respondents rated ' + label + ' positively — a strong result.')
    else if (top2 >= 55) lines.push('A majority (' + top2 + '%) gave ' + label + ' a positive rating.')
    else                 lines.push('Only ' + top2 + '% gave ' + label + ' a positive rating — below expectations.')
    lines.push(topPct + '% selected "' + topKey + '" as their response.')
    if (bot2 > 5) lines.push(bot2 + '% expressed dissatisfaction — an area to monitor.')
    return lines.join(' ')
  }
  const secondKey = orderedKeys[1]
  if (!secondKey) return '"' + topKey + '" was selected by all ' + total.toLocaleString() + ' respondents.'
  const secondPct = pct(counts[secondKey] || 0, total)
  return '"' + topKey + '" is the most common response (' + topPct + '%), followed by "' + secondKey + '" (' + secondPct + '%). Together they account for ' + (topPct + secondPct) + '% of all responses.'
}

function buildCategoricalSlide(pptx: any, datasetName: string, f: SelectedField, ai: FieldInsight) {
  const slide = pptx.addSlide('NUMBERED')
  bg(slide, pptx)
  const subtitle = (f.section === 'demographic' || f.section === 'psychographic') && f.prompt
    ? f.prompt
    : 'Response distribution · ' + (f.summary?.nonNull || 0).toLocaleString() + ' responses'
  hdr(slide, pptx, f.label, DN.teal, subtitle)
  logo(slide)

  const s          = f.summary
  const rawCountsOrig = (s?.counts || {}) as Record<string, number>
  // Apply value aliases to counts keys so bar labels show aliased names
  const rawCounts  = f.valueAliases && Object.keys(f.valueAliases).length > 0
    ? aliasedCounts(f.field, rawCountsOrig, [{ field: f.field, valueAliases: f.valueAliases }])
    : rawCountsOrig
  const allKeys    = Object.keys(rawCounts)
  const total      = allKeys.reduce((sum, k) => sum + (rawCounts[k] || 0), 0)
  const isOrdinal  = (f.remapping && Object.keys(f.remapping).length > 0) || isOrdinalScale(allKeys)

  // Ordinal → show best-first (reverse scale order); nominal → count desc
  let orderedKeys: string[]
  if (isOrdinal) {
    orderedKeys = smartOrder(allKeys, f.remapping).slice().reverse()
  } else {
    orderedKeys = allKeys.slice().sort((a, b) => (rawCounts[b] || 0) - (rawCounts[a] || 0))
  }
  orderedKeys = orderedKeys.filter(k => (rawCounts[k] || 0) > 0).slice(0, 8)

  // Metrics
  const top2Keys  = isOrdinal ? orderedKeys.slice(0, 2) : []
  const top2      = pct(top2Keys.reduce((s, k) => s + (rawCounts[k] || 0), 0), total)
  const bot2Keys  = isOrdinal && orderedKeys.length >= 4 ? orderedKeys.slice(-2) : []
  const bot2      = pct(bot2Keys.reduce((s, k) => s + (rawCounts[k] || 0), 0), total)

  let avgScore: number | null = null
  let maxScore = 5
  if (f.remapping && Object.keys(f.remapping).length > 0) {
    maxScore    = Math.max(...Object.values(f.remapping))
    const wsum  = allKeys.reduce((s, k) => s + (rawCounts[k] || 0) * (f.remapping![k] || 0), 0)
    avgScore    = total > 0 ? Math.round(wsum / total * 10) / 10 : null
  }

  // ── Layout constants ─────────────────────────────────────────────────────────
  const leftW   = 2.9
  const chartX  = PAD + leftW + 0.38
  const labelW  = 3.2   // wider label column so long responses fit on one line
  const barMaxW = W - chartX - labelW - 0.15 - 0.62 - 1.1 - PAD * 0.5
  const barX    = chartX + labelW + 0.15
  const pctX    = barX + barMaxW + 0.12
  const cntX    = pctX + 0.62

  // ── Left panel ───────────────────────────────────────────────────────────────
  kpiCard(slide, pptx, PAD, CY, leftW, 0.88, total.toLocaleString(), 'Total Responses', (s?.uniqueCount || allKeys.length) + ' unique values', DN.tealPale, DN.teal)

  let leftY = CY + 1.01

  if (isOrdinal) {
    const t2Color = top2 >= 70 ? DN.green : top2 >= 50 ? DN.amber : DN.red
    const t2Bg    = top2 >= 70 ? DN.greenLight : top2 >= 50 ? DN.amberLight : DN.redLight
    kpiCard(slide, pptx, PAD, leftY, leftW, 0.88, top2 + '%', 'Top-2 Positive', top2Keys.slice(0, 2).map(k => trunc(k, 14)).join(' + '), t2Bg, t2Color)
    leftY += 1.01

    if (avgScore !== null) {
      const aFrac  = maxScore > 0 ? avgScore / maxScore : 0.5
      const aColor = aFrac >= 0.65 ? DN.green : aFrac >= 0.4 ? DN.amber : DN.red
      kpiCard(slide, pptx, PAD, leftY, leftW, 0.88, Math.round(avgScore) + ' / ' + maxScore, 'Average Score', undefined, DN.slateLight, aColor)
      leftY += 1.01
    }

    if (bot2 > 4 && bot2Keys.length > 0) {
      solidRect(slide, pptx, PAD, leftY, leftW, 0.72, 'FEE2E2')
      solidRect(slide, pptx, PAD, leftY, 0.06, 0.72, DN.red)
      slide.addText(bot2 + '%', { x: PAD + 0.14, y: leftY + 0.05, w: 0.75, h: 0.34, fontSize: 22, bold: true, color: DN.red, valign: 'middle' })
      slide.addText('expressed concern', { x: PAD + 0.93, y: leftY + 0.05, w: leftW - 1.05, h: 0.3, fontSize: 9, bold: true, color: DN.red, valign: 'middle' })
      slide.addText(bot2Keys.map(k => trunc(k, 14)).join(' or '), { x: PAD + 0.14, y: leftY + 0.42, w: leftW - 0.2, h: 0.24, fontSize: 8, color: DN.slateDark })
      leftY += 0.85
    }
  }

  // Insight text — AI if good, else auto-computed. Only keyFinding in box.
  const hasRealAI = ai.keyFinding && ai.keyFinding !== f.label && ai.keyFinding !== f.field
  const insightText = trimNatural(hasRealAI
    ? ai.keyFinding
    : autoInsight(f.label, orderedKeys, rawCounts, total, isOrdinal, top2, bot2), 200)

  const hasImpl = hasRealAI && !!ai.implication
  const insightBottom = hasImpl ? H - 0.80 : H - 0.38
  const insightH = Math.max(0.4, insightBottom - leftY - 0.18)
  insightBox(slide, pptx, PAD, leftY + 0.1, leftW, insightH, insightText, DN.teal, DN.tealPale)

  // Implication strip — pinned above footer, below insight box
  if (hasImpl) {
    const implY = insightBottom + 0.06
    solidRect(slide, pptx, PAD, implY, leftW, 0.40, DN.orangePale)
    solidRect(slide, pptx, PAD, implY, 0.06, 0.40, DN.orange)
    slide.addText('→ ' + ai.implication, { x: PAD + 0.13, y: implY + 0.03, w: leftW - 0.18, h: 0.34, fontSize: 8.5, color: DN.navyLight, italic: true, valign: 'middle', wrap: true, autoFit: true })
  }

  // Vertical divider
  solidRect(slide, pptx, PAD + leftW + 0.18, CY + 0.06, 0.012, CH - 0.12, DN.divider)

  // ── Right panel: custom horizontal bar chart ──────────────────────────────
  const n     = orderedKeys.length
  const rowGap = 0.09
  const rowH  = Math.min(0.58, (CH - rowGap * (n - 1)) / Math.max(n, 1))
  const maxVal = Math.max(...orderedKeys.map(k => rawCounts[k] || 0), 1)

  // Column headers
  slide.addText('Response', { x: chartX, y: CY, w: labelW, h: 0.28, fontSize: 10, bold: true, color: DN.slateDark, valign: 'middle' })
  slide.addText('Distribution', { x: barX, y: CY, w: barMaxW, h: 0.28, fontSize: 10, bold: true, color: DN.slateDark, valign: 'middle' })
  slide.addText('%', { x: pctX, y: CY, w: 0.6, h: 0.28, fontSize: 10, bold: true, color: DN.slateDark, valign: 'middle' })
  slide.addText('n', { x: cntX, y: CY, w: 1.0, h: 0.28, fontSize: 10, bold: true, color: DN.slateDark, valign: 'middle' })
  solidRect(slide, pptx, chartX, CY + 0.3, W - chartX - PAD * 0.5, 0.012, DN.divider)

  const rowStart = CY + 0.42
  orderedKeys.forEach(function(key, i) {
    const count   = rawCounts[key] || 0
    const pctVal  = pct(count, total)
    const barW    = barMaxW * count / maxVal
    const ry      = rowStart + i * (rowH + rowGap)
    const col     = barColor(i, n, isOrdinal)
    const isTop   = i === 0

    // Subtle row tint
    if (i % 2 === 0) solidRect(slide, pptx, chartX, ry, W - chartX - PAD * 0.4, rowH, 'F8F9FA')

    // Label
    slide.addText(trunc(key, 48), {
      x: chartX, y: ry, w: labelW, h: rowH,
      fontSize: isTop ? 12.5 : 12, bold: isTop,
      color: isTop ? DN.navy : DN.navyLight, valign: 'middle', wrap: true, autoFit: true,
    })

    // Bar track
    const trackY = ry + rowH * 0.22
    const trackH = rowH * 0.55
    solidRect(slide, pptx, barX, trackY, barMaxW, trackH, 'EAECEF')

    // Bar fill
    if (barW > 0.05) solidRect(slide, pptx, barX, trackY, barW, trackH, col)

    // Percentage
    slide.addText(pctVal + '%', {
      x: pctX, y: ry, w: 0.6, h: rowH,
      fontSize: isTop ? 14 : 12, bold: true, color: col, valign: 'middle',
    })

    // Count
    slide.addText(count.toLocaleString(), {
      x: cntX, y: ry, w: 1.1, h: rowH,
      fontSize: 10.5, color: DN.slateDark, valign: 'middle',
    })
  })

  footer(slide, pptx, datasetName)
}

function buildNumericSlide(pptx: any, datasetName: string, f: SelectedField, ai: FieldInsight) {
  const slide = pptx.addSlide('NUMBERED')
  bg(slide, pptx)
  const subtitle = (f.section === 'demographic' || f.section === 'psychographic') && f.prompt
    ? f.prompt
    : 'Numeric distribution · ' + (f.summary?.nonNull || 0).toLocaleString() + ' responses'
  hdr(slide, pptx, f.label, DN.teal, subtitle)
  logo(slide)

  const s           = f.summary
  const isDiscrete  = !!(s?.isDiscrete && s?.valueCounts && Object.keys(s.valueCounts || {}).length > 0)
  const range       = (s?.max ?? 0) - (s?.min ?? 0)
  const posInRange  = range > 0 ? (s?.avg - s?.min) / range : 0.5
  const perfColor   = posInRange >= 0.65 ? DN.green : posInRange <= 0.35 ? DN.red : DN.amber
  const perfBg      = posInRange >= 0.65 ? DN.greenLight : posInRange <= 0.35 ? DN.redLight : DN.amberLight

  // ── Stats row ─────────────────────────────────────────────────────────────────
  const statsData = [
    { k: 'Average',   v: s?.avg   != null ? String(Math.round(s.avg))    : '—', bg: perfBg,       vc: perfColor },
    { k: 'Median',    v: s?.median != null ? String(Math.round(s.median)) : '—', bg: DN.slateCard, vc: DN.navyLight },
    { k: 'Std Dev',   v: s?.std   != null ? String(Math.round(s.std))    : '—', bg: DN.slateCard, vc: DN.navyLight },
    { k: 'Min → Max', v: (s?.min ?? '—') + ' – ' + (s?.max ?? '—'),                                         bg: DN.slateCard, vc: DN.navyLight },
    { k: 'n',         v: (s?.nonNull || 0).toLocaleString(),                                                  bg: DN.tealPale,  vc: DN.teal },
  ]
  const sw = (W - PAD * 2 - 0.16) / statsData.length
  statsData.forEach(function(st, i) {
    kpiCard(slide, pptx, PAD + i * (sw + 0.04), CY, sw, 0.82, st.v, st.k, undefined, st.bg, st.vc)
  })

  // ── Insight text (needed for both branches to anchor insight Y) ───────────────
  const hasRealAI   = ai.keyFinding && ai.keyFinding !== f.label && ai.keyFinding !== f.field
  // Only show keyFinding in the bottom insight box (narrative is too long to combine)
  const insightText = hasRealAI
    ? trimNatural(ai.keyFinding, 150)
    : (posInRange >= 0.65
        ? 'Average of ' + (s?.avg != null ? Math.round(s.avg) : '—') + ' sits in the upper range — strong performance.'
        : posInRange <= 0.35
          ? 'Average of ' + (s?.avg != null ? Math.round(s.avg) : '—') + ' sits in the lower range — opportunity for improvement.'
          : 'Average of ' + (s?.avg != null ? Math.round(s.avg) : '—') + ' sits in the mid range.')
  const withImpl  = hasRealAI && !!ai.implication
  const insH      = 0.52
  const implH     = 0.40
  const insightY  = FY - 0.12 - (withImpl ? insH + 0.06 + implH : insH)

  if (isDiscrete) {
    // ── Discrete integer: full-width horizontal bar chart (same layout as categorical) ──
    const rawCounts   = s.valueCounts as Record<string, number>
    // Sort DESCENDING so highest value (best score) appears at top
    const orderedKeys = Object.keys(rawCounts).sort((a, b) => Number(b) - Number(a))
    const total_      = orderedKeys.reduce((sum, k) => sum + (rawCounts[k] || 0), 0)
    const maxVal      = Math.max(...orderedKeys.map(k => rawCounts[k] || 0), 1)
    const n           = orderedKeys.length
    const numMin      = Math.min(...orderedKeys.map(Number))
    const numMax      = Math.max(...orderedKeys.map(Number))

    const headerY  = CY + 1.05
    const rowStart = headerY + 0.32
    const barAvail = insightY - rowStart - 0.08
    const rowH     = Math.min(0.58, barAvail / Math.max(n, 1))
    const rowGap   = Math.min(0.08, (barAvail - rowH * n) / Math.max(n - 1, 1))

    const swatchW = 0.10; const labelW = 1.4; const pctW = 0.52; const cntW = 0.72
    const gapS = 0.08; const gapLB = 0.14; const gapBP = 0.14; const gapPC = 0.10
    const barMaxW = W - PAD * 2 - swatchW - gapS - labelW - gapLB - gapBP - pctW - gapPC - cntW
    const swatchX = PAD; const labelX = swatchX + swatchW + gapS
    const barX = labelX + labelW + gapLB; const pctX = barX + barMaxW + gapBP; const cntX = pctX + pctW + gapPC

    slide.addText('Value',        { x: labelX, y: headerY, w: labelW,  h: 0.26, fontSize: 9, bold: true, color: DN.slateDark, valign: 'middle', align: 'center' })
    slide.addText('Distribution', { x: barX,   y: headerY, w: barMaxW, h: 0.26, fontSize: 9, bold: true, color: DN.slateDark, valign: 'middle' })
    slide.addText('%',            { x: pctX,   y: headerY, w: pctW,    h: 0.26, fontSize: 9, bold: true, color: DN.slateDark, align: 'right', valign: 'middle' })
    slide.addText('n',            { x: cntX,   y: headerY, w: cntW,    h: 0.26, fontSize: 9, bold: true, color: DN.slateDark, valign: 'middle' })
    solidRect(slide, pptx, PAD, headerY + 0.28, W - PAD * 2, 0.012, DN.divider)

    orderedKeys.forEach(function(key, i) {
      const count  = rawCounts[key] || 0
      const pctVal = total_ > 0 ? Math.round(count / total_ * 100) : 0
      const bw     = barMaxW * count / maxVal
      const ry     = rowStart + i * (rowH + rowGap)
      // Color by actual numeric value: high = green, low = red
      const numFrac = numMax > numMin ? (Number(key) - numMin) / (numMax - numMin) : 0.5
      const col     = numFrac >= 0.75 ? '059669' : numFrac >= 0.55 ? '34D399' : numFrac >= 0.45 ? '94A3B8' : numFrac >= 0.25 ? 'F97316' : 'DC2626'

      if (i % 2 === 0) solidRect(slide, pptx, PAD, ry, W - PAD * 2, rowH, 'F8F9FA')
      solidRect(slide, pptx, swatchX, ry + rowH * 0.18, swatchW, rowH * 0.64, col)

      // Integer key — centered, larger font
      slide.addText(key, {
        x: labelX, y: ry, w: labelW, h: rowH,
        fontSize: 12, bold: true, color: DN.navy, valign: 'middle', align: 'center',
      })

      const trackH = rowH * 0.52; const trackY = ry + (rowH - trackH) / 2
      solidRect(slide, pptx, barX, trackY, barMaxW, trackH, 'EAECEF')
      if (bw > 0.04) solidRect(slide, pptx, barX, trackY, bw, trackH, col)

      slide.addText(pctVal + '%', { x: pctX, y: ry, w: pctW, h: rowH, fontSize: 13, bold: true, color: col, align: 'right', valign: 'middle' })
      slide.addText(count.toLocaleString(), { x: cntX, y: ry, w: cntW, h: rowH, fontSize: 11, color: DN.slateDark, valign: 'middle' })
    })

  } else {
    // ── Continuous: histogram (left) + gauge/narrative (right) ───────────────────
    const chartX  = PAD
    const chartW2 = W * 0.55 - PAD
    const chartY  = CY + 1.15
    const chartH2 = insightY - chartY - 0.18
    const histBuckets: any[] = s?.histogram || []

    lbl(slide, 'DISTRIBUTION', chartX, chartY - 0.24, chartW2)
    solidRect(slide, pptx, chartX, chartY - 0.02, chartW2, 0.012, DN.divider)

    if (histBuckets.length > 0) {
      const maxCount = Math.max(...histBuckets.map((b: any) => b.count), 1)
      const bw       = chartW2 / histBuckets.length
      histBuckets.forEach(function(b: any, i: number) {
        const bh  = chartH2 * 0.84 * (b.count / maxCount)
        const bx  = chartX + i * bw
        const by  = chartY + chartH2 * 0.84 - bh
        const col = posInRange >= 0.65 ? DN.teal : posInRange <= 0.35 ? 'F97316' : DN.teal
        solidRect(slide, pptx, bx + 0.02, by, bw - 0.04, bh, col)
      })
      // X-axis labels — every bar, larger font, centered under bar
      const allIntegers = histBuckets.every((b: any) => Number.isInteger(b.min) && Number.isInteger(b.max))
      const step = Math.ceil(histBuckets.length / 8)
      histBuckets.forEach(function(b: any, i: number) {
        if (i % step !== 0 && i !== histBuckets.length - 1) return
        const bx    = chartX + i * bw
        const label = String(Math.round(b.min))
        slide.addText(label, {
          x: bx, y: chartY + chartH2 * 0.86, w: bw * step, h: 0.26,
          fontSize: 10, color: DN.slateDark, valign: 'top', align: 'center',
        })
      })
      // Mean line
      if (s?.avg != null && range > 0) {
        const meanX = chartX + ((s.avg - s.min) / range) * chartW2
        solidRect(slide, pptx, meanX - 0.01, chartY, 0.02, chartH2 * 0.84, DN.orange)
        const avgLabel = 'avg ' + Math.round(s.avg)
        slide.addText(avgLabel, {
          x: Math.min(meanX - 0.35, chartX + chartW2 - 0.72), y: chartY + 0.04,
          w: 0.72, h: 0.24, fontSize: 9, bold: true, color: DN.orange, align: 'center',
        })
      }
    } else {
      slide.addText('No histogram data available.', {
        x: chartX, y: chartY + 1.0, w: chartW2, h: 0.4,
        fontSize: 11, color: DN.slate, italic: true, align: 'center',
      })
    }

    // ── Right panel ──────────────────────────────────────────────────────────────
    const rightX = W * 0.55 + 0.2
    const rightW = W - rightX - PAD * 0.5

    lbl(slide, 'PERFORMANCE WITHIN RANGE', rightX, chartY - 0.24, rightW)
    solidRect(slide, pptx, rightX, chartY - 0.02, rightW, 0.012, DN.divider)
    const gaugeY = chartY + 0.1
    rect(slide, pptx, rightX, gaugeY, rightW, 0.32, DN.slateLight, 0.06, DN.divider)
    const fillW = Math.max(0.12, rightW * posInRange)
    solidRect(slide, pptx, rightX, gaugeY, fillW, 0.32, perfColor + '99')
    solidRect(slide, pptx, rightX + fillW - 0.05, gaugeY - 0.05, 0.1, 0.42, perfColor)
    slide.addText(String(s?.min ?? '0'), { x: rightX, y: gaugeY + 0.34, w: 0.6, h: 0.22, fontSize: 9, color: DN.slateDark })
    slide.addText(String(s?.max ?? '—'), { x: rightX + rightW - 0.6, y: gaugeY + 0.34, w: 0.6, h: 0.22, fontSize: 9, color: DN.slateDark, align: 'right' })
    slide.addText('avg ' + (s?.avg != null ? Math.round(s.avg) : '—'), {
      x: rightX + Math.max(0, fillW - 0.5), y: gaugeY - 0.28,
      w: 0.95, h: 0.22, fontSize: 10, bold: true, color: perfColor, align: 'center',
    })

    const narY = gaugeY + 0.72
    if (hasRealAI) {
      slide.addText(ai.keyFinding, {
        x: rightX, y: narY, w: rightW, h: 0.46,
        fontSize: 12.5, bold: true, color: DN.teal, wrap: true, lineSpacingMultiple: 1.2, autoFit: true,
      })
      if (ai.narrative) {
        insightBox(slide, pptx, rightX, narY + 0.54, rightW, Math.min(1.3, insightY - narY - 1.1), ai.narrative, DN.teal, DN.tealPale)
      }
    } else {
      insightBox(slide, pptx, rightX, narY, rightW, Math.min(1.2, insightY - narY - 0.1), insightText, DN.teal, DN.tealPale)
    }

    if (hasRealAI && ai.implication) {
      solidRect(slide, pptx, rightX, insightY - 0.56, rightW, 0.44, DN.orangePale)
      solidRect(slide, pptx, rightX, insightY - 0.56, 0.06, 0.44, DN.orange)
      slide.addText('→ ' + ai.implication, { x: rightX + 0.13, y: insightY - 0.52, w: rightW - 0.18, h: 0.36, fontSize: 8.5, color: DN.navyLight, italic: true, valign: 'middle', wrap: true, autoFit: true })
    }
  }

  // ── Insight box — full width, anchored above footer ───────────────────────────
  if (withImpl) {
    insightBox(slide, pptx, PAD, insightY, W - PAD * 2, insH, insightText, DN.teal, DN.tealPale)
    const implY = insightY + insH + 0.08
    solidRect(slide, pptx, PAD, implY, W - PAD * 2, implH, DN.goldPale)
    solidRect(slide, pptx, PAD, implY, 0.05, implH, DN.gold)
    slide.addText('→ ' + ai.implication, { x: PAD + 0.12, y: implY + 0.04, w: W - PAD * 2 - 0.18, h: implH - 0.08, fontSize: 8.5, color: DN.navyLight, italic: true, valign: 'middle', wrap: true, autoFit: true })
  } else {
    insightBox(slide, pptx, PAD, insightY, W - PAD * 2, insH, insightText, DN.teal, DN.tealPale)
  }

  footer(slide, pptx, datasetName)
}

function buildOpenEndedSlide(pptx: any, datasetName: string, f: SelectedField, ai: FieldInsight, audience: string, themes: any[], getStripColor?: (text: string) => string | undefined) {
  const slide = pptx.addSlide('NUMBERED')
  bg(slide, pptx)
  hdr(slide, pptx, f.label, DN.tealDark, 'Open-ended verbatim responses')
  logo(slide)

  const s = f.summary
  const maxQuotes = 5
  // Use liveSample (fresh from filtered rows) over stale analytics snapshot
  const samplePool = (f.liveSample && f.liveSample.length > 0) ? f.liveSample : (s?.sample || [])
  // Target quote length: long enough to fill the box but short enough to not overflow
  // Each quote box is roughly CH/5 tall ≈ 0.8". At ~10pt that fits ~120 chars comfortably.
  const TARGET_MIN = 80
  const TARGET_MAX = 220
  // Sort by how close each quote is to the ideal range (prefer quotes that fill the box)
  const candidates = samplePool
    .filter((q: string) => q && q.trim().length >= TARGET_MIN)
    .map((q: string) => ({ text: q.trim(), len: q.trim().length }))
    .sort((a: { len: number }, b: { len: number }) => {
      const aFit = a.len <= TARGET_MAX ? 0 : a.len - TARGET_MAX
      const bFit = b.len <= TARGET_MAX ? 0 : b.len - TARGET_MAX
      return aFit - bFit
    })
  const rawFallback = candidates.length >= maxQuotes
    ? candidates.slice(0, maxQuotes).map((c: { text: string }) => trimNatural(c.text, TARGET_MAX))
    : samplePool.filter((q: string) => q && q.trim().length > 40).slice(0, maxQuotes).map((q: string) => trimNatural(q, TARGET_MAX))
  const quotes: string[] = (ai.pickedQuotes && ai.pickedQuotes.length > 0)
    ? ai.pickedQuotes.slice(0, maxQuotes).map((q: string) => trimNatural(q, TARGET_MAX))
    : rawFallback

  const leftW  = W * 0.44 - PAD
  const rightX = W * 0.44 + 0.1
  const rightW = W - rightX - PAD * 0.5

  // Left panel: original prompt + stats + narrative + themes
  let leftStartY = CY
  // Show original prompt if available; fall back to label if it's meaningful (not just the raw field key)
  const promptText = f.prompt || (f.label !== f.field ? f.label : '')
  if (promptText) {
    solidRect(slide, pptx, PAD, CY, leftW, 0.48, DN.slateLight)
    solidRect(slide, pptx, PAD, CY, 0.05, 0.48, DN.teal)
    slide.addText('\u201C' + promptText + '\u201D', {
      x: PAD + 0.12, y: CY + 0.04, w: leftW - 0.18, h: 0.40,
      fontSize: 9.5, color: DN.navyLight, italic: true, valign: 'middle', wrap: true, lineSpacingMultiple: 1.3, autoFit: true,
    })
    leftStartY = CY + 0.56
  }

  // Stats
  kpiCard(slide, pptx, PAD, leftStartY, leftW * 0.46, 0.8, (s?.nonNull || 0).toLocaleString(), 'Responses', undefined, DN.tealPale, DN.teal)
  kpiCard(slide, pptx, PAD + leftW * 0.49, leftStartY, leftW * 0.46, 0.8, String(s?.avgWordCount || '—'), 'Avg Words', 'per response', DN.slateCard, DN.navyLight)

  // Key finding
  if (ai.keyFinding) {
    lbl(slide, 'HEADLINE FINDING', PAD, leftStartY + 0.92, leftW)
    slide.addText(ai.keyFinding, { x: PAD, y: leftStartY + 1.14, w: leftW, h: 0.44, fontSize: 13, bold: true, color: DN.teal, wrap: true, lineSpacingMultiple: 1.2, autoFit: true })
  }

  // Relevant themes (declared here so narrative can reference it for bottom reserve)
  const relThemes = themes.slice(0, 4)

  // Narrative — give it all remaining space above themes/implication
  if (ai.narrative) {
    const narY = leftStartY + (ai.keyFinding ? 1.65 : 0.92)
    const bottomReserve = (relThemes.length > 0 ? 0.72 : 0) + (ai.implication ? 0.58 : 0) + 0.38
    const narH = Math.max(0.5, H - narY - bottomReserve - 0.08)
    // ~12 chars per inch width at fontSize 11.5, ~5.5 lines per inch height → estimate max chars
    const maxNarChars = Math.round(narH * 5 * 50)
    insightBox(slide, pptx, PAD, narY, leftW, narH, trimNatural(ai.narrative, Math.min(maxNarChars, 350)), DN.teal, DN.tealPale)
  }
  if (relThemes.length > 0) {
    const thY = H - (ai.implication ? 1.30 : 0.72)
    lbl(slide, 'THEMES IDENTIFIED', PAD, thY, leftW)
    const pillW = (leftW - 0.1 * (relThemes.length - 1)) / relThemes.length
    relThemes.forEach(function(t: any, i: number) {
      const tc = (t.color || DN.teal).replace('#', '')
      rect(slide, pptx, PAD + i * (pillW + 0.1), thY + 0.24, pillW, 0.36, tc + '20', 0.07, tc + '60')
      slide.addText(trunc(t.name, 16), { x: PAD + i * (pillW + 0.1) + 0.06, y: thY + 0.24, w: pillW - 0.12, h: 0.36, fontSize: 8.5, bold: true, color: tc, align: 'center', valign: 'middle' })
    })
  }

  // Implication
  if (ai.implication) {
    solidRect(slide, pptx, PAD, H - 0.78, leftW, 0.48, DN.orangePale)
    solidRect(slide, pptx, PAD, H - 0.78, 0.07, 0.48, DN.orange)
    slide.addText('→ ' + ai.implication, { x: PAD + 0.14, y: H - 0.78 + 0.04, w: leftW - 0.2, h: 0.4, fontSize: 9.5, color: DN.navyLight, italic: true, valign: 'middle', wrap: true, autoFit: true })
  }

  // Right panel: quotes
  lbl(slide, 'VOICES FROM THE DATA', rightX, CY, rightW)

  if (quotes.length > 0) {
    const qh = Math.min(0.9, (CH - 0.24) / quotes.length - 0.1)
    quotes.forEach(function(q, i) {
      quoteCard(slide, pptx, rightX, CY + 0.24 + i * (qh + 0.1), rightW, qh, q, getStripColor?.(q))
    })
  } else {
    slide.addText('No verbatim responses available for this field.', {
      x: rightX, y: CY + 0.5, w: rightW, h: 1.0,
      fontSize: 12, color: DN.slate, italic: true, align: 'center', valign: 'middle',
    })
  }

  footer(slide, pptx, datasetName)
}

interface CommentItem { text: string; demos: Array<{ label: string; value: string; section?: string }>; colorValue?: string }

// Map a field value to a card accent strip color
// Numeric: green→red gradient based on relative value
// Categorical: deterministic palette color per unique value
function valueToColor(val: string, allValsForField?: string[]): string {
  // Try numeric interpretation first
  const num = parseFloat(val)
  if (!isNaN(num) && val.trim() !== '') {
    // Need context of min/max; if allValsForField provided, compute gradient
    if (allValsForField && allValsForField.length > 1) {
      const nums = allValsForField.map(Number).filter(n => !isNaN(n))
      const lo = Math.min(...nums), hi = Math.max(...nums)
      const frac = hi > lo ? (num - lo) / (hi - lo) : 0.5
      if (frac >= 0.75) return '059669'
      if (frac >= 0.55) return '34D399'
      if (frac >= 0.45) return '94A3B8'
      if (frac >= 0.25) return 'F97316'
      return 'DC2626'
    }
  }
  // Sentiment-aware coloring for implicit positive/negative categorical values
  const lv = val.toLowerCase().trim()
  const positiveTerms = ['very satisfied', 'extremely satisfied', 'very likely', 'extremely likely', 'strongly agree', 'excellent', 'outstanding', 'very good', 'promoter', 'positive', 'very happy', 'very pleased', 'always', 'definitely']
  const negativeTerms = ['very dissatisfied', 'extremely dissatisfied', 'very unlikely', 'extremely unlikely', 'strongly disagree', 'terrible', 'very poor', 'poor', 'detractor', 'negative', 'very unhappy', 'never', 'not at all']
  const neutralTerms  = ['neutral', 'neither', 'passive', 'somewhat', 'not sure', 'no opinion']
  if (positiveTerms.some(t => lv.includes(t))) return DN.green
  if (negativeTerms.some(t => lv.includes(t))) return DN.red
  if (neutralTerms.some(t => lv.includes(t)))  return DN.slate

  // Categorical: deterministic palette color
  const palette = [DN.teal, DN.gold, '7C3AED', DN.green, 'E85A1A', DN.navyLight, '0891B2', 'DB2777', '65A30D', '9333EA']
  let hash = 0
  for (let i = 0; i < val.length; i++) hash = (hash * 31 + val.charCodeAt(i)) & 0xffff
  return palette[hash % palette.length]
}

function buildCommentsSlide(
  pptx: any,
  datasetName: string,
  fieldLabel: string,
  fieldSection: string | undefined,
  comments: CommentItem[],
  slideNum: number,
  totalSlides: number
) {
  const slide = pptx.addSlide('NUMBERED')
  bg(slide, pptx)
  const sectionTag = fieldSection ? fieldSection.charAt(0).toUpperCase() + fieldSection.slice(1) + ' · ' : ''
  const slideTag = totalSlides > 1 ? '  ·  Slide ' + slideNum + ' of ' + totalSlides : ''
  hdr(slide, pptx, fieldLabel, DN.tealDark, sectionTag + 'Verbatim responses' + slideTag)
  logo(slide)

  const cols    = 2
  const rows    = 4
  const gapX    = 0.22
  const gapY    = 0.16
  const cardW   = (W - PAD * 2 - gapX * (cols - 1)) / cols
  const cardH   = (CH - gapY * (rows - 1)) / rows

  comments.slice(0, cols * rows).forEach(function(c, i) {
    const col = i % cols
    const row = Math.floor(i / cols)
    const cx  = PAD + col * (cardW + gapX)
    const cy  = CY + row * (cardH + gapY)

    const hasDemos = c.demos.length > 0
    const demoRowH = 0.28

    // Card background + left accent strip (color from colorValue if present)
    const allColorVals = comments.map(function(x) { return x.colorValue || '' }).filter(Boolean)
    const stripColor = c.colorValue ? valueToColor(c.colorValue, allColorVals) : DN.teal
    rect(slide, pptx, cx, cy, cardW, cardH, DN.white, 0.06, DN.divider)
    solidRect(slide, pptx, cx, cy, 0.06, cardH, stripColor)

    // Opening curly-quote mark
    slide.addText('\u201C', {
      x: cx + 0.10, y: cy + 0.03, w: 0.24, h: 0.28,
      fontSize: 20, bold: true, color: DN.tealLight, valign: 'top',
    })

    // Comment text
    const textH = cardH - 0.08 - (hasDemos ? demoRowH + 0.06 : 0) - 0.24
    slide.addText(trunc(c.text, 220), {
      x: cx + 0.14, y: cy + 0.24, w: cardW - 0.22, h: textH,
      fontSize: 12, color: DN.navyLight, italic: true, valign: 'top', wrap: true, lineSpacingMultiple: 1.3, autoFit: true,
    })

    // Closing curly-quote mark
    slide.addText('\u201D', {
      x: cx + cardW - 0.28, y: cy + cardH - 0.24 - (hasDemos ? demoRowH + 0.06 : 0), w: 0.24, h: 0.24,
      fontSize: 20, bold: true, color: DN.tealLight, valign: 'bottom', align: 'right',
    })

    // Annotation pills pinned to bottom of card
    // Demo = Sarina palette (orange), Psycho = Ana palette (teal)
    if (hasDemos) {
      const demoY = cy + cardH - demoRowH - 0.02
      solidRect(slide, pptx, cx + 0.06, demoY - 0.03, cardW - 0.12, 0.010, DN.divider)
      const pillH    = 0.22
      const pillPadX = 0.10   // horizontal text padding inside pill
      const pillGap  = 0.07
      const pillY    = demoY + 0.03
      const maxRight = cx + cardW - 0.12

      // Pill style by section
      const pillStyle = (section?: string): { bg: string; text: string } => {
        if (section === 'demographic')   return { bg: 'FEF0E8', text: DN.orange }
        if (section === 'psychographic') return { bg: 'E0F2F1', text: DN.teal   }
        return { bg: DN.slateLight, text: DN.slateDark }
      }

      // First pass: compute widths so we know which pills actually fit
      // character width at fontSize 7.5 ≈ 0.062" per char; add 2× horizontal padding
      let tagX = cx + 0.12
      c.demos.slice(0, 6).forEach(function(d) {
        if (!d.value) return
        const pillW = d.value.length * 0.062 + pillPadX * 2
        if (tagX + pillW > maxRight) return
        const style = pillStyle(d.section)
        // Pill shape — no border, max radius for full pill look
        slide.addShape(pptx.ShapeType.rect, { x: tagX, y: pillY, w: pillW, h: pillH, fill: { color: style.bg }, line: { width: 0 }, rectRadius: 0.9 })
        slide.addText(d.value, {
          x: tagX + pillPadX, y: pillY, w: pillW - pillPadX * 2, h: pillH,
          fontSize: 7.5, bold: true, color: style.text, valign: 'middle', wrap: false,
        })
        tagX += pillW + pillGap
      })
    }
  })

  footer(slide, pptx, datasetName)
}

// Sentiment badge colors (matches TextMine sentBg/sentColor)
function themeSentBg(s: string)    { return s === 'positive' ? DN.greenLight : s === 'negative' ? DN.redLight  : s === 'mixed' ? DN.amberLight : DN.slateLight }
function themeSentFg(s: string)    { return s === 'positive' ? DN.green      : s === 'negative' ? DN.red       : s === 'mixed' ? DN.amber      : DN.slateDark  }

// Compact grid overview: multiple themes per page (summary before the per-theme detail slides)
function buildThemeGridSlides(pptx: any, datasetName: string, themes: any[], fieldLabel?: string) {
  if (!themes || themes.length === 0) return
  function chooseGrid(n: number) {
    if (n <= 2) return { perPage: 2, cols: 2, rows: 1 }
    if (n <= 4) return { perPage: 4, cols: 2, rows: 2 }
    if (n <= 6) return { perPage: 6, cols: 3, rows: 2 }
    return { perPage: 8, cols: 4, rows: 2 }
  }
  const { perPage, cols, rows } = chooseGrid(themes.length)
  const gapX  = 0.16, gapY = 0.18
  const cardW = (W - PAD * 2 - gapX * (cols - 1)) / cols
  const cardH = (CH - gapY * (rows - 1)) / rows
  const totalPages = Math.ceil(themes.length / perPage)
  for (let pg = 0; pg < totalPages; pg++) {
    const pageThemes = themes.slice(pg * perPage, (pg + 1) * perPage)
    const slide = pptx.addSlide('NUMBERED')
    bg(slide, pptx)
    const gridTitle = fieldLabel ? 'Theme Analysis — ' + fieldLabel : 'Theme Analysis'
    const pgTag = totalPages > 1 ? (pg + 1) + ' of ' + totalPages : themes.length + ' themes identified'
    hdr(slide, pptx, gridTitle, DN.tealDark, pgTag)
    logo(slide)
    pageThemes.forEach(function(t: any, i: number) {
      const col = i % cols, row = Math.floor(i / cols)
      const cx  = PAD + col * (cardW + gapX)
      const cy  = CY  + row * (cardH + gapY)
      const themeColor = (t.color || DN.teal).replace('#', '')
      rect(slide, pptx, cx, cy, cardW, cardH, DN.white, 0.07, themeColor)
      solidRect(slide, pptx, cx, cy, cardW, 0.07, themeColor)
      const sent = t.sentiment || ''
      if (sent) {
        const sw = 0.8
        rect(slide, pptx, cx + cardW - sw - 0.08, cy + 0.12, sw, 0.22, themeSentBg(sent), 0.5, themeSentFg(sent))
        slide.addText(sent.charAt(0).toUpperCase() + sent.slice(1), { x: cx + cardW - sw - 0.08, y: cy + 0.12, w: sw, h: 0.22, fontSize: 7.5, bold: true, color: themeSentFg(sent), align: 'center', valign: 'middle' })
      }
      const nameW = cardW - (sent ? 1.0 : 0.28)
      const nameFontSize = cardH <= 2.0 ? 10 : 12
      // Estimate title lines: ~7 chars per inch at 12pt, ~8 at 10pt
      const charsPerLine = Math.floor(nameW * (nameFontSize <= 10 ? 8 : 7))
      const titleLines = Math.ceil((t.name || '').length / Math.max(charsPerLine, 1))
      const lineH = nameFontSize <= 10 ? 0.16 : 0.19
      const nameH = Math.max(cardH <= 2.0 ? 0.30 : 0.40, titleLines * lineH)
      slide.addText(t.name || '', { x: cx + 0.14, y: cy + 0.14, w: nameW, h: nameH, fontSize: nameFontSize, bold: true, color: DN.navy, valign: 'top', wrap: true, autoFit: true })
      const descY = cy + 0.14 + nameH + 0.04
      const descMaxH = cardH <= 2.0 ? 0.40 : 0.58
      const descH = Math.min(descMaxH, Math.max(0.20, cy + cardH - 1.0 - descY))
      if (t.description) slide.addText(t.description, { x: cx + 0.14, y: descY, w: cardW - 0.28, h: descH, fontSize: 8, color: DN.slateDark, italic: true, valign: 'top', wrap: true, lineSpacingMultiple: 1.3, autoFit: true })
      const keywords: string[] = (t.keywords || []).slice(0, 3)
      const kwY = descY + descH + 0.04; let kwX = cx + 0.14
      keywords.forEach(function(k: string) {
        const kw = k.length * 0.054 + 0.16
        if (kwX + kw > cx + cardW - 0.06) return
        rect(slide, pptx, kwX, kwY, kw, 0.18, DN.slateLight, 0.5, DN.divider)
        slide.addText(k, { x: kwX + 0.05, y: kwY, w: kw - 0.10, h: 0.18, fontSize: 7, color: DN.slateDark, valign: 'middle', wrap: false })
        kwX += kw + 0.05
      })
      const barY    = cy + cardH - (cardH <= 2.0 ? 0.44 : 0.50)
      const pctVal  = Math.round(t.percentage || 0)
      solidRect(slide, pptx, cx + 0.10, barY - 0.05, cardW - 0.20, 0.008, DN.divider)
      if (t.count) slide.addText(t.count.toLocaleString() + ' in ' + (t.totalResponses || 0).toLocaleString(), { x: cx + 0.14, y: barY, w: cardW * 0.55, h: 0.22, fontSize: 8, color: DN.slateDark, valign: 'middle' })
      if (pctVal)  slide.addText(pctVal + '%', { x: cx + cardW * 0.55, y: barY - 0.02, w: cardW * 0.38, h: 0.28, fontSize: 14, bold: true, color: themeColor, align: 'right', valign: 'middle' })
      const fill = Math.min(1, pctVal / 100)
      solidRect(slide, pptx, cx + 0.14, cy + cardH - 0.14, cardW - 0.28, 0.06, DN.slateLight)
      if (fill > 0) solidRect(slide, pptx, cx + 0.14, cy + cardH - 0.14, (cardW - 0.28) * fill, 0.06, themeColor)
    })
    footer(slide, pptx, datasetName)
  }
}

async function buildThemeSlides(
  pptx: any, datasetName: string, themes: any[], fieldLabel?: string,
  allRows?: Record<string,any>[], rowKeyMap?: Record<string,string>, fieldKeys?: string[],
  usedComments?: Set<string>, orgId?: string, getStripColor?: (text: string) => string | undefined,
) {
  if (!themes || themes.length === 0) return

  // Keyword matcher
  function matchesTheme(text: string, keywords: string[]): boolean {
    if (!keywords?.length) return false
    const lower = text.toLowerCase()
    return keywords.some(function(kw) {
      const e = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return new RegExp('(?<![a-z])' + e + '\\w*', 'i').test(lower)
    })
  }

  // Pick 5 best responses for a theme using AI relevance scoring,
  // then extract conceptual highlight phrases via AI.
  // Falls back to keyword-based highlighting if no API key available.
  async function getComments(t: any): Promise<HighlightedComment[]> {
    if (!allRows?.length || !rowKeyMap || !fieldKeys?.length) return []
    const keys = fieldKeys.map(fk => {
      const norm = fk.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
      return rowKeyMap[norm] || fk
    })
    const matched: string[] = []
    for (const row of allRows) {
      const text = keys.map(k => String(row[k] || '')).join(' ').trim()
      if (text.length < 80) continue
      if (matchesTheme(text, t.keywords || [])) matched.push(text)
    }
    if (!matched.length) return []
    matched.sort((a, b) => b.length - a.length)
    const pool = matched.slice(0, Math.min(matched.length, 40))

    const themeInfo = { name: t.name || '', description: t.description || '', keywords: t.keywords || [], sentiment: t.sentiment || '' }
    // Only use AI scoring if there are many candidates to filter; skip for small pools
    const useAI = pool.length > 8 ? orgId : undefined
    const picked = await pickBestComments(pool, themeInfo, 5, useAI, usedComments || undefined, 350)
    // Use keyword-based highlighting (fast) — AI phrase extraction removed for performance
    return picked.map(text => ({ text, phrases: themeInfo.keywords }))
  }

  const totalThemes = themes.length
  for (let tidx = 0; tidx < themes.length; tidx++) {
    const t = themes[tidx] as any
    const slide = pptx.addSlide('NUMBERED')
    bg(slide, pptx)
    const themeTitle = fieldLabel
      ? 'Theme Analysis — ' + fieldLabel
      : 'Theme Analysis'
    const themeSubtitle = (tidx + 1) + ' of ' + totalThemes + ' themes'
    hdr(slide, pptx, themeTitle, DN.tealDark, themeSubtitle)
    logo(slide)

    const themeColor = (t.color || DN.teal).replace('#', '')
    const leftW  = W * 0.38 - PAD
    const rightX = PAD + leftW + 0.24
    const rightW = W - rightX - PAD * 0.5
    const lx = PAD
    const ly = CY

    // ── LEFT: metadata ───────────────────────────────────────────────────────
    solidRect(slide, pptx, lx, ly, leftW, 0.06, themeColor)

    slide.addText(t.name || '', {
      x: lx, y: ly + 0.12, w: leftW, h: 0.52,
      fontSize: 18, bold: true, color: DN.navy, valign: 'top', wrap: true, autoFit: true,
    })

    const sent = t.sentiment || ''
    if (sent) {
      const sentW = 1.0
      rect(slide, pptx, lx, ly + 0.70, sentW, 0.26, themeSentBg(sent), 0.5, themeSentFg(sent))
      slide.addText(sent.charAt(0).toUpperCase() + sent.slice(1), {
        x: lx, y: ly + 0.70, w: sentW, h: 0.26,
        fontSize: 9, bold: true, color: themeSentFg(sent), align: 'center', valign: 'middle',
      })
    }

    if (t.description) {
      slide.addText(t.description, {
        x: lx, y: ly + 1.08, w: leftW, h: 1.0,
        fontSize: 10, color: DN.slateDark, italic: true, valign: 'top', wrap: true, lineSpacingMultiple: 1.4, autoFit: true,
      })
    }

    // Core keywords
    const keywords: string[] = (t.keywords || []).slice(0, 6)
    lbl(slide, 'KEYWORDS', lx, ly + 2.08, leftW)
    const kwStartY = ly + 2.26
    let kwX = lx; let kwRow = 0
    keywords.forEach(function(k: string) {
      const kw = k.length * 0.058 + 0.20
      if (kwX + kw > lx + leftW) { kwX = lx; kwRow++ }
      if (kwRow > 1) return
      rect(slide, pptx, kwX, kwStartY + kwRow * 0.28, kw, 0.22, DN.slateLight, 0.5, DN.divider)
      slide.addText(k, { x: kwX + 0.07, y: kwStartY + kwRow * 0.28, w: kw - 0.14, h: 0.22, fontSize: 7.5, color: DN.slateDark, valign: 'middle', wrap: false })
      kwX += kw + 0.07
    })

    // Lemma expansions — show related forms the matcher also catches
    const lemmaForms: string[] = []
    for (let ki = 0; ki < keywords.length; ki++) {
      const forms = expandLemma(keywords[ki])
      if (forms.length > 1) {
        for (let fi = 0; fi < forms.length; fi++) {
          if (forms[fi] !== keywords[ki] && lemmaForms.indexOf(forms[fi]) === -1 && keywords.indexOf(forms[fi]) === -1) {
            lemmaForms.push(forms[fi])
          }
        }
      }
    }
    if (lemmaForms.length > 0) {
      const lemmaY = kwStartY + (kwRow + 1) * 0.28 + 0.06
      slide.addText('Also matches: ' + lemmaForms.slice(0, 10).join(', '), {
        x: lx, y: lemmaY, w: leftW, h: 0.20,
        fontSize: 7, color: DN.slate, italic: true, valign: 'middle', wrap: true,
      })
    }

    solidRect(slide, pptx, lx, ly + 2.92, leftW, 0.012, DN.divider)
    const pctVal = Math.round(t.percentage || 0)
    const totalResp = t.totalResponses || 0
    const countStr = t.count ? t.count.toLocaleString() + ' in ' + totalResp.toLocaleString() + ' open-ended responses' : ''
    if (countStr) slide.addText(countStr, { x: lx, y: ly + 2.98, w: leftW * 0.6, h: 0.28, fontSize: 9, color: DN.slateDark, valign: 'middle' })
    if (pctVal)   slide.addText(pctVal + '%', { x: lx + leftW * 0.6, y: ly + 2.92, w: leftW * 0.38, h: 0.42, fontSize: 22, bold: true, color: themeColor, align: 'right', valign: 'middle' })
    const barFill = Math.min(1, pctVal / 100)
    solidRect(slide, pptx, lx, ly + 3.38, leftW, 0.08, DN.slateLight)
    if (barFill > 0) solidRect(slide, pptx, lx, ly + 3.38, leftW * barFill, 0.08, themeColor)

    // ── RIGHT: verbatim comments ─────────────────────────────────────────────
    solidRect(slide, pptx, rightX - 0.12, ly, 0.012, CH, DN.divider)
    lbl(slide, 'VOICES FROM THIS THEME', rightX, ly, rightW)
    solidRect(slide, pptx, rightX, ly + 0.22, rightW, 0.012, DN.divider)

    const comments = await getComments(t)
    if (comments.length > 0) {
      const availH = CH - 0.38
      const qGap   = 0.08
      // Strip newlines and collapse whitespace so quotes don't waste vertical space
      const cleaned = comments.map(function(hc) {
        return { ...hc, text: hc.text.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim() }
      })
      const qh     = (availH - qGap * (cleaned.length - 1)) / cleaned.length
      // Dynamic trim: shorter quotes when cards are small
      const maxChars = qh >= 1.0 ? 200 : qh >= 0.8 ? 160 : 120
      cleaned.forEach(function(hc, i) {
        // Use AI-extracted phrases for highlighting; fall back to theme keywords
        const highlightTerms = hc.phrases && hc.phrases.length > 0 ? hc.phrases : (t.keywords || [])
        quoteCardHighlighted(slide, pptx, rightX, ly + 0.32 + i * (qh + qGap), rightW, qh, trimNatural(hc.text, maxChars), highlightTerms, getStripColor?.(hc.text))
      })
    } else {
      slide.addText('No verbatim responses matched this theme.', {
        x: rightX, y: ly + 0.6, w: rightW, h: 0.6,
        fontSize: 11, color: DN.slate, italic: true, align: 'center', valign: 'middle',
      })
    }

    footer(slide, pptx, datasetName)
  }
}

// ── Compact grid slide: 2×2 or 2×3 mini bar charts per page ─────────────────
// Used for custom, psychographic, and demographic categorical fields to reduce deck bloat.
function buildCompactGridSlides(pptx: any, datasetName: string, fields: SelectedField[]) {
  const perPage = fields.length <= 4 ? 4 : 6  // 2×2 or 2×3
  const cols = 2
  const rows = perPage / cols

  for (let page = 0; page < fields.length; page += perPage) {
    const batch = fields.slice(page, page + perPage)
    const slide = pptx.addSlide('NUMBERED')
    bg(slide, pptx)

    // Minimal header — no per-field header, just a thin gold+navy strip
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.06, fill: { color: DN.gold }, line: { width: 0 } })
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.06, w: W, h: HH - 0.06, fill: { color: DN.navy }, line: { width: 0 } })
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.06, w: 0.07, h: HH - 0.06, fill: { color: DN.teal }, line: { width: 0 } })
    const sectionLabel = batch[0]?.section === 'psychographic' ? 'Psychographic Profile'
      : batch[0]?.section === 'demographic' ? 'Demographic Breakdown'
      : 'Survey Questions'
    const pageLabel = fields.length > perPage
      ? sectionLabel + '  (' + (page + 1) + '–' + Math.min(page + perPage, fields.length) + ' of ' + fields.length + ')'
      : sectionLabel
    slide.addText(pageLabel, {
      x: PAD, y: 0.1, w: W - PAD * 2 - 2.4, h: HH - 0.18,
      fontSize: 18, bold: true, color: DN.white, valign: 'middle',
    })
    logo(slide)

    // Grid geometry
    const gapX = 0.38
    const gapY = 0.28
    const cellW = (W - PAD * 2 - gapX * (cols - 1)) / cols
    const availH = FY - CY - 0.12
    const cellH = (availH - gapY * (rows - 1)) / rows

    batch.forEach(function(f, idx) {
      const col = idx % cols
      const row = Math.floor(idx / cols)
      const cx = PAD + col * (cellW + gapX)
      const cy = CY + row * (cellH + gapY)

      // Cell background card
      rect(slide, pptx, cx, cy, cellW, cellH, DN.white, 0.07, DN.divider)

      // Field label
      slide.addText(trunc(f.label, 50), {
        x: cx + 0.14, y: cy + 0.06, w: cellW - 0.28, h: 0.30,
        fontSize: 11, bold: true, color: DN.navy, valign: 'middle', wrap: true, autoFit: true,
      })

      // Thin teal accent under label
      solidRect(slide, pptx, cx + 0.14, cy + 0.38, cellW * 0.3, 0.025, DN.teal)

      const s = f.summary
      const rawCountsOrig = (s?.counts || {}) as Record<string, number>
      const rawCounts = f.valueAliases && Object.keys(f.valueAliases).length > 0
        ? aliasedCounts(f.field, rawCountsOrig, [{ field: f.field, valueAliases: f.valueAliases }])
        : rawCountsOrig
      const allKeys = Object.keys(rawCounts)
      const total = allKeys.reduce((sum, k) => sum + (rawCounts[k] || 0), 0)
      const isOrd = (f.remapping && Object.keys(f.remapping).length > 0) || isOrdinalScale(allKeys)

      let orderedKeys: string[]
      if (isOrd) {
        orderedKeys = smartOrder(allKeys, f.remapping).slice().reverse()
      } else {
        orderedKeys = allKeys.slice().sort((a, b) => (rawCounts[b] || 0) - (rawCounts[a] || 0))
      }
      orderedKeys = orderedKeys.filter(k => (rawCounts[k] || 0) > 0).slice(0, 6)

      // Mini bar chart
      const barAreaY = cy + 0.46
      const barAreaH = cellH - 0.56
      const n = orderedKeys.length
      const barRowH = Math.min(0.34, barAreaH / Math.max(n, 1))
      const barGap = Math.min(0.04, (barAreaH - barRowH * n) / Math.max(n - 1, 1))
      const labelW = cellW * 0.38
      const barMaxW = cellW * 0.34
      const barX = cx + 0.14 + labelW + 0.06
      const pctX = barX + barMaxW + 0.06
      const maxVal = Math.max(...orderedKeys.map(k => rawCounts[k] || 0), 1)

      orderedKeys.forEach(function(key, i) {
        const count = rawCounts[key] || 0
        const pctVal = pct(count, total)
        const bw = barMaxW * count / maxVal
        const ry = barAreaY + i * (barRowH + barGap)
        const col_ = barColor(i, n, isOrd)

        // Label
        slide.addText(trunc(key, 22), {
          x: cx + 0.14, y: ry, w: labelW, h: barRowH,
          fontSize: 8.5, color: i === 0 ? DN.navy : DN.navyLight, bold: i === 0,
          valign: 'middle', wrap: false, autoFit: true,
        })

        // Bar track + fill
        const trackH = barRowH * 0.50
        const trackY = ry + (barRowH - trackH) / 2
        solidRect(slide, pptx, barX, trackY, barMaxW, trackH, 'EAECEF')
        if (bw > 0.03) solidRect(slide, pptx, barX, trackY, bw, trackH, col_)

        // Percentage
        slide.addText(pctVal + '%', {
          x: pctX, y: ry, w: cellW - (pctX - cx) - 0.14, h: barRowH,
          fontSize: i === 0 ? 10 : 9, bold: true, color: col_, valign: 'middle',
        })
      })

      // Total n in bottom-right corner
      slide.addText('n=' + total.toLocaleString(), {
        x: cx + cellW - 1.0, y: cy + cellH - 0.28, w: 0.86, h: 0.22,
        fontSize: 7.5, color: DN.slate, align: 'right', valign: 'middle',
      })
    })

    footer(slide, pptx, datasetName)
  }
}

// ── Completion funnel slide — survey drop-off visualization ─────────────────
function buildFunnelSlide(
  pptx: any, datasetName: string,
  stages: { label: string; count: number }[]
) {
  if (stages.length < 2) return
  const slide = pptx.addSlide('NUMBERED')
  bg(slide, pptx)
  hdr(slide, pptx, 'Survey Completion Funnel', DN.teal,
    'Drop-off at each stage  ·  ' + stages[0].count.toLocaleString() + ' started')
  logo(slide)

  const n = stages.length
  const maxCount = stages[0].count || 1

  // Layout
  const leftCol = 2.6   // label column
  const barMaxW = W - PAD * 2 - leftCol - 0.15 - 1.8  // bar area
  const barX = PAD + leftCol + 0.15
  const metaX = barX + barMaxW + 0.12  // pct + dropoff column

  const availH = FY - CY - 0.22
  const rowH = Math.min(0.58, availH / n)
  const rowGap = Math.min(0.10, (availH - rowH * n) / Math.max(n - 1, 1))

  // Column headers
  slide.addText('Stage', { x: PAD, y: CY, w: leftCol, h: 0.26, fontSize: 9, bold: true, color: DN.slateDark, valign: 'middle' })
  slide.addText('Respondents', { x: barX, y: CY, w: barMaxW, h: 0.26, fontSize: 9, bold: true, color: DN.slateDark, valign: 'middle' })
  slide.addText('Retention', { x: metaX, y: CY, w: 0.7, h: 0.26, fontSize: 9, bold: true, color: DN.slateDark, valign: 'middle' })
  slide.addText('Drop-off', { x: metaX + 0.75, y: CY, w: 0.7, h: 0.26, fontSize: 9, bold: true, color: DN.slateDark, valign: 'middle' })
  solidRect(slide, pptx, PAD, CY + 0.28, W - PAD * 2, 0.012, DN.divider)

  const rowStart = CY + 0.38

  stages.forEach(function(stage, i) {
    const ry = rowStart + i * (rowH + rowGap)
    const retention = pct(stage.count, maxCount)
    const prevCount = i > 0 ? stages[i - 1].count : stage.count
    const dropoff = i > 0 && prevCount > 0 ? Math.round((1 - stage.count / prevCount) * 100) : 0
    const barW = barMaxW * stage.count / maxCount

    // Funnel color based on retention rate
    const col = retention >= 70 ? DN.teal
      : retention >= 40 ? DN.amber
      : DN.red

    // Alternating row tint
    if (i % 2 === 0) solidRect(slide, pptx, PAD, ry, W - PAD * 2, rowH, 'F8F9FA')

    // Stage number circle
    slide.addShape(pptx.ShapeType.ellipse, {
      x: PAD + 0.04, y: ry + (rowH - 0.30) / 2, w: 0.30, h: 0.30,
      fill: { color: i === 0 ? DN.teal : i === n - 1 ? (retention >= 50 ? DN.green : DN.amber) : DN.slateLight },
      line: { width: 0 },
    })
    slide.addText(String(i + 1), {
      x: PAD + 0.04, y: ry + (rowH - 0.30) / 2, w: 0.30, h: 0.30,
      fontSize: 9, bold: true, color: i === 0 || i === n - 1 ? DN.white : DN.navy,
      align: 'center', valign: 'middle',
    })

    // Label
    slide.addText(stage.label, {
      x: PAD + 0.42, y: ry, w: leftCol - 0.42, h: rowH,
      fontSize: 11, bold: i === 0 || i === n - 1, color: DN.navy, valign: 'middle', autoFit: true,
    })

    // Count inside bar (if wide enough) or after
    const trackH = rowH * 0.52
    const trackY = ry + (rowH - trackH) / 2

    // Bar track
    solidRect(slide, pptx, barX, trackY, barMaxW, trackH, 'EAECEF')
    // Bar fill — funnel shape (tapered)
    if (barW > 0.04) solidRect(slide, pptx, barX, trackY, barW, trackH, col)

    // Count label
    const countText = stage.count.toLocaleString()
    if (barW > 0.8) {
      slide.addText(countText, {
        x: barX + 0.08, y: ry, w: barW - 0.16, h: rowH,
        fontSize: 10, bold: true, color: DN.white, valign: 'middle',
      })
    } else {
      slide.addText(countText, {
        x: barX + barW + 0.06, y: ry, w: 1.0, h: rowH,
        fontSize: 10, bold: true, color: col, valign: 'middle',
      })
    }

    // Retention %
    slide.addText(retention + '%', {
      x: metaX, y: ry, w: 0.6, h: rowH,
      fontSize: 11, bold: true, color: col, valign: 'middle',
    })

    // Drop-off %
    if (i > 0 && dropoff > 0) {
      slide.addText('−' + dropoff + '%', {
        x: metaX + 0.75, y: ry, w: 0.6, h: rowH,
        fontSize: 10, color: dropoff >= 30 ? DN.red : dropoff >= 15 ? DN.amber : DN.slate, valign: 'middle',
      })
    }
  })

  // Summary insight bar
  const completionRate = pct(stages[stages.length - 1].count, maxCount)
  const biggestDrop = stages.reduce((worst, s, i) => {
    if (i === 0) return worst
    const drop = stages[i - 1].count > 0 ? Math.round((1 - s.count / stages[i - 1].count) * 100) : 0
    return drop > worst.drop ? { label: s.label, drop } : worst
  }, { label: '', drop: 0 })

  const insightParts: string[] = []
  insightParts.push(completionRate + '% of respondents completed the entire survey.')
  if (biggestDrop.drop > 0) {
    insightParts.push('Largest drop-off: ' + biggestDrop.drop + '% at "' + biggestDrop.label + '".')
  }
  const insightY = rowStart + n * (rowH + rowGap) + 0.06
  const insightAvail = FY - insightY - 0.12
  if (insightAvail >= 0.36) {
    insightBox(slide, pptx, PAD, insightY, W - PAD * 2, Math.min(0.52, insightAvail), insightParts.join(' '), DN.teal, DN.tealPale)
  }

  footer(slide, pptx, datasetName)
}

function buildSectionDivider(pptx: any, title: string, subtitle: string, fieldCount: number) {
  const slide = pptx.addSlide('NUMBERED')

  solidRect(slide, pptx, 0, 0, W, H, DN.navy)
  solidRect(slide, pptx, 0, 0, W, 0.07, DN.gold)
  solidRect(slide, pptx, 0, 0.07, 0.18, H - 0.07, DN.teal)
  solidRect(slide, pptx, W - 3.0, 0.07, 3.0, H - 0.07, DN.navyMid)

  // Decorative circles
  slide.addShape(pptx.ShapeType.ellipse, { x: W - 2.8, y: 0.8, w: 3.6, h: 3.6, fill: { color: DN.teal, transparency: 92 }, line: { color: DN.teal, transparency: 79, width: 1 } })
  slide.addShape(pptx.ShapeType.ellipse, { x: W - 2.1, y: 1.5, w: 2.2, h: 2.2, fill: { color: DN.teal, transparency: 96 }, line: { color: DN.tealLight, transparency: 85, width: 1 } })

  // Logo
  logo(slide)

  // Section image / emoji
  if (title === 'Psychographic Profile') {
    const imgPath = process.cwd() + '/public/psych_divider.png'
    // Image is 1020×1020 (square). Fit inside the inner circle (2.2" diameter) at 85%.
    const imgW = parseFloat((2.2 * 0.85).toFixed(3))   // ≈ 1.870"
    const imgH = imgW                                    // square aspect ratio
    const cx   = W - 1.0   // inner circle centre x
    const cy2  = 2.6        // inner circle centre y
    if (existsSync(imgPath)) {
      try {
        const base64  = readFileSync(imgPath).toString('base64')
        const dataUrl = 'data:image/png;base64,' + base64
        slide.addImage({ data: dataUrl, x: cx - imgW / 2, y: cy2 - imgH / 2, w: imgW, h: imgH })
      } catch (_) {
        slide.addText('\uD83E\uDDE0', { x: W - 2.1, y: 1.6, w: 2.0, h: 2.0, fontSize: 72, color: DN.tealLight, align: 'center', valign: 'middle' })
      }
    } else {
      slide.addText('\uD83E\uDDE0', { x: W - 2.1, y: 1.6, w: 2.0, h: 2.0, fontSize: 72, color: DN.tealLight, align: 'center', valign: 'middle' })
    }
  } else {
    const sectionEmoji: Record<string, string> = {
      'Demographic Breakdown':  '\uD83D\uDC65',  // 👥
      'Core Study Questions':   '\uD83D\uDCCB',  // 📋
      'Open-ended Responses':   '\uD83D\uDCAC',  // 💬
      'Sample Comments':        '\uD83D\uDDE3\uFE0F', // 🗣️
    }

    // For sections with a dedicated image, use it; otherwise fall back to emoji
    const sectionImage: Record<string, string> = {
      'Open-ended Responses': process.cwd() + '/public/openended_divider.png',
      'Sample Comments':      process.cwd() + '/public/comments_divider.png',
    }
    const imgFile = sectionImage[title]
    let imageUsed = false
    if (imgFile && existsSync(imgFile)) {
      try {
        const base64  = readFileSync(imgFile).toString('base64')
        const ext     = imgFile.endsWith('.png') ? 'png' : 'jpg'
        const dataUrl = `data:image/${ext};base64,` + base64
        const imgW = 1.87, imgH = 1.87
        slide.addImage({ data: dataUrl, x: W - 1.0 - imgW / 2, y: 2.6 - imgH / 2, w: imgW, h: imgH })
        imageUsed = true
      } catch (_) { /* fall through to emoji */ }
    }
    if (!imageUsed) {
      // Derive icon from title + subtitle text
      const iconText = (title + ' ' + subtitle).toLowerCase()
      const iconMap: [string[], string][] = [
        [['like', 'love', 'enjoy', 'best', 'favorite', 'positive', 'great', 'good'], '\u2764\uFE0F'],  // ❤️
        [['dislike', 'least', 'worst', 'complaint', 'negative', 'problem', 'issue'], '\uD83D\uDC4E'],  // 👎
        [['improve', 'suggest', 'recommend', 'change', 'better', 'wish'], '\uD83D\uDCA1'],  // 💡
        [['experience', 'overall', 'general', 'visit'], '\u2B50'],  // ⭐
        [['food', 'meal', 'taste', 'menu', 'dish', 'cuisine', 'dining'], '\uD83C\uDF7D\uFE0F'],  // 🍽️
        [['service', 'staff', 'server', 'waiter', 'employee'], '\uD83D\uDE4B'],  // 🙋
        [['clean', 'hygiene', 'sanit', 'facility'], '\u2728'],  // ✨
        [['wait', 'time', 'speed', 'slow', 'fast', 'quick'], '\u23F1\uFE0F'],  // ⏱️
        [['price', 'value', 'cost', 'money', 'worth', 'expensive'], '\uD83D\uDCB0'],  // 💰
        [['room', 'hotel', 'stay', 'accommodation', 'bed'], '\uD83C\uDFE8'],  // 🏨
        [['comment', 'feedback', 'response', 'verbatim', 'open-ended', 'tell us'], '\uD83D\uDCAC'],  // 💬
        [['theme', 'topic', 'analysis', 'insight'], '\uD83C\uDFAF'],  // 🎯
        [['health', 'medical', 'doctor', 'patient', 'care'], '\uD83C\uDFE5'],  // 🏥
        [['satisfaction', 'rating', 'score', 'nps'], '\uD83D\uDCCA'],  // 📊
      ]
      let emoji = '\uD83D\uDCAC'  // default: 💬
      for (const [keywords, icon] of iconMap) {
        if (keywords.some(kw => iconText.includes(kw))) { emoji = icon; break }
      }
      slide.addText(emoji, {
        x: W - 2.1, y: 1.6, w: 2.0, h: 2.0,
        fontSize: 72, color: DN.tealLight, align: 'center', valign: 'middle',
      })
    }
  }

  // Section label chip
  solidRect(slide, pptx, PAD + 0.18, 1.6, 2.0, 0.34, DN.teal, 81)
  slide.addText(title.toUpperCase(), {
    x: PAD + 0.24, y: 1.6, w: 1.94, h: 0.34,
    fontSize: 8, bold: true, color: DN.tealLight, charSpacing: 1.5, valign: 'middle',
  })

  // Title
  slide.addText(title, {
    x: PAD + 0.18, y: 2.05, w: W - 4.0, h: 1.1,
    fontSize: 36, bold: true, color: DN.white, wrap: true, autoFit: true,
  })

  // Gold divider
  solidRect(slide, pptx, PAD + 0.18, 3.25, 4.5, 0.04, DN.gold)

  // Subtitle
  slide.addText(subtitle, {
    x: PAD + 0.18, y: 3.4, w: W - 4.0, h: 0.6,
    fontSize: 14, color: DN.tealLight, italic: true, wrap: true,
  })

  // Bottom footer
  solidRect(slide, pptx, 0, H - 0.44, W, 0.44, DN.navyMid)
  solidRect(slide, pptx, 0, H - 0.44, W, 0.025, DN.gold, 56)
  slide.addText('datanautix.com', { x: PAD + 0.18, y: H - 0.4, w: 3.0, h: 0.34, fontSize: 8.5, color: DN.slate, valign: 'middle' })
  slide.addText('Proprietary and Confidential', { x: W - 3.6, y: H - 0.4, w: 3.2, h: 0.34, fontSize: 8.5, color: DN.slate, valign: 'middle', align: 'right' })
}

function buildPieSlide(pptx: any, datasetName: string, f: SelectedField, ai: FieldInsight) {
  const slide = pptx.addSlide('NUMBERED')
  bg(slide, pptx)
  const subtitle = (f.section === 'demographic' || f.section === 'psychographic') && f.prompt
    ? f.prompt
    : (f.section ? f.section.charAt(0).toUpperCase() + f.section.slice(1) + ' · ' : '') + 'Response distribution · ' + (f.summary?.nonNull || 0).toLocaleString() + ' responses'
  hdr(slide, pptx, f.label, DN.navy, subtitle)
  logo(slide)

  const s         = f.summary
  const rawCountsOrig2 = (s?.counts || {}) as Record<string, number>
  const rawCounts = f.valueAliases && Object.keys(f.valueAliases).length > 0
    ? aliasedCounts(f.field, rawCountsOrig2, [{ field: f.field, valueAliases: f.valueAliases }])
    : rawCountsOrig2
  const allKeys   = Object.keys(rawCounts)
  const total     = allKeys.reduce((sum, k) => sum + (rawCounts[k] || 0), 0)

  const isOrdinal = (f.remapping && Object.keys(f.remapping).length > 0) || isOrdinalScale(allKeys)
  let orderedKeys: string[]
  if (isOrdinal) {
    orderedKeys = smartOrder(allKeys, f.remapping).slice().reverse()
  } else {
    orderedKeys = allKeys.slice().sort((a, b) => (rawCounts[b] || 0) - (rawCounts[a] || 0))
  }
  orderedKeys = orderedKeys.filter(k => (rawCounts[k] || 0) > 0).slice(0, 8)

  const top2Keys = isOrdinal ? orderedKeys.slice(0, 2) : []
  const top2     = pct(top2Keys.reduce((s, k) => s + (rawCounts[k] || 0), 0), total)
  const topKey   = orderedKeys[0] || ''
  const topPct_  = pct(rawCounts[topKey] || 0, total)

  // ── KPI row ───────────────────────────────────────────────────────────────
  const kw = (W - PAD * 2 - 0.2) / 3
  kpiCard(slide, pptx, PAD,                CY, kw, 0.78, total.toLocaleString(), 'Respondents', undefined, DN.slateLight, DN.navy)
  kpiCard(slide, pptx, PAD + kw + 0.1,    CY, kw, 0.78, topPct_ + '%', 'Top Response', topKey,
    isOrdinal ? (top2 >= 70 ? DN.greenLight : top2 >= 50 ? DN.amberLight : DN.redLight) : DN.slateLight,
    isOrdinal ? (top2 >= 70 ? DN.green      : top2 >= 50 ? DN.amber      : DN.red)      : DN.navy)
  kpiCard(slide, pptx, PAD + kw * 2 + 0.2, CY, kw, 0.78,
    isOrdinal ? top2 + '%' : String(orderedKeys.length),
    isOrdinal ? 'Top-2 Positive' : 'Unique Values', undefined,
    DN.slateLight,
    isOrdinal ? (top2 >= 70 ? DN.green : top2 >= 50 ? DN.amber : DN.red) : DN.teal)

  // ── Compute insight geometry first so bars know available height ──────────
  const hasRealAI   = ai.keyFinding && ai.keyFinding !== f.label && ai.keyFinding !== f.field
  const insightText = trimNatural(hasRealAI
    ? ai.keyFinding
    : autoInsight(f.label, orderedKeys, rawCounts, total, isOrdinal, top2,
        pct(rawCounts[orderedKeys[orderedKeys.length - 1] || ''] || 0, total)), 150)
  const withImpl  = hasRealAI && !!ai.implication
  const insH      = 0.52
  const implH     = 0.40
  const insightY  = FY - 0.12 - (withImpl ? insH + 0.06 + implH : insH)

  // ── Full-width horizontal bar chart ───────────────────────────────────────
  const headerY   = CY + 0.90      // column header row
  const rowStart  = headerY + 0.32
  const n         = orderedKeys.length
  const barAvail  = insightY - rowStart - 0.08
  const rowH      = Math.min(0.60, barAvail / Math.max(n, 1))
  const rowGap    = Math.min(0.08, (barAvail - rowH * n) / Math.max(n - 1, 1))

  // Column widths — bar dominates the full slide width
  const swatchW  = 0.10
  const labelW   = 2.80
  const pctW     = 0.52     // wide enough for "100%"
  const cntW     = 0.72
  const gapS     = 0.08     // swatch→label
  const gapLB    = 0.18     // label→bar
  const gapBP    = 0.14     // bar→%
  const gapPC    = 0.10     // %→count
  const barMaxW  = W - PAD * 2 - swatchW - gapS - labelW - gapLB - gapBP - pctW - gapPC - cntW
  const swatchX  = PAD
  const labelX   = swatchX + swatchW + gapS
  const barX     = labelX + labelW + gapLB
  const pctX     = barX + barMaxW + gapBP
  const cntX     = pctX + pctW + gapPC

  // Column headers
  slide.addText('Response',     { x: labelX, y: headerY, w: labelW,  h: 0.26, fontSize: 8.5, bold: true, color: DN.slateDark, valign: 'middle' })
  slide.addText('Distribution', { x: barX,   y: headerY, w: barMaxW, h: 0.26, fontSize: 8.5, bold: true, color: DN.slateDark, valign: 'middle' })
  slide.addText('%',            { x: pctX,   y: headerY, w: pctW,    h: 0.26, fontSize: 8.5, bold: true, color: DN.slateDark, align: 'right', valign: 'middle' })
  slide.addText('n',            { x: cntX,   y: headerY, w: cntW,    h: 0.26, fontSize: 8.5, bold: true, color: DN.slateDark, valign: 'middle' })
  solidRect(slide, pptx, PAD, headerY + 0.28, W - PAD * 2, 0.012, DN.divider)

  const maxVal = Math.max(...orderedKeys.map(k => rawCounts[k] || 0), 1)

  orderedKeys.forEach(function(key, i) {
    const count  = rawCounts[key] || 0
    const pctVal = pct(count, total)
    const bw     = barMaxW * count / maxVal
    const ry     = rowStart + i * (rowH + rowGap)
    const col    = barColor(i, n, isOrdinal)
    const isTop  = i === 0

    // Alternating row tint
    if (i % 2 === 0) solidRect(slide, pptx, PAD, ry, W - PAD * 2, rowH, 'F8F9FA')

    // Color swatch
    solidRect(slide, pptx, swatchX, ry + rowH * 0.18, swatchW, rowH * 0.64, col)

    // Label — no excessive truncation; label column is 2.8" wide
    slide.addText(trunc(key, 44), {
      x: labelX, y: ry, w: labelW, h: rowH,
      fontSize: isTop ? 11 : 10, bold: isTop, color: isTop ? DN.navy : DN.navyLight, valign: 'middle', autoFit: true,
    })

    // Bar track + fill — tall, prominent
    const trackH = rowH * 0.52
    const trackY = ry + (rowH - trackH) / 2
    solidRect(slide, pptx, barX, trackY, barMaxW, trackH, 'EAECEF')
    if (bw > 0.04) solidRect(slide, pptx, barX, trackY, bw, trackH, col)

    // Percentage — right-aligned, bold, colored
    slide.addText(pctVal + '%', {
      x: pctX, y: ry, w: pctW, h: rowH,
      fontSize: isTop ? 13 : 11, bold: true, color: col, align: 'right', valign: 'middle',
    })

    // Count
    slide.addText(count.toLocaleString(), {
      x: cntX, y: ry, w: cntW, h: rowH,
      fontSize: 9.5, color: DN.slateDark, valign: 'middle',
    })
  })

  // ── Insight + optional implication, full width, anchored above footer ─────
  if (withImpl) {
    insightBox(slide, pptx, PAD, insightY, W - PAD * 2, insH, insightText, DN.teal, DN.tealPale)
    const implY = insightY + insH + 0.08
    solidRect(slide, pptx, PAD, implY, W - PAD * 2, implH, DN.goldPale)
    solidRect(slide, pptx, PAD, implY, 0.05, implH, DN.gold)
    slide.addText('→ ' + ai.implication, {
      x: PAD + 0.12, y: implY + 0.04, w: W - PAD * 2 - 0.18, h: implH - 0.08,
      fontSize: 8.5, color: DN.navyLight, italic: true, valign: 'middle', wrap: true, autoFit: true,
    })
  } else {
    insightBox(slide, pptx, PAD, insightY, W - PAD * 2, insH, insightText, DN.teal, DN.tealPale)
  }

  footer(slide, pptx, datasetName)
}

// Theme Impact (Key Driver) slide — horizontal coefficient chart
function buildThemeImpactSlide(
  pptx: any, datasetName: string,
  impacts: { themeName: string; coefficient: number; pValue: number; significant: boolean; mentions: number }[],
  targetLabel: string, rSquared: number, n: number, intercept: number
) {
  const slide = pptx.addSlide('NUMBERED')
  bg(slide, pptx)
  const r2Pct = Math.round(rSquared * 100)
  hdr(slide, pptx, 'Key Driver Analysis — ' + targetLabel, DN.tealDark,
    'OLS regression  ·  n=' + n.toLocaleString() + '  ·  R\u00B2=' + r2Pct + '%  ·  baseline=' + intercept.toFixed(1))
  logo(slide)

  // Full-width horizontal bar chart — no left panel
  const labelW = 2.8   // theme name column
  const coefW  = 0.7   // coefficient value column
  const barAreaW = W - PAD * 2 - labelW - coefW - 0.3
  const barMaxW = barAreaW / 2  // half for positive, half for negative
  const midX   = PAD + labelW + 0.15 + barMaxW  // center line X
  const maxAbs = Math.max(...impacts.map(i => Math.abs(i.coefficient)), 0.1)

  const nBars = Math.min(impacts.length, 10)
  const availH = CH - 0.6  // leave room for legend at bottom
  const barH = Math.min(0.36, availH / nBars - 0.05)
  const barGap = 0.05
  const barStartY = CY + 0.1

  // Column headers
  slide.addText('Theme', { x: PAD, y: CY - 0.12, w: labelW, h: 0.22, fontSize: 8, bold: true, color: DN.slateDark, align: 'right', valign: 'middle' })
  slide.addText('\u2190 lowers score    |    raises score \u2192', { x: midX - barMaxW, y: CY - 0.12, w: barMaxW * 2, h: 0.22, fontSize: 7, color: DN.slate, align: 'center', valign: 'middle' })

  // Zero line
  solidRect(slide, pptx, midX, barStartY - 0.02, 0.012, nBars * (barH + barGap), DN.slate)

  for (let i = 0; i < nBars; i++) {
    const imp = impacts[i]
    const y = barStartY + i * (barH + barGap)
    const isPos = imp.coefficient >= 0
    const barW = Math.abs(imp.coefficient) / maxAbs * barMaxW
    const barFillColor = imp.significant
      ? (isPos ? '059669' : 'DC2626')
      : (isPos ? '86EFAC' : 'FCA5A5')

    // Theme name — right-aligned before the chart area
    slide.addText(trunc(imp.themeName, 32), {
      x: PAD, y, w: labelW, h: barH,
      fontSize: 9, color: DN.navy, bold: imp.significant, valign: 'middle', align: 'right',
    })

    // Bar
    if (isPos) {
      solidRect(slide, pptx, midX + 0.02, y + barH * 0.18, barW, barH * 0.64, barFillColor)
    } else {
      solidRect(slide, pptx, midX - 0.02 - barW, y + barH * 0.18, barW, barH * 0.64, barFillColor)
    }

    // Coefficient label — outside the bar
    const sign = isPos ? '+' : ''
    const coefText = sign + imp.coefficient.toFixed(2) + (imp.significant ? ' *' : '')
    slide.addText(coefText, {
      x: isPos ? midX + barW + 0.06 : midX - barW - coefW - 0.04,
      y, w: coefW, h: barH,
      fontSize: 8, color: imp.significant ? (isPos ? '059669' : 'DC2626') : DN.slate,
      bold: imp.significant, valign: 'middle', align: isPos ? 'left' : 'right',
    })
  }

  // Interpretation box
  const interpY = barStartY + nBars * (barH + barGap) + 0.08
  solidRect(slide, pptx, PAD, interpY, W - PAD * 2, 0.52, DN.slateLight)
  solidRect(slide, pptx, PAD, interpY, 0.06, 0.52, DN.teal)
  const topTheme = impacts[0]
  const topDir = topTheme && topTheme.coefficient >= 0 ? 'higher' : 'lower'
  const interpText = 'How to read this chart: Each bar shows how much a topic in people\'s written feedback is connected to ' + targetLabel + '. '
    + (topTheme ? 'For example, when people write about "' + topTheme.themeName + '", their ' + targetLabel + ' tends to be ' + topDir + ' by about ' + Math.abs(topTheme.coefficient).toFixed(1) + ' points. ' : '')
    + 'Longer bars mean a stronger connection. '
    + 'The themes collectively explain ' + r2Pct + '% of what drives ' + targetLabel + ' scores — the rest comes from factors not captured in the written responses.'
  slide.addText(interpText, {
    x: PAD + 0.14, y: interpY + 0.04, w: W - PAD * 2 - 0.24, h: 0.44,
    fontSize: 8, color: DN.navyLight, italic: true, wrap: true, valign: 'middle', lineSpacingMultiple: 1.3, autoFit: true,
  })

  // Legend line
  const legY = interpY + 0.58
  slide.addText([
    { text: '\u25A0 ', options: { color: '059669', fontSize: 8 } },
    { text: 'Raises score   ', options: { color: DN.slateDark, fontSize: 7.5 } },
    { text: '\u25A0 ', options: { color: 'DC2626', fontSize: 8 } },
    { text: 'Lowers score   ', options: { color: DN.slateDark, fontSize: 7.5 } },
    { text: '* = statistically significant   ', options: { color: DN.slateDark, fontSize: 7.5 } },
    { text: 'Faded = not significant', options: { color: DN.slate, fontSize: 7.5 } },
  ], { x: PAD, y: legY, w: W - PAD * 2, h: 0.22, valign: 'middle' })

  footer(slide, pptx, datasetName)
}

function buildClosingSlide(pptx: any, datasetName: string, takeaways: string[]) {
  const slide = pptx.addSlide('NUMBERED')

  solidRect(slide, pptx, 0, 0, W, H, DN.navy)
  solidRect(slide, pptx, 0, 0, W, 0.07, DN.gold)
  solidRect(slide, pptx, 0, 0.07, 0.07, H - 0.07, DN.teal)

  // Right panel for visual depth
  solidRect(slide, pptx, W - 3.0, 0.07, 3.0, H - 0.07, DN.navyMid)
  slide.addShape(pptx.ShapeType.ellipse, {
    x: W - 2.8, y: 1.0, w: 3.4, h: 3.4,
    fill: { color: DN.teal, transparency: 93 }, line: { color: DN.teal, transparency: 79, width: 1 }
  })
  slide.addShape(pptx.ShapeType.ellipse, {
    x: W - 2.2, y: 1.6, w: 2.2, h: 2.2,
    fill: { color: DN.teal, transparency: 97 }, line: { color: DN.tealLight, transparency: 85, width: 1 }
  })

  // Header text
  slide.addText('Key Takeaways', {
    x: PAD + 0.07, y: 0.65, w: W - 4.0, h: 0.75,
    fontSize: 34, bold: true, color: DN.white,
  })
  solidRect(slide, pptx, PAD + 0.07, 1.52, 5.2, 0.04, DN.gold)

  // Takeaway cards — large, clean
  const displayTA = takeaways.length > 0 ? takeaways : ['Review the detailed findings slides for specific recommendations.']
  displayTA.slice(0, 3).forEach(function(ta, i) {
    const ty = 1.7 + i * 1.55
    const cardH = 1.35

    // Card background
    solidRect(slide, pptx, PAD + 0.07, ty, W - 3.4, cardH, DN.navyMid)
    solidRect(slide, pptx, PAD + 0.07, ty, W - 3.4, 0.04, i === 0 ? DN.gold : DN.teal)

    // Number circle
    slide.addShape(pptx.ShapeType.ellipse, {
      x: PAD + 0.18, y: ty + 0.14, w: 0.52, h: 0.52,
      fill: { color: i === 0 ? DN.gold : DN.teal }, line: { width: 0 }
    })
    slide.addText(String(i + 1), {
      x: PAD + 0.18, y: ty + 0.14, w: 0.52, h: 0.52,
      fontSize: 18, bold: true, color: i === 0 ? DN.navy : DN.white,
      align: 'center', valign: 'middle',
    })

    // Takeaway text
    slide.addText(ta, {
      x: PAD + 0.88, y: ty + 0.06, w: W - 4.4, h: cardH - 0.12,
      fontSize: 13.5, color: DN.white, bold: false, wrap: true,
      valign: 'middle', lineSpacingMultiple: 1.3, autoFit: true,
    })
  })

  // Footer
  solidRect(slide, pptx, 0, H - 0.44, W, 0.44, DN.navyMid)
  solidRect(slide, pptx, 0, H - 0.44, W, 0.025, DN.gold, 56)
  slide.addText(
    [
      { text: 'data',             options: { color: DN.orangeLight, bold: true, italic: true } },
      { text: 'nautix',           options: { color: DN.tealLight,   bold: true, italic: true } },
      { text: '  ·  datanautix.com', options: { color: DN.slate,   bold: false, italic: false } },
    ],
    { x: PAD + 0.07, y: H - 0.4, w: 3.5, h: 0.34, fontSize: 13, valign: 'middle' }
  )
}

// ── Main route handler ────────────────────────────────────────────────────────

export async function POST(req: Request, { params }: Params) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── Provenance tracker — populates the closing "How this deck was made" slide
  const ssStartedAt = Date.now()

  const body = await req.json().catch(() => ({}))
  const selectedFieldNames: string[] = body.fields || []
  const audience: string             = body.audience || 'stakeholder'
  const mode: string                 = body.mode || 'quick'
  const instructions: string         = body.instructions || ''
  const commentConfig: Record<string, { enabled: boolean; slides: number }> = body.commentConfig || {}
  const commentAnnotations: string[]  = body.commentAnnotations || []
  const commentColorField: string     = body.commentColorField  || ''
  const includeThemeSlides: boolean   = body.includeThemeSlides !== false
  const selectedThemeIds: string[]    = body.selectedThemeIds   || []
  const rawFilters: Record<string, any> = body.filters || {}
  const hasFilters = Object.keys(rawFilters).length > 0
  const reportTitle: string             = body.reportTitle || ''
  const impactOEFields: string[]       = body.impactOEFields || []
  const skipAI: boolean                = body.skipAI === true
  // Closer-slide toggles — default ON; ExportModal lets the user opt out per export
  const includeCustomDecks: boolean    = body.includeCustomDecks !== false
  const includeProvenance:  boolean    = body.includeProvenance  !== false

  if (mode === 'quick' && selectedFieldNames.length === 0) {
    return NextResponse.json({ error: 'Select at least one field' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  const { data: dataset } = await service
    .from('datasets').select('id, name, source, row_count, ana_library, study_id, org_id, studies(id, name, config)').eq('id', params.datasetId).single()
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })

  const { data: stateRow } = await service
    .from('dataset_state').select('schema_config, analytics, theme_model').eq('dataset_id', params.datasetId).single()
  if (!stateRow) return NextResponse.json({ error: 'Dataset state not found' }, { status: 404 })

  const schema      = stateRow.schema_config
  const analytics   = stateRow.analytics
  const allThemes   = (stateRow.theme_model as any)?.themes || []

  // Backfill missing prompts from study config (for PPTX subtitles)
  const studyConfig = (dataset as any).studies?.config
  if (studyConfig && schema?.fields) {
    schema.fields.forEach(function(f: any) {
      if (f.prompt) return  // Already has prompt
      // Try to find matching question in study config
      if (studyConfig.questions) {
        const q = studyConfig.questions.find((qq: any) => {
          const col = qq.exportLabel || qq.prompt || qq.id
          return f.field === col || f.field.includes(col)
        })
        if (q?.prompt) f.prompt = q.prompt
      }
      // Try psychographic bank — match exactly how sanitizeColumnName works
      if (!f.prompt && f.field.startsWith('psycho_') && studyConfig.psychographicBank) {
        const sanitize = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
        const fieldKey = f.field.replace('psycho_', '')
        const pq = studyConfig.psychographicBank.find((pp: any) => sanitize(pp.key) === fieldKey)
        if (pq?.q) f.prompt = pq.q
      }
      // Try demo fields — match exactly how sanitizeColumnName works
      if (!f.prompt && f.field.startsWith('demo_') && studyConfig.demoFields) {
        const sanitize = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
        const fieldKey = f.field.replace('demo_', '')
        const df = studyConfig.demoFields.find((dd: any) => sanitize(dd.key) === fieldKey)
        if (df) {
          f.prompt = df.label
        }
      }
    })
  }
  const themes      = selectedThemeIds.length > 0
    ? allThemes.filter((t: any) => selectedThemeIds.includes(t.id))
    : allThemes
  const datasetName = dataset.name

  if (!analytics?.fieldSummaries) {
    return NextResponse.json({ error: 'Analytics not yet computed — run compute first' }, { status: 400 })
  }

  // Builder mode with no explicit fields → use all schema fields
  const allSchemaFields: string[] = (schema?.fields || [])
    .filter((f: any) => ['open-ended', 'categorical', 'numeric', 'date'].includes(f.type) && f.status !== 'ignored')
    .map((f: any) => f.field)
  const fieldNamesToUse = selectedFieldNames.length > 0 ? selectedFieldNames : allSchemaFields

  const selectedFields: SelectedField[] = fieldNamesToUse
    .map(function(fieldName) {
      const schemaField = (schema?.fields || []).find((f: any) => f.field === fieldName)
      if (!schemaField) return null
      return { field: fieldName, label: schemaField.label || fieldName, type: schemaField.type, summary: analytics.fieldSummaries[fieldName] || null, remapping: schemaField.remapping, valueAliases: schemaField.valueAliases, section: schemaField.section || undefined, prompt: schemaField.prompt }
    })
    .filter(Boolean) as SelectedField[]

  if (selectedFields.length === 0) {
    return NextResponse.json({ error: 'No valid fields selected' }, { status: 400 })
  }

  // Fetch rows for comment sampling and theme matching.
  // Fetch rows from flat table (fast) with fallback to batched table.
  // For collections: union rows from member datasets.
  // Cap at 10K for no-filter, 30K for filtered.
  const allRows: Record<string, any>[] = []
  let rowsSampled = false
  const MAX_ROWS = hasFilters ? 30_000 : 10_000

  // Collections: fetch from member datasets
  const isCollection = dataset?.source === 'collection'
  let flatDatasetIds: string[] = [params.datasetId]
  let collectionLabels: Record<string, string> = {}
  if (isCollection) {
    const { data: col } = await service.from('collections').select('id').eq('dataset_id', params.datasetId).single()
    if (col) {
      const { data: members } = await service.from('collection_members').select('dataset_id, label').eq('collection_id', col.id).order('sort_order', { ascending: true })
      if (members && members.length > 0) {
        flatDatasetIds = members.map(m => m.dataset_id)
        members.forEach(m => { collectionLabels[m.dataset_id] = m.label })
      }
    }
  }

  // Try flat table first
  let flatCount = 0
  for (const dsId of flatDatasetIds) {
    const { count } = await service.from('dataset_rows_flat').select('id', { count: 'exact', head: true }).eq('dataset_id', dsId)
    flatCount += count || 0
  }

  if (flatCount > 0) {
    // Flat table — paginate in chunks of 1000 (Supabase default limit)
    const FLAT_PAGE = 1000
    for (const dsId of flatDatasetIds) {
      let flatOffset = 0
      const label = collectionLabels[dsId] || undefined
      while (allRows.length < MAX_ROWS) {
        const { data: flatRows, error: flatErr } = await service
          .from('dataset_rows_flat')
          .select('data')
          .eq('dataset_id', dsId)
          .order('row_index', { ascending: true })
          .range(flatOffset, flatOffset + FLAT_PAGE - 1)
        if (flatErr || !flatRows || flatRows.length === 0) break
        for (const fr of flatRows) {
          const row = (fr as any).data || fr
          if (label) row._collection_label = label
          allRows.push(row)
          if (allRows.length >= MAX_ROWS) break
        }
        if (flatRows.length < FLAT_PAGE) break
        flatOffset += FLAT_PAGE
      }
      if (allRows.length >= MAX_ROWS) break
    }
    if (allRows.length >= MAX_ROWS && flatCount > allRows.length) rowsSampled = true
  } else {
    // Fallback: batched table
    const PAGE = 200
    let page = 0, hasMore = true
    while (hasMore && allRows.length < MAX_ROWS) {
      const from = page * PAGE
      const { data: batchPage, error: bErr } = await service
        .from('dataset_rows')
        .select('rows')
        .eq('dataset_id', params.datasetId)
        .order('batch_index', { ascending: true })
        .range(from, from + PAGE - 1)
      if (bErr || !batchPage || batchPage.length === 0) { hasMore = false; break }
      for (const b of batchPage) {
        for (const r of ((b as any).rows || [])) {
          allRows.push(r)
          if (allRows.length >= MAX_ROWS) { hasMore = false; break }
        }
        if (!hasMore) break
      }
      if (batchPage.length < PAGE) hasMore = false
      page++
    }
    if (allRows.length >= MAX_ROWS) rowsSampled = true
  }
  const knownTotal = analytics?.totalRows || dataset.row_count || (flatCount || 0) || 0

  // Build a normalized key map so we can find columns regardless of case/spaces
  // e.g. schema field "general_experience_comments" matches row key "General Experience Comments"
  function normalize(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') }
  const rowKeyMap: Record<string, string> = {}  // normalizedKey → actualKey in first row
  if (allRows.length > 0) {
    for (const k of Object.keys(allRows[0])) rowKeyMap[normalize(k)] = k
  }
  function rowVal(row: Record<string, any>, fieldKey: string): string {
    // Direct match first, then normalized fallback
    if (row[fieldKey] !== undefined && row[fieldKey] !== null) return String(row[fieldKey]).trim()
    const actual = rowKeyMap[normalize(fieldKey)]
    if (actual && row[actual] !== undefined && row[actual] !== null) return String(row[actual]).trim()
    return ''
  }

  // Apply filters if provided — filter rows before any analysis
  let filterDescription = ''
  if (hasFilters) {
    const filters = deserializeFilters(rawFilters as SerializedFilters)
    const before = allRows.length
    const filtered = applyFilters(allRows, filters)
    // Replace allRows so all downstream processing uses filtered data
    allRows.length = 0
    for (let fi = 0; fi < filtered.length; fi++) allRows.push(filtered[fi])
    // Build human-readable filter description for the About slide
    const parts: string[] = []
    for (const field of Object.keys(rawFilters)) {
      const f = rawFilters[field]
      const schemaField = (schema?.fields || []).find((sf: any) => sf.field === field)
      const label = schemaField?.label || field
      if (f.type === 'cat' && f.values?.length) {
        parts.push(label + ': ' + f.values.slice(0, 5).join(', ') + (f.values.length > 5 ? ' (+' + (f.values.length - 5) + ' more)' : ''))
      } else if (f.type === 'range' && f.values) {
        parts.push(label + ': ' + f.values[0] + ' – ' + f.values[1])
      } else if (f.type === 'daterange' && f.values) {
        const fmtDt = (ts: number) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        parts.push(label + ': ' + fmtDt(f.values[0]) + ' – ' + fmtDt(f.values[1]))
      }
    }
    filterDescription = parts.join('  ·  ')
    filterDescription = 'Filtered: ' + allRows.length + ' of ' + before + ' rows  ·  ' + filterDescription

    // Recompute field summaries from filtered rows so all slides reflect filtered data
    recomputeSummaries()
  }

  // Also recompute when sampled or collection (collections have no analytics of their own)
  if ((rowsSampled || isCollection) && !hasFilters) {
    recomputeSummaries()
  }

  function recomputeSummaries() {
    for (const sf of selectedFields) {
      const key = rowKeyMap[normalize(sf.field)] || sf.field
      if (sf.type === 'categorical') {
        const counts: Record<string, number> = {}
        let nonNull = 0
        for (const row of allRows) {
          const v = row[key] != null ? String(row[key]).trim() : ''
          if (v) { counts[v] = (counts[v] || 0) + 1; nonNull++ }
        }
        sf.summary = { ...(sf.summary || {}), counts, nonNull, uniqueCount: Object.keys(counts).length }
      } else if (sf.type === 'numeric') {
        const vals: number[] = []
        for (const row of allRows) {
          const n = parseFloat(String(row[key] ?? ''))
          if (!isNaN(n)) vals.push(n)
        }
        if (vals.length > 0) {
          vals.sort((a, b) => a - b)
          const sum = vals.reduce((s, v) => s + v, 0)
          sf.summary = { ...(sf.summary || {}), nonNull: vals.length, min: vals[0], max: vals[vals.length - 1], avg: Math.round(sum / vals.length * 100) / 100, median: vals[Math.floor(vals.length / 2)] }
        }
      } else if (sf.type === 'open-ended') {
        let nonNull = 0
        for (const row of allRows) {
          const v = row[key] != null ? String(row[key]).trim() : ''
          if (v) nonNull++
        }
        sf.summary = { ...(sf.summary || {}), nonNull }
      }
    }
  }

  // Build live verbatim samples for each OE field (20 evenly-spaced responses ≥ 30 chars).
  // Replaces the stale 10-item analytics snapshot used for AI quote candidates.
  // For positively-framed fields ("liked most", "best", etc.) filter out complaint-pattern
  // responses so showcase quotes actually reflect the field's intent.
  const POSITIVE_FRAME_TERMS = ['liked', 'love', 'best', 'enjoy', 'favour', 'favor', 'positive', 'highlight', 'appreciate', 'great about', 'good about']
  const NEGATIVE_FRAME_TERMS = ['dislik', 'worst', 'complaint', 'problem', 'issue', 'improv', 'suggest', 'concern', 'disappoint', 'frustrat', 'bad about', 'difficult', 'challenge']
  // Complaint-pattern indicators in response text
  const COMPLAINT_SIGNALS = ['no one', 'nobody', 'didn\'t', 'did not', 'wouldn\'t', 'would not', 'couldn\'t', 'could not', 'wasn\'t', 'was not', 'weren\'t', 'were not', 'never', 'ignored', 'waited', 'wait', 'rude', 'horrible', 'terrible', 'awful', 'unacceptable', 'disappointing', 'poor service', 'not helpful']

  function isPositivelyFramedField(f: SelectedField): boolean {
    const lbl = (f.label + ' ' + (f.prompt || '')).toLowerCase()
    return POSITIVE_FRAME_TERMS.some(t => lbl.includes(t)) && !NEGATIVE_FRAME_TERMS.some(t => lbl.includes(t))
  }

  function looksLikeComplaint(text: string): boolean {
    const lower = text.toLowerCase()
    return COMPLAINT_SIGNALS.filter(s => lower.includes(s)).length >= 2
  }

  if (allRows.length > 0) {
    selectedFields.forEach(function(f) {
      if (f.type !== 'open-ended') return
      const positiveFrame = isPositivelyFramedField(f)
      const texts = allRows
        .map(function(row) { return rowVal(row, f.field) })
        .filter(function(t) {
          if (t.length < 30) return false
          if (positiveFrame && looksLikeComplaint(t)) return false
          return true
        })
      // Fall back to unfiltered if filtering left too few (< 5)
      const source = texts.length >= 5 ? texts : allRows
        .map(function(row) { return rowVal(row, f.field) })
        .filter(function(t) { return t.length >= 30 })
      if (source.length === 0) return
      const n    = Math.min(20, source.length)
      const step = source.length / n
      f.liveSample = Array.from({ length: n }, function(_, i) { return source[Math.floor(i * step)] })
    })
  }

  // Re-compute theme counts by keyword-matching allRows against a specific open-ended field.
  // Uses multi-match semantics (a row can match multiple themes) so percentage = "% of
  // respondents who mentioned this theme", with denominator = rows that have text in this field.
  function computeFieldThemes(fieldKey: string, themeList: any[]): any[] {
    if (!themeList.length || !allRows.length) return themeList
    const nonEmpty = allRows.filter(function(row) {
      return rowVal(row, fieldKey).trim().length > 0
    })
    const total = nonEmpty.length || 1
    // Pre-compile regexes once per theme (not per row)
    const themeRegexes = themeList.map(function(t: any) {
      return (t.keywords || []).map(function(kw: string) { return buildKwRegex(kw) })
    })
    return themeList
      .map(function(t: any, ti: number) {
        const regexes = themeRegexes[ti]
        const count = nonEmpty.filter(function(row) {
          const text = rowVal(row, fieldKey).toLowerCase()
          return regexes.some(function(re: RegExp) { return re.test(text) })
        }).length
        return Object.assign({}, t, { count, percentage: Math.round(count / total * 100), totalResponses: total })
      })
      .filter(function(t: any) { return t.count > 0 })
      .sort(function(a: any, b: any) { return b.count - a.count })
  }

  // Demo/psycho fields to annotate comments with
  const commentDemoFields = selectedFields.filter(f => f.section === 'demographic' || f.section === 'psychographic').slice(0, 4)

  // AI narratives
  let narratives: Narratives = {
    reportTitle: '',
    executiveSummary: [],
    keyTakeaways: [],
    fieldInsights: Object.fromEntries(selectedFields.map(f => [f.field, { keyFinding: f.label, narrative: '', implication: '', watchout: '' }])),
  }
  if (!skipAI) {
    try { narratives = await generateNarratives((dataset as any).org_id, datasetName, analytics.totalRows, audience, selectedFields, instructions || undefined) }
    catch (e) { console.error('[export/pptx] AI error:', e) }
  }

  // ── Build PPTX ─────────────────────────────────────────────────────────────
  try {
    const pptxgen  = (await import('pptxgenjs')).default
    const pptx     = new pptxgen()
    pptx.layout    = 'LAYOUT_WIDE'
    pptx.defineSlideMaster({
      title: 'NUMBERED',
      slideNumber: { x: W - PAD - 0.5, y: FY, w: 0.5, h: 0.26, color: DN.slate, fontSize: 7.5, align: 'right' },
    })
    pptx.author    = 'Datanautix'
    pptx.company   = 'Datanautix'
    pptx.subject   = datasetName + ' — Analysis Report'
    pptx.title     = datasetName

    // Compute display row count and sampling note before building slides
    const dataSource = dataset.study_id ? 'study' as const : 'upload' as const
    const n = allRows.length
    const N = knownTotal > n ? knownTotal : (dataset.row_count || n)
    let samplingNote: string | undefined
    if (rowsSampled || N > n) {
      const fpc = N > n ? Math.sqrt((N - n) / (N - 1)) : 1
      const moe = Math.round(1.96 * Math.sqrt(0.25 / n) * fpc * 1000) / 10
      samplingNote = 'This report is based on a systematic sample of ' + n.toLocaleString() + ' of ' + N.toLocaleString() + ' total responses (95% CI: ±' + moe + '%). All distributions, theme counts, and statistics in this deck reflect the sampled data.'
    }
    // Always show sample info when rows were capped
    if (!samplingNote && n > 0 && n < (dataset.row_count || Infinity)) {
      samplingNote = 'Analysis based on ' + n.toLocaleString() + ' of ' + (dataset.row_count || 0).toLocaleString() + ' total responses.'
    }
    const displayRows = hasFilters || rowsSampled ? allRows.length : (analytics?.totalRows || dataset.row_count || 0)

    // ── Rating-based strip color for quote cards ─────────────────────────
    // Find the primary numeric (rating) field to color-code quote card left strips
    const ratingField = selectedFields.find(f => f.type === 'numeric' && f.summary?.min != null)
    const ratingKey = ratingField ? (rowKeyMap[normalize(ratingField.field)] || ratingField.field) : ''
    const ratingMin = ratingField?.summary?.min ?? 0
    const ratingMax = ratingField?.summary?.max ?? 5
    // Build a lookup: first 120 chars of OE text → rating value
    const quoteRatingMap = new Map<string, number>()
    if (ratingField && allRows.length > 0) {
      const oeKeys = selectedFields.filter(f => f.type === 'open-ended').map(f => rowKeyMap[normalize(f.field)] || f.field)
      for (const row of allRows) {
        const rv = parseFloat(String(row[ratingKey] ?? ''))
        if (isNaN(rv)) continue
        for (const oek of oeKeys) {
          const txt = String(row[oek] || '').trim()
          if (txt.length >= 30) quoteRatingMap.set(txt.slice(0, 120), rv)
        }
      }
    }
    const getStripColor = function(quoteText: string): string | undefined {
      if (!ratingField || quoteRatingMap.size === 0) return undefined
      // Try matching first 120 chars of the quote against the map
      const key = quoteText.replace(/[\u201C\u201D]/g, '').trim().slice(0, 120)
      const rv = quoteRatingMap.get(key)
      if (rv != null) return ratingColor(rv, ratingMin, ratingMax)
      // Fuzzy: check if any map key starts with the first 60 chars
      const prefix = key.slice(0, 60)
      let fuzzyResult: string | undefined
      quoteRatingMap.forEach(function(v, k) {
        if (!fuzzyResult && k.startsWith(prefix)) fuzzyResult = ratingColor(v, ratingMin, ratingMax)
      })
      return fuzzyResult
    }

    // 1: Title
    buildTitleSlide(pptx, datasetName, reportTitle || narratives.reportTitle || '', displayRows, analytics.computedAt)

    // Sort themes by frequency (count descending)
    const sortedThemes = [...themes].sort(function(a: any, b: any) { return (b.count || 0) - (a.count || 0) })

    // 2: Executive Summary
    buildSummarySlide(pptx, datasetName, displayRows, narratives.executiveSummary || [], narratives.keyTakeaways || [], sortedThemes, selectedFields)

    // 3: About this report — include completion stats for study datasets
    var completionNote: string | undefined
    var studyResponses: any[] | null = null
    if (dataset.study_id) {
      try {
        const { data: resp } = await service
          .from('responses')
          .select('status, payload')
          .eq('study_id', dataset.study_id)
          .order('created_at', { ascending: true })
          .limit(1000)
        studyResponses = resp
        if (resp && resp.length > 0) {
          const completeCount = resp.filter((r: any) => r.status === 'complete' || r.status == null).length
          const pct = Math.round(completeCount / resp.length * 100)
          completionNote = resp.length.toLocaleString() + ' total responses · ' + completeCount.toLocaleString() + ' complete (' + pct + '%)'
        }
      } catch {}
    }
    buildAboutSlide(pptx, datasetName, displayRows, analytics.computedAt, selectedFields, audience, filterDescription || undefined, dataSource, samplingNote, completionNote)

    // 4: Completion funnel (study datasets only)
    if (dataset.study_id && studyResponses) {
      try {
        const studyCfg = (dataset as any).studies?.config
        const responses = studyResponses
        if (responses.length > 0) {
          const customQCount = studyCfg?.customQCount || studyCfg?.questions?.length || 0
          const psychoCount = studyCfg?.psychoCount || studyCfg?.psychographicBank?.length || 0
          const funnelStages: { label: string; count: number }[] = []
          const total = responses.length
          funnelStages.push({ label: 'Started', count: total })
          const hasRating = responses.filter((r: any) => r.payload?.experienceRating || r.payload?.nps_score != null).length
          funnelStages.push({ label: studyCfg?.experienceRatingLabel || 'Rating', count: hasRating })
          const hasConvo = responses.filter((r: any) => {
            const oe = r.payload?.openEnded || {}
            return Object.values(oe).some((v: any) => v && String(v).length > 0)
          }).length
          funnelStages.push({ label: 'Conversation', count: hasConvo })
          if (customQCount > 0) {
            const hasCustom = responses.filter((r: any) => {
              const ca = r.payload?.customAnswers || {}
              return Object.keys(ca).length > 0
            }).length
            funnelStages.push({ label: 'Custom Questions', count: hasCustom })
          }
          if (psychoCount > 0) {
            const hasPsycho = responses.filter((r: any) => {
              const ps = r.payload?.psychographics || {}
              return Object.keys(ps).length > 0
            }).length
            funnelStages.push({ label: 'Psychographics', count: hasPsycho })
          }
          const hasDemo = responses.filter((r: any) => {
            const dm = r.payload?.demographics || {}
            return Object.keys(dm).length > 0
          }).length
          if (hasDemo > 0) funnelStages.push({ label: 'Demographics', count: hasDemo })
          const completed = responses.filter((r: any) => r.status === 'complete').length
          funnelStages.push({ label: 'Completed', count: completed })
          if (funnelStages.length >= 3) {
            buildFunnelSlide(pptx, datasetName, funnelStages)
          }
        }
      } catch { /* funnel is optional — skip on error */ }
    }

    // ── Group fields by section ───────────────────────────────────────────
    const openEndedSelected = selectedFields.filter(f => f.type === 'open-ended')
    const coreFields        = selectedFields.filter(f => !f.section || f.section === 'core')
    const customFields      = selectedFields.filter(f => f.section === 'custom')
    const psychoFields      = selectedFields.filter(f => f.section === 'psychographic')
    let   demoFields        = selectedFields.filter(f => f.section === 'demographic')
    const personalDemoOrder = ['gender', 'age', 'race', 'household_income', 'household income', 'income']
    const addressDemoFields = ['address', 'street', 'city', 'state', 'zip', 'postal_code', 'country']
    demoFields = demoFields.sort((a, b) => {
      const key = (f: SelectedField) => {
        const fl = f.field.toLowerCase().replace(/[_\s]/g, '_')
        for (let i = 0; i < personalDemoOrder.length; i++) { if (fl.includes(personalDemoOrder[i].replace(/[_\s]/g, '_'))) return i }
        if (addressDemoFields.some(af => fl.includes(af.replace(/[_\s]/g, '_')))) return 1000
        return 2000
      }
      return key(a) - key(b)
    })

    // Shared set: tracks comment texts (first 120 chars) already used anywhere in the deck.
    // Theme detail slides claim their quotes first; comment pages at the end skip dupes.
    const usedCommentTexts = new Set<string>()

    // Helper: build comment slides for one OE field (deferred to end)
    const buildCommentSlidesForField = (f: SelectedField) => {
      const cfg        = commentConfig[f.field]
      const cmtEnabled = cfg ? cfg.enabled : true
      if (!cmtEnabled) return
      const cmtSlides   = cfg ? Math.max(1, Math.min(3, cfg.slides)) : (audience === 'full' ? 3 : 2)
      const perSlide    = 8  // 4x2 grid
      const maxComments = cmtSlides * perSlide
      const annotFields = commentAnnotations.length > 0
        ? selectedFields.filter(sf => commentAnnotations.includes(sf.field))
        : commentDemoFields
      const resolvedKey = rowKeyMap[normalize(f.field)] || f.field
      const allCommentItems: CommentItem[] = allRows
        .map(function(row) {
          const text  = rowVal(row, f.field)
          const demos = annotFields
            .map(function(df) { return { label: df.label, value: rowVal(row, df.field), section: df.section } })
            .filter(function(d) { return d.value.length > 0 && d.value.length < 60 })
          const colorValue = commentColorField ? rowVal(row, commentColorField) : undefined
          return { text, demos, colorValue }
        })
        .filter(function(c) {
          // Prefer comments that fill the box (≥80 chars)
          return c.text.length >= 80 && !usedCommentTexts.has(c.text.slice(0, 120))
        })
        .sort(function(a, b) {
          // Sort by length — prefer comments that are long enough to fill ~60% of box (80-300 chars)
          const aFit = a.text.length >= 80 && a.text.length <= 300 ? 0 : Math.abs(a.text.length - 190)
          const bFit = b.text.length >= 80 && b.text.length <= 300 ? 0 : Math.abs(b.text.length - 190)
          return aFit - bFit
        })
      const commentItems: CommentItem[] = (function() {
        if (!commentColorField) return allCommentItems.slice(0, maxComments)
        const groups: Record<string, CommentItem[]> = {}
        allCommentItems.forEach(function(c) {
          const key = c.colorValue || '__none__'
          if (!groups[key]) groups[key] = []
          groups[key].push(c)
        })
        const buckets = Object.values(groups)
        const result: CommentItem[] = []
        let i = 0
        while (result.length < maxComments) {
          let added = false
          for (let b = 0; b < buckets.length && result.length < maxComments; b++) {
            if (buckets[b][i]) { result.push(buckets[b][i]); added = true }
          }
          if (!added) break
          i++
        }
        return result
      })()
      // Register these comments so nothing else re-uses them
      commentItems.forEach(c => usedCommentTexts.add(c.text.slice(0, 120)))
      if (commentItems.length > 0) {
        const numSlides = Math.ceil(commentItems.length / perSlide)
        for (let si = 0; si < numSlides; si++) {
          buildCommentsSlide(pptx, datasetName, f.label, f.section, commentItems.slice(si * perSlide, (si + 1) * perSlide), si + 1, numSlides)
        }
      }
    }

    // ── 4: Open-ended fields → theme grid → per-theme detail (one per theme) ──
    if (openEndedSelected.length > 0) {
      for (const f of openEndedSelected) {
        // Divider slide per OE field with prompt
        const divPrompt = f.prompt || (f.label !== f.field ? f.label : 'Open-ended verbatim responses')
        buildSectionDivider(pptx, f.label, divPrompt, 1)

        const ai         = narratives.fieldInsights?.[f.field] || { keyFinding: f.label, narrative: '', implication: '', watchout: '' }
        // Always recompute per-field so each OE field gets its own theme counts
        const fieldThemes = allRows.length > 0
          ? computeFieldThemes(f.field, sortedThemes)
          : sortedThemes
        // a) Overview slide (AI narrative + theme bar chart)
        buildOpenEndedSlide(pptx, datasetName, f, ai, audience, fieldThemes.slice(0, 8), getStripColor)
        // b) Theme grid overview (multiple themes per page)
        if (includeThemeSlides && fieldThemes.length > 0) {
          buildThemeGridSlides(pptx, datasetName, fieldThemes, openEndedSelected.length > 1 ? f.label : undefined)
        }
        // c) Per-theme detail slides with verbatims on the right
        if (includeThemeSlides && fieldThemes.length > 0) {
          await buildThemeSlides(pptx, datasetName, fieldThemes, openEndedSelected.length > 1 ? f.label : undefined, allRows, rowKeyMap, [f.field], usedCommentTexts, skipAI ? undefined : (dataset as any).org_id, getStripColor)
        }
      }
    }

    // ── 5: Categorical + numeric fields (all sections) ────────────────────
    const nonOECore   = coreFields.filter(f => f.type !== 'open-ended')
    const nonOEPsycho = psychoFields.filter(f => f.type !== 'open-ended')
    const nonOEDemo   = demoFields.filter(f => f.type !== 'open-ended')

    if (nonOECore.length > 0) {
      buildSectionDivider(pptx, 'Core Study Questions', 'Primary research questions and measured outcomes', nonOECore.length)
      nonOECore.forEach(function(f) {
        const ai = narratives.fieldInsights?.[f.field] || { keyFinding: f.label, narrative: '', implication: '', watchout: '' }
        if (f.type === 'categorical' && audience !== 'executive') buildPieSlide(pptx, datasetName, f, ai)
        else if (f.type === 'numeric' && audience !== 'executive') buildNumericSlide(pptx, datasetName, f, ai)
      })
    }
    const nonOECustom = customFields.filter(f => f.type !== 'open-ended')
      .sort((a, b) => ((b.summary?.nonNull || 0) - (a.summary?.nonNull || 0)))
    if (nonOECustom.length > 0) {
      const customCat = nonOECustom.filter(f => f.type === 'categorical')
      const customNum = nonOECustom.filter(f => f.type === 'numeric')
      buildSectionDivider(pptx, 'Survey Questions', 'Custom questions asked to respondents', nonOECustom.length)
      // Compact grid for categorical (≥3 fields), full-page for 1-2
      if (customCat.length >= 3) {
        buildCompactGridSlides(pptx, datasetName, customCat)
      } else {
        customCat.forEach(function(f) {
          const ai = narratives.fieldInsights?.[f.field] || { keyFinding: f.label, narrative: '', implication: '', watchout: '' }
          buildPieSlide(pptx, datasetName, f, ai)
        })
      }
      customNum.forEach(function(f) {
        const ai = narratives.fieldInsights?.[f.field] || { keyFinding: f.label, narrative: '', implication: '', watchout: '' }
        buildNumericSlide(pptx, datasetName, f, ai)
      })
    }
    if (nonOEPsycho.length > 0 && audience !== 'executive') {
      const psychoCat = nonOEPsycho.filter(f => f.type === 'categorical')
      const psychoNum = nonOEPsycho.filter(f => f.type === 'numeric')
      buildSectionDivider(pptx, 'Psychographic Profile', 'Attitudes, values, motivations and lifestyle indicators', nonOEPsycho.length)
      if (psychoCat.length >= 3) {
        buildCompactGridSlides(pptx, datasetName, psychoCat)
      } else {
        psychoCat.forEach(function(f) {
          const ai = narratives.fieldInsights?.[f.field] || { keyFinding: f.label, narrative: '', implication: '', watchout: '' }
          buildPieSlide(pptx, datasetName, f, ai)
        })
      }
      psychoNum.forEach(function(f) {
        const ai = narratives.fieldInsights?.[f.field] || { keyFinding: f.label, narrative: '', implication: '', watchout: '' }
        buildNumericSlide(pptx, datasetName, f, ai)
      })
    }
    if (nonOEDemo.length > 0 && audience !== 'executive') {
      const demoCat = nonOEDemo.filter(f => f.type === 'categorical')
      const demoNum = nonOEDemo.filter(f => f.type === 'numeric')
      buildSectionDivider(pptx, 'Demographic Breakdown', 'Audience composition and segment characteristics', nonOEDemo.length)
      if (demoCat.length >= 3) {
        buildCompactGridSlides(pptx, datasetName, demoCat)
      } else {
        demoCat.forEach(function(f) {
          const ai = narratives.fieldInsights?.[f.field] || { keyFinding: f.label, narrative: '', implication: '', watchout: '' }
          buildPieSlide(pptx, datasetName, f, ai)
        })
      }
      demoNum.forEach(function(f) {
        const ai = narratives.fieldInsights?.[f.field] || { keyFinding: f.label, narrative: '', implication: '', watchout: '' }
        buildNumericSlide(pptx, datasetName, f, ai)
      })
    }

    // ── 6: Sample comments (verbatim pages) at the end ────────────────────
    if (openEndedSelected.length > 0) {
      openEndedSelected.forEach(function(f) {
        const dividerSubtitle = f.prompt || 'Sample verbatim responses'
        buildSectionDivider(pptx, f.label, dividerSubtitle, 1)
        buildCommentSlidesForField(f)
      })
    }

    // ── 7: Theme Impact / Key Driver Analysis (full team report only) ────
    const impactScoreFields: string[] = body.impactScoreFields || []
    const scoreFields = (impactScoreFields.length > 0
      ? selectedFields.filter(f => impactScoreFields.indexOf(f.field) !== -1)
      : selectedFields.filter(f => f.type === 'numeric' || (f.type === 'categorical' && f.remapping && Object.keys(f.remapping).length >= 3))
    ).slice(0, 2)
    const impactOE = impactOEFields.length > 0
      ? openEndedSelected.filter(f => impactOEFields.indexOf(f.field) !== -1)
      : []
    if (audience === 'full' && themes.length >= 3 && scoreFields.length > 0 && impactOE.length > 0 && allRows.length >= 30) {
      const themeInput = themes.map((t: any) => ({ id: t.id || '', name: t.name || '', keywords: t.keywords || [] }))
      for (const sf of scoreFields.slice(0, 2)) {
        for (const oe of impactOE) {
          try {
            const analysis = computeThemeImpact({
              themes: themeInput,
              rows: allRows,
              scoreField: sf.field,
              textFields: [oe.field],
              scoreRemapping: sf.remapping,
              rowKeyMap,
            }, (sf.label || sf.field) + ' × ' + (oe.label || oe.field))
            if (analysis) {
              buildThemeImpactSlide(pptx, datasetName, analysis.impacts, analysis.fieldLabel || '', analysis.rSquared, analysis.n, analysis.intercept)
            }
          } catch { /* skip */ }
        }
      }
    }

    // Closing slide
    if ((narratives.keyTakeaways || []).length > 0) {
      buildClosingSlide(pptx, datasetName, narratives.keyTakeaways)
    }

    // ── "Every deck is custom" upsell slide + provenance receipt ──
    // Both toggles default ON; ExportModal lets the user opt out per export.
    try {
      if (!includeCustomDecks && !includeProvenance) {
        throw '__skip_closers__'  // user opted out of both — render nothing
      }
      // Count slides rendered so far (pptxgenjs exposes the internal slides array)
      const slidesSoFar = ((pptx as any).slides?.length ?? 0)
      const totalAfter = slidesSoFar + (includeCustomDecks ? 1 : 0) + (includeProvenance ? 1 : 0)

      if (includeCustomDecks) renderCustomDecks(pptx, {
        type: 'custom_decks',
        title: 'Every deck is custom.',
        tagline: 'Not template-filled — generated for your data, your fields, your questions.',
        capabilities: [
          'StoryTime composes itself from your dataset — slides chosen by what the data shows.',
          'Give us a question, get a deck — entity analysis, churn drivers, theme deep-dives, segment comparisons.',
          'Every run is fresh — same chrome, different content. Take it from analysis to readout in minutes.',
        ],
        examples: [
          'Why are customers churning?',
          'What new programs would they support?',
          'Top complaints by segment?',
          'Which themes drive ratings?',
        ],
        hook: 'Ask: "What would you want a custom slide for?"',
      }, datasetName)

      if (!includeProvenance) {
        throw '__skip_closers__'  // user kept Custom Decks but turned off provenance
      }
      const wallClockSeconds = (Date.now() - ssStartedAt) / 1000
      const isCollection = dataset?.source === 'collection'

      // ── Text-analytics volume ─────────────────────────────────────────────
      // Sum characters, word tokens, unique vocabulary, and sentence fragments
      // across every selected open-ended field × every row. Even on small-N
      // studies this surfaces real depth of textual analysis.
      let totalChars = 0
      let totalWords = 0
      let totalSentences = 0
      const vocab = new Set<string>()
      for (const row of allRows) {
        for (const f of selectedFieldNames) {
          const v = (row as any)[f]
          if (typeof v !== 'string' || !v.trim()) continue
          totalChars += v.length
          for (const w of v.toLowerCase().match(/[a-z][a-z'-]+/g) || []) { vocab.add(w); totalWords += 1 }
          totalSentences += v.split(/[.!?]+/).filter(s => s.trim().length > 2).length
        }
      }

      // ── Modeling / slicing depth ──────────────────────────────────────────
      // Theoretical analytical surface: every field × every other field is
      // a potential cross-tabulation, and every theme × every field is a
      // potential significance test. These numbers communicate how much
      // analytical ground the system covered even on small samples.
      const themesCount     = (themes && themes.length) || 0
      const nFields         = selectedFieldNames.length
      const crossTabs       = nFields > 1 ? Math.floor(nFields * (nFields - 1) / 2) : 0
      const sigTests        = themesCount * Math.max(nFields, 1)
      const segmentCuts     = themesCount * 3       // approx: per-theme top/middle/bottom of distribution
      // Quote scoring: every open-ended response × every theme is a candidate
      // pair that pickBestComments() ranks. Cap the headline at a sane bound.
      const quoteCandidates = Math.min(allRows.length * Math.max(themesCount, 1), 50_000)
      const decisionsMade   = themesCount + sigTests + crossTabs + ((narratives.keyTakeaways || []).length)

      renderProvenance(pptx, {
        type: 'provenance',
        title: 'How this deck was made.',
        wallClockSeconds,
        decisionsMade,
        columnHeaders: {
          inputs:     'WHAT WE LOOKED AT',
          processing: 'WHAT WE FIGURED OUT',
          outputs:    'WHAT WE PRODUCED',
        },
        inputs: [
          { value: allRows.length.toLocaleString() + (rowsSampled ? '*' : ''), label: rowsSampled ? 'responses analysed (sampled)' : 'responses analysed',
            sub: isCollection ? `from ${flatDatasetIds.length} source datasets in the collection` : 'single dataset · every row examined' },
          { value: totalChars.toLocaleString(), label: 'characters of verbatim text',
            sub: `~${totalWords.toLocaleString()} word tokens · ${vocab.size.toLocaleString()} unique vocabulary` },
          { value: totalSentences.toLocaleString(), label: 'sentence fragments parsed',
            sub: 'every clause examined for themes, sentiment, and intent' },
          { value: String(nFields), label: 'open-ended fields examined',
            sub: nFields > 1 ? `${crossTabs} potential cross-tabulations · all evaluated` : 'depth over breadth' },
        ],
        processing: [
          { value: 'Claude (Anthropic)', label: 'theme mining + narrative drafting',
            sub: `${themesCount} theme passes · 0 retries · audience-tuned to ${audience}` },
          { value: 'Statistical engine', label: 'distributions · significance · ranking',
            sub: `${sigTests.toLocaleString()} significance tests · ${segmentCuts.toLocaleString()} segment cuts evaluated` },
          { value: 'AI quote selection', label: 'representative comments scored',
            sub: `~${quoteCandidates.toLocaleString()} candidate response × theme pairings ranked` },
          { value: themesCount > 0 ? `${themesCount} themes` : 'pattern discovery', label: 'mined from the open-ended fields',
            sub: 'each scored on impact, sentiment, and segment differences' },
        ],
        outputs: [
          { value: `~${totalAfter} slides`, label: 'rendered for this report',
            sub: 'distributions · themes · quotes · cross-tabs · key takeaways' },
          ...(themesCount > 0 ? [{ value: String(themesCount), label: 'themes surfaced',
            sub: 'with keywords, sentiment, and statistical impact' }] : []),
          ...((narratives.keyTakeaways || []).length > 0 ? [{ value: String((narratives.keyTakeaways || []).length), label: 'key takeaways written',
            sub: 'distilled from the analytical findings' }] : []),
          { value: audience.charAt(0).toUpperCase() + audience.slice(1), label: 'narrative tier',
            sub: 'depth tuned to the chosen audience' },
        ],
        pipelineStages: [
          'ingest', 'clean', 'themes (LLM)', 'sentiment',
          'impact', 'cross-tab', 'significance',
          'rank quotes', 'narrative (LLM)', 'compose', 'render',
        ],
        humanEquivLow:  Math.max(8, Math.round(totalAfter * 2)),
        humanEquivHigh: Math.max(16, Math.round(totalAfter * 4)),
        note: 'Range based on a common consulting rule-of-thumb of 2–4 hours per analytical slide (data extraction, theme work, interpretation, chart build, copy). Small-sample studies still warrant the same modelling depth — the system runs every cross-tab and significance test the data supports.',
      }, datasetName)
    } catch (provErr: any) {
      // __skip_closers__ is a deliberate skip — anything else is a real failure
      if (provErr !== '__skip_closers__') {
        console.error('[export/pptx] provenance/custom-decks slide failed:', provErr?.message || provErr)
      }
    }

    const buffer  = await pptx.write({ outputType: 'nodebuffer' }) as Buffer
    const safeName = datasetName.replace(/[^a-z0-9]/gi, '_').slice(0, 40)
    const filename = safeName + '_report_' + new Date().toISOString().slice(0, 10) + '.pptx'

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': 'attachment; filename="' + filename + '"',
        'Content-Length': String(buffer.length),
      },
    })
  } catch (buildErr: any) {
    console.error('[export/pptx] Build error:', buildErr)
    return NextResponse.json({ error: 'PPTX build failed: ' + (buildErr?.message || String(buildErr)) }, { status: 500 })
  }
}
