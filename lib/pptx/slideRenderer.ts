// lib/pptx/slideRenderer.ts
// Lightweight slide spec renderer — takes JSON slide specs from Ana and renders
// them into pptxgenjs slides using the shared Datanautix brand primitives.

import { W, H, PAD, FY, bgFill, trunc } from './shared'

// ── CREAM palette ────────────────────────────────────────────────────────────
// Defined LOCALLY so we can re-skin every deck that uses this renderer without
// touching shared.ts (other self-contained decks import DN/W/H/CY from there).
const CR = {
  cream:   'FFFDF9',  // slide background for content slides
  card:    'FAF6F0',  // card fill
  ink:     '2E2A25',  // primary text / dark cover bg
  ink2:    '8C7E6E',  // muted text / sublabels
  orange:  'E85A1A',  // primary accent
  orangeD: 'B84010',  // dark orange / negative
  teal:    '2A7A6F',  // secondary accent
  tealL:   '3D9E91',  // light teal
  tealD:   '1D5A52',  // dark teal
  gold:    'E8B84B',
  line:    'E4DDD4',  // hairline borders
  white:   'FFFFFF',
  // semantic chart colors kept
  green:   '059669',
  red:     'DC2626',
  amber:   'D97706',
  coverSub:'D8D0C6',  // muted cream for dataset/date on the dark cover
}

// Header eats the top of the slide; content starts here.
const CONTENT_Y = 1.7

// ── Spec types ──────────────────────────────────────────────────────────────
export interface BarChartSlide {
  type: 'bar_chart'
  title: string
  subtitle?: string
  data: { label: string; value: number; color?: string }[]
  insight?: string
}

// Vertical column chart — x-axis category labels along the bottom, value on
// top of each bar. `muted` columns (e.g. "opened, never engaged") render gray
// with a divider before them so they read as a distinct, excluded segment.
export interface ColumnChartSlide {
  type: 'column_chart'
  title: string
  subtitle?: string
  xAxisLabel?: string
  yAxisLabel?: string
  data: { label: string; value: number; color?: string; muted?: boolean }[]
  insight?: string
}

export interface KpiGridSlide {
  type: 'kpi_grid'
  title: string
  subtitle?: string
  kpis: { value: string; label: string; sub?: string; color?: string }[]
  insight?: string
}

export interface TableSlide {
  type: 'table'
  title: string
  subtitle?: string
  columns: string[]
  rows: string[][]
  rowTints?: (string | undefined)[]   // optional per-row background tint (overrides zebra) — e.g. color-code groups
  insight?: string
}

export interface BulletsSlide {
  type: 'bullets'
  title: string
  subtitle?: string
  bullets: string[]
  insight?: string
}

export interface QuotesSlide {
  type: 'quotes'
  title: string
  subtitle?: string
  quotes: { text: string; attribution?: string }[]
}

export interface TwoColumnSlide {
  type: 'two_column'
  title: string
  subtitle?: string
  left: { heading?: string; bullets?: string[]; text?: string }
  right: { heading?: string; bullets?: string[]; text?: string }
}

export interface EntityGridSlide {
  type: 'entity_grid'
  title: string
  subtitle?: string
  entities: { name: string; mentions: number; category?: string; pct?: number }[]
  accentColor?: string
  insight?: string
}

export interface ProvenanceSlide {
  type: 'provenance'
  title?: string
  wallClockSeconds: number
  decisionsMade?: number   // legacy optional second top stat (canonicalisations + categorisations + …)
  secondStat?: { value: string; label: string; sub?: string; color?: string }  // factual second top stat; takes precedence over decisionsMade
  columnHeaders?: { inputs: string; processing: string; outputs: string }
  inputs:     { label: string; value: string; sub?: string }[]
  processing: { label: string; value: string; sub?: string }[]
  outputs:    { label: string; value: string; sub?: string }[]
  pipelineStages?: string[]   // optional chip strip below the columns
  humanEquivLow:  number       // hours
  humanEquivHigh: number       // hours
  note?: string
}

export interface CustomDecksSlide {
  type: 'custom_decks'
  title?: string
  tagline?: string
  capabilities: string[]
  examples?: string[]
  hook?: string
}

export type SlideSpec = BarChartSlide | ColumnChartSlide | KpiGridSlide | TableSlide | BulletsSlide | QuotesSlide | TwoColumnSlide | EntityGridSlide | ProvenanceSlide | CustomDecksSlide

export interface DeckSpec {
  title: string
  subtitle?: string
  slides: SlideSpec[]
}

// ── Shared helpers ──────────────────────────────────────────────────────────
function solidRect(slide: any, pptx: any, x: number, y: number, w: number, h: number, fill: string, transparency = 0) {
  slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: fill, transparency }, line: { width: 0 } })
}

function rect(slide: any, pptx: any, x: number, y: number, w: number, h: number, fill: string) {
  slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: fill }, line: { color: CR.line, width: 1 }, rectRadius: 0.07 })
}

/** Prominent subject-brand label, top-right of every content slide (the brand the
 *  report is about). The datanautix producer mark lives in the footer. */
function brandLabel(slide: any, pptx: any, brand?: string) {
  if (!brand) return
  slide.addText(trunc(brand, 40), {
    x: W - 3.8, y: 0.44, w: 3.5, h: 0.46, fontSize: 16, bold: true,
    color: CR.ink, align: 'right', valign: 'top', wrap: false, autoFit: true,
  })
  // short orange accent rule beneath, aligned to the right margin
  solidRect(slide, pptx, W - 2.0, 0.92, 1.7, 0.035, CR.orange)
}

