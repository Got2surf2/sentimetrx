/* eslint-disable */
// Competitive review-intelligence deck — Ruth's Chris vs Capital Grille.
// The spine is a THREE-LENS capability ladder, demonstrated on the head-to-head:
//   Lens 1 · CLASSIFY  — fixed 7-axis taxonomy (structured, comparable, auditable)
//   Lens 2 · EXTRACT   — entity catalog (the specific dishes/drinks guests name)
//   Lens 3 · UNDERSTAND— NLU theme-mining (emergent themes + sentiment; beyond
//                        a basket-of-words classifier)
// Lands on: "better, more actionable insights." ONE builder, mirrored by --brand
// (protagonist = "you"; the other = the peer they're benchmarked against).
//
// All figures are real:
//   · taxonomy mention rates → scripts/pilot-rc-cg-compare.ts (keyword tier)
//   · entity mention counts   → count_entity_terms over dataset_rows_flat
//   · emergent themes         → cached theme_model + count_theme_matches (the
//                               same engine behind the in-app Theme Analysis panel)
// Denominator = reviews with written text (RC 20,699 · CG 10,652).
// NOTE: theme models are mined PER BRAND, so theme %s are not cross-brand
// comparable (that is Lens 1's job) — Lens 3 shows each brand's OWN themes.
//
// Run:  node_modules/.bin/tsx scripts/pilot-rc-cg-deck.ts --brand rc|cg
//       (no flag → builds BOTH to ~/Downloads)

import PptxGenJS from 'pptxgenjs'
import os from 'os'
import path from 'path'

const C = {
  navy: '0D2B45', teal: '0F7173', tealLight: '4DBFC1', orange: 'E85A1A',
  gold: 'E8B84B', white: 'FFFFFF', slate: '8FA3AE', slateDark: '5E7480', slateLight: 'E8EDEF',
  card: 'F4F7F8', divider: 'D4DDE2', ink: '12303F',
  green: '059669', red: 'DC2626', amber: 'D97706',
}
const W = 13.33, H = 7.5, PAD = 0.5

// ── real data (rc / cg) ──────────────────────────────────────────────────────
const REVIEWS = { rc: 20699, cg: 10652 }          // reviews with written text
const TOTAL_REVIEWS = '31,000+'                    // classified, both brands
const TOTAL_ROWS = '42,000'                        // all rows pulled

// L1 — axis-level mention rate (% of reviews touching the axis)
const AXES: { label: string; rc: number; cg: number }[] = [
  { label: 'Service — who served you',        rc: 81.5, cg: 79.6 },  // touchpoint
  { label: 'How they did — staff attributes', rc: 90.7, cg: 90.2 },  // attribute
  { label: 'Food — what you ate',             rc: 39.1, cg: 44.4 },  // product
  { label: 'Drinks — bar & wine',             rc: 10.7, cg: 16.4 },  // beverage
  { label: 'Room — ambiance & décor',         rc: 21.2, cg: 24.5 },  // ambiance
  { label: 'Occasion — when & why',           rc: 30.0, cg: 31.8 },  // context
  { label: 'Outcome — will they return',      rc: 87.5, cg: 87.5 },  // outcome
]

// L2 — sub-topic mention rate (% of reviews), "praise" topics only.
const SUBS: { label: string; rc: number; cg: number }[] = [
  { label: 'Warm / friendly staff',      rc: 67.1, cg: 64.0 },
  { label: 'The server, by name',        rc: 79.9, cg: 77.9 },
  { label: 'Anniversaries & milestones', rc:  9.2, cg:  8.8 },
  { label: 'Sense of place / location',  rc:  6.0, cg:  5.0 },
  { label: 'Seafood',                    rc:  9.0, cg: 14.1 },
  { label: 'Wine list',                  rc:  2.9, cg:  5.8 },
  { label: 'Appetizers',                 rc:  5.8, cg:  8.2 },
  { label: 'Soup',                       rc:  1.3, cg:  3.3 },
  { label: 'Décor & atmosphere',         rc: 14.6, cg: 18.1 },
  { label: 'Desserts',                   rc:  6.9, cg:  9.1 },
  { label: 'Lunch service',              rc:  1.1, cg:  4.9 },
]

