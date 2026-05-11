// GET /api/rollup-deck — generates the Datanautix AI-Native Roll-up investor deck.
// Query: ?length=short (10 slides, default) or ?length=long (24 slides).
//
// Style matches /api/pitch-deck — Arial, navy header w/ accent line, branded
// title and ask slides, footer with datanautix.com + page number.

import { NextResponse, type NextRequest } from 'next/server'
import PptxGenJS from 'pptxgenjs'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { logDeckDownload } from '@/lib/auth/logDeckDownload'

export const dynamic = 'force-dynamic'

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
  // wordmark right
  slide.addText([
    { text: 'data', options: { color: DN.hermesOrange, bold: true, italic: true } },
    { text: 'nautix', options: { color: DN.sarinaBlue, bold: true, italic: true } },
  ], { x: W - 2.4, y: 0.2, w: 2.0, h: 0.5, fontSize: 16, fontFace: 'Arial', valign: 'middle', align: 'right' })
  // accent line
  slide.addShape('rect', { x: 0, y: 1.0, w: W, h: 0.04, fill: { color: DN.sarinaBlue } })
}

function addFooter(slide: any, pageNum: number) {
  slide.addText('datanautix.com  ·  AI-Native Roll-up of Customer Intelligence  ·  Confidential', {
    x: 0.5, y: H - 0.4, w: 10, h: 0.3, fontSize: 9, fontFace: 'Arial', color: DN.slate,
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

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function getDeckDates() {
  const buildDate = process.env.NEXT_PUBLIC_BUILD_DATE
  const lastUpdated = buildDate ? fmtDate(new Date(buildDate)) : fmtDate(new Date())
  const downloaded = fmtDate(new Date())
  return { lastUpdated, downloaded }
}

function addTitleSlide(pptx: any, title: string, subtitle: string, tagline: string) {
  const s = pptx.addSlide()
  const { lastUpdated, downloaded } = getDeckDates()
  s.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.navy } })
  // decorative ellipses
  s.addShape('ellipse', { x: W - 4.2, y: -1.5, w: 5.5, h: 5.5, fill: { color: DN.teal, transparency: 88 }, line: { width: 0 } })
  s.addShape('ellipse', { x: W - 3.0, y: 0.5, w: 3.5, h: 3.5, fill: { color: DN.sarinaBlue, transparency: 92 }, line: { width: 0 } })
  s.addShape('rect', { x: 0, y: 0, w: W, h: 0.07, fill: { color: DN.gold } })

  s.addText('DATANAUTIX', { x: 0.8, y: 1.4, w: 11, h: 0.5, fontSize: 16, fontFace: 'Arial', color: DN.gold, bold: true, charSpacing: 4 })
  s.addText(title, { x: 0.8, y: 2.1, w: 11, h: 1.6, fontSize: 44, fontFace: 'Arial', color: DN.white, bold: true })
  s.addShape('rect', { x: 0.8, y: 3.7, w: 4.5, h: 0.04, fill: { color: DN.gold } })
  s.addText(subtitle, { x: 0.8, y: 3.9, w: 11, h: 0.6, fontSize: 18, fontFace: 'Arial', color: DN.sarinaBlue, italic: true })
  s.addText(tagline, { x: 0.8, y: 4.7, w: 11, h: 0.6, fontSize: 22, fontFace: 'Arial', color: DN.white, bold: true })

  // Date strip — small, low-emphasis, just below tagline
  s.addText(`Last updated  ${lastUpdated}     ·     Downloaded  ${downloaded}`, {
    x: 0.8, y: 5.5, w: 11, h: 0.35,
    fontSize: 11, fontFace: 'Arial', color: DN.slate, italic: true,
  })

  s.addShape('rect', { x: 0, y: H - 0.5, w: W, h: 0.5, fill: { color: DN.navyMid } })
  s.addText([
    { text: 'data', options: { color: DN.hermesOrange, bold: true, italic: true } },
    { text: 'nautix', options: { color: DN.sarinaBlue, bold: true, italic: true } },
    { text: '   ·   datanautix.com   ·   Confidential', options: { color: DN.slate } },
  ], { x: 0.6, y: H - 0.45, w: 12, h: 0.4, fontSize: 13, fontFace: 'Arial', valign: 'middle' })
}

// ── Slide builders ─────────────────────────────────────────────────────────
function slideOpportunity(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'A fragmented market about to be rebuilt.')
  addFooter(s, pg)
  s.addText('Voice-of-Customer · Qualitative Research · Reputation · Social Listening · Conversational AI', {
    x: 0.6, y: 1.3, w: 12, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.hermesOrange, bold: true,
  })
  s.addText([
    bullet('Multi-billion-dollar global market spanning Voice-of-Customer, qualitative research, reputation, and social listening — dominated by labor-heavy services and legacy software'),
    bullet('Hundreds of $1–10M revenue services firms are founder-owned and aging out of the market'),
    bullet('Incumbents (Qualtrics, Medallia, Forsta, InMoment) are bolting AI onto 15-year-old codebases'),
    bullet('LLMs collapse 80% of analyst labor — but only for platforms designed around them from day one'),
    bullet('Long tail of vendors and boutique research firms is ripe for AI-led consolidation'),
  ], { x: 0.6, y: 2.0, w: 12.0, h: 4.0 })
  s.addText('Specific TAM / segment-size figures: pending citation from MarketsandMarkets, Grand View Research, Forrester, or your preferred source before external use.', {
    x: 0.6, y: 6.4, w: 12.1, h: 0.4, fontSize: 9, fontFace: 'Arial', color: DN.slate, italic: true,
  })

  s.addNotes(
`Set up the thesis. Walk the five bullets but keep moving.

THE FRAME: A multi-billion-dollar market spanning Voice-of-Customer, qualitative research, reputation, social listening, and conversational AI. Dominated by labor-heavy services firms and legacy software.

KEY POINTS:
- Hundreds of $1-10M revenue services firms — founder-owned, aging out of the market. That's the buy-side opportunity.
- The incumbents — Qualtrics, Medallia, Forsta, InMoment — are bolting AI onto 15-year-old codebases. They can't catch us without a rewrite.
- LLMs collapse 80% of analyst labor — but only for platforms designed around them from day one. We are. They aren't.
- Long tail of vendors and boutique research firms is ripe for AI-led consolidation.

NOTE FOR LP: the TAM figures footnote is intentional. Specific dollar figures get cited from MarketsandMarkets / Grand View / Forrester before external use. Don't quote a number you cannot back up.

Next slide is the credibility story — why us.`
  )
  return pg
}

function slideBeforeAfter(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Before Sentimetrx  vs.  After Sentimetrx', 'A researcher\'s day with legacy tools (Medallia, SurveyMonkey, Qualtrics, Forsta) vs. with Sentimetrx')
  addFooter(s, pg)

  const steps: { label: string; before: string; after: string }[] = [
    { label: 'DESIGN',  before: 'Build a 30-question static form. Wire branching by hand.',           after: 'Pick industry → AI writes the entire conversational study.' },
    { label: 'DEPLOY',  before: 'Export contacts to Mailchimp. Build a separate email tool.',         after: 'Built-in campaigns. Merge tags, reminders, tracking.' },
    { label: 'COLLECT', before: '5–15% response rate. "It was fine." "It was good."',                 after: '10× more responses. AI clarifiers turn "fine" into the real reason.' },
    { label: 'ANALYZE', before: 'Hand 1,000 verbatims to an analyst. Wait 3 weeks for themes.',       after: 'Ana extracts themes + sentiment + segments in minutes.' },
    { label: 'REPORT',  before: 'Junior analyst hand-builds a 50-slide deck. Two-week turn.',         after: 'AI generates tiered PPTX in 2 hours, not 2 weeks.' },
    { label: 'LISTEN',  before: 'Buy a 2nd tool for reviews. A 3rd for social. A 4th for regulatory.', after: 'Reviews + social + Reddit + Reg.gov. One pipeline. One model.' },
  ]

  // Card geometry
  const cardY = 1.3
  const cardH = 5.5
  const leftX = 0.5
  const rightX = 6.85
  const cardW = 5.98

  // Drab "before color TV" palette for the legacy side
  const greyHeader = '4A4A4A'   // dark charcoal (header strip)
  const greyBg     = 'F2F2F2'   // light cool grey (card background)
  const greyAccent = '6B7280'   // medium grey (left-edge accent + label color)
  const greyBorder = 'D1D5DB'   // pill border on legacy side
  const greyText   = '4B5563'   // muted body text on legacy side

  // ── Left card (Before / Legacy) — drab grey ──
  s.addShape('rect', { x: leftX, y: cardY, w: cardW, h: cardH, fill: { color: greyBg }, rectRadius: 0.12 })
  s.addShape('rect', { x: leftX, y: cardY, w: cardW, h: 0.55, fill: { color: greyHeader }, rectRadius: 0.12 })
  s.addText('WITH LEGACY TOOLS', {
    x: leftX, y: cardY, w: cardW, h: 0.55,
    fontFace: 'Arial', fontSize: 13, color: DN.white, bold: true, align: 'center', valign: 'middle', charSpacing: 2,
  })

  // ── Right card (After / Sentimetrx) — branded teal-pale tint ──
  s.addShape('rect', { x: rightX, y: cardY, w: cardW, h: cardH, fill: { color: DN.tealPale }, rectRadius: 0.12 })
  s.addShape('rect', { x: rightX, y: cardY, w: cardW, h: 0.55, fill: { color: DN.teal }, rectRadius: 0.12 })
  s.addText('WITH SENTIMETRX', {
    x: rightX, y: cardY, w: cardW, h: 0.55,
    fontFace: 'Arial', fontSize: 13, color: DN.white, bold: true, align: 'center', valign: 'middle', charSpacing: 2,
  })

  // ── Rows ──
  const rowsY = cardY + 0.7
  const rowsH = cardH - 0.85
  const rowH = (rowsH - 0.05 * (steps.length - 1)) / steps.length

  // Layout: label column wide enough for "ANALYZE" with no wrap; pill takes the rest
  const labelW = 1.2
  const pillX = 1.45      // relative offset inside card
  const pillW = cardW - pillX - 0.15

  steps.forEach((step, i) => {
    const y = rowsY + i * (rowH + 0.05)

    // BEFORE row
    s.addText(step.label, {
      x: leftX + 0.15, y, w: labelW, h: rowH,
      fontFace: 'Arial', fontSize: 9, color: greyAccent, bold: true, charSpacing: 1, valign: 'middle', autoFit: true,
    })
    s.addShape('rect', {
      x: leftX + pillX, y, w: pillW, h: rowH,
      fill: { color: DN.white }, rectRadius: 0.08, line: { color: greyBorder, width: 0.75 },
    })
    s.addShape('rect', {
      x: leftX + pillX, y, w: 0.08, h: rowH,
      fill: { color: greyAccent }, rectRadius: 0.04,
    })
    s.addText(step.before, {
      x: leftX + pillX + 0.17, y, w: pillW - 0.3, h: rowH,
      fontFace: 'Arial', fontSize: 11, color: greyText, valign: 'middle', wrap: true,
    })

    // AFTER row
    s.addText(step.label, {
      x: rightX + 0.15, y, w: labelW, h: rowH,
      fontFace: 'Arial', fontSize: 9, color: DN.tealDark, bold: true, charSpacing: 1, valign: 'middle', autoFit: true,
    })
    s.addShape('rect', {
      x: rightX + pillX, y, w: pillW, h: rowH,
      fill: { color: DN.white }, rectRadius: 0.08, line: { color: 'B7E4E5', width: 0.75 },
    })
    s.addShape('rect', {
      x: rightX + pillX, y, w: 0.08, h: rowH,
      fill: { color: DN.teal }, rectRadius: 0.04,
    })
    s.addText(step.after, {
      x: rightX + pillX + 0.17, y, w: pillW - 0.3, h: rowH,
      fontFace: 'Arial', fontSize: 11, color: DN.navy, bold: true, valign: 'middle', wrap: true,
    })
  })
}

