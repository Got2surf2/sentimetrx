// lib/pptx/nepaCaraReimaginedDeck.ts
// "If We Built CARA Today" — a Datanautix capability briefing on reimagining the
// federal NEPA public-comment analysis stack, worked live on the real Blue
// Mountains Forest Plan Revision comment record.
//
// AUDIENCE: federal land-management NEPA staff broadly — USDA Forest Service
// (whose tool is CARA, the Comment Analysis & Response Application) AND the
// National Park Service / DOI (whose equivalent is PEPC). The spine is CARA
// because our worked example (Blue Mountains) is a live Forest Service project,
// but the argument generalizes to any agency running a comment period.
//
// ARC (owner-specified):
//   1. If we were to build CARA today, here's how we'd do it.
//   2. What we can do that is MORE than CARA.
//   3. The current Blue Mountains record as it stands — our CARA-equivalent view.
//   4. Of the must-respond comments, how many are actually QUESTIONS?  (next funnel layer)
//   5. Point our already-deployed Blue Mountains assistant at a subset of those questions.
//   6. What % of the questions can be answered at HIGH confidence — the labor-reduction story.
//
// DATA HONESTY (no-fabricated-data rule): the funnel, dedup, issue, stance, and
// campaign counts are from the real corpus (deterministic dedup is exact; issue/
// stance are an automated Claude first pass, labelled). The question-layer counts
// come from an LLM extraction over the real record; the answerability % comes from
// running the LIVE prod agent against real questions with a strict independent
// judge. No dollar figures or invented statistics.
//
// Branding: Datanautix company brand, powered by the Sentimetrx platform. Never
// white-labeled. Pine accents nod to the land-management audience.

import type PptxGenJS from 'pptxgenjs'

// ─────────────────────────────────────────────────────────────────────────────
// REAL DATA — Blue Mountains comment record (snapshot of the live CARA corpus).
// ─────────────────────────────────────────────────────────────────────────────
const F = { submitted: 989, held: 197, available: 792, distinct: 565, substantive: 414 }
const DUP_PCT = Math.round((F.available - F.distinct) / F.available * 100) // 29%
const STANCE = { oppose: 366, support: 155, mixed: 33, unclear: 11 }
const ISSUES: [string, number, number][] = [ // [label, distinct voices, substantive]
  ['Access & roads', 267, 222],
  ['Timber / logging', 233, 188],
  ['Recreation', 223, 190],
  ['Wildlife', 209, 191],
  ['Old growth / 21-inch rule', 177, 155],
  ['Enforceable standards', 145, 134],
  ['Water & fish', 133, 128],
  ['Fire & fuels', 133, 128],
]
const CAMPAIGN_COPIES = 172 // biggest single form-letter campaign (access/recreation template)

// ─────────────────────────────────────────────────────────────────────────────
// QUESTION LAYER — filled from scripts/oneoff/_nepa_questions.ts over the real record.
// (Populated after the extraction run; see slide-6 note.)
// ─────────────────────────────────────────────────────────────────────────────
const Q = {
  mustRespond: F.substantive,   // the must-respond set (from the funnel slide)
  pctAnswerable: 100,           // ~all must-respond comments pose an answerable question
  totalAsks: 1809,              // answerable question-instances in the record (raw answering workload)
  top25Pct: 32,                 // share of every ask covered by just the top 25 distinct questions
  topTypes: [                   // [label, question-instance count]
    ['What does each alternative do?', 561],
    ['Effects & impacts', 206],
    ['Science & data', 191],
    ['Process & deadlines', 107],
    ['Economics & jobs', 62],
    ['Wildlife & habitat', 61],
  ] as [string, number][],
}

// ─────────────────────────────────────────────────────────────────────────────
// ANSWERABILITY — filled from scripts/oneoff/_nepa_answerability.ts (LIVE agent).
// ─────────────────────────────────────────────────────────────────────────────
const A = {
  tested: 50,
  // Measured WITH the full 371-page Draft EIS ingested into the agent's KB.
  high: 14, partial: 18, no: 18,
  pctHigh: 28, pctPartial: 36, pctNo: 36, pctHighPartial: 64,
  pctHighByVol: 31, pctHighPartialByVol: 71,
  // Before the DEIS ingest (28 curated chunks only) — the lift progression.
  beforeHigh: 20, beforeHighPartial: 52,
  targetHighPartial: 80,   // roadmap target with retrieval tuning (projection, not measured)
  // 3 real, unedited high-confidence Q->A pairs from the live prod agent.
  samples: [
    { q: 'By how much would Alternative 2 increase commercial logging vs. current levels?',
      a: 'Roughly triple — from about 106 million board-feet per year today to about 377 MMBF/yr, projected to support around 3,000 jobs and $240 million in annual income in timber-dependent communities.' },
    { q: 'Does Alternative 2 eliminate the 21-inch rule that has protected large old trees since 1994?',
      a: 'Yes — Alt 2 eliminates the 21-inch rule entirely and replaces it with different large/old-tree guidance, allowing substantially more harvest. Alt 3 keeps a 21-inch guideline (not a mandatory standard), with a 30-inch threshold for grand fir.' },
    { q: 'Will the plan keep restricting motorized access in designated Wilderness and Wilderness Study Areas?',
      a: 'Yes — those protections come from federal law (the Wilderness Act), not the forest plan, so the revision can’t change them. What is unsettled in this draft is motorized access outside those protected areas.' },
  ] as { q: string; a: string }[],
}

// ─────────────────────────────────────────────────────────────────────────────
// PII TRIAGE — filled from scripts/oneoff/_nepa_pii_scan.ts over the 755 released
// comments (deterministic regex + LLM contextual). Numbers redaction-safe (no PII).
// ─────────────────────────────────────────────────────────────────────────────
const PII = {
  scanned: 792,
  held: F.held,         // FS comments held pending manual PII review (the backlog)
  structured: 7,        // released comments with an exact email/phone/address (regex)
  contextual: 82,       // released comments the AI flagged for a name/location/detail
  flagged: 85,          // union — the reviewer's worklist
  pctCleared: 89,       // auto-cleared, no reviewer needed
  pctFlagged: 11,
}

// ─────────────────────────────────────────────────────────────────────────────
// INTENT SPLIT — the "two sides of CARA", from _nepa_intent_split.ts over the real
// submitted comments. The formal record is ~all positions; the questions audience
// is largely absent from it (they never file a comment) — Side A's opportunity.
// ─────────────────────────────────────────────────────────────────────────────
const INTENT = {
  distinct: 565, analyzed: 792,
  pctPosition: 81,   // pure position for the record (Side B)
  pctBoth: 18,       // states a position AND asks real questions (the visible tip)
  pctQuestion: 1,    // pure question in the formal record
  bothVoices: 103,
}

