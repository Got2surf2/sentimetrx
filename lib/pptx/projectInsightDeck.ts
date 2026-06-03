// lib/pptx/projectInsightDeck.ts
// Builder for the "Project Insight" PE teaser deck — a 10-slide first-
// conversation pitch for an AI-native consolidation of the organizational-
// feedback software market.
//
// Framing (Option B): survey/feedback software is the *acquisition vehicle*;
// the AI insight layer is the product. Numbers are qualitative by design — no
// fabricated TAM, vendor counts, deal multiples, or EBITDA-uplift figures.
// Acquisition-screen thresholds (recurring SaaS, retention/margin floors) are
// kept as buy-box criteria, not market claims; specific figures get cited
// before any external use (see the footnotes).
//
// Style mirrors lib/pptx/reviewIntelligenceDeck + /api/rollup-deck — Arial,
// navy header w/ accent line, branded title + close slides, datanautix.com
// footer with page number.

import type PptxGenJS from 'pptxgenjs'

// ── Brand palette ──────────────────────────────────────────────────────────
const DN = {
  teal:         '0F7173',
  tealDark:     '0A4F51',
  tealPale:     'E0F7FA',
  navy:         '0D2B45',
  navyMid:      '0F3A54',
  gold:         'E8B84B',
  orange:       'E85A1A',
  ink:          '0D2B45',
  slate:        '8FA3AE',
  slateLight:   'E8EDEF',
  slateCard:    'F4F7F8',
  white:        'FFFFFF',
  sarinaBlue:   '00B4D8',
  hermesOrange: 'E8632A',
  green:        '059669',
  greenLight:   'D1FAE5',
  red:          'DC2626',
  redLight:     'FEE2E2',
  amber:        'D97706',
  amberLight:   'FEF3C7',
}

const W = 13.33
const H = 7.5

const FOOTER = 'datanautix.com  ·  Project Insight  ·  Confidential — for discussion only'

// ── Shared layout primitives ───────────────────────────────────────────────
function addHeader(slide: any, title: string, subtitle?: string) {
  slide.addShape('rect', { x: 0, y: 0, w: W, h: 1.0, fill: { color: DN.navy } })
  slide.addText(title, {
    x: 0.6, y: subtitle ? 0.1 : 0.15, w: 9.5, h: subtitle ? 0.5 : 0.7,
    fontSize: 26, fontFace: 'Arial', color: DN.white, bold: true, valign: 'middle',
  })
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.6, y: 0.55, w: 9.5, h: 0.35,
      fontSize: 12, fontFace: 'Arial', color: DN.sarinaBlue, italic: true, valign: 'middle',
    })
  }
  slide.addText([
    { text: 'data', options: { color: DN.hermesOrange, bold: true, italic: true } },
    { text: 'nautix', options: { color: DN.sarinaBlue, bold: true, italic: true } },
  ], { x: W - 2.4, y: 0.2, w: 2.0, h: 0.5, fontSize: 16, fontFace: 'Arial', valign: 'middle', align: 'right' })
  slide.addShape('rect', { x: 0, y: 1.0, w: W, h: 0.04, fill: { color: DN.sarinaBlue } })
}

function addFooter(slide: any, pageNum: number) {
  slide.addText(FOOTER, {
    x: 0.5, y: H - 0.4, w: 11, h: 0.3, fontSize: 9, fontFace: 'Arial', color: DN.slate,
  })
  slide.addText(`${pageNum}`, {
    x: W - 1, y: H - 0.4, w: 0.5, h: 0.3, fontSize: 9, fontFace: 'Arial', color: DN.slate, align: 'right',
  })
}

function bullet(text: string, opts: any = {}) {
  return {
    text,
    options: {
      fontSize: 14, fontFace: 'Arial', color: DN.ink, lineSpacing: 24,
      bullet: { code: '2022' },
      ...opts,
    },
  }
}

