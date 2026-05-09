// GET /api/signal-tiers-deck — generates a PPTX explaining Reddit + Substack signal tiers
// Downloads directly to the browser

import { NextResponse } from 'next/server'
import PptxGenJS from 'pptxgenjs'
import { DN as DN_SHARED, W, H, trunc } from '@/lib/pptx/shared'
import { requireAdmin } from '@/lib/auth/requireAdmin'

export const dynamic = 'force-dynamic'

// Signal-tiers-deck has unique colors (sarinaBlue, rose, emerald)
const DN = {
  ...DN_SHARED,
  orange:     'E8632A',  // override (hermes variant)
  sarinaBlue: '00B4D8',
  gray:       '9CA3AF',
  rose:       'E11D48',
  emerald:    '10B981',
}

function addHeader(slide: any, title: string, subtitle?: string) {
  slide.addShape('rect', { x: 0, y: 0, w: W, h: 1.1, fill: { color: DN.navy } })
  slide.addText(title, { x: 0.6, y: 0.15, w: 10, h: 0.55, fontSize: 26, fontFace: 'Arial', color: DN.white, bold: true })
  if (subtitle) {
    slide.addText(subtitle, { x: 0.6, y: 0.65, w: 10, h: 0.35, fontSize: 14, fontFace: 'Arial', color: DN.sarinaBlue })
  }
  slide.addShape('rect', { x: 0, y: 1.1, w: W, h: 0.04, fill: { color: DN.sarinaBlue } })
}

function addFooter(slide: any, page: number) {
  slide.addText('datanautix.com', { x: 0.5, y: H - 0.4, w: 3, h: 0.3, fontSize: 9, color: DN.slate, fontFace: 'Arial' })
  slide.addText(String(page), { x: W - 1, y: H - 0.4, w: 0.5, h: 0.3, fontSize: 9, color: DN.slate, fontFace: 'Arial', align: 'right' })
  // Logo placeholder
  slide.addText('DATANAUTIX', { x: W - 2.5, y: 0.2, w: 2, h: 0.4, fontSize: 11, fontFace: 'Arial', color: DN.orange, bold: true, align: 'right' })
}

