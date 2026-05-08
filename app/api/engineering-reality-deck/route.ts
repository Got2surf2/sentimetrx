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
  addHeader(s, 'The Frame', 'How to read this deck')
  addFooter(s, pg)
  s.addText([
    bullet('This is a peer review document, not a pitch. Honest about what works and what does not.'),
    bullet('Built start-to-current in ~9 weeks (first commit: March 1, 2026). 1,624 commits at last count.'),
    bullet('Single operator + AI-assisted engineering. Operator-led on every architectural decision, data model, product flow, integration choice, and safety policy. AI implemented ~70–80% of the line code under review.'),
    bullet('On top of 12 years of NLP / NLU practice — the design instincts came from that, not from AI.'),
    bullet('Production deployment on Vercel + Supabase. No dedicated DevOps. No engineering team beyond the operator.'),
    bullet('Stack: Next.js 14 App Router · TypeScript strict · Supabase Postgres + RLS + pgvector · Anthropic Claude · OpenAI embeddings · Sentry · pptxgenjs · Plotly.'),
    bullet('Read this with that constraint in mind. The disciplines that exist are the ones that scale to one operator. The gaps are the ones that need a team.'),
  ], { x: 0.6, y: 1.3, w: 12.1, h: 5.7 })
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
    s.addText(m.name, { x: x + 0.25, y: y + 0.08, w: cardW - 1.05, h: 0.32, fontSize: 13, fontFace: 'Arial', color: DN.navy, bold: true, valign: 'middle', autoFit: true })
    s.addText(m.lines, { x: x + cardW - 0.85, y: y + 0.08, w: 0.7, h: 0.32, fontSize: 11, fontFace: 'Arial', color: DN.hermesOrange, bold: true, align: 'right', valign: 'middle' })
    s.addText(m.tag, { x: x + 0.25, y: y + 0.4, w: cardW - 0.4, h: 0.22, fontSize: 9, fontFace: 'Arial', color: DN.slate, italic: true, valign: 'middle', autoFit: true })
    s.addText(m.desc, { x: x + 0.25, y: y + 0.65, w: cardW - 0.4, h: cardH - 0.7, fontSize: 9.5, fontFace: 'Arial', color: DN.ink, lineSpacing: 14, valign: 'top', autoFit: true })
  })

  // Layer legend (small, right side)
  s.addText([
    { text: '■ ', options: { color: DN.sarinaBlue, fontSize: 10 } },
    { text: 'customer-facing  ~58.5K   ', options: { color: DN.ink, fontSize: 10 } },
    { text: '■ ', options: { color: DN.slate, fontSize: 10 } },
    { text: 'platform / infrastructure  ~21.4K   ', options: { color: DN.ink, fontSize: 10 } },
    { text: '+ smaller (settings, public surfaces, decks) ~3K', options: { color: DN.slate, fontSize: 10, italic: true } },
  ], { x: 0.5, y: 6.95, w: 12.3, h: 0.3, fontFace: 'Arial', align: 'center', valign: 'middle' })
}

