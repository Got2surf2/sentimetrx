// lib/pptx/salesPitchDeck.ts
// Reusable Sentimetrx SALES-PITCH TEMPLATE — a standard capability deck we build
// any client pitch from, so we're not reinventing the deck each time. House style
// mirrors the EA membership deck (navy header bands, sarinaBlue accent, orange
// kicker lines, navy stat cards, Sentimetrx-forward branding + "powered by
// Datanautix" footer).
//
// The SPINE is fixed (cover → two ways to hear → why conversational → the
// conversational advantage → try-it → the ask). The EVIDENCE sections (KPIs,
// leaderboard, diagnosis, dimensions/themes coin, themes, early-warning) are all
// OPTIONAL and data-driven — fill whichever a given client's data supports.
//
// New client = a new SalesPitchConfig object (copy SAMPLE_BAREBURGER, swap the
// data). Rendered by the admin-gated /api/sales-pitch-deck route.
//
// Async because it embeds a scannable QR (survey.url) via qrcode.

import QRCode from 'qrcode'

// ── Brand palette (Sentimetrx-forward) ───────────────────────────────────────
const DN = {
  navy: '0D2B45', navyMid: '0F3A54', sarina: '00B4D8', orange: 'E8632A',
  gold: 'E8B84B', slate: '8FA3AE', slateLight: 'E8EDEF', teal: '0F7173',
  ink: '0D2B45', white: 'FFFFFF',
  green: '16A34A', greenTint: 'D1FAE5', red: 'DC2626', redTint: 'FEE2E2',
  amber: 'D97706', amberTint: 'FEF3C7',
}
const W = 13.33, H = 7.5, AF = 'Arial'

// ── Config types ─────────────────────────────────────────────────────────────
export interface StatTile { value: string; label: string; sub?: string; color?: string }
export interface LeaderRow { name: string; rating: string; n: string; neg: string; good: boolean }
export interface DiagRow { name: string; rating: string; note: string; tone?: 'bad' | 'warn' }
export interface ThemeRow { name: string; positive: boolean; stat: string; keywords: string }

export interface SalesPitchConfig {
  client: string
  filename: string
  /** Informational — which evidence modules a copy of this config tends to fill.
   *  'restaurant' pitches include leaderboard/diagnosis/coin/themes/early-warning;
   *  'generic' pitches lean on the universal spine + KPIs. Not enforced — any
   *  module present renders regardless. */
  vertical?: 'restaurant' | 'generic'
  cover: { title: string; subtitle: string; meta: string }
  /** "Two ways to hear your guests" — the spine. */
  twoModes: {
    kicker?: string
    listenTitle: string; listenBullets: string[]
    askTitle: string; askBullets: string[]
    band: string
    takeaway: string
  }
  /** Optional shown-vs-locked teaser (review-history engagements). */
  teaser?: { headerTitle: string; kicker: string; shownTitle: string; shownBullets: string[]; lockedTitle: string; lockedBullets: string[]; takeaway: string }
  /** Optional at-a-glance KPI grid (3-wide). */
  kpis?: { headerTitle: string; kicker: string; tiles: StatTile[]; takeaway: string }
  /** Optional stars-&-dogs leaderboard. `columns` defaults to the restaurant set. */
  leaderboard?: { headerTitle: string; kicker: string; columns?: [string, string, string, string]; rows: LeaderRow[]; takeaway: string }
  /** Optional score-decomposition table. `columns` defaults to the restaurant set. */
  diagnosis?: { headerTitle: string; kicker: string; columns?: [string, string, string]; rows: DiagRow[]; takeaway: string }
  /** Optional Dimensions↔Themes "coin" slide (taxonomy differentiator). */
  coin?: { headerTitle: string; kicker: string; leftTitle: string; leftBullets: string[]; rightTitle: string; rightBullets: string[]; takeaway: string }
  /** Optional AI-mined themes rows. */
  themes?: { headerTitle: string; kicker: string; rows: ThemeRow[]; takeaway: string }
  /** Optional early-warning stat grid. */
  earlyWarning?: { headerTitle: string; kicker: string; tiles: StatTile[]; takeaway: string }
  /** Why conversational (the 40–50% data-loss argument). Defaults provided. */
  whyConversational?: { headerTitle: string; kicker: string; statBig: string; statLabel: string; statSource: string; deadEnds: string; why: string; takeaway: string }
  /** The static-vs-conversational advantage (client-flavored, illustrative). */
  advantage?: { staticLines: string; convLines: string; takeaway: string }
  /** Optional try-it survey slide with a scannable QR. */
  survey?: { url: string; bullets: string[]; takeaway: string }
  /** The closing ask. */
  ask: { title: string; subtitle: string; rows: { label: string; text: string }[]; cta: string }
}

