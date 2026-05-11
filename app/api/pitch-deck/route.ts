// GET /api/pitch-deck — generates and downloads a Sentimetrx investor pitch deck PPTX

import { NextResponse } from 'next/server'
import PptxGenJS from 'pptxgenjs'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { logDeckDownload } from '@/lib/auth/logDeckDownload'

export const dynamic = 'force-dynamic'

// Brand palette
const DN = {
  teal:       '0F7173',
  tealDark:   '0A4F51',
  navy:       '0D2B45',
  navyMid:    '0F3A54',
  gold:       'E8B84B',
  orange:     'E85A1A',
  ink:        '0D2B45',
  slate:      '8FA3AE',
  slateLight: 'E8EDEF',
  white:      'FFFFFF',
  sarinaBlue: '00B4D8',
  hermesOrange: 'E8632A',
}

const W = 13.33
const H = 7.5

function addHeader(slide: any, title: string) {
  // Dark navy bar at top
  slide.addShape('rect', { x: 0, y: 0, w: W, h: 1.0, fill: { color: DN.navy } })
  slide.addText(title, { x: 0.6, y: 0.15, w: 8, h: 0.7, fontSize: 28, fontFace: 'Arial', color: DN.white, bold: true })
  // Accent line
  slide.addShape('rect', { x: 0, y: 1.0, w: W, h: 0.04, fill: { color: DN.sarinaBlue } })
}

function addFooter(slide: any, pageNum: number) {
  slide.addText('sentimetrx.ai', { x: 0.5, y: H - 0.4, w: 3, h: 0.3, fontSize: 9, color: DN.slate, fontFace: 'Arial' })
  slide.addText(`${pageNum}`, { x: W - 1, y: H - 0.4, w: 0.5, h: 0.3, fontSize: 9, color: DN.slate, fontFace: 'Arial', align: 'right' })
}

