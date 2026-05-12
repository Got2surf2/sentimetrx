// GET /api/restaurant-expansion-deck — customer-facing expansion deck for
// existing Ana clients in the restaurant industry.
//
// PRESENTER-LED design discipline: each slide is a handhold, not a document.
// Titles carry the message; bodies stay short; full talk track lives in
// PPT Speaker Notes (visible in Presenter View, hidden from the audience).

import { NextResponse, type NextRequest } from 'next/server'
import PptxGenJS from 'pptxgenjs'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { logDeckDownload } from '@/lib/auth/logDeckDownload'

export const dynamic = 'force-dynamic'

const CLIENTS: Record<string, { name: string; slug: string }> = {
  darden:  { name: 'Darden',           slug: 'Darden' },
  bloomin: { name: "Bloomin' Brands",  slug: 'BlominBrands' },
}

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
  amber:        'D97706',
  amberLight:   'FEF3C7',
  purple:       '6D28D9',
}

const W = 13.33
const H = 7.5

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function addHeader(slide: any, title: string) {
  // Lighter than the dense decks: no subtitle line, more white space below
  slide.addShape('rect', { x: 0, y: 0, w: W, h: 1.0, fill: { color: DN.navy } })
  slide.addText(title, {
    x: 0.6, y: 0.15, w: 10.0, h: 0.7,
    fontSize: 26, fontFace: 'Arial', color: DN.white, bold: true, valign: 'middle',
  })
  slide.addText([
    { text: 'data', options: { color: DN.hermesOrange, bold: true, italic: true } },
    { text: 'nautix', options: { color: DN.sarinaBlue, bold: true, italic: true } },
  ], { x: W - 2.4, y: 0.2, w: 2.0, h: 0.5, fontSize: 16, fontFace: 'Arial', valign: 'middle', align: 'right' })
  slide.addShape('rect', { x: 0, y: 1.0, w: W, h: 0.04, fill: { color: DN.sarinaBlue } })
}

function addFooter(slide: any, pageNum: number) {
  slide.addText('Datanautix · for client discussion · Confidential', {
    x: 0.5, y: H - 0.4, w: 10, h: 0.3, fontSize: 9, fontFace: 'Arial', color: DN.slate,
  })
  slide.addText(`${pageNum}`, {
    x: W - 1, y: H - 0.4, w: 0.5, h: 0.3, fontSize: 9, fontFace: 'Arial', color: DN.slate, align: 'right',
  })
}

// ── Cover ──────────────────────────────────────────────────────────────────
function addTitleSlide(pptx: any, clientName: string) {
  const s = pptx.addSlide()
  const downloaded = fmtDate(new Date())

  s.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.navy } })
  s.addShape('ellipse', { x: W - 4.5, y: -1.5, w: 5.5, h: 5.5, fill: { color: DN.teal, transparency: 88 }, line: { width: 0 } })
  s.addShape('ellipse', { x: W - 3.0, y: 0.5, w: 3.5, h: 3.5, fill: { color: DN.sarinaBlue, transparency: 92 }, line: { width: 0 } })
  s.addShape('rect', { x: 0, y: 0, w: W, h: 0.07, fill: { color: DN.gold } })

  s.addText('DATANAUTIX', { x: 0.8, y: 1.6, w: 11, h: 0.5, fontSize: 16, fontFace: 'Arial', color: DN.gold, bold: true, charSpacing: 2 })
  s.addText('Beyond Text Analytics', { x: 0.8, y: 2.4, w: 11, h: 1.0, fontSize: 48, fontFace: 'Arial', color: DN.white, bold: true })
  s.addShape('rect', { x: 0.8, y: 3.6, w: 4.5, h: 0.05, fill: { color: DN.gold } })
  s.addText(`for ${clientName}`, { x: 0.8, y: 3.75, w: 11, h: 0.7, fontSize: 28, fontFace: 'Arial', color: DN.sarinaBlue, italic: true })
  s.addText(downloaded, { x: 0.8, y: 5.4, w: 11, h: 0.35, fontSize: 12, fontFace: 'Arial', color: DN.slate, italic: true })

  s.addShape('rect', { x: 0, y: H - 0.5, w: W, h: 0.5, fill: { color: DN.navyMid } })
  s.addText([
    { text: 'data', options: { color: DN.hermesOrange, bold: true, italic: true } },
    { text: 'nautix', options: { color: DN.sarinaBlue, bold: true, italic: true } },
    { text: `   ·   Prepared for ${clientName}   ·   Confidential`, options: { color: DN.slate } },
  ], { x: 0.6, y: H - 0.45, w: 12, h: 0.4, fontSize: 12, fontFace: 'Arial', valign: 'middle' })

  s.addNotes(
`Open warmly. This is a partner conversation, not a vendor pitch.

Frame the next 20–30 minutes: "We've been thinking about how to extend the value you already get from Ana. Over the last 9 weeks we've built five new modules around it. I want to walk through what's possible — and propose a small pilot."

Then go to the next slide.`
  )
}

