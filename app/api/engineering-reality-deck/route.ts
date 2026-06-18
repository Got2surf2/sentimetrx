// GET /api/engineering-reality-deck — honest engineering review for a peer
// audience (senior eng / YC alum / technical advisor). Not a pitch deck.
// Says what got built, what discipline exists, what is missing, where the
// risks are, and what hardening would buy with capital.

import { NextResponse } from 'next/server'
import PptxGenJS from 'pptxgenjs'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { logDeckDownload } from '@/lib/auth/logDeckDownload'

export const dynamic = 'force-dynamic'

const DN = {
  teal:         '0F7173',
  tealDark:     '0A4F51',
  tealPale:     'E0F7FA',
  navy:         '0D2B45',
  navyMid:      '0F3A54',
  gold:         'E8B84B',
  orange:       'E85A1A',
  ink:          '0D2B45',
  slate:        '8FA3AE',
  slateLight:   'E8EDEF',
  slateCard:    'F4F7F8',
  white:        'FFFFFF',
  sarinaBlue:   '00B4D8',
  hermesOrange: 'E8632A',
  green:        '059669',
  greenLight:   'D1FAE5',
  red:          'DC2626',
  redLight:     'FEE2E2',
  amber:        'D97706',
  amberLight:   'FEF3C7',
  purple:       '6D28D9',
}

const W = 13.33
const H = 7.5

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function addHeader(slide: any, title: string, subtitle?: string) {
  slide.addShape('rect', { x: 0, y: 0, w: W, h: 1.0, fill: { color: DN.navy } })
  slide.addText(title, {
    x: 0.6, y: subtitle ? 0.1 : 0.15, w: 9.5, h: subtitle ? 0.5 : 0.7,
    fontSize: 24, fontFace: 'Arial', color: DN.white, bold: true, valign: 'middle',
  })
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.6, y: 0.55, w: 9.5, h: 0.35,
      fontSize: 12, fontFace: 'Arial', color: DN.sarinaBlue, italic: true, valign: 'middle',
    })
  }
  slide.addText([
    { text: 'data', options: { color: DN.hermesOrange, bold: true, italic: true } },
    { text: 'nautix', options: { color: DN.sarinaBlue, bold: true, italic: true } },
  ], { x: W - 2.4, y: 0.2, w: 2.0, h: 0.5, fontSize: 16, fontFace: 'Arial', valign: 'middle', align: 'right' })
  slide.addShape('rect', { x: 0, y: 1.0, w: W, h: 0.04, fill: { color: DN.sarinaBlue } })
}

function addFooter(slide: any, pageNum: number) {
  slide.addText('Datanautix · Engineering Reality Check · For peer review · Confidential', {
    x: 0.5, y: H - 0.4, w: 10, h: 0.3, fontSize: 9, fontFace: 'Arial', color: DN.slate,
  })
  slide.addText(`${pageNum}`, {
    x: W - 1, y: H - 0.4, w: 0.5, h: 0.3, fontSize: 9, fontFace: 'Arial', color: DN.slate, align: 'right',
  })
}

function bullet(text: string, opts: any = {}) {
  return {
    text,
    options: {
      fontSize: 12, fontFace: 'Arial', color: DN.ink, lineSpacing: 20,
      bullet: { code: '2022' },
      ...opts,
    },
  }
}

// ── Cover ──────────────────────────────────────────────────────────────────
function addTitleSlide(pptx: any) {
  const s = pptx.addSlide()
  const buildDate = process.env.NEXT_PUBLIC_BUILD_DATE
  const lastUpdated = buildDate ? fmtDate(new Date(buildDate)) : fmtDate(new Date())
  const downloaded = fmtDate(new Date())

  s.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.navy } })
  s.addShape('ellipse', { x: W - 4.5, y: -1.5, w: 5.5, h: 5.5, fill: { color: DN.teal, transparency: 88 }, line: { width: 0 } })
  s.addShape('ellipse', { x: W - 3.0, y: 0.5, w: 3.5, h: 3.5, fill: { color: DN.sarinaBlue, transparency: 92 }, line: { width: 0 } })
  s.addShape('rect', { x: 0, y: 0, w: W, h: 0.07, fill: { color: DN.gold } })

  s.addText('DATANAUTIX', { x: 0.8, y: 1.4, w: 11, h: 0.5, fontSize: 16, fontFace: 'Arial', color: DN.gold, bold: true, charSpacing: 2 })
  s.addText('Engineering Reality Check', { x: 0.8, y: 2.1, w: 11, h: 1.0, fontSize: 40, fontFace: 'Arial', color: DN.white, bold: true })
  s.addShape('rect', { x: 0.8, y: 3.2, w: 4.5, h: 0.04, fill: { color: DN.gold } })
  s.addText('A Claude-spined stack solving real, well-understood problems — an honest engineering peer review', {
    x: 0.8, y: 3.4, w: 11, h: 0.6, fontSize: 16, fontFace: 'Arial', color: DN.sarinaBlue, italic: true,
  })
  s.addText('Built March 1, 2026 → present  ·  ~16 weeks  ·  1 operator + AI-assisted engineering  ·  on top of 12 years of NLP / NLU domain expertise', {
    x: 0.8, y: 4.3, w: 11, h: 0.6, fontSize: 13, fontFace: 'Arial', color: DN.white, lineSpacing: 20,
  })
  s.addText(`Last updated  ${lastUpdated}     ·     Downloaded  ${downloaded}`, {
    x: 0.8, y: 5.5, w: 11, h: 0.35,
    fontSize: 11, fontFace: 'Arial', color: DN.slate, italic: true,
  })

  s.addShape('rect', { x: 0, y: H - 0.5, w: W, h: 0.5, fill: { color: DN.navyMid } })
  s.addText([
    { text: 'data', options: { color: DN.hermesOrange, bold: true, italic: true } },
    { text: 'nautix', options: { color: DN.sarinaBlue, bold: true, italic: true } },
    { text: '   ·   datanautix.com   ·   Confidential   ·   Not for external distribution', options: { color: DN.slate } },
  ], { x: 0.6, y: H - 0.45, w: 12, h: 0.4, fontSize: 12, fontFace: 'Arial', valign: 'middle' })
}

