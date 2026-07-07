// lib/pptx/eaNpsPitchDeck.ts
// "Beyond the Score" — a Sentimetrx proposal to add a specific-emotion layer to
// EA's summer NPS program. AUDIENCE: EA's internal customer-insights team (they
// own the NPS survey AND the analysis); Seann Graddy walks us in. POSTURE:
// augment, don't displace — "even better icing on the cake." The insights team
// stays the hero: they keep the instrument, the analysis, and the story to
// leadership; we hand them a sharper read of the "why" open-text they already
// collect.
//
// The thesis: EA's NPS already asks "why did you score us that way." A valence
// rollup sorts those answers positive/negative; a specific-emotion lens also
// sorts them by attribution (regret = self-blame, disappointment = external),
// which is the part that predicts behavior and points at the roadmap.
//
// Graddy-toned (forward, product/player-truth, roadmap — NOT churn/renewal
// economics): REGRET in a captive franchise = the membership already won them
// (product validation + a make-the-switch-easy lever); DISAPPOINTMENT = a fixable
// miss the team routes to product; CONFUSION = a clarity/comms opportunity.
//
// Science anchor: Zeelenberg & Pieters — regret and disappointment share valence
// but drive different behavior; jointly explained 87.7% of dissatisfaction across
// 900+ customers, adding signal over and above the satisfaction score.
//
// Grounding: real public-forum VoC on MVP Bundle vs MVP+ (CFB 27 / Madden 27
// cycle, MVP+ window now closed). The one conversational example is labelled
// ILLUSTRATIVE per the no-fabricated-data rule.
//
// Sentimetrx-forward branding, Datanautix as delivery company (author/footer) —
// matches lib/pptx/eaMembershipDeck.ts for the same EA audience. Exported builder
// so it can be pixel-QC'd via scripts/oneoff/_ea_nps_pitch_deck_qc.ts.

import type PptxGenJS from 'pptxgenjs'

