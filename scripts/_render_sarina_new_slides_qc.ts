/* eslint-disable */
// One-off: render ONLY the 4 new substance slides added 2026-05-28 to the
// NOWOCATS approach deck (KB sources, How Sarina is steered, What the town
// hall wrapper adds, Visual flow). Output goes to ~/Downloads for user QC
// without triggering a Vercel prod build.
//
// Run: node_modules/.bin/tsx scripts/_render_sarina_new_slides_qc.ts

import { writeFileSync } from 'fs'
import { homedir } from 'os'
import path from 'path'
import PptxGenJS from 'pptxgenjs'

const W = 13.33
const H = 7.5

const C = {
  navy:        '0D2B45',
  teal:        '0F7173',
  tealMid:     '4DBFC1',
  tealLight:   'E0F0F0',
  orange:      'E8632A',
  gold:        'E8B84B',
  white:       'FFFFFF',
  slate:       '8FA3AE',
  slateCard:   'F4F7F8',
  ink:         '111827',
  mid:         '374151',
  faint:       '9CA3AF',
  green:       '059669',
  red:         'DC2626',
  purple:      '7C3AED',
  ocBlue:      '1E5BA8',
  tealTint:    'E5F1F1',
  tealLineMid: 'A8D1D2',
  orangeTint:  'FBE6DA',
  purpleTint:  'F4EFFC',
  purpleLine:  'B59BE5',
}

function hdr(slide: any, title: string, sub?: string) {
  slide.addShape('rect', { x: 0, y: 0, w: W, h: 1.1, fill: { color: C.navy } })
  slide.addShape('rect', { x: 0, y: 0, w: 0.07, h: 1.1, fill: { color: C.teal } })
  slide.addShape('rect', { x: 0, y: 1.1, w: W, h: 0.04, fill: { color: C.gold } })
  slide.addText(title, { x: 0.55, y: 0.1, w: 10.5, h: 0.6, fontSize: 28, fontFace: 'Arial', color: C.white, bold: true })
  if (sub) slide.addText(sub, { x: 0.55, y: 0.66, w: 10.5, h: 0.34, fontSize: 13, fontFace: 'Arial', color: C.slate })
  wordmark(slide)
}

function wordmark(slide: any) {
  slide.addText(
    [
      { text: 'data', options: { color: 'F07040', bold: true, italic: true } },
      { text: 'nautix', options: { color: C.tealMid, bold: true, italic: true } },
    ],
    { x: W - 2.4, y: 0.15, w: 2.2, h: 0.7, fontSize: 15, valign: 'middle', align: 'right' }
  )
}

function ftr(slide: any, n: number) {
  slide.addText('datanautix.com  ·  Prepared for VHB & Orange County Public Works', { x: 0.5, y: H - 0.36, w: 7, h: 0.26, fontSize: 8, color: C.faint, fontFace: 'Arial' })
  slide.addText('QC Preview — new slides only', { x: W / 2 - 1.5, y: H - 0.36, w: 3, h: 0.26, fontSize: 8, color: C.faint, fontFace: 'Arial', align: 'center' })
  slide.addText(String(n), { x: W - 0.9, y: H - 0.36, w: 0.4, h: 0.26, fontSize: 8, color: C.faint, fontFace: 'Arial', align: 'right' })
}

