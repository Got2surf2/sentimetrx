// lib/pptx/mcoListeningDeck.ts
// "Listening to Your Guests" — a guest-experience intelligence program for
// Orlando International Airport (MCO). A high-level teaser / leave-behind that
// recaps the 2015–2020 engagement and outlines a path forward: continuous
// voice-of-guest analytics, peer benchmarking, and the agentic MCO Concierge
// prototype.
//
// Datanautix-branded (the consulting brand that delivers), co-branded with the
// MCO sunburst mark. Builds a PptxGenJS instance in place so both the API route
// and a local QC harness can share one builder.
//
// Appendix slides marked "ILLUSTRATIVE" are sample output FORMATS, not real MCO
// data — by design, per the no-fabricated-data rule. The two benchmarking
// appendix slides are built to be swapped with real review data when supplied.

import type PptxGenJS from 'pptxgenjs'
import { MCO_LOGO_DATA_URI } from './mcoLogo'

const W = 13.33
const H = 7.5

// Logo native aspect ratio (275 x 120 → h = w * 0.4364)
const LOGO_AR = 120 / 275

const C = {
  navy:      '0A2540', // MCO deep blue (matches the agent header)
  navy2:     '0D2B45',
  teal:      '0F7173',
  tealMid:   '3FA9B0',
  tealLight: 'E2F1F2',
  orange:    'EF8B1E', // MCO sunburst
  amber:     'F59E0B', // MCO accent
  gold:      'F2B705',
  white:     'FFFFFF',
  slate:     '8FA3AE',
  slateCard: 'F4F7F8',
  ink:       '111827',
  mid:       '374151',
  faint:     '9CA3AF',
  green:     '059669',
  red:       'DC2626',
  // Pre-computed tints (pptxgenjs dropped 8-digit hex)
  tealTint:   'E5F1F1',
  orangeTint: 'FCEBD8',
  amberTint:  'FEF3DC',
}

/** White co-brand chip with the MCO mark, sized to the logo aspect ratio.
 *  The mark PNG has a white background, so it must sit on a white surface. */
