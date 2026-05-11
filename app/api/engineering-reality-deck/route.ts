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
  s.addText('What we built, how we built it, and what is missing — for peer review', {
    x: 0.8, y: 3.4, w: 11, h: 0.6, fontSize: 16, fontFace: 'Arial', color: DN.sarinaBlue, italic: true,
  })
  s.addText('Built March 1, 2026 → present  ·  ~9 weeks  ·  1 operator + AI-assisted engineering  ·  on top of 12 years of NLP / NLU domain expertise', {
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
  addHeader(s, '9 weeks. One operator. AI-assisted.')
  addFooter(s, pg)

  // Four big anchor stats
  const stats = [
    { v: '9 wk',  l: 'Mar 1, 2026 → today' },
    { v: '1,624', l: 'commits' },
    { v: '12 yr', l: 'NLP / NLU practice' },
    { v: '~83K',  l: 'lines of TypeScript' },
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
- ~9 WEEKS: first commit March 1, 2026. So when I say "built recently" — that's what I mean.
- 1,624 COMMITS: dense work, lots of iteration.
- 12 YEARS of NLP/NLU: this is the part that matters. The design judgment, the data model, every architectural decision came from that experience — not from AI.
- ~83K LINES of TypeScript: production scale, not prototype.

Detail to weave in:
- Single operator + AI-assisted engineering.
- Operator-led on every architectural decision, data model, product flow, integration choice, and safety policy.
- AI implemented ~70-80% of the line code under operator review.
- Production deployment: Vercel + Supabase, no dedicated DevOps.
- Stack: Next.js 14 App Router, TypeScript strict, Supabase Postgres + RLS + pgvector, Anthropic Claude, OpenAI embeddings, Sentry, pptxgenjs.

LAND THE BOTTOM STRAP: "Read this with that constraint in mind. Disciplines that exist scale to one operator. Gaps need a team."`
  )
}

// ── 2. What Got Built ──────────────────────────────────────────────────────
function slideWhatGotBuilt(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'What Got Built', '12 modules across customer-facing + platform · 410 TS files · ~83K code lines (sums below)')
  addFooter(s, pg)

  type Mod = { name: string; tag: string; lines: string; desc: string; layer: 'customer' | 'infra' }
  const modules: Mod[] = [
    // ── Customer-facing (6) ──
    { name: 'Sarina',          tag: 'Surveys',         lines: '~11K',  desc: 'Conversational runtime · LLM clarifiers · adaptive flow · 15 question types', layer: 'customer' },
    { name: 'Ana',             tag: 'Analytics',       lines: '~27K',  desc: 'Text analytics · 13 chart types · stats · PPTX export · 500K-row datasets',   layer: 'customer' },
    { name: 'Agents',          tag: 'RAG',             lines: '~5.6K', desc: 'Public chat agents · hybrid retrieval · per-turn sentiment + intent',         layer: 'customer' },
    { name: 'PulseIQ',         tag: 'Live sessions',   lines: '~8K',   desc: 'AI-moderated concurrent conversations · real-time topic detection',            layer: 'customer' },
    { name: 'Listening',       tag: 'Multi-source',    lines: '~3.5K', desc: 'Meta · Google Reviews · Reddit · Substack · Reg.gov · idempotent ingest',     layer: 'customer' },
    { name: 'Campaigns',       tag: 'Email orchestration', lines: '~3.4K', desc: 'Resend / SES / SendGrid / SMTP / SMS · merge tags · auto-reminders',     layer: 'customer' },
    // ── Platform / infrastructure (6) ──
    { name: 'Service layer',   tag: 'lib/',            lines: '~10K',  desc: 'AI router · embeddings · guardrails · usage logging · ingestion helpers',     layer: 'infra' },
    { name: 'Admin tooling',   tag: 'Internal',        lines: '~6.7K', desc: 'Org mgmt · usage views · agent tester · simulator · cost estimator',          layer: 'infra' },
    { name: 'UI / nav primitives', tag: 'Shared',      lines: '~1.9K', desc: 'Top nav · sub-header · Lottie loader · shared components',                    layer: 'infra' },
    { name: 'Dashboard',       tag: 'Entry surface',   lines: '~1.5K', desc: 'Study cards · sentiment donut · industry filters · response trends',          layer: 'infra' },
    { name: 'Auth + onboarding', tag: 'PKCE',          lines: '~0.7K', desc: '/auth/callback · invite tokens · login · password reset · magic link',       layer: 'infra' },
    { name: 'Cron orchestration', tag: '7 jobs',        lines: '~0.6K', desc: '45s budgets · CRON_SECRET-gated · partial-success default',                 layer: 'infra' },
  ]

  // 4 rows × 3 cols
  const cols = 3, rows = 4
  const cardW = (W - 0.5 * 2 - 0.12 * (cols - 1)) / cols   // ~4.09
  const cardH = (5.85 - 0.12 * (rows - 1)) / rows           // ~1.37
  const startX = 0.5
  const startY = 1.2

  modules.forEach((m, i) => {
    const col = i % cols, row = Math.floor(i / cols)
    const x = startX + col * (cardW + 0.12)
    const y = startY + row * (cardH + 0.12)
    const accent = m.layer === 'customer' ? DN.sarinaBlue : DN.slate
    s.addShape('rect', { x, y, w: cardW, h: cardH, fill: { color: DN.slateCard }, rectRadius: 0.08 })
    s.addShape('rect', { x, y, w: 0.13, h: cardH, fill: { color: accent } })
    // Single-line module name (larger, bolder)
    s.addText(m.name, { x: x + 0.25, y: y + 0.15, w: cardW - 1.1, h: 0.48, fontSize: 16, fontFace: 'Arial', color: DN.navy, bold: true, valign: 'middle', autoFit: true })
    s.addText(m.lines, { x: x + cardW - 0.95, y: y + 0.15, w: 0.8, h: 0.48, fontSize: 14, fontFace: 'Arial', color: DN.hermesOrange, bold: true, align: 'right', valign: 'middle' })
    // Tag only — descriptions live in speaker notes
    s.addText(m.tag, { x: x + 0.25, y: y + 0.7, w: cardW - 0.4, h: cardH - 0.75, fontSize: 11, fontFace: 'Arial', color: DN.slate, italic: true, valign: 'top', autoFit: true })
  })

  // Layer legend (small, right side)
  s.addText([
    { text: '■ ', options: { color: DN.sarinaBlue, fontSize: 11 } },
    { text: 'customer-facing  ~58.5K   ', options: { color: DN.ink, fontSize: 11 } },
    { text: '■ ', options: { color: DN.slate, fontSize: 11 } },
    { text: 'platform / infrastructure  ~21.4K', options: { color: DN.ink, fontSize: 11 } },
  ], { x: 0.5, y: 6.95, w: 12.3, h: 0.3, fontFace: 'Arial', align: 'center', valign: 'middle' })

  s.addNotes(
`Twelve modules — six customer-facing, six platform/infrastructure. The 83K total is the sum of the two.

CUSTOMER-FACING (~58.5K, sarinaBlue stripe):
- Sarina (~11K) — Conversational survey runtime. LLM clarifiers. 15 question types. Multi-language.
- Ana (~27K) — Text analytics. 13 chart types. Hypothesis testing. PPTX export. Handles 500K-row datasets.
- Agents (~5.6K) — Public chat agents. Hybrid retrieval (cosine + tsv + trigram). Per-turn sentiment + intent.
- PulseIQ (~8K) — AI-moderated concurrent conversations. Real-time topic detection.
- Listening (~3.5K) — Meta · Google Reviews · Reddit · Substack · Reg.gov · idempotent ingest.
- Campaigns (~3.4K) — Resend / SES / SendGrid / SMTP / SMS. Merge tags. Auto-reminders.

PLATFORM/INFRA (~21.4K, slate stripe):
- Service layer (~10K) — AI router · embeddings · guardrails · usage logging · ingestion helpers.
- Admin tooling (~6.7K) — Org mgmt · usage views · agent tester · simulator · cost estimator.
- UI / nav primitives (~1.9K) — Top nav · sub-header · Lottie loader.
- Dashboard (~1.5K) — Study cards · sentiment donut · industry filters.
- Auth + onboarding (~0.7K) — PKCE flow · /auth/callback · invite tokens · login.
- Cron orchestration (~0.6K) — 7 scheduled jobs · 45s budgets · CRON_SECRET-gated.

Don't read this aloud. Let them see the surface area. Move on quickly.`
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
    '41 SQL migrations',
    '16 spec docs kept current',
    'RLS on every table',
    'Per-call AI usage logged',
    'Auth + AI + drift audit trails',
    'Sentry across server / client / edge',
    'Lean dep tree — 27 packages',
  ]
  items.forEach((it, i) => {
    const col = i % 4, row = Math.floor(i / 4)
    const x = 0.5 + col * 3.13
    const y = 1.5 + row * 1.9
    s.addShape('rect', { x, y, w: 3.0, h: 1.7, fill: { color: 'F0FDF4' }, rectRadius: 0.08, line: { color: DN.green, width: 1.5 } })
    s.addText(it, { x: x + 0.15, y, w: 2.7, h: 1.7, fontSize: 14, fontFace: 'Arial', color: DN.navy, bold: true, align: 'center', valign: 'middle', autoFit: true })
  })

  s.addText('No file over 3K lines.   ·   What needs to be big is big.', {
    x: 0.5, y: 5.7, w: 12.3, h: 0.5, fontSize: 14, fontFace: 'Arial', color: DN.green, italic: true, bold: true, align: 'center',
  })

  s.addNotes(
`Eight things to mention. Don't read; let the audience scan.

Detail to weave in:
- TYPESCRIPT STRICT MODE. Zero compile errors enforced before every commit. Caught dozens of bugs that tests would have caught.
- 41 VERSIONED SQL MIGRATIONS in sql/. Every schema change is traceable and replayable.
- 16 SPECIFICATION DOCS in docs/*.md kept current with code (it's a memory rule for the AI).
- RLS ENABLED ON EVERY TABLE. sql/032_enable_rls_everywhere.sql is idempotent.
- PER-CALL AI USAGE LOGGED. usage_logs table records input/output/cache tokens per call. Cost-per-org reportable in real time.
- AUDIT TRAILS: user_logins (every successful auth), bot_conversation_reviews (cron-driven AI self-audit every 4 hr), usage_logs (FinOps).
- SENTRY on server, client, and edge. Sourcemaps uploaded. Vercel build injects commit count + ISO timestamp.
- LEAN DEPENDENCY TREE — 27 npm deps total (17 production). Most React/Next apps in this category run 50–150. This is itself a quality signal.

Service-role boundary: server-only key. Auth client for reads, service role for writes after explicit user check. RLS is the last line.

Bottom strap: "No file over 3K lines. What needs to be big is big — PPTX exporter, survey engine, charts module. Everything else is small."`
  )
}

// ── 5. Discipline That Is Missing ──────────────────────────────────────────
function slideGaps(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, "Where it's thin.")
  addFooter(s, pg)

  // Top row — the three big ones in red
  const big = [
    'Zero automated tests',
    'No CI pipeline',
    'In-memory rate limit',
  ]
  big.forEach((b, i) => {
    const x = 0.5 + i * 4.2
    const y = 1.4
    s.addShape('rect', { x, y, w: 4.0, h: 1.7, fill: { color: 'FEF2F2' }, rectRadius: 0.1, line: { color: DN.red, width: 2 } })
    s.addText(b, { x: x + 0.15, y, w: 3.7, h: 1.7, fontSize: 18, fontFace: 'Arial', color: DN.red, bold: true, align: 'center', valign: 'middle', autoFit: true })
  })

  // Bottom row — smaller gaps as amber chips
  const smaller = [
    'No GDPR export / delete',
    'No mutation audit trail',
    'No load-tested baselines',
    'No ADRs',
    'No SAST scanning',
    'No per-org LLM cost cap (enforced)',
  ]
  smaller.forEach((sg, i) => {
    const col = i % 3, row = Math.floor(i / 3)
    const x = 0.5 + col * 4.2
    const y = 3.4 + row * 1.0
    s.addShape('rect', { x, y, w: 4.0, h: 0.85, fill: { color: 'FEF3C7' }, rectRadius: 0.08, line: { color: DN.amber, width: 1 } })
    s.addText(sg, { x: x + 0.15, y, w: 3.7, h: 0.85, fontSize: 12, fontFace: 'Arial', color: '92400E', bold: true, align: 'center', valign: 'middle', autoFit: true })
  })

  s.addText('Tests are the one a team would have caught. Everything else is investment, not bug.', {
    x: 0.5, y: 5.85, w: 12.3, h: 0.5, fontSize: 13, fontFace: 'Arial', color: DN.navy, italic: true, bold: true, align: 'center',
  })

  s.addNotes(
`Be direct here. This is the credibility-building slide for an engineer reviewer. Don't soft-pedal.

THE THREE BIG ONES (top row, red):

1. ZERO AUTOMATED TESTS. Type checking and manual verification only. Refactor confidence is low; regression risk on big changes is real. This is the gap a team would have caught.

2. NO CI PIPELINE. Local dev + Vercel auto-deploy. tsc passes is the merge bar.

3. IN-MEMORY RATE LIMITING. lib/rateLimit.ts. Buckets reset on cold start. Not production-grade against a sustained attack.

SMALLER GAPS (bottom row, amber):

- No GDPR export/delete endpoints — cascade-delete relies on FK ON DELETE CASCADE; risky if EU customer signs.
- No mutation audit trail beyond auth + AI. Cannot reconstruct who edited a study, bot config, or campaign.
- No load-tested concurrency baselines. Patterns sound (HNSW, batching, time budgets) but unverified at scale.
- No ADRs. Decisions live in commit messages and the operator's head.
- No SAST / dependency scanning beyond Vercel defaults.
- Per-org LLM cost logged, not enforced. A misbehaving customer could rack up Anthropic spend.

Other items if asked: no formal CORS policy, no design system / Storybook.

CLOSE THE SLIDE on the bottom strap: "Tests are the one a team would have caught. Everything else is investment, not bug." Don't apologize. State it.`
  )
}