function hdr(slide: any, pptx: any, title: string, subtitle?: string, brand?: string) {
  bgFill(slide, pptx, CR.cream)
  // full-height left accent bar
  solidRect(slide, pptx, 0, 0, 0.16, H, CR.orange)
  // Title is forced to ONE row: no wrap, truncated to fit, and autoFit shrinks
  // it further if still wide — so it never wraps into the subtitle below it.
  slide.addText(trunc(title, 62), {
    x: 0.9, y: 0.52, w: W - 0.9 - 3.8, h: 0.6,
    fontSize: 24, bold: true, color: CR.ink, valign: 'middle', wrap: false, autoFit: true,
  })
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.9, y: 1.16, w: W - 0.9 - 3.8, h: 0.42,
      fontSize: 12.5, color: CR.teal, italic: true, valign: 'top', wrap: true,
    })
  }
  brandLabel(slide, pptx, brand)
}

function footer(slide: any, pptx: any, _datasetName: string) {
  solidRect(slide, pptx, 0, FY - 0.02, W, 0.012, CR.teal, 55)
  // datanautix producer mark (moved here from the header; the subject brand now
  // owns the top-right of each slide).
  slide.addText([
    { text: 'data',   options: { color: CR.teal,   bold: true } },
    { text: 'nautix', options: { color: CR.orange, bold: true } },
    { text: '   ·   datanautix.com', options: { color: CR.ink2 } },
  ], { x: PAD, y: FY, w: W * 0.6, h: 0.26, fontSize: 8.5, valign: 'middle' })
}

function insightBox(slide: any, pptx: any, x: number, y: number, w: number, h: number, text: string) {
  rect(slide, pptx, x, y, w, h, CR.card)
  solidRect(slide, pptx, x, y, 0.06, h, CR.teal)
  slide.addText(text, {
    x: x + 0.18, y: y + 0.06, w: w - 0.26, h: h - 0.12,
    fontSize: 13, color: CR.ink2, italic: true, valign: 'top', wrap: true, lineSpacingMultiple: 1.3, autoFit: true,
  })
}

function pct(v: number, total: number) { return total > 0 ? Math.round(v / total * 100) : 0 }

// ── Slide builders ──────────────────────────────────────────────────────────

// Cream-family bar palette cycled across chart slides.
const BAR_COLORS = [CR.teal, CR.tealL, CR.gold, CR.orange, CR.ink2, CR.tealD, CR.green, CR.amber, CR.red, CR.orangeD]

export function renderBarChart(pptx: any, spec: BarChartSlide, datasetName: string) {
  const slide = pptx.addSlide('NUMBERED')
  hdr(slide, pptx, spec.title, spec.subtitle, datasetName)

  const data = spec.data.slice(0, 12)
  const n = data.length
  const total = data.reduce((s, d) => s + d.value, 0)
  const maxVal = Math.max(...data.map(d => d.value), 1)

  // Layout
  const labelW = 3.2
  const chartX = PAD
  const barX = chartX + labelW + 0.15
  const barMaxW = W - barX - PAD - 1.6
  const pctX = barX + barMaxW + 0.12
  const cntX = pctX + 0.62

  // Column headers
  const headY = CONTENT_Y + 0.05
  slide.addText('', { x: chartX, y: headY, w: labelW, h: 0.26, fontSize: 12, bold: true, color: CR.ink2 })
  slide.addText('Distribution', { x: barX, y: headY, w: barMaxW, h: 0.26, fontSize: 12, bold: true, color: CR.ink2 })
  slide.addText('%', { x: pctX, y: headY, w: 0.6, h: 0.26, fontSize: 12, bold: true, color: CR.ink2 })
  slide.addText('n', { x: cntX, y: headY, w: 1.0, h: 0.26, fontSize: 12, bold: true, color: CR.ink2 })
  solidRect(slide, pptx, chartX, headY + 0.28, W - PAD * 2, 0.012, CR.line)

  // Reserve space for insight
  const insightH = spec.insight ? 0.9 : 0
  const rowAvail = FY - (headY + 0.38) - insightH - 0.12
  const rowH = Math.min(0.52, rowAvail / Math.max(n, 1))
  const rowGap = Math.min(0.06, (rowAvail - rowH * n) / Math.max(n - 1, 1))
  const rowStart = headY + 0.38

  data.forEach((d, i) => {
    const ry = rowStart + i * (rowH + rowGap)
    const barW = barMaxW * d.value / maxVal
    const col = d.color || BAR_COLORS[i % BAR_COLORS.length]
    const p = pct(d.value, total)

    if (i % 2 === 0) solidRect(slide, pptx, chartX, ry, W - PAD * 2, rowH, CR.card)

    slide.addText(trunc(d.label, 40), {
      x: chartX, y: ry, w: labelW, h: rowH,
      fontSize: i === 0 ? 13 : 12.5, bold: i === 0, color: i === 0 ? CR.ink : CR.ink2, valign: 'middle', autoFit: true,
    })

    const trackH = rowH * 0.50
    const trackY = ry + (rowH - trackH) / 2
    solidRect(slide, pptx, barX, trackY, barMaxW, trackH, CR.line)
    if (barW > 0.04) solidRect(slide, pptx, barX, trackY, barW, trackH, col)

    slide.addText(p + '%', { x: pctX, y: ry, w: 0.6, h: rowH, fontSize: i === 0 ? 13 : 12, bold: true, color: col, valign: 'middle' })
    slide.addText(d.value.toLocaleString(), { x: cntX, y: ry, w: 1.0, h: rowH, fontSize: 12, color: CR.ink2, valign: 'middle' })
  })

  if (spec.insight) {
    const insY = rowStart + n * (rowH + rowGap) + 0.08
    insightBox(slide, pptx, PAD, insY, W - PAD * 2, insightH, spec.insight)
  }

  footer(slide, pptx, datasetName)
}