// ── Primitives ───────────────────────────────────────────────────────────────
function header(s: any, title: string) {
  s.addShape('rect', { x: 0, y: 0, w: W, h: 1.0, fill: { color: DN.navy } })
  s.addText(title, { x: 0.6, y: 0.15, w: 9.8, h: 0.7, fontSize: 27, fontFace: AF, color: DN.white, bold: true, valign: 'middle' })
  s.addText('Sentimetrx', { x: W - 3.0, y: 0.15, w: 2.7, h: 0.7, fontSize: 16, fontFace: AF, color: DN.sarina, bold: true, align: 'right', valign: 'middle' })
  s.addShape('rect', { x: 0, y: 1.0, w: W, h: 0.04, fill: { color: DN.sarina } })
}
function footer(s: any, client: string, pg: number) {
  s.addText('sentimetrx.ai  ·  powered by Datanautix', { x: 0.5, y: H - 0.4, w: 6, h: 0.3, fontSize: 9, color: DN.slate, fontFace: AF })
  s.addText(`Prepared for ${client}  ·  Confidential`, { x: W - 5.2, y: H - 0.4, w: 3.9, h: 0.3, fontSize: 9, color: DN.slate, fontFace: AF, align: 'right' })
  s.addText(`${pg}`, { x: W - 1.0, y: H - 0.4, w: 0.5, h: 0.3, fontSize: 9, color: DN.slate, fontFace: AF, align: 'right' })
}
function kicker(s: any, text: string, color = DN.orange) {
  s.addText(text, { x: 0.6, y: 1.22, w: 12.1, h: 0.55, fontSize: 21, fontFace: AF, color, bold: true, valign: 'middle' })
}
function takeaway(s: any, text: string, color = DN.navy) {
  s.addText(text, { x: 0.6, y: 6.55, w: 12.1, h: 0.5, fontSize: 15, fontFace: AF, color, bold: true, italic: true, align: 'center', valign: 'middle' })
}
function panel(s: any, x: number, y: number, w: number, h: number, topStrip: string, heading: string, headingColor: string, bullets: string[], bodyColor = DN.ink, fontSize = 14) {
  s.addShape('rect', { x, y, w, h, fill: { color: DN.slateLight }, rectRadius: 0.12 })
  s.addShape('rect', { x, y, w, h: 0.1, fill: { color: topStrip } })
  s.addText(heading, { x: x + 0.2, y: y + 0.2, w: w - 0.4, h: 0.45, fontSize: 16, fontFace: AF, color: headingColor, bold: true, align: 'center' })
  s.addText(bullets.join('\n'), { x: x + 0.35, y: y + 0.8, w: w - 0.6, h: h - 0.95, fontSize, fontFace: AF, color: bodyColor, bullet: { code: '2022', indent: 16 }, lineSpacing: 22, paraSpaceAfter: 10, valign: 'top' })
}
function statTile(s: any, x: number, y: number, w: number, h: number, t: StatTile) {
  const num = t.color || DN.sarina
  s.addShape('rect', { x, y, w, h, fill: { color: DN.slateLight }, rectRadius: 0.1 })
  s.addShape('rect', { x, y, w, h: 0.09, fill: { color: num } })
  s.addText(t.value, { x, y: y + 0.22, w, h: 0.7, fontSize: 34, fontFace: AF, color: num, bold: true, align: 'center' })
  s.addText(t.label, { x: x + 0.15, y: y + 0.95, w: w - 0.3, h: 0.35, fontSize: 13.5, fontFace: AF, color: DN.navy, bold: true, align: 'center' })
  if (t.sub) s.addText(t.sub, { x: x + 0.12, y: y + 1.28, w: w - 0.24, h: 0.35, fontSize: 10, fontFace: AF, color: DN.slate, align: 'center', italic: true })
}
function statGrid(s: any, tiles: StatTile[]) {
  tiles.slice(0, 6).forEach((t, i) => statTile(s, 0.6 + (i % 3) * 4.06, 2.05 + Math.floor(i / 3) * 1.95, 3.86, 1.75, t))
}

const DEFAULT_WHY = {
  headerTitle: 'Ask: Why Conversational',
  kicker: 'Half of what an open-ended question collects, you can’t use.',
  statBig: '40–50%',
  statLabel: 'of open-ended survey answers carry no usable insight',
  statSource: 'Sentimetrx client data, across studies',
  deadEnds: '“It’s fine.”     “Good.”     “N/A.”     “Love it.”',
  why: 'Not because people have nothing to say — a static form never asks the one follow-up that would surface it. The moment to dig is gone the instant they tap “Next.”',
  takeaway: 'Fix it at analysis time and you’re too late. The fix happens at the moment of collection.',
}