// ── 6. Risk Register ───────────────────────────────────────────────────────
function slideRisks(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Where it would break first.')
  addFooter(s, pg)

  // Just the top 5 risks, ranked, as horizontal bars with severity dot
  const risks: { sev: 'HIGH' | 'MED' | 'LOW'; text: string }[] = [
    { sev: 'HIGH', text: 'In-memory rate limit under sustained attack' },
    { sev: 'HIGH', text: 'Concurrent PulseIQ sessions above ~50 — untested' },
    { sev: 'MED',  text: 'Service-role used liberally — app bugs could leak across orgs' },
    { sev: 'MED',  text: 'No mutation audit trail on critical tables' },
    { sev: 'MED',  text: 'GDPR export / delete endpoints not built' },
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
`Top 5 on the slide. Walk them honestly — these are the ones that would page someone.

HIGH:
1. In-memory rate limit under sustained attack. lib/rateLimit.ts; buckets reset on cold start. A determined attacker could exhaust function instances; legitimate traffic gets 429s.
2. Concurrent PulseIQ sessions above ~50 — untested. Unknown failure modes. Could degrade unpredictably during a real event.

MED:
3. Service-role used liberally. App-layer bug could leak data across orgs. RLS protects reads, not service-role writes.
4. No mutation audit trail. Cannot reconstruct who-changed-what during a dispute or breach.
5. GDPR export / delete endpoints not built. Compliance liability the moment an EU customer signs.

ALSO IN THE FULL REGISTER (mention only if asked):
- Per-org LLM cost not capped (logged, not enforced) — MED
- No regression tests on critical paths — MED
- Cron failures only land in Sentry, no oncall paging — LOW
- No SAST / dependency scanning — LOW

Don't apologize. Engineers respect honest risk inventories.`
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

THE REFRAME (bottom strap): "AI is a junior engineer at faster cadence. The same disciplines apply — type safety, RLS, audit logs, code review. The disciplines we have. Tests are the gap."

Don't say "fully AI-generated." That cedes the framing. Say "AI-assisted engineering on top of 12 years of domain expertise."`
  )
}

