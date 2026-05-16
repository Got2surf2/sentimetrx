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
  hdr(s5, 'How a conversation flows', 'Every resident chooses their own path — both paths end at the official record')
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
    '· Sarina answers questions using the PM-1 Q&A + technical deck\n' +
    '· Tracks which of 8 core topics have been touched\n' +
    '· Every 2–3 turns offers a soft transition to feedback\n' +
    '· Around exchange 10, firmer nudge: "before you go, share your thoughts?"',
    { x: 0.75, y: pathY + 0.75, w: 5.5, h: pathH - 0.95, fontSize: 12.5, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.6 }
  )

  s5.addShape('roundRect', { x: 6.78, y: pathY, w: 6.05, h: pathH, rectRadius: 0.12, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
  s5.addShape('rect', { x: 6.78, y: pathY, w: 6.05, h: 0.55, fill: { color: C.purple }, line: { color: C.purple, width: 0 } })
  s5.addText('PATH 2 — FEEDBACK', { x: 6.98, y: pathY, w: 5.7, h: 0.55, fontSize: 12, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle', charSpacing: 2 })
  s5.addText(
    '· Straight into a guided 7-question conversation\n' +
    '· Each answer is acknowledged before the next question\n' +
    '· Free-text encouraged — no chips, no radio buttons\n' +
    '· Closes with the official record acknowledgment',
    { x: 7.03, y: pathY + 0.75, w: 5.5, h: pathH - 0.95, fontSize: 12.5, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.6 }
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
  hdr(s7, 'Path 2 — Feedback', 'Seven questions, asked conversationally — not as a form')
  ftr(s7, p)

  // Top banner — conversational not survey
  s7.addShape('roundRect', { x: 0.5, y: 1.28, w: 12.3, h: 0.85, rectRadius: 0.1, fill: { color: C.purpleTint }, line: { color: C.purpleLine, width: 0.6 } })
  s7.addText('Conversational by design. Sarina asks one question at a time, acknowledges the answer, and lets the resident elaborate naturally. No chips. No radio buttons. No survey-feel.', {
    x: 0.7, y: 1.32, w: 11.9, h: 0.78, fontSize: 13, fontFace: 'Arial', color: C.purple, valign: 'middle', wrap: true, lineSpacingMultiple: 1.4,
  })

  // Questions list
  const qs = [
    ['Q1', 'Which best describes you?', 'Resident · business owner · commuter · other'],
    ['Q2', 'Where in NW Orange County do you live, work, or travel most?', 'Free-form — captures the corridor context naturally'],
    ['Q3', 'How do you mostly get around?', 'Drive · transit · bike · walk'],
    ['Q4', 'What\'s your biggest transportation frustration today?', 'Free-form — themed and entity-tagged automatically'],
    ['Q5', 'Looking ahead to 2050, what concerns you most about growth?', 'Free-form — anchors responses against the build vs. no-build narrative'],
    ['Q6', 'Of the six improvement categories, which one would make the biggest difference in your daily life?', 'Widening · new roads · safety · intersection · ped/bike · transit'],
    ['Q7', 'A specific intersection or stretch of road to flag? Anything else?', 'Free-form — feeds the geographic hot-spot map for the Final Study Report'],
  ]
  qs.forEach(function(row, i) {
    const y = 2.4 + i * 0.66
    s7.addShape('rect', { x: 0.5, y, w: 12.3, h: 0.64, fill: { color: i % 2 === 0 ? C.white : C.slateCard }, line: { color: 'F3F4F6', width: 0.3 } })
    s7.addShape('ellipse', { x: 0.62, y: y + 0.13, w: 0.4, h: 0.4, fill: { color: C.purple }, line: { color: C.purple, width: 0 } })
    s7.addText(row[0], { x: 0.62, y: y + 0.13, w: 0.4, h: 0.4, fontSize: 10, fontFace: 'Arial', color: C.white, bold: true, align: 'center', valign: 'middle' })
    s7.addText(row[1], { x: 1.2, y, w: 7.5, h: 0.64, fontSize: 12.5, fontFace: 'Arial', color: C.navy, valign: 'middle', bold: true, wrap: true })
    s7.addText(row[2], { x: 8.8, y, w: 3.95, h: 0.64, fontSize: 10.5, fontFace: 'Arial', color: C.mid, italic: true, valign: 'middle', wrap: true })
  })

  s7.addNotes(
    'Walk through each question and explain the why. Q2 is the one that would have been a 25-item picklist in a survey tool. Free-form captures more — "I live in Wekiwa Springs but commute to Apopka on 441" tells you ' +
    'where they live, where they work, and which corridor matters. A picklist would have lost that. Q6 is the only "pick one of six" question because the six improvement categories are how VHB will analyze priorities for the Final Study Report.'
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

  // ═══ SLIDE 11: Timeline + What We Need ═══
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
    { n: '1', title: 'Approve the 7 feedback questions',           body: 'Adjustable any time post-launch — but we need v1 locked to ship.' },
    { n: '2', title: 'Confirm the QR placement',                   body: 'Postcard, signage at the open house, project website. Sole QR target.' },
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
    'Close with the timeline. We can be live before the postcard mails. The four asks are small — a couple of approvals and a heads-up when their PM-2 slides drop. ' +
    'No infrastructure on their side, no contract complications.'
  )

  // ═══ SLIDE 12: Close ═══
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