function caveat(slide: any, text: string) {
  slide.addText(text, {
    x: 0.6, y: 6.55, w: 12.1, h: 0.4, fontSize: 9, fontFace: 'Arial', color: DN.slate, italic: true,
  })
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function getDeckDates() {
  const buildDate = process.env.NEXT_PUBLIC_BUILD_DATE
  const lastUpdated = buildDate ? fmtDate(new Date(buildDate)) : fmtDate(new Date())
  const downloaded = fmtDate(new Date())
  return { lastUpdated, downloaded }
}

// Two-column "card grid" — title chip + body, with a colored spine.
function cardGrid(slide: any, items: { t: string; b: string; c: string }[], yTop: number, rowH = 1.55) {
  items.forEach((it, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = 0.6 + col * 6.15
    const y = yTop + row * (rowH + 0.2)
    slide.addShape('rect', { x, y, w: 5.95, h: rowH, fill: { color: DN.slateCard }, line: { color: DN.slateLight, width: 1 }, rectRadius: 0.06 })
    slide.addShape('rect', { x, y, w: 0.1, h: rowH, fill: { color: it.c } })
    slide.addText(it.t, { x: x + 0.3, y: y + 0.12, w: 5.5, h: 0.35, fontSize: 13, fontFace: 'Arial', color: DN.navy, bold: true })
    slide.addText(it.b, { x: x + 0.3, y: y + 0.5, w: 5.5, h: rowH - 0.6, fontSize: 11.5, fontFace: 'Arial', color: DN.ink, lineSpacing: 16, valign: 'top' })
  })
}

// ── Slides ───────────────────────────────────────────────────────────────

// 1 — Cover
function slideCover(pptx: any) {
  const s = pptx.addSlide()
  const { lastUpdated, downloaded } = getDeckDates()
  s.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.navy } })
  s.addShape('ellipse', { x: W - 4.2, y: -1.5, w: 5.5, h: 5.5, fill: { color: DN.teal, transparency: 88 }, line: { width: 0 } })
  s.addShape('ellipse', { x: W - 3.0, y: 0.5, w: 3.5, h: 3.5, fill: { color: DN.sarinaBlue, transparency: 92 }, line: { width: 0 } })
  s.addShape('rect', { x: 0, y: 0, w: W, h: 0.07, fill: { color: DN.gold } })

  s.addText('PROJECT INSIGHT', { x: 0.8, y: 1.4, w: 11, h: 0.5, fontSize: 16, fontFace: 'Arial', color: DN.gold, bold: true, charSpacing: 4 })
  s.addText('Building the leading independent\nfeedback & insights software platform', {
    x: 0.8, y: 2.1, w: 11.5, h: 1.7, fontSize: 38, fontFace: 'Arial', color: DN.white, bold: true, lineSpacing: 44,
  })
  s.addShape('rect', { x: 0.8, y: 3.95, w: 4.5, h: 0.04, fill: { color: DN.gold } })
  s.addText('An AI-native consolidation of the organizational-feedback software market', {
    x: 0.8, y: 4.15, w: 11.5, h: 0.6, fontSize: 18, fontFace: 'Arial', color: DN.sarinaBlue, italic: true,
  })

  s.addText(`Last updated  ${lastUpdated}     ·     Downloaded  ${downloaded}`, {
    x: 0.8, y: 5.5, w: 11, h: 0.35, fontSize: 11, fontFace: 'Arial', color: DN.slate, italic: true,
  })

  s.addShape('rect', { x: 0, y: H - 0.5, w: W, h: 0.5, fill: { color: DN.navyMid } })
  s.addText([
    { text: 'data', options: { color: DN.hermesOrange, bold: true, italic: true } },
    { text: 'nautix', options: { color: DN.sarinaBlue, bold: true, italic: true } },
    { text: '   ·   datanautix.com   ·   Confidential — for discussion only', options: { color: DN.slate } },
  ], { x: 0.6, y: H - 0.45, w: 12, h: 0.4, fontSize: 13, fontFace: 'Arial', valign: 'middle' })

  s.addNotes(
`Teaser deck — first conversation, not the CIM. The job here is to make the thesis compelling enough to justify diligence, not to walk a target list.

One-line thesis: the organizational-feedback software market is large, old, and fragmented; AI collapses the cost of interpreting feedback; we consolidate subscale, founder-owned vendors onto a single AI-native insight layer and re-rate the whole as a platform.

Keep it to ~15 minutes. The deck is deliberately number-light — every dollar figure is cited before it goes external.`)
}

