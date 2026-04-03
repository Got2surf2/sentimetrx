// app/api/datasets/[datasetId]/export/pptx/route.ts
// POST — generate a consulting-quality PowerPoint from dataset analytics.
// Body: { fields: string[], audience: 'executive'|'stakeholder'|'full' }

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { smartOrder, isOrdinalScale } from '@/lib/scaleUtils'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

interface Params { params: { datasetId: string } }

// ── Datanautix brand palette ──────────────────────────────────────────────────
const DN = {
  // Teal family (brand primary)
  teal:        '0F7173',
  tealDark:    '0A4F51',
  tealLight:   '1DA39A',
  tealPale:    'E0F2F1',
  tealPale2:   'B2DFDB',
  // Navy family (professional dark)
  navy:        '0D2B45',
  navyMid:     '0F3A54',
  navyLight:   '1A5070',
  // Gold accent (replaces orange in slide design; orange kept for logo only)
  gold:        'E8B84B',
  goldLight:   'F5D98A',
  goldPale:    'FFF8E1',
  // Orange (logo / brand identity only)
  orange:      'E85A1A',
  orangeLight: 'F07040',
  orangePale:  'FEF0E8',
  // Neutral
  ink:         '0D2B45',
  inkSoft:     '1A3A50',
  slate:       '8FA3AE',
  slateDark:   '4A6572',
  slateLight:  'E8EDEF',
  slateCard:   'F4F7F8',
  divider:     'D4DDE2',
  white:       'FFFFFF',
  // Semantic
  green:       '059669',
  greenLight:  'D1FAE5',
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

function bg(slide: any, pptx: any, color = DN.slateCard) {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color }, line: { width: 0 } })
}

function hdr(slide: any, pptx: any, title: string, _color = DN.navy, subtitle?: string) {
  // Thin gold bar at very top
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.06, fill: { color: DN.gold }, line: { width: 0 } })
  // Navy header band
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.06, w: W, h: HH - 0.06, fill: { color: DN.navy }, line: { width: 0 } })
  // Left teal accent strip inside header
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.06, w: 0.07, h: HH - 0.06, fill: { color: DN.teal }, line: { width: 0 } })
  slide.addText(title, {
    x: PAD, y: 0.1, w: W - PAD * 2 - 2.4, h: subtitle ? 0.5 : HH - 0.18,
    fontSize: subtitle ? 17 : 20, bold: true, color: DN.white, valign: 'middle', wrap: true,
  })
  if (subtitle) {
    slide.addText(subtitle, {
      x: PAD, y: 0.56, w: W - PAD * 2 - 2.4, h: 0.32,
      fontSize: 10, color: DN.tealLight, valign: 'middle', italic: true,
    })
  }
}

function logo(slide: any) {
  // "data" in orange, "nautix" in teal — all lowercase, right side of header
  slide.addText('data', {
    x: W - 2.3, y: 0.1, w: 1.0, h: HH - 0.18,
    fontSize: 15, bold: true, italic: true, color: DN.orangeLight,
    valign: 'middle', align: 'right',
  })
  slide.addText('nautix', {
    x: W - 1.3, y: 0.1, w: 1.1, h: HH - 0.18,
    fontSize: 15, bold: true, italic: true, color: DN.tealLight,
    valign: 'middle', align: 'left',
  })
}

