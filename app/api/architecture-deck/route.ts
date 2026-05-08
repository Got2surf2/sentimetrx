// GET /api/architecture-deck — generates a technical architecture deck
// for investor diligence (CTO / technical advisor audience).
//
// Style matches /api/rollup-deck and /api/pitch-deck — Arial, navy
// header w/ accent line, branded title and ask slides, footer with
// datanautix.com + page number.

import { NextResponse } from 'next/server'
import PptxGenJS from 'pptxgenjs'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { logDeckDownload } from '@/lib/auth/logDeckDownload'

export const dynamic = 'force-dynamic'

// ── Brand palette ──────────────────────────────────────────────────────────
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
  purpleLight:  'EDE9FE',
}

const W = 13.33
const H = 7.5

// ── Shared layout primitives ───────────────────────────────────────────────
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
  slide.addText('datanautix.com  ·  Platform Architecture  ·  Confidential — for technical diligence', {
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
      fontSize: 13, fontFace: 'Arial', color: DN.ink, lineSpacing: 22,
      bullet: { code: '2022' },
      ...opts,
    },
  }
}

// helper: section label pill (small uppercase tag inside a slide)
function tag(slide: any, x: number, y: number, w: number, label: string, color: string) {
  slide.addShape('rect', { x, y, w, h: 0.3, fill: { color }, rectRadius: 0.05 })
  slide.addText(label, {
    x, y, w, h: 0.3, fontSize: 9, fontFace: 'Arial', color: DN.white, bold: true,
    align: 'center', valign: 'middle', charSpacing: 1, autoFit: true,
  })
}

// ── Title slide ────────────────────────────────────────────────────────────
function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function addTitleSlide(pptx: any) {
  const s = pptx.addSlide()
  const buildDate = process.env.NEXT_PUBLIC_BUILD_DATE
  const lastUpdated = buildDate ? fmtDate(new Date(buildDate)) : fmtDate(new Date())
  const downloaded = fmtDate(new Date())

  s.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.navy } })
  s.addShape('ellipse', { x: W - 4.5, y: -1.5, w: 5.5, h: 5.5, fill: { color: DN.teal, transparency: 88 }, line: { width: 0 } })
  s.addShape('ellipse', { x: W - 3.0, y: 0.5, w: 3.5, h: 3.5, fill: { color: DN.sarinaBlue, transparency: 92 }, line: { width: 0 } })
  s.addShape('rect', { x: 0, y: 0, w: W, h: 0.07, fill: { color: DN.gold } })

  s.addText('DATANAUTIX', { x: 0.8, y: 1.4, w: 11, h: 0.5, fontSize: 16, fontFace: 'Arial', color: DN.gold, bold: true, charSpacing: 4 })
  s.addText('Platform Architecture', { x: 0.8, y: 2.1, w: 11, h: 1.0, fontSize: 44, fontFace: 'Arial', color: DN.white, bold: true })
  s.addShape('rect', { x: 0.8, y: 3.2, w: 4.5, h: 0.04, fill: { color: DN.gold } })
  s.addText('A technical reference for investor due diligence', {
    x: 0.8, y: 3.4, w: 11, h: 0.6, fontSize: 18, fontFace: 'Arial', color: DN.sarinaBlue, italic: true,
  })
  s.addText('Built AI-native. Multi-tenant from day one. Audit-grade by design.', {
    x: 0.8, y: 4.3, w: 11, h: 0.5, fontSize: 16, fontFace: 'Arial', color: DN.white,
  })
  // Date strip
  s.addText(`Last updated  ${lastUpdated}     ·     Downloaded  ${downloaded}`, {
    x: 0.8, y: 5.0, w: 11, h: 0.35,
    fontSize: 11, fontFace: 'Arial', color: DN.slate, italic: true,
  })

  s.addShape('rect', { x: 0, y: H - 0.5, w: W, h: 0.5, fill: { color: DN.navyMid } })
  s.addText([
    { text: 'data', options: { color: DN.hermesOrange, bold: true, italic: true } },
    { text: 'nautix', options: { color: DN.sarinaBlue, bold: true, italic: true } },
    { text: '   ·   datanautix.com   ·   Confidential', options: { color: DN.slate } },
  ], { x: 0.6, y: H - 0.45, w: 12, h: 0.4, fontSize: 13, fontFace: 'Arial', valign: 'middle' })
}

// ── 1. TL;DR ───────────────────────────────────────────────────────────────
function slideTLDR(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Architecture in One Slide', 'AI-native, multi-tenant SaaS — production hardened on Vercel + Supabase')
  addFooter(s, pg)

  const pillars = [
    { t: 'Multi-Tenant Data',   v: '39 tables · org-scoped RLS · Postgres + pgvector + tsvector', color: DN.sarinaBlue },
    { t: 'AI Pipeline',          v: 'Tiered LLM router · prompt caching · per-call usage accounting',        color: DN.teal },
    { t: 'Multi-Source Ingest',  v: '7 sources · 7 cron jobs · timeout-safe budgets · idempotent',            color: DN.hermesOrange },
    { t: 'Hybrid Retrieval',     v: 'OpenAI embeddings (1536d) · HNSW + FTS + trigram blend',                 color: DN.gold },
    { t: 'Observability',        v: 'Sentry · usage_logs · login audit · AI conversation review',             color: DN.purple },
    { t: 'Compliance Posture',   v: 'PKCE auth · content moderation · SOC 2 Type II in flight',               color: DN.navy },
  ]
  pillars.forEach((p, i) => {
    const col = i % 2, row = Math.floor(i / 2)
    const x = 0.6 + col * 6.15
    const y = 1.3 + row * 1.85
    s.addShape('rect', { x, y, w: 5.95, h: 1.7, fill: { color: DN.slateCard }, rectRadius: 0.1 })
    s.addShape('rect', { x, y, w: 0.18, h: 1.7, fill: { color: p.color } })
    s.addText(p.t, { x: x + 0.35, y: y + 0.15, w: 5.5, h: 0.45, fontSize: 16, fontFace: 'Arial', color: DN.navy, bold: true })
    s.addText(p.v, { x: x + 0.35, y: y + 0.7, w: 5.5, h: 0.9, fontSize: 12, fontFace: 'Arial', color: DN.ink, lineSpacing: 18 })
  })
}

// ── 1.5 Platform by the Numbers ────────────────────────────────────────────
function slidePlatformByNumbers(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Platform by the Numbers', 'The surface area of what is built and serving enterprise customers today.')
  addFooter(s, pg)

  const stats = [
    { v: '6',    l: 'revenue-bearing modules',          sub: 'Sarina · Ana · Agents · PulseIQ · Listening · Campaigns', color: DN.sarinaBlue },
    { v: '180+', l: 'specialized API endpoints',        sub: 'Auth · public · admin · webhook · cron',                  color: DN.teal },
    { v: '40+',  l: 'domain tables in 7 schema groups', sub: 'pgvector · tsvector · pg_trgm hybrid retrieval',          color: DN.hermesOrange },
    { v: '7',    l: 'multi-source ingestion paths',      sub: 'Reviews · Reddit · Substack · Reg.gov · Social · Files · Survey', color: DN.gold },
    { v: '13',   l: 'chart types in the analytics suite', sub: 'with hypothesis testing & PPTX export',                color: DN.purple },
    { v: '5',    l: 'verticals with named enterprise clients', sub: 'Sports · Hospitality · Education · Airports · Political', color: DN.navy },
  ]

  const cardW = 4.05
  const cardH = 2.4
  const startY = 1.3

  stats.forEach((stat, i) => {
    const col = i % 3, row = Math.floor(i / 3)
    const x = 0.45 + col * (cardW + 0.1)
    const y = startY + row * (cardH + 0.1)
    s.addShape('rect', { x, y, w: cardW, h: cardH, fill: { color: DN.slateCard }, rectRadius: 0.1 })
    s.addShape('rect', { x, y, w: cardW, h: 0.18, fill: { color: stat.color } })
    s.addText(stat.v, {
      x, y: y + 0.32, w: cardW, h: 1.0,
      fontFace: 'Arial', fontSize: 56, color: stat.color, bold: true, align: 'center', valign: 'middle',
    })
    s.addText(stat.l, {
      x: x + 0.2, y: y + 1.4, w: cardW - 0.4, h: 0.45,
      fontFace: 'Arial', fontSize: 13, color: DN.navy, bold: true, align: 'center', valign: 'middle', autoFit: true,
    })
    s.addText(stat.sub, {
      x: x + 0.2, y: y + 1.85, w: cardW - 0.4, h: 0.45,
      fontFace: 'Arial', fontSize: 10, color: DN.slate, italic: true, align: 'center', valign: 'middle', lineSpacing: 14, autoFit: true,
    })
  })

  s.addText('No prototype. No demoware. Production traffic across all six modules.', {
    x: 0.5, y: 6.6, w: 12.3, h: 0.4,
    fontFace: 'Arial', fontSize: 12, color: DN.navy, italic: true, bold: true, align: 'center',
  })
}

