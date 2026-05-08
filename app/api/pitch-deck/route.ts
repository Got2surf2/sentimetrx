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
  s2.addText('Survey response quality has been declining for years — and the analysis is getting harder, not easier.', { x: 0.6, y: 1.3, w: 12, h: 0.6, fontSize: 18, fontFace: 'Arial', color: DN.hermesOrange, bold: true })
  s2.addText([
    bullet('Average survey response rates are in the single digits to low teens, and falling'),
    bullet('The majority of open-ended responses are too vague to act on — "it was fine," "good," "OK"'),
    bullet('Companies stitch together 3–5 separate tools for surveys, email outreach, text analytics, translation, and reporting'),
    bullet('Enterprise text analytics platforms run into six figures annually and require data science teams to operate'),
    bullet('Most surveys are English-only, missing the richer feedback consumers give in their native language'),
  ], { x: 0.6, y: 2.2, w: 11.5, h: 4.5 })

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

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 4: THE SOLUTION
  // ═══════════════════════════════════════════════════════════════
  const s4 = pptx.addSlide()
  pg++
  addHeader(s4, 'The Solution')
  addFooter(s4, pg)
  s4.addText('Sentimetrx replaces static surveys with AI-powered conversations that adapt in real-time.', {
    x: 0.6, y: 1.3, w: 12, h: 0.6, fontSize: 18, fontFace: 'Arial', color: DN.sarinaBlue, bold: true
  })
  s4.addText([
    bullet('A branded AI agent greets respondents by name and asks questions conversationally'),
    bullet('AI detects vague answers and asks intelligent follow-ups to get the "why"'),
    bullet('Handles off-topic questions gracefully with smart deflection'),
    bullet('Works in 15 languages — one-click AI translation of the entire study'),
    bullet('Built-in email campaigns — no separate Mailchimp required'),
    bullet('AI text analytics with statistical significance testing — no data scientist required'),
  ], { x: 0.6, y: 2.2, w: 11.5, h: 4.5 })
  s4.addText('One platform. Survey + outreach + analytics + reporting.', {
    x: 0.6, y: 6.0, w: 12, h: 0.5, fontSize: 16, fontFace: 'Arial', color: DN.navy, bold: true
  })

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 5: PRODUCT
  // ═══════════════════════════════════════════════════════════════
  const s5 = pptx.addSlide()
  pg++
  addHeader(s5, 'Product')
  addFooter(s5, pg)
  const cols = [
    { title: 'AI Study Wizard', desc: 'Select industry + goals.\nAI generates complete study.\n7 blueprints, 18 industries.', color: DN.sarinaBlue },
    { title: 'Conversational Collection', desc: 'Respondents chat with your agent.\nAI clarifiers probe short answers.\n15 question types + skip logic.', color: DN.teal },
    { title: 'Built-in Campaigns', desc: 'Rich email templates.\nMerge tags, reminders, tracking.\nNo Mailchimp required.', color: DN.hermesOrange },
    { title: '15 Languages', desc: 'One-click AI translation.\nAuto-translate responses.\nNo translation vendors.', color: DN.gold },
    { title: 'AI Analytics', desc: 'Theme extraction at scale.\nStatistical significance.\nPPTX, HTML, CSV export.', color: DN.navy },
  ]
  cols.forEach((col, i) => {
    const x = 0.4 + i * 2.55
    s5.addShape('rect', { x, y: 1.4, w: 2.35, h: 5.2, fill: { color: DN.slateLight }, rectRadius: 0.1 })
    s5.addShape('rect', { x, y: 1.4, w: 2.35, h: 0.5, fill: { color: col.color }, rectRadius: 0.1 })
    s5.addText(col.title, { x, y: 1.45, w: 2.35, h: 0.45, fontSize: 12, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle', autoFit: true })
    s5.addText(col.desc, { x: x + 0.15, y: 2.1, w: 2.05, h: 4.2, fontSize: 11, fontFace: 'Arial', color: DN.ink, lineSpacing: 18, autoFit: true })
  })

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
    s13.addShape('rect', { x: 0.6, y, w: 0.5, h: 0.5, fill: { color: DN.sarinaBlue }, rectRadius: 0.25 })
    s13.addText(`${i + 1}`, { x: 0.6, y, w: 0.5, h: 0.5, fontSize: 16, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
    s13.addText(r.title, { x: 1.3, y, w: 4, h: 0.5, fontSize: 14, fontFace: 'Arial', color: DN.navy, bold: true, valign: 'middle' })
    s13.addText(r.desc, { x: 5.5, y, w: 7.5, h: 0.5, fontSize: 13, fontFace: 'Arial', color: DN.ink, valign: 'middle' })
  })

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
