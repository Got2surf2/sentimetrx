/* eslint-disable */
// Ruth's Chris pilot — client-facing RESULTS deck (one-off → ~/Downloads).
// Standalone pptxgenjs builder; Sentimetrx-branded. All numbers are real,
// produced by scripts/pilot-rc-{regression,keyword-lift,coverage,examples}.ts.
//
// Run: node_modules/.bin/tsx scripts/pilot-rc-deck.ts [--out <path>]

import PptxGenJS from 'pptxgenjs'
import os from 'os'
import path from 'path'

const C = {
  navy: '0D2B45', teal: '0F7173', tealLight: '4DBFC1', orange: 'E85A1A',
  gold: 'E8B84B', white: 'FFFFFF', slate: '8FA3AE', slateLight: 'E8EDEF',
  card: 'F4F7F8', divider: 'D4DDE2', ink: '12303F',
  green: '059669', red: 'DC2626', amber: 'D97706',
}
const W = 13.33, H = 7.5, PAD = 0.5
const args = process.argv.slice(2)
const getFlag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const OUT = getFlag('--out') ?? path.join(os.homedir(), 'Downloads', 'sentimetrx-ruths-chris-pilot-results-2026-06-02.pptx')

const pptx = new PptxGenJS()
pptx.defineLayout({ name: 'W', width: W, height: H })
pptx.layout = 'W'

function wordmark(s: any, x: number, y: number, size: number, onDark = false) {
  s.addText(
    [
      { text: 'Senti', options: { color: onDark ? C.white : C.navy, bold: true } },
      { text: 'metrx', options: { color: C.teal, bold: true } },
    ],
    { x, y, w: 3.2, h: 0.4, fontSize: size, align: 'left', fontFace: 'Arial' },
  )
}

function header(s: any, kicker: string, title: string) {
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: C.card }, line: { width: 0 } })
  s.addText(kicker.toUpperCase(), { x: PAD, y: 0.42, w: 9, h: 0.3, fontSize: 11, color: C.teal, bold: true, charSpacing: 2, fontFace: 'Arial' })
  s.addText(title, { x: PAD, y: 0.7, w: 10.5, h: 0.7, fontSize: 26, color: C.navy, bold: true, fontFace: 'Arial' })
  s.addShape(pptx.ShapeType.rect, { x: PAD, y: 1.5, w: 1.1, h: 0.06, fill: { color: C.orange }, line: { width: 0 } })
  wordmark(s, W - 3.0, 0.45, 14)
}

function footer(s: any, n: number) {
  s.addText('Sentimetrx  ·  sentimetrx.ai  ·  Prepared for Ruth’s Chris Steak House', { x: PAD, y: H - 0.42, w: 9, h: 0.3, fontSize: 9, color: C.slate, fontFace: 'Arial' })
  s.addText(String(n), { x: W - 1.0, y: H - 0.42, w: 0.5, h: 0.3, fontSize: 9, color: C.slate, align: 'right', fontFace: 'Arial' })
}

// label list with polarity/severity coloring
function labelRuns(labels: { t: string; kind?: 'pos' | 'neg' | 'neu' | 'miss' | 'add' }[]) {
  const runs: any[] = []
  labels.forEach((l, i) => {
    const color = l.kind === 'neg' ? C.red : l.kind === 'pos' ? C.green : l.kind === 'miss' ? C.amber : l.kind === 'add' ? C.teal : C.ink
    runs.push({ text: l.t, options: { color, bold: l.kind === 'miss' || l.kind === 'add' } })
    if (i < labels.length - 1) runs.push({ text: '   ·   ', options: { color: C.divider } })
  })
  return runs
}

