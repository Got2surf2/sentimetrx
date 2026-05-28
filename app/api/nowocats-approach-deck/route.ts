// GET /api/nowocats-approach-deck
// Approach deck for VHB / Orange County Public Works.
// Pitches the Sarina agent as the PM-2 digital engagement companion for NOWOCATS.

import { NextResponse } from 'next/server'
import PptxGenJS from 'pptxgenjs'
import { requireAdmin } from '@/lib/auth/requireAdmin'

export const dynamic = 'force-dynamic'

const W = 13.33
const H = 7.5

const C = {
  navy:      '0D2B45',
  teal:      '0F7173',
  tealMid:   '4DBFC1',
  tealLight: 'E0F0F0',
  orange:    'E8632A',
  gold:      'E8B84B',
  white:     'FFFFFF',
  slate:     '8FA3AE',
  slateCard: 'F4F7F8',
  ink:       '111827',
  mid:       '374151',
  faint:     '9CA3AF',
  green:     '059669',
  red:       'DC2626',
  purple:    '7C3AED',
  ocBlue:    '1E5BA8',
  // Pre-computed tint variants (PptxGenJS dropped 8-digit hex support, so we
  // can no longer do `C.teal + '25'` for translucent fills).
  tealTint:    'E5F1F1',  // teal at ~15% opacity
  tealLineMid: 'A8D1D2',  // teal at ~50% opacity
  orangeTint:  'FBE6DA',  // orange at ~15% opacity
  purpleTint:  'F4EFFC',  // purple at ~9%  opacity
  purpleLine:  'B59BE5',  // purple at ~38% opacity
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
  slide.addText('Confidential', { x: W / 2 - 1.5, y: H - 0.36, w: 3, h: 0.26, fontSize: 8, color: C.faint, fontFace: 'Arial', align: 'center' })
  slide.addText(String(n), { x: W - 0.9, y: H - 0.36, w: 0.4, h: 0.26, fontSize: 8, color: C.faint, fontFace: 'Arial', align: 'right' })
}

