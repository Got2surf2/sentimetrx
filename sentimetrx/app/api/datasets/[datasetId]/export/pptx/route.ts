// app/api/datasets/[datasetId]/export/pptx/route.ts
// POST — generate a consulting-quality PowerPoint from dataset analytics.
// Body: { fields: string[], audience: 'executive'|'stakeholder'|'full' }

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

interface Params { params: { datasetId: string } }

// ── Datanautix brand palette ──────────────────────────────────────────────────
const DN = {
  teal:        '2A7A6F',
  tealDark:    '1D5A52',
  tealLight:   '3D9E91',
  tealPale:    'E6F4F2',
  tealPale2:   'C8E8E4',
  orange:      'E85A1A',
  orangeLight: 'F07040',
  orangePale:  'FEF0E8',
  orangePale2: 'FAD5C2',
  ink:         '1A1714',
  inkSoft:     '2E2A25',
  cream:       'FAF6F0',
  parchment:   'F2EBE0',
  warmMid:     '8C7E6E',
  warmLight:   'B8ADA0',
  divider:     'E4DDD4',
  white:       'FFFFFF',
  greenLight:  'D1FAE5',
  green:       '059669',
  amber:       'D97706',
  amberLight:  'FEF3C7',
  red:         'DC2626',
  redLight:    'FEE2E2',
}

// ── Layout (LAYOUT_WIDE = 13.33" × 7.5") ─────────────────────────────────────
const W   = 13.33
const H   = 7.5
const HH  = 0.9    // header height
const CY  = 1.05   // content start y
const CH  = H - CY - 0.32
const FY  = H - 0.28
const PAD = 0.42

// ── Shared helpers ────────────────────────────────────────────────────────────

function bg(slide: any, pptx: any, color = DN.cream) {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color }, line: { width: 0 } })
}

function hdr(slide: any, pptx: any, title: string, color = DN.teal, subtitle?: string) {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: HH, fill: { color }, line: { width: 0 } })
  // Orange accent line at header bottom
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: HH - 0.04, w: W, h: 0.04, fill: { color: DN.orange }, line: { width: 0 } })
  slide.addText(title, {
    x: PAD, y: 0.06, w: W - PAD * 2 - 2.4, h: subtitle ? 0.5 : HH - 0.12,
    fontSize: subtitle ? 17 : 20, bold: true, color: DN.white, valign: 'middle', wrap: true,
  })
  if (subtitle) {
    slide.addText(subtitle, {
      x: PAD, y: 0.54, w: W - PAD * 2 - 2.4, h: 0.32,
      fontSize: 10, color: 'B8D4D1', valign: 'middle', italic: true,
    })
  }
}

function logo(slide: any) {
  // "data" in orange, "nautix" in teal — all lowercase, right side of header
  slide.addText('data', {
    x: W - 2.3, y: 0.06, w: 1.0, h: HH - 0.12,
    fontSize: 16, bold: true, italic: true, color: DN.orangeLight,
    valign: 'middle', align: 'right',
  })
  slide.addText('nautix', {
    x: W - 1.3, y: 0.06, w: 1.1, h: HH - 0.12,
    fontSize: 16, bold: true, italic: true, color: DN.tealLight,
    valign: 'middle', align: 'left',
  })
}

function footer(slide: any, datasetName: string, pageNum: number) {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: FY - 0.02, w: W, h: 0.02, fill: { color: DN.divider }, line: { width: 0 } })
  slide.addText('datanautix.com  ·  ' + trunc(datasetName, 50), {
    x: PAD, y: FY, w: W * 0.72, h: 0.26, fontSize: 7.5, color: DN.warmLight, valign: 'middle',
  })
  slide.addText(String(pageNum), {
    x: W - PAD - 0.4, y: FY, w: 0.4, h: 0.26,
    fontSize: 7.5, color: DN.warmLight, align: 'right', valign: 'middle',
  })
}

// pptx is module-level during build — we capture it per call via closure
let pptx: any = null

function rect(slide: any, x: number, y: number, w: number, h: number, fill: string, radius = 0.07, border = DN.divider) {
  slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: fill }, line: { color: border, width: 1 }, rectRadius: radius })
}

function solidRect(slide: any, x: number, y: number, w: number, h: number, fill: string) {
  slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: fill }, line: { width: 0 } })
}

function lbl(slide: any, text: string, x: number, y: number, w: number, color = DN.warmMid) {
  slide.addText(text, { x, y, w, h: 0.22, fontSize: 7.5, bold: true, color, charSpacing: 1.2, textTransform: 'uppercase' })
}

function trunc(s: string, n: number) { return !s ? '' : s.length > n ? s.slice(0, n - 1) + '…' : s }

function pct(v: number, total: number) { return total > 0 ? Math.round(v / total * 100) : 0 }