// ── 1. Title ─────────────────────────────────────────────────────────────────
{
  const s = pptx.addSlide()
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: C.navy }, line: { width: 0 } })
  s.addShape(pptx.ShapeType.rect, { x: 0, y: H - 0.5, w: W, h: 0.5, fill: { color: C.teal }, line: { width: 0 } })
  wordmark(s, PAD, 0.6, 22, true)
  s.addText('Review Classification Pilot', { x: PAD, y: 2.7, w: 11.5, h: 0.6, fontSize: 18, color: C.tealLight, bold: true, fontFace: 'Arial' })
  s.addText('Rebuilding your review taxonomy\nfrom your own customers’ words', { x: PAD, y: 3.3, w: 11.8, h: 1.6, fontSize: 40, color: C.white, bold: true, fontFace: 'Arial', lineSpacingMultiple: 1.0 })
  s.addText('Results & methodology  ·  43,196 Google reviews  ·  June 2026', { x: PAD, y: 5.1, w: 11.5, h: 0.4, fontSize: 14, color: C.slateLight, fontFace: 'Arial' })
  s.addText('Prepared for Ruth’s Chris Steak House', { x: PAD, y: H - 0.46, w: 9, h: 0.4, fontSize: 12, color: C.white, bold: true, fontFace: 'Arial' })
}

// ── 2. Starting point ──────────────────────────────────────────────────────
{
  const s = pptx.addSlide()
  header(s, 'What we started with', 'Your data — and what was in it')
  const cards = [
    { k: '43,196', v: 'customer reviews', d: '15 months of Google reviews, every one already tagged by your current CX vendor.' },
    { k: '229', v: 'vendor labels', d: 'A flat list of tags — overlapping, case-duplicated, and hard to roll up.' },
    { k: '20.8%', v: 'stamped “TEST”', d: '1 in 5 reviews carries the vendor’s internal QA tag — noise sitting in production data.' },
  ]
  cards.forEach((c, i) => {
    const x = PAD + i * 4.1
    s.addShape(pptx.ShapeType.roundRect, { x, y: 1.9, w: 3.8, h: 2.4, rectRadius: 0.08, fill: { color: C.white }, line: { color: C.divider, width: 1 } })
    s.addText(c.k, { x: x + 0.2, y: 2.1, w: 3.4, h: 0.8, fontSize: 40, bold: true, color: i === 2 ? C.red : C.teal, fontFace: 'Arial' })
    s.addText(c.v, { x: x + 0.2, y: 2.95, w: 3.4, h: 0.3, fontSize: 13, bold: true, color: C.navy, fontFace: 'Arial' })
    s.addText(c.d, { x: x + 0.2, y: 3.3, w: 3.45, h: 0.9, fontSize: 11, color: C.ink, fontFace: 'Arial' })
  })
  s.addText([
    { text: 'The opportunity.  ', options: { bold: true, color: C.navy } },
    { text: 'Your reviews already contain rich, specific customer language. The goal of the pilot: turn that raw text into a clean, auditable taxonomy that captures more than the current vendor — built from your data, not guessed at a desk.', options: { color: C.ink } },
  ], { x: PAD, y: 4.7, w: 12.3, h: 1.4, fontSize: 15, fontFace: 'Arial', valign: 'top', lineSpacingMultiple: 1.15 })
  footer(s, 2)
}

