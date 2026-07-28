// Run: npx tsx scripts/oneoff/_ppfl_proposal_deck.ts
// Throwaway: proposal deck for People Power for Florida — AI canvasser practice
// gym + field companion ("two sides of the same coin"), six illustrative voter
// personas, loop flow chart, pilot phases. Writes to ~/Downloads (owner chose
// one-off Downloads for this prospect's materials). Companion to
// _ppfl_canvasser_onepager_pdf.ts. PPFL brand palette verified from their live
// CSS (violet/lavender/pink neo-brutalist sticker style); Datanautix chrome kept.
// Personas are ILLUSTRATIVE composites (labeled on-slide) — no fabricated stats.
import PptxGenJS from 'pptxgenjs'
import { homedir } from 'os'
import { join } from 'path'

const P = {
  violet: '3E1264',
  violetDeep: '2A0A4A',
  lavender: 'B695D2',
  lavenderPale: 'CEB5E3',
  offwhite: 'F7F7FF',
  pink: 'FD7DAF',
  pinkTint: 'FDE8F1',
  black: '000000',
  white: 'FFFFFF',
  ink: '1A1A1A',
  gray: '6B6B6B',
  tealL: '4DBFC1',
  orangeL: 'F07040',
}

const W = 13.33
const H = 7.5
const FONT = 'Arial'

type Slide = PptxGenJS.Slide

// White "sticker" card: hard black offset shadow + black outline
function sticker(s: Slide, x: number, y: number, w: number, h: number, fill = P.white, off = 0.07) {
  s.addShape('roundRect', { x: x + off, y: y + off, w, h, fill: { color: P.black }, line: { width: 0 }, rectRadius: 0.08 })
  s.addShape('roundRect', { x, y, w, h, fill: { color: fill }, line: { color: P.black, width: 1.75 }, rectRadius: 0.08 })
}

// NOTE: pptxgenjs's addText `shadow` option emits out-of-range EMU values (and
// mutates the options object, compounding per use) — PowerPoint flags the file
// as corrupt and strips shapes. Instead we fake the hard sticker shadow by
// drawing a black copy of the text offset behind the real one.
function shadowText(s: Slide, text: string, opts: PptxGenJS.TextPropsOptions & { x: number; y: number }, off = 0.045) {
  s.addText(text, { ...opts, color: P.black, x: opts.x + off, y: opts.y + off })
  s.addText(text, opts)
}

function violetBg(s: Slide) {
  s.background = { color: P.violet }
  s.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: P.violet }, line: { width: 0 } })
}

function addHeader(s: Slide, kicker: string, title: string) {
  violetBg(s)
  s.addText(kicker.toUpperCase(), { x: 0.6, y: 0.28, w: 9.5, h: 0.3, fontSize: 11, fontFace: FONT, color: P.lavenderPale, bold: true, charSpacing: 3 })
  shadowText(s, title, { x: 0.58, y: 0.55, w: 11.0, h: 0.75, fontSize: 30, fontFace: FONT, color: P.white, bold: true })
  s.addText(
    [
      { text: 'data', options: { color: P.tealL, bold: true } },
      { text: 'nautix', options: { color: P.orangeL, bold: true } },
    ],
    { x: W - 2.6, y: 0.32, w: 2.0, h: 0.4, fontSize: 15, fontFace: FONT, align: 'right' }
  )
  s.addShape('rect', { x: 0.6, y: 1.38, w: W - 1.2, h: 0.035, fill: { color: P.pink }, line: { width: 0 } })
}

function addFooter(s: Slide, pg: number) {
  s.addText('Prepared for People Power for Florida  ·  Confidential', { x: 0.6, y: H - 0.4, w: 6.5, h: 0.3, fontSize: 9, fontFace: FONT, color: P.lavenderPale })
  s.addText(
    [
      { text: 'data', options: { color: P.tealL, bold: true } },
      { text: 'nautix', options: { color: P.orangeL, bold: true } },
      { text: '  ·  datanautix.com', options: { color: P.lavenderPale } },
    ],
    { x: W - 5.4, y: H - 0.4, w: 4.0, h: 0.3, fontSize: 9, fontFace: FONT, align: 'right' }
  )
  s.addText(String(pg), { x: W - 1.1, y: H - 0.4, w: 0.5, h: 0.3, fontSize: 9, fontFace: FONT, color: P.lavenderPale, align: 'right' })
}

function chip(s: Slide, x: number, y: number, w: number, text: string, fill = P.white, color = P.violet, fontSize = 10) {
  s.addShape('roundRect', { x: x + 0.04, y: y + 0.04, w, h: 0.34, fill: { color: P.black }, line: { width: 0 }, rectRadius: 0.17 })
  s.addShape('roundRect', { x, y, w, h: 0.34, fill: { color: fill }, line: { color: P.black, width: 1.25 }, rectRadius: 0.17 })
  s.addText(text, { x, y, w, h: 0.34, fontSize, fontFace: FONT, color, bold: true, align: 'center', valign: 'middle' })
}