// ── 1. The Frame ───────────────────────────────────────────────────────────
function slideTheFrame(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, '~16 weeks. One operator. AI-assisted.')
  addFooter(s, pg)

  // Four big anchor stats
  const stats = [
    { v: '16 wk', l: 'Mar 1 → Jun 18, 2026' },
    { v: '2,428', l: 'commits' },
    { v: '12 yr', l: 'NLP / NLU practice' },
    { v: '~193K', l: 'lines of TypeScript' },
  ]
  stats.forEach((stat, i) => {
    const x = 0.5 + i * 3.15
    const y = 1.7
    s.addShape('rect', { x, y, w: 3.0, h: 2.4, fill: { color: DN.slateCard }, rectRadius: 0.1 })
    s.addText(stat.v, { x, y: y + 0.3, w: 3.0, h: 1.2, fontSize: 48, fontFace: 'Arial', color: DN.sarinaBlue, bold: true, align: 'center', valign: 'middle', autoFit: true })
    s.addText(stat.l, { x, y: y + 1.55, w: 3.0, h: 0.7, fontSize: 14, fontFace: 'Arial', color: DN.slate, italic: true, align: 'center', valign: 'middle', autoFit: true })
  })

  s.addShape('rect', { x: 0.5, y: 5.0, w: 12.3, h: 1.5, fill: { color: DN.navy }, rectRadius: 0.1 })
  s.addShape('rect', { x: 0.5, y: 5.0, w: 0.2, h: 1.5, fill: { color: DN.gold } })
  s.addText('How to read this', { x: 0.85, y: 5.1, w: 6, h: 0.3, fontSize: 10, fontFace: 'Arial', color: DN.gold, bold: true, charSpacing: 3 })
  s.addText("It's a peer review. Honest about what works and what doesn't.", {
    x: 0.85, y: 5.4, w: 12.0, h: 0.55, fontSize: 18, fontFace: 'Arial', color: DN.white, bold: true,
  })
  s.addText('The disciplines that exist are the ones that scale to one operator. The gaps are the ones that need a team.', {
    x: 0.85, y: 5.95, w: 12.0, h: 0.45, fontSize: 12, fontFace: 'Arial', color: DN.sarinaBlue, italic: true,
  })

  s.addNotes(
`Open by setting the frame clearly. This is NOT a pitch. It's a peer review.

Cover the four anchor stats:
- ~16 WEEKS: first commit March 1, 2026. So when I say "built recently" — that's what I mean.
- 2,428 COMMITS: dense work, lots of iteration.
- 12 YEARS of NLP/NLU: this is the part that matters. The design judgment, the data model, every architectural decision came from that experience — not from AI.
- ~193K LINES of TypeScript across 903 files: production scale, not prototype.

Detail to weave in:
- Single operator + AI-assisted engineering.
- Operator-led on every architectural decision, data model, product flow, integration choice, and safety policy.
- AI implemented ~70-80% of the line code under operator review.
- Production deployment: Vercel + Supabase, no dedicated DevOps.
- Stack: Next.js 16 App Router, React 19, TypeScript strict, Supabase Postgres + RLS + pgvector, Anthropic Claude, OpenAI embeddings, Sentry, pptxgenjs.

LAND THE BOTTOM STRAP: "Read this with that constraint in mind. Disciplines that exist scale to one operator. Gaps need a team."`
  )
}