function slideAILedVsAdded(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'AI-Led, Not AI-Added', 'The category is splitting in two — we are already on the right side')
  addFooter(s, pg)

  const head = [
    { text: '', options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
    { text: 'Incumbents (AI-added)', options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
    { text: 'Datanautix (AI-led)', options: { fill: { color: DN.sarinaBlue }, color: DN.white, bold: true, fontSize: 11 } },
  ]
  const data = [
    ['Collection', 'Static form + AI summary', 'Conversational agent, real-time LLM adaptation'],
    ['Text analysis', 'Bolted-on 3rd-party (Clarabridge, Lexalytics)', 'Native theme / sentiment / persona / intent pipeline'],
    ['Multi-source ingest', 'Separate vendor stack', 'One LLM pipeline: surveys + reviews + social + regulatory'],
    ['Agents', 'Separate vendor (Drift, Intercom)', 'Native RAG agents, same data model'],
    ['Live group sessions', 'Human-only / none', 'AI-moderated PulseIQ sessions with topic detection + deflection'],
    ['Reporting', 'Human analyst writes the deck', 'AI-generated tiered PPTX (Exec / Stakeholder / Full Team)'],
  ]
  const rows = [head, ...data.map(r => r.map((c, i) => ({
    text: c,
    options: {
      fontSize: 11, fontFace: 'Arial',
      color: i === 2 ? DN.tealDark : i === 0 ? DN.ink : DN.ink,
      bold: i === 0,
      fill: { color: i === 2 ? DN.tealPale : i === 0 ? DN.slateCard : DN.white },
    },
  })))]
  s.addTable(rows as any, { x: 0.5, y: 1.4, w: 12.3, colW: [2.4, 4.7, 5.2], border: { pt: 0.5, color: DN.slateLight }, rowH: 0.65 })

  s.addText('Architecture difference. Margins, speed, and product depth compound in ways AI-added incumbents cannot match without a full rewrite.', {
    x: 0.6, y: 6.5, w: 12.0, h: 0.5, fontSize: 12, fontFace: 'Arial', color: DN.navy, italic: true, bold: true, align: 'center',
  })
}

function slideCompetitive(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Fragmented across six categories. None does the whole stack.')
  addFooter(s, pg)

  const cats = [
    {
      name: 'Legacy VoC / CX',
      players: 'Qualtrics · Medallia · Forsta · InMoment',
      gap: 'AI bolted onto 15-year stacks; services revenue cannibalization risk',
      color: DN.red,
    },
    {
      name: 'Survey & form tools',
      players: 'SurveyMonkey · Typeform · Alchemer · Jotform',
      gap: 'Form-based collection; no analytics depth; no conversational layer',
      color: DN.amber,
    },
    {
      name: 'Text analytics',
      players: 'Stratifyd · Relative Insight · Lexalytics',
      gap: 'Analysis only; no collection layer; no multi-source ingest',
      color: DN.amber,
    },
    {
      name: 'Reputation & reviews',
      players: 'Birdeye · Podium · Reputation.com · ReviewTrackers',
      gap: 'Single-channel; no research, agent, or live-event formats',
      color: DN.amber,
    },
    {
      name: 'Conversational AI / chatbots',
      players: 'Drift · Intercom Fin · Ada · Botpress',
      gap: 'Support-focused; no survey, analytics, or research integration',
      color: DN.sarinaBlue,
    },
    {
      name: 'Social listening',
      players: 'Brandwatch · Sprout Social · Talkwalker · Meltwater',
      gap: 'Listen-only; no collection or agent loop; no first-party synthesis',
      color: DN.sarinaBlue,
    },
  ]

  // 3×2 grid
  const cardW = 4.05
  const cardH = 2.25
  const startX = 0.45
  const startY = 1.25
  const gapX = 0.1
  const gapY = 0.1

  cats.forEach((c, i) => {
    const col = i % 3, row = Math.floor(i / 3)
    const x = startX + col * (cardW + gapX)
    const y = startY + row * (cardH + gapY)

    s.addShape('rect', { x, y, w: cardW, h: cardH, fill: { color: DN.slateCard }, rectRadius: 0.1 })
    s.addShape('rect', { x, y, w: cardW, h: 0.5, fill: { color: c.color }, rectRadius: 0.1 })
    s.addText(c.name, {
      x: x + 0.15, y: y + 0.05, w: cardW - 0.3, h: 0.4,
      fontFace: 'Arial', fontSize: 13, color: DN.white, bold: true, valign: 'middle',
    })
    s.addText('PLAYERS', {
      x: x + 0.2, y: y + 0.6, w: cardW - 0.4, h: 0.22,
      fontFace: 'Arial', fontSize: 8, color: DN.slate, bold: true, charSpacing: 3,
    })
    s.addText(c.players, {
      x: x + 0.2, y: y + 0.82, w: cardW - 0.4, h: 0.55,
      fontFace: 'Arial', fontSize: 11, color: DN.navy, bold: true, valign: 'top', lineSpacing: 16,
    })
    s.addShape('rect', { x: x + 0.2, y: y + 1.4, w: cardW - 0.4, h: 0.02, fill: { color: 'D4DDE2' } })
    s.addText('THEIR GAP', {
      x: x + 0.2, y: y + 1.45, w: cardW - 0.4, h: 0.22,
      fontFace: 'Arial', fontSize: 8, color: DN.hermesOrange, bold: true, charSpacing: 3,
    })
    s.addText(c.gap, {
      x: x + 0.2, y: y + 1.65, w: cardW - 0.4, h: cardH - 1.7,
      fontFace: 'Arial', fontSize: 10, color: DN.ink, italic: true, valign: 'top', lineSpacing: 14,
    })
  })

  // Bottom kicker — acquisition target callout
  const kY = startY + 2 * (cardH + gapY) + 0.05
  s.addShape('rect', { x: 0.5, y: kY, w: 12.3, h: H - kY - 0.5, fill: { color: DN.navy }, rectRadius: 0.08 })
  s.addShape('rect', { x: 0.5, y: kY, w: 0.18, h: H - kY - 0.5, fill: { color: DN.green } })
  s.addText('Boutique MR / CX firms = acquisition target, not competitor.', {
    x: 0.85, y: kY, w: 12.0, h: H - kY - 0.5,
    fontFace: 'Arial', fontSize: 16, color: DN.gold, bold: true, italic: true, valign: 'middle',
  })

  s.addNotes(
`The competitive landscape. Six categories of vendor. Each does pieces. Nobody does the whole stack AI-native.

WALK THE 6 CATEGORIES (the audience reads color-coded threat tier):

RED (incumbent platforms — biggest shadows, but also our likely exit buyers):
- Legacy VoC / CX: Qualtrics, Medallia, Forsta, InMoment.
- The gap: AI bolted onto 15-year stacks. Services-revenue cannibalization risk.

AMBER (point-tool vendors — the long tail we replace with the platform):
- Survey & form tools: SurveyMonkey, Typeform, Alchemer.
- Text analytics: Stratifyd, Relative Insight.
- Reputation & reviews: Birdeye, Podium, Reputation.com.

SARINA BLUE (adjacent markets — not direct, but worth flagging):
- Conversational AI / chatbots: Drift, Intercom Fin, Ada.
- Social listening: Brandwatch, Sprout, Talkwalker, Meltwater.

THE PUNCHLINE (the bottom strap): "Boutique MR / CX firms — Kantar, NielsenIQ, hundreds of small — are not a competitor. They are our acquisition target. The roll-up consolidates that layer onto the AI-native platform above."

This slide answers two questions at once: "who else is doing this?" (lots, but in pieces) and "what's your moat?" (the integrated platform, plus the consolidation play).`
  )
}

function slideWhatWeBuilt(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Six modules. Already serving enterprise.')
  addFooter(s, pg)

  const modules = [
    { name: 'Sarina',     tag: 'Surveys',       color: DN.sarinaBlue },
    { name: 'Ana',        tag: 'Analytics',     color: DN.teal },
    { name: 'Agents',     tag: 'RAG',           color: DN.hermesOrange },
    { name: 'PulseIQ',    tag: 'Live sessions', color: DN.gold },
    { name: 'Listening',  tag: 'Multi-source',  color: DN.navy },
    { name: 'Campaigns',  tag: 'Email + SMS',   color: DN.tealDark },
  ]
  modules.forEach((m, i) => {
    const col = i % 3, row = Math.floor(i / 3)
    const x = 0.6 + col * 4.15
    const y = 1.4 + row * 1.7
    s.addShape('rect', { x, y, w: 3.85, h: 1.5, fill: { color: DN.slateCard }, rectRadius: 0.1 })
    s.addShape('rect', { x, y, w: 3.85, h: 0.55, fill: { color: m.color }, rectRadius: 0.1 })
    s.addText(m.name, { x, y, w: 3.85, h: 0.55, fontSize: 22, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
    s.addText(m.tag, { x, y: y + 0.7, w: 3.85, h: 0.7, fontSize: 14, fontFace: 'Arial', color: DN.slate, italic: true, align: 'center', valign: 'middle' })
  })

  s.addShape('rect', { x: 0.6, y: 4.95, w: 12.1, h: 1.7, fill: { color: DN.navy }, rectRadius: 0.1 })
  s.addText('PROOF', { x: 0.8, y: 5.05, w: 4, h: 0.35, fontSize: 11, fontFace: 'Arial', color: DN.gold, bold: true, charSpacing: 3 })
  s.addText('Globetrotters · Orlando Magic · JW Marriott · Red Lobster · UCF Rosen · MCO Airport', {
    x: 0.8, y: 5.4, w: 11.7, h: 0.5, fontSize: 16, fontFace: 'Arial', color: DN.white, bold: true,
  })
  s.addText('5 verticals · multi-tenant · white-labeled', {
    x: 0.8, y: 5.95, w: 11.7, h: 0.4, fontSize: 13, fontFace: 'Arial', color: DN.sarinaBlue, italic: true,
  })

  s.addNotes(
`Six revenue-bearing modules. Walk them in one breath each — the audience does not need depth here, that's what the architecture deck is for.

- SARINA (conversational surveys) — ~10× the response rate of email surveys.
- ANA (AI text analytics) — analysis in <5% of human-team time.
- AGENTS (public RAG chat agents) — hybrid retrieval, drift review.
- PULSEIQ (live group feedback) — concurrent AI-moderated conversations with real-time theme mining.
- LISTENING — Google Reviews, Reddit, Substack, Reg.gov, Meta. One pipeline.
- CAMPAIGNS — multi-provider email + SMS with AI personalization.

THE PROOF BAR: Globetrotters, Orlando Magic, JW Marriott, Red Lobster, UCF Rosen, MCO Airport. Five verticals. Real customers. Not prototype.

Don't dwell. The point is "we've shipped this, customers use it, this is not a deck."`
  )
}

function slideWedge(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Hospitality first.')
  addFooter(s, pg)
  s.addText('Why hospitality leads', { x: 0.6, y: 1.3, w: 6, h: 0.5, fontSize: 16, fontFace: 'Arial', color: DN.navy, bold: true })
  s.addShape('rect', { x: 0.6, y: 1.75, w: 1.2, h: 0.04, fill: { color: DN.gold } })
  s.addText([
    bullet('Datanautix already serves Marriott, Red Lobster, Orlando resorts — reference customers ready'),
    bullet('Highly fragmented vendor landscape (review monitoring, MR boutiques, CX agencies)'),
    bullet('Recurring need + measurable ROI → high cross-sell room with every customer'),
    bullet('Benchmark data flywheel — proprietary dataset no incumbent can build'),
    bullet('30+ hospitality-focused MR / CX / reputation firms identified, $1–10M revenue range'),
  ], { x: 0.6, y: 1.95, w: 7.5, h: 4.0 })

  // sidebar callout
  s.addShape('rect', { x: 8.4, y: 1.4, w: 4.4, h: 5.2, fill: { color: DN.slateLight }, rectRadius: 0.1 })
  s.addText('PARALLEL CHANNELS', { x: 8.6, y: 1.55, w: 4, h: 0.35, fontSize: 10, fontFace: 'Arial', color: DN.hermesOrange, bold: true, charSpacing: 3 })
  s.addText('Sports & Venues', { x: 8.6, y: 2.0, w: 4, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.navy, bold: true })
  s.addText('Globetrotters, Orlando Magic — proven', { x: 8.6, y: 2.4, w: 4, h: 0.3, fontSize: 11, fontFace: 'Arial', color: DN.slate })
  s.addShape('rect', { x: 8.6, y: 2.85, w: 4, h: 0.02, fill: { color: DN.slate } })
  s.addText('Political / Public Opinion', { x: 8.6, y: 3.05, w: 4, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.navy, bold: true })
  s.addText('Voter research, reg.gov ingest', { x: 8.6, y: 3.45, w: 4, h: 0.3, fontSize: 11, fontFace: 'Arial', color: DN.slate })
  s.addShape('rect', { x: 8.6, y: 3.9, w: 4, h: 0.02, fill: { color: DN.slate } })
  s.addText('Education', { x: 8.6, y: 4.1, w: 4, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.navy, bold: true })
  s.addText('UCF Rosen, course evaluations', { x: 8.6, y: 4.5, w: 4, h: 0.3, fontSize: 11, fontFace: 'Arial', color: DN.slate })
  s.addText('Opportunistic only.\nDo not let them distract from\nhospitality momentum.', {
    x: 8.6, y: 5.4, w: 4, h: 1.0, fontSize: 11, fontFace: 'Arial', color: DN.navy, italic: true, lineSpacing: 18,
  })

  s.addNotes(
`The wedge slide. Five reasons hospitality leads.

1. DATANAUTIX ALREADY SERVES the names — JW Marriott, Red Lobster, multiple Orlando resorts. Reference customers are already in the bag.

2. HIGHLY FRAGMENTED VENDOR LANDSCAPE: review monitoring tools, MR boutiques, CX agencies. Lots of acquisition targets.

3. RECURRING NEED + measurable ROI. Cross-sell room with every customer.

4. BENCHMARK DATA FLYWHEEL. Every acquired customer contributes to a proprietary dataset no incumbent can build.

5. 30+ HOSPITALITY-FOCUSED firms identified, $1-10M revenue range.

SIDEBAR (parallel channels): sports & venues (Globetrotters, Magic) and political/public opinion already have proof points. Run them as opportunistic channels — don't let them distract from hospitality momentum.`
  )
}

function slidePlaybook(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Buy. Migrate. Expand. Cross-sell. Compound.')
  addFooter(s, pg)
  const steps = [
    { n: '1', title: 'Acquire',       color: DN.sarinaBlue },
    { n: '2', title: 'Migrate',       color: DN.teal },
    { n: '3', title: 'Expand margin', color: DN.hermesOrange },
    { n: '4', title: 'Cross-sell',    color: DN.gold },
    { n: '5', title: 'Compound',      color: DN.navy },
  ]
  steps.forEach((step, i) => {
    const y = 1.5 + i * 1.05
    s.addShape('ellipse', { x: 0.7, y, w: 0.9, h: 0.9, fill: { color: step.color } })
    s.addText(step.n, { x: 0.7, y, w: 0.9, h: 0.9, fontSize: 36, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
    s.addShape('rect', { x: 1.8, y: y + 0.05, w: 11.0, h: 0.8, fill: { color: DN.slateCard }, rectRadius: 0.08 })
    s.addShape('rect', { x: 1.8, y: y + 0.05, w: 0.15, h: 0.8, fill: { color: step.color } })
    s.addText(step.title, { x: 2.1, y: y + 0.05, w: 10.6, h: 0.8, fontSize: 22, fontFace: 'Arial', color: DN.navy, bold: true, valign: 'middle' })
  })

  s.addNotes(
`Five steps. Walk them quickly — the audience knows the playbook arc. The detail is in your delivery.

1. ACQUIRE. Services firms at 3-6× EBITDA. Founder-owned, sticky contracts, labor-heavy, AI-vulnerable. The boutique MR / CX firms we covered on the competitive slide.

2. MIGRATE. Move delivery onto Sentimetrx within 90 days. Same playbook every deal — that's how this scales.

3. EXPAND MARGIN. Replace analyst hours with Ana. Target +1,000 to 1,500 basis points of EBITDA in Year 1. That's the AI margin lever.

4. CROSS-SELL. Add the modules they didn't have — agents, PulseIQ, multi-source listening. New revenue from the existing customer base at zero CAC.

5. COMPOUND. Each deal deepens the data moat, the vertical IP, and the benchmark value across the platform. Year 5 deals are more valuable than Year 1 deals.

This is the slide where the math becomes inevitable. The next slide shows the numbers.`
  )
}

function slideMath(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Every $1 of acquired EBITDA → ~5× richer on exit.')
  addFooter(s, pg)

  const head = [
    { text: '', options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
    { text: 'Pre-Deal', options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11, align: 'center' } },
    { text: 'Year 1 Post-Migration', options: { fill: { color: DN.sarinaBlue }, color: DN.white, bold: true, fontSize: 11, align: 'center' } },
    { text: 'Year 2', options: { fill: { color: DN.sarinaBlue }, color: DN.white, bold: true, fontSize: 11, align: 'center' } },
  ]
  const data = [
    ['Revenue', '$3.0M', '$3.6M', '$4.3M'],
    ['Services COGS', '($1.8M)', '($1.6M)', '($1.7M)'],
    ['Platform allocation', '—', '($0.2M)', '($0.3M)'],
    ['SG&A', '($0.6M)', '($0.5M)', '($0.5M)'],
    ['EBITDA', '$0.6M', '$1.3M', '$1.8M'],
    ['Margin', '20%', '36%', '42%'],
  ]
  const rows = [head, ...data.map((r, ri) => r.map((c, ci) => ({
    text: c,
    options: {
      fontSize: 12, fontFace: 'Arial',
      color: ci === 0 ? DN.ink : ri >= 4 ? DN.tealDark : DN.ink,
      bold: ci === 0 || ri >= 4,
      fill: { color: ri >= 4 ? DN.tealPale : ri % 2 === 0 ? DN.slateCard : DN.white },
      align: ci === 0 ? 'left' : 'center',
    },
  })))]
  s.addTable(rows as any, { x: 0.6, y: 1.4, w: 12.1, colW: [3.4, 2.9, 2.9, 2.9], border: { pt: 0.5, color: DN.slateLight }, rowH: 0.42 })

  // arbitrage callout
  s.addShape('rect', { x: 0.6, y: 5.3, w: 12.1, h: 1.4, fill: { color: DN.navy }, rectRadius: 0.1 })
  s.addText('Acquired at 4× pre-deal EBITDA = $2.4M  ·  60% cash / 30% seller note / 10% rollover', {
    x: 0.8, y: 5.4, w: 11.7, h: 0.4, fontSize: 13, fontFace: 'Arial', color: DN.white,
  })
  s.addText('Year 2 effective multiple paid: 1.3×   →   Platform exit multiple at scale: 10–12× EBITDA', {
    x: 0.8, y: 5.85, w: 11.7, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.gold, bold: true,
  })
  s.addText('Five deals = $5M EBITDA from ~$12M deployed.', {
    x: 0.8, y: 6.25, w: 11.7, h: 0.4, fontSize: 13, fontFace: 'Arial', color: DN.sarinaBlue, italic: true, bold: true,
  })

  s.addNotes(
`This is the math slide. The table tells the story — walk it slowly.

PRE-DEAL: $3M revenue · 20% margin · $0.6M EBITDA. Typical boutique MR firm.

ACQUIRE at 4× pre-deal EBITDA = $2.4M purchase price. Structure: 60% cash / 30% seller note / 10% rollover.

POST-MIGRATION (Year 1):
- Analyst labor compression via Ana: +$300K to EBITDA.
- Module cross-sell at 20% revenue uplift: +$200K to EBITDA.
- Run-rate EBITDA goes to $1.3M.

Year 2: even better — $1.8M EBITDA at 42% margin.

THE PUNCH LINE:
- We paid $2.4M for what's now generating $1.3M EBITDA in Year 1.
- Effective multiple paid on run-rate: 1.3-2.2×.
- Platform exit multiple at scale: 10-12× EBITDA.
- Every $1 of acquired EBITDA becomes ~5× richer on exit.

Repeat across 5 deals = $5M of consolidated EBITDA from ~$12M of capital deployed.

This is the slide where LPs do the math in their heads. Give them 30 seconds of silence.`
  )
}

function slidePhasing(pptx: any, pg: number, isAsk = true) {
  const s = pptx.addSlide()
  addHeader(s, 'Capital matched to proof.')
  addFooter(s, pg)

  const head = [
    { text: 'Phase', options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11, align: 'center' } },
    { text: 'Window', options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11, align: 'center' } },
    { text: 'Capital', options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11, align: 'center' } },
    { text: 'Source', options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11, align: 'center' } },
    { text: 'Milestone', options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11, align: 'center' } },
  ]
  const data: [string, string, string, string, string, boolean][] = [
    ['0', '0–6 mo',     '$1–3M',   'Founder + angels',                        'First deal closed + migration documented', false],
    ['1', '6–18 mo',    '$5–10M',  'Independent sponsor / family offices',    '2–3 more tuck-ins; ~$15–25M combined revenue', true],
    ['2', '18–36 mo',   '$25–75M', 'Institutional PE',                        '5+ more deals; first SaaS tuck-in', false],
    ['3', '3–7 yr',     'Equity + debt', 'Growth equity / large-cap PE',      'Larger platform deals, exit prep', false],
  ]
  const rows = [head, ...data.map(([phase, window, capital, source, milestone, highlight]) => [
    { text: phase, options: { fontSize: 14, fontFace: 'Arial', color: highlight ? DN.white : DN.navy, bold: true, align: 'center', fill: { color: highlight ? DN.sarinaBlue : DN.slateCard } } },
    { text: window, options: { fontSize: 11, fontFace: 'Arial', color: highlight ? DN.white : DN.ink, align: 'center', fill: { color: highlight ? DN.sarinaBlue : DN.white } } },
    { text: capital, options: { fontSize: 11, fontFace: 'Arial', color: highlight ? DN.white : DN.ink, bold: highlight, align: 'center', fill: { color: highlight ? DN.sarinaBlue : DN.slateCard } } },
    { text: source, options: { fontSize: 10, fontFace: 'Arial', color: highlight ? DN.white : DN.ink, align: 'center', fill: { color: highlight ? DN.sarinaBlue : DN.white } } },
    { text: milestone, options: { fontSize: 10, fontFace: 'Arial', color: highlight ? DN.white : DN.ink, align: 'center', fill: { color: highlight ? DN.sarinaBlue : DN.slateCard } } },
  ])]
  s.addTable(rows as any, { x: 0.5, y: 1.35, w: 12.3, colW: [1.0, 1.8, 2.1, 3.4, 4.0], border: { pt: 0.5, color: DN.slateLight }, rowH: 0.55 })

  if (isAsk) {
    s.addShape('rect', { x: 0.5, y: 4.7, w: 12.3, h: 2.0, fill: { color: DN.navy }, rectRadius: 0.1 })
    s.addShape('rect', { x: 0.5, y: 4.7, w: 0.15, h: 2.0, fill: { color: DN.gold } })
    s.addText("TODAY'S ASK", { x: 0.85, y: 4.85, w: 6, h: 0.4, fontSize: 12, fontFace: 'Arial', color: DN.gold, bold: true, charSpacing: 3 })
    s.addText('$5–10M Independent-Sponsor Vehicle', { x: 0.85, y: 5.25, w: 12, h: 0.6, fontSize: 24, fontFace: 'Arial', color: DN.white, bold: true })
    s.addText('Funds Phase 0 + Phase 1 — 3–4 services acquisitions, platform migration, sponsor team', {
      x: 0.85, y: 5.85, w: 12, h: 0.4, fontSize: 13, fontFace: 'Arial', color: DN.sarinaBlue,
    })
    s.addText('Co-investment rights at deal level  ·  8% pref + 80/20 split  ·  4–6× MOIC over 5–7 years', {
      x: 0.85, y: 6.25, w: 12, h: 0.4, fontSize: 11, fontFace: 'Arial', color: DN.slate, italic: true,
    })
  }

  s.addNotes(
`The phasing slide. Walk it as a sequence of proof points, not a fundraising calendar.

PHASE 0 (now-6 months, $1-3M): close the first services acquisition with founder capital + angels. Document the migration. This is what we are doing this quarter.

PHASE 1 (6-18 months, $5-10M — TODAY'S ASK if isAsk=true): independent sponsor / family offices fund 2-3 more tuck-ins. Combined revenue ~$15-25M. This is the platform that institutional PE will then fund.

PHASE 2 (18-36 months, $25-75M): institutional PE. 5+ more deals. First SaaS tuck-in.

PHASE 3 (3-7 yr): equity + debt for larger platform deals, exit prep.

THE ASK (if isAsk=true, gold accent at bottom): "$5-10M independent-sponsor vehicle. Funds Phase 0 + Phase 1 — 3-4 services acquisitions, platform migration, sponsor team. Co-investment rights at deal level, 8% pref + 80/20 split, 4-6× MOIC over 5-7 years."

The reason this structure works: PE typically wants to fund a proven playbook. By Phase 2 we've demonstrated 3-4 deals worth of integration mechanics. That's exactly what institutional capital will buy.`
  )
}