export function renderColumnChart(pptx: any, spec: ColumnChartSlide, datasetName: string) {
  const slide = pptx.addSlide('NUMBERED')
  hdr(slide, pptx, spec.title, spec.subtitle, datasetName)

  const data = spec.data.slice(0, 14)
  const n = data.length
  const maxVal = Math.max(...data.map(d => d.value), 1)

  const insightH = spec.insight ? 0.9 : 0
  const chartX = PAD + 0.1
  const chartTop = CONTENT_Y + 0.25
  const axisY = FY - insightH - 0.5            // baseline (x-axis) y
  const labelY = axisY + 0.06                  // category labels under axis
  const chartW = W - chartX - PAD - 0.1
  const chartH = axisY - chartTop

  // y baseline
  solidRect(slide, pptx, chartX, axisY, chartW, 0.014, CR.line)

  const slotW = chartW / n
  const barW = Math.min(1.1, slotW * 0.62)

  data.forEach((d, i) => {
    const cx = chartX + i * slotW + (slotW - barW) / 2
    const barH = Math.max(0.03, (d.value / maxVal) * (chartH - 0.3))
    const by = axisY - barH
    const col = d.muted ? CR.line : (d.color || BAR_COLORS[i % BAR_COLORS.length])

    // divider before the first muted column to set it apart visually
    if (d.muted && (i === 0 || !data[i - 1].muted)) {
      solidRect(slide, pptx, chartX + i * slotW - 0.01, chartTop, 0.012, chartH, CR.line)
    }

    solidRect(slide, pptx, cx, by, barW, barH, col)
    // value label on top
    slide.addText(d.value.toLocaleString(), {
      x: cx - 0.2, y: by - 0.26, w: barW + 0.4, h: 0.24,
      fontSize: 12, bold: true, color: d.muted ? CR.ink2 : CR.ink, align: 'center',
    })
    // category label under axis
    slide.addText(d.label, {
      x: chartX + i * slotW, y: labelY, w: slotW, h: 0.46,
      fontSize: 10.5, bold: !d.muted, color: CR.ink2, align: 'center', valign: 'top', wrap: true, autoFit: true,
    })
  })

  if (spec.xAxisLabel) {
    slide.addText(spec.xAxisLabel, { x: chartX, y: labelY + 0.5, w: chartW, h: 0.24, fontSize: 9, italic: true, color: CR.ink2, align: 'center' })
  }

  if (spec.insight) {
    insightBox(slide, pptx, PAD, FY - insightH - 0.05, W - PAD * 2, insightH, spec.insight)
  }

  footer(slide, pptx, datasetName)
}

function renderKpiGrid(pptx: any, spec: KpiGridSlide, datasetName: string) {
  const slide = pptx.addSlide('NUMBERED')
  hdr(slide, pptx, spec.title, spec.subtitle, datasetName)

  const kpis = spec.kpis.slice(0, 6)
  const cols = Math.min(kpis.length, 3)
  const rows = Math.ceil(kpis.length / cols)
  const gap = 0.26
  const kw = (W - PAD * 2 - gap * (cols - 1)) / cols
  const kh = 1.25

  kpis.forEach((k, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = PAD + col * (kw + gap)
    const y = CONTENT_Y + 0.1 + row * (kh + gap)
    const accent = k.color || CR.teal

    rect(slide, pptx, x, y, kw, kh, CR.card)
    // thin colored top accent bar
    solidRect(slide, pptx, x, y, kw, 0.07, accent)
    slide.addText(k.value, {
      x: x + 0.16, y: y + 0.14, w: kw - 0.32, h: kh * 0.45,
      fontSize: 34, bold: true, color: accent, valign: 'middle', autoFit: true,
    })
    slide.addText(k.label, {
      x: x + 0.16, y: y + kh * 0.55, w: kw - 0.32, h: 0.26,
      fontSize: 13.5, bold: true, color: CR.ink, autoFit: true,
    })
    if (k.sub) {
      slide.addText(k.sub, {
        x: x + 0.16, y: y + kh * 0.55 + 0.26, w: kw - 0.32, h: 0.24,
        fontSize: 10.5, color: CR.ink2, autoFit: true,
      })
    }
  })

  if (spec.insight) {
    const insY = CONTENT_Y + 0.1 + rows * (kh + gap) + 0.1
    const avail = FY - insY - 0.12
    if (avail > 0.3) insightBox(slide, pptx, PAD, insY, W - PAD * 2, Math.min(1.1, avail), spec.insight)
  }

  footer(slide, pptx, datasetName)
}