// Entity catalog — raw review-mention counts; pct computed from REVIEWS base.
const DISHES: { label: string; rc: number; cg: number }[] = [
  { label: 'Filet Mignon',           rc: 135, cg: 270 },
  { label: 'Ribeye',                 rc: 571, cg: 341 },
  { label: 'Bone-in Ribeye',         rc:  14, cg:  56 },
  { label: 'Calamari',               rc: 162, cg: 238 },
  { label: 'Lobster Bisque',         rc:  89, cg: 171 },
  { label: 'Lobster Mac & Cheese',   rc: 288, cg: 211 },
  { label: 'Lamb Chops',             rc: 169, cg: 158 },
  { label: 'Sea Bass',               rc: 131, cg: 126 },
  { label: 'Mashed Potatoes',        rc: 524, cg: 253 },
  { label: 'Creamed Spinach',        rc: 291, cg: 104 },
  { label: 'Sweet Potato Casserole', rc: 243, cg:   0 },
  { label: 'Bread Pudding',          rc: 113, cg:   1 },
  { label: 'Cheesecake',             rc: 326, cg: 211 },
]
const DRINKS: { label: string; rc: number; cg: number }[] = [
  { label: 'Stoli Doli',          rc:  0, cg: 32 },
  { label: 'Espresso Martini',    rc: 38, cg: 35 },
  { label: 'Old Fashioned',       rc: 90, cg: 62 },
  { label: 'Pomegranate Martini', rc: 29, cg:  0 },
]

// Lens 3 — emergent themes (cached theme_model + count_theme_matches). Per brand;
// pct = share of that brand's reviews matching the mined keyword set.
type Sent = 'positive' | 'mixed' | 'negative'
const THEMES: Record<'rc' | 'cg', { name: string; sentiment: Sent; pct: number }[]> = {
  rc: [
    { name: 'Special Occasions & Celebrations', sentiment: 'positive', pct: 23.8 },
    { name: 'Service Excellence',               sentiment: 'positive', pct: 22.1 },
    { name: 'Operational Issues',               sentiment: 'mixed',    pct: 20.5 },
    { name: 'Food Quality & Preparation',       sentiment: 'mixed',    pct: 19.0 },
    { name: 'Atmosphere & Ambiance',            sentiment: 'positive', pct: 16.8 },
    { name: 'Return Intent & Loyalty',          sentiment: 'positive', pct: 15.5 },
    { name: 'Value & Pricing',                  sentiment: 'mixed',    pct:  5.1 },
  ],
  cg: [
    { name: 'Food Quality & Preparation',       sentiment: 'mixed',    pct: 68.7 },
    { name: 'Service Quality',                  sentiment: 'mixed',    pct: 68.1 },
    { name: 'Overall Experience & Satisfaction',sentiment: 'positive', pct: 64.9 },
    { name: 'Special Occasions & Celebrations', sentiment: 'positive', pct: 24.5 },
    { name: 'Atmosphere & Ambiance',            sentiment: 'positive', pct: 23.3 },
    { name: 'Value & Pricing',                  sentiment: 'mixed',    pct: 12.1 },
    { name: 'Portion Size & Presentation',      sentiment: 'mixed',    pct: 12.0 },
  ],
}

// ── per-brand orientation ────────────────────────────────────────────────────
type Key = 'rc' | 'cg'
const BRANDS: Record<Key, { label: string; full: string; possessive: string }> = {
  rc: { label: "Ruth's Chris",   full: 'Ruth’s Chris Steak House', possessive: 'Ruth’s Chris’s' },
  cg: { label: 'Capital Grille', full: 'The Capital Grille',       possessive: 'Capital Grille’s' },
}