// 2 — Executive summary
function slideExecSummary(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Executive summary')
  addFooter(s, pg)

  cardGrid(s, [
    { t: 'The opportunity', c: DN.hermesOrange, b: 'Consolidate fragmented survey, feedback and insights software vendors serving SMB and mid-market customers.' },
    { t: 'The thesis', c: DN.sarinaBlue, b: 'A highly fragmented, founder-owned market with strong recurring revenue — where AI creates real product and operating leverage.' },
    { t: 'The platform', c: DN.teal, b: 'Acquire a focused cluster of companies over a 3–5 year hold to create a category-leading, AI-native insights platform.' },
    { t: 'The edge', c: DN.gold, b: 'Buy survey software as the distribution vehicle; build the AI insight layer the incumbents are bolting onto 15-year-old code.' },
  ], 1.35)

  s.addText('Why it works: fragmented supply + recurring revenue + an AI step-change in the cost of analysis = a consolidation window that favors a platform designed around AI from day one.', {
    x: 0.6, y: 5.7, w: 12.1, h: 0.7, fontSize: 13, fontFace: 'Arial', color: DN.navy, italic: true, align: 'center', valign: 'middle',
  })

  s.addNotes(
`The whole deck in one slide. Four boxes: opportunity, thesis, platform, edge.

The "edge" box is the Option-B reframe — survey software is the acquisition vehicle, not the end market. The product we are building is the AI system of interpretation. That is what re-rates the asset.

Deal count and hold period (a focused cluster over 3–5 years) are operating plan, not market claims, so they stay. Target ARR / multiples are intentionally absent here — they live in diligence with citations.`)
  return pg
}

// 3 — Market problem
function slideProblem(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'The market problem', 'A market that evolved as hundreds of point solutions')
  addFooter(s, pg)

  s.addText('Feedback software fragmented into single-purpose tools…', {
    x: 0.6, y: 1.3, w: 12, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.hermesOrange, bold: true,
  })
  s.addText([
    bullet('Survey creation · customer feedback · employee engagement'),
    bullet('Product research · market research · forms and data collection'),
  ], { x: 0.7, y: 1.8, w: 12, h: 1.0 })

  s.addText('…and most providers stayed subscale.', {
    x: 0.6, y: 3.0, w: 12, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.navy, bold: true,
  })
  cardGrid(s, [
    { t: 'Founder-led', c: DN.slate, b: 'Owner-operated, limited access to growth capital, reaching succession.' },
    { t: 'Thin go-to-market', c: DN.slate, b: 'Limited sales capability; growth capped by founder bandwidth.' },
    { t: 'Under-invested in AI', c: DN.slate, b: 'No capacity to build the analysis layer customers now expect.' },
    { t: 'Out-gunned at the top', c: DN.slate, b: 'Cannot compete with enterprise leaders for large accounts.' },
  ], 3.45, 1.25)

  s.addText('Result: a large pool of good-but-stuck businesses — a significant consolidation opportunity.', {
    x: 0.6, y: 6.5, w: 12.1, h: 0.4, fontSize: 12, fontFace: 'Arial', color: DN.teal, bold: true, align: 'center',
  })

  s.addNotes(
`Set up the fragmentation. The market grew as point solutions — each box on this slide was once a company. Most never reached escape velocity.

Don't pile on. The four cards are the shared profile of the acquisition universe: founder-led, thin GTM, under-invested in AI, out-gunned upmarket. That is exactly the profile that consolidates well — healthy recurring revenue, fixable growth constraints.`)
  return pg
}