async function main() {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Datanautix'
  pptx.company = 'Datanautix'
  pptx.title = 'Ready for Every Door — Proposal for People Power for Florida'
  let pg = 0

  // ═════════════════════════ 1 · TITLE ═════════════════════════
  const s1 = pptx.addSlide(); pg++
  violetBg(s1)
  // pink ticker band
  s1.addShape('rect', { x: 0, y: 4.62, w: W, h: 0.5, fill: { color: P.pink }, line: { color: P.black, width: 1.5 } })
  s1.addText('PRACTICE   〰   KNOCK   〰   LISTEN   〰   BUILD POWER', { x: 0, y: 4.62, w: W, h: 0.5, fontSize: 14, fontFace: FONT, color: P.black, bold: true, align: 'center', valign: 'middle', charSpacing: 3 })
  s1.addText('A PROPOSAL FOR PEOPLE POWER FOR FLORIDA', { x: 0.85, y: 1.0, w: 11.5, h: 0.4, fontSize: 14, fontFace: FONT, color: P.lavenderPale, bold: true, charSpacing: 4 })
  shadowText(s1, 'Ready for\nEvery Door.', { x: 0.8, y: 1.45, w: 11.8, h: 2.3, fontSize: 60, fontFace: FONT, color: P.white, bold: true, lineSpacing: 66 }, 0.07)
  s1.addText('Train canvassers to earn the trust of under-40 voters — then guide them at every real door, and learn from every conversation.', {
    x: 0.85, y: 3.75, w: 10.8, h: 0.75, fontSize: 18, fontFace: FONT, color: P.offwhite, lineSpacing: 25,
  })
  s1.addText(
    [
      { text: 'data', options: { color: P.tealL, bold: true } },
      { text: 'nautix', options: { color: P.orangeL, bold: true } },
      { text: '   ·   datanautix.com   ·   consumer insights, powered by conversational AI', options: { color: P.lavenderPale } },
    ],
    { x: 0.85, y: 6.35, w: 11.5, h: 0.4, fontSize: 14, fontFace: FONT }
  )

  // ═════════════════════════ 2 · WHY NOW ═════════════════════════
  const s2 = pptx.addSlide(); pg++
  addHeader(s2, 'The opportunity', 'The door is where young voters decide')
  addFooter(s2, pg)
  s2.addText('For many under-40 Floridians, a knock or a campus intercept is the first time anyone has personally invited them into civic life. The invitation lands — or dies — on trust.', {
    x: 0.6, y: 1.6, w: 12.1, h: 0.8, fontSize: 17, fontFace: FONT, color: P.pink, bold: true, lineSpacing: 24,
  })
  const why = [
    { t: 'Trust is the currency', d: 'Young voters aren’t opponents to out-argue. They’re weighing whether the person at the door — and the ask — are credible, safe, and worth their limited time. The skill that wins is listening, not rebuttal.' },
    { t: 'The canvasser is the invitation', d: 'Institutions can’t make this ask; a trusted human can. Every canvasser is the movement’s face at the exact moment a young voter decides. Preparation isn’t a nice-to-have — it’s the whole game.' },
    { t: 'Nobody has built this', d: 'Sales teams have had AI role-play gyms for years. Our market scan found no U.S. platform offering AI practice conversations for canvassers — and none that connects training to guidance at the real door.' },
  ]
  why.forEach((m, i) => {
    const x = 0.6 + i * 4.13
    sticker(s2, x, 2.75, 3.92, 3.6)
    s2.addShape('rect', { x: x + 0.02, y: 2.77, w: 3.88, h: 0.14, fill: { color: P.pink }, line: { width: 0 } })
    s2.addText(m.t, { x: x + 0.22, y: 3.05, w: 3.5, h: 0.65, fontSize: 16.5, fontFace: FONT, color: P.violet, bold: true, valign: 'top' })
    s2.addText(m.d, { x: x + 0.22, y: 3.75, w: 3.5, h: 2.45, fontSize: 12.5, fontFace: FONT, color: P.ink, lineSpacing: 18, valign: 'top' })
  })

  // ═════════════════════════ 3 · THE COIN ═════════════════════════
  const s3 = pptx.addSlide(); pg++
  addHeader(s3, 'The concept', 'Two sides of the same coin')
  addFooter(s3, pg)
  // coin halves
  const coinY = 2.0, coinD = 3.3
  const coins = [
    { x: 2.0, face: 'HEADS', name: 'The Practice Gym', d: 'Where canvassers train.\nAI voter personas, real\npushback, coached debriefs,\na 1–5 star score.' },
    { x: W - 2.0 - coinD, face: 'TAILS', name: 'The Field Companion', d: 'Where canvassers perform.\nVoter context, tailored talking\npoints, and research questions\nat every real door.' },
  ]
  coins.forEach(c => {
    // hard shadow circle + coin + inner ring
    s3.addShape('ellipse', { x: c.x + 0.09, y: coinY + 0.09, w: coinD, h: coinD, fill: { color: P.black }, line: { width: 0 } })
    s3.addShape('ellipse', { x: c.x, y: coinY, w: coinD, h: coinD, fill: { color: P.white }, line: { color: P.black, width: 2.5 } })
    s3.addShape('ellipse', { x: c.x + 0.18, y: coinY + 0.18, w: coinD - 0.36, h: coinD - 0.36, fill: { color: P.white }, line: { color: P.pink, width: 1.75, dashType: 'dash' } })
    s3.addText(c.face, { x: c.x, y: coinY + 0.58, w: coinD, h: 0.32, fontSize: 12, fontFace: FONT, color: P.pink, bold: true, align: 'center', charSpacing: 4 })
    s3.addText(c.name, { x: c.x + 0.25, y: coinY + 0.94, w: coinD - 0.5, h: 0.62, fontSize: 17.5, fontFace: FONT, color: P.violet, bold: true, align: 'center' })
    s3.addText(c.d, { x: c.x + 0.34, y: coinY + 1.56, w: coinD - 0.68, h: 1.5, fontSize: 10.8, fontFace: FONT, color: P.ink, align: 'center', lineSpacing: 14.5, valign: 'top' })
  })
  shadowText(s3, '=', { x: W / 2 - 0.5, y: coinY + coinD / 2 - 0.55, w: 1.0, h: 1.0, fontSize: 54, fontFace: FONT, color: P.pink, bold: true, align: 'center', valign: 'middle' })
  // the metal bar
  sticker(s3, 1.7, 5.85, W - 3.4, 0.95, P.black)
  s3.addText(
    [
      { text: 'MINTED FROM ONE METAL:  ', options: { color: P.pink, bold: true, charSpacing: 2 } },
      { text: 'a single persona-intelligence layer. The voter types a canvasser practices against in the gym are the same intelligence that guides them at a real door.', options: { color: P.offwhite } },
    ],
    { x: 1.95, y: 5.85, w: W - 3.9, h: 0.95, fontSize: 12.5, fontFace: FONT, valign: 'middle', lineSpacing: 17 }
  )

  // ═════════════════════════ 4 · THE LOOP (FLOW CHART) ═════════════════════════
  const s4 = pptx.addSlide(); pg++
  addHeader(s4, 'How the two sides work together', 'One loop: train → deploy → capture → sharpen')
  addFooter(s4, pg)
  const nodeW = 2.62, nodeH = 1.5
  const topY = 2.05, botY = 4.75
  const xs = [0.9, 4.1, 7.3, 10.0]
  const nodes: { x: number; y: number; k: string; t: string; d: string }[] = [
    { x: xs[0], y: topY, k: '1 · BUILD', t: 'Personas', d: 'Voter archetypes shaped with your organizers — the people your teams actually meet.' },
    { x: xs[1], y: topY, k: '2 · TRAIN', t: 'Practice Gym', d: 'Canvassers rehearse real conversations against the personas — and get coached.' },
    { x: xs[2], y: topY, k: '3 · SCORE', t: 'Door-Ready', d: 'A 1–5 star score tells organizers who’s ready and who needs another rep.' },
    { x: xs[3], y: botY, k: '4 · DEPLOY', t: 'Field Companion', d: 'At each door: voter context, tailored talking points, rotated research questions.' },
    { x: xs[2] - 0.55, y: botY, k: '5 · CAPTURE', t: 'Every Interaction', d: 'Outcomes, reactions, and answers logged in seconds — every conversation gets a receipt.' },
    { x: xs[1] - 0.55, y: botY, k: '6 · SHARPEN', t: 'Smarter Personas', d: 'Field data refines the personas — training gets more real every week.' },
  ]
  // connectors: 1→2→3, 3→4 (down-right), 4→5, 5→6, 6→1 (up-left)
  const arrow = (x: number, y: number, w: number, h: number, rot = 0, type: 'rightArrow' | 'downArrow' | 'leftArrow' | 'upArrow' = 'rightArrow') => {
    s4.addShape(type, { x, y, w, h, fill: { color: P.pink }, line: { color: P.black, width: 1.25 }, rotate: rot })
  }
  arrow(xs[0] + nodeW + 0.06, topY + nodeH / 2 - 0.16, 0.52, 0.32)
  arrow(xs[1] + nodeW + 0.06, topY + nodeH / 2 - 0.16, 0.52, 0.32)
  // 3 → 4: down arrow on the right edge
  arrow(xs[3] + nodeW / 2 + 0.6, topY + nodeH + 0.12, 0.32, 0.95, 0, 'downArrow')
  // node 3 to that column: right arrow from node 3
  arrow(xs[2] + nodeW + 0.06, topY + nodeH / 2 - 0.16, 0.52, 0.32)
  // 4 → 5, 5 → 6 (leftArrows on bottom row)
  arrow(xs[3] - 0.62, botY + nodeH / 2 - 0.16, 0.52, 0.32, 0, 'leftArrow')
  arrow(xs[2] - 0.55 - 0.62, botY + nodeH / 2 - 0.16, 0.52, 0.32, 0, 'leftArrow')
  // 6 → 1: left out of node 6, then a tall up arrow back into node 1
  arrow(xs[1] - 0.55 - 0.6, botY + nodeH / 2 - 0.16, 0.5, 0.32, 0, 'leftArrow')
  arrow(2.2, topY + nodeH + 0.12, 0.32, botY + nodeH / 2 - (topY + nodeH + 0.12) - 0.05, 0, 'upArrow')
  nodes.forEach(n => {
    sticker(s4, n.x, n.y, nodeW, nodeH)
    s4.addText(n.k, { x: n.x + 0.14, y: n.y + 0.08, w: nodeW - 0.28, h: 0.26, fontSize: 9, fontFace: FONT, color: P.pink, bold: true, charSpacing: 2 })
    s4.addText(n.t, { x: n.x + 0.14, y: n.y + 0.3, w: nodeW - 0.28, h: 0.32, fontSize: 14.5, fontFace: FONT, color: P.violet, bold: true })
    s4.addText(n.d, { x: n.x + 0.14, y: n.y + 0.64, w: nodeW - 0.28, h: 0.82, fontSize: 9.3, fontFace: FONT, color: P.ink, lineSpacing: 12.5, valign: 'top' })
  })
  s4.addText('Training transfers to the field. The field teaches the training. Neither works this well alone.', {
    x: 0.6, y: 6.55, w: 12.1, h: 0.4, fontSize: 13.5, fontFace: FONT, color: P.lavenderPale, italic: true, align: 'center',
  })

  // ═════════════════════════ 5 · SIDE ONE: GYM ═════════════════════════
  const s5 = pptx.addSlide(); pg++
  addHeader(s5, 'Side one — the practice gym', 'Hundreds of practice doors before the first real one')
  addFooter(s5, pg)
  const steps = [
    { k: 'STEP 1', t: 'Draw a persona', d: 'The system randomly deals an AI voter persona — first-timers, skeptics, the checked-out — each carrying the real reasons young people hold back: no time, no trust, worry about what being visible could cost them.' },
    { k: 'STEP 2', t: 'Have the conversation', d: 'A live back-and-forth chat, door-knock or intercept mode. The persona deflects, challenges, warms up, or shuts down — the way real people do.' },
    { k: 'STEP 3', t: 'Get the debrief', d: 'The system reviews the whole conversation: turn-by-turn guidance on what could have been said differently, language to change at each moment, and overall coaching.' },
    { k: 'STEP 4', t: 'Earn the score', d: 'A 1–5 star score built on what actually moves young voters — listen before you pitch, keep it local and concrete, lower the risk, leave a small real next step.' },
  ]
  steps.forEach((st, i) => {
    const x = 0.6 + (i % 2) * 6.25, y = 1.75 + Math.floor(i / 2) * 2.5
    sticker(s5, x, y, 5.95, 2.25)
    chip(s5, x + 0.22, y + 0.2, 0.95, st.k, P.violet, P.white, 9)
    s5.addText(st.t, { x: x + 1.3, y: y + 0.14, w: 4.4, h: 0.45, fontSize: 17, fontFace: FONT, color: P.violet, bold: true, valign: 'middle' })
    s5.addText(st.d, { x: x + 0.24, y: y + 0.68, w: 5.5, h: 1.45, fontSize: 11.5, fontFace: FONT, color: P.ink, lineSpacing: 16, valign: 'top' })
  })

  // ═════════════════════════ 6 · DEBRIEF + SCORE ═════════════════════════
  const s6 = pptx.addSlide(); pg++
  addHeader(s6, 'Side one — the practice gym', 'The debrief: coaching, not criticism')
  addFooter(s6, pg)
  // left: illustrative debrief card
  sticker(s6, 0.6, 1.75, 6.4, 4.9)
  s6.addText('ILLUSTRATIVE DEBRIEF', { x: 0.9, y: 1.95, w: 5.8, h: 0.3, fontSize: 10, fontFace: FONT, color: P.gray, bold: true, charSpacing: 3 })
  s6.addText(
    [
      { text: '★★★★', options: { color: P.pink, fontSize: 26, bold: true } },
      { text: '★', options: { color: 'D8D8D8', fontSize: 26, bold: true } },
      { text: '   4 of 5 — door-ready', options: { color: P.violet, fontSize: 16, bold: true } },
    ],
    { x: 0.9, y: 2.28, w: 5.8, h: 0.55, fontFace: FONT, valign: 'middle' }
  )
  s6.addText('“Strong open and real listening. At turn 3, when she said ‘politicians are all the same,’ you jumped back to the script — next time validate first: ‘Honestly? A lot of people our age feel exactly that way. Can I tell you why I still do this?’”', {
    x: 0.9, y: 3.0, w: 5.8, h: 1.55, fontSize: 13, fontFace: FONT, color: P.ink, italic: true, lineSpacing: 19, valign: 'top',
  })
  s6.addShape('rect', { x: 0.9, y: 4.6, w: 5.8, h: 0.02, fill: { color: 'E2D7EE' }, line: { width: 0 } })
  s6.addText(
    [
      { text: 'Turn-by-turn: ', options: { bold: true, color: P.violet } },
      { text: 'what worked, what to say differently, and the exact language to change at each moment — plus overall coaching the canvasser can apply on the very next run.', options: { color: P.ink } },
    ],
    { x: 0.9, y: 4.75, w: 5.8, h: 1.7, fontSize: 12.5, fontFace: FONT, lineSpacing: 18, valign: 'top' }
  )
  // right: the four things stars measure
  shadowText(s6, 'What the stars measure', { x: 7.5, y: 1.8, w: 5.2, h: 0.4, fontSize: 16, fontFace: FONT, color: P.white, bold: true })
  const rubric = [
    { t: 'Listen before you pitch', d: 'Did the canvasser hear the person before reaching for the script?' },
    { t: 'Keep it local & concrete', d: 'Did the conversation stay close to daily life, where change feels real?' },
    { t: 'Lower the risk', d: 'Did they validate hesitation and make the ask feel safe and bounded?' },
    { t: 'Leave a real next step', d: 'Did the voter walk away with one small, specific, doable action?' },
  ]
  rubric.forEach((r, i) => {
    const y = 2.35 + i * 1.08
    sticker(s6, 7.5, y, 5.2, 0.92, P.lavenderPale)
    s6.addText(
      [
        { text: `${r.t}   `, options: { bold: true, color: P.violet } },
        { text: r.d, options: { color: P.violetDeep } },
      ],
      { x: 7.72, y, w: 4.8, h: 0.92, fontSize: 11.5, fontFace: FONT, valign: 'middle', lineSpacing: 15 }
    )
  })

  // ═════════════════════════ 7 · PERSONAS INTRO ═════════════════════════
  const s7 = pptx.addSlide(); pg++
  addHeader(s7, 'The persona cast', 'Six voters your canvassers will actually meet')
  addFooter(s7, pg)
  s7.addText('A rotating cast, built with your organizers.', { x: 0.6, y: 1.65, w: 12.1, h: 0.5, fontSize: 20, fontFace: FONT, color: P.pink, bold: true })
  s7.addText('These six starting archetypes are illustrative — grounded in current research on how Central Florida’s young voters decide whether to engage, then refined in a working session with your regional leads. Each persona carries a realistic life, a disposition at the door, an objection stack, and hidden “what wins me” triggers that drive the coaching. The gym deals them at random — with mood and setting varied — so no two practice doors feel the same.', {
    x: 0.6, y: 2.2, w: 12.1, h: 1.3, fontSize: 13.5, fontFace: FONT, color: P.offwhite, lineSpacing: 20,
  })
  const cast = [
    ['Jaylen, 19', 'The First-Timer', '“My vote doesn’t change anything.”'],
    ['Maria, 27', 'Stretched Thin', '“I care — I just don’t have room for it.”'],
    ['Devon, 24', 'The Risk Calculator', '“I’ve seen what being visible costs.”'],
    ['Priya, 22', 'The Skeptical Senior', '“They’re all funded by the same people.”'],
    ['Tyler, 26', 'The Not-Political', '“I stay out of all that drama.”'],
    ['Grace, 30', 'The Quiet Helper', '“I help my neighbors. Politics isn’t helping.”'],
  ]
  cast.forEach((c, i) => {
    const x = 0.6 + (i % 3) * 4.13, y = 3.75 + Math.floor(i / 3) * 1.5
    sticker(s7, x, y, 3.92, 1.28)
    s7.addText(
      [
        { text: `${c[0]}  ·  `, options: { bold: true, color: P.violet } },
        { text: c[1], options: { bold: true, color: P.pink } },
      ],
      { x: x + 0.2, y: y + 0.12, w: 3.55, h: 0.34, fontSize: 13, fontFace: FONT }
    )
    s7.addText(c[2], { x: x + 0.2, y: y + 0.5, w: 3.55, h: 0.65, fontSize: 11.5, fontFace: FONT, color: P.ink, italic: true, lineSpacing: 15, valign: 'top' })
  })
  s7.addText('Personas are illustrative composites for proposal purposes — final cast is built jointly with People Power for Florida.', {
    x: 0.6, y: 6.85, w: 12.1, h: 0.3, fontSize: 9.5, fontFace: FONT, color: P.lavenderPale, italic: true,
  })

  // ═════════════════════════ 8-10 · PERSONA CARDS (2 per slide) ═════════════════════════
  interface Persona {
    name: string; tag: string; life: string; quote: string
    holdback: string[]; wins: string[]
  }
  const personas: Persona[] = [
    {
      name: 'Jaylen, 19', tag: 'The First-Timer',
      life: 'Community-college student in Kissimmee, works part-time retail, lives with his mom. Registered at the DMV; has never voted. Gets everything from YouTube and TikTok.',
      quote: '“Nothing changes either way, bro. Why would my one vote matter?”',
      holdback: ['Believes outcomes are pre-decided; nobody he trusts has ever told him otherwise', 'No one has ever personally asked him to participate', 'Doesn’t know the mechanics — registration status, where, when, how'],
      wins: ['Local proof: one concrete thing that changed nearby because people showed up', 'A tiny, specific first step he can do on his phone right now', 'Being talked with, not lectured — respect over civics homework'],
    },
    {
      name: 'Maria, 27', tag: 'Stretched Thin',
      life: 'Two jobs (medical billing + weekend serving) in Pine Hills, one kid, rents. Genuinely warm, answers the door holding her phone with 4% battery. Cares deeply about schools and rent.',
      quote: '“I care, I really do — but if it costs me time or money, that’s too big an ask.”',
      holdback: ['Zero slack: every ask competes with rent, shifts, and her kid', 'Exhausted — burnout, not apathy', 'Past experiences of giving effort and getting nothing back'],
      wins: ['Micro-asks that fit inside her life (two minutes, from her couch)', 'Anything that visibly helps her kid’s school or her block', 'Respecting her time out loud — it signals this org is different'],
    },
    {
      name: 'Devon, 24', tag: 'The Risk Calculator',
      life: 'Warehouse team lead near Sanford, supports his younger brother. Careful online — watched a coworker get fired over a political post. Follows everything, posts nothing.',
      quote: '“I’ve got a job and people counting on me. I can’t be out here visible like that.”',
      holdback: ['Real fear of professional consequences and harassment', 'Won’t be publicly identified with causes — full stop', 'Distrusts how organizations handle his information'],
      wins: ['Private, low-exposure ways to participate that are still real', 'Clear expectations: exactly what’s asked, what’s public, what’s not', 'Proof the org protects its people'],
    },
    {
      name: 'Priya, 22', tag: 'The Skeptical Senior',
      life: 'UCF senior, political science minor — the best-informed person on this list. Reads everything, trusts almost none of it. Registered NPA on purpose.',
      quote: '“Both parties are funded by the same people. Why would I pick a team?”',
      holdback: ['Deep institutional distrust — parties, orgs, media alike', 'Sees most civic asks as someone else’s agenda wearing a costume', 'Burned out on performative politics and constant conflict'],
      wins: ['Radical transparency: who’s behind this, who funds it, what happens next', 'Non-partisan, issue-first framing she can verify herself', 'Receipts — evidence of what past participation actually produced'],
    },
    {
      name: 'Tyler, 26', tag: 'The Not-Political',
      life: 'Line cook in Brevard, easygoing, conflict-averse. Loves his neighborhood, helps friends move, feeds people. The word “politics” makes him physically step back.',
      quote: '“I don’t do politics, man. Too much drama. I just live my life.”',
      holdback: ['Politics = fighting; he opts out of fights', 'Worries engagement will strain family and friendships', 'Nothing about “civic life” has ever felt like it was for him'],
      wins: ['Care-first framing: helping neighbors is already what he does', 'Community language, not political language', 'Low-drama, tangible actions with people he already likes'],
    },
    {
      name: 'Grace, 30', tag: 'The Quiet Helper',
      life: 'Young mom in suburban Polk County, active in her church, organizes meal trains. Conservative-leaning, votes most years. Suspicious of “activists” but endlessly generous.',
      quote: '“We take care of people at church. I’m not looking to march about it.”',
      holdback: ['Wary the org has a hidden partisan agenda', 'Public confrontation conflicts with how she serves', 'Assumes her views make her unwelcome in “these groups”'],
      wins: ['Service framing: this is neighbors caring for neighbors', 'Schools, families, and local safety — her issues, on her terms', 'Explicit welcome across politics — belonging before belief'],
    },
  ]
  for (let sIdx = 0; sIdx < 3; sIdx++) {
    const sp = pptx.addSlide(); pg++
    addHeader(sp, `The persona cast — ${sIdx + 1} of 3`, 'Illustrative starting personas')
    addFooter(sp, pg)
    for (let j = 0; j < 2; j++) {
      const p = personas[sIdx * 2 + j]
      const x = 0.6 + j * 6.25
      sticker(sp, x, 1.7, 5.95, 5.15)
      sp.addShape('rect', { x: x + 0.02, y: 1.72, w: 5.91, h: 0.14, fill: { color: P.pink }, line: { width: 0 } })
      sp.addText(
        [
          { text: `${p.name}  `, options: { bold: true, color: P.violet, fontSize: 18 } },
          { text: p.tag, options: { bold: true, color: P.pink, fontSize: 14 } },
        ],
        { x: x + 0.25, y: 1.98, w: 5.45, h: 0.42, fontFace: FONT, valign: 'middle' }
      )
      sp.addText(p.life, { x: x + 0.25, y: 2.44, w: 5.45, h: 0.92, fontSize: 10.6, fontFace: FONT, color: P.gray, lineSpacing: 14, valign: 'top' })
      sp.addShape('roundRect', { x: x + 0.25, y: 3.36, w: 5.45, h: 0.62, fill: { color: P.pinkTint }, line: { color: P.black, width: 1 }, rectRadius: 0.06 })
      sp.addText(p.quote, { x: x + 0.4, y: 3.36, w: 5.2, h: 0.62, fontSize: 11.5, fontFace: FONT, color: P.ink, italic: true, bold: true, valign: 'middle', lineSpacing: 14 })
      sp.addText('WHY THEY HOLD BACK', { x: x + 0.25, y: 4.12, w: 5.45, h: 0.26, fontSize: 9, fontFace: FONT, color: P.gray, bold: true, charSpacing: 2 })
      sp.addText(p.holdback.map(t => ({ text: t, options: { bullet: { characterCode: '2022', indent: 8 } } })), {
        x: x + 0.3, y: 4.38, w: 5.4, h: 1.0, fontSize: 10.2, fontFace: FONT, color: P.ink, lineSpacing: 13.5, valign: 'top',
      })
      sp.addText('WHAT WINS THEM', { x: x + 0.25, y: 5.42, w: 5.45, h: 0.26, fontSize: 9, fontFace: FONT, color: P.pink, bold: true, charSpacing: 2 })
      sp.addText(p.wins.map(t => ({ text: t, options: { bullet: { characterCode: '2022', indent: 8 } } })), {
        x: x + 0.3, y: 5.68, w: 5.4, h: 1.05, fontSize: 10.2, fontFace: FONT, color: P.violet, lineSpacing: 13.5, valign: 'top', bold: true,
      })
    }
  }

  // ═════════════════════════ 11 · SIDE TWO: FIELD ═════════════════════════
  const s11 = pptx.addSlide(); pg++
  addHeader(s11, 'Side two — the field companion', 'The same intelligence, live at every real door')
  addFooter(s11, pg)
  const field = [
    { k: 'CONTEXT', t: 'Who’s at this door', d: 'Quick, glanceable context on the person the canvasser hopes to reach — so the conversation starts warm, not cold.' },
    { k: 'GUIDANCE', t: 'What to lead with', d: 'Suggested talking points matched to that voter’s profile — generated by the same persona intelligence the canvasser trained against in the gym.' },
    { k: 'RESEARCH', t: 'The questions that matter', d: 'One or two research questions drawn from your central question bank — and only the ones that haven’t yet hit their completion target.' },
    { k: 'CAPTURE', t: 'Log the interaction', d: 'Outcome, reaction, and notes logged in seconds before the next door — so your team can circle back and show people what came of it. Every conversation gets a receipt.' },
  ]
  field.forEach((f, i) => {
    const x = 0.6 + (i % 2) * 6.25, y = 1.75 + Math.floor(i / 2) * 2.5
    sticker(s11, x, y, 5.95, 2.25)
    chip(s11, x + 0.22, y + 0.2, 1.2, f.k, P.violet, P.white, 9)
    s11.addText(f.t, { x: x + 1.55, y: y + 0.14, w: 4.2, h: 0.45, fontSize: 17, fontFace: FONT, color: P.violet, bold: true, valign: 'middle' })
    s11.addText(f.d, { x: x + 0.24, y: y + 0.68, w: 5.5, h: 1.45, fontSize: 11.5, fontFace: FONT, color: P.ink, lineSpacing: 16, valign: 'top' })
  })

  // ═════════════════════════ 12 · RESEARCH ENGINE ═════════════════════════
  const s12 = pptx.addSlide(); pg++
  addHeader(s12, 'Side two — the field companion', 'The central research engine')
  addFooter(s12, pg)
  s12.addText('Your canvass quietly becomes a continuous, statewide study of Florida’s under-40 electorate — while it registers and mobilizes.', {
    x: 0.6, y: 1.6, w: 12.1, h: 0.75, fontSize: 17, fontFace: FONT, color: P.pink, bold: true, lineSpacing: 23,
  })
  const engine = [
    { t: '1 · HQ writes the questions once', d: 'A centralized research question bank — what your team wants to learn from the under-40 electorate this cycle — with a target completion rate for each question.' },
    { t: '2 · The system rotates them', d: 'Every door and intercept gets 1–2 open questions, drawn only from those still short of target. Questions that hit their target retire automatically; under-sampled ones surface more often.' },
    { t: '3 · Answers become insight', d: 'Responses flow into the same AI text-analytics engine we run for consumer brands — themes, sentiment, and shifts across regions and weeks, ready for your leadership and your funders.' },
  ]
  engine.forEach((e, i) => {
    const y = 2.55 + i * 1.42
    sticker(s12, 0.6, y, 12.1, 1.22, i === 2 ? P.lavenderPale : P.white)
    s12.addText(e.t, { x: 0.85, y: y + 0.1, w: 3.9, h: 1.0, fontSize: 14, fontFace: FONT, color: P.violet, bold: true, valign: 'middle', lineSpacing: 17 })
    s12.addText(e.d, { x: 4.9, y: y + 0.1, w: 7.6, h: 1.0, fontSize: 11.8, fontFace: FONT, color: P.ink, valign: 'middle', lineSpacing: 16 })
  })

  // ═════════════════════════ 13 · LANDSCAPE ═════════════════════════
  const s13 = pptx.addSlide(); pg++
  addHeader(s13, 'The landscape', 'Who else does this? Nobody — all of it.')
  addFooter(s13, pg)
  const rows: [string, string, string][] = [
    ['Walk-list apps', 'MiniVAN, Ecanvasser, Reach', 'Lists, static scripts, and data capture. No AI guidance, no training, no question rotation.'],
    ['i360 Walk', 'GOP data ecosystem', 'Per-voter dynamic scripts — but rules-based, and it lives in the other side’s data ecosystem.'],
    ['New AI entrants', 'CanvaCORE, Qomon', 'Early AI cues from demographics or CRM history. No practice gym, no research engine.'],
    ['Sales-training AI', 'Hyperbound, Second Nature', 'Mature AI role-play for sales teams — none of them touch civic or political canvassing.'],
  ]
  // header row
  sticker(s13, 0.6, 1.7, 12.1, 0.55, P.black)
  s13.addText('THE LANDSCAPE', { x: 0.85, y: 1.7, w: 3.6, h: 0.55, fontSize: 11, fontFace: FONT, color: P.white, bold: true, valign: 'middle', charSpacing: 2 })
  s13.addText('WHAT THEY OFFER', { x: 4.7, y: 1.7, w: 7.5, h: 0.55, fontSize: 11, fontFace: FONT, color: P.white, bold: true, valign: 'middle', charSpacing: 2 })
  rows.forEach((r, i) => {
    const y = 2.42 + i * 0.88
    sticker(s13, 0.6, y, 12.1, 0.72)
    s13.addText(
      [
        { text: `${r[0]}\n`, options: { bold: true, color: P.violet, fontSize: 11.5 } },
        { text: r[1], options: { color: P.gray, fontSize: 9.5 } },
      ],
      { x: 0.85, y, w: 3.6, h: 0.72, fontFace: FONT, valign: 'middle', lineSpacing: 13 }
    )
    s13.addText(r[2], { x: 4.7, y, w: 7.7, h: 0.72, fontSize: 11, fontFace: FONT, color: P.ink, valign: 'middle', lineSpacing: 14 })
  })
  const yUs = 2.42 + 4 * 0.88
  sticker(s13, 0.6, yUs, 12.1, 0.95, P.pinkTint)
  s13.addText(
    [
      { text: 'THIS PROPOSAL   ', options: { bold: true, color: P.pink, fontSize: 11.5, charSpacing: 1 } },
      { text: 'The only system that trains canvassers and coaches them in the field from one persona-intelligence layer — with research questions that rotate toward completion targets.', options: { bold: true, color: P.violet, fontSize: 11.5 } },
    ],
    { x: 0.85, y: yUs, w: 11.6, h: 0.95, fontFace: FONT, valign: 'middle', lineSpacing: 16 }
  )

  // ═════════════════════════ 14 · THE PILOT ═════════════════════════
  const s14 = pptx.addSlide(); pg++
  addHeader(s14, 'The proposal', 'Start with one region. Prove it. Then scale.')
  addFooter(s14, pg)
  const phases = [
    { k: 'PHASE 1', t: 'Build the cast & open the gym', d: 'A working session with your organizers turns field experience into the persona cast. One fellows cohort trains in the gym — every canvasser practices, gets debriefed, and earns scores before their next turf.', foot: '~4–6 weeks · one cohort' },
    { k: 'PHASE 2', t: 'Take it to the doors', d: 'The field companion goes live with the same cohort — voter context, talking points, and your first centrally-managed research questions with completion targets. Every interaction captured.', foot: 'one region · same cohort' },
    { k: 'PHASE 3', t: 'Close the loop & scale', d: 'Field data sharpens the personas; training measurably transfers. Roll out across regions — Central, North, South — with the research engine reporting statewide.', foot: 'statewide' },
  ]
  phases.forEach((ph, i) => {
    const x = 0.6 + i * 4.13
    sticker(s14, x, 1.8, 3.92, 3.8)
    chip(s14, x + 0.22, 2.0, 1.05, ph.k, P.pink, P.black, 9)
    s14.addText(ph.t, { x: x + 0.22, y: 2.45, w: 3.5, h: 0.75, fontSize: 15.5, fontFace: FONT, color: P.violet, bold: true, valign: 'top', lineSpacing: 19 })
    s14.addText(ph.d, { x: x + 0.22, y: 3.2, w: 3.5, h: 1.85, fontSize: 11, fontFace: FONT, color: P.ink, lineSpacing: 15.5, valign: 'top' })
    s14.addText(ph.foot, { x: x + 0.22, y: 5.1, w: 3.5, h: 0.35, fontSize: 10, fontFace: FONT, color: P.pink, bold: true })
    if (i < 2) s14.addShape('rightArrow', { x: x + 3.96, y: 3.5, w: 0.34, h: 0.42, fill: { color: P.pink }, line: { color: P.black, width: 1.25 } })
  })
  sticker(s14, 0.6, 5.95, 12.1, 0.85, P.black)
  s14.addText(
    [
      { text: 'WHAT WE NEED FROM YOU:  ', options: { color: P.pink, bold: true, charSpacing: 1 } },
      { text: 'your organizers’ field wisdom for the persona workshop, one cohort willing to train, and your first ten research questions. We bring everything else.', options: { color: P.offwhite } },
    ],
    { x: 0.85, y: 5.95, w: 11.6, h: 0.85, fontSize: 12.5, fontFace: FONT, valign: 'middle', lineSpacing: 17 }
  )

  // ═════════════════════════ 15 · WHY US / NEXT STEPS ═════════════════════════
  const s15 = pptx.addSlide(); pg++
  violetBg(s15)
  addFooter(s15, pg)
  shadowText(s15, 'Why us — and what happens next', { x: 0.8, y: 0.7, w: 11.7, h: 0.8, fontSize: 34, fontFace: FONT, color: P.white, bold: true })
  sticker(s15, 0.8, 1.8, 5.85, 4.3)
  s15.addText('WHO WE ARE', { x: 1.05, y: 2.0, w: 5.3, h: 0.3, fontSize: 10, fontFace: FONT, color: P.pink, bold: true, charSpacing: 3 })
  s15.addText(
    [
      { text: 'Datanautix ', options: { bold: true, color: P.violet } },
      { text: 'is a consumer insights company with more than a decade in AI-enabled text analytics — turning what people actually say, in their own words, into what organizations do.\n\n', options: { color: P.ink } },
      { text: 'Our conversational agents run real customer- and constituent-facing conversations in production today. For one national seafood restaurant brand, our conversational approach drew ', options: { color: P.ink } },
      { text: '3.5× the response rate', options: { bold: true, color: P.violet } },
      { text: ' of their traditional survey.\n\nThat research DNA is what makes the personas feel real, keeps the questions rigorous, and makes the data captured at the door worth trusting.', options: { color: P.ink } },
    ],
    { x: 1.05, y: 2.35, w: 5.35, h: 3.6, fontSize: 12.5, fontFace: FONT, lineSpacing: 18, valign: 'top' }
  )
  sticker(s15, 7.05, 1.8, 5.5, 4.3, P.lavenderPale)
  s15.addText('NEXT STEPS', { x: 7.3, y: 2.0, w: 5.0, h: 0.3, fontSize: 10, fontFace: FONT, color: P.violet, bold: true, charSpacing: 3 })
  const nexts = [
    'A 45-minute working call: your organizers’ read on the persona cast',
    'We stand up a live demo — chat with a persona, see a real debrief',
    'Agree the pilot cohort, region, and first research questions',
    'Phase 1 begins',
  ]
  nexts.forEach((n, i) => {
    const y = 2.5 + i * 0.85
    s15.addShape('ellipse', { x: 7.35, y: y + 0.05, w: 0.42, h: 0.42, fill: { color: P.violet }, line: { color: P.black, width: 1.25 } })
    s15.addText(String(i + 1), { x: 7.35, y: y + 0.05, w: 0.42, h: 0.42, fontSize: 13, fontFace: FONT, color: P.white, bold: true, align: 'center', valign: 'middle' })
    s15.addText(n, { x: 7.95, y, w: 4.5, h: 0.6, fontSize: 12, fontFace: FONT, color: P.violetDeep, valign: 'middle', lineSpacing: 15, bold: i === 3 })
  })
  s15.addShape('rect', { x: 0, y: 6.55, w: W, h: 0.5, fill: { color: P.pink }, line: { color: P.black, width: 1.5 } })
  s15.addText('REGISTER   〰   TAKE ACTION   〰   BUILD POWER', { x: 0, y: 6.55, w: W, h: 0.5, fontSize: 13, fontFace: FONT, color: P.black, bold: true, align: 'center', valign: 'middle', charSpacing: 3 })

  const out = join(homedir(), 'Downloads', 'People_Power_FL_Canvasser_AI_Proposal.pptx')
  await pptx.writeFile({ fileName: out })
  console.log('Wrote', out)
}

main().catch((e) => { console.error(e); process.exit(1) })