// ── 3. Approach ──────────────────────────────────────────────────────────────
{
  const s = pptx.addSlide()
  header(s, 'Our approach', 'A 7-axis taxonomy, learned from 5,000 of your reviews')
  const axes = ['Touchpoint — who served you', 'Attribute — how they did', 'Product — what you ate', 'Beverage — what you drank', 'Ambiance — the room', 'Context — when / where', 'Outcome — will you return']
  axes.forEach((a, i) => {
    const col = i % 2, rowY = 1.95 + Math.floor(i / 2) * 0.62
    const x = PAD + col * 6.15
    s.addShape(pptx.ShapeType.roundRect, { x, y: rowY, w: 5.9, h: 0.5, rectRadius: 0.06, fill: { color: C.white }, line: { color: C.divider, width: 1 } })
    s.addShape(pptx.ShapeType.rect, { x, y: rowY, w: 0.1, h: 0.5, fill: { color: C.orange }, line: { width: 0 } })
    s.addText(a, { x: x + 0.25, y: rowY, w: 5.6, h: 0.5, fontSize: 12.5, color: C.navy, bold: true, valign: 'middle', fontFace: 'Arial' })
  })
  s.addText([
    { text: '+ a cross-cutting severity flag: normal / alert / crisis', options: { italic: true, color: C.slate } },
    { text: '      Your vendor’s entire cross-brand scheme maps cleanly into these 7 axes.', options: { color: C.teal, bold: true } },
  ], { x: PAD, y: 4.42, w: 12, h: 0.3, fontSize: 11, fontFace: 'Arial' })

  const steps = [
    { n: '1', t: 'MINE', d: 'Claude reads 5,000 random reviews and pulls the exact phrases your customers use.' },
    { n: '2', t: 'BUILD', d: 'Keep phrases that recur → a 1,017-phrase dictionary, every phrase audit-traced to its frequency.' },
    { n: '3', t: 'CLASSIFY', d: 'Two tiers: a free instant keyword pass + an AI pass for nuance, severity & new phrasings.' },
  ]
  steps.forEach((st, i) => {
    const x = PAD + i * 4.1
    s.addShape(pptx.ShapeType.roundRect, { x, y: 4.8, w: 3.8, h: 1.85, rectRadius: 0.08, fill: { color: C.navy }, line: { width: 0 } })
    s.addText(st.n, { x: x + 0.2, y: 4.95, w: 0.6, h: 0.5, fontSize: 22, bold: true, color: C.gold, fontFace: 'Arial' })
    s.addText(st.t, { x: x + 0.75, y: 4.98, w: 2.9, h: 0.45, fontSize: 15, bold: true, color: C.tealLight, valign: 'middle', fontFace: 'Arial' })
    s.addText(st.d, { x: x + 0.2, y: 5.5, w: 3.45, h: 1.05, fontSize: 11.5, color: C.white, fontFace: 'Arial', lineSpacingMultiple: 1.1 })
  })
  footer(s, 3)
}

// ── 4. How we tested ─────────────────────────────────────────────────────────
{
  const s = pptx.addSlide()
  header(s, 'How we tested', 'Three checks, on your data')
  const tests = [
    { t: '7 / 7', d: 'Hand-picked hard reviews — food poisoning → crisis; “gnats” → pests, not food-safety; “the food was good” does NOT invent a steak tag.', l: 'Accuracy (anchor reviews)' },
    { t: '3.15×', d: 'More labels than a basic hand-built dictionary, on 500 held-out reviews. Coverage rose from 82% to 99%.', l: 'Lift vs a hand-built list' },
    { t: '43,196', d: 'Every review classified and compared, head-to-head, against your current vendor’s labels.', l: 'Full coverage pass' },
  ]
  tests.forEach((c, i) => {
    const x = PAD + i * 4.1
    s.addShape(pptx.ShapeType.roundRect, { x, y: 2.0, w: 3.8, h: 3.4, rectRadius: 0.08, fill: { color: C.white }, line: { color: C.divider, width: 1 } })
    s.addShape(pptx.ShapeType.rect, { x, y: 2.0, w: 3.8, h: 0.12, fill: { color: C.teal }, line: { width: 0 } })
    s.addText(c.t, { x: x + 0.2, y: 2.35, w: 3.4, h: 0.9, fontSize: 44, bold: true, color: C.navy, fontFace: 'Arial' })
    s.addText(c.l, { x: x + 0.2, y: 3.3, w: 3.4, h: 0.55, fontSize: 13, bold: true, color: C.teal, fontFace: 'Arial' })
    s.addText(c.d, { x: x + 0.2, y: 3.9, w: 3.45, h: 1.4, fontSize: 11.5, color: C.ink, fontFace: 'Arial', lineSpacingMultiple: 1.12 })
  })
  s.addText('All software type-checks and the full 388-test suite pass.', { x: PAD, y: 5.7, w: 11, h: 0.3, fontSize: 11, italic: true, color: C.slate, fontFace: 'Arial' })
  footer(s, 4)
}

