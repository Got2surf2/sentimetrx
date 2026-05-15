// GET /api/pulseiq-deck
// PulseIQ pitch for engineering consulting firms that run NEPA public engagement.
// Organized by the three standard NEPA meeting formats.

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

// Two-panel layout used for each meeting-type slide
function meetingSlide(
  pptx: any, title: string, sub: string, pageNum: number,
  sessionPoints: string[], pulsePoints: string[], accent = C.teal
) {
  const s = pptx.addSlide()
  s.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s, title, sub)
  ftr(s, pageNum)

  const panelY = 1.28
  const panelH = H - panelY - 0.5
  const midX   = 6.55

  // Left panel — the session
  s.addShape('roundRect', { x: 0.4, y: panelY, w: midX - 0.65, h: panelH, rectRadius: 0.1, fill: { color: C.navy }, line: { color: C.navy, width: 0 } })
  s.addText('THE SESSION', { x: 0.6, y: panelY + 0.18, w: midX - 1.0, h: 0.3, fontSize: 9, fontFace: 'Arial', color: C.slate, bold: true, charSpacing: 3 })
  sessionPoints.forEach(function(pt, i) {
    s.addText('· ' + pt, { x: 0.65, y: panelY + 0.6 + i * 1.2, w: midX - 1.1, h: 1.1, fontSize: 14, fontFace: 'Arial', color: C.white, wrap: true, lineSpacingMultiple: 1.4 })
  })

  // Right panel — PulseIQ
  s.addShape('roundRect', { x: midX + 0.1, y: panelY, w: W - midX - 0.5, h: panelH, rectRadius: 0.1, fill: { color: accent + '1A' }, line: { color: accent + '50', width: 0.8 } })
  s.addText('WHERE PULSEIQ FITS', { x: midX + 0.3, y: panelY + 0.18, w: W - midX - 0.8, h: 0.3, fontSize: 9, fontFace: 'Arial', color: accent, bold: true, charSpacing: 3 })
  pulsePoints.forEach(function(pt, i) {
    s.addText('→ ' + pt, { x: midX + 0.3, y: panelY + 0.6 + i * 1.2, w: W - midX - 0.75, h: 1.1, fontSize: 14, fontFace: 'Arial', color: C.ink, wrap: true, lineSpacingMultiple: 1.4 })
  })

  return s
}

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied

  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Datanautix'
  pptx.title = 'PulseIQ — Community Intelligence for NEPA Engagement'
  let p = 0

  // ═══ SLIDE 1: Title ═══
  const s1 = pptx.addSlide()
  s1.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.navy } })
  s1.addShape('rect', { x: 0, y: 0, w: 0.22, h: H, fill: { color: C.teal } })
  s1.addShape('rect', { x: 0, y: 3.9, w: W, h: 0.05, fill: { color: C.gold } })
  s1.addText('PulseIQ', { x: 0.9, y: 0.85, w: 11, h: 1.3, fontSize: 68, fontFace: 'Arial', color: C.white, bold: true })
  s1.addText('Community Intelligence\nfor NEPA Engagement', { x: 0.9, y: 2.15, w: 11, h: 1.55, fontSize: 28, fontFace: 'Arial', color: C.tealMid, lineSpacingMultiple: 1.4 })
  s1.addText('Purpose-built for engineering consultants who run open houses, public hearings, and community workshops.', {
    x: 0.9, y: 4.05, w: 10.5, h: 0.65, fontSize: 15, fontFace: 'Arial', color: C.slate, wrap: true,
  })
  wordmark(s1)
  s1.addText(new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), { x: 0.9, y: H - 0.9, w: 4, h: 0.4, fontSize: 12, fontFace: 'Arial', color: C.slate })

  // ═══ SLIDE 2: The Three NEPA Meeting Formats ═══
  p++
  const s2 = pptx.addSlide()
  s2.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s2, 'Three formats. Same underlying problem.', 'NEPA requires meaningful public participation — but the tools haven\'t kept up')
  ftr(s2, p)

  const formats = [
    {
      label: '01', title: 'Open House',
      tag: 'Most common',
      body: 'Stations around the room. Maps, renderings, staff. Comment cards or digital kiosks. Semi-formal, conversational. People self-select what they engage with — and many walk through without saying anything.',
      accent: C.teal,
    },
    {
      label: '02', title: 'Formal Public Hearing',
      tag: 'Legally significant',
      body: 'Structured testimony. 2–5 minutes per speaker. Court reporter. Everything enters the administrative record. Closer to a quasi-legal proceeding than a community conversation. Often politically charged.',
      accent: C.orange,
    },
    {
      label: '03', title: 'Workshop / Charrette',
      tag: 'Early planning',
      body: 'Small group discussions. Table facilitators. Sticky-note exercises, prioritization voting, scenario comparisons. Rich qualitative data — almost all of it lost or inconsistently transcribed.',
      accent: C.purple,
    },
  ]
  formats.forEach(function(f, i) {
    const x = 0.45 + i * 4.3
    s2.addShape('roundRect', { x, y: 1.35, w: 4.05, h: 5.65, rectRadius: 0.12, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
    s2.addShape('roundRect', { x, y: 1.35, w: 4.05, h: 1.1, rectRadius: 0.12, fill: { color: f.accent }, line: { color: f.accent, width: 0 } })
    s2.addShape('rect', { x, y: 1.95, w: 4.05, h: 0.5, fill: { color: f.accent }, line: { color: f.accent, width: 0 } })
    s2.addText(f.label, { x, y: 1.38, w: 4.05, h: 0.4, fontSize: 11, fontFace: 'Arial', color: C.white + '99', bold: true, align: 'center' })
    s2.addText(f.title, { x, y: 1.72, w: 4.05, h: 0.5, fontSize: 22, fontFace: 'Arial', color: C.white, bold: true, align: 'center' })
    s2.addShape('roundRect', { x: x + 0.6, y: 2.6, w: 2.85, h: 0.35, rectRadius: 0.04, fill: { color: f.accent + '25' }, line: { color: f.accent + '60', width: 0.4 } })
    s2.addText(f.tag, { x: x + 0.6, y: 2.6, w: 2.85, h: 0.35, fontSize: 10, fontFace: 'Arial', color: f.accent, bold: true, align: 'center', valign: 'middle' })
    s2.addText(f.body, { x: x + 0.2, y: 3.1, w: 3.65, h: 3.7, fontSize: 12.5, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.45 })
  })

  // ═══ SLIDE 3: Open House ═══
  p++
  meetingSlide(
    pptx,
    'Open House',
    'The most common format — and the one with the biggest participation gap',
    p,
    [
      'Attendees self-select which stations they visit',
      'Comment cards capture only those who stop to write',
      'Staff conversations go unrecorded',
      'No way to reach people who couldn\'t attend that evening',
    ],
    [
      'QR code at every station — capture feedback at the point of interest',
      'Async link extends participation before and after the event',
      'Every comment auto-tagged by topic — no manual sorting',
      'Responses from the room and remote participants in one unified record',
    ],
    C.teal
  )

  // ═══ SLIDE 4: Formal Public Hearing ═══
  p++
  meetingSlide(
    pptx,
    'Formal Public Hearing',
    'The administrative record is built here — and gaps in it become litigation risk',
    p,
    [
      '2–5 minute speaking slots; most affected residents never testify',
      'Court reporter captures spoken testimony only',
      'Agency must respond to every substantive comment on record',
      'High volume of submissions + tight response deadlines',
    ],
    [
      'Pre-hearing engagement captures voices who won\'t stand at a microphone',
      'AI synthesizes all input into themes for the agency response matrix',
      'Full transcript with timestamps, topic mapping, and sentiment scores',
      'Structured export formatted for NEPA administrative record requirements',
    ],
    C.orange
  )

  // ═══ SLIDE 5: Workshop / Charrette ═══
  p++
  meetingSlide(
    pptx,
    'Workshop / Charrette',
    'Rich local knowledge enters the room — and most of it never makes it to the EIS',
    p,
    [
      'Table facilitators capture notes inconsistently',
      'Sticky-note exercises produce data that\'s hard to quantify or cite',
      'Scenario preferences and priority votes rarely get aggregated rigorously',
      'The people at the table aren\'t a representative sample',
    ],
    [
      'Structured digital prompts replace sticky-note exercises — same feel, searchable output',
      'Priority rankings quantified across all participants, not just vocal table members',
      'Every response captured verbatim, timestamped, and attributed to a discussion topic',
      'Data ready for the EIS the next morning — not weeks of manual synthesis',
    ],
    C.purple
  )

  // ═══ SLIDE 6: Traditional vs. PulseIQ ═══
  p++
  const s6 = pptx.addSlide()
  s6.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s6, 'Who actually participates', 'Across all three formats, the structural gap is the same')
  ftr(s6, p)

  s6.addShape('roundRect', { x: 0.5, y: 1.28, w: 5.85, h: 0.55, rectRadius: 0.06, fill: { color: 'FEE2E2' }, line: { color: 'FECACA', width: 0.5 } })
  s6.addText('Traditional Public Engagement', { x: 0.5, y: 1.28, w: 5.85, h: 0.55, fontSize: 14, fontFace: 'Arial', color: C.red, bold: true, align: 'center', valign: 'middle' })

  s6.addShape('ellipse', { x: 6.19, y: 1.3, w: 0.55, h: 0.52, fill: { color: C.navy } })
  s6.addText('VS', { x: 6.19, y: 1.3, w: 0.55, h: 0.52, fontSize: 10, fontFace: 'Arial', color: C.white, bold: true, align: 'center', valign: 'middle' })

  s6.addShape('roundRect', { x: 6.98, y: 1.28, w: 5.85, h: 0.55, rectRadius: 0.06, fill: { color: C.tealLight }, line: { color: '99D4D5', width: 0.5 } })
  s6.addText('With PulseIQ', { x: 6.98, y: 1.28, w: 5.85, h: 0.55, fontSize: 14, fontFace: 'Arial', color: C.teal, bold: true, align: 'center', valign: 'middle' })

  const compRows = [
    { label: 'Who participates',  bad: 'Whoever can attend on a weeknight',                good: 'Anyone with a phone — any time, any location' },
    { label: 'Language',          bad: 'English (translation rarely arranged)',              good: 'Automatically in any language the participant chooses' },
    { label: 'Timing',            bad: 'One window — fixed date and location',              good: 'Before, during, and after the session — 24/7' },
    { label: "What's captured",   bad: 'Verbal comments, manually summarized if at all',    good: 'Full transcript, AI-synthesized, timestamped, exportable' },
    { label: 'The official record', bad: 'Who showed up and who spoke loudest',             good: 'The breadth of the affected community' },
  ]
  compRows.forEach(function(row, i) {
    const y = 2.0 + i * 1.0
    const bg = i % 2 === 0 ? C.white : C.slateCard
    s6.addShape('rect', { x: 0.5, y, w: 12.33, h: 0.96, fill: { color: bg }, line: { color: 'E5E7EB', width: 0.3 } })
    s6.addText(row.label, { x: 0.65, y, w: 2.7, h: 0.96, fontSize: 12, fontFace: 'Arial', color: C.navy, bold: true, valign: 'middle', wrap: true })
    s6.addText('✗  ' + row.bad,  { x: 3.45, y, w: 3.35, h: 0.96, fontSize: 12, fontFace: 'Arial', color: '#991B1B', valign: 'middle', wrap: true })
    s6.addText('✓  ' + row.good, { x: 6.98, y, w: 5.7,  h: 0.96, fontSize: 12, fontFace: 'Arial', color: C.teal,    valign: 'middle', wrap: true })
  })

  // ═══ SLIDE 7: Process Flow ═══
  p++
  const s7 = pptx.addSlide()
  s7.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s7, 'How it works', 'From project kickoff to defensible record — no new infrastructure required')
  ftr(s7, p)

  const steps = [
    { num: '1', label: 'Deploy',  color: C.teal,   points: ['QR code or link — generated in minutes', 'Post at venue, email the mailing list, share on social', 'No app. No account. Any device.'] },
    { num: '2', label: 'Engage',  color: C.orange,  points: ['AI moderator guides each participant through your discussion topics', 'Asks follow-up questions to draw out nuance', 'Runs 24/7 — before, during, and after the session'] },
    { num: '3', label: 'Analyze', color: C.purple,  points: ['Themes surface automatically as responses arrive', 'Sentiment scored per topic', 'Representative quotes extracted and attributed'] },
    { num: '4', label: 'Act',     color: C.navy,    points: ['Real-time dashboard for your team', 'AI-written summary ready for the permit record', 'Export PPTX, CSV, or shareable link'] },
  ]

  const bW = 2.9, bH = 5.0, sX = 0.55, gp = 0.35
  steps.forEach(function(st, i) {
    const x = sX + i * (bW + gp)
    s7.addShape('roundRect', { x, y: 1.35, w: bW, h: bH, rectRadius: 0.12, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
    s7.addShape('roundRect', { x, y: 1.35, w: bW, h: 0.9, rectRadius: 0.12, fill: { color: st.color }, line: { color: st.color, width: 0 } })
    s7.addShape('rect', { x, y: 1.65, w: bW, h: 0.6, fill: { color: st.color }, line: { color: st.color, width: 0 } })
    s7.addText(st.num, { x, y: 1.38, w: bW, h: 0.4, fontSize: 11, fontFace: 'Arial', color: C.white + '99', bold: true, align: 'center' })
    s7.addText(st.label, { x, y: 1.72, w: bW, h: 0.45, fontSize: 20, fontFace: 'Arial', color: C.white, bold: true, align: 'center' })
    st.points.forEach(function(pt, j) {
      s7.addText('· ' + pt, { x: x + 0.18, y: 2.38 + j * 1.2, w: bW - 0.35, h: 1.1, fontSize: 13, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.35 })
    })
    if (i < steps.length - 1) {
      s7.addText('›', { x: x + bW + 0.04, y: 3.3, w: gp + 0.1, h: 0.65, fontSize: 30, fontFace: 'Arial', color: C.faint, align: 'center', valign: 'middle' })
    }
  })

  // ═══ SLIDE 8: Multilingual ═══
  p++
  const s8 = pptx.addSlide()
  s8.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s8, 'Environmental justice starts with language access', 'NEPA requires outreach to affected communities — including non-English speakers')
  ftr(s8, p)

  s8.addShape('roundRect', { x: 0.5, y: 1.28, w: 12.3, h: 1.4, rectRadius: 0.1, fill: { color: C.navy }, line: { color: C.navy, width: 0 } })
  s8.addText('In Florida, 1 in 4 residents speaks a language other than English at home.', {
    x: 0.7, y: 1.32, w: 11.9, h: 1.32, fontSize: 22, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle', wrap: true,
  })
  s8.addText('Spanish, Haitian Creole, Portuguese, Vietnamese. They live in the project corridor. Their property values are affected. A 7 PM English-language meeting does not reach them — and their absence becomes the record.', {
    x: 0.6, y: 2.85, w: 12, h: 0.85, fontSize: 14, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.45,
  })

  const langItems = [
    { title: 'Participant chooses their language at join', body: 'Spanish, Haitian Creole, Portuguese, French, Vietnamese and more. The entire conversation happens in that language — no translation friction, no missed nuance.', accent: C.teal },
    { title: 'Facilitators see everything in English', body: 'All responses auto-translated in real time on the dashboard. One unified view regardless of how many languages are active in the room.', accent: C.orange },
    { title: 'A complete record, not a filtered one', body: 'NEPA\'s environmental justice mandate requires demonstrating outreach to affected communities. PulseIQ closes the gap — and documents that it was closed.', accent: C.purple },
  ]
  langItems.forEach(function(item, i) {
    card(s8, 0.5 + i * 4.3, 3.85, 4.0, 3.18, item.title, item.body, item.accent)
  })

  // ═══ SLIDE 9: Privacy ═══
  p++
  const s9 = pptx.addSlide()
  s9.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s9, 'Privacy by design — not by policy', 'Built for public-facing engagement where trust is the product')
  ftr(s9, p)

  const privItems = [
    { title: 'No PII required', body: 'No name, email, phone, or account creation. Participants join via QR scan or link — nothing identifying is collected or requested.', accent: C.teal },
    { title: 'Anonymous session tokens', body: 'Each participant gets a random session-scoped ID. No linkage to any real-world identity — by system design, not just policy.', accent: C.teal },
    { title: 'Self-reported demographics only', body: 'Optional questions (age range, zip code) are answered by the participant. We never infer, append, or enrich from third-party sources.', accent: C.orange },
    { title: 'Data stays in the platform', body: 'Responses are never shared with third parties or used for advertising. Each organization\'s data is isolated — no cross-client access is architecturally possible.', accent: C.orange },
    { title: 'No AI training on responses', body: 'Participant conversations are never used to train AI models — not ours, not our vendors\'. What participants say stays inside your project record.', accent: C.purple },
    { title: 'Legally defensible record', body: 'Full audit log of every response, timestamp, and topic mapping. Exportable for NEPA and state-equivalent administrative filings.', accent: C.purple },
  ]
  privItems.forEach(function(item, i) {
    const col = i % 3
    const row = Math.floor(i / 3)
    card(s9, 0.4 + col * 4.3, 1.35 + row * 2.9, 4.05, 2.6, item.title, item.body, item.accent)
  })

  // ═══ SLIDE 10: What You Walk Away With ═══
  p++
  const s10 = pptx.addSlide()
  s10.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s10, 'What you walk away with', 'Four outputs your team and your client can use')
  ftr(s10, p)

  const outputs = [
    { title: 'Real-Time Sentiment Dashboard', body: 'Live view of themes, sentiment breakdown, and response volume as the session runs. Share with client leadership before the meeting ends.', accent: C.teal },
    { title: 'AI-Synthesized Theme Report', body: 'Every major topic the community raised — with representative quotes, sentiment scores, and response counts. Ready to present the next morning.', accent: C.orange },
    { title: 'Legally Defensible Comment Record', body: 'Full transcript of every response with participant ID, timestamp, and topic mapping. Structured for NEPA and state-equivalent documentation requirements.', accent: C.purple },
    { title: 'Stakeholder Presentation', body: 'One-click branded slide deck. Executive summary, theme slides, demographic breakdowns, key quotes. Board-ready without manual assembly.', accent: C.gold },
  ]
  outputs.forEach(function(o, i) {
    const col = i % 2
    const row = Math.floor(i / 2)
    card(s10, 0.5 + col * 6.45, 1.35 + row * 2.95, 6.1, 2.65, o.title, o.body, o.accent)
  })

  // ═══ SLIDE 11: Close ═══
  p++
  const s11 = pptx.addSlide()
  s11.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.navy } })
  s11.addShape('rect', { x: 0, y: 0, w: 0.22, h: H, fill: { color: C.teal } })
  s11.addShape('rect', { x: 0, y: 4.25, w: W, h: 0.05, fill: { color: C.gold } })
  s11.addText('The community has opinions\nabout your project.', {
    x: 0.9, y: 0.85, w: 11.5, h: 2.2, fontSize: 44, fontFace: 'Arial', color: C.white, bold: true, lineSpacingMultiple: 1.4,
  })
  s11.addText('You decide whether to collect them before the hearing — or after.', {
    x: 0.9, y: 3.1, w: 11.5, h: 0.85, fontSize: 23, fontFace: 'Arial', color: C.tealMid,
  })
  s11.addText("Let's run it on your next contentious project.", {
    x: 0.9, y: 4.45, w: 11.5, h: 0.55, fontSize: 16, fontFace: 'Arial', color: C.slate,
  })
  wordmark(s11)
  s11.addText('datanautix.com', { x: 0.9, y: H - 0.85, w: 4, h: 0.4, fontSize: 13, fontFace: 'Arial', color: C.slate })

  const buffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': 'attachment; filename="PulseIQ-Community-Intelligence.pptx"',
    },
  })
}
