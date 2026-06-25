// lib/pptx/slideRenderer.ts
// Lightweight slide spec renderer — takes JSON slide specs from Ana and renders
// them into pptxgenjs slides using the shared Datanautix brand primitives.

import { W, H, PAD, FY, bgFill, trunc } from './shared'

// ── CREAM palette ────────────────────────────────────────────────────────────
// Defined LOCALLY so we can re-skin every deck that uses this renderer without
// touching shared.ts (other self-contained decks import DN/W/H/CY from there).
const CR = {
  // Modern base — white / cool gray / deep navy — with the Datanautix Ana orange
  // as the signature accent and a cool blue as the secondary/variety color.
  cream:   'FFFFFF',  // slide background for content slides (white)
  card:    'F1F5F9',  // card fill (cool light gray)
  ink:     '0F1E33',  // primary text / dark cover bg (deep navy)
  ink2:    '5B6B7F',  // muted text / sublabels (slate)
  orange:  'E85A1A',  // primary accent — Datanautix Ana orange
  orangeD: 'B84010',  // dark orange / negative
  teal:    'E85A1A',  // workhorse accent (badges/KPIs/stripes) — intentionally orange
  tealL:   '38BDF8',  // sky blue — wordmark "data", quote marks, eyebrows (cool counterpoint)
  tealD:   '1E3A8A',  // deep blue (secondary accent)
  gold:    '2563EB',  // secondary pop (blue) — bullet/bar variety
  line:    'E2E8F0',  // hairline borders (slate-200)
  white:   'FFFFFF',
  // semantic chart colors kept
  green:   '059669',
  red:     'DC2626',
  amber:   'D97706',
  coverSub:'C7D2E0',  // muted steel for dataset/date on the dark cover
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
  valueSuffix?: string   // appended to each on-bar value label (e.g. '%') — use for percentage charts, NOT rating charts
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
  insight?: string   // optional AI narrative/implication shown in a band below the quotes
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

// Full-bleed section divider on the dark cream-family cover background. Used to
// break a long report into labelled chapters (Themes, Quotes, Statistics, …).
export interface SectionSlide {
  type: 'section'
  title: string
  subtitle?: string
  eyebrow?: string   // small uppercase kicker above the title (e.g. "THEMES")
}

// Theme-analysis cards: each card = a big share %, the theme name, a sentiment
// badge, and a row of keyword chips (each with its own share %). The signature
// StoryTime slide.
export interface ThemeCardsSlide {
  type: 'theme_cards'
  title: string
  subtitle?: string
  cards: {
    name: string
    pct: number                 // theme share of analysed comments
    count?: number              // n matching
    total?: number              // of N analysed
    sentiment?: string          // 'Positive' | 'Mixed' | 'Negative' | 'Neutral'
    keywords?: { word: string; pct?: number }[]
  }[]
  insight?: string
}

// Verbatim-comment cards in a 2-column grid (up to 8). Each card holds a quoted
// comment plus optional metadata pills (e.g. demographic / psychographic tags),
// with a left accent strip that can be color-coded by a source value.
export interface CommentsGridSlide {
  type: 'comments_grid'
  title: string
  subtitle?: string
  comments: {
    text: string
    accent?: string                                        // left strip color (sentiment / value gradient)
    pills?: { label: string; tone?: 'demo' | 'psycho' | 'neutral' }[]
  }[]
}

// Numeric-field distribution: a row of summary-stat cards above a histogram, with
// an optional mean marker. Covers both continuous (binned) and discrete-integer
// fields — the caller supplies the buckets either way.
export interface NumericStatsSlide {
  type: 'numeric_stats'
  title: string
  subtitle?: string
  stats: { label: string; value: string; color?: string }[]
  histogram?: { label: string; count: number }[]
  meanFrac?: number      // 0..1 position of the mean within [min,max] — draws the mean line
  meanLabel?: string     // e.g. "avg 4"
  insight?: string
}

// Response-distribution horizontal bars with an optional KPI strip on top
// (respondents / top response / top-2 positive). The categorical + pie builders
// both reduce to this.
export interface DistBarsSlide {
  type: 'dist_bars'
  title: string
  subtitle?: string
  kpis?: { value: string; label: string; sub?: string; color?: string }[]
  data: { label: string; value: number; color?: string }[]
  insight?: string
}

// 2×2 compact grid of mini bar charts — one card per categorical field. Packs
// low-priority survey/psychographic/demographic fields without one-slide-each bloat.
export interface CompactGridSlide {
  type: 'compact_grid'
  title: string
  subtitle?: string
  cells: {
    label: string
    total: number
    bars: { label: string; value: number; color?: string }[]
  }[]
}

// Survey response + completion funnel: headline KPI cards above a stage-by-stage
// retention funnel (each stage a bar sized to its share of stage 1).
export interface SurveyFunnelSlide {
  type: 'survey_funnel'
  title: string
  subtitle?: string
  kpis: { value: string; label: string; sub?: string; color?: string }[]
  stages: { label: string; count: number }[]
  insight?: string
}

// Key-driver (OLS coefficient) chart — diverging horizontal bars around a zero
// line; green raises / red lowers the target metric, faded = not significant.
export interface ThemeImpactSlide {
  type: 'theme_impact'
  title: string
  subtitle?: string
  impacts: { themeName: string; coefficient: number; significant: boolean }[]
  interpretation?: string
}

export type SlideSpec = BarChartSlide | ColumnChartSlide | KpiGridSlide | TableSlide | BulletsSlide | QuotesSlide | TwoColumnSlide | EntityGridSlide | ProvenanceSlide | CustomDecksSlide | SectionSlide | ThemeCardsSlide | CommentsGridSlide | NumericStatsSlide | DistBarsSlide | CompactGridSlide | SurveyFunnelSlide | ThemeImpactSlide

export interface DeckSpec {
  title: string
  subtitle?: string
  preparedFor?: string
  preparedBy?: string
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

// Word-boundary clip with ellipsis. Used to HARD-cap verbatim text to a budget
// derived from its card size, so a quote can never bleed past the card even when
// the renderer ignores pptx autoFit shrink (LibreOffice/older PowerPoint).
function clip(s: string, max: number): string {
  if (!s || s.length <= max) return s
  const cut = s.slice(0, max)
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  if (sentence > max * 0.55) return cut.slice(0, sentence + 1)
  const sp = cut.lastIndexOf(' ')
  return (sp > 0 ? cut.slice(0, sp) : cut).replace(/[\s,;:]+$/, '') + '…'
}

// Chars that fit a w×h box at the given font size (conservative — leaves margin
// so wrapping never pushes a final line out of the box).
function fitBudget(w: number, h: number, fontPt: number): number {
  const charW = fontPt * 0.0066      // ~inches per char (italic body)
  const lineH = fontPt / 72 * 1.28   // line height at 1.28 spacing
  const perLine = Math.max(8, Math.floor(w / charW))
  const lines = Math.max(1, Math.floor(h / lineH))
  return Math.max(40, Math.floor(perLine * lines * 0.92))
}

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
    slide.addText(d.value.toLocaleString() + (spec.valueSuffix || ''), {
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
  // 1–2 quotes → one full-width column; 3+ → two columns.
  const cols = quotes.length <= 2 ? 1 : 2
  const perCol = Math.ceil(quotes.length / cols)
  const colGap = cols > 1 ? 0.24 : 0
  const colW = (W - PAD * 2 - colGap) / cols
  const gap = 0.16
  const insightH = spec.insight ? 0.85 : 0
  const top = CONTENT_Y + 0.1
  const availH = FY - top - 0.12 - insightH
  // Card height: fill the available space, but CAPPED so a short quote isn't
  // marooned in a giant box. When capped, the stack is centered vertically so the
  // layout still looks intentional (and long quotes are trimmed to fit — no bleed).
  const MAX_QH = 1.7
  const qh = Math.min(MAX_QH, (availH - gap * (perCol - 1)) / perCol)
  const stackH = qh * perCol + gap * (perCol - 1)
  const top0 = top + Math.max(0, (availH - stackH) / 2)
  const FS = 12.5

  quotes.forEach((q, i) => {
    const col = Math.floor(i / perCol)
    const row = i % perCol
    const x = PAD + col * (colW + colGap)
    const y = top0 + row * (qh + gap)

    rect(slide, pptx, x, y, colW, qh, CR.card)
    solidRect(slide, pptx, x, y, 0.06, qh, CR.teal)

    const innerW = colW - 0.34
    const innerH = qh - (q.attribution ? 0.34 : 0.2)
    // Hard char budget from the card size → text can't bleed even when the
    // rendering app ignores pptx autoFit shrink (LibreOffice / older PowerPoint).
    const body = clip(q.text, fitBudget(innerW, innerH, FS))
    slide.addText([
      { text: '\u201C', options: { fontSize: FS + 4, bold: true, color: CR.tealL } },
      { text: body, options: { fontSize: FS, color: CR.ink2, italic: true } },
      { text: '\u201D', options: { fontSize: FS + 4, bold: true, color: CR.tealL } },
    ], { x: x + 0.16, y: y + 0.1, w: innerW, h: innerH, valign: 'middle', wrap: true, lineSpacingMultiple: 1.28, autoFit: true })

    if (q.attribution) {
      slide.addText('— ' + q.attribution, {
        x: x + 0.16, y: y + qh - 0.26, w: innerW, h: 0.2,
        fontSize: 8.5, color: CR.ink2, italic: true, align: 'right',
      })
    }
  })

  if (spec.insight) {
    insightBox(slide, pptx, PAD, FY - insightH - 0.05, W - PAD * 2, insightH, spec.insight)
  }

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
    if (col.bullets && col.bullets.length) {
      // Native bullets (not a literal "\u2022 " prefix) so a wrapped line hangs-indents
      // to align with the text above it, not under the bullet glyph. One text box
      // \u2192 the bullets auto-flow and never overlap when they wrap.
      slide.addText(
        col.bullets.map((b) => ({ text: b, options: { bullet: { indent: 16 }, paraSpaceAfter: 10 } })),
        { x, y, w: colW, h: contentH - (y - CONTENT_Y), fontSize: 13, color: CR.ink2, valign: 'top', wrap: true, lineSpacingMultiple: 1.15, autoFit: true },
      )
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
  const statH      = 1.02     // top stats region (trimmed so the 3-item columns fit value+label+sub)
  const pipeH      = spec.pipelineStages && spec.pipelineStages.length > 0 ? 0.42 : 0
  const strapH     = 0.80     // bottom productivity strap
  const gap        = 0.12

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
    // Stat region inside statH (1.02): topPad 0.04 + value 0.60 + 0.02 gap +
    // label 0.18 + 0.02 gap + sub 0.14 + bottom 0.02 = 1.02
    const topPad = 0.04
    const valH   = 0.60
    const lblHt  = 0.18
    const subHt  = 0.14
    const g      = 0.02
    const valY = contentTop + topPad
    const lblY = valY + valH + g
    const subY = lblY + lblHt + g
    slide.addText(value, {
      x, y: valY, w, h: valH,
      fontSize: 46, bold: true, color, align: 'center', valign: 'middle', autoFit: true, wrap: false, margin: 0 as any,
    })
    slide.addText(label, {
      x, y: lblY, w, h: lblHt,
      fontSize: 16, bold: true, color: CR.ink, align: 'center', valign: 'middle', autoFit: true, wrap: false, margin: 0 as any,
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
    const valH = 0.22
    const labH = 0.15
    const g    = 0.03
    // Sub height is whatever room is left IN the slot — so a sub can never spill
    // into the next item's value (the bug the owner caught). Kept to one line.
    const subH = Math.min(0.28, itemSlotH - valH - labH - g * 2 - 0.03)

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
      if (it.sub && subH >= 0.11) {
        slide.addText(clip(it.sub, 60), {
          x: x + 0.15, y: subY, w: colW - 0.3, h: subH,
          fontSize: 8.5, color: CR.ink2, valign: 'top', wrap: false, autoFit: true, margin: 0 as any,
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
function renderTitleSlide(pptx: any, title: string, subtitle: string, datasetName: string, preparedFor?: string, preparedBy?: string) {
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

  if (preparedFor) {
    slide.addText(`Prepared for ${preparedFor}`, { x: 0.75, y: 6.36, w: W - 2.0, h: 0.32, fontSize: 12, color: CR.coverSub })
  }
  if (preparedBy) {
    slide.addText(`Prepared by ${preparedBy}`, { x: 0.75, y: preparedFor ? 6.68 : 6.36, w: W - 2.0, h: 0.32, fontSize: 12, color: CR.coverSub })
  }

  slide.addText('datanautix.com', { x: 0.75, y: H - 0.6, w: 4.0, h: 0.34, fontSize: 12, color: CR.ink2, valign: 'middle' })
}


// Section divider — chapter break on the dark cream-family background.
function renderSection(pptx: any, spec: SectionSlide, _datasetName: string) {
  const slide = pptx.addSlide('NUMBERED')
  solidRect(slide, pptx, 0, 0, W, H, CR.ink)
  solidRect(slide, pptx, 0, 0, 0.22, H, CR.orange)
  let y = 2.7
  if (spec.eyebrow) {
    slide.addText(spec.eyebrow.toUpperCase(), { x: 0.9, y, w: W - 2.0, h: 0.32, fontSize: 12, bold: true, color: CR.tealL, charSpacing: 2 })
    y += 0.5
  }
  slide.addText(trunc(spec.title, 60), { x: 0.9, y, w: W - 2.0, h: 1.0, fontSize: 34, bold: true, color: CR.white, valign: 'top', wrap: true, autoFit: true })
  solidRect(slide, pptx, 0.93, y + 1.02, 3.6, 0.04, CR.orange)
  if (spec.subtitle) {
    slide.addText(spec.subtitle, { x: 0.9, y: y + 1.2, w: W - 2.2, h: 0.7, fontSize: 15, color: CR.coverSub, italic: true, valign: 'top', wrap: true, lineSpacingMultiple: 1.3 })
  }
  slide.addText([
    { text: 'data',   options: { color: CR.tealL,  bold: true } },
    { text: 'nautix', options: { color: CR.orange, bold: true } },
  ], { x: 0.9, y: H - 0.7, w: 4.0, h: 0.34, fontSize: 12, valign: 'middle' })
}

// Theme-analysis cards — stacked full-width cards (share %, name, sentiment
// badge, keyword chips).
const SENT_COLOR: Record<string, { fg: string; bg: string }> = {
  positive: { fg: CR.green,  bg: 'EAF7F1' },
  negative: { fg: CR.red,    bg: 'FCEDEC' },
  mixed:    { fg: CR.amber,  bg: 'FBF2DF' },
  neutral:  { fg: CR.ink2,   bg: 'F0EBE3' },
}
function renderThemeCards(pptx: any, spec: ThemeCardsSlide, datasetName: string) {
  const slide = pptx.addSlide('NUMBERED')
  hdr(slide, pptx, spec.title, spec.subtitle, datasetName)

  const cards = spec.cards.slice(0, 5)
  const insightH = spec.insight ? 0.8 : 0
  const top = CONTENT_Y + 0.05
  const avail = FY - top - 0.12 - insightH
  const gap = 0.16
  const ch = Math.min(1.15, (avail - gap * (cards.length - 1)) / Math.max(cards.length, 1))

  cards.forEach((c, i) => {
    const y = top + i * (ch + gap)
    rect(slide, pptx, PAD, y, W - PAD * 2, ch, CR.card)
    solidRect(slide, pptx, PAD, y, 0.06, ch, CR.teal)

    // Share-% box (left)
    const boxW = 1.25
    solidRect(slide, pptx, PAD + 0.14, y + 0.12, boxW, ch - 0.24, CR.teal)
    slide.addText(Math.round(c.pct) + '%', {
      x: PAD + 0.14, y: y + 0.16, w: boxW, h: (ch - 0.24) * 0.6,
      fontSize: 22, bold: true, color: CR.white, align: 'center', valign: 'middle', autoFit: true,
    })
    if (c.count != null) {
      slide.addText(c.count.toLocaleString() + (c.total != null ? ' of ' + c.total.toLocaleString() : ''), {
        x: PAD + 0.14, y: y + ch - 0.34, w: boxW, h: 0.22,
        fontSize: 8, color: CR.white, align: 'center', valign: 'middle',
      })
    }

    const tx = PAD + 0.14 + boxW + 0.24
    const tw = W - PAD - tx - 0.16
    // Theme name
    slide.addText(trunc(c.name, 48), {
      x: tx, y: y + 0.12, w: tw - 1.6, h: 0.34, fontSize: 15, bold: true, color: CR.ink, valign: 'middle', autoFit: true,
    })
    // Sentiment badge (top-right)
    if (c.sentiment) {
      const s = SENT_COLOR[c.sentiment.toLowerCase()] || SENT_COLOR.neutral
      slide.addShape(pptx.ShapeType.roundRect, { x: W - PAD - 1.4, y: y + 0.14, w: 1.24, h: 0.3, rectRadius: 0.06, fill: { color: s.bg }, line: { color: s.fg, width: 1 } })
      slide.addText(c.sentiment, { x: W - PAD - 1.4, y: y + 0.14, w: 1.24, h: 0.3, fontSize: 9.5, bold: true, color: s.fg, align: 'center', valign: 'middle' })
    }
    // Keyword chips as one inline rich-text row
    if (c.keywords && c.keywords.length) {
      const runs: any[] = []
      c.keywords.slice(0, 8).forEach((k, ki) => {
        if (ki > 0) runs.push({ text: '   ', options: { fontSize: 12 } })
        runs.push({ text: k.word, options: { fontSize: 12.5, bold: true, color: CR.teal } })
        if (k.pct != null) runs.push({ text: ' ' + Math.round(k.pct) + '%', options: { fontSize: 9, color: CR.ink2 } })
      })
      slide.addText(runs, { x: tx, y: y + 0.52, w: tw, h: ch - 0.62, valign: 'top', wrap: true, lineSpacingMultiple: 1.2 })
    }
  })

  if (spec.insight) {
    const insY = top + cards.length * (ch + gap) + 0.04
    if (FY - insY - 0.12 > 0.3) insightBox(slide, pptx, PAD, insY, W - PAD * 2, Math.min(0.8, FY - insY - 0.12), spec.insight)
  }

  footer(slide, pptx, datasetName)
}

// Verbatim-comment grid — 2 columns × up to 4 rows of quoted cards with optional
// metadata pills pinned to the bottom of each card.
const PILL_TONE: Record<string, { bg: string; fg: string }> = {
  demo:    { bg: 'FCEFE6', fg: CR.orange },
  psycho:  { bg: 'E6F2F0', fg: CR.teal },
  neutral: { bg: 'F0EBE3', fg: CR.ink2 },
}
function renderCommentsGrid(pptx: any, spec: CommentsGridSlide, datasetName: string) {
  const slide = pptx.addSlide('NUMBERED')
  hdr(slide, pptx, spec.title, spec.subtitle, datasetName)

  const comments = spec.comments.slice(0, 8)
  const cols = 2
  const rows = Math.max(1, Math.ceil(comments.length / cols))
  const gapX = 0.24, gapY = 0.18
  const top = CONTENT_Y + 0.05
  const avail = FY - top - 0.1
  const cardW = (W - PAD * 2 - gapX * (cols - 1)) / cols
  // Cap card height so a near-empty last slide (1–2 comments) doesn't blow each
  // card up to full-slide size; center the rows when capped.
  const cardH = Math.min(2.0, (avail - gapY * (rows - 1)) / rows)
  const gridH = cardH * rows + gapY * (rows - 1)
  const top0 = top + Math.max(0, (avail - gridH) / 2)

  comments.forEach((c, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = PAD + col * (cardW + gapX)
    const y = top0 + row * (cardH + gapY)
    rect(slide, pptx, x, y, cardW, cardH, CR.card)
    solidRect(slide, pptx, x, y, 0.06, cardH, c.accent || CR.teal)

    const hasPills = !!(c.pills && c.pills.length)
    const pillH = 0.26
    const textH = cardH - 0.2 - (hasPills ? pillH + 0.08 : 0)
    const body = clip(c.text, fitBudget(cardW - 0.34, textH, 12))
    slide.addText([
      { text: '“', options: { fontSize: 16, bold: true, color: CR.tealL } },
      { text: body, options: { fontSize: 12, color: CR.ink2, italic: true } },
      { text: '”', options: { fontSize: 16, bold: true, color: CR.tealL } },
    ], { x: x + 0.16, y: y + 0.1, w: cardW - 0.28, h: textH, valign: 'top', wrap: true, lineSpacingMultiple: 1.28, autoFit: true })

    if (hasPills) {
      let px = x + 0.16
      const py = y + cardH - pillH - 0.08
      const maxRight = x + cardW - 0.12
      c.pills!.slice(0, 6).forEach((p) => {
        if (!p.label) return
        const pw = p.label.length * 0.072 + 0.20
        if (px + pw > maxRight) return
        const tone = PILL_TONE[p.tone || 'neutral'] || PILL_TONE.neutral
        slide.addShape(pptx.ShapeType.roundRect, { x: px, y: py, w: pw, h: pillH, rectRadius: 0.13, fill: { color: tone.bg }, line: { width: 0 } })
        slide.addText(p.label, { x: px, y: py, w: pw, h: pillH, fontSize: 8.5, bold: true, color: tone.fg, align: 'center', valign: 'middle', wrap: false })
        px += pw + 0.08
      })
    }
  })

  footer(slide, pptx, datasetName)
}

// Numeric distribution — summary-stat cards over a histogram with an optional mean line.
function renderNumericStats(pptx: any, spec: NumericStatsSlide, datasetName: string) {
  const slide = pptx.addSlide('NUMBERED')
  hdr(slide, pptx, spec.title, spec.subtitle, datasetName)

  const stats = spec.stats.slice(0, 6)
  const top = CONTENT_Y + 0.05
  const sgap = 0.16
  const sw = (W - PAD * 2 - sgap * (stats.length - 1)) / Math.max(stats.length, 1)
  const sh = 0.95
  stats.forEach((st, i) => {
    const x = PAD + i * (sw + sgap)
    rect(slide, pptx, x, top, sw, sh, CR.card)
    solidRect(slide, pptx, x, top, sw, 0.06, st.color || CR.teal)
    slide.addText(st.value, { x: x + 0.1, y: top + 0.14, w: sw - 0.2, h: sh * 0.46, fontSize: 23, bold: true, color: st.color || CR.teal, align: 'center', valign: 'middle', autoFit: true })
    slide.addText(st.label, { x: x + 0.1, y: top + sh * 0.62, w: sw - 0.2, h: sh * 0.3, fontSize: 11, bold: true, color: CR.ink2, align: 'center', valign: 'middle', autoFit: true })
  })

  const insightH = spec.insight ? 0.8 : 0
  const histTop = top + sh + 0.45
  const histBot = FY - insightH - 0.45
  const hist = spec.histogram || []
  if (hist.length > 0 && histBot > histTop) {
    slide.addText('DISTRIBUTION', { x: PAD, y: histTop - 0.3, w: W - PAD * 2, h: 0.22, fontSize: 10, bold: true, color: CR.ink2, charSpacing: 2 })
    solidRect(slide, pptx, PAD, histTop - 0.05, W - PAD * 2, 0.012, CR.line)
    const chartX = PAD
    const chartW = W - PAD * 2
    const axisY = histBot
    const chartH = axisY - histTop
    const maxC = Math.max(...hist.map(b => b.count), 1)
    const bw = chartW / hist.length
    solidRect(slide, pptx, chartX, axisY, chartW, 0.012, CR.line)
    hist.forEach((b, i) => {
      const bh = Math.max(0.02, (b.count / maxC) * (chartH - 0.1))
      const bx = chartX + i * bw
      solidRect(slide, pptx, bx + 0.03, axisY - bh, Math.max(0.04, bw - 0.06), bh, CR.teal)
    })
    const step = Math.max(1, Math.ceil(hist.length / 10))
    hist.forEach((b, i) => {
      if (i % step !== 0 && i !== hist.length - 1) return
      slide.addText(b.label, { x: chartX + i * bw - bw * 0.5, y: axisY + 0.04, w: bw * 2, h: 0.24, fontSize: 9, color: CR.ink2, align: 'center' })
    })
    if (spec.meanFrac != null) {
      const mx = chartX + Math.max(0, Math.min(1, spec.meanFrac)) * chartW
      solidRect(slide, pptx, mx - 0.01, histTop, 0.02, chartH, CR.orange)
      if (spec.meanLabel) {
        const mlx = Math.min(Math.max(chartX, mx - 0.42), chartX + chartW - 0.84)
        // cream chip so the label stays legible where it crosses a tall bar
        solidRect(slide, pptx, mlx, histTop + 0.02, 0.84, 0.24, CR.cream)
        slide.addText(spec.meanLabel, { x: mlx, y: histTop + 0.02, w: 0.84, h: 0.24, fontSize: 9, bold: true, color: CR.orange, align: 'center', valign: 'middle' })
      }
    }
  }

  if (spec.insight) insightBox(slide, pptx, PAD, FY - insightH - 0.05, W - PAD * 2, insightH, spec.insight)
  footer(slide, pptx, datasetName)
}

// Response-distribution horizontal bars with an optional KPI strip on top.
function renderDistBars(pptx: any, spec: DistBarsSlide, datasetName: string) {
  const slide = pptx.addSlide('NUMBERED')
  hdr(slide, pptx, spec.title, spec.subtitle, datasetName)

  let top = CONTENT_Y + 0.05
  const kpis = (spec.kpis || []).slice(0, 3)
  if (kpis.length) {
    const kgap = 0.16
    const kw = (W - PAD * 2 - kgap * (kpis.length - 1)) / kpis.length
    const kh = 0.85
    kpis.forEach((k, i) => {
      const x = PAD + i * (kw + kgap)
      rect(slide, pptx, x, top, kw, kh, CR.card)
      solidRect(slide, pptx, x, top, 0.06, kh, k.color || CR.teal)
      slide.addText(k.value, { x: x + 0.18, y: top + 0.08, w: kw - 0.32, h: kh * 0.5, fontSize: 22, bold: true, color: k.color || CR.teal, valign: 'middle', autoFit: true })
      slide.addText(k.label, { x: x + 0.18, y: top + kh * 0.56, w: kw - 0.32, h: 0.24, fontSize: 11.5, bold: true, color: CR.ink, autoFit: true })
      if (k.sub) slide.addText(k.sub, { x: x + 0.18, y: top + kh * 0.56 + 0.22, w: kw - 0.32, h: 0.2, fontSize: 9, color: CR.ink2, autoFit: true })
    })
    top += kh + 0.24
  }

  const data = spec.data.slice(0, 9)
  const n = data.length
  const total = data.reduce((s, d) => s + d.value, 0)
  const maxVal = Math.max(...data.map(d => d.value), 1)
  const labelW = 3.0
  const barX = PAD + labelW + 0.15
  const barMaxW = W - barX - PAD - 1.5
  const pctX = barX + barMaxW + 0.12
  const cntX = pctX + 0.62

  const headY = top
  slide.addText('Response', { x: PAD, y: headY, w: labelW, h: 0.24, fontSize: 11.5, bold: true, color: CR.ink2, valign: 'middle' })
  slide.addText('Distribution', { x: barX, y: headY, w: barMaxW, h: 0.24, fontSize: 11.5, bold: true, color: CR.ink2, valign: 'middle' })
  slide.addText('%', { x: pctX, y: headY, w: 0.6, h: 0.24, fontSize: 11.5, bold: true, color: CR.ink2, valign: 'middle' })
  slide.addText('n', { x: cntX, y: headY, w: 1.0, h: 0.24, fontSize: 11.5, bold: true, color: CR.ink2, valign: 'middle' })
  solidRect(slide, pptx, PAD, headY + 0.28, W - PAD * 2, 0.012, CR.line)

  const insightH = spec.insight ? 0.8 : 0
  const rowStart = headY + 0.38
  const rowAvail = FY - rowStart - insightH - 0.12
  const rowH = Math.min(0.56, rowAvail / Math.max(n, 1))
  const rowGap = Math.min(0.08, (rowAvail - rowH * n) / Math.max(n - 1, 1))

  data.forEach((d, i) => {
    const ry = rowStart + i * (rowH + rowGap)
    const col = d.color || BAR_COLORS[i % BAR_COLORS.length]
    const p = pct(d.value, total)
    if (i % 2 === 0) solidRect(slide, pptx, PAD, ry, W - PAD * 2, rowH, CR.card)
    slide.addText(trunc(d.label, 42), { x: PAD, y: ry, w: labelW, h: rowH, fontSize: i === 0 ? 13 : 12.5, bold: i === 0, color: i === 0 ? CR.ink : CR.ink2, valign: 'middle', autoFit: true })
    const trackH = rowH * 0.5
    const trackY = ry + (rowH - trackH) / 2
    solidRect(slide, pptx, barX, trackY, barMaxW, trackH, CR.line)
    const bw = barMaxW * d.value / maxVal
    if (bw > 0.04) solidRect(slide, pptx, barX, trackY, bw, trackH, col)
    slide.addText(p + '%', { x: pctX, y: ry, w: 0.6, h: rowH, fontSize: i === 0 ? 13 : 12, bold: true, color: col, valign: 'middle' })
    slide.addText(d.value.toLocaleString(), { x: cntX, y: ry, w: 1.0, h: rowH, fontSize: 12, color: CR.ink2, valign: 'middle' })
  })

  if (spec.insight) insightBox(slide, pptx, PAD, FY - insightH - 0.05, W - PAD * 2, insightH, spec.insight)
  footer(slide, pptx, datasetName)
}

// 2×2 compact grid of mini bar charts (one card per categorical field).
function renderCompactGrid(pptx: any, spec: CompactGridSlide, datasetName: string) {
  const slide = pptx.addSlide('NUMBERED')
  hdr(slide, pptx, spec.title, spec.subtitle, datasetName)

  const cells = spec.cells.slice(0, 4)
  const cols = 2
  const rows = Math.max(1, Math.ceil(cells.length / cols))
  const gapX = 0.3, gapY = 0.24
  const top = CONTENT_Y + 0.05
  const avail = FY - top - 0.1
  const cellW = (W - PAD * 2 - gapX * (cols - 1)) / cols
  const cellH = (avail - gapY * (rows - 1)) / rows

  cells.forEach((cell, idx) => {
    const col = idx % cols
    const row = Math.floor(idx / cols)
    const cx = PAD + col * (cellW + gapX)
    const cy = top + row * (cellH + gapY)
    rect(slide, pptx, cx, cy, cellW, cellH, CR.card)
    slide.addText(trunc(cell.label, 48), { x: cx + 0.16, y: cy + 0.08, w: cellW - 0.32, h: 0.3, fontSize: 12.5, bold: true, color: CR.ink, valign: 'middle', autoFit: true })
    solidRect(slide, pptx, cx + 0.16, cy + 0.42, cellW * 0.28, 0.028, CR.teal)

    const bars = cell.bars.slice(0, 6)
    const bn = bars.length
    const barAreaY = cy + 0.52
    const barAreaH = cellH - 0.66
    const barRowH = Math.min(0.34, barAreaH / Math.max(bn, 1))
    const barGap = Math.min(0.05, (barAreaH - barRowH * bn) / Math.max(bn - 1, 1))
    const labelW = cellW * 0.40
    const barMaxW = cellW * 0.32
    const barX = cx + 0.16 + labelW + 0.06
    const pctX = barX + barMaxW + 0.06
    const maxVal = Math.max(...bars.map(b => b.value), 1)
    bars.forEach((b, i) => {
      const ry = barAreaY + i * (barRowH + barGap)
      const p = pct(b.value, cell.total)
      const col_ = b.color || BAR_COLORS[i % BAR_COLORS.length]
      slide.addText(trunc(b.label, 22), { x: cx + 0.16, y: ry, w: labelW, h: barRowH, fontSize: 11.5, color: i === 0 ? CR.ink : CR.ink2, bold: i === 0, valign: 'middle', wrap: false, autoFit: true })
      const trackH = barRowH * 0.5
      const trackY = ry + (barRowH - trackH) / 2
      solidRect(slide, pptx, barX, trackY, barMaxW, trackH, CR.line)
      const bw = barMaxW * b.value / maxVal
      if (bw > 0.03) solidRect(slide, pptx, barX, trackY, bw, trackH, col_)
      slide.addText(p + '%', { x: pctX, y: ry, w: cellW - (pctX - cx) - 0.16, h: barRowH, fontSize: 11.5, bold: true, color: col_, valign: 'middle' })
    })
    slide.addText('n=' + cell.total.toLocaleString(), { x: cx + cellW - 1.1, y: cy + cellH - 0.28, w: 0.96, h: 0.22, fontSize: 8, color: CR.ink2, align: 'right', valign: 'middle' })
  })
  footer(slide, pptx, datasetName)
}

// Survey response + completion funnel.
function renderSurveyFunnel(pptx: any, spec: SurveyFunnelSlide, datasetName: string) {
  const slide = pptx.addSlide('NUMBERED')
  hdr(slide, pptx, spec.title, spec.subtitle, datasetName)
  const top = CONTENT_Y + 0.05
  const kpis = spec.kpis.slice(0, 3)
  const kgap = 0.18
  const kw = (W - PAD * 2 - kgap * (kpis.length - 1)) / Math.max(kpis.length, 1)
  const kh = 0.95
  kpis.forEach((k, i) => {
    const x = PAD + i * (kw + kgap)
    rect(slide, pptx, x, top, kw, kh, CR.card)
    solidRect(slide, pptx, x, top, 0.06, kh, k.color || CR.teal)
    slide.addText(k.value, { x: x + 0.18, y: top + 0.1, w: kw - 0.34, h: kh * 0.5, fontSize: 26, bold: true, color: k.color || CR.teal, valign: 'middle', autoFit: true })
    slide.addText(k.label, { x: x + 0.18, y: top + kh * 0.56, w: kw - 0.34, h: 0.24, fontSize: 12, bold: true, color: CR.ink, autoFit: true })
    if (k.sub) slide.addText(k.sub, { x: x + 0.18, y: top + kh * 0.56 + 0.22, w: kw - 0.34, h: 0.2, fontSize: 9.5, color: CR.ink2, autoFit: true })
  })

  const insightH = spec.insight ? 0.7 : 0
  const funnelLblY = top + kh + 0.22
  slide.addText('COMPLETION FUNNEL', { x: PAD, y: funnelLblY, w: W - PAD * 2, h: 0.22, fontSize: 10, bold: true, color: CR.ink2, charSpacing: 2 })
  const stages = spec.stages.slice(0, 8)
  const n = stages.length
  if (n >= 1) {
    const start = stages[0].count || 1
    const labelW = 3.0
    const metaW = 2.3
    const barX = PAD + labelW + 0.12
    const barMaxW = W - PAD - metaW - barX
    const areaY = funnelLblY + 0.32
    const areaH = FY - areaY - insightH - 0.12
    const rowH = Math.min(0.5, (areaH - 0.1 * (n - 1)) / n)
    const rowGap = n > 1 ? Math.min(0.14, (areaH - rowH * n) / (n - 1)) : 0
    stages.forEach((st, i) => {
      const ry = areaY + i * (rowH + rowGap)
      const ret = pct(st.count, start)
      const prev = i > 0 ? stages[i - 1].count : st.count
      const drop = i > 0 && prev > 0 ? Math.round((1 - st.count / prev) * 100) : 0
      const bw = Math.max(0.04, barMaxW * st.count / start)
      const col = ret >= 70 ? CR.teal : ret >= 40 ? CR.amber : CR.red
      slide.addText(trunc(st.label, 40), { x: PAD, y: ry, w: labelW, h: rowH, fontSize: 12.5, bold: i === 0 || i === n - 1, color: CR.ink, valign: 'middle', wrap: false, autoFit: true })
      const trackH = rowH * 0.54
      const trackY = ry + (rowH - trackH) / 2
      solidRect(slide, pptx, barX, trackY, barMaxW, trackH, CR.line)
      solidRect(slide, pptx, barX, trackY, bw, trackH, col)
      slide.addText(st.count.toLocaleString() + ' (' + ret + '%)', { x: barX + barMaxW + 0.12, y: ry, w: metaW - 1.0, h: rowH, fontSize: 12, bold: true, color: CR.ink, valign: 'middle', wrap: false })
      if (drop > 0) slide.addText('↓' + drop + '%', { x: W - PAD - 0.85, y: ry, w: 0.85, h: rowH, fontSize: 11, bold: true, color: drop >= 20 ? CR.red : CR.amber, align: 'right', valign: 'middle' })
    })
  }
  if (spec.insight) insightBox(slide, pptx, PAD, FY - insightH - 0.02, W - PAD * 2, insightH, spec.insight)
  footer(slide, pptx, datasetName)
}

// Key-driver (OLS coefficient) diverging-bar chart.
function renderThemeImpact(pptx: any, spec: ThemeImpactSlide, datasetName: string) {
  const slide = pptx.addSlide('NUMBERED')
  hdr(slide, pptx, spec.title, spec.subtitle, datasetName)

  const impacts = spec.impacts.slice(0, 10)
  const nBars = impacts.length
  const labelW = 2.8
  const coefW = 0.8
  const top = CONTENT_Y + 0.4
  const interpH = spec.interpretation ? 0.85 : 0
  const legendH = 0.3
  const barAreaW = W - PAD * 2 - labelW - coefW - 0.3
  const barMaxW = barAreaW / 2
  const midX = PAD + labelW + 0.15 + barMaxW
  const maxAbs = Math.max(...impacts.map(i => Math.abs(i.coefficient)), 0.1)

  const availH = FY - top - interpH - legendH - 0.3
  const barH = Math.min(0.4, availH / Math.max(nBars, 1) - 0.05)
  const barGap = 0.05
  // Scale bars to leave room for the coefficient label OUTSIDE the longest bar,
  // so a long negative bar's label never collides with the theme-name column.
  const barScaleW = barMaxW - coefW - 0.14

  slide.addText('Theme', { x: PAD, y: top - 0.3, w: labelW, h: 0.22, fontSize: 11, bold: true, color: CR.ink2, align: 'right', valign: 'middle' })
  slide.addText('← lowers score      raises score →', { x: midX - barMaxW, y: top - 0.3, w: barMaxW * 2, h: 0.22, fontSize: 8.5, color: CR.ink2, align: 'center', valign: 'middle' })
  solidRect(slide, pptx, midX, top - 0.02, 0.014, nBars * (barH + barGap), CR.ink2)

  impacts.forEach((imp, i) => {
    const y = top + i * (barH + barGap)
    const isPos = imp.coefficient >= 0
    const bw = Math.abs(imp.coefficient) / maxAbs * barScaleW
    const col = imp.significant ? (isPos ? CR.green : CR.red) : (isPos ? '9FD9C4' : 'F0B4B4')
    slide.addText(trunc(imp.themeName, 32), { x: PAD, y, w: labelW, h: barH, fontSize: 12, color: CR.ink, bold: imp.significant, valign: 'middle', align: 'right' })
    if (isPos) solidRect(slide, pptx, midX + 0.02, y + barH * 0.16, bw, barH * 0.68, col)
    else solidRect(slide, pptx, midX - 0.02 - bw, y + barH * 0.16, bw, barH * 0.68, col)
    const txt = (isPos ? '+' : '') + imp.coefficient.toFixed(2) + (imp.significant ? ' *' : '')
    slide.addText(txt, { x: isPos ? midX + bw + 0.06 : midX - bw - coefW - 0.04, y, w: coefW, h: barH, fontSize: 11.5, color: imp.significant ? (isPos ? CR.green : CR.red) : CR.ink2, bold: imp.significant, valign: 'middle', align: isPos ? 'left' : 'right' })
  })

  let yAfter = top + nBars * (barH + barGap) + 0.1
  if (spec.interpretation) {
    insightBox(slide, pptx, PAD, yAfter, W - PAD * 2, interpH, spec.interpretation)
    yAfter += interpH + 0.08
  }
  slide.addText([
    { text: '■ ', options: { color: CR.green, fontSize: 9 } },
    { text: 'Raises score    ', options: { color: CR.ink2, fontSize: 9 } },
    { text: '■ ', options: { color: CR.red, fontSize: 9 } },
    { text: 'Lowers score    ', options: { color: CR.ink2, fontSize: 9 } },
    { text: '* = statistically significant    ', options: { color: CR.ink2, fontSize: 9 } },
    { text: 'Faded = not significant', options: { color: CR.ink2, fontSize: 9 } },
  ], { x: PAD, y: yAfter, w: W - PAD * 2, h: 0.24, valign: 'middle' })

  footer(slide, pptx, datasetName)
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

  renderTitleSlide(pptx, deck.title, deck.subtitle || '', datasetName, deck.preparedFor, deck.preparedBy)

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
      case 'section':      renderSection(pptx, spec, datasetName); break
      case 'theme_cards':  renderThemeCards(pptx, spec, datasetName); break
      case 'comments_grid': renderCommentsGrid(pptx, spec, datasetName); break
      case 'numeric_stats': renderNumericStats(pptx, spec, datasetName); break
      case 'dist_bars':    renderDistBars(pptx, spec, datasetName); break
      case 'compact_grid': renderCompactGrid(pptx, spec, datasetName); break
      case 'survey_funnel': renderSurveyFunnel(pptx, spec, datasetName); break
      case 'theme_impact': renderThemeImpact(pptx, spec, datasetName); break
      default:
        // Unknown type — render as bullets with the raw data
        renderBullets(pptx, { type: 'bullets', title: (spec as any).title || 'Slide', bullets: [JSON.stringify(spec)] }, datasetName)
    }
  }

  const buffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer
  return Buffer.from(buffer)
}
