// lib/pptx/eaMembershipDeck.ts
// Sentimetrx capability deck for the EA membership-survey meeting.
// Sentimetrx-forward branding (Datanautix as delivery company in author/footer).
// Exported builder so it can be pixel-QC'd via scripts/_ea_membership_deck_qc.ts
// without going through the auth'd route.

// Brand palette (mirrors app/api/pitch-deck/route.ts — Sentimetrx-forward accents)
const DN = {
  teal: '0F7173',
  navy: '0D2B45',
  navyMid: '0F3A54',
  gold: 'E8B84B',
  orange: 'E85A1A',
  ink: '0D2B45',
  slate: '8FA3AE',
  slateLight: 'E8EDEF',
  white: 'FFFFFF',
  sarinaBlue: '00B4D8',
  hermesOrange: 'E8632A',
}

const W = 13.33
const H = 7.5

function addHeader(slide: any, title: string) {
  slide.addShape('rect', { x: 0, y: 0, w: W, h: 1.0, fill: { color: DN.navy } })
  slide.addText(title, { x: 0.6, y: 0.15, w: 9.5, h: 0.7, fontSize: 28, fontFace: 'Arial', color: DN.white, bold: true })
  // Sentimetrx-forward wordmark, top-right
  slide.addText('Sentimetrx', { x: W - 3.0, y: 0.15, w: 2.7, h: 0.7, fontSize: 16, fontFace: 'Arial', color: DN.sarinaBlue, bold: true, align: 'right', valign: 'middle' })
  slide.addShape('rect', { x: 0, y: 1.0, w: W, h: 0.04, fill: { color: DN.sarinaBlue } })
}

function addFooter(slide: any, pageNum: number) {
  slide.addText('sentimetrx.ai  ·  powered by Datanautix', { x: 0.5, y: H - 0.4, w: 6, h: 0.3, fontSize: 9, color: DN.slate, fontFace: 'Arial' })
  slide.addText('Prepared for EA  ·  Confidential', { x: W - 4.5, y: H - 0.4, w: 3.2, h: 0.3, fontSize: 9, color: DN.slate, fontFace: 'Arial', align: 'right' })
  slide.addText(`${pageNum}`, { x: W - 1.0, y: H - 0.4, w: 0.5, h: 0.3, fontSize: 9, color: DN.slate, fontFace: 'Arial', align: 'right' })
}

