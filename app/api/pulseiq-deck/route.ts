// GET /api/pulseiq-deck
// PulseIQ pitch for engineering consulting firms that run public engagement.
// Positioned honestly: useful under specific high-stakes conditions.

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
  tealLight: 'D0ECEC',
  orange:    'E8632A',
  gold:      'E8B84B',
  white:     'FFFFFF',
  slate:     '8FA3AE',
  slateCard: 'F4F7F8',
  ink:       '111827',
  mid:       '374151',
  faint:     '9CA3AF',
  green:     '059669',
  greenLight:'D1FAE5',
  red:       'DC2626',
  purple:    '7C3AED',
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
  slide.addText('datanautix.com', { x: 0.5, y: H - 0.36, w: 3.5, h: 0.26, fontSize: 8, color: C.faint, fontFace: 'Arial' })
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
  pptx.title = 'PulseIQ — Community Intelligence for High-Stakes Projects'
  let p = 0

  // ═══ SLIDE 1: Title ═══
  const s1 = pptx.addSlide()
  s1.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.navy } })
  s1.addShape('rect', { x: 0, y: 0, w: 0.22, h: H, fill: { color: C.teal } })
  s1.addShape('rect', { x: 0, y: 3.9, w: W, h: 0.05, fill: { color: C.gold } })
  s1.addText('PulseIQ', { x: 0.9, y: 0.9, w: 11, h: 1.3, fontSize: 68, fontFace: 'Arial', color: C.white, bold: true })
  s1.addText('Community Intelligence for\nHigh-Stakes Project Approvals', { x: 0.9, y: 2.2, w: 11, h: 1.5, fontSize: 26, fontFace: 'Arial', color: C.tealMid, lineSpacingMultiple: 1.4 })
  s1.addText('For engineering consultants who run public engagement — and need the outcome to go right.', { x: 0.9, y: 4.05, w: 10.5, h: 0.6, fontSize: 15, fontFace: 'Arial', color: C.slate })
  wordmark(s1)
  s1.addText(new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), { x: 0.9, y: H - 0.9, w: 4, h: 0.4, fontSize: 12, fontFace: 'Arial', color: C.slate })

  // ═══ SLIDE 2: Honest Positioning ═══
  p++
  const s2 = pptx.addSlide()
  s2.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s2, 'Not for every project. A few specific ones.')
  ftr(s2, p)

  s2.addText('PulseIQ changes the outcome when three conditions are true:', {
    x: 0.6, y: 1.3, w: 12, h: 0.5, fontSize: 16, fontFace: 'Arial', color: C.mid,
  })

  const conditions = [
    { num: '1', title: 'Organized opposition can kill or delay the permit', body: 'A small vocal group dominates public meetings. The silent majority never shows. The record looks one-sided — and it becomes the official record.' },
    { num: '2', title: 'A legal comment period creates a compliance obligation', body: 'NEPA, SEPA, or state equivalents require a documented, defensible response to public input. Volume and tight timelines make this genuinely hard.' },
    { num: '3', title: 'You need to know what the community actually thinks — not who showed up', body: 'Attendance at a 7 PM English-language meeting is not a representative sample. Async digital engagement captures the people who don\'t come.' },
  ]
  conditions.forEach(function(c, i) {
    const y = 2.0 + i * 1.65
    s2.addShape('roundRect', { x: 0.5, y, w: 12.3, h: 1.45, rectRadius: 0.1, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
    s2.addShape('ellipse', { x: 0.78, y: y + 0.43, w: 0.58, h: 0.58, fill: { color: C.teal } })
    s2.addText(c.num, { x: 0.78, y: y + 0.43, w: 0.58, h: 0.58, fontSize: 20, fontFace: 'Arial', color: C.white, bold: true, align: 'center', valign: 'middle' })
    s2.addText(c.title, { x: 1.55, y: y + 0.1, w: 11, h: 0.44, fontSize: 16, fontFace: 'Arial', color: C.navy, bold: true })
    s2.addText(c.body, { x: 1.55, y: y + 0.56, w: 11, h: 0.75, fontSize: 13, fontFace: 'Arial', color: C.mid, wrap: true })
  })

  // ═══ SLIDE 3: Four Scenarios Overview ═══
  p++
  const s3 = pptx.addSlide()
  s3.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s3, 'Where engineering consultants use it', 'Four recurring project types where community dynamics shape the outcome')
  ftr(s3, p)

  const scenarios = [
    { title: 'Transmission & Substation Siting', body: 'Organized opposition from immediate neighbors vs. broader public support for grid reliability. Traditional meetings capture the former — not the latter.', accent: C.teal },
    { title: 'Highway & Transit Corridor Approvals', body: 'NEPA public comment periods generate large submission volumes in tight windows. AI synthesis is the only practical path to a defensible response matrix.', accent: C.orange },
    { title: 'Industrial Facility Permitting', body: 'Battery storage, solar farms, data centers. Opposition often concentrates in a few blocks; the broader community is neutral. Standard meetings won\'t show you that split.', accent: C.purple },
    { title: 'Utility Rate Cases & Public Hearings', body: 'Rate commissions require evidence of genuine public input. Capturing the specific concerns — affordability vs. reliability — lets your client tailor testimony before the hearing.', accent: C.gold },
  ]
  scenarios.forEach(function(sc, i) {
    const col = i % 2
    const row = Math.floor(i / 2)
    card(s3, 0.5 + col * 6.45, 1.35 + row * 2.95, 6.1, 2.65, sc.title, sc.body, sc.accent)
  })

  // ═══ SLIDE 4: Traditional vs. PulseIQ ═══
  p++
  const s4 = pptx.addSlide()
  s4.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s4, 'Who actually participates', 'The structural problem with traditional public engagement')
  ftr(s4, p)

  // Column headers
  s4.addShape('roundRect', { x: 0.5, y: 1.3, w: 5.85, h: 0.55, rectRadius: 0.06, fill: { color: 'FEE2E2' }, line: { color: 'FECACA', width: 0.5 } })
  s4.addText('Traditional Public Meeting', { x: 0.5, y: 1.3, w: 5.85, h: 0.55, fontSize: 15, fontFace: 'Arial', color: C.red, bold: true, align: 'center', valign: 'middle' })

  s4.addShape('roundRect', { x: 6.98, y: 1.3, w: 5.85, h: 0.55, rectRadius: 0.06, fill: { color: C.tealLight }, line: { color: '99D4D5', width: 0.5 } })
  s4.addText('With PulseIQ', { x: 6.98, y: 1.3, w: 5.85, h: 0.55, fontSize: 15, fontFace: 'Arial', color: C.teal, bold: true, align: 'center', valign: 'middle' })

  // VS divider
  s4.addShape('ellipse', { x: 6.19, y: 1.32, w: 0.55, h: 0.52, fill: { color: C.navy } })
  s4.addText('VS', { x: 6.19, y: 1.32, w: 0.55, h: 0.52, fontSize: 10, fontFace: 'Arial', color: C.white, bold: true, align: 'center', valign: 'middle' })

  const rows = [
    { label: 'Who participates', bad: 'Whoever can attend on a weeknight', good: 'Anyone with a phone — at any time' },
    { label: 'Language', bad: 'English (translation rarely arranged)', good: 'Automatically in any language the participant chooses' },
    { label: 'Timing', bad: 'One evening, one location, fixed window', good: 'Before, during, and after — 24 / 7' },
    { label: "What's captured", bad: 'Verbal comments — manually summarized if at all', good: 'Full transcript, AI-synthesized, timestamped, exportable' },
    { label: 'The official record', bad: 'Who showed up and who spoke loudest', good: 'The breadth of the affected community' },
  ]

  rows.forEach(function(row, i) {
    const y = 2.0 + i * 1.02
    const bg = i % 2 === 0 ? C.white : C.slateCard

    // Row background
    s4.addShape('rect', { x: 0.5, y, w: 12.33, h: 0.98, fill: { color: bg }, line: { color: 'E5E7EB', width: 0.3 } })

    // Row label (left quarter)
    s4.addText(row.label, { x: 0.65, y, w: 2.8, h: 0.98, fontSize: 12, fontFace: 'Arial', color: C.navy, bold: true, valign: 'middle', wrap: true })

    // Bad column (middle)
    s4.addText('✗  ' + row.bad, { x: 3.55, y, w: 3.3, h: 0.98, fontSize: 12, fontFace: 'Arial', color: '#991B1B', valign: 'middle', wrap: true })

    // Good column (right)
    s4.addText('✓  ' + row.good, { x: 6.98, y, w: 5.7, h: 0.98, fontSize: 12, fontFace: 'Arial', color: C.teal, valign: 'middle', wrap: true })
  })

  // ═══ SLIDE 5: Process Flow ═══
  p++
  const s5 = pptx.addSlide()
  s5.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s5, 'How it works', 'From project kickoff to defensible record — no new infrastructure required')
  ftr(s5, p)

  const steps = [
    { num: '1', label: 'Deploy', color: C.teal, points: ['Generate a QR code or link in minutes', 'Post at the venue, email the mailing list, share on social', 'No app. No account. Any device.'] },
    { num: '2', label: 'Engage', color: C.orange, points: ['AI moderator guides each participant through your discussion topics', 'Asks follow-up questions to draw out nuance', 'Runs 24/7 — before, during, and after the public meeting'] },
    { num: '3', label: 'Analyze', color: C.purple, points: ['Themes surface automatically as responses arrive', 'Sentiment scored per topic', 'Representative quotes extracted and attributed'] },
    { num: '4', label: 'Act', color: C.navy, points: ['Real-time dashboard for your team', 'AI-written summary ready for the permit record', 'Export PPTX, CSV, or shareable link'] },
  ]

  const boxW = 2.9
  const boxH = 5.0
  const startX = 0.55
  const gap = 0.35

  steps.forEach(function(st, i) {
    const x = startX + i * (boxW + gap)

    // Card
    s5.addShape('roundRect', { x, y: 1.35, w: boxW, h: boxH, rectRadius: 0.12, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })

    // Color top bar
    s5.addShape('roundRect', { x, y: 1.35, w: boxW, h: 0.85, rectRadius: 0.12, fill: { color: st.color }, line: { color: st.color, width: 0 } })
    // Square off the bottom corners of the top bar
    s5.addShape('rect', { x, y: 1.6, w: boxW, h: 0.6, fill: { color: st.color }, line: { color: st.color, width: 0 } })

    // Step number + label
    s5.addText(st.num, { x, y: 1.38, w: boxW, h: 0.45, fontSize: 11, fontFace: 'Arial', color: C.white + 'AA', bold: true, align: 'center' })
    s5.addText(st.label, { x, y: 1.72, w: boxW, h: 0.45, fontSize: 20, fontFace: 'Arial', color: C.white, bold: true, align: 'center' })

    // Bullet points
    st.points.forEach(function(pt, j) {
      s5.addText('· ' + pt, { x: x + 0.18, y: 2.38 + j * 1.2, w: boxW - 0.35, h: 1.1, fontSize: 13, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.35 })
    })

    // Arrow to next step
    if (i < steps.length - 1) {
      const arrowX = x + boxW + 0.06
      s5.addText('›', { x: arrowX, y: 3.35, w: gap + 0.08, h: 0.6, fontSize: 28, fontFace: 'Arial', color: C.faint, align: 'center', valign: 'middle' })
    }
  })

  // ═══ SLIDE 6: Multilingual ═══
  p++
  const s6 = pptx.addSlide()
  s6.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s6, 'Every voice — not just the English-speaking ones', 'Why language access changes who gets heard')
  ftr(s6, p)

  // Big statement
  s6.addShape('roundRect', { x: 0.5, y: 1.3, w: 12.3, h: 1.35, rectRadius: 0.1, fill: { color: C.navy }, line: { color: C.navy, width: 0 } })
  s6.addText('In Florida, 1 in 4 residents speaks a language other than English at home.', {
    x: 0.7, y: 1.35, w: 11.9, h: 1.25, fontSize: 22, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle', wrap: true,
  })

  s6.addText('Spanish, Haitian Creole, Portuguese, Vietnamese. They live in the project corridor. Their property values are affected. They will not come to a 7 PM English-language meeting — and their absence will be used as consent.', {
    x: 0.6, y: 2.82, w: 12, h: 0.85, fontSize: 14, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.45,
  })

  const langItems = [
    { title: 'Participant chooses their language at join', body: 'Spanish, Haitian Creole, Portuguese, French, Vietnamese — and more. The entire conversation happens in that language, with no translation friction.', accent: C.teal },
    { title: 'Facilitators see everything in English', body: 'All responses are auto-translated in real time on the dashboard. Your team manages one unified view regardless of how many languages are active.', accent: C.orange },
    { title: 'The record is complete — not just who happened to show up', body: 'A public comment process that excludes non-English speakers creates legal and reputational exposure. PulseIQ removes that gap by design.', accent: C.purple },
  ]
  langItems.forEach(function(item, i) {
    card(s6, 0.5 + i * 4.3, 3.83, 4.0, 3.22, item.title, item.body, item.accent)
  })

  // ═══ SLIDE 7: Privacy ═══
  p++
  const s7 = pptx.addSlide()
  s7.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s7, 'Privacy by design — not by policy', 'Built for public-facing engagement where trust is the product')
  ftr(s7, p)

  const privacyItems = [
    { title: 'No PII required', body: 'No name. No email. No phone number. No account creation. Participants join with a QR scan or link — nothing identifying is collected or requested.', accent: C.teal },
    { title: 'Anonymous session tokens', body: 'Each participant receives a random session-scoped ID. There is no linkage between the token and any real-world identity — by system design, not just policy.', accent: C.teal },
    { title: 'Self-reported demographics only', body: 'Optional demographic questions (age range, zip code) are answered by the participant. We never infer, append, or enrich from third-party sources.', accent: C.orange },
    { title: 'Data stays in the platform', body: 'Responses are never shared with third parties, sold, or used for advertising. Each organization\'s data is isolated — no cross-client access is architecturally possible.', accent: C.orange },
    { title: 'No AI training on responses', body: 'Participant conversations are never used to train AI models — not ours, not our vendors\'. What participants say stays inside your project record.', accent: C.purple },
    { title: 'Legally defensible record', body: 'Full audit log of every response, timestamp, and topic mapping. Exportable for NEPA and state-equivalent administrative filings. Retained per your data policy.', accent: C.purple },
  ]
  privacyItems.forEach(function(item, i) {
    const col = i % 3
    const row = Math.floor(i / 3)
    card(s7, 0.4 + col * 4.3, 1.35 + row * 2.9, 4.05, 2.6, item.title, item.body, item.accent)
  })

  // ═══ SLIDE 8: What You Walk Away With ═══
  p++
  const s8 = pptx.addSlide()
  s8.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s8, 'What you walk away with', 'Four outputs your team and your client can use')
  ftr(s8, p)

  const outputs = [
    { title: 'Real-Time Sentiment Dashboard', body: 'Live view of themes, sentiment breakdown, and response volume as the session runs. Share with client leadership before the meeting ends.', accent: C.teal },
    { title: 'AI-Synthesized Theme Report', body: 'Every major topic the community raised — with representative quotes, sentiment scores, and response counts. Ready to present the next morning.', accent: C.orange },
    { title: 'Legally Defensible Comment Record', body: 'Full transcript of every response with participant ID, timestamp, and topic mapping. Structured for NEPA and state-equivalent documentation requirements.', accent: C.purple },
    { title: 'Stakeholder Presentation', body: 'One-click branded slide deck. Executive summary, theme slides, demographic breakdowns, key quotes. Board-ready without manual assembly.', accent: C.gold },
  ]
  outputs.forEach(function(o, i) {
    const col = i % 2
    const row = Math.floor(i / 2)
    card(s8, 0.5 + col * 6.45, 1.35 + row * 2.95, 6.1, 2.65, o.title, o.body, o.accent)
  })

  // ═══ SLIDE 9: Close ═══
  p++
  const s9 = pptx.addSlide()
  s9.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.navy } })
  s9.addShape('rect', { x: 0, y: 0, w: 0.22, h: H, fill: { color: C.teal } })
  s9.addShape('rect', { x: 0, y: 4.3, w: W, h: 0.05, fill: { color: C.gold } })
  s9.addText('The community has opinions\nabout your project.', {
    x: 0.9, y: 0.9, w: 11.5, h: 2.2, fontSize: 44, fontFace: 'Arial', color: C.white, bold: true, lineSpacingMultiple: 1.4,
  })
  s9.addText('You decide whether to collect them before the hearing — or after.', {
    x: 0.9, y: 3.15, w: 11.5, h: 0.85, fontSize: 23, fontFace: 'Arial', color: C.tealMid,
  })
  s9.addText('Let\'s run it on your next contentious project.', {
    x: 0.9, y: 4.5, w: 11.5, h: 0.55, fontSize: 16, fontFace: 'Arial', color: C.slate,
  })
  wordmark(s9)
  s9.addText('datanautix.com', { x: 0.9, y: H - 0.85, w: 4, h: 0.4, fontSize: 13, fontFace: 'Arial', color: C.slate })

  const buffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': 'attachment; filename="PulseIQ-Community-Intelligence.pptx"',
    },
  })
}