function bullet(text: string, opts?: any) {
  return { text, options: { fontSize: 14, fontFace: 'Arial', color: DN.ink, lineSpacing: 24, bullet: { code: '2022' }, ...opts } }
}

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  await logDeckDownload('pitch-deck')

  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Datanautix'
  pptx.title = 'Sentimetrx — Investor Pitch Deck'
  let pg = 0

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 1: TITLE
  // ═══════════════════════════════════════════════════════════════
  const s1 = pptx.addSlide()
  pg++
  s1.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.navy } })
  s1.addText('Sentimetrx', { x: 0.8, y: 1.8, w: 11, h: 1.2, fontSize: 54, fontFace: 'Arial', color: DN.white, bold: true })
  s1.addText('AI-Powered Conversational Feedback Intelligence', { x: 0.8, y: 3.0, w: 11, h: 0.8, fontSize: 22, fontFace: 'Arial', color: DN.sarinaBlue })
  s1.addText('The first platform that collects, understands, and acts on\ncustomer feedback — in one place, in any language.', { x: 0.8, y: 4.2, w: 10, h: 0.9, fontSize: 16, fontFace: 'Arial', color: DN.slate, lineSpacing: 24 })
  // Date strip
  {
    const buildDate = process.env.NEXT_PUBLIC_BUILD_DATE
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    const lastUpdated = buildDate ? fmt(new Date(buildDate)) : fmt(new Date())
    const downloaded = fmt(new Date())
    s1.addText(`Last updated  ${lastUpdated}     ·     Downloaded  ${downloaded}`, {
      x: 0.8, y: 5.5, w: 11, h: 0.35,
      fontSize: 11, fontFace: 'Arial', color: DN.slate, italic: true,
    })
  }
  s1.addText('sentimetrx.ai', { x: 0.8, y: 6.2, w: 5, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.gold, bold: true })
  s1.addShape('rect', { x: 0, y: H - 0.06, w: W, h: 0.06, fill: { color: DN.sarinaBlue } })

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 2: THE PROBLEM
  // ═══════════════════════════════════════════════════════════════
  const s2 = pptx.addSlide()
  pg++
  addHeader(s2, 'The Problem')
  addFooter(s2, pg)
  s2.addText('Response quality is falling. Analysis is getting harder.', { x: 0.6, y: 1.3, w: 12, h: 0.7, fontSize: 24, fontFace: 'Arial', color: DN.hermesOrange, bold: true })

  // Four big problem chips
  const problems = [
    { t: 'Single-digit response rates', c: DN.hermesOrange },
    { t: '"It was fine." "Good." "OK."', c: DN.navy },
    { t: '3–5 separate vendors stitched together', c: DN.teal },
    { t: 'English-only misses the real signal', c: DN.sarinaBlue },
  ]
  problems.forEach((p, i) => {
    const col = i % 2, row = Math.floor(i / 2)
    const x = 0.6 + col * 6.0
    const y = 2.4 + row * 1.7
    s2.addShape('rect', { x, y, w: 5.8, h: 1.4, fill: { color: DN.slateLight }, rectRadius: 0.1 })
    s2.addShape('rect', { x, y, w: 0.18, h: 1.4, fill: { color: p.c } })
    s2.addText(p.t, { x: x + 0.3, y, w: 5.4, h: 1.4, fontSize: 18, fontFace: 'Arial', color: DN.navy, bold: true, valign: 'middle', autoFit: true })
  })
  s2.addText('Enterprise text analytics costs six figures and needs a data science team to operate.', {
    x: 0.6, y: 6.0, w: 12, h: 0.4, fontSize: 13, fontFace: 'Arial', color: DN.slate, italic: true, align: 'center',
  })
  s2.addNotes(
`Frame the problem. Don't pile on — pick two or three pains the audience already feels.

POINTS to weave:
- Survey response rates are in the single digits to low teens, and falling. Guests / customers / employees won't fill out forms anymore.
- The MAJORITY of open-ended responses are too vague to act on. "It was fine." "Good." "OK." Useless at analysis time.
- Companies stitch together 3-5 vendors: SurveyMonkey for collection, Mailchimp for outreach, Clarabridge for text, separate translation vendor, manual reporting.
- Enterprise text analytics platforms (Qualtrics, Medallia, Forsta) cost six figures annually and require a data science team to operate. Mid-market can't afford it; small companies can't operate it.
- Most surveys are English-only — missing the richer feedback non-native speakers give in their own language.

The next slide is the insight that changes the picture.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 3: THE INSIGHT
  // ═══════════════════════════════════════════════════════════════
  const s3 = pptx.addSlide()
  pg++
  addHeader(s3, 'The Insight')
  addFooter(s3, pg)
  s3.addShape('rect', { x: 0.6, y: 1.6, w: 12, h: 2.2, fill: { color: DN.slateLight }, rectRadius: 0.15 })
  s3.addText('The problem isn\'t that people don\'t want to give feedback.\nIt\'s that surveys are a monologue pretending to be a conversation.', {
    x: 1.2, y: 1.8, w: 11, h: 1.0, fontSize: 22, fontFace: 'Arial', color: DN.navy, bold: true, lineSpacing: 32
  })
  s3.addText('When a respondent says "the wait was too long," a traditional survey moves to the next checkbox.\nA human interviewer would say "tell me more about that — how long did you wait?"', {
    x: 1.2, y: 2.9, w: 11, h: 0.8, fontSize: 14, fontFace: 'Arial', color: DN.slate, lineSpacing: 22
  })
  s3.addText('That follow-up is where the insight lives. And until now, it required a human.', {
    x: 0.6, y: 4.4, w: 12, h: 0.5, fontSize: 16, fontFace: 'Arial', color: DN.hermesOrange, bold: true
  })
  s3.addNotes(
`This is the insight slide. Land it slowly.

Say it: "The problem isn't that people don't want to give feedback. It's that surveys are a monologue pretending to be a conversation."

Then the example: "When a respondent says 'the wait was too long,' a traditional survey moves to the next checkbox. A human interviewer would say 'tell me more about that — how long did you wait?'"

Pause.

"That follow-up is where the insight lives. And until now, it required a human."

The whole company is one product application of that insight.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 4: THE SOLUTION
  // ═══════════════════════════════════════════════════════════════
  const s4 = pptx.addSlide()
  pg++
  addHeader(s4, 'The Solution')
  addFooter(s4, pg)
  s4.addText('AI-powered conversations that adapt in real time.', {
    x: 0.6, y: 1.4, w: 12, h: 0.7, fontSize: 26, fontFace: 'Arial', color: DN.sarinaBlue, bold: true, align: 'center',
  })

  // Four big "what we do" chips
  const caps = [
    { t: 'Conversational collection', c: DN.sarinaBlue },
    { t: 'AI clarifiers + deflection', c: DN.teal },
    { t: '15 languages, one click',    c: DN.hermesOrange },
    { t: 'Built-in campaigns',         c: DN.gold },
  ]
  caps.forEach((p, i) => {
    const col = i % 2, row = Math.floor(i / 2)
    const x = 0.6 + col * 6.0
    const y = 2.4 + row * 1.6
    s4.addShape('rect', { x, y, w: 5.8, h: 1.3, fill: { color: p.c }, rectRadius: 0.1 })
    s4.addText(p.t, { x: x + 0.2, y, w: 5.5, h: 1.3, fontSize: 22, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle', autoFit: true })
  })

  s4.addText('One platform. Survey + outreach + analytics + reporting.', {
    x: 0.6, y: 6.0, w: 12, h: 0.6, fontSize: 18, fontFace: 'Arial', color: DN.navy, bold: true, italic: true, align: 'center',
  })
  s4.addNotes(
`The solution. Four capabilities, walked in 60 seconds total.

CONVERSATIONAL COLLECTION: A branded AI agent greets respondents by name and asks questions conversationally. Not a form — a chat.

AI CLARIFIERS + DEFLECTION: The AI detects vague answers and asks intelligent follow-ups to get the WHY. Off-topic questions handled gracefully with smart deflection — stays in your brand voice.

15 LANGUAGES, ONE CLICK: AI translation of the entire study. Respondents answer in their native language. Analysis returns to your team in English.

BUILT-IN CAMPAIGNS: Email outreach is part of the platform. No separate Mailchimp. No separate analytics vendor. No data scientist needed.

CLOSE: "One platform. Survey + outreach + analytics + reporting. That's the difference."`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 5: PRODUCT
  // ═══════════════════════════════════════════════════════════════
  const s5 = pptx.addSlide()
  pg++
  addHeader(s5, 'Product')
  addFooter(s5, pg)
  const cols = [
    { title: 'AI Study Wizard',          color: DN.sarinaBlue },
    { title: 'Conversational Collection', color: DN.teal },
    { title: 'Built-in Campaigns',        color: DN.hermesOrange },
    { title: '15 Languages',              color: DN.gold },
    { title: 'AI Analytics',              color: DN.navy },
  ]
  cols.forEach((col, i) => {
    const x = 0.4 + i * 2.55
    s5.addShape('rect', { x, y: 1.6, w: 2.35, h: 4.8, fill: { color: col.color }, rectRadius: 0.1 })
    s5.addText(col.title, { x: x + 0.1, y: 1.6, w: 2.15, h: 4.8, fontSize: 22, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle', autoFit: true })
  })
  s5.addText('Five capabilities. One platform. No stitching.', {
    x: 0.4, y: 6.6, w: 12.5, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.navy, italic: true, bold: true, align: 'center',
  })
  s5.addNotes(
`Five product columns. Walk them in 90 seconds.

AI STUDY WIZARD: Pick industry + goals, AI generates a complete study. 7 blueprints, 18 industries supported out of the box.

CONVERSATIONAL COLLECTION: Respondents chat with your agent. AI clarifiers probe short answers. 15 question types with skip logic.

BUILT-IN CAMPAIGNS: Rich email templates, merge tags, reminders, tracking. No Mailchimp required.

15 LANGUAGES: One-click AI translation of the whole study. Auto-translate responses back. No translation vendors.

AI ANALYTICS: Theme extraction at scale. Statistical significance testing. Export to PPTX, HTML, CSV. No data scientist required.

The whole stack — collection through reporting — under one login, one bill.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 6: CONVERSATIONAL ADVANTAGE
  // ═══════════════════════════════════════════════════════════════
  const s6 = pptx.addSlide()
  pg++
  addHeader(s6, 'The Conversational Advantage')
  addFooter(s6, pg)
  // Traditional side
  s6.addShape('rect', { x: 0.5, y: 1.4, w: 5.8, h: 4.8, fill: { color: 'FEF2F2' }, rectRadius: 0.1 })
  s6.addText('Traditional Survey', { x: 0.5, y: 1.5, w: 5.8, h: 0.5, fontSize: 14, fontFace: 'Arial', color: 'DC2626', bold: true, align: 'center' })
  s6.addText('Q: How was your experience? ★★★★ (4/5)\nAny comments? "It was good"\n\nInsight captured:\nPositive sentiment. That\'s it.', {
    x: 0.8, y: 2.2, w: 5.2, h: 3.5, fontSize: 13, fontFace: 'Arial', color: DN.ink, lineSpacing: 22
  })
  // Sentimetrx side
  s6.addShape('rect', { x: 7, y: 1.4, w: 5.8, h: 4.8, fill: { color: 'F0FDF4' }, rectRadius: 0.1 })
  s6.addText('Sentimetrx Conversation', { x: 7, y: 1.5, w: 5.8, h: 0.5, fontSize: 14, fontFace: 'Arial', color: '16A34A', bold: true, align: 'center' })
  s6.addText('Bot: How was your experience? [emoji scale]\nUser: [taps Good — 4 stars]\nBot: What made it good?\nUser: Staff was friendly but we waited a long time\nBot: Could you tell me more about the wait?\nUser: 45 min for a table with a reservation\n\nInsight: staff driver + 45-min wait + reservation issue', {
    x: 7.3, y: 2.2, w: 5.2, h: 3.5, fontSize: 12, fontFace: 'Arial', color: DN.ink, lineSpacing: 20
  })
  s6.addText('3-5x more actionable text per respondent. Same survey length. No interviewer required.', {
    x: 0.5, y: 6.5, w: 12.3, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.sarinaBlue, bold: true, align: 'center'
  })
  s6.addNotes(
`The side-by-side that lands the whole pitch.

LEFT (traditional): "How was your experience? 4 stars. Any comments? It was good."
Insight captured: positive sentiment. That's it.

RIGHT (Sentimetrx):
Bot asks the same opener. User taps "good — 4 stars."
Bot probes: "What made it good?"
User: "Staff was friendly but we waited a long time."
Bot probes again: "Could you tell me more about the wait?"
User: "45 min for a table with a reservation."

Insight captured: staff driver (positive) + 45-min wait + reservation issue. THREE actionable signals.

Land the punchline: "3-5× more actionable text per respondent. Same survey length. No interviewer required."

This is the slide that makes researchers and CX leaders perk up.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 7: COMPETITIVE LANDSCAPE
  // ═══════════════════════════════════════════════════════════════
  const s7 = pptx.addSlide()
  pg++
  addHeader(s7, 'Competitive Landscape')
  addFooter(s7, pg)
  s7.addText('No existing platform combines conversational AI + text analytics + campaigns + multi-language.', {
    x: 0.6, y: 1.3, w: 12, h: 0.5, fontSize: 15, fontFace: 'Arial', color: DN.hermesOrange, bold: true
  })
  const tHead = [
    { text: '', options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 10 } },
    { text: 'Survey Tools', options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 10 } },
    { text: 'Text Analytics', options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 10 } },
    { text: 'Sentimetrx', options: { fill: { color: DN.sarinaBlue }, color: DN.white, bold: true, fontSize: 10 } },
  ]
  const tRows = [
    ['Collection', 'Static forms', 'None (needs data)', 'AI conversation'],
    ['AI Follow-up', 'No', 'N/A', 'Real-time contextual'],
    ['Analytics', 'Basic charts', 'Theme extraction', 'Both + significance'],
    ['Campaigns', 'Separate tool', 'N/A', 'Built-in'],
    ['Languages', 'Manual/paid', 'Post-hoc', '15, one-click AI'],
    ['Annual Cost', '$25K-100K', '$15K-80K', 'Fraction of combined'],
  ]
  const tableRows = [tHead, ...tRows.map(r => r.map((c, i) => ({
    text: c,
    options: { fontSize: 10, fontFace: 'Arial', color: i === 3 ? DN.teal : DN.ink, bold: i === 0, fill: { color: i === 3 ? 'E0F7FA' : DN.white } }
  })))]
  s7.addTable(tableRows as any, { x: 0.6, y: 2.0, w: 12, colW: [2.2, 3, 3, 3.8], border: { pt: 0.5, color: DN.slateLight } })

  s7.addNotes(
`The competitive grid. Walk the diagonal — don't read every cell.

KEY ROWS to land:
- COLLECTION: survey tools = static forms; text analytics = nothing (they need data fed in); us = AI conversation.
- AI FOLLOW-UP: only Sentimetrx does real-time contextual follow-ups.
- ANALYTICS: survey tools = basic charts; text analytics = theme extraction; us = both with statistical significance.
- CAMPAIGNS: only us has it built in.
- LANGUAGES: only us has one-click AI translation.
- COST: survey tools $25-100K, text analytics $15-80K, us = a fraction of the combined.

The point: no incumbent stack does all five well. Procurement teams are sick of stitching three vendors together. We are the consolidation play.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 8: AI DEPTH
  // ═══════════════════════════════════════════════════════════════
  const s8 = pptx.addSlide()
  pg++
  addHeader(s8, 'AI Depth — Not a Wrapper')
  addFooter(s8, pg)
  const aiRows = [
    ['Study Creation', 'Generates complete studies from industry + goals'],
    ['Real-time Clarification', 'Reads responses, generates contextual follow-ups'],
    ['Smart Deflection', 'Detects off-topic questions, redirects warmly'],
    ['Translation', 'Translates studies to 15 languages + responses back to English'],
    ['Theme Extraction', 'Discovers patterns across thousands of open-ended responses'],
    ['Statistical Analysis', 'Significance testing on theme distributions'],
  ]
  aiRows.forEach((row, i) => {
    const y = 1.5 + i * 0.85
    s8.addShape('rect', { x: 0.6, y, w: 3.5, h: 0.7, fill: { color: DN.sarinaBlue }, rectRadius: 0.08 })
    s8.addText(row[0], { x: 0.8, y, w: 3.3, h: 0.7, fontSize: 13, fontFace: 'Arial', color: DN.white, bold: true, valign: 'middle' })
    s8.addText(row[1], { x: 4.4, y, w: 8.5, h: 0.7, fontSize: 13, fontFace: 'Arial', color: DN.ink, valign: 'middle' })
  })
  s8.addText('We use Claude (Anthropic) across the stack — deeply integrated, not API wrappers.', {
    x: 0.6, y: 6.6, w: 12, h: 0.4, fontSize: 12, fontFace: 'Arial', color: DN.slate, italic: true
  })
  s8.addNotes(
`The "we're not a wrapper" slide. Six places AI actually does work.

WALK QUICKLY — one line each:
- STUDY CREATION: AI generates complete studies from industry + goals (not just templates).
- REAL-TIME CLARIFICATION: AI reads each response and generates the contextual follow-up. Not pre-written branching.
- SMART DEFLECTION: AI detects off-topic questions and redirects warmly without breaking the conversation.
- TRANSLATION: AI translates the study to 15 languages AND responses back to English for analysis.
- THEME EXTRACTION: AI discovers patterns across thousands of open-ended responses. No taxonomy seeding required.
- STATISTICAL ANALYSIS: AI runs significance testing on theme distributions — surfaces "this segment significantly differs."

THE PUNCH LINE at the bottom: "We use Claude (Anthropic) across the stack. Deeply integrated, not API wrappers. The AI is the spine, not a feature."`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 9: MARKET OPPORTUNITY
  // ═══════════════════════════════════════════════════════════════
  const s9 = pptx.addSlide()
  pg++
  addHeader(s9, 'Market Opportunity')
  addFooter(s9, pg)
  const markets = [
    { label: 'Survey Software',    color: DN.sarinaBlue },
    { label: 'Text Analytics',     color: DN.teal },
    { label: 'CX Management',      color: DN.navy },
  ]
  markets.forEach((m, i) => {
    const x = 0.8 + i * 4.2
    s9.addShape('rect', { x, y: 1.5, w: 3.8, h: 2.0, fill: { color: m.color }, rectRadius: 0.1 })
    s9.addText(m.label, { x: x + 0.2, y: 1.5, w: 3.4, h: 2.0, fontSize: 18, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
  })
  s9.addText('Three large, growing, adjacent markets — combined size and CAGR figures available from MarketsandMarkets, Grand View Research, Forrester, or Gartner (cite specific source before external use).', {
    x: 0.6, y: 3.7, w: 12, h: 0.6, fontSize: 11, fontFace: 'Arial', color: DN.slate, italic: true
  })
  s9.addText('Our wedge: Mid-market organizations spending across 3–5 separate tools today.\nToo small for Qualtrics/Medallia, too sophisticated for SurveyMonkey.', {
    x: 0.6, y: 4.4, w: 12, h: 0.8, fontSize: 14, fontFace: 'Arial', color: DN.ink, bold: true, lineSpacing: 22
  })
  // TAM/SAM/SOM placeholder cards — figures pending citation
  const tam = [
    { label: 'TAM', desc: 'Mid-market survey + analytics' },
    { label: 'SAM', desc: 'English + multilingual mid-market' },
    { label: 'SOM', desc: 'Initial verticals' },
  ]
  tam.forEach((t, i) => {
    const x = 0.8 + i * 4.2
    s9.addShape('rect', { x, y: 5.4, w: 3.8, h: 1.4, fill: { color: i === 2 ? DN.sarinaBlue : i === 1 ? DN.teal : DN.navy }, rectRadius: 0.1 })
    s9.addText(t.label, { x, y: 5.5, w: 3.8, h: 0.5, fontSize: 16, fontFace: 'Arial', color: DN.white, bold: true, align: 'center' })
    s9.addText(t.desc, { x: x + 0.2, y: 6.0, w: 3.4, h: 0.7, fontSize: 11, fontFace: 'Arial', color: DN.white, align: 'center', valign: 'top', lineSpacing: 16 })
  })
  s9.addText('Specific TAM / SAM / SOM dollar figures pending — to be sourced before external use.', {
    x: 0.6, y: 6.95, w: 12, h: 0.3, fontSize: 9, fontFace: 'Arial', color: DN.slate, italic: true, align: 'center',
  })
  s9.addNotes(
`The market opportunity slide. Three adjacent markets — survey software, text analytics, and CX management. All three are large and growing.

We deliberately don't put specific TAM dollar figures on the slide. Source them from your preferred research firm (MarketsandMarkets, Grand View Research, Forrester, Gartner) and add the citations before external use.

OUR WEDGE: mid-market organizations spending across 3-5 separate tools today. Too small for Qualtrics or Medallia. Too sophisticated for SurveyMonkey alone.

TAM / SAM / SOM breakdown: define TAM = mid-market survey + analytics. SAM = English + multilingual mid-market. SOM = the initial verticals where we have proof points (hospitality, sports, education, airports, political).

Don't quote a number you can't back up. The footnote at the bottom tells the LP this is intentional.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 10: CASE STUDIES
  // ═══════════════════════════════════════════════════════════════
  const s10 = pptx.addSlide()
  pg++
  addHeader(s10, 'Validated Results')
  addFooter(s10, pg)
  const cases = [
    { name: 'Harlem Globetrotters', metric: '10x', desc: 'more responses vs. post-event email surveys. 15-20% in-venue response rate.' },
    { name: 'JW Marriott', metric: '10x', desc: 'more responses than post-stay email. Actionable feedback within hours.' },
    { name: 'UCF Rosen College', metric: '<5%', desc: 'of time taken by human experts. Near-identical quality to professors.' },
    { name: 'Orlando Resort', metric: 'Seconds', desc: 'to identify root cause vs. weeks of manual analysis. Saved costly renovation.' },
  ]
  cases.forEach((c, i) => {
    const y = 1.5 + i * 1.35
    s10.addShape('rect', { x: 0.6, y, w: 12, h: 1.15, fill: { color: i % 2 === 0 ? DN.slateLight : DN.white }, rectRadius: 0.08 })
    s10.addText(c.name, { x: 0.9, y, w: 3, h: 1.15, fontSize: 14, fontFace: 'Arial', color: DN.navy, bold: true, valign: 'middle' })
    s10.addText(c.metric, { x: 4.0, y, w: 1.8, h: 1.15, fontSize: 28, fontFace: 'Arial', color: DN.sarinaBlue, bold: true, valign: 'middle', align: 'center' })
    s10.addText(c.desc, { x: 6.0, y, w: 6.4, h: 1.15, fontSize: 13, fontFace: 'Arial', color: DN.ink, valign: 'middle' })
  })
  s10.addShape('rect', { x: 0.6, y: 6.2, w: 12, h: 0.8, fill: { color: DN.navy }, rectRadius: 0.08 })
  s10.addText('"Ana performed almost as well as the team of professors and outperformed the graduate student — in less than 5% of the time."\n— Dr. Fevzi Okumus, UCF Rosen College', {
    x: 1.0, y: 6.2, w: 11.5, h: 0.8, fontSize: 11, fontFace: 'Arial', color: DN.white, italic: true, valign: 'middle', lineSpacing: 16
  })
  s10.addNotes(
`Four customer case studies. Each is a different industry — proves we're not a one-vertical novelty.

HARLEM GLOBETROTTERS: 10× more responses vs post-event email. 15-20% in-venue response rate (industry email surveys average 5-15%).

JW MARRIOTT: 10× more responses than post-stay email. Actionable feedback within hours, not weeks.

UCF ROSEN COLLEGE: less than 5% of the time taken by human experts. Near-identical quality to professors. This is the diligence-proof point — independent third-party validation.

ORLANDO RESORT: seconds to identify a root cause vs weeks of manual analysis. Saved a costly renovation by catching the real driver in the data.

THE FACULTY QUOTE at the bottom: "Ana performed almost as well as the team of professors and outperformed the graduate student — in less than 5% of the time." — Dr. Fevzi Okumus, UCF Rosen College.

Don't paraphrase this. Read the quote.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 11: BUSINESS MODEL
  // ═══════════════════════════════════════════════════════════════
  const s11 = pptx.addSlide()
  pg++
  addHeader(s11, 'Business Model')
  addFooter(s11, pg)
  s11.addText('SaaS subscription with usage-based AI tier', { x: 0.6, y: 1.3, w: 12, h: 0.4, fontSize: 16, fontFace: 'Arial', color: DN.navy, bold: true })
  const tiers = [
    { name: 'Starter', price: '$99/mo', features: '3 active studies\n1K responses/mo\nBasic analytics', color: DN.slateLight },
    { name: 'Professional', price: '$299/mo', features: 'Unlimited studies\n10K responses/mo\nAI analytics + campaigns', color: DN.sarinaBlue },
    { name: 'Enterprise', price: 'Custom', features: 'White-label, SSO\nDedicated support\nUnlimited everything', color: DN.navy },
  ]
  tiers.forEach((t, i) => {
    const x = 0.6 + i * 4.2
    const isLight = i === 0
    s11.addShape('rect', { x, y: 2.0, w: 3.8, h: 3.6, fill: { color: t.color }, rectRadius: 0.1 })
    s11.addText(t.name, { x, y: 2.1, w: 3.8, h: 0.5, fontSize: 16, fontFace: 'Arial', color: isLight ? DN.navy : DN.white, bold: true, align: 'center' })
    s11.addText(t.price, { x, y: 2.6, w: 3.8, h: 0.7, fontSize: 28, fontFace: 'Arial', color: isLight ? DN.sarinaBlue : DN.gold, bold: true, align: 'center' })
    s11.addText(t.features, { x: x + 0.3, y: 3.4, w: 3.2, h: 2.0, fontSize: 12, fontFace: 'Arial', color: isLight ? DN.ink : DN.white, lineSpacing: 20 })
  })
  s11.addText('85%+ gross margin target — AI costs ~$0.002/interaction', {
    x: 0.6, y: 6.0, w: 12, h: 0.4, fontSize: 13, fontFace: 'Arial', color: DN.slate
  })
  s11.addNotes(
`Three tiers. Walk them quickly.

STARTER ($99/mo): 3 active studies, 1K responses/month, basic analytics. For consultancies, small CX teams, education users.

PROFESSIONAL ($299/mo): Unlimited studies, 10K responses/month, AI analytics + campaigns. The mid-market sweet spot.

ENTERPRISE (custom): White-label, SSO, dedicated support, unlimited everything. Multi-brand restaurant groups, large hospitality, political ops.

THE MARGIN POINT: 85%+ gross margin target. AI inference costs at scale are roughly $0.002 per interaction (with prompt caching). The economics of the product mirror traditional SaaS, not a services business.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 12: GO-TO-MARKET
  // ═══════════════════════════════════════════════════════════════
  const s12 = pptx.addSlide()
  pg++
  addHeader(s12, 'Go-to-Market')
  addFooter(s12, pg)
  const phases = [
    { title: 'Phase 1 — Now', items: 'Healthcare (patient experience)\nNonprofit (donor feedback)\nHospitality (guest experience)', color: DN.sarinaBlue },
    { title: 'Phase 2 — 6 months', items: 'White-label channel partners\nIntegration marketplace\nSelf-serve freemium tier', color: DN.teal },
    { title: 'Phase 3 — 12 months', items: 'API platform access\nReal-time feedback triggers\nEmbedded survey widgets', color: DN.navy },
  ]
  phases.forEach((p, i) => {
    const x = 0.6 + i * 4.2
    s12.addShape('rect', { x, y: 1.5, w: 3.8, h: 0.6, fill: { color: p.color }, rectRadius: 0.08 })
    s12.addText(p.title, { x, y: 1.5, w: 3.8, h: 0.6, fontSize: 14, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
    s12.addText(p.items, { x: x + 0.2, y: 2.3, w: 3.4, h: 2.5, fontSize: 13, fontFace: 'Arial', color: DN.ink, lineSpacing: 22 })
  })

  s12.addNotes(
`Three GTM phases. Walk them as a timeline.

PHASE 1 (now): Three vertical wedges where we have references.
- HEALTHCARE patient experience.
- NONPROFIT donor feedback.
- HOSPITALITY guest experience.

PHASE 2 (6 months): Channel scale.
- White-label partner program — agencies and consultancies re-brand under their own.
- Integration marketplace — connect to Salesforce, HubSpot, Slack, Snowflake, etc.
- Self-serve freemium tier — bottom-of-funnel acquisition.

PHASE 3 (12 months): Platform expansion.
- API platform access — developers build on top.
- Real-time feedback triggers — fire events to other systems.
- Embedded survey widgets — drop into any web property.

The arc: prove the verticals, scale via partners, become a platform.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 13: WHY NOW
  // ═══════════════════════════════════════════════════════════════
  const s13 = pptx.addSlide()
  pg++
  addHeader(s13, 'Why Now')
  addFooter(s13, pg)
  const reasons = [
    { title: 'AI costs crossed the threshold', desc: 'Claude Haiku makes real-time conversational AI viable at $0.002/interaction' },
    { title: 'Survey fatigue is peaking', desc: 'Response rates at all-time lows — the market is ready for a different approach' },
    { title: 'Multi-language demand', desc: 'Every organization needs multilingual feedback; $10K+ translation workflows are ripe for disruption' },
    { title: 'Tool consolidation trend', desc: 'CFOs cutting point-solution budgets; "one platform" is the winning pitch' },
    { title: 'Regulatory pressure', desc: 'Healthcare, financial services, and government mandating structured feedback collection' },
  ]
  reasons.forEach((r, i) => {
    const y = 1.5 + i * 1.1
    s13.addShape('ellipse', { x: 0.6, y, w: 0.7, h: 0.7, fill: { color: DN.sarinaBlue } })
    s13.addText(`${i + 1}`, { x: 0.6, y, w: 0.7, h: 0.7, fontSize: 24, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
    s13.addText(r.title, { x: 1.5, y, w: 11.3, h: 0.7, fontSize: 20, fontFace: 'Arial', color: DN.navy, bold: true, valign: 'middle', autoFit: true })
  })

  s13.addNotes(
`Five reasons "why now." Walk them quickly — each is a 10-second beat.

1. AI COSTS CROSSED THE THRESHOLD. Claude Haiku makes real-time conversational AI viable at roughly $0.002 per interaction. Two years ago this was impossible economically.

2. SURVEY FATIGUE IS PEAKING. Response rates at all-time lows. The market is ready for a different approach — they've stopped using the old tools, they just don't have a replacement yet.

3. MULTI-LANGUAGE DEMAND. Every customer-facing organization needs feedback in multiple languages. $10K+ translation workflows are everywhere — and ripe for AI disruption.

4. TOOL CONSOLIDATION TREND. CFOs are cutting point-solution budgets. "One platform" is the winning pitch right now. Companies are killing 3 of their 5 vendors.

5. REGULATORY PRESSURE. Healthcare, financial services, and government are mandating structured feedback collection (CMS for healthcare, OMB for federal). Compliance creates urgency.

All five are happening NOW. Not in 18 months. Now.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 14: THE ASK
  // ═══════════════════════════════════════════════════════════════
  const s14 = pptx.addSlide()
  pg++
  s14.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.navy } })
  s14.addText('The Ask', { x: 0.8, y: 0.8, w: 11, h: 0.8, fontSize: 36, fontFace: 'Arial', color: DN.white, bold: true })
  s14.addShape('rect', { x: 0.8, y: 1.6, w: 3, h: 0.04, fill: { color: DN.sarinaBlue } })
  s14.addText([
    bullet('Scale AI infrastructure', { color: DN.white, fontSize: 16 }),
    bullet('Hire sales team — healthcare, nonprofit, hospitality', { color: DN.white, fontSize: 16 }),
    bullet('Build white-label channel program', { color: DN.white, fontSize: 16 }),
    bullet('Product expansion — SMS, embedded widgets, API', { color: DN.white, fontSize: 16 }),
  ], { x: 0.8, y: 2.2, w: 11, h: 2.8 })
  s14.addText('Target milestones (18 months):', { x: 0.8, y: 5.0, w: 11, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.gold, bold: true })
  s14.addText('$1M ARR  •  200+ paying organizations  •  3 channel partners  •  50K monthly responses', {
    x: 0.8, y: 5.5, w: 11, h: 0.4, fontSize: 15, fontFace: 'Arial', color: DN.white
  })
  s14.addText('sentimetrx.ai  •  info@datanautix.com  •  calendly.com/sanjay-datanautix', {
    x: 0.8, y: 6.5, w: 11, h: 0.4, fontSize: 13, fontFace: 'Arial', color: DN.slate
  })
  s14.addNotes(
`The closing ask. Four use-of-funds buckets:

1. SCALE AI INFRASTRUCTURE: handle the next 10× of conversations without manual intervention.
2. HIRE SALES TEAM: vertical reps for healthcare, nonprofit, and hospitality. Three named hires.
3. BUILD WHITE-LABEL CHANNEL PROGRAM: agencies and consultancies as a distribution layer.
4. PRODUCT EXPANSION: SMS, embedded widgets, public API.

TARGET MILESTONES (18 months from close):
- $1M ARR
- 200+ paying organizations
- 3 channel partners
- 50K monthly responses

Don't end with "let me know what you think." End with the next step: "Here is what I'd like to do. Let me know if you can join the next investor call on [date]."`
  )

  // Generate buffer
  const buffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer
  const uint8 = new Uint8Array(buffer)

  return new NextResponse(uint8, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': 'attachment; filename="Sentimetrx-Pitch-Deck.pptx"',
    },
  })
}