function renderTable(pptx: any, spec: TableSlide, datasetName: string) {
  const slide = pptx.addSlide('NUMBERED')
  hdr(slide, pptx, spec.title, spec.subtitle, datasetName)

  const cols = spec.columns
  const rows = spec.rows.slice(0, 15)
  const colW = (W - PAD * 2) / cols.length

  const insightH = spec.insight ? 0.9 : 0
  const tableAvail = FY - CONTENT_Y - 0.1 - insightH - 0.12
  const rowH = Math.min(0.46, tableAvail / (rows.length + 1))

  // Header row
  cols.forEach((col, ci) => {
    const x = PAD + ci * colW
    solidRect(slide, pptx, x, CONTENT_Y + 0.05, colW, rowH, CR.ink)
    slide.addText(col, {
      x: x + 0.1, y: CONTENT_Y + 0.05, w: colW - 0.2, h: rowH,
      fontSize: 12, bold: true, color: CR.white, valign: 'middle', autoFit: true,
    })
  })

  // Data rows
  rows.forEach((row, ri) => {
    const ry = CONTENT_Y + 0.05 + (ri + 1) * rowH
    solidRect(slide, pptx, PAD, ry, W - PAD * 2, rowH, spec.rowTints?.[ri] ?? (ri % 2 === 0 ? CR.card : CR.cream))
    row.forEach((cell, ci) => {
      const x = PAD + ci * colW
      slide.addText(trunc(cell, 50), {
        x: x + 0.1, y: ry, w: colW - 0.2, h: rowH,
        fontSize: 12.5, color: ci === 0 ? CR.ink : CR.ink2, bold: ci === 0, valign: 'middle', autoFit: true,
      })
    })
  })

  if (spec.insight) {
    const insY = CONTENT_Y + 0.05 + (rows.length + 1) * rowH + 0.1
    insightBox(slide, pptx, PAD, insY, W - PAD * 2, insightH, spec.insight)
  }

  footer(slide, pptx, datasetName)
}

function renderBullets(pptx: any, spec: BulletsSlide, datasetName: string) {
  const slide = pptx.addSlide('NUMBERED')
  hdr(slide, pptx, spec.title, spec.subtitle, datasetName)

  const bullets = spec.bullets.slice(0, 10)
  const insightH = spec.insight ? 0.9 : 0
  const avail = FY - CONTENT_Y - 0.1 - insightH - 0.12
  const gap = 0.12
  const bulletH = Math.min(0.52, (avail - gap * (bullets.length - 1)) / bullets.length)

  bullets.forEach((b, i) => {
    const y = CONTENT_Y + 0.1 + i * (bulletH + gap)
    solidRect(slide, pptx, PAD, y, W - PAD * 2, bulletH, CR.card)
    solidRect(slide, pptx, PAD, y, 0.06, bulletH, i % 2 === 0 ? CR.teal : CR.gold)
    slide.addText(b, {
      x: PAD + 0.22, y, w: W - PAD * 2 - 0.34, h: bulletH,
      fontSize: 13.5, color: CR.ink, valign: 'middle', wrap: true, autoFit: true,
    })
  })

  if (spec.insight) {
    const insY = CONTENT_Y + 0.1 + bullets.length * (bulletH + gap) + 0.06
    // Give the insight box ALL remaining vertical space (down to the footer)
    // instead of a fixed 0.52 that crammed 2-3 sentences into one line and
    // bled below the box. Bullets slides usually have empty space below.
    const insAvail = FY - insY - 0.12
    insightBox(slide, pptx, PAD, insY, W - PAD * 2, Math.max(0.52, Math.min(1.5, insAvail)), spec.insight)
  }

  footer(slide, pptx, datasetName)
}

export function renderQuotes(pptx: any, spec: QuotesSlide, datasetName: string) {
  const slide = pptx.addSlide('NUMBERED')
  hdr(slide, pptx, spec.title, spec.subtitle, datasetName)

  const quotes = spec.quotes.slice(0, 6)
  const cols = quotes.length <= 3 ? 1 : 2
  const perCol = Math.ceil(quotes.length / cols)
  const colW = (W - PAD * 2 - (cols > 1 ? 0.2 : 0)) / cols
  const gap = 0.14
  const qh = Math.min(1.2, (FY - CONTENT_Y - 0.2) / perCol - gap)

  quotes.forEach((q, i) => {
    const col = Math.floor(i / perCol)
    const row = i % perCol
    const x = PAD + col * (colW + 0.2)
    const y = CONTENT_Y + 0.1 + row * (qh + gap)

    rect(slide, pptx, x, y, colW, qh, CR.card)
    solidRect(slide, pptx, x, y, 0.06, qh, CR.teal)

    const trimmed = q.text.length > 230 ? q.text.slice(0, 227) + '...' : q.text
    slide.addText([
      { text: '\u201C', options: { fontSize: 17, bold: true, color: CR.tealL } },
      { text: trimmed, options: { fontSize: 13, color: CR.ink2, italic: true } },
      { text: '\u201D', options: { fontSize: 17, bold: true, color: CR.tealL } },
    ], { x: x + 0.16, y: y + 0.08, w: colW - 0.28, h: qh - (q.attribution ? 0.32 : 0.14), valign: 'top', wrap: true, lineSpacingMultiple: 1.4, autoFit: true })

    if (q.attribution) {
      slide.addText('— ' + q.attribution, {
        x: x + 0.16, y: y + qh - 0.26, w: colW - 0.28, h: 0.2,
        fontSize: 8.5, color: CR.ink2, italic: true, align: 'right',
      })
    }
  })

  footer(slide, pptx, datasetName)
}