// ── 1. You already use Ana ────────────────────────────────────────────────
function slideWhereWeStarted(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'You already use Ana.')
  addFooter(s, pg)

  // Big centered Ana box
  s.addShape('rect', { x: 3.5, y: 2.0, w: 6.3, h: 2.3, fill: { color: DN.sarinaBlue }, rectRadius: 0.15, line: { color: DN.gold, width: 3 } })
  s.addText('Ana', { x: 3.5, y: 2.1, w: 6.3, h: 1.0, fontSize: 64, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
  s.addText('AI text analytics — themes, sentiment, decks', {
    x: 3.5, y: 3.2, w: 6.3, h: 0.5, fontSize: 16, fontFace: 'Arial', color: DN.white, italic: true, align: 'center',
  })
  s.addText('what you trust us for', {
    x: 3.5, y: 3.7, w: 6.3, h: 0.4, fontSize: 13, fontFace: 'Arial', color: DN.gold, bold: true, align: 'center', charSpacing: 2,
  })

  // Bottom strap
  s.addText("That hasn't changed.", {
    x: 0.5, y: 5.1, w: 12.3, h: 0.6, fontSize: 28, fontFace: 'Arial', color: DN.navy, bold: true, italic: true, align: 'center',
  })
  s.addText("What has changed is what feeds it.", {
    x: 0.5, y: 5.8, w: 12.3, h: 0.5, fontSize: 18, fontFace: 'Arial', color: DN.slate, align: 'center',
  })

  s.addNotes(
`The point of this slide is reassurance. They've invested time and people in Ana — themes, dashboards, the way their team reads sentiment. None of that goes away.

Stay here for 20 seconds. Don't sell. Just acknowledge:
- "You've been using Ana for large-scale text analytics."
- "The engine, the theme model, the chart suite, the way you export decks — all of that stays exactly as you know it."

Then pivot: "What's changed is the data that feeds Ana." Click to next slide.`
  )
}

// ── 2. Six modules ─────────────────────────────────────────────────────────
function slidePlatformToday(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Six modules. One platform.')
  addFooter(s, pg)

  type Mod = { name: string; tag: string; status: 'have' | 'new'; color: string }
  const mods: Mod[] = [
    { name: 'Ana',        tag: 'Text analytics',            status: 'have', color: DN.sarinaBlue },
    { name: 'Sarina',     tag: 'Conversational surveys',     status: 'new',  color: DN.teal },
    { name: 'Agents',     tag: 'Public AI conversations',    status: 'new',  color: DN.hermesOrange },
    { name: 'PulseIQ',    tag: 'Live group feedback',        status: 'new',  color: DN.gold },
    { name: 'Listening',  tag: 'Multi-source ingest',        status: 'new',  color: DN.purple },
    { name: 'Campaigns',  tag: 'Email + SMS',                status: 'new',  color: DN.navy },
  ]
  mods.forEach((m, i) => {
    const col = i % 3, row = Math.floor(i / 3)
    const x = 0.55 + col * 4.13
    const y = 1.5 + row * 2.6
    s.addShape('rect', { x, y, w: 4.0, h: 2.35, fill: { color: DN.slateCard }, rectRadius: 0.1 })
    s.addShape('rect', { x, y, w: 4.0, h: 0.85, fill: { color: m.color }, rectRadius: 0.1 })
    s.addText(m.name, { x: x + 0.2, y, w: 3.6, h: 0.85, fontSize: 32, fontFace: 'Arial', color: DN.white, bold: true, valign: 'middle' })

    // status badge — top right corner
    const badgeText = m.status === 'have' ? 'YOU HAVE' : 'NEW'
    const badgeBg = m.status === 'have' ? DN.gold : DN.white
    const badgeColor = m.status === 'have' ? DN.navy : m.color
    s.addShape('rect', { x: x + 2.7, y: y + 0.22, w: 1.15, h: 0.36, fill: { color: badgeBg }, rectRadius: 0.04 })
    s.addText(badgeText, { x: x + 2.7, y: y + 0.22, w: 1.15, h: 0.36, fontSize: 10, fontFace: 'Arial', color: badgeColor, bold: true, align: 'center', valign: 'middle', charSpacing: 2 })

    s.addText(m.tag, { x: x + 0.2, y: y + 1.05, w: 3.6, h: 1.2, fontSize: 18, fontFace: 'Arial', color: DN.ink, valign: 'top', autoFit: true })
  })

  s.addNotes(
`This is the map of the conversation. Walk through it once: "Ana you already have. The other five are new — and they all feed Ana."

Don't dwell here. Each module gets its own slide. Just orient them on what's coming.

Pause on the colors: sarinaBlue Ana = the centerpiece. The rest orbit it.`
  )
}

// ── 2.5 With or without AI ─────────────────────────────────────────────────
function slideWithWithoutAI(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Available with or without AI.')
  addFooter(s, pg)

  // 6 columns, each with two stacked boxes (without / with AI)
  const modules = [
    { name: 'Sarina',     without: 'Forms · branching · QR / NFC · manual translation',          withAI: 'Real-time clarifiers · adaptive flow · auto-translate' },
    { name: 'Agents',     without: 'Scripted FAQ · decision trees',                              withAI: 'RAG retrieval · drift review · safety' },
    { name: 'PulseIQ',    without: 'Manual moderation · structured Q&A',                         withAI: 'AI moderation · real-time topic detection' },
    { name: 'Listening',  without: 'Reviews + social + Reddit ingest · keyword filters',         withAI: 'Theme + sentiment + intent extraction' },
    { name: 'Campaigns',  without: 'Scheduling · merge tags · webhook tracking',                 withAI: 'AI personalization · smart send timing' },
    { name: 'Ana',        without: 'Charts · statistics · hypothesis tests · dashboards',        withAI: 'Theme mining · AI summaries · quote selection' },
  ]

  const cardW = 2.0
  const startX = 0.55
  const gap = 0.08

  modules.forEach((m, i) => {
    const x = startX + i * (cardW + gap)

    // Module name header
    s.addShape('rect', { x, y: 1.4, w: cardW, h: 0.55, fill: { color: DN.navy }, rectRadius: 0.06 })
    s.addText(m.name, { x, y: 1.4, w: cardW, h: 0.55, fontSize: 14, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle', autoFit: true })

    // WITHOUT AI box (drab grey)
    s.addShape('rect', { x, y: 2.05, w: cardW, h: 2.05, fill: { color: 'F2F2F2' }, rectRadius: 0.06 })
    s.addShape('rect', { x, y: 2.05, w: cardW, h: 0.35, fill: { color: '6B7280' }, rectRadius: 0.06 })
    s.addText('WITHOUT AI', { x, y: 2.05, w: cardW, h: 0.35, fontSize: 9, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle', charSpacing: 2 })
    s.addText(m.without, { x: x + 0.1, y: 2.45, w: cardW - 0.2, h: 1.6, fontSize: 10, fontFace: 'Arial', color: '4B5563', valign: 'top', lineSpacing: 14, autoFit: true })

    // WITH AI box (branded teal)
    s.addShape('rect', { x, y: 4.2, w: cardW, h: 2.05, fill: { color: DN.tealPale }, rectRadius: 0.06 })
    s.addShape('rect', { x, y: 4.2, w: cardW, h: 0.35, fill: { color: DN.teal }, rectRadius: 0.06 })
    s.addText('WITH AI', { x, y: 4.2, w: cardW, h: 0.35, fontSize: 9, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle', charSpacing: 2 })
    s.addText(m.withAI, { x: x + 0.1, y: 4.6, w: cardW - 0.2, h: 1.6, fontSize: 10, fontFace: 'Arial', color: DN.navy, bold: true, valign: 'top', lineSpacing: 14, autoFit: true })
  })

  s.addText('You choose what to switch on.', {
    x: 0.5, y: 6.5, w: 12.3, h: 0.5, fontSize: 18, fontFace: 'Arial', color: DN.navy, bold: true, italic: true, align: 'center',
  })

  s.addNotes(
`The capability map. Every module is useful WITHOUT AI — and gets sharper with AI on. Walk it column by column at a high level; let the slide do the work.

SARINA: even without AI, you have a modern survey platform — branching forms, QR/NFC capture, manual translation. Switch AI on and you get real-time clarifiers, adaptive flow, auto-translate.

AGENTS: without AI, scripted FAQ trees (cheaper but limited). With AI, true RAG agents trained on your menu, with safety + drift review.

PULSEIQ: without AI, manually-moderated live Q&A. With AI, hundreds of concurrent conversations moderated automatically with real-time topic detection.

LISTENING: the ingestion pipelines (Google Reviews, social, Reddit, regulatory) work without AI — you just get raw data with keyword filters. AI on = theme + sentiment + intent extraction.

CAMPAIGNS: without AI, modern email/SMS orchestration (scheduling, merge tags, tracking). With AI, per-recipient personalization and smart send timing.

ANA: this is the one you ALREADY have. Without AI: charts, statistics, hypothesis tests. With AI: theme mining, AI summaries, quote selection — that's what you've been using.

THE POINT: You don't have to flip everything on at once. Pick what fits your policy and your AI posture. Add more later.

That's the lead-in to the next slide — which addresses "and even when AI is on, whose AI is it?"`
  )
}

// ── 2.6 AI-agnostic ────────────────────────────────────────────────────────
function slideAIAgnostic(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'AI-agnostic. Bring your own.')
  addFooter(s, pg)

  // Four big options
  const options = [
    { tag: 'DEFAULT',    title: 'Our Anthropic + OpenAI setup',  body: 'Plug-and-play · no procurement · production-ready',   color: DN.sarinaBlue },
    { tag: 'YOUR PROVIDER', title: 'Anthropic · OpenAI · Azure · Bedrock · Gemini', body: 'Route AI calls through your existing enterprise contract', color: DN.teal },
    { tag: 'BYOK',       title: 'Your API keys',                  body: 'Spend lands on your bill · your governance · your audit trail', color: DN.hermesOrange },
    { tag: 'YOUR GATEWAY', title: 'Your internal AI gateway',     body: 'Already running LangSmith / LiteLLM / a custom proxy? Point us at it.', color: DN.gold },
  ]
  options.forEach((opt, i) => {
    const col = i % 2, row = Math.floor(i / 2)
    const x = 0.5 + col * 6.2
    const y = 1.4 + row * 1.85
    s.addShape('rect', { x, y, w: 6.05, h: 1.6, fill: { color: DN.slateCard }, rectRadius: 0.1 })
    s.addShape('rect', { x, y, w: 0.18, h: 1.6, fill: { color: opt.color } })
    s.addText(opt.tag, { x: x + 0.35, y: y + 0.12, w: 5, h: 0.3, fontSize: 10, fontFace: 'Arial', color: opt.color, bold: true, charSpacing: 3 })
    s.addText(opt.title, { x: x + 0.35, y: y + 0.4, w: 5.6, h: 0.45, fontSize: 16, fontFace: 'Arial', color: DN.navy, bold: true, valign: 'middle', autoFit: true })
    s.addText(opt.body, { x: x + 0.35, y: y + 0.9, w: 5.6, h: 0.65, fontSize: 11, fontFace: 'Arial', color: DN.ink, italic: true, valign: 'top', autoFit: true })
  })

  // Bottom contrast strap
  s.addShape('rect', { x: 0.5, y: 5.3, w: 12.3, h: 1.5, fill: { color: DN.navy }, rectRadius: 0.1 })
  s.addShape('rect', { x: 0.5, y: 5.3, w: 0.2, h: 1.5, fill: { color: DN.gold } })
  s.addText('THE CONTRAST', { x: 0.85, y: 5.4, w: 6, h: 0.3, fontSize: 10, fontFace: 'Arial', color: DN.gold, bold: true, charSpacing: 3 })
  s.addText('Qualtrics, Medallia, Forsta = locked into their AI. Their model, their keys, their data path.', {
    x: 0.85, y: 5.7, w: 12.0, h: 0.5, fontSize: 14, fontFace: 'Arial', color: DN.white, bold: true,
  })
  s.addText('You bring your AI to the table — we run on it.', {
    x: 0.85, y: 6.25, w: 12.0, h: 0.45, fontSize: 14, fontFace: 'Arial', color: DN.sarinaBlue, italic: true, bold: true,
  })

  s.addNotes(
`The procurement-and-governance slide. Land this hard if their CIO/IT or CISO is in the room.

Four ways the AI layer can be configured:

DEFAULT — our Anthropic + OpenAI setup. Plug-and-play. No procurement work on your side. Fastest to start.

YOUR PROVIDER — if your team already has an enterprise contract with Anthropic, OpenAI, Azure OpenAI, AWS Bedrock, or Google Gemini, we route AI calls through that. You keep your existing relationship, pricing, and governance.

BYOK (Bring Your Own Key) — API keys live on your side. Spend lands on your bill. Your governance team controls usage. Your audit trail.

YOUR GATEWAY — if you already run an internal AI gateway (LangSmith, LiteLLM, a custom proxy for data residency or PII redaction), point us at it. We don't care what's behind it.

WHY THIS MATTERS:
- Compliance: your data path stays under your control.
- Cost: you can negotiate AI rates better than we ever could.
- Lock-in: zero. Switch providers without switching platforms.

THE CONTRAST (bottom strap, land hard):
"Qualtrics, Medallia, Forsta are locked into their AI. Their model, their keys, their data path."
"You bring your AI to the table — we run on it."

That's the differentiator for any enterprise IT/legal team that has policies on AI providers.`
  )
}

// ── 3. Why now ─────────────────────────────────────────────────────────────
function slideWhyNow(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Three things changed at once.')
  addFooter(s, pg)

  const forces = [
    { n: '1', title: 'Surveys are dying',           color: DN.sarinaBlue },
    { n: '2', title: 'Guests want answers now',     color: DN.teal },
    { n: '3', title: 'AI made conversation viable', color: DN.hermesOrange },
  ]
  forces.forEach((f, i) => {
    const x = 0.6 + i * 4.13
    const y = 2.0
    s.addShape('ellipse', { x: x + 1.65, y, w: 0.7, h: 0.7, fill: { color: f.color } })
    s.addText(f.n, { x: x + 1.65, y, w: 0.7, h: 0.7, fontSize: 26, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
    s.addText(f.title, { x, y: y + 1.0, w: 4.0, h: 2.0, fontSize: 22, fontFace: 'Arial', color: DN.navy, bold: true, align: 'center', valign: 'top', autoFit: true })
  })

  // Bottom strap
  s.addShape('rect', { x: 0.5, y: 6.0, w: 12.3, h: 0.85, fill: { color: DN.slateCard }, rectRadius: 0.08 })
  s.addText('You have the analytics. We can now help you ask the right questions in the moment.', {
    x: 0.5, y: 6.0, w: 12.3, h: 0.85, fontSize: 15, fontFace: 'Arial', color: DN.navy, italic: true, bold: true, align: 'center', valign: 'middle',
  })

  s.addNotes(
`Three forces, in your own words:

1. SURVEYS ARE DYING. Single-digit response rates. Guests won't fill out post-visit emails anymore. They'll tell a person — or an AI — but they won't tell a form.

2. GUESTS WANT ANSWERS NOW. They expect a brand that can answer dietary questions, parking questions, hours, dress code instantly. Host stands and call lines don't scale to that.

3. AI MADE CONVERSATION VIABLE. For the first time, a survey can ask "what made the wait feel long?" in the MOMENT — not mine "it was OK" in a report a month later.

Land on the bottom strap: "You already have the analytics. What you've been missing is a way to ask better questions at the moment of experience."`
  )
}

// ── 4. Sarina ──────────────────────────────────────────────────────────────
function slideSarina(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Sarina — ask better questions in the moment.')
  addFooter(s, pg)

  // The headline stat — dominate the slide
  s.addText('10×', {
    x: 0.5, y: 1.8, w: 6.0, h: 2.6, fontSize: 200, fontFace: 'Arial', color: DN.sarinaBlue, bold: true, align: 'center', valign: 'middle',
  })
  s.addText('more responses than email surveys', {
    x: 0.5, y: 4.5, w: 6.0, h: 0.6, fontSize: 18, fontFace: 'Arial', color: DN.slate, italic: true, align: 'center',
  })

  // Three short labels on the right
  const labels = [
    { t: 'In-venue capture',     d: 'QR · NFC · post-visit link' },
    { t: 'AI clarifiers',         d: '"It was fine" → "what made it fine?"' },
    { t: 'Multi-language',        d: 'Spanish · Mandarin · Portuguese · more' },
  ]
  labels.forEach((l, i) => {
    const y = 1.8 + i * 1.3
    s.addShape('rect', { x: 7.0, y, w: 5.8, h: 1.1, fill: { color: DN.slateCard }, rectRadius: 0.08 })
    s.addShape('rect', { x: 7.0, y, w: 0.13, h: 1.1, fill: { color: DN.teal } })
    s.addText(l.t, { x: 7.25, y: y + 0.12, w: 5.5, h: 0.4, fontSize: 18, fontFace: 'Arial', color: DN.navy, bold: true })
    s.addText(l.d, { x: 7.25, y: y + 0.55, w: 5.5, h: 0.45, fontSize: 12, fontFace: 'Arial', color: DN.slate, italic: true })
  })

  s.addText('All of it lands in Ana. No new dashboard.', {
    x: 0.5, y: 6.4, w: 12.3, h: 0.5, fontSize: 15, fontFace: 'Arial', color: DN.navy, bold: true, italic: true, align: 'center',
  })

  s.addNotes(
`Lead with the 10x number. Let it sit.

"That's the headline. JW Marriott and a few hospitality clients — Sarina gets about 10 times the responses they get from email surveys. Because guests will talk in the moment when they won't fill a form an hour later."

Then walk the three labels on the right:

- IN-VENUE CAPTURE: QR on the receipt, NFC tap at the host stand, optional post-visit email. Whatever fits the moment.
- AI CLARIFIERS: this is the magic. A weak answer doesn't get filed away. The AI probes. "It was fine" gets "what made it fine?" "The wait was too long" gets "how long, and what did you think the wait was for?"
- MULTI-LANGUAGE: guests respond in their native language. Analysis comes back to your team in English — one report.

Close: "All of it lands in Ana. No new dashboard. Same theme model, same charts you already use."

OPTIONAL service-recovery talking point if it comes up:
"A low score or named complaint can trigger an automatic follow-up survey 48 hours later. You close the loop without flagging it manually."`
  )
}

// ── 5. Agents ──────────────────────────────────────────────────────────────
function slideAgents(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Agents — trained on your menu. Your voice.')
  addFooter(s, pg)

  const useCases = [
    { name: 'Menu & dietary',    color: DN.sarinaBlue },
    { name: 'Reservation FAQ',   color: DN.teal },
    { name: 'Catering & events', color: DN.hermesOrange },
    { name: 'Wine & pairing',    color: DN.gold },
    { name: 'Loyalty + rewards', color: DN.purple },
    { name: 'Service recovery',  color: DN.navy },
  ]
  useCases.forEach((uc, i) => {
    const col = i % 3, row = Math.floor(i / 3)
    const x = 0.5 + col * 4.2
    const y = 1.6 + row * 2.4
    s.addShape('rect', { x, y, w: 4.0, h: 2.0, fill: { color: uc.color }, rectRadius: 0.1 })
    s.addText(uc.name, { x: x + 0.15, y, w: 3.7, h: 2.0, fontSize: 22, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle', autoFit: true })
  })

  s.addText('Every conversation flows back into Ana.', {
    x: 0.5, y: 6.6, w: 12.3, h: 0.4, fontSize: 15, fontFace: 'Arial', color: DN.navy, italic: true, bold: true, align: 'center',
  })

  s.addNotes(
`These are six examples — not exhaustive. Trained on your data: your menu, your policies, your brand voice.

Walk them quickly:

- MENU & DIETARY: allergens, vegan, gluten-free, kids menu, ingredient sourcing, seasonal availability.
- RESERVATION FAQ: dress code, parking, accessibility, large parties, holiday hours, cancellation rules.
- CATERING & EVENTS: off-site catering, private dining minimums, custom requests.
- WINE & PAIRING: trained on your wine list and chef pairings, price-anchored suggestions, vintage availability.
- LOYALTY + REWARDS: program tier explanations, point lookups, benefits, upcoming offers.
- SERVICE RECOVERY: acknowledges complaints, routes to a manager, captures details for follow-up.

The KEY point at the end: "Every conversation is captured. Themes and sentiment land in Ana — so you learn what guests are asking your brand, not just what they're saying about it."

OPTIONAL safety talking point if asked:
"Off-topic deflection, 3-strike profanity rules, sensitive-topic avoidance. Stays in your brand voice."`
  )
}

// ── 6. PulseIQ ─────────────────────────────────────────────────────────────
function slidePulseIQ(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'PulseIQ — many concurrent conversations, one AI moderator.')
  addFooter(s, pg)

  // Big visual concept: many bubbles converging
  // Many small ellipses (participants)
  for (let i = 0; i < 14; i++) {
    const cx = 1.0 + (i % 7) * 1.0 + (Math.floor(i / 7) === 0 ? 0 : 0.5)
    const cy = 1.7 + Math.floor(i / 7) * 0.8
    s.addShape('ellipse', { x: cx, y: cy, w: 0.55, h: 0.55, fill: { color: DN.sarinaBlue, transparency: 30 }, line: { width: 0 } })
  }

  // Arrow pointing down to themes
  s.addText('↓', { x: 0.5, y: 3.4, w: 12.3, h: 0.5, fontSize: 32, fontFace: 'Arial', color: DN.slate, align: 'center' })

  // Themes box
  s.addShape('rect', { x: 2.5, y: 4.1, w: 8.3, h: 1.1, fill: { color: DN.navy }, rectRadius: 0.1, line: { color: DN.gold, width: 2 } })
  s.addText('Themes emerge live', { x: 2.5, y: 4.1, w: 8.3, h: 0.6, fontSize: 22, fontFace: 'Arial', color: DN.gold, bold: true, align: 'center', valign: 'middle' })
  s.addText('on a facilitator dashboard · while people are still talking', {
    x: 2.5, y: 4.65, w: 8.3, h: 0.45, fontSize: 13, fontFace: 'Arial', color: DN.white, italic: true, align: 'center',
  })

  // Three short use cases
  const uses = ['Chef tastings', 'Menu launches', 'Location openings']
  uses.forEach((u, i) => {
    const x = 0.5 + i * 4.2
    s.addText(u, { x, y: 5.7, w: 4.0, h: 0.5, fontSize: 17, fontFace: 'Arial', color: DN.navy, bold: true, align: 'center' })
  })

  s.addNotes(
`Visualise it for them: imagine 50, 100, 200 guests at a chef's table or a brand event, each having their own one-on-one conversation with an AI moderator. Different topics, different threads.

The magic is the dashboard. A facilitator (a member of your team, or me, or no one if you want fully autonomous) sees what's trending in real time. Topics emerging. Sentiment shifting. Where people are dropping off.

Three restaurant moments where this lands:
- CHEF TASTINGS / new menu tastings.
- MENU LAUNCHES across many locations on the same night.
- LOCATION OPENINGS — capture the first night's experience, themes by close.

Tagline: "What used to take a focus group and a 3-week readout now happens during the event, with the executive summary on the screen by close."`
  )
}

// ── 7. Listening ───────────────────────────────────────────────────────────
function slideListening(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Listening — one pipeline, every channel.')
  addFooter(s, pg)

  const sources = [
    'Google Reviews',
    'Facebook + Instagram',
    'Reddit',
    'Internal CRM',
    'Survey verbatims',
    'CSV / XLSX uploads',
  ]
  sources.forEach((src, i) => {
    const col = i % 3, row = Math.floor(i / 3)
    const x = 0.6 + col * 4.13
    const y = 1.5 + row * 1.5
    s.addShape('rect', { x, y, w: 4.0, h: 1.3, fill: { color: DN.slateCard }, rectRadius: 0.08, line: { color: DN.slateLight, width: 1 } })
    s.addText(src, { x: x + 0.1, y, w: 3.8, h: 1.3, fontSize: 18, fontFace: 'Arial', color: DN.navy, bold: true, align: 'center', valign: 'middle', autoFit: true })
  })

  s.addShape('rect', { x: 0.5, y: 6.0, w: 12.3, h: 0.95, fill: { color: DN.navy }, rectRadius: 0.08 })
  s.addShape('rect', { x: 0.5, y: 6.0, w: 0.18, h: 0.95, fill: { color: DN.gold } })
  s.addText('Every channel feeds the same theme model.', {
    x: 0.85, y: 6.0, w: 12.0, h: 0.95, fontSize: 16, fontFace: 'Arial', color: DN.gold, bold: true, italic: true, valign: 'middle',
  })

  s.addNotes(
`These are the channels we ingest today. Cover them quickly — the audience knows what each one is.

Detail to weave in (don't read off):
- GOOGLE REVIEWS: continuous sync across all locations, 6-hour cadence, new reviews land in Ana same-day.
- FACEBOOK + INSTAGRAM: page comments, post engagement, named-mention triggering.
- REDDIT: city-specific food subreddits, food-critic communities — useful for launch week chatter.
- INTERNAL CRM: service-recovery cases, manager escalations, complaint history.
- SURVEY VERBATIMS: Sarina + anything legacy you keep running.
- CSV / XLSX: mystery shopper reports, internal audits, focus group transcripts.

THE PAYOFF (land this hard): "Every channel feeds the same theme model. When a 'long wait' theme spikes in Google Reviews, you see it on the same dashboard where the Sarina surveys at that location ALREADY show it. You catch the pattern before it spreads."`
  )
}

// ── 8. Campaigns ───────────────────────────────────────────────────────────
function slideCampaigns(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Campaigns — close the loop.')
  addFooter(s, pg)

  const items = [
    { t: 'Post-visit follow-up',      c: DN.sarinaBlue },
    { t: 'Loyalty re-engagement',     c: DN.teal },
    { t: 'Service recovery outreach', c: DN.hermesOrange },
  ]
  items.forEach((it, i) => {
    const y = 1.8 + i * 1.4
    s.addShape('rect', { x: 1.5, y, w: 10.3, h: 1.2, fill: { color: it.c }, rectRadius: 0.1 })
    s.addText(it.t, { x: 1.5, y, w: 10.3, h: 1.2, fontSize: 26, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
  })

  s.addText('Same platform. Same dataset. Measured end-to-end.', {
    x: 0.5, y: 6.5, w: 12.3, h: 0.4, fontSize: 15, fontFace: 'Arial', color: DN.navy, italic: true, bold: true, align: 'center',
  })

  s.addNotes(
`Three use cases. Cover them in 60 seconds.

- POST-VISIT FOLLOW-UP: trigger Sarina survey after the table closes; auto-reminders at 72 hours and 7 days for non-responders. No Mailchimp required.

- LOYALTY RE-ENGAGEMENT: a guest who hasn't visited in 60 days gets a personalised message that references their last visit — server name, dish, anything you tracked.

- SERVICE RECOVERY: a low-score guest or named complaint gets a manager-signed apology with a recovery offer. Open rate, click rate, return-visit rate all measured.

If they ask about providers: "Resend, SendGrid, AWS SES, SMTP, Twilio SMS — pluggable, fits your deliverability setup."

The close: "Same platform that captured the feedback closes the loop. You stop guessing which campaign moved which theme."`
  )
}

// ── 9. It all rolls into Ana ───────────────────────────────────────────────
function slideItAllRollsIntoAna(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'It all rolls into Ana.')
  addFooter(s, pg)

  // 5 source boxes — minimal labels
  const sources = [
    { label: 'Sarina',     color: DN.teal },
    { label: 'Agents',     color: DN.hermesOrange },
    { label: 'PulseIQ',    color: DN.gold },
    { label: 'Listening',  color: DN.purple },
    { label: 'Campaigns',  color: DN.navy },
  ]
  sources.forEach((src, i) => {
    const x = 0.5 + i * 2.55
    const y = 1.5
    s.addShape('rect', { x, y, w: 2.4, h: 1.3, fill: { color: src.color }, rectRadius: 0.08 })
    s.addText(src.label, { x, y, w: 2.4, h: 1.3, fontSize: 22, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
  })

  // Big arrows
  s.addText('↓   ↓   ↓   ↓   ↓', {
    x: 0.5, y: 3.0, w: 12.3, h: 0.5, fontSize: 28, fontFace: 'Arial', color: DN.slate, align: 'center',
  })

  // Ana — big, gold-bordered
  s.addShape('rect', { x: 2.5, y: 3.8, w: 8.3, h: 2.0, fill: { color: DN.sarinaBlue }, rectRadius: 0.15, line: { color: DN.gold, width: 4 } })
  s.addText('Ana', { x: 2.5, y: 3.9, w: 8.3, h: 1.2, fontSize: 54, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
  s.addText('the dashboard you already use', { x: 2.5, y: 5.1, w: 8.3, h: 0.5, fontSize: 16, fontFace: 'Arial', color: DN.gold, bold: true, italic: true, align: 'center' })

  s.addText('No new dashboard. No migration. One theme model across every channel.', {
    x: 0.5, y: 6.4, w: 12.3, h: 0.5, fontSize: 14, fontFace: 'Arial', color: DN.navy, bold: true, italic: true, align: 'center',
  })

  s.addNotes(
`This is the linchpin slide. The whole story.

Five new collection / outreach modules. All feeding the one analytics engine you already use.

What this means in practice — say it clearly:
"A 'long wait' theme is visible on ONE dashboard whether it surfaced in a post-visit Sarina survey, an Agent conversation, a Google Review, or a Reddit post. You see cross-channel patterns instantly. Cross-location benchmarking happens without stitching exports together."

Pause. Let them ask the obvious question: "What does it cost us to add this?"

That's the next slide.`
  )
}

// ── 10. Proposed pilot ─────────────────────────────────────────────────────
function slidePilot(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, '90 days. 5–10 locations. Decide together.')
  addFooter(s, pg)

  const phases = [
    { week: '2 weeks', focus: 'Setup',  color: DN.sarinaBlue },
    { week: '6 weeks', focus: 'Run',    color: DN.teal },
    { week: '4 weeks', focus: 'Decide', color: DN.hermesOrange },
  ]
  phases.forEach((p, i) => {
    const x = 0.6 + i * 4.13
    const y = 1.7
    s.addShape('rect', { x, y, w: 4.0, h: 3.0, fill: { color: p.color }, rectRadius: 0.12 })
    s.addText(p.week, { x, y: y + 0.4, w: 4.0, h: 0.5, fontSize: 18, fontFace: 'Arial', color: DN.white, italic: true, align: 'center' })
    s.addText(p.focus, { x, y: y + 1.0, w: 4.0, h: 1.3, fontSize: 56, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
  })

  s.addShape('rect', { x: 0.5, y: 5.4, w: 12.3, h: 1.5, fill: { color: DN.navy }, rectRadius: 0.1 })
  s.addShape('rect', { x: 0.5, y: 5.4, w: 0.2, h: 1.5, fill: { color: DN.gold } })
  s.addText('NEXT STEP', { x: 0.85, y: 5.55, w: 6, h: 0.35, fontSize: 11, fontFace: 'Arial', color: DN.gold, bold: true, charSpacing: 3 })
  s.addText('Pick 5–10 pilot locations.', {
    x: 0.85, y: 5.95, w: 12.0, h: 0.55, fontSize: 26, fontFace: 'Arial', color: DN.white, bold: true,
  })
  s.addText('We stand up the pilot in 2 weeks. Your team sees results inside 3.', {
    x: 0.85, y: 6.5, w: 12.0, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.sarinaBlue, italic: true,
  })

  s.addNotes(
`Close the meeting on a concrete ask. Don't end with "let me know what you think." End with a specific decision they can make this week.

Walk the three phases:

- 2 WEEKS — SETUP. Configure pilot locations, tune Sarina to your brand, train one Agent on current menu and policies, turn on Google Reviews sync for the pilot footprint.

- 6 WEEKS — RUN. Live collection across surveys, agents, and listening. Weekly Ana readouts to your team. Campaign follow-ups on low-score visits. One PulseIQ session (chef tasting or a staff event) as a showcase.

- 4 WEEKS — DECIDE. Side-by-side comparison: response rate, theme depth, time-to-insight, service-recovery rate vs your current process. Joint decision on the full rollout footprint.

THE ASK: "Pick 5–10 pilot locations. Share your current menu, policies, and a representative dataset. We stand up the pilot in 2 weeks. Your team sees results inside 3."

Stop talking. Wait for their response.`
  )
}

// ── Deck assembler ─────────────────────────────────────────────────────────
function buildDeck(pptx: any, clientName: string) {
  let pg = 0
  addTitleSlide(pptx, clientName)
  pg = 1
  slideWhereWeStarted(pptx, ++pg)
  slidePlatformToday(pptx, ++pg)
  slideWithWithoutAI(pptx, ++pg)
  slideAIAgnostic(pptx, ++pg)
  slideWhyNow(pptx, ++pg)
  slideSarina(pptx, ++pg)
  slideAgents(pptx, ++pg)
  slidePulseIQ(pptx, ++pg)
  slideListening(pptx, ++pg)
  slideCampaigns(pptx, ++pg)
  slideItAllRollsIntoAna(pptx, ++pg)
  slidePilot(pptx, ++pg)
}

// ── Route handler ──────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const url = new URL(req.url)
  const clientParam = (url.searchParams.get('client') || '').toLowerCase()
  const client = CLIENTS[clientParam] ?? { name: '[CLIENT NAME]', slug: 'Generic' }
  await logDeckDownload('restaurant-expansion-deck', clientParam || 'generic')

  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Datanautix'
  pptx.company = 'Datanautix'
  pptx.title = `Datanautix — Restaurant Expansion · ${client.name}`

  buildDeck(pptx, client.name)

  const buffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer
  const uint8 = new Uint8Array(buffer)

  return new NextResponse(uint8, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="Datanautix-Restaurant-Expansion-${client.slug}.pptx"`,
    },
  })
}
