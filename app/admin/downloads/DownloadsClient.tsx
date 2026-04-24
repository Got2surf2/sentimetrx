'use client'

// app/admin/downloads/DownloadsClient.tsx
// Admin download monitor: shows all active/queued/failed downloads across sources

import { useState } from 'react'

const HERMES = '#E8632A'

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  downloading: { bg: '#dbeafe', text: '#2563eb', border: '#93c5fd' },
  active:      { bg: '#d1fae5', text: '#059669', border: '#a7f3d0' },
  done:        { bg: '#d1fae5', text: '#059669', border: '#a7f3d0' },
  pending:     { bg: '#fef3c7', text: '#d97706', border: '#fcd34d' },
  searching:   { bg: '#fef3c7', text: '#d97706', border: '#fcd34d' },
  paused:      { bg: '#f3f4f6', text: '#6b7280', border: '#e5e7eb' },
  error:       { bg: '#fee2e2', text: '#dc2626', border: '#fecaca' },
  draft:       { bg: '#f3f4f6', text: '#6b7280', border: '#e5e7eb' },
}

function StatusPill({ status }: { status: string }) {
  const s = STATUS_COLORS[status] || STATUS_COLORS.draft
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: s.bg, color: s.text, border: '1px solid ' + s.border }}>
      {status}
    </span>
  )
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function timeAgo(iso: string | null) {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60000) return 'just now'
  if (ms < 3600000) return Math.floor(ms / 60000) + 'm ago'
  if (ms < 86400000) return Math.floor(ms / 3600000) + 'h ago'
  return Math.floor(ms / 86400000) + 'd ago'
}

interface Props {
  redditSources: any[]
  reviewSources: any[]
  pendingLocations: any[]
  substackDatasets: any[]
  regDatasets: any[]
}

type Tab = 'all' | 'reddit' | 'reviews' | 'substack' | 'regulations'

export default function DownloadsClient({ redditSources, reviewSources, pendingLocations, substackDatasets, regDatasets }: Props) {
  const [tab, setTab] = useState<Tab>('all')

  const errorCount = redditSources.filter(s => s.status === 'error').length +
    reviewSources.filter(s => s.status === 'error').length
  const activeCount = redditSources.filter(s => s.status === 'downloading').length +
    reviewSources.filter(s => s.status === 'active' || s.status === 'searching').length +
    pendingLocations.length

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'all', label: 'Overview', count: 0 },
    { key: 'reddit', label: 'Reddit', count: redditSources.length },
    { key: 'reviews', label: 'Google Reviews', count: reviewSources.length },
    { key: 'substack', label: 'Substack', count: substackDatasets.length },
    { key: 'regulations', label: 'Regulations.gov', count: regDatasets.length },
  ]

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>Download Monitor</h1>
        <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>Active, queued, and failed downloads across all sources</p>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', padding: '16px 20px' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#2563eb' }}>{activeCount}</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>Active / Pending</div>
        </div>
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', padding: '16px 20px' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: errorCount > 0 ? '#dc2626' : '#059669' }}>{errorCount}</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>Errors</div>
        </div>
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', padding: '16px 20px' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#059669' }}>{redditSources.length + reviewSources.length}</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>Reddit + Reviews Sources</div>
        </div>
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', padding: '16px 20px' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: HERMES }}>{substackDatasets.length + regDatasets.length}</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>Substack + Regulations</div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #e5e7eb', paddingBottom: 0 }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: 'transparent', border: 'none', borderBottom: tab === t.key ? '2px solid ' + HERMES : '2px solid transparent',
              color: tab === t.key ? HERMES : '#6b7280',
            }}>
            {t.label}{t.count > 0 ? ' (' + t.count + ')' : ''}
          </button>
        ))}
      </div>

      {/* Content */}
      {(tab === 'all' || tab === 'reddit') && redditSources.length > 0 && (
        <Section title="Reddit Downloads" icon="🔴">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={th}>Org</th><th style={th}>Status</th><th style={th}>Posts</th><th style={th}>Comments</th><th style={th}>Updated</th><th style={th}>Error</th>
              </tr>
            </thead>
            <tbody>
              {redditSources.map((s: any) => (
                <tr key={s.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={td}>{s.orgName}</td>
                  <td style={td}><StatusPill status={s.status} /></td>
                  <td style={td}>{s.total_posts || 0}</td>
                  <td style={td}>{s.total_comments || 0}</td>
                  <td style={td}>{timeAgo(s.updated_at)}</td>
                  <td style={{ ...td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#dc2626', fontSize: 11 }}>{s.error_message || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {(tab === 'all' || tab === 'reviews') && reviewSources.length > 0 && (
        <Section title="Google Reviews" icon="⭐">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={th}>Brand</th><th style={th}>Org</th><th style={th}>Status</th><th style={th}>Frequency</th><th style={th}>Last Sync</th><th style={th}>Next Sync</th><th style={th}>Pending Tasks</th><th style={th}>Error</th>
              </tr>
            </thead>
            <tbody>
              {reviewSources.map((s: any) => {
                const pending = pendingLocations.filter(l => l.review_source_id === s.id).length
                return (
                  <tr key={s.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ ...td, fontWeight: 600 }}>{s.brand_name}</td>
                    <td style={td}>{s.orgName}</td>
                    <td style={td}><StatusPill status={s.status} /></td>
                    <td style={td}>{s.sync_frequency_hours}h</td>
                    <td style={td}>{timeAgo(s.last_synced_at)}</td>
                    <td style={td}>{s.next_sync_at ? fmtDate(s.next_sync_at) : '—'}</td>
                    <td style={td}>{pending > 0 ? <span style={{ color: '#d97706', fontWeight: 600 }}>{pending}</span> : '0'}</td>
                    <td style={{ ...td, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#dc2626', fontSize: 11 }}>{s.error_message || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Section>
      )}

      {(tab === 'all' || tab === 'substack') && substackDatasets.length > 0 && (
        <Section title="Substack" icon="📰">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={th}>Dataset</th><th style={th}>Org</th><th style={th}>Rows</th><th style={th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {substackDatasets.map((d: any) => (
                <tr key={d.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ ...td, fontWeight: 600 }}>{d.name}</td>
                  <td style={td}>{d.orgName}</td>
                  <td style={td}>{(d.row_count || 0).toLocaleString()}</td>
                  <td style={td}>{fmtDate(d.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {(tab === 'all' || tab === 'regulations') && regDatasets.length > 0 && (
        <Section title="Regulations.gov" icon="🏛️">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={th}>Dataset</th><th style={th}>Org</th><th style={th}>Comments</th><th style={th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {regDatasets.map((d: any) => (
                <tr key={d.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ ...td, fontWeight: 600 }}>{d.name}</td>
                  <td style={td}>{d.orgName}</td>
                  <td style={td}>{(d.row_count || 0).toLocaleString()}</td>
                  <td style={td}>{fmtDate(d.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {redditSources.length === 0 && reviewSources.length === 0 && substackDatasets.length === 0 && regDatasets.length === 0 && (
        <div style={{ textAlign: 'center', padding: 64, color: '#9ca3af' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📥</div>
          <p style={{ fontSize: 16, fontWeight: 600, color: '#374151' }}>No downloads found</p>
        </div>
      )}
    </div>
  )
}

const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600, color: '#6b7280' }
const td: React.CSSProperties = { padding: '8px 10px', color: '#374151' }

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', marginBottom: 20, overflow: 'hidden' }}>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>{icon}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{title}</span>
      </div>
      <div style={{ padding: '0 8px' }}>{children}</div>
    </div>
  )
}