// 4 — Why now
function slideWhyNow(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Why now', 'Three forces are reshaping the industry at the same time')
  addFooter(s, pg)

  const cols = [
    { t: 'AI transformation', c: DN.sarinaBlue, lines: ['Customers now expect automated analysis, theme extraction, sentiment detection and recommendations — not just a chart of responses.', 'The bar moved from "collect" to "interpret and act."'] },
    { t: 'Founder liquidity', c: DN.hermesOrange, lines: ['Many platforms were founded roughly 2005–2015 and are reaching succession.', 'Owners want liquidity and a home for their teams — supply meets a natural buyer.'] },
    { t: 'Enterprise drift', c: DN.teal, lines: ['Large vendors concentrate on enterprise accounts, leaving SMB and mid-market under-served.', 'A consolidator can own the segment the leaders are walking away from.'] },
  ]
  cols.forEach((col, i) => {
    const x = 0.6 + i * 4.15
    s.addShape('rect', { x, y: 1.4, w: 3.95, h: 4.7, fill: { color: DN.slateCard }, line: { color: DN.slateLight, width: 1 }, rectRadius: 0.06 })
    s.addShape('rect', { x, y: 1.4, w: 3.95, h: 0.12, fill: { color: col.c } })
    s.addText(col.t, { x: x + 0.25, y: 1.7, w: 3.5, h: 0.5, fontSize: 16, fontFace: 'Arial', color: DN.navy, bold: true })
    s.addText(col.lines.map(l => bullet(l, { fontSize: 12, lineSpacing: 17 })), { x: x + 0.25, y: 2.35, w: 3.55, h: 3.5, valign: 'top' })
  })

  s.addText('The window: AI makes the product better at the same moment owners are ready to sell and incumbents are looking away.', {
    x: 0.6, y: 6.35, w: 12.1, h: 0.4, fontSize: 12, fontFace: 'Arial', color: DN.navy, italic: true, align: 'center',
  })

  s.addNotes(
`Three forces, one window. The point is the alignment: any one of these on its own is interesting; together they create a finite consolidation window.

AI transformation = product tailwind. Founder liquidity = supply of targets. Enterprise drift = a defensible segment the leaders are vacating. Land the "at the same time."`)
  return pg
}

// 5 — The thesis (Option B core)
function slideThesis(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'The thesis: AI as the system of interpretation', 'Survey software is the vehicle. The insight layer is the product.')
  addFooter(s, pg)

  s.addText('Today', { x: 0.6, y: 1.35, w: 2, h: 0.35, fontSize: 13, fontFace: 'Arial', color: DN.slate, bold: true })
  s.addShape('rect', { x: 0.6, y: 1.75, w: 12.1, h: 0.85, fill: { color: DN.slateCard }, line: { color: DN.slateLight, width: 1 }, rectRadius: 0.06 })
  s.addText('Survey  →  Report', { x: 0.6, y: 1.75, w: 12.1, h: 0.85, fontSize: 20, fontFace: 'Arial', color: DN.slate, bold: true, align: 'center', valign: 'middle' })

  s.addText('Where this goes', { x: 0.6, y: 2.85, w: 4, h: 0.35, fontSize: 13, fontFace: 'Arial', color: DN.teal, bold: true })
  s.addShape('rect', { x: 0.6, y: 3.25, w: 12.1, h: 0.95, fill: { color: DN.navy }, rectRadius: 0.06 })
  s.addText([
    { text: 'Survey  →  ', options: { color: DN.white } },
    { text: 'Analyze  →  Recommend  →  Act', options: { color: DN.sarinaBlue, bold: true } },
  ], { x: 0.6, y: 3.25, w: 12.1, h: 0.95, fontSize: 22, fontFace: 'Arial', bold: true, align: 'center', valign: 'middle' })

  s.addText([
    bullet('A shared AI engine becomes the system of interpretation across every acquired product — one analysis layer, many front doors.'),
    bullet('Incumbents are bolting AI onto 15-year-old codebases; a platform designed around AI from day one does not carry that debt.'),
    bullet('Each acquisition plugs its customers and data into the same engine — value compounds with every deal, not just adds.'),
  ], { x: 0.6, y: 4.5, w: 12.1, h: 1.9 })

  s.addNotes(
`This is the slide the PE narrative lives or dies on. Option B in one picture.

The "Today" band is the commodity: survey to report. Everyone does it; it does not command a platform multiple. The "Where this goes" band is the product we are actually building — analyze, recommend, act. AI is the system of interpretation that sits under every acquired brand.

The compounding point matters: in a normal roll-up, value adds. Here, because every target feeds the same engine and data layer, value compounds. That is the multiple-expansion argument, made qualitatively.`)
  return pg
}