// ── 2. Stack at a glance ───────────────────────────────────────────────────
function slideStack(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Stack at a Glance', 'Named technologies. Production versions.')
  addFooter(s, pg)

  const head = [
    { text: 'Layer',     options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
    { text: 'Choice',    options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
    { text: 'Version / Notes', options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
  ]
  const data = [
    ['Framework',         'Next.js (App Router)',                       'v14.2.5 · server components · force-dynamic on critical routes'],
    ['Language',          'TypeScript',                                  'strict mode · Supabase types auto-generated'],
    ['Hosting',           'Vercel Functions (Node.js)',                  '60s timeout · 45s code budget · 10MB body limit on uploads'],
    ['Database',          'Supabase Postgres',                            'RLS-everywhere · 35 SQL migrations · managed PgBouncer pooling'],
    ['Vector store',      'pgvector',                                     '1536d cosine · HNSW index on agent knowledge chunks'],
    ['Auth',              'Supabase Auth',                                'PKCE flow · /auth/callback · magic-link + password + invite'],
    ['Primary LLM',       'Anthropic Claude',                             'Haiku 4.5 (fast) · Sonnet 4 / 4.6 (standard, advanced) · prompt cache'],
    ['Embeddings',        'OpenAI text-embedding-3-small',                '1536 dim · indexed in pgvector with HNSW'],
    ['Email',             'Resend (primary)',                             'SendGrid / SES / SMTP / Twilio SMS pluggable'],
    ['Observability',     'Sentry @sentry/nextjs 10.51',                 'server + client + edge configs · sourcemap upload · 0.1 trace sample'],
    ['File storage',      'AWS S3 (presigned)',                           '@aws-sdk/client-s3 · CSV/XLSX uploads · transient'],
    ['Reporting',         'pptxgenjs 4.0 · Plotly 2.35 · xlsx 0.18',     'server-side PPTX · client-side interactive charts'],
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
  s.addTable(rows as any, { x: 0.5, y: 1.3, w: 12.3, colW: [2.3, 3.5, 6.5], border: { pt: 0.5, color: DN.slateLight }, rowH: 0.4 })
}

// ── 3. System architecture (layered) ───────────────────────────────────────
function slideSystemArch(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'System Architecture', 'Six layers · clear boundaries · no hidden coupling')
  addFooter(s, pg)

  // Layered tiers
  const tiers: { label: string; items: string; color: string }[] = [
    { label: 'CLIENT',           items: 'Authenticated app  ·  Public surfaces (/s/[guid], /b/[slug], /th/[id])  ·  Embed widgets  ·  Shared analytics links',                color: DN.sarinaBlue },
    { label: 'EDGE / APP ROUTER', items: 'Next.js 14 App Router  ·  Server Components  ·  Route handlers (force-dynamic)  ·  Auth callback  ·  Public widgets',              color: DN.teal },
    { label: 'SERVICE LAYER',    items: 'lib/ai (LLM router)  ·  lib/personaExtractor  ·  lib/opinionMining  ·  lib/deflect  ·  lib/guardrails  ·  lib/usageLog  ·  lib/rateLimit', color: DN.hermesOrange },
    { label: 'EXTERNAL APIs',    items: 'Anthropic Claude  ·  OpenAI Embeddings + Moderation  ·  Resend  ·  Meta Graph v19  ·  DataForSEO  ·  Reddit / Substack / Reg.gov',  color: DN.gold },
    { label: 'DATA LAYER',       items: 'Supabase Postgres  ·  Row-Level Security  ·  pgvector (HNSW)  ·  tsvector + pg_trgm  ·  35 migrations  ·  ON DELETE CASCADE',     color: DN.navy },
    { label: 'ORCHESTRATION',    items: '7 cron jobs (campaign · review-sync · townhall-themes · bot-review · social-sync · token-refresh · cleanup)  ·  CRON_SECRET bearer', color: DN.purple },
  ]
  const rowH = 0.86
  const startY = 1.25
  tiers.forEach((t, i) => {
    const y = startY + i * (rowH + 0.05)
    tag(s, 0.5, y + (rowH - 0.3) / 2, 1.55, t.label, t.color)
    s.addShape('rect', { x: 2.15, y, w: 10.7, h: rowH, fill: { color: DN.slateCard }, rectRadius: 0.08 })
    s.addText(t.items, { x: 2.3, y, w: 10.5, h: rowH, fontSize: 11, fontFace: 'Arial', color: DN.ink, valign: 'middle', wrap: true })
  })
}

// ── 3.5 AI at the Center (hub-and-spoke) ───────────────────────────────────
function slideAICenter(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'AI at the Center', 'Every workflow touches the same AI layer — by design')
  addFooter(s, pg)

  // ── Hub geometry ──
  const hubX = 4.4, hubY = 3.4, hubW = 4.55, hubH = 1.5

  // ── Spoke cards: 4 left, 4 right ──
  const cardW = 3.3, cardH = 1.05
  const leftX = 0.5
  const rightX = 9.5
  const yPositions = [1.7, 2.95, 4.2, 5.45]

  type Spoke = { side: 'L' | 'R'; row: number; title: string; body: string; color: string }
  const spokes: Spoke[] = [
    { side: 'L', row: 0, title: 'CONVERSATIONAL COLLECTION', body: 'Sarina · Agents · PulseIQ.\nReal-time clarifiers, persona inference.', color: DN.sarinaBlue },
    { side: 'L', row: 1, title: 'MULTI-SOURCE INGESTION',    body: 'Reviews · Reddit · Social · Reg.gov · Files.\nNormalized to one pipeline.',  color: DN.teal },
    { side: 'L', row: 2, title: 'HYBRID RETRIEVAL',           body: 'OpenAI 1536d + tsvector + pg_trgm.\nSub-10ms vector search.',               color: DN.hermesOrange },
    { side: 'L', row: 3, title: 'THEME & SENTIMENT',          body: 'Ana. 4–7 themes per dataset.\nNegation-aware. Significance labeled.',       color: DN.gold },
    { side: 'R', row: 0, title: 'PERSONA & INTENT',           body: 'Mid-conversation extraction.\nDonate / volunteer / event / custom.',         color: DN.purple },
    { side: 'R', row: 1, title: 'CONTENT SAFETY',             body: 'OpenAI Moderation API.\n14 input regex + AI refusal detection.',             color: DN.red },
    { side: 'R', row: 2, title: 'AUTO REPORTING',             body: 'Tiered PPTX. AI quote selection.\npptxgenjs + Plotly.',                       color: DN.green },
    { side: 'R', row: 3, title: 'SELF-AUDIT & FINOPS',        body: 'bot_conversation_reviews.\nusage_logs · per-org cost in real time.',         color: DN.navy },
  ]

  // ── Draw connector lines first (they sit behind the hub + cards) ──
  spokes.forEach(sp => {
    const cardMidY = yPositions[sp.row] + cardH / 2
    if (sp.side === 'L') {
      // horizontal connector from right edge of left card to hub left edge
      s.addShape('rect', { x: leftX + cardW, y: cardMidY - 0.015, w: hubX - (leftX + cardW), h: 0.03, fill: { color: 'B7C4D1' }, line: { width: 0 } })
      // gold dot at hub end
      s.addShape('ellipse', { x: hubX - 0.07, y: cardMidY - 0.07, w: 0.14, h: 0.14, fill: { color: DN.gold }, line: { width: 0 } })
    } else {
      const startX = hubX + hubW
      s.addShape('rect', { x: startX, y: cardMidY - 0.015, w: rightX - startX, h: 0.03, fill: { color: 'B7C4D1' }, line: { width: 0 } })
      s.addShape('ellipse', { x: startX - 0.07, y: cardMidY - 0.07, w: 0.14, h: 0.14, fill: { color: DN.gold }, line: { width: 0 } })
    }
  })

  // ── Hub (drawn after connectors so it covers their endpoints visually) ──
  // outer halo
  s.addShape('ellipse', { x: hubX - 0.45, y: hubY - 0.45, w: hubW + 0.9, h: hubH + 0.9, fill: { color: DN.sarinaBlue, transparency: 80 }, line: { width: 0 } })
  // mid halo
  s.addShape('ellipse', { x: hubX - 0.2, y: hubY - 0.2, w: hubW + 0.4, h: hubH + 0.4, fill: { color: DN.teal, transparency: 60 }, line: { width: 0 } })
  // core ellipse
  s.addShape('ellipse', { x: hubX, y: hubY, w: hubW, h: hubH, fill: { color: DN.navy }, line: { color: DN.gold, width: 2 } })
  s.addText('AI LAYER', {
    x: hubX, y: hubY + 0.15, w: hubW, h: 0.55,
    fontSize: 26, fontFace: 'Arial', color: DN.gold, bold: true, align: 'center', valign: 'middle', charSpacing: 6,
  })
  s.addText('LLM router  ·  Embeddings  ·  Moderation  ·  Prompt cache  ·  Usage logging', {
    x: hubX + 0.1, y: hubY + 0.78, w: hubW - 0.2, h: 0.5,
    fontSize: 11, fontFace: 'Arial', color: DN.white, italic: true, align: 'center', valign: 'middle',
  })

  // ── Spoke cards (drawn last so they sit on top) ──
  spokes.forEach(sp => {
    const x = sp.side === 'L' ? leftX : rightX
    const y = yPositions[sp.row]
    s.addShape('rect', { x, y, w: cardW, h: cardH, fill: { color: DN.white }, rectRadius: 0.08, line: { color: DN.slateLight, width: 0.75 } })
    // accent strip on hub-facing edge
    if (sp.side === 'L') {
      s.addShape('rect', { x: x + cardW - 0.1, y, w: 0.1, h: cardH, fill: { color: sp.color }, rectRadius: 0.04 })
    } else {
      s.addShape('rect', { x, y, w: 0.1, h: cardH, fill: { color: sp.color }, rectRadius: 0.04 })
    }
    s.addText(sp.title, {
      x: x + (sp.side === 'L' ? 0.18 : 0.25), y: y + 0.08, w: cardW - 0.4, h: 0.32,
      fontSize: 10, fontFace: 'Arial', color: sp.color, bold: true, charSpacing: 1, valign: 'middle', autoFit: true,
    })
    s.addText(sp.body, {
      x: x + (sp.side === 'L' ? 0.18 : 0.25), y: y + 0.42, w: cardW - 0.4, h: cardH - 0.5,
      fontSize: 9.5, fontFace: 'Arial', color: DN.ink, valign: 'top', lineSpacing: 14,
    })
  })

  // bottom kicker
  s.addText('Refactoring this in is a years-long replatform for incumbents. We were born here.', {
    x: 0.5, y: 6.85, w: 12.3, h: 0.3, fontSize: 11, fontFace: 'Arial', color: DN.navy, italic: true, bold: true, align: 'center',
  })
}

// ── 4. Data layer (39 tables, six domains) ─────────────────────────────────
function slideDataLayer(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Data Layer: 39 Tables, 7 Domains', 'Org-scoped from the schema up. No tenant routers — multi-tenancy is a column.')
  addFooter(s, pg)

  const domains = [
    { name: 'Surveys',       count: '6 tables', tables: 'studies · responses · study_response_stats · study_designs · drafts · share_tokens', color: DN.sarinaBlue },
    { name: 'Datasets',      count: '4 tables', tables: 'datasets · dataset_rows_flat · dataset_state · archived_dataset_rows*', color: DN.teal },
    { name: 'Agents / RAG',  count: '5 tables', tables: 'bots · bot_knowledge_chunks · bot_conversation_turns · bot_conversation_reviews · bot_session_personas', color: DN.hermesOrange },
    { name: 'PulseIQ',       count: '4 tables', tables: 'townhall_sessions · townhall_themes · townhall_turns · townhall_participant_responses', color: DN.gold },
    { name: 'Campaigns',     count: '5 tables', tables: 'campaigns · campaign_respondents · campaign_emails · campaign_send_log · campaign_schedules', color: DN.purple },
    { name: 'Listening',     count: '8 tables', tables: 'review_sources · review_source_locations · reddit_sources · reddit_source_threads · social_connections · social_comments · social_moderation_log · social_alert_rules', color: DN.green },
    { name: 'Org / Audit',   count: '7 tables', tables: 'organizations · users · invites · org_transfers · usage_logs · user_logins · collections', color: DN.navy },
  ]
  const colW = 4.05, rowH = 1.55
  domains.forEach((d, i) => {
    const col = i % 3, row = Math.floor(i / 3)
    const x = 0.45 + col * (colW + 0.1)
    const y = 1.3 + row * (rowH + 0.1)
    s.addShape('rect', { x, y, w: colW, h: rowH, fill: { color: DN.slateCard }, rectRadius: 0.1 })
    s.addShape('rect', { x, y, w: colW, h: 0.45, fill: { color: d.color }, rectRadius: 0.1 })
    s.addText(d.name, { x: x + 0.15, y, w: colW - 1.0, h: 0.45, fontSize: 13, fontFace: 'Arial', color: DN.white, bold: true, valign: 'middle' })
    s.addText(d.count, { x: x + colW - 1.0, y, w: 0.85, h: 0.45, fontSize: 11, fontFace: 'Arial', color: DN.white, italic: true, align: 'right', valign: 'middle' })
    s.addText(d.tables, { x: x + 0.15, y: y + 0.55, w: colW - 0.3, h: rowH - 0.65, fontSize: 9, fontFace: 'Arial', color: DN.ink, lineSpacing: 16 })
  })
  // bottom callout
  s.addShape('rect', { x: 0.5, y: 1.3 + 3 * (rowH + 0.1) + 0.05, w: 12.3, h: 0.55, fill: { color: DN.navy }, rectRadius: 0.08 })
  s.addText('Search infrastructure: pgvector (1536d, HNSW, cosine)  ·  tsvector + GIN  ·  pg_trgm  ·  hybrid blend in search_knowledge_semantic()', {
    x: 0.5, y: 1.3 + 3 * (rowH + 0.1) + 0.05, w: 12.3, h: 0.55, fontSize: 11, fontFace: 'Arial', color: DN.gold, bold: true, italic: true, align: 'center', valign: 'middle',
  })
}

// ── 5. Multi-tenancy ───────────────────────────────────────────────────────
function slideMultiTenancy(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Multi-Tenancy Model', 'org_id is in every data-bearing table. Features are JSONB. RLS does the gating.')
  addFooter(s, pg)

  s.addText([
    bullet('Single-tenant logical schema, multi-tenant via org_id on every domain table'),
    bullet('organizations.features (JSONB) gates modules per org: { surveys, analyze, bots, townhall, campaigns, googleReviews, reddit, substack, social }'),
    bullet('users.features (JSONB) overrides on a per-user basis; effectiveFeatures() computes intersection'),
    bullet('Admin orgs (organizations.is_admin_org=true) see all orgs without bypassing RLS — separate auth path, same DB'),
    bullet('Invites are PKCE-gated single-use tokens (invites table) — anon-readable for the signup hand-off, then consumed'),
    bullet('Org transfers logged (org_transfers) for audit; ON DELETE CASCADE keeps referential integrity on user removal'),
  ], { x: 0.6, y: 1.3, w: 12.1, h: 4.2 })

  s.addShape('rect', { x: 0.5, y: 5.7, w: 12.3, h: 1.0, fill: { color: DN.navy }, rectRadius: 0.08 })
  s.addText('Migration math:', { x: 0.7, y: 5.78, w: 4, h: 0.3, fontSize: 11, fontFace: 'Arial', color: DN.gold, bold: true, charSpacing: 3 })
  s.addText('Acquired-customer onboarding = INSERT into organizations + bulk import to dataset_rows_flat. No schema fork. No tenant router. 90-day migration is a configuration exercise, not a re-architecture.', {
    x: 0.7, y: 6.05, w: 12.0, h: 0.6, fontSize: 12, fontFace: 'Arial', color: DN.white, italic: true,
  })
}

// ── 6. AuthZ + RLS ─────────────────────────────────────────────────────────
function slideAuthZ(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'AuthZ: RLS at the Database, Not the App', 'Defense in depth — even a leaky route cannot return another tenant\'s data')
  addFooter(s, pg)

  const head = [
    { text: 'Path',           options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
    { text: 'Identity',       options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
    { text: 'Enforcement',    options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
  ]
  const data = [
    ['Authenticated app reads',  'auth.uid() (JWT)',          'RLS: USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()))'],
    ['Authenticated mutations',  'auth.uid()',                'Service-role on server with explicit user/org check before write'],
    ['Public survey response',   'anon',                      'study_guid lookup + study.status=\'active\' + payload schema validation'],
    ['Public agent chat',        'anon + IP rate limit',      'lib/rateLimit per IP + bot.id check + content moderation pre/post'],
    ['Shared analytics link',    'token in URL',              'shared_links table token validation; readonly snapshot only'],
    ['Cron jobs',                'CRON_SECRET bearer',        'Header check before any logic; service-role for writes'],
    ['Admin views',              'is_admin_org=true',         'Same RLS, but admins query across orgs via app-layer escalation'],
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
  s.addTable(rows as any, { x: 0.5, y: 1.25, w: 12.3, colW: [3.0, 2.6, 6.7], border: { pt: 0.5, color: DN.slateLight }, rowH: 0.55 })

  s.addText('All tables have RLS enabled (sql/032_enable_rls_everywhere.sql). Default-deny posture. Public read exceptions are explicit and named.', {
    x: 0.6, y: 6.4, w: 12.1, h: 0.4, fontSize: 11, fontFace: 'Arial', color: DN.navy, italic: true, align: 'center',
  })
}

// ── 7. AI Pipeline ─────────────────────────────────────────────────────────
function slideAIPipeline(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'AI Pipeline: One Router, Three Tiers, Every Call Logged', 'lib/ai.ts is the single LLM entry point. callAI() wraps every model invocation.')
  addFooter(s, pg)

  // Tier cards
  const tiers = [
    { name: 'fast',     model: 'claude-haiku-4-5-20251001', use: 'Real-time clarifiers, persona, intent, deflection',  cost: 'cheapest · max 350 tok',  color: DN.sarinaBlue },
    { name: 'standard', model: 'claude-sonnet-4-20250514',  use: 'Theme mining, town-hall pivots',                     cost: 'mid · max 4000 tok',      color: DN.teal },
    { name: 'advanced', model: 'claude-sonnet-4-6',         use: 'Reasoning-heavy report generation',                  cost: 'highest · max 3500 tok',  color: DN.hermesOrange },
  ]
  tiers.forEach((t, i) => {
    const x = 0.5 + i * 4.15
    s.addShape('rect', { x, y: 1.25, w: 4.0, h: 2.6, fill: { color: DN.slateCard }, rectRadius: 0.1 })
    s.addShape('rect', { x, y: 1.25, w: 4.0, h: 0.55, fill: { color: t.color }, rectRadius: 0.1 })
    s.addText(t.name.toUpperCase(), { x, y: 1.25, w: 4.0, h: 0.55, fontSize: 14, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle', charSpacing: 4 })
    s.addText(t.model, { x: x + 0.15, y: 1.95, w: 3.7, h: 0.35, fontSize: 11, fontFace: 'Arial', color: DN.navy, bold: true })
    s.addText(t.use, { x: x + 0.15, y: 2.35, w: 3.7, h: 0.85, fontSize: 11, fontFace: 'Arial', color: DN.ink, lineSpacing: 18 })
    s.addText(t.cost, { x: x + 0.15, y: 3.4, w: 3.7, h: 0.3, fontSize: 10, fontFace: 'Arial', color: DN.slate, italic: true })
  })

  // Bottom: every-call logged
  s.addShape('rect', { x: 0.5, y: 4.1, w: 12.3, h: 2.4, fill: { color: DN.navy }, rectRadius: 0.1 })
  s.addText('EVERY CALL LOGGED', { x: 0.7, y: 4.2, w: 12, h: 0.3, fontSize: 11, fontFace: 'Arial', color: DN.gold, bold: true, charSpacing: 4 })
  s.addText('callAI() wrapper writes to usage_logs:', { x: 0.7, y: 4.55, w: 12, h: 0.3, fontSize: 13, fontFace: 'Arial', color: DN.white, bold: true })
  s.addText('org_id  ·  resource_type  ·  resource_id  ·  event_type  ·  model  ·  provider  ·  tier  ·  input_tokens  ·  output_tokens  ·  cache_read_tokens  ·  cache_creation_tokens', {
    x: 0.7, y: 4.95, w: 12, h: 0.7, fontSize: 11, fontFace: 'Arial', color: DN.sarinaBlue, lineSpacing: 18,
  })
  s.addText('Prompt caching reduces per-call cost. cache_read_tokens are billed at the lower rate. Cost-per-org is reportable in real time via /admin/usage.', {
    x: 0.7, y: 5.85, w: 12, h: 0.55, fontSize: 11, fontFace: 'Arial', color: DN.white, italic: true,
  })
}

// ── 8. AI feature map ──────────────────────────────────────────────────────
function slideAIFeatureMap(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'AI Feature Map', 'Every AI capability has a named home in the codebase')
  addFooter(s, pg)

  const head = [
    { text: 'Capability',         options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
    { text: 'File',               options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
    { text: 'Tier',               options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
    { text: 'Purpose',            options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
  ]
  const data = [
    ['Clarifiers',          '/api/clarify',                       'fast',     'Adaptive follow-ups on vague survey responses'],
    ['Persona inference',   'lib/personaExtractor.ts',            'fast',     'Life stage, occupation, communication style — turns 2–4'],
    ['Intent detection',    'lib/opinionMining.ts',               'fast',     'donate / volunteer / event / custom intents'],
    ['Deflection',          'lib/deflect.ts · /api/deflect',      'fast',     'Off-topic and sensitive content routing'],
    ['Theme mining',        'lib/analyzeTheme.ts',                'standard', '4–7 themes, 8–15 keywords, AI-extracted'],
    ['PulseIQ topic AI',    '/api/cron/townhall-theme-detection', 'standard', 'Live theme suggestion + organic detection'],
    ['Agent review',        '/api/cron/bot-conversation-review',  'fast',     'Theme drift, knowledge gaps every 4 hr'],
    ['Knowledge retrieval', 'search_knowledge_semantic() (SQL)',  'embed',    'Hybrid: cosine 4× + tsv 2× + trigram blend'],
    ['Moderation',          'lib/moderation.ts (OpenAI)',         'embed',    'Harassment / hate / violence / sexual / self-harm / identity'],
    ['Report generation',   'lib/reportPlan.ts',                  'advanced', 'Tiered PPTX deck (Exec / Stakeholder / Full Team)'],
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
  s.addTable(rows as any, { x: 0.5, y: 1.25, w: 12.3, colW: [2.6, 3.6, 1.4, 4.7], border: { pt: 0.5, color: DN.slateLight }, rowH: 0.42 })
}

// ── 9. Embeddings + retrieval ─────────────────────────────────────────────
function slideRetrieval(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Hybrid Retrieval', 'Semantic + lexical + fuzzy in one SQL function')
  addFooter(s, pg)

  // Pipeline diagram
  const stages = [
    { label: 'Query',                 detail: 'User prompt or AI-expanded synonym set',                color: DN.sarinaBlue },
    { label: 'Embed',                 detail: 'OpenAI text-embedding-3-small · 1536d',                color: DN.teal },
    { label: 'Vector search',         detail: 'pgvector HNSW · cosine distance',                      color: DN.hermesOrange },
    { label: 'Full-text + trigram',   detail: 'tsvector + websearch_to_tsquery + pg_trgm similarity', color: DN.gold },
    { label: 'Blend & rank',          detail: 'cosine ×4 + tsv rank ×2 + trigram (top-K cutoff)',    color: DN.purple },
    { label: 'Return chunks',         detail: 'Top results → agent system prompt or analytics surface', color: DN.navy },
  ]
  stages.forEach((stage, i) => {
    const y = 1.3 + i * 0.85
    s.addShape('rect', { x: 0.5, y, w: 2.6, h: 0.7, fill: { color: stage.color }, rectRadius: 0.08 })
    s.addText(stage.label, { x: 0.5, y, w: 2.6, h: 0.7, fontSize: 14, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
    s.addShape('rect', { x: 3.2, y, w: 9.6, h: 0.7, fill: { color: DN.slateCard }, rectRadius: 0.08 })
    s.addText(stage.detail, { x: 3.4, y, w: 9.4, h: 0.7, fontSize: 12, fontFace: 'Arial', color: DN.ink, valign: 'middle' })
  })

  s.addText('Sub-10ms retrieval at scale. Falls back gracefully — if embedding API is down, lexical + trigram still serve.', {
    x: 0.5, y: 6.5, w: 12.3, h: 0.4, fontSize: 11, fontFace: 'Arial', color: DN.navy, italic: true, align: 'center',
  })
}

// ── 10. Multi-source ingestion ─────────────────────────────────────────────
function slideIngestion(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Multi-Source Ingestion', 'Seven sources. One pipeline. Idempotent and timeout-safe.')
  addFooter(s, pg)

  const head = [
    { text: 'Source',         options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
    { text: 'Mechanism',      options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
    { text: 'Cadence / Limit', options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
    { text: 'Idempotency',    options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
  ]
  const data = [
    ['Facebook + Instagram', 'Meta Graph v19 webhook + 15-min cron backstop', '15 min',                'comment_id unique constraint'],
    ['Google Reviews',       'DataForSEO 2-phase task queue',                  '6 hr · BATCH_SIZE=3',   'last_review_id + pending_task ID'],
    ['Reddit',               'Public JSON API (no auth)',                      '2 sec throttle · 100/page', 'thread_id + comment_id'],
    ['Substack',             'Public archive + comment endpoints',             '500 ms throttle',       'post_id + comment_id'],
    ['Regulations.gov',      'API v4 with key',                                '1 sec throttle · 1000/hr', 'document_id + comment_id'],
    ['CSV / XLSX upload',    'xlsx parse → batched INSERT',                    '500 rows / batch · 10MB body', 'optional row checksum'],
    ['Survey responses',     'Direct POST → /api/respond',                     'rate-limited per IP',    'response.guid'],
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
  s.addTable(rows as any, { x: 0.5, y: 1.25, w: 12.3, colW: [2.7, 4.0, 2.7, 2.9], border: { pt: 0.5, color: DN.slateLight }, rowH: 0.5 })

  s.addShape('rect', { x: 0.5, y: 6.0, w: 12.3, h: 0.7, fill: { color: DN.navy }, rectRadius: 0.08 })
  s.addText('All sources land in dataset_rows_flat or domain-specific tables — same downstream AI pipeline. One model. Any input.', {
    x: 0.5, y: 6.0, w: 12.3, h: 0.7, fontSize: 13, fontFace: 'Arial', color: DN.gold, bold: true, italic: true, align: 'center', valign: 'middle',
  })
}

// ── 11. Cron orchestration ─────────────────────────────────────────────────
function slideCron(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Cron Orchestration', 'Seven jobs. CRON_SECRET-gated. 45-second time budget on a 60-second timeout.')
  addFooter(s, pg)

  const head = [
    { text: 'Job',              options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
    { text: 'Cadence',          options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
    { text: 'Purpose',          options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 11 } },
  ]
  const data = [
    ['campaign-scheduler',         '15 min',  'Bulk email send + scheduled reminders'],
    ['review-sync',                '6 hr',    'Google Reviews fetch (DataForSEO 2-phase task)'],
    ['townhall-theme-detection',   '15 min',  'Live theme mining and pivot suggestions'],
    ['bot-conversation-review',    '4 hr',    'AI drift detection on agent sessions per bot.review_interval_hours'],
    ['social-sync',                '15 min',  'Facebook + Instagram comment ingestion + moderation'],
    ['social-token-refresh',       'Daily',   'Meta Graph long-lived OAuth token rotation'],
    ['cleanup-shared-links',       '03:00 UTC', 'Expire orphaned share tokens'],
  ]
  const rows = [head, ...data.map((r, ri) => r.map((c, ci) => ({
    text: c,
    options: {
      fontSize: 11, fontFace: 'Arial',
      color: ci === 0 ? DN.navy : DN.ink,
      bold: ci === 0,
      fill: { color: ri % 2 === 0 ? DN.slateCard : DN.white },
    },
  })))]
  s.addTable(rows as any, { x: 0.5, y: 1.25, w: 12.3, colW: [3.4, 2.0, 6.9], border: { pt: 0.5, color: DN.slateLight }, rowH: 0.5 })

  s.addText([
    bullet('Every cron handler bails at TIME_BUDGET_MS=45000 — never lets Vercel kill mid-write', { fontSize: 12 }),
    bullet('Per-invocation work limits (e.g., 5 agents per review pass, 3 concurrent review tasks) keep tail latency predictable', { fontSize: 12 }),
    bullet('Failures are logged to Sentry with cron job name; partial success is the default — next run picks up where this one stopped', { fontSize: 12 }),
  ], { x: 0.5, y: 5.4, w: 12.3, h: 1.7 })
}

// ── 12. Reporting pipeline ─────────────────────────────────────────────────
function slideReporting(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Reporting Pipeline', 'Server-rendered consulting decks. Generated, not authored.')
  addFooter(s, pg)
  s.addText([
    bullet('pptxgenjs 4.0 server-side renders branded PPTX — same code path as this deck'),
    bullet('Three tiers per dataset: Executive (~10 slides), Stakeholder (~25), Full Team (50+)'),
    bullet('AI selects representative quotes per theme; statistical significance labeled inline (p<.001, p<.01, p<.05)'),
    bullet('Slide spec → renderer pattern in lib/pptx/slideRenderer.ts: bar_chart · kpi_grid · table · bullets · quotes · two_column · entity_grid'),
    bullet('Plotly 2.35 powers the live interactive charts in /share/analytics with HTML-to-image snapshotting for embeds'),
    bullet('CSV / JSON / API exports for downstream BI; HTML interactive share links use signed tokens'),
  ], { x: 0.6, y: 1.25, w: 12.1, h: 4.5 })

  s.addShape('rect', { x: 0.5, y: 5.95, w: 12.3, h: 0.85, fill: { color: DN.navy }, rectRadius: 0.08 })
  s.addText('A typical legacy services workflow takes 2 weeks for a deck. The same deck on Sentimetrx is 2 hours of analyst review on top of an AI-generated draft.', {
    x: 0.5, y: 5.95, w: 12.3, h: 0.85, fontSize: 13, fontFace: 'Arial', color: DN.gold, italic: true, bold: true, align: 'center', valign: 'middle',
  })
}

// ── 13. Scalability ────────────────────────────────────────────────────────
function slideScalability(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Scalability Patterns', '500K rows. Sub-10ms vector search. Predictable tail latency.')
  addFooter(s, pg)

  const items = [
    { title: '500K-row datasets',  body: 'dataset_rows_flat denormalization · indexed by (dataset_id, row_index) · JSONB payload', color: DN.sarinaBlue },
    { title: 'Hybrid search',      body: 'HNSW vector + GIN tsvector + pg_trgm trigram · returns top-K in <10ms typical',         color: DN.teal },
    { title: 'AI re-ranking',      body: 'FTS top-100 → Claude semantic re-rank → deterministic sample for stable analytics',     color: DN.hermesOrange },
    { title: 'Batched ingestion',  body: '500-row INSERT batches · ROWS_PER_BATCH configurable · 10MB Server Action body limit',  color: DN.gold },
    { title: 'Cron time budget',   body: 'TIME_BUDGET_MS=45000 on a 60s Vercel timeout · partial success is the default',         color: DN.purple },
    { title: 'Concurrency caps',   body: 'BATCH_SIZE=3 concurrent task polls · per-invocation work limits keep tail bounded',     color: DN.navy },
  ]
  items.forEach((it, i) => {
    const col = i % 2, row = Math.floor(i / 2)
    const x = 0.5 + col * 6.3
    const y = 1.3 + row * 1.6
    s.addShape('rect', { x, y, w: 6.1, h: 1.45, fill: { color: DN.slateCard }, rectRadius: 0.08 })
    s.addShape('rect', { x, y, w: 0.15, h: 1.45, fill: { color: it.color } })
    s.addText(it.title, { x: x + 0.3, y: y + 0.1, w: 5.7, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.navy, bold: true })
    s.addText(it.body, { x: x + 0.3, y: y + 0.55, w: 5.7, h: 0.85, fontSize: 11, fontFace: 'Arial', color: DN.ink, lineSpacing: 18 })
  })
}

// ── 13.5 Bottlenecks & Bound Profile ──────────────────────────────────────
function slideBottlenecks(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Bottlenecks & Bound Profile', 'Where the limits live — per subsystem, plus where it would break first')
  addFooter(s, pg)

  const head = [
    { text: 'Subsystem',           options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 10 } },
    { text: 'Bound',               options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 10, align: 'center' } },
    { text: 'Dominant cost',       options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 10 } },
    { text: 'Degradation starts at', options: { fill: { color: DN.navy }, color: DN.white, bold: true, fontSize: 10 } },
  ]
  // bound type → color tag
  const bColor = (b: string) => b === 'IO' ? DN.sarinaBlue : b === 'CPU' ? DN.hermesOrange : DN.purple
  const bBg    = (b: string) => b === 'IO' ? 'E0F7FA'      : b === 'CPU' ? 'FEE7DC'        : 'EDE9FE'

  const data: [string, string, string, string][] = [
    ['Survey collection (Sarina)',    'IO',    'Anthropic Haiku round-trip (200–800 ms)',   'Provider rate limit · backoff to 503'],
    ['Agent chat (RAG)',              'IO',    'LLM + pgvector + Postgres lookup',          'Concurrent sessions > Postgres pool size'],
    ['PulseIQ live sessions',         'IO',    'Per-turn moderation + topic detection',     'Concurrent participants > ~50 (unverified)'],
    ['Theme mining (Ana)',            'IO',    'Sonnet inference over sampled rows',         'Token cost > per-org budget (logged, not enforced)'],
    ['Statistical engine',            'CPU',   'Bootstrap CIs · ANOVA · regression',        '60s function timeout on > ~50K rows'],
    ['PPTX generation (Ana export)',  'CPU',   'pptxgenjs in-memory assembly',              '60s timeout on Full-Team decks with 50+ slides'],
    ['Hybrid retrieval',              'IO',    'pgvector HNSW + tsvector GIN',              'Index size > Postgres shared_buffers'],
    ['Multi-source ingestion',        'IO',    'External API rate limits + paging',         '45s cron budget exhaustion'],
    ['File upload (CSV / XLSX)',      'Mixed', 'xlsx parse (CPU) + 500-row insert (IO)',    '10 MB body limit · 60s timeout on > ~500K rows'],
    ['Cold start',                    'IO',    'Vercel function spin-up + connection',      'First request after idle period (~100–300 ms)'],
  ]
  const rows = [head, ...data.map((r, ri) => [
    { text: r[0], options: { fontSize: 9.5, fontFace: 'Arial', color: DN.navy, bold: true, fill: { color: ri % 2 === 0 ? DN.slateCard : DN.white } } },
    { text: r[1], options: { fontSize: 9.5, fontFace: 'Arial', color: bColor(r[1]), bold: true, fill: { color: bBg(r[1]) }, align: 'center' } },
    { text: r[2], options: { fontSize: 9.5, fontFace: 'Arial', color: DN.ink, fill: { color: ri % 2 === 0 ? DN.slateCard : DN.white } } },
    { text: r[3], options: { fontSize: 9.5, fontFace: 'Arial', color: DN.ink, fill: { color: ri % 2 === 0 ? DN.slateCard : DN.white } } },
  ])]
  s.addTable(rows as any, { x: 0.5, y: 1.2, w: 12.3, colW: [3.3, 1.0, 4.0, 4.0], border: { pt: 0.5, color: DN.slateLight }, rowH: 0.34 })

  // System-level constraints
  s.addShape('rect', { x: 0.5, y: 5.4, w: 6.0, h: 1.7, fill: { color: DN.slateCard }, rectRadius: 0.08 })
  s.addText('SYSTEM-LEVEL CONSTRAINTS', { x: 0.7, y: 5.45, w: 5.7, h: 0.25, fontFace: 'Arial', fontSize: 9, color: DN.slate, bold: true, charSpacing: 1 })
  s.addText([
    bullet('Vercel function: 60s timeout · 45s code budget · 1024 MB default', { fontSize: 10 }),
    bullet('Supabase PgBouncer pool · bounded concurrent connections', { fontSize: 10 }),
    bullet('No Redis / KV layer · rate limit is per-instance in-memory', { fontSize: 10 }),
    bullet('LLM rate limits enforced per API key · backoff at provider', { fontSize: 10 }),
  ], { x: 0.7, y: 5.7, w: 5.7, h: 1.4 })

  // Where it would break first
  s.addShape('rect', { x: 6.8, y: 5.4, w: 6.0, h: 1.7, fill: { color: DN.navy }, rectRadius: 0.08 })
  s.addShape('rect', { x: 6.8, y: 5.4, w: 0.18, h: 1.7, fill: { color: DN.amber } })
  s.addText('WHERE IT WOULD BREAK FIRST', { x: 7.05, y: 5.45, w: 5.5, h: 0.25, fontFace: 'Arial', fontSize: 9, color: DN.amber, bold: true, charSpacing: 1 })
  s.addText([
    bullet('In-memory rate limiter under sustained attack (cold-start reset)', { fontSize: 10, color: DN.white }),
    bullet('Concurrent PulseIQ sessions above ~50 — untested', { fontSize: 10, color: DN.white }),
    bullet('Single PPTX export over 50K analytics rows', { fontSize: 10, color: DN.white }),
    bullet('Coincident cron + heavy upload on the same warm instance', { fontSize: 10, color: DN.white }),
  ], { x: 7.05, y: 5.7, w: 5.55, h: 1.4 })
}

// ── 14. Security ───────────────────────────────────────────────────────────
function slideSecurity(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Security Posture', 'Defense in depth. Boundaries that survive bugs.')
  addFooter(s, pg)
  s.addText([
    bullet('Auth: Supabase Auth with PKCE flow. /auth/callback handles code exchange, magic-link token_hash, and legacy hash fragments'),
    bullet('Secrets: All API keys in Vercel env vars (ANTHROPIC, OPENAI, SUPABASE_SERVICE_ROLE, CRON_SECRET, META_*, DATAFORSEO, REGULATIONS_GOV) — never in code'),
    bullet('Service-role key server-only — never reaches the browser. Reads use the auth client; service role for writes after explicit user check'),
    bullet('Row-Level Security on every table (sql/032_enable_rls_everywhere.sql) — default-deny posture, named exceptions only'),
    bullet('Input guardrails (lib/guardrails.ts): 14 regex patterns + 600-char cap. Output validation: length, question pattern, AI refusal detection'),
    bullet('OpenAI Moderation API on every public chat turn — harassment / hate / violence / sexual / self-harm / identity'),
    bullet('Rate limiting (lib/rateLimit.ts) per-IP buckets on public endpoints (/api/respond, /api/bot-chat, /api/clarify)'),
    bullet('PII: response IPs hashed (SHA-256) at rest. Email addresses in invites/users encrypted at rest by Supabase'),
  ], { x: 0.6, y: 1.25, w: 12.1, h: 5.7 })
}

// ── 15. Auditability ──────────────────────────────────────────────────────
function slideAuditability(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Auditability', 'Three audit trails. Real-time. Org-scoped.')
  addFooter(s, pg)

  const trails = [
    {
      name: 'usage_logs',
      tag: 'AI ACCOUNTING',
      color: DN.sarinaBlue,
      bullets: [
        'Every callAI() invocation writes a row',
        'Tracks input + output + cache_read + cache_creation tokens',
        '13 event types: chat, persona, deflect, theme_detect, ai_reply, report, …',
        'Cost computed from RATES table (lib/usageRates.ts)',
        'Org members see their own usage at /admin/usage',
      ],
    },
    {
      name: 'bot_conversation_reviews',
      tag: 'AI SELF-AUDIT',
      color: DN.teal,
      bullets: [
        'AI audits its own conversations every 4 hours (configurable)',
        'Detects theme drift (DRIFT: YES/NO), knowledge gaps, drop-off patterns',
        'Stores summary + boolean flags per agent per review window',
        'Driven by /api/cron/bot-conversation-review',
        'Surfaced in agent dashboard for human review',
      ],
    },
    {
      name: 'user_logins',
      tag: 'AUTH AUDIT',
      color: DN.hermesOrange,
      bullets: [
        'Every successful auth logged via logLogin()',
        'method (password / magic / sso / invite)',
        'IP, user_agent, org_id, created_at',
        'Admin-readable; supports anomaly detection',
        'Underpins the audit-framework (docs/AUDIT_FRAMEWORK.md)',
      ],
    },
  ]
  trails.forEach((t, i) => {
    const x = 0.5 + i * 4.15
    s.addShape('rect', { x, y: 1.25, w: 4.0, h: 5.5, fill: { color: DN.slateCard }, rectRadius: 0.1 })
    s.addShape('rect', { x, y: 1.25, w: 4.0, h: 0.45, fill: { color: t.color }, rectRadius: 0.1 })
    s.addText(t.tag, { x, y: 1.25, w: 4.0, h: 0.45, fontSize: 10, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle', charSpacing: 4 })
    s.addText(t.name, { x: x + 0.15, y: 1.85, w: 3.7, h: 0.4, fontSize: 14, fontFace: 'Arial', color: DN.navy, bold: true })
    s.addText(t.bullets.map(b => bullet(b, { fontSize: 11 })), { x: x + 0.15, y: 2.35, w: 3.7, h: 4.3 })
  })
}

// ── 16. Observability + FinOps ─────────────────────────────────────────────
function slideObservability(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Observability + AI FinOps', 'Errors, traces, and AI cost — all visible per org.')
  addFooter(s, pg)
  s.addText([
    bullet('Sentry @sentry/nextjs 10.51 — server, client, and edge configs · sourcemap upload · 0.1 trace sample rate'),
    bullet('instrumentation.ts wires server-side tracing (Next 14 hook). VERCEL_ENV tags errors by env'),
    bullet('Vercel build injects commit count + ISO timestamp into next.config.js → visible in errors and admin UI'),
    bullet('AI FinOps: usage_logs joined with lib/usageRates.ts → real-time cost per org / per resource / per tier'),
    bullet('Prompt caching cuts costs ~40–80% on repeated system prompts; cache_read_tokens vs cache_creation_tokens split visible in logs'),
    bullet('No third-party RUM beyond Sentry — no Datadog / Honeycomb today (roadmap: optional)'),
  ], { x: 0.6, y: 1.25, w: 12.1, h: 4.7 })

  s.addShape('rect', { x: 0.5, y: 6.05, w: 12.3, h: 0.75, fill: { color: DN.navy }, rectRadius: 0.08 })
  s.addText('Cost-per-org is a first-class metric. We can defend gross margin per acquired customer the day after migration.', {
    x: 0.5, y: 6.05, w: 12.3, h: 0.75, fontSize: 13, fontFace: 'Arial', color: DN.gold, italic: true, bold: true, align: 'center', valign: 'middle',
  })
}

// ── 17. Failure & DR ───────────────────────────────────────────────────────
function slideFailureDR(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Failure Modes + Data Integrity', 'Idempotent ingestion. Cascade-protected deletes. Supabase-managed backups.')
  addFooter(s, pg)
  s.addText([
    bullet('Backups: Supabase automated daily backups + point-in-time recovery on paid tiers (RPO ≈ minutes)'),
    bullet('Idempotency keys on every ingest source — comment_id, document_id, response.guid, pending_task ID'),
    bullet('Retry semantics: 60-second backoff on 429s, exponential on transient failures, partial success on cron'),
    bullet('Transactional writes: Supabase RPC functions (search_dataset_rows, archive_dataset) wrap multi-table mutations'),
    bullet('ON DELETE CASCADE on all foreign keys (users → responses, agents → conversations, datasets → rows) — no orphans'),
    bullet('Soft delete for datasets: archive_dataset() moves rows to archived_dataset_rows_flat (recoverable)'),
    bullet('Webhook + cron-backstop pattern: Meta sends a webhook AND we sweep every 15 min in case it failed'),
  ], { x: 0.6, y: 1.25, w: 12.1, h: 5.7 })
}

// ── 18. Compliance + remediation ───────────────────────────────────────────
function slideCompliance(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Compliance Posture & Honest Gaps', 'What\'s done. What\'s in flight. What we deferred and why.')
  addFooter(s, pg)

  const cols = [
    {
      tag: 'DONE',
      color: DN.green,
      items: [
        'PII hashing (response IP → SHA-256)',
        'Supabase data encryption at rest',
        'PKCE auth + session JWTs',
        'Service-role isolation (server only)',
        'Sentry error sanitization',
        'Content moderation on public surfaces',
      ],
    },
    {
      tag: 'IN FLIGHT',
      color: DN.amber,
      items: [
        'SOC 2 Type II audit (target: Phase 1)',
        'GDPR data export endpoint',
        'GDPR account deletion endpoint',
        'CORS policy formalization',
        'Mutation audit trail on critical tables',
        'Vercel KV for distributed rate limiting',
      ],
    },
    {
      tag: 'DEFERRED',
      color: DN.slate,
      items: [
        'HIPAA path (Phase 3 — healthcare wedge)',
        'WCAG 2.1 AA formal audit',
        'EU data residency (regional Postgres)',
        'BAA-eligible third-party providers',
        'Dedicated read replica for analytics',
      ],
    },
  ]
  cols.forEach((col, i) => {
    const x = 0.5 + i * 4.15
    s.addShape('rect', { x, y: 1.25, w: 4.0, h: 5.4, fill: { color: DN.slateCard }, rectRadius: 0.1 })
    s.addShape('rect', { x, y: 1.25, w: 4.0, h: 0.5, fill: { color: col.color }, rectRadius: 0.1 })
    s.addText(col.tag, { x, y: 1.25, w: 4.0, h: 0.5, fontSize: 13, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle', charSpacing: 4 })
    s.addText(col.items.map(it => bullet(it, { fontSize: 11 })), { x: x + 0.15, y: 1.85, w: 3.7, h: 4.7 })
  })
}

// ── 19. 12-month roadmap ───────────────────────────────────────────────────
function slideRoadmap(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, '12-Month Architecture Roadmap', 'What investment unlocks technically.')
  addFooter(s, pg)

  const items = [
    { q: 'Q1', items: 'Vercel KV for rate limiting · Mutation audit trail · GDPR export/delete endpoints',                color: DN.sarinaBlue },
    { q: 'Q2', items: 'SOC 2 Type II close-out · Vercel Workflows for durable ingestion · CORS policy formalized',         color: DN.teal },
    { q: 'Q3', items: 'AI Gateway for provider abstraction · regional residency option (EU) · dedicated analytics replica', color: DN.hermesOrange },
    { q: 'Q4', items: 'Open SDK (TS / Python) · partner API tier · BAA-eligible HIPAA path opt-in',                         color: DN.gold },
  ]
  items.forEach((it, i) => {
    const y = 1.3 + i * 1.3
    s.addShape('rect', { x: 0.5, y, w: 1.5, h: 1.15, fill: { color: it.color }, rectRadius: 0.08 })
    s.addText(it.q, { x: 0.5, y, w: 1.5, h: 1.15, fontSize: 36, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
    s.addShape('rect', { x: 2.1, y, w: 10.7, h: 1.15, fill: { color: DN.slateCard }, rectRadius: 0.08 })
    s.addText(it.items, { x: 2.3, y, w: 10.4, h: 1.15, fontSize: 13, fontFace: 'Arial', color: DN.ink, valign: 'middle' })
  })
}

// ── 20. The technical bet ──────────────────────────────────────────────────
function slideTheBet(pptx: any, pg: number) {
  const s = pptx.addSlide()
  s.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.navy } })
  s.addShape('rect', { x: 0, y: 0, w: W, h: 0.07, fill: { color: DN.gold } })
  s.addShape('ellipse', { x: W - 4, y: -1, w: 5, h: 5, fill: { color: DN.teal, transparency: 90 }, line: { width: 0 } })

  s.addText('The Technical Bet', { x: 0.8, y: 0.7, w: 11, h: 0.7, fontSize: 32, fontFace: 'Arial', color: DN.white, bold: true })
  s.addShape('rect', { x: 0.8, y: 1.45, w: 4.5, h: 0.04, fill: { color: DN.gold } })
  s.addText('Why this architecture out-runs the incumbents — and absorbs their customers in 90 days.', {
    x: 0.8, y: 1.6, w: 11, h: 0.6, fontSize: 16, fontFace: 'Arial', color: DN.sarinaBlue, italic: true,
  })

  const bets = [
    { n: '1', t: 'AI is the spine, not a feature.',         d: 'Every workflow has an LLM in the loop by design. Refactoring this in is a years-long replatform for incumbents.' },
    { n: '2', t: 'Multi-tenancy is a column, not a fork.',  d: 'org_id everywhere + RLS at the DB. Acquired customers move in with an INSERT, not an integration project.' },
    { n: '3', t: 'Cost is observable per org from day one.', d: 'usage_logs joins lib/usageRates.ts in real time. We defend gross margin on every acquired book.' },
    { n: '4', t: 'Audit is built, not bolted.',              d: 'AI self-audit (agent reviews) + auth audit + usage audit. SOC 2 Type II is a closure, not an excavation.' },
  ]
  bets.forEach((b, i) => {
    const y = 2.6 + i * 1.05
    s.addShape('ellipse', { x: 0.8, y, w: 0.7, h: 0.7, fill: { color: DN.gold } })
    s.addText(b.n, { x: 0.8, y, w: 0.7, h: 0.7, fontSize: 22, fontFace: 'Arial', color: DN.navy, bold: true, align: 'center', valign: 'middle' })
    s.addText(b.t, { x: 1.7, y, w: 11, h: 0.4, fontSize: 16, fontFace: 'Arial', color: DN.gold, bold: true, valign: 'middle' })
    s.addText(b.d, { x: 1.7, y: y + 0.4, w: 11, h: 0.55, fontSize: 12, fontFace: 'Arial', color: DN.white, italic: true, valign: 'middle' })
  })

  s.addShape('rect', { x: 0, y: H - 0.45, w: W, h: 0.45, fill: { color: DN.navyMid } })
  s.addText('Datanautix · datanautix.com · Confidential', {
    x: 0.6, y: H - 0.4, w: 12, h: 0.35, fontSize: 11, fontFace: 'Arial', color: DN.slate, valign: 'middle',
  })
}

// ── Deck assembler ─────────────────────────────────────────────────────────
function buildDeck(pptx: any) {
  let pg = 0
  addTitleSlide(pptx)
  pg = 1
  slideTLDR(pptx, ++pg)
  slidePlatformByNumbers(pptx, ++pg)
  slideStack(pptx, ++pg)
  slideSystemArch(pptx, ++pg)
  slideAICenter(pptx, ++pg)
  slideDataLayer(pptx, ++pg)
  slideMultiTenancy(pptx, ++pg)
  slideAuthZ(pptx, ++pg)
  slideAIPipeline(pptx, ++pg)
  slideAIFeatureMap(pptx, ++pg)
  slideRetrieval(pptx, ++pg)
  slideIngestion(pptx, ++pg)
  slideCron(pptx, ++pg)
  slideReporting(pptx, ++pg)
  slideScalability(pptx, ++pg)
  slideBottlenecks(pptx, ++pg)
  slideSecurity(pptx, ++pg)
  slideAuditability(pptx, ++pg)
  slideObservability(pptx, ++pg)
  slideFailureDR(pptx, ++pg)
  slideCompliance(pptx, ++pg)
  slideRoadmap(pptx, ++pg)
  slideTheBet(pptx, ++pg)
}

// ── Route handler ──────────────────────────────────────────────────────────
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  await logDeckDownload('architecture-deck')

  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Datanautix'
  pptx.company = 'Datanautix'
  pptx.title = 'Datanautix — Platform Architecture (Technical Diligence)'

  buildDeck(pptx)

  const buffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer
  const uint8 = new Uint8Array(buffer)

  return new NextResponse(uint8, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': 'attachment; filename="Datanautix-Platform-Architecture.pptx"',
    },
  })
}
