// GET /api/restaurant-expansion-deck — customer-facing expansion deck for
// existing Ana clients in the restaurant industry. Warm tone, restaurant-
// specific examples, leads with what they already trust and walks them
// through Sarina / Agents / PulseIQ / Listening / Campaigns.

import { NextResponse, type NextRequest } from 'next/server'
import PptxGenJS from 'pptxgenjs'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { logDeckDownload } from '@/lib/auth/logDeckDownload'

export const dynamic = 'force-dynamic'

// Recognised ?client= values → display name + safe filename suffix.
const CLIENTS: Record<string, { name: string; slug: string }> = {
  darden:  { name: 'Darden',           slug: 'Darden' },
  bloomin: { name: "Bloomin' Brands",  slug: 'BlominBrands' },
}

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
  slide.addText('Datanautix · Restaurant Expansion · Confidential — for client discussion', {
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

// ── Cover ──────────────────────────────────────────────────────────────────
function addTitleSlide(pptx: any, clientName: string) {
  const s = pptx.addSlide()
  const buildDate = process.env.NEXT_PUBLIC_BUILD_DATE
  const lastUpdated = buildDate ? fmtDate(new Date(buildDate)) : fmtDate(new Date())
  const downloaded = fmtDate(new Date())

  s.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: DN.navy } })
  s.addShape('ellipse', { x: W - 4.5, y: -1.5, w: 5.5, h: 5.5, fill: { color: DN.teal, transparency: 88 }, line: { width: 0 } })
  s.addShape('ellipse', { x: W - 3.0, y: 0.5, w: 3.5, h: 3.5, fill: { color: DN.sarinaBlue, transparency: 92 }, line: { width: 0 } })
  s.addShape('rect', { x: 0, y: 0, w: W, h: 0.07, fill: { color: DN.gold } })

  s.addText('DATANAUTIX', { x: 0.8, y: 1.4, w: 11, h: 0.5, fontSize: 16, fontFace: 'Arial', color: DN.gold, bold: true, charSpacing: 2 })
  s.addText('Beyond Text Analytics', { x: 0.8, y: 2.1, w: 11, h: 0.9, fontSize: 42, fontFace: 'Arial', color: DN.white, bold: true })
  s.addText(`Closing the loop on guest feedback — for ${clientName}`, { x: 0.8, y: 3.05, w: 11, h: 0.7, fontSize: 24, fontFace: 'Arial', color: DN.sarinaBlue, italic: true })
  s.addShape('rect', { x: 0.8, y: 3.85, w: 4.5, h: 0.04, fill: { color: DN.gold } })
  s.addText('The Ana analytics you already trust — now connected to conversational collection, public-facing agents, live event feedback, and multi-source listening.', {
    x: 0.8, y: 4.05, w: 11, h: 1.1, fontSize: 15, fontFace: 'Arial', color: DN.white, lineSpacing: 24,
  })
  s.addText(`Prepared  ${downloaded}     ·     Last updated  ${lastUpdated}`, {
    x: 0.8, y: 5.5, w: 11, h: 0.35,
    fontSize: 11, fontFace: 'Arial', color: DN.slate, italic: true,
  })

  s.addShape('rect', { x: 0, y: H - 0.5, w: W, h: 0.5, fill: { color: DN.navyMid } })
  s.addText([
    { text: 'data', options: { color: DN.hermesOrange, bold: true, italic: true } },
    { text: 'nautix', options: { color: DN.sarinaBlue, bold: true, italic: true } },
    { text: `   ·   datanautix.com   ·   Prepared for ${clientName}   ·   Confidential`, options: { color: DN.slate } },
  ], { x: 0.6, y: H - 0.45, w: 12, h: 0.4, fontSize: 12, fontFace: 'Arial', valign: 'middle' })
}