function slideOrigin(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'We did not pivot to AI. We were waiting for it.')
  addFooter(s, pg)

  // Four stages — just tag + headline, no body
  const stages = [
    { tag: 'BACKGROUND', title: '12 years in enterprise NLP / NLU',  color: DN.slate },
    { tag: 'LLM',        title: 'Move the problem upstream',          color: DN.sarinaBlue },
    { tag: 'EXTENSION',  title: 'Agents · PulseIQ · Ana',              color: DN.teal },
    { tag: 'NOW',        title: 'The economic flip',                   color: DN.gold },
  ]
  const startY = 1.3
  const cardH = 0.95
  const gap = 0.12
  stages.forEach((stage, i) => {
    const y = startY + i * (cardH + gap)
    s.addShape('rect', { x: 0.5, y, w: 1.7, h: cardH, fill: { color: stage.color }, rectRadius: 0.08 })
    s.addText(stage.tag, {
      x: 0.5, y, w: 1.7, h: cardH,
      fontFace: 'Arial', fontSize: 11, color: DN.white, bold: true, charSpacing: 2, align: 'center', valign: 'middle', autoFit: true,
    })
    s.addShape('rect', { x: 2.3, y, w: 10.5, h: cardH, fill: { color: DN.slateCard }, rectRadius: 0.08 })
    s.addText(stage.title, {
      x: 2.5, y, w: 10.1, h: cardH,
      fontFace: 'Arial', fontSize: 22, color: DN.navy, bold: true, valign: 'middle', autoFit: true,
    })
  })

  // Closing kicker (the user's exact line)
  const kY = startY + stages.length * (cardH + gap) + 0.05
  s.addShape('rect', { x: 0.5, y: kY, w: 12.3, h: H - kY - 0.5, fill: { color: DN.navy }, rectRadius: 0.08 })
  s.addShape('rect', { x: 0.5, y: kY, w: 0.18, h: H - kY - 0.5, fill: { color: DN.gold } })
  s.addText('Wisdom + experience build transformational tools — and flip the economics.', {
    x: 0.85, y: kY, w: 12.0, h: H - kY - 0.5,
    fontFace: 'Arial', fontSize: 17, color: DN.gold, bold: true, italic: true, valign: 'middle', autoFit: true,
  })

  s.addNotes(
`The credibility slide. Walk the four stages.

BACKGROUND. 12 years running an enterprise NLP/NLU practice. Helping large clients make sense of open-ended comments at scale — surveys, online reviews, regulatory feedback. Always running into the same wall: short, ambiguous comments are nearly useless at analysis time.

LLM. LLMs let us move the problem upstream. Instead of trying to mine "it was fine" for meaning in a report a month later, we intercept weak responses at capture time and ask the follow-up. Sarina, the conversational survey, is born.

EXTENSION. Then domain-trained Agents — political candidates, restaurant menus — with off-topic detection and 3-strike safety. Then PulseIQ — concurrent conversations with real-time theme mining. Then Ana, the text analytics suite, deeper than what 15-year-old incumbents ship.

NOW. The economic flip. For 12 years this platform would have required a 50-person engineering team and $20M+ of capital. AI is the leverage that lets experienced operators deliver enterprise-grade products on venture-light capital.

LAND THE CLOSE on the user's exact phrasing:
"This is the age where wisdom + experience build transformational tools — and flip the economics of the business."

That sentence is the entire pitch. Stop and let it sit.`
  )
}

