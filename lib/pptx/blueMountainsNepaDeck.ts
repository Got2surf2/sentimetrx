// lib/pptx/blueMountainsNepaDeck.ts
// "Hearing the Blue Mountains" — a Datanautix capability briefing for the USDA
// Forest Service on turning the NEPA public-comment period into a real-time read
// on objection risk.
//
// AUDIENCE: Forest Service planners / NEPA staff / a Region-6 decision team.
// TONE: de-risk the process, avoid a repeat of the 2019 collapse, hit the
// objection-window deadlines. NOT a generic "AI is cool" pitch.
//
// The spine is the real Blue Mountains Forest Plan Revision (Malheur, Umatilla,
// Wallowa-Whitman NFs): the first attempt ran ~15 years (2004 → 2018 Final EIS →
// withdrawn March 2019 after Tribes, counties, permittees, and conservation
// groups converged in objection), and the re-initiated revision is in its 90-day
// comment window RIGHT NOW (Jul 2 – Sep 30, 2026). Every load-bearing fact here
// is sourced (see slide notes); no comment/objection COUNTS are invented, per the
// no-fabricated-data rule — capability claims are qualitative or method-based.
//
// Forest-Service framing note: FS uses a PRE-decisional objection process
// (36 CFR 218/219), so concerns raised in comments become the objections that can
// freeze a decision before it is signed — which is exactly what the concern-
// capture agent surfaces early.
//
// Branding: Datanautix company brand (the consulting company delivering to a gov
// client), powered by the Sentimetrx platform. Pine/forest accents nod to the
// Forest Service audience (client colors) while keeping Datanautix chrome — never
// white-labeled. Exported builder so it can be pixel-QC'd.

import type PptxGenJS from 'pptxgenjs'

// Palette — Forest Service pine (audience) + Datanautix brand accents (teal/orange).
const C = {
  pine: '1B4332',       // header bars / title bg — deep Forest Service green
  pineMid: '2D6A4F',
  moss: '52B788',       // bright accent rule
  mossDeep: '40916C',
  dnTeal: '0F7173',     // Datanautix "data"
  dnOrange: 'E8632A',   // Datanautix "nautix"
  gold: 'E8B84B',
  ink: '1B2D26',        // near-black green-gray body text
  slate: '7C8B84',
  slateLight: 'E7EDE9',
  card: 'F4F7F5',       // warm off-white, faint green tint
  cardTint: 'EAF2ED',
  white: 'FFFFFF',
  amber: 'B45309',
  amberTint: 'FDF3E3',
  red: 'B91C1C',
  redTint: 'FBEAEA',
  green: '16A34A',
}

const W = 13.33
const H = 7.5

// Datanautix wordmark: "data" teal + "nautix" orange, one word no separator.
function addWordmark(slide: PptxGenJS.Slide, x: number, y: number, size: number, onDark: boolean) {
  slide.addText(
    [
      { text: 'data', options: { color: onDark ? C.moss : C.dnTeal, bold: true } },
      { text: 'nautix', options: { color: C.dnOrange, bold: true } },
    ],
    { x, y, w: 3.2, h: 0.5, fontSize: size, fontFace: 'Arial', align: 'left', valign: 'middle' },
  )
}

function addHeader(slide: PptxGenJS.Slide, title: string, sub?: string) {
  slide.addShape('rect', { x: 0, y: 0, w: W, h: 1.0, fill: { color: C.pine } })
  slide.addText(title, { x: 0.6, y: sub ? 0.1 : 0.15, w: 9.4, h: sub ? 0.56 : 0.7, fontSize: 26, fontFace: 'Arial', color: C.white, bold: true, valign: sub ? 'bottom' : 'middle' })
  if (sub) slide.addText(sub, { x: 0.62, y: 0.62, w: 9.6, h: 0.34, fontSize: 12.5, fontFace: 'Arial', color: C.moss })
  addWordmark(slide, W - 3.0, 0.25, 15, true)
  slide.addShape('rect', { x: 0, y: 1.0, w: W, h: 0.04, fill: { color: C.moss } })
}

function addFooter(slide: PptxGenJS.Slide, pageNum: number) {
  slide.addText('datanautix.com  ·  powered by the Sentimetrx platform', { x: 0.5, y: H - 0.4, w: 6.5, h: 0.3, fontSize: 9, color: C.slate, fontFace: 'Arial' })
  slide.addText('Prepared for the USDA Forest Service  ·  Confidential', { x: W - 5.2, y: H - 0.4, w: 4.0, h: 0.3, fontSize: 9, color: C.slate, fontFace: 'Arial', align: 'right' })
  slide.addText(`${pageNum}`, { x: W - 0.9, y: H - 0.4, w: 0.5, h: 0.3, fontSize: 9, color: C.slate, fontFace: 'Arial', align: 'right' })
}

// Three-across card row helper (title + body + colored top stripe).
function cardRow(
  slide: PptxGenJS.Slide,
  y: number,
  h: number,
  cards: { t: string; d: string; c: string }[],
) {
  const n = cards.length
  const gap = 0.23
  const totalW = 12.13
  const cw = (totalW - gap * (n - 1)) / n
  cards.forEach((card, i) => {
    const x = 0.6 + i * (cw + gap)
    slide.addShape('rect', { x, y, w: cw, h, fill: { color: C.card }, rectRadius: 0.1 })
    slide.addShape('rect', { x, y, w: cw, h: 0.12, fill: { color: card.c } })
    slide.addText(card.t, { x: x + 0.22, y: y + 0.26, w: cw - 0.44, h: 0.72, fontSize: 15, fontFace: 'Arial', color: C.pine, bold: true, valign: 'top' })
    slide.addText(card.d, { x: x + 0.22, y: y + 1.02, w: cw - 0.44, h: h - 1.2, fontSize: 12, fontFace: 'Arial', color: C.ink, valign: 'top', lineSpacing: 17 })
  })
}

