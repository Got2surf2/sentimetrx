'use client'

// app/admin/decks/DecksClient.tsx
// Investor & strategy deck downloads — one-click PPTX generation.

import { useRouter } from 'next/navigation'

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
    href: '/api/pitch-deck',
    filename: 'Sentimetrx-Pitch-Deck.pptx',
    title: 'Sentimetrx Investor Pitch',
    subtitle: 'The original product-company narrative — AI-native conversational feedback platform.',
    audience: 'Early-stage investors · seed / Series A',
    slides: '14 slides',
    accent: '#00B4D8',
    badge: 'PRODUCT',
    logKey: 'pitch-deck',
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
    subtitle: 'Honest peer-review deck — what is built, what discipline exists, what is missing, risk register, hardening plan.',
    audience: 'Senior engineers · YC alums · prospective technical advisors',
    slides: '10 slides',
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
]

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
          Server-generated PPTX. Each deck rebuilds on every download — content updates immediately when the underlying route changes.
        </p>
      </div>

      <ActivityStrip totalDownloads={totalDownloads} tableStatus={tableStatus} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {DECKS.map(deck => (
          <DeckCard
            key={deck.href}
            deck={deck}
            lastDownloaded={lastDownloaded[deck.logKey]}
            lastUpdated={lastUpdated[deck.logKey] ?? null}
            onDownload={onDownload}
          />
        ))}
      </div>

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
          Download .pptx
        </a>
      </div>
    </div>
  )
}