// ── 1b. Positioning (real problems, deep experience, where funding goes) ─────
function slidePositioning(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Anyone can build a tool now. We solve real problems.', '20 years across platforms → a Claude-spined stack for known, well-understood pain points')
  addFooter(s, pg)

  // LEFT — THE EDGE (highlighted)
  s.addShape('rect', { x: 0.5, y: 1.35, w: 5.95, h: 4.1, fill: { color: DN.tealPale }, rectRadius: 0.12 })
  s.addShape('rect', { x: 0.5, y: 1.35, w: 5.95, h: 0.65, fill: { color: DN.teal }, rectRadius: 0.12 })
  s.addText('THE EDGE', { x: 0.5, y: 1.35, w: 5.95, h: 0.65, fontFace: 'Arial', fontSize: 15, color: DN.white, bold: true, align: 'center', valign: 'middle', charSpacing: 3 })
  s.addText([
    bullet('20 years building across data + insights platforms — 12 of them in NLP / NLU', { fontSize: 13, color: DN.navy, bold: true }),
    bullet('Claude is the spine of the stack — the reasoning core, not a thin wrapper', { fontSize: 13, color: DN.navy }),
    bullet('We solve real, well-understood problems with known pain points — not a demo in search of a use case', { fontSize: 13, color: DN.navy }),
    bullet('Already validated by real customers: Globetrotters · JW Marriott · UCF Rosen · MCO · Orlando Magic', { fontSize: 13, color: DN.navy }),
  ], { x: 0.8, y: 2.2, w: 5.4, h: 3.1, valign: 'top' })

  // RIGHT — WHERE INITIAL FUNDING GOES
  s.addShape('rect', { x: 6.85, y: 1.35, w: 5.95, h: 4.1, fill: { color: DN.slateCard }, rectRadius: 0.12 })
  s.addShape('rect', { x: 6.85, y: 1.35, w: 5.95, h: 0.65, fill: { color: DN.navy }, rectRadius: 0.12 })
  s.addText('WHERE INITIAL FUNDING GOES', { x: 6.85, y: 1.35, w: 5.95, h: 0.65, fontFace: 'Arial', fontSize: 14, color: DN.white, bold: true, align: 'center', valign: 'middle', charSpacing: 2 })
  s.addText([
    bullet('Scalability — load + concurrency baselines, per-org cost controls, durable pipelines', { fontSize: 13 }),
    bullet('Enterprise usability — SOC 2 / GDPR, admin + onboarding, performance, polish', { fontSize: 13 }),
    bullet('Hardening a working platform against demand that already exists — not funding a search for product-market fit', { fontSize: 13 }),
  ], { x: 7.15, y: 2.2, w: 5.4, h: 3.1, valign: 'top' })

  // Bottom strap — roll-up as upside, not the whole story
  s.addShape('rect', { x: 0.5, y: 5.65, w: 12.3, h: 0.7, fill: { color: DN.navy }, rectRadius: 0.08 })
  s.addText('The large, fragmented market is the upside. Consolidation is one path — not the whole story.', {
    x: 0.5, y: 5.65, w: 12.3, h: 0.7, fontSize: 16, fontFace: 'Arial', color: DN.gold, bold: true, italic: true, align: 'center', valign: 'middle',
  })

  s.addText('Underlying market — VoC / qualitative research / reputation / social listening — is multi-billion-dollar and fragmented; specific figures cited before external use.', {
    x: 0.5, y: 6.45, w: 12.3, h: 0.35, fontSize: 10, fontFace: 'Arial', color: DN.slate, italic: true, align: 'center',
  })

  s.addNotes(
`The positioning slide. Lead with defensibility, not the roll-up.

THE BARRIER COLLAPSED (the header): say it plainly — anyone with an idea can ship a tool now. AI made building cheap. That's exactly why novelty isn't the moat.

THE EDGE (left): our moat is that we're NOT chasing a novel idea. 20 years building across data + insights platforms — 12 specifically in NLP/NLU. Claude is the spine of the stack (the reasoning core, deeply integrated — not a wrapper). And we solve real, well-understood problems with KNOWN pain points — surveys nobody answers, open-ends nobody can read, meetings nobody can mine. Real customers already validate it: Globetrotters, JW Marriott, UCF Rosen, MCO, Orlando Magic. (Reconciles with the "12 yr NLP/NLU" anchor stat: 20 across platforms, 12 in NLP.)

WHERE INITIAL FUNDING GOES (right): this is the use-of-funds in one line — we're not raising to find product-market fit. The platform works and has customers. Initial capital shores it up on two axes: SCALABILITY (load/concurrency baselines, per-org cost caps, durable pipelines) and ENTERPRISE USABILITY (SOC 2 / GDPR, admin + onboarding, performance, polish). It maps directly to the hardening slide later.

THE UPSIDE (bottom strap): the large fragmented market and the AI-led roll-up are real upside — but they're optionality on top of a working product, not the identity. "Consolidation is one path, not the whole story." Full roll-up thesis lives in the Datanautix Roll-up deck for anyone who wants it.`
  )
}