function slideWhyUs(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'The platform is shipped. The customers are real.')
  addFooter(s, pg)
  s.addText([
    bullet('AI-native platform live with named enterprise clients across 5 verticals — no R&D risk for the LP'),
    bullet('Six revenue-bearing modules: Sarina, Ana, Agents, PulseIQ, Listening, Campaigns'),
    bullet('Multi-tenant infrastructure built for white-label and feature-gated migration of acquired customers'),
    bullet('Founder/operator combining product, AI, and vertical expertise'),
    bullet('Hiring: VP M&A, Operating Partner, Board Chair (ex-Forsta / InMoment / Qualtrics target)'),
  ], { x: 0.6, y: 1.4, w: 12.1, h: 3.4 })

  // metric strip
  const metrics = [
    { v: '5', l: 'verticals served' },
    { v: '6', l: 'revenue modules' },
    { v: '10×', l: 'response lift' },
    { v: '<5%', l: 'of human-team analysis time' },
  ]
  metrics.forEach((m, i) => {
    const x = 0.6 + i * 3.05
    s.addShape('rect', { x, y: 5.0, w: 2.85, h: 1.6, fill: { color: DN.slateLight }, rectRadius: 0.1 })
    s.addText(m.v, { x, y: 5.1, w: 2.85, h: 0.85, fontSize: 38, fontFace: 'Arial', color: DN.sarinaBlue, bold: true, align: 'center', valign: 'middle' })
    s.addText(m.l, { x: x + 0.15, y: 5.95, w: 2.55, h: 0.55, fontSize: 11, fontFace: 'Arial', color: DN.slate, align: 'center', valign: 'middle' })
  })

  s.addNotes(
`Why us. Five bullets across the top, four metric tiles across the bottom.

THE FIVE THEMES (don't read; cover):
1. AI-native platform LIVE with named enterprise clients across 5 verticals. No R&D risk for the LP — the product exists.
2. SIX REVENUE-BEARING MODULES: Sarina, Ana, Agents, PulseIQ, Listening, Campaigns.
3. MULTI-TENANT INFRASTRUCTURE built for white-label and feature-gated migration of acquired customers. That's how we absorb a boutique MR firm's customers in 90 days, not 18 months.
4. FOUNDER / OPERATOR combining product, AI, and vertical expertise. (Personalize as needed.)
5. HIRING (Phase 1 investment): VP M&A, Operating Partner, Board Chair (ex-Forsta / InMoment / Qualtrics target).

THE FOUR HEADLINE NUMBERS:
- 5 verticals served.
- 6 revenue modules.
- 10× response lift over email surveys (validated at multiple hospitality clients).
- <5% of human-team analysis time (validated at UCF Rosen College).

Close: "Already serving enterprise. No R&D risk for the LP. The risk is execution speed on the M&A side, not platform readiness."`
  )
}