// 6 — Acquisition strategy / buy box
function slideBuyBox(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Acquisition strategy', 'A disciplined, repeatable buy box')
  addFooter(s, pg)

  cardGrid(s, [
    { t: 'Business model', c: DN.teal, b: 'Recurring SaaS revenue with healthy net retention — the cash-flow base that funds the platform.' },
    { t: 'Ownership', c: DN.hermesOrange, b: 'Founder-owned and operated, at or approaching a succession or liquidity moment.' },
    { t: 'Quality screen', c: DN.sarinaBlue, b: 'Strong gross retention and software-grade gross margins — durable, not discount-driven, revenue.' },
    { t: 'Segment', c: DN.gold, b: 'Survey · customer experience · product feedback · employee feedback · research panels.' },
  ], 1.35)

  s.addText('Geography:  North America · Europe · Australia', {
    x: 0.6, y: 5.55, w: 12.1, h: 0.4, fontSize: 13, fontFace: 'Arial', color: DN.navy, bold: true, align: 'center',
  })
  s.addText('Each target must be accretive on its own AND a clean fit for the shared AI engine — distribution we can plug in, not a rebuild.', {
    x: 0.6, y: 5.95, w: 12.1, h: 0.5, fontSize: 12, fontFace: 'Arial', color: DN.teal, italic: true, align: 'center',
  })
  caveat(s, 'Specific revenue / retention / margin thresholds are set in the investment criteria and confirmed in diligence; ranges intentionally omitted from this teaser.')

  s.addNotes(
`The buy box. The message is discipline and repeatability — this is not opportunistic.

Recurring SaaS + founder-owned + retention/margin quality + the right segments + the right geos. The closing line is the Option-B filter: every target has to be both a good standalone business and a clean fit for the shared engine. If integrating it means a rebuild, it fails the screen.

Specific thresholds (the "$3–15M ARR / 80%+ / 70%+" numbers from the draft) live in the criteria memo, not the teaser — they get confirmed in diligence.`)
  return pg
}

// 7 — Illustrative pipeline
function slidePipeline(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Illustrative acquisition pipeline', 'Representative of the universe — not a target list')
  addFooter(s, pg)

  const waves = [
    { t: 'Wave 1 — anchor candidates', c: DN.teal, names: ['SmartSurvey', 'Sogolytics', 'Survio', 'LimeSurvey', 'Zonka Feedback'] },
    { t: 'Wave 2 — bolt-on candidates', c: DN.sarinaBlue, names: ['Feedier', 'OpinionX', 'Centiment', 'Responsly', 'PointerPro'] },
  ]
  waves.forEach((wave, wi) => {
    const x = 0.6 + wi * 6.15
    s.addShape('rect', { x, y: 1.35, w: 5.95, h: 4.6, fill: { color: DN.slateCard }, line: { color: DN.slateLight, width: 1 }, rectRadius: 0.06 })
    s.addShape('rect', { x, y: 1.35, w: 5.95, h: 0.12, fill: { color: wave.c } })
    s.addText(wave.t, { x: x + 0.3, y: 1.6, w: 5.4, h: 0.45, fontSize: 15, fontFace: 'Arial', color: DN.navy, bold: true })
    wave.names.forEach((n, ni) => {
      const y = 2.25 + ni * 0.72
      s.addShape('rect', { x: x + 0.3, y, w: 5.35, h: 0.58, fill: { color: DN.white }, line: { color: DN.slateLight, width: 1 }, rectRadius: 0.05 })
      s.addText(n, { x: x + 0.5, y, w: 5.0, h: 0.58, fontSize: 14, fontFace: 'Arial', color: DN.ink, bold: true, valign: 'middle' })
    })
  })

  caveat(s, 'Illustrative only — named companies show the shape and scale of the addressable universe. No outreach, valuation, or transaction is implied; actual targets are subject to diligence.')

  s.addNotes(
`The original draft's weakest slide — because a hypothetical list reads as hand-wavy on an IC. Fix the framing, not the content: this is "what the universe looks like," not "who we are buying."

Two waves only — anchor candidates that could seed the platform, then bolt-ons. Lead with the disclaimer if asked. The real pipeline (sourced, scored, contacted) is diligence-stage work and lives elsewhere.

If the partner pushes on it, that is the cue to talk sourcing process, not to defend specific names.`)
  return pg
}

