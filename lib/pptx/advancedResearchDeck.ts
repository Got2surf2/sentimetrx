// lib/pptx/advancedResearchDeck.ts
// Reusable, CLIENT-AGNOSTIC capability deck: "Four Advanced Research Capabilities".
// A high-level prospect overview of the four modern-research capabilities on the
// Sentimetrx platform:
//   ① Conversational Surveys  ② Town Hall (live-conversation capture)
//   ③ PulseIQ (virtual focus groups)  ④ Analytics (text analytics · charting ·
//      statistics · predictive modeling)
//
// Structure: cover → the four-capability OVERVIEW (the opening map) → a detail
// drill-down per product → the one-platform through-line → the close.
//
// House style mirrors salesPitchDeck.ts (navy header bands, sarina-cyan accent,
// orange kickers, navy stat cards, Sentimetrx-forward branding + a "powered by
// Datanautix" footer). Fixed content — NOT data-driven — so any prospect can use
// it as-is; an optional client name is injected on the cover + footer only.
//
// Content rules: no fabricated market data. The only quantified claims are the
// house's own established, attributed figures (the 40–50% unusable-open-ends stat
// and the "3–5× more usable text" advantage), reused consistently with the sales-
// pitch template. The static-vs-conversational transcript is labeled Illustrative.
//
// Rendered by the admin-gated /api/advanced-research-deck route.

import type PptxGenJS from 'pptxgenjs'

// ── Brand palette (Sentimetrx-forward, matches salesPitchDeck) ────────────────
const DN = {
  navy: '0D2B45', navyMid: '0F3A54', sarina: '00B4D8', orange: 'E8632A',
  gold: 'E8B84B', slate: '8FA3AE', slateLight: 'E8EDEF', teal: '0F7173',
  ink: '0D2B45', white: 'FFFFFF',
  green: '16A34A', greenTint: 'D1FAE5', red: 'DC2626', redTint: 'FEE2E2',
  amber: 'D97706', amberTint: 'FEF3C7',
}
const W = 13.33, H = 7.5, AF = 'Arial'

