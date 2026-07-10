'use client'

// app/admin/decks/DecksClient.tsx
// Investor & strategy deck downloads — one-click PPTX generation.

import { useRouter } from 'next/navigation'
import { useState } from 'react'

const HERMES = '#E8632A'

type Deck = {
  href: string
  filename: string
  title: string
  subtitle: string
  audience: string
  slides: string
  accent: string
  badge: string
  /** Key used to look up last-downloaded timestamp from the server-side map. */
  logKey: string
}

const DECKS: Deck[] = [
  {
    href: '/api/nepa-comment-deck',
    filename: 'Datanautix-Blue-Mountains-NEPA.pptx',
    title: 'NEPA Comment Analysis — Forest Service (Blue Mountains)',
    subtitle: 'Capability briefing for the USDA Forest Service: turn the NEPA public-comment period into a real-time objection-risk read. Anchored to the live Blue Mountains Forest Plan Revision (Malheur · Umatilla · Wallowa-Whitman) — the 15-year effort withdrawn at the 2019 objection deadline, now re-opened for comment (Jul 2 – Sep 30, 2026). Front-facing info+concern-capture agent, semantic dedup + template-delta extraction, substantive-vs-form-letter classification, human-in-the-loop response generation, objection-risk/defensibility layer. Every load-bearing fact sourced; no invented counts.',
    audience: 'USDA Forest Service · NEPA planning / Region 6 decision team',
    slides: '12 slides',
    accent: '#2D6A4F',
    badge: 'GOV · NEPA',
    logKey: 'nepa-comment-deck',
  },
  {
    href: '/api/sales-pitch-deck?client=bareburger',
    filename: 'Bareburger-Sentimetrx-Capabilities.pptx',
    title: 'Sales Pitch Template — Restaurant (Bareburger sample)',
    subtitle: 'The standard client-pitch template. Universal spine (two ways to hear → why conversational → the advantage → the ask) + restaurant evidence modules (Stars & Dogs, dimensions/themes coin, food-safety early-warning) filled from Bareburger’s real reviews. Copy the config to start any new restaurant pitch.',
    audience: 'Prospective clients · first capability meeting',
    slides: '13 slides',
    accent: '#00B4D8',
    badge: 'TEMPLATE · RESTAURANT',
    logKey: 'sales-pitch-deck:bareburger',
  },
  {
    href: '/api/sales-pitch-deck?client=generic',
    filename: 'Sentimetrx-Capabilities.pptx',
    title: 'Sales Pitch Template — Generic (non-restaurant)',
    subtitle: 'Same template, restaurant modules omitted — the universal spine + a KPI grid, for membership / hospitality / SaaS / healthcare prospects. The non-restaurant starting point; swap in the client’s data and labels.',
    audience: 'Prospective clients · first capability meeting',
    slides: '~7 slides',
    accent: '#0F7173',
    badge: 'TEMPLATE · GENERIC',
    logKey: 'sales-pitch-deck:generic',
  },
  {
    href: '/api/pitch-deck',
    filename: 'Sentimetrx-Pitch-Deck.pptx',
    title: 'Sentimetrx Investor Pitch',
    subtitle: 'The original product-company narrative — AI-native conversational feedback platform. Editable PPTX. Opens with the “40 Years in the Making” founder-origin slide.',
    audience: 'Early-stage investors · seed / Series A',
    slides: '15 slides',
    accent: '#00B4D8',
    badge: 'PRODUCT',
    logKey: 'pitch-deck',
  },
  {
    href: '/api/pitch-deck-v3',
    filename: 'Sentimetrx-Anthology-Short.pdf',
    title: 'Sentimetrx — Anthology Fund (Short)',
    subtitle: 'YC-shaped SHORT deck — a 9-slide core (problem · what-we-do · the data-flywheel moat · why-now · market · traction · founder · ask) + a labeled appendix. Leads with the moat so “reliant on Claude” reads as “the model is rented; the data is the moat.”',
    audience: 'Early-stage investors · seed / Series A',
    slides: '9 core + appendix',
    accent: '#E85A1A',
    badge: 'PDF · SHORT',
    logKey: 'pitch-deck-v3',
  },
  {
    href: '/api/pitch-deck-v2',
    filename: 'Sentimetrx-Anthology-Fund.pdf',
    title: 'Sentimetrx — Anthology Fund (Full)',
    subtitle: 'Full 17-slide warm-editorial deck for the Menlo × Anthropic Anthology Fund — 40-year arc, incumbents-falling/AI-inflection, CXM market sizing, Claude-as-spine, restaurant vertical, traction, and the “why we fit Anthology” checklist. The detailed/leave-behind version.',
    audience: 'Early-stage investors · seed / Series A',
    slides: '17 slides',
    accent: '#0F7173',
    badge: 'PDF · FULL',
    logKey: 'pitch-deck-v2',
  },
  {
    href: '/api/rollup-deck?length=short',
    filename: 'Datanautix-Rollup-Pitch.pptx',
    title: 'Datanautix Roll-up — Short Pitch',
    subtitle: 'AI-native consolidation thesis. Hospitality wedge. The 30-min first conversation.',
    audience: 'Family offices · operator-LPs · independent-sponsor partners',
    slides: '12 slides',
    accent: '#0F7173',
    badge: 'ROLL-UP · SHORT',
    logKey: 'rollup-deck:short',
  },
  {
    href: '/api/rollup-deck?length=long',
    filename: 'Datanautix-Rollup-Diligence.pptx',
    title: 'Datanautix Roll-up — Diligence Deck',
    subtitle: 'Full investor diligence — market, target archetypes, integration playbook, portfolio model.',
    audience: 'Institutional PE · 60–90 min diligence meetings',
    slides: '27 slides',
    accent: '#E8B84B',
    badge: 'ROLL-UP · LONG',
    logKey: 'rollup-deck:long',
  },
  {
    href: '/api/project-insight-deck',
    filename: 'Project-Insight-Teaser.pptx',
    title: 'Project Insight — Teaser',
    subtitle: 'Tight 10-slide first-conversation teaser scoped to survey/feedback software. AI-as-interpretation framing, named illustrative pipeline, qualitative figures only. Overlaps the Datanautix Roll-up decks.',
    audience: 'PE partners · independent sponsors — first meeting',
    slides: '10 slides',
    accent: '#0F7173',
    badge: 'TEASER',
    logKey: 'project-insight-deck',
  },
  {
    href: '/api/architecture-deck',
    filename: 'Datanautix-Platform-Architecture.pptx',
    title: 'Platform Architecture',
    subtitle: 'Technical reference: stack, multi-tenancy, AI pipeline, security, audit, compliance, roadmap.',
    audience: 'Investor CTO · technical due-diligence advisor',
    slides: '22 slides',
    accent: '#0D2B45',
    badge: 'TECHNICAL',
    logKey: 'architecture-deck',
  },
  {
    href: '/api/engineering-reality-deck',
    filename: 'Datanautix-Engineering-Reality.pptx',
    title: 'Engineering Reality Check',
    subtitle: 'Honest peer-review deck — what is built, what discipline exists, what is missing, risk register, hardening plan. Positions a Claude-spined stack solving real, well-understood problems; funding shores up scalability + enterprise usability (roll-up = upside).',
    audience: 'Senior engineers · YC alums · prospective technical advisors',
    slides: '11 slides',
    accent: '#6D28D9',
    badge: 'PEER REVIEW',
    logKey: 'engineering-reality-deck',
  },
  {
    href: '/api/restaurant-expansion-deck?client=darden',
    filename: 'Datanautix-Restaurant-Expansion-Darden.pptx',
    title: 'Restaurant Expansion — Darden',
    subtitle: 'Customer expansion deck with Darden name injected on cover + footer. Wednesday 2026-05-13 meeting.',
    audience: 'Darden — current Ana client',
    slides: '15 slides',
    accent: '#E8632A',
    badge: 'DARDEN',
    logKey: 'restaurant-expansion-deck:darden',
  },
  {
    href: '/api/ea-membership-deck',
    filename: 'Sentimetrx-EA-Membership-Research.pptx',
    title: 'EA — Conversational Membership Research',
    subtitle: 'Sentimetrx-forward capability deck for the EA membership-survey meeting. Origin → the 40–50% “unusable open-ends” problem → conversational surveys → collection-tied analysis → why-now → proof → a tailored membership-study close. Tight 11 slides, editable PPTX. CUSTOMIZE: confirm program/perk names + contact before sending.',
    audience: 'EA — membership / insights team, first meeting',
    slides: '11 slides',
    accent: '#00B4D8',
    badge: 'EA',
    logKey: 'ea-membership-deck',
  },
  {
    href: '/api/ea-nps-pitch-deck',
    filename: 'Sentimetrx-EA-Beyond-The-Score.pptx',
    title: 'EA — Beyond the Score (NPS specific-emotion layer)',
    subtitle: 'Graddy-toned, augment-not-displace proposal to add a specific-emotion layer to EA’s summer NPS (audience = their internal customer-insights team, who own the survey + analysis). The moment (MVP Bundle vs closed-window MVP+) → the second signal beneath valence → the science (Zeelenberg & Pieters, 87.7%/900+) → captive-franchise reframe (regret = the membership already won them; disappointment = a fixable miss) → "Icing on the Cake" positioning (they keep instrument/insight/story, we add one layer) → behavioral map → real forum VoC → conversational mechanic → 3 cohorts (Already Sold / A Fixable Miss / Needs Clarity) → insight→roadmap (team = hero) → proof → with-your-team pilot. 14 slides, editable PPTX. CUSTOMIZE: confirm contact before sending.',
    audience: 'EA customer-insights team (Graddy walks us in) — weave-in, not displace',
    slides: '14 slides',
    accent: '#7C3AED',
    badge: 'EA · NPS',
    logKey: 'ea-nps-pitch-deck',
  },
  {
    href: '/api/community-feedback-deck',
    filename: 'Gathering-Community-Feedback.pdf',
    title: 'Gathering Community Feedback — A New Approach',
    subtitle: 'Public/community-engagement capability deck, built around the five questions every engagement lead must answer — representativeness, language access (Title VI/ADA), did-we-hear-enough, neutrality/accuracy, and showing the community you listened. One KB behind three channels (Sarina web · PulseIQ pre-meeting · Town Hall live). Includes a NOWOCATS proof slide.',
    audience: 'Public-sector / engineering & planning firms running community engagement',
    slides: '12 slides',
    accent: '#2A7A6F',
    badge: 'ENGAGEMENT · PDF',
    logKey: 'community-feedback-deck',
  },
  {
    href: '/api/pulseiq-deck',
    filename: 'PulseIQ-Community-Intelligence.pptx',
    title: 'PulseIQ — Community Intelligence',
    subtitle: 'Pitch for engineering consultants who run public engagement. Scenario-led: transmission siting, NEPA comment periods, industrial facility permitting.',
    audience: 'Senior partners at engineering / environmental consulting firms',
    slides: '9 slides',
    accent: '#0F7173',
    badge: 'PULSEIQ',
    logKey: 'pulseiq-deck',
  },
  {
    href: '/api/mco-listening-deck',
    filename: 'MCO-Listening-To-Your-Guests.pptx',
    title: 'MCO — Listening to Your Guests',
    subtitle: 'High-level teaser / leave-behind for Orlando International Airport. Recaps the 2015–2020 guest-experience engagement, lays out a world-class "listening" methodology, peer benchmarking, and the agentic MCO Concierge prototype. Appendix carries illustrative sample outputs (clearly labeled) built to swap with real review data.',
    audience: 'MCO / GOAA — guest-experience & small-business stakeholders, first meeting follow-up',
    slides: '14 slides + appendix',
    accent: '#EF8B1E',
    badge: 'MCO',
    logKey: 'mco-listening-deck',
  },
  {
    href: '/api/nowocats-approach-deck',
    filename: 'NOWOCATS-Engagement-Approach.pptx',
    title: 'NOWOCATS — PM-2 Engagement Approach',
    subtitle: 'Project-specific approach deck for VHB & Orange County Public Works. Pitches Sarina (the NOWOCATS Assistant) as the PM-2 digital companion, sourced entirely from public project materials.',
    audience: 'VHB partners · Orange County Transportation Planning Division',
    slides: '12 slides',
    accent: '#1E5BA8',
    badge: 'NOWOCATS',
    logKey: 'nowocats-approach-deck',
  },
  {
    href: '/api/restaurant-expansion-deck?client=bloomin',
    filename: "Datanautix-Restaurant-Expansion-BlominBrands.pptx",
    title: "Restaurant Expansion — Bloomin' Brands",
    subtitle: "Customer expansion deck with Bloomin' Brands name injected on cover + footer. Wednesday 2026-05-13 meeting.",
    audience: "Bloomin' Brands — current Ana client",
    slides: '15 slides',
    accent: '#E8632A',
    badge: "BLOOMIN' BRANDS",
    logKey: 'restaurant-expansion-deck:bloomin',
  },
  {
    href: '/api/review-intelligence-deck?mode=full',
    filename: 'Datanautix-Review-Intelligence-Full.pptx',
    title: 'Review Intelligence — Full Story',
    subtitle: 'The taxonomy classifier for Ruth’s Chris: 3-lens capability + vendor head-to-head (90.4% recall, 98.6% tagged, 20.8% TEST leak) + the critical-category audit (62% of vendor food-safety alerts are false alarms; ~99% pest precision).',
    audience: 'Ruth’s Chris / Darden — prospect pitch',
    slides: '9 slides',
    accent: '#0F7173',
    badge: 'RUTH’S CHRIS',
    logKey: 'review-intelligence-deck:full',
  },
  {
    href: '/api/review-intelligence-deck?mode=alerts',
    filename: 'Datanautix-Review-Intelligence-Alert-Quality.pptx',
    title: 'Review Intelligence — Alert Quality',
    subtitle: 'The punchy critical-category cut: 62% of the incumbent vendor’s food-safety alerts are false alarms, pests precision ~99%, “noisy vs clean alerts.” Drops into an existing conversation.',
    audience: 'Ops / CX leadership — risk framing',
    slides: '4 slides',
    accent: '#DC2626',
    badge: 'ALERTS',
    logKey: 'review-intelligence-deck:alerts',
  },
  {
    href: '/api/review-intelligence-deck?mode=capability',
    filename: 'Datanautix-Review-Intelligence-Capability.pptx',
    title: 'Review Intelligence — Capability',
    subtitle: 'Brand-neutral capability deck (no vendor/alert data) — classify · extract · understand + live in-app analytics. For a brand with no incumbent labels (e.g. Chuy’s).',
    audience: 'New brand — analytics manager demo',
    slides: '6 slides',
    accent: '#E8B84B',
    badge: 'CAPABILITY',
    logKey: 'review-intelligence-deck:capability',
  },
]