function mcoMark(slide: any, x: number, y: number, logoW: number, pad = 0.1) {
  const logoH = logoW * LOGO_AR
  const chipW = logoW + pad * 2
  const chipH = logoH + pad * 2
  slide.addShape('roundRect', { x, y, w: chipW, h: chipH, rectRadius: 0.06, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
  slide.addImage({ data: MCO_LOGO_DATA_URI, x: x + pad, y: y + pad, w: logoW, h: logoH })
  return { chipW, chipH }
}

function wordmark(slide: any) {
  slide.addText(
    [
      { text: 'data',   options: { color: '4DBFC1', bold: true, italic: true } },
      { text: 'nautix', options: { color: 'F07040', bold: true, italic: true } },
    ],
    { x: W - 2.4, y: 0.15, w: 2.2, h: 0.7, fontSize: 15, valign: 'middle', align: 'right' }
  )
}

function hdr(slide: any, title: string, sub?: string) {
  slide.addShape('rect', { x: 0, y: 0, w: W, h: 1.1, fill: { color: C.navy } })
  // Co-brand MCO mark, far left on a white chip
  mcoMark(slide, 0.34, 0.3, 0.62)
  slide.addShape('rect', { x: 0, y: 1.1, w: W, h: 0.04, fill: { color: C.gold } })
  slide.addText(title, { x: 1.5, y: 0.1, w: 9.0, h: sub ? 0.56 : 0.9, fontSize: 26, fontFace: 'Arial', color: C.white, bold: true, valign: sub ? 'bottom' : 'middle' })
  if (sub) slide.addText(sub, { x: 1.5, y: 0.66, w: 9.6, h: 0.36, fontSize: 12.5, fontFace: 'Arial', color: C.tealMid })
  wordmark(slide)
}

function ftr(slide: any, n: number) {
  slide.addText('datanautix.com  ·  Prepared for Orlando International Airport (MCO)', { x: 0.5, y: H - 0.36, w: 8, h: 0.26, fontSize: 8, color: C.faint, fontFace: 'Arial' })
  slide.addText('Confidential', { x: W / 2 - 1.5, y: H - 0.36, w: 3, h: 0.26, fontSize: 8, color: C.faint, fontFace: 'Arial', align: 'center' })
  slide.addText(String(n), { x: W - 0.9, y: H - 0.36, w: 0.4, h: 0.26, fontSize: 8, color: C.faint, fontFace: 'Arial', align: 'right' })
}

function card(slide: any, x: number, y: number, w: number, h: number, title: string, body: string, accent = C.teal) {
  slide.addShape('roundRect', { x, y, w, h, rectRadius: 0.1, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
  slide.addShape('rect', { x, y, w: 0.06, h, fill: { color: accent } })
  slide.addText(title, { x: x + 0.22, y: y + 0.12, w: w - 0.38, h: 0.42, fontSize: 15, fontFace: 'Arial', color: C.navy, bold: true })
  slide.addText(body, { x: x + 0.22, y: y + 0.58, w: w - 0.38, h: h - 0.72, fontSize: 12.5, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.4 })
}

/** Small amber "illustrative" badge for appendix sample slides. */
function illuBadge(slide: any, x = 0.5, y = 1.22) {
  slide.addShape('roundRect', { x, y, w: 5.7, h: 0.34, rectRadius: 0.05, fill: { color: C.amberTint }, line: { color: C.amber, width: 0.6 } })
  slide.addText('ILLUSTRATIVE EXAMPLE — sample output format, not MCO data', {
    x: x + 0.1, y, w: 5.5, h: 0.34, fontSize: 9.5, fontFace: 'Arial', color: 'B45309', bold: true, valign: 'middle', charSpacing: 0.5,
  })
}

/** Horizontal sentiment bar: positive (green) / neutral (slate) / negative (red) split. */
function sentimentRow(slide: any, x: number, y: number, w: number, label: string, pos: number, neu: number, neg: number, mention: string) {
  slide.addText(label, { x, y, w: 2.55, h: 0.34, fontSize: 11, fontFace: 'Arial', color: C.navy, bold: true, valign: 'middle' })
  const barX = x + 2.65
  const barW = w - 2.65 - 0.95
  slide.addShape('rect', { x: barX, y: y + 0.04, w: barW * (pos / 100), h: 0.26, fill: { color: C.green }, line: { width: 0 } })
  slide.addShape('rect', { x: barX + barW * (pos / 100), y: y + 0.04, w: barW * (neu / 100), h: 0.26, fill: { color: 'CBD5E1' }, line: { width: 0 } })
  slide.addShape('rect', { x: barX + barW * ((pos + neu) / 100), y: y + 0.04, w: barW * (neg / 100), h: 0.26, fill: { color: C.red }, line: { width: 0 } })
  slide.addText(mention, { x: x + w - 0.9, y, w: 0.9, h: 0.34, fontSize: 9.5, fontFace: 'Arial', color: C.faint, align: 'right', valign: 'middle' })
}

/** Grouped comparison bar (MCO vs peer set) for the benchmarking appendix. */
function compareRow(slide: any, x: number, y: number, w: number, label: string, mco: number, peer: number) {
  slide.addText(label, { x, y, w: 2.9, h: 0.5, fontSize: 11, fontFace: 'Arial', color: C.navy, bold: true, valign: 'middle' })
  const barX = x + 3.0
  const barW = w - 3.0 - 0.05
  const maxScore = 5
  slide.addShape('rect', { x: barX, y: y + 0.02, w: barW * (mco / maxScore), h: 0.2, fill: { color: C.orange }, line: { width: 0 } })
  slide.addText(mco.toFixed(1), { x: barX + barW * (mco / maxScore) + 0.05, y: y - 0.02, w: 0.5, h: 0.24, fontSize: 9, fontFace: 'Arial', color: C.orange, bold: true, valign: 'middle' })
  slide.addShape('rect', { x: barX, y: y + 0.27, w: barW * (peer / maxScore), h: 0.2, fill: { color: C.teal }, line: { width: 0 } })
  slide.addText(peer.toFixed(1), { x: barX + barW * (peer / maxScore) + 0.05, y: y + 0.23, w: 0.5, h: 0.24, fontSize: 9, fontFace: 'Arial', color: C.teal, bold: true, valign: 'middle' })
}

export function buildMcoListeningDeck(pptx: PptxGenJS): void {
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Datanautix'
  pptx.company = 'Datanautix'
  pptx.title = 'Listening to Your Guests — MCO Guest Experience Intelligence'
  let p = 0

  // ═══ SLIDE 1: Title ═══
  const s1 = pptx.addSlide()
  s1.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.navy } })
  s1.addShape('rect', { x: 0, y: 0, w: 0.22, h: H, fill: { color: C.amber } })
  s1.addShape('rect', { x: 0, y: 4.55, w: W, h: 0.05, fill: { color: C.gold } })
  mcoMark(s1, 0.9, 0.7, 1.7, 0.14)
  s1.addText('Listening to Your Guests', { x: 0.9, y: 2.0, w: 11.6, h: 1.2, fontSize: 54, fontFace: 'Arial', color: C.white, bold: true })
  s1.addText('A Guest Experience Intelligence program for Orlando International Airport', {
    x: 0.9, y: 3.25, w: 11.6, h: 1.1, fontSize: 24, fontFace: 'Arial', color: C.amber, wrap: true, lineSpacingMultiple: 1.3,
  })
  s1.addText('From mining what guests already tell you — to an always-on listening system, world-class peer benchmarking, and an agentic concierge that helps travelers and learns from every conversation.', {
    x: 0.9, y: 4.75, w: 11.6, h: 1.1, fontSize: 14, fontFace: 'Arial', color: C.slate, wrap: true, lineSpacingMultiple: 1.5,
  })
  wordmark(s1)
  s1.addText('Prepared for Orlando International Airport  ·  Greater Orlando Aviation Authority', { x: 0.9, y: H - 1.1, w: 11, h: 0.32, fontSize: 13, fontFace: 'Arial', color: C.white })
  s1.addText(new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), { x: 0.9, y: H - 0.72, w: 5, h: 0.32, fontSize: 12, fontFace: 'Arial', color: C.slate })
  s1.addNotes(
    'Open warm: "Thank you for the 30 minutes. We put together a short read-ahead your stakeholders can flip through. ' +
    'The headline is simple — Datanautix worked with MCO for five years on guest experience, the tooling has leapt forward since, and we\'d love to show your team what world-class listening looks like now." ' +
    'This deck is a teaser. The goal is the next meeting, not a decision.'
  )

  // ═══ SLIDE 2: We know this airport ═══
  p++
  const s2 = pptx.addSlide()
  s2.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s2, 'We already know this airport', 'A five-year guest-experience partnership — and a toolkit that has leapt forward since')
  ftr(s2, p)

  s2.addShape('roundRect', { x: 0.5, y: 1.3, w: 12.33, h: 1.0, rectRadius: 0.1, fill: { color: C.navy }, line: { width: 0 } })
  s2.addText('From 2015 to 2020, Datanautix ran ongoing guest-experience analytics for MCO. The engagement paused with COVID — but everything we learned about this airport, and the way travelers talk about it, is still ours to build on.', {
    x: 0.7, y: 1.34, w: 11.9, h: 0.92, fontSize: 14, fontFace: 'Arial', color: C.white, valign: 'middle', wrap: true, lineSpacingMultiple: 1.45,
  })

  const ka = [
    { title: '2015 – 2020', body: 'Continuous guest-experience analysis across four listening channels — website feedback, social media, peer benchmarking, and on-demand studies.', accent: C.teal },
    { title: 'Paused at COVID', body: 'The program wound down when air travel collapsed in 2020. The relationship — and the institutional knowledge — didn\'t go anywhere.', accent: C.orange },
    { title: 'A different toolkit now', body: 'What took weeks of manual coding then now happens continuously. AI reads every open-ended comment like an analyst — and can talk back to guests in real time.', accent: C.amber },
  ]
  ka.forEach(function (k, i) {
    card(s2, 0.5 + i * 4.13, 2.55, 3.9, 4.4, k.title, k.body, k.accent)
  })
  s2.addNotes(
    'This slide establishes credibility and re-opens the door. We are not a cold vendor — we have five years of context on MCO. ' +
    'The third card is the pivot: the reason to talk again is that the capability has fundamentally changed since 2020.'
  )

  // ═══ SLIDE 3: What we did 2015–2020 ═══
  p++
  const s3 = pptx.addSlide()
  s3.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s3, 'What we did, 2015 – 2020', 'Four listening channels, one analytical engine — mining open-ended guest voice for themes and patterns')
  ftr(s3, p)

  const channels = [
    { title: 'Website feedback', body: 'Ongoing analysis of the guest feedback submitted through the airport website — open-ended comments mined for recurring themes and emerging issues.', accent: C.teal },
    { title: 'Social media listening', body: 'Social commentary about MCO, sourced from Sprout Social, themed and tracked over time so spikes and sentiment shifts surfaced early.', accent: C.orange },
    { title: 'Quarterly peer benchmarking', body: 'Structured comparison against a peer group of domestic and international airports, built from Google reviews and other public sources.', accent: C.amber },
    { title: 'On-demand guest studies', body: 'Targeted guest-experience research run on request — to pressure-test a specific question or decision when leadership needed an answer.', accent: C.teal },
  ]
  channels.forEach(function (ch, i) {
    const col = i % 2
    const row = Math.floor(i / 2)
    card(s3, 0.5 + col * 6.2, 1.32 + row * 2.18, 5.95, 2.0, ch.title, ch.body, ch.accent)
  })

  s3.addShape('roundRect', { x: 0.5, y: 5.75, w: 12.33, h: 1.1, rectRadius: 0.1, fill: { color: C.tealTint }, line: { color: C.tealMid, width: 0.6 } })
  s3.addText('The engine underneath: text analytics', { x: 0.7, y: 5.82, w: 5, h: 0.34, fontSize: 12, fontFace: 'Arial', color: C.teal, bold: true })
  s3.addText('Across all four channels, we used text analytics to mine open-ended content — the comments, posts, and reviews most programs throw away — and turn them into themes, patterns, and trends leadership could act on.', {
    x: 0.7, y: 6.16, w: 11.9, h: 0.64, fontSize: 12, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.35,
  })
  s3.addNotes(
    'Walk the four channels quickly — they will recognize them. Then land on the engine: text analytics on open-ended voice was the differentiator then, and it is the foundation of everything that follows in this deck.'
  )

  // ═══ SLIDE 4: The methodology centerpiece ═══
  p++
  const s4 = pptx.addSlide()
  s4.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s4, 'A world-class "Listening to Your Guests" method', 'Five moves, run continuously — not a quarterly report, a living system')
  ftr(s4, p)

  const loop = [
    { n: '1', title: 'Capture', body: 'Every channel a guest speaks — surveys, website, social, reviews, in-terminal, and the concierge itself.', accent: C.teal },
    { n: '2', title: 'Understand', body: 'AI reads every open-ended comment — themes, sentiment, drivers, and the entities (gates, vendors, checkpoints) behind them.', accent: C.orange },
    { n: '3', title: 'Benchmark', body: 'Continuously, against the world\'s best airports — where MCO leads, and where peers are pulling ahead.', accent: C.amber },
    { n: '4', title: 'Act', body: 'Route the right signal to the right team — operations, concessions, facilities — with the quote and the location attached.', accent: C.teal },
    { n: '5', title: 'Close the loop', body: 'Watch the metric move after the fix. Prove the change worked, or try again. The system never stops listening.', accent: C.orange },
  ]
  const lw = 2.36, lg = 0.12
  loop.forEach(function (m, i) {
    const x = 0.5 + i * (lw + lg)
    s4.addShape('roundRect', { x, y: 1.5, w: lw, h: 5.0, rectRadius: 0.12, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
    s4.addShape('rect', { x, y: 1.5, w: lw, h: 0.7, fill: { color: m.accent }, line: { width: 0 } })
    s4.addShape('ellipse', { x: x + lw / 2 - 0.3, y: 1.85, w: 0.6, h: 0.6, fill: { color: C.white }, line: { color: m.accent, width: 1.5 } })
    s4.addText(m.n, { x: x + lw / 2 - 0.3, y: 1.85, w: 0.6, h: 0.6, fontSize: 22, fontFace: 'Arial', color: m.accent, bold: true, align: 'center', valign: 'middle' })
    s4.addText(m.title, { x, y: 2.55, w: lw, h: 0.5, fontSize: 17, fontFace: 'Arial', color: C.navy, bold: true, align: 'center' })
    s4.addText(m.body, { x: x + 0.2, y: 3.1, w: lw - 0.4, h: 3.2, fontSize: 11.5, fontFace: 'Arial', color: C.mid, align: 'center', wrap: true, lineSpacingMultiple: 1.4 })
    if (i < loop.length - 1) {
      s4.addText('▶', { x: x + lw + lg / 2 - 0.06, y: 1.78, w: 0.2, h: 0.3, fontSize: 13, fontFace: 'Arial', color: C.faint, align: 'center' })
    }
  })
  s4.addText('Continuous — every loop feeds the next. "Listening" stops being a survey you send and becomes a sense the airport always has.', {
    x: 0.5, y: 6.62, w: 12.33, h: 0.35, fontSize: 12, fontFace: 'Arial', color: C.navy, italic: true, align: 'center',
  })
  s4.addNotes(
    'This is the centerpiece — the slide their stakeholders will remember. The point is the shift from "quarterly report" to "living system." ' +
    'Capture → Understand → Benchmark → Act → Close the loop, running continuously. Everything else in the deck plugs into one of these five moves.'
  )

  // ═══ SLIDE 5: Every place a guest speaks ═══
  p++
  const s5 = pptx.addSlide()
  s5.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s5, 'Every place a guest speaks — one surface', 'Capture, unified: the channels you run today plus the ones modern listening adds')
  ftr(s5, p)

  const surfaces = [
    { title: 'Surveys & website', body: 'Post-trip surveys and the website feedback form — themed automatically, no manual coding.', accent: C.teal },
    { title: 'Social media', body: 'Public commentary across platforms (e.g. via Sprout Social), tracked for sentiment and spikes.', accent: C.orange },
    { title: 'Online reviews', body: 'Google and travel-site reviews — for MCO and for the peer airports you benchmark against.', accent: C.amber },
    { title: 'In-terminal capture', body: 'QR codes and kiosks at the moment and place of the experience — a gate, a restroom, a checkpoint.', accent: C.teal },
    { title: 'The MCO Concierge', body: 'Every question a traveler asks the agent is a signal: what confuses people, where they get stuck, what they want.', accent: C.orange },
    { title: 'Staff & operations', body: 'Frontline and ops notes folded into the same themes, so the guest voice and the operational reality line up.', accent: C.amber },
  ]
  surfaces.forEach(function (s, i) {
    const col = i % 3
    const row = Math.floor(i / 3)
    const x = 0.5 + col * 4.13
    const y = 1.4 + row * 2.55
    s5.addShape('roundRect', { x, y, w: 3.9, h: 2.35, rectRadius: 0.1, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
    s5.addShape('rect', { x, y, w: 3.9, h: 0.45, fill: { color: s.accent }, line: { width: 0 } })
    s5.addText(s.title, { x: x + 0.18, y, w: 3.55, h: 0.45, fontSize: 13.5, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle' })
    s5.addText(s.body, { x: x + 0.18, y: y + 0.58, w: 3.55, h: 1.6, fontSize: 11.5, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.4 })
  })
  s5.addNotes(
    'The pitch: you already collect a lot of this — it just lives in separate tools and separate reports. ' +
    'The win is one surface where every guest voice lands and is themed the same way. The last two cards (concierge + staff) are channels most airports do not yet treat as listening surfaces.'
  )

  // ═══ SLIDE 6: From comments to meaning ═══
  p++
  const s6 = pptx.addSlide()
  s6.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s6, 'From open-ended comments to meaning', 'What modern text analytics pulls out of free-text guest voice — automatically, at scale')
  ftr(s6, p)

  const analytics = [
    { title: 'Themes', body: 'The recurring topics guests raise — security wait, wayfinding, dining value, restroom cleanliness — discovered from the data, not pre-guessed.', accent: C.teal },
    { title: 'Sentiment & drivers', body: 'Not just "positive vs negative," but what is actually driving each theme up or down, and which themes move the overall rating most.', accent: C.orange },
    { title: 'Entities', body: 'The specific gates, terminals, checkpoints, and vendors named in comments — so a complaint maps to a place and an owner.', accent: C.amber },
    { title: 'Trends & alerts', body: 'A new issue surfacing this week, a sentiment dip at a checkpoint, an emerging theme nobody preloaded — flagged early, not at quarter-end.', accent: C.teal },
  ]
  analytics.forEach(function (a, i) {
    const col = i % 2
    const row = Math.floor(i / 2)
    card(s6, 0.5 + col * 6.2, 1.4 + row * 2.6, 5.95, 2.4, a.title, a.body, a.accent)
  })
  s6.addNotes(
    'Keep this conceptual — the appendix has an illustrative dashboard if they want to see the shape of it. ' +
    'The key idea: open-ended comments are the richest and most-ignored data an airport has. We turn them into themes, drivers, entities, and early-warning trends.'
  )

  // ═══ SLIDE 7: Benchmark against the world's best ═══
  p++
  const s7 = pptx.addSlide()
  s7.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s7, 'Benchmark against the world\'s best airports', 'Your quarterly peer comparison — reimagined as a continuous, public-data feed')
  ftr(s7, p)

  s7.addShape('roundRect', { x: 0.5, y: 1.3, w: 12.33, h: 0.95, rectRadius: 0.1, fill: { color: C.navy }, line: { width: 0 } })
  s7.addText('We pull live public reviews for a peer set you choose — domestic hubs (ATL, DFW, DEN, LAX) and global benchmarks (SIN Changi, ICN, DXB, AMS) — and theme them the same way we theme MCO. Two questions, answered continuously:', {
    x: 0.7, y: 1.34, w: 11.9, h: 0.88, fontSize: 12.5, fontFace: 'Arial', color: C.white, valign: 'middle', wrap: true, lineSpacingMultiple: 1.4,
  })

  s7.addShape('roundRect', { x: 0.5, y: 2.5, w: 6.05, h: 4.4, rectRadius: 0.12, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
  s7.addShape('rect', { x: 0.5, y: 2.5, w: 6.05, h: 0.6, fill: { color: C.green }, line: { width: 0 } })
  s7.addText('WHERE MCO LEADS', { x: 0.7, y: 2.5, w: 5.7, h: 0.6, fontSize: 13, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle', charSpacing: 2 })
  s7.addText(
    'The dimensions where guests rate MCO above the peer set — your proof points, on the record, kept current.\n\n' +
    '· Defend your strengths with evidence\n' +
    '· Spotlight wins for stakeholders and tenants\n' +
    '· Catch a strength slipping before it costs you',
    { x: 0.72, y: 3.25, w: 5.6, h: 3.5, fontSize: 12.5, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.5 }
  )

  s7.addShape('roundRect', { x: 6.78, y: 2.5, w: 6.05, h: 4.4, rectRadius: 0.12, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
  s7.addShape('rect', { x: 6.78, y: 2.5, w: 6.05, h: 0.6, fill: { color: C.orange }, line: { width: 0 } })
  s7.addText('WHAT MCO CAN LEARN', { x: 6.98, y: 2.5, w: 5.7, h: 0.6, fontSize: 13, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle', charSpacing: 2 })
  s7.addText(
    'The dimensions where a peer is pulling ahead — and the specific things guests praise them for.\n\n' +
    '· See exactly what travelers love elsewhere\n' +
    '· Borrow proven ideas, skip the guesswork\n' +
    '· Prioritize the gaps that move guest rating most',
    { x: 7.0, y: 3.25, w: 5.6, h: 3.5, fontSize: 12.5, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.5 }
  )
  s7.addNotes(
    'They already do quarterly peer benchmarking — this reframes it as continuous and public-data-driven, and crucially as two-sided: celebrate strengths AND import what peers do better. ' +
    'The appendix has illustrative versions of both views; offer to rebuild them on their real peer set with live reviews.'
  )

  // ═══ SLIDE 8: The leap — agentic technology ═══
  p++
  const s8 = pptx.addSlide()
  s8.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.navy } })
  s8.addShape('rect', { x: 0, y: 0, w: 0.22, h: H, fill: { color: C.amber } })
  s8.addText('The biggest change since 2020:', { x: 0.9, y: 1.5, w: 11.5, h: 0.6, fontSize: 22, fontFace: 'Arial', color: C.tealMid })
  s8.addText('guests can now\ntalk to the airport.', { x: 0.9, y: 2.15, w: 11.5, h: 1.9, fontSize: 48, fontFace: 'Arial', color: C.white, bold: true, lineSpacingMultiple: 1.1 })
  s8.addText('Agentic technology turns listening into a two-way channel. The airport doesn\'t just collect feedback after the trip — it helps the traveler in the moment, and learns from every question they ask. We built a working prototype for MCO to show exactly what that looks like.', {
    x: 0.9, y: 4.4, w: 11.3, h: 1.6, fontSize: 16, fontFace: 'Arial', color: C.slate, wrap: true, lineSpacingMultiple: 1.5,
  })
  wordmark(s8)
  s8.addNotes(
    'A breath slide — slow down. The frame: text analytics (slides 3–7) is the listening foundation. Agentic tech is the leap — listening becomes a conversation. Then reveal the prototype.'
  )

  // ═══ SLIDE 9: Meet the MCO Concierge ═══
  p++
  const s9 = pptx.addSlide()
  s9.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s9, 'Meet the MCO Concierge — a working prototype', 'A conversational guide that answers in plain language and shows the right map, list, or status beside it')
  ftr(s9, p)

  // Left: who/what
  s9.addShape('roundRect', { x: 0.5, y: 1.3, w: 5.0, h: 5.6, rectRadius: 0.12, fill: { color: C.navy }, line: { width: 0 } })
  mcoMark(s9, 0.72, 1.5, 1.0)
  s9.addText('"Ana, the MCO Concierge"', { x: 0.72, y: 2.25, w: 4.55, h: 0.5, fontSize: 17, fontFace: 'Arial', color: C.white, bold: true })
  s9.addText('A traveler asks a question — by phone, kiosk, or website. Ana answers in natural language and the screen shows the matching terminal map, parking grid, dining list, or live status beside the chat.', {
    x: 0.72, y: 2.8, w: 4.55, h: 1.8, fontSize: 13, fontFace: 'Arial', color: C.slate, wrap: true, lineSpacingMultiple: 1.5,
  })
  s9.addText('Built on real MCO content (a crawl of flymco.com) and live public data — not a scripted demo. Speaks 16 languages. Already live at sentimetrx.ai/b/mco.', {
    x: 0.72, y: 4.7, w: 4.55, h: 1.9, fontSize: 13, fontFace: 'Arial', color: C.tealMid, italic: true, wrap: true, lineSpacingMultiple: 1.5,
  })

  // Right: capability grid
  const caps = [
    { t: 'Flights & gates', b: 'Live status, gate, and boarding for a specific flight' },
    { t: 'Security waits', b: 'Current checkpoint wait times by terminal and lane' },
    { t: 'Parking', b: 'Live lot availability and rates, with a recommendation' },
    { t: 'Dining & shops', b: 'What\'s open near you, with live Google ratings' },
    { t: 'Wayfinding', b: 'Terminal maps and step-by-step navigation to a gate' },
    { t: 'Continue on phone', b: 'Scan a QR to carry the conversation from kiosk to pocket' },
  ]
  caps.forEach(function (c, i) {
    const col = i % 2
    const row = Math.floor(i / 3)
    // 2 columns x 3 rows on the right
    const x = 5.7 + (i % 2) * 3.6
    const y = 1.4 + Math.floor(i / 2) * 1.82
    s9.addShape('roundRect', { x, y, w: 3.45, h: 1.65, rectRadius: 0.1, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
    s9.addShape('rect', { x, y, w: 3.45, h: 0.06, fill: { color: C.amber } })
    s9.addText(c.t, { x: x + 0.18, y: y + 0.14, w: 3.1, h: 0.4, fontSize: 13.5, fontFace: 'Arial', color: C.navy, bold: true })
    s9.addText(c.b, { x: x + 0.18, y: y + 0.56, w: 3.1, h: 1.0, fontSize: 11, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.35 })
  })
  s9.addNotes(
    'Keep capabilities accurate: flights/gates, security wait times, parking availability + rates, dining/shops with live Google ratings, terminal maps & navigation, QR continue-on-phone, kiosk-able, 16 languages. ' +
    'Differentiator: most airport bots are chat-only OR a kiosk wayfinder. Ours pairs a conversation with a synchronized rich-media canvas — ahead of what Changi, Schiphol, DFW, and LaGuardia have shipped publicly. ' +
    'Offer to run it live in the next meeting.'
  )

  // ═══ SLIDE 10: Two wins ═══
  p++
  const s10 = pptx.addSlide()
  s10.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s10, 'One concierge, two wins', 'Help the traveler now — and turn every conversation into guest insight')
  ftr(s10, p)

  s10.addShape('roundRect', { x: 0.5, y: 1.45, w: 6.05, h: 5.2, rectRadius: 0.12, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
  s10.addShape('rect', { x: 0.5, y: 1.45, w: 6.05, h: 0.65, fill: { color: C.teal }, line: { width: 0 } })
  s10.addText('WIN 1 — A BETTER EXPERIENCE', { x: 0.72, y: 1.45, w: 5.6, h: 0.65, fontSize: 13, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle', charSpacing: 1.5 })
  s10.addText(
    'The traveler gets a calm, instant answer at the most stressful moments of the journey:\n\n' +
    '· "Will I make my connection?"\n' +
    '· "Where do I park, and what does it cost?"\n' +
    '· "What\'s open near gate B14 right now?"\n' +
    '· "How do I get from C to A?"\n\n' +
    'No app to download. No line to wait in. In their language.',
    { x: 0.72, y: 2.3, w: 5.6, h: 4.2, fontSize: 13, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.5 }
  )

  s10.addShape('roundRect', { x: 6.78, y: 1.45, w: 6.05, h: 5.2, rectRadius: 0.12, fill: { color: C.navy }, line: { width: 0 } })
  s10.addShape('rect', { x: 6.78, y: 1.45, w: 6.05, h: 0.65, fill: { color: C.orange }, line: { width: 0 } })
  s10.addText('WIN 2 — A NEW LISTENING CHANNEL', { x: 7.0, y: 1.45, w: 5.6, h: 0.65, fontSize: 13, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle', charSpacing: 1.5 })
  s10.addText(
    'Every question is data the airport never had before:\n\n' +
    '· What are travelers most confused about?\n' +
    '· Where do they get stuck — which gates, which signs?\n' +
    '· What do they ask for that isn\'t there?\n' +
    '· Which terminals and times drive the most stress?\n\n' +
    'The same theming engine reads the conversations — so the concierge feeds the very same Voice-of-Guest dashboard.',
    { x: 7.0, y: 2.3, w: 5.6, h: 4.2, fontSize: 13, fontFace: 'Arial', color: C.white, wrap: true, lineSpacingMultiple: 1.5 }
  )
  s10.addNotes(
    'This is the strategic punchline: the concierge is not a side project — it is both a service improvement and a listening surface, feeding the same dashboard from slide 6. One investment, two returns.'
  )

  // ═══ SLIDE 11: Where small business fits ═══
  p++
  const s11 = pptx.addSlide()
  s11.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s11, 'Where this helps your small-business tenants', 'Concessions and dining are the guest experience — and they\'re mostly local and small businesses')
  ftr(s11, p)

  s11.addShape('roundRect', { x: 0.5, y: 1.3, w: 12.33, h: 1.0, rectRadius: 0.1, fill: { color: C.tealTint }, line: { color: C.tealMid, width: 0.6 } })
  s11.addText('How travelers rate food, retail, and service is a big part of how they rate the airport overall. Those outlets are largely run by the small and local businesses your program champions — so the same listening engine becomes a tool for them, too.', {
    x: 0.7, y: 1.34, w: 11.9, h: 0.92, fontSize: 13, fontFace: 'Arial', color: C.teal, valign: 'middle', wrap: true, lineSpacingMultiple: 1.4,
  })

  const sb = [
    { title: 'A read on their guests', body: 'Each concession sees what travelers say about it — themes, sentiment, and the specific compliments and complaints — without buying its own analytics stack.', accent: C.teal },
    { title: 'A fairer playing field', body: 'Enterprise feedback tooling is expensive. Folding tenants into the airport\'s program gives a small local operator the same insight a national chain has.', accent: C.orange },
    { title: 'A shared scorecard', body: 'The program team can see how the small-business portfolio contributes to guest experience — and spotlight the standouts to stakeholders.', accent: C.amber },
  ]
  sb.forEach(function (b, i) {
    card(s11, 0.5 + i * 4.13, 2.55, 3.9, 4.3, b.title, b.body, b.accent)
  })
  s11.addNotes(
    'This slide speaks to the people we actually met — the small-business development team — and gives them a reason to champion the program internally. ' +
    'Frame it as opportunity, qualitatively; no invented numbers. The pitch: guest-experience listening is also a benefit you can extend to your small-business tenants.'
  )

  // ═══ SLIDE 12: Phased path forward ═══
  p++
  const s12 = pptx.addSlide()
  s12.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s12, 'A phased path forward', 'Start small, prove value fast, expand — no big-bang commitment')
  ftr(s12, p)

  const phases = [
    { label: 'PHASE 1', name: 'Re-establish listening', body: 'Stand up the unified Voice-of-Guest dashboard on your existing channels — surveys, website, social, reviews. Themed, continuous, live.', accent: C.teal },
    { label: 'PHASE 2', name: 'Benchmark', body: 'Add continuous peer benchmarking on a peer set you pick. Deliver the first "where we lead / what we can learn" read on real data.', accent: C.amber },
    { label: 'PHASE 3', name: 'Concierge pilot', body: 'Deploy the MCO Concierge on a contained surface — the website or a kiosk — and start capturing the new conversational signal.', accent: C.orange },
    { label: 'PHASE 4', name: 'Scale & close the loop', body: 'Expand surfaces, route signals to operations and concessions, and track whether fixes move the metric. The living system, fully on.', accent: C.teal },
  ]
  const pw = 2.95, pg = 0.18
  phases.forEach(function (ph, i) {
    const x = 0.5 + i * (pw + pg)
    s12.addShape('roundRect', { x, y: 1.7, w: pw, h: 4.6, rectRadius: 0.12, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
    s12.addShape('rect', { x, y: 1.7, w: pw, h: 0.85, fill: { color: ph.accent }, line: { width: 0 } })
    s12.addText(ph.label, { x: x + 0.2, y: 1.78, w: pw - 0.4, h: 0.3, fontSize: 11, fontFace: 'Arial', color: C.white, bold: true, charSpacing: 2 })
    s12.addText(ph.name, { x: x + 0.2, y: 2.06, w: pw - 0.4, h: 0.42, fontSize: 16, fontFace: 'Arial', color: C.white, bold: true })
    s12.addText(ph.body, { x: x + 0.2, y: 2.75, w: pw - 0.4, h: 3.4, fontSize: 12, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.45 })
    if (i < phases.length - 1) {
      s12.addText('▶', { x: x + pw + pg / 2 - 0.08, y: 3.8, w: 0.24, h: 0.3, fontSize: 15, fontFace: 'Arial', color: C.faint, align: 'center' })
    }
  })
  s12.addText('Each phase stands alone and pays for itself. You decide how far to go, and how fast.', {
    x: 0.5, y: 6.5, w: 12.33, h: 0.35, fontSize: 12.5, fontFace: 'Arial', color: C.navy, italic: true, align: 'center',
  })
  s12.addNotes(
    'Lower the perceived risk. This is not a monolithic platform purchase — it is four phases, each useful on its own. Phase 1 alone (the dashboard) delivers value; everything after is optional expansion.'
  )

  // ═══ SLIDE 13: The ask ═══
  p++
  const s13 = pptx.addSlide()
  s13.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s13, 'The next step', 'A 60-minute working session with your guest-experience and concessions stakeholders')
  ftr(s13, p)

  s13.addShape('roundRect', { x: 0.5, y: 1.4, w: 12.33, h: 1.0, rectRadius: 0.1, fill: { color: C.navy }, line: { width: 0 } })
  s13.addText('No commitment — a working session. We come ready to show, not just tell.', {
    x: 0.7, y: 1.4, w: 11.9, h: 1.0, fontSize: 16, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle', wrap: true,
  })

  const asks = [
    { n: '1', title: 'See the MCO Concierge live', body: 'We run the working prototype on the room\'s screen — your stakeholders ask it real traveler questions and watch the canvas respond.' },
    { n: '2', title: 'A benchmarking sample on your peers', body: 'Tell us your peer set. We\'ll bring a "where MCO leads / what MCO can learn" read built from real, current public reviews.' },
    { n: '3', title: 'Scope a Phase 1 dashboard', body: 'Walk through which of your existing channels we\'d connect first, and what the unified Voice-of-Guest view would show on day one.' },
  ]
  asks.forEach(function (a, i) {
    const y = 2.7 + i * 1.35
    s13.addShape('roundRect', { x: 0.5, y, w: 12.33, h: 1.2, rectRadius: 0.1, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
    s13.addShape('ellipse', { x: 0.75, y: y + 0.32, w: 0.55, h: 0.55, fill: { color: C.amber }, line: { width: 0 } })
    s13.addText(a.n, { x: 0.75, y: y + 0.32, w: 0.55, h: 0.55, fontSize: 20, fontFace: 'Arial', color: C.navy, bold: true, align: 'center', valign: 'middle' })
    s13.addText(a.title, { x: 1.55, y: y + 0.16, w: 11, h: 0.45, fontSize: 16, fontFace: 'Arial', color: C.navy, bold: true })
    s13.addText(a.body, { x: 1.55, y: y + 0.6, w: 11, h: 0.55, fontSize: 12.5, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.35 })
  })
  s13.addNotes(
    'Make the next meeting easy to say yes to: it is a working session, not a sales pitch. The live demo is the hook; the benchmarking sample on their own peer set is the proof; the Phase 1 scope makes it concrete.'
  )

  // ═══ SLIDE 14: Close ═══
  p++
  const s14 = pptx.addSlide()
  s14.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.navy } })
  s14.addShape('rect', { x: 0, y: 0, w: 0.22, h: H, fill: { color: C.amber } })
  s14.addShape('rect', { x: 0, y: 4.5, w: W, h: 0.05, fill: { color: C.gold } })
  s14.addText('You already listen to your guests.', { x: 0.9, y: 1.5, w: 11.5, h: 1.4, fontSize: 44, fontFace: 'Arial', color: C.white, bold: true, lineSpacingMultiple: 1.2 })
  s14.addText('Let\'s make MCO world-class at it.', { x: 0.9, y: 3.0, w: 11.5, h: 0.9, fontSize: 30, fontFace: 'Arial', color: C.amber, bold: true })
  s14.addText('Five years of context. A toolkit that\'s leapt forward. A working prototype already wearing your name.', {
    x: 0.9, y: 4.75, w: 11.3, h: 0.9, fontSize: 16, fontFace: 'Arial', color: C.slate, wrap: true, lineSpacingMultiple: 1.4,
  })
  // Co-brand lockup
  mcoMark(s14, 0.9, H - 1.55, 1.1)
  s14.addText('×', { x: 2.35, y: H - 1.5, w: 0.4, h: 0.6, fontSize: 22, fontFace: 'Arial', color: C.slate, align: 'center', valign: 'middle' })
  s14.addText(
    [
      { text: 'data', options: { color: '4DBFC1', bold: true, italic: true } },
      { text: 'nautix', options: { color: 'F07040', bold: true, italic: true } },
    ],
    { x: 2.8, y: H - 1.5, w: 2.6, h: 0.6, fontSize: 22, valign: 'middle' }
  )
  s14.addText('datanautix.com', { x: W - 4.5, y: H - 0.8, w: 4, h: 0.4, fontSize: 13, fontFace: 'Arial', color: C.slate, align: 'right' })
  s14.addNotes(
    'Land it and stop talking. "You already listen — let\'s make MCO world-class at it." Then ask for the working session. Let the co-brand lockup (MCO × datanautix) sit on screen while they respond.'
  )

  // ═══ SLIDE 15: Appendix divider ═══
  p++
  const sA = pptx.addSlide()
  sA.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.navy } })
  sA.addShape('rect', { x: 0, y: 0, w: 0.22, h: H, fill: { color: C.teal } })
  sA.addText('Appendix', { x: 0.9, y: 2.6, w: 11, h: 1.0, fontSize: 48, fontFace: 'Arial', color: C.white, bold: true })
  sA.addText('Illustrative sample outputs — the shape of the analysis, not MCO data', {
    x: 0.9, y: 3.7, w: 11, h: 0.6, fontSize: 18, fontFace: 'Arial', color: C.tealMid,
  })
  sA.addShape('roundRect', { x: 0.9, y: 4.6, w: 9.2, h: 0.8, rectRadius: 0.08, fill: { color: C.amberTint }, line: { color: C.amber, width: 0.8 } })
  sA.addText('The two benchmarking pages are built to be re-run on your real peer set with live reviews — just tell us the airports.', {
    x: 1.1, y: 4.6, w: 8.8, h: 0.8, fontSize: 13, fontFace: 'Arial', color: 'B45309', bold: true, valign: 'middle', wrap: true,
  })
  wordmark(sA)

  // ═══ SLIDE A1: Illustrative VoG theme dashboard ═══
  p++
  const sB = pptx.addSlide()
  sB.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(sB, 'Sample: Voice-of-Guest theme dashboard', 'What a unified listening view looks like — one airport, all channels, one screen')
  ftr(sB, p)
  illuBadge(sB)

  sB.addShape('roundRect', { x: 0.5, y: 1.7, w: 12.33, h: 5.15, rectRadius: 0.12, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
  sB.addText('Theme', { x: 0.72, y: 1.85, w: 2.55, h: 0.3, fontSize: 10, fontFace: 'Arial', color: C.faint, bold: true, charSpacing: 1 })
  sB.addText('Guest sentiment  (■ positive   ■ neutral   ■ negative)', { x: 3.37, y: 1.85, w: 7, h: 0.3, fontSize: 10, fontFace: 'Arial', color: C.faint, bold: true })
  sB.addText('Mentions', { x: 11.45, y: 1.85, w: 1.1, h: 0.3, fontSize: 10, fontFace: 'Arial', color: C.faint, bold: true, align: 'right' })
  sB.addShape('rect', { x: 0.72, y: 2.18, w: 11.85, h: 0.012, fill: { color: 'E5E7EB' } })

  const themes = [
    ['Staff helpfulness', 78, 16, 6, '4,120'],
    ['Terminal cleanliness', 71, 20, 9, '3,540'],
    ['Dining variety & value', 52, 24, 24, '3,910'],
    ['Wayfinding & signage', 44, 28, 28, '2,870'],
    ['Security wait time', 38, 22, 40, '5,260'],
    ['Restroom availability', 41, 25, 34, '2,180'],
    ['Parking & ground transport', 55, 27, 18, '1,940'],
    ['Seating & charging at gates', 49, 30, 21, '1,610'],
  ]
  themes.forEach(function (t, i) {
    sentimentRow(sB, 0.72, 2.45 + i * 0.55, 11.85, t[0] as string, t[1] as number, t[2] as number, t[3] as number, t[4] as string)
  })
  sB.addNotes(
    'Illustrative only — say so out loud. The format is the message: every theme is discovered from open-ended comments, scored for sentiment, and sized by volume, across all channels at once. ' +
    'On a real engagement these rows are MCO\'s actual themes, and each is drillable to the verbatim quotes and the gates/vendors named.'
  )

  // ═══ SLIDE A2: Illustrative — where MCO leads ═══
  p++
  const sC = pptx.addSlide()
  sC.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(sC, 'Sample: where MCO leads its peers', 'A two-sided benchmark — your strengths, on real public-review data')
  ftr(sC, p)
  illuBadge(sC)

  sC.addShape('roundRect', { x: 0.5, y: 1.7, w: 12.33, h: 4.85, rectRadius: 0.12, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
  sC.addText('Guest rating, 1–5 — MCO vs. peer-set average', { x: 0.72, y: 1.85, w: 8, h: 0.32, fontSize: 11, fontFace: 'Arial', color: C.navy, bold: true })
  // legend
  sC.addShape('rect', { x: 9.4, y: 1.9, w: 0.22, h: 0.18, fill: { color: C.orange } })
  sC.addText('MCO', { x: 9.7, y: 1.82, w: 0.9, h: 0.32, fontSize: 10, fontFace: 'Arial', color: C.mid, valign: 'middle' })
  sC.addShape('rect', { x: 10.6, y: 1.9, w: 0.22, h: 0.18, fill: { color: C.teal } })
  sC.addText('Peer avg', { x: 10.9, y: 1.82, w: 1.4, h: 0.32, fontSize: 10, fontFace: 'Arial', color: C.mid, valign: 'middle' })

  const leads = [
    ['Staff helpfulness', 4.4, 4.0],
    ['Terminal cleanliness', 4.3, 3.9],
    ['Ease of arrival/curbside', 4.2, 3.8],
    ['Overall ambiance', 4.1, 3.8],
    ['Family/kid friendliness', 4.2, 3.9],
  ]
  leads.forEach(function (r, i) {
    compareRow(sC, 0.72, 2.5 + i * 0.85, 11.85, r[0] as string, r[1] as number, r[2] as number)
  })
  sC.addText('The story for stakeholders: here is where guests already rank MCO ahead — defend it, fund it, and put it in front of the board.', {
    x: 0.72, y: 6.62, w: 11.85, h: 0.32, fontSize: 10, fontFace: 'Arial', color: C.faint, italic: true,
  })
  sC.addNotes(
    'Illustrative figures — the bars and numbers are placeholders. With a real peer set and live reviews these become MCO\'s actual leads. ' +
    'This is the "celebrate the wins" half of benchmarking — the half that helps your champion sell internally.'
  )

  // ═══ SLIDE A3: Illustrative — what MCO can learn ═══
  p++
  const sD = pptx.addSlide()
  sD.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(sD, 'Sample: what MCO can learn from peers', 'Where a peer is pulling ahead — and the specific thing guests praise them for')
  ftr(sD, p)
  illuBadge(sD)

  sD.addShape('roundRect', { x: 0.5, y: 1.7, w: 6.0, h: 5.15, rectRadius: 0.12, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
  sD.addText('Guest rating, 1–5 — MCO vs. peer-set average', { x: 0.7, y: 1.82, w: 5.6, h: 0.3, fontSize: 10.5, fontFace: 'Arial', color: C.navy, bold: true })
  const learn = [
    ['Security wait predictability', 3.4, 4.1],
    ['Digital wayfinding', 3.6, 4.2],
    ['Rest & quiet zones', 3.3, 4.0],
    ['Dining value-for-money', 3.5, 4.0],
  ]
  learn.forEach(function (r, i) {
    compareRow(sD, 0.7, 2.45 + i * 1.0, 5.85, r[0] as string, r[1] as number, r[2] as number)
  })

  sD.addShape('roundRect', { x: 6.78, y: 1.7, w: 6.05, h: 5.15, rectRadius: 0.12, fill: { color: C.navy }, line: { width: 0 } })
  sD.addText('WHAT GUESTS PRAISE ELSEWHERE', { x: 7.0, y: 1.9, w: 5.6, h: 0.32, fontSize: 11, fontFace: 'Arial', color: C.tealMid, bold: true, charSpacing: 1.5 })
  const praises = [
    ['Real-time wait displays', 'Peers post live security waits at the entrance — travelers feel in control before they reach the line.'],
    ['Sensory & quiet rooms', 'Dedicated calm zones and sensory rooms draw repeated, specific praise from families and neurodivergent travelers.'],
    ['Local-flavor dining', 'Strong "taste of the city" concessions read as value, not just convenience — a direct tie to your small-business tenants.'],
  ]
  praises.forEach(function (pz, i) {
    const y = 2.4 + i * 1.45
    sD.addText(pz[0], { x: 7.0, y, w: 5.6, h: 0.4, fontSize: 13.5, fontFace: 'Arial', color: C.white, bold: true })
    sD.addText(pz[1], { x: 7.0, y: y + 0.42, w: 5.6, h: 0.95, fontSize: 11.5, fontFace: 'Arial', color: C.slate, wrap: true, lineSpacingMultiple: 1.4 })
  })
  sD.addNotes(
    'Illustrative — the gaps and quotes are examples of the shape of the output. The honest framing: benchmarking is not just a scoreboard, it is an idea pipeline. ' +
    'Where peers win, guests tell you exactly why — and you can borrow it. Note the dining example ties straight back to the small-business slide.'
  )

  // ═══ SLIDE A4: MCO Concierge capability detail ═══
  p++
  const sE = pptx.addSlide()
  sE.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(sE, 'MCO Concierge — how the prototype works', 'A real build on real MCO content and live public data — not a scripted demo')
  ftr(sE, p)

  sE.addShape('roundRect', { x: 0.5, y: 1.3, w: 12.33, h: 0.95, rectRadius: 0.1, fill: { color: C.tealTint }, line: { color: C.tealMid, width: 0.6 } })
  sE.addText('Ahead of what Changi (AskMax), Schiphol, DFW (IRIS), and LaGuardia (Bridget) have shipped publicly — those are chat-only OR kiosk-only. The MCO Concierge pairs a natural-language conversation with a synchronized rich-media canvas.', {
    x: 0.7, y: 1.34, w: 11.9, h: 0.88, fontSize: 12, fontFace: 'Arial', color: C.teal, valign: 'middle', wrap: true, lineSpacingMultiple: 1.4,
  })

  const detail = [
    { title: 'Knowledge', body: 'Seeded from a crawl of flymco.com — terminals, parking, dining, services. Answers are grounded in airport content, not invented.', accent: C.teal },
    { title: 'Live data', body: 'Flight status, security wait times, parking availability and rates, and dining hours + live Google ratings pulled in real time.', accent: C.orange },
    { title: 'Synchronized canvas', body: 'As Ana answers, the screen shows the matching terminal map, parking grid, restaurant list, or flight-prep panel — one card at a time.', accent: C.amber },
    { title: 'Anywhere a guest is', body: 'Website chat, a wall-mounted kiosk, or their own phone — with a QR "continue on my phone" handoff. 16 languages.', accent: C.teal },
  ]
  detail.forEach(function (d, i) {
    const col = i % 2
    const row = Math.floor(i / 2)
    card(sE, 0.5 + col * 6.2, 2.45 + row * 2.15, 5.95, 1.97, d.title, d.body, d.accent)
  })
  sE.addText('Live now at sentimetrx.ai/b/mco — we can run it on the room\'s screen in the next meeting.', {
    x: 0.5, y: 6.62, w: 12.33, h: 0.3, fontSize: 11, fontFace: 'Arial', color: C.navy, italic: true, align: 'center',
  })
  sE.addNotes(
    'Detail slide for the technically curious stakeholder. Everything here is real and verifiable in the live agent. ' +
    'Do not overstate — keep to: flymco.com-grounded knowledge, live flight/security/parking/dining data, synchronized canvas, multi-surface + QR handoff, 16 languages.'
  )
}