// ── 8. Phase 1 Hardening Plan ──────────────────────────────────────────────
function slideHardening(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'What capital buys.')
  addFooter(s, pg)

  // Seven big chips — just the area name. Details in speaker notes.
  const items = [
    { area: 'Tests',            color: DN.sarinaBlue },
    { area: 'Rate limit',       color: DN.teal },
    { area: 'Compliance',       color: DN.hermesOrange },
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
`Seven hardening areas. Walk each only if asked — otherwise let the chip grid be the visual and move on.

DETAIL FOR EACH:

- TESTS: Vitest + Playwright + GitHub Actions CI. ~15 critical-path tests (auth, RLS, admin gating, public endpoints, guardrails). Merge bar = green CI. ~$300K wedge in use-of-funds (combined with load testing).

- RATE LIMIT: Vercel KV-backed token bucket replacing in-memory. Per-IP and per-org. Survives cold starts.

- COMPLIANCE: SOC 2 Type II audit + third-party pen-test (~$400K). GDPR export/delete endpoints. CORS policy formalized.

- AUDIT TRAIL: Postgres triggers → audit_log table on critical mutations (studies, bots, datasets, org membership).

- AI OBSERVABILITY: LangSmith for traces + LLM-as-judge evals + user-feedback loop wired into bot/survey/PulseIQ. ~$100K (integration + first 12 months hosted).

- SCALABILITY: k6 / Artillery load suite. Documented baselines per scenario. Per-org LLM cost cap enforcement.

- OPERATIONS: Vercel Workflows for durable ingestion (replacing budget-aware cron). ADRs in docs/adr/. SAST (Semgrep / Snyk). Storybook for components.

These are the same lines that appear on the rollup deck's use-of-funds slide. Around $0.8M total of the $10M Phase 1 vehicle.`
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