function renderTwoColumn(pptx: any, spec: TwoColumnSlide, datasetName: string) {
  const slide = pptx.addSlide('NUMBERED')
  hdr(slide, pptx, spec.title, spec.subtitle, datasetName)

  const colW = (W - PAD * 2 - 0.3) / 2
  const contentH = FY - CONTENT_Y - 0.2

  // Vertical divider
  solidRect(slide, pptx, PAD + colW + 0.14, CONTENT_Y + 0.1, 0.012, contentH - 0.1, CR.line)

  function renderCol(col: typeof spec.left, x: number) {
    let y = CONTENT_Y + 0.1
    if (col.heading) {
      slide.addText(col.heading, { x, y, w: colW, h: 0.34, fontSize: 15.5, bold: true, color: CR.ink, valign: 'middle' })
      solidRect(slide, pptx, x, y + 0.36, colW * 0.3, 0.028, CR.teal)
      y += 0.52
    }
    if (col.text) {
      slide.addText(col.text, { x, y, w: colW, h: contentH - (y - CONTENT_Y), fontSize: 13, color: CR.ink2, wrap: true, lineSpacingMultiple: 1.4, valign: 'top', autoFit: true })
    }
    if (col.bullets) {
      col.bullets.forEach((b, i) => {
        slide.addText('\u2022  ' + b, { x, y: y + i * 0.42, w: colW, h: 0.38, fontSize: 13, color: CR.ink2, valign: 'middle', wrap: true, autoFit: true })
      })
    }
  }

  renderCol(spec.left, PAD)
  renderCol(spec.right, PAD + colW + 0.3)

  footer(slide, pptx, datasetName)
}

export function renderEntityGrid(pptx: any, spec: EntityGridSlide, datasetName: string) {
  const slide = pptx.addSlide('NUMBERED')
  hdr(slide, pptx, spec.title, spec.subtitle, datasetName)

  const entities = spec.entities.slice(0, 24)
  const accent = spec.accentColor || CR.teal
  const maxMentions = Math.max(...entities.map(e => e.mentions), 1)

  const cols = 3
  const cardW = (W - PAD * 2 - 0.2) / cols
  const cardH = 0.78
  const gap = 0.1
  const startY = CONTENT_Y + 0.1
  const insightH = spec.insight ? 0.48 : 0

  entities.forEach((ent, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = PAD + col * (cardW + gap)
    const y = startY + row * (cardH + gap)
    if (y + cardH > FY - insightH - 0.15) return

    const barW = Math.max(0.1, (ent.mentions / maxMentions) * (cardW - 0.4))
    const p = ent.pct ?? pct(ent.mentions, entities.reduce((s, e) => s + e.mentions, 0))

    rect(slide, pptx, x, y, cardW, cardH, CR.card)
    solidRect(slide, pptx, x, y, 0.05, cardH, accent)
    // Right-justified number + unit. Box is wide enough for 4-digit mention
    // counts at fontSize 16 bold (was 0.38, narrow → wrapped on 2 digits).
    // Title box's right margin (cardW - 1.05) reserves room for the number
    // column so the two regions never overlap.
    const numW = 0.95
    slide.addText(trunc(ent.name, 35), {
      x: x + 0.16, y: y + 0.07, w: cardW - numW - 0.20, h: 0.30,
      fontSize: 12, bold: true, color: CR.ink, wrap: true, autoFit: true,
    })
    slide.addText(String(ent.mentions), {
      x: x + cardW - numW - 0.05, y: y + 0.04, w: numW, h: 0.32,
      fontSize: 17, bold: true, color: accent, align: 'right',
    })
    slide.addText(ent.mentions === 1 ? 'mention' : 'mentions', {
      x: x + cardW - numW - 0.05, y: y + 0.34, w: numW, h: 0.16,
      fontSize: 8, color: CR.ink2, align: 'right',
    })
    solidRect(slide, pptx, x + 0.16, y + cardH - 0.15, barW, 0.07, accent)
    slide.addText(p + '% of mentions', {
      x: x + 0.16, y: y + 0.40, w: cardW - numW - 0.20, h: 0.20,
      fontSize: 12, color: CR.ink2,
    })
  })

  if (spec.insight) {
    const maxRow = Math.floor((FY - startY - insightH - 0.15) / (cardH + gap))
    const insY = startY + maxRow * (cardH + gap) + 0.06
    insightBox(slide, pptx, PAD, insY, W - PAD * 2, insightH, spec.insight)
  }

  footer(slide, pptx, datasetName)
}

export function fmtWallClock(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} seconds`
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`
  return `${(seconds / 3600).toFixed(1)} hours`
}