// Brand palette — mirrors eaMembershipDeck (Sentimetrx-forward accents). The two
// emotion colors use the Datanautix brand pairing (no purple): regret = deep
// Sarina blue (internal), disappointment = Ana orange (external). EA’s gold
// (≈ #f7c64d) rides through as the accent — a subtle nod to EA SPORTS.
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
  regret: '0E63A8', // deep Sarina blue — internal attribution / self-blame
  regretTint: 'E1EFFB',
  disappoint: 'E85A1A', // Ana orange — external attribution
  disappointTint: 'FCEBD8',
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
  pptx.title = 'Beyond the Score — A Specific-Emotion Layer for EA’s NPS'
  let pg = 0

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 1: TITLE
  // ═══════════════════════════════════════════════════════════════
  const s1 = pptx.addSlide()
  pg++
  s1.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.navy } })
  s1.addShape('rect', { x: 0, y: 0, w: 0.18, h: H, fill: { color: DN.sarinaBlue } })
  s1.addText('Beyond the Score', { x: 0.8, y: 1.5, w: 11.5, h: 1.2, fontSize: 50, fontFace: 'Arial', color: DN.white, bold: true })
  s1.addText('A precision layer for your NPS program — reading the “why” for the specific emotion behind every score.', {
    x: 0.8, y: 2.8, w: 11.4, h: 1.0, fontSize: 20, fontFace: 'Arial', color: DN.sarinaBlue, lineSpacing: 28,
  })
  s1.addText('A Sentimetrx proposal — for the EA SPORTS customer-insights team\nSummer NPS program  ·  MVP Bundle & MVP+ Membership  ·  College Football 27 & Madden NFL 27', {
    x: 0.8, y: 4.2, w: 11.5, h: 0.9, fontSize: 15, fontFace: 'Arial', color: DN.slate, lineSpacing: 24,
  })
  s1.addText('Sentimetrx', { x: 0.8, y: 6.0, w: 5, h: 0.5, fontSize: 18, fontFace: 'Arial', color: DN.white, bold: true })
  s1.addText('sentimetrx.ai  ·  powered by Datanautix', { x: 0.8, y: 6.5, w: 8, h: 0.4, fontSize: 12, fontFace: 'Arial', color: DN.gold })
  s1.addShape('rect', { x: 0, y: H - 0.06, w: W, h: 0.06, fill: { color: DN.sarinaBlue } })
  s1.addNotes(
`Warm and collegial — this is a room of insights peers, and Graddy walked us in. Open by respecting their work, not pitching over it.

"You already run a strong NPS program — the score, the 'why,' the read-out to Graddy and the studios. We're not here to change any of that. We're here to add one layer: reading that 'why' for the specific emotion behind it — because that's the part that tells you what a player will do next, and where the roadmap is."

Frame the whole deck as icing on a cake they already bake well.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 2: THE MOMENT
  // ═══════════════════════════════════════════════════════════════
  const s2 = pptx.addSlide()
  pg++
  addHeader(s2, 'The Moment')
  addFooter(s2, pg)
  s2.addText('This summer’s wave lands on a player base that has already sorted itself.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.6, fontSize: 22, fontFace: 'Arial', color: DN.hermesOrange, bold: true,
  })
  s2.addText('Two offerings, sold at the same price. The subscription window has closed — so every respondent is already a Bundle owner or a Member, and their feelings about that choice are fresh. It’s a rare natural experiment sitting inside your own survey.', {
    x: 0.6, y: 1.95, w: 12.1, h: 0.9, fontSize: 14, fontFace: 'Arial', color: DN.ink, lineSpacing: 21,
  })
  const moment = [
    { t: 'Same price, different bet', d: 'MVP Bundle: own both games + 3-day early access. MVP+: access + 7-day early access, beta, and 12 monthly Ultimate Team packs — on a ~$150/yr membership.', c: DN.sarinaBlue },
    { t: 'The window just closed', d: 'MVP+ is off-sale for this cycle. The choice is settled for a year — exactly when the emotion behind it is most legible in a survey answer.', c: DN.gold },
    { t: 'Perfectly timed', d: 'Early access opened days ago. A wave right now catches first reactions at peak salience — the richest “why” your program will collect all year.', c: DN.hermesOrange },
  ]
  moment.forEach((m, i) => {
    const x = 0.6 + i * 4.13
    s2.addShape('rect', { x, y: 3.15, w: 3.9, h: 3.35, fill: { color: DN.slateCard }, rectRadius: 0.1 })
    s2.addShape('rect', { x, y: 3.15, w: 3.9, h: 0.12, fill: { color: m.c } })
    s2.addText(m.t, { x: x + 0.22, y: 3.4, w: 3.5, h: 0.7, fontSize: 16, fontFace: 'Arial', color: DN.navy, bold: true, valign: 'top' })
    s2.addText(m.d, { x: x + 0.22, y: 4.15, w: 3.5, h: 2.2, fontSize: 12.5, fontFace: 'Arial', color: DN.ink, lineSpacing: 18, valign: 'top' })
  })
  s2.addNotes(
`Set the table as a shared observation, not a lecture. The point they'll appreciate: this isn't a generic satisfaction wave — it's a natural experiment their instrument is perfectly placed to read. Two products, same price, one just went off-sale, population self-sorted, feelings fresh.

Say the price plainly (~$150/yr) — it's public. The structure is the point.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 3: THE SECOND SIGNAL
  // ═══════════════════════════════════════════════════════════════
  const s3 = pptx.addSlide()
  pg++
  addHeader(s3, 'The Second Signal')
  addFooter(s3, pg)
  s3.addText('Inside every “why” there are two signals. Most programs read only one.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.6, fontSize: 22, fontFace: 'Arial', color: DN.hermesOrange, bold: true,
  })
  s3.addText('Your team already reads these open-ends. A valence lens sorts them positive vs. negative. An emotion lens also sorts them by attribution — who the player blames — and that’s the read that predicts what they do next.', {
    x: 0.6, y: 1.9, w: 12.1, h: 0.75, fontSize: 14, fontFace: 'Arial', color: DN.ink, lineSpacing: 21,
  })
  // Two identical-looking 6s, different meaning
  const twins = [
    { verdict: 'Blames his own choice', quote: '“Honestly the game’s fine. I just wish I’d gotten MVP+ instead of the Bundle.”', label: 'REGRET → the membership already won him', c: DN.regret, tint: DN.regretTint },
    { verdict: 'Blames the delivery', quote: '“Paid for MVP+ for the early access and it didn’t even work at launch.”', label: 'DISAPPOINTMENT → a fixable miss', c: DN.disappoint, tint: DN.disappointTint },
  ]
  twins.forEach((t, i) => {
    const x = 0.6 + i * 6.25
    s3.addShape('rect', { x, y: 2.85, w: 6.05, h: 3.5, fill: { color: t.tint }, rectRadius: 0.12 })
    s3.addShape('rect', { x, y: 2.85, w: 6.05, h: 0.12, fill: { color: t.c } })
    s3.addText('6 / 10', { x: x + 0.3, y: 3.1, w: 2.0, h: 0.75, fontSize: 34, fontFace: 'Arial', color: DN.navy, bold: true })
    s3.addText('Same score. Same sentiment.', { x: x + 2.4, y: 3.2, w: 3.4, h: 0.5, fontSize: 11.5, fontFace: 'Arial', color: DN.slate, italic: true, valign: 'middle' })
    s3.addText(t.verdict, { x: x + 2.4, y: 3.6, w: 3.4, h: 0.4, fontSize: 13, fontFace: 'Arial', color: t.c, bold: true, valign: 'middle' })
    s3.addText(t.quote, { x: x + 0.3, y: 4.15, w: 5.45, h: 1.15, fontSize: 14, fontFace: 'Arial', color: DN.ink, italic: true, lineSpacing: 20, valign: 'top' })
    s3.addShape('rect', { x: x + 0.3, y: 5.55, w: 5.45, h: 0.6, fill: { color: t.c }, rectRadius: 0.06 })
    s3.addText(t.label, { x: x + 0.3, y: 5.55, w: 5.45, h: 0.6, fontSize: 12, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
  })
  s3.addText('The score tells you they’re unhappy. The emotion tells you which one is a product win in disguise.', {
    x: 0.6, y: 6.5, w: 12.1, h: 0.45, fontSize: 15, fontFace: 'Arial', color: DN.navy, bold: true, italic: true, align: 'center',
  })
  s3.addNotes(
`Respect their craft — they KNOW the open-ends are rich. The added idea: a second lens. Valence sorts good/bad; attribution sorts self-blame vs. external-blame, and that's the behavior-predictive part.

"Same 6, same negative tag. But one player blames his own choice — that's regret, and for you it's almost good news. The other blames the launch — that's disappointment, and it's a fixable miss. Reading the emotion tells your team which is which."

Quotes are illustrative composites of real forum language (the real verbatims are two slides on).`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 4: THE SCIENCE
  // ═══════════════════════════════════════════════════════════════
  const s4 = pptx.addSlide()
  pg++
  addHeader(s4, 'The Science: Two Emotions, One Score')
  addFooter(s4, pg)
  s4.addText('Regret and disappointment feel equally negative — and point in opposite directions.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.5, fontSize: 20, fontFace: 'Arial', color: DN.hermesOrange, bold: true,
  })
  const emo = [
    {
      name: 'REGRET', sub: 'Internal attribution — self-blame', c: DN.regret, tint: DN.regretTint,
      cue: '“I should have… I wish I’d chosen… my mistake.”',
      rows: ['Blames their own decision, not the product', 'Signals the value prop actually landed', 'The membership won them — they just mistimed it'],
    },
    {
      name: 'DISAPPOINTMENT', sub: 'External attribution — the product/brand missed', c: DN.disappoint, tint: DN.disappointTint,
      cue: '“Fell short… not what was promised… didn’t work.”',
      rows: ['Blames a launch, a perk, or a message', 'Points at something specific to improve', 'Fixable — recovers with the right response'],
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
  s4.addText('Across 900+ customers, regret and disappointment jointly explained 87.7% of dissatisfaction — and predicted complaining, switching, and word-of-mouth over and above the satisfaction score itself. The emotion adds signal a valence read can’t reach.  (Zeelenberg & Pieters, Journal of Business Research)', {
    x: 0.85, y: 5.96, w: 11.6, h: 0.62, fontSize: 12, fontFace: 'Arial', color: DN.white, lineSpacing: 16, valign: 'top',
  })
  s4.addNotes(
`This is the credible core an insights team will respect — lead with the rigor. Same valence, different behavior is the published finding. Read the band verbatim: 87.7% of dissatisfaction variance across 900+ customers, emotions predicting behavior OVER AND ABOVE the score.

Frame it as a tool for their kit, not a critique: "the emotion adds signal a valence read can't reach" — additive, not corrective.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 5: WHY THIS IS DIFFERENT FOR EA (product-toned)
  // ═══════════════════════════════════════════════════════════════
  const s5 = pptx.addSlide()
  pg++
  s5.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.navy } })
  s5.addShape('rect', { x: 0, y: 0, w: 0.18, h: H, fill: { color: DN.sarinaBlue } })
  s5.addText('Why This Matters More for EA', { x: 0.7, y: 0.45, w: 12, h: 0.6, fontSize: 28, fontFace: 'Arial', color: DN.white, bold: true })
  s5.addText('You hold the exclusive football licenses. In a category players can’t leave, the emotion behind the score reads differently.', {
    x: 0.7, y: 1.15, w: 12, h: 0.7, fontSize: 17, fontFace: 'Arial', color: DN.sarinaBlue, lineSpacing: 23,
  })
  s5.addText('In an open market, regret means a customer defects to a rival. There’s no rival football sim — so regret isn’t a churn signal here. It’s a read on how players feel about a choice they’re keeping:', {
    x: 0.7, y: 2.0, w: 12, h: 0.75, fontSize: 14, fontFace: 'Arial', color: DN.slate, lineSpacing: 20,
  })
  const flip = [
    { name: 'REGRET → THE MEMBERSHIP ALREADY WON THEM', c: DN.regret, body: 'A Bundle buyer who wishes he’d gotten MVP+ isn’t going anywhere — he’s telling you the membership is worth having and he wishes he’d acted. That’s product validation for the roadmap, plus a clear, player-friendly lever: make the switch effortless.' },
    { name: 'DISAPPOINTMENT → A FIXABLE MISS', c: DN.disappoint, body: 'External blame points at something in the launch, a perk, or the messaging — not the player’s choice. Named in players’ own words, it’s a precise, routable signal your team can hand straight to the studio and product owners.' },
  ]
  flip.forEach((f, i) => {
    const x = 0.7 + i * 6.15
    s5.addShape('rect', { x, y: 2.95, w: 5.9, h: 2.95, fill: { color: DN.navyMid }, rectRadius: 0.12 })
    s5.addShape('rect', { x, y: 2.95, w: 5.9, h: 0.85, fill: { color: f.c }, rectRadius: 0.12 })
    s5.addShape('rect', { x, y: 3.6, w: 5.9, h: 0.2, fill: { color: f.c } })
    s5.addText(f.name, { x: x + 0.25, y: 2.95, w: 5.4, h: 0.85, fontSize: 14.5, fontFace: 'Arial', color: DN.white, bold: true, valign: 'middle' })
    s5.addText(f.body, { x: x + 0.28, y: 3.95, w: 5.35, h: 1.8, fontSize: 13, fontFace: 'Arial', color: DN.white, lineSpacing: 19, valign: 'top' })
  })
  s5.addShape('rect', { x: 0.7, y: 6.15, w: 11.95, h: 0.78, fill: { color: DN.sarinaBlue }, rectRadius: 0.08 })
  s5.addText('In a franchise players stay in, the specific emotion isn’t a churn metric — it’s where the roadmap lives.', {
    x: 0.7, y: 6.15, w: 11.95, h: 0.78, fontSize: 16, fontFace: 'Arial', color: DN.navy, bold: true, align: 'center', valign: 'middle',
  })
  s5.addNotes(
`The insight that makes the room lean in — deliver it as a shared analytical point, never as revenue-extraction. This is Graddy's world: player truth and roadmap, not renewal economics.

"Because there's no other NFL or college football game, a regretful player can't leave. So his regret isn't a churn risk — it's the strongest possible evidence your membership is worth having. He's telling you it landed; he just wishes he'd acted. That's confidence for the roadmap, and it points at an easy, player-friendly fix — let him switch."

Land it forward: in a franchise players stay in, the emotion is where the roadmap lives.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 6: ICING ON THE CAKE — positioning (weave-in, not displace)
  // ═══════════════════════════════════════════════════════════════
  const s6 = pptx.addSlide()
  pg++
  addHeader(s6, 'Icing on the Cake', 'This plugs into your program — it doesn’t replace it')
  addFooter(s6, pg)
  s6.addText('You keep the survey, the analysis, and the story to leadership. We add one precision layer.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.55, fontSize: 19, fontFace: 'Arial', color: DN.sarinaBlue, bold: true,
  })
  const fit = [
    { t: 'You own the instrument', d: 'Your NPS score and your question set stay exactly as they are. Nothing about the program you run changes — same wave, same cadence, same benchmarks.', c: DN.gold },
    { t: 'You own the insight', d: 'The analysis and the narrative to Graddy and the studios stay yours. We hand your team sharper inputs — not a competing read-out.', c: DN.teal },
    { t: 'We add one layer', d: 'A specific-emotion read on the open-text you already collect. The icing that makes the cake you already bake land harder with the roadmap.', c: DN.sarinaBlue },
  ]
  fit.forEach((f, i) => {
    const x = 0.6 + i * 4.13
    s6.addShape('rect', { x, y: 1.95, w: 3.9, h: 3.5, fill: { color: DN.slateCard }, rectRadius: 0.1 })
    s6.addShape('rect', { x, y: 1.95, w: 3.9, h: 0.12, fill: { color: f.c } })
    s6.addText(f.t, { x: x + 0.22, y: 2.2, w: 3.5, h: 0.5, fontSize: 16.5, fontFace: 'Arial', color: DN.navy, bold: true, valign: 'top' })
    s6.addText(f.d, { x: x + 0.22, y: 2.85, w: 3.5, h: 2.4, fontSize: 13, fontFace: 'Arial', color: DN.ink, lineSpacing: 19, valign: 'top' })
  })
  s6.addShape('rect', { x: 0.6, y: 5.75, w: 12.1, h: 0.85, fill: { color: DN.navy }, rectRadius: 0.08 })
  s6.addText('Your NPS program   +   a specific-emotion layer   =   a sharper read-out, same team.', {
    x: 0.6, y: 5.75, w: 12.1, h: 0.85, fontSize: 16, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle',
  })
  s6.addNotes(
`THE slide that disarms the displacement fear — say it plainly and early. This team owns NPS; the worst read of an outside vendor is "they're here to take my program." Kill that.

"We're not replacing anything. You own the instrument — the score, the questions, the benchmarks. You own the insight — the analysis and the story to Graddy. We add exactly one thing: a read of the emotion inside the 'why' you already collect. Icing on a cake you already bake well — and it makes your read-out sharper."

If they only remember one slide, let it be this one.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 7: THE BEHAVIORAL MAP (product-toned moves)
  // ═══════════════════════════════════════════════════════════════
  const s7 = pptx.addSlide()
  pg++
  addHeader(s7, 'The Behavioral Map', 'What each emotion means — mapped to your two offerings')
  addFooter(s7, pg)
  const cols = [
    { x: 0.5, w: 2.55, label: 'Signal' },
    { x: 3.05, w: 3.35, label: 'What they say' },
    { x: 6.4, w: 3.15, label: 'What it tells you' },
    { x: 9.55, w: 3.28, label: 'Where it points' },
  ]
  s7.addShape('rect', { x: 0.5, y: 1.35, w: 12.33, h: 0.5, fill: { color: DN.navy } })
  cols.forEach((c) => {
    s7.addText(c.label, { x: c.x + 0.1, y: 1.35, w: c.w - 0.15, h: 0.5, fontSize: 12, fontFace: 'Arial', color: DN.white, bold: true, valign: 'middle' })
  })
  const rows = [
    { sig: 'Regret — Bundle buyer', c: DN.regret, say: '“I should’ve gotten MVP+ — same price, more stuff.”', mean: 'The membership already won them', move: 'Make the Bundle→MVP+ switch effortless' },
    { sig: 'Disappointment — delivery', c: DN.disappoint, say: '“Paid for MVP+, didn’t get the early access.”', mean: 'A promise that didn’t land', move: 'Route to the team that owns it' },
    { sig: 'Disappointment — value', c: DN.disappoint, say: '“Perks are all Ultimate Team; I only play Franchise.”', mean: 'Value mismatch by play mode', move: 'Roadmap lever: mode-specific perks' },
    { sig: 'Confusion — the offer', c: DN.gold, say: '“Do I get the deluxe stuff PLUS the sub stuff?”', mean: 'The offer structure isn’t landing', move: 'A clarity fix at the point of choice' },
  ]
  const rowH = 1.15
  rows.forEach((r, i) => {
    const y = 1.85 + i * rowH
    s7.addShape('rect', { x: 0.5, y, w: 12.33, h: rowH, fill: { color: i % 2 ? DN.white : DN.slateCard } })
    s7.addShape('rect', { x: 0.5, y, w: 0.1, h: rowH, fill: { color: r.c } })
    s7.addText(r.sig, { x: cols[0].x + 0.18, y, w: cols[0].w - 0.2, h: rowH, fontSize: 12.5, fontFace: 'Arial', color: r.c, bold: true, valign: 'middle', lineSpacing: 15 })
    s7.addText(r.say, { x: cols[1].x + 0.1, y, w: cols[1].w - 0.2, h: rowH, fontSize: 12, fontFace: 'Arial', color: DN.ink, italic: true, valign: 'middle', lineSpacing: 15 })
    s7.addText(r.mean, { x: cols[2].x + 0.1, y, w: cols[2].w - 0.2, h: rowH, fontSize: 12, fontFace: 'Arial', color: DN.navy, valign: 'middle', lineSpacing: 15 })
    s7.addText(r.move, { x: cols[3].x + 0.1, y, w: cols[3].w - 0.15, h: rowH, fontSize: 12, fontFace: 'Arial', color: DN.navy, bold: true, valign: 'middle', lineSpacing: 15 })
  })
  s7.addText('One read, four cohorts — each pointing at a different part of the roadmap. That’s the map a valence score can’t draw.', {
    x: 0.5, y: 6.65, w: 12.33, h: 0.4, fontSize: 13, fontFace: 'Arial', color: DN.navy, italic: true, align: 'center',
  })
  s7.addNotes(
`The operational payoff — but "where it points" is the roadmap, not a CRM action. Each row is a cohort a valence rollup blends into one gray "detractors" bucket.

Row 1 = product validation + an easy player-friendly lever. Rows 2–3 = two flavors of a fixable miss (a stumbled launch, a mode mismatch — the mode one lands squarely on Graddy's ask about making the membership valuable). Row 4 = a clarity/comms signal: players genuinely don't understand Bundle vs subscription.

Quotes are representative of real public forum language (verbatims next slide).`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 8: WE DID THE HOMEWORK (VoC)
  // ═══════════════════════════════════════════════════════════════
  const s8 = pptx.addSlide()
  pg++
  addHeader(s8, 'We Did the Homework')
  addFooter(s8, pg)
  s8.addText('These signals are already in the wild. Today they’re scattered anecdotes. We help you make them measurable.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.55, fontSize: 17, fontFace: 'Arial', color: DN.hermesOrange, bold: true,
  })
  const voc = [
    { tag: 'REGRET', c: DN.regret, q: '“If you’re buying the MVP bundle you might as well buy MVP+ — it’s the same price and you get the extras.”' },
    { tag: 'CONFUSION', c: DN.gold, q: '“If you buy the subscription do you get the deluxe edition stuff PLUS the stuff from the subscription?”' },
    { tag: 'CLARITY GAP', c: DN.teal, q: '“They just want people to sign up and forget the $150 renewal is coming.” — players want to understand what they bought.' },
    { tag: 'DISAPPOINTMENT', c: DN.disappoint, q: 'An EA forum thread, verbatim title: “Purchased MVP+, but not receiving early access.”' },
  ]
  voc.forEach((v, i) => {
    const col = i % 2, row = Math.floor(i / 2)
    const x = 0.6 + col * 6.15
    const y = 1.95 + row * 1.85
    s8.addShape('rect', { x, y, w: 5.95, h: 1.65, fill: { color: DN.slateCard }, rectRadius: 0.1 })
    s8.addShape('rect', { x, y, w: 0.16, h: 1.65, fill: { color: v.c } })
    s8.addText(v.tag, { x: x + 0.32, y: y + 0.14, w: 5.5, h: 0.3, fontSize: 11, fontFace: 'Arial', color: v.c, bold: true, charSpacing: 1.5 })
    s8.addText(v.q, { x: x + 0.32, y: y + 0.48, w: 5.5, h: 1.05, fontSize: 12.5, fontFace: 'Arial', color: DN.ink, italic: true, lineSpacing: 17, valign: 'top' })
  })
  s8.addText('Public forum chatter, summer 2026 — unfiltered and unprompted. The same feelings are in your NPS “why” right now, waiting to be sorted and counted.', {
    x: 0.6, y: 5.75, w: 12.1, h: 0.7, fontSize: 13.5, fontFace: 'Arial', color: DN.navy, bold: true, align: 'center', lineSpacing: 18,
  })
  s8.addNotes(
`Credibility + grounding. These are REAL verbatim quotes from public EA/MUT forums this summer — say so. They map onto the four cohorts from the map, proving the framework isn't theoretical: players are already expressing these emotions, loudly, for free.

The partnership line: "You're already getting this feedback — scattered across Reddit and your forums where it can't be counted. The same emotions are in your NPS 'why' right now. We help your team sort and count them inside the survey you already run."`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 9: HOW WE CAPTURE IT (mechanic, weave-in)
  // ═══════════════════════════════════════════════════════════════
  const s9 = pptx.addSlide()
  pg++
  addHeader(s9, 'How We Capture It')
  addFooter(s9, pg)
  s9.addText('Your exact question set stays. We just make the “why” turn a little smarter.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.5, fontSize: 19, fontFace: 'Arial', color: DN.sarinaBlue, bold: true,
  })
  s9.addShape('rect', { x: 0.6, y: 1.85, w: 5.4, h: 0.32, fill: { color: DN.disappointTint }, line: { color: DN.disappoint, width: 0.6 }, rectRadius: 0.05 })
  s9.addText('ILLUSTRATIVE EXAMPLE — the shape of the exchange, not EA data', {
    x: 0.7, y: 1.85, w: 5.3, h: 0.32, fontSize: 9.5, fontFace: 'Arial', color: 'B45309', bold: true, valign: 'middle',
  })
  // Left: static
  s9.addShape('rect', { x: 0.6, y: 2.35, w: 5.85, h: 3.75, fill: { color: 'FEF2F2' }, rectRadius: 0.1 })
  s9.addText('Open-text “why” box', { x: 0.6, y: 2.45, w: 5.85, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.red, bold: true, align: 'center' })
  s9.addText('NPS: 6/10\n\nWhy did you score us that way?\n“idk it’s fine, wish I’d done the other one”\n\n———\n\nWhat your team can code:\nNegative sentiment. The attribution — and the roadmap signal — stays buried.', {
    x: 0.9, y: 3.0, w: 5.3, h: 3.0, fontSize: 13, fontFace: 'Arial', color: DN.ink, lineSpacing: 21, valign: 'top',
  })
  // Right: conversation
  s9.addShape('rect', { x: 7.05, y: 2.35, w: 5.85, h: 3.75, fill: { color: 'F0FDF4' }, rectRadius: 0.1 })
  s9.addText('Sentimetrx conversation', { x: 7.05, y: 2.45, w: 5.85, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.green, bold: true, align: 'center' })
  s9.addText('NPS: 6/10\nAgent: What’s the one thing keeping that from a 9 or 10?\nPlayer: idk the game’s fine, I just wish I’d gotten MVP+\nAgent: If MVP+ had been one tap at checkout, would you have taken it?\nPlayer: 100% — the 7-day early access alone was worth it\n\n———\n\nHanded to your read-out:\n• REGRET · internal attribution\n• The membership already won him\n• Roadmap signal: make the switch easy', {
    x: 7.3, y: 2.9, w: 5.35, h: 3.1, fontSize: 11.5, fontFace: 'Arial', color: DN.ink, lineSpacing: 16, valign: 'top',
  })
  s9.addText('Same survey length. No interviewer. Every “why” tagged — emotion + attribution — and fed into your existing read-out.', {
    x: 0.6, y: 6.25, w: 12.3, h: 0.5, fontSize: 14, fontFace: 'Arial', color: DN.sarinaBlue, bold: true, align: 'center', lineSpacing: 18,
  })
  s9.addNotes(
`The "how," framed as with-your-team. Reassure first: NPS question stays, their other questions stay, their coding stays. We swap only the dead open-text "why" for a branded conversational turn that surfaces attribution — and we hand the tagged result back into THEIR read-out.

Walk the right column — one adaptive probe reveals internal attribution and that the membership landed. Note out loud: illustrative dialogue; real drivers come from EA's players.

For a technical insights audience: one follow-up ≤25 words, on-brand, 15 languages, ~$0.002/interaction; collection + tagging in one system, output plugs into their pipeline.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 10: WHAT YOU GET OUT — THREE COHORTS
  // ═══════════════════════════════════════════════════════════════
  const s10 = pptx.addSlide()
  pg++
  addHeader(s10, 'What Your Read-Out Gets')
  addFooter(s10, pg)
  s10.addText('Three emotion cohorts that plug straight into your NPS story — not a word cloud.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.5, fontSize: 20, fontFace: 'Arial', color: DN.sarinaBlue, bold: true,
  })
  const segs = [
    { name: 'ALREADY SOLD', c: DN.regret, tint: DN.regretTint, from: 'From the regret signal', body: 'Players who wish they’d chosen MVP+ — proof the value prop landed. A confidence read for Graddy, plus a clean lever: make switching effortless next cycle.' },
    { name: 'A FIXABLE MISS', c: DN.disappoint, tint: DN.disappointTint, from: 'From the disappointment signal', body: 'A stumbled launch, perks that missed a play mode. External, specific, and named in players’ words — the kind of signal your team routes straight to product.' },
    { name: 'NEEDS CLARITY', c: DN.teal, tint: 'E2F1F2', from: 'From the confusion signal', body: 'Players unsure what they bought or what renews. A communication opportunity — help them understand the offer, and trust follows.' },
  ]
  segs.forEach((s, i) => {
    const x = 0.6 + i * 4.13
    s10.addShape('rect', { x, y: 1.95, w: 3.9, h: 3.65, fill: { color: s.tint }, rectRadius: 0.12 })
    s10.addShape('rect', { x, y: 1.95, w: 3.9, h: 0.7, fill: { color: s.c }, rectRadius: 0.12 })
    s10.addShape('rect', { x, y: 2.4, w: 3.9, h: 0.25, fill: { color: s.c } })
    s10.addText(s.name, { x: x + 0.2, y: 1.95, w: 3.5, h: 0.7, fontSize: 18, fontFace: 'Arial', color: DN.white, bold: true, valign: 'middle' })
    s10.addText(s.from, { x: x + 0.22, y: 2.8, w: 3.5, h: 0.35, fontSize: 12, fontFace: 'Arial', color: s.c, bold: true, italic: true })
    s10.addText(s.body, { x: x + 0.22, y: 3.25, w: 3.5, h: 2.2, fontSize: 12.5, fontFace: 'Arial', color: DN.ink, lineSpacing: 18, valign: 'top' })
  })
  s10.addShape('rect', { x: 0.6, y: 5.85, w: 12.1, h: 0.75, fill: { color: DN.navy }, rectRadius: 0.08 })
  s10.addText('Delivered as a live dashboard with the verbatim behind every number — cut by game, play mode, and platform, ready for your read-out.', {
    x: 0.6, y: 5.85, w: 12.1, h: 0.75, fontSize: 14, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle',
  })
  s10.addNotes(
`The deliverable, made concrete — and it feeds THEIR read-out, doesn't compete with it. Three named cohorts, each pointing at a different part of the roadmap:

ALREADY SOLD → a confidence story for Graddy + a make-switching-easy lever.
A FIXABLE MISS → routable product signals (the mode-mismatch is the direct answer to Graddy's "what would make the membership valuable").
NEEDS CLARITY → a comms opportunity, not a churn worry.

Close on the dashboard + verbatim + segmentation — the inputs their story is built on.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 11: FROM INSIGHT TO ROADMAP (hero the team)
  // ═══════════════════════════════════════════════════════════════
  const s11 = pptx.addSlide()
  pg++
  addHeader(s11, 'From Insight to Roadmap')
  addFooter(s11, pg)
  s11.addText('Each cohort your team surfaces points at a concrete move — sourced in players’ own words.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.5, fontSize: 18, fontFace: 'Arial', color: DN.hermesOrange, bold: true,
  })
  const plays = [
    { t: 'Make the switch effortless', d: 'Regretful Bundle buyers already want in. A one-tap Bundle→MVP+ path turns their enthusiasm into a better experience — and validates the membership on the roadmap.', c: DN.regret },
    { t: 'Fix what broke the promise', d: 'The “didn’t get my early access” cohort is a clean, routable defect. Your read-out hands it to the studio with the player’s exact words attached.', c: DN.disappoint },
    { t: 'Mode-aware perks', d: 'Franchise and Dynasty players are telling you the Ultimate Team–heavy rewards miss them. A concrete roadmap lever — the direct answer to “what makes MVP+ valuable.”', c: DN.teal },
    { t: 'Clearer choice at purchase', d: 'The confusion cohort shows exactly where the offer reads muddy. A messaging fix at the point of choice — trust, not just conversion.', c: DN.gold },
  ]
  plays.forEach((p, i) => {
    const col = i % 2, row = Math.floor(i / 2)
    const x = 0.6 + col * 6.15
    const y = 1.95 + row * 2.15
    s11.addShape('rect', { x, y, w: 5.95, h: 1.95, fill: { color: DN.slateCard }, rectRadius: 0.1 })
    s11.addShape('rect', { x, y, w: 0.16, h: 1.95, fill: { color: p.c } })
    s11.addText(p.t, { x: x + 0.32, y: y + 0.18, w: 5.5, h: 0.6, fontSize: 15.5, fontFace: 'Arial', color: DN.navy, bold: true, valign: 'top' })
    s11.addText(p.d, { x: x + 0.32, y: y + 0.78, w: 5.5, h: 1.05, fontSize: 12.5, fontFace: 'Arial', color: DN.ink, lineSpacing: 17, valign: 'top' })
  })
  s11.addText('Your team becomes the source of the roadmap signal — not just the keeper of the score.', {
    x: 0.6, y: 6.3, w: 12.1, h: 0.45, fontSize: 13.5, fontFace: 'Arial', color: DN.navy, italic: true, bold: true, align: 'center',
  })
  s11.addNotes(
`This is the make-them-the-hero slide. The insights team walks out of the NPS wave with concrete roadmap moves to hand Graddy and the studios — sourced in players' own words. That's how they grow their own standing internally, with us as the quiet layer underneath.

The mode-aware-perks card is the one to land hardest — it's the literal answer to Graddy's stated ask ("what would make the membership valuable"). Bottom line: your team becomes the source of the roadmap, not just the scorekeeper.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 12: PROOF
  // ═══════════════════════════════════════════════════════════════
  const s12 = pptx.addSlide()
  pg++
  addHeader(s12, 'Proof It Works')
  addFooter(s12, pg)
  s12.addText('The conversational method is already shipping — and validated against expert analysts.', {
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
    s12.addShape('rect', { x, y, w: 5.95, h: 1.55, fill: { color: DN.slateCard }, rectRadius: 0.1 })
    s12.addText(p.stat, { x: x + 0.15, y: y + 0.1, w: 1.95, h: 1.35, fontSize: p.fs, fontFace: 'Arial', color: DN.sarinaBlue, bold: true, align: 'center', valign: 'middle' })
    s12.addText(p.org, { x: x + 2.15, y: y + 0.18, w: 3.6, h: 0.45, fontSize: 15, fontFace: 'Arial', color: DN.navy, bold: true })
    s12.addText(p.d, { x: x + 2.15, y: y + 0.6, w: 3.65, h: 0.85, fontSize: 12, fontFace: 'Arial', color: DN.ink, lineSpacing: 16, valign: 'top' })
  })
  s12.addShape('rect', { x: 0.6, y: 5.4, w: 12.1, h: 1.15, fill: { color: DN.navy }, rectRadius: 0.1 })
  s12.addText('“Ana performed almost as well as the team of professors and outperformed the graduate student — in less than 5% of the time.”', {
    x: 0.9, y: 5.5, w: 11.5, h: 0.7, fontSize: 13, fontFace: 'Arial', color: DN.white, italic: true, valign: 'middle',
  })
  s12.addText('— Dr. Fevzi Okumus, UCF Rosen College of Hospitality Management', {
    x: 0.9, y: 6.2, w: 11.5, h: 0.32, fontSize: 11, fontFace: 'Arial', color: DN.gold,
  })
  s12.addNotes(
`Credibility close before the ask. Two proof legs: (1) conversational capture gets far more, richer responses than a static form — Globetrotters and JW Marriott ~10×; (2) the analysis matches an expert team at a fraction of the time — UCF Rosen. Read the Okumus quote verbatim.

For an insights audience the UCF point lands hardest: it augments expert analysts, it doesn't pretend to replace judgment.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 13: RUNNING IT WITH YOUR TEAM (pilot)
  // ═══════════════════════════════════════════════════════════════
  const s13 = pptx.addSlide()
  pg++
  addHeader(s13, 'Running It With Your Team')
  addFooter(s13, pg)
  s13.addText('One layer added to the wave you’re already sending — with you, not around you.', {
    x: 0.6, y: 1.25, w: 12.1, h: 0.5, fontSize: 20, fontFace: 'Arial', color: DN.hermesOrange, bold: true,
  })
  const steps = [
    { n: '1', t: 'You keep the instrument', d: 'Your NPS question, your follow-ons, your benchmarks — unchanged. You stay the owner of the program and the analysis.' },
    { n: '2', t: 'We add the “why” layer', d: 'A branded conversational turn runs the follow-up in your voice — one adaptive probe, 15 languages.' },
    { n: '3', t: 'Every “why” tagged', d: 'Emotion + attribution on each response, handed back in a form that drops into your read-out.' },
    { n: '4', t: 'Three cohorts, in-window', d: 'Already Sold, A Fixable Miss, Needs Clarity — with verbatim and a live dashboard, inside the survey period.' },
  ]
  steps.forEach((st, i) => {
    const y = 1.95 + i * 1.05
    s13.addShape('rect', { x: 0.6, y, w: 12.1, h: 0.9, fill: { color: DN.slateCard }, rectRadius: 0.08 })
    s13.addShape('ellipse', { x: 0.8, y: y + 0.19, w: 0.52, h: 0.52, fill: { color: DN.sarinaBlue } })
    s13.addText(st.n, { x: 0.8, y: y + 0.19, w: 0.52, h: 0.52, fontSize: 20, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
    s13.addText(st.t, { x: 1.55, y, w: 3.9, h: 0.9, fontSize: 15, fontFace: 'Arial', color: DN.navy, bold: true, valign: 'middle' })
    s13.addText(st.d, { x: 5.5, y, w: 7.05, h: 0.9, fontSize: 12.5, fontFace: 'Arial', color: DN.ink, valign: 'middle', lineSpacing: 16 })
  })
  s13.addShape('rect', { x: 0.6, y: 6.25, w: 12.1, h: 0.6, fill: { color: DN.navy }, rectRadius: 0.08 })
  s13.addText('A single wave to prove it — measured together against the read your team gets today.', {
    x: 0.6, y: 6.25, w: 12.1, h: 0.6, fontSize: 13, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle',
  })
  s13.addNotes(
`Make it easy and non-threatening to say yes. The frame: we add one layer to a wave they already run, on their terms, and we measure it together against the read they get today. Collaborative, low-risk, reversible.

Emphasize "with you, not around you" — this team green-lights or kills the pilot; we never touch their instrument without them.`
  )

  // ═══════════════════════════════════════════════════════════════
  // SLIDE 14: CLOSE
  // ═══════════════════════════════════════════════════════════════
  const s14 = pptx.addSlide()
  pg++
  s14.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.navy } })
  s14.addShape('rect', { x: 0, y: 0, w: 0.18, h: H, fill: { color: DN.sarinaBlue } })
  s14.addShape('rect', { x: 0, y: 4.55, w: W, h: 0.05, fill: { color: DN.gold } })
  s14.addText('Your NPS already asks\nthe perfect question.', {
    x: 0.8, y: 1.5, w: 11.6, h: 1.6, fontSize: 40, fontFace: 'Arial', color: DN.white, bold: true, lineSpacing: 46,
  })
  s14.addText('Let’s read the answer with you.', { x: 0.8, y: 3.4, w: 11.6, h: 0.8, fontSize: 28, fontFace: 'Arial', color: DN.gold, bold: true })
  s14.addText('You keep the survey, the analysis, and the story. We add the specific-emotion layer that turns your score into the roadmap — the icing on a cake you already bake well.', {
    x: 0.8, y: 4.75, w: 11.4, h: 0.9, fontSize: 16, fontFace: 'Arial', color: DN.slate, lineSpacing: 22,
  })
  s14.addShape('rect', { x: 0.8, y: 5.95, w: 11.7, h: 0.78, fill: { color: DN.sarinaBlue }, rectRadius: 0.08 })
  s14.addText('Let’s add one layer to this summer’s wave.   sentimetrx.ai  ·  sanjay@datanautix.com', {
    x: 0.8, y: 5.95, w: 11.7, h: 0.78, fontSize: 16, fontFace: 'Arial', color: DN.navy, bold: true, align: 'center', valign: 'middle',
  })
  s14.addText('Sentimetrx  ·  powered by Datanautix', { x: 0.8, y: 6.95, w: 8, h: 0.35, fontSize: 12, fontFace: 'Arial', color: DN.slate })
  s14.addNotes(
`Land it warm and partnership-first. "Your NPS already asks the perfect question — the 'why.' We'd love to read the answer with you, for the emotion behind it. You keep everything that's yours; we add the layer that turns the score into roadmap. Icing on a cake you already bake well."

CTA is a single collaborative wave. Contact sanjay@datanautix.com; swap if Larry fronts the relationship.`
  )

  return pptx
}