// ── Primitives ────────────────────────────────────────────────────────────────
function header(s: PptxGenJS.Slide, title: string) {
  s.addShape('rect', { x: 0, y: 0, w: W, h: 1.0, fill: { color: DN.navy } })
  s.addText(title, { x: 0.6, y: 0.15, w: 9.8, h: 0.7, fontSize: 26, fontFace: AF, color: DN.white, bold: true, valign: 'middle' })
  s.addText('Sentimetrx', { x: W - 3.0, y: 0.15, w: 2.7, h: 0.7, fontSize: 16, fontFace: AF, color: DN.sarina, bold: true, align: 'right', valign: 'middle' })
  s.addShape('rect', { x: 0, y: 1.0, w: W, h: 0.04, fill: { color: DN.sarina } })
}
function footer(s: PptxGenJS.Slide, client: string | null, pg: number) {
  s.addText('sentimetrx.ai  ·  powered by Datanautix', { x: 0.5, y: H - 0.4, w: 6, h: 0.3, fontSize: 9, color: DN.slate, fontFace: AF })
  s.addText(client ? `Prepared for ${client}  ·  Confidential` : 'Confidential', { x: W - 5.2, y: H - 0.4, w: 3.9, h: 0.3, fontSize: 9, color: DN.slate, fontFace: AF, align: 'right' })
  s.addText(`${pg}`, { x: W - 1.0, y: H - 0.4, w: 0.5, h: 0.3, fontSize: 9, color: DN.slate, fontFace: AF, align: 'right' })
}
function kicker(s: PptxGenJS.Slide, text: string, color = DN.orange) {
  s.addText(text, { x: 0.6, y: 1.22, w: 12.1, h: 0.55, fontSize: 20, fontFace: AF, color, bold: true, valign: 'middle' })
}
function takeaway(s: PptxGenJS.Slide, text: string, color = DN.navy) {
  s.addText(text, { x: 0.6, y: 6.55, w: 12.1, h: 0.5, fontSize: 15, fontFace: AF, color, bold: true, italic: true, align: 'center', valign: 'middle' })
}
/** Rounded panel with a colored top strip, centered heading, and a bulleted body. */
function panel(s: PptxGenJS.Slide, x: number, y: number, w: number, h: number, topStrip: string, heading: string, headingColor: string, bullets: string[], bodyColor = DN.ink, fontSize = 14) {
  s.addShape('rect', { x, y, w, h, fill: { color: DN.slateLight }, rectRadius: 0.12 })
  s.addShape('rect', { x, y, w, h: 0.1, fill: { color: topStrip } })
  s.addText(heading, { x: x + 0.2, y: y + 0.22, w: w - 0.4, h: 0.45, fontSize: 16, fontFace: AF, color: headingColor, bold: true, align: 'center' })
  s.addText(bullets.join('\n'), { x: x + 0.35, y: y + 0.85, w: w - 0.6, h: h - 1.0, fontSize, fontFace: AF, color: bodyColor, bullet: { code: '2022', indent: 16 }, lineSpacing: 22, paraSpaceAfter: 10, valign: 'top' })
}
/** A numbered capability card used on the overview map. */
function capCard(s: PptxGenJS.Slide, x: number, y: number, w: number, h: number, num: string, title: string, body: string) {
  s.addShape('rect', { x, y, w, h, fill: { color: DN.slateLight }, rectRadius: 0.1 })
  s.addShape('rect', { x, y, w, h: 0.09, fill: { color: DN.sarina } })
  s.addText(num, { x: x + 0.2, y: y + 0.22, w: 0.9, h: 0.6, fontSize: 30, fontFace: AF, color: DN.orange, bold: true, valign: 'middle' })
  s.addText(title, { x: x + 1.05, y: y + 0.2, w: w - 1.25, h: 0.65, fontSize: 15.5, fontFace: AF, color: DN.navy, bold: true, valign: 'middle' })
  s.addText(body, { x: x + 0.28, y: y + 0.92, w: w - 0.56, h: h - 1.1, fontSize: 12.5, fontFace: AF, color: DN.ink, lineSpacing: 17, valign: 'top' })
}

