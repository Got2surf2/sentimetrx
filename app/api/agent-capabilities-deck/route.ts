// GET /api/agent-capabilities-deck — generates a PPTX explaining branded agent capabilities
// Positioned for political campaigns. Downloads directly to ~/Downloads

import { NextResponse } from 'next/server'
import PptxGenJS from 'pptxgenjs'
import { DN as DN_SHARED, W, H } from '@/lib/pptx/shared'
import { requireAdmin } from '@/lib/auth/requireAdmin'

export const dynamic = 'force-dynamic'

const DN = {
  ...DN_SHARED,
  hermes: 'E8632A',
  sarinaBlue: '00B4D8',
  ink: '0A1628',
  gray: '9CA3AF',
  purple: '7C3AED',
  purpleLight: 'EDE9FE',
}

function hdr(slide: PptxGenJS.Slide, title: string, subtitle?: string) {
  slide.addShape('rect', { x: 0, y: 0, w: W, h: 1.1, fill: { color: DN.ink } })
  slide.addShape('rect', { x: 0, y: 0, w: 0.06, h: 1.1, fill: { color: DN.sarinaBlue } })
  slide.addText(title, { x: 0.6, y: 0.12, w: 10, h: 0.55, fontSize: 26, fontFace: 'Arial', color: DN.white, bold: true })
  if (subtitle) slide.addText(subtitle, { x: 0.6, y: 0.62, w: 10, h: 0.35, fontSize: 13, fontFace: 'Arial', color: DN.sarinaBlue })
  slide.addShape('rect', { x: 0, y: 1.1, w: W, h: 0.035, fill: { color: DN.gold } })
  slide.addText(
    [{ text: 'data', options: { color: DN.hermes, bold: true, italic: true } }, { text: 'nautix', options: { color: DN.sarinaBlue, bold: true, italic: true } }],
    { x: W - 2.3, y: 0.15, w: 2.1, h: 0.7, fontSize: 15, valign: 'middle', align: 'right' }
  )
}

function ftr(slide: PptxGenJS.Slide, page: number) {
  slide.addText('datanautix.com', { x: 0.5, y: H - 0.38, w: 3, h: 0.3, fontSize: 8, color: DN.slate, fontFace: 'Arial' })
  slide.addText('Proprietary & Confidential', { x: W / 2 - 1.5, y: H - 0.38, w: 3, h: 0.3, fontSize: 8, color: DN.slate, fontFace: 'Arial', align: 'center' })
  slide.addText(String(page), { x: W - 1, y: H - 0.38, w: 0.5, h: 0.3, fontSize: 8, color: DN.slate, fontFace: 'Arial', align: 'right' })
}