function tierCard(slide: any, x: number, y: number, w: number, h: number, label: string, color: string, bgColor: string, description: string, criteria: string) {
  slide.addShape('roundRect', { x, y, w, h, rectRadius: 0.1, fill: { color: bgColor }, line: { color: color, width: 1.5 } })
  slide.addText(label, { x: x + 0.15, y: y + 0.1, w: w - 0.3, h: 0.4, fontSize: 16, fontFace: 'Arial', color: color, bold: true })
  slide.addText(description, { x: x + 0.15, y: y + 0.5, w: w - 0.3, h: 0.5, fontSize: 11, fontFace: 'Arial', color: '374151', wrap: true })
  slide.addText(criteria, { x: x + 0.15, y: y + 1.0, w: w - 0.3, h: 0.4, fontSize: 9, fontFace: 'Arial', color: DN.slate, italic: true, wrap: true })
}

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied

  var pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Datanautix'
  pptx.title = 'Signal Tiers: Reddit & Substack Community Analysis'
  var p = 0

  // ═══ SLIDE 1: Title ═══
  var s1 = pptx.addSlide()
  s1.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.navy } })
  s1.addShape('rect', { x: 0, y: 3.2, w: W, h: 0.04, fill: { color: DN.sarinaBlue } })
  s1.addText('Signal Tier Analysis', { x: 0.8, y: 1.5, w: 11, h: 1.0, fontSize: 40, fontFace: 'Arial', color: DN.white, bold: true })
  s1.addText('Mining Community Conversations from Reddit & Substack', { x: 0.8, y: 2.4, w: 11, h: 0.6, fontSize: 20, fontFace: 'Arial', color: DN.sarinaBlue })
  s1.addText('Separating Signal from Noise in Public Discourse', { x: 0.8, y: 3.5, w: 11, h: 0.5, fontSize: 16, fontFace: 'Arial', color: DN.slate })
  s1.addText('DATANAUTIX', { x: W - 3, y: H - 1, w: 2.5, h: 0.5, fontSize: 14, fontFace: 'Arial', color: DN.orange, bold: true, align: 'right' })
  s1.addText(new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), { x: 0.8, y: H - 1, w: 4, h: 0.5, fontSize: 12, fontFace: 'Arial', color: DN.slate })

  // ═══ SLIDE 2: Why Community Conversations ═══
  p++
  var s2 = pptx.addSlide()
  addHeader(s2, 'Why Community Conversations Matter', 'The untapped layer of public opinion')
  addFooter(s2, p)
  var whyItems = [
    { title: 'Organic & Unsolicited', desc: 'People choose to discuss these topics — nobody prompted them. This reveals genuine priorities and concerns.' },
    { title: 'Socially Validated', desc: 'Upvotes, likes, and replies show which arguments resonate. You see not just what people say, but what others agree with.' },
    { title: 'Real Language', desc: 'Community conversations use the actual words and framing real people use — not sanitized survey responses. This is the language that works.' },
    { title: 'Layered Discourse', desc: 'Reddit captures mass public opinion. Substack captures opinion leader influence. Together they map the full conversation landscape.' },
  ]
  whyItems.forEach(function(item, i) {
    var y = 1.5 + i * 1.3
    s2.addShape('roundRect', { x: 0.6, y, w: 12, h: 1.1, rectRadius: 0.08, fill: { color: i % 2 === 0 ? DN.slateLight : DN.white }, line: { color: 'D1D5DB', width: 0.5 } })
    s2.addText(item.title, { x: 0.9, y: y + 0.1, w: 3, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.navy, bold: true })
    s2.addText(item.desc, { x: 0.9, y: y + 0.5, w: 11.4, h: 0.5, fontSize: 11, fontFace: 'Arial', color: '374151', wrap: true })
  })

  // ═══ SLIDE 3: Reddit vs Substack ═══
  p++
  var s3 = pptx.addSlide()
  addHeader(s3, 'Two Sources, Two Perspectives', 'Reddit captures the crowd. Substack captures the influencers.')
  addFooter(s3, p)

  // Reddit column — Sarina Blue
  s3.addShape('roundRect', { x: 0.6, y: 1.5, w: 5.8, h: 4.5, rectRadius: 0.1, fill: { color: 'E0F7FA' }, line: { color: DN.sarinaBlue, width: 2 } })
  s3.addText('Reddit', { x: 0.9, y: 1.6, w: 5, h: 0.5, fontSize: 22, fontFace: 'Arial', color: DN.sarinaBlue, bold: true })
  s3.addText('Mass Public Opinion', { x: 0.9, y: 2.1, w: 5, h: 0.3, fontSize: 13, fontFace: 'Arial', color: DN.sarinaBlue, italic: true })
  var redditPoints = [
    'Anonymous discourse — people say what they really think',
    'Upvote/downvote system creates a natural ranking',
    'Per-thread context: what resonates in THIS conversation',
    'Score = net community endorsement (up minus down)',
    'High volume: hundreds to thousands of comments per thread',
  ]
  redditPoints.forEach(function(pt, i) {
    s3.addText('• ' + pt, { x: 1.0, y: 2.6 + i * 0.55, w: 5, h: 0.5, fontSize: 11, fontFace: 'Arial', color: '374151', wrap: true })
  })

  // Substack column — Ana Orange
  s3.addShape('roundRect', { x: 6.9, y: 1.5, w: 5.8, h: 4.5, rectRadius: 0.1, fill: { color: 'FFF4EF' }, line: { color: DN.orange, width: 2 } })
  s3.addText('Substack', { x: 7.2, y: 1.6, w: 5, h: 0.5, fontSize: 22, fontFace: 'Arial', color: DN.orange, bold: true })
  s3.addText('Opinion Leader Influence', { x: 7.2, y: 2.1, w: 5, h: 0.3, fontSize: 13, fontFace: 'Arial', color: DN.orange, italic: true })
  var substackPoints = [
    'Named commenters — engaged subscribers with identity',
    'Like (heart) system — endorsement only, no rejection signal',
    'Author replies = curated endorsement from the influencer',
    'Reply threads show depth of engagement on specific arguments',
    'Quality over quantity: fewer but more thoughtful responses',
  ]
  substackPoints.forEach(function(pt, i) {
    s3.addText('• ' + pt, { x: 7.3, y: 2.6 + i * 0.55, w: 5, h: 0.5, fontSize: 11, fontFace: 'Arial', color: '374151', wrap: true })
  })

  // ═══ SLIDE 4: The Signal Tier Philosophy ═══
  p++
  var s4 = pptx.addSlide()
  addHeader(s4, 'The Signal Tier Philosophy', 'Not all comments are equal — classify by community validation')
  addFooter(s4, p)

  s4.addText('The core insight: engagement volume determines whether a comment is signal or noise.\nA comment with 500 upvotes carries more weight than one with 2.\nA comment with 50 likes on Substack matters more than one with none.', {
    x: 0.6, y: 1.5, w: 12, h: 1.0, fontSize: 13, fontFace: 'Arial', color: '374151', wrap: true, lineSpacingMultiple: 1.5,
  })

  s4.addText('The Method: Per-Thread Percentile Ranking', { x: 0.6, y: 2.7, w: 12, h: 0.4, fontSize: 16, fontFace: 'Arial', color: DN.navy, bold: true })

  var steps = [
    '1. Group comments by thread (Reddit) or post (Substack)',
    '2. Within each group, rank all comments by score/likes from highest to lowest',
    '3. Assign a percentile (100th = top comment, 0th = bottom)',
    '4. Classify into tiers based on where each comment falls',
    '5. Thresholds are adjustable (default: 70th/30th percentile)',
  ]
  steps.forEach(function(step, i) {
    s4.addShape('roundRect', { x: 0.8, y: 3.3 + i * 0.5, w: 11.5, h: 0.42, rectRadius: 0.05, fill: { color: i % 2 === 0 ? DN.slateLight : DN.white } })
    s4.addText(step, { x: 1.0, y: 3.3 + i * 0.5, w: 11, h: 0.42, fontSize: 12, fontFace: 'Arial', color: DN.navy })
  })

  s4.addText('Why per-thread? A +50 comment in a thread where the top is +5000 is mid-tier.\nThe same +50 in a thread where the top is +60 is near the top. Context matters.', {
    x: 0.6, y: 6.0, w: 12, h: 0.7, fontSize: 11, fontFace: 'Arial', color: DN.slate, italic: true, wrap: true, lineSpacingMultiple: 1.4,
  })

  // ═══ SLIDE 5: Reddit Signal Tiers ═══
  p++
  var s5 = pptx.addSlide()
  addHeader(s5, 'Reddit Signal Tiers', 'Four categories based on per-thread score percentile')
  addFooter(s5, p)

  tierCard(s5, 0.5, 1.5, 5.9, 1.5, '⬆ Mainstream', DN.green, 'ECFDF5',
    'Comments that won the room. High community endorsement — these arguments resonated.',
    'Criteria: ≥ 70th percentile by score within thread')

  tierCard(s5, 6.9, 1.5, 5.9, 1.5, '⚠ Controversial', DN.amber, 'FFFBEB',
    'Mixed reception. These arguments got attention but didn\'t achieve consensus.',
    'Criteria: 30th–70th percentile by score within thread')

  tierCard(s5, 0.5, 3.5, 5.9, 1.5, '⬇ Fringe', DN.red, 'FEF2F2',
    'Actively rejected views. The community downvoted these — but they still tell you what\'s out there.',
    'Criteria: Negative net score (regardless of percentile)')

  tierCard(s5, 6.9, 3.5, 5.9, 1.5, '• Noise', DN.gray, 'F9FAFB',
    'Low engagement. Nobody cared enough to vote either way.',
    'Criteria: Below 30th percentile, non-negative score')

  s5.addText('For political strategy: Mainstream = messages that work.  Controversial = topics that polarize.  Fringe = positions the crowd rejects.', {
    x: 0.5, y: 5.5, w: 12, h: 0.6, fontSize: 12, fontFace: 'Arial', color: DN.navy, italic: true, wrap: true,
  })

  // ═══ SLIDE 6: Substack Signal Tiers ═══
  p++
  var s6 = pptx.addSlide()
  addHeader(s6, 'Substack Signal Tiers', 'Three tiers + author endorsement flag (likes-based)')
  addFooter(s6, p)

  tierCard(s6, 0.5, 1.5, 5.9, 1.5, '❤ Resonant', DN.green, 'ECFDF5',
    'High-like comments that connected with the audience. These arguments landed.',
    'Criteria: ≥ 70th percentile by likes within post')

  tierCard(s6, 6.9, 1.5, 5.9, 1.5, '💬 Discussed', DN.amber, 'FFFBEB',
    'Moderate likes or high reply count. Generated conversation even if not universally endorsed.',
    'Criteria: 30th–70th percentile by likes, OR 3+ replies')

  tierCard(s6, 0.5, 3.5, 5.9, 1.5, '⬇ Low Engagement', DN.red, 'FEF2F2',
    'Below the threshold but some minimal engagement. Background noise.',
    'Criteria: Below 30th percentile with some activity')

  tierCard(s6, 6.9, 3.5, 5.9, 1.5, '• Ignored', DN.gray, 'F9FAFB',
    'Zero engagement. No likes, no replies. Not necessarily wrong — just didn\'t register.',
    'Criteria: 0 likes and 0 replies')

  // Author Reply badge
  s6.addShape('roundRect', { x: 0.5, y: 5.4, w: 12.3, h: 0.8, rectRadius: 0.08, fill: { color: 'FFF1F2' }, line: { color: DN.rose, width: 1.5 } })
  s6.addText('Author Reply Badge', { x: 0.8, y: 5.45, w: 3, h: 0.35, fontSize: 13, fontFace: 'Arial', color: DN.rose, bold: true })
  s6.addText('Any comment the publication author replied to gets flagged. This is a curated endorsement from the opinion leader — it tells you what arguments the influencer validates.', {
    x: 0.8, y: 5.8, w: 11.5, h: 0.35, fontSize: 11, fontFace: 'Arial', color: '374151', wrap: true,
  })

  // ═══ SLIDE 7: Key Differences ═══
  p++
  var s7 = pptx.addSlide()
  addHeader(s7, 'Reddit vs Substack: Key Differences', 'Same framework, adapted for each platform\'s dynamics')
  addFooter(s7, p)

  var diffRows = [
    ['Signal Metric', 'Net score (upvotes − downvotes)', 'Likes (hearts) — endorsement only'],
    ['Rejection Signal', 'Downvotes → Fringe tier', 'No downvotes → Low Engagement instead'],
    ['Author Signal', 'Is OP (original poster) flag', 'Author Reply badge (publication writer)'],
    ['Anonymity', 'Anonymous/pseudonymous', 'Named subscribers with identity'],
    ['Volume', 'High (hundreds per thread)', 'Lower (tens per post, deeper engagement)'],
    ['Use Case', 'Mass opinion polling', 'Influencer audience sentiment'],
    ['Best For', '"What does the crowd think?"', '"What do engaged readers think?"'],
  ]
  diffRows.forEach(function(row, i) {
    var y = 1.5 + i * 0.75
    var isHeader = i === 0
    s7.addShape('rect', { x: 0.5, y, w: 3.5, h: 0.65, fill: { color: isHeader ? DN.navy : (i % 2 === 0 ? DN.slateLight : DN.white) } })
    s7.addShape('rect', { x: 4.0, y, w: 4.4, h: 0.65, fill: { color: isHeader ? DN.emerald : (i % 2 === 0 ? 'ECFDF5' : DN.white) } })
    s7.addShape('rect', { x: 8.4, y, w: 4.4, h: 0.65, fill: { color: isHeader ? DN.rose : (i % 2 === 0 ? 'FFF1F2' : DN.white) } })
    s7.addText(row[0], { x: 0.6, y, w: 3.3, h: 0.65, fontSize: isHeader ? 12 : 11, fontFace: 'Arial', color: isHeader ? DN.white : DN.navy, bold: isHeader, valign: 'middle' })
    s7.addText(row[1], { x: 4.1, y, w: 4.2, h: 0.65, fontSize: isHeader ? 12 : 11, fontFace: 'Arial', color: isHeader ? DN.white : '374151', bold: isHeader, valign: 'middle', wrap: true })
    s7.addText(row[2], { x: 8.5, y, w: 4.2, h: 0.65, fontSize: isHeader ? 12 : 11, fontFace: 'Arial', color: isHeader ? DN.white : '374151', bold: isHeader, valign: 'middle', wrap: true })
  })

  // ═══ SLIDE 8: Use Cases ═══
  p++
  var s8 = pptx.addSlide()
  addHeader(s8, 'Strategic Applications', 'How campaign teams and brand strategists use Signal Tiers')
  addFooter(s8, p)

  var useCases = [
    { title: 'Message Testing', desc: 'Identify which talking points consistently land in the Mainstream tier across multiple threads. These are your proven messages — the words that resonate.' },
    { title: 'Risk Detection', desc: 'Track Controversial tier themes. These are the topics where your audience is split. They need careful framing — or avoidance.' },
    { title: 'Opposition Research', desc: 'The Fringe tier shows what the community actively rejects. These are your opponent\'s weak positions — arguments the crowd has already dismissed.' },
    { title: 'Narrative Shaping', desc: 'Cross-tab themes against Signal Tiers: "The economy argument is Mainstream in 8 of 12 threads." This data-driven narrative testing replaces gut feel.' },
    { title: 'Influencer Intelligence', desc: 'Substack\'s Author Reply badge shows which arguments opinion leaders validate. Track which commenters consistently get author engagement.' },
  ]
  useCases.forEach(function(uc, i) {
    var y = 1.5 + i * 1.1
    s8.addShape('roundRect', { x: 0.5, y, w: 12.3, h: 0.9, rectRadius: 0.08, fill: { color: i % 2 === 0 ? DN.slateLight : DN.white }, line: { color: 'D1D5DB', width: 0.5 } })
    s8.addText(uc.title, { x: 0.8, y: y + 0.05, w: 3, h: 0.35, fontSize: 13, fontFace: 'Arial', color: DN.navy, bold: true })
    s8.addText(uc.desc, { x: 0.8, y: y + 0.4, w: 11.7, h: 0.45, fontSize: 11, fontFace: 'Arial', color: '374151', wrap: true })
  })

  // ═══ SLIDE 9: About ═══
  p++
  var s9 = pptx.addSlide()
  s9.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.navy } })
  s9.addShape('rect', { x: 0, y: 3.0, w: W, h: 0.04, fill: { color: DN.sarinaBlue } })
  s9.addText('DATANAUTIX', { x: 0.8, y: 1.5, w: 11, h: 0.7, fontSize: 32, fontFace: 'Arial', color: DN.orange, bold: true })
  s9.addText('Turning Community Conversations into Strategic Intelligence', { x: 0.8, y: 2.2, w: 11, h: 0.5, fontSize: 18, fontFace: 'Arial', color: DN.sarinaBlue })
  s9.addText('datanautix.com', { x: 0.8, y: 3.5, w: 11, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.slate })
  s9.addText('Generated ' + new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), {
    x: 0.8, y: H - 1, w: 5, h: 0.4, fontSize: 11, fontFace: 'Arial', color: DN.slate,
  })

  var buf = await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer
  return new NextResponse(Buffer.from(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': 'attachment; filename="Signal_Tiers_Reddit_Substack.pptx"',
    },
  })
}