export function buildEaMembershipDeck(pptx: any) {
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Datanautix'
  pptx.company = 'Datanautix'
  pptx.title = 'Sentimetrx — Conversational Membership Research for EA'
  let pg = 0

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 1: TITLE
  // ═══════════════════════════════════════════════════════════════
  const s1 = pptx.addSlide()
  pg++
  s1.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.navy } })
  s1.addShape('rect', { x: 0, y: 0, w: 0.18, h: H, fill: { color: DN.sarinaBlue } })
  s1.addText('Listening to Your Members', { x: 0.8, y: 1.7, w: 11.5, h: 1.2, fontSize: 46, fontFace: 'Arial', color: DN.white, bold: true })
  s1.addText('Conversational research that gets a real answer the first time you ask.', { x: 0.8, y: 2.95, w: 11, h: 0.7, fontSize: 20, fontFace: 'Arial', color: DN.sarinaBlue })
  s1.addText('A Sentimetrx capability overview — prepared for EA\nEA SPORTS MVP+ Membership  ·  member & non-member research', { x: 0.8, y: 4.1, w: 11, h: 0.9, fontSize: 15, fontFace: 'Arial', color: DN.slate, lineSpacing: 24 })
  s1.addText('Sentimetrx', { x: 0.8, y: 6.0, w: 5, h: 0.5, fontSize: 18, fontFace: 'Arial', color: DN.white, bold: true })
  s1.addText('sentimetrx.ai  ·  powered by Datanautix', { x: 0.8, y: 6.5, w: 8, h: 0.4, fontSize: 12, fontFace: 'Arial', color: DN.gold })
  s1.addShape('rect', { x: 0, y: H - 0.06, w: W, h: 0.06, fill: { color: DN.sarinaBlue } })
  s1.addNotes(
`Open warmly. This is a capability overview, not a hard pitch — the goal is to show EA how we'd run the membership study and why our approach gets cleaner data than a standard survey.

"What we do is conversational research. Instead of a static form, your members talk to a branded AI agent that asks a smart follow-up the moment an answer is vague — so you get a real answer the first time, not a shrug."

Tee up the agenda: who we are, the problem with how member feedback is collected today, what conversational surveys change, how the analysis ties directly into collection, and how we'd run the study for MVP+ — across members and the players who haven't joined.

Note: warm, relationship-first meeting (Graddy invited us in). Use this as a leave-behind / "here's how it'd work" backup, not a front-to-back script — lead the conversation, reach for the deck if he wants substance.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 2: WHO WE ARE — 40 YEARS IN THE MAKING
  // ═══════════════════════════════════════════════════════════════
  const s2 = pptx.addSlide()
  pg++
  addHeader(s2, 'Who We Are')
  addFooter(s2, pg)
  s2.addText('Forty years of consumer-insight work — and frontier AI is the unlock.', {
    x: 0.6, y: 1.25, w: 12, h: 0.5, fontSize: 18, fontFace: 'Arial', color: DN.hermesOrange, bold: true,
  })
  const milestones = [
    { year: '1986', label: 'AI research begins', desc: 'PhD at Ohio State’s Laboratory for AI Research under Dr. B. Chandrasekaran — a pioneer of diagnostic AI.', color: DN.navy },
    { year: 'Bell Labs', label: 'Into industry', desc: 'Carried machine-reasoning foundations from the lab into industry.', color: DN.teal },
    { year: '2000', label: 'Consumer insights', desc: '25 years as practitioners mining customer & guest experience for major brands.', color: DN.slate },
    { year: '2014', label: 'Consultancy → tech', desc: 'Converted the firm into software built on NLU/NLP to mine open-ended feedback at scale.', color: DN.gold },
    { year: 'Today', label: 'AI is the unlock', desc: 'Frontier reasoning over open-ended language, viable in real time (~$0.002 / interaction).', color: DN.sarinaBlue },
  ]
  milestones.forEach((m, i) => {
    const x = 0.4 + i * 2.55
    s2.addShape('rect', { x, y: 2.0, w: 2.35, h: 0.85, fill: { color: m.color }, rectRadius: 0.08 })
    s2.addText(m.year, { x, y: 2.0, w: 2.35, h: 0.85, fontSize: 15, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle', autoFit: true })
    s2.addShape('rect', { x, y: 2.95, w: 2.35, h: 3.3, fill: { color: DN.slateLight }, rectRadius: 0.08 })
    s2.addShape('rect', { x, y: 2.95, w: 2.35, h: 0.12, fill: { color: m.color } })
    s2.addText(m.label, { x: x + 0.15, y: 3.15, w: 2.05, h: 0.6, fontSize: 13, fontFace: 'Arial', color: DN.navy, bold: true, valign: 'top', autoFit: true })
    s2.addText(m.desc, { x: x + 0.15, y: 3.75, w: 2.05, h: 2.4, fontSize: 11, fontFace: 'Arial', color: DN.ink, valign: 'top', lineSpacing: 15 })
  })
  s2.addShape('rect', { x: 0.4, y: 6.5, w: 12.5, h: 0.6, fill: { color: DN.navy }, rectRadius: 0.08 })
  s2.addText('We have studied how people answer questions for four decades. Sentimetrx is that craft, automated.', {
    x: 0.4, y: 6.5, w: 12.5, h: 0.6, fontSize: 13, fontFace: 'Arial', color: DN.white, italic: true, bold: true, align: 'center', valign: 'middle',
  })
  s2.addNotes(
`30 seconds. Establish credibility without dwelling. The point for a tech audience: we are not a survey tool that bolted on AI — we are insight practitioners who have wanted this capability for 40 years, and the models finally make it real-time and economical.

Land the bottom line: "We have studied how people answer questions for four decades. Sentimetrx is that craft, automated."`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 3: THE PROBLEM — HALF OF WHAT YOU COLLECT, YOU CAN'T USE
  // ═══════════════════════════════════════════════════════════════
  const s3 = pptx.addSlide()
  pg++
  addHeader(s3, 'The Problem')
  addFooter(s3, pg)
  s3.addText('Half of what an open-ended question collects, you can’t actually use.', {
    x: 0.6, y: 1.25, w: 12, h: 0.6, fontSize: 23, fontFace: 'Arial', color: DN.hermesOrange, bold: true,
  })
  // Big stat block
  s3.addShape('rect', { x: 0.6, y: 2.1, w: 4.0, h: 3.5, fill: { color: DN.navy }, rectRadius: 0.12 })
  s3.addText('40–50%', { x: 0.6, y: 2.5, w: 4.0, h: 1.3, fontSize: 60, fontFace: 'Arial', color: DN.sarinaBlue, bold: true, align: 'center' })
  s3.addText('of open-ended answers carry no usable insight', { x: 0.8, y: 3.8, w: 3.6, h: 1.0, fontSize: 15, fontFace: 'Arial', color: DN.white, align: 'center', lineSpacing: 20 })
  s3.addText('Sentimetrx client data, across studies', { x: 0.8, y: 4.85, w: 3.6, h: 0.5, fontSize: 10, fontFace: 'Arial', color: DN.slate, italic: true, align: 'center' })
  // Right column: the dead-end answers + why
  s3.addShape('rect', { x: 5.0, y: 2.1, w: 7.7, h: 3.5, fill: { color: DN.slateLight }, rectRadius: 0.12 })
  s3.addText('The answers you pay to collect:', { x: 5.3, y: 2.3, w: 7.1, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.navy, bold: true })
  s3.addText([
    { text: '“It’s fine.”     “Good.”     “N/A.”     “Love it.”     “Meh.”\n', options: { fontSize: 18, color: DN.ink, bold: true, lineSpacing: 30 } },
    { text: '\nNot because members have nothing to say — because a static form never asks the one follow-up that would surface it. The moment to dig is gone the instant they tap “Next.”', options: { fontSize: 14, color: DN.slate, lineSpacing: 22 } },
  ], { x: 5.3, y: 2.8, w: 7.1, h: 2.6, valign: 'top', fontFace: 'Arial' })
  s3.addText('You are paying full price for the response — and throwing away half the signal at analysis time.', {
    x: 0.6, y: 5.9, w: 12, h: 0.5, fontSize: 15, fontFace: 'Arial', color: DN.navy, bold: true, italic: true, align: 'center',
  })
  s3.addNotes(
`The anchor stat — and it is from our OWN client data, so say that explicitly; it is not a borrowed industry figure.

"Across our studies, 40 to 50 percent of open-ended answers carry no usable insight. 'It's fine.' 'Good.' 'N/A.' You are paying full price to collect the response, and then discarding half the signal when you go to analyze it."

The cause matters: it is not apathy. A static form simply never asks the one follow-up that would surface the real answer — and once the member taps Next, that moment is gone.

This sets up the insight slide.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 4: THE INSIGHT
  // ═══════════════════════════════════════════════════════════════
  const s4 = pptx.addSlide()
  pg++
  addHeader(s4, 'The Insight')
  addFooter(s4, pg)
  s4.addShape('rect', { x: 0.6, y: 1.5, w: 12.1, h: 2.2, fill: { color: DN.slateLight }, rectRadius: 0.15 })
  s4.addText('Most surveys are a monologue pretending to be a conversation.', {
    x: 1.1, y: 1.75, w: 11.1, h: 1.0, fontSize: 24, fontFace: 'Arial', color: DN.navy, bold: true, lineSpacing: 32,
  })
  s4.addText('When a member says “the perks aren’t worth it,” a form moves to the next checkbox.\nA good interviewer would say “which perks did you expect to use?”', {
    x: 1.1, y: 2.85, w: 11.1, h: 0.8, fontSize: 14, fontFace: 'Arial', color: DN.slate, lineSpacing: 22,
  })
  s4.addText('That follow-up is where the insight lives. Until now, it required a human in the loop.', {
    x: 0.6, y: 4.3, w: 12, h: 0.5, fontSize: 17, fontFace: 'Arial', color: DN.hermesOrange, bold: true,
  })
  s4.addText('Fixing it at analysis time is too late. The fix has to happen at the moment of collection.', {
    x: 0.6, y: 5.4, w: 12, h: 0.5, fontSize: 16, fontFace: 'Arial', color: DN.navy, bold: true,
  })
  s4.addNotes(
`Land this slowly — it is the whole thesis.

"Most surveys are a monologue pretending to be a conversation. When a member says 'the perks aren't worth it,' a form just moves on. A good interviewer would lean in: 'which perks did you expect to use?' That follow-up is where the insight lives."

Then the pivot that a data team will appreciate: "You cannot fix this with better analytics after the fact — the detail was never captured. The fix has to happen at the moment of collection." That is exactly what conversational surveys do.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 5: CONVERSATIONAL SURVEYS — THE SOLUTION
  // ═══════════════════════════════════════════════════════════════
  const s5 = pptx.addSlide()
  pg++
  addHeader(s5, 'Conversational Surveys')
  addFooter(s5, pg)
  s5.addText('A branded AI agent that adapts every follow-up in real time.', {
    x: 0.6, y: 1.25, w: 12, h: 0.6, fontSize: 22, fontFace: 'Arial', color: DN.sarinaBlue, bold: true, align: 'center',
  })
  const caps = [
    { t: 'Conversational collection', d: 'Members chat with a branded agent — not a form. It greets, asks, and listens.', c: DN.sarinaBlue },
    { t: 'AI clarifiers, in the moment', d: 'Detects a vague or negative answer and probes for the “why” before moving on.', c: DN.teal },
    { t: 'On-brand deflection', d: 'Off-topic or hostile inputs handled gracefully, in your voice — never derails.', c: DN.hermesOrange },
    { t: '15 languages, one click', d: 'Members answer in their language; analysis returns to your team in English.', c: DN.gold },
  ]
  caps.forEach((p, i) => {
    const col = i % 2, row = Math.floor(i / 2)
    const x = 0.6 + col * 6.15
    const y = 2.05 + row * 1.9
    s5.addShape('rect', { x, y, w: 5.95, h: 1.7, fill: { color: DN.slateLight }, rectRadius: 0.1 })
    s5.addShape('rect', { x, y, w: 0.16, h: 1.7, fill: { color: p.c } })
    s5.addText(p.t, { x: x + 0.32, y: y + 0.16, w: 5.5, h: 0.5, fontSize: 17, fontFace: 'Arial', color: DN.navy, bold: true })
    s5.addText(p.d, { x: x + 0.32, y: y + 0.68, w: 5.5, h: 0.9, fontSize: 13, fontFace: 'Arial', color: DN.ink, lineSpacing: 18, valign: 'top' })
  })
  s5.addText('One platform: collection, follow-up, translation, and analysis — no vendors stitched together.', {
    x: 0.6, y: 6.05, w: 12, h: 0.5, fontSize: 15, fontFace: 'Arial', color: DN.navy, bold: true, italic: true, align: 'center',
  })
  s5.addNotes(
`Four capabilities, ~60 seconds. The headline is "adapts every follow-up in real time."

CONVERSATIONAL COLLECTION — a branded agent, a chat, not a form.
AI CLARIFIERS — the core mechanic: it detects a vague or negative answer and asks an intelligent follow-up (≤25 words) to get the why; when an answer is already specific it moves on, so the survey never feels padded.
ON-BRAND DEFLECTION — off-topic or hostile input is redirected warmly in your voice; matters for a gaming audience.
15 LANGUAGES — one-click translation of the whole study; members answer in their language, you read it in English.

Close on the consolidation point: collection + follow-up + translation + analysis in one platform.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 6: THE CONVERSATIONAL ADVANTAGE (side-by-side, membership-flavored)
  // ═══════════════════════════════════════════════════════════════
  const s6 = pptx.addSlide()
  pg++
  addHeader(s6, 'The Conversational Advantage')
  addFooter(s6, pg)
  s6.addShape('rect', { x: 0.5, y: 1.35, w: 5.85, h: 4.7, fill: { color: 'FEF2F2' }, rectRadius: 0.1 })
  s6.addText('Static Survey', { x: 0.5, y: 1.45, w: 5.85, h: 0.45, fontSize: 14, fontFace: 'Arial', color: 'DC2626', bold: true, align: 'center' })
  s6.addText('Q: How do you feel about your MVP+ membership?\n★★★ (3/5)\n\nQ: Anything to add?\n“It’s OK.”\n\n———\n\nWhat you can act on:\nNeutral sentiment. Nothing else.', {
    x: 0.8, y: 2.05, w: 5.3, h: 3.8, fontSize: 13, fontFace: 'Arial', color: DN.ink, lineSpacing: 22,
  })
  s6.addShape('rect', { x: 7.0, y: 1.35, w: 5.85, h: 4.7, fill: { color: 'F0FDF4' }, rectRadius: 0.1 })
  s6.addText('Sentimetrx Conversation', { x: 7.0, y: 1.45, w: 5.85, h: 0.45, fontSize: 14, fontFace: 'Arial', color: '16A34A', bold: true, align: 'center' })
  s6.addText('Agent: How do you feel about your MVP+ membership? [taps 3/5]\nAgent: What’s holding it back from a 5?\nMember: I got it for the early access to Madden\nAgent: How’s the rest of it landing?\nMember: Most of the perks are Ultimate Team packs — I only play Franchise\nAgent: What would’ve made it a 5?\nMember: Franchise stuff, not just MUT rewards\n\n———\n\nWhat you can act on:\n• Joined for early access (acquisition driver)\n• Franchise player, UT-tilted rewards (value mismatch by mode)\n• Wants mode-specific perks (roadmap lever)', {
    x: 7.3, y: 2.05, w: 5.3, h: 3.8, fontSize: 11.5, fontFace: 'Arial', color: DN.ink, lineSpacing: 17,
  })
  s6.addText('3–5× more actionable text per respondent. Same survey length. No interviewer required.', {
    x: 0.5, y: 6.25, w: 12.3, h: 0.4, fontSize: 15, fontFace: 'Arial', color: DN.sarinaBlue, bold: true, align: 'center',
  })
  s6.addNotes(
`The slide that makes a research/insights lead lean in. Walk both columns.

LEFT: "How do you feel about your MVP+ membership? 3 out of 5. Anything to add? It's OK." All you can act on is a neutral score.

RIGHT: same opener, but the agent probes — "what's holding it back from a 5?" → "I got it for the early access to Madden" → "how's the rest landing?" → "most of the perks are Ultimate Team packs and I only play Franchise" → "what would've made it a 5?" → "Franchise stuff, not just MUT."

From one member you now have the acquisition driver (early access), a value mismatch by mode (a Franchise player getting UT-tilted rewards), AND a concrete roadmap lever (mode-specific perks) — three things Graddy's team can act on. Note: illustrative; the real drivers come from EA's members.

Punchline: "3 to 5 times more actionable text per respondent, same survey length, no interviewer." Note: the membership example is illustrative — the real drivers come from EA's actual members.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 7: BETTER DATA IN → BETTER INSIGHT OUT (collection ↔ analysis)
  // ═══════════════════════════════════════════════════════════════
  const s7 = pptx.addSlide()
  pg++
  addHeader(s7, 'Collection and Analysis, Connected')
  addFooter(s7, pg)
  s7.addText('The analysis is only as good as the data — so we improve the data at the source.', {
    x: 0.6, y: 1.25, w: 12, h: 0.6, fontSize: 19, fontFace: 'Arial', color: DN.hermesOrange, bold: true,
  })
  // Pipeline of 4 stages with arrows
  const stages = [
    { t: 'Conversational\ncollection', d: 'Adaptive follow-ups capture specifics, not shrugs', c: DN.sarinaBlue },
    { t: 'Structured\nresponses', d: 'Every answer scored, tagged, and tied to the member', c: DN.teal },
    { t: 'Themes, entities\n& key drivers', d: 'What members raise, about which features, and what moves renewal', c: DN.hermesOrange },
    { t: 'Significance\n& cohorts', d: 'By game, mode, and segment — what’s real vs. noise', c: DN.navy },
  ]
  const sw = 2.85, gap = 0.45
  const totalW = stages.length * sw + (stages.length - 1) * gap
  const startX = (W - totalW) / 2
  stages.forEach((st, i) => {
    const x = startX + i * (sw + gap)
    s7.addShape('rect', { x, y: 2.3, w: sw, h: 3.0, fill: { color: DN.slateLight }, rectRadius: 0.1 })
    s7.addShape('rect', { x, y: 2.3, w: sw, h: 0.7, fill: { color: st.c }, rectRadius: 0.1 })
    s7.addShape('rect', { x, y: 2.75, w: sw, h: 0.25, fill: { color: st.c } })
    s7.addText(st.t, { x: x + 0.1, y: 2.3, w: sw - 0.2, h: 0.7, fontSize: 14, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
    s7.addText(st.d, { x: x + 0.2, y: 3.2, w: sw - 0.4, h: 1.9, fontSize: 13, fontFace: 'Arial', color: DN.ink, lineSpacing: 19, valign: 'top', align: 'center' })
    if (i < stages.length - 1) {
      s7.addText('→', { x: x + sw, y: 2.3, w: gap, h: 3.0, fontSize: 24, fontFace: 'Arial', color: DN.slate, bold: true, align: 'center', valign: 'middle' })
    }
  })
  s7.addText('One platform, end to end. No exporting raw verbatims to a separate text-analytics vendor.', {
    x: 0.6, y: 5.7, w: 12, h: 0.5, fontSize: 15, fontFace: 'Arial', color: DN.navy, bold: true, italic: true, align: 'center',
  })
  s7.addNotes(
`This is the slide a technical/data audience cares about most: collection and analysis are the same system, not two vendors taped together.

"Garbage in, garbage out is the real problem with feedback programs. We attack it at the source — the conversation captures specifics, so by the time it reaches the models there is real signal to work with."

Walk the pipeline: conversational collection → structured, scored responses → themes, entities and key drivers → statistical significance and cohort breakdowns by game, mode, and segment. Same login, same platform — the verbatims never leave to a separate text-analytics tool.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 8: THE ANALYSIS LAYER (what EA gets out)
  // ═══════════════════════════════════════════════════════════════
  const s8 = pptx.addSlide()
  pg++
  addHeader(s8, 'What You Get Out')
  addFooter(s8, pg)
  s8.addText('Decision-ready analysis — in seconds, not weeks.', {
    x: 0.6, y: 1.25, w: 12, h: 0.5, fontSize: 22, fontFace: 'Arial', color: DN.sarinaBlue, bold: true,
  })
  const outs = [
    { t: 'Themes & key drivers', d: 'The handful of things driving satisfaction and renewal intent — ranked by impact, not just frequency.', c: DN.sarinaBlue },
    { t: 'Feature-level sentiment', d: 'Entity analysis pins sentiment to specific perks — early access, the monthly Ultimate Team packs, the two-game bundle, mode progression — so you see exactly what lands.', c: DN.teal },
    { t: 'Significance testing', d: 'Differences flagged as statistically real vs. noise, so you act on signal — no data-science team required.', c: DN.hermesOrange },
    { t: 'Segment & cohort cuts', d: 'Cut every theme by game played, mode (Franchise/Dynasty/UT), platform, or region to see who feels what.', c: DN.gold },
  ]
  outs.forEach((o, i) => {
    const col = i % 2, row = Math.floor(i / 2)
    const x = 0.6 + col * 6.15
    const y = 2.0 + row * 1.95
    s8.addShape('rect', { x, y, w: 5.95, h: 1.75, fill: { color: DN.slateLight }, rectRadius: 0.1 })
    s8.addShape('rect', { x, y, w: 0.16, h: 1.75, fill: { color: o.c } })
    s8.addText(o.t, { x: x + 0.32, y: y + 0.16, w: 5.5, h: 0.5, fontSize: 17, fontFace: 'Arial', color: DN.navy, bold: true })
    s8.addText(o.d, { x: x + 0.32, y: y + 0.66, w: 5.5, h: 1.0, fontSize: 12.5, fontFace: 'Arial', color: DN.ink, lineSpacing: 17, valign: 'top' })
  })
  s8.addText('Live dashboard for your team + an exportable, presentation-ready readout.', {
    x: 0.6, y: 6.05, w: 12, h: 0.5, fontSize: 15, fontFace: 'Arial', color: DN.navy, bold: true, italic: true, align: 'center',
  })
  s8.addNotes(
`What EA actually receives. Keep it concrete and tied to membership decisions.

THEMES & KEY DRIVERS — ranked by impact on renewal intent, not just how often something is mentioned. This is the "what should we fix first" answer.
FEATURE-LEVEL SENTIMENT — entity analysis attaches sentiment to specific perks (early access, the monthly Ultimate Team packs, the two-game bundle, mode progression), so "value" stops being a vague score and becomes a per-feature read.
SIGNIFICANCE TESTING — we flag what's statistically real so you don't chase noise.
SEGMENT & COHORT CUTS — every theme sliced by game played, mode, platform, region.

Close: it shows up as a live dashboard plus an exportable, presentation-ready readout — the kind of deck this one was built in.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 9: WHY NOW
  // ═══════════════════════════════════════════════════════════════
  const s9 = pptx.addSlide()
  pg++
  addHeader(s9, 'Why Now')
  addFooter(s9, pg)
  s9.addText('The technology and the moment finally line up.', {
    x: 0.6, y: 1.25, w: 12, h: 0.5, fontSize: 22, fontFace: 'Arial', color: DN.hermesOrange, bold: true,
  })
  const whys = [
    { t: 'AI crossed the cost line', d: 'Real-time reasoning over open-ended answers now costs ~$0.002 per interaction — viable at member scale.' },
    { t: 'Survey fatigue is peaking', d: 'Static forms get ignored. A short, conversational exchange earns a real answer where a form gets a shrug.' },
    { t: 'Players expect chat-native', d: 'Your members already live in chat and conversational interfaces — a form feels dated; a conversation feels normal.' },
    { t: 'Consolidation beats stitching', d: 'One platform replaces the survey + outreach + text-analytics + translation stack most programs run today.' },
  ]
  whys.forEach((w, i) => {
    const y = 2.1 + i * 1.05
    s9.addShape('rect', { x: 0.6, y, w: 12.1, h: 0.9, fill: { color: DN.slateLight }, rectRadius: 0.08 })
    s9.addShape('rect', { x: 0.6, y, w: 0.16, h: 0.9, fill: { color: DN.sarinaBlue } })
    s9.addText(w.t, { x: 0.95, y, w: 3.6, h: 0.9, fontSize: 15, fontFace: 'Arial', color: DN.navy, bold: true, valign: 'middle' })
    s9.addText(w.d, { x: 4.7, y, w: 7.85, h: 0.9, fontSize: 13, fontFace: 'Arial', color: DN.ink, valign: 'middle', lineSpacing: 17 })
  })
  s9.addNotes(
`Four forces, ~45 seconds. Tailor the third one to EA — gamers are the audience least likely to fill out a form and most comfortable in a chat interface.

AI COST — the capability existed in theory for years; only now is it real-time and economical at member scale.
SURVEY FATIGUE — response quality and rates keep falling; conversation reverses that.
CHAT-NATIVE EXPECTATIONS — your members already converse with interfaces; a static form feels dated to them.
CONSOLIDATION — one platform replaces the multi-vendor stack.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 10: PROOF
  // ═══════════════════════════════════════════════════════════════
  const s10 = pptx.addSlide()
  pg++
  addHeader(s10, 'Proof It Works')
  addFooter(s10, pg)
  const proofs = [
    { org: 'Harlem Globetrotters', stat: '10×', fs: 32, d: 'more responses than their prior survey — 15–20% in-venue response rate.' },
    { org: 'JW Marriott', stat: '10×', fs: 32, d: 'more responses than post-stay email, captured in the moment.' },
    { org: 'UCF Rosen College', stat: '<5%', fs: 32, d: 'of the expert team’s time, at near-identical analysis quality.' },
    { org: 'Orlando Resort', stat: 'Seconds', fs: 22, d: 'to identify a root cause that used to take weeks of manual reading.' },
  ]
  proofs.forEach((p, i) => {
    const col = i % 2, row = Math.floor(i / 2)
    const x = 0.6 + col * 6.15
    const y = 1.65 + row * 1.85
    s10.addShape('rect', { x, y, w: 5.95, h: 1.65, fill: { color: DN.slateLight }, rectRadius: 0.1 })
    s10.addText(p.stat, { x: x + 0.15, y: y + 0.15, w: 1.95, h: 1.35, fontSize: p.fs, fontFace: 'Arial', color: DN.sarinaBlue, bold: true, align: 'center', valign: 'middle' })
    s10.addText(p.org, { x: x + 2.15, y: y + 0.2, w: 3.6, h: 0.45, fontSize: 15, fontFace: 'Arial', color: DN.navy, bold: true })
    s10.addText(p.d, { x: x + 2.15, y: y + 0.62, w: 3.65, h: 0.9, fontSize: 12, fontFace: 'Arial', color: DN.ink, lineSpacing: 16, valign: 'top' })
  })
  s10.addShape('rect', { x: 0.6, y: 5.55, w: 12.1, h: 1.1, fill: { color: DN.navy }, rectRadius: 0.1 })
  s10.addText('“Ana performed almost as well as the team of professors and outperformed the graduate student — in less than 5% of the time.”', {
    x: 0.9, y: 5.65, w: 11.5, h: 0.65, fontSize: 13, fontFace: 'Arial', color: DN.white, italic: true, valign: 'middle',
  })
  s10.addText('— Dr. Fevzi Okumus, UCF Rosen College of Hospitality Management', {
    x: 0.9, y: 6.28, w: 11.5, h: 0.32, fontSize: 11, fontFace: 'Arial', color: DN.gold,
  })
  s10.addNotes(
`Four real proof points — all from shipped, validated work. Read the verbatim quote; do not paraphrase it.

GLOBETROTTERS / JW MARRIOTT — same headline: in-the-moment conversational capture gets ~10× the responses of a post-event email form.
UCF ROSEN — the academic validation: matched an expert team's analysis quality in under 5% of the time.
ORLANDO RESORT — speed-to-root-cause: seconds vs. weeks.

Then the quote from Dr. Okumus. This is the credibility close before we talk about EA specifically.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 11: FOR EA — THE MEMBERSHIP STUDY
  // ═══════════════════════════════════════════════════════════════
  const s11 = pptx.addSlide()
  pg++
  s11.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.navy } })
  s11.addShape('rect', { x: 0, y: 0, w: 0.18, h: H, fill: { color: DN.sarinaBlue } })
  s11.addText('For EA: Growing the Value of MVP+', { x: 0.7, y: 0.5, w: 12, h: 0.7, fontSize: 30, fontFace: 'Arial', color: DN.white, bold: true })
  s11.addText('What would make MVP+ more valuable — to your members, and to the players who haven’t joined.', { x: 0.7, y: 1.28, w: 12, h: 0.5, fontSize: 16, fontFace: 'Arial', color: DN.sarinaBlue })
  // Left: your members
  s11.addText('Your members', { x: 0.7, y: 1.95, w: 5.9, h: 0.4, fontSize: 16, fontFace: 'Arial', color: DN.gold, bold: true })
  s11.addText(
    'What’s delivering value — and what they forgot they had\n' +
    'What’s missing that would make next year an obvious yes\n' +
    'Which new perk would make it a no-brainer\n' +
    'How it differs by game, mode, and platform',
    { x: 0.8, y: 2.4, w: 5.8, h: 2.1, fontSize: 13, fontFace: 'Arial', color: DN.white, bullet: { code: '2022', indent: 18 }, lineSpacing: 21, paraSpaceAfter: 8, valign: 'top' }
  )
  // Right: the players who haven't joined
  s11.addText('The players who haven’t joined', { x: 6.9, y: 1.95, w: 5.9, h: 0.4, fontSize: 16, fontFace: 'Arial', color: DN.gold, bold: true })
  s11.addText(
    'Whether they even know what MVP+ is\n' +
    'What’s holding them back from joining\n' +
    'What would make it worth it to them\n' +
    'The one change that flips them to yes',
    { x: 7.0, y: 2.4, w: 5.8, h: 2.1, fontSize: 13, fontFace: 'Arial', color: DN.white, bullet: { code: '2022', indent: 18 }, lineSpacing: 21, paraSpaceAfter: 8, valign: 'top' }
  )
  // Longitudinal "walk the journey" band
  s11.addShape('rect', { x: 0.7, y: 4.75, w: 12.0, h: 1.15, fill: { color: DN.navyMid }, rectRadius: 0.08 })
  s11.addShape('rect', { x: 0.7, y: 4.75, w: 0.16, h: 1.15, fill: { color: DN.sarinaBlue } })
  s11.addText('Then we walk the journey', { x: 1.0, y: 4.9, w: 11.5, h: 0.4, fontSize: 15, fontFace: 'Arial', color: DN.gold, bold: true })
  s11.addText('Re-ask as the perk mix grows, so every change becomes a read on what moved the value — and why. Baseline now; the insight compounds wave over wave.', {
    x: 1.0, y: 5.28, w: 11.5, h: 0.55, fontSize: 13, fontFace: 'Arial', color: DN.white, lineSpacing: 18, valign: 'top',
  })
  // CTA
  s11.addShape('rect', { x: 0.7, y: 6.15, w: 12.0, h: 0.78, fill: { color: DN.sarinaBlue }, rectRadius: 0.08 })
  s11.addText('Let’s baseline a first wave.   sentimetrx.ai  ·  sanjay@datanautix.com', {
    x: 0.7, y: 6.15, w: 12.0, h: 0.78, fontSize: 16, fontFace: 'Arial', color: DN.navy, bold: true, align: 'center', valign: 'middle',
  })
  s11.addNotes(
`The close — answer EA's exact ask back to them: "what would make the membership valuable to members and non-members," and "grow its value over time." Make it about MVP+, not us.

TWO POPULATIONS (this is what Graddy asked for in writing):
- YOUR MEMBERS — what's delivering value, what they ignore, what's missing, and which new perk would make next year an obvious yes. Cut by game played, mode (Franchise/Dynasty vs. Ultimate Team), platform.
- THE PLAYERS WHO HAVEN'T JOINED — awareness, what's holding them back, what would make it worth it, and the single change that flips them to yes. This is the acquisition lever telemetry can't see.

WALK THE JOURNEY (the headline idea): MVP+ is a moving target — the perk mix will grow. So baseline it now, then re-ask as perks change; every change becomes a near-experiment on what moved the value, in members' own words. The insight compounds — a true time-series, not disconnected snapshots. This is the partnership, not a one-off report.

CTA: "Let's baseline a first wave." Low-friction — a slice of members + a slice of non-members.

CUSTOMIZE before sending: confirm any specific perk names; contact is set to sanjay@datanautix.com — swap to larry@datanautix.com if Larry fronts the EA relationship.`
  )

  return pptx
}