// KPI card: big number + label, optional sub
function kpiCard(slide: any, x: number, y: number, w: number, h: number, value: string, label: string, sub?: string, bg_ = DN.tealPale, valColor = DN.teal) {
  rect(slide, x, y, w, h, bg_, 0.08, DN.tealPale2)
  slide.addText(value, { x: x + 0.14, y: y + 0.08, w: w - 0.28, h: h * 0.6, fontSize: Math.min(26, Math.max(18, 26 - value.length * 1.2)), bold: true, color: valColor, valign: 'middle' })
  slide.addText(label, { x: x + 0.14, y: y + h * 0.64, w: w - 0.28, h: 0.22, fontSize: 8.5, bold: true, color: DN.warmMid })
  if (sub) slide.addText(sub, { x: x + 0.14, y: y + h * 0.64 + 0.22, w: w - 0.28, h: 0.18, fontSize: 7.5, color: DN.warmLight })
}

// Insight box with left accent stripe
function insightBox(slide: any, x: number, y: number, w: number, h: number, text: string, accentColor = DN.teal, bgColor = DN.tealPale) {
  rect(slide, x, y, w, h, bgColor, 0.07, accentColor + '60')
  solidRect(slide, x, y, 0.07, h, accentColor)
  slide.addText(text, { x: x + 0.16, y: y + 0.1, w: w - 0.24, h: h - 0.2, fontSize: 11, color: DN.inkSoft, italic: true, valign: 'top', wrap: true, lineSpacingMultiple: 1.25 })
}

// Quote card
function quoteCard(slide: any, x: number, y: number, w: number, h: number, text: string) {
  rect(slide, x, y, w, h, DN.parchment, 0.07, DN.divider)
  solidRect(slide, x, y, 0.06, h, DN.teal)
  slide.addText('\u201C', { x: x + 0.12, y: y + 0.02, w: 0.28, h: 0.36, fontSize: 28, bold: true, color: DN.tealLight, valign: 'top' })
  slide.addText(trunc(text, 200), { x: x + 0.15, y: y + 0.32, w: w - 0.24, h: h - 0.4, fontSize: 10, color: DN.inkSoft, italic: true, valign: 'top', wrap: true, lineSpacingMultiple: 1.3 })
}

// ── AI narrative generation ───────────────────────────────────────────────────

interface FieldInsight {
  keyFinding: string
  narrative:  string
  implication: string
  watchout?:  string
}

interface Narratives {
  reportTitle:     string
  executiveSummary: string[]
  keyTakeaways:    string[]
  fieldInsights:   Record<string, FieldInsight>
}