// ── Deck taxonomy ─────────────────────────────────────────────────────────────
// Grouped by audience so the list stays navigable as decks accumulate. Mapped by
// logKey (not a per-entry field) so adding a deck above doesn't force a touch
// here — an unmapped deck falls into 'client' and still renders.
type DeckCategory = 'investor' | 'technical' | 'client'

const CATEGORIES: { key: DeckCategory; label: string; accent: string }[] = [
  { key: 'investor',  label: 'Investor',              accent: '#00B4D8' },
  { key: 'technical', label: 'Technical & Diligence', accent: '#0D2B45' },
  { key: 'client',    label: 'Client & Prospect',     accent: '#E8632A' },
]

const CATEGORY_OF: Record<string, DeckCategory> = {
  'pitch-deck': 'investor',
  'pitch-deck-v2': 'investor',
  'pitch-deck-v3': 'investor',
  'rollup-deck:short': 'investor',
  'rollup-deck:long': 'investor',
  'project-insight-deck': 'investor',
  'architecture-deck': 'technical',
  'engineering-reality-deck': 'technical',
  'restaurant-expansion-deck:darden': 'client',
  'restaurant-expansion-deck:bloomin': 'client',
  'ea-membership-deck': 'client',
  'ea-nps-pitch-deck': 'client',
  'community-feedback-deck': 'client',
  'pulseiq-deck': 'client',
  'mco-listening-deck': 'client',
  'nowocats-approach-deck': 'client',
  'review-intelligence-deck:full': 'client',
  'review-intelligence-deck:alerts': 'client',
  'review-intelligence-deck:capability': 'client',
}
const catOf = (d: Deck): DeckCategory => CATEGORY_OF[d.logKey] ?? 'client'

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return ''
  if (ms < 60_000)       return 'just now'
  if (ms < 3_600_000)    return Math.floor(ms / 60_000) + 'm ago'
  if (ms < 86_400_000)   return Math.floor(ms / 3_600_000) + 'h ago'
  if (ms < 604_800_000)  return Math.floor(ms / 86_400_000) + 'd ago'
  return Math.floor(ms / 604_800_000) + 'w ago'
}