function slideExit(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Multiple buyers. Multiple paths.')
  addFooter(s, pg)

  const cols = [
    { title: 'Strategic Acquirers', items: 'Qualtrics\nMedallia\nSprinklr\nServiceNow\nSalesforce\nNICE\nAdobe\nLarge CX / contact-center platforms', color: DN.sarinaBlue },
    { title: 'PE Platforms', items: 'Vista Equity\nThoma Bravo\nHg\nSilver Lake\nLarge-cap roll-up sponsors', color: DN.teal },
    { title: 'IPO Path', items: 'At $100M+ revenue\nWith 25%+ growth\n5+ year hold\nProfitable platform model', color: DN.navy },
  ]
  cols.forEach((col, i) => {
    const x = 0.6 + i * 4.15
    s.addShape('rect', { x, y: 1.4, w: 3.85, h: 4.4, fill: { color: DN.slateLight }, rectRadius: 0.1 })
    s.addShape('rect', { x, y: 1.4, w: 3.85, h: 0.55, fill: { color: col.color }, rectRadius: 0.1 })
    s.addText(col.title, { x, y: 1.4, w: 3.85, h: 0.55, fontSize: 14, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
    s.addText(col.items, { x: x + 0.25, y: 2.05, w: 3.45, h: 3.7, fontSize: 12, fontFace: 'Arial', color: DN.ink, lineSpacing: 24 })
  })

  s.addShape('rect', { x: 0.6, y: 6.0, w: 12.1, h: 0.7, fill: { color: DN.navy }, rectRadius: 0.08 })
  s.addText('Target return: 4–6× MOIC over 5–7 years   ·   First-deal IRR demonstrable within 18 months', {
    x: 0.8, y: 6.0, w: 11.7, h: 0.7, fontSize: 14, fontFace: 'Arial', color: DN.gold, bold: true, valign: 'middle', align: 'center',
  })

  s.addNotes(
`The exit slide. Three credible paths.

STRATEGIC ACQUIRERS (most likely):
Qualtrics, Medallia, Sprinklr, ServiceNow, Salesforce, NICE, Adobe, large CX / contact-center platforms.
These are the firms that need an AI-native acquisition to refresh their stack. We are the acquisition.

PE PLATFORMS:
Vista Equity, Thoma Bravo, Hg, Silver Lake. Large-cap roll-up sponsors. Two paths: (1) sell the consolidated platform; (2) take a recap.

IPO:
At $100M+ revenue, 25%+ growth, profitable. 5-7 year hold from Phase 1.

THE NUMBERS:
- Target return: 4-6× MOIC over 5-7 years.
- First-deal IRR demonstrable within 18 months — that's what unlocks Phase 2 capital.

Close the meeting on the exit. Then ask for the meeting.`
  )
}

// ── Long-deck-only slides ──────────────────────────────────────────────────
function slideExecSummary(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Executive Summary', 'One slide. The whole deal.')
  addFooter(s, pg)
  const rows: [string, string][] = [
    ['Thesis', 'Roll up fragmented, founder-owned customer-intelligence services firms onto an AI-native operating platform — already shipped and serving enterprise clients'],
    ['Why now', 'LLMs collapse analyst labor; legacy incumbents stuck on pre-LLM architectures; founder generation aging out'],
    ['Wedge', 'Hospitality first; sports + political run as parallel opportunistic channels'],
    ['Math', 'Buy services at 3–6× EBITDA; exit consolidated platform at 10–12× — multiple arbitrage + AI-driven margin expansion'],
    ['Ask', '$5–10M independent-sponsor vehicle for first 3–4 deals'],
    ['Exit', 'Strategic (Qualtrics, Medallia, Sprinklr) or large-cap PE in 5–7 yrs; 4–6× MOIC target'],
  ]
  rows.forEach(([k, v], i) => {
    const y = 1.4 + i * 0.85
    s.addShape('rect', { x: 0.6, y, w: 2.4, h: 0.7, fill: { color: DN.sarinaBlue }, rectRadius: 0.08 })
    s.addText(k, { x: 0.6, y, w: 2.4, h: 0.7, fontSize: 13, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
    s.addShape('rect', { x: 3.1, y, w: 9.7, h: 0.7, fill: { color: DN.slateCard }, rectRadius: 0.08 })
    s.addText(v, { x: 3.3, y, w: 9.4, h: 0.7, fontSize: 11, fontFace: 'Arial', color: DN.ink, valign: 'middle' })
  })
}

function slideMarket(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'The Market', 'Five adjacent segments. Fragmented at the edges.')
  addFooter(s, pg)
  const segs = [
    { label: 'CX / VoC\nPlatforms',                  color: DN.sarinaBlue },
    { label: 'Market Research\nServices',            color: DN.teal },
    { label: 'Online Reputation\n& Review Intel.',   color: DN.hermesOrange },
    { label: 'Social Listening /\nCommunity Intel.', color: DN.gold },
    { label: 'Conversational AI /\nCustomer Agents', color: DN.navy },
  ]
  segs.forEach((seg, i) => {
    const x = 0.6 + i * 2.5
    s.addShape('rect', { x, y: 1.5, w: 2.3, h: 2.8, fill: { color: seg.color }, rectRadius: 0.1 })
    s.addText(seg.label, { x: x + 0.1, y: 1.6, w: 2.1, h: 2.6, fontSize: 14, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle', lineSpacing: 22 })
  })
  s.addShape('rect', { x: 0.6, y: 4.6, w: 12.1, h: 1.7, fill: { color: DN.slateLight }, rectRadius: 0.1 })
  s.addText('Top 5 incumbents hold a minority of the combined market', { x: 0.85, y: 4.7, w: 12, h: 0.5, fontSize: 17, fontFace: 'Arial', color: DN.navy, bold: true })
  s.addText('The long tail: hundreds of $1–20M revenue founder-owned firms — labor-heavy, AI-vulnerable, ripe for consolidation. This is where the roll-up happens.', {
    x: 0.85, y: 5.2, w: 12, h: 0.9, fontSize: 12, fontFace: 'Arial', color: DN.ink, lineSpacing: 18,
  })
  s.addShape('rect', { x: 0.6, y: 6.4, w: 12.1, h: 0.5, fill: { color: 'FEF3C7' }, rectRadius: 0.06, line: { color: DN.amber, width: 0.75 } })
  s.addText('Specific segment $ figures and incumbent share % to be sourced from MarketsandMarkets, Grand View Research, Forrester, or Gartner before external use.', {
    x: 0.75, y: 6.4, w: 12.0, h: 0.5, fontSize: 10, fontFace: 'Arial', color: '7C2D12', italic: true, valign: 'middle',
  })
}

function slideWhyNow(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Why Now', 'Three forces. Time-bounded window.')
  addFooter(s, pg)
  const forces = [
    { n: '1', title: 'LLM economics', body: 'Qualitative analysis costs collapsed 80%+. Only AI-native platforms can capture the savings without rewriting their stack.', color: DN.sarinaBlue },
    { n: '2', title: 'Founder demographics', body: 'Boomer-owned services firms are aging out. Succession is the #1 reason owners sell in this segment — buyers with vision win.', color: DN.teal },
    { n: '3', title: 'Incumbent paralysis', body: 'Qualtrics, Medallia, Forsta, Sprinklr cannot refactor to LLM-native economics without cannibalizing services revenue. Public-co cadence makes deep replatforming politically impossible.', color: DN.hermesOrange },
  ]
  forces.forEach((f, i) => {
    const y = 1.4 + i * 1.7
    s.addShape('ellipse', { x: 0.6, y: y + 0.1, w: 1.0, h: 1.0, fill: { color: f.color } })
    s.addText(f.n, { x: 0.6, y: y + 0.1, w: 1.0, h: 1.0, fontSize: 36, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
    s.addShape('rect', { x: 1.8, y, w: 11.0, h: 1.4, fill: { color: DN.slateLight }, rectRadius: 0.08 })
    s.addText(f.title, { x: 2.1, y: y + 0.1, w: 10.5, h: 0.45, fontSize: 16, fontFace: 'Arial', color: f.color, bold: true })
    s.addText(f.body, { x: 2.1, y: y + 0.55, w: 10.5, h: 0.85, fontSize: 12, fontFace: 'Arial', color: DN.ink, lineSpacing: 18 })
  })
  s.addText('The window closes in 5–7 years. Either we consolidate the long tail in that window, or a strategic does it on top of us.', {
    x: 0.6, y: 6.6, w: 12.1, h: 0.4, fontSize: 12, fontFace: 'Arial', color: DN.navy, italic: true, bold: true, align: 'center',
  })
}

function slideIncumbentFragility(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Incumbent Fragility', 'Why Qualtrics, Medallia & Sprinklr cannot easily catch us')
  addFooter(s, pg)
  s.addText([
    bullet('15-year-old codebases architected for static surveys — not conversational flows'),
    bullet('AI features bolted on as features, not as the spine of the workflow'),
    bullet('Services revenue (~30–50% of revenue at incumbents) is exactly what AI compresses — refactoring cannibalizes their P&L'),
    bullet('Public-company quarterly cadence makes deep replatforming politically impossible'),
    bullet('Their M&A appetite is for AI-native platforms — i.e., us as the eventual exit'),
  ], { x: 0.6, y: 1.4, w: 12.1, h: 4.5 })
  s.addShape('rect', { x: 0.6, y: 6.0, w: 12.1, h: 0.7, fill: { color: DN.navy }, rectRadius: 0.08 })
  s.addText('We do not compete with incumbents. We become the asset they buy.', {
    x: 0.6, y: 6.0, w: 12.1, h: 0.7, fontSize: 14, fontFace: 'Arial', color: DN.gold, bold: true, italic: true, align: 'center', valign: 'middle',
  })
}

function slideAILedCollection(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'AI-Led Collection', 'Sarina + Agents + PulseIQ — every channel is conversational')
  addFooter(s, pg)
  const cols = [
    { name: 'Sarina', tag: 'Surveys', desc: 'LLM-driven clarifiers on vague responses\nSentiment-adaptive flow\nIn-conversation persona inference\n15 question types\nMulti-language auto-translation', color: DN.sarinaBlue },
    { name: 'Agents', tag: 'RAG / Public Chat', desc: 'RAG-based public chat agents\nHybrid retrieval (semantic + lexical + fuzzy)\nPer-turn sentiment & intent capture\nConversation review & theme drift detection', color: DN.teal },
    { name: 'PulseIQ', tag: 'Live Sessions', desc: 'AI-moderated live group sessions\nOrganic topic detection\nDeflection routing\nTrending-phrase analysis\nProjectable live screens', color: DN.hermesOrange },
  ]
  cols.forEach((c, i) => {
    const x = 0.6 + i * 4.15
    s.addShape('rect', { x, y: 1.4, w: 3.85, h: 5.3, fill: { color: DN.slateLight }, rectRadius: 0.1 })
    s.addShape('rect', { x, y: 1.4, w: 3.85, h: 0.85, fill: { color: c.color }, rectRadius: 0.1 })
    s.addText(c.name, { x, y: 1.45, w: 3.85, h: 0.5, fontSize: 22, fontFace: 'Arial', color: DN.white, bold: true, align: 'center' })
    s.addText(c.tag, { x, y: 1.9, w: 3.85, h: 0.3, fontSize: 11, fontFace: 'Arial', color: DN.white, italic: true, align: 'center' })
    s.addText(c.desc, { x: x + 0.25, y: 2.4, w: 3.45, h: 4.2, fontSize: 12, fontFace: 'Arial', color: DN.ink, lineSpacing: 22 })
  })
}

function slideAILedAnalysis(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'AI-Led Analysis: Ana', 'The text analytics engine that makes services-firm owners weep')
  addFooter(s, pg)
  s.addText([
    bullet('Theme mining: 4–7 distinct themes with 8–15 keywords each, all LLM-extracted'),
    bullet('Sentence-level sentiment with negation handling and emotion tags'),
    bullet('Cross-tabulation, hypothesis testing (t-test, ANOVA, chi-square, regression)'),
    bullet('13 chart types with drag-to-assign field mapping'),
    bullet('Bootstrap confidence intervals; 95% CI labeling on theme samples'),
    bullet('AI-generated executive summaries and recommendations'),
    bullet('Word cloud, comment browser with theme/sentiment filters, keyword highlighting'),
  ], { x: 0.6, y: 1.4, w: 12.1, h: 4.0 })
  s.addShape('rect', { x: 0.6, y: 5.6, w: 12.1, h: 1.1, fill: { color: DN.navy }, rectRadius: 0.1 })
  s.addText('Validated:', { x: 0.85, y: 5.65, w: 3, h: 0.35, fontSize: 11, fontFace: 'Arial', color: DN.gold, bold: true, charSpacing: 3 })
  s.addText('"Ana performed almost as well as the team of professors and outperformed the graduate student — in less than 5% of the time."', {
    x: 0.85, y: 5.95, w: 11.7, h: 0.5, fontSize: 13, fontFace: 'Arial', color: DN.white, italic: true,
  })
  s.addText('— Dr. Fevzi Okumus, UCF Rosen College', { x: 0.85, y: 6.3, w: 11.7, h: 0.3, fontSize: 10, fontFace: 'Arial', color: DN.sarinaBlue, align: 'right' })
}

function slideAILedIngestion(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'AI-Led Ingestion', 'Same LLM pipeline. Any source.')
  addFooter(s, pg)
  const sources = [
    { name: 'Facebook Pages + Instagram', detail: 'Meta Graph API · webhook + cron backstop' },
    { name: 'Google Reviews', detail: 'DataforSEO · 6-hour incremental sync per location' },
    { name: 'Reddit', detail: 'Thread + comment download per subreddit search' },
    { name: 'Substack', detail: 'Publication comment download per post' },
    { name: 'Regulations.gov', detail: 'Page-by-page regulatory comment ingest' },
    { name: 'File Upload', detail: 'CSV / XLSX / JSON · column mapping · deduplication' },
  ]
  sources.forEach((src, i) => {
    const col = i % 2, row = Math.floor(i / 2)
    const x = 0.6 + col * 6.15
    const y = 1.5 + row * 1.1
    s.addShape('rect', { x, y, w: 5.95, h: 0.95, fill: { color: DN.slateLight }, rectRadius: 0.08 })
    s.addShape('rect', { x, y, w: 0.15, h: 0.95, fill: { color: DN.sarinaBlue } })
    s.addText(src.name, { x: x + 0.3, y: y + 0.08, w: 5.55, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.navy, bold: true })
    s.addText(src.detail, { x: x + 0.3, y: y + 0.48, w: 5.55, h: 0.4, fontSize: 11, fontFace: 'Arial', color: DN.slate })
  })
  s.addShape('rect', { x: 0.6, y: 5.7, w: 12.1, h: 1.0, fill: { color: DN.navy }, rectRadius: 0.1 })
  s.addText('Every source flows into the same theme / sentiment / persona pipeline.', {
    x: 0.85, y: 5.8, w: 11.7, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.white, bold: true,
  })
  s.addText('One pipeline. Any input. Cannot be replicated by incumbents without rebuilding their data layer.', {
    x: 0.85, y: 6.2, w: 11.7, h: 0.4, fontSize: 12, fontFace: 'Arial', color: DN.gold, italic: true,
  })
}

function slideAILedReporting(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'AI-Led Reporting', 'Consulting-grade decks. Generated, not authored.')
  addFooter(s, pg)
  const tiers = [
    { name: 'Executive', count: '~10 slides', desc: 'KPI summary\nKey themes\nTop 3 actions', color: DN.sarinaBlue },
    { name: 'Stakeholder', count: '~25 slides', desc: 'Theme deep-dives\nSegment cuts\nStat significance\nRepresentative quotes', color: DN.teal },
    { name: 'Full Team', count: '50+ slides', desc: 'Every theme\nAll cross-tabs\nFull statistical analysis\nAppendix data', color: DN.navy },
  ]
  tiers.forEach((t, i) => {
    const x = 0.6 + i * 4.15
    s.addShape('rect', { x, y: 1.4, w: 3.85, h: 4.2, fill: { color: DN.slateLight }, rectRadius: 0.1 })
    s.addShape('rect', { x, y: 1.4, w: 3.85, h: 0.7, fill: { color: t.color }, rectRadius: 0.1 })
    s.addText(t.name, { x, y: 1.45, w: 3.85, h: 0.4, fontSize: 18, fontFace: 'Arial', color: DN.white, bold: true, align: 'center' })
    s.addText(t.count, { x, y: 1.85, w: 3.85, h: 0.25, fontSize: 11, fontFace: 'Arial', color: DN.white, italic: true, align: 'center' })
    s.addText(t.desc, { x: x + 0.25, y: 2.3, w: 3.45, h: 3.2, fontSize: 12, fontFace: 'Arial', color: DN.ink, lineSpacing: 22 })
  })
  s.addText([
    bullet('AI-selected representative quotes per theme', { fontSize: 12 }),
    bullet('Statistical significance labeling (p<.001, p<.01, p<.05)', { fontSize: 12 }),
    bullet('Auto-distribution charts, sentiment breakdowns, recommendations', { fontSize: 12 }),
    bullet('Plus interactive HTML share links, CSV / JSON / API exports', { fontSize: 12 }),
  ], { x: 0.6, y: 5.8, w: 12.1, h: 1.0 })
}

function slideAILedInfra(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'AI-Led Infrastructure', 'Built for white-label and multi-tenant migration from day one')
  addFooter(s, pg)
  s.addText([
    bullet('Org-scoped row-level security; per-org and per-user feature gating'),
    bullet('White-labeled survey, agent, and PulseIQ surfaces'),
    bullet('Feature flags per module (Analyze, Agents, Social, Google Reviews, Reddit, Substack)'),
    bullet('Usage accounting and cost attribution per org'),
    bullet('Public endpoints for surveys, agents, PulseIQ — no-auth, rate-limited'),
    bullet('Sentry monitoring; SOC 2 Type II posture in flight'),
  ], { x: 0.6, y: 1.4, w: 12.1, h: 4.0 })
  s.addShape('rect', { x: 0.6, y: 5.6, w: 12.1, h: 1.1, fill: { color: DN.navy }, rectRadius: 0.1 })
  s.addText('This is what makes acquired customers migratable in 90 days, not 18 months.', {
    x: 0.6, y: 5.6, w: 12.1, h: 1.1, fontSize: 16, fontFace: 'Arial', color: DN.gold, bold: true, italic: true, align: 'center', valign: 'middle',
  })
}

function slideProofPoints(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Proof Points', 'Five verticals. Named enterprise clients. Two product lines live.')
  addFooter(s, pg)

  const head = [
    { text: 'Vertical', options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
    { text: 'Anchor Clients', options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
    { text: 'Product Fit', options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
  ]
  const data = [
    ['Sports & Venues', 'Harlem Globetrotters, Orlando Magic', 'Sarina + Ana'],
    ['Hospitality', 'JW Marriott, Red Lobster, Orlando resorts', 'Sarina + Listening + Ana'],
    ['Education', 'UCF Rosen College', 'Sarina + PulseIQ'],
    ['Airports', 'MCO Airport', 'Sarina + Listening'],
    ['Political / Civic', 'Multiple voter research engagements', 'Sarina + Ana + Reg.gov'],
  ]
  const rows = [head, ...data.map((r, ri) => r.map((c, ci) => ({
    text: c,
    options: {
      fontSize: 11, fontFace: 'Arial',
      color: ci === 0 ? DN.navy : DN.ink,
      bold: ci === 0,
      fill: { color: ri % 2 === 0 ? DN.slateCard : DN.white },
    },
  })))]
  s.addTable(rows as any, { x: 0.6, y: 1.4, w: 12.1, colW: [3.0, 5.5, 3.6], border: { pt: 0.5, color: DN.slateLight }, rowH: 0.55 })

  s.addShape('rect', { x: 0.6, y: 5.4, w: 12.1, h: 1.3, fill: { color: DN.navy }, rectRadius: 0.1 })
  s.addText('HEADLINE METRICS', { x: 0.85, y: 5.5, w: 6, h: 0.3, fontSize: 11, fontFace: 'Arial', color: DN.gold, bold: true, charSpacing: 3 })
  s.addText('~10× response lift vs. email   ·   <5% of human-team analysis time   ·   5 verticals, 6 modules', {
    x: 0.85, y: 5.85, w: 11.7, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.white, bold: true,
  })
  s.addText('Already serving enterprise. No R&D risk for the LP.', {
    x: 0.85, y: 6.25, w: 11.7, h: 0.4, fontSize: 12, fontFace: 'Arial', color: DN.sarinaBlue, italic: true,
  })
}

function slideTargetArchetypes(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Target Archetypes', 'Four types of acquired company. Different roles in the portfolio.')
  addFooter(s, pg)
  const types = [
    { n: '1', tag: 'PRIMARY', name: 'Boutique qualitative MR firms', desc: '$1–8M revenue · founder-owned · 60%+ services labor cost · the platform margin lever lands hardest here', color: DN.sarinaBlue },
    { n: '2', tag: 'SECONDARY', name: 'Reputation / review monitoring agencies', desc: 'Manual reporting workflows ripe for automation · captive customer base · clean cross-sell of agents + listening', color: DN.teal },
    { n: '3', tag: 'TERTIARY', name: 'CX consultancies with retainer books', desc: 'Recurring revenue · captive customers · services-heavy delivery converts to platform pull-through', color: DN.hermesOrange },
    { n: '4', tag: 'PHASE 3 ONLY', name: 'SaaS tuck-ins', desc: 'Capability fill-in only (e.g., niche reputation tool) · NOT core thesis · do not lead the roll-up here', color: DN.slate },
  ]
  types.forEach((t, i) => {
    const y = 1.4 + i * 1.3
    s.addShape('ellipse', { x: 0.6, y: y + 0.15, w: 0.85, h: 0.85, fill: { color: t.color } })
    s.addText(t.n, { x: 0.6, y: y + 0.15, w: 0.85, h: 0.85, fontSize: 28, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
    s.addShape('rect', { x: 1.65, y, w: 11.15, h: 1.15, fill: { color: DN.slateLight }, rectRadius: 0.08 })
    s.addText(t.tag, { x: 1.85, y: y + 0.1, w: 3, h: 0.25, fontSize: 9, fontFace: 'Arial', color: t.color, bold: true, charSpacing: 3 })
    s.addText(t.name, { x: 1.85, y: y + 0.32, w: 11, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.navy, bold: true })
    s.addText(t.desc, { x: 1.85, y: y + 0.7, w: 10.7, h: 0.4, fontSize: 11, fontFace: 'Arial', color: DN.ink })
  })
}

function slideAcquisitionCriteria(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Acquisition Criteria', 'A clear, repeatable filter')
  addFooter(s, pg)

  // Buy column
  s.addShape('rect', { x: 0.6, y: 1.4, w: 5.95, h: 5.3, fill: { color: 'F0FDF4' }, rectRadius: 0.1 })
  s.addShape('rect', { x: 0.6, y: 1.4, w: 5.95, h: 0.5, fill: { color: DN.green }, rectRadius: 0.1 })
  s.addText('BUY IF', { x: 0.6, y: 1.4, w: 5.95, h: 0.5, fontSize: 14, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle', charSpacing: 4 })
  s.addText([
    bullet('$1–10M revenue, profitable', { fontSize: 12 }),
    bullet('Founder/family-owned (no VC overhang)', { fontSize: 12 }),
    bullet('Recurring contract revenue ≥ 60%', { fontSize: 12 }),
    bullet('Services labor ≥ 50% of cost base', { fontSize: 12 }),
    bullet('Customer churn < 10%', { fontSize: 12 }),
    bullet('Demonstrable domain expertise', { fontSize: 12 }),
    bullet('Owner ready to transition (12–24 mo earnout)', { fontSize: 12 }),
  ], { x: 0.85, y: 2.05, w: 5.5, h: 4.5 })

  // Skip column
  s.addShape('rect', { x: 6.85, y: 1.4, w: 5.95, h: 5.3, fill: { color: 'FEF2F2' }, rectRadius: 0.1 })
  s.addShape('rect', { x: 6.85, y: 1.4, w: 5.95, h: 0.5, fill: { color: DN.red }, rectRadius: 0.1 })
  s.addText('SKIP IF', { x: 6.85, y: 1.4, w: 5.95, h: 0.5, fontSize: 14, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle', charSpacing: 4 })
  s.addText([
    bullet('Pure SaaS at high ARR multiples', { fontSize: 12 }),
    bullet('Heavily VC-funded', { fontSize: 12 }),
    bullet('Customer concentration > 30%', { fontSize: 12 }),
    bullet('Custom dev shop without recurring base', { fontSize: 12 }),
    bullet('Heavy regulated-data without compliance posture', { fontSize: 12 }),
    bullet('Owner not ready to step away', { fontSize: 12 }),
    bullet('Geographic mismatch (Phase 1 = US only)', { fontSize: 12 }),
  ], { x: 7.1, y: 2.05, w: 5.5, h: 4.5 })
}

function slide90DayPlaybook(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, '90-Day Integration Playbook', 'Same playbook. Every deal.')
  addFooter(s, pg)
  const phases = [
    { range: 'Days 1–14', label: 'Plan', body: 'Customer mapping · contract review · data migration design · retention plan', color: DN.sarinaBlue },
    { range: 'Days 15–45', label: 'Migrate', body: 'Delivery workflow rebuilt on Sentimetrx · analyst training · first study migrated', color: DN.teal },
    { range: 'Days 30–60', label: 'Cutover', body: 'All active engagements moved to platform · legacy infra retired', color: DN.hermesOrange },
    { range: 'Days 60–90', label: 'Cross-Sell', body: 'Module cross-sell to existing book · benchmark data ingested into shared dataset', color: DN.gold },
    { range: 'Day 90', label: 'Measure', body: 'Before/after EBITDA, time-to-deck, gross-margin metrics published internally — feeds the next fundraise', color: DN.navy },
  ]
  phases.forEach((p, i) => {
    const y = 1.4 + i * 1.05
    s.addShape('rect', { x: 0.6, y, w: 2.4, h: 0.9, fill: { color: p.color }, rectRadius: 0.08 })
    s.addText(p.range, { x: 0.6, y: y + 0.1, w: 2.4, h: 0.4, fontSize: 11, fontFace: 'Arial', color: DN.white, italic: true, align: 'center' })
    s.addText(p.label, { x: 0.6, y: y + 0.4, w: 2.4, h: 0.45, fontSize: 18, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
    s.addShape('rect', { x: 3.1, y, w: 9.7, h: 0.9, fill: { color: DN.slateLight }, rectRadius: 0.08 })
    s.addText(p.body, { x: 3.35, y, w: 9.3, h: 0.9, fontSize: 12, fontFace: 'Arial', color: DN.ink, valign: 'middle' })
  })
}

function slidePortfolioProForma(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Portfolio Pro Forma', 'Five deals. Three years. The compounding effect.')
  addFooter(s, pg)
  const head = [
    { text: '', options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
    { text: 'Year 0', options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11, align: 'center' } },
    { text: 'Year 1', options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11, align: 'center' } },
    { text: 'Year 2', options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11, align: 'center' } },
    { text: 'Year 3', options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11, align: 'center' } },
  ]
  const data = [
    ['Deals closed (cum.)', '0', '2', '5', '8'],
    ['Combined revenue', '$0', '$7M', '$20M', '$35M'],
    ['Combined EBITDA', '$0', '$1.5M', '$7M', '$14M'],
    ['EBITDA margin', '—', '21%', '35%', '40%'],
    ['Capital deployed', '$1M', '$9M', '$30M', '$55M'],
  ]
  const rows = [head, ...data.map((r, ri) => r.map((c, ci) => ({
    text: c,
    options: {
      fontSize: 12, fontFace: 'Arial',
      color: ci === 0 ? DN.navy : ri === 2 ? DN.tealDark : DN.ink,
      bold: ci === 0 || ri === 2,
      fill: { color: ri === 2 ? DN.tealPale : ri % 2 === 0 ? DN.slateCard : DN.white },
      align: ci === 0 ? 'left' : 'center',
    },
  })))]
  s.addTable(rows as any, { x: 0.6, y: 1.4, w: 12.1, colW: [3.5, 2.15, 2.15, 2.15, 2.15], border: { pt: 0.5, color: DN.slateLight }, rowH: 0.55 })
  s.addShape('rect', { x: 0.6, y: 5.5, w: 12.1, h: 1.2, fill: { color: DN.navy }, rectRadius: 0.1 })
  s.addText('Year 5–6 exit at 10–12× EBITDA  →  $140–200M+ enterprise value', {
    x: 0.6, y: 5.5, w: 12.1, h: 1.2, fontSize: 18, fontFace: 'Arial', color: DN.gold, bold: true, align: 'center', valign: 'middle',
  })
}

function slideRisks(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Risks & Mitigations', "What could go wrong. How we have thought about it.")
  addFooter(s, pg)
  const head = [
    { text: 'Risk', options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
    { text: 'Mitigation', options: { fill: { color: DN.sarinaBlue }, color: DN.white, bold: true, fontSize: 11 } },
  ]
  const data = [
    ['LLM commoditization', 'Moat is workflow + proprietary benchmarks + domain IP — not the model'],
    ['Incumbent platform attack', 'Speed of M&A; AI-native architecture is hard to copy without rewrite'],
    ['Customer attrition during migration', '90-day playbook with retention plan; seller earnout aligned to retention'],
    ['Compliance (HIPAA, GDPR)', 'SOC 2 Type II in flight; healthcare deferred to Phase 3'],
    ['Customer concentration', 'Hospitality wedge backed by sports + political diversification'],
    ['Talent retention at acquired firms', 'Equity rollover + earnout; platform makes their work more valuable'],
  ]
  const rows = [head, ...data.map((r, ri) => r.map((c, ci) => ({
    text: c,
    options: {
      fontSize: 11, fontFace: 'Arial',
      color: ci === 0 ? DN.navy : DN.ink,
      bold: ci === 0,
      fill: { color: ri % 2 === 0 ? DN.slateCard : DN.white },
    },
  })))]
  s.addTable(rows as any, { x: 0.6, y: 1.4, w: 12.1, colW: [3.8, 8.3], border: { pt: 0.5, color: DN.slateLight }, rowH: 0.6 })
}

function slideTeam(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Team & Advisory', 'Built for execution. Hiring for scale.')
  addFooter(s, pg)
  // In place
  s.addShape('rect', { x: 0.6, y: 1.4, w: 5.95, h: 5.3, fill: { color: DN.slateLight }, rectRadius: 0.1 })
  s.addShape('rect', { x: 0.6, y: 1.4, w: 5.95, h: 0.5, fill: { color: DN.teal }, rectRadius: 0.1 })
  s.addText('IN PLACE', { x: 0.6, y: 1.4, w: 5.95, h: 0.5, fontSize: 14, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle', charSpacing: 4 })
  s.addText([
    bullet('Founder / CEO — product, AI, vertical expertise', { fontSize: 12 }),
    bullet('Platform engineering team', { fontSize: 12 }),
    bullet('Existing customer relationships across 5 verticals', { fontSize: 12 }),
    bullet('Reference customer pipeline (Marriott, Magic, Globetrotters, MCO)', { fontSize: 12 }),
  ], { x: 0.85, y: 2.05, w: 5.5, h: 4.5 })

  // Hiring
  s.addShape('rect', { x: 6.85, y: 1.4, w: 5.95, h: 5.3, fill: { color: DN.slateLight }, rectRadius: 0.1 })
  s.addShape('rect', { x: 6.85, y: 1.4, w: 5.95, h: 0.5, fill: { color: DN.hermesOrange }, rectRadius: 0.1 })
  s.addText('HIRING (PHASE 1)', { x: 6.85, y: 1.4, w: 5.95, h: 0.5, fontSize: 14, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle', charSpacing: 4 })
  s.addText([
    bullet('VP M&A / Corp Dev — sourcing & diligence', { fontSize: 12 }),
    bullet('Operating Partner — ex-MR / CX exec', { fontSize: 12 }),
    bullet('Head of Migration — owns 90-day playbook', { fontSize: 12 }),
    bullet('Board Chair — ex-Forsta / InMoment / Qualtrics', { fontSize: 12 }),
    bullet('Advisory: ex-CEOs of consolidated services / SaaS', { fontSize: 12 }),
  ], { x: 7.1, y: 2.05, w: 5.5, h: 4.5 })
}

function slideUseOfFunds(pptx: any, pg: number) {
  const s = pptx.addSlide()
  s.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.navy } })
  s.addShape('rect', { x: 0, y: 0, w: W, h: 0.07, fill: { color: DN.gold } })
  s.addShape('ellipse', { x: W - 4, y: -1, w: 5, h: 5, fill: { color: DN.teal, transparency: 90 }, line: { width: 0 } })

  s.addText('Use of Funds', { x: 0.8, y: 0.7, w: 11, h: 0.7, fontSize: 32, fontFace: 'Arial', color: DN.white, bold: true })
  s.addText('$10M Independent-Sponsor Vehicle  ·  18-month deployment', {
    x: 0.8, y: 1.45, w: 11, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.sarinaBlue, italic: true,
  })
  s.addShape('rect', { x: 0.8, y: 1.95, w: 4.5, h: 0.04, fill: { color: DN.gold } })

  const uses: [string, string, number][] = [
    ['Acquisition equity (3–4 deals at avg $1.5M)',         '$5.0M', 50],
    ['Sponsor team (VP M&A, Operating Partner)',            '$1.2M', 12],
    ['Migration & integration costs',                        '$0.8M', 8],
    ['Sourcing, legal, diligence',                           '$0.8M', 8],
    ['SOC 2 Type II audit + third-party pen-test',           '$0.4M', 4],
    ['Test suite + load / scalability testing battery',      '$0.3M', 3],
    ['AI observability (LangSmith integration + evals)',     '$0.1M', 1],
    ['Reserve',                                              '$1.4M', 14],
  ]
  const rowGap = 0.48
  uses.forEach(([label, amount, pct], i) => {
    const y = 2.3 + i * rowGap
    s.addText(label, { x: 0.8, y, w: 7.0, h: 0.42, fontSize: 12.5, fontFace: 'Arial', color: DN.white, valign: 'middle', autoFit: true })
    // bar
    s.addShape('rect', { x: 7.9, y: y + 0.09, w: 3.0, h: 0.24, fill: { color: DN.navyMid } })
    s.addShape('rect', { x: 7.9, y: y + 0.09, w: 3.0 * (pct / 50), h: 0.24, fill: { color: DN.sarinaBlue } })
    s.addText(amount, { x: 11.1, y, w: 1.5, h: 0.42, fontSize: 13, fontFace: 'Arial', color: DN.gold, bold: true, valign: 'middle', align: 'right' })
  })
  // total
  const totalY = 2.3 + uses.length * rowGap + 0.05
  s.addShape('rect', { x: 0.8, y: totalY, w: 11.5, h: 0.04, fill: { color: DN.gold } })
  s.addText('TOTAL', { x: 0.8, y: totalY + 0.1, w: 7, h: 0.5, fontSize: 16, fontFace: 'Arial', color: DN.gold, bold: true, charSpacing: 3 })
  s.addText('$10.0M', { x: 11.1, y: totalY + 0.1, w: 1.5, h: 0.5, fontSize: 22, fontFace: 'Arial', color: DN.white, bold: true, align: 'right' })

  s.addText('LP economics: Co-investment rights · 8% pref + 80/20 split · 4–6× MOIC over 5–7 years', {
    x: 0.8, y: totalY + 0.75, w: 11.5, h: 0.4, fontSize: 11, fontFace: 'Arial', color: DN.slate, italic: true,
  })
}

// ── Deck assemblers ────────────────────────────────────────────────────────
function buildShortDeck(pptx: any) {
  let pg = 0
  addTitleSlide(pptx,
    'The AI-Native Roll-up of\nCustomer Intelligence',
    'A consolidation play in the fragmented Voice-of-Customer market',
    'AI-led. Not AI-added.',
  )
  pg = 1
  slideOpportunity(pptx, ++pg)
  slideOrigin(pptx, ++pg)
  slideBeforeAfter(pptx, ++pg)
  slideAILedVsAdded(pptx, ++pg)
  slideCompetitive(pptx, ++pg)
  slideWhatWeBuilt(pptx, ++pg)
  slideWedge(pptx, ++pg)
  slidePlaybook(pptx, ++pg)
  slideMath(pptx, ++pg)
  slidePhasing(pptx, ++pg, true)
  slideWhyUs(pptx, ++pg)
  slideExit(pptx, ++pg)
}

function buildLongDeck(pptx: any) {
  let pg = 0
  addTitleSlide(pptx,
    'The AI-Native Roll-up of\nCustomer Intelligence',
    'Investor diligence deck — Phase 1 independent-sponsor raise',
    'AI-led. Not AI-added.',
  )
  pg = 1
  slideExecSummary(pptx, ++pg)
  slideMarket(pptx, ++pg)
  slideWhyNow(pptx, ++pg)
  slideOrigin(pptx, ++pg)
  slideBeforeAfter(pptx, ++pg)
  slideAILedVsAdded(pptx, ++pg)
  slideIncumbentFragility(pptx, ++pg)
  slideCompetitive(pptx, ++pg)
  slideWhatWeBuilt(pptx, ++pg)
  slideAILedCollection(pptx, ++pg)
  slideAILedAnalysis(pptx, ++pg)
  slideAILedIngestion(pptx, ++pg)
  slideAILedReporting(pptx, ++pg)
  slideAILedInfra(pptx, ++pg)
  slideProofPoints(pptx, ++pg)
  slideWedge(pptx, ++pg)
  slideTargetArchetypes(pptx, ++pg)
  slideAcquisitionCriteria(pptx, ++pg)
  slide90DayPlaybook(pptx, ++pg)
  slideMath(pptx, ++pg)
  slidePortfolioProForma(pptx, ++pg)
  slidePhasing(pptx, ++pg, false)
  slideRisks(pptx, ++pg)
  slideTeam(pptx, ++pg)
  slideExit(pptx, ++pg)
  slideUseOfFunds(pptx, ++pg)
}

// ── Route handler ──────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const url = new URL(req.url)
  const length = (url.searchParams.get('length') || 'short').toLowerCase()
  const isLong = length === 'long' || length === 'full'
  await logDeckDownload('rollup-deck', isLong ? 'long' : 'short')

  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Datanautix'
  pptx.company = 'Datanautix'
  pptx.title = isLong
    ? 'Datanautix — AI-Native Roll-up (Diligence Deck)'
    : 'Datanautix — AI-Native Roll-up (Pitch Deck)'

  if (isLong) buildLongDeck(pptx)
  else buildShortDeck(pptx)

  const buffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer
  const uint8 = new Uint8Array(buffer)

  const filename = isLong ? 'Datanautix-Rollup-Diligence.pptx' : 'Datanautix-Rollup-Pitch.pptx'
  return new NextResponse(uint8, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