export function buildBlueMountainsNepaDeck(pptx: PptxGenJS) {
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Datanautix'
  pptx.company = 'Datanautix'
  pptx.title = 'Hearing the Blue Mountains — Real-time objection-risk from the NEPA comment period'
  let pg = 0

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 1 — TITLE
  // ═══════════════════════════════════════════════════════════════
  const s1 = pptx.addSlide()
  pg++
  s1.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.pine } })
  s1.addShape('rect', { x: 0, y: 0, w: 0.18, h: H, fill: { color: C.moss } })
  s1.addText('Hearing the Blue Mountains', { x: 0.8, y: 1.35, w: 11.6, h: 1.1, fontSize: 46, fontFace: 'Arial', color: C.white, bold: true })
  s1.addText('Turning the NEPA public-comment period from a compliance burden into a real-time read on objection risk.', {
    x: 0.8, y: 2.7, w: 11.4, h: 1.0, fontSize: 19, fontFace: 'Arial', color: C.moss, lineSpacing: 27,
  })
  s1.addText('A Datanautix capability briefing for the USDA Forest Service\nBlue Mountains Forest Plan Revision  ·  Malheur · Umatilla · Wallowa-Whitman National Forests  ·  Region 6', {
    x: 0.8, y: 4.15, w: 11.6, h: 0.9, fontSize: 14.5, fontFace: 'Arial', color: C.slateLight, lineSpacing: 23,
  })
  addWordmark(s1, 0.8, 6.0, 22, true)
  s1.addText('powered by the Sentimetrx platform', { x: 0.8, y: 6.55, w: 8, h: 0.4, fontSize: 12, fontFace: 'Arial', color: C.gold })
  s1.addShape('rect', { x: 0, y: H - 0.06, w: W, h: 0.06, fill: { color: C.moss } })
  s1.addNotes(
`Open on the room's own history — respectfully, not as a gotcha. This team knows the Blue Mountains story better than anyone.

"You're in a live 90-day comment window right now on a plan revision that has already been attempted once, over fifteen years, and withdrawn. We want to show you how the comment period itself — the thing you're legally required to run — can become your earliest, clearest signal of where the objections are forming, while there's still time to answer them."

Datanautix delivers; the Sentimetrx platform is the tooling underneath.`,
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 2 — THE 15-YEAR LESSON
  // ═══════════════════════════════════════════════════════════════
  const s2 = pptx.addSlide()
  pg++
  addHeader(s2, 'Fifteen years, then back to zero', 'What the last revision cost — and why')
  addFooter(s2, pg)
  s2.addText('The first Blue Mountains revision ran ~15 years, reached a Final EIS, and was withdrawn before it could take effect.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.62, fontSize: 20, fontFace: 'Arial', color: C.dnOrange, bold: true,
  })
  cardRow(s2, 2.05, 2.5, [
    { t: '2004 → 2018', d: 'Revision of the Malheur, Umatilla & Wallowa-Whitman plans began in 2004. The Final EIS, three revised plans, and draft Records of Decision were published June 29, 2018; the objection deadline was Aug 28, 2018.', c: C.pineMid },
    { t: 'March 14, 2019 — withdrawn', d: 'The Deputy Chief directed the Regional Forester to withdraw the draft RODs, the Final EIS, and all three revised plans — the entire decision, undone.', c: C.dnOrange },
    { t: 'Why it fell', d: 'Plans judged "difficult to understand and potentially confusing to implement," as objections from Tribes, counties, grazing permittees, recreation users, and conservation groups converged.', c: C.amber },
  ])
  s2.addShape('rect', { x: 0.6, y: 4.85, w: 12.13, h: 1.55, fill: { color: C.cardTint }, rectRadius: 0.1 })
  s2.addShape('rect', { x: 0.6, y: 4.85, w: 0.12, h: 1.55, fill: { color: C.moss } })
  s2.addText('The decision-quality problem wasn’t the science — the review found no violation of law or policy. It was that fifteen years of accumulated concern was only fully legible at the objection deadline, when it was already too late to reconcile.', {
    x: 0.95, y: 5.05, w: 11.5, h: 1.15, fontSize: 15, fontFace: 'Arial', color: C.ink, italic: true, valign: 'middle', lineSpacing: 22,
  })
  s2.addNotes(
`Facts (all sourced): revision began 2004; Final EIS + three revised plans + draft RODs published 6/29/2018; objection deadline 8/28/2018; Deputy Chief Chris French directed Regional Forester Glenn Casamassa to withdraw the draft RODs, FEIS, and revised plans on 3/14/2019, citing plans "difficult to understand and potentially confusing to implement" — no identified violation of law/regulation/policy.
Sources: fs.usda.gov Umatilla project page; Blue Mountains Biodiversity Project (withdrawal notice); OPB (2023 restart coverage).

The point is NOT to relitigate 2019 — it's that the signal existed in the record all along; it just wasn't legible until the deadline. That's the gap we close.`,
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 3 — AND NOW, AGAIN — LIVE
  // ═══════════════════════════════════════════════════════════════
  const s3 = pptx.addSlide()
  pg++
  addHeader(s3, 'And now the window is open — again', 'The re-initiated revision, in comment right now')
  addFooter(s3, pg)
  s3.addText('The revision was re-initiated in 2023. A new Draft EIS is out, and the 90-day public comment period is open today.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.62, fontSize: 20, fontFace: 'Arial', color: C.pineMid, bold: true,
  })
  // Timeline band
  s3.addShape('rect', { x: 0.6, y: 2.2, w: 12.13, h: 1.5, fill: { color: C.card }, rectRadius: 0.1 })
  const tl = [
    { d: 'Jul 2, 2026', t: 'Comment period opens', c: C.moss },
    { d: 'Now', t: 'Comments arriving daily', c: C.dnTeal },
    { d: 'Sep 30, 2026', t: 'Comment deadline', c: C.dnOrange },
  ]
  tl.forEach((m, i) => {
    const x = 1.1 + i * 3.9
    s3.addShape('ellipse', { x: x - 0.06, y: 2.72, w: 0.24, h: 0.24, fill: { color: m.c } })
    s3.addText(m.d, { x: x + 0.28, y: 2.55, w: 3.4, h: 0.34, fontSize: 15, fontFace: 'Arial', color: C.pine, bold: true })
    s3.addText(m.t, { x: x + 0.28, y: 2.92, w: 3.4, h: 0.5, fontSize: 12, fontFace: 'Arial', color: C.ink })
    if (i < tl.length - 1) s3.addShape('rect', { x: x + 0.3, y: 2.83, w: 3.5, h: 0.02, fill: { color: C.slateLight } })
  })
  s3.addText('The opportunity: hear it as it arrives — not at the deadline', {
    x: 0.6, y: 4.0, w: 12.1, h: 0.5, fontSize: 17, fontFace: 'Arial', color: C.pine, bold: true,
  })
  cardRow(s3, 4.6, 1.9, [
    { t: 'Same three forests, same stakes', d: 'The communities, Tribes, and interests that converged in 2019 are the same ones commenting now.', c: C.pineMid },
    { t: 'A finite, high-value corpus', d: 'Every comment is a preserved concern — under the objection rules, an issue must be raised now to carry weight later.', c: C.moss },
    { t: 'Time to reconcile', d: 'Weeks of runway between "a concern is forming" and "the decision is written." That runway is where plans are saved.', c: C.dnTeal },
  ])
  s3.addNotes(
`The re-initiated revision: Federal Register notice 7/31/2023; new DEIS published; 90-day comment window 7/2/2026–9/30/2026 per the Umatilla project page.

This is the demo gift — we're not pitching a hypothetical. The window is open as we speak. Everything that follows is framed as "what you could be doing with the comments already in your inbox."`,
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 4 — HOW IT'S DONE TODAY
  // ═══════════════════════════════════════════════════════════════
  const s4 = pptx.addSlide()
  pg++
  addHeader(s4, 'How comment analysis is done today', 'Capable people, doing it by hand, at the deadline')
  addFooter(s4, pg)
  s4.addText('The current workflow is thorough — and almost entirely manual, serial, and back-loaded to the end of the window.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.6, fontSize: 18, fontFace: 'Arial', color: C.ink, lineSpacing: 24,
  })
  const steps = [
    { n: '1', t: 'Collect', d: 'Comments arrive via CARA, mail, email, and hearing transcripts into one undifferentiated pile.' },
    { n: '2', t: 'Read & code', d: 'Staff or a contractor read each comment and hand-code it to concern categories — slow and reader-dependent.' },
    { n: '3', t: 'Dedup form letters', d: 'Exact-match campaigns are set aside — but near-duplicates and personalized variants slip the net.' },
    { n: '4', t: 'Respond', d: 'Substantive comments get a written response compiled into the Final EIS appendix — the "hard look" record.' },
  ]
  steps.forEach((st, i) => {
    const x = 0.6 + i * 3.06
    s4.addShape('rect', { x, y: 2.15, w: 2.85, h: 3.0, fill: { color: C.card }, rectRadius: 0.1 })
    s4.addShape('ellipse', { x: x + 0.22, y: 2.4, w: 0.55, h: 0.55, fill: { color: C.pine } })
    s4.addText(st.n, { x: x + 0.22, y: 2.4, w: 0.55, h: 0.55, fontSize: 20, fontFace: 'Arial', color: C.white, bold: true, align: 'center', valign: 'middle' })
    s4.addText(st.t, { x: x + 0.22, y: 3.1, w: 2.4, h: 0.5, fontSize: 16, fontFace: 'Arial', color: C.pine, bold: true, valign: 'top' })
    s4.addText(st.d, { x: x + 0.22, y: 3.62, w: 2.45, h: 1.45, fontSize: 11.5, fontFace: 'Arial', color: C.ink, valign: 'top', lineSpacing: 16 })
  })
  s4.addShape('rect', { x: 0.6, y: 5.5, w: 12.13, h: 0.95, fill: { color: C.amberTint }, rectRadius: 0.1 })
  s4.addShape('rect', { x: 0.6, y: 5.5, w: 0.12, h: 0.95, fill: { color: C.amber } })
  s4.addText('The result is a compliant record produced under deadline pressure — with no view of what was building until the objections land. It answers "did we respond?" but never "what is the objection risk, and is it rising?"', {
    x: 0.95, y: 5.62, w: 11.5, h: 0.72, fontSize: 13.5, fontFace: 'Arial', color: C.ink, valign: 'middle', lineSpacing: 19,
  })
  s4.addNotes(
`Framing: respect the status quo — this is skilled work. The weakness is structural, not personal: it's serial, manual, and back-loaded, so intelligence about objection risk only exists after the window closes.
FS process anchor: the pre-decisional objection process (36 CFR 218/219) and the "hard look" responsiveness standard — the comment-response record is what a decision is defended on.`,
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 5 — WHERE IT BREAKS
  // ═══════════════════════════════════════════════════════════════
  const s5 = pptx.addSlide()
  pg++
  addHeader(s5, 'Where it breaks', 'Three blind spots that cost the last plan')
  addFooter(s5, pg)
  cardRow(s5, 1.35, 2.55, [
    { t: 'The flood buries the signal', d: 'An orchestrated form-letter campaign can dwarf the substantive comments. Volume gets mistaken for weight, and the few new concerns drown in the copies.', c: C.dnOrange },
    { t: 'The personal paragraph is lost', d: 'People paste an advocacy template and add their own story. That added paragraph is often the real, litigable substance — and exact-match dedup discards it with the template.', c: C.amber },
    { t: 'No early-warning signal', d: 'Nothing tells you which concerns are compounding until the objection deadline. You learn the plan is in trouble at the exact moment you can no longer fix it.', c: C.red },
  ])
  s5.addShape('rect', { x: 0.6, y: 4.25, w: 12.13, h: 2.15, fill: { color: C.pine }, rectRadius: 0.1 })
  s5.addText('The 2019 pattern, in one line', { x: 0.95, y: 4.5, w: 11.4, h: 0.5, fontSize: 16, fontFace: 'Arial', color: C.moss, bold: true })
  s5.addText('Concern accumulated for years inside the record, invisible in aggregate, until it surfaced all at once as objections the agency could no longer reconcile — and the decision was withdrawn. The failure wasn’t effort. It was the lack of a running, structured read on what the public was actually raising.', {
    x: 0.95, y: 5.05, w: 11.5, h: 1.2, fontSize: 14.5, fontFace: 'Arial', color: C.white, valign: 'top', lineSpacing: 22,
  })
  s5.addNotes(
`These three are the setup for the whole capability story: (1) semantic dedup + honest campaign accounting answers the flood; (2) template-delta extraction rescues the personal paragraph; (3) the concern-capture agent + running analysis is the early-warning signal. Each following slide pays one of these off.`,
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 6 — THE FRONT-FACING AGENT
  // ═══════════════════════════════════════════════════════════════
  const s6 = pptx.addSlide()
  pg++
  addHeader(s6, 'A front-facing agent on the project page', 'It informs the public — and captures every concern')
  addFooter(s6, pg)
  s6.addText('One conversational agent, two jobs — running for the whole comment window.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.55, fontSize: 19, fontFace: 'Arial', color: C.pineMid, bold: true,
  })
  // Two big role panels
  const panels = [
    { t: 'Job 1 — Information agent', c: C.dnTeal, body: [
      'Answers questions about the plan in plain language, grounded in the DEIS, the "need to change," and the proposed action — a knowledgebase, not a chatbot guessing.',
      'Meets people where they are: fewer "what does this even mean?" comments, better-informed substantive ones.',
      'Cites the source section so the public — and the record — can trace every answer.',
    ] },
    { t: 'Job 2 — Concern capture', c: C.dnOrange, body: [
      'Turns a free-text box into guided intake: every question and concern captured as structured, classifiable data.',
      'Tags each concern to a plan topic — grazing, access, wildlife, timber, Tribal treaty rights, recreation.',
      'Nothing is lost to formatting or a PDF: the concern is data the moment it is spoken.',
    ] },
  ]
  panels.forEach((p, i) => {
    const x = 0.6 + i * 6.16
    s6.addShape('rect', { x, y: 2.0, w: 5.97, h: 4.4, fill: { color: C.card }, rectRadius: 0.1 })
    s6.addShape('rect', { x, y: 2.0, w: 5.97, h: 0.55, fill: { color: p.c }, rectRadius: 0.1 })
    s6.addText(p.t, { x: x + 0.28, y: 2.02, w: 5.5, h: 0.55, fontSize: 17, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle' })
    p.body.forEach((b, j) => {
      s6.addShape('ellipse', { x: x + 0.34, y: 2.95 + j * 1.12, w: 0.14, h: 0.14, fill: { color: p.c } })
      s6.addText(b, { x: x + 0.62, y: 2.78 + j * 1.12, w: 5.15, h: 1.0, fontSize: 12.5, fontFace: 'Arial', color: C.ink, valign: 'top', lineSpacing: 17 })
    })
  })
  s6.addNotes(
`This is where we demo the live prototype — a Blue Mountains agent seeded with the real plan knowledgebase. Let them ask it a real question ("how does this change grazing allotments?") and watch it answer with a citation, then show that the question was captured.
The dual role is the whole idea: the public gets a better experience, and the agency gets structured intelligence as a byproduct of service — not extra work.`,
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 7 — THE AGENT IN ACTION (real, unscripted transcript)
  // ═══════════════════════════════════════════════════════════════
  const sC = pptx.addSlide()
  pg++
  addHeader(sC, 'The agent in action', 'A real, unscripted exchange from the live demo agent')
  addFooter(sC, pg)
  const bubbles = [
    { who: 'user', t: 'How does the proposed action affect grazing?', h: 0.5 },
    { who: 'agent', t: 'Officials considered but rejected a proposal that would have greatly reduced grazing, so existing allotments largely continue. Concerns from ranchers and conservation advocates — especially around streams and riparian areas — are very much in play.', h: 1.15 },
    { who: 'user', t: "I run cattle on a Wallowa-Whitman allotment and I'm worried the new plan cuts my access. What can I do?", h: 0.82 },
    { who: 'agent', t: 'Your concern is worth putting on the record — the comment period closes September 30, 2026. The most effective comments are specific: name your allotment, describe the access impact, and tie it to plan language. What worries you most — road closures, grazing terms, or something else?', h: 1.5 },
  ]
  let by = 1.32
  bubbles.forEach(b => {
    const isUser = b.who === 'user'
    const w = isUser ? 4.7 : 5.6
    const x = isUser ? (8.2 - w) : 0.6
    sC.addText(isUser ? 'Commenter' : '🌲 Plan Assistant', { x, y: by - 0.2, w, h: 0.18, fontSize: 8.5, fontFace: 'Arial', color: C.slate, align: isUser ? 'right' : 'left', bold: true })
    sC.addShape('rect', { x, y: by, w, h: b.h, fill: { color: isUser ? C.pineMid : C.card }, rectRadius: 0.09, line: isUser ? { color: C.pineMid, width: 0.5 } : { color: C.slateLight, width: 1 } })
    sC.addText(b.t, { x: x + 0.2, y: by + 0.08, w: w - 0.4, h: b.h - 0.16, fontSize: 11.5, fontFace: 'Arial', color: isUser ? C.white : C.ink, valign: 'middle', lineSpacing: 16 })
    by += b.h + 0.42
  })
  // Right rail — "what just happened"
  sC.addShape('rect', { x: 8.55, y: 1.32, w: 4.18, h: 5.28, fill: { color: C.pine }, rectRadius: 0.1 })
  sC.addText('What just happened', { x: 8.82, y: 1.52, w: 3.7, h: 0.4, fontSize: 15, fontFace: 'Arial', color: C.moss, bold: true })
  const rail = [
    'Answered from the plan knowledgebase — neutral and sourced, never taking a side.',
    'Heard the specific concern: grazing access on a named Wallowa-Whitman allotment.',
    'Surfaced the Sept 30 deadline and what makes a comment substantive.',
    'Tagged grazing · access · concern-captured — and fed the "what people are asking" view.',
  ]
  rail.forEach((r, i) => {
    sC.addShape('ellipse', { x: 8.82, y: 2.2 + i * 1.05, w: 0.13, h: 0.13, fill: { color: C.moss } })
    sC.addText(r, { x: 9.08, y: 2.04 + i * 1.05, w: 3.5, h: 0.95, fontSize: 11, fontFace: 'Arial', color: C.white, valign: 'top', lineSpacing: 15 })
  })
  sC.addNotes(
`This is a REAL, unscripted exchange captured from the live prod agent (sentimetrx.ai/b/blue-mountains) — not a mockup (per the no-fabricated-data rule). It shows the dual role on one screen: a neutral, sourced info answer + concern capture + routing to a substantive comment, with the tags that feed the insight view. Offer to open the live agent and let them ask their own question — and to share a full saved conversation.`,
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 8 — "WE KNOW WHAT PEOPLE ARE ASKING"
  // ═══════════════════════════════════════════════════════════════
  const s7 = pptx.addSlide()
  pg++
  addHeader(s7, 'The questions are the intelligence', 'A source the paper comment box never gave you')
  addFooter(s7, pg)
  s7.addText('What the public asks — in aggregate, in real time — is a live map of where concern is forming.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.6, fontSize: 19, fontFace: 'Arial', color: C.dnOrange, bold: true,
  })
  s7.addText('Every question the agent answers is also a data point. Rolled up, the question stream shows which topics are drawing heat, how fast, and from whom — weeks before those concerns harden into filed objections.', {
    x: 0.6, y: 1.95, w: 12.1, h: 0.85, fontSize: 14, fontFace: 'Arial', color: C.ink, lineSpacing: 21,
  })
  cardRow(s7, 3.0, 2.05, [
    { t: 'Ranked by rising concern', d: 'Topics ordered by volume and velocity — not just how many, but which are accelerating this week.', c: C.dnOrange },
    { t: 'Segmented by who’s asking', d: 'Permittees, Tribes, recreation users, adjacent landowners — the same interests that converged in 2019.', c: C.dnTeal },
    { t: 'Linked to the plan', d: 'Each cluster maps to the DEIS section it questions, so staff jump straight to the relevant analysis.', c: C.moss },
  ])
  s7.addShape('rect', { x: 0.6, y: 5.35, w: 12.13, h: 1.05, fill: { color: C.cardTint }, rectRadius: 0.1 })
  s7.addShape('rect', { x: 0.6, y: 5.35, w: 0.12, h: 1.05, fill: { color: C.moss } })
  s7.addText('This is the early-warning system the last revision never had: a running answer to "what is the public actually worried about, and is it getting worse?" — while the window is still open to respond.', {
    x: 0.95, y: 5.5, w: 11.5, h: 0.78, fontSize: 14, fontFace: 'Arial', color: C.ink, italic: true, valign: 'middle', lineSpacing: 20,
  })
  s7.addNotes(
`The reframe the client asked for: "we know what people are asking about" becomes a NEW insight source. Emphasize velocity (accelerating topics) and segmentation (who) — that's what turns a word cloud into an objection-risk instrument.
No invented numbers here — the dashboard shape is described qualitatively; in the demo it's populated by the prototype agent's real captured questions.`,
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 8 — DEDUP + TEMPLATE-DELTA
  // ═══════════════════════════════════════════════════════════════
  const s8 = pptx.addSlide()
  pg++
  addHeader(s8, 'Cutting through the form-letter flood', 'Semantic dedup + template-delta extraction')
  addFooter(s8, pg)
  s8.addText('Exact-match dedup is table stakes. The value is finding the new substance hidden inside the copies.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.58, fontSize: 18, fontFace: 'Arial', color: C.pineMid, bold: true,
  })
  const funnel = [
    { t: 'Semantic clustering', d: 'Groups campaign variants and near-duplicates — not just character-identical copies — into one campaign, with an honest count of how many voices it represents.', c: C.dnTeal },
    { t: 'Template-delta extraction', d: 'Isolates the shared template, then pulls out each commenter’s unique addition — the personal paragraph appended to an advocacy form letter, where the real substance usually lives.', c: C.dnOrange },
    { t: 'The substantive minority, surfaced', d: 'A campaign of tens of thousands collapses to the handful of genuinely new concerns — every one preserved, none discarded with the boilerplate.', c: C.moss },
  ]
  funnel.forEach((f, i) => {
    const y = 2.0 + i * 1.5
    s8.addShape('rect', { x: 0.6, y, w: 12.13, h: 1.35, fill: { color: C.card }, rectRadius: 0.1 })
    s8.addShape('rect', { x: 0.6, y, w: 0.12, h: 1.35, fill: { color: f.c } })
    s8.addText(`${i + 1}`, { x: 0.85, y, w: 0.7, h: 1.35, fontSize: 30, fontFace: 'Arial', color: f.c, bold: true, align: 'center', valign: 'middle' })
    s8.addText(f.t, { x: 1.7, y: y + 0.18, w: 10.8, h: 0.42, fontSize: 16, fontFace: 'Arial', color: C.pine, bold: true })
    s8.addText(f.d, { x: 1.7, y: y + 0.6, w: 10.8, h: 0.68, fontSize: 12.5, fontFace: 'Arial', color: C.ink, valign: 'top', lineSpacing: 17 })
  })
  s8.addNotes(
`Template-delta is the differentiator — say it plainly. Contractors already do exact-match dedup; almost nobody rescues the personalized delta, and that delta is where litigable, substantive content hides.
"Honest count of how many voices" matters to a gov audience: it lets the agency weigh a campaign truthfully (N unique concerns vs. one orchestrated message x thousands) without dismissing or over-counting it.`,
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 9 — SUBSTANTIVE vs COPY-PASTE
  // ═══════════════════════════════════════════════════════════════
  const s9 = pptx.addSlide()
  pg++
  addHeader(s9, 'Substantive vs. copy-paste', 'Focus the response where the law requires it')
  addFooter(s9, pg)
  s9.addText('The agency must respond to substantive comments. The first job is telling them apart — at scale, consistently.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.6, fontSize: 18, fontFace: 'Arial', color: C.ink, lineSpacing: 24,
  })
  // Two-column compare
  const cols = [
    { t: 'Copy-paste / campaign', c: C.slate, items: ['Character- or near-identical to a template', 'Position stated, no new fact or analysis', 'Answered once, applied across the cluster', 'Counted honestly as one message × N senders'] },
    { t: 'Substantive', c: C.mossDeep, items: ['Raises a specific new fact, method, or impact', 'Ties to a plan component or DEIS section', 'Requires an individual, reasoned response', 'Every one is a preserved objection issue'] },
  ]
  cols.forEach((col, i) => {
    const x = 0.6 + i * 6.16
    s9.addShape('rect', { x, y: 2.05, w: 5.97, h: 3.5, fill: { color: i === 0 ? C.slateLight : C.cardTint }, rectRadius: 0.1 })
    s9.addShape('rect', { x, y: 2.05, w: 5.97, h: 0.55, fill: { color: col.c }, rectRadius: 0.1 })
    s9.addText(col.t, { x: x + 0.28, y: 2.07, w: 5.5, h: 0.55, fontSize: 16, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle' })
    col.items.forEach((it, j) => {
      s9.addText(it, { x: x + 0.5, y: 2.85 + j * 0.63, w: 5.3, h: 0.55, fontSize: 12.5, fontFace: 'Arial', color: C.ink, valign: 'top', bullet: { characterCode: '2022' } })
    })
  })
  s9.addShape('rect', { x: 0.6, y: 5.75, w: 12.13, h: 0.7, fill: { color: C.amberTint }, rectRadius: 0.08 })
  s9.addText('The measurable output: what share of the record is orchestrated volume vs. distinct substantive concern — the honest denominator a defensible decision rests on.', {
    x: 0.95, y: 5.82, w: 11.5, h: 0.55, fontSize: 13, fontFace: 'Arial', color: C.amber, valign: 'middle', italic: true },
  )
  s9.addNotes(
`This directly maps to 40 CFR 1503.4 / FS responsiveness: agencies must respond to substantive comments; non-substantive expressions of preference can be acknowledged in aggregate. Our classifier operationalizes exactly that legal line, consistently and at scale — which is itself a defensibility argument (consistent, documented treatment).`,
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 10 — INTELLIGENT RESPONSE GENERATION
  // ═══════════════════════════════════════════════════════════════
  const s10 = pptx.addSlide()
  pg++
  addHeader(s10, 'Intelligent response generation', 'Draft fast — with a human on every word')
  addFooter(s10, pg)
  cardRow(s10, 1.35, 2.4, [
    { t: 'One canonical response per cluster', d: 'Draft a single reasoned response to a campaign or concern cluster, review it once, and apply it consistently across every comment in the cluster.', c: C.dnTeal },
    { t: 'Grounded substantive drafts', d: 'For each substantive comment, a draft response grounded in the plan record and the relevant DEIS analysis — a first draft for staff, not a final word.', c: C.dnOrange },
    { t: 'Every comment → a response', d: 'A complete, auditable mapping from each comment to its response. Nothing substantive falls through the cracks — the essence of the "hard look."', c: C.moss },
  ])
  s10.addShape('rect', { x: 0.6, y: 4.15, w: 12.13, h: 2.25, fill: { color: C.pine }, rectRadius: 0.1 })
  s10.addText('Human-in-the-loop, by design', { x: 0.95, y: 4.4, w: 11.4, h: 0.5, fontSize: 16, fontFace: 'Arial', color: C.moss, bold: true })
  s10.addText('The comment-response record is part of the administrative record and must reflect the agency’s own reasoning. Every draft is generated for a Forest Service reviewer to edit, approve, or reject — the platform accelerates the drafting and guarantees the coverage; the agency owns the judgment and the words. Speed with the record intact.', {
    x: 0.95, y: 4.95, w: 11.5, h: 1.3, fontSize: 14.5, fontFace: 'Arial', color: C.white, valign: 'top', lineSpacing: 22,
  })
  s10.addNotes(
`Non-negotiable framing for a gov audience: AI drafts, humans decide. Never imply auto-published responses — the administrative record must be the agency's reasoning. Lead the value with COVERAGE + CONSISTENCY + SPEED, and put the human-in-the-loop guarantee on the same slide so nobody in the room worries we're proposing to automate their legal record.`,
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 11 — OBJECTION-RISK / DEFENSIBILITY LAYER
  // ═══════════════════════════════════════════════════════════════
  const s11 = pptx.addSlide()
  pg++
  addHeader(s11, 'The objection-risk layer', 'Close the gaps before the decision is signed')
  addFooter(s11, pg)
  s11.addText('Tie concerns to responses, and expose the gap: which raised issues does the current record not yet adequately answer?', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.6, fontSize: 18, fontFace: 'Arial', color: C.pineMid, bold: true, lineSpacing: 24,
  })
  const flow = [
    { t: 'Concerns', d: 'Every substantive issue raised, ranked by weight and rising velocity', c: C.dnTeal },
    { t: 'Responses', d: 'The record’s current answer to each — or the absence of one', c: C.moss },
    { t: 'Gaps', d: 'Issues with thin or missing responses = the objection-risk shortlist', c: C.dnOrange },
    { t: 'Action', d: 'Strengthen the analysis or the response before the window closes', c: C.pineMid },
  ]
  flow.forEach((f, i) => {
    const x = 0.6 + i * 3.06
    s11.addShape('rect', { x, y: 2.15, w: 2.75, h: 2.5, fill: { color: C.card }, rectRadius: 0.1 })
    s11.addShape('rect', { x, y: 2.15, w: 2.75, h: 0.12, fill: { color: f.c } })
    s11.addText(f.t, { x: x + 0.2, y: 2.4, w: 2.4, h: 0.5, fontSize: 16, fontFace: 'Arial', color: C.pine, bold: true })
    s11.addText(f.d, { x: x + 0.2, y: 2.95, w: 2.4, h: 1.55, fontSize: 12, fontFace: 'Arial', color: C.ink, valign: 'top', lineSpacing: 17 })
    if (i < flow.length - 1) s11.addText('→', { x: x + 2.72, y: 2.15, w: 0.4, h: 2.5, fontSize: 22, fontFace: 'Arial', color: C.slate, align: 'center', valign: 'middle' })
  })
  s11.addShape('rect', { x: 0.6, y: 5.0, w: 12.13, h: 1.4, fill: { color: C.cardTint }, rectRadius: 0.1 })
  s11.addShape('rect', { x: 0.6, y: 5.0, w: 0.12, h: 1.4, fill: { color: C.mossDeep } })
  s11.addText('Under the pre-decisional objection process, an issue must be raised in comment to carry into objection or litigation. So the comment corpus is a preview of the objection surface — and this layer tells you, before you sign, exactly where that surface is thin.', {
    x: 0.95, y: 5.15, w: 11.5, h: 1.12, fontSize: 14, fontFace: 'Arial', color: C.ink, valign: 'middle', lineSpacing: 21,
  })
  s11.addNotes(
`This is the litigation-insight payoff, framed defensibly — NOT "we predict lawsuits." We surface where the responsiveness record is thin on issues that are being preserved for objection, so the agency can shore it up while it still can.
Legal anchors: issue exhaustion (must raise it to litigate it) + "hard look." Keep it about strengthening the record, not gaming outcomes.`,
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 13 — OLD WORLD vs NEW WORLD: WHEN YOU GET THE SIGNAL
  // ═══════════════════════════════════════════════════════════════
  const sT = pptx.addSlide()
  pg++
  addHeader(sT, 'When you learn what the public is worried about', 'The whole value in one picture: time')
  addFooter(sT, pg)

  const wx0 = 2.4, wx1 = 8.55   // the comment window (Jul 2 → Sep 30)
  const dx0 = 9.0               // downstream outcomes start here

  // ── Band 1: TODAY ──────────────────────────────────────────────
  const y1 = 1.9
  sT.addText('TODAY', { x: 0.55, y: y1 + 0.15, w: 1.75, h: 0.35, fontSize: 15, fontFace: 'Arial', color: C.slate, bold: true })
  sT.addText('manual · at the deadline', { x: 0.55, y: y1 + 0.52, w: 1.8, h: 0.5, fontSize: 10, fontFace: 'Arial', color: C.slate, lineSpacing: 13 })
  sT.addShape('rect', { x: wx0, y: y1 + 0.42, w: wx1 - wx0, h: 0.18, fill: { color: C.slateLight } })
  sT.addShape('rect', { x: wx1 - 0.5, y: y1 + 0.28, w: 0.5, h: 0.46, fill: { color: C.red } }) // insight = a spike only at the deadline
  sT.addText('Jul 2', { x: wx0 - 0.2, y: y1 + 0.66, w: 1.0, h: 0.24, fontSize: 8.5, color: C.slate, fontFace: 'Arial' })
  sT.addText('Sep 30', { x: wx1 - 0.85, y: y1 + 0.66, w: 1.0, h: 0.24, fontSize: 8.5, color: C.slate, fontFace: 'Arial', align: 'right' })
  sT.addText('No running signal — the first real read on public concern arrives as filed objections, at the deadline. Too late to reconcile.', { x: wx0, y: y1 + 0.98, w: wx1 - wx0 + 0.1, h: 0.55, fontSize: 10.5, color: C.ink, fontFace: 'Arial', italic: true, lineSpacing: 14 })
  const badOut = ['Objections', 'Litigation', 'Delay / re-do']
  badOut.forEach((o, i) => {
    const cx = dx0 + i * 1.3
    sT.addShape('rect', { x: cx, y: y1 + 0.32, w: 1.12, h: 0.5, fill: { color: C.redTint }, rectRadius: 0.06 })
    sT.addText(o, { x: cx, y: y1 + 0.32, w: 1.12, h: 0.5, fontSize: 9, color: C.red, fontFace: 'Arial', bold: true, align: 'center', valign: 'middle' })
    if (i < badOut.length - 1) sT.addText('→', { x: cx + 1.1, y: y1 + 0.32, w: 0.22, h: 0.5, fontSize: 12, color: C.slate, align: 'center', valign: 'middle' })
  })

  sT.addShape('rect', { x: 0.55, y: 3.85, w: 12.2, h: 0.014, fill: { color: C.slateLight } })

  // ── Band 2: WITH THE AGENT ─────────────────────────────────────
  const y2 = 4.2
  sT.addText('WITH THE AGENT', { x: 0.55, y: y2 + 0.08, w: 1.8, h: 0.5, fontSize: 15, fontFace: 'Arial', color: C.mossDeep, bold: true, lineSpacing: 16 })
  sT.addText('real-time · from day one', { x: 0.55, y: y2 + 0.6, w: 1.8, h: 0.5, fontSize: 10, fontFace: 'Arial', color: C.mossDeep, lineSpacing: 13 })
  sT.addShape('rect', { x: wx0, y: y2 + 0.42, w: wx1 - wx0, h: 0.18, fill: { color: C.moss } }) // running signal across the whole window
  for (let i = 0; i < 7; i++) {
    const dxi = wx0 + 0.35 + i * ((wx1 - wx0 - 0.7) / 6)
    sT.addShape('ellipse', { x: dxi, y: y2 + 0.33, w: 0.15, h: 0.15, fill: { color: C.pine } })
  }
  sT.addText('Jul 2', { x: wx0 - 0.2, y: y2 + 0.66, w: 1.0, h: 0.24, fontSize: 8.5, color: C.slate, fontFace: 'Arial' })
  sT.addText('Sep 30', { x: wx1 - 0.85, y: y2 + 0.66, w: 1.0, h: 0.24, fontSize: 8.5, color: C.slate, fontFace: 'Arial', align: 'right' })
  sT.addText('◄——  weeks of runway to act  ——►', { x: wx0, y: y2 + 0.92, w: wx1 - wx0, h: 0.28, fontSize: 10, color: C.mossDeep, fontFace: 'Arial', bold: true, align: 'center' })
  sT.addText('Concern is visible from the first week — ranked and rising — with runway to strengthen the record before the deadline.', { x: wx0, y: y2 + 1.22, w: wx1 - wx0 + 0.1, h: 0.5, fontSize: 10.5, color: C.ink, fontFace: 'Arial', italic: true, lineSpacing: 14 })
  const goodOut = ['Concerns addressed', 'Decision holds']
  goodOut.forEach((o, i) => {
    const cx = dx0 + i * 1.95
    sT.addShape('rect', { x: cx, y: y2 + 0.32, w: 1.78, h: 0.5, fill: { color: C.cardTint }, rectRadius: 0.06 })
    sT.addText(o, { x: cx, y: y2 + 0.32, w: 1.78, h: 0.5, fontSize: 9, color: C.mossDeep, fontFace: 'Arial', bold: true, align: 'center', valign: 'middle' })
    if (i < goodOut.length - 1) sT.addText('→', { x: cx + 1.76, y: y2 + 0.32, w: 0.22, h: 0.5, fontSize: 12, color: C.slate, align: 'center', valign: 'middle' })
  })

  // Value-prop banner
  sT.addShape('rect', { x: 0.55, y: 6.28, w: 12.2, h: 0.72, fill: { color: C.pine }, rectRadius: 0.08 })
  sT.addText('The value is time: we surface concern months before the deadline — the window to pre-empt objections, litigation, and delay.', { x: 0.85, y: 6.28, w: 11.6, h: 0.72, fontSize: 13.5, color: C.white, fontFace: 'Arial', bold: true, valign: 'middle' })
  sT.addNotes(
`The one-picture differentiator. Today, the first real read on public concern IS the objection — at the deadline — which is exactly how the last plan died. With the agent, concern is legible from week one, so there's runway to reconcile it into the record before the decision is signed. The value prop is TIME to pre-empt downstream litigation and delay.`,
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 14 — WHAT WE'D STAND UP + THE ASK
  // ═══════════════════════════════════════════════════════════════
  const s12 = pptx.addSlide()
  pg++
  s12.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.pine } })
  s12.addShape('rect', { x: 0, y: 0, w: 0.18, h: H, fill: { color: C.moss } })
  s12.addText('What we’d stand up for Blue Mountains', { x: 0.8, y: 0.75, w: 11.6, h: 0.8, fontSize: 30, fontFace: 'Arial', color: C.white, bold: true })
  s12.addText('A pilot on the comment period that is open right now.', { x: 0.8, y: 1.55, w: 11.6, h: 0.5, fontSize: 17, fontFace: 'Arial', color: C.moss })
  const offer = [
    { t: 'The public agent', d: 'A plain-language information + concern-capture agent on the project page, grounded in the plan knowledgebase.', c: C.dnTeal },
    { t: 'The analysis pipeline', d: 'Semantic dedup, template-delta extraction, substantive classification, and canonical + drafted responses — human-in-the-loop.', c: C.dnOrange },
    { t: 'The objection-risk dashboard', d: 'A running read on rising concerns and the gaps in the response record, refreshed as comments arrive.', c: C.moss },
  ]
  offer.forEach((o, i) => {
    const x = 0.8 + i * 3.94
    s12.addShape('rect', { x, y: 2.4, w: 3.7, h: 2.75, fill: { color: 'FFFFFF' }, rectRadius: 0.1 })
    s12.addShape('rect', { x, y: 2.4, w: 3.7, h: 0.12, fill: { color: o.c } })
    s12.addText(o.t, { x: x + 0.22, y: 2.65, w: 3.3, h: 0.75, fontSize: 15.5, fontFace: 'Arial', color: C.pine, bold: true, valign: 'top' })
    s12.addText(o.d, { x: x + 0.22, y: 3.45, w: 3.3, h: 1.55, fontSize: 12, fontFace: 'Arial', color: C.ink, valign: 'top', lineSpacing: 17 })
  })
  s12.addText('The last revision took fifteen years and was withdrawn at the objection deadline. This time, hear it while there’s still time to answer.', {
    x: 0.8, y: 5.5, w: 11.6, h: 0.75, fontSize: 16, fontFace: 'Arial', color: C.white, italic: true, lineSpacing: 23,
  })
  addWordmark(s12, 0.8, 6.5, 20, true)
  s12.addText('powered by the Sentimetrx platform  ·  datanautix.com', { x: 0.8, y: 6.98, w: 9, h: 0.4, fontSize: 11.5, fontFace: 'Arial', color: C.gold })
  s12.addShape('rect', { x: 0, y: H - 0.06, w: W, h: 0.06, fill: { color: C.moss } })
  s12.addNotes(
`Close on the pilot, scoped to the LIVE window — low-risk, high-signal, and it produces something useful to the current revision immediately.
Datanautix delivers the engagement; Sentimetrx is the platform. Leave-behind: this deck + a link to the live prototype agent seeded on the Blue Mountains knowledgebase.`,
  )
}