export function renderProvenance(pptx: any, spec: ProvenanceSlide, datasetName: string) {
  const slide = pptx.addSlide('NUMBERED')
  hdr(slide, pptx, spec.title || 'How this deck was made.', undefined, datasetName)

  // ── Layout constants — every region derives from these ──
  const contentTop = CONTENT_Y + 0.05
  const contentBot = FY - 0.15
  const statH      = 1.30     // top stats region
  const pipeH      = spec.pipelineStages && spec.pipelineStages.length > 0 ? 0.45 : 0
  const strapH     = 0.95     // bottom productivity strap
  const gap        = 0.15

  const colY    = contentTop + statH + gap
  const strapY  = contentBot - strapH
  const pipeY   = pipeH > 0 ? (strapY - gap - pipeH) : strapY
  const colH    = (pipeH > 0 ? pipeY : strapY) - gap - colY

  // ── Top stats: separate text boxes, explicit y positions, margin:0 so
  //    there is no internal padding stealing space between stacked elements.
  const wallClockTxt = fmtWallClock(spec.wallClockSeconds)
  const wallNum  = wallClockTxt.replace(/seconds?|minutes?|hours?/, '').trim()
  const wallUnit = wallClockTxt.match(/seconds?|minutes?|hours?/)?.[0] || 'time'

  function drawStat(x: number, w: number, value: string, label: string, color: string, sub?: string) {
    // Stat region inside statH (1.30) — top padding 0.05 + value 0.78 + 0.02
    // gap + label 0.22 + 0.02 gap + sub 0.18 + bottom 0.03 = 1.30 exactly
    const topPad = 0.05
    const valH   = 0.78
    const lblHt  = 0.22
    const subHt  = 0.18
    const g      = 0.02
    const valY = contentTop + topPad
    const lblY = valY + valH + g
    const subY = lblY + lblHt + g
    slide.addText(value, {
      x, y: valY, w, h: valH,
      fontSize: 56, bold: true, color, align: 'center', valign: 'middle', autoFit: true, wrap: false, margin: 0 as any,
    })
    slide.addText(label, {
      x, y: lblY, w, h: lblHt,
      fontSize: 18, bold: true, color: CR.ink, align: 'center', valign: 'middle', autoFit: true, wrap: false, margin: 0 as any,
    })
    if (sub) {
      slide.addText(sub, {
        x, y: subY, w, h: subHt,
        fontSize: 10, color: CR.ink2, italic: true, align: 'center', valign: 'middle', autoFit: true, wrap: false, margin: 0 as any,
      })
    }
  }

  if (spec.secondStat || spec.decisionsMade !== undefined) {
    const half = (W - PAD * 2 - 0.4) / 2
    drawStat(PAD, half, wallNum, wallUnit, CR.teal, 'wall-clock')
    slide.addShape(pptx.ShapeType.rect, {
      x: PAD + half + 0.2 - 0.01, y: contentTop + 0.20, w: 0.02, h: statH - 0.40,
      fill: { color: CR.line }, line: { width: 0 },
    })
    if (spec.secondStat) {
      drawStat(PAD + half + 0.4, half, spec.secondStat.value, spec.secondStat.label,
               spec.secondStat.color || CR.gold, spec.secondStat.sub)
    } else {
      drawStat(PAD + half + 0.4, half, (spec.decisionsMade as number).toLocaleString(), 'decisions made', CR.gold,
               'canonicalisations · categorisations · rankings · selections')
    }
  } else {
    drawStat(PAD, W - PAD * 2, wallNum, wallUnit, CR.teal)
  }

  // ── Three columns ── max 3 items each (graceful slice if caller passes more)
  const headers = spec.columnHeaders || { inputs: 'INPUTS TAKEN', processing: 'PROCESSING DONE', outputs: 'OUTPUTS GENERATED' }
  const colW = (W - PAD * 2 - gap * 2) / 3
  const cols = [
    { tag: headers.inputs,     items: spec.inputs.slice(0, 3),     color: CR.tealD },
    { tag: headers.processing, items: spec.processing.slice(0, 3), color: CR.teal },
    { tag: headers.outputs,    items: spec.outputs.slice(0, 3),    color: CR.orange },
  ]
  cols.forEach((col, i) => {
    const x = PAD + i * (colW + gap)
    slide.addShape(pptx.ShapeType.rect, { x, y: colY, w: colW, h: colH, fill: { color: CR.card }, rectRadius: 0.1, line: { color: CR.line, width: 1 } })
    slide.addShape(pptx.ShapeType.rect, { x, y: colY, w: colW, h: 0.42, fill: { color: col.color }, rectRadius: 0.1, line: { width: 0 } })
    slide.addText(col.tag, {
      x, y: colY, w: colW, h: 0.42,
      fontSize: 11, bold: true, color: CR.white, align: 'center', valign: 'middle', charSpacing: 3, autoFit: true,
    })

    // ── Item slot calculations ──
    // Item content (with sub):    value 0.24 + gap 0.04 + label 0.16 + gap 0.04 + sub 0.28 = 0.76
    // Item content (no sub):      value 0.24 + gap 0.04 + label 0.16 = 0.44
    // Plus 0.06 bottom padding per item.
    const innerTop = colY + 0.55             // header (0.42) + top pad (0.13)
    const innerBot = colY + colH - 0.10      // bottom pad
    const innerH = innerBot - innerTop
    const itemSlotH = innerH / Math.max(col.items.length, 1)
    const valH = 0.24
    const labH = 0.16
    const subH = 0.28
    const g    = 0.04

    col.items.forEach((it, j) => {
      const iy = innerTop + j * itemSlotH + 0.02   // tiny top padding inside each slot
      const valY = iy
      const lblY = valY + valH + g
      const subY = lblY + labH + g
      slide.addText(it.value, {
        x: x + 0.15, y: valY, w: colW - 0.3, h: valH,
        fontSize: 16, bold: true, color: CR.ink, valign: 'middle', autoFit: true, wrap: false, margin: 0 as any,
      })
      slide.addText(it.label, {
        x: x + 0.15, y: lblY, w: colW - 0.3, h: labH,
        fontSize: 9.5, color: CR.ink2, italic: true, valign: 'middle', autoFit: true, wrap: false, margin: 0 as any,
      })
      if (it.sub) {
        slide.addText(it.sub, {
          x: x + 0.15, y: subY, w: colW - 0.3, h: subH,
          fontSize: 8.5, color: CR.ink2, valign: 'top', wrap: true, autoFit: true, margin: 0 as any, lineSpacingMultiple: 1.15,
        })
      }
    })
  })

  // ── Pipeline chip strip ──
  if (pipeH > 0 && spec.pipelineStages && spec.pipelineStages.length > 0) {
    slide.addShape(pptx.ShapeType.rect, {
      x: PAD, y: pipeY, w: W - PAD * 2, h: pipeH,
      fill: { color: CR.teal }, rectRadius: 0.06, line: { width: 0 },
    })
    slide.addShape(pptx.ShapeType.rect, {
      x: PAD, y: pipeY, w: 0.14, h: pipeH,
      fill: { color: CR.gold }, line: { width: 0 },
    })
    slide.addText('PIPELINE', {
      x: PAD + 0.25, y: pipeY, w: 0.9, h: pipeH,
      fontSize: 9, bold: true, color: CR.gold, valign: 'middle', charSpacing: 2,
    })
    // The stage chips themselves — one addText with bullet-ish separators
    const stagesText = spec.pipelineStages.map(s => `✓ ${s}`).join('   ·   ')
    slide.addText(stagesText, {
      x: PAD + 1.25, y: pipeY, w: W - PAD * 2 - 1.4, h: pipeH,
      fontSize: 10.5, color: CR.white, valign: 'middle', autoFit: true,
    })
  }

  // ── Bottom productivity strap — horizontal split: stat on left, note on right ──
  slide.addShape(pptx.ShapeType.rect, { x: PAD, y: strapY, w: W - PAD * 2, h: strapH, fill: { color: CR.ink }, rectRadius: 0.08, line: { width: 0 } })
  slide.addShape(pptx.ShapeType.rect, { x: PAD, y: strapY, w: 0.18, h: strapH, fill: { color: CR.orange }, line: { width: 0 } })

  const leftX = PAD + 0.35
  const leftW = (W - PAD * 2 - 0.35) * 0.38
  slide.addText('HUMAN-ANALYST EQUIVALENT', {
    x: leftX, y: strapY + 0.18, w: leftW, h: 0.28,
    fontSize: 10, bold: true, color: CR.gold, valign: 'middle', charSpacing: 3,
  })
  const eqTxt = spec.humanEquivLow === spec.humanEquivHigh
    ? `~${spec.humanEquivLow} hours`
    : `${spec.humanEquivLow}–${spec.humanEquivHigh} hours`
  slide.addText(eqTxt, {
    x: leftX, y: strapY + 0.48, w: leftW, h: strapH - 0.6,
    fontSize: 28, bold: true, color: CR.white, valign: 'middle', autoFit: true,
  })

  const divX = leftX + leftW + 0.25
  slide.addShape(pptx.ShapeType.rect, { x: divX, y: strapY + 0.25, w: 0.015, h: strapH - 0.5, fill: { color: CR.tealL, transparency: 60 }, line: { width: 0 } })

  if (spec.note) {
    const rightX = divX + 0.25
    const rightW = W - PAD - rightX - 0.05
    slide.addText(spec.note, {
      x: rightX, y: strapY + 0.18, w: rightW, h: strapH - 0.36,
      fontSize: 11, color: CR.coverSub, italic: true, valign: 'middle', wrap: true, lineSpacingMultiple: 1.35, autoFit: true,
    })
  }

  footer(slide, pptx, datasetName)
}

