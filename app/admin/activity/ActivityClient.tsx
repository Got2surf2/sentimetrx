'use client'

// app/admin/activity/ActivityClient.tsx
//
// Read-only admin dashboard for pilot health. Two top sections:
//   - Inactive Users (no events in N days). Sorted by recency of last
//     event so the most "barely active" users appear first. This is
//     the list to email when onboarding a pilot cohort.
//   - All Users (table). Email, org, last_active_at, 7d/30d events,
//     join date. Sortable.
//
// Below that, a recent activity feed (last 100 events) for context.

import { useState, useMemo } from 'react'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'

interface SummaryRow {
  user_id: string
  email: string
  full_name: string | null
  org_id: string | null
  org_name: string | null
  user_created_at: string
  disabled: boolean
  total_events: number
  active_days: number
  last_active_at: string | null
  first_active_at: string | null
  events_7d: number
  events_30d: number
  active_days_7d: number
  active_days_30d: number
}

interface RecentRow {
  id: string
  user_id: string
  org_id: string | null
  event_name: string
  event_category: string | null
  metadata: Record<string, unknown>
  created_at: string
}

interface Props {
  summary: SummaryRow[]
  recent: RecentRow[]
  userMap: Record<string, { email: string; full_name: string | null; org_name: string | null }>
  adminEmail: string
  logoUrl: string
  orgName: string
  fullName: string
}

function daysAgo(iso: string | null): number | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  return Math.floor(ms / 86400000)
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return mins + 'm ago'
  const h = Math.floor(mins / 60)
  if (h < 24) return h + 'h ago'
  const d = Math.floor(h / 24)
  if (d < 30) return d + 'd ago'
  return new Date(iso).toLocaleDateString()
}