// ── Builder ──────────────────────────────────────────────────────────────────
export async function buildSalesPitchDeck(pptx: any, cfg: SalesPitchConfig) {
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Datanautix'; pptx.company = 'Datanautix'
  pptx.title = `${cfg.client} — Sentimetrx Capability Overview`
  const tx = 0.6, tw = 12.13
  let pg = 0
  const foot = (s: any) => footer(s, cfg.client, pg)

  // 1 · COVER
  const c = pptx.addSlide(); pg++
  c.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.navy } })
  c.addShape('rect', { x: 0, y: 0, w: 0.18, h: H, fill: { color: DN.sarina } })
  c.addText(cfg.cover.title, { x: 0.8, y: 1.55, w: 11.6, h: 1.6, fontSize: 44, fontFace: AF, color: DN.white, bold: true, lineSpacing: 48 })
  c.addText(cfg.cover.subtitle, { x: 0.8, y: 3.2, w: 11.6, h: 1.0, fontSize: 19, fontFace: AF, color: DN.sarina, lineSpacing: 26 })
  c.addText(cfg.cover.meta, { x: 0.8, y: 4.5, w: 11.4, h: 0.9, fontSize: 14, fontFace: AF, color: DN.slate, lineSpacing: 22 })
  c.addText('Sentimetrx', { x: 0.8, y: 6.0, w: 5, h: 0.5, fontSize: 18, fontFace: AF, color: DN.white, bold: true })
  c.addText('sentimetrx.ai  ·  powered by Datanautix', { x: 0.8, y: 6.5, w: 8, h: 0.4, fontSize: 12, fontFace: AF, color: DN.gold })
  c.addShape('rect', { x: 0, y: H - 0.06, w: W, h: 0.06, fill: { color: DN.sarina } })

  // 2 · TWO WAYS TO HEAR
  {
    const s = pptx.addSlide(); pg++; header(s, 'Two Ways to Hear Your Guests'); foot(s)
    if (cfg.twoModes.kicker) kicker(s, cfg.twoModes.kicker, DN.sarina)
    panel(s, 0.6, 1.95, 5.85, 3.0, DN.sarina, cfg.twoModes.listenTitle, DN.navy, cfg.twoModes.listenBullets)
    panel(s, 6.9, 1.95, 5.85, 3.0, DN.orange, cfg.twoModes.askTitle, DN.navy, cfg.twoModes.askBullets)
    s.addShape('rect', { x: 0.6, y: 5.2, w: 12.15, h: 0.85, fill: { color: DN.navy }, rectRadius: 0.1 })
    s.addText(cfg.twoModes.band, { x: 0.6, y: 5.2, w: 12.15, h: 0.85, fontSize: 15, fontFace: AF, color: DN.white, bold: true, align: 'center', valign: 'middle' })
    takeaway(s, cfg.twoModes.takeaway)
  }

  // 3 · TEASER (optional)
  if (cfg.teaser) {
    const t = cfg.teaser
    const s = pptx.addSlide(); pg++; header(s, t.headerTitle); foot(s)
    kicker(s, t.kicker)
    panel(s, 0.6, 1.95, 5.85, 4.15, DN.slate, t.shownTitle, DN.slate, t.shownBullets)
    s.addShape('rect', { x: 6.9, y: 1.95, w: 5.85, h: 4.15, fill: { color: DN.navy }, rectRadius: 0.12 })
    s.addShape('rect', { x: 6.9, y: 1.95, w: 5.85, h: 0.1, fill: { color: DN.sarina } })
    s.addText(t.lockedTitle, { x: 6.9, y: 2.15, w: 5.85, h: 0.45, fontSize: 16, fontFace: AF, color: DN.sarina, bold: true, align: 'center' })
    s.addText(t.lockedBullets.join('\n'), { x: 7.25, y: 2.75, w: 5.15, h: 3.1, fontSize: 14, fontFace: AF, color: DN.white, bullet: { code: '2022', indent: 16 }, lineSpacing: 26, paraSpaceAfter: 10, valign: 'top' })
    takeaway(s, t.takeaway)
  }

  // 4 · KPIS (optional)
  if (cfg.kpis) {
    const s = pptx.addSlide(); pg++; header(s, cfg.kpis.headerTitle); foot(s)
    kicker(s, cfg.kpis.kicker, DN.sarina)
    statGrid(s, cfg.kpis.tiles)
    takeaway(s, cfg.kpis.takeaway)
  }

  // 5 · LEADERBOARD (optional)
  if (cfg.leaderboard) {
    const s = pptx.addSlide(); pg++; header(s, cfg.leaderboard.headerTitle); foot(s)
    kicker(s, cfg.leaderboard.kicker, DN.sarina)
    const cols = [6.13, 2.0, 2.0, 2.0], hy = 1.9, rh = 0.36
    const cx = (i: number) => tx + cols.slice(0, i).reduce((a, b) => a + b, 0)
    s.addShape('rect', { x: tx, y: hy, w: tw, h: 0.42, fill: { color: DN.navy } })
    ;(cfg.leaderboard.columns || ['Location', 'Rating', 'Reviews', '1–2★']).forEach((hc, i) => s.addText(hc, { x: cx(i) + 0.15, y: hy, w: cols[i] - 0.2, h: 0.42, fontSize: 12, fontFace: AF, color: DN.white, bold: true, valign: 'middle', align: i === 0 ? 'left' : 'center' }))
    cfg.leaderboard.rows.slice(0, 10).forEach((row, r) => {
      const y = hy + 0.42 + r * rh
      s.addShape('rect', { x: tx, y, w: tw, h: rh, fill: { color: row.good ? DN.greenTint : DN.redTint } })
      ;[row.name, row.rating, row.n, row.neg].forEach((cell, i) => s.addText(cell, { x: cx(i) + 0.15, y, w: cols[i] - 0.2, h: rh, fontSize: 11.5, fontFace: AF, color: DN.ink, bold: i === 0 || i === 1, valign: 'middle', align: i === 0 ? 'left' : 'center' }))
    })
    takeaway(s, cfg.leaderboard.takeaway)
  }

  // 6 · DIAGNOSIS (optional)
  if (cfg.diagnosis) {
    const s = pptx.addSlide(); pg++; header(s, cfg.diagnosis.headerTitle); foot(s)
    kicker(s, cfg.diagnosis.kicker)
    const cols = [4.0, 1.9, 6.23], hy = 2.15, rh = 0.72
    const cx = (i: number) => tx + cols.slice(0, i).reduce((a, b) => a + b, 0)
    s.addShape('rect', { x: tx, y: hy, w: tw, h: 0.42, fill: { color: DN.navy } })
    ;(cfg.diagnosis.columns || ['Location', 'Rating', 'What the reviews say']).forEach((hc, i) => s.addText(hc, { x: cx(i) + 0.15, y: hy, w: cols[i] - 0.2, h: 0.42, fontSize: 12, fontFace: AF, color: DN.white, bold: true, valign: 'middle', align: i === 1 ? 'center' : 'left' }))
    cfg.diagnosis.rows.slice(0, 5).forEach((row, r) => {
      const y = hy + 0.42 + r * rh
      s.addShape('rect', { x: tx, y, w: tw, h: rh, fill: { color: row.tone === 'warn' ? DN.amberTint : DN.redTint } })
      ;[row.name, row.rating, row.note].forEach((cell, i) => s.addText(cell, { x: cx(i) + 0.15, y, w: cols[i] - 0.2, h: rh, fontSize: 13, fontFace: AF, color: DN.ink, bold: i === 0 || i === 1, valign: 'middle', align: i === 1 ? 'center' : 'left' }))
    })
    takeaway(s, cfg.diagnosis.takeaway)
  }

  // 7 · COIN (optional)
  if (cfg.coin) {
    const s = pptx.addSlide(); pg++; header(s, cfg.coin.headerTitle); foot(s)
    kicker(s, cfg.coin.kicker, DN.sarina)
    panel(s, 0.6, 1.95, 5.85, 4.15, DN.sarina, cfg.coin.leftTitle, DN.navy, cfg.coin.leftBullets)
    panel(s, 6.9, 1.95, 5.85, 4.15, DN.orange, cfg.coin.rightTitle, DN.navy, cfg.coin.rightBullets)
    takeaway(s, cfg.coin.takeaway)
  }

  // 8 · THEMES (optional)
  if (cfg.themes) {
    const s = pptx.addSlide(); pg++; header(s, cfg.themes.headerTitle); foot(s)
    kicker(s, cfg.themes.kicker, DN.sarina)
    cfg.themes.rows.slice(0, 5).forEach((t, i) => {
      const y = 1.92 + i * 0.86
      s.addShape('rect', { x: tx, y, w: tw, h: 0.74, fill: { color: DN.slateLight }, rectRadius: 0.08 })
      s.addShape('rect', { x: tx, y, w: 0.16, h: 0.74, fill: { color: t.positive ? DN.green : DN.red } })
      s.addText(t.name, { x: tx + 0.34, y, w: 5.4, h: 0.74, fontSize: 14.5, fontFace: AF, color: DN.navy, bold: true, valign: 'middle' })
      s.addShape('rect', { x: 6.0, y: y + 0.2, w: 1.35, h: 0.34, fill: { color: t.positive ? DN.greenTint : DN.redTint }, rectRadius: 0.05 })
      s.addText(t.positive ? 'Positive' : 'Negative', { x: 6.0, y: y + 0.2, w: 1.35, h: 0.34, fontSize: 10, fontFace: AF, color: t.positive ? DN.green : DN.red, bold: true, align: 'center', valign: 'middle' })
      s.addText(t.stat, { x: 7.5, y, w: 1.75, h: 0.74, fontSize: 13, fontFace: AF, color: DN.navy, bold: true, valign: 'middle' })
      s.addText(t.keywords, { x: 9.35, y, w: 3.5, h: 0.74, fontSize: 10.5, fontFace: AF, color: DN.slate, italic: true, valign: 'middle' })
    })
    takeaway(s, cfg.themes.takeaway)
  }

  // 9 · EARLY WARNING (optional)
  if (cfg.earlyWarning) {
    const s = pptx.addSlide(); pg++; header(s, cfg.earlyWarning.headerTitle); foot(s)
    kicker(s, cfg.earlyWarning.kicker)
    statGrid(s, cfg.earlyWarning.tiles)
    takeaway(s, cfg.earlyWarning.takeaway)
  }

  // 10 · WHY CONVERSATIONAL (spine)
  {
    const wc = cfg.whyConversational || DEFAULT_WHY
    const s = pptx.addSlide(); pg++; header(s, wc.headerTitle); foot(s)
    kicker(s, wc.kicker)
    s.addShape('rect', { x: 0.6, y: 2.05, w: 4.0, h: 3.45, fill: { color: DN.navy }, rectRadius: 0.12 })
    s.addText(wc.statBig, { x: 0.6, y: 2.45, w: 4.0, h: 1.3, fontSize: 58, fontFace: AF, color: DN.sarina, bold: true, align: 'center' })
    s.addText(wc.statLabel, { x: 0.85, y: 3.75, w: 3.5, h: 1.0, fontSize: 15, fontFace: AF, color: DN.white, align: 'center', lineSpacing: 20 })
    s.addText(wc.statSource, { x: 0.85, y: 4.85, w: 3.5, h: 0.4, fontSize: 10, fontFace: AF, color: DN.slate, italic: true, align: 'center' })
    s.addShape('rect', { x: 5.0, y: 2.05, w: 7.75, h: 3.45, fill: { color: DN.slateLight }, rectRadius: 0.12 })
    s.addText('The answers you pay to collect:', { x: 5.3, y: 2.25, w: 7.2, h: 0.4, fontSize: 14, fontFace: AF, color: DN.navy, bold: true })
    s.addText([
      { text: wc.deadEnds + '\n', options: { fontSize: 19, color: DN.ink, bold: true, lineSpacing: 30 } },
      { text: '\n' + wc.why, options: { fontSize: 14, color: DN.slate, lineSpacing: 22 } },
    ], { x: 5.3, y: 2.75, w: 7.2, h: 2.6, valign: 'top', fontFace: AF })
    takeaway(s, wc.takeaway)
  }

  // 11 · THE CONVERSATIONAL ADVANTAGE (optional but recommended)
  if (cfg.advantage) {
    const s = pptx.addSlide(); pg++; header(s, 'The Conversational Advantage'); foot(s)
    s.addText('Illustrative — the real drivers come from your guests', { x: 0.6, y: 1.14, w: 12.1, h: 0.35, fontSize: 11, fontFace: AF, color: DN.slate, italic: true })
    s.addShape('rect', { x: 0.6, y: 1.55, w: 5.85, h: 4.55, fill: { color: 'FEF2F2' }, rectRadius: 0.1 })
    s.addText('Static form', { x: 0.6, y: 1.65, w: 5.85, h: 0.4, fontSize: 14, fontFace: AF, color: DN.red, bold: true, align: 'center' })
    s.addText(cfg.advantage.staticLines, { x: 0.9, y: 2.15, w: 5.3, h: 3.85, fontSize: 13, fontFace: AF, color: DN.ink, lineSpacing: 22, valign: 'top' })
    s.addShape('rect', { x: 6.9, y: 1.55, w: 5.85, h: 4.55, fill: { color: 'F0FDF4' }, rectRadius: 0.1 })
    s.addText('Sentimetrx conversation', { x: 6.9, y: 1.65, w: 5.85, h: 0.4, fontSize: 14, fontFace: AF, color: DN.green, bold: true, align: 'center' })
    s.addText(cfg.advantage.convLines, { x: 7.2, y: 2.15, w: 5.35, h: 3.85, fontSize: 12, fontFace: AF, color: DN.ink, lineSpacing: 17, valign: 'top' })
    takeaway(s, cfg.advantage.takeaway, DN.sarina)
  }

  // 12 · TRY IT — SURVEY + QR (optional)
  if (cfg.survey) {
    const qr = await QRCode.toDataURL(cfg.survey.url, { margin: 1, width: 600, errorCorrectionLevel: 'M' })
    const s = pptx.addSlide(); pg++; header(s, 'Try It — From Your Phone'); foot(s)
    kicker(s, 'The same engine, now asking the questions.', DN.sarina)
    s.addText('A live survey', { x: 0.6, y: 2.0, w: 7.3, h: 0.45, fontSize: 17, fontFace: AF, color: DN.navy, bold: true })
    s.addText(cfg.survey.bullets.join('\n'), { x: 0.7, y: 2.6, w: 7.1, h: 3.4, fontSize: 14, fontFace: AF, color: DN.ink, bullet: { code: '2022', indent: 16 }, lineSpacing: 24, paraSpaceAfter: 12, valign: 'top' })
    s.addShape('rect', { x: 8.3, y: 1.95, w: 4.45, h: 4.2, fill: { color: DN.slateLight }, rectRadius: 0.12 })
    s.addShape('rect', { x: 8.3, y: 1.95, w: 4.45, h: 0.1, fill: { color: DN.sarina } })
    s.addShape('rect', { x: 9.65, y: 2.35, w: 1.75, h: 1.75, fill: { color: DN.white } })
    s.addImage({ data: qr, x: 9.73, y: 2.43, w: 1.6, h: 1.6 })
    s.addText('Scan to try it', { x: 8.3, y: 4.25, w: 4.45, h: 0.4, fontSize: 16, fontFace: AF, color: DN.navy, bold: true, align: 'center' })
    s.addText(cfg.survey.url, { x: 8.4, y: 4.7, w: 4.25, h: 0.4, fontSize: 10.5, fontFace: AF, color: DN.slate, align: 'center' })
    s.addText('Reviews are the guests who spoke up.\nSurveys ask the quiet majority.', { x: 8.4, y: 5.25, w: 4.25, h: 0.7, fontSize: 12, fontFace: AF, color: DN.navy, italic: true, align: 'center', lineSpacing: 16 })
    takeaway(s, cfg.survey.takeaway)
  }

  // 13 · THE ASK (closing)
  {
    const s = pptx.addSlide(); pg++
    s.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.navy } })
    s.addShape('rect', { x: 0, y: 0, w: 0.18, h: H, fill: { color: DN.sarina } })
    s.addText(cfg.ask.title, { x: 0.7, y: 0.5, w: 12, h: 0.7, fontSize: 30, fontFace: AF, color: DN.white, bold: true })
    s.addText(cfg.ask.subtitle, { x: 0.7, y: 1.3, w: 12, h: 0.5, fontSize: 16, fontFace: AF, color: DN.sarina })
    cfg.ask.rows.slice(0, 4).forEach((a, i) => {
      const y = 2.15 + i * 0.92
      s.addShape('rect', { x: 0.7, y, w: 12.0, h: 0.78, fill: { color: DN.navyMid }, rectRadius: 0.08 })
      s.addShape('rect', { x: 0.7, y, w: 0.14, h: 0.78, fill: { color: DN.sarina } })
      s.addText(a.label, { x: 1.0, y, w: 2.9, h: 0.78, fontSize: 15, fontFace: AF, color: DN.gold, bold: true, valign: 'middle' })
      s.addText(a.text, { x: 4.0, y, w: 8.5, h: 0.78, fontSize: 13.5, fontFace: AF, color: DN.white, valign: 'middle' })
    })
    s.addShape('rect', { x: 0.7, y: 6.05, w: 12.0, h: 0.82, fill: { color: DN.sarina }, rectRadius: 0.08 })
    s.addText(cfg.ask.cta, { x: 0.7, y: 6.05, w: 12.0, h: 0.82, fontSize: 15, fontFace: AF, color: DN.navy, bold: true, align: 'center', valign: 'middle' })
  }

  return pptx
}