export function renderCustomDecks(pptx: any, spec: CustomDecksSlide, datasetName: string) {
  const slide = pptx.addSlide('NUMBERED')
  hdr(slide, pptx, spec.title || 'Every deck is custom.', spec.tagline, datasetName)

  // ── Shared vertical bounds — left stack and right box align top + bottom ──
  const hookH = spec.hook ? 0.55 : 0.10
  const topY    = CONTENT_Y + 0.10
  const bottomY = FY - hookH
  const totalH  = bottomY - topY

  // Left: N capability chips, evenly distributed within [topY, bottomY]
  const capW = 7.0
  const N = Math.max(spec.capabilities.length, 1)
  const gap = 0.14
  const capH = (totalH - gap * (N - 1)) / N
  spec.capabilities.forEach((cap, i) => {
    const y = topY + i * (capH + gap)
    slide.addShape(pptx.ShapeType.rect, { x: PAD, y, w: capW, h: capH, fill: { color: CR.card }, rectRadius: 0.08, line: { color: CR.line, width: 1 } })
    slide.addShape(pptx.ShapeType.rect, { x: PAD, y, w: 0.18, h: capH, fill: { color: CR.teal }, line: { width: 0 } })
    slide.addText(cap, {
      x: PAD + 0.4, y, w: capW - 0.55, h: capH,
      fontSize: 15, color: CR.ink, valign: 'middle', wrap: true, autoFit: true, lineSpacingMultiple: 1.3,
    })
  })

  // Right: single examples box — IDENTICAL top + bottom Y as the left stack
  if (spec.examples && spec.examples.length > 0) {
    const exX = PAD + capW + 0.25
    const exW = W - exX - PAD
    const exHeaderH = 0.45
    slide.addShape(pptx.ShapeType.rect, { x: exX, y: topY, w: exW, h: totalH, fill: { color: CR.ink }, rectRadius: 0.08, line: { width: 0 } })
    slide.addShape(pptx.ShapeType.rect, { x: exX, y: topY, w: exW, h: exHeaderH, fill: { color: CR.gold }, rectRadius: 0.08, line: { width: 0 } })
    slide.addText('EXAMPLE CUSTOM DECKS', {
      x: exX, y: topY, w: exW, h: exHeaderH,
      fontSize: 10, bold: true, color: CR.ink, align: 'center', valign: 'middle', charSpacing: 3,
    })
    // Distribute the example lines evenly inside the box
    const innerTop = topY + exHeaderH + 0.15
    const innerBot = topY + totalH - 0.15
    const itemH = (innerBot - innerTop) / spec.examples.length
    spec.examples.forEach((ex, i) => {
      slide.addText(`"${ex}"`, {
        x: exX + 0.25, y: innerTop + i * itemH, w: exW - 0.5, h: itemH,
        fontSize: 13, color: CR.white, italic: true, valign: 'middle', wrap: true, autoFit: true,
      })
    })
  }

  // Hook at the bottom — anchored to the same bottomY as the columns
  if (spec.hook) {
    slide.addText(spec.hook, {
      x: PAD, y: bottomY + 0.12, w: W - PAD * 2, h: hookH - 0.2,
      fontSize: 14, bold: true, italic: true, color: CR.teal, align: 'center', valign: 'middle',
    })
  }

  footer(slide, pptx, datasetName)
}

