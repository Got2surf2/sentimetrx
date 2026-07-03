// One-off deck: Vindman Voter Intelligence Platform — tightened, presenter-led.
// Run: npx tsx scripts/_vindman_deck_v2.ts
// Output: ~/Downloads/Vindman_Voter_Intelligence_Platform_v2.pptx
//
// Design rule: assume the presenter is an expert and will speak to each point.
// Slides carry the headline + a few anchors at large font. Body paragraphs go
// into addNotes() for the speaker, not onto the screen.

import PptxGenJS from 'pptxgenjs'
import os from 'os'
import path from 'path'

const W = 13.33
const H = 7.5

const C = {
  navy:       '0D2B45',
  navyDeep:   '081A2C',
  teal:       '0F7173',
  tealMid:    '4DBFC1',
  tealLight:  'E0F0F0',
  tealTint:   'F0F8F8',
  gold:       'E8B84B',
  goldDeep:   'B8893A',
  red:        'B91C1C',
  redTint:    'FBE7E7',
  green:      '047857',
  greenTint:  'E3F1EA',
  white:      'FFFFFF',
  ink:        '0F172A',
  mid:        '374151',
  faint:      '6B7280',
  border:     'E5E7EB',
  cardBg:     'F8FAFC',
  reddit:     'FF4500',
  substack:   'FF6719',
}

function band(slide: any, title: string, kicker?: string) {
  slide.addShape('rect', { x: 0, y: 0, w: W, h: 0.95, fill: { color: C.navy } })
  slide.addShape('rect', { x: 0, y: 0.95, w: W, h: 0.05, fill: { color: C.gold } })
  slide.addText(title, { x: 0.55, y: 0.18, w: 12.3, h: 0.6, fontSize: 30, fontFace: 'Arial', color: C.white, bold: true })
  if (kicker) slide.addText(kicker, { x: 0.55, y: 0.62, w: 12.3, h: 0.3, fontSize: 14, fontFace: 'Arial', color: C.tealLight })
}

function ftr(slide: any, n: number) {
  slide.addText('Sentimetrx  ·  Vindman for Florida  ·  Confidential', {
    x: 0.55, y: H - 0.32, w: 9, h: 0.22, fontSize: 9, color: C.faint, fontFace: 'Arial',
  })
  slide.addText(String(n), {
    x: W - 0.95, y: H - 0.32, w: 0.4, h: 0.22, fontSize: 9, color: C.faint, fontFace: 'Arial', align: 'right',
  })
}

const pptx = new PptxGenJS()
pptx.layout = 'LAYOUT_WIDE'
pptx.author = 'Datanautix / Sentimetrx'
pptx.title  = 'Vindman Voter Intelligence Platform'
let p = 0