export default function ActivityClient({ summary, recent, userMap, adminEmail, logoUrl, orgName, fullName }: Props) {
  const [inactiveThreshold, setInactiveThreshold] = useState(7) // days
  const [search, setSearch] = useState('')

  // Headline numbers
  const stats = useMemo(function() {
    const total = summary.length
    const active7 = summary.filter(s => (s.events_7d || 0) > 0).length
    const active30 = summary.filter(s => (s.events_30d || 0) > 0).length
    const neverActive = summary.filter(s => !s.last_active_at).length
    const stickiness = active30 > 0 ? Math.round((active7 / active30) * 100) : 0
    return { total, active7, active30, neverActive, stickiness }
  }, [summary])

  const inactive = useMemo(function() {
    const term = search.trim().toLowerCase()
    return summary
      .filter(s => {
        if (s.disabled) return false
        const d = daysAgo(s.last_active_at)
        const isInactive = d === null || d >= inactiveThreshold
        if (!isInactive) return false
        if (term) {
          const hit = (s.email || '').toLowerCase().includes(term) ||
                      (s.full_name || '').toLowerCase().includes(term) ||
                      (s.org_name || '').toLowerCase().includes(term)
          if (!hit) return false
        }
        return true
      })
      .sort((a, b) => {
        // Most-recently-active inactive users first (closer to "almost active")
        if (a.last_active_at && b.last_active_at) {
          return new Date(b.last_active_at).getTime() - new Date(a.last_active_at).getTime()
        }
        if (a.last_active_at) return -1
        if (b.last_active_at) return 1
        // Both never-active: newest-signup first (they need onboarding push)
        return new Date(b.user_created_at).getTime() - new Date(a.user_created_at).getTime()
      })
  }, [summary, inactiveThreshold, search])

  const allUsers = useMemo(function() {
    const term = search.trim().toLowerCase()
    return summary
      .filter(s => {
        if (!term) return true
        return (s.email || '').toLowerCase().includes(term) ||
               (s.full_name || '').toLowerCase().includes(term) ||
               (s.org_name || '').toLowerCase().includes(term)
      })
      .sort((a, b) => (new Date(b.last_active_at || 0).getTime()) - (new Date(a.last_active_at || 0).getTime()))
  }, [summary, search])

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb' }}>
      <TopNav logoUrl={logoUrl} orgName={orgName} isAdmin={true} userEmail={adminEmail} fullName={fullName} currentPage='admin' />
      <SubHeader crumbs={[{ label: 'Settings & Admin', href: '/admin/hub' }, { label: 'Activity' }]} />
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '112px 20px 24px' }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#111827', margin: 0 }}>User Activity</h1>
          <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
            Stickiness across the platform. Inactive users are the proactive outreach list.
          </p>
        </div>

        {/* Headline numbers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Total users', value: stats.total, color: '#111827' },
            { label: 'Active 7d',    value: stats.active7, color: '#059669' },
            { label: 'Active 30d',   value: stats.active30, color: '#2563eb' },
            { label: 'Stickiness (7d / 30d)', value: stats.stickiness + '%', color: '#e8622a' },
            { label: 'Never active', value: stats.neverActive, color: '#dc2626' },
          ].map(card => (
            <div key={card.label} style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: card.color, lineHeight: 1 }}>{card.value}</div>
              <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 4, fontWeight: 700 }}>{card.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: '#374151', display: 'flex', alignItems: 'center', gap: 6 }}>
            Inactivity threshold:
            <select value={inactiveThreshold} onChange={e => setInactiveThreshold(Number(e.target.value))}
              style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 7, background: 'white' }}>
              <option value={3}>3 days</option>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
          </label>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder='Search email / name / org…'
            style={{ flex: 1, minWidth: 240, padding: '6px 10px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 7, background: 'white' }}
          />
        </div>

        {/* Inactive list */}
        <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 10, marginBottom: 20, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #e5e7eb', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#991b1b' }}>
              Inactive ≥ {inactiveThreshold}d ({inactive.length})
            </span>
            {inactive.length > 0 && (
              <button
                onClick={() => {
                  const emails = inactive.map(u => u.email).join(', ')
                  navigator.clipboard.writeText(emails).catch(() => {})
                }}
                style={{ fontSize: 11, padding: '4px 10px', background: 'white', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
              >Copy {inactive.length} emails</button>
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#fafafa', color: '#6b7280', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px' }}>User</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px' }}>Org</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px' }}>Last active</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px' }}>30d events</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px' }}>Joined</th>
                </tr>
              </thead>
              <tbody>
                {inactive.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: '20px', textAlign: 'center', color: '#9ca3af' }}>No users are inactive past this threshold — nice.</td></tr>
                )}
                {inactive.map(u => (
                  <tr key={u.user_id} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '8px 12px' }}>
                      <div style={{ fontWeight: 600, color: '#111827' }}>{u.full_name || '—'}</div>
                      <div style={{ color: '#6b7280', fontSize: 11 }}>{u.email}</div>
                    </td>
                    <td style={{ padding: '8px 12px', color: '#374151' }}>{u.org_name || '—'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: u.last_active_at ? '#374151' : '#dc2626', fontWeight: u.last_active_at ? 400 : 700 }}>
                      {u.last_active_at ? timeAgo(u.last_active_at) : 'never'}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#374151' }}>{u.events_30d.toLocaleString()}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#6b7280' }}>{timeAgo(u.user_created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* All users */}
        <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 10, marginBottom: 20, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>All users ({allUsers.length})</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#fafafa', color: '#6b7280', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px' }}>User</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px' }}>Org</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px' }}>Last active</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px' }}>7d</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px' }}>30d</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px' }}>Total events</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px' }}>Joined</th>
                </tr>
              </thead>
              <tbody>
                {allUsers.map(u => (
                  <tr key={u.user_id} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '8px 12px' }}>
                      <div style={{ fontWeight: 600, color: '#111827' }}>{u.full_name || '—'}</div>
                      <div style={{ color: '#6b7280', fontSize: 11 }}>{u.email}</div>
                    </td>
                    <td style={{ padding: '8px 12px', color: '#374151' }}>{u.org_name || '—'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: u.last_active_at ? '#374151' : '#9ca3af' }}>{timeAgo(u.last_active_at)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#374151' }}>{u.events_7d.toLocaleString()}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#374151' }}>{u.events_30d.toLocaleString()}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#374151' }}>{u.total_events.toLocaleString()}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#6b7280' }}>{timeAgo(u.user_created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent feed */}
        <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>Recent events (last 100)</span>
          </div>
          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: '#fafafa', zIndex: 1 }}>
                <tr style={{ color: '#6b7280', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  <th style={{ textAlign: 'left', padding: '6px 12px' }}>When</th>
                  <th style={{ textAlign: 'left', padding: '6px 12px' }}>User</th>
                  <th style={{ textAlign: 'left', padding: '6px 12px' }}>Event</th>
                  <th style={{ textAlign: 'left', padding: '6px 12px' }}>Org</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(r => {
                  const u = userMap[r.user_id]
                  return (
                    <tr key={r.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '5px 12px', color: '#6b7280', whiteSpace: 'nowrap' }}>{timeAgo(r.created_at)}</td>
                      <td style={{ padding: '5px 12px', color: '#111827' }}>{u?.email || r.user_id.slice(0, 8)}</td>
                      <td style={{ padding: '5px 12px' }}>
                        <span style={{ background: '#eff6ff', color: '#1d4ed8', fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10 }}>{r.event_name}</span>
                      </td>
                      <td style={{ padding: '5px 12px', color: '#6b7280' }}>{u?.org_name || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