// ── Builder ────────────────────────────────────────────────────────────────────
export async function buildAdvancedResearchDeck(pptx: PptxGenJS, opts: { client?: string | null } = {}) {
  const client = opts.client?.trim() || null
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Datanautix'; pptx.company = 'Datanautix'
  pptx.title = 'Four Advanced Research Capabilities — Sentimetrx'
  let pg = 0
  const foot = (s: PptxGenJS.Slide) => footer(s, client, pg)

  // 1 · COVER ───────────────────────────────────────────────────────────────
  {
    const c = pptx.addSlide(); pg++
    c.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.navy } })
    c.addShape('rect', { x: 0, y: 0, w: 0.18, h: H, fill: { color: DN.sarina } })
    c.addText('Four Advanced Research Capabilities', { x: 0.8, y: 1.5, w: 11.7, h: 1.7, fontSize: 42, fontFace: AF, color: DN.white, bold: true, lineSpacing: 46 })
    c.addText('Modern research, end to end — three new ways to gather authentic voice,\nand one analytics engine that turns all of it into decisions.', { x: 0.8, y: 3.25, w: 11.6, h: 1.0, fontSize: 19, fontFace: AF, color: DN.sarina, lineSpacing: 26 })
    c.addText(client ? `A Sentimetrx capability overview  ·  Prepared for ${client}` : 'A Sentimetrx capability overview', { x: 0.8, y: 4.6, w: 11.4, h: 0.5, fontSize: 14, fontFace: AF, color: DN.slate })
    c.addText('Sentimetrx', { x: 0.8, y: 6.0, w: 5, h: 0.5, fontSize: 18, fontFace: AF, color: DN.white, bold: true })
    c.addText('sentimetrx.ai  ·  powered by Datanautix', { x: 0.8, y: 6.5, w: 8, h: 0.4, fontSize: 12, fontFace: AF, color: DN.gold })
    c.addShape('rect', { x: 0, y: H - 0.06, w: W, h: 0.06, fill: { color: DN.sarina } })
  }

  // 2 · OVERVIEW — the four-capability map (the opening slide) ─────────────────
  {
    const s = pptx.addSlide(); pg++; header(s, 'Four Advanced Research Capabilities'); foot(s)
    kicker(s, 'Three ways to hear people. One engine to understand them.', DN.sarina)
    // Three collection modalities across the top
    capCard(s, 0.6, 1.9, 3.9, 2.55, '①', 'Conversational Surveys', 'AI-moderated surveys that adapt to every answer — asking the next question themselves.')
    capCard(s, 4.72, 1.9, 3.9, 2.55, '②', 'Town Hall', 'Capture live, in-person conversations and meetings — themes and patterns extracted automatically.')
    capCard(s, 8.84, 1.9, 3.9, 2.55, '③', 'PulseIQ', 'Virtual focus groups that reach far more people than a room ever could.')
    // Down-arrow cue into the engine
    s.addText('▼   every modality lands on the same engine   ▼', { x: 0.6, y: 4.55, w: 12.15, h: 0.35, fontSize: 12, fontFace: AF, color: DN.slate, bold: true, align: 'center', italic: true })
    // Analytics foundation band
    s.addShape('rect', { x: 0.6, y: 4.95, w: 12.15, h: 1.35, fill: { color: DN.navy }, rectRadius: 0.12 })
    s.addShape('rect', { x: 0.6, y: 4.95, w: 0.14, h: 1.35, fill: { color: DN.sarina } })
    s.addText([
      { text: '④  Analytics — the insight engine\n', options: { fontSize: 17, color: DN.sarina, bold: true } },
      { text: 'Advanced text analytics  ·  charting  ·  statistical analysis  ·  predictive modeling', options: { fontSize: 14, color: DN.white } },
    ], { x: 1.0, y: 4.95, w: 11.5, h: 1.35, fontFace: AF, valign: 'middle', lineSpacing: 24 })
    takeaway(s, 'Most vendors sell one of these. Sentimetrx runs all four — on one platform.')
  }

  // 3 · CONVERSATIONAL SURVEYS — drill-down ───────────────────────────────────
  {
    const s = pptx.addSlide(); pg++; header(s, '① Conversational Surveys'); foot(s)
    kicker(s, 'A survey that listens — and asks the next question itself.')
    panel(s, 0.6, 1.95, 5.85, 4.15, DN.sarina, 'What it is', DN.navy, [
      'A branded AI agent asks your people in natural back-and-forth',
      'Adaptive follow-ups — generated live, in the moment',
      'The exact questions you choose, every time',
      'Reaches the quiet majority who never fill out a form',
      'Deploy anywhere: email, SMS, QR, kiosk, in-app',
    ])
    panel(s, 6.9, 1.95, 5.85, 4.15, DN.orange, 'Why it wins', DN.navy, [
      'Probes the “why” the instant an answer is vague',
      '3–5× more usable text per respondent',
      'No interviewer to schedule, train, or pay',
      'Feels like a conversation, not a form → higher completion',
      'Lands on the same taxonomy + themes as everything else',
    ])
    takeaway(s, 'The depth of an interview, at the scale and cost of a survey.')
  }

  // 4 · THE CONVERSATIONAL ADVANTAGE — why it beats traditional ────────────────
  {
    const s = pptx.addSlide(); pg++; header(s, 'Why Conversational Beats Traditional'); foot(s)
    kicker(s, 'Half of what a static open-ended question collects, you can’t use.')
    // Big stat card
    s.addShape('rect', { x: 0.6, y: 1.95, w: 4.0, h: 3.55, fill: { color: DN.navy }, rectRadius: 0.12 })
    s.addText('40–50%', { x: 0.6, y: 2.35, w: 4.0, h: 1.3, fontSize: 54, fontFace: AF, color: DN.sarina, bold: true, align: 'center' })
    s.addText('of open-ended survey answers carry no usable insight', { x: 0.85, y: 3.7, w: 3.5, h: 1.0, fontSize: 15, fontFace: AF, color: DN.white, align: 'center', lineSpacing: 20 })
    s.addText('Sentimetrx client data, across studies', { x: 0.85, y: 4.9, w: 3.5, h: 0.4, fontSize: 10, fontFace: AF, color: DN.slate, italic: true, align: 'center' })
    // Illustrative side-by-side
    s.addText('Illustrative — the real answers come from your people', { x: 5.0, y: 1.62, w: 7.75, h: 0.3, fontSize: 10.5, fontFace: AF, color: DN.slate, italic: true })
    s.addShape('rect', { x: 5.0, y: 1.95, w: 3.75, h: 3.55, fill: { color: 'FEF2F2' }, rectRadius: 0.1 })
    s.addText('Static form', { x: 5.0, y: 2.05, w: 3.75, h: 0.4, fontSize: 13.5, fontFace: AF, color: DN.red, bold: true, align: 'center' })
    s.addText('Q: How was your experience?\n★★★  (3/5)\n\nQ: Anything to add?\n“It was fine.”\n\n———\nWhat you can act on:\nA neutral score. Nothing else.', { x: 5.25, y: 2.5, w: 3.25, h: 2.9, fontSize: 12, fontFace: AF, color: DN.ink, lineSpacing: 18, valign: 'top' })
    s.addShape('rect', { x: 9.0, y: 1.95, w: 3.75, h: 3.55, fill: { color: 'F0FDF4' }, rectRadius: 0.1 })
    s.addText('Conversational', { x: 9.0, y: 2.05, w: 3.75, h: 0.4, fontSize: 13.5, fontFace: AF, color: DN.green, bold: true, align: 'center' })
    s.addText('Agent: What held it back from a 5?\nGreat product — onboarding was rough\nAgent: Where did it get stuck?\nCouldn’t find how to invite my team\n\n———\nWhat you can act on:\n• Onboarding friction, not the product\n• The exact step: team invites', { x: 9.25, y: 2.5, w: 3.25, h: 2.9, fontSize: 11.5, fontFace: AF, color: DN.ink, lineSpacing: 15, valign: 'top' })
    takeaway(s, 'The fix happens at the moment of collection — not at analysis time, when it’s too late.', DN.sarina)
  }

  // 5 · TOWN HALL — live conversation capture ─────────────────────────────────
  {
    const s = pptx.addSlide(); pg++; header(s, '② Town Hall — Live Conversation Capture'); foot(s)
    kicker(s, 'Record the room. Get the themes — not just a transcript.')
    panel(s, 0.6, 1.95, 5.85, 4.15, DN.sarina, 'What it is', DN.navy, [
      'Capture in-person focus groups, community meetings, and panels',
      'High-accuracy transcription of the full session',
      'Speaker attribution — who said what',
      'Works from a single mic or room audio',
      'Every recorded session becomes a structured record',
    ])
    panel(s, 6.9, 1.95, 5.85, 4.15, DN.orange, 'What you get back', DN.navy, [
      'Themes and patterns auto-extracted across the whole session',
      'Sentiment by topic, not one blended impression',
      'Representative quotes pulled to evidence each theme',
      'A consultant-grade readout — not hours of tape to review',
      'Searchable, and comparable to your surveys and panels',
    ])
    takeaway(s, 'Every in-person session becomes structured, searchable insight — automatically.')
  }

  // 6 · PULSEIQ — virtual focus groups ────────────────────────────────────────
  {
    const s = pptx.addSlide(); pg++; header(s, '③ PulseIQ — Virtual Focus Groups'); foot(s)
    kicker(s, 'The depth of a focus group, at the scale of a survey.')
    panel(s, 0.6, 1.95, 5.85, 4.15, DN.sarina, 'What it is', DN.navy, [
      'Moderated digital focus groups, run by a live AI facilitator',
      'Participants join from anywhere, on their own time',
      'Guided discussion that probes and follows up in real time',
      'Reaches people a physical room never could',
      'A live pulse as opinion forms — not a snapshot weeks later',
    ])
    panel(s, 6.9, 1.95, 5.85, 4.15, DN.orange, 'Why it matters', DN.navy, [
      'Far larger, more representative panels than one room holds',
      'No travel, no scheduling six people into one hour',
      'Consistent, unbiased moderation on every conversation',
      'Qualitative depth without the logistics ceiling',
      'Same analytics engine as surveys and Town Hall',
    ])
    takeaway(s, 'Focus-group depth, without the room — and without the logistics.')
  }

  // 7 · ANALYTICS I — text analytics + charting ───────────────────────────────
  {
    const s = pptx.addSlide(); pg++; header(s, '④ Analytics — Text Analytics & Charting'); foot(s)
    kicker(s, 'Everything you collect, finally read the same way.', DN.sarina)
    panel(s, 0.6, 1.95, 5.85, 4.15, DN.sarina, 'Advanced text analytics', DN.navy, [
      'A standardized multi-axis taxonomy on every response',
      'AI-mined themes — discovered from people’s actual words',
      'Entity and dimension analysis, not just keywords',
      'Sentiment per topic, not one blended score',
      'One engine across surveys, Town Hall, PulseIQ, and reviews',
    ])
    panel(s, 6.9, 1.95, 5.85, 4.15, DN.orange, 'Charting', DN.navy, [
      'Instant charts on any cut of the data',
      'Filter across the whole corpus, live',
      'Distribution, trend, and breakdown by any segment',
      'Structured comparability + open-ended discovery on one screen',
      'Export-ready for the report or the boardroom',
    ])
    takeaway(s, 'The comparability of structured data with the richness of open-ended voice.')
  }

  // 8 · ANALYTICS II — statistics + predictive modeling ───────────────────────
  {
    const s = pptx.addSlide(); pg++; header(s, '④ Analytics — Statistics & Predictive Modeling'); foot(s)
    kicker(s, 'From what happened — to what actually drives it.')
    panel(s, 0.6, 1.95, 5.85, 4.15, DN.sarina, 'Statistical analysis', DN.navy, [
      'Significance testing and cross-tabs you can defend',
      'Rating scales auto-quantified for analysis',
      'Sample-aware — no naïve small-sample claims',
      'Segment against segment, on the same axes',
      'Confidence, not just a chart',
    ])
    panel(s, 6.9, 1.95, 5.85, 4.15, DN.orange, 'Predictive modeling', DN.navy, [
      'Key-driver analysis — what moves satisfaction, loyalty, the outcome',
      'Logistic & regression modeling over numbers, categories, AND themes',
      'Ranks drivers by real impact, controlling for overlap',
      'Turns open-ended themes into modeled predictors',
      'Tells you which lever to pull first',
    ])
    takeaway(s, 'Not just a dashboard — a model that points at the highest-impact move.')
  }

  // 9 · THE THROUGH-LINE — one platform ───────────────────────────────────────
  {
    const s = pptx.addSlide(); pg++; header(s, 'One Platform, Not Four Tools'); foot(s)
    kicker(s, 'The advantage isn’t any one capability — it’s that they share an engine.', DN.sarina)
    // Flow band
    const boxes: [string, string, string][] = [
      ['GATHER', 'Surveys · Town Hall · PulseIQ', DN.sarina],
      ['UNDERSTAND', 'One taxonomy + AI themes', DN.orange],
      ['DECIDE', 'Charts · statistics · prediction', DN.teal],
    ]
    boxes.forEach(([label, body, color], i) => {
      const x = 0.6 + i * 4.28
      s.addShape('rect', { x, y: 2.1, w: 3.9, h: 1.7, fill: { color: DN.slateLight }, rectRadius: 0.1 })
      s.addShape('rect', { x, y: 2.1, w: 3.9, h: 0.1, fill: { color } })
      s.addText(label, { x, y: 2.35, w: 3.9, h: 0.5, fontSize: 17, fontFace: AF, color: DN.navy, bold: true, align: 'center' })
      s.addText(body, { x: x + 0.2, y: 2.9, w: 3.5, h: 0.75, fontSize: 13, fontFace: AF, color: DN.ink, align: 'center', lineSpacing: 17, valign: 'top' })
      if (i < 2) s.addText('→', { x: x + 3.78, y: 2.1, w: 0.6, h: 1.7, fontSize: 30, fontFace: AF, color: DN.slate, bold: true, align: 'center', valign: 'middle' })
    })
    s.addText([
      { text: 'Why it compounds\n', options: { fontSize: 15, color: DN.navy, bold: true } },
      { text: 'Compare a survey against a focus group against a live meeting — on the same axes.  One place to analyze, so insight moves from anecdote → evidence → prediction.  No stitching vendors and exports together.', options: { fontSize: 13.5, color: DN.ink } },
    ], { x: 0.6, y: 4.2, w: 12.15, h: 1.8, fontFace: AF, lineSpacing: 22, valign: 'top' })
    takeaway(s, 'Stop stitching tools together. Gather, understand, and predict in one place.')
  }

  // 10 · CLOSE — where to start ────────────────────────────────────────────────
  {
    const s = pptx.addSlide(); pg++
    s.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.navy } })
    s.addShape('rect', { x: 0, y: 0, w: 0.18, h: H, fill: { color: DN.sarina } })
    s.addText('Where to Start', { x: 0.7, y: 0.55, w: 12, h: 0.7, fontSize: 30, fontFace: AF, color: DN.white, bold: true })
    s.addText('One question, one modality, one analysis layer — see it working on your own topic.', { x: 0.7, y: 1.35, w: 12, h: 0.5, fontSize: 16, fontFace: AF, color: DN.sarina })
    const rows: [string, string][] = [
      ['Pick a question', 'One decision you need better voice on.'],
      ['Choose the mode', 'A conversational survey, a live session, or a virtual panel — or all three.'],
      ['One analysis layer', 'Everything lands on the same engine from day one — text analytics, charts, stats, prediction.'],
      ['See it live', 'A working demo on your own topic, not a generic canned tour.'],
    ]
    rows.forEach(([label, text], i) => {
      const y = 2.2 + i * 0.9
      s.addShape('rect', { x: 0.7, y, w: 12.0, h: 0.76, fill: { color: DN.navyMid }, rectRadius: 0.08 })
      s.addShape('rect', { x: 0.7, y, w: 0.14, h: 0.76, fill: { color: DN.sarina } })
      s.addText(label, { x: 1.0, y, w: 3.1, h: 0.76, fontSize: 15, fontFace: AF, color: DN.gold, bold: true, valign: 'middle' })
      s.addText(text, { x: 4.2, y, w: 8.3, h: 0.76, fontSize: 13.5, fontFace: AF, color: DN.white, valign: 'middle' })
    })
    s.addShape('rect', { x: 0.7, y: 6.0, w: 12.0, h: 0.82, fill: { color: DN.sarina }, rectRadius: 0.08 })
    s.addText('Modern research — gathered, understood, and predicted in one platform.', { x: 0.7, y: 6.0, w: 12.0, h: 0.82, fontSize: 15, fontFace: AF, color: DN.navy, bold: true, align: 'center', valign: 'middle' })
  }

  return pptx
}