// ── 5. Results: coverage ──────────────────────────────────────────────────────
{
  const s = pptx.addSlide()
  header(s, 'Results', 'Our labels vs your vendor’s — across all 43,196 reviews')
  // two big compare columns
  const colY = 2.0, colH = 2.5
  const mk = (x: number, head: string, color: string, rows: [string, string][]) => {
    s.addShape(pptx.ShapeType.roundRect, { x, y: colY, w: 5.85, h: colH, rectRadius: 0.08, fill: { color: C.white }, line: { color: C.divider, width: 1 } })
    s.addShape(pptx.ShapeType.rect, { x, y: colY, w: 5.85, h: 0.55, fill: { color }, line: { width: 0 } })
    s.addText(head, { x: x + 0.2, y: colY, w: 5.45, h: 0.55, fontSize: 14, bold: true, color: C.white, valign: 'middle', fontFace: 'Arial' })
    rows.forEach((r, i) => {
      const ry = colY + 0.7 + i * 0.58
      s.addText(r[0], { x: x + 0.2, y: ry, w: 4.0, h: 0.5, fontSize: 12, color: C.ink, valign: 'middle', fontFace: 'Arial' })
      s.addText(r[1], { x: x + 4.0, y: ry, w: 1.65, h: 0.5, fontSize: 16, bold: true, color: C.navy, align: 'right', valign: 'middle', fontFace: 'Arial' })
    })
  }
  mk(PAD, 'Your current vendor', C.slate, [
    ['Reviews with a usable label', '95.3%'],
    ['Stamped only “TEST” / internal', '20.8%'],
    ['Avg labels per review', '5.0'],
  ])
  mk(PAD + 6.05, 'Sentimetrx', C.teal, [
    ['Reviews with a label', '98.6%'],
    ['Same topic captured (axis level)', '90.4%'],
    ['Avg labels per review', '7.3'],
  ])
  // recall band
  s.addShape(pptx.ShapeType.roundRect, { x: PAD, y: 4.75, w: 11.9, h: 1.55, rectRadius: 0.08, fill: { color: C.navy }, line: { width: 0 } })
  s.addText([
    { text: 'We don’t lose what they caught.  ', options: { bold: true, color: C.gold } },
    { text: 'We reproduce ', options: { color: C.white } },
    { text: '90.4%', options: { bold: true, color: C.tealLight } },
    { text: ' of the vendor’s labels at the topic level — then add more on top. Their scheme is finer-grained in places (every holiday, steak cut, and daypart); our free keyword tier rolls those up and the AI tier resolves them. Matching their labels was never the goal anyway: 1 in 5 of their tags is “TEST”.', options: { color: C.white } },
  ], { x: PAD + 0.3, y: 4.95, w: 11.3, h: 1.2, fontSize: 14, fontFace: 'Arial', valign: 'middle', lineSpacingMultiple: 1.15 })
  s.addText('Comparison covers 100% of your vendor’s cross-brand category scheme. Figures from the free keyword tier; the AI tier raises recall further.', { x: PAD, y: H - 0.66, w: 11.5, h: 0.25, fontSize: 9, italic: true, color: C.slate, fontFace: 'Arial' })
  footer(s, 5)
}

