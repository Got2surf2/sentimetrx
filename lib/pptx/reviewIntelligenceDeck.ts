// lib/pptx/reviewIntelligenceDeck.ts
// Review Intelligence deck — the restaurant taxonomy classifier story.
// Datanautix-branded deliverable (per the deck-export brand rule); Sentimetrx
// is the platform, referenced in content. One builder, three modes:
//   full       — the complete prospect story (capability + vendor head-to-head
//                + critical-category alert audit). Default: Ruth's Chris.
//   alerts     — just the critical-category findings (food-safety / pests).
//   capability — brand-neutral capability (no vendor/alert data) for a brand
//                with no incumbent labels (e.g. Chuy's).
//
// Every figure is real (RC pilot, this session):
//   · vendor coverage   → scripts/pilot-rc-coverage.ts (43,196 reviews)
//   · food-safety audit → scripts/pilot-rc-foodsafety-audit.ts (Haiku judge)
//   · pests             → scripts/pilot-rc-alert-compare.ts
import type PptxGenJS from 'pptxgenjs'

export type DeckMode = 'full' | 'alerts' | 'capability'

const C = {
  navy: '0D2B45', teal: '0F7173', tealLight: '4DBFC1', orange: 'E85A1A',
  gold: 'E8B84B', white: 'FFFFFF', slate: '8FA3AE', slateDark: '5E7480',
  slateLight: 'E8EDEF', card: 'F4F7F8', divider: 'D4DDE2', ink: '12303F',
  green: '059669', red: 'DC2626', amber: 'D97706',
}
const W = 13.33, H = 7.5, PAD = 0.5