// ── 2. What Got Built ──────────────────────────────────────────────────────
function slideWhatGotBuilt(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'What Got Built', '13 modules across customer-facing + platform · 903 TS files · ~193K lines')
  addFooter(s, pg)

  type Mod = { name: string; tag: string; desc: string; layer: 'customer' | 'infra' }
  const modules: Mod[] = [
    // ── Customer-facing (7) ──
    { name: 'Sarina',          tag: 'Surveys',          desc: 'Conversational runtime · LLM clarifiers · adaptive flow · 16 languages', layer: 'customer' },
    { name: 'Ana',             tag: 'Analytics',        desc: 'Text analytics · 13 chart types · stats · PPTX export · 500K-row datasets',   layer: 'customer' },
    { name: 'Town Hall',       tag: 'Recorded meetings', desc: 'ASR (Whisper/Deepgram) · Opus+Sonnet Q&A extraction · entity clustering · PDF/deck export', layer: 'customer' },
    { name: 'Agents',          tag: 'RAG',              desc: 'Public chat agents · hybrid retrieval · per-turn sentiment + intent',         layer: 'customer' },
    { name: 'PulseIQ',         tag: 'Live sessions',    desc: 'AI-moderated concurrent conversations · real-time topic detection',            layer: 'customer' },
    { name: 'Listening',       tag: 'Multi-source',     desc: 'Meta · Google/Tripadvisor reviews · Reddit · Substack · Reg.gov · idempotent', layer: 'customer' },
    { name: 'Campaigns',       tag: 'Email + SMS',      desc: 'Resend / SES / SendGrid / SMTP / Twilio · merge tags · auto-reminders',       layer: 'customer' },
    // ── Platform / infrastructure (6) ──
    { name: 'Service layer',   tag: 'lib/',             desc: 'AI router · embeddings · guardrails · usage logging · ingestion helpers',     layer: 'infra' },
    { name: 'Admin tooling',   tag: 'Internal',         desc: 'Org mgmt · usage views · agent tester · simulator · cost estimator',          layer: 'infra' },
    { name: 'UI / nav primitives', tag: 'Shared',       desc: 'Top nav · sub-header · Lottie loader · shared components',                    layer: 'infra' },
    { name: 'Dashboard',       tag: 'Entry surface',    desc: 'Study cards · sentiment donut · industry filters · response trends',          layer: 'infra' },
    { name: 'Auth + onboarding', tag: 'PKCE',           desc: '/auth/callback · invite tokens · login · password reset · magic link',       layer: 'infra' },
    { name: 'Cron orchestration', tag: '9 jobs',        desc: '45s budgets · CRON_SECRET-gated · partial-success default',                  layer: 'infra' },
  ]

  // 4 cols × 4 rows (13 cards, 3 empty slots)
  const cols = 4, rows = 4
  const cardW = (W - 0.5 * 2 - 0.12 * (cols - 1)) / cols
  const cardH = (5.85 - 0.12 * (rows - 1)) / rows
  const startX = 0.5
  const startY = 1.2

  modules.forEach((m, i) => {
    const col = i % cols, row = Math.floor(i / cols)
    const x = startX + col * (cardW + 0.12)
    const y = startY + row * (cardH + 0.12)
    const accent = m.layer === 'customer' ? DN.sarinaBlue : DN.slate
    s.addShape('rect', { x, y, w: cardW, h: cardH, fill: { color: DN.slateCard }, rectRadius: 0.08 })
    s.addShape('rect', { x, y, w: 0.13, h: cardH, fill: { color: accent } })
    s.addText(m.name, { x: x + 0.25, y: y + 0.12, w: cardW - 0.4, h: 0.45, fontSize: 15, fontFace: 'Arial', color: DN.navy, bold: true, valign: 'middle', autoFit: true })
    s.addText(m.tag, { x: x + 0.25, y: y + 0.62, w: cardW - 0.4, h: cardH - 0.7, fontSize: 11, fontFace: 'Arial', color: DN.slate, italic: true, valign: 'top', autoFit: true })
  })

  // Layer legend
  s.addText([
    { text: '■ ', options: { color: DN.sarinaBlue, fontSize: 11 } },
    { text: 'customer-facing (7)     ', options: { color: DN.ink, fontSize: 11 } },
    { text: '■ ', options: { color: DN.slate, fontSize: 11 } },
    { text: 'platform / infrastructure (6)', options: { color: DN.ink, fontSize: 11 } },
  ], { x: 0.5, y: 6.95, w: 12.3, h: 0.3, fontFace: 'Arial', align: 'center', valign: 'middle' })

  s.addNotes(
`Thirteen modules — seven customer-facing, six platform/infrastructure. ~193K lines of TypeScript across 903 files total.

CUSTOMER-FACING (sarinaBlue stripe):
- Sarina — Conversational survey runtime. LLM clarifiers. 16 languages.
- Ana — Text analytics. 13 chart types. Hypothesis testing. PPTX export. Handles 500K-row datasets.
- Town Hall (NEW since the last review, ~19K lines) — recorded in-person meetings: ASR (Whisper/Deepgram), Opus+Sonnet two-pass Q&A extraction, entity clustering, phase detection, PDF + deck export. A full second product.
- Agents — Public chat agents. Hybrid retrieval (cosine + tsv + trigram). Per-turn sentiment + intent.
- PulseIQ — AI-moderated concurrent conversations. Real-time topic detection.
- Listening — Meta · Google/Tripadvisor reviews · Reddit · Substack · Reg.gov · idempotent ingest.
- Campaigns — Resend / SES / SendGrid / SMTP / Twilio SMS. Merge tags. Auto-reminders.

PLATFORM/INFRA (slate stripe): service layer (AI router, embeddings, guardrails, usage logging), admin tooling, UI/nav primitives, dashboard, auth+onboarding, cron orchestration (9 jobs).

Don't read this aloud. Let them see the surface area — note Town Hall is a whole new product since the last review. Move on quickly.`
  )
}

// ── 3. Architectural Decisions ─────────────────────────────────────────────
function slideDecisions(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'The decisions that shaped the build.')
  addFooter(s, pg)

  // Six biggest decisions as labeled chips
  const decisions = [
    'Multi-tenant via org_id + RLS at the DB',
    'Vercel + Supabase only — no DevOps',
    'lib/ as the single AI integration seam',
    'Tier-routed LLM (haiku / sonnet)',
    'Hybrid retrieval — pgvector + tsv + trigram',
    'Cron + 45s budget instead of a queue',
  ]
  decisions.forEach((d, i) => {
    const col = i % 2, row = Math.floor(i / 2)
    const x = 0.5 + col * 6.2
    const y = 1.4 + row * 1.7
    s.addShape('rect', { x, y, w: 6.05, h: 1.45, fill: { color: DN.slateCard }, rectRadius: 0.08 })
    s.addShape('rect', { x, y, w: 0.15, h: 1.45, fill: { color: DN.sarinaBlue } })
    s.addText(d, { x: x + 0.3, y, w: 5.65, h: 1.45, fontSize: 16, fontFace: 'Arial', color: DN.navy, bold: true, valign: 'middle', autoFit: true })
  })

  s.addText('Operator-led. Every one of them.', {
    x: 0.5, y: 6.7, w: 12.3, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.navy, italic: true, bold: true, align: 'center',
  })

  s.addNotes(
`Six biggest decisions. Walk them quickly — one or two sentences each.

1. MULTI-TENANT VIA org_id + RLS AT THE DB. Defense in depth. Even a leaky route can't leak data across tenants. RLS is enforced at PostgreSQL — not the app.

2. VERCEL + SUPABASE ONLY. No DevOps overhead. Managed scaling. One operator can run it.

3. lib/ AS THE SINGLE AI INTEGRATION SEAM. One place to enforce usage logging, prompt caching, tier routing. Every AI call goes through callAI().

4. TIER-ROUTED LLM (haiku / sonnet). Cost control via tier. Haiku for real-time clarifiers (sub-second), Sonnet for theme mining (deeper reasoning).

5. HYBRID RETRIEVAL — pgvector + tsv + pg_trgm. Semantic + lexical + fuzzy fallback. No external vector DB. Sub-10ms at scale.

6. CRON + 45s BUDGET INSTEAD OF A QUEUE. Vercel-native. No queue infrastructure at this stage. 60s function timeout, 45s code budget — we bail safely.

Other decisions if asked: force-dynamic on auth'd routes, 500-row batched ingestion, single denormalized table for 500K-row datasets.

Close: "Operator-led. Every one of them." (the bottom strap on the slide).`
  )
}

