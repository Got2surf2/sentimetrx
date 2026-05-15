// GET /api/pulseiq-deck
// PulseIQ pitch deck for engineering consulting firms that run public engagement sessions.
// Positioned as: useful under specific high-stakes conditions, not universally.

import { NextResponse } from 'next/server'
import PptxGenJS from 'pptxgenjs'
import { requireAdmin } from '@/lib/auth/requireAdmin'

export const dynamic = 'force-dynamic'

const W = 13.33
const H = 7.5

const C = {
  navy:      '0D2B45',
  teal:      '0F7173',
  tealLight: 'D0ECEC',
  orange:    'E8632A',
  orangeLight:'FFF0E8',
  gold:      'E8B84B',
  white:     'FFFFFF',
  slate:     '8FA3AE',
  slateCard: 'F4F7F8',
  ink:       '111827',
  mid:       '374151',
  faint:     '9CA3AF',
  green:     '059669',
  red:       'DC2626',
}

function hdr(slide: any, title: string, sub?: string) {
  slide.addShape('rect', { x: 0, y: 0, w: W, h: 1.1, fill: { color: C.navy } })
  slide.addShape('rect', { x: 0, y: 0, w: 0.07, h: 1.1, fill: { color: C.teal } })
  slide.addShape('rect', { x: 0, y: 1.1, w: W, h: 0.04, fill: { color: C.gold } })
  slide.addText(title, { x: 0.55, y: 0.1, w: 10, h: 0.6, fontSize: 28, fontFace: 'Arial', color: C.white, bold: true })
  if (sub) slide.addText(sub, { x: 0.55, y: 0.65, w: 10, h: 0.35, fontSize: 13, fontFace: 'Arial', color: C.slate })
  wordmark(slide)
}

function wordmark(slide: any, dark = false) {
  slide.addText(
    [
      { text: 'data', options: { color: dark ? C.orange : 'F07040', bold: true, italic: true } },
      { text: 'nautix', options: { color: dark ? C.teal : '4DBFC1', bold: true, italic: true } },
    ],
    { x: W - 2.4, y: 0.15, w: 2.2, h: 0.7, fontSize: 15, valign: 'middle', align: 'right' }
  )
}

function ftr(slide: any, n: number) {
  slide.addText('datanautix.com', { x: 0.5, y: H - 0.38, w: 3.5, h: 0.28, fontSize: 8, color: C.faint, fontFace: 'Arial' })
  slide.addText('Confidential', { x: W / 2 - 1.5, y: H - 0.38, w: 3, h: 0.28, fontSize: 8, color: C.faint, fontFace: 'Arial', align: 'center' })
  slide.addText(String(n), { x: W - 0.9, y: H - 0.38, w: 0.4, h: 0.28, fontSize: 8, color: C.faint, fontFace: 'Arial', align: 'right' })
}