function footer(slide: any, datasetName: string, pageNum: number) {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: FY - 0.02, w: W, h: 0.015, fill: { color: DN.teal + '60' }, line: { width: 0 } })
  slide.addText('datanautix.com  ·  ' + trunc(datasetName, 50), {
    x: PAD, y: FY, w: W * 0.72, h: 0.26, fontSize: 7.5, color: DN.slate, valign: 'middle',
  })
  slide.addText(String(pageNum), {
    x: W - PAD - 0.4, y: FY, w: 0.4, h: 0.26,
    fontSize: 7.5, color: DN.slate, align: 'right', valign: 'middle',
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
${fields.map(f => `    "${f.field}": {
      "keyFinding": "one strong punchy statement about this field (max 12 words)",
      "narrative": "2-3 sentences. Specific data references. What the distribution reveals. What drives it.",
      "implication": "1-2 sentences. So what? What should be done or watched as a result?",
      "watchout": "1 sentence caveat, limitation or counter-reading (optional, omit if nothing meaningful)"
    }`).join(',\n')}
  }
}`

  const controller = new AbortController()
  const aiTimeout  = setTimeout(() => controller.abort(), 38000)  // 38s cap — leave room for PPTX build
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 3500, messages: [{ role: 'user', content: prompt }] }),
    signal: controller.signal,
  }).finally(() => clearTimeout(aiTimeout))

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
  field:      string
  label:      string
  type:       string
  summary:    any
  remapping?: Record<string, number>
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

  // Thin divider line (use a slim rect — ShapeType.line not reliable in pptxgenjs v4)
  solidRect(slide, PAD + 0.2, 2.15, 5.5, 0.015, DN.warmLight)

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

  // Key findings bullets — or auto-generated snapshot if no AI
  lbl(slide, 'KEY FINDINGS', PAD, CY + 1.05, leftW)
  const realBullets = bullets.filter(b => b && b.length > 10)
  if (realBullets.length > 0) {
    const bulletItems = realBullets.slice(0, 5).map(function(b) {
      return { text: b, options: { bullet: { indent: 14 }, fontSize: 11.5, color: DN.inkSoft, paraSpaceAfter: 7, lineSpacingMultiple: 1.3 } }
    })
    slide.addText(bulletItems, { x: PAD, y: CY + 1.28, w: leftW, h: CH - 1.28, fontSize: 11.5, valign: 'top' })
  } else {
    // Auto-generate snapshot from field data
    const snapFields = fields.filter(f => f.type === 'categorical' && f.summary?.counts)
    const snapY = CY + 1.28
    snapFields.slice(0, 5).forEach(function(f, i) {
      const counts  = f.summary.counts as Record<string, number>
      const total_  = Object.values(counts).reduce((s: number, v: any) => s + v, 0)
      const topKey  = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || ''
      const topPct_ = total_ > 0 ? Math.round(counts[topKey] / total_ * 100) : 0
      const fy      = snapY + i * 0.82
      solidRect(slide, PAD, fy + 0.18, 0.06, 0.42, DN.teal)
      slide.addText(trunc(f.label || f.field, 20), { x: PAD + 0.13, y: fy, w: leftW - 1.0, h: 0.28, fontSize: 9, bold: true, color: DN.warmMid })
      slide.addText(topPct_ + '% ' + trunc(topKey, 22), { x: PAD + 0.13, y: fy + 0.28, w: leftW - 0.5, h: 0.3, fontSize: 11.5, bold: true, color: DN.ink })
    })
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

function buildCategoricalSlide(datasetName: string, f: SelectedField, ai: FieldInsight, pageNum: number) {
  const slide = pptx.addSlide()
  bg(slide, pptx)
  hdr(slide, pptx, f.label, DN.teal, 'Response distribution · ' + (f.summary?.nonNull || 0).toLocaleString() + ' responses')
  logo(slide)

  const s          = f.summary
  const rawCounts  = (s?.counts || {}) as Record<string, number>
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
  const labelW  = 2.5
  const barMaxW = W - chartX - labelW - 0.15 - 0.62 - 1.1 - PAD * 0.5
  const barX    = chartX + labelW + 0.15
  const pctX    = barX + barMaxW + 0.12
  const cntX    = pctX + 0.62

  // ── Left panel ───────────────────────────────────────────────────────────────
  kpiCard(slide, PAD, CY, leftW, 0.88, total.toLocaleString(), 'Total Responses', (s?.uniqueCount || allKeys.length) + ' unique values', DN.tealPale, DN.teal)

  let leftY = CY + 1.01

  if (isOrdinal) {
    const t2Color = top2 >= 70 ? DN.green : top2 >= 50 ? DN.amber : DN.red
    const t2Bg    = top2 >= 70 ? DN.greenLight : top2 >= 50 ? DN.amberLight : DN.redLight
    kpiCard(slide, PAD, leftY, leftW, 0.88, top2 + '%', 'Top-2 Positive', top2Keys.slice(0, 2).map(k => trunc(k, 14)).join(' + '), t2Bg, t2Color)
    leftY += 1.01

    if (avgScore !== null) {
      const aFrac  = maxScore > 0 ? avgScore / maxScore : 0.5
      const aColor = aFrac >= 0.65 ? DN.green : aFrac >= 0.4 ? DN.amber : DN.red
      kpiCard(slide, PAD, leftY, leftW, 0.88, avgScore.toFixed(1) + ' / ' + maxScore, 'Average Score', undefined, DN.cream, aColor)
      leftY += 1.01
    }

    if (bot2 > 4 && bot2Keys.length > 0) {
      solidRect(slide, PAD, leftY, leftW, 0.72, 'FEE2E2')
      solidRect(slide, PAD, leftY, 0.06, 0.72, DN.red)
      slide.addText(bot2 + '%', { x: PAD + 0.14, y: leftY + 0.05, w: 0.75, h: 0.34, fontSize: 22, bold: true, color: DN.red, valign: 'middle' })
      slide.addText('expressed concern', { x: PAD + 0.93, y: leftY + 0.05, w: leftW - 1.05, h: 0.3, fontSize: 9, bold: true, color: DN.red, valign: 'middle' })
      slide.addText(bot2Keys.map(k => trunc(k, 14)).join(' or '), { x: PAD + 0.14, y: leftY + 0.42, w: leftW - 0.2, h: 0.24, fontSize: 8, color: DN.warmMid })
      leftY += 0.85
    }
  }

  // Insight text — AI if good, else auto-computed
  const hasRealAI = ai.keyFinding && ai.keyFinding !== f.label && ai.keyFinding !== f.field
  const insightText = hasRealAI
    ? ai.keyFinding + (ai.narrative ? '\n\n' + ai.narrative : '')
    : autoInsight(f.label, orderedKeys, rawCounts, total, isOrdinal, top2, bot2)

  const insightH = Math.max(0.5, H - leftY - 0.55)
  insightBox(slide, PAD, leftY + 0.1, leftW, insightH, insightText, DN.teal, DN.tealPale)

  // Implication strip
  if (hasRealAI && ai.implication) {
    solidRect(slide, PAD, H - 0.72, leftW, 0.44, DN.orangePale)
    solidRect(slide, PAD, H - 0.72, 0.06, 0.44, DN.orange)
    slide.addText('→ ' + ai.implication, { x: PAD + 0.13, y: H - 0.72 + 0.04, w: leftW - 0.18, h: 0.36, fontSize: 8.5, color: DN.inkSoft, italic: true, valign: 'middle', wrap: true })
  }

  // Vertical divider
  solidRect(slide, PAD + leftW + 0.18, CY + 0.06, 0.012, CH - 0.12, DN.divider)

  // ── Right panel: custom horizontal bar chart ──────────────────────────────
  const n     = orderedKeys.length
  const rowGap = 0.09
  const rowH  = Math.min(0.58, (CH - rowGap * (n - 1)) / Math.max(n, 1))
  const maxVal = Math.max(...orderedKeys.map(k => rawCounts[k] || 0), 1)

  // Column headers
  slide.addText('Response', { x: chartX, y: CY, w: labelW, h: 0.28, fontSize: 8.5, bold: true, color: DN.warmMid, valign: 'middle' })
  slide.addText('Distribution', { x: barX, y: CY, w: barMaxW, h: 0.28, fontSize: 8.5, bold: true, color: DN.warmMid, valign: 'middle' })
  slide.addText('%', { x: pctX, y: CY, w: 0.6, h: 0.28, fontSize: 8.5, bold: true, color: DN.warmMid, valign: 'middle' })
  slide.addText('n', { x: cntX, y: CY, w: 1.0, h: 0.28, fontSize: 8.5, bold: true, color: DN.warmMid, valign: 'middle' })
  solidRect(slide, chartX, CY + 0.3, W - chartX - PAD * 0.5, 0.012, DN.divider)

  const rowStart = CY + 0.42
  orderedKeys.forEach(function(key, i) {
    const count   = rawCounts[key] || 0
    const pctVal  = pct(count, total)
    const barW    = barMaxW * count / maxVal
    const ry      = rowStart + i * (rowH + rowGap)
    const col     = barColor(i, n, isOrdinal)
    const isTop   = i === 0

    // Subtle row tint
    if (i % 2 === 0) solidRect(slide, chartX, ry, W - chartX - PAD * 0.4, rowH, 'F8F9FA')

    // Label
    slide.addText(trunc(key, 30), {
      x: chartX, y: ry, w: labelW, h: rowH,
      fontSize: isTop ? 11 : 10.5, bold: isTop,
      color: isTop ? DN.ink : DN.inkSoft, valign: 'middle',
    })

    // Bar track
    const trackY = ry + rowH * 0.22
    const trackH = rowH * 0.55
    solidRect(slide, barX, trackY, barMaxW, trackH, 'EAECEF')

    // Bar fill
    if (barW > 0.05) solidRect(slide, barX, trackY, barW, trackH, col)

    // Percentage
    slide.addText(pctVal + '%', {
      x: pctX, y: ry, w: 0.6, h: rowH,
      fontSize: isTop ? 13 : 11, bold: true, color: col, valign: 'middle',
    })

    // Count
    slide.addText(count.toLocaleString(), {
      x: cntX, y: ry, w: 1.1, h: rowH,
      fontSize: 9.5, color: DN.warmMid, valign: 'middle',
    })
  })

  footer(slide, datasetName, pageNum)
}

function buildNumericSlide(datasetName: string, f: SelectedField, ai: FieldInsight, pageNum: number) {
  const slide = pptx.addSlide()
  bg(slide, pptx)
  hdr(slide, pptx, f.label, DN.teal, 'Numeric distribution · ' + (f.summary?.nonNull || 0).toLocaleString() + ' responses')
  logo(slide)

  const s          = f.summary
  const range      = (s?.max ?? 0) - (s?.min ?? 0)
  const posInRange = range > 0 ? (s?.avg - s?.min) / range : 0.5
  const perfColor  = posInRange >= 0.65 ? DN.green : posInRange <= 0.35 ? DN.red : DN.amber
  const perfBg     = posInRange >= 0.65 ? DN.greenLight : posInRange <= 0.35 ? DN.redLight : DN.amberLight

  // ── Stats row (top strip) ────────────────────────────────────────────────────
  const statsData = [
    { k: 'Average',   v: s?.avg?.toFixed?.(2) ?? '—',  bg: perfBg,       vc: perfColor },
    { k: 'Median',    v: s?.median?.toFixed?.(2) ?? '—', bg: DN.cream,   vc: DN.inkSoft },
    { k: 'Std Dev',   v: s?.std?.toFixed?.(2) ?? '—',  bg: DN.cream,     vc: DN.inkSoft },
    { k: 'Min → Max', v: (s?.min ?? '—') + ' – ' + (s?.max ?? '—'), bg: DN.cream, vc: DN.inkSoft },
    { k: 'n',         v: (s?.nonNull || 0).toLocaleString(), bg: DN.tealPale, vc: DN.teal },
  ]
  const sw = (W - PAD * 2 - 0.16) / statsData.length
  statsData.forEach(function(st, i) {
    kpiCard(slide, PAD + i * (sw + 0.04), CY, sw, 0.82, st.v, st.k, undefined, st.bg, st.vc)
  })

  // ── Left: custom histogram ───────────────────────────────────────────────────
  const chartX  = PAD
  const chartW2 = W * 0.55 - PAD
  const chartY  = CY + 0.95
  const chartH2 = CH - 1.05
  const histBuckets: any[] = s?.histogram || []

  lbl(slide, 'DISTRIBUTION', chartX, chartY - 0.22, chartW2)
  solidRect(slide, chartX, chartY - 0.02, chartW2, 0.012, DN.divider)

  if (histBuckets.length > 0) {
    const maxCount  = Math.max(...histBuckets.map((b: any) => b.count), 1)
    const bw        = chartW2 / histBuckets.length
    histBuckets.forEach(function(b: any, i: number) {
      const bh   = chartH2 * 0.88 * (b.count / maxCount)
      const bx   = chartX + i * bw
      const by   = chartY + chartH2 * 0.88 - bh
      const frac = i / Math.max(histBuckets.length - 1, 1)
      const col  = posInRange >= 0.65 ? DN.teal : posInRange <= 0.35 ? 'F97316' : DN.teal
      solidRect(slide, bx + 0.02, by, bw - 0.04, bh, col)
    })
    // X-axis labels (show ~5 evenly spaced)
    const step = Math.ceil(histBuckets.length / 5)
    histBuckets.forEach(function(b: any, i: number) {
      if (i % step !== 0 && i !== histBuckets.length - 1) return
      const bx = chartX + i * (chartW2 / histBuckets.length)
      slide.addText(String(Number(b.min.toFixed(1))), {
        x: bx, y: chartY + chartH2 * 0.9, w: chartW2 / histBuckets.length * step, h: 0.22,
        fontSize: 7.5, color: DN.warmMid, valign: 'top',
      })
    })
    // Mean line
    if (s?.avg != null && range > 0) {
      const meanX = chartX + ((s.avg - s.min) / range) * chartW2
      solidRect(slide, meanX - 0.01, chartY, 0.02, chartH2 * 0.88, DN.orange)
      slide.addText('avg ' + s.avg.toFixed(1), {
        x: Math.min(meanX - 0.3, chartX + chartW2 - 0.65), y: chartY + 0.04,
        w: 0.65, h: 0.22, fontSize: 8, bold: true, color: DN.orange, align: 'center',
      })
    }
  } else {
    slide.addText('No histogram data available.', {
      x: chartX, y: chartY + 1.0, w: chartW2, h: 0.4,
      fontSize: 11, color: DN.warmLight, italic: true, align: 'center',
    })
  }

  // ── Right panel ──────────────────────────────────────────────────────────────
  const rightX = W * 0.55 + 0.2
  const rightW = W - rightX - PAD * 0.5

  // Performance gauge bar
  lbl(slide, 'PERFORMANCE WITHIN RANGE', rightX, chartY - 0.22, rightW)
  solidRect(slide, rightX, chartY - 0.02, rightW, 0.012, DN.divider)
  const gaugeY = chartY + 0.1
  rect(slide, rightX, gaugeY, rightW, 0.32, DN.parchment, 0.06, DN.divider)
  const fillW = Math.max(0.12, rightW * posInRange)
  solidRect(slide, rightX, gaugeY, fillW, 0.32, perfColor + '99')
  solidRect(slide, rightX + fillW - 0.05, gaugeY - 0.05, 0.1, 0.42, perfColor)
  slide.addText(String(s?.min ?? '0'), { x: rightX, y: gaugeY + 0.34, w: 0.6, h: 0.2, fontSize: 7.5, color: DN.warmMid })
  slide.addText(String(s?.max ?? '—'), { x: rightX + rightW - 0.6, y: gaugeY + 0.34, w: 0.6, h: 0.2, fontSize: 7.5, color: DN.warmMid, align: 'right' })
  slide.addText('avg ' + (s?.avg?.toFixed(1) ?? '—'), {
    x: rightX + Math.max(0, fillW - 0.5), y: gaugeY - 0.28,
    w: 0.95, h: 0.22, fontSize: 9, bold: true, color: perfColor, align: 'center',
  })

  // Key finding / narrative
  const narY = gaugeY + 0.72
  const hasRealAI = ai.keyFinding && ai.keyFinding !== f.label && ai.keyFinding !== f.field
  if (hasRealAI) {
    slide.addText(ai.keyFinding, {
      x: rightX, y: narY, w: rightW, h: 0.46,
      fontSize: 12.5, bold: true, color: DN.teal, wrap: true, lineSpacingMultiple: 1.2,
    })
    if (ai.narrative) {
      insightBox(slide, rightX, narY + 0.54, rightW, Math.min(1.3, H - narY - 1.4), ai.narrative, DN.teal, DN.tealPale)
    }
  } else {
    // Auto insight for numeric
    const autoText = posInRange >= 0.65
      ? 'Average of ' + (s?.avg?.toFixed(1) ?? '—') + ' sits in the upper range — strong performance.'
      : posInRange <= 0.35
        ? 'Average of ' + (s?.avg?.toFixed(1) ?? '—') + ' sits in the lower range — opportunity for improvement.'
        : 'Average of ' + (s?.avg?.toFixed(1) ?? '—') + ' sits in the mid range.'
    insightBox(slide, rightX, narY, rightW, Math.min(1.2, H - narY - 0.4), autoText, DN.teal, DN.tealPale)
  }

  if (ai.implication && hasRealAI) {
    solidRect(slide, rightX, H - 0.72, rightW, 0.44, DN.orangePale)
    solidRect(slide, rightX, H - 0.72, 0.06, 0.44, DN.orange)
    slide.addText('→ ' + ai.implication, { x: rightX + 0.13, y: H - 0.72 + 0.04, w: rightW - 0.18, h: 0.36, fontSize: 8.5, color: DN.inkSoft, italic: true, valign: 'middle', wrap: true })
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
  solidRect(slide, PAD + 0.2, 1.55, 4.5, 0.03, DN.orange)

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
  const mode: string                 = body.mode || 'quick'
  const instructions: string         = body.instructions || ''

  if (mode === 'quick' && selectedFieldNames.length === 0) {
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

  // Builder mode with no explicit fields → use all schema fields
  const allSchemaFields: string[] = (schema?.fields || [])
    .filter((f: any) => ['open-ended', 'categorical', 'numeric', 'date'].includes(f.type) && f.status !== 'ignored')
    .map((f: any) => f.field)
  const fieldNamesToUse = selectedFieldNames.length > 0 ? selectedFieldNames : allSchemaFields

  const selectedFields: SelectedField[] = fieldNamesToUse
    .map(function(fieldName) {
      const schemaField = (schema?.fields || []).find((f: any) => f.field === fieldName)
      if (!schemaField) return null
      return { field: fieldName, label: schemaField.label || fieldName, type: schemaField.type, summary: analytics.fieldSummaries[fieldName] || null, remapping: schemaField.remapping }
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
    try { narratives = await generateNarratives(apiKey, datasetName, analytics.totalRows, audience, selectedFields, instructions || undefined) }
    catch (e) { console.error('[export/pptx] AI error:', e) }
  }

  // ── Build PPTX ─────────────────────────────────────────────────────────────
  try {
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
  } catch (buildErr: any) {
    console.error('[export/pptx] Build error:', buildErr)
    return NextResponse.json({ error: 'PPTX build failed: ' + (buildErr?.message || String(buildErr)) }, { status: 500 })
  }
}