// ── 4. Discipline That Exists ──────────────────────────────────────────────
function slideDiscipline(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'What discipline exists.')
  addFooter(s, pg)

  // Eight green-stripe chips in a 4×2 grid
  const items = [
    'TypeScript strict',
    '875 tests · CI on every push',
    'RLS + cross-org egress suites',
    'k6 + Playwright load suites',
    'Postgres-backed rate limiter',
    '126 SQL migrations',
    '31 spec docs kept current',
    'Sentry · usage + audit logging',
  ]
  items.forEach((it, i) => {
    const col = i % 4, row = Math.floor(i / 4)
    const x = 0.5 + col * 3.13
    const y = 1.5 + row * 1.9
    s.addShape('rect', { x, y, w: 3.0, h: 1.7, fill: { color: 'F0FDF4' }, rectRadius: 0.08, line: { color: DN.green, width: 1.5 } })
    s.addText(it, { x: x + 0.15, y, w: 2.7, h: 1.7, fontSize: 14, fontFace: 'Arial', color: DN.navy, bold: true, align: 'center', valign: 'middle', autoFit: true })
  })

  s.addText('Tests, CI, and a shared-state rate limiter — the gaps from the last review — now exist.', {
    x: 0.5, y: 5.7, w: 12.3, h: 0.5, fontSize: 14, fontFace: 'Arial', color: DN.green, italic: true, bold: true, align: 'center',
  })

  s.addNotes(
`Eight things to mention. Don't read; let the audience scan. The headline: the disciplines that were GAPS in the last review now exist.

Detail to weave in:
- TYPESCRIPT STRICT MODE. Zero compile errors enforced before every commit + in CI.
- 875 AUTOMATED TESTS across 67 files (Vitest), unit + integration with mocks. CI (.github/workflows/ci.yml) runs typecheck + the full suite on every push and PR — green is the merge bar. (This was "zero tests / no CI" last review.)
- RLS + CROSS-ORG EGRESS SUITES: env-gated suites that hit real Supabase to prove RLS isolation (test:rls) and per-table cross-org egress (test:egress, plus campaign- and dataset-specific egress). Multi-tenancy is tested, not asserted.
- LOAD SUITES: k6 (tests/loadtest/townhall.k6.js) + Playwright browser load config. Concurrency baselines now have a harness.
- POSTGRES-BACKED RATE LIMITER. Buckets live in rate_limit_buckets, mutated atomically by the check_rate_limit RPC — shared across cold starts and instances. In-process map only as an outage fallback. (This was "in-memory rate limit" last review.)
- 126 VERSIONED SQL MIGRATIONS in sql/. Every schema change traceable + replayable.
- 31 SPECIFICATION DOCS in docs/*.md kept current with code (enforced by a pre-commit spec-drift hook + a memory rule for the AI).
- SENTRY on server/client/edge; per-call AI usage logged to usage_logs; auth + AI-self-audit trails.

Lean dep tree (26 prod deps). Service-role boundary: server-only key, auth client for reads, service role for writes after explicit org check, RLS as the last line — now also covered by the egress suites.`
  )
}