function card2(slide: any, x: number, y: number, w: number, h: number, title: string, body: string, accent = C.teal) {
  slide.addShape('roundRect', { x, y, w, h, rectRadius: 0.1, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
  slide.addShape('rect', { x, y, w: 0.06, h, fill: { color: accent } })
  slide.addText(title, { x: x + 0.22, y: y + 0.12, w: w - 0.38, h: 0.4, fontSize: 15, fontFace: 'Arial', color: C.navy, bold: true })
  slide.addText(body, { x: x + 0.22, y: y + 0.55, w: w - 0.38, h: h - 0.68, fontSize: 13, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.4 })
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
  s1.addText('PulseIQ', { x: 0.9, y: 1.0, w: 11, h: 1.2, fontSize: 64, fontFace: 'Arial', color: C.white, bold: true })
  s1.addText('Community Intelligence for\nHigh-Stakes Project Approvals', { x: 0.9, y: 2.2, w: 11, h: 1.4, fontSize: 26, fontFace: 'Arial', color: '4DBFC1', lineSpacingMultiple: 1.35 })
  s1.addText('For engineering consultants who run public engagement — and need the outcome to go right.', { x: 0.9, y: 4.1, w: 10.5, h: 0.6, fontSize: 15, fontFace: 'Arial', color: C.slate })
  wordmark(s1)
  s1.addText(new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), { x: 0.9, y: H - 1.0, w: 4, h: 0.4, fontSize: 12, fontFace: 'Arial', color: C.slate })

  // ═══ SLIDE 2: Honest Positioning ═══
  p++
  const s2 = pptx.addSlide()
  s2.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s2, 'Not for every project. A few specific ones.')
  ftr(s2, p)

  s2.addText('PulseIQ changes the outcome when three conditions are true:', {
    x: 0.6, y: 1.35, w: 12, h: 0.5, fontSize: 16, fontFace: 'Arial', color: C.mid,
  })

  const conditions = [
    { num: '1', title: 'Organized opposition can kill or delay the permit', body: 'A small vocal group dominates public meetings. The silent majority never shows. The record looks one-sided.' },
    { num: '2', title: 'A legal comment period creates a compliance obligation', body: 'NEPA, SEPA, or state-equivalent mandates require a documented, defensible response to public input. Volume makes this hard.' },
    { num: '3', title: 'You need to know what the community actually thinks — not who showed up', body: 'Attendance at a 7 PM meeting is not a representative sample. QR-based async engagement captures the people who don\'t come.' },
  ]
  conditions.forEach(function(c, i) {
    const y = 2.05 + i * 1.6
    s2.addShape('roundRect', { x: 0.5, y, w: 12.3, h: 1.4, rectRadius: 0.1, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
    s2.addShape('ellipse', { x: 0.75, y: y + 0.4, w: 0.55, h: 0.55, fill: { color: C.teal } })
    s2.addText(c.num, { x: 0.75, y: y + 0.4, w: 0.55, h: 0.55, fontSize: 18, fontFace: 'Arial', color: C.white, bold: true, align: 'center', valign: 'middle' })
    s2.addText(c.title, { x: 1.5, y: y + 0.1, w: 11, h: 0.42, fontSize: 16, fontFace: 'Arial', color: C.navy, bold: true })
    s2.addText(c.body, { x: 1.5, y: y + 0.54, w: 11, h: 0.7, fontSize: 13, fontFace: 'Arial', color: C.mid, wrap: true })
  })

  // ═══ SLIDE 3: The 4 Scenarios Overview ═══
  p++
  const s3 = pptx.addSlide()
  s3.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s3, 'Four scenarios where it matters', 'Each one has derailed or reshaped major projects')
  ftr(s3, p)

  const scenarios = [
    { title: 'Transmission & Substation Siting', body: 'Organized neighbors vs. regional grid reliability. The permit board sees 40 opponents. PulseIQ shows 800 supporters who never attended.' , accent: C.teal },
    { title: 'Highway & Transit Corridor Approvals', body: 'NEPA public comment periods generate thousands of submissions. AI synthesizes themes in minutes — not the six weeks your legal team doesn\'t have.', accent: C.orange },
    { title: 'Industrial Facility Permitting', body: 'Battery storage, solar farms, data centers. Opposition looks overwhelming until PulseIQ isolates it to three blocks. 80% of the broader community is neutral.', accent: '7C3AED' },
    { title: 'Utility Rate Cases & Public Hearings', body: 'Rate commissions require evidence of public input. PulseIQ captures the specific concerns (affordability vs. reliability), letting your client pivot messaging before the hearing.', accent: C.gold },
  ]
  scenarios.forEach(function(sc, i) {
    const col = i % 2
    const row = Math.floor(i / 2)
    card2(s3, 0.5 + col * 6.45, 1.35 + row * 2.9, 6.1, 2.6, sc.title, sc.body, sc.accent)
  })

  // ═══ SLIDE 4: Scenario Deep-Dive — Transmission Line ═══
  p++
  const s4 = pptx.addSlide()
  s4.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s4, 'Scenario: Transmission Line Siting', 'When the meeting room isn\'t the community')
  ftr(s4, p)

  s4.addText('THE SITUATION', { x: 0.6, y: 1.25, w: 4, h: 0.3, fontSize: 9, fontFace: 'Arial', color: C.slate, bold: true, charSpacing: 3 })
  s4.addText('A proposed 500kV corridor through three counties.\n40 organized opponents dominate every public meeting.\nThe permit record looks like unanimous opposition.', {
    x: 0.6, y: 1.55, w: 8, h: 1.4, fontSize: 18, fontFace: 'Arial', color: C.ink, lineSpacingMultiple: 1.5, bold: false,
  })

  s4.addShape('rect', { x: 0.6, y: 3.1, w: 12.1, h: 0.04, fill: { color: 'E5E7EB' } })

  s4.addText('WHAT PULSEIQ FOUND', { x: 0.6, y: 3.25, w: 5, h: 0.3, fontSize: 9, fontFace: 'Arial', color: C.teal, bold: true, charSpacing: 3 })

  const findings = [
    { stat: '340', label: 'async responses collected in parallel with public meetings' },
    { stat: '12:1', label: 'support-to-opposition ratio in the broader community' },
    { stat: '3', label: 'specific concerns surfaced — noise, visual impact, property values' },
  ]
  findings.forEach(function(f, i) {
    const x = 0.6 + i * 4.15
    s4.addShape('roundRect', { x, y: 3.65, w: 3.85, h: 2.4, rectRadius: 0.1, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
    s4.addText(f.stat, { x, y: 3.9, w: 3.85, h: 1.0, fontSize: 54, fontFace: 'Arial', color: C.teal, bold: true, align: 'center' })
    s4.addText(f.label, { x: x + 0.2, y: 4.9, w: 3.45, h: 1.0, fontSize: 13, fontFace: 'Arial', color: C.mid, align: 'center', wrap: true, lineSpacingMultiple: 1.3 })
  })

  // ═══ SLIDE 5: Scenario Deep-Dive — NEPA Comment Period ═══
  p++
  const s5 = pptx.addSlide()
  s5.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s5, 'Scenario: NEPA Public Comment Period', 'When volume defeats compliance')
  ftr(s5, p)

  s5.addText('THE SITUATION', { x: 0.6, y: 1.25, w: 4, h: 0.3, fontSize: 9, fontFace: 'Arial', color: C.slate, bold: true, charSpacing: 3 })
  s5.addText('A highway realignment EIS generates 4,800 written comments\nin a 45-day window. One legal team. One permit deadline.\nNot enough humans to synthesize it in time.', {
    x: 0.6, y: 1.55, w: 9, h: 1.4, fontSize: 18, fontFace: 'Arial', color: C.ink, lineSpacingMultiple: 1.5,
  })

  s5.addShape('rect', { x: 0.6, y: 3.1, w: 12.1, h: 0.04, fill: { color: 'E5E7EB' } })
  s5.addText('WHAT PULSEIQ DELIVERED', { x: 0.6, y: 3.25, w: 5, h: 0.3, fontSize: 9, fontFace: 'Arial', color: C.orange, bold: true, charSpacing: 3 })

  const nepaFindings = [
    { stat: '11', label: 'distinct themes identified from 4,800 submissions' },
    { stat: '20 min', label: 'to produce a defensible theme summary with representative quotes' },
    { stat: '0', label: 'comments ignored — every submission accounted for in the record' },
  ]
  nepaFindings.forEach(function(f, i) {
    const x = 0.6 + i * 4.15
    s5.addShape('roundRect', { x, y: 3.65, w: 3.85, h: 2.4, rectRadius: 0.1, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
    s5.addText(f.stat, { x, y: 3.9, w: 3.85, h: 1.0, fontSize: 48, fontFace: 'Arial', color: C.orange, bold: true, align: 'center' })
    s5.addText(f.label, { x: x + 0.2, y: 4.9, w: 3.45, h: 1.0, fontSize: 13, fontFace: 'Arial', color: C.mid, align: 'center', wrap: true, lineSpacingMultiple: 1.3 })
  })

  // ═══ SLIDE 6: Scenario Deep-Dive — Finding the Real Objection ═══
  p++
  const s6 = pptx.addSlide()
  s6.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s6, 'Scenario: Industrial Facility Siting', 'When you need to know what they\'re actually afraid of')
  ftr(s6, p)

  s6.addText('70% opposed.', { x: 0.6, y: 1.3, w: 12, h: 0.85, fontSize: 42, fontFace: 'Arial', color: C.red, bold: true })
  s6.addText('But to what, exactly?', { x: 0.6, y: 2.1, w: 12, h: 0.65, fontSize: 28, fontFace: 'Arial', color: C.ink })

  s6.addShape('rect', { x: 0.6, y: 2.9, w: 12.1, h: 0.04, fill: { color: 'E5E7EB' } })

  s6.addText('A proposed battery storage facility. Initial community sessions showed strong opposition. PulseIQ ran async engagement across the broader zip codes — and found something different.', {
    x: 0.6, y: 3.05, w: 12, h: 0.7, fontSize: 14, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.4,
  })

  const pivot = [
    { before: 'Assumed fear', after: 'Safety / fire risk' },
    { before: 'Actual fear', after: 'Property values and visual impact' },
    { before: 'Engineering response', after: 'Landscaping berm + underground conduit added' },
    { before: 'Opposition after redesign', after: '28% — down from 70%' },
  ]
  pivot.forEach(function(row, i) {
    const y = 3.9 + i * 0.75
    const bg = i % 2 === 0 ? C.white : C.slateCard
    s6.addShape('rect', { x: 0.6, y, w: 12.1, h: 0.72, fill: { color: bg }, line: { color: 'E5E7EB', width: 0.3 } })
    s6.addText(row.before, { x: 0.75, y, w: 4.5, h: 0.72, fontSize: 13, fontFace: 'Arial', color: C.slate, bold: true, valign: 'middle' })
    s6.addText(row.after, { x: 5.4, y, w: 7, h: 0.72, fontSize: 15, fontFace: 'Arial', color: i === 3 ? C.green : C.ink, bold: i === 3, valign: 'middle' })
  })

  // ═══ SLIDE 7: How It Works ═══
  p++
  const s7 = pptx.addSlide()
  s7.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s7, 'How it works', 'QR code to insight report — no app, no login, no IT project')
  ftr(s7, p)

  const steps = [
    {
      num: '1', title: 'Deploy', color: C.teal,
      lines: ['Generate a QR code or link in minutes', 'Post at the venue, email to the list, share on social', 'No app download. No account. Any device.'],
    },
    {
      num: '2', title: 'Collect', color: C.orange,
      lines: ['AI moderator guides each participant through your discussion topics', 'Asks follow-up questions. Handles multiple languages automatically', 'Runs 24/7 — before, during, and after the public meeting'],
    },
    {
      num: '3', title: 'Analyze', color: '7C3AED',
      lines: ['Themes, sentiment, and representative quotes surface in real time', 'AI-written executive summary ready for the permit record', 'Export CSV, branded PPTX, or shareable dashboard link'],
    },
  ]
  steps.forEach(function(st, i) {
    const x = 0.5 + i * 4.3
    s7.addShape('roundRect', { x, y: 1.35, w: 4.0, h: 5.6, rectRadius: 0.1, fill: { color: C.white }, line: { color: 'E5E7EB', width: 0.5 } })
    s7.addShape('ellipse', { x: x + 1.5, y: 1.65, w: 1.0, h: 1.0, fill: { color: st.color } })
    s7.addText(st.num, { x: x + 1.5, y: 1.65, w: 1.0, h: 1.0, fontSize: 32, fontFace: 'Arial', color: C.white, bold: true, align: 'center', valign: 'middle' })
    s7.addText(st.title, { x, y: 2.85, w: 4.0, h: 0.55, fontSize: 22, fontFace: 'Arial', color: st.color, bold: true, align: 'center' })
    st.lines.forEach(function(line, j) {
      s7.addText('· ' + line, { x: x + 0.2, y: 3.55 + j * 0.85, w: 3.6, h: 0.75, fontSize: 13, fontFace: 'Arial', color: C.mid, wrap: true, lineSpacingMultiple: 1.35 })
    })
  })

  // ═══ SLIDE 8: What You Walk Away With ═══
  p++
  const s8 = pptx.addSlide()
  s8.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.slateCard } })
  hdr(s8, 'What you walk away with', 'Four outputs your team and your client can use')
  ftr(s8, p)

  const outputs = [
    { title: 'Real-Time Sentiment Dashboard', body: 'Live view of themes, sentiment breakdown, and response volume as the session runs. Share with client leadership before the meeting is over.', accent: C.teal },
    { title: 'AI-Synthesized Theme Report', body: 'Every major topic the community raised, with representative quotes, sentiment scores, and how many participants raised it — ready to present.', accent: C.orange },
    { title: 'Legally Defensible Comment Record', body: 'Full transcript of every response with participant ID, timestamp, and topic mapping. Meets NEPA and state-equivalent documentation standards.', accent: '7C3AED' },
    { title: 'Stakeholder PPTX', body: 'One-click branded slide deck. Executive summary, theme slides, demographic breakdowns. Board-ready the morning after the session.', accent: C.gold },
  ]
  outputs.forEach(function(o, i) {
    const col = i % 2
    const row = Math.floor(i / 2)
    card2(s8, 0.5 + col * 6.45, 1.35 + row * 2.9, 6.1, 2.6, o.title, o.body, o.accent)
  })

  // ═══ SLIDE 9: Closing ═══
  p++
  const s9 = pptx.addSlide()
  s9.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.navy } })
  s9.addShape('rect', { x: 0, y: 0, w: 0.22, h: H, fill: { color: C.teal } })
  s9.addShape('rect', { x: 0, y: 4.2, w: W, h: 0.05, fill: { color: C.gold } })
  s9.addText('The community has opinions\nabout your project.', {
    x: 0.9, y: 1.0, w: 11.5, h: 2.0, fontSize: 42, fontFace: 'Arial', color: C.white, bold: true, lineSpacingMultiple: 1.35,
  })
  s9.addText('You decide whether to collect them before the hearing — or after.', {
    x: 0.9, y: 3.1, w: 11.5, h: 0.8, fontSize: 22, fontFace: 'Arial', color: '4DBFC1',
  })
  s9.addText('Let\'s run it on your next contentious project.', {
    x: 0.9, y: 4.35, w: 11.5, h: 0.55, fontSize: 16, fontFace: 'Arial', color: C.slate,
  })
  wordmark(s9)
  s9.addText('datanautix.com', { x: 0.9, y: H - 0.9, w: 4, h: 0.4, fontSize: 13, fontFace: 'Arial', color: C.slate })

  const buffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': 'attachment; filename="PulseIQ-Community-Intelligence.pptx"',
    },
  })
}