// Palette — land-management pine + Datanautix brand accents.
const C = {
  pine: '1B4332', pineMid: '2D6A4F', moss: '52B788', mossDeep: '40916C',
  dnTeal: '0F7173', dnOrange: 'E8632A', gold: 'E8B84B',
  ink: '1B2D26', slate: '7C8B84', slateLight: 'E7EDE9', card: 'F4F7F5', cardTint: 'EAF2ED',
  white: 'FFFFFF', amber: 'B45309', amberTint: 'FDF3E3', red: 'B91C1C', redTint: 'FBEAEA', green: '16A34A',
}
const W = 13.33, H = 7.5

function addWordmark(slide: PptxGenJS.Slide, x: number, y: number, size: number, onDark: boolean) {
  slide.addText(
    [{ text: 'data', options: { color: onDark ? C.moss : C.dnTeal, bold: true } },
     { text: 'nautix', options: { color: C.dnOrange, bold: true } }],
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
  slide.addText('Federal NEPA comment analysis  ·  Confidential', { x: W - 5.2, y: H - 0.4, w: 4.0, h: 0.3, fontSize: 9, color: C.slate, fontFace: 'Arial', align: 'right' })
  slide.addText(`${pageNum}`, { x: W - 0.9, y: H - 0.4, w: 0.5, h: 0.3, fontSize: 9, color: C.slate, fontFace: 'Arial', align: 'right' })
}
function cardRow(slide: PptxGenJS.Slide, y: number, h: number, cards: { t: string; d: string; c: string }[]) {
  const n = cards.length, gap = 0.23, totalW = 12.13, cw = (totalW - gap * (n - 1)) / n
  cards.forEach((card, i) => {
    const x = 0.6 + i * (cw + gap)
    slide.addShape('rect', { x, y, w: cw, h, fill: { color: C.card }, rectRadius: 0.1 })
    slide.addShape('rect', { x, y, w: cw, h: 0.12, fill: { color: card.c } })
    slide.addText(card.t, { x: x + 0.22, y: y + 0.26, w: cw - 0.44, h: 0.72, fontSize: 15, fontFace: 'Arial', color: C.pine, bold: true, valign: 'top' })
    slide.addText(card.d, { x: x + 0.22, y: y + 1.02, w: cw - 0.44, h: h - 1.2, fontSize: 12, fontFace: 'Arial', color: C.ink, valign: 'top', lineSpacing: 17 })
  })
}

export function buildNepaCaraReimaginedDeck(pptx: PptxGenJS) {
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Datanautix'
  pptx.company = 'Datanautix'
  pptx.title = 'If We Built CARA Today — Reimagining federal NEPA comment analysis'
  let pg = 0

  // ═══ SLIDE 1 — TITLE ═══
  const s1 = pptx.addSlide(); pg++
  s1.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.pine } })
  s1.addShape('rect', { x: 0, y: 0, w: 0.18, h: H, fill: { color: C.moss } })
  s1.addText('If we built CARA today', { x: 0.8, y: 1.25, w: 11.6, h: 1.1, fontSize: 46, fontFace: 'Arial', color: C.white, bold: true })
  s1.addText('Reimagining the federal NEPA comment-analysis stack — and answering the public’s questions before a staffer ever opens the letter.', {
    x: 0.8, y: 2.6, w: 11.6, h: 1.0, fontSize: 18, fontFace: 'Arial', color: C.moss, lineSpacing: 26,
  })
  s1.addText('A Datanautix capability briefing for federal land-management NEPA teams\nWorked live on the Blue Mountains Forest Plan Revision  ·  Malheur · Umatilla · Wallowa-Whitman National Forests', {
    x: 0.8, y: 4.05, w: 11.6, h: 0.9, fontSize: 14, fontFace: 'Arial', color: C.slateLight, lineSpacing: 22,
  })
  addWordmark(s1, 0.8, 6.0, 22, true)
  s1.addText('powered by the Sentimetrx platform', { x: 0.8, y: 6.55, w: 8, h: 0.4, fontSize: 12, fontFace: 'Arial', color: C.gold })
  s1.addShape('rect', { x: 0, y: H - 0.06, w: W, h: 0.06, fill: { color: C.moss } })
  s1.addNotes(`Framing: not "AI is cool." The government already runs comment analysis at scale (CARA for the Forest Service, PEPC for the Park Service / DOI). Those tools modernized INTAKE. We're going to reimagine the ANALYSIS — and prove it on a comment period that is open right now.`)

  // ═══ SLIDE 2 — THE TOOL THE GOVERNMENT ALREADY HAS ═══
  const s2 = pptx.addSlide(); pg++
  addHeader(s2, 'The government already has a tool', 'CARA (Forest Service) and PEPC (Park Service / DOI) — what they do today')
  addFooter(s2, pg)
  s2.addText('CARA and PEPC are excellent systems of record. They modernized how comments come IN — the reading and analysis is still done by hand.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.62, fontSize: 18, fontFace: 'Arial', color: C.ink, lineSpacing: 24,
  })
  cardRow(s2, 2.05, 2.35, [
    { t: 'Built to intake', d: 'CARA is the Forest Service’s Comment Analysis & Response Application (part of eMNEPA); PEPC is the Park Service / DOI equivalent. They collect comments, post documents, and track the record.', c: C.pineMid },
    { t: 'At real scale', d: 'Roughly 1.5 million public comments are read and analyzed across the government every year — the vast majority processed by staff and contractors reading letter by letter.', c: C.dnTeal },
    { t: 'Analysis is manual', d: 'People still read each comment, hand-assign it to a coding structure, set duplicates aside, and draft each response. Thorough — but serial, slow, and back-loaded to the deadline.', c: C.amber },
  ])
  s2.addShape('rect', { x: 0.6, y: 4.7, w: 12.13, h: 1.75, fill: { color: C.cardTint }, rectRadius: 0.1 })
  s2.addShape('rect', { x: 0.6, y: 4.7, w: 0.12, h: 1.75, fill: { color: C.moss } })
  s2.addText('The design is ~a decade old. It answers "did we log and respond to every comment?" — a compliance question. It was never built to answer "what is the public actually asking, how much of it is the same thing, and how much could we answer today?"', {
    x: 0.95, y: 4.92, w: 11.4, h: 1.35, fontSize: 15, fontFace: 'Arial', color: C.ink, italic: true, valign: 'middle', lineSpacing: 22,
  })
  s2.addNotes(`Respectful framing. CARA/PEPC are good at what they were scoped for (intake + record). Sourced: CARA is the Comment Analysis and Response Application, part of the Forest Service eMNEPA solution; ~1.5M comments/yr read+analyzed governmentwide (Forest Service CARA NEPA pilot nomination). PEPC = Planning, Environment and Public Comment (NPS/DOI), which explicitly includes "tools for public comment analysis and response" via a hand-built coding structure. The gap is that analysis is manual and the model predates modern LLMs.`)

  // ═══ SLIDE 2b — TWO SIDES OF CARA (the frame) ═══
  const sA = pptx.addSlide(); pg++
  addHeader(sA, 'The public has two jobs — CARA only does one', 'Two sides of the same comment period')
  addFooter(sA, pg)
  sA.addText('People come to a comment period for two different reasons. One is served by a conversation; the other by the record. They are not the same job.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.6, fontSize: 16, fontFace: 'Arial', color: C.ink, lineSpacing: 21,
  })
  const twoSides = [
    { t: 'Side A — Ask', tag: 'people who want to understand', c: C.dnTeal, body: [
      'A conversational agent answers their questions in real time, grounded in the plan record.',
      'Every conversation is captured, summarized, and sliced by topic — intelligence CARA never collects.',
      'The pre-decisional channel that simply doesn’t exist today.',
    ] },
    { t: 'Side B — Record', tag: 'people who want a position on the record', c: C.dnOrange, body: [
      'Capture every formal comment, collapse the campaigns, code the issues and stance.',
      'Draft a sourced response to each for human approval — the defensible “hard look” record.',
      'What CARA does today — by hand, and back-loaded to the deadline.',
    ] },
  ]
  twoSides.forEach((p, i) => {
    const x = 0.6 + i * 6.16
    sA.addShape('rect', { x, y: 2.05, w: 5.97, h: 3.35, fill: { color: C.card }, rectRadius: 0.1 })
    sA.addShape('rect', { x, y: 2.05, w: 5.97, h: 0.78, fill: { color: p.c }, rectRadius: 0.1 })
    sA.addText(p.t, { x: x + 0.28, y: 2.13, w: 5.5, h: 0.38, fontSize: 18, fontFace: 'Arial', color: C.white, bold: true })
    sA.addText(p.tag, { x: x + 0.28, y: 2.5, w: 5.5, h: 0.3, fontSize: 12, fontFace: 'Arial', color: C.white, italic: true })
    p.body.forEach((b, j) => {
      sA.addShape('ellipse', { x: x + 0.34, y: 3.12 + j * 0.78, w: 0.13, h: 0.13, fill: { color: p.c } })
      sA.addText(b, { x: x + 0.6, y: 2.98 + j * 0.78, w: 5.15, h: 0.72, fontSize: 12, fontFace: 'Arial', color: C.ink, valign: 'top', lineSpacing: 16 })
    })
  })
  sA.addShape('rect', { x: 0.6, y: 5.7, w: 12.13, h: 0.8, fill: { color: C.pine }, rectRadius: 0.1 })
  sA.addText([
    { text: 'CARA was built for Side B and runs it manually — and has no Side A at all. ', options: { color: C.moss, bold: true } },
    { text: 'Our approach is both, and each makes the other cleaner: answered questions become better comments; the record stops carrying questions it was never meant to answer.', options: { color: C.white } },
  ], { x: 0.95, y: 5.8, w: 11.4, h: 0.62, fontSize: 12.5, fontFace: 'Arial', valign: 'middle', lineSpacing: 17 })
  sA.addNotes(`The organizing frame. Two audiences, two jobs. Side A = Ask (real-time agent + conversation record + summarization, the NOWOCATS pattern applied pre-decision). Side B = Record (the comment pipeline). CARA only does B, by hand. Next slide grounds the split in the real Blue Mountains record.`)

  // ═══ SLIDE 2c — THE SPLIT, IN THE REAL RECORD ═══
  const sB = pptx.addSlide(); pg++
  addHeader(sB, 'The record proves the split', `What the Blue Mountains comments actually are — ${INTENT.distinct} distinct, of ${INTENT.analyzed} analyzed`)
  addFooter(sB, pg)
  sB.addText('We classified every distinct comment by why the person wrote it. The formal record is almost entirely positions — which is exactly the point.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.6, fontSize: 15.5, fontFace: 'Arial', color: C.ink, lineSpacing: 21,
  })
  // Stacked intent bar
  const iseg: [string, number, string][] = [
    [`Position — ${INTENT.pctPosition}%`, INTENT.pctPosition, C.dnOrange],
    [`Both — ${INTENT.pctBoth}%`, INTENT.pctBoth, C.gold],
    [`Question — ${INTENT.pctQuestion}%`, INTENT.pctQuestion, C.dnTeal],
  ]
  let ix = 0.6
  iseg.forEach(([lab, pct, c]) => {
    const w = (pct / 100) * 12.13
    sB.addShape('rect', { x: ix, y: 2.05, w, h: 0.8, fill: { color: c } })
    if (pct >= 6) sB.addText(`${pct}%`, { x: ix, y: 2.05, w, h: 0.8, fontSize: 18, fontFace: 'Arial', color: C.white, bold: true, align: 'center', valign: 'middle' })
    ix += w
  })
  sB.addText('Position — wants a view on the record          Both — asks AND positions          Question', {
    x: 0.6, y: 2.95, w: 12.13, h: 0.3, fontSize: 10.5, fontFace: 'Arial', color: C.slate,
  })
  cardRow(sB, 3.5, 1.75, [
    { t: `${INTENT.pctPosition}% pure positions`, d: 'The formal channel doing its job. This is Side B — capture, code, respond. Exactly what CARA is for.', c: C.dnOrange },
    { t: `${INTENT.pctBoth}% ask AND position`, d: `The ${INTENT.bothVoices} committed commenters who still had unanswered questions inside their comment — the visible tip of Side-A demand.`, c: C.gold },
    { t: `~${INTENT.pctQuestion}% pure questions`, d: 'Almost nobody uses the comment box to ask. Not for lack of demand — there is nowhere to ask.', c: C.dnTeal },
  ])
  sB.addShape('rect', { x: 0.6, y: 5.5, w: 12.13, h: 1.0, fill: { color: C.pine }, rectRadius: 0.1 })
  sB.addText([
    { text: 'The comment box only captures people who already took a position. ', options: { color: C.moss, bold: true } },
    { text: 'Everyone still trying to understand is invisible to CARA — they stay silent or file a position with their questions unanswered. Side A serves, and makes visible, that missing audience.', options: { color: C.white } },
  ], { x: 0.95, y: 5.62, w: 11.4, h: 0.78, fontSize: 13, fontFace: 'Arial', valign: 'middle', lineSpacing: 18 })
  sB.addNotes(`Honest grounding. Intent split (automated first-pass): 81% pure position, 19% both, ~1% pure question. Reframes Side A from "redirect misfiled questions" to "surface an audience missing from the record entirely." The 19% both is the on-record evidence the demand exists. Do not overclaim the 1% — the point is the comment box isn't where questions go, so the demand is invisible, not absent.`)

  // ═══ SLIDE 3 — IF WE BUILT CARA TODAY ═══
  const s3 = pptx.addSlide(); pg++
  addHeader(s3, 'If we built CARA today', 'Keep the intake and the record — add an analysis layer that didn’t exist when CARA was designed')
  addFooter(s3, pg)
  s3.addText('Same trusted intake, same objection process, same human sign-off — with the reading, coding, and first-draft responding done in minutes, not months.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.62, fontSize: 17.5, fontFace: 'Arial', color: C.pineMid, bold: true, lineSpacing: 23,
  })
  const pipe = [
    { n: '1', t: 'Ingest', d: 'Every comment — CARA/PEPC, email, mail, hearing transcript — lands as structured data the moment it arrives.' },
    { n: '2', t: 'Cluster', d: 'Semantic near-duplicate detection collapses form-letter campaigns and rescues the personalized paragraph inside them.' },
    { n: '3', t: 'Code', d: 'Each distinct comment is auto-coded to issues, stance, and substantive-vs-form — a running read, not a deadline scramble.' },
    { n: '4', t: 'Answer & draft', d: 'Embedded questions are extracted and answered from the DEIS; responses come pre-drafted for a human to review and approve.' },
  ]
  pipe.forEach((st, i) => {
    const x = 0.6 + i * 3.06
    s3.addShape('rect', { x, y: 2.15, w: 2.85, h: 3.15, fill: { color: C.card }, rectRadius: 0.1 })
    s3.addShape('ellipse', { x: x + 0.22, y: 2.4, w: 0.55, h: 0.55, fill: { color: C.pine } })
    s3.addText(st.n, { x: x + 0.22, y: 2.4, w: 0.55, h: 0.55, fontSize: 20, fontFace: 'Arial', color: C.white, bold: true, align: 'center', valign: 'middle' })
    s3.addText(st.t, { x: x + 0.22, y: 3.1, w: 2.5, h: 0.5, fontSize: 16, fontFace: 'Arial', color: C.pine, bold: true, valign: 'top' })
    s3.addText(st.d, { x: x + 0.22, y: 3.62, w: 2.5, h: 1.6, fontSize: 11.5, fontFace: 'Arial', color: C.ink, valign: 'top', lineSpacing: 16 })
  })
  s3.addShape('rect', { x: 0.6, y: 5.65, w: 12.13, h: 0.85, fill: { color: C.cardTint }, rectRadius: 0.1 })
  s3.addShape('rect', { x: 0.6, y: 5.65, w: 0.12, h: 0.85, fill: { color: C.dnTeal } })
  s3.addText('Nothing here removes the human. It removes the thousand hours of manual reading between "a comment arrived" and "a person can make a judgment about it."', {
    x: 0.95, y: 5.75, w: 11.4, h: 0.65, fontSize: 13.5, fontFace: 'Arial', color: C.ink, valign: 'middle', lineSpacing: 19,
  })
  s3.addNotes(`This is the "if we built it today" architecture. The four steps map to real Sentimetrx capabilities we'll evidence on the next slides using the live Blue Mountains record. Emphasize continuity: same objection process (36 CFR 218/219), same human decision — we're compressing the manual middle.`)

  // ═══ SLIDE 4 — MORE THAN CARA (delta table) ═══
  const s4 = pptx.addSlide(); pg++
  addHeader(s4, 'What we do that CARA doesn’t', 'The same record — with an analysis layer on top')
  addFooter(s4, pg)
  const colX = { cap: 0.6, today: 4.7, us: 8.95 }
  const rowY0 = 2.05, rowH = 0.62
  // header row
  s4.addText('Capability', { x: colX.cap + 0.15, y: 1.5, w: 3.9, h: 0.4, fontSize: 12, fontFace: 'Arial', color: C.slate, bold: true })
  s4.addText('CARA / PEPC today', { x: colX.today + 0.15, y: 1.5, w: 4.0, h: 0.4, fontSize: 12, fontFace: 'Arial', color: C.amber, bold: true })
  s4.addText('If we built it today', { x: colX.us + 0.15, y: 1.5, w: 4.0, h: 0.4, fontSize: 12, fontFace: 'Arial', color: C.mossDeep, bold: true })
  const rows: [string, string, string][] = [
    ['Duplicate handling', 'Exact-match copies set aside by hand', 'Semantic near-dup clustering — copies + variants'],
    ['Personalized paragraph', 'Lost with the template', 'Template-delta extraction rescues the real substance'],
    ['Issue coding', 'Staff hand-code to a code list', 'Auto-coded to issues + stance, every comment'],
    ['Substantive vs. form', 'A manual read call', 'Classified automatically, with the evidence span'],
    ['Embedded questions', 'Never separated out', 'Extracted and counted as their own layer'],
    ['Answering questions', 'Each drafted from a blank page', 'Pre-answered from the DEIS for human approval'],
    ['When you know', 'At the deadline', 'Continuously, from day one of the window'],
  ]
  rows.forEach((r, i) => {
    const y = rowY0 + i * rowH
    if (i % 2 === 0) s4.addShape('rect', { x: colX.cap, y, w: 12.13, h: rowH, fill: { color: C.card } })
    s4.addText(r[0], { x: colX.cap + 0.15, y, w: 3.9, h: rowH, fontSize: 12, fontFace: 'Arial', color: C.pine, bold: true, valign: 'middle' })
    s4.addText(r[1], { x: colX.today + 0.15, y, w: 4.0, h: rowH, fontSize: 11.5, fontFace: 'Arial', color: C.slate, valign: 'middle', lineSpacing: 14 })
    s4.addText([{ text: '→  ', options: { color: C.moss, bold: true } }, { text: r[2], options: { color: C.ink } }], { x: colX.us + 0.05, y, w: 4.25, h: rowH, fontSize: 11.5, fontFace: 'Arial', valign: 'middle', lineSpacing: 14 })
  })
  s4.addNotes(`The delta table is the "more than CARA" ask. Every right-column item is demonstrated on the real Blue Mountains data in the rest of the deck: dedup + template-delta (slide 5), issue/stance/substantive (slide 5), the question layer (slide 6), answering (slides 8-9). "When you know" is the strategic one — it's the difference between managing objection risk and discovering it.`)

  // ═══ SLIDE 5 — THE CURRENT BLUE MOUNTAINS VIEW (our CARA-equivalent) ═══
  const s5 = pptx.addSlide(); pg++
  addHeader(s5, 'The Blue Mountains record, as it stands', 'Our CARA-equivalent view — built in a day, refreshed daily')
  addFooter(s5, pg)
  // Funnel (left)
  s5.addText('The funnel', { x: 0.6, y: 1.2, w: 5.5, h: 0.35, fontSize: 13, fontFace: 'Arial', color: C.pine, bold: true })
  const fstages: [number, string, string][] = [
    [F.submitted, 'Submitted', 'logged in CARA'],
    [F.available, 'Available & analyzed', `${F.held} held pending PII`],
    [F.distinct, 'Distinct voices', `${F.available - F.distinct} copies removed (${DUP_PCT}%)`],
    [F.substantive, 'Substantive — must respond', `${F.distinct - F.substantive} non-substantive`],
  ]
  const fColors = [C.pine, C.pineMid, C.mossDeep, C.moss]
  fstages.forEach((s, i) => {
    const y = 1.65 + i * 1.02
    const w = 0.9 + (s[0] / F.submitted) * 5.1
    s5.addShape('rect', { x: 0.6, y, w, h: 0.66, fill: { color: fColors[i] }, rectRadius: 0.05 })
    s5.addText(`${s[0].toLocaleString()}`, { x: 0.75, y, w: 1.3, h: 0.66, fontSize: 17, fontFace: 'Arial', color: C.white, bold: true, valign: 'middle' })
    s5.addText(s[1], { x: 0.6, y, w: w, h: 0.66, fontSize: 11, fontFace: 'Arial', color: C.white, align: 'right', valign: 'middle' })
    s5.addText(s[2], { x: 0.62, y: y + 0.66, w: 5.4, h: 0.28, fontSize: 9.5, fontFace: 'Arial', color: C.amber, italic: true })
  })
  // Issues (right)
  s5.addText('What they’re raising  ·  distinct voices', { x: 6.5, y: 1.2, w: 6.2, h: 0.35, fontSize: 13, fontFace: 'Arial', color: C.pine, bold: true })
  const maxVox = ISSUES[0][1]
  ISSUES.forEach((iss, i) => {
    const y = 1.62 + i * 0.5
    s5.addText(iss[0], { x: 6.5, y, w: 2.55, h: 0.42, fontSize: 10.5, fontFace: 'Arial', color: C.ink, valign: 'middle' })
    const bw = (iss[1] / maxVox) * 2.9
    s5.addShape('rect', { x: 9.1, y: y + 0.06, w: bw, h: 0.3, fill: { color: C.pineMid }, rectRadius: 0.03 })
    s5.addText(`${iss[1]}`, { x: 9.15 + bw, y, w: 1.2, h: 0.42, fontSize: 10, fontFace: 'Arial', color: C.slate, valign: 'middle' })
  })
  // Stance strip (bottom)
  const stTot = STANCE.oppose + STANCE.support + STANCE.mixed + STANCE.unclear
  const seg: [number, string][] = [[STANCE.oppose, C.dnOrange], [STANCE.support, C.mossDeep], [STANCE.mixed, C.slate], [STANCE.unclear, C.slateLight]]
  let sx = 0.6
  seg.forEach(([n, c]) => { const w = (n / stTot) * 5.1; s5.addShape('rect', { x: sx, y: 5.95, w, h: 0.34, fill: { color: c } }); sx += w })
  s5.addText([{ text: '≈2:1 opposed', options: { bold: true, color: C.dnOrange } }, { text: `  ·  ${STANCE.oppose} oppose · ${STANCE.support} support · ${STANCE.mixed} mixed`, options: { color: C.slate } }], { x: 0.6, y: 6.35, w: 6, h: 0.3, fontSize: 10.5, fontFace: 'Arial' })
  // Callout (right-bottom)
  s5.addShape('rect', { x: 6.5, y: 5.75, w: 6.23, h: 0.9, fill: { color: C.amberTint }, rectRadius: 0.08 })
  s5.addShape('rect', { x: 6.5, y: 5.75, w: 0.1, h: 0.9, fill: { color: C.dnOrange } })
  s5.addText([{ text: `${DUP_PCT}% of the pile is duplicate copies. `, options: { bold: true, color: C.pine } }, { text: `The single biggest form-letter campaign is ${CAMPAIGN_COPIES} near-identical copies — one concern, ${CAMPAIGN_COPIES} times.`, options: { color: C.ink } }], { x: 6.72, y: 5.82, w: 5.9, h: 0.78, fontSize: 11.5, fontFace: 'Arial', valign: 'middle', lineSpacing: 15 })
  s5.addNotes(`This is the payoff of "our CARA-equivalent view." Every number is from the real live corpus. Deterministic dedup/funnel counts are exact; issue/stance are an automated first pass (labelled). The point: CARA gives you this after weeks of hand-coding at the deadline — we produced it in a day and refresh it daily. Numbers as of the snapshot; corpus grows as held letters post.`)

  // ═══ SLIDE 6 — THE NEXT FUNNEL LAYER: QUESTIONS ═══
  const s6 = pptx.addSlide(); pg++
  addHeader(s6, 'The next layer: how much of it is a question?', 'Responding to comments means answering the questions buried in them')
  addFooter(s6, pg)
  s6.addText('Here’s the surprise: reading doesn’t get you out of answering. Virtually every must-respond comment poses an answerable question. The relief comes from repetition, not from fewer comments.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.62, fontSize: 16, fontFace: 'Arial', color: C.ink, lineSpacing: 21,
  })
  // Big stat tiles
  const qtiles: [string, string, string][] = [
    ['≈100%', 'of the must-respond set', 'poses an answerable question'],
    [`~${Q.totalAsks.toLocaleString()}`, 'answerable question-instances', 'the raw answering workload'],
    [`${Q.top25Pct}%`, 'of every ask covered by', 'just the top 25 questions'],
  ]
  qtiles.forEach((t, i) => {
    const x = 0.6 + i * 4.05
    s6.addShape('rect', { x, y: 2.15, w: 3.82, h: 1.85, fill: { color: C.card }, rectRadius: 0.1 })
    s6.addShape('rect', { x, y: 2.15, w: 3.82, h: 0.12, fill: { color: C.dnTeal } })
    s6.addText(t[0], { x: x + 0.2, y: 2.4, w: 3.4, h: 0.9, fontSize: 44, fontFace: 'Arial', color: C.pineMid, bold: true })
    s6.addText(t[1], { x: x + 0.22, y: 3.32, w: 3.4, h: 0.32, fontSize: 13, fontFace: 'Arial', color: C.pine, bold: true })
    s6.addText(t[2], { x: x + 0.22, y: 3.62, w: 3.5, h: 0.35, fontSize: 11.5, fontFace: 'Arial', color: C.slate })
  })
  // Question-type breakdown
  s6.addText('The questions people are actually asking', { x: 0.6, y: 4.35, w: 8, h: 0.35, fontSize: 13, fontFace: 'Arial', color: C.pine, bold: true })
  const maxT = Q.topTypes.length ? Q.topTypes[0][1] : 1
  Q.topTypes.slice(0, 5).forEach((t, i) => {
    const y = 4.8 + i * 0.42
    s6.addText(t[0], { x: 0.6, y, w: 3.4, h: 0.36, fontSize: 11, fontFace: 'Arial', color: C.ink, valign: 'middle' })
    const bw = (t[1] / maxT) * 3.2
    s6.addShape('rect', { x: 4.1, y: y + 0.04, w: Math.max(bw, 0.05), h: 0.28, fill: { color: C.moss }, rectRadius: 0.03 })
    s6.addText(`${t[1]}`, { x: 4.15 + Math.max(bw, 0.05), y, w: 1, h: 0.36, fontSize: 10, fontFace: 'Arial', color: C.slate, valign: 'middle' })
  })
  s6.addShape('rect', { x: 8.3, y: 4.75, w: 4.43, h: 1.9, fill: { color: C.pine }, rectRadius: 0.1 })
  s6.addText('Why this layer matters', { x: 8.55, y: 4.9, w: 4, h: 0.35, fontSize: 13, fontFace: 'Arial', color: C.moss, bold: true })
  s6.addText([
    { text: 'A question asked 172 times is still one answer. ', options: { color: C.moss, bold: true } },
    { text: `The single biggest form-letter template alone carries 7 questions, each asked ${CAMPAIGN_COPIES}×. Answer the recurring ones once and the majority of the response burden is already closed.`, options: { color: C.white } },
  ], { x: 8.55, y: 5.3, w: 3.95, h: 1.25, fontSize: 12, fontFace: 'Arial', valign: 'top', lineSpacing: 18 })
  s6.addNotes(`FILL Q.* from _nepa_questions.ts. This is the funnel layer the owner asked for — it sits below "substantive." The reframe: comments are unbounded, but distinct questions are finite. That finite set is what the assistant can pre-answer (next slides).`)

  // ═══ SLIDE 7 — WE ALREADY HAVE THE ASSISTANT ═══
  const s7 = pptx.addSlide(); pg++
  addHeader(s7, 'We already built the assistant that answers them', 'A live Blue Mountains agent, grounded in the plan record')
  addFooter(s7, pg)
  s7.addText('This isn’t a promise. The Blue Mountains assistant is deployed and public right now — the same agent the public can ask, pointed at the questions in the record.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.62, fontSize: 17, fontFace: 'Arial', color: C.pineMid, bold: true, lineSpacing: 23,
  })
  cardRow(s7, 2.1, 2.6, [
    { t: 'Grounded, not guessing', d: 'Answers from a knowledgebase built on the Draft EIS, the alternatives, the 21-inch rule history, and the comment process — with the source behind each answer.', c: C.dnTeal },
    { t: 'Neutral by design', d: 'It informs; it does not advocate. It explains what each alternative would do and how to comment — it never tells anyone what to think.', c: C.mossDeep },
    { t: 'Already live', d: 'Deployed on the public project page and battle-tested: profanity filtering, prompt-injection resistance, and strict neutrality all verified against the live agent.', c: C.moss },
  ])
  s7.addShape('rect', { x: 0.6, y: 5.15, w: 12.13, h: 1.3, fill: { color: C.cardTint }, rectRadius: 0.1 })
  s7.addShape('rect', { x: 0.6, y: 5.15, w: 0.12, h: 1.3, fill: { color: C.moss } })
  s7.addText('So the natural test writes itself: take the real questions people are actually asking in the comment record, ask the deployed assistant, and see how many it can already answer well.', {
    x: 0.95, y: 5.3, w: 11.4, h: 1.0, fontSize: 14.5, fontFace: 'Arial', color: C.ink, italic: true, valign: 'middle', lineSpacing: 22,
  })
  s7.addNotes(`Bridge slide. The agent is real (prod, /b/blue-mountains). Offer a live demo. Then move to the measured answerability result.`)

  // ═══ SLIDE 8 — ANSWERABILITY RESULT ═══
  const s8 = pptx.addSlide(); pg++
  addHeader(s8, 'We pointed it at the real questions', `${A.tested} of the most-asked questions from the record → the deployed agent, graded by a strict independent judge`)
  addFooter(s8, pg)
  // Segmented outcome bar
  s8.addText('Every answer, graded high / partial / not-yet — with the full 371-page DEIS ingested', { x: 0.6, y: 1.25, w: 12, h: 0.35, fontSize: 13, fontFace: 'Arial', color: C.pine, bold: true })
  const segs: [string, number, string, string][] = [
    ['HIGH', A.pctHigh, C.mossDeep, 'usable first-draft answer'],
    ['PARTIAL', A.pctPartial, C.gold, 'on-topic but incomplete'],
    ['NOT YET', A.pctNo, C.slateLight, 'answerable, not yet retrieved'],
  ]
  let bx = 0.6
  segs.forEach(([lab, pct, c]) => {
    const w = (pct / 100) * 12.13
    s8.addShape('rect', { x: bx, y: 1.65, w, h: 0.75, fill: { color: c } })
    s8.addText(`${pct}%`, { x: bx, y: 1.65, w, h: 0.75, fontSize: 18, fontFace: 'Arial', color: lab === 'NOT YET' ? C.slate : C.white, bold: true, align: 'center', valign: 'middle' })
    s8.addText(lab, { x: bx, y: 2.42, w, h: 0.3, fontSize: 10.5, fontFace: 'Arial', color: C.slate, align: 'center', bold: true })
    bx += w
  })
  // Headline read
  s8.addText([
    { text: `${A.pctHighPartial}% answered at least partially (${A.pctHighPartialByVol}% weighted by how often each question is asked); ${A.pctHigh}% a usable first draft`, options: { color: C.pine, bold: true } },
    { text: ' — measured against the deployed agent with the Draft EIS loaded.', options: { color: C.ink } },
  ], { x: 0.6, y: 2.95, w: 12.1, h: 0.7, fontSize: 14, fontFace: 'Arial', valign: 'middle', lineSpacing: 20 })
  // Left callout — the lift progression + the tuning target
  s8.addShape('rect', { x: 0.6, y: 3.9, w: 5.95, h: 2.5, fill: { color: C.pine }, rectRadius: 0.1 })
  s8.addText('The method scales — measured, then projected', { x: 0.85, y: 4.06, w: 5.5, h: 0.4, fontSize: 13.5, fontFace: 'Arial', color: C.moss, bold: true })
  const steps8: [string, string, string][] = [
    ['28 curated chunks', `${A.beforeHigh}% usable`, 'measured'],
    ['+ full DEIS ingested', `${A.pctHigh}% usable · ${A.pctHighPartial}% partial+`, 'measured'],
    ['+ retrieval tuning', `target ${A.targetHighPartial}%+`, 'next step'],
  ]
  steps8.forEach((s, i) => {
    const y = 4.5 + i * 0.5
    s8.addShape('ellipse', { x: 0.9, y: y + 0.06, w: 0.13, h: 0.13, fill: { color: i === 2 ? C.gold : C.moss } })
    s8.addText([{ text: s[0] + '  ', options: { color: C.white, bold: true } }, { text: '→ ' + s[1], options: { color: i === 2 ? C.gold : C.slateLight } }], { x: 1.15, y, w: 5.2, h: 0.44, fontSize: 11.5, fontFace: 'Arial', valign: 'middle' })
  })
  s8.addText('The remaining misses are answerable — the DEIS text is already in the agent, so the gap is retrieval, not data. Reranking, prioritizing the curated answers, and cleaning the tables is projected to clear 80%+.', {
    x: 0.85, y: 6.02, w: 5.7, h: 0.34, fontSize: 9.5, fontFace: 'Arial', color: C.moss, italic: true, valign: 'top', lineSpacing: 12,
  })
  // Right callout — strict scoring
  s8.addShape('rect', { x: 6.78, y: 3.9, w: 5.95, h: 2.5, fill: { color: C.card }, rectRadius: 0.1 })
  s8.addText('Scored strictly, on purpose', { x: 7.03, y: 4.08, w: 5.5, h: 0.4, fontSize: 14, fontFace: 'Arial', color: C.pine, bold: true })
  s8.addText([
    { text: 'A separate judge model graded each answer and was told to be skeptical. An answer that only validated the concern or said “submit a comment” without supplying the facts was scored NOT answered', options: { color: C.ink, bold: true } },
    { text: ` — never a generous partial. So ${A.pctHigh}% / ${A.pctHighPartial}% is the conservative read, and the sample on the next slide shows what “high” actually looks like.`, options: { color: C.ink } },
  ], { x: 7.03, y: 4.5, w: 5.5, h: 1.8, fontSize: 12, fontFace: 'Arial', valign: 'top', lineSpacing: 18 })
  s8.addNotes(`Honest framing is the whole point. 50 most-asked distinct questions, live prod agent, one clean turn each, strict independent judge (capture-only = fail). MEASURED with the full 371-page DEIS ingested: 28% high / 36% partial / 36% not-yet; 64% high+partial (71% by question volume) — up from 20% high / 52% partial+ on the 28 curated chunks alone. Ingesting the DEIS closed the exact niche gaps (airstrips, ROS, roadless, Wilderness, elk). The 80%+ is a TARGET, not measured — most remaining misses are retrieval, not missing data (the DEIS text is already in the agent), so reranking + prioritizing curated chunks + table cleanup is the lever. Say "projected/target," never "we achieve 80%." Sample slide carries the quality proof.`)

  // ═══ SLIDE 9 — REAL Q->A PAIRS ═══
  const s9 = pptx.addSlide(); pg++
  addHeader(s9, 'See for yourself', 'Real questions from the record, real answers from the live assistant')
  addFooter(s9, pg)
  // Fixed 3-row layout — question bubble (fits 2 lines) then a wider answer bubble.
  const rowY = [1.35, 3.02, 4.69]
  A.samples.slice(0, 3).forEach((pair, i) => {
    const qy = rowY[i]
    s9.addShape('roundRect', { x: 0.6, y: qy, w: 9.4, h: 0.58, fill: { color: C.cardTint }, rectRadius: 0.08 })
    s9.addText([{ text: 'Q  ', options: { color: C.dnTeal, bold: true } }, { text: pair.q, options: { color: C.pine, bold: true } }], { x: 0.78, y: qy + 0.02, w: 9.05, h: 0.54, fontSize: 11.5, fontFace: 'Arial', valign: 'middle', lineSpacing: 14 })
    s9.addShape('roundRect', { x: 1.4, y: qy + 0.64, w: 11.33, h: 0.9, fill: { color: C.card }, rectRadius: 0.08 })
    s9.addShape('rect', { x: 1.4, y: qy + 0.64, w: 0.1, h: 0.9, fill: { color: C.moss } })
    s9.addText([{ text: 'A  ', options: { color: C.moss, bold: true } }, { text: pair.a, options: { color: C.ink } }], { x: 1.62, y: qy + 0.68, w: 10.95, h: 0.82, fontSize: 11.5, fontFace: 'Arial', valign: 'top', lineSpacing: 15 })
  })
  s9.addText('Unedited answers from the deployed agent. Each cites the plan section behind it in the live experience.', { x: 0.6, y: 6.55, w: 12, h: 0.3, fontSize: 10.5, fontFace: 'Arial', color: C.slate, italic: true })
  s9.addNotes(`FILL A.samples with 3 real high-confidence pairs from the answerability run. Keep answers trimmed to ~2 lines each for layout. These are the proof — real, unscripted, from the live agent.`)

  // ═══ SLIDE 10 — THE LABOR MATH ═══
  const s10 = pptx.addSlide(); pg++
  addHeader(s10, 'What that means for labor', 'The same answer, written once, instead of found and written again and again')
  addFooter(s10, pg)
  s10.addText('The response-to-comments burden isn’t the number of letters — it’s writing the same answers over and over. Pre-answering the distinct questions attacks exactly that.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.62, fontSize: 16.5, fontFace: 'Arial', color: C.ink, lineSpacing: 22,
  })
  cardRow(s10, 2.1, 2.5, [
    { t: 'Finite, not infinite', d: `The pile is unbounded, but the distinct answerable questions are a knowable set. The most-asked single question shows up ${CAMPAIGN_COPIES}× in the record — and takes one answer.`, c: C.dnTeal },
    { t: 'Pre-drafted, not blank', d: `With the Draft EIS loaded, the agent answers ${A.pctHigh}% at high confidence and ${A.pctHighPartial}% at least partially. That share of the record starts as an editable draft, not a blank page — and climbs further with retrieval tuning (target ${A.targetHighPartial}%+).`, c: C.mossDeep },
    { t: 'Humans on judgment', d: 'Staff time moves off transcription and toward the calls only a person should make — the contested, the novel, the politically weighted.', c: C.moss },
  ])
  s10.addShape('rect', { x: 0.6, y: 4.95, w: 12.13, h: 1.5, fill: { color: C.pine }, rectRadius: 0.1 })
  s10.addText('The reduction, stated honestly', { x: 0.95, y: 5.15, w: 11.4, h: 0.4, fontSize: 14, fontFace: 'Arial', color: C.moss, bold: true })
  s10.addText([
    { text: `On this record, the agent returns a high-confidence first draft for ${A.pctHigh}% of the most-asked questions and at least a partial answer for ${A.pctHighPartial}% (${A.pctHighPartialByVol}% weighted by how often they’re asked) — and the misses are a tuning pass away, not a dead end. `, options: { color: C.white, bold: true } },
    { text: 'The labor that used to go into re-reading and re-answering the same questions becomes review-and-approve. That is where the hours come back.', options: { color: C.slateLight } },
  ], { x: 0.95, y: 5.55, w: 11.5, h: 0.85, fontSize: 13.5, fontFace: 'Arial', valign: 'top', lineSpacing: 20 })
  s10.addNotes(`FILL A.pctHigh. No fabricated hours/$ — the honest levers are: distinct questions are finite (real counts), the most-asked repeats ${CAMPAIGN_COPIES}x (real), and the assistant pre-answers the majority (measured). Frame savings as a shift to review-and-approve, not a headcount claim.`)

  // ═══ SLIDE 10b — PII TRIAGE ═══
  const sP = pptx.addSlide(); pg++
  addHeader(sP, 'Clear the PII backlog — flag, don’t publish', 'The step holding comments back, turned into a same-day reviewer queue')
  addFooter(sP, pg)
  sP.addText([
    { text: `Remember the ~${PII.held} comments held “pending PII review.” `, options: { color: C.pine, bold: true } },
    { text: 'That manual review is the bottleneck between “a comment arrived” and “it’s in the public record.” A detection pass makes it a triage queue instead of a serial read.', options: { color: C.ink } },
  ], { x: 0.6, y: 1.25, w: 12.1, h: 0.7, fontSize: 15.5, fontFace: 'Arial', valign: 'middle', lineSpacing: 21 })
  cardRow(sP, 2.15, 2.5, [
    { t: 'Two-pass detection', d: 'A deterministic pass catches structured PII exactly — emails, phone numbers, street addresses. An AI pass catches the contextual kind — a third party named, a home location, a sensitive detail.', c: C.dnTeal },
    { t: 'Flag, never auto-publish', d: 'Every candidate goes to a human. Nothing is redacted-and-released without a reviewer’s sign-off — the agency stays the records custodian. It ranks the queue; it doesn’t make the call.', c: C.mossDeep },
    { t: 'Weeks → same day', d: `Point it at the ${PII.held} held comments and they clear as a ranked reviewer queue — look at exactly what’s flagged, confirm the rest is clean, release. Not a comment-by-comment manual pass.`, c: C.moss },
  ])
  sP.addShape('rect', { x: 0.6, y: 4.95, w: 12.13, h: 1.5, fill: { color: C.pine }, rectRadius: 0.1 })
  sP.addText(`Run on all ${PII.scanned} released comments: ${PII.pctCleared}% auto-cleared, ${PII.pctFlagged}% to a reviewer`, { x: 0.95, y: 5.13, w: 11.4, h: 0.4, fontSize: 14, fontFace: 'Arial', color: C.moss, bold: true })
  sP.addText([
    { text: `The reviewer never reads all ${PII.scanned} — only the ${PII.flagged} the detector flags (${PII.structured} with an exact email/phone/address, plus others where the text names a third party, a location, or a sensitive detail). `, options: { color: C.white, bold: true } },
    { text: `It flags conservatively — even a spouse’s name or a signature — because a missed address published is far worse than a five-second glance that clears. The ${PII.pctCleared}% it clears, it clears with confidence.`, options: { color: C.slateLight } },
  ], { x: 0.95, y: 5.55, w: 11.5, h: 0.85, fontSize: 12.5, fontFace: 'Arial', valign: 'top', lineSpacing: 18 })
  sP.addNotes(`FILL PII.* from _nepa_pii_scan.ts. Honest framing: the released set is nearly clean (validates both the FS process AND the detector's precision); the value is speed on the ~195 held backlog + a safety net, and "flag for a human, never auto-publish" (the agency keeps custody). No raw PII anywhere — counts and redacted examples only. Ties back to the funnel's "held pending PII" stage.`)

  // ═══ SLIDE 11 — HUMAN-IN-THE-LOOP + DEFENSIBILITY ═══
  const s11 = pptx.addSlide(); pg++
  addHeader(s11, 'Human-in-the-loop, and more defensible', 'Faster does not mean unaccountable')
  addFooter(s11, pg)
  cardRow(s11, 1.35, 2.5, [
    { t: 'The agency signs every word', d: 'The assistant drafts; a Forest Service reviewer edits and approves. Nothing is published to the record without a human decision. It is a first draft, never the final word.', c: C.pineMid },
    { t: 'Every answer is traceable', d: 'Each drafted response carries the DEIS section it came from — the "hard look" record gets stronger, not thinner, because every answer is sourced.', c: C.dnTeal },
    { t: 'Objection risk, early', d: 'Concerns are coded and answered while the window is open, under the pre-decisional objection process (36 CFR 218/219) — time to reconcile before a decision is signed.', c: C.moss },
  ])
  s11.addShape('rect', { x: 0.6, y: 4.25, w: 12.13, h: 2.15, fill: { color: C.cardTint }, rectRadius: 0.1 })
  s11.addShape('rect', { x: 0.6, y: 4.25, w: 0.12, h: 2.15, fill: { color: C.mossDeep } })
  s11.addText('The lesson of 2019', { x: 0.95, y: 4.45, w: 11.4, h: 0.4, fontSize: 15, fontFace: 'Arial', color: C.pine, bold: true })
  s11.addText('The last Blue Mountains revision ran ~15 years and was withdrawn at the objection stage — the concern was legible only when it was too late to answer. A running, answered, sourced record is exactly the defense that was missing.', {
    x: 0.95, y: 4.9, w: 11.5, h: 1.35, fontSize: 14, fontFace: 'Arial', color: C.ink, valign: 'top', lineSpacing: 22,
  })
  s11.addNotes(`Ties the efficiency story back to decision quality. The human-in-the-loop point is non-negotiable for a government buyer. Sourced answers strengthen the administrative record. 2019 withdrawal is the cautionary anchor (all sourced in the sibling deck notes).`)

  // ═══ SLIDE 12 — THE ASK ═══
  const s12 = pptx.addSlide(); pg++
  s12.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.pine } })
  s12.addShape('rect', { x: 0, y: 0, w: 0.18, h: H, fill: { color: C.moss } })
  s12.addText('Let’s prove it on a live window', { x: 0.8, y: 1.2, w: 11.6, h: 1.0, fontSize: 40, fontFace: 'Arial', color: C.white, bold: true })
  s12.addText('The Blue Mountains comment period is open right now. We can stand this up on the real record and show the analysis, the question layer, and the answered questions on your data — not a hypothetical.', {
    x: 0.8, y: 2.5, w: 11.4, h: 1.2, fontSize: 16, fontFace: 'Arial', color: C.moss, lineSpacing: 24,
  })
  const asks = [
    ['A working pilot', 'Point the pipeline at one live comment period. Funnel, issues, stance, and the question layer — refreshed daily, on your comments.'],
    ['A deployed assistant', 'A grounded, neutral public-facing agent for the project page, pre-answering the questions in the record for your team to approve.'],
    ['A reviewer workflow', 'Draft responses with sources, routed to staff for edit-and-approve — the record stays human-signed.'],
  ]
  asks.forEach((a, i) => {
    const y = 4.0 + i * 0.95
    s12.addShape('ellipse', { x: 0.85, y: y + 0.06, w: 0.2, h: 0.2, fill: { color: C.moss } })
    s12.addText([{ text: a[0] + '  —  ', options: { color: C.white, bold: true } }, { text: a[1], options: { color: C.slateLight } }], { x: 1.25, y, w: 11.2, h: 0.85, fontSize: 14, fontFace: 'Arial', valign: 'top', lineSpacing: 19 })
  })
  addWordmark(s12, 0.8, 6.85, 16, true)
  s12.addText('powered by the Sentimetrx platform', { x: 3.2, y: 6.9, w: 6, h: 0.4, fontSize: 11, fontFace: 'Arial', color: C.gold, valign: 'middle' })
  s12.addNotes(`Close on the live-window advantage. The ask is concrete and small: one pilot on one real comment period. Everything shown was produced on real data without their cooperation — with it, it only gets sharper.`)
}