// ── 1. Where We Started Together ──────────────────────────────────────────
function slideWhereWeStarted(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Where We Started Together', 'Ana — the text analytics engine you already use')
  addFooter(s, pg)
  s.addText([
    bullet('You have been using Ana to make sense of large volumes of open-ended guest feedback — survey verbatims, comment fields, follow-up notes.'),
    bullet('Ana mines themes, scores sentiment, surfaces drivers, runs significance testing, and exports executive-ready decks — all without manual coding.'),
    bullet('That work has not changed. The analytics engine, the theme model, the chart suite, the PPTX export — all of it stays exactly as you know it.'),
    bullet('What has changed is what feeds Ana. Over the last 9 weeks we have built five new modules that connect upstream collection and downstream outreach to the same analytics layer you already trust.'),
  ], { x: 0.6, y: 1.3, w: 12.1, h: 4.0 })

  s.addShape('rect', { x: 0.5, y: 5.6, w: 12.3, h: 1.3, fill: { color: DN.navy }, rectRadius: 0.1 })
  s.addShape('rect', { x: 0.5, y: 5.6, w: 0.18, h: 1.3, fill: { color: DN.gold } })
  s.addText('THE CORE IDEA', { x: 0.85, y: 5.7, w: 6, h: 0.3, fontSize: 11, fontFace: 'Arial', color: DN.gold, bold: true, charSpacing: 3 })
  s.addText('Your guest feedback story is no longer just analysis. It is collection → conversation → analysis → outreach — all in one platform, all flowing into the Ana you already know.', {
    x: 0.85, y: 6.0, w: 12.0, h: 0.85, fontSize: 13, fontFace: 'Arial', color: DN.white, italic: true, lineSpacing: 20,
  })
}

// ── 2. The Platform Today ──────────────────────────────────────────────────
function slidePlatformToday(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'The Platform Today', 'Six modules. One analytics engine. The full guest-feedback loop.')
  addFooter(s, pg)

  type Mod = { name: string; subtitle: string; status: 'have' | 'new'; desc: string; color: string }
  const mods: Mod[] = [
    { name: 'Ana',        subtitle: 'AI Text Analytics',           status: 'have', desc: 'What you have today. Themes, sentiment, statistical testing, consulting-grade decks.', color: DN.sarinaBlue },
    { name: 'Sarina',     subtitle: 'Conversational Surveys',      status: 'new',  desc: 'AI-driven guest surveys that probe weak responses in real time. ~10× the responses of email surveys.', color: DN.teal },
    { name: 'Agents',     subtitle: 'Public-Facing AI Agents',     status: 'new',  desc: 'Menu Q&A, dietary checks, reservation FAQs — trained on your menu, your policies, your brand voice.', color: DN.hermesOrange },
    { name: 'PulseIQ',    subtitle: 'Live Group Feedback',         status: 'new',  desc: 'Real-time sentiment across many concurrent conversations — chef tastings, new-menu launches, location openings.', color: DN.gold },
    { name: 'Listening',  subtitle: 'Multi-Source Ingestion',      status: 'new',  desc: 'Google Reviews, social, Reddit, regulatory feedback — all flowing into the same Ana theme model.', color: DN.purple },
    { name: 'Campaigns',  subtitle: 'Email + SMS Orchestration',   status: 'new',  desc: 'Trigger surveys after the visit, send loyalty re-engagement, follow up on service recovery — all measured.', color: DN.navy },
  ]
  mods.forEach((m, i) => {
    const col = i % 3, row = Math.floor(i / 3)
    const x = 0.45 + col * 4.13
    const y = 1.3 + row * 2.65
    s.addShape('rect', { x, y, w: 4.0, h: 2.5, fill: { color: DN.slateCard }, rectRadius: 0.1 })
    s.addShape('rect', { x, y, w: 4.0, h: 0.55, fill: { color: m.color }, rectRadius: 0.1 })
    s.addText(m.name, { x: x + 0.2, y, w: 2.4, h: 0.55, fontSize: 18, fontFace: 'Arial', color: DN.white, bold: true, valign: 'middle' })
    // status badge
    const badgeText = m.status === 'have' ? 'YOU HAVE' : 'NEW'
    const badgeBg = m.status === 'have' ? DN.gold : DN.white
    const badgeColor = m.status === 'have' ? DN.navy : m.color
    s.addShape('rect', { x: x + 2.7, y: y + 0.13, w: 1.1, h: 0.3, fill: { color: badgeBg }, rectRadius: 0.04 })
    s.addText(badgeText, { x: x + 2.7, y: y + 0.13, w: 1.1, h: 0.3, fontSize: 9, fontFace: 'Arial', color: badgeColor, bold: true, align: 'center', valign: 'middle', charSpacing: 2 })

    s.addText(m.subtitle, { x: x + 0.2, y: y + 0.7, w: 3.6, h: 0.3, fontSize: 11, fontFace: 'Arial', color: DN.slate, italic: true, autoFit: true })
    s.addText(m.desc, { x: x + 0.2, y: y + 1.05, w: 3.6, h: 1.35, fontSize: 11, fontFace: 'Arial', color: DN.ink, lineSpacing: 18, valign: 'top', autoFit: true })
  })
}

