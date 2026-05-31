'use client'

// components/downloads/DownloadMonitor.tsx
// Shared download/upload monitor used by:
//   - /admin/downloads (cross-org, super-admin view) — showOrgColumn=true
//   - /downloads       (single-org, owner view)     — showOrgColumn=false
// Google Reviews rows support inline cadence edit + multi-select bulk
// actions (set frequency / pause / resume) via PATCH /api/review-sources.

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

const FREQUENCY_OPTIONS: { value: number; label: string }[] = [
  { value:    0, label: 'Manual'    },
  { value:    6, label: 'Every 6h'  },
  { value:   12, label: 'Every 12h' },
  { value:   24, label: 'Daily'     },
  { value:   72, label: 'Every 3 days' },
  { value:  168, label: 'Weekly'    },
  { value:  720, label: 'Monthly'   },
  { value: 2160, label: 'Quarterly' },
]

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
  if (d.getFullYear() > 2100) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function fmtFrequency(hours: number | null | undefined): string {
  if (hours == null || hours === 0) return 'Manual'
  if (hours < 24 && 24 % hours === 0)              return `Every ${hours}h`
  if (hours === 24)                                return 'Daily'
  if (hours % 168 === 0 && hours / 168 === 1)      return 'Weekly'
  if (hours % 168 === 0)                           return `Every ${hours / 168} weeks`
  if (hours === 720)                               return 'Monthly'
  if (hours === 2160)                              return 'Quarterly'
  if (hours % 24 === 0)                            return `Every ${hours / 24} days`
  return `${hours}h`
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
  redditSources:    any[]
  reviewSources:    any[]
  pendingLocations: any[]
  substackDatasets: any[]
  regDatasets:      any[]
  uploadDatasets:   any[]
  recordings?:      any[]
  showOrgColumn?:   boolean   // false for single-org user view
  title?:           string
  subtitle?:        string
}

type Tab = 'all' | 'reddit' | 'reviews' | 'substack' | 'regulations' | 'uploads' | 'recordings'