async function generateNarratives(
  apiKey: string,
  datasetName: string,
  totalRows: number,
  audience: string,
  fields: SelectedField[]
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
      const top5 = Object.entries(s.counts || {})
        .sort((a: any, b: any) => b[1] - a[1]).slice(0, 5)
        .map(([k, v]: any) => `"${k}" ${v} (${pct(v, s.nonNull)}%)`).join(', ')
      return `${f.label} (categorical, n=${s.nonNull}): top responses — ${top5} | unique values: ${s.uniqueCount}`
    } else if (s.type === 'numeric') {
      const range = s.max - s.min
      const posInRange = range > 0 ? ((s.avg - s.min) / range * 100).toFixed(0) : '50'
      return `${f.label} (numeric, n=${s.nonNull}): avg=${s.avg?.toFixed(2)}, median=${s.median?.toFixed(2)}, min=${s.min}, max=${s.max}, std=${s.std?.toFixed(2)} | avg sits at ${posInRange}% of possible range`
    } else if (s.type === 'open-ended') {
      const sample = (s.sample || []).slice(0, 5).map((t: string) => `"${t.slice(0, 100)}"`).join(' | ')
      return `${f.label} (open-ended, n=${s.nonNull}): avg ${s.avgWordCount} words per response | samples: ${sample}`
    } else if (s.type === 'date') {
      return `${f.label} (date): ${s.min} to ${s.max}, n=${s.nonNull}`
    }
    return `${f.label}: no data`
  }).join('\n\n')

  const prompt = `You are a senior consultant preparing a data readout presentation. Write compelling, specific insights — not generic observations.

Dataset: "${datasetName}" — ${totalRows.toLocaleString()} responses
Audience: ${audience}. ${audienceNote}

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
${fields.map(f => `    "${f.field}": {
      "keyFinding": "one strong punchy statement about this field (max 12 words)",
      "narrative": "2-3 sentences. Specific data references. What the distribution reveals. What drives it.",
      "implication": "1-2 sentences. So what? What should be done or watched as a result?",
      "watchout": "1 sentence caveat, limitation or counter-reading (optional, omit if nothing meaningful)"
    }`).join(',\n')}
  }
}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 3500, messages: [{ role: 'user', content: prompt }] }),
  })

  if (!res.ok) throw new Error('AI call failed: ' + res.status)
  const data = await res.json()
  const raw  = (data.content?.[0]?.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')

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
  field:   string
  label:   string
  type:    string
  summary: any
}

// ── Slide builders ────────────────────────────────────────────────────────────

function buildTitleSlide(datasetName: string, reportTitle: string, totalRows: number, computedAt: string | null, pageNum: number) {
  const slide = pptx.addSlide()

  // Dark background
  solidRect(slide, 0, 0, W, H, DN.ink)
  // Teal left accent strip
  solidRect(slide, 0, 0, 0.2, H, DN.teal)
  // Orange bottom accent bar
  solidRect(slide, 0, H - 0.06, W, 0.06, DN.orange)

  // Logo large: "data" orange, "nautix" teal
  slide.addText('data', {
    x: PAD + 0.2, y: 0.9, w: 2.2, h: 1.0,
    fontSize: 52, bold: true, italic: true, color: DN.orangeLight, valign: 'middle',
  })
  slide.addText('nautix', {
    x: PAD + 2.35, y: 0.9, w: 3.0, h: 1.0,
    fontSize: 52, bold: true, italic: true, color: DN.tealLight, valign: 'middle',
  })

  // Thin divider line
  slide.addShape(pptx.ShapeType.line, {
    x: PAD + 0.2, y: 2.15, w: 5.5, h: 0,
    line: { color: DN.warmLight, width: 0.75 },
  })

  // Dataset name (main title)
  slide.addText(datasetName, {
    x: PAD + 0.2, y: 2.3, w: W - PAD * 2 - 0.4, h: 1.5,
    fontSize: 30, bold: true, color: DN.white, wrap: true, valign: 'top',
  })

  // Report subtitle from AI
  if (reportTitle && reportTitle !== 'Data Analysis Report') {
    slide.addText(reportTitle, {
      x: PAD + 0.2, y: 3.9, w: W - PAD * 2 - 0.4, h: 0.5,
      fontSize: 15, color: DN.warmLight, italic: true, valign: 'middle',
    })
  }

  // Meta row
  const metaParts = [totalRows.toLocaleString() + ' responses']
  if (computedAt) metaParts.push(new Date(computedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }))
  slide.addText(metaParts.join('  ·  '), {
    x: PAD + 0.2, y: 4.6, w: W - 2.5, h: 0.38,
    fontSize: 13, color: DN.warmMid, valign: 'middle',
  })

  // Right side decorative element
  solidRect(slide, W - 2.0, 0, 2.0, H, DN.tealDark + '40')
  slide.addText('CONFIDENTIAL', {
    x: W - 1.9, y: H - 1.2, w: 1.8, h: 0.9,
    fontSize: 7, color: DN.warmLight, align: 'center', valign: 'middle', charSpacing: 2,
    rotate: 270,
  })
}

function buildAboutSlide(datasetName: string, totalRows: number, computedAt: string | null, fields: SelectedField[], audience: string, pageNum: number) {
  const slide = pptx.addSlide()
  bg(slide, pptx)
  hdr(slide, pptx, 'About This Report', DN.teal, 'Methodology, scope and data coverage')
  logo(slide)

  const y0 = CY + 0.1
  const cardH = 1.0
  const cardW = (W - PAD * 2 - 0.3) / 3

  // Three scope cards
  const dateStr = computedAt
    ? new Date(computedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'N/A'

  const openCount = fields.filter(f => f.type === 'open-ended').length
  const catCount  = fields.filter(f => f.type === 'categorical').length
  const numCount  = fields.filter(f => f.type === 'numeric').length

  const scopeCards = [
    { v: totalRows.toLocaleString(), l: 'Total Responses', sub: 'in this analysis', bg: DN.tealPale, vc: DN.teal },
    { v: fields.length.toString(),   l: 'Fields Analysed',  sub: `${openCount} open · ${catCount} cat · ${numCount} num`, bg: DN.orangePale, vc: DN.orange },
    { v: dateStr, l: 'Report Generated', sub: audience + ' edition', bg: DN.cream, vc: DN.inkSoft },
  ]
  scopeCards.forEach(function(sc, i) {
    const cx = PAD + i * (cardW + 0.15)
    kpiCard(slide, cx, y0, cardW, cardH, sc.v, sc.l, sc.sub, sc.bg, sc.vc)
  })

  // Fields breakdown
  lbl(slide, 'FIELDS INCLUDED IN THIS REPORT', PAD, y0 + cardH + 0.2, W - PAD * 2)

  // Two column list of fields
  const col1 = fields.slice(0, Math.ceil(fields.length / 2))
  const col2 = fields.slice(Math.ceil(fields.length / 2))
  const listY = y0 + cardH + 0.48
  const colW2 = (W - PAD * 2 - 0.4) / 2
  const typeColor: Record<string, string> = { 'open-ended': DN.teal, 'categorical': DN.orange, 'numeric': DN.green, 'date': DN.warmMid }

  function fieldRow(f: SelectedField, x: number, y: number) {
    const tc = typeColor[f.type] || DN.warmMid
    solidRect(slide, x, y + 0.06, 0.07, 0.16, tc)
    slide.addText(trunc(f.label || f.field, 36), { x: x + 0.14, y, w: colW2 - 0.55, h: 0.28, fontSize: 10.5, color: DN.inkSoft, bold: false, valign: 'middle' })
    slide.addText(f.type, { x: x + colW2 - 0.45, y, w: 0.45, h: 0.28, fontSize: 8, color: tc, bold: true, align: 'right', valign: 'middle' })
  }

  const maxRows = Math.min(8, col1.length)
  col1.slice(0, maxRows).forEach(function(f, i) { fieldRow(f, PAD, listY + i * 0.3) })
  col2.slice(0, maxRows).forEach(function(f, i) { fieldRow(f, PAD + colW2 + 0.4, listY + i * 0.3) })

  // Methodology note
  const noteY = H - 0.9
  solidRect(slide, PAD, noteY, W - PAD * 2, 0.52, DN.parchment)
  slide.addText('Methodology: Responses were collected and analysed using Sarina (AI-assisted survey platform). Statistical significance not assumed unless stated. Open-ended responses are verbatim samples.', {
    x: PAD + 0.12, y: noteY + 0.08, w: W - PAD * 2 - 0.24, h: 0.36,
    fontSize: 8.5, color: DN.warmMid, italic: true, wrap: true,
  })

  footer(slide, datasetName, pageNum)
}

function buildSummarySlide(datasetName: string, totalRows: number, bullets: string[], takeaways: string[], themes: any[], fields: SelectedField[], pageNum: number) {
  const slide = pptx.addSlide()
  bg(slide, pptx)
  hdr(slide, pptx, 'Executive Summary', DN.teal)
  logo(slide)

  const leftW  = W * 0.54 - PAD
  const rightX = W * 0.54 + 0.1
  const rightW = W - rightX - PAD * 0.5

  // ── Left: KPI cards then bullets ──
  // KPI row: responses + a couple of field stats
  const numericField  = fields.find(f => f.type === 'numeric')
  const openField     = fields.find(f => f.type === 'open-ended')

  const kpis = [
    { v: totalRows.toLocaleString(), l: 'Responses', bg: DN.tealPale, vc: DN.teal },
  ]
  if (numericField?.summary?.avg != null) {
    kpis.push({ v: numericField.summary.avg.toFixed(1), l: trunc(numericField.label || numericField.field, 18), bg: DN.orangePale, vc: DN.orange })
  }
  if (openField?.summary?.avgWordCount) {
    kpis.push({ v: String(openField.summary.avgWordCount), l: 'Avg Words / Response', bg: DN.cream, vc: DN.inkSoft })
  }
  if (themes.length > 0) {
    kpis.push({ v: String(themes.length), l: 'Themes Identified', bg: DN.tealPale, vc: DN.teal })
  }

  const kpiW = leftW / Math.min(kpis.length, 4) - 0.1
  kpis.slice(0, 4).forEach(function(k, i) {
    kpiCard(slide, PAD + i * (kpiW + 0.1), CY, kpiW, 0.9, k.v, k.l, undefined, k.bg, k.vc)
  })

  // Key findings bullets
  lbl(slide, 'KEY FINDINGS', PAD, CY + 1.05, leftW)
  const bulletItems = bullets.slice(0, 5).map(function(b) {
    return { text: b, options: { bullet: { indent: 14 }, fontSize: 12, color: DN.inkSoft, paraSpaceAfter: 6, lineSpacingMultiple: 1.25 } }
  })
  if (bulletItems.length) {
    slide.addText(bulletItems, { x: PAD, y: CY + 1.28, w: leftW, h: CH - 1.28, fontSize: 12, valign: 'top' })
  }

  // ── Right: Top themes + takeaways ──
  if (themes.length > 0) {
    lbl(slide, 'TOP THEMES', rightX, CY, rightW)
    const maxThemes = Math.min(themes.length, 5)
    const thH = Math.min(0.7, (CH * 0.5 - 0.28) / maxThemes)
    themes.slice(0, maxThemes).forEach(function(t: any, i: number) {
      const ty = CY + 0.25 + i * (thH + 0.06)
      const themeColor = (t.color || DN.teal).replace('#', '')
      const hitPct = totalRows > 0 ? Math.round((t.count || 0) / totalRows * 100) : 0
      const barW = rightW * Math.min(hitPct / 100, 1)
      // background track
      rect(slide, rightX, ty, rightW, thH, DN.parchment, 0.05, DN.divider)
      // fill bar
      if (barW > 0.05) solidRect(slide, rightX, ty, barW, thH, themeColor + '40')
      solidRect(slide, rightX, ty, 0.06, thH, themeColor)
      slide.addText(trunc(t.name, 30), { x: rightX + 0.12, y: ty + 0.04, w: rightW - 0.55, h: thH - 0.08, fontSize: 10.5, bold: true, color: DN.ink, valign: 'middle' })
      slide.addText(hitPct + '%', { x: rightX + rightW - 0.5, y: ty + 0.04, w: 0.45, h: thH - 0.08, fontSize: 10, color: DN.warmMid, bold: true, align: 'right', valign: 'middle' })
    })
  }

  // Recommended actions / key takeaways
  if (takeaways.length > 0) {
    const taY = themes.length > 0 ? CY + CH * 0.52 : CY
    lbl(slide, 'RECOMMENDED ACTIONS', rightX, taY, rightW)
    takeaways.slice(0, 3).forEach(function(ta, i) {
      const ty = taY + 0.25 + i * 0.72
      solidRect(slide, rightX, ty, 0.06, 0.54, i === 0 ? DN.orange : DN.teal)
      rect(slide, rightX + 0.12, ty, rightW - 0.12, 0.54, DN.parchment, 0.06, DN.divider)
      slide.addText(ta, { x: rightX + 0.24, y: ty + 0.04, w: rightW - 0.32, h: 0.46, fontSize: 10.5, color: DN.inkSoft, valign: 'middle', wrap: true, lineSpacingMultiple: 1.2 })
    })
  }

  footer(slide, datasetName, pageNum)
}

function buildCategoricalSlide(datasetName: string, f: SelectedField, ai: FieldInsight, pageNum: number) {
  const slide = pptx.addSlide()
  bg(slide, pptx)
  hdr(slide, pptx, f.label, DN.teal, 'Distribution of responses')
  logo(slide)

  const s = f.summary
  const entries = Object.entries(s?.counts || {} as Record<string, number>)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 10)
  const total = entries.reduce((sum, [, v]) => sum + (v as number), 0)

  const chartW = W * 0.56 - PAD
  const rightX = W * 0.56 + 0.1
  const rightW = W - rightX - PAD * 0.5

  if (entries.length > 0) {
    const CHART_COLORS = [
      DN.teal, DN.tealLight, '4BA89A', '5CB3A6', '3D9E91',
      '2E7A6F', DN.orange, DN.orangeLight, 'F58A5C', 'E87A4A',
    ]
    slide.addChart('bar', [{ name: f.label, labels: entries.map(([k]) => trunc(k, 26)), values: entries.map(([, v]) => v as number) }], {
      x: PAD, y: CY + 0.05, w: chartW, h: CH - 0.1,
      barDir: 'bar',
      chartColors: CHART_COLORS,
      showLegend: false,
      showValue: true,
      dataLabelFormatCode: '0',
      dataLabelColor: DN.white,
      dataLabelFontSize: 9,
      dataLabelPosition: 'inEnd',
      valAxisLabelColor: DN.warmLight,
      catAxisLabelColor: DN.inkSoft,
      catAxisLabelFontSize: 9.5,
      valAxisLineShow: false,
      catGridLine: { style: 'none' },
    })
  }

  // Right panel
  // Summary stats
  kpiCard(slide, rightX, CY, rightW, 0.78, (s?.nonNull || 0).toLocaleString(), 'Responses', s?.uniqueCount + ' unique values', DN.tealPale, DN.teal)

  // Top response callout
  if (entries.length > 0) {
    const [topK, topV] = entries[0]
    const topPct = pct(topV as number, total)
    lbl(slide, 'TOP RESPONSE', rightX, CY + 0.9, rightW)
    rect(slide, rightX, CY + 1.12, rightW, 0.68, DN.orangePale, 0.08, DN.orangePale2)
    solidRect(slide, rightX, CY + 1.12, 0.07, 0.68, DN.orange)
    slide.addText(trunc(topK, 28), { x: rightX + 0.16, y: CY + 1.16, w: rightW - 0.45, h: 0.34, fontSize: 12, bold: true, color: DN.inkSoft, valign: 'middle', wrap: true })
    slide.addText(topPct + '%', { x: rightX + rightW - 0.45, y: CY + 1.16, w: 0.42, h: 0.34, fontSize: 18, bold: true, color: DN.orange, align: 'right', valign: 'middle' })
    slide.addText((topV as number).toLocaleString() + ' responses', { x: rightX + 0.16, y: CY + 1.52, w: rightW - 0.24, h: 0.22, fontSize: 8.5, color: DN.warmMid })
  }

  // Key finding
  if (ai.keyFinding) {
    lbl(slide, 'KEY FINDING', rightX, CY + 1.95, rightW)
    slide.addText(ai.keyFinding, { x: rightX, y: CY + 2.17, w: rightW, h: 0.44, fontSize: 12.5, bold: true, color: DN.teal, wrap: true, lineSpacingMultiple: 1.2 })
  }

  // Narrative
  if (ai.narrative) {
    const narY = CY + (ai.keyFinding ? 2.68 : 1.95)
    insightBox(slide, rightX, narY, rightW, Math.min(1.1, H - narY - 0.82), ai.narrative, DN.teal, DN.tealPale)
  }

  // Implication
  if (ai.implication) {
    const impY = H - 1.02
    solidRect(slide, rightX, impY, rightW, 0.68, DN.orangePale)
    solidRect(slide, rightX, impY, 0.07, 0.68, DN.orange)
    slide.addText('→ ' + ai.implication, { x: rightX + 0.14, y: impY + 0.06, w: rightW - 0.2, h: 0.56, fontSize: 9.5, color: DN.inkSoft, italic: true, valign: 'middle', wrap: true, lineSpacingMultiple: 1.2 })
  }

  footer(slide, datasetName, pageNum)
}

function buildNumericSlide(datasetName: string, f: SelectedField, ai: FieldInsight, pageNum: number) {
  const slide = pptx.addSlide()
  bg(slide, pptx)
  hdr(slide, pptx, f.label, DN.teal, 'Numeric distribution analysis')
  logo(slide)

  const s = f.summary
  const range = (s?.max ?? 0) - (s?.min ?? 0)
  const posInRange = range > 0 ? (s?.avg - s?.min) / range : 0.5
  const perfColor = posInRange >= 0.65 ? DN.green : posInRange <= 0.35 ? DN.red : DN.amber
  const perfBg    = posInRange >= 0.65 ? DN.greenLight : posInRange <= 0.35 ? DN.redLight : DN.amberLight

  // Stats row — 5 cards full width
  const stats = [
    { k: 'Average',    v: s?.avg?.toFixed?.(2) ?? '—',    bg: perfBg,   vc: perfColor },
    { k: 'Median',     v: s?.median?.toFixed?.(2) ?? '—', bg: DN.cream, vc: DN.inkSoft },
    { k: 'Std Dev',    v: s?.std?.toFixed?.(2) ?? '—',    bg: DN.cream, vc: DN.inkSoft },
    { k: 'Min → Max',  v: (s?.min ?? '—') + ' – ' + (s?.max ?? '—'), bg: DN.cream, vc: DN.inkSoft },
    { k: 'Responses',  v: (s?.nonNull || 0).toLocaleString(), bg: DN.tealPale, vc: DN.teal },
  ]
  const sw = (W - PAD * 2 - 0.16) / stats.length
  stats.forEach(function(st, i) {
    kpiCard(slide, PAD + i * (sw + 0.04), CY, sw, 0.82, st.v, st.k, undefined, st.bg, st.vc)
  })

  const chartH = CH - 0.95
  const chartW = W * 0.52 - PAD

  // Histogram
  const histBuckets: any[] = s?.histogram || []
  if (histBuckets.length > 0) {
    slide.addChart('bar', [{
      name: f.label,
      labels: histBuckets.map((b: any) => Number(b.min.toFixed(1)) + '–' + Number(b.max.toFixed(1))),
      values: histBuckets.map((b: any) => b.count),
    }], {
      x: PAD, y: CY + 0.95, w: chartW, h: chartH,
      barDir: 'col',
      chartColors: [DN.teal],
      showLegend: false,
      showValue: false,
      valAxisLabelColor: DN.warmLight,
      catAxisLabelColor: DN.warmMid,
      catAxisLabelFontSize: 7.5,
      valAxisLineShow: false,
      catGridLine: { style: 'none' },
      barGapWidthPct: 20,
    })
    lbl(slide, 'RESPONSE DISTRIBUTION', PAD, CY + 0.94, chartW)
  }

  // Right panel
  const rightX = W * 0.52 + 0.15
  const rightW = W - rightX - PAD * 0.5

  // Scale position visual
  lbl(slide, 'PERFORMANCE INDICATOR', rightX, CY + 0.94, rightW)
  const barY = CY + 1.16
  rect(slide, rightX, barY, rightW, 0.3, DN.parchment, 0.06, DN.divider)
  const fillW = Math.max(0.1, rightW * posInRange)
  solidRect(slide, rightX, barY, fillW, 0.3, perfColor + '80')
  solidRect(slide, rightX + fillW - 0.04, barY - 0.04, 0.08, 0.38, perfColor)
  slide.addText(s?.min ?? '0', { x: rightX, y: barY + 0.3, w: 0.5, h: 0.22, fontSize: 8, color: DN.warmMid, valign: 'top' })
  slide.addText(s?.max ?? '—', { x: rightX + rightW - 0.5, y: barY + 0.3, w: 0.5, h: 0.22, fontSize: 8, color: DN.warmMid, align: 'right', valign: 'top' })
  slide.addText('avg ' + (s?.avg?.toFixed(1) ?? '—'), { x: rightX + fillW - 0.45, y: barY - 0.28, w: 0.9, h: 0.22, fontSize: 8.5, bold: true, color: perfColor, align: 'center' })

  // Key finding
  if (ai.keyFinding) {
    lbl(slide, 'KEY FINDING', rightX, CY + 1.72, rightW)
    slide.addText(ai.keyFinding, { x: rightX, y: CY + 1.94, w: rightW, h: 0.44, fontSize: 12.5, bold: true, color: DN.teal, wrap: true, lineSpacingMultiple: 1.2 })
  }

  // Narrative
  if (ai.narrative) {
    const narY = CY + (ai.keyFinding ? 2.45 : 1.72)
    const narH = Math.min(1.2, H - narY - (ai.implication ? 0.9 : 0.4))
    insightBox(slide, rightX, narY, rightW, narH, ai.narrative, DN.teal, DN.tealPale)
  }

  // Implication
  if (ai.implication) {
    solidRect(slide, rightX, H - 0.78, rightW, 0.48, DN.orangePale)
    solidRect(slide, rightX, H - 0.78, 0.07, 0.48, DN.orange)
    slide.addText('→ ' + ai.implication, { x: rightX + 0.14, y: H - 0.78 + 0.04, w: rightW - 0.2, h: 0.4, fontSize: 9.5, color: DN.inkSoft, italic: true, valign: 'middle', wrap: true })
  }

  footer(slide, datasetName, pageNum)
}

function buildOpenEndedSlide(datasetName: string, f: SelectedField, ai: FieldInsight, audience: string, themes: any[], pageNum: number) {
  const slide = pptx.addSlide()
  bg(slide, pptx)
  hdr(slide, pptx, f.label, DN.tealDark, 'Open-ended verbatim responses')
  logo(slide)

  const s = f.summary
  const maxQuotes = audience === 'full' ? 6 : audience === 'stakeholder' ? 4 : 3
  const quotes: string[] = (s?.sample || []).filter((q: string) => q && q.trim().length > 15).slice(0, maxQuotes)

  const leftW  = W * 0.44 - PAD
  const rightX = W * 0.44 + 0.1
  const rightW = W - rightX - PAD * 0.5

  // Left panel: stats + narrative + themes
  // Stats
  kpiCard(slide, PAD, CY, leftW * 0.46, 0.8, (s?.nonNull || 0).toLocaleString(), 'Responses', undefined, DN.tealPale, DN.teal)
  kpiCard(slide, PAD + leftW * 0.49, CY, leftW * 0.46, 0.8, String(s?.avgWordCount || '—'), 'Avg Words', 'per response', DN.cream, DN.inkSoft)

  // Key finding
  if (ai.keyFinding) {
    lbl(slide, 'HEADLINE FINDING', PAD, CY + 0.92, leftW)
    slide.addText(ai.keyFinding, { x: PAD, y: CY + 1.14, w: leftW, h: 0.44, fontSize: 13, bold: true, color: DN.teal, wrap: true, lineSpacingMultiple: 1.2 })
  }

  // Narrative
  if (ai.narrative) {
    const narY = CY + (ai.keyFinding ? 1.65 : 0.92)
    const narH = Math.min(1.1, H - narY - (themes.length > 0 ? 1.0 : 0.45) - (ai.implication ? 0.65 : 0.1))
    insightBox(slide, PAD, narY, leftW, narH, ai.narrative, DN.teal, DN.tealPale)
  }

  // Relevant themes
  const relThemes = themes.slice(0, 4)
  if (relThemes.length > 0) {
    const thY = H - (ai.implication ? 1.55 : 0.9)
    lbl(slide, 'THEMES IDENTIFIED', PAD, thY, leftW)
    const pillW = (leftW - 0.1 * (relThemes.length - 1)) / relThemes.length
    relThemes.forEach(function(t: any, i: number) {
      const tc = (t.color || DN.teal).replace('#', '')
      rect(slide, PAD + i * (pillW + 0.1), thY + 0.24, pillW, 0.36, tc + '20', 0.07, tc + '60')
      slide.addText(trunc(t.name, 16), { x: PAD + i * (pillW + 0.1) + 0.06, y: thY + 0.24, w: pillW - 0.12, h: 0.36, fontSize: 8.5, bold: true, color: tc, align: 'center', valign: 'middle' })
    })
  }

  // Implication
  if (ai.implication) {
    solidRect(slide, PAD, H - 0.78, leftW, 0.48, DN.orangePale)
    solidRect(slide, PAD, H - 0.78, 0.07, 0.48, DN.orange)
    slide.addText('→ ' + ai.implication, { x: PAD + 0.14, y: H - 0.78 + 0.04, w: leftW - 0.2, h: 0.4, fontSize: 9.5, color: DN.inkSoft, italic: true, valign: 'middle', wrap: true })
  }

  // Right panel: quotes
  lbl(slide, 'VOICES FROM THE DATA', rightX, CY, rightW)

  if (quotes.length > 0) {
    const qh = Math.min(0.9, (CH - 0.24) / quotes.length - 0.1)
    quotes.forEach(function(q, i) {
      quoteCard(slide, rightX, CY + 0.24 + i * (qh + 0.1), rightW, qh, q)
    })
  } else {
    slide.addText('No verbatim responses available for this field.', {
      x: rightX, y: CY + 0.5, w: rightW, h: 1.0,
      fontSize: 12, color: DN.warmLight, italic: true, align: 'center', valign: 'middle',
    })
  }

  footer(slide, datasetName, pageNum)
}

function buildClosingSlide(datasetName: string, takeaways: string[], pageNum: number) {
  const slide = pptx.addSlide()

  solidRect(slide, 0, 0, W, H, DN.ink)
  solidRect(slide, 0, 0, 0.2, H, DN.teal)
  solidRect(slide, 0, H - 0.06, W, 0.06, DN.orange)
  solidRect(slide, W - 2.0, 0, 2.0, H, DN.tealDark + '40')

  slide.addText('Key Takeaways', { x: PAD + 0.2, y: 0.7, w: W - 3.0, h: 0.7, fontSize: 32, bold: true, color: DN.white })
  slide.addShape(pptx.ShapeType.line, { x: PAD + 0.2, y: 1.55, w: 4.5, h: 0, line: { color: DN.orange, width: 2 } })

  takeaways.slice(0, 3).forEach(function(ta, i) {
    const ty = 1.85 + i * 1.2
    solidRect(slide, PAD + 0.2, ty, 0.42, 0.42, DN.orange)
    slide.addText(String(i + 1), { x: PAD + 0.2, y: ty, w: 0.42, h: 0.42, fontSize: 18, bold: true, color: DN.white, align: 'center', valign: 'middle' })
    slide.addText(ta, { x: PAD + 0.78, y: ty - 0.04, w: W - PAD - 3.2, h: 0.52, fontSize: 14, color: DN.white, bold: false, wrap: true, valign: 'middle', lineSpacingMultiple: 1.2 })
  })

  // Footer logo + URL
  slide.addText('data', { x: W - 3.8, y: H - 0.55, w: 1.0, h: 0.42, fontSize: 13, bold: true, italic: true, color: DN.orangeLight, align: 'right', valign: 'middle' })
  slide.addText('nautix', { x: W - 2.8, y: H - 0.55, w: 1.1, h: 0.42, fontSize: 13, bold: true, italic: true, color: DN.tealLight, align: 'left', valign: 'middle' })
  slide.addText('.com', { x: W - 1.7, y: H - 0.55, w: 1.5, h: 0.42, fontSize: 13, color: DN.warmMid, valign: 'middle' })
}

// ── Main route handler ────────────────────────────────────────────────────────

export async function POST(req: Request, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const selectedFieldNames: string[] = body.fields || []
  const audience: string             = body.audience || 'stakeholder'

  if (selectedFieldNames.length === 0) {
    return NextResponse.json({ error: 'Select at least one field' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  const { data: dataset } = await service
    .from('datasets').select('id, name, row_count, ana_library').eq('id', params.datasetId).single()
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })

  const { data: stateRow } = await service
    .from('dataset_state').select('schema_config, analytics, theme_model').eq('dataset_id', params.datasetId).single()
  if (!stateRow) return NextResponse.json({ error: 'Dataset state not found' }, { status: 404 })

  const schema      = stateRow.schema_config
  const analytics   = stateRow.analytics
  const themes      = (stateRow.theme_model as any)?.themes || []
  const datasetName = dataset.name

  if (!analytics?.fieldSummaries) {
    return NextResponse.json({ error: 'Analytics not yet computed — run compute first' }, { status: 400 })
  }

  const selectedFields: SelectedField[] = selectedFieldNames
    .map(function(fieldName) {
      const schemaField = (schema?.fields || []).find((f: any) => f.field === fieldName)
      if (!schemaField) return null
      return { field: fieldName, label: schemaField.label || fieldName, type: schemaField.type, summary: analytics.fieldSummaries[fieldName] || null }
    })
    .filter(Boolean) as SelectedField[]

  if (selectedFields.length === 0) {
    return NextResponse.json({ error: 'No valid fields selected' }, { status: 400 })
  }

  // AI narratives
  let narratives: Narratives = {
    reportTitle: '',
    executiveSummary: [],
    keyTakeaways: [],
    fieldInsights: Object.fromEntries(selectedFields.map(f => [f.field, { keyFinding: f.label, narrative: '', implication: '', watchout: '' }])),
  }
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (apiKey) {
    try { narratives = await generateNarratives(apiKey, datasetName, analytics.totalRows, audience, selectedFields) }
    catch (e) { console.error('[export/pptx] AI error:', e) }
  }

  // ── Build PPTX ─────────────────────────────────────────────────────────────
  const pptxgen  = (await import('pptxgenjs')).default
  pptx           = new pptxgen()
  pptx.layout    = 'LAYOUT_WIDE'
  pptx.author    = 'Datanautix'
  pptx.company   = 'Datanautix'
  pptx.subject   = datasetName + ' — Analysis Report'
  pptx.title     = datasetName

  let page = 1

  // 1: Title
  buildTitleSlide(datasetName, narratives.reportTitle || '', analytics.totalRows, analytics.computedAt, page++)

  // 2: About this report
  buildAboutSlide(datasetName, analytics.totalRows, analytics.computedAt, selectedFields, audience, page++)

  // 3: Executive Summary
  buildSummarySlide(datasetName, analytics.totalRows, narratives.executiveSummary || [], narratives.keyTakeaways || [], themes, selectedFields, page++)

  // Field slides — open-ended first, then categorical, then numeric
  const ordered = [
    ...selectedFields.filter(f => f.type === 'open-ended'),
    ...selectedFields.filter(f => f.type === 'categorical'),
    ...selectedFields.filter(f => f.type === 'numeric'),
  ]

  for (const f of ordered) {
    const ai = narratives.fieldInsights?.[f.field] || { keyFinding: f.label, narrative: '', implication: '', watchout: '' }
    if (f.type === 'open-ended') {
      buildOpenEndedSlide(datasetName, f, ai, audience, themes, page++)
    } else if (f.type === 'categorical') {
      if (audience !== 'executive') buildCategoricalSlide(datasetName, f, ai, page++)
    } else if (f.type === 'numeric') {
      if (audience !== 'executive') buildNumericSlide(datasetName, f, ai, page++)
    }
  }

  // Closing slide
  if ((narratives.keyTakeaways || []).length > 0) {
    buildClosingSlide(datasetName, narratives.keyTakeaways, page++)
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
}