// ── 5. Discipline That Is Missing ──────────────────────────────────────────
function slideGaps(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, "Where it's thin.")
  addFooter(s, pg)

  // Top row — the notable remaining gaps in red
  const big = [
    'No SOC 2 / pen-test',
    'No GDPR export / delete',
    'Mutation audit trail thin',
  ]
  big.forEach((b, i) => {
    const x = 0.5 + i * 4.2
    const y = 1.4
    s.addShape('rect', { x, y, w: 4.0, h: 1.7, fill: { color: 'FEF2F2' }, rectRadius: 0.1, line: { color: DN.red, width: 2 } })
    s.addText(b, { x: x + 0.15, y, w: 3.7, h: 1.7, fontSize: 18, fontFace: 'Arial', color: DN.red, bold: true, align: 'center', valign: 'middle', autoFit: true })
  })

  // Bottom row — smaller gaps as amber chips
  const smaller = [
    'Per-org LLM cost cap (logged, not enforced)',
    'No SAST / dependency scanning',
    'No ADRs',
    'High-concurrency baselines partial',
    'Service-role used liberally',
    'No formal CORS policy',
  ]
  smaller.forEach((sg, i) => {
    const col = i % 3, row = Math.floor(i / 3)
    const x = 0.5 + col * 4.2
    const y = 3.4 + row * 1.0
    s.addShape('rect', { x, y, w: 4.0, h: 0.85, fill: { color: 'FEF3C7' }, rectRadius: 0.08, line: { color: DN.amber, width: 1 } })
    s.addText(sg, { x: x + 0.15, y, w: 3.7, h: 0.85, fontSize: 12, fontFace: 'Arial', color: '92400E', bold: true, align: 'center', valign: 'middle', autoFit: true })
  })

  s.addText('The big three from the last review — tests, CI, rate limiting — are closed. What is left is compliance + observability investment, not bugs.', {
    x: 0.5, y: 5.85, w: 12.3, h: 0.5, fontSize: 13, fontFace: 'Arial', color: DN.navy, italic: true, bold: true, align: 'center',
  })

  s.addNotes(
`Be direct here. The credibility move: the gaps that mattered most last review are gone, and the remaining list is compliance/observability investment — not "a team would have caught this" bugs.

WHAT CLOSED since last review (say this first): zero tests → 875 tests + CI; no CI → CI on every push/PR; in-memory rate limit → Postgres-backed shared-state limiter; no load baselines → k6 + Playwright suites.

THE NOTABLE REMAINING ONES (top row, red):

1. NO SOC 2 / THIRD-PARTY PEN-TEST. Security disciplines exist (RLS, egress suites, guardrails) but no external audit or pen-test yet. The thing an enterprise buyer asks for.

2. NO GDPR EXPORT / DELETE. Cascade-delete relies on FK ON DELETE CASCADE; no self-serve data export/erasure endpoints. A compliance liability the moment an EU customer signs.

3. MUTATION AUDIT TRAIL THIN. Auth logins + AI self-audit are logged, but no who-changed-what trail on studies / bot configs / campaigns / org membership.

SMALLER GAPS (bottom row, amber):
- Per-org LLM cost logged, not enforced — a misbehaving customer could rack up Anthropic spend.
- No SAST / dependency scanning beyond Vercel defaults.
- No ADRs — decisions live in commit messages, specs, and the operator's head.
- High-concurrency baselines partial — k6 townhall suite exists, but a real large event is still unproven.
- Service-role used liberally on writes (RLS + egress suites mitigate, but app-layer assertions are thin).
- No formal CORS policy.

CLOSE on the bottom strap. Don't apologize — this is now an investment list, not a bug list.`
  )
}

// ── 6. Risk Register ───────────────────────────────────────────────────────
function slideRisks(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Where it would break first.')
  addFooter(s, pg)

  // Just the top 5 risks, ranked, as horizontal bars with severity dot
  const risks: { sev: 'HIGH' | 'MED' | 'LOW'; text: string }[] = [
    { sev: 'HIGH', text: 'Service-role used liberally — an app bug could leak across orgs' },
    { sev: 'MED',  text: 'PulseIQ / Town Hall at real-event concurrency — load harness exists, large event unproven' },
    { sev: 'MED',  text: 'GDPR export / delete endpoints not built' },
    { sev: 'MED',  text: 'No mutation audit trail on critical tables' },
    { sev: 'MED',  text: 'Per-org LLM cost logged, not enforced' },
  ]
  const sevColor = (s: string) => s === 'HIGH' ? DN.red : s === 'MED' ? DN.amber : DN.green
  const sevBg    = (s: string) => s === 'HIGH' ? 'FEF2F2' : s === 'MED' ? 'FEF3C7' : 'F0FDF4'

  risks.forEach((r, i) => {
    const y = 1.4 + i * 0.95
    s.addShape('rect', { x: 0.5, y, w: 12.3, h: 0.8, fill: { color: sevBg(r.sev) }, rectRadius: 0.08 })
    s.addShape('rect', { x: 0.5, y, w: 0.18, h: 0.8, fill: { color: sevColor(r.sev) } })
    s.addText(r.sev, { x: 0.8, y, w: 1.1, h: 0.8, fontSize: 13, fontFace: 'Arial', color: sevColor(r.sev), bold: true, align: 'center', valign: 'middle', charSpacing: 2 })
    s.addText(r.text, { x: 2.0, y, w: 10.7, h: 0.8, fontSize: 15, fontFace: 'Arial', color: DN.navy, bold: true, valign: 'middle', autoFit: true })
  })

  s.addText('Plus four lower-severity items in the speaker notes.', {
    x: 0.5, y: 6.4, w: 12.3, h: 0.4, fontSize: 11, fontFace: 'Arial', color: DN.slate, italic: true, align: 'center',
  })

  s.addNotes(
`Top 5 on the slide. Walk them honestly — these are the ones that would page someone. Note up front that in-memory rate limit and "no regression tests" are off this list since last review — both resolved.

HIGH:
1. Service-role used liberally on writes. RLS protects reads; an app-layer bug on a service-role write path could leak across orgs. Mitigated by the cross-org egress test suites (test:egress + campaign/dataset egress), but app-layer assertions are still thinner than I'd like.

MED:
2. PulseIQ / Town Hall at real-event concurrency. A k6 load harness exists (tests/loadtest/townhall.k6.js), but a genuine large simultaneous event is still unproven in production.
3. GDPR export / delete endpoints not built. Compliance liability the moment an EU customer signs.
4. No mutation audit trail on critical tables. Cannot reconstruct who-changed-what during a dispute or breach (auth + AI-self-audit ARE logged).
5. Per-org LLM cost logged, not enforced. A misbehaving customer could rack up Anthropic spend before anyone notices.

ALSO IN THE FULL REGISTER (mention only if asked):
- No SOC 2 / third-party pen-test yet — MED
- Cron failures only land in Sentry, no oncall paging — LOW
- No SAST / dependency scanning — LOW

Don't apologize. Engineers respect honest risk inventories — and several of last review's top risks are now closed.`
  )
}

