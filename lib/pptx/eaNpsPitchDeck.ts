// lib/pptx/eaNpsPitchDeck.ts
// "Beyond the Score" — a Sentimetrx proposal to run EA's summer NPS program as a
// specific-emotion engine. The thesis: EA's NPS already asks "why did you score
// us that way," then collapses the answer to valence. We keep EA's exact question
// set and turn the "why" turn into a regret-vs-disappointment classifier.
//
// The strategic spine (owner-directed): EA holds the exclusive NFL + college
// football licenses, so the category is captive. That inverts the usual playbook —
// REGRET (self-blame, "I should've bought MVP+") has nowhere to churn to, so it
// converts to next-cycle subscription demand; DISAPPOINTMENT (external blame,
// "EA's early access broke," "the value isn't there") is the recoverable cohort
// EA can act on now (mid-cycle Bundle→MVP+ conversion, service recovery, proactive
// renewal nudges).
//
// Science anchor: Zeelenberg & Pieters — regret and disappointment share valence
// but drive different behavior; jointly explained 87.7% of dissatisfaction across
// 900+ customers, predicting behavior over and above the satisfaction score.
//
// Grounding: real public-forum VoC on MVP Bundle vs MVP+ (CFB 27 / Madden 27
// cycle, MVP+ window now closed). The one conversational example is labelled
// ILLUSTRATIVE per the no-fabricated-data rule.
//
// Sentimetrx-forward branding, Datanautix as delivery company (author/footer) —
// matches lib/pptx/eaMembershipDeck.ts for the same EA audience. Exported builder
// so it can be pixel-QC'd via scripts/oneoff/_ea_nps_pitch_deck_qc.ts without the
// auth'd route.

import type PptxGenJS from 'pptxgenjs'

// Brand palette — mirrors eaMembershipDeck (Sentimetrx-forward accents) plus two
// emotion colors: regret = violet (internal), disappointment = amber (external).
const DN = {
  teal: '0F7173',
  navy: '0D2B45',
  navyMid: '0F3A54',
  gold: 'E8B84B',
  orange: 'E85A1A',
  ink: '0D2B45',
  slate: '8FA3AE',
  slateLight: 'E8EDEF',
  slateCard: 'F4F7F8',
  white: 'FFFFFF',
  sarinaBlue: '00B4D8',
  hermesOrange: 'E8632A',
  regret: '7C3AED', // violet — internal attribution / self-blame
  regretTint: 'EDE9FE',
  disappoint: 'D97706', // amber — external attribution
  disappointTint: 'FEF3C7',
  green: '16A34A',
  red: 'DC2626',
}

const W = 13.33
const H = 7.5

function addHeader(slide: PptxGenJS.Slide, title: string, sub?: string) {
  slide.addShape('rect', { x: 0, y: 0, w: W, h: 1.0, fill: { color: DN.navy } })
  slide.addText(title, { x: 0.6, y: sub ? 0.1 : 0.15, w: 9.5, h: sub ? 0.56 : 0.7, fontSize: 27, fontFace: 'Arial', color: DN.white, bold: true, valign: sub ? 'bottom' : 'middle' })
  if (sub) slide.addText(sub, { x: 0.62, y: 0.62, w: 9.6, h: 0.34, fontSize: 12.5, fontFace: 'Arial', color: DN.sarinaBlue })
  slide.addText('Sentimetrx', { x: W - 3.0, y: 0.15, w: 2.7, h: 0.7, fontSize: 16, fontFace: 'Arial', color: DN.sarinaBlue, bold: true, align: 'right', valign: 'middle' })
  slide.addShape('rect', { x: 0, y: 1.0, w: W, h: 0.04, fill: { color: DN.sarinaBlue } })
}

function addFooter(slide: PptxGenJS.Slide, pageNum: number) {
  slide.addText('sentimetrx.ai  ·  powered by Datanautix', { x: 0.5, y: H - 0.4, w: 6, h: 0.3, fontSize: 9, color: DN.slate, fontFace: 'Arial' })
  slide.addText('Prepared for EA  ·  Confidential', { x: W - 4.5, y: H - 0.4, w: 3.2, h: 0.3, fontSize: 9, color: DN.slate, fontFace: 'Arial', align: 'right' })
  slide.addText(`${pageNum}`, { x: W - 1.0, y: H - 0.4, w: 0.5, h: 0.3, fontSize: 9, color: DN.slate, fontFace: 'Arial', align: 'right' })
}