export default function DownloadMonitor({
  redditSources,
  reviewSources: initialReviewSources,
  pendingLocations,
  substackDatasets,
  regDatasets,
  uploadDatasets,
  recordings = [],
  showOrgColumn = true,
  title = 'Download Monitor',
  subtitle = 'Active, queued, and failed downloads',
}: Props) {
  const [tab, setTab] = useState<Tab>('all')
  const [reviewSources, setReviewSources] = useState<any[]>(initialReviewSources)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const flashMsg = (m: string) => { setFlash(m); setTimeout(() => setFlash(null), 3000) }

  async function patchSource(id: string, payload: Record<string, any>) {
    const res = await fetch('/api/review-sources/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.error || 'Failed to update')
    }
    return res.json().catch(() => ({}))
  }

  async function changeFrequency(id: string, hours: number) {
    setSavingIds(prev => new Set(prev).add(id))
    try {
      await patchSource(id, { sync_frequency_hours: hours })
      setReviewSources(prev => prev.map(s => s.id === id ? { ...s, sync_frequency_hours: hours } : s))
    } catch (e: any) {
      flashMsg('Update failed: ' + e.message)
    } finally {
      setSavingIds(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  async function bulkSetFrequency(hours: number) {
    if (selected.size === 0 || bulkBusy) return
    setBulkBusy(true)
    const ids = Array.from(selected)
    try {
      await Promise.all(ids.map(id => patchSource(id, { sync_frequency_hours: hours })))
      setReviewSources(prev => prev.map(s => selected.has(s.id) ? { ...s, sync_frequency_hours: hours } : s))
      flashMsg(`Updated ${ids.length} sources`)
      setSelected(new Set())
    } catch (e: any) {
      flashMsg('Bulk update failed: ' + e.message)
    } finally {
      setBulkBusy(false)
    }
  }

  async function bulkSetStatus(status: 'active' | 'paused') {
    if (selected.size === 0 || bulkBusy) return
    setBulkBusy(true)
    const ids = Array.from(selected)
    try {
      await Promise.all(ids.map(id => patchSource(id, { status })))
      setReviewSources(prev => prev.map(s => selected.has(s.id) ? { ...s, status } : s))
      flashMsg(`${status === 'paused' ? 'Paused' : 'Resumed'} ${ids.length} sources`)
      setSelected(new Set())
    } catch (e: any) {
      flashMsg('Bulk update failed: ' + e.message)
    } finally {
      setBulkBusy(false)
    }
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  function toggleSelectAll() {
    if (selected.size === reviewSources.length) setSelected(new Set())
    else setSelected(new Set(reviewSources.map(s => s.id)))
  }

  const errorCount = redditSources.filter(s => s.status === 'error').length +
    reviewSources.filter(s => s.status === 'error').length
  const activeCount = redditSources.filter(s => s.status === 'downloading').length +
    reviewSources.filter(s => s.status === 'active' || s.status === 'searching').length +
    pendingLocations.length

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'all',         label: 'Overview',        count: 0 },
    { key: 'reddit',      label: 'Reddit',          count: redditSources.length },
    { key: 'reviews',     label: 'Google Reviews',  count: reviewSources.length },
    { key: 'substack',    label: 'Substack',        count: substackDatasets.length },
    { key: 'regulations', label: 'Regulations.gov', count: regDatasets.length },
    { key: 'uploads',     label: 'Uploads',         count: uploadDatasets.length },
    { key: 'recordings',  label: 'Recordings',      count: recordings.length },
  ]

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>{title}</h1>
        <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>{subtitle}</p>
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
          <div style={{ fontSize: 24, fontWeight: 800, color: HERMES }}>{substackDatasets.length + regDatasets.length + uploadDatasets.length}</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>Substack + Regulations + Uploads</div>
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

      {/* Bulk action toolbar — appears when any review source is selected */}
      {selected.size > 0 && (
        <div style={{ background: '#fff7f0', border: '1px solid ' + HERMES + '40', borderRadius: 10, padding: '10px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: HERMES }}>
            {selected.size} selected
          </span>
          <span style={{ fontSize: 12, color: '#6b7280' }}>·</span>
          <span style={{ fontSize: 12, color: '#374151' }}>Set frequency:</span>
          <select
            disabled={bulkBusy}
            onChange={e => { const v = Number(e.target.value); if (!Number.isNaN(v)) bulkSetFrequency(v); e.target.value = '' }}
            style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db', background: 'white', cursor: bulkBusy ? 'wait' : 'pointer' }}>
            <option value="">Choose…</option>
            {FREQUENCY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button onClick={() => bulkSetStatus('paused')} disabled={bulkBusy}
            style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid #fcd34d', background: '#fef3c7', color: '#92400e', cursor: bulkBusy ? 'wait' : 'pointer' }}>
            Pause
          </button>
          <button onClick={() => bulkSetStatus('active')} disabled={bulkBusy}
            style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid #a7f3d0', background: '#d1fae5', color: '#065f46', cursor: bulkBusy ? 'wait' : 'pointer' }}>
            Resume
          </button>
          <button onClick={() => setSelected(new Set())} disabled={bulkBusy}
            style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid #e5e7eb', background: 'white', color: '#6b7280', cursor: 'pointer', marginLeft: 'auto' }}>
            Clear
          </button>
        </div>
      )}

      {flash && (
        <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', borderRadius: 8, padding: '8px 12px', fontSize: 12, marginBottom: 16 }}>
          {flash}
        </div>
      )}

      {/* Reddit */}
      {(tab === 'all' || tab === 'reddit') && redditSources.length > 0 && (
        <Section title="Reddit Downloads" icon="🔴">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                {showOrgColumn && <th style={th}>Org</th>}
                <th style={th}>Status</th><th style={th}>Posts</th><th style={th}>Comments</th><th style={th}>Updated</th><th style={th}>Error</th>
              </tr>
            </thead>
            <tbody>
              {redditSources.map((s: any) => (
                <tr key={s.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  {showOrgColumn && <td style={td}>{s.orgName}</td>}
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

      {/* Google Reviews — inline-editable frequency + multi-select */}
      {(tab === 'all' || tab === 'reviews') && reviewSources.length > 0 && (
        <Section title="Google Reviews" icon="⭐">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ ...th, width: 28 }}>
                  <input
                    type="checkbox"
                    checked={reviewSources.length > 0 && selected.size === reviewSources.length}
                    onChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                </th>
                <th style={th}>Brand</th>
                {showOrgColumn && <th style={th}>Org</th>}
                <th style={th}>Status</th><th style={th}>Frequency</th><th style={th}>Last Sync</th><th style={th}>Next Sync</th><th style={th}>Pending</th><th style={th}>Error</th>
              </tr>
            </thead>
            <tbody>
              {reviewSources.map((s: any) => {
                const pending = pendingLocations.filter(l => l.review_source_id === s.id).length
                const isSel = selected.has(s.id)
                const isSaving = savingIds.has(s.id)
                return (
                  <tr key={s.id} style={{ borderBottom: '1px solid #f3f4f6', background: isSel ? '#fff7f0' : undefined }}>
                    <td style={td}>
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggleSelect(s.id)}
                        aria-label={'Select ' + s.brand_name}
                      />
                    </td>
                    <td style={{ ...td, fontWeight: 600 }}>{s.brand_name}</td>
                    {showOrgColumn && <td style={td}>{s.orgName}</td>}
                    <td style={td}><StatusPill status={s.status} /></td>
                    <td style={td}>
                      <select
                        value={FREQUENCY_OPTIONS.some(o => o.value === s.sync_frequency_hours) ? s.sync_frequency_hours : ''}
                        disabled={isSaving}
                        onChange={e => changeFrequency(s.id, Number(e.target.value))}
                        style={{ fontSize: 11, padding: '2px 6px', borderRadius: 5, border: '1px solid #d1d5db', background: 'white', cursor: isSaving ? 'wait' : 'pointer' }}>
                        {!FREQUENCY_OPTIONS.some(o => o.value === s.sync_frequency_hours) && (
                          <option value="">{fmtFrequency(s.sync_frequency_hours)} (custom)</option>
                        )}
                        {FREQUENCY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
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

      {/* Substack */}
      {(tab === 'all' || tab === 'substack') && substackDatasets.length > 0 && (
        <Section title="Substack" icon="📰">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={th}>Dataset</th>{showOrgColumn && <th style={th}>Org</th>}<th style={th}>Rows</th><th style={th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {substackDatasets.map((d: any) => (
                <tr key={d.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ ...td, fontWeight: 600 }}>{d.name}</td>
                  {showOrgColumn && <td style={td}>{d.orgName}</td>}
                  <td style={td}>{(d.row_count || 0).toLocaleString()}</td>
                  <td style={td}>{fmtDate(d.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* Regulations */}
      {(tab === 'all' || tab === 'regulations') && regDatasets.length > 0 && (
        <Section title="Regulations.gov" icon="🏛️">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={th}>Dataset</th>{showOrgColumn && <th style={th}>Org</th>}<th style={th}>Comments</th><th style={th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {regDatasets.map((d: any) => (
                <tr key={d.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ ...td, fontWeight: 600 }}>{d.name}</td>
                  {showOrgColumn && <td style={td}>{d.orgName}</td>}
                  <td style={td}>{(d.row_count || 0).toLocaleString()}</td>
                  <td style={td}>{fmtDate(d.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* Uploads */}
      {(tab === 'all' || tab === 'uploads') && uploadDatasets.length > 0 && (
        <Section title="Uploaded Datasets" icon="📤">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={th}>Dataset</th>{showOrgColumn && <th style={th}>Org</th>}<th style={th}>Status</th><th style={th}>Rows</th><th style={th}>Created</th><th style={th}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {uploadDatasets.map((d: any) => (
                <tr key={d.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ ...td, fontWeight: 600 }}>{d.name}</td>
                  {showOrgColumn && <td style={td}>{d.orgName}</td>}
                  <td style={td}><StatusPill status={d.status || 'done'} /></td>
                  <td style={td}>{(d.row_count || 0).toLocaleString()}</td>
                  <td style={td}>{fmtDate(d.created_at)}</td>
                  <td style={td}>{timeAgo(d.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* Recordings */}
      {(tab === 'all' || tab === 'recordings') && recordings.length > 0 && (
        <Section title="Recordings" icon="🎙️">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={th}>Name</th>{showOrgColumn && <th style={th}>Org</th>}<th style={th}>Type</th><th style={th}>Date</th><th style={th}>Status</th><th style={th}>Vendor</th><th style={th}>Duration</th><th style={th}>Cost</th><th style={th}>Error</th>
              </tr>
            </thead>
            <tbody>
              {recordings.map((r: any) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ ...td, fontWeight: 600 }}>
                    <a href={r.status === 'complete' && r.dataset_id ? `/analyze/${r.dataset_id}/report` : `/analyze/new/recording/${r.id}/status`}
                       style={{ color: '#111827', textDecoration: 'none' }}>
                      {r.name}
                    </a>
                  </td>
                  {showOrgColumn && <td style={td}>{r.orgName}</td>}
                  <td style={td}>{r.session_type === 'qa' ? 'Q&A' : r.session_type}</td>
                  <td style={td}>{r.meeting_date || '—'}</td>
                  <td style={td}><StatusPill status={r.status === 'complete' ? 'done' : r.status === 'failed' ? 'error' : r.status === 'queued' || r.status === 'extracting' || r.status === 'transcribing' || r.status === 'analyzing' || r.status === 'rendering' ? 'downloading' : 'pending'} /></td>
                  <td style={td}>{r.asr_vendor_chosen || '—'}</td>
                  <td style={td}>{r.source_duration_sec ? Math.round(r.source_duration_sec / 60) + 'm' : '—'}</td>
                  <td style={td}>{r.cost_cents ? '$' + (r.cost_cents / 100).toFixed(2) : '—'}</td>
                  <td style={{ ...td, maxWidth: 240, color: '#dc2626', fontSize: 11 }}>{r.error_message ? r.error_message.slice(0, 80) + (r.error_message.length > 80 ? '…' : '') : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {redditSources.length === 0 && reviewSources.length === 0 && substackDatasets.length === 0 && regDatasets.length === 0 && uploadDatasets.length === 0 && recordings.length === 0 && (
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