// ── 7. Operator vs AI ──────────────────────────────────────────────────────
function slideOperatorVsAI(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Who did what.')
  addFooter(s, pg)

  // Operator card — high signal, big text
  s.addShape('rect', { x: 0.5, y: 1.4, w: 5.95, h: 4.6, fill: { color: DN.tealPale }, rectRadius: 0.12 })
  s.addShape('rect', { x: 0.5, y: 1.4, w: 5.95, h: 0.7, fill: { color: DN.teal }, rectRadius: 0.12 })
  s.addText('OPERATOR', { x: 0.5, y: 1.4, w: 5.95, h: 0.7, fontFace: 'Arial', fontSize: 18, color: DN.white, bold: true, align: 'center', valign: 'middle', charSpacing: 3 })
  s.addText('100% of these', { x: 0.5, y: 2.15, w: 5.95, h: 0.35, fontSize: 11, fontFace: 'Arial', color: DN.tealDark, italic: true, align: 'center' })
  const opItems = ['Every architecture decision', 'Every data model + RLS policy', 'Every product flow', 'Every integration choice', 'Every safety policy', '12 yrs of NLP / NLU judgment']
  opItems.forEach((it, i) => {
    s.addText(it, { x: 0.8, y: 2.7 + i * 0.5, w: 5.4, h: 0.45, fontSize: 14, fontFace: 'Arial', color: DN.navy, bold: true, valign: 'middle', autoFit: true })
  })

  // AI card — visibly subordinate (slate instead of brand color)
  s.addShape('rect', { x: 6.85, y: 1.4, w: 5.95, h: 4.6, fill: { color: DN.slateCard }, rectRadius: 0.12 })
  s.addShape('rect', { x: 6.85, y: 1.4, w: 5.95, h: 0.7, fill: { color: DN.slate }, rectRadius: 0.12 })
  s.addText('AI', { x: 6.85, y: 1.4, w: 5.95, h: 0.7, fontFace: 'Arial', fontSize: 18, color: DN.white, bold: true, align: 'center', valign: 'middle', charSpacing: 3 })
  s.addText('~70–80% of the line code', { x: 6.85, y: 2.15, w: 5.95, h: 0.35, fontSize: 11, fontFace: 'Arial', color: DN.slate, italic: true, align: 'center' })
  const aiItems = ['Implementation', 'Boilerplate + glue', 'Refactors under direction', 'UI scaffolding', 'Migration scripts', 'First-pass error handling']
  aiItems.forEach((it, i) => {
    s.addText(it, { x: 7.15, y: 2.7 + i * 0.5, w: 5.4, h: 0.45, fontSize: 14, fontFace: 'Arial', color: DN.ink, valign: 'middle', autoFit: true })
  })

  // Bottom strap — the key reframe
  s.addShape('rect', { x: 0.5, y: 6.2, w: 12.3, h: 0.75, fill: { color: DN.navy }, rectRadius: 0.08 })
  s.addText('AI = junior engineer at faster cadence. Same disciplines apply.', {
    x: 0.5, y: 6.2, w: 12.3, h: 0.75, fontSize: 16, fontFace: 'Arial', color: DN.gold, bold: true, italic: true, align: 'center', valign: 'middle',
  })

  s.addNotes(
`This is the slide that disarms the "AI-built means not serious" objection. Walk it deliberately.

OPERATOR — 100% of these (let them really land):
- Every architectural decision.
- Every data model and every RLS policy.
- Every product flow and UX choice.
- Every integration choice — Anthropic, OpenAI, DataForSEO, Resend, Meta Graph, Reddit, Substack, Reg.gov.
- Every guardrail / safety policy.
- Every "is this safe to ship" judgment.
- Code review of every change before commit.
- All 12 years of NLP/NLU pattern recognition.

AI — ~70-80% of the line code:
- Implementation of operator-decided patterns.
- Boilerplate, glue, types, route handlers.
- Refactoring under direction.
- UI components against spec.
- Migration scripts (then operator-reviewed).
- First-pass error handling, logging hooks.
- Documentation scaffolding.

NOT AI: design judgment, NOT: data model, NOT: security policy.

THE REFRAME (bottom strap): "AI is a junior engineer at faster cadence. The same disciplines apply — type safety, RLS, audit logs, code review, and now 875 tests + CI. The gaps that remain are compliance and observability, not core engineering."

Don't say "fully AI-generated." That cedes the framing. Say "AI-assisted engineering on top of 12 years of domain expertise."`
  )
}