export function buildReviewIntelligenceDeck(pptx: PptxGenJS, mode: DeckMode = 'full', clientName = 'Ruth’s Chris') {
  const shape = (pptx as any).ShapeType
  let pageNo = 0
  const isCap = mode === 'capability'
  const possessive = isCap ? 'your' : `${clientName}’s`

  const dnWordmark = (s: PptxGenJS.Slide, x: number, y: number, size: number) =>
    s.addText(
      [{ text: 'data', options: { color: C.teal, bold: true } },
       { text: '·', options: { color: C.slate, bold: true } },
       { text: 'nautix', options: { color: C.orange, bold: true } }],
      { x, y, w: 3.0, h: 0.4, fontSize: size, align: 'right', fontFace: 'Arial' })

  const header = (s: PptxGenJS.Slide, kicker: string, title: string) => {
    s.addShape(shape.rect, { x: 0, y: 0, w: W, h: H, fill: { color: C.card }, line: { width: 0 } })
    s.addText(kicker.toUpperCase(), { x: PAD, y: 0.42, w: 9.5, h: 0.3, fontSize: 11, color: C.teal, bold: true, charSpacing: 2, fontFace: 'Arial' })
    s.addText(title, { x: PAD, y: 0.7, w: 10.3, h: 0.8, fontSize: 24, color: C.navy, bold: true, fontFace: 'Arial' })
    s.addShape(shape.rect, { x: PAD, y: 1.52, w: 1.1, h: 0.06, fill: { color: C.orange }, line: { width: 0 } })
    dnWordmark(s, W - 3.3, 0.45, 14)
  }
  const footer = (s: PptxGenJS.Slide) => {
    pageNo += 1
    s.addText(`Datanautix  ·  datanautix.com${isCap ? '' : '  ·  Prepared for ' + clientName}`, { x: PAD, y: H - 0.42, w: 11, h: 0.3, fontSize: 9, color: C.slate, fontFace: 'Arial' })
    s.addText(String(pageNo), { x: W - 1.0, y: H - 0.42, w: 0.5, h: 0.3, fontSize: 9, color: C.slate, align: 'right', fontFace: 'Arial' })
  }
  const note = (s: PptxGenJS.Slide, t: string) => s.addNotes(t)

  // ── Title ─────────────────────────────────────────────────────────────────
  {
    const s = pptx.addSlide()
    s.addShape(shape.rect, { x: 0, y: 0, w: W, h: H, fill: { color: C.navy }, line: { width: 0 } })
    s.addShape(shape.rect, { x: 0, y: H - 0.5, w: W, h: 0.5, fill: { color: C.teal }, line: { width: 0 } })
    dnWordmark(s, PAD, 0.6, 22)
    const kicker = mode === 'alerts' ? 'Critical-Category Alert Quality' : 'Review Intelligence'
    const title = mode === 'alerts'
      ? 'When the alert that matters most\ncan’t be trusted'
      : isCap
        ? 'Reading every review\nthree ways'
        : `Rebuilding ${possessive} review taxonomy\nfrom your own customers’ words`
    s.addText(kicker, { x: PAD, y: 2.5, w: 11.5, h: 0.5, fontSize: 18, color: C.tealLight, bold: true, fontFace: 'Arial' })
    s.addText(title, { x: PAD, y: 3.0, w: 12.0, h: 1.7, fontSize: 38, color: C.white, bold: true, fontFace: 'Arial', lineSpacingMultiple: 1.0 })
    const sub = isCap
      ? 'Classify · Extract · Understand  ·  a precision review classifier'
      : `${'43,196'} reviews  ·  head-to-head vs your current vendor  ·  June 2026`
    s.addText(sub, { x: PAD, y: 5.0, w: 12, h: 0.4, fontSize: 14, color: C.slateLight, fontFace: 'Arial' })
    s.addText(isCap ? 'Powered by Sentimetrx' : `Prepared for ${clientName}  ·  powered by Sentimetrx`, { x: PAD, y: H - 0.46, w: 10, h: 0.4, fontSize: 12, color: C.white, bold: true, fontFace: 'Arial' })
    note(s, 'Datanautix delivers this; Sentimetrx is the platform underneath. Frame: we read every public review and turned raw text into a clean, auditable taxonomy — built from your customers’ language, and more precise than the flat scheme you pay for today.')
  }

  // ── Three lenses (capability + full) ───────────────────────────────────────
  if (mode === 'full' || isCap) {
    const s = pptx.addSlide()
    header(s, 'How we read a review', 'Three lenses on the same sentence')
    const lenses = [
      { n: '1', t: 'CLASSIFY', c: C.teal, d: 'Every review onto one fixed 7-axis schema — service, food, drinks, room, occasion, outcome + a severity flag. Complete, comparable, auditable.' },
      { n: '2', t: 'EXTRACT', c: C.navy, d: 'The specific things guests name — dishes, drinks, places — pulled straight from the text. Detail a category label can’t hold.' },
      { n: '3', t: 'UNDERSTAND', c: C.orange, d: 'Themes mined by reading for meaning (NLU) — not matching a word list. Emergent topics, each with its own sentiment.' },
    ]
    lenses.forEach((l, i) => {
      const x = PAD + i * 4.1
      s.addShape(shape.roundRect, { x, y: 1.95, w: 3.8, h: 2.75, rectRadius: 0.08, fill: { color: C.white }, line: { color: C.divider, width: 1 } })
      s.addShape(shape.rect, { x, y: 1.95, w: 3.8, h: 0.12, fill: { color: l.c }, line: { width: 0 } })
      s.addText(`LENS ${l.n}`, { x: x + 0.25, y: 2.25, w: 3.3, h: 0.3, fontSize: 11, bold: true, color: C.slate, charSpacing: 2, fontFace: 'Arial' })
      s.addText(l.t, { x: x + 0.25, y: 2.5, w: 3.3, h: 0.5, fontSize: 22, bold: true, color: l.c, fontFace: 'Arial' })
      s.addText(l.d, { x: x + 0.25, y: 3.1, w: 3.35, h: 1.5, fontSize: 12, color: C.ink, fontFace: 'Arial', lineSpacingMultiple: 1.12 })
    })
    s.addShape(shape.roundRect, { x: PAD, y: 5.05, w: 12.3, h: 1.2, rectRadius: 0.08, fill: { color: C.navy }, line: { width: 0 } })
    s.addText([
      { text: 'Built from your words.  ', options: { bold: true, color: C.gold } },
      { text: `The 7-axis schema is filled by a 1,017-phrase dictionary machine-mined from 5,000 of ${possessive} own reviews — your customers’ actual vocabulary, not a guess at a desk. Every label traces to a verbatim quote.`, options: { color: C.white } },
    ], { x: PAD + 0.3, y: 5.15, w: 11.7, h: 1.0, fontSize: 13.5, fontFace: 'Arial', valign: 'middle', lineSpacingMultiple: 1.12 })
    footer(s)
    note(s, 'Three complementary lenses: structure for comparability, entities for specifics, NLU for meaning. Lead with the punchline that even the “bag of words” lens is data-driven — mined from their reviews, not hand-guessed.')
  }

  // ── Vendor coverage head-to-head (full only) ───────────────────────────────
  if (mode === 'full') {
    const s = pptx.addSlide()
    header(s, 'Lens 1 · Classify', 'Our labels vs your vendor’s — every review')
    const colY = 2.0, colH = 2.5
    const mk = (x: number, head: string, color: string, rows: [string, string][]) => {
      s.addShape(shape.roundRect, { x, y: colY, w: 5.85, h: colH, rectRadius: 0.08, fill: { color: C.white }, line: { color: C.divider, width: 1 } })
      s.addShape(shape.rect, { x, y: colY, w: 5.85, h: 0.55, fill: { color }, line: { width: 0 } })
      s.addText(head, { x: x + 0.2, y: colY, w: 5.45, h: 0.55, fontSize: 14, bold: true, color: C.white, valign: 'middle', fontFace: 'Arial' })
      rows.forEach((r, i) => {
        const ry = colY + 0.7 + i * 0.58
        s.addText(r[0], { x: x + 0.2, y: ry, w: 4.0, h: 0.5, fontSize: 12, color: C.ink, valign: 'middle', fontFace: 'Arial' })
        s.addText(r[1], { x: x + 4.0, y: ry, w: 1.65, h: 0.5, fontSize: 16, bold: true, color: C.navy, align: 'right', valign: 'middle', fontFace: 'Arial' })
      })
    }
    mk(PAD, 'Your current vendor', C.slate, [['Reviews with a usable label', '95.3%'], ['Stamped only “TEST” / internal', '20.8%'], ['Avg labels per review', '5.0']])
    mk(PAD + 6.05, 'Sentimetrx', C.teal, [['Reviews with a label', '98.6%'], ['Vendor’s topics reproduced', '90.4%'], ['Avg labels per review', '7.3']])
    s.addShape(shape.roundRect, { x: PAD, y: 4.75, w: 11.9, h: 1.55, rectRadius: 0.08, fill: { color: C.navy }, line: { width: 0 } })
    s.addText([
      { text: 'We don’t lose what they caught.  ', options: { bold: true, color: C.gold } },
      { text: 'We reproduce ', options: { color: C.white } },
      { text: '90.4%', options: { bold: true, color: C.tealLight } },
      { text: ' of the vendor’s labels at the topic level, tag more reviews (98.6% vs 95.3%), and drop the 20.8% “TEST” leak sitting in their production data. More signal, less noise — every label auditable to a quote.', options: { color: C.white } },
    ], { x: PAD + 0.3, y: 4.95, w: 11.3, h: 1.2, fontSize: 14, fontFace: 'Arial', valign: 'middle', lineSpacingMultiple: 1.15 })
    footer(s)
    note(s, 'This is the “we already match what you pay for, and beat it” slide — but never say it that baldly. Let the numbers do it. 20.8% TEST leak is a credibility grenade: one in five of their tags is internal QA noise in live data.')
  }

  // ── Lens 2 Entities (full + capability) ────────────────────────────────────
  if (mode === 'full' || isCap) {
    const s = pptx.addSlide()
    header(s, 'Lens 2 · Extract', 'The specific things guests name')
    const items = isCap
      ? [['Margarita', 'top-named drink'], ['Queso', '100% positive'], ['Chips & salsa', 'the signature opener'], ['Fajitas', 'named by name'], ['To-go', 'a daypart all its own']]
      : [['Sweet Potato Casserole', 'a brand signature'], ['Bread Pudding', 'named, not “dessert”'], ['Creamed Spinach', 'the side they remember'], ['Filet / Ribeye', 'cut-level detail'], ['Stoli Doli', 'a competitor’s tell']]
    s.addShape(shape.roundRect, { x: PAD, y: 1.95, w: 12.3, h: 3.0, rectRadius: 0.08, fill: { color: C.white }, line: { color: C.divider, width: 1 } })
    items.forEach((it, i) => {
      const ry = 2.2 + i * 0.52
      s.addText(it[0], { x: PAD + 0.3, y: ry, w: 5.0, h: 0.45, fontSize: 14, bold: true, color: C.navy, valign: 'middle', fontFace: 'Arial' })
      s.addText(it[1], { x: PAD + 5.5, y: ry, w: 6.4, h: 0.45, fontSize: 12.5, color: C.slateDark, italic: true, valign: 'middle', fontFace: 'Arial' })
    })
    s.addText([
      { text: 'Guests name what makes a brand a brand.  ', options: { bold: true, color: C.navy } },
      { text: `Pulled automatically from raw text — no menu upload — these are exactly the specifics a flat category (“food mentioned”) throws away.`, options: { color: C.ink } },
    ], { x: PAD, y: 5.15, w: 12.3, h: 1.0, fontSize: 14, fontFace: 'Arial', valign: 'top', lineSpacingMultiple: 1.12 })
    footer(s)
    note(s, 'Entities are the “surprise” lens — brand-defining items that no fixed taxonomy would anticipate. For the steakhouse: sweet potato casserole / bread pudding. The catalog finds them from the text, with zero menu input.')
  }

  // ── Lens 3 Themes (full + capability) ──────────────────────────────────────
  if (mode === 'full' || isCap) {
    const s = pptx.addSlide()
    header(s, 'Lens 3 · Understand', `Themes that emerged from ${possessive} reviews`)
    const themes = isCap
      ? [['Service Quality', 'mixed', 68], ['Food Quality', 'mixed', 60], ['Value & Pricing', 'mixed', 22], ['To-go & Lunch', 'positive', 18], ['Margaritas & Bar', 'positive', 14]]
      : [['Special Occasions', 'positive', 24], ['Service Excellence', 'positive', 22], ['Operational Issues', 'mixed', 21], ['Food Quality', 'mixed', 19], ['Return Intent', 'positive', 16]]
    const maxPct = Math.max(...themes.map(t => t[2] as number))
    themes.forEach((t, i) => {
      const y = 2.0 + i * 0.62
      const sent = t[1] as string, col = sent === 'positive' ? C.green : C.amber
      s.addShape(shape.roundRect, { x: PAD, y: y + 0.06, w: 0.95, h: 0.3, rectRadius: 0.15, fill: { color: col }, line: { width: 0 } })
      s.addText(sent === 'mixed' ? 'MIXED' : 'POS', { x: PAD, y: y + 0.06, w: 0.95, h: 0.3, fontSize: 8.5, bold: true, color: C.white, align: 'center', valign: 'middle', fontFace: 'Arial' })
      s.addText(t[0] as string, { x: PAD + 1.1, y, w: 4.6, h: 0.42, fontSize: 13, bold: true, color: C.navy, valign: 'middle', fontFace: 'Arial' })
      s.addShape(shape.rect, { x: 6.2, y: y + 0.1, w: Math.max(0.05, 4.2 * (t[2] as number) / maxPct), h: 0.2, fill: { color: col }, line: { width: 0 } })
      s.addText(`${t[2]}%`, { x: 10.5, y, w: 0.8, h: 0.42, fontSize: 11, bold: true, color: C.ink, valign: 'middle', fontFace: 'Arial' })
    })
    s.addShape(shape.roundRect, { x: PAD, y: 5.35, w: 12.3, h: 0.95, rectRadius: 0.08, fill: { color: C.slateLight }, line: { width: 0 } })
    s.addText([
      { text: 'The colour is the signal.  ', options: { bold: true, color: C.navy } },
      { text: `These themes weren’t chosen by us — they emerged from the language, each carrying its own sentiment. “Mixed” marks where guests are split — the exact places to act. A bag-of-words classifier tells you a topic appeared; reading for meaning tells you how guests feel.`, options: { color: C.ink } },
    ], { x: PAD + 0.3, y: 5.45, w: 11.7, h: 0.8, fontSize: 12, fontFace: 'Arial', valign: 'middle', lineSpacingMultiple: 1.08 })
    footer(s)
    note(s, 'The NLU lens. Highlight that an emergent, brand-specific theme surfaced (RC: “Operational Issues” — reservations/wait/parking) that no fixed bucket would name. Mixed-sentiment themes are the actionable ones.')
  }

  // ── Critical category: food safety (full + alerts) ─────────────────────────
  if (mode === 'full' || mode === 'alerts') {
    const s = pptx.addSlide()
    header(s, 'The critical category', 'The alert that matters most is the noisiest')
    // big stat
    s.addShape(shape.roundRect, { x: PAD, y: 1.95, w: 5.6, h: 3.4, rectRadius: 0.1, fill: { color: C.navy }, line: { width: 0 } })
    s.addText('62%', { x: PAD + 0.3, y: 2.2, w: 5.0, h: 1.3, fontSize: 88, bold: true, color: C.red, fontFace: 'Arial' })
    s.addText('of your vendor’s food-safety alerts are FALSE ALARMS', { x: PAD + 0.3, y: 3.55, w: 5.0, h: 0.9, fontSize: 16, bold: true, color: C.white, fontFace: 'Arial', lineSpacingMultiple: 1.05 })
    s.addText('703 of 1,140 contained no actual food-safety hazard — an independent audit of every alert (conservative; ambiguous cases counted in the vendor’s favor).', { x: PAD + 0.3, y: 4.5, w: 5.0, h: 0.75, fontSize: 10.5, color: C.slateLight, fontFace: 'Arial', lineSpacingMultiple: 1.08 })
    // examples
    s.addText('What the vendor flagged “food safety”:', { x: 6.5, y: 2.0, w: 6.4, h: 0.35, fontSize: 13, bold: true, color: C.navy, fontFace: 'Arial' })
    const fa = [
      '“Ghetto service 0 stars dirty like Newark”',
      '“the older gentleman with no hair seemed odd”',
      '“potato cheese appetizer… was [bad]”',
      '“servers were not the best… came for a special…”',
    ]
    fa.forEach((q, i) => {
      const ry = 2.5 + i * 0.62
      s.addShape(shape.rect, { x: 6.5, y: ry + 0.05, w: 0.08, h: 0.45, fill: { color: C.red }, line: { width: 0 } })
      s.addText(q, { x: 6.7, y: ry, w: 6.2, h: 0.55, fontSize: 12, italic: true, color: C.ink, valign: 'middle', fontFace: 'Arial' })
    })
    s.addText([
      { text: 'Alert fatigue is the real cost.  ', options: { bold: true, color: C.navy } },
      { text: 'When two in three “food-safety” alerts are noise, the flag gets ignored — and the real one slips through with it.', options: { color: C.ink } },
    ], { x: 6.5, y: 5.15, w: 6.4, h: 1.0, fontSize: 12.5, fontFace: 'Arial', valign: 'top', lineSpacingMultiple: 1.12 })
    footer(s)
    note(s, '62% is a defensible LOWER bound — full population (all 1,140), independent LLM judge, conservative rubric. The story isn’t “their tool is bad,” it’s “the alert your operators most need to trust, they can’t.”')
  }

  // ── Critical category: pests (full + alerts) ───────────────────────────────
  if (mode === 'full' || mode === 'alerts') {
    const s = pptx.addSlide()
    header(s, 'The critical category', 'Precision is what makes an alert actionable')
    // two columns: vendor noise vs our precision
    const col = (x: number, head: string, color: string, lines: string[], foot: string) => {
      s.addShape(shape.roundRect, { x, y: 1.95, w: 5.85, h: 3.4, rectRadius: 0.08, fill: { color: C.white }, line: { color: C.divider, width: 1 } })
      s.addShape(shape.rect, { x, y: 1.95, w: 5.85, h: 0.5, fill: { color }, line: { width: 0 } })
      s.addText(head, { x: x + 0.2, y: 1.95, w: 5.45, h: 0.5, fontSize: 13.5, bold: true, color: C.white, valign: 'middle', fontFace: 'Arial' })
      lines.forEach((q, i) => {
        const ry = 2.62 + i * 0.5
        s.addText(`“${q}”`, { x: x + 0.25, y: ry, w: 5.4, h: 0.45, fontSize: 11.5, italic: true, color: C.ink, valign: 'middle', fontFace: 'Arial' })
      })
      s.addText(foot, { x: x + 0.25, y: 4.85, w: 5.4, h: 0.42, fontSize: 12, bold: true, color, valign: 'middle', fontFace: 'Arial' })
    }
    col(PAD, 'Vendor “bug” alert fires on…', C.slate, ['I’d fly in just to eat here', 'I’m a regular bar fly', 'awesome mosquito mocktail', 'spinach had to be ant back (typo)'], 'noise → the alert gets muted')
    col(PAD + 6.05, 'We fire on real pests — ~99%', C.teal, ['caterpillar found in a salad', 'cockroach ran across the floor', 'maggots in my food', 'mouse running around'], 'precise → the alert gets acted on')
    s.addText([
      { text: 'And we catch what they bury.  ', options: { bold: true, color: C.navy } },
      { text: 'In the same data we independently surfaced real maggot and multiple cockroach reports the vendor’s noisy flag missed entirely.', options: { color: C.ink } },
    ], { x: PAD, y: 5.55, w: 12.3, h: 0.7, fontSize: 13, fontFace: 'Arial', valign: 'top', lineSpacingMultiple: 1.1 })
    footer(s)
    note(s, 'Same noisy-vs-clean pattern as food safety, made concrete. Their Alert-Bug fires on travel idioms, a drink name, and typos; ours hits 99% precision and catches real reports they missed. Precision is what earns operator trust.')
  }

  // ── What it means / productized ────────────────────────────────────────────
  {
    const s = pptx.addSlide()
    s.addShape(shape.rect, { x: 0, y: 0, w: W, h: H, fill: { color: C.navy }, line: { width: 0 } })
    s.addShape(shape.rect, { x: 0, y: 0, w: 0.14, h: H, fill: { color: C.orange }, line: { width: 0 } })
    dnWordmark(s, W - 3.3, 0.45, 14)
    s.addText('WHAT THIS MEANS', { x: PAD, y: 0.6, w: 9, h: 0.3, fontSize: 12, color: C.tealLight, bold: true, charSpacing: 2, fontFace: 'Arial' })
    s.addText(mode === 'alerts' ? 'Alerts your operators can trust' : 'A classifier pre-trained on your customers', { x: PAD, y: 0.95, w: 11.8, h: 0.7, fontSize: 26, color: C.white, bold: true, fontFace: 'Arial' })
    const pts: [string, string][] = mode === 'alerts'
      ? [
          ['Precision over noise.', 'We fire on real hazards, not negativity — ~99% precise on pests, and the food-safety flag means something again.'],
          ['Severity built in.', 'A crisis / alert flag surfaces safety failures the moment they appear in the text — not at quarter-end.'],
          ['Every alert drills to a quote.', 'Each flag traces to the verbatim review behind it — auditable, escalatable, defensible.'],
          ['Runs continuously.', 'On every new review, refreshed on a schedule — across your whole footprint.'],
        ]
      : [
          ['Built from your words.', `A 1,017-phrase library machine-generated from ${possessive} own reviews — your customers’ vocabulary, not a guess.`],
          ['More coverage, less noise.', isCap ? 'Three lenses on every review: structured topics, named specifics, and emergent themes with sentiment.' : '98.6% of reviews tagged vs 95.3%; we reproduce 90.4% of the vendor’s topics and drop the 20.8% “TEST” leak.'],
          ['Precise where it counts.', isCap ? 'A severity flag surfaces safety and service failures the moment they appear — auditable to the quote.' : '62% of the vendor’s food-safety alerts are false alarms; ours are ~99% precise. Alerts your team can act on.'],
          ['Live, in your dashboard.', 'Classified at upload, viewable in-app — axis & sub rates, sentiment, and severity alerts — refreshed continuously.'],
        ]
    pts.forEach((p, i) => {
      const y = 2.0 + i * 1.05
      s.addShape(shape.rect, { x: PAD, y: y + 0.06, w: 0.32, h: 0.32, fill: { color: C.gold }, line: { width: 0 } })
      s.addText([
        { text: p[0] + '  ', options: { bold: true, color: C.tealLight } },
        { text: p[1], options: { color: C.white } },
      ], { x: PAD + 0.55, y, w: 11.6, h: 0.95, fontSize: 14.5, fontFace: 'Arial', valign: 'top', lineSpacingMultiple: 1.1 })
    })
    footer(s)
    note(s, 'Close on the productized reality: this is not a one-off study — it’s a live capability in the dashboard, classified at upload, refreshed continuously, every number auditable to a quote.')
  }
}