// ── Title slide ─────────────────────────────────────────────────────────────
// Dark INK cover — premium, high-contrast against the cream content slides.
function renderTitleSlide(pptx: any, title: string, subtitle: string, datasetName: string) {
  const slide = pptx.addSlide('NUMBERED')
  solidRect(slide, pptx, 0, 0, W, H, CR.ink)
  // full-height orange left bar
  solidRect(slide, pptx, 0, 0, 0.22, H, CR.orange)

  // datanautix wordmark, top-left
  slide.addText([
    { text: 'data',   options: { color: CR.tealL,  bold: true } },
    { text: 'nautix', options: { color: CR.orange, bold: true } },
  ], { x: 0.75, y: 0.55, w: 4.0, h: 0.45, fontSize: 18, valign: 'middle' })

  // Title block
  slide.addText(title, { x: 0.75, y: 2.5, w: W - 2.0, h: 1.4, fontSize: 40, bold: true, color: CR.white, wrap: true, valign: 'top', autoFit: true })
  solidRect(slide, pptx, 0.78, 3.95, 4.5, 0.045, CR.orange)
  if (subtitle) {
    slide.addText(subtitle, { x: 0.75, y: 4.15, w: W - 2.0, h: 0.6, fontSize: 18, color: CR.tealL, italic: true, wrap: true })
  }

  slide.addText(datasetName, { x: 0.75, y: 5.6, w: W - 2.0, h: 0.4, fontSize: 13, color: CR.coverSub })
  slide.addText(new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), { x: 0.75, y: 5.98, w: W - 2.0, h: 0.35, fontSize: 12, color: CR.coverSub })

  slide.addText('datanautix.com', { x: 0.75, y: H - 0.6, w: 4.0, h: 0.34, fontSize: 12, color: CR.ink2, valign: 'middle' })
}


// ── Main renderer ───────────────────────────────────────────────────────────
export async function renderDeck(deck: DeckSpec, datasetName: string): Promise<Buffer> {
  const pptxgen = (await import('pptxgenjs')).default
  const pptx = new pptxgen()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Datanautix'
  pptx.company = 'Datanautix'
  pptx.title = deck.title
  pptx.defineSlideMaster({
    title: 'NUMBERED',
    slideNumber: { x: W - PAD - 0.5, y: FY, w: 0.5, h: 0.26, color: CR.ink2, fontSize: 8, align: 'right' },
  })

  renderTitleSlide(pptx, deck.title, deck.subtitle || '', datasetName)

  for (const spec of deck.slides) {
    switch (spec.type) {
      case 'bar_chart':   renderBarChart(pptx, spec, datasetName); break
      case 'column_chart': renderColumnChart(pptx, spec, datasetName); break
      case 'kpi_grid':    renderKpiGrid(pptx, spec, datasetName); break
      case 'table':       renderTable(pptx, spec, datasetName); break
      case 'bullets':     renderBullets(pptx, spec, datasetName); break
      case 'quotes':      renderQuotes(pptx, spec, datasetName); break
      case 'two_column':  renderTwoColumn(pptx, spec, datasetName); break
      case 'entity_grid': renderEntityGrid(pptx, spec as EntityGridSlide, datasetName); break
      case 'provenance':   renderProvenance(pptx, spec, datasetName); break
      case 'custom_decks': renderCustomDecks(pptx, spec, datasetName); break
      default:
        // Unknown type — render as bullets with the raw data
        renderBullets(pptx, { type: 'bullets', title: (spec as any).title || 'Slide', bullets: [JSON.stringify(spec)] }, datasetName)
    }
  }

  const buffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer
  return Buffer.from(buffer)
}
