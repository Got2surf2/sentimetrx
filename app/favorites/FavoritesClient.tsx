'use client'
// app/favorites/FavoritesClient.tsx
// Cross-resource favorites page using a unified rich card. Each type renders
// the same shape (color strip, type badge, name, key stat, meta row, last-
// touched timestamp) so the page reads as one coherent collection instead
// of five mini-list-pages stitched together. Click anywhere on a card →
// open the resource's primary view (handled by parent <Link>).

import Link from 'next/link'

interface EnrichedFav {
  resource_type: 'bot' | 'study' | 'dataset' | 'campaign' | 'townhall_session'
  resource_id:   string
  name:          string
  subtitle?:     string
  href:          string
  ts:            string | null
  created_at:    string
  raw:           Record<string, any>
}

interface Props {
  favorites: EnrichedFav[]
}

const HERMES = '#e8622a'

// Per-type visual identity (color strip + badge text + icon).
const TYPE_META: Record<EnrichedFav['resource_type'], { label: string; icon: string; color: string }> = {
  bot:              { label: 'Agent',    icon: '🤖', color: '#00b4d8' },
  study:            { label: 'Survey',   icon: '📝', color: '#e8622a' },
  dataset:          { label: 'Dataset',  icon: '📊', color: '#0ea5e9' },
  campaign:         { label: 'Campaign', icon: '✉',  color: '#6366f1' },
  townhall_session: { label: 'PulseIQ',  icon: '💬', color: '#8b5cf6' },
}

const TYPE_LABELS: Record<EnrichedFav['resource_type'], string> = {
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

// Per-type "key stat" — the one number the user cares about at a glance.
function keyStat(f: EnrichedFav): { value: string; label: string } | null {
  const r = f.raw
  switch (f.resource_type) {
    case 'bot':
      return { value: (r.conversation_count || 0).toLocaleString(), label: r.conversation_count === 1 ? 'conversation' : 'conversations' }
    case 'study':
      return { value: (r.response_count || 0).toLocaleString(), label: r.response_count === 1 ? 'response' : 'responses' }
    case 'dataset':
      return r.row_count ? { value: r.row_count.toLocaleString(), label: r.row_count === 1 ? 'row' : 'rows' } : null
    case 'campaign':
    case 'townhall_session':
      return null
    default:
      return null
  }
}

// Per-type status badge bg/fg colors.
function statusBadge(f: EnrichedFav): { text: string; bg: string; fg: string } | null {
  const r = f.raw
  const s = r.status as string | undefined
  if (!s) return null
  if (s === 'active' || s === 'published')       return { text: s, bg: '#d1fae5', fg: '#059669' }
  if (s === 'draft')                              return { text: s, bg: '#f3f4f6', fg: '#6b7280' }
  if (s === 'paused' || s === 'archived')         return { text: s, bg: '#fef3c7', fg: '#d97706' }
  if (s === 'closed' || s === 'completed')        return { text: s, bg: '#e0e7ff', fg: '#4338ca' }
  return { text: s, bg: '#f3f4f6', fg: '#6b7280' }
}

// Avatar / icon to put in the card's corner (per-type fallback).
function avatarFor(f: EnrichedFav): { letter: string; bg: string } {
  const meta = TYPE_META[f.resource_type]
  const r = f.raw
  if (f.resource_type === 'bot' && r.config?.avatarLetter) return { letter: r.config.avatarLetter, bg: r.config?.avatarGradient || meta.color }
  if (f.resource_type === 'study' && r.bot_emoji) return { letter: r.bot_emoji, bg: meta.color }
  return { letter: (r.name || '?').charAt(0).toUpperCase(), bg: meta.color }
}

function FavoriteCard({ f }: { f: EnrichedFav }) {
  const meta   = TYPE_META[f.resource_type]
  const stat   = keyStat(f)
  const status = statusBadge(f)
  const ava    = avatarFor(f)

  return (
    <Link href={f.href}
      style={{
        display: 'block', textDecoration: 'none', color: 'inherit',
        background: 'white', border: '1px solid #e5e7eb', borderRadius: 14,
        overflow: 'hidden', transition: 'border-color 0.15s, box-shadow 0.15s, transform 0.15s',
      }}
      onMouseEnter={function(e) {
        ;(e.currentTarget as HTMLElement).style.borderColor = meta.color + '60'
        ;(e.currentTarget as HTMLElement).style.boxShadow   = '0 4px 16px ' + meta.color + '14'
        ;(e.currentTarget as HTMLElement).style.transform   = 'translateY(-1px)'
      }}
      onMouseLeave={function(e) {
        ;(e.currentTarget as HTMLElement).style.borderColor = '#e5e7eb'
        ;(e.currentTarget as HTMLElement).style.boxShadow   = ''
        ;(e.currentTarget as HTMLElement).style.transform   = ''
      }}>
      {/* Color strip — per-type identity */}
      <div style={{ height: 5, background: meta.color }} />

      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column' as const, gap: 12 }}>
        {/* Header — avatar + name/subtitle + type badge */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{
            width: 38, height: 38, borderRadius: '50%',
            background: ava.bg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 700, color: 'white', flexShrink: 0,
          }}>
            {ava.letter}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const }}>
              {f.name}
            </div>
            {f.subtitle && (
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const }}>
                {f.subtitle}
              </div>
            )}
          </div>
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '3px 7px', borderRadius: 10,
            background: meta.color + '15', color: meta.color, border: '1px solid ' + meta.color + '30',
            textTransform: 'uppercase' as const, letterSpacing: 0.3, flexShrink: 0,
          }}>
            <span style={{ marginRight: 3 }}>{meta.icon}</span>{meta.label}
          </span>
        </div>

        {/* Key stat — big number */}
        {stat && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: meta.color, fontVariantNumeric: 'tabular-nums' as const }}>
              {stat.value}
            </span>
            <span style={{ fontSize: 11, color: '#6b7280' }}>{stat.label}</span>
          </div>
        )}

        {/* Footer — status badge (left) + last-touched timestamp (right) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 'auto', paddingTop: 8, borderTop: '1px solid #f3f4f6' }}>
          <div>
            {status && (
              <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 10, background: status.bg, color: status.fg, textTransform: 'capitalize' as const }}>
                {status.text}
              </span>
            )}
          </div>
          <span style={{ fontSize: 10, color: '#9ca3af' }}>{relTime(f.ts) || 'starred ' + relTime(f.created_at)}</span>
        </div>
      </div>
    </Link>
  )
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
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#111827' }}>★ Favorites</h1>
        <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>{favorites.length} item{favorites.length === 1 ? '' : 's'} pinned across the platform.</p>
      </div>

      {TYPE_ORDER.filter(function(t) { return (groups[t] || []).length > 0 }).map(function(type) {
        const items = groups[type]
        return (
          <section key={type} style={{ marginBottom: 36 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 14 }}>
              {TYPE_LABELS[type]} ({items.length})
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
              {items.map(function(f) { return <FavoriteCard key={f.resource_id} f={f} /> })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