// ── 3. Why Now ─────────────────────────────────────────────────────────────
function slideWhyNow(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Why Now', 'Three things changed at once in restaurant guest feedback')
  addFooter(s, pg)

  const forces = [
    { n: '1', title: 'Response rates collapsed',           body: 'Post-visit email surveys hover in the single digits. Guests will not fill out forms. They will tell a person — or an AI — what happened.',  color: DN.sarinaBlue },
    { n: '2', title: 'Guest expectations rose',            body: 'Diners expect a brand that answers questions instantly — dietary, hours, dress code, parking, kid options. Host stands and call lines cannot scale to it.', color: DN.teal },
    { n: '3', title: 'AI made conversation viable',        body: 'For the first time, a survey can ask "what made the wait feel long?" in the moment instead of mining "it was OK" in a report a month later.',         color: DN.hermesOrange },
  ]
  forces.forEach((f, i) => {
    const y = 1.4 + i * 1.7
    s.addShape('ellipse', { x: 0.6, y: y + 0.1, w: 1.0, h: 1.0, fill: { color: f.color } })
    s.addText(f.n, { x: 0.6, y: y + 0.1, w: 1.0, h: 1.0, fontSize: 36, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
    s.addShape('rect', { x: 1.8, y, w: 11.0, h: 1.4, fill: { color: DN.slateCard }, rectRadius: 0.08 })
    s.addText(f.title, { x: 2.1, y: y + 0.1, w: 10.5, h: 0.45, fontSize: 16, fontFace: 'Arial', color: f.color, bold: true })
    s.addText(f.body, { x: 2.1, y: y + 0.55, w: 10.5, h: 0.85, fontSize: 12, fontFace: 'Arial', color: DN.ink, lineSpacing: 18, autoFit: true })
  })
  s.addText('You already have the analytics. What you have been missing is a way to ask better questions at the moment of experience — and a way to engage guests between visits without bolting on three more vendors.', {
    x: 0.6, y: 6.55, w: 12.1, h: 0.5, fontSize: 12, fontFace: 'Arial', color: DN.navy, italic: true, bold: true, align: 'center',
  })
}

// ── 4. Sarina for Restaurants ─────────────────────────────────────────────
function slideSarina(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Sarina — Conversational Surveys', 'AI-driven guest surveys built for restaurants')
  addFooter(s, pg)

  s.addText([
    bullet('In-venue or post-visit. QR on the receipt, NFC tap at the host stand, email link 30 minutes after the table closes — whatever fits the moment.'),
    bullet('AI clarifiers turn weak answers into actionable detail. "It was fine" gets a follow-up. "The wait was too long" gets "how long, and what did you think the wait was for?"'),
    bullet('Restaurant-aware question banks — service, food quality, atmosphere, value, server name capture, dish-level feedback, wait-time root cause.'),
    bullet('Multi-language out of the box. Guests respond in Spanish, Mandarin, Portuguese — we translate the analysis layer back so your team reads one report.'),
    bullet('Service-recovery loop: a low score or named complaint can auto-trigger a follow-up survey 48 hours later — closing the loop without manual flagging.'),
    bullet('Every Sarina response lands in the same Ana dataset you already use. Same theme model. Same charts. No new dashboard to learn.'),
  ], { x: 0.6, y: 1.3, w: 12.1, h: 4.7 })

  s.addShape('rect', { x: 0.5, y: 6.1, w: 12.3, h: 0.85, fill: { color: DN.navy }, rectRadius: 0.08 })
  s.addShape('rect', { x: 0.5, y: 6.1, w: 0.15, h: 0.85, fill: { color: DN.gold } })
  s.addText('Validated', { x: 0.8, y: 6.15, w: 4, h: 0.3, fontSize: 10, fontFace: 'Arial', color: DN.gold, bold: true, charSpacing: 3 })
  s.addText('JW Marriott and other hospitality clients: ~10× more responses than post-stay email surveys, with the actionable detail showing up in hours, not weeks.', {
    x: 0.8, y: 6.4, w: 12.0, h: 0.5, fontSize: 12, fontFace: 'Arial', color: DN.white, italic: true,
  })
}

// ── 5. Agents for Restaurants ─────────────────────────────────────────────
function slideAgents(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Agents — Public-Facing AI Conversations', 'Trained on your menu, your policies, your brand voice')
  addFooter(s, pg)

  const useCases = [
    { name: 'Menu & Dietary',  desc: 'Allergens · vegan / vegetarian · gluten-free · kids menu · ingredient sourcing · seasonal availability', color: DN.sarinaBlue },
    { name: 'Reservation FAQ', desc: 'Dress code · parking · accessibility · large parties · holiday hours · pet policy · cancellation rules',   color: DN.teal },
    { name: 'Catering & Events', desc: 'Off-site catering pricing · private dining minimums · seasonal menu options · custom requests',          color: DN.hermesOrange },
    { name: 'Wine & Pairing',  desc: 'Trained on your wine list and chef pairings · price-anchored suggestions · vintage availability',          color: DN.gold },
    { name: 'Loyalty + Rewards', desc: 'Program tier explanations · point lookups · benefits · upcoming offers · birthday rewards',              color: DN.purple },
    { name: 'Service Recovery', desc: 'Acknowledges complaints · routes to manager · captures details for follow-up · sets recovery expectations', color: DN.navy },
  ]
  useCases.forEach((uc, i) => {
    const col = i % 2, row = Math.floor(i / 2)
    const x = 0.5 + col * 6.2
    const y = 1.3 + row * 1.5
    s.addShape('rect', { x, y, w: 6.05, h: 1.35, fill: { color: DN.slateCard }, rectRadius: 0.08 })
    s.addShape('rect', { x, y, w: 0.15, h: 1.35, fill: { color: uc.color } })
    s.addText(uc.name, { x: x + 0.3, y: y + 0.1, w: 5.6, h: 0.35, fontSize: 14, fontFace: 'Arial', color: DN.navy, bold: true })
    s.addText(uc.desc, { x: x + 0.3, y: y + 0.5, w: 5.6, h: 0.8, fontSize: 11, fontFace: 'Arial', color: DN.ink, lineSpacing: 16, autoFit: true })
  })

  s.addText('Every conversation is captured. Themes and sentiment land in Ana — so you learn what guests are asking your brand, not just what they are saying about it.', {
    x: 0.6, y: 5.9, w: 12.1, h: 0.4, fontSize: 11, fontFace: 'Arial', color: DN.navy, italic: true, bold: true, align: 'center',
  })

  s.addShape('rect', { x: 0.5, y: 6.4, w: 12.3, h: 0.55, fill: { color: DN.navy }, rectRadius: 0.08 })
  s.addText('SAFETY · Off-topic deflection · 3-strike profanity rules · sensitive-topic avoidance · always stays in your brand voice', {
    x: 0.5, y: 6.4, w: 12.3, h: 0.55, fontSize: 11, fontFace: 'Arial', color: DN.gold, italic: true, bold: true, align: 'center', valign: 'middle',
  })
}

// ── 6. PulseIQ for Restaurants ─────────────────────────────────────────────
function slidePulseIQ(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'PulseIQ — Live Group Feedback', 'Real-time sentiment across many concurrent conversations')
  addFooter(s, pg)

  s.addText([
    bullet('Run an AI-moderated feedback session live — with dozens or hundreds of participants in their own one-on-one conversations.'),
    bullet('Themes emerge in real time as people talk. A facilitator dashboard shows what is trending, what topics are dropping off, where sentiment is shifting.'),
    bullet('Restaurant moments where this lands: new menu launches, chef tasting events, location opening week, staff training feedback, brand activations, franchise advisory boards.'),
    bullet('Curt or off-topic responses are detected and redirected without a human moderator stepping in. Sensitive topics can be blocked or auto-deflected.'),
    bullet('Projectable live screen for ballrooms or training rooms — themes scroll across the screen as guests are still talking.'),
    bullet('Session output flows into Ana like any other dataset — a single dataset for the event, ready for the post-event readout.'),
  ], { x: 0.6, y: 1.3, w: 12.1, h: 5.0 })

  s.addShape('rect', { x: 0.5, y: 6.4, w: 12.3, h: 0.55, fill: { color: DN.navy }, rectRadius: 0.08 })
  s.addText('What used to take a focus group and a 3-week readout now happens during the event, with the executive summary on the screen by close.', {
    x: 0.5, y: 6.4, w: 12.3, h: 0.55, fontSize: 12, fontFace: 'Arial', color: DN.gold, italic: true, bold: true, align: 'center', valign: 'middle',
  })
}

// ── 7. Listening ───────────────────────────────────────────────────────────
function slideListening(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Listening — Multi-Source Ingestion', 'Every channel guests are already talking on, in one pipeline')
  addFooter(s, pg)

  const sources = [
    { name: 'Google Reviews',     detail: 'Continuous sync across all locations · 6-hour cadence · new reviews land in Ana same day' },
    { name: 'Social (Facebook + Instagram)', detail: 'Page comments, post-level engagement, named-mention triggering' },
    { name: 'Reddit',             detail: 'City-specific food subreddits · food-critic communities · launch-week chatter' },
    { name: 'Internal CRM / tickets', detail: 'Service-recovery cases, manager-level escalations, named complaint history' },
    { name: 'Survey verbatims',   detail: 'Sarina + any legacy survey tool you keep running' },
    { name: 'CSV / XLSX upload',  detail: 'One-off datasets — mystery shopper reports, internal audits, focus group transcripts' },
  ]
  sources.forEach((src, i) => {
    const col = i % 2, row = Math.floor(i / 2)
    const x = 0.5 + col * 6.2
    const y = 1.3 + row * 1.35
    s.addShape('rect', { x, y, w: 6.05, h: 1.2, fill: { color: DN.slateCard }, rectRadius: 0.08 })
    s.addShape('rect', { x, y, w: 0.15, h: 1.2, fill: { color: DN.sarinaBlue } })
    s.addText(src.name, { x: x + 0.3, y: y + 0.1, w: 5.6, h: 0.35, fontSize: 14, fontFace: 'Arial', color: DN.navy, bold: true })
    s.addText(src.detail, { x: x + 0.3, y: y + 0.5, w: 5.6, h: 0.65, fontSize: 11, fontFace: 'Arial', color: DN.ink, lineSpacing: 16, autoFit: true })
  })

  s.addShape('rect', { x: 0.5, y: 5.85, w: 12.3, h: 1.1, fill: { color: DN.navy }, rectRadius: 0.08 })
  s.addShape('rect', { x: 0.5, y: 5.85, w: 0.18, h: 1.1, fill: { color: DN.gold } })
  s.addText('THE PAYOFF', { x: 0.85, y: 5.95, w: 4, h: 0.3, fontSize: 10, fontFace: 'Arial', color: DN.gold, bold: true, charSpacing: 3 })
  s.addText('Every channel feeds the same theme model. When a "long wait" theme spikes in Google Reviews, you see it on the same dashboard where Sarina surveys at that location already show it — and you have the granularity to act before it spreads.', {
    x: 0.85, y: 6.2, w: 12.0, h: 0.7, fontSize: 12, fontFace: 'Arial', color: DN.white, italic: true, lineSpacing: 18,
  })
}

// ── 8. Campaigns ───────────────────────────────────────────────────────────
function slideCampaigns(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Campaigns — Email + SMS Outreach', 'Close the loop from the same platform that captured the feedback')
  addFooter(s, pg)
  s.addText([
    bullet('Post-visit surveys with auto-reminders (72-hour, 7-day) for non-responders — without bolting on Mailchimp or HubSpot.'),
    bullet('Loyalty re-engagement: a guest who has not visited in 60 days gets a personalized message that references their last visit details.'),
    bullet('Service-recovery follow-up: a complaint or low-score guest gets a manager-signed apology with a recovery offer — measured end-to-end.'),
    bullet('Event invites + post-event surveys: chef tasting RSVPs, new-menu launches, private dining invitations — all tracked in Ana.'),
    bullet('Multi-provider — Resend, SendGrid, AWS SES, SMTP, Twilio SMS. Whichever fits your existing deliverability setup.'),
    bullet('Webhook tracking on opens, clicks, bounces — feeding the same dashboard so you measure what works.'),
  ], { x: 0.6, y: 1.3, w: 12.1, h: 4.8 })

  s.addText('The collection layer and the outreach layer share the same dataset. You stop guessing which campaign moved which theme.', {
    x: 0.6, y: 6.4, w: 12.1, h: 0.5, fontSize: 12, fontFace: 'Arial', color: DN.navy, italic: true, bold: true, align: 'center',
  })
}

// ── 9. It All Rolls Into Ana ──────────────────────────────────────────────
function slideItAllRollsIntoAna(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'It All Rolls Into Ana', 'One analytics engine — the one you already know')
  addFooter(s, pg)

  // Funnel / flow diagram
  const sources = [
    { label: 'Sarina\n(in-venue surveys)',   color: DN.teal },
    { label: 'Agents\n(public AI chats)',    color: DN.hermesOrange },
    { label: 'PulseIQ\n(live event sessions)', color: DN.gold },
    { label: 'Listening\n(reviews / social / Reddit)', color: DN.purple },
    { label: 'Campaigns\n(email + SMS replies)', color: DN.navy },
  ]
  sources.forEach((src, i) => {
    const x = 0.5 + i * 2.55
    const y = 1.4
    s.addShape('rect', { x, y, w: 2.4, h: 1.6, fill: { color: src.color }, rectRadius: 0.08 })
    s.addText(src.label, { x: x + 0.1, y, w: 2.2, h: 1.6, fontSize: 12, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle', autoFit: true })
  })

  // Arrows
  s.addText('↓   ↓   ↓   ↓   ↓', {
    x: 0.5, y: 3.2, w: 12.3, h: 0.4, fontSize: 22, fontFace: 'Arial', color: DN.slate, align: 'center',
  })

  // Ana box (centered, big)
  s.addShape('rect', { x: 3.0, y: 3.7, w: 7.3, h: 1.5, fill: { color: DN.sarinaBlue }, rectRadius: 0.12, line: { color: DN.gold, width: 3 } })
  s.addText('Ana — AI Text Analytics', { x: 3.0, y: 3.8, w: 7.3, h: 0.5, fontSize: 22, fontFace: 'Arial', color: DN.white, bold: true, align: 'center' })
  s.addText('Themes · sentiment · cross-tab · significance testing · executive PPTX', {
    x: 3.0, y: 4.35, w: 7.3, h: 0.4, fontSize: 12, fontFace: 'Arial', color: DN.white, italic: true, align: 'center',
  })
  s.addText('The same Ana you already use — no new dashboard, no migration', {
    x: 3.0, y: 4.75, w: 7.3, h: 0.4, fontSize: 11, fontFace: 'Arial', color: DN.gold, bold: true, align: 'center',
  })

  // Bottom payoff
  s.addShape('rect', { x: 0.5, y: 5.7, w: 12.3, h: 1.3, fill: { color: DN.slateCard }, rectRadius: 0.08 })
  s.addText('What this means in practice', { x: 0.7, y: 5.8, w: 12, h: 0.4, fontSize: 13, fontFace: 'Arial', color: DN.navy, bold: true })
  s.addText('A single "long wait" theme is now visible on one dashboard — whether it surfaced in a post-visit Sarina survey, an Agent conversation, a Google Review, or a Reddit post. Cross-channel patterns become visible immediately. Cross-location benchmarking happens without manually stitching exports.', {
    x: 0.7, y: 6.15, w: 12, h: 0.8, fontSize: 11, fontFace: 'Arial', color: DN.ink, lineSpacing: 16, autoFit: true,
  })
}

// ── 10. Proposed Pilot + Next Steps ───────────────────────────────────────
function slidePilot(pptx: any, pg: number) {
  const s = pptx.addSlide()
  addHeader(s, 'Proposed Pilot', '90 days · 5–10 locations · the full loop, no commitment beyond the pilot')
  addFooter(s, pg)

  const phases = [
    { week: 'Weeks 1–2', focus: 'Setup', body: 'Configure 5–10 pilot locations · Sarina question bank tuned to your brand · agent trained on current menu and policies · Google Reviews sync turned on for the pilot footprint' },
    { week: 'Weeks 3–8', focus: 'Run',   body: 'Live collection across surveys, agents, and listening · weekly Ana readouts to your team · campaign follow-ups on low-score visits · one live PulseIQ session (chef tasting or staff training) as a showcase' },
    { week: 'Weeks 9–12', focus: 'Decide', body: 'Side-by-side comparison: response rate, theme depth, time-to-insight, and recovery rate vs your current process · joint decision on full rollout footprint' },
  ]
  phases.forEach((p, i) => {
    const y = 1.3 + i * 1.5
    s.addShape('rect', { x: 0.5, y, w: 2.0, h: 1.35, fill: { color: DN.sarinaBlue }, rectRadius: 0.08 })
    s.addText(p.week, { x: 0.5, y: y + 0.15, w: 2.0, h: 0.4, fontSize: 12, fontFace: 'Arial', color: DN.white, italic: true, align: 'center' })
    s.addText(p.focus, { x: 0.5, y: y + 0.55, w: 2.0, h: 0.5, fontSize: 20, fontFace: 'Arial', color: DN.white, bold: true, align: 'center', valign: 'middle' })
    s.addShape('rect', { x: 2.6, y, w: 10.2, h: 1.35, fill: { color: DN.slateCard }, rectRadius: 0.08 })
    s.addText(p.body, { x: 2.8, y, w: 9.95, h: 1.35, fontSize: 12, fontFace: 'Arial', color: DN.ink, valign: 'middle', lineSpacing: 18, autoFit: true })
  })

  // Next steps callout
  s.addShape('rect', { x: 0.5, y: 6.0, w: 12.3, h: 0.95, fill: { color: DN.navy }, rectRadius: 0.08 })
  s.addShape('rect', { x: 0.5, y: 6.0, w: 0.18, h: 0.95, fill: { color: DN.gold } })
  s.addText('NEXT STEPS', { x: 0.85, y: 6.1, w: 6, h: 0.3, fontSize: 11, fontFace: 'Arial', color: DN.gold, bold: true, charSpacing: 3 })
  s.addText('Pick 5–10 pilot locations · share current menu, policies, and a representative dataset · we stand up the pilot in 2 weeks · your team sees results inside 3.', {
    x: 0.85, y: 6.35, w: 12.0, h: 0.6, fontSize: 13, fontFace: 'Arial', color: DN.white, valign: 'middle', autoFit: true,
  })
}

// ── Deck assembler ─────────────────────────────────────────────────────────
function buildDeck(pptx: any, clientName: string) {
  let pg = 0
  addTitleSlide(pptx, clientName)
  pg = 1
  slideWhereWeStarted(pptx, ++pg)
  slidePlatformToday(pptx, ++pg)
  slideWhyNow(pptx, ++pg)
  slideSarina(pptx, ++pg)
  slideAgents(pptx, ++pg)
  slidePulseIQ(pptx, ++pg)
  slideListening(pptx, ++pg)
  slideCampaigns(pptx, ++pg)
  slideItAllRollsIntoAna(pptx, ++pg)
  slidePilot(pptx, ++pg)
}

// ── Route handler ──────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const url = new URL(req.url)
  const clientParam = (url.searchParams.get('client') || '').toLowerCase()
  const client = CLIENTS[clientParam] ?? { name: '[CLIENT NAME]', slug: 'Generic' }
  await logDeckDownload('restaurant-expansion-deck', clientParam || 'generic')

  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Datanautix'
  pptx.company = 'Datanautix'
  pptx.title = `Datanautix — Restaurant Expansion · ${client.name}`

  buildDeck(pptx, client.name)

  const buffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer
  const uint8 = new Uint8Array(buffer)

  return new NextResponse(uint8, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="Datanautix-Restaurant-Expansion-${client.slug}.pptx"`,
    },
  })
}