function card(slide: any, x: number, y: number, w: number, h: number, title: string, body: string, accent = C.teal) {
  slide.addShape('roundRect', { x, y, w, h, rectRadius: 0.1, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
  slide.addShape('rect', { x, y, w: 0.06, h, fill: { color: accent } })
  slide.addText(title, { x: x + 0.22, y: y + 0.12, w: w - 0.38, h: 0.42, fontSize: 15, fontFace: 'Arial', color: C.navy, bold: true })
  slide.addText(body, { x: x + 0.22, y: y + 0.57, w: w - 0.38, h: h - 0.7, fontSize: 13, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.4 })
}

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied

  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Datanautix'
  pptx.title = 'NOWOCATS PM-2 Engagement Approach'
  let p = 0

  // ═══ SLIDE 1: Title ═══
  const s1 = pptx.addSlide()
  s1.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.navy } })
  s1.addShape('rect', { x: 0, y: 0, w: 0.22, h: H, fill: { color: C.teal } })
  s1.addShape('rect', { x: 0, y: 3.9, w: W, h: 0.05, fill: { color: C.gold } })
  s1.addText('Sarina', { x: 0.9, y: 0.6, w: 11, h: 1.4, fontSize: 76, fontFace: 'Arial', color: C.white, bold: true })
  s1.addText('A Digital Engagement Companion\nfor NOWOCATS Community Meeting #2', { x: 0.9, y: 2.0, w: 11, h: 1.7, fontSize: 26, fontFace: 'Arial', color: C.tealMid, lineSpacingMultiple: 1.4 })
  s1.addText('A conversational agent that extends NOWOCATS public engagement beyond the open house — reaching residents who can\'t attend, prefer Spanish, or simply want to think before they speak.', {
    x: 0.9, y: 4.1, w: 11, h: 1.0, fontSize: 14, fontFace: 'Arial', color: C.slate, wrap: true, lineSpacingMultiple: 1.5,
  })
  wordmark(s1)
  s1.addText('Prepared for VHB & Orange County Public Works', { x: 0.9, y: H - 1.15, w: 11, h: 0.32, fontSize: 13, fontFace: 'Arial', color: C.white })
  s1.addText(new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), { x: 0.9, y: H - 0.75, w: 4, h: 0.32, fontSize: 12, fontFace: 'Arial', color: C.slate })
  s1.addNotes(
    'Open with this: "We built something specifically for NOWOCATS, drawing on every public document the project team has put out. ' +
    'The goal is to extend the reach of PM-2 — not replace it — by giving residents a way to engage on their own time, in their language, ' +
    'and in a format that doesn\'t require standing up in a room of 200 people."'
  )

  // ═══ SLIDE 2: We've Done the Homework ═══
  p++
  const s2 = pptx.addSlide()
  s2.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s2, 'We\'ve done the homework', 'Everything below was extracted from your public materials — nothing invented')
  ftr(s2, p)

  const homework = [
    { title: 'Study scope, ingested', body: 'NOWOCATS\' 4-phase process, the 2050 horizon, the multimodal framing, the District 2 origin tied to Commissioner Moore, and the inspiration from NEOCATS.', accent: C.teal },
    { title: 'Existing conditions, ingested', body: 'The 44-slide PM-1 technical deck — every failing roadway, every failing intersection, crash data (20 fatalities, 85% in low-light), LTS analysis, transit gaps.', accent: C.orange },
    { title: 'PM-1 Q&A forum, ingested', body: 'All 28 question-and-answer pairs across 12 topic areas. Sarina answers using the project team\'s own wording — not paraphrased, not invented.', accent: C.purple },
    { title: 'PM-2 logistics, ingested', body: 'Date (June 16, 2026), venue (Apopka Community Center), the six recommendation categories, Title VI and ADA contacts, the bilingual outreach already in motion.', accent: C.gold },
  ]
  homework.forEach(function(it, i) {
    const col = i % 2
    const row = Math.floor(i / 2)
    card(s2, 0.5 + col * 6.45, 1.35 + row * 2.95, 6.1, 2.7, it.title, it.body, it.accent)
  })
  s2.addNotes(
    'This slide builds credibility. We did not show up with a generic pitch. We read everything the project has put out, and every fact Sarina cites comes from those materials. ' +
    'For VHB this matters: their reputation rides on what the agent says in public. We\'re telling them upfront, "the source-of-truth is your work, not our imagination."'
  )

  // ═══ SLIDE 3: The Participation Gap ═══
  p++
  const s3 = pptx.addSlide()
  s3.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s3, 'The participation gap', 'PM-2 captures who shows up. The bigger story is who doesn\'t.')
  ftr(s3, p)

  s3.addShape('roundRect', { x: 0.5, y: 1.28, w: 12.3, h: 1.0, rectRadius: 0.1, fill: { color: C.navy }, line: { color: C.navy, width: 0 } })
  s3.addText('A 2-hour open house at the Apopka Community Center is a real engagement event — but it captures one slice of the affected community.', {
    x: 0.7, y: 1.32, w: 11.9, h: 0.92, fontSize: 16, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle', wrap: true,
  })

  const gaps = [
    { title: 'Can\'t attend that night', body: 'Working shifts, parenting, distance from Apopka, mobility limits. Their commute is on US 441 every day — but they\'ll never be in the room.', accent: C.teal },
    { title: 'Spanish-first households', body: 'Orange County already runs the project bilingually — Esther Fernández is the dedicated Spanish lead. The demand is documented. Sarina is bilingual from minute one.', accent: C.orange },
    { title: 'Won\'t speak in public', body: 'The silent residents are often the most affected. They\'ll type a careful response on their phone before they\'ll stand at a microphone.', accent: C.purple },
  ]
  gaps.forEach(function(g, i) {
    card(s3, 0.5 + i * 4.27, 2.55, 4.0, 4.5, g.title, g.body, g.accent)
  })
  s3.addNotes(
    'Three honest reasons residents don\'t make it to the official record. The point is not that the open house is broken — it\'s that the open house is one channel. ' +
    'Sarina is a second channel that operates 24/7 around it, before AND after, and in Spanish. That\'s how you close the gap NEPA-style requirements are asking you to close.'
  )

  // ═══ SLIDE 4: Meet Sarina ═══
  p++
  const s4 = pptx.addSlide()
  s4.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s4, 'Meet Sarina', 'A civic-toned conversational agent — the only QR code on the PM-2 postcard')
  ftr(s4, p)

  // Left: who Sarina is
  s4.addShape('roundRect', { x: 0.5, y: 1.3, w: 6.0, h: 5.75, rectRadius: 0.12, fill: { color: C.navy }, line: { color: C.navy, width: 0 } })
  s4.addText('WHO SHE IS', { x: 0.75, y: 1.5, w: 5.5, h: 0.3, fontSize: 9, fontFace: 'Arial', color: C.tealMid, bold: true, charSpacing: 3 })
  s4.addText('Sarina is the NOWOCATS Assistant. She speaks for the project — not for politicians, not for advocacy groups, not for a developer. Her voice matches the project team\'s own: measured, factual, civic.', {
    x: 0.75, y: 1.9, w: 5.5, h: 1.5, fontSize: 14, fontFace: 'Arial', color: C.white, wrap: true, lineSpacingMultiple: 1.5,
  })
  s4.addText('She runs on Sentimetrx — the agent platform behind every conversational deployment we run for public-engagement clients. Multilingual, accessible by phone QR scan, no app install, no account creation.', {
    x: 0.75, y: 3.5, w: 5.5, h: 1.7, fontSize: 14, fontFace: 'Arial', color: C.slate, wrap: true, lineSpacingMultiple: 1.5,
  })
  s4.addText('Available from the day the postcard mails through two weeks after PM-2.', {
    x: 0.75, y: 5.5, w: 5.5, h: 1.4, fontSize: 14, fontFace: 'Arial', color: C.tealMid, italic: true, wrap: true, lineSpacingMultiple: 1.4,
  })

  // Right: at-a-glance facts
  s4.addShape('roundRect', { x: 6.85, y: 1.3, w: 6.0, h: 5.75, rectRadius: 0.12, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
  s4.addText('AT A GLANCE', { x: 7.1, y: 1.5, w: 5.5, h: 0.3, fontSize: 9, fontFace: 'Arial', color: C.teal, bold: true, charSpacing: 3 })

  const facts = [
    ['Deployment', 'QR code on PM-2 postcard, signage at open house, project website'],
    ['Languages', 'English + Spanish from first message'],
    ['Identity', 'No login. No account. No personal information collected.'],
    ['Knowledge', 'NOWOCATS public materials only — RAG-backed, source-cited'],
    ['Output', 'Themed feedback report + raw transcript for the official PM-2 record'],
    ['Build window', '3–4 working days from final spec approval'],
  ]
  facts.forEach(function(row, i) {
    const y = 2.0 + i * 0.8
    s4.addShape('rect', { x: 7.1, y, w: 5.5, h: 0.78, fill: { color: i % 2 === 0 ? C.slateCard : C.white }, line: { color: 'F3F4F6', width: 0.3 } })
    s4.addText(row[0], { x: 7.2, y, w: 1.65, h: 0.78, fontSize: 11, fontFace: 'Arial', color: C.navy, bold: true, valign: 'middle' })
    s4.addText(row[1], { x: 8.9, y, w: 3.85, h: 0.78, fontSize: 11.5, fontFace: 'Arial', color: C.mid, valign: 'middle', wrap: true })
  })

  s4.addNotes(
    'Sarina is positioned as part of the NOWOCATS project team, not as a chatbot vendor. She wears the same voice the project team uses in the Q&A forum. ' +
    'The right column is what VHB and county staff will care about operationally — no PII, no logins, knowledge sourced from their own materials, ready in 3-4 days.'
  )

  // ═══ SLIDE 5: How a Conversation Flows ═══
  p++
  const s5 = pptx.addSlide()
  s5.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s5, 'How a conversation flows', 'Two paths, one record — Sarina covers 8 information topics (Path 1) and learns 7 feedback topics (Path 2)')
  ftr(s5, p)

  // Top: opening
  s5.addShape('roundRect', { x: 3.4, y: 1.4, w: 6.55, h: 1.05, rectRadius: 0.12, fill: { color: C.teal }, line: { color: C.teal, width: 0 } })
  s5.addText('OPENING', { x: 3.6, y: 1.5, w: 6.0, h: 0.3, fontSize: 9, fontFace: 'Arial', color: C.tealLight, bold: true, charSpacing: 3 })
  s5.addText('"Hi — I\'m Sarina, the NOWOCATS Assistant. What\'s your first name? And are you here to learn about the study, or share your thoughts?"', {
    x: 3.6, y: 1.78, w: 6.15, h: 0.62, fontSize: 12, fontFace: 'Arial', color: C.white, italic: true, wrap: true, lineSpacingMultiple: 1.35,
  })

  // Branch arrows down
  s5.addText('▼', { x: 2.4, y: 2.55, w: 0.6, h: 0.35, fontSize: 18, fontFace: 'Arial', color: C.faint, align: 'center' })
  s5.addText('▼', { x: 10.35, y: 2.55, w: 0.6, h: 0.35, fontSize: 18, fontFace: 'Arial', color: C.faint, align: 'center' })

  // Two-column paths
  const pathY = 2.95
  const pathH = 3.0

  s5.addShape('roundRect', { x: 0.5, y: pathY, w: 6.05, h: pathH, rectRadius: 0.12, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
  s5.addShape('rect', { x: 0.5, y: pathY, w: 6.05, h: 0.55, fill: { color: C.orange }, line: { color: C.orange, width: 0 } })
  s5.addText('PATH 1 — INFORMATION', { x: 0.7, y: pathY, w: 5.7, h: 0.55, fontSize: 12, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle', charSpacing: 2 })
  s5.addText(
    '· First reply always points to www.nowocats.com for the full project record\n' +
    '· Sarina then answers questions using the PM-1 Q&A + technical deck\n' +
    '· Tracks which of 8 core topics have been touched\n' +
    '· Every 2–3 turns offers a soft transition to feedback\n' +
    '· Around exchange 10, firmer nudge: "before you go, share your thoughts?"',
    { x: 0.75, y: pathY + 0.75, w: 5.5, h: pathH - 0.95, fontSize: 12, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.5 }
  )

  s5.addShape('roundRect', { x: 6.78, y: pathY, w: 6.05, h: pathH, rectRadius: 0.12, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
  s5.addShape('rect', { x: 6.78, y: pathY, w: 6.05, h: 0.55, fill: { color: C.purple }, line: { color: C.purple, width: 0 } })
  s5.addText('PATH 2 — FEEDBACK', { x: 6.98, y: pathY, w: 5.7, h: 0.55, fontSize: 12, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle', charSpacing: 2 })
  s5.addText(
    '· Open conversation — the resident leads, Sarina follows\n' +
    '· She quietly tracks 7 topics and steers toward uncovered ones\n' +
    '· Two anchor asks before closing (who you are + top priority)\n' +
    '· No forms, no chips, no radio buttons — just a conversation\n' +
    '· Closes with the official record acknowledgment',
    { x: 7.03, y: pathY + 0.75, w: 5.5, h: pathH - 0.95, fontSize: 12, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.5 }
  )

  // Bottom: merge to record
  s5.addText('▼', { x: 2.4, y: pathY + pathH + 0.05, w: 0.6, h: 0.35, fontSize: 18, fontFace: 'Arial', color: C.faint, align: 'center' })
  s5.addText('▼', { x: 10.35, y: pathY + pathH + 0.05, w: 0.6, h: 0.35, fontSize: 18, fontFace: 'Arial', color: C.faint, align: 'center' })

  s5.addShape('roundRect', { x: 3.4, y: pathY + pathH + 0.45, w: 6.55, h: 0.75, rectRadius: 0.1, fill: { color: C.navy }, line: { color: C.navy, width: 0 } })
  s5.addText('Response captured for the official PM-2 record', { x: 3.5, y: pathY + pathH + 0.45, w: 6.35, h: 0.75, fontSize: 14, fontFace: 'Arial', color: C.white, bold: true, align: 'center', valign: 'middle' })

  s5.addNotes(
    'This is the architectural slide. Two doors in, one door out. The off-ramp from Path 1 is the key engineering trick — most residents who scan to "learn more" never get asked their opinion. ' +
    'Sarina politely converts them. Everyone ends at the same record so VHB gets a unified dataset, not two separate ones to reconcile.'
  )

  // ═══ SLIDE 6: Path 1 — Information ═══
  p++
  const s6 = pptx.addSlide()
  s6.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s6, 'Path 1 — Information', 'Eight core topics. RAG-backed answers. A graceful off-ramp.')
  ftr(s6, p)

  // Left: the 8 topics
  s6.addShape('roundRect', { x: 0.5, y: 1.3, w: 6.0, h: 5.75, rectRadius: 0.12, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
  s6.addText('THE EIGHT CORE TOPICS', { x: 0.75, y: 1.45, w: 5.5, h: 0.3, fontSize: 9, fontFace: 'Arial', color: C.teal, bold: true, charSpacing: 3 })
  s6.addText('Sarina tracks which of these have come up. Every participant who completes Path 1 has been exposed to all eight.', {
    x: 0.75, y: 1.78, w: 5.5, h: 0.65, fontSize: 11.5, fontFace: 'Arial', color: C.mid, italic: true, wrap: true, lineSpacingMultiple: 1.4,
  })

  const topics = [
    'What NOWOCATS is, and why now',
    'Study area boundaries',
    'Current traffic conditions (LOS, failing segments)',
    '2050 forecasts — no-build vs. build',
    'Multimodal scope (it\'s not only roads)',
    'Programmed vs. planned improvements',
    'Environmental considerations (Wekiva, Lake Apopka)',
    'Decision process — LPA + BCC — and timeline',
  ]
  topics.forEach(function(t, i) {
    const y = 2.55 + i * 0.54
    s6.addShape('ellipse', { x: 0.78, y: y + 0.1, w: 0.22, h: 0.22, fill: { color: C.teal }, line: { color: C.teal, width: 0 } })
    s6.addText(String(i + 1), { x: 0.78, y: y + 0.1, w: 0.22, h: 0.22, fontSize: 9, fontFace: 'Arial', color: C.white, bold: true, align: 'center', valign: 'middle' })
    s6.addText(t, { x: 1.1, y, w: 5.2, h: 0.5, fontSize: 12.5, fontFace: 'Arial', color: C.mid, valign: 'middle' })
  })

  // Right: how the off-ramp works
  s6.addShape('roundRect', { x: 6.85, y: 1.3, w: 6.0, h: 5.75, rectRadius: 0.12, fill: { color: C.navy }, line: { color: C.navy, width: 0 } })
  s6.addText('THE OFF-RAMP', { x: 7.1, y: 1.45, w: 5.5, h: 0.3, fontSize: 9, fontFace: 'Arial', color: C.tealMid, bold: true, charSpacing: 3 })
  s6.addText('Every 2–3 exchanges, Sarina offers a soft transition:', {
    x: 7.1, y: 1.78, w: 5.5, h: 0.4, fontSize: 12, fontFace: 'Arial', color: C.slate, italic: true,
  })

  s6.addShape('roundRect', { x: 7.1, y: 2.3, w: 5.5, h: 1.4, rectRadius: 0.08, fill: { color: C.tealTint }, line: { color: C.tealMid, width: 0.5 } })
  s6.addText('"Happy to keep going. We haven\'t talked about traffic forecasts or environmental review yet — want me to cover either, or are you ready to share your thoughts?"',
    { x: 7.25, y: 2.35, w: 5.25, h: 1.3, fontSize: 12, fontFace: 'Arial', color: C.white, italic: true, wrap: true, lineSpacingMultiple: 1.45 })

  s6.addText('Around exchange 10, if the resident hasn\'t switched, she nudges more firmly:', {
    x: 7.1, y: 3.9, w: 5.5, h: 0.55, fontSize: 12, fontFace: 'Arial', color: C.slate, italic: true, wrap: true, lineSpacingMultiple: 1.4,
  })

  s6.addShape('roundRect', { x: 7.1, y: 4.55, w: 5.5, h: 1.4, rectRadius: 0.08, fill: { color: C.orangeTint }, line: { color: C.orange, width: 0.5 } })
  s6.addText('"Before you go, I\'d hate to miss capturing your perspective. Mind sharing a couple of thoughts? It\'ll go into the official PM-2 record."',
    { x: 7.25, y: 4.6, w: 5.25, h: 1.3, fontSize: 12, fontFace: 'Arial', color: C.white, italic: true, wrap: true, lineSpacingMultiple: 1.45 })

  s6.addText('Goal: every information-seeker ends up contributing to the record.', {
    x: 7.1, y: 6.15, w: 5.5, h: 0.7, fontSize: 12.5, fontFace: 'Arial', color: C.tealMid, bold: true, italic: true, wrap: true, lineSpacingMultiple: 1.4,
  })

  s6.addNotes(
    'The participation-rate engineering happens here. A typical "info bot" lets people leave without ever asking their opinion. Sarina makes that conversion natural, repeated, and timed. ' +
    'The two-quote example shows the exact copy — VHB and county staff can review the tone in advance.'
  )

  // ═══ SLIDE 7: Path 2 — Feedback ═══
  p++
  const s7 = pptx.addSlide()
  s7.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s7, 'Path 2 — Feedback', 'An open conversation — 7 topics tracked quietly, 2 anchor asks before closing')
  ftr(s7, p)

  // Top banner — fluid, not a survey
  s7.addShape('roundRect', { x: 0.5, y: 1.28, w: 12.3, h: 0.95, rectRadius: 0.1, fill: { color: C.purpleTint }, line: { color: C.purpleLine, width: 0.6 } })
  s7.addText('The resident leads. Sarina follows their thread, asks natural follow-ups, and quietly tracks which of 7 topics have been covered. Before closing she ensures 2 anchor questions are answered — the only structured fields VHB needs for cross-resident analysis.', {
    x: 0.7, y: 1.32, w: 11.9, h: 0.88, fontSize: 12, fontFace: 'Arial', color: C.purple, valign: 'middle', wrap: true, lineSpacingMultiple: 1.4,
  })

  // LEFT: 7 topics to cover (conversationally)
  s7.addShape('roundRect', { x: 0.5, y: 2.4, w: 7.5, h: 4.6, rectRadius: 0.12, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
  s7.addShape('rect', { x: 0.5, y: 2.4, w: 7.5, h: 0.5, fill: { color: C.teal }, line: { color: C.teal, width: 0 } })
  s7.addText('7 TOPICS SARINA ENSURES GET COVERED', { x: 0.7, y: 2.4, w: 7.1, h: 0.5, fontSize: 11, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle', charSpacing: 2 })
  s7.addText('In any order — extracted from conversation when possible, asked directly only if needed.', {
    x: 0.7, y: 2.96, w: 7.1, h: 0.4, fontSize: 10.5, fontFace: 'Arial', color: C.mid, italic: true, wrap: true,
  })

  const topics7 = [
    'Who they are — resident, business, commuter, other',
    'Where in NW Orange County they live, work, or travel',
    'How they mostly get around — drive, transit, bike, walk',
    'Biggest transportation frustration today',
    '2050 growth concerns (build vs. no-build context)',
    'Top priority improvement category (one of six)',
    'Specific intersection or stretch of road to flag',
  ]
  topics7.forEach(function(t, i) {
    const y = 3.5 + i * 0.48
    s7.addShape('ellipse', { x: 0.7, y: y + 0.08, w: 0.28, h: 0.28, fill: { color: C.teal }, line: { color: C.teal, width: 0 } })
    s7.addText(String(i + 1), { x: 0.7, y: y + 0.08, w: 0.28, h: 0.28, fontSize: 10, fontFace: 'Arial', color: C.white, bold: true, align: 'center', valign: 'middle' })
    s7.addText(t, { x: 1.1, y, w: 6.8, h: 0.45, fontSize: 11.5, fontFace: 'Arial', color: C.mid, valign: 'middle', wrap: true })
  })

  // RIGHT: 2 anchor asks (always explicit before closing)
  s7.addShape('roundRect', { x: 8.2, y: 2.4, w: 4.6, h: 4.6, rectRadius: 0.12, fill: { color: C.navy }, line: { color: C.navy, width: 0 } })
  s7.addShape('rect', { x: 8.2, y: 2.4, w: 4.6, h: 0.5, fill: { color: C.gold }, line: { color: C.gold, width: 0 } })
  s7.addText('2 ANCHOR ASKS BEFORE CLOSING', { x: 8.4, y: 2.4, w: 4.2, h: 0.5, fontSize: 10, fontFace: 'Arial', color: C.navy, bold: true, valign: 'middle', charSpacing: 1.5 })
  s7.addText('The only two structured fields VHB needs every record to have. Asked explicitly if not already surfaced.', {
    x: 8.4, y: 2.96, w: 4.2, h: 0.6, fontSize: 10.5, fontFace: 'Arial', color: C.slate, italic: true, wrap: true, lineSpacingMultiple: 1.3,
  })

  // Anchor 1
  s7.addShape('roundRect', { x: 8.4, y: 3.7, w: 4.2, h: 1.55, rectRadius: 0.08, fill: { color: 'FFFFFF' }, line: { color: C.gold, width: 0.6 } })
  s7.addText('A1 — USER TYPE', { x: 8.55, y: 3.78, w: 4.0, h: 0.28, fontSize: 9, fontFace: 'Arial', color: C.gold, bold: true, charSpacing: 1.5 })
  s7.addText('"Which best describes you — resident, business owner, commuter, or other?"', {
    x: 8.55, y: 4.05, w: 4.0, h: 0.65, fontSize: 11, fontFace: 'Arial', color: C.navy, italic: true, wrap: true, lineSpacingMultiple: 1.35,
  })
  s7.addText('Needed for every demographic cross-tab', { x: 8.55, y: 4.85, w: 4.0, h: 0.32, fontSize: 9, fontFace: 'Arial', color: C.mid, italic: true })

  // Anchor 2
  s7.addShape('roundRect', { x: 8.4, y: 5.35, w: 4.2, h: 1.55, rectRadius: 0.08, fill: { color: 'FFFFFF' }, line: { color: C.gold, width: 0.6 } })
  s7.addText('A2 — PRIORITY CATEGORY', { x: 8.55, y: 5.43, w: 4.0, h: 0.28, fontSize: 9, fontFace: 'Arial', color: C.gold, bold: true, charSpacing: 1.5 })
  s7.addText('"Of these six — widening, new roads, safety, intersections, ped/bike, transit — which would make the biggest difference for you?"', {
    x: 8.55, y: 5.7, w: 4.0, h: 0.95, fontSize: 10, fontFace: 'Arial', color: C.navy, italic: true, wrap: true, lineSpacingMultiple: 1.3,
  })
  s7.addText('Maps directly to VHB\'s Final Study Report buckets', { x: 8.55, y: 6.55, w: 4.0, h: 0.3, fontSize: 9, fontFace: 'Arial', color: C.mid, italic: true })

  s7.addNotes(
    'This is the slide where most pitches lose people because it looks like a form. Ours is not. Sarina starts with "what\'s on your mind about transportation in NW Orange County?" and follows their thread. ' +
    'The 7 topics are a coverage checklist she tracks internally — she gently steers toward uncovered ones when the conversation lulls, but the resident sets the depth and order. ' +
    'The 2 anchor asks are the only structured fields VHB needs every record to carry: user type for cross-tabs, and priority category because those six buckets are how VHB will organize the Final Study Report. ' +
    'Everything else — corridor, mode, frustration, 2050 concern, intersection flag — is value-add prose, automatically themed and entity-tagged downstream. We get the structured data VHB needs AND a real conversation. ' +
    'A high-engagement resident who wants to talk for 5 minutes about the 441/Apopka commute gets to. The current "Q1, Q2, Q3..." design would have cut them off.'
  )

  // ═══ SLIDE 8: Civic Tone & No Fabrication ═══
  p++
  const s8 = pptx.addSlide()
  s8.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s8, 'Civic tone. Zero fabrication.', 'Sarina\'s voice matches the project team\'s — by construction, not by hope')
  ftr(s8, p)

  s8.addShape('roundRect', { x: 0.5, y: 1.28, w: 12.3, h: 1.0, rectRadius: 0.1, fill: { color: C.navy }, line: { color: C.navy, width: 0 } })
  s8.addText('The biggest risk in any public-facing AI is the moment it makes something up. Three guardrails — built into the system prompt, not bolted on after — prevent it.', {
    x: 0.7, y: 1.32, w: 11.9, h: 0.92, fontSize: 14, fontFace: 'Arial', color: C.white, valign: 'middle', wrap: true, lineSpacingMultiple: 1.5,
  })

  const guards = [
    { title: 'No fabricated facts',     body: 'Sarina answers only from the ingested NOWOCATS corpus. If asked something she doesn\'t know, she uses the project team\'s own phrasing: "I\'ll log that for the project team to look further into the specific locations identified from local feedback."', accent: C.teal },
    { title: 'No political positions',  body: 'Sarina never advocates for or against a project, a developer, a politician, or a planning decision. Asked "should we build this?" she redirects to the decision process (LPA + BCC) and elected officials.', accent: C.orange },
    { title: 'No promised outcomes',    body: 'Sarina is clear that NOWOCATS identifies needs — funding and decisions come later through LPA workshops and Board of County Commissioners hearings. She never says "this will happen by [date]."', accent: C.purple },
  ]
  guards.forEach(function(g, i) {
    card(s8, 0.5 + i * 4.27, 2.55, 4.0, 4.5, g.title, g.body, g.accent)
  })

  s8.addNotes(
    'This is the slide VHB will linger on. Their professional reputation is on the line if the agent says something inaccurate to a resident, who then quotes it at the BCC hearing. ' +
    'These three rules are inherited from the language already in the PM-1 Q&A forum — we\'re not making up new policy, we\'re mirroring what Hatem and Babuji already do.'
  )

  // ═══ SLIDE 9: Spanish + ADA + Title VI ═══
  p++
  const s9 = pptx.addSlide()
  s9.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s9, 'Spanish + ADA + Title VI — built in', 'The accessibility commitments already on the postcard, honored by Sarina too')
  ftr(s9, p)

  const access = [
    { title: 'Spanish from the first message', body: 'If a resident writes in Spanish, Sarina responds in Spanish for the entire conversation. No translation friction, no missed nuance. Mirrors the bilingual posture Orange County already maintains through Esther Fernández.', accent: C.teal },
    { title: 'ADA accommodations surfaced', body: 'When a resident mentions accessibility needs, Sarina volunteers Nicola Norton\'s contact (407-836-6568) — exactly as the PM-2 postcard does — so the accommodation request reaches the right person, not Sarina.', accent: C.orange },
    { title: 'Title VI / language services', body: 'For language services beyond Spanish, Sarina refers residents to Natalia Garcia (407-836-7334). The Title VI commitment on the postcard is honored in the digital channel too — not just on paper.', accent: C.purple },
  ]
  access.forEach(function(a, i) {
    card(s9, 0.5 + i * 4.27, 1.35, 4.0, 5.7, a.title, a.body, a.accent)
  })

  s9.addNotes(
    'The postcard already says public participation is "solicited without regard to race, color, national origin, age, sex, religion, income, disability, or familial status." ' +
    'Sarina lives up to that same promise in the digital channel. The contacts cited are the real ones already on the postcard — Sarina is consistent with what the project has already committed to.'
  )

  // ═══ SLIDE 10: What VHB Gets Back ═══
  p++
  const s10 = pptx.addSlide()
  s10.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s10, 'What VHB and Orange County get back', 'Structured input for the Final Study Report — no manual coding required')
  ftr(s10, p)

  const outs = [
    { title: 'Themed response report',         body: 'Every resident response auto-tagged by topic (safety, transit, congestion, environmental, etc.). Sentiment scored per theme. Representative quotes pulled with attribution. Ready for the Final Study Report appendix.', accent: C.teal },
    { title: 'Geographic hot-spot map',        body: 'Free-text mentions of corridors and intersections are entity-tagged and aggregated. The output is a heat map of where concern is concentrated — directly usable for the prioritized 2050 needs plan.', accent: C.orange },
    { title: 'Verbatim transcript archive',    body: 'Every full conversation preserved with timestamp, language, and topic mapping. Structured for the administrative record — both the LPA workshop and BCC public hearing.', accent: C.purple },
    { title: 'Stakeholder-ready slide deck',   body: 'One-click branded presentation: executive summary, theme slides, demographic breakdowns, top quotes. Generated automatically — ready the morning after PM-2.', accent: C.gold },
  ]
  outs.forEach(function(o, i) {
    const col = i % 2
    const row = Math.floor(i / 2)
    card(s10, 0.5 + col * 6.45, 1.35 + row * 2.85, 6.1, 2.6, o.title, o.body, o.accent)
  })

  s10.addNotes(
    'The pitch here: digital feedback usually creates a pile of unstructured comments somebody has to read through. We invert that. ' +
    'You get the synthesis on day one — themed, geo-tagged, quoted — and the raw transcript is there if you need to drill in.'
  )

  // ═══ SLIDE 11: What's in Sarina's brain — KB sources ═══
  p++
  const sKb = pptx.addSlide()
  sKb.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(sKb, 'What\'s in Sarina\'s brain', 'Five public NOWOCATS documents. Chunked, embedded, source-cited. Nothing beyond them.')
  ftr(sKb, p)

  const kbDocs = [
    {
      title: 'Existing Conditions Report',
      meta:  'September 2025  ·  Study Report',
      body:  '143.8 sq mi study area. 44 intersections + 27 roadway segments evaluated. 2025 baseline + 2050 build vs no-build forecasts. Multimodal — roads, transit, bike/ped, freight.',
      accent: C.teal,
    },
    {
      title: 'PM-1 Community Meeting Presentation',
      meta:  'Jan 26 & 28, 2026  ·  44 slides',
      body:  'Study purpose, existing conditions, programmed vs planned improvements, future conditions, timeline, engagement. Hatem (Orange County) + Babuji (VHB) ingested as project contacts.',
      accent: C.orange,
    },
    {
      title: 'PM-1 Q&A Forum',
      meta:  'Verbatim Q&A  ·  28 pairs / 12 topics',
      body:  'Every resident question and project-team response from Community Meeting #1. Sarina cites the team\'s exact wording — not paraphrased, not synthesized.',
      accent: C.purple,
    },
    {
      title: 'PM-1 Posters + Meeting Notice',
      meta:  'Plain-language explainers  ·  Meeting Materials',
      body:  'LOS definitions in resident-friendly language, programmed-vs-planned framing, venue / contact details from the Community Meeting #1 poster set.',
      accent: C.gold,
    },
    {
      title: 'PM-2 Postcard',
      meta:  'Meeting #2 Notice  ·  June 16, 2026',
      body:  'Date, time, venue. ADA contact (Nicola Norton, 407-836-6568). Title VI contact (Natalia Garcia, 407-836-7334). Bilingual outreach commitment.',
      accent: C.tealMid,
    },
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

  // Sixth cell — RAG mechanics callout (navy)
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

  // Bottom strip — re-ingest commitment
  sKb.addShape('roundRect', { x: 0.5, y: 6.55, w: 12.3, h: 0.5, rectRadius: 0.08, fill: { color: C.gold }, line: { color: C.gold, width: 0 } })
  sKb.addText('PM-2 presentation slides become a sixth document the moment they publish — same pipeline, no rebuild.', {
    x: 0.5, y: 6.55, w: 12.3, h: 0.5, fontSize: 12, fontFace: 'Arial', color: C.navy, bold: true, align: 'center', valign: 'middle',
  })

  sKb.addNotes(
    'This is the slide Babuji will lean in on. Five public documents, chunked at section level, embedded with text-embedding-3-small, retrieved by semantic similarity at query time. ' +
    'Every chunk carries a source label so Sarina knows which document she\'s citing — and the system prompt forces her to ground every answer in retrieved chunks, not in pre-training knowledge. ' +
    'When PM-2 slides drop, they become a sixth document through the same pipeline — no model retraining, no separate code path. ' +
    'For Hatem: nothing in this brain came from outside Orange County / VHB public materials. The corpus is the corpus.'
  )

  // ═══ SLIDE 12: How Sarina is steered — tone, guardrails, off-limits ═══
  p++
  const sSt = pptx.addSlide()
  sSt.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(sSt, 'How Sarina is steered', 'Three explicit knobs control her voice — personality, system prompt, guardrails — plus a deflection router for off-topic asks')
  ftr(sSt, p)

  const knobs = [
    {
      title: 'Personality',
      sub:   'WHO SHE SOUNDS LIKE',
      body:  'Civic. Measured. Neighbor-helpful. Matches the wording Hatem and Babuji already use in the PM-1 Q&A forum. Bilingual from the first message — if the resident writes Spanish, Sarina responds in Spanish the entire conversation.',
      accent: C.teal,
    },
    {
      title: 'System Prompt',
      sub:   'WHAT SHE DOES + HOW SHE SPEAKS',
      body:  'Mission, conversation arc, and a plain-language translation table.\n\nPlain English leads, engineering term in parentheses:\n· essentially stop-and-go in rush hour (LOS F)\n· 0-100 pavement score; <60 is poor (PCI)\n· how comfortable a road feels to walk/bike (LTS)\n· average vehicles per day (AADT)\n20+ acronyms covered.',
      accent: C.orange,
    },
    {
      title: 'Guardrails',
      sub:   'WHAT SHE WILL NOT DO',
      body:  'Explicit rule list applied per-reply:\n1. Answer only from ingested NOWOCATS corpus\n2. No political positions for or against any project\n3. No promised outcomes or timelines beyond PM materials\n4. No funding, budget, or developer commitments\n5. No comparison with other county initiatives',
      accent: C.purple,
    },
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

  // Off-limits strip
  sSt.addShape('roundRect', { x: 0.5, y: 5.95, w: 12.3, h: 1.1, rectRadius: 0.1, fill: { color: C.navy }, line: { color: C.navy, width: 0 } })
  sSt.addText('OFF-LIMITS', { x: 0.7, y: 6.02, w: 2.2, h: 0.34, fontSize: 11, fontFace: 'Arial', color: C.gold, bold: true, charSpacing: 3 })
  sSt.addText(
    'Sarina will not advocate for or against any specific project · will not name a politician favorably or critically · will not promise that any road or improvement will or will not be built · will not opine on funding, land deals, or developer-driven projects · will not discuss matters outside NW Orange County transportation. Off-topic asks are redirected by a deflection router with a configurable message.',
    { x: 2.95, y: 6.02, w: 9.7, h: 0.96, fontSize: 11, fontFace: 'Arial', color: C.white, wrap: true, lineSpacingMultiple: 1.35 }
  )

  sSt.addNotes(
    'For Babuji: these are three separate fields on the bot record — personality, system_prompt, guardrails — plus a deflection router that fires before the main LLM call. ' +
    'The jargon translation table was iterated through multiple passes after we caught LOS F leaking into replies verbatim. Final order: plain English leads, technical term in parens — so the resident understands immediately, but can still match what Sarina said to the technical terminology in other NOWOCATS materials they may have read. ' +
    'For Hatem: the off-limits list is the answer to "what if a resident asks something politically charged?" The deflection router catches it before Sarina answers — she redirects with a configurable message. Reputation risk for VHB and the county is bounded by code, not by hope.'
  )

  // ═══ SLIDE 13: What the town hall wrapper adds ═══
  p++
  const sTh = pptx.addSlide()
  sTh.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(sTh, 'What the town hall wrapper adds', 'Bare Sarina = one resident at a time. The town hall layer pools many residents into one analytical surface.')
  ftr(sTh, p)

  // LEFT — Bare Sarina (1:1)
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

  // RIGHT — Town Hall wrapper
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

  sTh.addNotes(
    'For Hatem this is the budget slide. The 1:1 chat alone is useful — each resident gets a careful conversation and you get a themed report. But with 200+ residents you can\'t read every transcript by hand. ' +
    'The town hall wrapper is the synthesis layer: topic saturation tells you which feedback topics have enough signal to act on, emergent theme detection catches things the project team didn\'t anticipate (a specific corridor concern, a new safety pattern), and the facilitator dashboard is what you watch the night of June 16 — as PM-2 unfolds, you see what the room is actually saying, not just who happens to be at the microphone. ' +
    'For Babuji: same Sarina, same corpus, same guardrails — the wrapper sits on top, not beside. One agent to maintain.'
  )

  // ═══ SLIDE 14: The 7 focus areas + 2 anchor asks at town hall level ═══
  p++
  const sFa = pptx.addSlide()
  sFa.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(sFa, 'The 7 focus areas the town hall tracks', 'Path 2 in detail. Each focus area carries a configurable response target. Saturation is visible to the facilitator live during PM-2.')
  ftr(sFa, p)

  // LEFT — 7 focus areas
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

  // Bottom strip in LEFT — 2 anchor asks reminder
  sFa.addShape('roundRect', { x: 0.7, y: 6.65, w: 7.4, h: 0.3, rectRadius: 0.05, fill: { color: C.gold }, line: { color: C.gold, width: 0 } })
  sFa.addText('+ 2 anchor asks (User type · Priority category) confirmed before closing if not already surfaced.', {
    x: 0.7, y: 6.65, w: 7.4, h: 0.3, fontSize: 10, fontFace: 'Arial', color: C.navy, bold: true, align: 'center', valign: 'middle',
  })

  // RIGHT — Facilitator dashboard mock
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

  sFa.addNotes(
    'For Hatem and Babuji: this is the slide that makes the 7 focus areas concrete. Left column shows them in order, with the kind of question Sarina opens with — these are illustrative; she follows the resident\'s lead, and a single resident may surface multiple focus areas in one message. ' +
    'The 2 anchor asks (user type + priority category) are always confirmed before closing, by explicit ask if Sarina hasn\'t already inferred them from earlier turns. ' +
    'Right column shows what you\'ll be looking at the night of June 16 — a live saturation panel. Targets are configurable per topic; the default is 5 responses. Status labels are illustrative; the actual dashboard renders counters and progress badges per topic. ' +
    'The two "asked per conversation" rows reflect that user-type and priority-category are anchor asks — every conversation is expected to confirm them.'
  )

  // ═══ SLIDE 15: Entities Sarina already recognizes ═══
  p++
  const sEn = pptx.addSlide()
  sEn.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(sEn, 'Entities Sarina already recognizes', 'Extracted from the 5 ingested NOWOCATS documents — 202 total, 71 visible. Grouped here by category.')
  ftr(sEn, p)

  // Top banner — what entities do for the experience
  sEn.addShape('roundRect', { x: 0.5, y: 1.28, w: 12.3, h: 0.78, rectRadius: 0.1, fill: { color: C.navy }, line: { color: C.navy, width: 0 } })
  sEn.addText('When a resident mentions any of these — a corridor, an intersection, a program name, an agency — Sarina recognizes it as the entity and the mention rolls up into the cross-resident hotspot map and the stakeholder reporting.', {
    x: 0.7, y: 1.32, w: 11.9, h: 0.7, fontSize: 11.5, fontFace: 'Arial', color: C.white, wrap: true, valign: 'middle', lineSpacingMultiple: 1.35,
  })

  // Two-row category grid (4 + 2)
  // Top row: Places (wide), Programs, People
  // Bottom row: Organizations, Policy, Event
  function entCard(x: number, y: number, w: number, h: number, header: string, count: number, items: string[], accent: string) {
    sEn.addShape('roundRect', { x, y, w, h, rectRadius: 0.1, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
    sEn.addShape('rect', { x, y, w, h: 0.42, fill: { color: accent }, line: { color: accent, width: 0 } })
    sEn.addText(header, { x: x + 0.15, y, w: w - 0.3, h: 0.42, fontSize: 10.5, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle', charSpacing: 2 })
    sEn.addText(String(count), { x: x + w - 0.85, y, w: 0.7, h: 0.42, fontSize: 11.5, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle', align: 'right' })
    sEn.addText(items.join('\n'), { x: x + 0.15, y: y + 0.5, w: w - 0.3, h: h - 0.6, fontSize: 10, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.3 })
  }

  // Top row
  const topY = 2.2
  const topH = 2.55
  // PLACES — wide column on left
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
  // PROGRAMS — middle
  entCard(5.85, topY, 3.6, topH, 'PROGRAMS', 8,
    [
      'NOWOCATS',
      'NEOCATS',
      'Northwest Orange County Areawide',
      '  Transportation Study',
      'Route 44 · Route 106',
      'Route 405 · Route 436N',
    ], C.orange)
  // PEOPLE — right
  entCard(9.6, topY, 3.25, topH, 'PEOPLE', 5,
    [
      'Babuji Ambikapathy',
      'Christine Moore',
      'Commissioner Moore',
      'Nicola Norton',
      'Natalia Garcia',
    ], C.purple)

  // Bottom row
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

  // Bottom caption
  sEn.addText('Re-extractable any time the KB changes. New entities surface automatically when the next NOWOCATS document is ingested. Hatem and other names that appeared less frequently in the corpus sit in the hidden tier (admin can promote to visible).', {
    x: 0.5, y: 6.92, w: 12.3, h: 0.32, fontSize: 9, fontFace: 'Arial', color: C.faint, italic: true, align: 'center', wrap: true,
  })

  sEn.addNotes(
    'These are real — extracted from Sarina\'s 5 ingested NOWOCATS documents via Haiku entity discovery, cost ~$0.03 for the full run. ' +
    '202 entities total; 71 surfaced more than once and are shown as visible by default. The remaining 131 (hidden) are low-confidence — single mentions. Admin can promote any hidden entity to visible via the /bots/[id]/entities admin page. ' +
    'The point for Babuji: this is what Sarina recognizes today, by name. When a resident says "the 441/SR-50 intersection" or "Wekiwa Springs Road", Sarina ties it to the entity, and across many residents it aggregates into the geographic hotspot map in the town hall layer. ' +
    'For Hatem: notice Babuji is in the People list. Your name (Hatem Abou-Senna) is in the hidden tier — only one mention in PM-1 contacts. We can promote it before launch if you want it surfaced.'
  )

  // ═══ SLIDE 16: Visual — Docs → Sarina → Individual + Town Hall ═══
  p++
  const sVi = pptx.addSlide()
  sVi.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(sVi, 'From documents to a smarter room', 'NOWOCATS public materials → one trained agent → engagement at the individual level AND at the panel level')
  ftr(sVi, p)

  // ── Row 1: INGEST ──────────────────────────────────────────────
  const r1Y = 1.3
  sVi.addShape('roundRect', { x: 0.5, y: r1Y, w: 1.1, h: 1.1, rectRadius: 0.08, fill: { color: C.navy }, line: { color: C.navy, width: 0 } })
  sVi.addText('INGEST', { x: 0.5, y: r1Y, w: 1.1, h: 1.1, fontSize: 11, fontFace: 'Arial', color: C.gold, bold: true, align: 'center', valign: 'middle', charSpacing: 2 })

  const docLabels = ['ECR\n(Sept 2025)', 'PM-1 Deck\n(44 slides)', 'PM-1 Q&A\n(28 pairs)', 'PM-1 Posters\n+ Notice', 'PM-2 Postcard\n(Jun 16)']
  docLabels.forEach(function(lbl, i) {
    const x = 1.85 + i * 1.55
    sVi.addShape('roundRect', { x, y: r1Y, w: 1.4, h: 1.1, rectRadius: 0.08, fill: { color: C.white }, line: { color: C.tealLineMid, width: 0.6 } })
    sVi.addText(lbl, { x, y: r1Y, w: 1.4, h: 1.1, fontSize: 9.5, fontFace: 'Arial', color: C.navy, bold: true, align: 'center', valign: 'middle', lineSpacingMultiple: 1.3 })
  })
  // Arrow into RAG store
  sVi.addText('▶', { x: 9.75, y: r1Y + 0.32, w: 0.4, h: 0.46, fontSize: 22, fontFace: 'Arial', color: C.teal, align: 'center' })
  sVi.addShape('roundRect', { x: 10.25, y: r1Y, w: 2.6, h: 1.1, rectRadius: 0.08, fill: { color: C.tealTint }, line: { color: C.teal, width: 0.8 } })
  sVi.addText('Vector store\n(text-embedding-3-small)', { x: 10.25, y: r1Y, w: 2.6, h: 1.1, fontSize: 11, fontFace: 'Arial', color: C.teal, bold: true, align: 'center', valign: 'middle', lineSpacingMultiple: 1.3 })

  // ── Row 2: AGENT (Sarina) ──────────────────────────────────────
  const r2Y = 2.6
  sVi.addShape('roundRect', { x: 0.5, y: r2Y, w: 1.1, h: 1.2, rectRadius: 0.08, fill: { color: C.navy }, line: { color: C.navy, width: 0 } })
  sVi.addText('AGENT', { x: 0.5, y: r2Y, w: 1.1, h: 1.2, fontSize: 11, fontFace: 'Arial', color: C.gold, bold: true, align: 'center', valign: 'middle', charSpacing: 2 })

  // Sarina center badge
  sVi.addShape('roundRect', { x: 1.85, y: r2Y, w: 3.6, h: 1.2, rectRadius: 0.12, fill: { color: C.navy }, line: { color: C.gold, width: 1.2 } })
  sVi.addText('Sarina', { x: 1.85, y: r2Y + 0.05, w: 3.6, h: 0.6, fontSize: 24, fontFace: 'Arial', color: C.white, bold: true, align: 'center' })
  sVi.addText('NOWOCATS Assistant', { x: 1.85, y: r2Y + 0.62, w: 3.6, h: 0.4, fontSize: 11, fontFace: 'Arial', color: C.tealMid, italic: true, align: 'center' })

  // 3 capability pills
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

  // Down arrow into engagement row
  sVi.addText('▼', { x: 3.35, y: 3.85, w: 0.6, h: 0.3, fontSize: 16, fontFace: 'Arial', color: C.faint, align: 'center' })
  sVi.addText('▼', { x: 9.05, y: 3.85, w: 0.6, h: 0.3, fontSize: 16, fontFace: 'Arial', color: C.faint, align: 'center' })

  // ── Row 3: ENGAGE — two channels ───────────────────────────────
  const r3Y = 4.25
  const r3H = 2.45
  sVi.addShape('roundRect', { x: 0.5, y: r3Y, w: 1.1, h: r3H, rectRadius: 0.08, fill: { color: C.navy }, line: { color: C.navy, width: 0 } })
  sVi.addText('ENGAGE', { x: 0.5, y: r3Y, w: 1.1, h: r3H, fontSize: 11, fontFace: 'Arial', color: C.gold, bold: true, align: 'center', valign: 'middle', charSpacing: 2 })

  // LEFT — Individual channel
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

  // RIGHT — Town Hall layer
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

  // Bottom caption
  sVi.addShape('roundRect', { x: 0.5, y: 6.85, w: 12.3, h: 0.32, rectRadius: 0.05, fill: { color: C.gold }, line: { color: C.gold, width: 0 } })
  sVi.addText('Individual = what each resident knows.   Town hall = what the room knows.   Same agent feeds both.', {
    x: 0.5, y: 6.85, w: 12.3, h: 0.32, fontSize: 11, fontFace: 'Arial', color: C.navy, bold: true, align: 'center', valign: 'middle',
  })

  sVi.addNotes(
    'This is the punchline visual. Read it left-to-right, top-to-bottom. ' +
    'Five public NOWOCATS documents become Sarina in the middle — one agent shaped by personality + system prompt + guardrails. ' +
    'From there Sarina engages residents two ways: individually via the postcard QR or the website chat widget — and at the town hall layer where many individual conversations pool into one analytical surface. ' +
    'The town hall isn\'t another channel — it\'s the synthesis layer on top. You learn things you can only learn by pooling: who in aggregate is concerned about 441 and SR-50, where the room sits on transit versus safety, which themes are emergent versus expected, where the geographic hotspots actually are. ' +
    'Hatem will use the town hall view to decide what to bring to the LPA. Babuji will use it to scope what goes in the Final Study Report. ' +
    'And critically — it\'s ONE agent, ONE corpus, ONE set of guardrails. The wrapper is operationally free once the agent exists.'
  )

  // ═══ SLIDE 17: Recommendation — Sarina on www.nowocats.com ═══
  p++
  const s10b = pptx.addSlide()
  s10b.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s10b, 'Recommendation — Sarina belongs on www.nowocats.com too', 'The QR is one doorway. The project website is a doorway already open every day.')
  ftr(s10b, p)

  // Top rationale banner
  s10b.addShape('roundRect', { x: 0.5, y: 1.28, w: 12.3, h: 1.0, rectRadius: 0.1, fill: { color: C.navy }, line: { color: C.navy, width: 0 } })
  s10b.addText('Every visitor who lands on www.nowocats.com is already asking "what is this project?" — the same question the postcard QR is designed to answer. Embedding Sarina as a chat widget on the project site turns that traffic into conversations instead of static page-reads. Same agent, same RAG corpus, same official record. No second build.', {
    x: 0.7, y: 1.32, w: 11.9, h: 0.92, fontSize: 12, fontFace: 'Arial', color: C.white, valign: 'middle', wrap: true, lineSpacingMultiple: 1.45,
  })

  // Two columns — surfaces
  const surfY = 2.5
  const surfH = 3.4

  // LEFT: Postcard QR
  s10b.addShape('roundRect', { x: 0.5, y: surfY, w: 6.05, h: surfH, rectRadius: 0.12, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
  s10b.addShape('rect', { x: 0.5, y: surfY, w: 6.05, h: 0.55, fill: { color: C.orange }, line: { color: C.orange, width: 0 } })
  s10b.addText('SURFACE 1 — POSTCARD QR', { x: 0.7, y: surfY, w: 5.7, h: 0.55, fontSize: 11, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle', charSpacing: 2 })
  s10b.addText(
    '· Targeted PM-2 outreach — mailed households\n' +
    '· Bounded around the meeting window\n' +
    '· Normal Sarina cadence (Path 1 → Path 2 nudge)\n' +
    '· Conversation tagged source = qr',
    { x: 0.75, y: surfY + 0.75, w: 5.5, h: surfH - 0.95, fontSize: 12.5, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.6 }
  )

  // RIGHT: Website widget
  s10b.addShape('roundRect', { x: 6.78, y: surfY, w: 6.05, h: surfH, rectRadius: 0.12, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
  s10b.addShape('rect', { x: 6.78, y: surfY, w: 6.05, h: 0.55, fill: { color: C.teal }, line: { color: C.teal, width: 0 } })
  s10b.addText('SURFACE 2 — www.nowocats.com WIDGET', { x: 6.98, y: surfY, w: 5.7, h: 0.55, fontSize: 11, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle', charSpacing: 2 })
  s10b.addText(
    '· Ambient site-wide explainer for any visitor\n' +
    '· Always-on — before, during, and after PM-2\n' +
    '· Soft-pedals the feedback nudge (web visitors aren\'t the targeted PM-2 list)\n' +
    '· Conversation tagged source = web',
    { x: 7.03, y: surfY + 0.75, w: 5.5, h: surfH - 0.95, fontSize: 12.5, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.6 }
  )

  // Bottom: one record
  s10b.addShape('roundRect', { x: 3.4, y: surfY + surfH + 0.3, w: 6.55, h: 0.8, rectRadius: 0.1, fill: { color: C.gold }, line: { color: C.gold, width: 0 } })
  s10b.addText('Two surfaces in. One record out. One agent to maintain.', {
    x: 3.5, y: surfY + surfH + 0.3, w: 6.35, h: 0.8, fontSize: 14, fontFace: 'Arial', color: C.navy, bold: true, align: 'center', valign: 'middle',
  })

  s10b.addNotes(
    'Pause on this slide. The postcard QR will deliver targeted engagement, but a project website that already exists is the second-biggest source of "tell me about NOWOCATS" intent. Right now that visitor reads static text and leaves. ' +
    'With Sarina embedded as a chat widget, they get a conversation — and if they express any feedback intent, they end up in the same official record. ' +
    'Critically: we are NOT proposing a second bot. Same Sarina, same corpus, same system prompt with one conditional that soft-pedals the feedback nudge for web visitors (since they were not specifically invited to PM-2). One agent, one dataset, two doorways. The marginal cost is the embed — that\'s it. ' +
    'For VHB the win is clean attribution: every record has a source field, so you can report "X% of engagement came via the postcard, Y% via the website" in the Final Study Report.'
  )

  // ═══ SLIDE 18: Timeline + What We Need ═══
  p++
  const s11 = pptx.addSlide()
  s11.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s11, 'Timeline + what we need from VHB', 'PM-2 is June 16. We can be live for the postcard mail-out.')
  ftr(s11, p)

  // Top: timeline strip
  const tlY = 1.35
  const phases = [
    { label: 'GREEN LIGHT',  date: 'Day 0',  body: 'Spec + Qs approved' },
    { label: 'BUILD',         date: 'Day 1–3', body: 'Sarina configured, RAG loaded, system prompt set' },
    { label: 'TEST',          date: 'Day 4',  body: 'VHB review · tone tuning · final copy' },
    { label: 'LIVE',          date: 'Pre-mail', body: 'QR code generated, link goes on PM-2 postcard' },
    { label: 'PM-2',          date: 'Jun 16', body: 'Open house — Sarina active in the room and at home' },
    { label: 'RECORD CLOSE',  date: 'Jun 30', body: 'Two-week post-meeting window closes' },
    { label: 'REPORT',        date: 'Jul',    body: 'Themed report + raw transcript delivered to VHB' },
  ]
  const tw = 1.72, tg = 0.07
  phases.forEach(function(ph, i) {
    const x = 0.5 + i * (tw + tg)
    s11.addShape('roundRect', { x, y: tlY, w: tw, h: 1.65, rectRadius: 0.08, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
    s11.addShape('rect', { x, y: tlY, w: tw, h: 0.4, fill: { color: i < 3 ? C.teal : i < 5 ? C.orange : C.purple }, line: { color: C.white, width: 0 } })
    s11.addText(ph.label, { x, y: tlY, w: tw, h: 0.4, fontSize: 9, fontFace: 'Arial', color: C.white, bold: true, align: 'center', valign: 'middle', charSpacing: 1.5 })
    s11.addText(ph.date,  { x, y: tlY + 0.48, w: tw, h: 0.3, fontSize: 11, fontFace: 'Arial', color: C.navy, bold: true, align: 'center' })
    s11.addText(ph.body,  { x: x + 0.1, y: tlY + 0.8, w: tw - 0.2, h: 0.75, fontSize: 10, fontFace: 'Arial', color: C.mid, align: 'center', wrap: true, lineSpacingMultiple: 1.3 })
  })

  // Bottom: what we need from VHB
  const askY = 3.4
  s11.addShape('roundRect', { x: 0.5, y: askY, w: 12.3, h: 3.4, rectRadius: 0.12, fill: { color: C.navy }, line: { color: C.navy, width: 0 } })
  s11.addText('WHAT WE NEED FROM VHB / ORANGE COUNTY', { x: 0.75, y: askY + 0.18, w: 12, h: 0.34, fontSize: 11, fontFace: 'Arial', color: C.tealMid, bold: true, charSpacing: 3 })

  const asks = [
    { n: '1', title: 'Approve the 7 topics + 2 anchor asks',       body: 'Topics covered conversationally; user-type and priority-category asked explicitly. v1 locked to ship; adjustable post-launch.' },
    { n: '2', title: 'Confirm both deployment surfaces',            body: 'Postcard QR + Sarina embedded as a chat widget on www.nowocats.com. Same agent, source-attributed.' },
    { n: '3', title: 'Approve the agent name and persona',         body: 'Currently "Sarina, the NOWOCATS Assistant." Easy to swap.' },
    { n: '4', title: 'PM-2 presentation slides on publication',    body: 'Ingest the moment they go live so Sarina cites the latest 2050 recommendations.' },
  ]
  asks.forEach(function(a, i) {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = 0.7 + col * 6.0
    const y = askY + 0.6 + row * 1.3
    s11.addShape('ellipse', { x, y: y + 0.05, w: 0.42, h: 0.42, fill: { color: C.gold }, line: { color: C.gold, width: 0 } })
    s11.addText(a.n, { x, y: y + 0.05, w: 0.42, h: 0.42, fontSize: 14, fontFace: 'Arial', color: C.navy, bold: true, align: 'center', valign: 'middle' })
    s11.addText(a.title, { x: x + 0.55, y, w: 5.2, h: 0.4, fontSize: 12.5, fontFace: 'Arial', color: C.white, bold: true })
    s11.addText(a.body,  { x: x + 0.55, y: y + 0.42, w: 5.2, h: 0.75, fontSize: 11, fontFace: 'Arial', color: C.slate, wrap: true, lineSpacingMultiple: 1.4 })
  })

  s11.addNotes(
    'Close with the timeline. We can be live before the postcard mails. The four asks are small — a couple of approvals, the website embed (a single script tag on their side), and a heads-up when their PM-2 slides drop. ' +
    'No infrastructure on their side beyond pasting the widget snippet, no contract complications.'
  )

  // ═══ SLIDE 19: Close ═══
  p++
  const s12 = pptx.addSlide()
  s12.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.navy } })
  s12.addShape('rect', { x: 0, y: 0, w: 0.22, h: H, fill: { color: C.teal } })
  s12.addShape('rect', { x: 0, y: 4.25, w: W, h: 0.05, fill: { color: C.gold } })
  s12.addText('NW Orange County\nhas a lot to say about NOWOCATS.', {
    x: 0.9, y: 0.85, w: 11.5, h: 2.2, fontSize: 42, fontFace: 'Arial', color: C.white, bold: true, lineSpacingMultiple: 1.4,
  })
  s12.addText('Most of it will never make it into a 2-hour open house.', {
    x: 0.9, y: 3.05, w: 11.5, h: 0.85, fontSize: 23, fontFace: 'Arial', color: C.tealMid,
  })
  s12.addText('Sarina captures the rest — before, during, and after PM-2.', {
    x: 0.9, y: 4.5, w: 11.5, h: 0.55, fontSize: 18, fontFace: 'Arial', color: C.slate,
  })
  s12.addText('Live in 3–4 working days from green light.', {
    x: 0.9, y: 5.15, w: 11.5, h: 0.5, fontSize: 16, fontFace: 'Arial', color: C.gold, italic: true,
  })
  wordmark(s12)
  s12.addText('datanautix.com', { x: 0.9, y: H - 0.85, w: 4, h: 0.4, fontSize: 13, fontFace: 'Arial', color: C.slate })

  s12.addNotes(
    'Use the silence. Don\'t talk over the close. The point of the deck is to set up the question "do we want to do this?" — let them sit with it for a beat before you ask.'
  )

  const buffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': 'attachment; filename="NOWOCATS-Engagement-Approach.pptx"',
    },
  })
}