// example card renderer
function exampleSlide(n: number, kicker: string, title: string, takeaway: { lead: string; body: string }, examples: { text: string; rating: number; left: { head: string; runs: any[] }; right: { head: string; runs: any[] } }[]) {
  const s = pptx.addSlide()
  header(s, kicker, title)
  const topY = 1.95
  const cardH = examples.length === 2 ? 1.75 : 1.2
  examples.forEach((ex, i) => {
    const y = topY + i * (cardH + 0.2)
    s.addShape(pptx.ShapeType.roundRect, { x: PAD, y, w: 12.3, h: cardH, rectRadius: 0.07, fill: { color: C.white }, line: { color: C.divider, width: 1 } })
    s.addText([
      { text: `${ex.rating}★  `, options: { color: C.amber, bold: true } },
      { text: `“${ex.text}”`, options: { italic: true, color: C.ink } },
    ], { x: PAD + 0.25, y: y + 0.12, w: 11.8, h: 0.62, fontSize: 11.5, fontFace: 'Arial', valign: 'top', lineSpacingMultiple: 1.0 })
    const ly = y + 0.8
    s.addText(ex.left.head, { x: PAD + 0.25, y: ly, w: 2.0, h: 0.3, fontSize: 10, bold: true, color: C.slate, fontFace: 'Arial' })
    s.addText(ex.left.runs, { x: PAD + 2.1, y: ly, w: 9.9, h: 0.3, fontSize: 11, fontFace: 'Arial' })
    s.addText(ex.right.head, { x: PAD + 0.25, y: ly + 0.4, w: 2.0, h: 0.3, fontSize: 10, bold: true, color: C.teal, fontFace: 'Arial' })
    s.addText(ex.right.runs, { x: PAD + 2.1, y: ly + 0.4, w: 9.9, h: 0.4, fontSize: 11, fontFace: 'Arial' })
  })
  const ty = topY + examples.length * (cardH + 0.2) + 0.05
  s.addText([
    { text: takeaway.lead + '  ', options: { bold: true, color: C.navy } },
    { text: takeaway.body, options: { color: C.ink } },
  ], { x: PAD, y: ty, w: 12.3, h: 1.0, fontSize: 13.5, fontFace: 'Arial', valign: 'top', lineSpacingMultiple: 1.12 })
  footer(s, n)
}

// ── 6. MATCH ───────────────────────────────────────────────────────────────
exampleSlide(6, 'Examples · 1 of 3', 'Where we matched the vendor — and went further',
  { lead: 'We reproduce their call, then add the ones they left on the table.', body: 'In the second review the vendor logged only “server”; we also captured the minimal wine list and that the guest won’t return — signals that drive churn.' },
  [
    { text: 'The food was HORRIBLE! It tasted like frozen food.', rating: 1,
      left: { head: 'Vendor', runs: labelRuns([{ t: 'attribute:flavor', kind: 'neg' }]) },
      right: { head: 'Sentimetrx', runs: labelRuns([{ t: 'attribute:flavor', kind: 'neg' }]) } },
    { text: 'By far the worst Ruth’s Chris. Terrible service, food was lackluster, and the wine list is minimal to say the least. I will never go back.', rating: 1,
      left: { head: 'Vendor', runs: labelRuns([{ t: 'touchpoint:server', kind: 'neu' }]) },
      right: { head: 'Sentimetrx', runs: labelRuns([{ t: 'touchpoint:server', kind: 'neg' }, { t: 'beverage:wine', kind: 'add' }, { t: 'outcome:not-recommend', kind: 'add' }, { t: 'attribute:professional', kind: 'neg' }]) } },
  ])

// ── 7. VENDOR MORE ──────────────────────────────────────────────────────────
exampleSlide(7, 'Examples · 2 of 3', 'Where the vendor tagged more (TEST excluded)',
  { lead: 'Two different stories.', body: 'The first is a real gap in the free keyword tier — “waited 40 mins” should fire speed; our AI tier catches it (next slide). The second shows the vendor over-applying decor/location/clean to a review that mentions none of them — where our classifier stays precise.' },
  [
    { text: 'Waited 40 mins and never got my steak, drink was horrible and the manager was unhelpful. Never again, and I used to love this place.', rating: 1,
      left: { head: 'Vendor', runs: labelRuns([{ t: 'attribute:speed', kind: 'miss' }, { t: 'attribute:pace', kind: 'miss' }, { t: 'touchpoint:server', kind: 'miss' }]) },
      right: { head: 'Sentimetrx (keyword)', runs: labelRuns([{ t: 'touchpoint:manager', kind: 'neu' }, { t: 'attribute:flavor', kind: 'neg' }, { t: 'product:steak', kind: 'neu' }, { t: 'outcome:return', kind: 'neg' }]) } },
    { text: 'Treated me like trash when I took a bite of my friend’s baguette at the bar — “against policy.” Did not appreciate being looked down on. Will not return.', rating: 1,
      left: { head: 'Vendor', runs: labelRuns([{ t: 'ambiance:clean', kind: 'miss' }, { t: 'ambiance:decor', kind: 'miss' }, { t: 'ambiance:location', kind: 'miss' }, { t: 'product:bread', kind: 'miss' }, { t: 'touchpoint:server', kind: 'miss' }]) },
      right: { head: 'Sentimetrx', runs: labelRuns([{ t: 'touchpoint:bartender', kind: 'neu' }, { t: 'outcome:not-recommend', kind: 'neg' }]) } },
  ])