// ── Seed sample: Bareburger (copy this to start a new client pitch) ───────────
export const SAMPLE_BAREBURGER: SalesPitchConfig = {
  client: 'Bareburger',
  filename: 'Bareburger-Sentimetrx-Capabilities.pptx',
  vertical: 'restaurant',
  cover: {
    title: 'Bareburger, in Your Guests’ Words',
    subtitle: 'Two ways to hear your guests — listen to reviews in the wild, and ask with\nconversational surveys. One analytics platform.',
    meta: 'A Sentimetrx capability overview — prepared for Bareburger\n14,683 Google reviews  ·  23 locations  ·  read on the 2022–2023 window',
  },
  twoModes: {
    kicker: 'Listen to what they say unprompted — and ask what you need to know.',
    listenTitle: '① Listen — conversations in the wild',
    listenBullets: ['Google reviews, delivery, social', 'Unsolicited and honest', 'Already happening — 14,683 reviews here', 'Everything in this deck came from it'],
    askTitle: '② Ask — conversational surveys',
    askBullets: ['A branded AI agent asks your guests', 'Adaptive follow-ups, in the moment', 'The exact questions you choose', 'Reaches the quiet majority who never post'],
    band: 'Both land on the SAME analytics engine — 8-axis taxonomy, AI themes, per-store.',
    takeaway: 'Most vendors do one. Sentimetrx runs both — read the same way.',
  },
  teaser: {
    headerTitle: 'Listen: What This Shows — and What It Unlocks',
    kicker: 'Operational fixes need current data.',
    shownTitle: 'Shown today  ·  2022–2023',
    shownBullets: ['2,552 reviews', 'Proves the full method, end to end', 'Old enough to share freely', 'Directional — not this quarter’s fixes'],
    lockedTitle: 'Unlocked in the engagement  ·  2024–2026',
    lockedBullets: ['9,848 reviews — 4× more', '55% from the last 12 months', 'What to fix now + a live daily feed', 'Includes your newest stores'],
    takeaway: 'This deck is the demo. The current layer is the product.',
  },
  kpis: {
    headerTitle: 'Bareburger at a Glance',
    kicker: '2,552 reviews. Every rated one. No sampling.',
    tiles: [
      { value: '2,552', label: 'Reviews', sub: '2022–23' }, { value: '4.45★', label: 'Blended rating' }, { value: '~13', label: 'Locations', sub: 'with history' },
      { value: '73%', label: '5-star share' }, { value: '1.18★', label: 'Best-to-worst gap', sub: '4.91 → 3.73' }, { value: '55%', label: 'Owner-response', sub: 'reply ≠ act' },
    ],
    takeaway: 'Healthy average. The story is the variance underneath.',
  },
  leaderboard: {
    headerTitle: 'Stars & Dogs — Every Store, One Scale',
    kicker: 'Top 5 and bottom 5 by rating · 2022–23 (n = reviews).',
    rows: [
      { name: 'Astoria (31st Ave), NY', rating: '4.91★', n: '138', neg: '0.7%', good: true }, { name: 'New York (Manhattan), NY', rating: '4.59★', n: '868', neg: '5.0%', good: true },
      { name: 'Mt Kisco, NY', rating: '4.55★', n: '155', neg: '7.1%', good: true }, { name: 'Long Island City, NY', rating: '4.48★', n: '229', neg: '8.7%', good: true }, { name: 'Bayside, NY', rating: '4.48★', n: '184', neg: '9.8%', good: true },
      { name: 'Closter, NJ', rating: '4.32★', n: '161', neg: '11.8%', good: false }, { name: 'Montclair, NJ', rating: '4.23★', n: '185', neg: '9.7%', good: false }, { name: 'Ridgefield, CT', rating: '4.23★', n: '112', neg: '12.4%', good: false },
      { name: 'Westfield, NJ', rating: '4.22★', n: '209', neg: '12.0%', good: false }, { name: 'Central Valley, NY', rating: '3.73★', n: '64', neg: '28.1%', good: false },
    ],
    takeaway: 'Central Valley turns away more than 1 in 4 guests unhappy. Astoria almost none. Same brand — the gap is operational.',
  },
  diagnosis: {
    headerTitle: 'Why a Dog Is a Dog',
    kicker: 'The score, decomposed. The full current diagnosis is locked.',
    rows: [
      { name: 'Central Valley, NY', rating: '3.73★', note: 'Slow service · long waits', tone: 'bad' },
      { name: 'Westfield, NJ', rating: '4.22★', note: 'Rude host · greasy, inconsistent food', tone: 'bad' },
      { name: 'Closter, NJ', rating: '4.32★', note: 'Cleanliness · “premium price, not premium”', tone: 'warn' },
      { name: 'Stamford, CT', rating: '4.37★', note: 'Staff conduct (phone + counter)', tone: 'warn' },
    ],
    takeaway: 'A star rating can’t do this. Every store gets a named, fixable cause.',
  },
  coin: {
    headerTitle: 'Two Sides of the Experience Coin',
    kicker: 'Most tools do one. We cross both.',
    leftTitle: 'Dimensions — the fixed yardstick',
    leftBullets: ['8 standardized axes, every review', 'Same for every store, every quarter', 'Comparable — powers the rankings', 'Drives the churn & food-safety flags'],
    rightTitle: 'Themes — what the AI discovers',
    rightBullets: ['Mined from your guests’ actual words', 'Finds what you didn’t know to ask', 'Brand-specific and emergent', 'E.g. a “menu changed” backlash'],
    takeaway: 'Dimensions give you comparability. Themes give you discovery.',
  },
  themes: {
    headerTitle: 'Themes the AI Found — in Your Words',
    kicker: 'Mined from your reviews, then counted back (★ = theme average).',
    rows: [
      { name: 'Vegan & gluten-free haven', positive: true, stat: '12%  ·  ★4.47', keywords: 'impossible burger · dedicated fryer · celiac' },
      { name: 'Exotic-meat & sides superfans', positive: true, stat: '12%  ·  ★4.35', keywords: 'bison · elk · onion rings · milkshakes' },
      { name: '“Menu changed — it used to be better”', positive: false, stat: '★3.52', keywords: 'new menu · removed · double patties · downhill' },
      { name: 'Slow, inattentive service', positive: false, stat: '★2.18', keywords: 'long wait · ignored · on their phones' },
      { name: 'Delivery & pickup errors', positive: false, stat: '★2.71', keywords: 'missing item · wrong order · cold food' },
    ],
    takeaway: 'No one wrote a rubric for these. Vegan/GF & exotic-meat: lean in. Menu-change & slow service: fix.',
  },
  earlyWarning: {
    headerTitle: 'The Early-Warning Layer',
    kicker: 'Signals a star rating buries.',
    tiles: [
      { value: '17', label: 'Churn intent', sub: '“never coming back”', color: DN.red }, { value: '45', label: 'Disappointment', sub: 'a let-down, not one bad meal', color: DN.amber }, { value: '7', label: 'Food-safety flags', sub: 'existential risk', color: DN.red },
      { value: '16', label: 'Rude-staff callouts', sub: 'conduct, not capacity', color: DN.red }, { value: '13', label: 'Wrong-order flags', sub: 'accuracy failures', color: DN.amber }, { value: '48', label: 'Price / value pushback', sub: '“overpriced”', color: DN.amber },
    ],
    takeaway: 'Each flag is a guest leaving — months before the P&L shows it.',
  },
  advantage: {
    staticLines: 'Q: How was your visit?\n★★★  (3/5)\n\nQ: Anything to add?\n“It was fine.”\n\n———\n\nWhat you can act on:\nA neutral score. Nothing else.',
    convLines: 'Agent: How was your visit? [taps 3/5]\nAgent: What held it back from a 5?\nGuest: Burger was great — but we waited 40 min\nAgent: Was it the kitchen, or the server?\nGuest: Server never came back after we ordered\n\n———\n\nWhat you can act on:\n• Speed + attentiveness at THIS store\n• Server-driven, not the kitchen\n• Tied to the daypart & location',
    takeaway: '3–5× more actionable text per guest. Same length. No interviewer.',
  },
  survey: {
    url: 'https://www.sentimetrx.ai/s/bareback',
    bullets: [
      'Conversational AI — adapts to each answer, not a static form',
      'Probes the “why” the instant an answer is vague',
      'Lands on the same 8-axis taxonomy + themes as your reviews',
      'Deploy anywhere: receipts, table tents, email, the app',
    ],
    takeaway: 'Reviews tell you what happened. Surveys let you ask — read by the same engine.',
  },
  ask: {
    title: 'The Ask — One Platform, Two Modes',
    subtitle: 'Listen in the wild, ask directly — same taxonomy, same themes, same per-store view.',
    rows: [
      { label: 'Listen', text: 'We’re already reading your reviews — unlock the current 2024–26 layer.' },
      { label: 'Ask', text: 'Stand up conversational surveys for the questions reviews can’t answer.' },
      { label: 'One platform', text: 'Both modes on one engine — no vendors stitched together.' },
      { label: 'Start small', text: 'Three stores + a first survey wave — one star, one dog, one middle.' },
    ],
    cta: 'High-value guest intelligence, delivered — not a dashboard you have to staff.',
  },
}