// ── 8. Phase 1 Hardening Plan ──────────────────────────────────────────────
function slideHardening(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'What capital buys.')
  addFooter(s, pg)

  // Six big chips — just the area name. Details in speaker notes.
  // (Tests + rate-limit hardening already shipped — they're off this list.)
  const items = [
    { area: 'Compliance',       color: DN.hermesOrange },
    { area: 'Pen-test / SAST',  color: DN.red },
    { area: 'Audit trail',      color: DN.gold },
    { area: 'AI observability', color: '6D28D9' },
    { area: 'Scalability',      color: DN.green },
    { area: 'Operations',       color: DN.navy },
  ]
  // 4×2 grid (one slot empty)
  items.forEach((it, i) => {
    const col = i % 4, row = Math.floor(i / 4)
    const x = 0.5 + col * 3.13
    const y = 1.5 + row * 2.2
    s.addShape('rect', { x, y, w: 3.0, h: 2.0, fill: { color: it.color }, rectRadius: 0.1 })
    s.addText(it.area, { x: x + 0.1, y, w: 2.8, h: 2.0, fontFace: 'Arial', fontSize: 22, color: DN.white, bold: true, align: 'center', valign: 'middle', autoFit: true })
  })

  // Bottom strap
  s.addText('Each chip is a use-of-funds line item. Details in the notes / use-of-funds slide.', {
    x: 0.5, y: 6.4, w: 12.3, h: 0.4, fontSize: 12, fontFace: 'Arial', color: DN.navy, italic: true, bold: true, align: 'center',
  })

  s.addNotes(
`Six hardening areas. Walk each only if asked — otherwise let the chip grid be the visual and move on.

FRAME FIRST: tests + CI and the shared-state rate limiter already shipped (they were on this list last review). What capital buys now is mostly compliance + observability — the enterprise-readiness layer, not core engineering gaps.

DETAIL FOR EACH:

- COMPLIANCE: SOC 2 Type II + GDPR export/delete endpoints + formal CORS policy. The enterprise-buyer checklist.

- PEN-TEST / SAST: third-party penetration test + SAST / dependency scanning (Semgrep / Snyk) in CI beyond Vercel defaults.

- AUDIT TRAIL: Postgres triggers → audit_log table on critical mutations (studies, bots, datasets, org membership).

- AI OBSERVABILITY: LangSmith for traces + LLM-as-judge evals + user-feedback loop wired into bot/survey/PulseIQ/Town Hall.

- SCALABILITY: extend the existing k6 / Playwright load suites to documented baselines per scenario; enforce per-org LLM cost caps.

- OPERATIONS: Vercel Workflows for durable ingestion (the Town Hall pipeline already uses WDK; extend the pattern), ADRs in docs/adr/, oncall paging on cron failures, Storybook for components.

These map to the rollup deck's use-of-funds lines. Smaller wedge than last review — the test/CI/rate-limit investment is already made.`
  )
}

// ── 9. Open Questions ──────────────────────────────────────────────────────
function slideOpenQuestions(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'What I want you to push back on.')
  addFooter(s, pg)

  // Four short questions, big text
  const qs = [
    'Where is this thinnest?',
    'Service-role boundary — acceptable risk?',
    'Vercel Workflows now, or wait for pain?',
    "What would you require to sign as an advisor?",
  ]
  qs.forEach((q, i) => {
    const col = i % 2, row = Math.floor(i / 2)
    const x = 0.5 + col * 6.2
    const y = 1.4 + row * 2.3
    s.addShape('rect', { x, y, w: 6.05, h: 2.0, fill: { color: DN.slateCard }, rectRadius: 0.1 })
    s.addShape('rect', { x, y, w: 0.18, h: 2.0, fill: { color: DN.gold } })
    s.addText(`Q${i + 1}`, { x: x + 0.3, y: y + 0.15, w: 1.0, h: 0.4, fontSize: 12, fontFace: 'Arial', color: DN.gold, bold: true, charSpacing: 2 })
    s.addText(q, { x: x + 0.3, y: y + 0.55, w: 5.6, h: 1.35, fontSize: 20, fontFace: 'Arial', color: DN.navy, bold: true, valign: 'middle', autoFit: true })
  })

  s.addShape('rect', { x: 0.5, y: 6.15, w: 12.3, h: 0.85, fill: { color: DN.navy }, rectRadius: 0.08 })
  s.addText('Disagreement is the point.', {
    x: 0.5, y: 6.15, w: 12.3, h: 0.85, fontSize: 18, fontFace: 'Arial', color: DN.gold, bold: true, italic: true, align: 'center', valign: 'middle',
  })

  s.addNotes(
`Close the meeting on these. Don't read them — let them pick the one that grabs them first.

THE FOUR QUESTIONS:

Q1. WHERE IS THIS THINNEST? Where would you push hardest in technical diligence? Honest answers expected.

Q2. SERVICE-ROLE BOUNDARY — acceptable risk? RLS protects reads; service-role on writes after explicit user check. Is that sufficient at this scale, or should we invest in tighter app-layer assertions before Phase 1?

Q3. VERCEL WORKFLOWS NOW, OR WAIT FOR PAIN? Worth replatforming cron orchestration to durable workflows now, or stay budget-aware until we hit a real failure mode?

Q4. WHAT WOULD YOU REQUIRE TO SIGN AS AN ADVISOR (or recommend to a portco)?

ALSO IN MY HEAD, ask if it comes up:
- Right test framework for this stack — Vitest + Playwright + MSW, or different mix?
- Vercel KV vs Upstash Redis for ephemeral state?
- Postgres triggers vs application-level for mutation audit — what trips fewer landmines?
- SLOs — define them now, or wait for paying customers to push?

CLOSE: "Disagreement is the point. The deck exists so we can argue from a shared baseline."`
  )
}

// ── Deck assembler ─────────────────────────────────────────────────────────
function buildDeck(pptx: any) {
  let pg = 0
  addTitleSlide(pptx)
  pg = 1
  slideTheFrame(pptx, ++pg)
  slidePositioning(pptx, ++pg)
  slideWhatGotBuilt(pptx, ++pg)
  slideDecisions(pptx, ++pg)
  slideDiscipline(pptx, ++pg)
  slideGaps(pptx, ++pg)
  slideRisks(pptx, ++pg)
  slideOperatorVsAI(pptx, ++pg)
  slideHardening(pptx, ++pg)
  slideOpenQuestions(pptx, ++pg)
}

// ── Route handler ──────────────────────────────────────────────────────────
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  await logDeckDownload('engineering-reality-deck')

  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Datanautix'
  pptx.company = 'Datanautix'
  pptx.title = 'Datanautix — Engineering Reality Check'

  buildDeck(pptx)

  const buffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer
  const uint8 = new Uint8Array(buffer)

  return new NextResponse(uint8, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': 'attachment; filename="Datanautix-Engineering-Reality.pptx"',
    },
  })
}