// ── 8. WE MISSED → AI recovers ───────────────────────────────────────────────
exampleSlide(8, 'Examples · 3 of 3', 'Where the keyword tier missed — and the AI tier recovers it',
  { lead: 'This is why we ship two tiers.', body: 'The free keyword pass can’t reason about a parking-lot incident or an implied wait. The AI tier reads the situation — and adds severity flags (alert / crisis) the vendor’s flat labels can’t express at all.' },
  [
    { text: 'They chased my husband out of the parking lot and called the police on him. Worst place ever!!!', rating: 1,
      left: { head: 'Keyword tier', runs: labelRuns([{ t: '(nothing)', kind: 'neu' }]) },
      right: { head: '+ AI tier', runs: labelRuns([{ t: 'ambiance:safety [ALERT]', kind: 'add' }, { t: 'outcome:not-recommend', kind: 'add' }]) } },
    { text: 'Sat at the bar that had 5 people working behind it for 5 minutes and didn’t even get a hello. Got up and walked out.', rating: 1,
      left: { head: 'Keyword tier', runs: labelRuns([{ t: 'touchpoint:bartender', kind: 'neu' }]) },
      right: { head: '+ AI tier', runs: labelRuns([{ t: 'touchpoint:bartender', kind: 'neg' }, { t: 'attribute:attentive', kind: 'add' }, { t: 'attribute:speed [ALERT]', kind: 'add' }, { t: 'outcome:not-recommend', kind: 'add' }]) } },
  ])

// ── 9. What it means ─────────────────────────────────────────────────────────
{
  const s = pptx.addSlide()
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: C.navy }, line: { width: 0 } })
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.14, h: H, fill: { color: C.orange }, line: { width: 0 } })
  wordmark(s, W - 3.0, 0.45, 14, true)
  s.addText('WHAT THIS MEANS', { x: PAD, y: 0.6, w: 9, h: 0.3, fontSize: 12, color: C.tealLight, bold: true, charSpacing: 2, fontFace: 'Arial' })
  s.addText('A classifier pre-trained on your customers', { x: PAD, y: 0.95, w: 11.8, h: 0.7, fontSize: 28, color: C.white, bold: true, fontFace: 'Arial' })
  const points = [
    ['Built from your words.', 'The 1,017-phrase library was machine-generated from your own reviews — your customers’ actual vocabulary, not a guess.'],
    ['More coverage, less noise.', '98.6% of reviews tagged vs 95.3%; we reproduce 90.4% of the vendor’s labels (topic level) and drop the 20.8% “TEST” leak.'],
    ['Two tiers, your choice.', 'A free, instant, fully-auditable keyword pass — plus an AI pass that catches mixed sentiment, severity, and novel phrasings.'],
    ['Auditable end to end.', 'Every phrase carries its sample frequency; every label traces to a verbatim quote from the review.'],
  ]
  points.forEach((p, i) => {
    const y = 2.0 + i * 1.08
    s.addShape(pptx.ShapeType.rect, { x: PAD, y: y + 0.06, w: 0.32, h: 0.32, fill: { color: C.gold }, line: { width: 0 } })
    s.addText([
      { text: p[0] + '  ', options: { bold: true, color: C.tealLight } },
      { text: p[1], options: { color: C.white } },
    ], { x: PAD + 0.55, y, w: 11.6, h: 0.95, fontSize: 14.5, fontFace: 'Arial', valign: 'top', lineSpacingMultiple: 1.12 })
  })
  footer(s, 9)
}

pptx.writeFile({ fileName: OUT }).then(() => console.log('Wrote ' + OUT))