async function main() {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Datanautix'
  pptx.title = 'NOWOCATS Approach Deck — 4 new substance slides (QC)'
  let p = 0

  // ═══ SLIDE 1 (was slide 11 in full deck): What's in Sarina's brain ═══
  p++
  const sKb = pptx.addSlide()
  sKb.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(sKb, 'What\'s in Sarina\'s brain', 'Five public NOWOCATS documents. Chunked, embedded, source-cited. Nothing beyond them.')
  ftr(sKb, p)

  const kbDocs = [
    { title: 'Existing Conditions Report', meta: 'September 2025  ·  Study Report', body: '143.8 sq mi study area. 44 intersections + 27 roadway segments evaluated. 2025 baseline + 2050 build vs no-build forecasts. Multimodal — roads, transit, bike/ped, freight.', accent: C.teal },
    { title: 'PM-1 Community Meeting Presentation', meta: 'Jan 26 & 28, 2026  ·  44 slides', body: 'Study purpose, existing conditions, programmed vs planned improvements, future conditions, timeline, engagement. Hatem (Orange County) + Babuji (VHB) ingested as project contacts.', accent: C.orange },
    { title: 'PM-1 Q&A Forum', meta: 'Verbatim Q&A  ·  28 pairs / 12 topics', body: 'Every resident question and project-team response from Community Meeting #1. Sarina cites the team\'s exact wording — not paraphrased, not synthesized.', accent: C.purple },
    { title: 'PM-1 Posters + Meeting Notice', meta: 'Plain-language explainers  ·  Meeting Materials', body: 'LOS definitions in resident-friendly language, programmed-vs-planned framing, venue / contact details from the Community Meeting #1 poster set.', accent: C.gold },
    { title: 'PM-2 Postcard', meta: 'Meeting #2 Notice  ·  June 16, 2026', body: 'Date, time, venue. ADA contact (Nicola Norton, 407-836-6568). Title VI contact (Natalia Garcia, 407-836-7334). Bilingual outreach commitment.', accent: C.tealMid },
  ]
  kbDocs.forEach(function(d, i) {
    const col = i % 3
    const row = Math.floor(i / 3)
    const x = 0.5 + col * 4.27
    const y = 1.35 + row * 2.55
    sKb.addShape('roundRect', { x, y, w: 4.0, h: 2.4, rectRadius: 0.1, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
    sKb.addShape('rect', { x, y, w: 0.06, h: 2.4, fill: { color: d.accent } })
    sKb.addText(d.title, { x: x + 0.22, y: y + 0.12, w: 3.65, h: 0.38, fontSize: 14, fontFace: 'Arial', color: C.navy, bold: true })
    sKb.addText(d.meta,  { x: x + 0.22, y: y + 0.5,  w: 3.65, h: 0.28, fontSize: 9.5, fontFace: 'Arial', color: d.accent, bold: true, charSpacing: 1.5 })
    sKb.addText(d.body,  { x: x + 0.22, y: y + 0.82, w: 3.65, h: 1.5,  fontSize: 11, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.4 })
  })
  const xR = 0.5 + 2 * 4.27
  const yR = 1.35 + 1 * 2.55
  sKb.addShape('roundRect', { x: xR, y: yR, w: 4.0, h: 2.4, rectRadius: 0.1, fill: { color: C.navy }, line: { color: C.navy, width: 0 } })
  sKb.addText('HOW IT WORKS', { x: xR + 0.22, y: yR + 0.12, w: 3.65, h: 0.3, fontSize: 9, fontFace: 'Arial', color: C.tealMid, bold: true, charSpacing: 3 })
  sKb.addText(
    'Each ## heading = one chunk.\n' +
    'Chunks vectorized with text-embedding-3-small.\n' +
    'Resident question → semantic search → top-N chunks → answer grounded in ONLY those chunks.\n' +
    'Every chunk carries its source label.',
    { x: xR + 0.22, y: yR + 0.48, w: 3.65, h: 1.85, fontSize: 11, fontFace: 'Arial', color: C.white, wrap: true, lineSpacingMultiple: 1.4 }
  )
  sKb.addShape('roundRect', { x: 0.5, y: 6.55, w: 12.3, h: 0.5, rectRadius: 0.08, fill: { color: C.gold }, line: { color: C.gold, width: 0 } })
  sKb.addText('PM-2 presentation slides become a sixth document the moment they publish — same pipeline, no rebuild.', {
    x: 0.5, y: 6.55, w: 12.3, h: 0.5, fontSize: 12, fontFace: 'Arial', color: C.navy, bold: true, align: 'center', valign: 'middle',
  })

  // ═══ SLIDE 2 (was slide 12): How Sarina is steered ═══
  p++
  const sSt = pptx.addSlide()
  sSt.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(sSt, 'How Sarina is steered', 'Three explicit knobs control her voice — personality, system prompt, guardrails — plus a deflection router for off-topic asks')
  ftr(sSt, p)

  const knobs = [
    { title: 'Personality', sub: 'WHO SHE SOUNDS LIKE', body: 'Civic. Measured. Neighbor-helpful. Matches the wording Hatem and Babuji already use in the PM-1 Q&A forum. Bilingual from the first message — if the resident writes Spanish, Sarina responds in Spanish the entire conversation.', accent: C.teal },
    { title: 'System Prompt', sub: 'WHAT SHE DOES + HOW SHE SPEAKS', body: 'Mission, conversation arc, and a plain-language translation table.\n\nPlain English leads, engineering term in parentheses:\n· essentially stop-and-go in rush hour (LOS F)\n· 0-100 pavement score; <60 is poor (PCI)\n· how comfortable a road feels to walk/bike (LTS)\n· average vehicles per day (AADT)\n20+ acronyms covered.', accent: C.orange },
    { title: 'Guardrails', sub: 'WHAT SHE WILL NOT DO', body: 'Explicit rule list applied per-reply:\n1. Answer only from ingested NOWOCATS corpus\n2. No political positions for or against any project\n3. No promised outcomes or timelines beyond PM materials\n4. No funding, budget, or developer commitments\n5. No comparison with other county initiatives', accent: C.purple },
  ]
  knobs.forEach(function(k, i) {
    const x = 0.5 + i * 4.27
    const y = 1.35
    const h = 4.45
    sSt.addShape('roundRect', { x, y, w: 4.0, h, rectRadius: 0.12, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
    sSt.addShape('rect', { x, y, w: 4.0, h: 0.62, fill: { color: k.accent }, line: { color: k.accent, width: 0 } })
    sSt.addText(k.title, { x: x + 0.22, y: y + 0.05, w: 3.65, h: 0.32, fontSize: 16, fontFace: 'Arial', color: C.white, bold: true })
    sSt.addText(k.sub,   { x: x + 0.22, y: y + 0.36, w: 3.65, h: 0.24, fontSize: 9, fontFace: 'Arial', color: C.white, bold: true, charSpacing: 2 })
    sSt.addText(k.body,  { x: x + 0.22, y: y + 0.78, w: 3.65, h: h - 0.95, fontSize: 11, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.4 })
  })
  sSt.addShape('roundRect', { x: 0.5, y: 5.95, w: 12.3, h: 1.1, rectRadius: 0.1, fill: { color: C.navy }, line: { color: C.navy, width: 0 } })
  sSt.addText('OFF-LIMITS', { x: 0.7, y: 6.02, w: 2.2, h: 0.34, fontSize: 11, fontFace: 'Arial', color: C.gold, bold: true, charSpacing: 3 })
  sSt.addText(
    'Sarina will not advocate for or against any specific project · will not name a politician favorably or critically · will not promise that any road or improvement will or will not be built · will not opine on funding, land deals, or developer-driven projects · will not discuss matters outside NW Orange County transportation. Off-topic asks are redirected by a deflection router with a configurable message.',
    { x: 2.95, y: 6.02, w: 9.7, h: 0.96, fontSize: 11, fontFace: 'Arial', color: C.white, wrap: true, lineSpacingMultiple: 1.35 }
  )

  // ═══ SLIDE 3 (was slide 13): What the town hall wrapper adds ═══
  p++
  const sTh = pptx.addSlide()
  sTh.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(sTh, 'What the town hall wrapper adds', 'Bare Sarina = one resident at a time. The town hall layer pools many residents into one analytical surface.')
  ftr(sTh, p)

  sTh.addShape('roundRect', { x: 0.5, y: 1.3, w: 5.4, h: 5.5, rectRadius: 0.12, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
  sTh.addShape('rect', { x: 0.5, y: 1.3, w: 5.4, h: 0.55, fill: { color: C.slate }, line: { color: C.slate, width: 0 } })
  sTh.addText('BARE SARINA (1:1)', { x: 0.7, y: 1.3, w: 5.0, h: 0.55, fontSize: 11, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle', charSpacing: 2 })
  sTh.addText(
    'WHAT YOU GET\n' +
    '· One resident per conversation\n' +
    '· Themed per-conversation report\n' +
    '· Source-tagged transcript (qr or web)\n' +
    '· Per-session sentiment and topic flags',
    { x: 0.75, y: 2.0, w: 5.0, h: 1.95, fontSize: 12, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.5 }
  )
  sTh.addText('WHAT\'S MISSING', { x: 0.75, y: 4.05, w: 5.0, h: 0.3, fontSize: 10, fontFace: 'Arial', color: C.red, bold: true, charSpacing: 2 })
  sTh.addText(
    '· Who else mentioned this corridor?\n' +
    '· What share of the room raised safety vs transit?\n' +
    '· Did residents raise themes we didn\'t preload?\n' +
    '· Have we heard enough on each topic to act?',
    { x: 0.75, y: 4.38, w: 5.0, h: 2.3, fontSize: 11.5, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.5 }
  )

  sTh.addShape('roundRect', { x: 6.2, y: 1.3, w: 6.65, h: 5.5, rectRadius: 0.12, fill: { color: C.navy }, line: { color: C.navy, width: 0 } })
  sTh.addShape('rect', { x: 6.2, y: 1.3, w: 6.65, h: 0.55, fill: { color: C.teal }, line: { color: C.teal, width: 0 } })
  sTh.addText('+ TOWN HALL WRAPPER', { x: 6.4, y: 1.3, w: 6.25, h: 0.55, fontSize: 11, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle', charSpacing: 2 })
  sTh.addText('SIGNALS YOU CAN ONLY EXTRACT BY POOLING', { x: 6.4, y: 2.0, w: 6.25, h: 0.3, fontSize: 9, fontFace: 'Arial', color: C.tealMid, bold: true, charSpacing: 2 })

  const thRows = [
    ['Shared topic plan',           'Per-topic response targets (e.g., "50 responses across the 6 priority categories"). Counts toward target every time a resident addresses the topic.'],
    ['Live saturation counter',     'Which of the 7 feedback topics have hit target. Which still need outreach. Visible in real time during PM-2.'],
    ['Emergent theme detection',    'AI sweeps every N responses for patterns NOT in the preloaded topic list. Catches what the project team didn\'t anticipate.'],
    ['Cross-resident sentiment',    'Pooled sentiment per topic with representative quotes pulled across many respondents — not just one voice.'],
    ['Facilitator dashboard',       'What the room is saying RIGHT NOW. Live during the June 16 open house. Lets staff steer conversation while it\'s happening.'],
    ['Geographic hotspot rollup',   'Corridors and intersections mentioned by N residents, weighted by user type. Only visible with many inputs.'],
  ]
  thRows.forEach(function(r, i) {
    const y = 2.4 + i * 0.71
    sTh.addText(r[0], { x: 6.4, y, w: 2.4, h: 0.65, fontSize: 11, fontFace: 'Arial', color: C.gold, bold: true, valign: 'middle' })
    sTh.addText(r[1], { x: 8.85, y, w: 3.85, h: 0.65, fontSize: 10, fontFace: 'Arial', color: C.white, wrap: true, valign: 'middle', lineSpacingMultiple: 1.3 })
  })

  // ═══ NEW SLIDE: 7 focus areas at town hall level ═══
  p++
  const sFa = pptx.addSlide()
  sFa.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(sFa, 'The 7 focus areas the town hall tracks', 'Path 2 in detail. Each focus area carries a configurable response target. Saturation is visible to the facilitator live during PM-2.')
  ftr(sFa, p)

  sFa.addShape('roundRect', { x: 0.5, y: 1.3, w: 7.8, h: 5.7, rectRadius: 0.12, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
  sFa.addShape('rect', { x: 0.5, y: 1.3, w: 7.8, h: 0.5, fill: { color: C.teal }, line: { color: C.teal, width: 0 } })
  sFa.addText('THE 7 FOCUS AREAS  +  SARINA\'S TYPICAL OPENING', { x: 0.7, y: 1.3, w: 7.4, h: 0.5, fontSize: 10.5, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle', charSpacing: 2 })

  const focusAreas = [
    { label: 'Resident profile',           ask: '"Quick context — resident, business owner, commuter through the area, or something else?"' },
    { label: 'Geographic context',         ask: '"What part of Northwest Orange County does this come up for you?"' },
    { label: 'Travel mode',                ask: '"How do you mostly get around — driving, transit, biking, walking, or a mix?"' },
    { label: 'Biggest frustration today',  ask: '"What\'s the biggest transportation frustration for you right now?"' },
    { label: '2050 growth concern',        ask: '"Looking ahead to 2050 — what worries you most about how the area changes?"' },
    { label: 'Priority improvement category', ask: '"Of these six — widening, new roads, safety, intersections, ped/bike, transit — which would make the biggest difference?"' },
    { label: 'Specific locations to flag', ask: '"Any specific intersections or stretches you want the team to look at?"' },
  ]
  focusAreas.forEach(function(f, i) {
    const y = 1.95 + i * 0.66
    sFa.addShape('ellipse', { x: 0.7, y: y + 0.07, w: 0.34, h: 0.34, fill: { color: C.teal }, line: { color: C.teal, width: 0 } })
    sFa.addText(String(i + 1), { x: 0.7, y: y + 0.07, w: 0.34, h: 0.34, fontSize: 11, fontFace: 'Arial', color: C.white, bold: true, align: 'center', valign: 'middle' })
    sFa.addText(f.label, { x: 1.15, y, w: 2.6, h: 0.5, fontSize: 12, fontFace: 'Arial', color: C.navy, bold: true, valign: 'middle' })
    sFa.addText(f.ask,   { x: 3.8, y, w: 4.3, h: 0.62, fontSize: 10.5, fontFace: 'Arial', color: C.mid, italic: true, wrap: true, valign: 'middle', lineSpacingMultiple: 1.25 })
  })

  sFa.addShape('roundRect', { x: 0.7, y: 6.65, w: 7.4, h: 0.3, rectRadius: 0.05, fill: { color: C.gold }, line: { color: C.gold, width: 0 } })
  sFa.addText('+ 2 anchor asks (User type · Priority category) confirmed before closing if not already surfaced.', {
    x: 0.7, y: 6.65, w: 7.4, h: 0.3, fontSize: 10, fontFace: 'Arial', color: C.navy, bold: true, align: 'center', valign: 'middle',
  })

  sFa.addShape('roundRect', { x: 8.45, y: 1.3, w: 4.4, h: 5.7, rectRadius: 0.12, fill: { color: C.navy }, line: { color: C.navy, width: 0 } })
  sFa.addShape('rect', { x: 8.45, y: 1.3, w: 4.4, h: 0.5, fill: { color: C.gold }, line: { color: C.gold, width: 0 } })
  sFa.addText('WHAT THE FACILITATOR SEES', { x: 8.65, y: 1.3, w: 4.0, h: 0.5, fontSize: 10, fontFace: 'Arial', color: C.navy, bold: true, valign: 'middle', charSpacing: 2 })
  sFa.addText('Saturation panel — live during PM-2', { x: 8.65, y: 1.92, w: 4.0, h: 0.3, fontSize: 9.5, fontFace: 'Arial', color: C.tealMid, italic: true, charSpacing: 1.5 })

  const dashRows = [
    ['Resident profile',         'asked per conversation', C.green],
    ['Geographic context',       'on track',               C.green],
    ['Travel mode',              'on track',               C.green],
    ['Biggest frustration',      'on track',               C.green],
    ['2050 growth concern',      'needs nudge',            C.gold],
    ['Priority category',        'asked per conversation', C.green],
    ['Specific locations',       'open — 87 mentions',     C.tealMid],
  ]
  dashRows.forEach(function(r, i) {
    const y = 2.4 + i * 0.5
    sFa.addText(String(r[0]), { x: 8.65, y, w: 2.4, h: 0.4, fontSize: 10, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle' })
    sFa.addShape('roundRect', { x: 11.15, y: y + 0.05, w: 1.55, h: 0.34, rectRadius: 0.04, fill: { color: r[2] as string }, line: { color: r[2] as string, width: 0 } })
    sFa.addText(String(r[1]), { x: 11.15, y: y + 0.05, w: 1.55, h: 0.34, fontSize: 8.5, fontFace: 'Arial', color: C.white, bold: true, align: 'center', valign: 'middle' })
  })

  sFa.addText('Defaults: 5 responses per topic (configurable). Counter advances every time a resident addresses the topic.', {
    x: 8.65, y: 6.05, w: 4.0, h: 0.85, fontSize: 9, fontFace: 'Arial', color: C.slate, italic: true, wrap: true, lineSpacingMultiple: 1.4,
  })

  // ═══ NEW SLIDE: Entities Sarina already recognizes ═══
  p++
  const sEn = pptx.addSlide()
  sEn.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(sEn, 'Entities Sarina already recognizes', 'Extracted from the 5 ingested NOWOCATS documents — 202 total, 71 visible. Grouped here by category.')
  ftr(sEn, p)

  sEn.addShape('roundRect', { x: 0.5, y: 1.28, w: 12.3, h: 0.78, rectRadius: 0.1, fill: { color: C.navy }, line: { color: C.navy, width: 0 } })
  sEn.addText('When a resident mentions any of these — a corridor, an intersection, a program name, an agency — Sarina recognizes it as the entity and the mention rolls up into the cross-resident hotspot map and the stakeholder reporting.', {
    x: 0.7, y: 1.32, w: 11.9, h: 0.7, fontSize: 11.5, fontFace: 'Arial', color: C.white, wrap: true, valign: 'middle', lineSpacingMultiple: 1.35,
  })

  function entCard(x: number, y: number, w: number, h: number, header: string, count: number, items: string[], accent: string) {
    sEn.addShape('roundRect', { x, y, w, h, rectRadius: 0.1, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
    sEn.addShape('rect', { x, y, w, h: 0.42, fill: { color: accent }, line: { color: accent, width: 0 } })
    sEn.addText(header, { x: x + 0.15, y, w: w - 0.3, h: 0.42, fontSize: 10.5, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle', charSpacing: 2 })
    sEn.addText(String(count), { x: x + w - 0.85, y, w: 0.7, h: 0.42, fontSize: 11.5, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle', align: 'right' })
    sEn.addText(items.join('\n'), { x: x + 0.15, y: y + 0.5, w: w - 0.3, h: h - 0.6, fontSize: 10, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.3 })
  }

  const topY = 2.2
  const topH = 2.55
  entCard(0.5, topY, 5.2, topH, 'PLACES (CORRIDORS, ROADS)', 51,
    [
      'US 441 / Orange Blossom Trail · SR 436',
      'Plymouth Sorrento Road · Welch Road',
      'Rock Springs Road · Ocoee Apopka Road',
      'Sadler Road · Jones Avenue · Park Avenue',
      'W Kelly Park Road · Ponkan Road',
      'Wekiwa Springs Road · Hiawassee Road',
      'Apopka · Apopka Community Center',
      'Orange County · City of Apopka',
      'Semoran Boulevard · SR 429',
      '+ 36 more (Binion, Clarcona, Vick, ...)',
    ], C.teal)
  entCard(5.85, topY, 3.6, topH, 'PROGRAMS', 8,
    [
      'NOWOCATS',
      'NEOCATS',
      'Northwest Orange County Areawide',
      '  Transportation Study',
      'Route 44 · Route 106',
      'Route 405 · Route 436N',
    ], C.orange)
  entCard(9.6, topY, 3.25, topH, 'PEOPLE', 5,
    [
      'Babuji Ambikapathy',
      'Christine Moore',
      'Commissioner Moore',
      'Nicola Norton',
      'Natalia Garcia',
    ], C.purple)

  const botY = 4.95
  const botH = 1.85
  entCard(0.5, botY, 5.2, botH, 'ORGANIZATIONS', 3,
    [
      'FDOT (Florida Department of Transportation)',
      'VHB',
      'LYNX',
    ], C.tealMid)
  entCard(5.85, botY, 3.6, botH, 'POLICY', 1,
    [
      'Americans with Disabilities Act',
    ], C.gold)
  entCard(9.6, botY, 3.25, botH, 'EVENT', 1,
    [
      'NOWOCATS Community Meeting series',
    ], C.slate)

  sEn.addText('Re-extractable any time the KB changes. New entities surface automatically when the next NOWOCATS document is ingested. Hatem and other names that appeared less frequently in the corpus sit in the hidden tier (admin can promote to visible).', {
    x: 0.5, y: 6.92, w: 12.3, h: 0.32, fontSize: 9, fontFace: 'Arial', color: C.faint, italic: true, align: 'center', wrap: true,
  })

  // ═══ SLIDE 6 (was slide 14): Visual — Docs → Sarina → Individual + Town Hall ═══
  p++
  const sVi = pptx.addSlide()
  sVi.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(sVi, 'From documents to a smarter room', 'NOWOCATS public materials → one trained agent → engagement at the individual level AND at the panel level')
  ftr(sVi, p)

  const r1Y = 1.3
  sVi.addShape('roundRect', { x: 0.5, y: r1Y, w: 1.1, h: 1.1, rectRadius: 0.08, fill: { color: C.navy }, line: { color: C.navy, width: 0 } })
  sVi.addText('INGEST', { x: 0.5, y: r1Y, w: 1.1, h: 1.1, fontSize: 11, fontFace: 'Arial', color: C.gold, bold: true, align: 'center', valign: 'middle', charSpacing: 2 })

  const docLabels = ['ECR\n(Sept 2025)', 'PM-1 Deck\n(44 slides)', 'PM-1 Q&A\n(28 pairs)', 'PM-1 Posters\n+ Notice', 'PM-2 Postcard\n(Jun 16)']
  docLabels.forEach(function(lbl, i) {
    const x = 1.85 + i * 1.55
    sVi.addShape('roundRect', { x, y: r1Y, w: 1.4, h: 1.1, rectRadius: 0.08, fill: { color: C.white }, line: { color: C.tealLineMid, width: 0.6 } })
    sVi.addText(lbl, { x, y: r1Y, w: 1.4, h: 1.1, fontSize: 9.5, fontFace: 'Arial', color: C.navy, bold: true, align: 'center', valign: 'middle', lineSpacingMultiple: 1.3 })
  })
  sVi.addText('▶', { x: 9.75, y: r1Y + 0.32, w: 0.4, h: 0.46, fontSize: 22, fontFace: 'Arial', color: C.teal, align: 'center' })
  sVi.addShape('roundRect', { x: 10.25, y: r1Y, w: 2.6, h: 1.1, rectRadius: 0.08, fill: { color: C.tealTint }, line: { color: C.teal, width: 0.8 } })
  sVi.addText('Vector store\n(text-embedding-3-small)', { x: 10.25, y: r1Y, w: 2.6, h: 1.1, fontSize: 11, fontFace: 'Arial', color: C.teal, bold: true, align: 'center', valign: 'middle', lineSpacingMultiple: 1.3 })

  const r2Y = 2.6
  sVi.addShape('roundRect', { x: 0.5, y: r2Y, w: 1.1, h: 1.2, rectRadius: 0.08, fill: { color: C.navy }, line: { color: C.navy, width: 0 } })
  sVi.addText('AGENT', { x: 0.5, y: r2Y, w: 1.1, h: 1.2, fontSize: 11, fontFace: 'Arial', color: C.gold, bold: true, align: 'center', valign: 'middle', charSpacing: 2 })

  sVi.addShape('roundRect', { x: 1.85, y: r2Y, w: 3.6, h: 1.2, rectRadius: 0.12, fill: { color: C.navy }, line: { color: C.gold, width: 1.2 } })
  sVi.addText('Sarina', { x: 1.85, y: r2Y + 0.05, w: 3.6, h: 0.6, fontSize: 24, fontFace: 'Arial', color: C.white, bold: true, align: 'center' })
  sVi.addText('NOWOCATS Assistant', { x: 1.85, y: r2Y + 0.62, w: 3.6, h: 0.4, fontSize: 11, fontFace: 'Arial', color: C.tealMid, italic: true, align: 'center' })

  const caps = [
    { label: 'Personality',   sub: 'civic · bilingual',          accent: C.teal },
    { label: 'System Prompt', sub: 'mission + jargon table',     accent: C.orange },
    { label: 'Guardrails',    sub: '5 rules + deflection router', accent: C.purple },
  ]
  caps.forEach(function(c, i) {
    const x = 5.7 + i * 2.45
    sVi.addShape('roundRect', { x, y: r2Y, w: 2.3, h: 1.2, rectRadius: 0.08, fill: { color: C.white }, line: { color: c.accent, width: 0.8 } })
    sVi.addText(c.label, { x, y: r2Y + 0.18, w: 2.3, h: 0.4, fontSize: 12.5, fontFace: 'Arial', color: c.accent, bold: true, align: 'center' })
    sVi.addText(c.sub,   { x, y: r2Y + 0.6,  w: 2.3, h: 0.5, fontSize: 10, fontFace: 'Arial', color: C.mid, italic: true, align: 'center', wrap: true, lineSpacingMultiple: 1.3 })
  })

  sVi.addText('▼', { x: 3.35, y: 3.85, w: 0.6, h: 0.3, fontSize: 16, fontFace: 'Arial', color: C.faint, align: 'center' })
  sVi.addText('▼', { x: 9.05, y: 3.85, w: 0.6, h: 0.3, fontSize: 16, fontFace: 'Arial', color: C.faint, align: 'center' })

  const r3Y = 4.25
  const r3H = 2.45
  sVi.addShape('roundRect', { x: 0.5, y: r3Y, w: 1.1, h: r3H, rectRadius: 0.08, fill: { color: C.navy }, line: { color: C.navy, width: 0 } })
  sVi.addText('ENGAGE', { x: 0.5, y: r3Y, w: 1.1, h: r3H, fontSize: 11, fontFace: 'Arial', color: C.gold, bold: true, align: 'center', valign: 'middle', charSpacing: 2 })

  sVi.addShape('roundRect', { x: 1.85, y: r3Y, w: 4.8, h: r3H, rectRadius: 0.12, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.6 } })
  sVi.addShape('rect', { x: 1.85, y: r3Y, w: 4.8, h: 0.5, fill: { color: C.orange }, line: { color: C.orange, width: 0 } })
  sVi.addText('INDIVIDUAL  —  QR + WIDGET', { x: 2.0, y: r3Y, w: 4.5, h: 0.5, fontSize: 10.5, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle', charSpacing: 2 })
  sVi.addText(
    '· 1:1 conversation per resident\n' +
    '· Themed per-conversation report\n' +
    '· Source attribution (qr | web)\n' +
    '· Individual transcript in the record',
    { x: 2.05, y: r3Y + 0.6, w: 4.5, h: r3H - 0.7, fontSize: 11.5, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.5 }
  )

  sVi.addShape('roundRect', { x: 6.95, y: r3Y, w: 5.9, h: r3H, rectRadius: 0.12, fill: { color: C.navy }, line: { color: C.navy, width: 0 } })
  sVi.addShape('rect', { x: 6.95, y: r3Y, w: 5.9, h: 0.5, fill: { color: C.teal }, line: { color: C.teal, width: 0 } })
  sVi.addText('TOWN HALL LAYER  —  WHAT THE ROOM KNOWS', { x: 7.1, y: r3Y, w: 5.6, h: 0.5, fontSize: 10.5, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle', charSpacing: 2 })
  sVi.addText(
    '· Topic saturation across all residents\n' +
    '· Emergent themes the team didn\'t preload\n' +
    '· Cross-resident sentiment + representative quotes\n' +
    '· Geographic hotspot map (corridors, intersections)\n' +
    '· Live facilitator dashboard during PM-2',
    { x: 7.15, y: r3Y + 0.6, w: 5.55, h: r3H - 0.7, fontSize: 11.5, fontFace: 'Arial', color: C.white, wrap: true, lineSpacingMultiple: 1.45 }
  )

  sVi.addShape('roundRect', { x: 0.5, y: 6.85, w: 12.3, h: 0.32, rectRadius: 0.05, fill: { color: C.gold }, line: { color: C.gold, width: 0 } })
  sVi.addText('Individual = what each resident knows.   Town hall = what the room knows.   Same agent feeds both.', {
    x: 0.5, y: 6.85, w: 12.3, h: 0.32, fontSize: 11, fontFace: 'Arial', color: C.navy, bold: true, align: 'center', valign: 'middle',
  })

  // Write file
  const buffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer
  const out = path.join(homedir(), 'Downloads', `sarina-new-slides-QC-${new Date().toISOString().slice(0, 10)}.pptx`)
  const fs = await import('fs')
  fs.writeFileSync(out, buffer)
  console.log('Wrote:', out)
}

main().catch(function(e) {
  console.error(e)
  process.exit(1)
})