export default function DecksClient({
  lastDownloaded,
  lastUpdated,
  totalDownloads,
  tableStatus,
}: {
  lastDownloaded: Record<string, string>
  lastUpdated: Record<string, string | null>
  totalDownloads: number
  tableStatus: 'ok' | 'missing' | 'error'
}) {
  const router = useRouter()
  const [filter, setFilter] = useState<'all' | DeckCategory>('all')
  // Sort key: each deck's "last updated" (source file's last-commit time), so
  // the most recently reworked deck floats to the top of its group. Decks with
  // no known timestamp sort last.
  const recency = (logKey: string) => {
    const iso = lastUpdated[logKey]
    return iso ? new Date(iso).getTime() : 0
  }
  // After a download click, give the file a moment to start, then re-query
  // the server component so the "Last downloaded" timestamp updates.
  const onDownload = () => {
    setTimeout(() => router.refresh(), 1800)
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>Investor &amp; Client Presentations</h1>
        <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
          Server-generated PPTX / PDF, grouped by audience. Each deck rebuilds on every download — content updates immediately when the underlying route changes.
        </p>
      </div>

      <ActivityStrip totalDownloads={totalDownloads} tableStatus={tableStatus} />

      {/* Filter by audience */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 22, flexWrap: 'wrap' }}>
        {([['all', 'All', '#374151', DECKS.length] as const,
           ...CATEGORIES.map(c => [c.key, c.label, c.accent, DECKS.filter(d => catOf(d) === c.key).length] as const),
          ]).map(([key, label, accent, n]) => {
          const active = filter === key
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              style={{
                fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${active ? accent : '#e5e7eb'}`,
                background: active ? accent : 'white', color: active ? 'white' : '#4b5563',
              }}
            >
              {label} <span style={{ opacity: 0.7 }}>{n}</span>
            </button>
          )
        })}
      </div>

      {CATEGORIES.filter(c => filter === 'all' || c.key === filter).map(cat => {
        const decks = DECKS.filter(d => catOf(d) === cat.key)
          .sort((a, b) => recency(b.logKey) - recency(a.logKey))
        if (!decks.length) return null
        return (
          <section key={cat.key} style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: cat.accent }} />
              <h2 style={{ fontSize: 13, fontWeight: 700, color: '#111827', textTransform: 'uppercase', letterSpacing: 1.5 }}>{cat.label}</h2>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>{decks.length} {decks.length === 1 ? 'deck' : 'decks'}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {decks.map(deck => (
                <DeckCard
                  key={deck.href}
                  deck={deck}
                  lastDownloaded={lastDownloaded[deck.logKey]}
                  lastUpdated={lastUpdated[deck.logKey] ?? null}
                  onDownload={onDownload}
                />
              ))}
            </div>
          </section>
        )
      })}

      <div style={{ marginTop: 28, padding: '14px 18px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: HERMES, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 6 }}>
          Deployment note
        </div>
        <p style={{ fontSize: 12, color: '#7c2d12', margin: 0, lineHeight: 1.6 }}>
          New decks land on production after a <code style={{ background: 'white', padding: '2px 6px', borderRadius: 4, fontFamily: 'ui-monospace, monospace' }}>git push</code>.
          Until then, downloads work locally on the dev server only.
        </p>
      </div>
    </div>
  )
}

function ActivityStrip({ totalDownloads, tableStatus }: { totalDownloads: number; tableStatus: 'ok' | 'missing' | 'error' }) {
  if (tableStatus === 'missing') {
    return (
      <div style={{ marginBottom: 18, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12, color: '#991b1b' }}>
        <span style={{ fontWeight: 700 }}>Heads up:</span>{' '}
        the <code style={{ background: 'white', padding: '1px 5px', borderRadius: 3 }}>deck_download_log</code> table is not in this database. Run <code style={{ background: 'white', padding: '1px 5px', borderRadius: 3 }}>sql/040_deck_download_log.sql</code> in Supabase. Until then, "Last downloaded" cannot populate.
      </div>
    )
  }
  if (tableStatus === 'error') {
    return (
      <div style={{ marginBottom: 18, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12, color: '#991b1b' }}>
        Could not query the download log. Check Supabase service role key + RLS posture on <code style={{ background: 'white', padding: '1px 5px', borderRadius: 3 }}>deck_download_log</code>.
      </div>
    )
  }
  return (
    <div style={{ marginBottom: 18, padding: '8px 14px', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12, color: '#4b5563', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 9, fontWeight: 700, color: '#9ca3af', letterSpacing: 1.5, textTransform: 'uppercase' }}>Activity</span>
      <span style={{ color: '#9ca3af' }}>·</span>
      <span><b style={{ color: '#111827' }}>{totalDownloads.toLocaleString()}</b> {totalDownloads === 1 ? 'download' : 'downloads'} logged</span>
      <span style={{ color: '#9ca3af', marginLeft: 'auto', fontSize: 11, fontStyle: 'italic' }}>auto-refreshes after each download</span>
    </div>
  )
}

function DeckCard({
  deck,
  lastDownloaded,
  lastUpdated,
  onDownload,
}: {
  deck: Deck
  lastDownloaded?: string
  lastUpdated: string | null
  onDownload: () => void
}) {
  return (
    <div style={{
      background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden',
      display: 'flex', alignItems: 'stretch', boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
    }}>
      <div style={{ width: 6, background: deck.accent }} />
      <div style={{ flex: 1, padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 9, fontWeight: 700, color: 'white', background: deck.accent,
            padding: '3px 9px', borderRadius: 4, letterSpacing: 2, textTransform: 'uppercase',
          }}>{deck.badge}</span>
          <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500 }}>{deck.slides}</span>
        </div>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 4 }}>{deck.title}</h3>
          <p style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.5, margin: 0 }}>{deck.subtitle}</p>
        </div>
        <div style={{ fontSize: 11, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 600, color: '#374151' }}>Audience:</span>
          <span>{deck.audience}</span>
        </div>
        <div style={{ display: 'flex', gap: 18, fontSize: 11, color: '#6b7280', borderTop: '1px solid #f3f4f6', paddingTop: 8, marginTop: 2, flexWrap: 'wrap' }}>
          <div>
            <span style={{ fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, fontSize: 9, marginRight: 6 }}>Last updated</span>
            <span style={{ color: '#374151', fontWeight: 500 }}>{fmtDate(lastUpdated)}</span>
          </div>
          <div>
            <span style={{ fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1, fontSize: 9, marginRight: 6 }}>Last downloaded</span>
            <span style={{ color: lastDownloaded ? '#374151' : '#9ca3af', fontWeight: 500 }}>{fmtDate(lastDownloaded)}</span>
            {lastDownloaded && (
              <span style={{ color: '#9ca3af', marginLeft: 6 }}>· {timeAgo(lastDownloaded)}</span>
            )}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 18px' }}>
        <a
          href={deck.href}
          download={deck.filename}
          onClick={onDownload}
          style={{
            background: deck.accent, color: 'white', padding: '10px 18px', borderRadius: 8,
            fontSize: 13, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap',
            boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
          }}
        >
          Download .{deck.filename.split('.').pop()}
        </a>
      </div>
    </div>
  )
}