function buildDeck(meKey: Key, outPath: string) {
  const themKey: Key = meKey === 'rc' ? 'cg' : 'rc'
  const ME = BRANDS[meKey], THEM = BRANDS[themKey]
  const mine = (d: { rc: number; cg: number }) => d[meKey]
  const theirs = (d: { rc: number; cg: number }) => d[themKey]
  const rate = (n: number, who: Key) => 100 * n / REVIEWS[who]   // entity count → %

  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'W', width: W, height: H })
  pptx.layout = 'W'

  const wordmark = (s: any, x: number, y: number, size: number, onDark = false) =>
    s.addText(
      [{ text: 'Senti', options: { color: onDark ? C.white : C.navy, bold: true } },
       { text: 'metrx', options: { color: C.teal, bold: true } }],
      { x, y, w: 3.2, h: 0.4, fontSize: size, align: 'left', fontFace: 'Arial' })

  const header = (s: any, kicker: string, title: string) => {
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: C.card }, line: { width: 0 } })
    s.addText(kicker.toUpperCase(), { x: PAD, y: 0.42, w: 9.5, h: 0.3, fontSize: 11, color: C.teal, bold: true, charSpacing: 2, fontFace: 'Arial' })
    s.addText(title, { x: PAD, y: 0.7, w: 10.6, h: 0.7, fontSize: 25, color: C.navy, bold: true, fontFace: 'Arial' })
    s.addShape(pptx.ShapeType.rect, { x: PAD, y: 1.5, w: 1.1, h: 0.06, fill: { color: C.orange }, line: { width: 0 } })
    wordmark(s, W - 3.0, 0.45, 14)
  }
  const footer = (s: any, n: number) => {
    s.addText(`Sentimetrx  ·  sentimetrx.ai  ·  Prepared for ${ME.full}`, { x: PAD, y: H - 0.42, w: 10, h: 0.3, fontSize: 9, color: C.slate, fontFace: 'Arial' })
    s.addText(String(n), { x: W - 1.0, y: H - 0.42, w: 0.5, h: 0.3, fontSize: 9, color: C.slate, align: 'right', fontFace: 'Arial' })
  }
  const legend = (s: any, x: number, y: number) => {
    s.addShape(pptx.ShapeType.rect, { x, y: y + 0.04, w: 0.22, h: 0.16, fill: { color: C.teal }, line: { width: 0 } })
    s.addText(ME.label, { x: x + 0.3, y, w: 2.6, h: 0.24, fontSize: 11, bold: true, color: C.navy, fontFace: 'Arial', valign: 'middle' })
    s.addShape(pptx.ShapeType.rect, { x: x + 3.0, y: y + 0.04, w: 0.22, h: 0.16, fill: { color: C.slate }, line: { width: 0 } })
    s.addText(THEM.label, { x: x + 3.3, y, w: 2.6, h: 0.24, fontSize: 11, bold: true, color: C.slateDark, fontFace: 'Arial', valign: 'middle' })
  }
  const sentPill = (s: any, x: number, y: number, sent: Sent) => {
    const col = sent === 'positive' ? C.green : sent === 'negative' ? C.red : C.amber
    s.addShape(pptx.ShapeType.roundRect, { x, y, w: 0.95, h: 0.3, rectRadius: 0.15, fill: { color: col }, line: { width: 0 } })
    s.addText(sent === 'mixed' ? 'MIXED' : sent === 'negative' ? 'NEG' : 'POSITIVE', { x, y, w: 0.95, h: 0.3, fontSize: 8.5, bold: true, color: C.white, align: 'center', valign: 'middle', fontFace: 'Arial', charSpacing: 1 })
  }

  // ── 1. Title ────────────────────────────────────────────────────────────────
  {
    const s = pptx.addSlide()
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: C.navy }, line: { width: 0 } })
    s.addShape(pptx.ShapeType.rect, { x: 0, y: H - 0.5, w: W, h: 0.5, fill: { color: C.teal }, line: { width: 0 } })
    wordmark(s, PAD, 0.6, 22, true)
    s.addText('Competitive Review Intelligence', { x: PAD, y: 2.35, w: 11.5, h: 0.6, fontSize: 18, color: C.tealLight, bold: true, fontFace: 'Arial' })
    s.addText(`Three ways to read\n${ME.possessive} reviews — and the competition’s`, { x: PAD, y: 2.95, w: 11.8, h: 1.7, fontSize: 38, color: C.white, bold: true, fontFace: 'Arial', lineSpacingMultiple: 1.0 })
    s.addText([
      { text: 'Classify', options: { color: C.tealLight, bold: true } },
      { text: '  ·  ', options: { color: C.slate } },
      { text: 'Extract', options: { color: C.tealLight, bold: true } },
      { text: '  ·  ', options: { color: C.slate } },
      { text: 'Understand', options: { color: C.tealLight, bold: true } },
    ], { x: PAD, y: 4.75, w: 11.8, h: 0.4, fontSize: 17, fontFace: 'Arial' })
    s.addText(`Benchmarked against ${THEM.label}  ·  ${TOTAL_REVIEWS} public reviews  ·  June 2026`, { x: PAD, y: 5.25, w: 11.8, h: 0.4, fontSize: 13, color: C.slateLight, fontFace: 'Arial' })
    s.addText(`Prepared for ${ME.full}`, { x: PAD, y: H - 0.46, w: 9, h: 0.4, fontSize: 12, color: C.white, bold: true, fontFace: 'Arial' })
  }

  // ── 2. Three lenses ───────────────────────────────────────────────────────────
  {
    const s = pptx.addSlide()
    header(s, 'How we read a review', 'Three lenses on the same sentence')
    const lenses = [
      { n: '1', t: 'CLASSIFY', c: C.teal, d: 'Every review onto one fixed 7-axis schema — service, food, drinks, room, occasion, outcome. Complete, comparable, auditable.' },
      { n: '2', t: 'EXTRACT', c: C.navy, d: 'The specific things guests name — dishes, drinks, places — pulled straight from the text. Detail a category label can’t hold.' },
      { n: '3', t: 'UNDERSTAND', c: C.orange, d: 'Themes mined by reading for meaning (NLU) — not matching a word list. Emergent topics, each with its own sentiment.' },
    ]
    lenses.forEach((l, i) => {
      const x = PAD + i * 4.1
      s.addShape(pptx.ShapeType.roundRect, { x, y: 1.95, w: 3.8, h: 2.75, rectRadius: 0.08, fill: { color: C.white }, line: { color: C.divider, width: 1 } })
      s.addShape(pptx.ShapeType.rect, { x, y: 1.95, w: 3.8, h: 0.12, fill: { color: l.c }, line: { width: 0 } })
      s.addText(`LENS ${l.n}`, { x: x + 0.25, y: 2.25, w: 3.3, h: 0.3, fontSize: 11, bold: true, color: C.slate, charSpacing: 2, fontFace: 'Arial' })
      s.addText(l.t, { x: x + 0.25, y: 2.5, w: 3.3, h: 0.5, fontSize: 22, bold: true, color: l.c, fontFace: 'Arial' })
      s.addText(l.d, { x: x + 0.25, y: 3.1, w: 3.35, h: 1.5, fontSize: 12, color: C.ink, fontFace: 'Arial', lineSpacingMultiple: 1.12 })
    })
    s.addShape(pptx.ShapeType.roundRect, { x: PAD, y: 5.05, w: 12.3, h: 1.2, rectRadius: 0.08, fill: { color: C.navy }, line: { width: 0 } })
    s.addText([
      { text: 'No survey. No panel.  ', options: { bold: true, color: C.gold } },
      { text: `We ran all three lenses over ${REVIEWS[meKey].toLocaleString()} of ${ME.possessive} public reviews and ${REVIEWS[themKey].toLocaleString()} of ${THEM.label}’s — ${TOTAL_REVIEWS} in all, ${TOTAL_ROWS} reviews pulled. Each lens on the pages that follow; together they’re the point.`, options: { color: C.white } },
    ], { x: PAD + 0.3, y: 5.18, w: 11.7, h: 0.95, fontSize: 13.5, fontFace: 'Arial', valign: 'middle', lineSpacingMultiple: 1.12 })
    footer(s, 2)
  }

  // ── 3. Lens 1 — macro fingerprint (L1 bars) ──────────────────────────────────
  {
    const s = pptx.addSlide()
    header(s, 'Lens 1 · Classify', 'Structured tagging, every review, both brands')
    legend(s, PAD, 1.65)
    const topY = 2.05, rowH = 0.55, trackX = 5.4, trackW = 6.6, scale = 100
    AXES.forEach((a, i) => {
      const y = topY + i * rowH
      s.addText(a.label, { x: PAD, y, w: 4.7, h: 0.46, fontSize: 12, color: C.navy, bold: true, valign: 'middle', fontFace: 'Arial' })
      const mePct = mine(a), themPct = theirs(a), bh = 0.17
      s.addShape(pptx.ShapeType.rect, { x: trackX, y: y + 0.04, w: Math.max(0.02, trackW * mePct / scale), h: bh, fill: { color: C.teal }, line: { width: 0 } })
      s.addShape(pptx.ShapeType.rect, { x: trackX, y: y + 0.04 + bh + 0.03, w: Math.max(0.02, trackW * themPct / scale), h: bh, fill: { color: C.slate }, line: { width: 0 } })
      s.addText(`${mePct.toFixed(0)}%`, { x: trackX + trackW + 0.05, y: y + 0.02, w: 0.9, h: bh + 0.04, fontSize: 10.5, bold: true, color: C.teal, valign: 'middle', fontFace: 'Arial' })
      s.addText(`${themPct.toFixed(0)}%`, { x: trackX + trackW + 0.05, y: y + 0.04 + bh + 0.01, w: 0.9, h: bh + 0.04, fontSize: 10.5, bold: true, color: C.slateDark, valign: 'middle', fontFace: 'Arial' })
    })
    s.addShape(pptx.ShapeType.roundRect, { x: PAD, y: 6.05, w: 12.3, h: 0.85, rectRadius: 0.06, fill: { color: C.slateLight }, line: { width: 0 } })
    s.addText([
      { text: 'One clean schema, every review — and applied to your competitor too, not just your own four walls.  ', options: { bold: true, color: C.navy } },
      { text: `At the axis level the two brands look alike; the differences that matter are one level down. Because it’s structured, you get exact head-to-head deltas — next.`, options: { color: C.ink } },
    ], { x: PAD + 0.3, y: 6.12, w: 11.7, h: 0.7, fontSize: 12, fontFace: 'Arial', valign: 'middle', lineSpacingMultiple: 1.08 })
    footer(s, 3)
  }

  // two-column delta card (Lens 1 payoff)
  const deltaCol = (s: any, x: number, head: string, color: string, rows: { label: string; me: number; them: number }[]) => {
    s.addShape(pptx.ShapeType.roundRect, { x, y: 1.95, w: 5.85, h: 3.95, rectRadius: 0.08, fill: { color: C.white }, line: { color: C.divider, width: 1 } })
    s.addShape(pptx.ShapeType.rect, { x, y: 1.95, w: 5.85, h: 0.5, fill: { color }, line: { width: 0 } })
    s.addText(head, { x: x + 0.2, y: 1.95, w: 5.45, h: 0.5, fontSize: 13, bold: true, color: C.white, valign: 'middle', fontFace: 'Arial' })
    rows.forEach((r, i) => {
      const ry = 2.62 + i * 0.62
      s.addText(r.label, { x: x + 0.25, y: ry, w: 3.5, h: 0.5, fontSize: 12, color: C.navy, bold: true, valign: 'middle', fontFace: 'Arial' })
      s.addText([
        { text: `${r.me.toFixed(1)}% `, options: { bold: true, color: C.teal } },
        { text: `vs ${r.them.toFixed(1)}%`, options: { color: C.slateDark } },
      ], { x: x + 3.6, y: ry, w: 2.05, h: 0.5, fontSize: 12, align: 'right', valign: 'middle', fontFace: 'Arial' })
    })
  }

  // ── 4. Lens 1 — the deltas (where each leads) ─────────────────────────────────
  {
    const s = pptx.addSlide()
    header(s, 'Lens 1 · Classify', 'The payoff: exact head-to-head, both directions')
    const lead = SUBS.filter(d => mine(d) - theirs(d) > 0).sort((a, b) => (mine(b) - theirs(b)) - (mine(a) - theirs(a))).slice(0, 5)
      .map(d => ({ label: d.label, me: mine(d), them: theirs(d) }))
    const gap = SUBS.filter(d => theirs(d) - mine(d) > 0).sort((a, b) => (theirs(b) - mine(b)) - (theirs(a) - mine(a))).slice(0, 5)
      .map(d => ({ label: d.label, me: mine(d), them: theirs(d) }))
    deltaCol(s, PAD, `Where ${ME.label} leads`, C.teal, lead)
    deltaCol(s, PAD + 6.05, `Where ${THEM.label} leads`, C.slateDark, gap)
    s.addText([
      { text: 'Your equity, and your open ground.  ', options: { bold: true, color: C.navy } },
      { text: `On the left, the topics your guests raise more — warmth, the people, the moments. On the right, where ${THEM.label} gets more of the conversation — the bar, the seafood, the room. (Their seafood also lands better: 100% positive vs your 75% — a watch-item only the structured pass can size.)`, options: { color: C.ink } },
    ], { x: PAD, y: 6.05, w: 12.3, h: 0.95, fontSize: 12.5, fontFace: 'Arial', valign: 'top', lineSpacingMultiple: 1.1 })
    footer(s, 4)
  }

  // ── 5. Lens 2 — named-dish fingerprint (entities) ─────────────────────────────
  {
    const s = pptx.addSlide()
    header(s, 'Lens 2 · Extract', 'The specific things guests name')
    const items = [...DISHES, ...DRINKS].map(d => ({ d, mp: rate(mine(d), meKey), tp: rate(theirs(d), themKey) }))
      .sort((a, b) => (b.mp - b.tp) - (a.mp - a.tp))
    const yours = items.slice(0, 5)
    const theirsSig = [...items].reverse().slice(0, 5)
    const col = (x: number, head: string, color: string, rows: { d: any; mp: number; tp: number }[]) => {
      s.addShape(pptx.ShapeType.roundRect, { x, y: 1.95, w: 5.85, h: 3.55, rectRadius: 0.08, fill: { color: C.white }, line: { color: C.divider, width: 1 } })
      s.addShape(pptx.ShapeType.rect, { x, y: 1.95, w: 5.85, h: 0.5, fill: { color }, line: { width: 0 } })
      s.addText(head, { x: x + 0.2, y: 1.95, w: 5.45, h: 0.5, fontSize: 13, bold: true, color: C.white, valign: 'middle', fontFace: 'Arial' })
      rows.forEach((r, i) => {
        const ry = 2.62 + i * 0.55
        s.addText(r.d.label, { x: x + 0.25, y: ry, w: 3.5, h: 0.45, fontSize: 12, color: C.navy, bold: true, valign: 'middle', fontFace: 'Arial' })
        const them0 = r.tp < 0.005
        s.addText([
          { text: `${r.mp.toFixed(1)}% `, options: { bold: true, color: C.teal } },
          { text: them0 ? 'vs —' : `vs ${r.tp.toFixed(1)}%`, options: { color: them0 ? C.orange : C.slateDark } },
        ], { x: x + 3.6, y: ry, w: 2.05, h: 0.45, fontSize: 12, align: 'right', valign: 'middle', fontFace: 'Arial' })
      })
    }
    col(PAD, `${ME.possessive} signatures`, C.teal, yours)
    col(PAD + 6.05, `Where ${THEM.label} leads`, C.slateDark, theirsSig)
    s.addText('Mention rate = % of reviews that name the item — a vocabulary fingerprint of what guests write about, not a sales figure. “—” = effectively never named for that brand.', { x: PAD, y: 5.65, w: 12.3, h: 0.45, fontSize: 10, italic: true, color: C.slate, fontFace: 'Arial', lineSpacingMultiple: 1.05 })
    s.addText([
      { text: 'Guests name what makes a brand a brand.  ', options: { bold: true, color: C.navy } },
      { text: `Pulled automatically from raw text — no menu upload — these signatures are exactly what a fixed category (“food mentioned”) throws away.`, options: { color: C.ink } },
    ], { x: PAD, y: 6.3, w: 12.3, h: 0.6, fontSize: 12.5, fontFace: 'Arial', valign: 'top', lineSpacingMultiple: 1.08 })
    footer(s, 5)
  }

  // ── 6. Lens 3 — emergent themes (NLU) ─────────────────────────────────────────
  {
    const s = pptx.addSlide()
    header(s, 'Lens 3 · Understand', `Themes that emerged from reading ${ME.possessive} reviews`)
    const themes = THEMES[meKey]
    const maxPct = Math.max(...themes.map(t => t.pct))
    const topY = 1.95, rowH = 0.52, barX = 6.2, barW = 4.2
    themes.forEach((t, i) => {
      const y = topY + i * rowH
      sentPill(s, PAD, y + 0.06, t.sentiment)
      s.addText(t.name, { x: PAD + 1.1, y, w: 4.9, h: 0.42, fontSize: 12.5, color: C.navy, bold: true, valign: 'middle', fontFace: 'Arial' })
      const col = t.sentiment === 'positive' ? C.teal : C.amber
      s.addShape(pptx.ShapeType.rect, { x: barX, y: y + 0.11, w: Math.max(0.05, barW * t.pct / maxPct), h: 0.2, fill: { color: col }, line: { width: 0 } })
      s.addText(`${t.pct.toFixed(0)}%`, { x: barX + barW + 0.1, y, w: 0.8, h: 0.42, fontSize: 11, bold: true, color: C.ink, valign: 'middle', fontFace: 'Arial' })
    })
    const mixed = themes.filter(t => t.sentiment === 'mixed').map(t => t.name)
    s.addShape(pptx.ShapeType.roundRect, { x: PAD, y: 5.7, w: 12.3, h: 1.2, rectRadius: 0.08, fill: { color: C.slateLight }, line: { width: 0 } })
    s.addText([
      { text: 'The colour is the signal.  ', options: { bold: true, color: C.navy } },
      { text: `These themes weren’t chosen by us — they emerged from the language itself, each carrying its own sentiment. The amber “mixed” themes (${mixed.slice(0, 3).join(', ')}) are where your guests are split — the exact places to act. A basket-of-words classifier tells you a topic appeared; reading for meaning tells you how guests feel about it.`, options: { color: C.ink } },
    ], { x: PAD + 0.3, y: 5.78, w: 11.7, h: 1.05, fontSize: 12, fontFace: 'Arial', valign: 'middle', lineSpacingMultiple: 1.1 })
    s.addText('Share of this brand’s reviews matching each theme. Themes are mined per brand, so they’re not cross-brand comparable — that’s Lens 1’s job.', { x: PAD, y: 5.42, w: 12.3, h: 0.25, fontSize: 9, italic: true, color: C.slate, fontFace: 'Arial' })
    footer(s, 6)
  }

  // ── 7. The payoff ─────────────────────────────────────────────────────────────
  {
    const s = pptx.addSlide()
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: C.navy }, line: { width: 0 } })
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.14, h: H, fill: { color: C.orange }, line: { width: 0 } })
    wordmark(s, W - 3.0, 0.45, 14, true)
    s.addText('WHY IT MATTERS', { x: PAD, y: 0.6, w: 9, h: 0.3, fontSize: 12, color: C.tealLight, bold: true, charSpacing: 2, fontFace: 'Arial' })
    s.addText('Three lenses, one source of truth', { x: PAD, y: 0.95, w: 11.8, h: 0.7, fontSize: 28, color: C.white, bold: true, fontFace: 'Arial' })
    const points: [string, string][] = [
      ['Classify.', 'The structured, auditable tagging you rely on today — done completely, every review, and across any brand you choose, not just your own.'],
      ['Extract.', 'The specific dishes, drinks and places guests actually name — the detail flat category labels can’t carry.'],
      ['Understand.', 'Themes mined by reading for meaning, each with its sentiment — surfacing issues (and the where-opinion-splits) that no fixed bucket would ever name.'],
    ]
    points.forEach((p, i) => {
      const y = 2.05 + i * 1.0
      s.addShape(pptx.ShapeType.rect, { x: PAD, y: y + 0.06, w: 0.32, h: 0.32, fill: { color: C.gold }, line: { width: 0 } })
      s.addText([
        { text: p[0] + '  ', options: { bold: true, color: C.tealLight } },
        { text: p[1], options: { color: C.white } },
      ], { x: PAD + 0.55, y, w: 11.6, h: 0.9, fontSize: 14.5, fontFace: 'Arial', valign: 'top', lineSpacingMultiple: 1.1 })
    })
    s.addShape(pptx.ShapeType.roundRect, { x: PAD, y: 5.35, w: 12.3, h: 1.0, rectRadius: 0.08, fill: { color: C.teal }, line: { width: 0 } })
    s.addText([
      { text: 'Together: ', options: { bold: true, color: C.navy } },
      { text: 'better — and more actionable — insights than a category count alone.', options: { bold: true, color: C.white } },
    ], { x: PAD + 0.3, y: 5.35, w: 11.7, h: 1.0, fontSize: 18, fontFace: 'Arial', valign: 'middle' })
    footer(s, 7)
  }

  return pptx.writeFile({ fileName: outPath }).then(() => console.log('Wrote ' + outPath))
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const getFlag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const outFlag = getFlag('--out')
const brandFlag = (getFlag('--brand') as Key | undefined)
const stamp = '2026-06-02'
const fname = (k: Key) => `sentimetrx-competitive-${k === 'rc' ? 'ruths-chris' : 'capital-grille'}-${stamp}.pptx`
const dl = (k: Key) => outFlag ?? path.join(os.homedir(), 'Downloads', fname(k))

async function run() {
  const targets: Key[] = brandFlag ? [brandFlag] : ['rc', 'cg']
  for (const k of targets) await buildDeck(k, dl(k))
}
run().catch(e => { console.error(e); process.exit(1) })