// ── 3. Architectural Decisions ─────────────────────────────────────────────
function slideDecisions(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Architectural Decisions', 'What we did and why — the design judgment, operator-led')
  addFooter(s, pg)

  const head = [
    { text: 'Decision', options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
    { text: 'Why',      options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
  ]
  const data = [
    ['Multi-tenant via org_id + RLS at DB',                     'Defense in depth. Even leaky routes cannot leak data across tenants.'],
    ['Vercel + Supabase only',                                   'No DevOps overhead. Managed scaling. One operator can run it.'],
    ['Service layer (lib/) as the AI integration boundary',     'Single place to enforce usage logging, prompt caching, tier routing.'],
    ['Tier-routed LLM (haiku / sonnet)',                         'Cost control via tier; haiku for real-time clarifiers, sonnet for theme mining.'],
    ['pgvector + tsvector + pg_trgm hybrid retrieval',          'Semantic + lexical + fuzzy fallback. No external vector DB.'],
    ['Cron jobs with 45s budgets on 60s timeouts',              'Vercel-native. No queue infrastructure required at this stage.'],
    ['500-row batched ingestion',                                'Fits inside the 10MB Server Action limit; chunked enough to retry.'],
    ['Force-dynamic on auth\'d routes',                          'No ISR caching to debug. Fresh data every render.'],
    ['Single denormalized table for 500K-row datasets',         'Avoids join-heavy reads. JSONB + tsvector + GIN does the work.'],
  ]
  const rows = [head, ...data.map((r, ri) => r.map((c, ci) => ({
    text: c,
    options: {
      fontSize: 10, fontFace: 'Arial',
      color: ci === 0 ? DN.navy : DN.ink,
      bold: ci === 0,
      fill: { color: ri % 2 === 0 ? DN.slateCard : DN.white },
    },
  })))]
  s.addTable(rows as any, { x: 0.5, y: 1.25, w: 12.3, colW: [4.8, 7.5], border: { pt: 0.5, color: DN.slateLight }, rowH: 0.5 })
}

// ── 4. Discipline That Exists ──────────────────────────────────────────────
function slideDiscipline(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Discipline That Exists', 'The operating habits that scale to one operator + AI')
  addFooter(s, pg)
  s.addText([
    bullet('TypeScript strict mode — zero compile errors enforced before every commit. Caught dozens of bugs that tests would have caught.'),
    bullet('41 versioned SQL migrations in sql/ — every schema change is traceable and replayable.'),
    bullet('16 specification docs in docs/*.md kept current with code (saved as a memory rule).'),
    bullet('Service-role boundary: server-only key, never reaches client. Auth client for reads, service role for writes after explicit user check.'),
    bullet('RLS enabled on every table. sql/032_enable_rls_everywhere.sql is idempotent and re-applied on schema changes.'),
    bullet('Per-call AI usage logged (usage_logs) with input / output / cache tokens. Cost-per-org is reportable in real time.'),
    bullet('Audit trails: user_logins (every successful auth), bot_conversation_reviews (cron-driven AI self-audit every 4 hr), usage_logs (FinOps).'),
    bullet('Sentry server + client + edge configs with sourcemaps. Vercel build injects commit count + ISO timestamp.'),
    bullet('Lean dependency tree — 27 npm deps total (17 production). Most React / Next apps in this category run 50–150.'),
    bullet('No file > 3K lines. Largest files (PPTX exporter, survey engine, charts module) are the modules that legitimately need to be big.'),
  ], { x: 0.6, y: 1.3, w: 12.1, h: 5.7 })
}

// ── 5. Discipline That Is Missing ──────────────────────────────────────────
function slideGaps(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Discipline That Is Missing', 'Honest gaps — the things a team would have caught that one operator did not')
  addFooter(s, pg)
  s.addText([
    bullet('Zero automated tests. Type checking + manual verification only. Refactor confidence is low; regression risk on big changes is real.', { color: DN.red }),
    bullet('No CI pipeline. Local dev + Vercel auto-deploy. tsc passes is the merge bar.', { color: DN.red }),
    bullet('In-memory rate limiting (lib/rateLimit.ts) — buckets reset on cold start. Not production-grade against a sustained attack.', { color: DN.red }),
    bullet('No formal CORS policy. Same-origin only by accident; widget endpoints permit cross-origin without CSRF tokens.'),
    bullet('No mutation audit trail beyond auth + AI calls. Cannot reconstruct who edited a study, bot config, or campaign.'),
    bullet('GDPR export / delete endpoints not built. Cascade-delete relies on FK ON DELETE CASCADE — risky if EU customer signs.'),
    bullet('No load-tested concurrency baselines. Patterns are sound (HNSW, batching, time budgets) but unverified at scale.'),
    bullet('No ADRs. Major decisions live in commit messages and the operator\'s head.'),
    bullet('No SAST / dependency scanning beyond Vercel\'s defaults. No Snyk / Semgrep / GitHub code scanning.'),
    bullet('No design system or Storybook. Components are shared in components/ but not catalogued or tested in isolation.'),
    bullet('Per-org LLM cost is logged, not enforced. A misbehaving customer could rack up Anthropic spend before being throttled.'),
  ], { x: 0.6, y: 1.3, w: 12.1, h: 5.8 })
}

// ── 6. Risk Register ───────────────────────────────────────────────────────
function slideRisks(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Risk Register', 'Ranked by impact — what could break, what would happen')
  addFooter(s, pg)

  const head = [
    { text: 'Risk',          options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
    { text: 'Severity',      options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11, align: 'center' } },
    { text: 'What would happen', options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
  ]
  const data: [string, string, string, string][] = [
    ['In-memory rate limiting',                'HIGH',   'Sustained attack could exhaust function instances; legitimate traffic gets 429s', 'red'],
    ['Untested concurrency above ~50 users',   'HIGH',   'Unknown failure modes; PulseIQ live sessions could degrade unpredictably',          'red'],
    ['Service-role used liberally',            'MED',    'Application-layer bug could leak data across orgs (RLS protects reads, not server writes)', 'amber'],
    ['No mutation audit trail',                'MED',    'Cannot reconstruct who-changed-what on critical tables during dispute or breach',  'amber'],
    ['GDPR export/delete endpoints missing',   'MED',    'Compliance liability the moment an EU customer signs',                              'amber'],
    ['Per-org LLM cost not capped',            'MED',    'Misbehaving customer racks up Anthropic spend before being throttled',               'amber'],
    ['No regression tests on critical paths',  'MED',    'Refactors carry hidden risk; each release relies on manual smoke testing',           'amber'],
    ['Cron failures only land in Sentry',      'LOW',    'No oncall paging; a stuck ingest could drift unnoticed for a day',                   'green'],
    ['No SAST / dependency scanning',          'LOW',    'CVE in a dep slips in until next manual upgrade pass',                               'green'],
  ]
  const sevColor = (k: string) => k === 'red' ? DN.red : k === 'amber' ? DN.amber : DN.green
  const sevBg    = (k: string) => k === 'red' ? DN.redLight : k === 'amber' ? DN.amberLight : DN.greenLight
  const rows = [head, ...data.map(r => [
    { text: r[0], options: { fontSize: 10, fontFace: 'Arial', color: DN.navy, bold: true, fill: { color: DN.slateCard } } },
    { text: r[1], options: { fontSize: 10, fontFace: 'Arial', color: sevColor(r[3]), bold: true, fill: { color: sevBg(r[3]) }, align: 'center' } },
    { text: r[2], options: { fontSize: 10, fontFace: 'Arial', color: DN.ink, fill: { color: DN.white } } },
  ])]
  s.addTable(rows as any, { x: 0.5, y: 1.25, w: 12.3, colW: [3.5, 1.2, 7.6], border: { pt: 0.5, color: DN.slateLight }, rowH: 0.45 })
}

// ── 7. Operator vs AI ──────────────────────────────────────────────────────
function slideOperatorVsAI(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Operator vs AI — What Each Did', 'AI as fast junior under operator review')
  addFooter(s, pg)

  // Operator card
  s.addShape('rect', { x: 0.5, y: 1.25, w: 5.95, h: 5.55, fill: { color: DN.tealPale }, rectRadius: 0.1 })
  s.addShape('rect', { x: 0.5, y: 1.25, w: 5.95, h: 0.5, fill: { color: DN.teal }, rectRadius: 0.1 })
  s.addText('OPERATOR — 100% OF THESE', { x: 0.5, y: 1.25, w: 5.95, h: 0.5, fontFace: 'Arial', fontSize: 13, color: DN.white, bold: true, align: 'center', valign: 'middle' })
  s.addText([
    bullet('Every architectural decision', { fontSize: 11 }),
    bullet('Every data model + RLS policy', { fontSize: 11 }),
    bullet('Every product flow + UX choice', { fontSize: 11 }),
    bullet('Every integration choice (Anthropic, OpenAI, DataForSEO, Resend, Meta Graph, Reddit, Substack, Reg.gov)', { fontSize: 11 }),
    bullet('Every guardrail / safety policy', { fontSize: 11 }),
    bullet('Every "is this safe to ship" judgment', { fontSize: 11 }),
    bullet('Code review of every change before commit', { fontSize: 11 }),
    bullet('All 12 years of NLP/NLU pattern recognition', { fontSize: 11 }),
  ], { x: 0.7, y: 1.85, w: 5.6, h: 4.85 })

  // AI card
  s.addShape('rect', { x: 6.85, y: 1.25, w: 5.95, h: 5.55, fill: { color: DN.slateCard }, rectRadius: 0.1 })
  s.addShape('rect', { x: 6.85, y: 1.25, w: 5.95, h: 0.5, fill: { color: DN.slate }, rectRadius: 0.1 })
  s.addText('AI — ~70–80% OF THE LINE CODE', { x: 6.85, y: 1.25, w: 5.95, h: 0.5, fontFace: 'Arial', fontSize: 13, color: DN.white, bold: true, align: 'center', valign: 'middle' })
  s.addText([
    bullet('Implementation of operator-decided patterns', { fontSize: 11 }),
    bullet('Boilerplate, glue, types, route handlers', { fontSize: 11 }),
    bullet('Refactoring under direction', { fontSize: 11 }),
    bullet('Drafting of UI components against spec', { fontSize: 11 }),
    bullet('Migration scripts (then operator-reviewed)', { fontSize: 11 }),
    bullet('First-pass error handling, logging hooks', { fontSize: 11 }),
    bullet('Documentation + spec scaffolding', { fontSize: 11 }),
    bullet('NOT: design judgment, NOT: data model, NOT: security policy', { fontSize: 11, color: DN.red }),
  ], { x: 7.05, y: 1.85, w: 5.6, h: 4.85 })

  s.addText('Risk model: AI is a junior engineer at faster cadence. Same disciplines apply — type safety, RLS, audit logs, code review. Tests are the gap.', {
    x: 0.5, y: 6.9, w: 12.3, h: 0.3, fontFace: 'Arial', fontSize: 11, color: DN.navy, italic: true, bold: true, align: 'center',
  })
}

// ── 8. Phase 1 Hardening Plan ──────────────────────────────────────────────
function slideHardening(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Phase 1 Hardening Plan', 'What capital buys — turning gaps into shipped infrastructure')
  addFooter(s, pg)

  const items = [
    { area: 'Tests',           what: 'Vitest + Playwright + GitHub Actions CI · ~15 critical-path tests (auth, RLS, admin gating, public endpoints, guardrails) · merge bar = green CI', color: DN.sarinaBlue },
    { area: 'Rate limit',      what: 'Vercel KV-backed token bucket replacing in-memory · per-IP and per-org · survives cold starts',                                                color: DN.teal },
    { area: 'Compliance',      what: 'SOC 2 Type II audit + third-party pen-test · GDPR export/delete endpoints · CORS policy formalized',                                            color: DN.hermesOrange },
    { area: 'Audit trail',     what: 'Postgres triggers → audit_log table on critical mutations (studies, bots, datasets, org membership)',                                          color: DN.gold },
    { area: 'AI observability', what: 'LangSmith traces + LLM-as-judge evals + user-feedback loop wired into bot, survey, and PulseIQ outputs · regression eval datasets curated',  color: '6D28D9' },
    { area: 'Scalability',     what: 'k6 / Artillery load suite · documented baselines per scenario · per-org LLM cost cap enforcement',                                            color: DN.green },
    { area: 'Operations',      what: 'Vercel Workflows for durable ingestion (replacing budget-aware cron) · ADRs in docs/adr/ · SAST (Semgrep / Snyk) · Storybook for components',  color: DN.navy },
  ]
  const rowH = 0.72
  const rowGap = 0.08
  items.forEach((it, i) => {
    const y = 1.25 + i * (rowH + rowGap)
    s.addShape('rect', { x: 0.5, y, w: 1.85, h: rowH, fill: { color: it.color }, rectRadius: 0.08 })
    s.addText(it.area, { x: 0.5, y, w: 1.85, h: rowH, fontFace: 'Arial', fontSize: 13, color: DN.white, bold: true, align: 'center', valign: 'middle', autoFit: true })
    s.addShape('rect', { x: 2.45, y, w: 10.35, h: rowH, fill: { color: DN.slateCard }, rectRadius: 0.08 })
    s.addText(it.what, { x: 2.6, y, w: 10.1, h: rowH, fontFace: 'Arial', fontSize: 10.5, color: DN.ink, valign: 'middle', autoFit: true })
  })
}

// ── 9. Open Questions ──────────────────────────────────────────────────────
function slideOpenQuestions(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Open Questions for You', 'What I want a senior engineer to push back on')
  addFooter(s, pg)
  s.addText([
    bullet('Where does this architecture seem thinnest? Where would you push hardest in technical diligence?'),
    bullet('Right test framework for this stack — Vitest + Playwright + MSW? Or a different mix?'),
    bullet('Vercel KV vs Upstash Redis for the rate-limit + ephemeral state layer?'),
    bullet('Worth replatforming cron orchestration to Vercel Workflows now (durable, retryable, observable) or stay budget-aware until we hit a real pain point?'),
    bullet('Postgres triggers vs application-level for the mutation audit trail — what trips fewer landmines?'),
    bullet('Service-role boundary feels like the highest-risk pattern. Worth investing in tighter app-layer assertions before Phase 1, or is RLS-on-reads + careful service-role-on-writes acceptable at this scale?'),
    bullet('We have observability (Sentry + usage_logs + login audit) but no SLOs. Worth defining them now or waiting for paying customers to push?'),
    bullet('Anything you would absolutely require to see before signing as a technical advisor or recommending to a portco?'),
  ], { x: 0.6, y: 1.3, w: 12.1, h: 5.0 })

  s.addShape('rect', { x: 0.5, y: 6.4, w: 12.3, h: 0.65, fill: { color: DN.navy }, rectRadius: 0.08 })
  s.addText('Disagreement is the point — the deck exists so we can argue from a shared baseline.', {
    x: 0.5, y: 6.4, w: 12.3, h: 0.65, fontFace: 'Arial', fontSize: 13, color: DN.gold, italic: true, bold: true, align: 'center', valign: 'middle',
  })
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