// 8 — Value creation plan
function slideValueCreation(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Value creation plan', 'Centralize what scales; keep what customers love')
  addFooter(s, pg)

  const cols = [
    { t: 'Product', c: DN.sarinaBlue, lines: ['Shared AI engine', 'Shared analytics layer', 'Shared reporting infrastructure'] },
    { t: 'Operations', c: DN.teal, lines: ['Finance', 'HR', 'Legal', 'Customer success'] },
    { t: 'Growth', c: DN.hermesOrange, lines: ['Cross-sell across the base', 'Unified marketplace', 'Shared demand generation'] },
  ]
  cols.forEach((col, i) => {
    const x = 0.6 + i * 4.15
    s.addShape('rect', { x, y: 1.4, w: 3.95, h: 4.0, fill: { color: DN.slateCard }, line: { color: DN.slateLight, width: 1 }, rectRadius: 0.06 })
    s.addShape('rect', { x, y: 1.4, w: 3.95, h: 0.12, fill: { color: col.c } })
    s.addText(col.t, { x: x + 0.25, y: 1.7, w: 3.5, h: 0.5, fontSize: 18, fontFace: 'Arial', color: DN.navy, bold: true })
    s.addText(col.lines.map(l => bullet(l, { fontSize: 13, lineSpacing: 22 })), { x: x + 0.25, y: 2.4, w: 3.55, h: 2.8, valign: 'top' })
  })

  s.addText('Margin expands as duplicated cost is consolidated and shared infrastructure replaces per-company builds — meaningful uplift per acquisition.', {
    x: 0.6, y: 5.7, w: 12.1, h: 0.7, fontSize: 13, fontFace: 'Arial', color: DN.navy, italic: true, align: 'center', valign: 'middle',
  })
  caveat(s, 'Per-acquisition margin uplift is modeled in the investment case with deal-specific assumptions; a single headline figure is intentionally not asserted here.')

  s.addNotes(
`The operating playbook. Three columns: product, ops, growth.

Product is the strategic one — shared AI engine, analytics, reporting. That is where the platform thesis becomes real infrastructure. Ops is the classic roll-up cost synergy. Growth is cross-sell across a combined base plus shared demand gen.

I deliberately did not put a "300–800 bps" number on the slide — that was an unsourced figure in the draft. The honest version is "meaningful uplift per acquisition, modeled per deal." If an LP wants the number, that's the investment case, with assumptions shown.`)
  return pg
}

// 9 — Value creation logic / economics (qualitative)
function slideEconomics(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'How value compounds', 'The re-rating logic, without the spreadsheet')
  addFooter(s, pg)

  const steps = [
    { t: 'Acquire', c: DN.teal, b: 'Buy subscale, founder-owned SaaS at private-company entry valuations.' },
    { t: 'Integrate', c: DN.sarinaBlue, b: 'Move each onto the shared AI engine and consolidate duplicated operating cost.' },
    { t: 'Grow', c: DN.hermesOrange, b: 'Cross-sell the combined base; the AI layer lifts product value and retention.' },
    { t: 'Re-rate', c: DN.gold, b: 'A combined, AI-native platform earns a platform multiple — not a collection of small-company multiples.' },
  ]
  steps.forEach((st, i) => {
    const x = 0.6 + i * 3.1
    s.addShape('rect', { x, y: 1.6, w: 2.85, h: 3.4, fill: { color: DN.slateCard }, line: { color: DN.slateLight, width: 1 }, rectRadius: 0.06 })
    s.addShape('rect', { x, y: 1.6, w: 2.85, h: 0.12, fill: { color: st.c } })
    s.addText(`${i + 1}`, { x: x + 0.2, y: 1.85, w: 0.8, h: 0.6, fontSize: 28, fontFace: 'Arial', color: st.c, bold: true })
    s.addText(st.t, { x: x + 0.95, y: 1.95, w: 1.8, h: 0.5, fontSize: 16, fontFace: 'Arial', color: DN.navy, bold: true, valign: 'middle' })
    s.addText(st.b, { x: x + 0.2, y: 2.7, w: 2.5, h: 2.1, fontSize: 12, fontFace: 'Arial', color: DN.ink, lineSpacing: 17, valign: 'top' })
    if (i < steps.length - 1) {
      s.addText('→', { x: x + 2.78, y: 1.6, w: 0.45, h: 3.4, fontSize: 22, fontFace: 'Arial', color: DN.slate, bold: true, align: 'center', valign: 'middle' })
    }
  })

  s.addText('Equity value is created two ways at once: operational improvement inside each business, and multiple expansion as the whole becomes a category platform.', {
    x: 0.6, y: 5.4, w: 12.1, h: 0.7, fontSize: 13, fontFace: 'Arial', color: DN.navy, italic: true, align: 'center', valign: 'middle',
  })
  caveat(s, 'Entry / platform multiples and the illustrative portfolio model are presented in diligence with sourced comparables; specific figures intentionally omitted from this teaser.')

  s.addNotes(
`This replaces the draft's "10 companies × $5M = $50M, buy at 3–5×, exit at 8–12×" slide. Those numbers were illustrative and unsourced — exactly the kind of made-up math a PE partner discounts on sight.

Same argument, qualitative: acquire low, integrate onto shared AI infrastructure, grow the combined base, and re-rate from small-company multiples to a platform multiple. Two value levers at once — operational improvement and multiple expansion.

When they ask for the model — and they will — that is the diligence conversation, built on sourced comps. Promise it; don't fake it here.`)
  return pg
}