// ──────────────────────────────────────────────────────────────────────────
// Slide 1 — Title (huge, minimal)
{
  const s = pptx.addSlide(); p++
  s.background = { color: C.navy }
  s.addShape('rect', { x: 0, y: 0, w: 0.18, h: H, fill: { color: C.teal } })
  s.addShape('rect', { x: 0, y: H - 0.6, w: W, h: 0.08, fill: { color: C.gold } })

  s.addText('Voter Intelligence Platform', {
    x: 0.9, y: 2.1, w: 11.5, h: 1.2, fontSize: 52, fontFace: 'Arial', color: C.white, bold: true,
  })
  s.addText('A living database that listens, learns, and sharpens every talking point.', {
    x: 0.9, y: 3.45, w: 11.5, h: 0.7, fontSize: 22, fontFace: 'Arial', color: C.tealLight, italic: true,
  })

  s.addText('Vindman for Florida  ·  U.S. Senate 2026', {
    x: 0.9, y: 5.4, w: 11.5, h: 0.4, fontSize: 16, fontFace: 'Arial', color: C.gold,
  })
  s.addText('Prepared by Datanautix  ·  Powered by Sentimetrx  ·  May 2026', {
    x: 0.9, y: 5.9, w: 11.5, h: 0.35, fontSize: 12, fontFace: 'Arial', color: C.tealLight,
  })

  s.addNotes(
    `Opener: This is a continuously listening voter intelligence platform — not a polling tool, not a CRM. Six listening posts, one database, every conversation makes the next one smarter. Spend the next ~15 minutes on what's new since we last spoke.`
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 2 — Six listening posts (icon + label only)
{
  const s = pptx.addSlide(); p++
  band(s, 'Six listening posts. One database.', 'Every source feeds the same voter intelligence brain.')

  const posts = [
    { icon: '📋', label: 'Surveys',   sub: 'Conversational, deeper than forms' },
    { icon: '🤖', label: 'Agents',    sub: '24/7 Vindman persona on-site' },
    { icon: '💬', label: 'PulseIQ',   sub: 'Moderated discussions at scale' },
    { icon: '🟢', label: 'Reddit',    sub: 'Unprompted Florida voter signal' },
    { icon: '✍️', label: 'Substack',  sub: 'Opinion leaders + subscribers' },
    { icon: '🔍', label: 'Search',    sub: 'What voters Google, when' },
  ]

  const startX = 0.55
  const cardW = 4.05
  const cardH = 2.0
  const gapX = 0.15
  const gapY = 0.25

  posts.forEach((post, i) => {
    const col = i % 3
    const row = Math.floor(i / 3)
    const x = startX + col * (cardW + gapX)
    const y = 1.5 + row * (cardH + gapY)

    s.addShape('roundRect', { x, y, w: cardW, h: cardH, rectRadius: 0.12, fill: { color: C.white }, line: { color: C.border, width: 0.5 } })
    s.addShape('rect', { x, y, w: 0.08, h: cardH, fill: { color: C.teal } })

    s.addText(post.icon, { x: x + 0.25, y: y + 0.2, w: 0.9, h: 0.9, fontSize: 40, align: 'left' })
    s.addText(post.label, { x: x + 1.2, y: y + 0.3, w: cardW - 1.4, h: 0.55, fontSize: 26, fontFace: 'Arial', color: C.navy, bold: true })
    s.addText(post.sub, { x: x + 1.2, y: y + 0.95, w: cardW - 1.4, h: 0.85, fontSize: 14, fontFace: 'Arial', color: C.mid, wrap: true, valign: 'top' })
  })

  s.addShape('roundRect', { x: 0.55, y: 6.05, w: 12.25, h: 0.85, rectRadius: 0.08, fill: { color: C.tealTint }, line: { color: C.border, width: 0.3 } })
  s.addText('What voters say when nobody is asking — that\'s the signal no poll can reach.', {
    x: 0.85, y: 6.18, w: 11.65, h: 0.6, fontSize: 16, fontFace: 'Arial', color: C.teal, bold: true, italic: true, valign: 'middle',
  })

  ftr(s, p)
  s.addNotes(
    `Six channels, one database. The unlock is what voters say when they're NOT being asked — Reddit, Substack, search trends. That's ground truth no survey captures.`
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 3 — Tuesday in October (tight side-by-side)
{
  const s = pptx.addSlide(); p++
  band(s, 'A Tuesday in October', 'Same day, two campaigns — one is guessing, one knows.')

  // Column headers
  const colY = 1.45
  const lW = 5.9
  const rW = 5.9
  const lX = 0.55
  const rX = 6.85

  s.addShape('roundRect', { x: lX, y: colY, w: lW, h: 0.6, rectRadius: 0.06, fill: { color: C.redTint }, line: { color: C.red, width: 1 } })
  s.addText('MOODY  ·  guesses', { x: lX + 0.2, y: colY + 0.08, w: lW - 0.4, h: 0.44, fontSize: 18, fontFace: 'Arial', color: C.red, bold: true, valign: 'middle' })

  s.addShape('roundRect', { x: rX, y: colY, w: rW, h: 0.6, rectRadius: 0.06, fill: { color: C.greenTint }, line: { color: C.green, width: 1 } })
  s.addText('VINDMAN  ·  knows', { x: rX + 0.2, y: colY + 0.08, w: rW - 0.4, h: 0.44, fontSize: 18, fontFace: 'Arial', color: C.green, bold: true, valign: 'middle' })

  const rows = [
    { t: '8 AM', l: 'Same tracking numbers as last week.',               r: 'Overnight shift: HOA insurance, not health.' },
    { t: '10 AM', l: 'Drafts response from gut + last month\'s book.',    r: '3,000 touchpoints say the attack isn\'t landing. Save the ammo.' },
    { t: 'NOON', l: 'DC memo: "talk about affordability."',              r: 'Tampa brief built from last week\'s town hall: property taxes.' },
    { t: '2 PM', l: '"Our polling shows 54% concerned about costs."',    r: '"Here\'s what Maria in Hialeah said last night at 11pm."' },
    { t: '5 PM', l: 'Consultant: "hit healthcare." Which? For whom?',    r: 'Hit Moody\'s AG record on insurance — voters raised it unprompted.' },
  ]

  const startY = 2.2
  const rowH = 0.85
  rows.forEach((row, i) => {
    const y = startY + i * (rowH + 0.05)
    s.addShape('roundRect', { x: 0.05, y: y + 0.1, w: 0.5, h: 0.55, rectRadius: 0.06, fill: { color: C.navy } })
    s.addText(row.t, { x: 0.05, y: y + 0.1, w: 0.5, h: 0.55, fontSize: 12, fontFace: 'Arial', color: C.gold, bold: true, align: 'center', valign: 'middle' })

    s.addShape('roundRect', { x: lX, y, w: lW, h: rowH - 0.05, rectRadius: 0.06, fill: { color: C.white }, line: { color: C.border, width: 0.4 } })
    s.addText(row.l, { x: lX + 0.18, y: y + 0.1, w: lW - 0.36, h: rowH - 0.25, fontSize: 14, fontFace: 'Arial', color: C.mid, valign: 'middle', wrap: true })

    s.addShape('roundRect', { x: rX, y, w: rW, h: rowH - 0.05, rectRadius: 0.06, fill: { color: C.white }, line: { color: C.green, width: 0.6 } })
    s.addText(row.r, { x: rX + 0.18, y: y + 0.1, w: rW - 0.36, h: rowH - 0.25, fontSize: 14, fontFace: 'Arial', color: C.ink, bold: true, valign: 'middle', wrap: true })
  })

  ftr(s, p)
  s.addNotes(
    `Five timestamps, one day. Each row is the same moment in time — one side is gut feel, the other side is grounded in voter language pulled minutes earlier. The compounding effect of having this every day is the whole point.`
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 4 — "I'm meeting with..." (three audiences, ultra-tight)
{
  const s = pptx.addSlide(); p++
  band(s, '"I\'m meeting with..."', 'Ask the database. Get talking points built from real voter data.')

  const cols = [
    {
      who: 'Hispanic small business owners',
      where: 'Miami',
      bullets: [
        'HOA + commercial premiums up 140% in 2 years',
        'Tariff exposure on imports',
        'Moody\'s record: "she gave a pass to big insurance"',
        'Bilingual agent data: wants specifics, not slogans',
      ],
    },
    {
      who: 'Retired military veterans',
      where: 'Jacksonville',
      bullets: [
        '23 agent conversations on VA wait times this month',
        '"The Senate needs to do its job" — own framing, validated',
        'Contrast: Moody has zero military service',
        'Responds to directness; flags "vague promises"',
      ],
    },
    {
      who: 'College students + young pros',
      where: 'Tampa',
      bullets: [
        '"Floridians under 40 are being priced out" (Reddit, 1.2K)',
        'Student loan + cost-of-living squeeze (Substack)',
        'Connects climate inaction → rising premiums',
        '71% of agent chats happen after 9pm',
      ],
    },
  ]

  const startX = 0.55
  const colW = 4.05
  const gapX = 0.15

  cols.forEach((col, i) => {
    const x = startX + i * (colW + gapX)
    s.addShape('roundRect', { x, y: 1.45, w: colW, h: 5.0, rectRadius: 0.1, fill: { color: C.white }, line: { color: C.border, width: 0.5 } })
    s.addShape('rect', { x, y: 1.45, w: colW, h: 0.85, fill: { color: C.navy } })

    s.addText(col.who, { x: x + 0.2, y: 1.5, w: colW - 0.4, h: 0.4, fontSize: 15, fontFace: 'Arial', color: C.white, bold: true })
    s.addText(col.where, { x: x + 0.2, y: 1.9, w: colW - 0.4, h: 0.32, fontSize: 12, fontFace: 'Arial', color: C.gold, italic: true })

    const bulletText = col.bullets.map(b => `▸  ${b}`).join('\n\n')
    s.addText(bulletText, {
      x: x + 0.25, y: 2.55, w: colW - 0.5, h: 3.8, fontSize: 14, fontFace: 'Arial', color: C.ink, wrap: true, valign: 'top', lineSpacingMultiple: 1.2,
    })
  })

  s.addShape('roundRect', { x: 0.55, y: 6.6, w: 12.25, h: 0.6, rectRadius: 0.08, fill: { color: C.tealTint }, line: { color: C.border, width: 0.3 } })
  s.addText('Every line traces back to a real source. Ground truth — not a consultant\'s guess.', {
    x: 0.85, y: 6.68, w: 11.65, h: 0.44, fontSize: 14, fontFace: 'Arial', color: C.teal, italic: true, valign: 'middle',
  })

  ftr(s, p)
  s.addNotes(
    `These are illustrative — real outputs will be specific to the conversations we capture. The point is the format: name an audience, get specifics with provenance.`
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 5 — Section divider
{
  const s = pptx.addSlide(); p++
  s.background = { color: C.navy }
  s.addShape('rect', { x: 0, y: 0, w: 0.18, h: H, fill: { color: C.teal } })
  s.addShape('rect', { x: 0, y: H - 0.6, w: W, h: 0.08, fill: { color: C.gold } })

  s.addText('How it works', {
    x: 0.9, y: 2.6, w: 11.5, h: 1.0, fontSize: 56, fontFace: 'Arial', color: C.white, bold: true,
  })
  s.addText('The loop, the architecture, the evidence.', {
    x: 0.9, y: 3.85, w: 11.5, h: 0.6, fontSize: 22, fontFace: 'Arial', color: C.tealLight, italic: true,
  })
  s.addText('Sentimetrx  ·  Vindman for Florida', {
    x: 0.9, y: 6.3, w: 11.5, h: 0.4, fontSize: 12, fontFace: 'Arial', color: C.gold,
  })

  s.addNotes(`Transition: the previous section was the "what." Now the "how" — the loop, the architecture, the evidence base.`)
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 6 — Core loop (4 stages, huge)
{
  const s = pptx.addSlide(); p++
  band(s, 'The Loop', 'Each cycle makes the next one sharper. Money can\'t buy this.')

  const stages = [
    { n: '1', t: 'LISTEN',   sub: 'Voters in their own words' },
    { n: '2', t: 'EXTRACT',  sub: 'AI surfaces themes + language' },
    { n: '3', t: 'MESSAGE',  sub: 'Talking points from voters, not DC' },
    { n: '4', t: 'RESONATE', sub: 'It lands because it came from them' },
  ]

  const startX = 0.55
  const w = 2.95
  const gapX = 0.2
  const y = 2.4
  const h = 3.0

  stages.forEach((st, i) => {
    const x = startX + i * (w + gapX)
    const accent = i === 3 ? C.gold : C.teal

    s.addShape('roundRect', { x, y, w, h, rectRadius: 0.15, fill: { color: C.white }, line: { color: C.border, width: 0.6 } })
    s.addShape('ellipse', { x: x + w / 2 - 0.4, y: y + 0.3, w: 0.8, h: 0.8, fill: { color: accent } })
    s.addText(st.n, { x: x + w / 2 - 0.4, y: y + 0.3, w: 0.8, h: 0.8, fontSize: 28, fontFace: 'Arial', color: C.white, bold: true, align: 'center', valign: 'middle' })
    s.addText(st.t, { x: x + 0.15, y: y + 1.35, w: w - 0.3, h: 0.55, fontSize: 24, fontFace: 'Arial', color: C.navy, bold: true, align: 'center' })
    s.addText(st.sub, { x: x + 0.2, y: y + 2.0, w: w - 0.4, h: 0.9, fontSize: 14, fontFace: 'Arial', color: C.mid, align: 'center', wrap: true, valign: 'top' })

    if (i < stages.length - 1) {
      s.addText('→', { x: x + w + 0.02, y: y + h / 2 - 0.3, w: 0.16, h: 0.6, fontSize: 28, color: C.faint, align: 'center', bold: true })
    }
  })

  // Loop back indicator
  s.addText('↺  Every week this runs, the gap widens.', {
    x: 0.55, y: 5.95, w: 12.25, h: 0.4, fontSize: 18, fontFace: 'Arial', color: C.teal, bold: true, align: 'center',
  })

  ftr(s, p)
  s.addNotes(
    `The whole pitch is in this loop. Moody can spend $50M in October — she can't synthesize six months of continuous listening in two weeks.`
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 7 — Feedback loop (5 short rows)
{
  const s = pptx.addSlide(); p++
  band(s, 'Every source feeds every other source', 'Findings compound across channels.')

  const links = [
    { from: 'Reddit threads',          to: 'Agent knowledge base',     note: 'New concerns → next chat has the answer' },
    { from: 'Agent conversations',     to: 'Survey questions',         note: 'Common asks → next survey covers them' },
    { from: 'Survey results',          to: 'PulseIQ agendas',          note: 'Issue priorities → discussion topics' },
    { from: 'Town hall themes',        to: 'Campaign messaging',       note: 'Organic framing → comms refines' },
    { from: 'All sources',             to: 'Candidate briefings',      note: 'Cross-referenced before every event' },
  ]

  const rowH = 0.9
  const startY = 1.5
  links.forEach((link, i) => {
    const y = startY + i * (rowH + 0.1)
    s.addShape('roundRect', { x: 0.55, y, w: 12.25, h: rowH, rectRadius: 0.08, fill: { color: C.cardBg }, line: { color: C.border, width: 0.4 } })

    s.addText(link.from, { x: 0.8, y: y + 0.05, w: 3.6, h: rowH - 0.1, fontSize: 16, fontFace: 'Arial', color: C.navy, bold: true, valign: 'middle' })
    s.addText('→', { x: 4.4, y: y + 0.05, w: 0.5, h: rowH - 0.1, fontSize: 22, color: C.teal, bold: true, valign: 'middle', align: 'center' })
    s.addText(link.to, { x: 4.95, y: y + 0.05, w: 3.6, h: rowH - 0.1, fontSize: 16, fontFace: 'Arial', color: C.teal, bold: true, valign: 'middle' })
    s.addText(link.note, { x: 8.6, y: y + 0.05, w: 4.1, h: rowH - 0.1, fontSize: 13, fontFace: 'Arial', color: C.mid, italic: true, valign: 'middle' })
  })

  ftr(s, p)
  s.addNotes(`This is the network effect inside the platform. No source is siloed.`)
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 8 — Evidence (4 huge stats, minimal small print)
{
  const s = pptx.addSlide(); p++
  band(s, 'The Evidence', 'Public research on AI-driven voter engagement (2024–2026).')

  const stats = [
    { big: '3.9pt',  small: 'preference shift after\na 6-min chatbot chat',   src: 'Cornell, Dec 2025' },
    { big: '4×',     small: 'more persuasive than\ntraditional political ads', src: 'MIT Technology Review' },
    { big: '10pt',   small: 'shift observed in\nCanadian & Polish elections',  src: 'Cornell follow-up' },
    { big: '80–90%', small: 'response rates from\n24/7 AI chat',               src: 'Campaign Innovation Center' },
  ]

  const startX = 0.55
  const w = 3.0
  const gapX = 0.2
  const y = 1.55
  const h = 4.3

  stats.forEach((st, i) => {
    const x = startX + i * (w + gapX)
    s.addShape('roundRect', { x, y, w, h, rectRadius: 0.15, fill: { color: C.navy } })
    s.addShape('rect', { x, y: y + h - 0.08, w, h: 0.08, fill: { color: C.gold } })

    s.addText(st.big, { x: x + 0.1, y: y + 0.45, w: w - 0.2, h: 1.4, fontSize: 56, fontFace: 'Arial', color: C.gold, bold: true, align: 'center' })
    s.addText(st.small, { x: x + 0.15, y: y + 2.0, w: w - 0.3, h: 1.4, fontSize: 15, fontFace: 'Arial', color: C.white, align: 'center', wrap: true })
    s.addText(st.src, { x: x + 0.15, y: y + 3.55, w: w - 0.3, h: 0.4, fontSize: 11, fontFace: 'Arial', color: C.tealLight, align: 'center', italic: true })
  })

  s.addText('11% of voters used AI for election research in 2024.  ·  $1.9B spent on online political ads.  ·  Chatbots: more shift per dollar.', {
    x: 0.55, y: 6.2, w: 12.25, h: 0.5, fontSize: 13, fontFace: 'Arial', color: C.mid, align: 'center', italic: true,
  })

  ftr(s, p)
  s.addNotes(
    `The receipts. Cornell + MIT + CCI. Chatbots are most persuasive in calm, evidence-based dialogue — exactly the register we set the Vindman agent to.`
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 9 — Ground truth quotes (4 quotes, big text)
{
  const s = pptx.addSlide(); p++
  band(s, 'Ground Truth', 'Real quotes, tagged by source. The raw material for every talking point.')

  const quotes = [
    { text: 'My homeowner\'s insurance went from $2,400 to $6,100 in two years. I\'m a teacher.',  src: '🤖 Agent  ·  Jacksonville  ·  11:47pm' },
    { text: 'I voted Republican my whole life. When\'s the last time Moody answered a real question?', src: '💬 PulseIQ  ·  Coral Gables  ·  Live' },
    { text: 'Florida is literally becoming unlivable for anyone under 40. Nobody in Tallahassee cares.', src: '🟢 r/florida  ·  1.2K upvotes  ·  Mainstream' },
    { text: 'Vindman is the only one actually talking about why the AG gave insurance a pass.',     src: '✍️ Substack  ·  FL newsletter  ·  Resonant' },
  ]

  const startX = 0.55
  const w = 6.05
  const gapX = 0.15
  const h = 2.4
  const startY = 1.5

  quotes.forEach((q, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = startX + col * (w + gapX)
    const y = startY + row * (h + 0.2)

    s.addShape('roundRect', { x, y, w, h, rectRadius: 0.1, fill: { color: C.white }, line: { color: C.border, width: 0.5 } })
    s.addShape('rect', { x, y, w: 0.08, h, fill: { color: C.gold } })

    s.addText('"', { x: x + 0.2, y: y + 0.0, w: 0.6, h: 0.8, fontSize: 60, color: C.tealMid, bold: true, fontFace: 'Georgia' })
    s.addText(q.text, {
      x: x + 0.7, y: y + 0.35, w: w - 0.9, h: 1.35, fontSize: 17, fontFace: 'Georgia', color: C.ink, italic: true, wrap: true, valign: 'top',
    })
    s.addText(q.src, {
      x: x + 0.7, y: y + h - 0.55, w: w - 0.9, h: 0.4, fontSize: 12, fontFace: 'Arial', color: C.teal, bold: true,
    })
  })

  s.addText('Fictional examples — actual voter quotes will replace these from week one.', {
    x: 0.55, y: 6.7, w: 12.25, h: 0.35, fontSize: 11, fontFace: 'Arial', color: C.faint, italic: true, align: 'center',
  })

  ftr(s, p)
  s.addNotes(`This is what no poll question captures. Read one quote out loud to make the point land.`)
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 10 — Augments every program (table, tight rows)
{
  const s = pptx.addSlide(); p++
  band(s, 'Augments every campaign program', 'Works alongside polling, field, digital, fundraising.')

  const rows = [
    { prog: 'Polling',         note: 'Catches shifts between polls. Sharpens question framing.' },
    { prog: 'Field',           note: 'PulseIQ scales reach. Agent handles repeat questions. Real briefings.' },
    { prog: 'Digital + Ads',   note: 'Test framing before ad spend. Reddit reveals organic language.' },
    { prog: 'Fundraising',     note: 'Why lapsed donors left. Agent answers concerns 24/7.' },
    { prog: 'Rapid Response',  note: 'Sentiment on any news cycle within hours, not weeks.' },
    { prog: 'Oppo Research',   note: 'Agent armed on Moody\'s AG record. Town halls surface contrast.' },
  ]

  const startY = 1.5
  const rowH = 0.78
  rows.forEach((r, i) => {
    const y = startY + i * (rowH + 0.08)
    s.addShape('roundRect', { x: 0.55, y, w: 3.4, h: rowH, rectRadius: 0.06, fill: { color: C.navy } })
    s.addText(r.prog, { x: 0.7, y, w: 3.1, h: rowH, fontSize: 18, fontFace: 'Arial', color: C.gold, bold: true, valign: 'middle' })

    s.addShape('roundRect', { x: 4.05, y, w: 8.75, h: rowH, rectRadius: 0.06, fill: { color: C.white }, line: { color: C.border, width: 0.4 } })
    s.addText(r.note, { x: 4.25, y, w: 8.4, h: rowH, fontSize: 15, fontFace: 'Arial', color: C.ink, valign: 'middle', wrap: true })
  })

  ftr(s, p)
  s.addNotes(`Important framing: this augments, not replaces. Pollsters keep polling, field keeps knocking — they all get sharper input.`)
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 11 — Architecture
{
  const s = pptx.addSlide(); p++
  band(s, 'Architecture', 'Listening posts feed the center. Messaging flows out.')

  // Left column - listening posts
  const lx = 0.55
  const ly = 1.55
  const lw = 3.2
  s.addText('LISTENING POSTS', { x: lx, y: ly, w: lw, h: 0.4, fontSize: 13, fontFace: 'Arial', color: C.faint, bold: true })
  const posts = ['📋  Surveys', '🤖  Agents 24×7', '💬  PulseIQ Live', '🟢  Reddit', '✍️  Substack', '🔍  Search']
  posts.forEach((post, i) => {
    const y = ly + 0.5 + i * 0.72
    s.addShape('roundRect', { x: lx, y, w: lw, h: 0.6, rectRadius: 0.06, fill: { color: C.white }, line: { color: C.border, width: 0.4 } })
    s.addText(post, { x: lx + 0.15, y, w: lw - 0.3, h: 0.6, fontSize: 14, fontFace: 'Arial', color: C.ink, valign: 'middle' })
  })

  // Center - database
  const cx = 4.55
  const cy = 2.4
  const cw = 4.2
  const ch = 3.4
  s.addShape('roundRect', { x: cx, y: cy, w: cw, h: ch, rectRadius: 0.2, fill: { color: C.navy }, line: { color: C.gold, width: 2 } })
  s.addText('VOTER\nINTELLIGENCE\nDATABASE', {
    x: cx + 0.2, y: cy + 0.6, w: cw - 0.4, h: 1.8, fontSize: 26, fontFace: 'Arial', color: C.white, bold: true, align: 'center',
  })
  s.addText('Opinions  ·  Language\nPriorities  ·  Affinities', {
    x: cx + 0.2, y: cy + 2.3, w: cw - 0.4, h: 0.9, fontSize: 13, fontFace: 'Arial', color: C.gold, align: 'center', italic: true,
  })

  // Right column - outputs
  const rx = 9.55
  const ry = 1.55
  const rw = 3.25
  s.addText('MESSAGING OUTPUTS', { x: rx, y: ry, w: rw, h: 0.4, fontSize: 13, fontFace: 'Arial', color: C.faint, bold: true })
  const outs = ['Talking Points', 'Ad Messaging', 'Debate Prep', 'Surrogate Briefs', 'Donor Decks', 'Rapid Response']
  outs.forEach((out, i) => {
    const y = ry + 0.5 + i * 0.72
    s.addShape('roundRect', { x: rx, y, w: rw, h: 0.6, rectRadius: 0.06, fill: { color: C.tealTint }, line: { color: C.teal, width: 0.6 } })
    s.addText(out, { x: rx + 0.15, y, w: rw - 0.3, h: 0.6, fontSize: 14, fontFace: 'Arial', color: C.teal, bold: true, valign: 'middle' })
  })

  // Connectors (visual arrows)
  s.addText('→', { x: 3.8, y: cy + ch / 2 - 0.35, w: 0.7, h: 0.7, fontSize: 32, color: C.teal, bold: true, align: 'center', valign: 'middle' })
  s.addText('→', { x: 8.8, y: cy + ch / 2 - 0.35, w: 0.7, h: 0.7, fontSize: 32, color: C.gold, bold: true, align: 'center', valign: 'middle' })

  ftr(s, p)
  s.addNotes(`One brain in the middle. Inputs on the left, products on the right. The Ana analytics engine powers all of it.`)
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 12 — Prepared authenticity (3 before/after rows, tight)
{
  const s = pptx.addSlide(); p++
  band(s, 'Prepared Authenticity', 'Not scripted. Not improvised. Deeply informed.')

  const scenes = [
    { when: 'Tampa Town Hall', before: 'Poll memo: "affordability is #1." Generic answer.',          after: '15 actual Tampa quotes — knows it\'s HOA insurance, not healthcare. Room leans in.' },
    { when: 'Boca Donor Dinner', before: '"Thank you for your support." Polite nods.',                after: 'Knows 40% of lapsed donors want "the plan, not just what\'s wrong." Checks flow.' },
    { when: 'Media Hit',         before: '3 talking points from comms. Reporter pivots. Deflect.',    after: 'Verbatim voter framing on the unexpected topic. Clip goes viral — felt unrehearsed.' },
  ]

  const startY = 1.5
  const rowH = 1.6
  scenes.forEach((sc, i) => {
    const y = startY + i * (rowH + 0.2)

    s.addShape('roundRect', { x: 0.55, y, w: 2.6, h: rowH, rectRadius: 0.08, fill: { color: C.navy } })
    s.addText(sc.when, { x: 0.7, y, w: 2.3, h: rowH, fontSize: 18, fontFace: 'Arial', color: C.gold, bold: true, valign: 'middle' })

    s.addShape('roundRect', { x: 3.25, y, w: 4.6, h: rowH, rectRadius: 0.08, fill: { color: C.redTint }, line: { color: C.red, width: 0.5 } })
    s.addText('WITHOUT', { x: 3.4, y: y + 0.1, w: 1.3, h: 0.3, fontSize: 10, fontFace: 'Arial', color: C.red, bold: true })
    s.addText(sc.before, { x: 3.4, y: y + 0.42, w: 4.3, h: rowH - 0.55, fontSize: 14, fontFace: 'Arial', color: C.mid, wrap: true, valign: 'top' })

    s.addShape('roundRect', { x: 7.95, y, w: 4.85, h: rowH, rectRadius: 0.08, fill: { color: C.greenTint }, line: { color: C.green, width: 0.6 } })
    s.addText('WITH SENTIMETRX', { x: 8.1, y: y + 0.1, w: 2.5, h: 0.3, fontSize: 10, fontFace: 'Arial', color: C.green, bold: true })
    s.addText(sc.after, { x: 8.1, y: y + 0.42, w: 4.55, h: rowH - 0.55, fontSize: 14, fontFace: 'Arial', color: C.ink, bold: true, wrap: true, valign: 'top' })
  })

  ftr(s, p)
  s.addNotes(
    `The Colonel is methodical, not a retail politician. That's a strength — but it means the infrastructure has to do the prep work. This is "prepared authenticity": no scripts, deep wells.`
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 13 — Why Moody can't catch up (5 short headlines)
{
  const s = pptx.addSlide(); p++
  band(s, 'Why Moody can\'t catch up', 'The longer this runs, the wider the gap.')

  const points = [
    { h: 'Voter words vs. consultant words', s: 'When Vindman says "Floridians choose between groceries and rent," it\'s because thousands said it.' },
    { h: 'The gap compounds weekly',          s: 'Apr: 200 points. Jun: 5K. Oct: 50K+. Moody can\'t poll her way to six months of listening.' },
    { h: 'Hours vs. weeks',                   s: 'News breaks; sentiment lands in hours. Moody waits for the next polling memo.' },
    { h: '500 conversations vs. zero',         s: 'Agent runs simultaneous chats in English, Spanish, Creole, 24/7. Moody has a donate button.' },
    { h: 'The system self-improves',           s: 'Chats → KB updates → surveys → town halls → messaging. No one lifts a finger.' },
  ]

  const startY = 1.5
  const rowH = 0.95
  points.forEach((pt, i) => {
    const y = startY + i * (rowH + 0.1)
    s.addShape('roundRect', { x: 0.55, y, w: 0.6, h: rowH, rectRadius: 0.08, fill: { color: C.gold } })
    s.addText(String(i + 1), { x: 0.55, y, w: 0.6, h: rowH, fontSize: 26, fontFace: 'Arial', color: C.navy, bold: true, align: 'center', valign: 'middle' })

    s.addShape('roundRect', { x: 1.25, y, w: 11.55, h: rowH, rectRadius: 0.08, fill: { color: C.white }, line: { color: C.border, width: 0.4 } })
    s.addText(pt.h, { x: 1.45, y: y + 0.1, w: 11.2, h: 0.42, fontSize: 18, fontFace: 'Arial', color: C.navy, bold: true })
    s.addText(pt.s, { x: 1.45, y: y + 0.5, w: 11.2, h: rowH - 0.55, fontSize: 13, fontFace: 'Arial', color: C.mid, italic: true, valign: 'top', wrap: true })
  })

  ftr(s, p)
  s.addNotes(`This is the closer for the strategic argument. Money can't reverse this — it's a structural advantage that compounds daily.`)
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 14 — Compounding timeline
{
  const s = pptx.addSlide(); p++
  band(s, 'The compounding timeline', 'Exponential, not linear. Start now.')

  const phases = [
    { when: 'Wk 1–2',  label: 'SEED',     count: '~200',     items: ['Agent live on site', 'First donor survey', 'Reddit/Substack mining', 'KB from positions'] },
    { when: 'Wk 3–4',  label: 'GROW',     count: '~2,000',   items: ['First PulseIQ (S. FL)', 'Spanish agent + survey', 'Reddit → agent training', 'First briefing deck'] },
    { when: 'Mo 2–3',  label: 'COMPOUND', count: '~10,000',  items: ['5 regional town halls', 'Survey → PulseIQ → agent loop', 'Cross-source analytics', 'Weekly insight decks'] },
    { when: 'Mo 4+',   label: 'DOMINATE', count: '50,000+',  items: ['Sentiment trend tracking', 'Surrogate prep from data', 'Debate prep from voter language', 'Oppo response intel'] },
  ]

  const startX = 0.55
  const w = 3.0
  const gapX = 0.2
  const y = 1.5
  const h = 5.4

  phases.forEach((ph, i) => {
    const x = startX + i * (w + gapX)
    const accent = i === 3 ? C.gold : C.teal

    s.addShape('roundRect', { x, y, w, h, rectRadius: 0.12, fill: { color: C.white }, line: { color: C.border, width: 0.5 } })
    s.addShape('rect', { x, y, w, h: 1.2, fill: { color: C.navy } })

    s.addText(ph.when, { x: x + 0.15, y: y + 0.15, w: w - 0.3, h: 0.35, fontSize: 13, fontFace: 'Arial', color: C.gold, bold: true })
    s.addText(ph.label, { x: x + 0.15, y: y + 0.5, w: w - 0.3, h: 0.6, fontSize: 22, fontFace: 'Arial', color: C.white, bold: true })

    s.addShape('rect', { x, y: y + 1.2, w, h: 0.9, fill: { color: accent } })
    s.addText(ph.count, { x: x + 0.1, y: y + 1.25, w: w - 0.2, h: 0.55, fontSize: 28, fontFace: 'Arial', color: C.white, bold: true, align: 'center' })
    s.addText('data points', { x: x + 0.1, y: y + 1.75, w: w - 0.2, h: 0.3, fontSize: 11, fontFace: 'Arial', color: C.white, align: 'center', italic: true })

    const bullets = ph.items.map(it => `•  ${it}`).join('\n\n')
    s.addText(bullets, {
      x: x + 0.2, y: y + 2.25, w: w - 0.4, h: h - 2.4, fontSize: 13, fontFace: 'Arial', color: C.ink, wrap: true, valign: 'top', lineSpacingMultiple: 1.15,
    })
  })

  ftr(s, p)
  s.addNotes(`By month 4 you're operating with a depth of voter understanding no last-minute spending can replicate. The earlier we start, the wider the moat.`)
}

// ──────────────────────────────────────────────────────────────────────────
// Slide 15 — Next steps (huge, 4 items)
{
  const s = pptx.addSlide(); p++
  band(s, 'Next steps', 'Start building the database today.')

  const steps = [
    { n: '1', t: '30-min live demo',       sub: 'Campaign leadership  ·  Florida-specific data' },
    { n: '2', t: 'Share positions + briefs', sub: 'Agent knowledge base live within 48 hours' },
    { n: '3', t: 'Pick first survey audience', sub: 'Active donors recommended — fastest signal' },
    { n: '4', t: 'Pick first PulseIQ region', sub: 'South Florida recommended for diversity + reach' },
  ]

  const startY = 1.6
  const rowH = 1.18
  steps.forEach((st, i) => {
    const y = startY + i * (rowH + 0.15)

    s.addShape('ellipse', { x: 0.7, y: y + 0.2, w: 0.8, h: 0.8, fill: { color: C.gold } })
    s.addText(st.n, { x: 0.7, y: y + 0.2, w: 0.8, h: 0.8, fontSize: 32, fontFace: 'Arial', color: C.navy, bold: true, align: 'center', valign: 'middle' })

    s.addShape('roundRect', { x: 1.7, y, w: 11.1, h: rowH, rectRadius: 0.1, fill: { color: C.white }, line: { color: C.border, width: 0.5 } })
    s.addText(st.t, { x: 1.95, y: y + 0.15, w: 10.7, h: 0.5, fontSize: 24, fontFace: 'Arial', color: C.navy, bold: true })
    s.addText(st.sub, { x: 1.95, y: y + 0.65, w: 10.7, h: 0.45, fontSize: 14, fontFace: 'Arial', color: C.mid, italic: true })
  })

  ftr(s, p)
  s.addNotes(`Close on action. Each of the four is a small commitment that unblocks momentum.`)
}

// ──────────────────────────────────────────────────────────────────────────

const out = path.join(os.homedir(), 'Downloads', 'Vindman_Voter_Intelligence_Platform_v2.pptx')
pptx.writeFile({ fileName: out }).then(() => {
  console.log(`✓ Wrote ${out}`)
  console.log(`  ${p} slides`)
})