function card(slide: PptxGenJS.Slide, x: number, y: number, w: number, h: number, title: string, body: string, accent: string = DN.sarinaBlue) {
  slide.addShape('roundRect', { x, y, w, h, rectRadius: 0.08, fill: { color: DN.white }, line: { color: 'E5E7EB', width: 0.5 } })
  slide.addShape('rect', { x, y, w: 0.05, h, fill: { color: accent } })
  slide.addText(title, { x: x + 0.2, y: y + 0.08, w: w - 0.35, h: 0.35, fontSize: 13, fontFace: 'Arial', color: DN.navy, bold: true })
  slide.addText(body, { x: x + 0.2, y: y + 0.42, w: w - 0.35, h: h - 0.52, fontSize: 10, fontFace: 'Arial', color: '4B5563', wrap: true, lineSpacingMultiple: 1.3 })
}

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied

  var pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Datanautix'
  pptx.title = 'Branded AI Agents — Campaign Intelligence Platform'
  var p = 0

  // ═══ SLIDE 1: Title ═══
  var s1 = pptx.addSlide()
  s1.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.ink } })
  s1.addShape('rect', { x: 0, y: 0, w: 0.18, h: H, fill: { color: DN.sarinaBlue } })
  s1.addShape('rect', { x: 0, y: 3.6, w: W, h: 0.04, fill: { color: DN.gold } })
  s1.addText('Branded AI Agents', { x: 0.8, y: 1.2, w: 11, h: 1.0, fontSize: 44, fontFace: 'Arial', color: DN.white, bold: true })
  s1.addText('Your Candidate. Their Voice. Every Conversation.', { x: 0.8, y: 2.2, w: 11, h: 0.6, fontSize: 22, fontFace: 'Arial', color: DN.sarinaBlue })
  s1.addText('An AI-powered constituent engagement platform purpose-built for political campaigns', { x: 0.8, y: 3.9, w: 11, h: 0.5, fontSize: 14, fontFace: 'Arial', color: DN.slate })
  s1.addText(
    [{ text: 'data', options: { color: DN.hermes, bold: true, italic: true, fontSize: 16 } }, { text: 'nautix', options: { color: DN.sarinaBlue, bold: true, italic: true, fontSize: 16 } }],
    { x: W - 3, y: H - 1.2, w: 2.5, h: 0.5, align: 'right' }
  )
  s1.addText(new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), { x: 0.8, y: H - 1.2, w: 4, h: 0.5, fontSize: 12, fontFace: 'Arial', color: DN.slate })

  // ═══ SLIDE 2: The Problem ═══
  p++
  var s2 = pptx.addSlide()
  s2.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.slateCard } })
  hdr(s2, 'The Challenge', 'Why traditional campaign outreach is failing')
  ftr(s2, p)
  var problems = [
    { title: 'Voters don\'t answer phones', desc: 'Response rates for cold calls and polling have dropped below 5%. The voters you most need to reach are the ones most likely to screen your calls.' },
    { title: 'One-way messaging doesn\'t build trust', desc: 'Mailers, ads, and email blasts tell voters what to think. They don\'t listen. In an era of deep skepticism, broadcast messaging actively erodes trust.' },
    { title: 'Canvassers can\'t scale and can\'t be everywhere', desc: 'Your best advocates have limited hours. They can\'t reach 100,000 voters individually, adapt messaging to each person\'s concerns, or be available at 11 PM when a voter is thinking about the election.' },
    { title: 'You lose every conversation you never had', desc: 'A voter who Googles your candidate at midnight and finds nothing engaging has already started forming an opinion — without your input. The absence of a conversation is a lost opportunity.' },
  ]
  problems.forEach(function(item, i) {
    card(s2, 0.5, 1.4 + i * 1.4, 12.3, 1.2, item.title, item.desc, DN.red)
  })

  // ═══ SLIDE 3: The Solution ═══
  p++
  var s3 = pptx.addSlide()
  s3.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.slateCard } })
  hdr(s3, 'The Solution', 'A branded AI agent that IS your candidate — available 24/7')
  ftr(s3, p)
  s3.addText('An always-on, deeply knowledgeable AI representative that speaks in your candidate\'s voice, knows their positions cold, and engages every voter in a real conversation — not a script.', { x: 0.6, y: 1.35, w: 12, h: 0.6, fontSize: 13, fontFace: 'Arial', color: '374151', wrap: true, lineSpacingMultiple: 1.4 })
  var solutions = [
    { title: 'Branded & In-Character', desc: 'Custom avatar, colors, personality, and communication style. The agent sounds like your candidate — measured, passionate, direct, whatever the brand requires.' },
    { title: 'Deep Knowledge Base', desc: 'Trained on policy positions, voting records, speeches, and campaign materials. RAG-powered retrieval ensures factual, consistent answers backed by real sources.' },
    { title: 'Opponent Contrast on Demand', desc: 'When voters ask about the opponent, the agent draws clear policy contrasts. "That\'s a stark contrast to [opponent] who..." — factual, firm, on-message.' },
    { title: 'Available Everywhere', desc: 'Embed on your campaign website, share via QR codes at events, link from social media. One URL, accessible on any device, any time.' },
  ]
  solutions.forEach(function(item, i) {
    var col = i % 2
    var row = Math.floor(i / 2)
    card(s3, 0.5 + col * 6.3, 2.2 + row * 2.5, 5.9, 2.2, item.title, item.desc, DN.sarinaBlue)
  })

  // ═══ SLIDE 4: Guardrails & Safety ═══
  p++
  var s4 = pptx.addSlide()
  s4.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.slateCard } })
  hdr(s4, 'Message Control & Guardrails', 'Keep every conversation on-brand and on-message')
  ftr(s4, p)
  s4.addText('Unlike generic chatbots, our agents are built with campaign-grade message discipline. You control what the agent discusses, how it handles attacks, and where it draws the line.', { x: 0.6, y: 1.35, w: 12, h: 0.55, fontSize: 12, fontFace: 'Arial', color: '374151', wrap: true, lineSpacingMultiple: 1.3 })
  var guardrails = [
    { title: 'Sensitive Topic Management', desc: 'Define off-limits topics (salary, lawsuits, internal disputes). Messages touching banned topics are automatically redirected — gently, without acknowledging the restriction.', color: DN.red },
    { title: 'Focus Topic Prioritization', desc: 'Set primary focus areas (healthcare, education, community safety). The agent steers conversations toward your strengths and key messages.', color: DN.sarinaBlue },
    { title: 'Smart Deflection System', desc: 'AI-powered redirect logic distinguishes genuine feedback from off-topic questions. Feedback is welcomed; irrelevant questions are redirected with a brief acknowledgment.', color: DN.teal },
    { title: 'Negative Content Handling', desc: 'Two modes: DEFLECT (safest — never engages with attacks) or PIVOT (briefly acknowledges criticism exists, then pivots to your candidate\'s record).', color: DN.hermes },
    { title: 'Content Safety', desc: 'Automatic profanity, slur, and threat detection with 3-strike escalation. Flagged conversations are tagged for review. Keeps the conversation civil without moderator burden.', color: DN.purple },
    { title: 'Custom Guardrail Rules', desc: 'Inject specific rules: "Never discuss competitor fundraising," "Always mention the infrastructure bill." Rules are enforced at the system level — the AI can\'t ignore them.', color: DN.gold },
  ]
  guardrails.forEach(function(item, i) {
    var col = i % 3
    var row = Math.floor(i / 3)
    card(s4, 0.4 + col * 4.2, 2.1 + row * 2.5, 3.9, 2.2, item.title, item.desc, item.color)
  })

  // ═══ SLIDE 5: Persona Profiling ═══
  p++
  var s5 = pptx.addSlide()
  s5.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.slateCard } })
  hdr(s5, 'Adaptive Persona Profiling', 'Every voter gets a conversation tailored to them')
  ftr(s5, p)
  s5.addText('The agent naturally learns who it\'s talking to and adapts its communication style in real-time. No forms, no surveys — just a warm opening question.', { x: 0.6, y: 1.35, w: 12, h: 0.55, fontSize: 12, fontFace: 'Arial', color: '374151', wrap: true, lineSpacingMultiple: 1.3 })

  var personaItems = [
    { title: 'Natural Profiling', desc: '"Tell me a bit about yourself so I can make our conversation more relevant to you." One warm question, 1-2 natural follow-ups. No forms. No friction.' },
    { title: 'What We Extract', desc: 'Life stage (student, parent, retiree), occupation, industry, location type (urban/suburban/rural), key concerns, communication style preference.' },
    { title: 'Style Matching', desc: 'If they\'re casual ("lol im just a dad trying to figure stuff out"), the agent drops any formal tone immediately. If they\'re technical, it goes deeper. Real-time adaptation.' },
    { title: 'Explicit vs. Inferred', desc: 'Every data point tagged with source (explicit/inferred) and confidence (high/medium/low). We extract what they share, we don\'t guess demographics they didn\'t mention.' },
  ]
  personaItems.forEach(function(item, i) {
    var col = i % 2
    var row = Math.floor(i / 2)
    card(s5, 0.5 + col * 6.3, 2.2 + row * 2.5, 5.9, 2.2, item.title, item.desc, DN.teal)
  })

  // ═══ SLIDE 6: Intelligence & Analytics ═══
  p++
  var s6 = pptx.addSlide()
  s6.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.slateCard } })
  hdr(s6, 'Conversation Intelligence', 'Every chat is a data point. Every pattern is an insight.')
  ftr(s6, p)
  var intel = [
    { title: 'Content Flags & Moderation', desc: 'Every message is automatically scanned for profanity, slurs, threats, trolling, and outside-scope questions. Flagged conversations surface for review without manual monitoring.' },
    { title: 'Shareable Conversations', desc: 'One-click share links for any conversation. Send to campaign managers, comms teams, or donors. Links expire automatically (24h/7d/30d) — no lingering sensitive content.' },
    { title: 'Scheduled AI Reviews', desc: 'Configurable periodic reviews (24h/48h/weekly) where AI analyzes all recent conversations. Detects theme drift, surfaces common questions, identifies knowledge gaps in your messaging.' },
    { title: 'Persona Analytics', desc: 'Aggregated profiles reveal who\'s engaging: what life stages, occupations, and concerns dominate. Compare engagement patterns across demographics without ever asking invasive questions.' },
    { title: 'Conversation Export', desc: 'Full conversation export as CSV or curated Insights Deck (PPTX). Present conversation themes and engagement patterns to campaign leadership in board-ready format.' },
    { title: 'Real-Time Chat Viewer', desc: 'iMessage-style conversation replay with content flag badges, deflection markers, and persona data. Review any conversation exactly as the voter experienced it.' },
  ]
  intel.forEach(function(item, i) {
    var col = i % 3
    var row = Math.floor(i / 3)
    card(s6, 0.4 + col * 4.2, 1.35 + row * 2.8, 3.9, 2.5, item.title, item.desc, DN.hermes)
  })

  // ═══ SLIDE 7: Why Us vs. Generic AI ═══
  p++
  var s7 = pptx.addSlide()
  s7.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.slateCard } })
  hdr(s7, 'Why Our Agent Platform', 'What ChatGPT, Copilot, and generic chatbots can\'t do')
  ftr(s7, p)

  // Comparison table
  var colW = [4.5, 3.8, 3.8]
  var colX = [0.5, 5.1, 9.0]
  var headers = ['Capability', 'Generic AI Chatbots', 'Datanautix Agent']
  headers.forEach(function(h, i) {
    s7.addShape('rect', { x: colX[i], y: 1.35, w: colW[i], h: 0.5, fill: { color: DN.navy } })
    s7.addText(h, { x: colX[i], y: 1.35, w: colW[i], h: 0.5, fontSize: 12, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
  })

  var rows = [
    ['Stays on-message under adversarial probing', 'No — easily jailbroken', 'Yes — hardened guardrails + strike system'],
    ['Blocks sensitive topics automatically', 'No — discusses anything', 'Yes — word-level topic detection + AI redirect'],
    ['Draws opponent contrasts on policy', 'No — refuses to compare', 'Yes — factual contrast with sourced positions'],
    ['Adapts tone to each voter\'s persona', 'Minimal — one-size-fits-all', 'Yes — real-time style matching from profiling'],
    ['Flags trolling, profanity, bad actors', 'No — raw unfiltered chat', 'Yes — automatic flagging + 3-strike shutdown'],
    ['Surfaces voter concerns to campaign team', 'No — conversations are lost', 'Yes — AI reviews, exports, persona analytics'],
    ['Custom branded experience', 'Generic ChatGPT interface', 'Full branding: colors, avatar, personality, URL'],
    ['Knowledge base with RAG retrieval', 'Generic training data only', 'Your content: speeches, positions, FAQs, research'],
  ]
  rows.forEach(function(row, i) {
    var y = 1.85 + i * 0.6
    var bg = i % 2 === 0 ? DN.slateLight : DN.white
    row.forEach(function(cell, j) {
      s7.addShape('rect', { x: colX[j], y, w: colW[j], h: 0.6, fill: { color: bg }, line: { color: 'E5E7EB', width: 0.3 } })
      var cellColor = j === 1 ? DN.red : j === 2 ? DN.teal : '374151'
      s7.addText(cell, { x: colX[j] + 0.12, y, w: colW[j] - 0.24, h: 0.6, fontSize: 10, fontFace: 'Arial', color: cellColor, valign: 'middle', wrap: true, bold: j === 0 })
    })
  })

  // ═══ SLIDE 8: Setup & Deployment ═══
  p++
  var s8 = pptx.addSlide()
  s8.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.slateCard } })
  hdr(s8, 'From Zero to Live in Under an Hour', 'No developers. No integrations. No waiting.')
  ftr(s8, p)

  var steps = [
    { num: '1', title: 'Build Your Agent', desc: 'Name, branding, personality, avatar. Set the tone — formal and measured or warm and conversational. 5 minutes.' },
    { num: '2', title: 'Load Knowledge', desc: 'Paste policy positions, upload FAQs, crawl your campaign website, or run automated web research. AI chunks and indexes everything for instant retrieval.' },
    { num: '3', title: 'Set Guardrails', desc: 'Add sensitive topics, focus areas, opponent contrast rules, and custom guardrails. Configure negative content handling mode. Define the boundaries.' },
    { num: '4', title: 'Enable Profiling', desc: 'Toggle persona profiling on. Customize the opening question. The agent starts learning about each voter from the first message.' },
    { num: '5', title: 'Go Live', desc: 'One click to activate. Share the URL on your website, social media, campaign emails, event QR codes. Every voter gets the same quality conversation your best surrogate would deliver.' },
  ]
  steps.forEach(function(item, i) {
    var y = 1.4 + i * 1.1
    s8.addShape('roundRect', { x: 0.5, y, w: 12.3, h: 0.9, rectRadius: 0.08, fill: { color: DN.white }, line: { color: 'E5E7EB', width: 0.5 } })
    s8.addShape('ellipse', { x: 0.7, y: y + 0.15, w: 0.6, h: 0.6, fill: { color: DN.sarinaBlue } })
    s8.addText(item.num, { x: 0.7, y: y + 0.15, w: 0.6, h: 0.6, fontSize: 18, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
    s8.addText(item.title, { x: 1.5, y: y + 0.08, w: 3, h: 0.35, fontSize: 14, fontFace: 'Arial', color: DN.navy, bold: true })
    s8.addText(item.desc, { x: 1.5, y: y + 0.42, w: 11, h: 0.4, fontSize: 11, fontFace: 'Arial', color: '4B5563', wrap: true })
  })

  // ═══ SLIDE 9: Closing ═══
  p++
  var s9 = pptx.addSlide()
  s9.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.ink } })
  s9.addShape('rect', { x: 0, y: 0, w: 0.18, h: H, fill: { color: DN.sarinaBlue } })
  s9.addShape('rect', { x: 0, y: 3.4, w: W, h: 0.04, fill: { color: DN.gold } })
  s9.addText('Your candidate deserves\nto be in every conversation.', { x: 0.8, y: 1.2, w: 11, h: 1.6, fontSize: 36, fontFace: 'Arial', color: DN.white, bold: true, lineSpacingMultiple: 1.3 })
  s9.addText('Not just the ones your team has time for.', { x: 0.8, y: 2.8, w: 11, h: 0.6, fontSize: 20, fontFace: 'Arial', color: DN.sarinaBlue })
  s9.addText('Let\'s build your agent.', { x: 0.8, y: 4.0, w: 11, h: 0.6, fontSize: 18, fontFace: 'Arial', color: DN.slate })
  s9.addText(
    [{ text: 'data', options: { color: DN.hermes, bold: true, italic: true, fontSize: 18 } }, { text: 'nautix', options: { color: DN.sarinaBlue, bold: true, italic: true, fontSize: 18 } }],
    { x: W - 3.5, y: H - 1.5, w: 3, h: 0.6, align: 'right' }
  )
  s9.addText('datanautix.com', { x: W - 3.5, y: H - 1, w: 3, h: 0.4, fontSize: 13, fontFace: 'Arial', color: DN.slate, align: 'right' })

  // Generate and return
  var buffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer
  var uint8 = new Uint8Array(buffer)
  return new NextResponse(uint8, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': 'attachment; filename="Datanautix_Branded_AI_Agents.pptx"',
    },
  })
}