// 10 — Exit opportunities
function slideExits(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Exit opportunities', 'Multiple credible paths to liquidity')
  addFooter(s, pg)

  s.addText('Strategic buyers', { x: 0.6, y: 1.3, w: 6, h: 0.4, fontSize: 15, fontFace: 'Arial', color: DN.teal, bold: true })
  const strategics = ['Qualtrics', 'SurveyMonkey (Momentive)', 'Medallia', 'Forsta', 'UserTesting']
  strategics.forEach((n, i) => {
    const y = 1.78 + i * 0.62
    s.addShape('rect', { x: 0.6, y, w: 5.9, h: 0.5, fill: { color: DN.slateCard }, line: { color: DN.slateLight, width: 1 }, rectRadius: 0.05 })
    s.addShape('rect', { x: 0.6, y, w: 0.1, h: 0.5, fill: { color: DN.teal } })
    s.addText(n, { x: 0.9, y, w: 5.4, h: 0.5, fontSize: 14, fontFace: 'Arial', color: DN.ink, bold: true, valign: 'middle' })
  })

  s.addText('Financial buyers', { x: 6.8, y: 1.3, w: 6, h: 0.4, fontSize: 15, fontFace: 'Arial', color: DN.hermesOrange, bold: true })
  const financials = ['Growth equity', 'SaaS-focused private equity', 'Software consolidators / continuation vehicles']
  financials.forEach((n, i) => {
    const y = 1.78 + i * 0.62
    s.addShape('rect', { x: 6.8, y, w: 5.9, h: 0.5, fill: { color: DN.slateCard }, line: { color: DN.slateLight, width: 1 }, rectRadius: 0.05 })
    s.addShape('rect', { x: 6.8, y, w: 0.1, h: 0.5, fill: { color: DN.hermesOrange } })
    s.addText(n, { x: 7.1, y, w: 5.4, h: 0.5, fontSize: 14, fontFace: 'Arial', color: DN.ink, bold: true, valign: 'middle' })
  })

  s.addShape('rect', { x: 0.6, y: 5.15, w: 12.1, h: 1.05, fill: { color: DN.navy }, rectRadius: 0.08 })
  s.addText('Objective: build the largest independent mid-market feedback & insights platform — an asset both strategics and financial sponsors compete to own.', {
    x: 0.9, y: 5.15, w: 11.5, h: 1.05, fontSize: 16, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle',
  })
  caveat(s, 'Named buyers are illustrative of the strategic landscape; no discussions are implied.')

  s.addNotes(
`Close on optionality. The point is that we are not betting on one exit — strategics and sponsors both want this asset.

Strategic logic: the named acquirers all need AI-native mid-market reach; we would be the cleanest way to buy it. Financial logic: a de-risked, integrated platform is exactly what growth equity and SaaS PE pay up for.

End on the objective line. That is the sentence you want them repeating to their IC.`)
  return pg
}

// ── Assembly ────────────────────────────────────────────────────────────────
export function buildProjectInsightDeck(pptx: PptxGenJS) {
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Datanautix'
  pptx.company = 'Datanautix'
  pptx.title = 'Project Insight — Feedback & Insights Software Consolidation'
  pptx.subject = 'AI-native consolidation thesis — teaser'

  slideCover(pptx)
  let pg = 1
  pg = slideExecSummary(pptx, ++pg)
  pg = slideProblem(pptx, ++pg)
  pg = slideWhyNow(pptx, ++pg)
  pg = slideThesis(pptx, ++pg)
  pg = slideBuyBox(pptx, ++pg)
  pg = slidePipeline(pptx, ++pg)
  pg = slideValueCreation(pptx, ++pg)
  pg = slideEconomics(pptx, ++pg)
  pg = slideExits(pptx, ++pg)

  return pptx
}