// ── Seed sample: generic / non-restaurant starting point ─────────────────────
// Leans on the universal spine + a KPI grid; the restaurant-only modules
// (leaderboard, diagnosis, coin, themes, early-warning) are simply omitted. Shows
// how a non-restaurant pitch (membership, hospitality, SaaS, healthcare) is the
// same template with the vertical modules left out and labels swapped.
export const SAMPLE_GENERIC: SalesPitchConfig = {
  client: 'Your Brand',
  filename: 'Sentimetrx-Capabilities.pptx',
  vertical: 'generic',
  cover: {
    title: 'Your Customers, in Their Own Words',
    subtitle: 'Two ways to hear your customers — listen to what they say in the wild, and ask\nwith conversational surveys. One analytics platform.',
    meta: 'A Sentimetrx capability overview — prepared for [Client]\nReviews · support tickets · surveys · social — all on one engine',
  },
  twoModes: {
    kicker: 'Listen to what they say unprompted — and ask what you need to know.',
    listenTitle: '① Listen — conversations in the wild',
    listenBullets: ['Reviews, social, support tickets, app-store feedback', 'Unsolicited and honest', 'Already happening — you’re just not reading all of it', 'Auto-tagged and themed the moment it lands'],
    askTitle: '② Ask — conversational surveys',
    askBullets: ['A branded AI agent asks your customers', 'Adaptive follow-ups, in the moment', 'The exact questions you choose', 'Reaches the quiet majority who never post'],
    band: 'Both land on the SAME analytics engine — structured tags, AI themes, per-segment.',
    takeaway: 'Most vendors do one. Sentimetrx runs both — read the same way.',
  },
  kpis: {
    headerTitle: 'What the Listening Layer Surfaces',
    kicker: 'Everything you already collect — finally read the same way.',
    tiles: [
      { value: 'Themes', label: 'What they raise', sub: 'ranked by impact' }, { value: 'Sentiment', label: 'Per feature', sub: 'not one blended score' }, { value: 'Drivers', label: 'What moves loyalty', sub: 'signal vs noise' },
      { value: 'Segments', label: 'Who feels what', sub: 'cut any way' }, { value: 'Early-warning', label: 'Churn & risk flags', sub: 'before revenue moves' }, { value: 'Live feed', label: 'New detractors', sub: 'routed daily' },
    ],
    takeaway: 'The same engine that reads reviews reads every channel you own.',
  },
  // whyConversational omitted → uses the built-in 40–50% default
  advantage: {
    staticLines: 'Q: How was your experience?\n★★★  (3/5)\n\nQ: Anything to add?\n“It was fine.”\n\n———\n\nWhat you can act on:\nA neutral score. Nothing else.',
    convLines: 'Agent: How was your experience? [taps 3/5]\nAgent: What held it back from a 5?\nCustomer: The product’s great — onboarding was rough\nAgent: Where did it get stuck?\nCustomer: Couldn’t find how to invite my team\n\n———\n\nWhat you can act on:\n• Onboarding friction, not the product\n• Specific step: team invites\n• A concrete fix, in their words',
    takeaway: '3–5× more actionable text per respondent. Same length. No interviewer.',
  },
  survey: {
    url: 'https://www.sentimetrx.ai/s/your-demo',
    bullets: [
      'Conversational AI — adapts to each answer, not a static form',
      'Probes the “why” the instant an answer is vague',
      'Lands on the same taxonomy + themes as your listening data',
      'Deploy anywhere: email, SMS, in-app, QR, kiosk',
    ],
    takeaway: 'Reviews tell you what happened. Surveys let you ask — read by the same engine.',
  },
  ask: {
    title: 'The Ask — One Platform, Two Modes',
    subtitle: 'Listen in the wild, ask directly — same taxonomy, same themes, same segment view.',
    rows: [
      { label: 'Listen', text: 'Point us at your reviews / tickets / social — we read all of it.' },
      { label: 'Ask', text: 'Stand up conversational surveys for what listening can’t answer.' },
      { label: 'One platform', text: 'Both modes on one engine — no vendors stitched together.' },
      { label: 'Start small', text: 'One listening source + a first survey wave.' },
    ],
    cta: 'High-value customer intelligence, delivered — not a dashboard you have to staff.',
  },
}

/** Registry of client pitch configs the admin route can render (?client=). */
export const SALES_PITCH_CONFIGS: Record<string, SalesPitchConfig> = {
  bareburger: SAMPLE_BAREBURGER,
  generic: SAMPLE_GENERIC,
}
