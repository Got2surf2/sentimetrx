'use client'
// app/favorites/FavoritesClient.tsx
// Renders enriched favorites grouped by resource type. Each tile is a
// link to the resource's primary view. Empty state when the user has
// nothing starred.

import Link from 'next/link'

interface EnrichedFav {
  resource_type: 'bot' | 'study' | 'dataset' | 'campaign' | 'townhall_session'
  resource_id:   string
  name:          string
  subtitle?:     string
  href:          string
  ts:            string | null
  created_at:    string
}

interface Props {
  favorites: EnrichedFav[]
}

const HERMES = '#e8622a'

const TYPE_LABELS: Record<string, string> = {
  bot:              'Agents',
  study:            'Surveys',
  dataset:          'Datasets',
  campaign:         'Campaigns',
  townhall_session: 'PulseIQ',
}

const TYPE_ORDER: EnrichedFav['resource_type'][] = ['bot', 'study', 'dataset', 'campaign', 'townhall_session']

function relTime(ts: string | null): string {
  if (!ts) return ''
  const ms = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return mins + 'm ago'
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return hrs + 'h ago'
  const days = Math.floor(hrs / 24)
  if (days < 7) return days + 'd ago'
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function FavoritesClient({ favorites }: Props) {
  if (favorites.length === 0) {
    return (
      <div style={{ maxWidth: 720, margin: '64px auto', padding: '0 24px', textAlign: 'center' as const }}>
        <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.5 }}>★</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 8 }}>No favorites yet</h1>
        <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.5 }}>
          Click the ★ icon on any agent, survey, or dataset card to pin it here.
          Your favorites also appear at the top of <Link href="/m" style={{ color: HERMES, textDecoration: 'underline' }}>the mobile status page</Link>.
        </p>
      </div>
    )
  }

  const groups: Record<string, EnrichedFav[]> = {}
  for (const f of favorites) {
    if (!groups[f.resource_type]) groups[f.resource_type] = []
    groups[f.resource_type].push(f)
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>★ Favorites</h1>
        <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>{favorites.length} item{favorites.length === 1 ? '' : 's'} pinned across the platform.</p>
      </div>

      {TYPE_ORDER.filter(function(t) { return (groups[t] || []).length > 0 }).map(function(type) {
        const items = groups[type]
        return (
          <section key={type} style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: 0.4, marginBottom: 12 }}>
              {TYPE_LABELS[type]} ({items.length})
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {items.map(function(f) {
                return (
                  <Link key={f.resource_id} href={f.href}
                    style={{
                      display: 'block', textDecoration: 'none', color: 'inherit',
                      background: 'white', border: '1px solid #e5e7eb', borderRadius: 12,
                      padding: 14, transition: 'border-color 0.15s, box-shadow 0.15s',
                    }}
                    onMouseEnter={function(e) { (e.currentTarget as HTMLElement).style.borderColor = HERMES + '60'; (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 10px rgba(232,98,42,.08)' }}
                    onMouseLeave={function(e) { (e.currentTarget as HTMLElement).style.borderColor = '#e5e7eb'; (e.currentTarget as HTMLElement).style.boxShadow = '' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const, flex: 1 }}>{f.name}</div>
                      <div style={{ fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>{relTime(f.ts)}</div>
                    </div>
                    {f.subtitle && (
                      <div style={{ fontSize: 11, color: '#6b7280', overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const }}>{f.subtitle}</div>
                    )}
                  </Link>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