export function buildEaNpsPitchDeck(pptx: PptxGenJS) {
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Datanautix'
  pptx.company = 'Datanautix'
  pptx.title = 'Beyond the Score — Specific-Emotion NPS for EA SPORTS'
  let pg = 0

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 1: TITLE
  // ═══════════════════════════════════════════════════════════════
  const s1 = pptx.addSlide()
  pg++
  s1.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.navy } })
  s1.addShape('rect', { x: 0, y: 0, w: 0.18, h: H, fill: { color: DN.sarinaBlue } })
  s1.addText('Beyond the Score', { x: 0.8, y: 1.55, w: 11.5, h: 1.2, fontSize: 50, fontFace: 'Arial', color: DN.white, bold: true })
  s1.addText('Your NPS survey already asks players why. We turn that answer into a signal that predicts what they’ll do next.', {
    x: 0.8, y: 2.85, w: 11.2, h: 1.0, fontSize: 20, fontFace: 'Arial', color: DN.sarinaBlue, lineSpacing: 28,
  })
  s1.addText('A Sentimetrx proposal — prepared for EA SPORTS\nSummer NPS program  ·  MVP Bundle & MVP+ Membership  ·  College Football 27 & Madden NFL 27', {
    x: 0.8, y: 4.25, w: 11.5, h: 0.9, fontSize: 15, fontFace: 'Arial', color: DN.slate, lineSpacing: 24,
  })
  s1.addText('Sentimetrx', { x: 0.8, y: 6.0, w: 5, h: 0.5, fontSize: 18, fontFace: 'Arial', color: DN.white, bold: true })
  s1.addText('sentimetrx.ai  ·  powered by Datanautix', { x: 0.8, y: 6.5, w: 8, h: 0.4, fontSize: 12, fontFace: 'Arial', color: DN.gold })
  s1.addShape('rect', { x: 0, y: H - 0.06, w: W, h: 0.06, fill: { color: DN.sarinaBlue } })
  s1.addNotes(
`Open confident, not salesy. This is a pointed proposal, not a capability tour — the whole deck argues one idea: EA already collects the emotion that predicts behavior, and today throws it away at the valence step.

"You run an NPS survey every summer — a score, then 'why did you score us that way,' then a few more questions. That 'why' is the most valuable field in the survey, and almost every NPS program in the world reduces it to positive-or-negative. We don't. We read it for the specific emotion — and for a captive franchise like yours, that emotion is worth real money."

Frame the timing: CFB 27 / Madden 27 just shipped, MVP+ just sold out, feelings are fresh. Perfect moment to measure.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 2: THE MOMENT
  // ═══════════════════════════════════════════════════════════════
  const s2 = pptx.addSlide()
  pg++
  addHeader(s2, 'The Moment')
  addFooter(s2, pg)
  s2.addText('This summer you’ll survey a player base that has already sorted itself.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.6, fontSize: 22, fontFace: 'Arial', color: DN.hermesOrange, bold: true,
  })
  s2.addText('Two offerings, sold at the same price. The subscription window is now closed — so every respondent is already tagged Bundle or Member, and a large share of Bundle buyers know the identically-priced option was the better deal. The choice is locked; the feelings are fresh.', {
    x: 0.6, y: 1.95, w: 12.1, h: 0.9, fontSize: 14, fontFace: 'Arial', color: DN.ink, lineSpacing: 21,
  })
  const moment = [
    { t: 'Same price, different bet', d: 'MVP Bundle: own both games + 3-day early access. MVP+: access (not ownership) + 7-day early access, beta, and 12 monthly Ultimate Team packs — on a ~$150/yr auto-renew.', c: DN.sarinaBlue },
    { t: 'The window just closed', d: 'Players can no longer buy MVP+ for this cycle. The decision is irreversible for a year — exactly when regret and disappointment run hottest.', c: DN.gold },
    { t: 'Perfectly timed', d: 'Early access opened days ago. An NPS wave right now catches first reactions at peak emotional salience — the best data you’ll get all year.', c: DN.hermesOrange },
  ]
  moment.forEach((m, i) => {
    const x = 0.6 + i * 4.13
    s2.addShape('rect', { x, y: 3.15, w: 3.9, h: 3.35, fill: { color: DN.slateCard }, rectRadius: 0.1 })
    s2.addShape('rect', { x, y: 3.15, w: 3.9, h: 0.12, fill: { color: m.c } })
    s2.addText(m.t, { x: x + 0.22, y: 3.4, w: 3.5, h: 0.7, fontSize: 16, fontFace: 'Arial', color: DN.navy, bold: true, valign: 'top' })
    s2.addText(m.d, { x: x + 0.22, y: 4.15, w: 3.5, h: 2.2, fontSize: 12.5, fontFace: 'Arial', color: DN.ink, lineSpacing: 18, valign: 'top' })
  })
  s2.addNotes(
`Set the table. The point: this is not a generic satisfaction study — it is a rare natural experiment. Two products, same price, one just went off-sale, and the population self-selected into two groups whose feelings about that choice are the whole game.

Say the price plainly (~$150/yr) — it's public. Don't over-claim exact figures; the structure is the point: locked choice + fresh emotion = the highest-signal window of the year.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 3: THE BLIND SPOT
  // ═══════════════════════════════════════════════════════════════
  const s3 = pptx.addSlide()
  pg++
  addHeader(s3, 'The Blind Spot')
  addFooter(s3, pg)
  s3.addText('Your survey asks exactly the right question — then throws the answer away.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.6, fontSize: 22, fontFace: 'Arial', color: DN.hermesOrange, bold: true,
  })
  s3.addText('NPS score → “Why did you score us that way?” → open text → rolled up to one axis: positive vs. negative. Two players hand you the same 6 and the same “negative” sentiment — and behave in opposite directions.', {
    x: 0.6, y: 1.9, w: 12.1, h: 0.75, fontSize: 14, fontFace: 'Arial', color: DN.ink, lineSpacing: 21,
  })
  // Two identical-looking 6s, opposite fates
  const twins = [
    { verdict: 'Blames himself', quote: '“Honestly the game’s fine. I just wish I’d gotten MVP+ instead of the Bundle.”', label: 'REGRET → will subscribe next cycle', c: DN.regret, tint: DN.regretTint },
    { verdict: 'Blames EA', quote: '“Paid for MVP+ for the early access and it didn’t even work at launch.”', label: 'DISAPPOINTMENT → recoverable now', c: DN.disappoint, tint: DN.disappointTint },
  ]
  twins.forEach((t, i) => {
    const x = 0.6 + i * 6.25
    s3.addShape('rect', { x, y: 2.85, w: 6.05, h: 3.5, fill: { color: t.tint }, rectRadius: 0.12 })
    s3.addShape('rect', { x, y: 2.85, w: 6.05, h: 0.12, fill: { color: t.c } })
    s3.addText('6 / 10', { x: x + 0.3, y: 3.1, w: 2.0, h: 0.75, fontSize: 34, fontFace: 'Arial', color: DN.navy, bold: true })
    s3.addText('Sentiment: negative', { x: x + 2.4, y: 3.2, w: 3.4, h: 0.5, fontSize: 12, fontFace: 'Arial', color: DN.slate, italic: true, valign: 'middle' })
    s3.addText(t.verdict, { x: x + 2.4, y: 3.6, w: 3.4, h: 0.4, fontSize: 13, fontFace: 'Arial', color: t.c, bold: true, valign: 'middle' })
    s3.addText(t.quote, { x: x + 0.3, y: 4.15, w: 5.45, h: 1.15, fontSize: 14, fontFace: 'Arial', color: DN.ink, italic: true, lineSpacing: 20, valign: 'top' })
    s3.addShape('rect', { x: x + 0.3, y: 5.55, w: 5.45, h: 0.6, fill: { color: t.c }, rectRadius: 0.06 })
    s3.addText(t.label, { x: x + 0.3, y: 5.55, w: 5.45, h: 0.6, fontSize: 12.5, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
  })
  s3.addText('The number tells you they’re unhappy. Only the emotion tells you what they’ll do about it.', {
    x: 0.6, y: 6.5, w: 12.1, h: 0.45, fontSize: 15, fontFace: 'Arial', color: DN.navy, bold: true, italic: true, align: 'center',
  })
  s3.addNotes(
`The whole thesis on one slide. Walk it slowly.

"Same score. Same 'negative' sentiment tag. But one player blames himself — he'll be back, and he'll pay more. The other blames you — and you can fix it. A valence rollup literally cannot tell these two apart, so it treats them the same. That's the money you're leaving on the table."

Both quotes here are illustrative composites of real forum language (next slides show the real ones). Don't present them as EA's data yet.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 4: THE SCIENCE
  // ═══════════════════════════════════════════════════════════════
  const s4 = pptx.addSlide()
  pg++
  addHeader(s4, 'The Science: Two Emotions, One Score')
  addFooter(s4, pg)
  s4.addText('Regret and disappointment feel equally negative — and drive opposite behavior.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.5, fontSize: 20, fontFace: 'Arial', color: DN.hermesOrange, bold: true,
  })
  const emo = [
    {
      name: 'REGRET', sub: 'Internal attribution — self-blame', c: DN.regret, tint: DN.regretTint,
      cue: '“I should have… I wish I’d chosen… my mistake.”',
      rows: ['Blames their own decision, not the product', 'Ruminates, then acts to correct the choice', 'Durable, sticky behavior change'],
    },
    {
      name: 'DISAPPOINTMENT', sub: 'External attribution — blames the product/brand', c: DN.disappoint, tint: DN.disappointTint,
      cue: '“Fell short… not what was promised… didn’t work.”',
      rows: ['Blames EA, marketing, or circumstance', 'Recalibrates expectations, recovers faster', 'Reversible with the right corrective action'],
    },
  ]
  emo.forEach((e, i) => {
    const x = 0.6 + i * 6.25
    s4.addShape('rect', { x, y: 1.9, w: 6.05, h: 3.35, fill: { color: e.tint }, rectRadius: 0.12 })
    s4.addShape('rect', { x, y: 1.9, w: 6.05, h: 0.75, fill: { color: e.c }, rectRadius: 0.12 })
    s4.addShape('rect', { x, y: 2.4, w: 6.05, h: 0.25, fill: { color: e.c } })
    s4.addText(e.name, { x: x + 0.25, y: 1.95, w: 5.55, h: 0.4, fontSize: 19, fontFace: 'Arial', color: DN.white, bold: true, valign: 'middle' })
    s4.addText(e.sub, { x: x + 0.25, y: 2.32, w: 5.55, h: 0.3, fontSize: 12, fontFace: 'Arial', color: DN.white })
    s4.addText(e.cue, { x: x + 0.25, y: 2.8, w: 5.55, h: 0.5, fontSize: 13.5, fontFace: 'Arial', color: e.c, bold: true, italic: true, valign: 'middle' })
    e.rows.forEach((r, j) => {
      const y = 3.4 + j * 0.58
      s4.addText('•', { x: x + 0.25, y, w: 0.25, h: 0.5, fontSize: 14, fontFace: 'Arial', color: e.c, bold: true, valign: 'top' })
      s4.addText(r, { x: x + 0.5, y, w: 5.3, h: 0.55, fontSize: 13, fontFace: 'Arial', color: DN.ink, valign: 'top', lineSpacing: 16 })
    })
  })
  s4.addShape('rect', { x: 0.6, y: 5.5, w: 12.1, h: 1.15, fill: { color: DN.navy }, rectRadius: 0.1 })
  s4.addText('Peer-reviewed, not vibes', { x: 0.85, y: 5.62, w: 11.6, h: 0.35, fontSize: 13, fontFace: 'Arial', color: DN.gold, bold: true })
  s4.addText('Across 900+ customers, regret and disappointment jointly explained 87.7% of dissatisfaction — and predicted complaining, switching, and word-of-mouth over and above the satisfaction score itself. Valence alone left that signal on the floor.  (Zeelenberg & Pieters, Journal of Business Research)', {
    x: 0.85, y: 5.96, w: 11.6, h: 0.62, fontSize: 12, fontFace: 'Arial', color: DN.white, lineSpacing: 16, valign: 'top',
  })
  s4.addNotes(
`Establish that this is a measured, published phenomenon, not a clever metaphor.

Same valence, different behavior — that's the finding. Regret is internal (self-blame on the choice), disappointment is external (the product/brand let me down). Read the credibility band verbatim: 87.7% of dissatisfaction variance across 900+ customers, and — critically — the emotions predicted behavior OVER AND ABOVE the satisfaction score. That last clause is the sales argument: your NPS number is genuinely leaving predictive signal unused.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 5: THE MONOPOLY TWIST (the killer insight)
  // ═══════════════════════════════════════════════════════════════
  const s5 = pptx.addSlide()
  pg++
  s5.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.navy } })
  s5.addShape('rect', { x: 0, y: 0, w: 0.18, h: H, fill: { color: DN.sarinaBlue } })
  s5.addText('Why This Is Different for EA', { x: 0.7, y: 0.45, w: 12, h: 0.6, fontSize: 28, fontFace: 'Arial', color: DN.white, bold: true })
  s5.addText('You hold the exclusive NFL and college football licenses. That rewrites the physics of dissatisfaction.', {
    x: 0.7, y: 1.15, w: 12, h: 0.7, fontSize: 17, fontFace: 'Arial', color: DN.sarinaBlue, lineSpacing: 23,
  })
  s5.addText('In an open market, regret means churn — the customer blames their choice and defects to a rival. There is no rival football sim to defect to. The emotion has nowhere to exit — so the standard playbook flips:', {
    x: 0.7, y: 2.0, w: 12, h: 0.75, fontSize: 14, fontFace: 'Arial', color: DN.slate, lineSpacing: 20,
  })
  const flip = [
    { name: 'REGRET → LATENT DEMAND', c: DN.regret, body: 'A Bundle buyer who wishes he’d gotten MVP+ can’t switch games — so his self-blame converts into next-cycle subscription intent. This is your highest-value output: a pre-qualified MVP+ conversion list, in players’ own words. Not a churn risk to contain — revenue you haven’t booked yet.' },
    { name: 'DISAPPOINTMENT → RECOVERABLE', c: DN.disappoint, body: 'External blame is the cohort you can act on now — a broken early-access launch, a value mismatch, a surprise renewal. Because they blame the delivery and not their own choice, the right corrective action wins them back before the feeling hardens into brand damage.' },
  ]
  flip.forEach((f, i) => {
    const x = 0.7 + i * 6.15
    s5.addShape('rect', { x, y: 2.95, w: 5.9, h: 2.95, fill: { color: DN.navyMid }, rectRadius: 0.12 })
    s5.addShape('rect', { x, y: 2.95, w: 5.9, h: 0.65, fill: { color: f.c }, rectRadius: 0.12 })
    s5.addShape('rect', { x, y: 3.4, w: 5.9, h: 0.2, fill: { color: f.c } })
    s5.addText(f.name, { x: x + 0.25, y: 2.95, w: 5.4, h: 0.65, fontSize: 16, fontFace: 'Arial', color: DN.white, bold: true, valign: 'middle' })
    s5.addText(f.body, { x: x + 0.28, y: 3.8, w: 5.35, h: 1.95, fontSize: 13, fontFace: 'Arial', color: DN.white, lineSpacing: 19, valign: 'top' })
  })
  s5.addShape('rect', { x: 0.7, y: 6.15, w: 11.95, h: 0.78, fill: { color: DN.sarinaBlue }, rectRadius: 0.08 })
  s5.addText('In a captive category, regret isn’t a loss to prevent. It’s the most reliable buy-signal you have.', {
    x: 0.7, y: 6.15, w: 11.95, h: 0.78, fontSize: 16, fontFace: 'Arial', color: DN.navy, bold: true, align: 'center', valign: 'middle',
  })
  s5.addNotes(
`This is the slide that wins the meeting — the insight only EA gets to benefit from. Deliver it as strategy, not a jab.

"In most markets, regret is a churn signal — the person blames their choice and leaves. But there's no other NFL game, no other college football game. So a regretful Bundle buyer can't leave — his regret has nowhere to go but into next year's subscription. That's why, for you specifically, regret is not a risk to manage. It's a pre-qualified upsell list."

Then the other half: disappointment is external, so it's the recoverable cohort — the one you spend service dollars on. Land the punchline: in a captive category, regret is your best buy-signal.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 6: THE BEHAVIORAL MAP
  // ═══════════════════════════════════════════════════════════════
  const s6 = pptx.addSlide()
  pg++
  addHeader(s6, 'The Behavioral Map', 'What each emotion means — mapped to your two offerings')
  addFooter(s6, pg)
  // Table header
  const cols = [
    { x: 0.5, w: 2.55, label: 'Signal' },
    { x: 3.05, w: 3.35, label: 'What they say' },
    { x: 6.4, w: 3.15, label: 'What it means' },
    { x: 9.55, w: 3.28, label: 'The move for EA' },
  ]
  s6.addShape('rect', { x: 0.5, y: 1.35, w: 12.33, h: 0.5, fill: { color: DN.navy } })
  cols.forEach((c) => {
    s6.addText(c.label, { x: c.x + 0.1, y: 1.35, w: c.w - 0.15, h: 0.5, fontSize: 12, fontFace: 'Arial', color: DN.white, bold: true, valign: 'middle' })
  })
  const rows = [
    { sig: 'Regret — Bundle buyer', c: DN.regret, say: '“I should’ve gotten MVP+ — same price, more stuff.”', mean: 'Locked-in next-cycle subscriber', move: 'Pre-qualified MVP+ upsell list' },
    { sig: 'Disappointment — delivery', c: DN.disappoint, say: '“Paid for MVP+, didn’t get the early access.”', mean: 'Service-delivery failure', move: 'Comp + fix — cheapest save you’ll make' },
    { sig: 'Disappointment — value', c: DN.disappoint, say: '“Perks are all Ultimate Team; I only play Franchise.”', mean: 'Value mismatch by play mode', move: 'Roadmap lever: mode-specific perks' },
    { sig: 'Renewal dread', c: DN.gold, say: '“That $150 will hit my card and I’ll forget to cancel.”', mean: 'Future involuntary churn + chargeback', move: 'Proactive reminder = a trust win' },
  ]
  const rowH = 1.15
  rows.forEach((r, i) => {
    const y = 1.85 + i * rowH
    s6.addShape('rect', { x: 0.5, y, w: 12.33, h: rowH, fill: { color: i % 2 ? DN.white : DN.slateCard } })
    s6.addShape('rect', { x: 0.5, y, w: 0.1, h: rowH, fill: { color: r.c } })
    s6.addText(r.sig, { x: cols[0].x + 0.18, y, w: cols[0].w - 0.2, h: rowH, fontSize: 12.5, fontFace: 'Arial', color: r.c, bold: true, valign: 'middle', lineSpacing: 15 })
    s6.addText(r.say, { x: cols[1].x + 0.1, y, w: cols[1].w - 0.2, h: rowH, fontSize: 12, fontFace: 'Arial', color: DN.ink, italic: true, valign: 'middle', lineSpacing: 15 })
    s6.addText(r.mean, { x: cols[2].x + 0.1, y, w: cols[2].w - 0.2, h: rowH, fontSize: 12, fontFace: 'Arial', color: DN.navy, valign: 'middle', lineSpacing: 15 })
    s6.addText(r.move, { x: cols[3].x + 0.1, y, w: cols[3].w - 0.15, h: rowH, fontSize: 12, fontFace: 'Arial', color: DN.navy, bold: true, valign: 'middle', lineSpacing: 15 })
  })
  s6.addText('One classifier, four cohorts — each with a different owner and a different play. This is what a valence score can never give you.', {
    x: 0.5, y: 6.65, w: 12.33, h: 0.4, fontSize: 13, fontFace: 'Arial', color: DN.navy, italic: true, align: 'center',
  })
  s6.addNotes(
`The operational payoff of the theory. Walk the four rows — each is a distinct cohort a valence rollup would blend into one gray "detractors" bucket.

Row 1 is the revenue story (regret → upsell). Rows 2–3 are the service-recovery stories (two flavors of disappointment: a broken promise and a value mismatch). Row 4 is the one nobody measures — renewal dread — a leading indicator of involuntary churn and chargebacks you can pre-empt.

The quotes are representative of real public forum language (shown verbatim on the next slide).`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 7: WHAT PLAYERS ARE ALREADY SAYING (grounding)
  // ═══════════════════════════════════════════════════════════════
  const s7 = pptx.addSlide()
  pg++
  addHeader(s7, 'We Did the Homework')
  addFooter(s7, pg)
  s7.addText('These signals are already in the wild. Today they’re anecdotes. We make them a measured segment.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.55, fontSize: 18, fontFace: 'Arial', color: DN.hermesOrange, bold: true,
  })
  const voc = [
    { tag: 'REGRET SEED', c: DN.regret, q: '“If you’re buying the MVP bundle you might as well buy MVP+ — it’s the same price and you get the extras.”' },
    { tag: 'CONFUSION', c: DN.sarinaBlue, q: '“If you buy the subscription do you get the deluxe edition stuff PLUS the stuff from the subscription?”' },
    { tag: 'RENEWAL DREAD', c: DN.gold, q: '“They just want people to sign up and forget that a $150 charge is coming to the card on file.”' },
    { tag: 'DISAPPOINTMENT', c: DN.disappoint, q: 'An EA forum thread, verbatim title: “Purchased MVP+, but not receiving early access.”' },
  ]
  voc.forEach((v, i) => {
    const col = i % 2, row = Math.floor(i / 2)
    const x = 0.6 + col * 6.15
    const y = 1.95 + row * 1.85
    s7.addShape('rect', { x, y, w: 5.95, h: 1.65, fill: { color: DN.slateCard }, rectRadius: 0.1 })
    s7.addShape('rect', { x, y, w: 0.16, h: 1.65, fill: { color: v.c } })
    s7.addText(v.tag, { x: x + 0.32, y: y + 0.14, w: 5.5, h: 0.3, fontSize: 11, fontFace: 'Arial', color: v.c, bold: true, charSpacing: 1.5 })
    s7.addText(v.q, { x: x + 0.32, y: y + 0.48, w: 5.5, h: 1.05, fontSize: 12.5, fontFace: 'Arial', color: DN.ink, italic: true, lineSpacing: 17, valign: 'top' })
  })
  s7.addText('Public forum chatter, summer 2026 — unfiltered and unprompted. Anecdotes don’t scale; our survey turns every one of these into a tagged, countable, actionable cohort.', {
    x: 0.6, y: 5.75, w: 12.1, h: 0.7, fontSize: 13.5, fontFace: 'Arial', color: DN.navy, bold: true, align: 'center', lineSpacing: 18,
  })
  s7.addNotes(
`Credibility + grounding. These are REAL, verbatim quotes pulled from public EA/MUT forums this summer — say that. They map one-to-one onto the four cohorts from the previous slide, which proves the framework isn't theoretical: the emotions are already being expressed, loudly, for free.

The pitch: "You're already getting this feedback — scattered across Reddit and your own forums, where you can't count it or act on it. Put the same question inside your NPS survey and we turn the noise into a measured segment with a name and a play."`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 8: THE MECHANIC (conversational survey)
  // ═══════════════════════════════════════════════════════════════
  const s8 = pptx.addSlide()
  pg++
  addHeader(s8, 'How We Capture It')
  addFooter(s8, pg)
  s8.addText('We keep your exact NPS question set. We just make the “why” turn diagnostic.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.5, fontSize: 19, fontFace: 'Arial', color: DN.sarinaBlue, bold: true,
  })
  // illustrative badge
  s8.addShape('rect', { x: 0.6, y: 1.85, w: 5.4, h: 0.32, fill: { color: DN.disappointTint }, line: { color: DN.disappoint, width: 0.6 }, rectRadius: 0.05 })
  s8.addText('ILLUSTRATIVE EXAMPLE — the shape of the exchange, not EA data', {
    x: 0.7, y: 1.85, w: 5.3, h: 0.32, fontSize: 9.5, fontFace: 'Arial', color: 'B45309', bold: true, valign: 'middle',
  })
  // Left: static
  s8.addShape('rect', { x: 0.6, y: 2.35, w: 5.85, h: 3.75, fill: { color: 'FEF2F2' }, rectRadius: 0.1 })
  s8.addText('Static “why” box', { x: 0.6, y: 2.45, w: 5.85, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.red, bold: true, align: 'center' })
  s8.addText('NPS: 6/10\n\nWhy did you score us that way?\n“idk it’s fine, wish I’d done the other one”\n\n———\n\nWhat you can act on:\nOne detractor. Negative sentiment. Nothing you can route, name, or price.', {
    x: 0.9, y: 3.0, w: 5.3, h: 3.0, fontSize: 13, fontFace: 'Arial', color: DN.ink, lineSpacing: 21, valign: 'top',
  })
  // Right: conversation
  s8.addShape('rect', { x: 7.05, y: 2.35, w: 5.85, h: 3.75, fill: { color: 'F0FDF4' }, rectRadius: 0.1 })
  s8.addText('Sentimetrx conversation', { x: 7.05, y: 2.45, w: 5.85, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.green, bold: true, align: 'center' })
  s8.addText('NPS: 6/10\nAgent: What’s the one thing keeping that from a 9 or 10?\nPlayer: idk the game’s fine, I just wish I’d gotten MVP+\nAgent: If MVP+ had been one tap at checkout, would you have taken it?\nPlayer: 100% — the 7-day early access alone was worth it\n\n———\n\nTagged automatically:\n• REGRET · internal attribution\n• High MVP+ intent → Convert-me\n• Next-cycle subscriber, not a churn risk', {
    x: 7.3, y: 2.9, w: 5.35, h: 3.1, fontSize: 11.5, fontFace: 'Arial', color: DN.ink, lineSpacing: 16, valign: 'top',
  })
  s8.addText('Same survey length. No interviewer. Every response tagged: regret / disappointment / neutral + blame attribution + convert-vs-recover.', {
    x: 0.6, y: 6.25, w: 12.3, h: 0.5, fontSize: 14, fontFace: 'Arial', color: DN.sarinaBlue, bold: true, align: 'center', lineSpacing: 18,
  })
  s8.addNotes(
`The "how." Reassure first: we do NOT replace their survey. NPS question stays, their other questions stay. We swap only the dead open-text "why" for a branded conversational agent that asks one or two adaptive follow-ups to surface blame attribution.

Walk the right column — the agent probes, the player reveals internal attribution and high MVP+ intent, and it's auto-tagged into the Convert-me segment. Note out loud: illustrative dialogue, real drivers come from EA's players.

For a technical EA audience: one adaptive follow-up, ≤25 words, on-brand, 15 languages, ~$0.002/interaction. It's the same platform doing collection + classification, not a survey tool bolted to a text-analytics vendor.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 9: WHAT EA GETS OUT — THREE SEGMENTS
  // ═══════════════════════════════════════════════════════════════
  const s9 = pptx.addSlide()
  pg++
  addHeader(s9, 'What You Get Out')
  addFooter(s9, pg)
  s9.addText('Three action-ready segments — not a word cloud.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.5, fontSize: 21, fontFace: 'Arial', color: DN.sarinaBlue, bold: true,
  })
  const segs = [
    { name: 'CONVERT-ME', c: DN.regret, tint: DN.regretTint, from: 'From the regret cohort', body: 'Players who told us, in their own words, they’d have paid for MVP+. Your next-cycle conversion list — scored, named, and ready for the sales/lifecycle team.' },
    { name: 'RECOVER-ME', c: DN.disappoint, tint: DN.disappointTint, from: 'From the disappointment cohort', body: 'Delivery failures and value mismatches you can fix now — broken early access, mode-perk misfit. External blame means it’s reversible with the right touch.' },
    { name: 'WARN-ME', c: DN.teal, tint: 'E2F1F2', from: 'From the renewal-dread cohort', body: 'Players bracing for a surprise $150. Remind them before it hits — turn a chargeback and a bad review into a moment of trust and a saved renewal.' },
  ]
  segs.forEach((s, i) => {
    const x = 0.6 + i * 4.13
    s9.addShape('rect', { x, y: 1.95, w: 3.9, h: 3.65, fill: { color: s.tint }, rectRadius: 0.12 })
    s9.addShape('rect', { x, y: 1.95, w: 3.9, h: 0.7, fill: { color: s.c }, rectRadius: 0.12 })
    s9.addShape('rect', { x, y: 2.4, w: 3.9, h: 0.25, fill: { color: s.c } })
    s9.addText(s.name, { x: x + 0.2, y: 1.95, w: 3.5, h: 0.7, fontSize: 18, fontFace: 'Arial', color: DN.white, bold: true, valign: 'middle' })
    s9.addText(s.from, { x: x + 0.22, y: 2.8, w: 3.5, h: 0.35, fontSize: 12, fontFace: 'Arial', color: s.c, bold: true, italic: true })
    s9.addText(s.body, { x: x + 0.22, y: 3.25, w: 3.5, h: 2.2, fontSize: 12.5, fontFace: 'Arial', color: DN.ink, lineSpacing: 18, valign: 'top' })
  })
  s9.addShape('rect', { x: 0.6, y: 5.85, w: 12.1, h: 0.75, fill: { color: DN.navy }, rectRadius: 0.08 })
  s9.addText('Delivered as a live dashboard with the verbatim behind every number — cut by game, play mode, and platform.', {
    x: 0.6, y: 5.85, w: 12.1, h: 0.75, fontSize: 14, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle',
  })
  s9.addNotes(
`The deliverable, made concrete. Three named lists, each with a different owner inside EA:

CONVERT-ME → lifecycle / monetization team (the upsell list).
RECOVER-ME → CS / product ops (the fixes).
WARN-ME → retention / billing (the proactive save).

Close on the dashboard + verbatim + segmentation by game/mode/platform. The point vs. their status quo: today the "why" becomes a word cloud a PM admires; here it becomes three lists a team acts on this week.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 10: THE PLAYS THIS UNLOCKS (corrective actions)
  // ═══════════════════════════════════════════════════════════════
  const s10 = pptx.addSlide()
  pg++
  addHeader(s10, 'The Plays This Unlocks')
  addFooter(s10, pg)
  s10.addText('Disappointment is recoverable — if you know who to act on. Here’s the playbook.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.5, fontSize: 19, fontFace: 'Arial', color: DN.hermesOrange, bold: true,
  })
  const plays = [
    { t: 'Mid-cycle Bundle → MVP+ conversion', d: 'Offer regretful Bundle buyers the delta upgrade before the window psychology hardens. Turn regret into revenue this cycle, not just next.', c: DN.regret },
    { t: 'Targeted service recovery', d: 'Comp packs and a fix for the “didn’t get my early access” cohort. External blame is the easiest, cheapest save there is — and it converts a detractor to a promoter.', c: DN.disappoint },
    { t: 'Mode-aware perk roadmap', d: 'Franchise and Dynasty players are telling you the Ultimate Team–heavy rewards miss them. A concrete roadmap lever, sourced directly from members.', c: DN.teal },
    { t: 'Proactive renewal nudge', d: 'Pre-empt the “$150 surprise” for the dread cohort. Protect the renewal and the brand at the same time — the opposite of a silent auto-charge.', c: DN.gold },
  ]
  plays.forEach((p, i) => {
    const col = i % 2, row = Math.floor(i / 2)
    const x = 0.6 + col * 6.15
    const y = 1.95 + row * 2.15
    s10.addShape('rect', { x, y, w: 5.95, h: 1.95, fill: { color: DN.slateCard }, rectRadius: 0.1 })
    s10.addShape('rect', { x, y, w: 0.16, h: 1.95, fill: { color: p.c } })
    s10.addText(p.t, { x: x + 0.32, y: y + 0.18, w: 5.5, h: 0.6, fontSize: 15.5, fontFace: 'Arial', color: DN.navy, bold: true, valign: 'top' })
    s10.addText(p.d, { x: x + 0.32, y: y + 0.78, w: 5.5, h: 1.05, fontSize: 12.5, fontFace: 'Arial', color: DN.ink, lineSpacing: 17, valign: 'top' })
  })
  s10.addText('Every play is triggered by a segment the survey hands you — measurement and action, on one platform.', {
    x: 0.6, y: 6.3, w: 12.1, h: 0.45, fontSize: 13.5, fontFace: 'Arial', color: DN.navy, italic: true, align: 'center',
  })
  s10.addNotes(
`This is the "so what" — the owner specifically wanted the corrective-action story front and center. The headline idea: regret you bank next cycle; disappointment you recover this cycle, IF you can identify the cohort. Our survey is what makes the cohort identifiable.

The Bundle→MVP+ mid-cycle conversion is the marquee play — it monetizes regret immediately instead of waiting a year. The other three are recovery plays on the disappointment/dread cohorts. Keep it as "here's what becomes possible," not a promise EA will run all four.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 11: PROOF
  // ═══════════════════════════════════════════════════════════════
  const s11 = pptx.addSlide()
  pg++
  addHeader(s11, 'Proof It Works')
  addFooter(s11, pg)
  s11.addText('The conversational method is already shipping — and validated against experts.', {
    x: 0.6, y: 1.2, w: 12.1, h: 0.45, fontSize: 16, fontFace: 'Arial', color: DN.sarinaBlue, bold: true,
  })
  const proofs = [
    { org: 'Harlem Globetrotters', stat: '10×', fs: 32, d: 'more responses than their prior survey — 15–20% in-venue response rate.' },
    { org: 'JW Marriott', stat: '10×', fs: 32, d: 'more responses than post-stay email, captured in the moment.' },
    { org: 'UCF Rosen College', stat: '<5%', fs: 32, d: 'of the expert team’s time, at near-identical analysis quality.' },
    { org: 'Orlando Resort', stat: 'Seconds', fs: 22, d: 'to a root cause that used to take weeks of manual reading.' },
  ]
  proofs.forEach((p, i) => {
    const col = i % 2, row = Math.floor(i / 2)
    const x = 0.6 + col * 6.15
    const y = 1.8 + row * 1.75
    s11.addShape('rect', { x, y, w: 5.95, h: 1.55, fill: { color: DN.slateCard }, rectRadius: 0.1 })
    s11.addText(p.stat, { x: x + 0.15, y: y + 0.1, w: 1.95, h: 1.35, fontSize: p.fs, fontFace: 'Arial', color: DN.sarinaBlue, bold: true, align: 'center', valign: 'middle' })
    s11.addText(p.org, { x: x + 2.15, y: y + 0.18, w: 3.6, h: 0.45, fontSize: 15, fontFace: 'Arial', color: DN.navy, bold: true })
    s11.addText(p.d, { x: x + 2.15, y: y + 0.6, w: 3.65, h: 0.85, fontSize: 12, fontFace: 'Arial', color: DN.ink, lineSpacing: 16, valign: 'top' })
  })
  s11.addShape('rect', { x: 0.6, y: 5.4, w: 12.1, h: 1.15, fill: { color: DN.navy }, rectRadius: 0.1 })
  s11.addText('“Ana performed almost as well as the team of professors and outperformed the graduate student — in less than 5% of the time.”', {
    x: 0.9, y: 5.5, w: 11.5, h: 0.7, fontSize: 13, fontFace: 'Arial', color: DN.white, italic: true, valign: 'middle',
  })
  s11.addText('— Dr. Fevzi Okumus, UCF Rosen College of Hospitality Management', {
    x: 0.9, y: 6.2, w: 11.5, h: 0.32, fontSize: 11, fontFace: 'Arial', color: DN.gold,
  })
  s11.addNotes(
`Credibility close before the ask. Two proof legs: (1) the conversational-capture method gets far more, richer responses than a static form — Globetrotters and JW Marriott ~10×; (2) the analysis matches an expert team at a fraction of the time — UCF Rosen. Read the Okumus quote verbatim.

Bridge line: "The method that gets 10× the responses and matches an expert team — pointed at the one field in your NPS survey that predicts behavior."`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 12: HOW WE'D RUN IT (pilot)
  // ═══════════════════════════════════════════════════════════════
  const s12 = pptx.addSlide()
  pg++
  addHeader(s12, 'Running It on This Summer’s Wave')
  addFooter(s12, pg)
  s12.addText('A paid pilot inside the survey you’re already sending.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.5, fontSize: 20, fontFace: 'Arial', color: DN.hermesOrange, bold: true,
  })
  const steps = [
    { n: '1', t: 'Keep your question set', d: 'Your NPS question and every follow-on stay exactly as they are. Zero disruption to the program you already run.' },
    { n: '2', t: 'Swap the dead “why” box', d: 'Our branded conversational agent runs the follow-up in your voice — one adaptive probe, 15 languages.' },
    { n: '3', t: 'Classify every response', d: 'Regret / disappointment / neutral, blame attribution, and a convert-vs-recover flag on each detractor.' },
    { n: '4', t: 'Deliver 3 segments in-window', d: 'Convert-me, Recover-me, Warn-me — with verbatim and a live dashboard, inside the survey period.' },
  ]
  steps.forEach((st, i) => {
    const y = 1.95 + i * 1.05
    s12.addShape('rect', { x: 0.6, y, w: 12.1, h: 0.9, fill: { color: DN.slateCard }, rectRadius: 0.08 })
    s12.addShape('ellipse', { x: 0.8, y: y + 0.19, w: 0.52, h: 0.52, fill: { color: DN.sarinaBlue } })
    s12.addText(st.n, { x: 0.8, y: y + 0.19, w: 0.52, h: 0.52, fontSize: 20, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
    s12.addText(st.t, { x: 1.55, y, w: 3.9, h: 0.9, fontSize: 15, fontFace: 'Arial', color: DN.navy, bold: true, valign: 'middle' })
    s12.addText(st.d, { x: 5.5, y, w: 7.05, h: 0.9, fontSize: 12.5, fontFace: 'Arial', color: DN.ink, valign: 'middle', lineSpacing: 16 })
  })
  s12.addShape('rect', { x: 0.6, y: 6.25, w: 12.1, h: 0.6, fill: { color: DN.navy }, rectRadius: 0.08 })
  s12.addText('Success metric agreed up front — e.g. the size and conversion rate of the Convert-me segment vs. your open-text baseline.', {
    x: 0.6, y: 6.25, w: 12.1, h: 0.6, fontSize: 13, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle',
  })
  s12.addNotes(
`Make it easy and low-risk to say yes. The frame: this is not a rip-and-replace — it's a swap of one field in a survey they already run, on this summer's wave, with a metric agreed in advance.

Land the risk-reversal: they keep their instrument, we prove the Convert-me segment against their own historical open-text baseline. If it doesn't beat the baseline, they've lost nothing structural.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 13: CLOSE
  // ═══════════════════════════════════════════════════════════════
  const s13 = pptx.addSlide()
  pg++
  s13.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.navy } })
  s13.addShape('rect', { x: 0, y: 0, w: 0.18, h: H, fill: { color: DN.sarinaBlue } })
  s13.addShape('rect', { x: 0, y: 4.55, w: W, h: 0.05, fill: { color: DN.gold } })
  s13.addText('Your survey already knows who regrets\nand who’s disappointed.', {
    x: 0.8, y: 1.5, w: 11.6, h: 1.6, fontSize: 38, fontFace: 'Arial', color: DN.white, bold: true, lineSpacing: 44,
  })
  s13.addText('Let us read it.', { x: 0.8, y: 3.35, w: 11.6, h: 0.8, fontSize: 30, fontFace: 'Arial', color: DN.gold, bold: true })
  s13.addText('Keep your questions. Change what the answers tell you — from a score you already have to three lists your teams can act on this week.', {
    x: 0.8, y: 4.75, w: 11.3, h: 0.9, fontSize: 16, fontFace: 'Arial', color: DN.slate, lineSpacing: 22,
  })
  s13.addShape('rect', { x: 0.8, y: 5.95, w: 11.7, h: 0.78, fill: { color: DN.sarinaBlue }, rectRadius: 0.08 })
  s13.addText('Let’s pilot the summer wave.   sentimetrx.ai  ·  sanjay@datanautix.com', {
    x: 0.8, y: 5.95, w: 11.7, h: 0.78, fontSize: 16, fontFace: 'Arial', color: DN.navy, bold: true, align: 'center', valign: 'middle',
  })
  s13.addText('Sentimetrx  ·  powered by Datanautix', { x: 0.8, y: 6.95, w: 8, h: 0.35, fontSize: 12, fontFace: 'Arial', color: DN.slate })
  s13.addNotes(
`Land it and stop. "Your survey already captures who regrets their choice and who's disappointed in you. Today you average it into a number. Let us read the emotion — and hand you the upsell list, the recovery list, and the save list."

CTA is a pilot on this summer's wave. Low friction — a slice of the NPS respondents. Contact set to sanjay@datanautix.com; swap if someone else fronts the EA relationship.`
  )

  return pptx
}
