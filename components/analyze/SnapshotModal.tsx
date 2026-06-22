'use client'
// components/analyze/SnapshotModal.tsx
// Read-only display of a frozen snapshot — aggregates-only, drift-immune.
// Renders the captured fieldSummaries (from computeAnalyticsFromRows at freeze
// time) plus the record count, the period/filters recipe, and retention controls.
// See docs/SAVED_VIEWS.md §5.

import type { DatasetAnalytics, FieldSummary, SchemaFieldConfig } from '@/lib/analyzeTypes'
import { T } from '@/lib/analyzeTheme'

export interface FrozenReport {
  capturedAt:       string
  filteredRowCount: number
  totalRowCount:    number
  sampled:          boolean
  period:           { range: [number, number] } | null
  filters:          Record<string, unknown>
  analytics:        DatasetAnalytics
}

export interface SnapshotRow {
  id:               string
  name:             string
  visibility:       'private' | 'org'
  expires_at:       string | null
  source_view_name: string | null
  created_at:       string
  frozen:           FrozenReport | null
}

const fmtDate = (iso: string) => { const d = new Date(iso); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
const fmtTs = (ts: number) => { const d = new Date(ts); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }

function FieldSummaryRow({ field, label, s }: { field: string; label: string; s: FieldSummary }) {
  if (s.type === 'id' || s.type === 'ignore') return null
  const head = (
    <div style={{ fontSize: 11, fontWeight: 700, color: T.textMid, marginBottom: 4 }}>{label}
      <span style={{ fontWeight: 500, color: T.textFaint, marginLeft: 6 }}>{s.nonNull} non-blank</span>
    </div>
  )
  if (s.type === 'categorical') {
    const top = (s.topN || []).slice(0, 5)
    const max = top.reduce(function(m, v) { return Math.max(m, s.counts[v] || 0) }, 0) || 1
    return (
      <div style={{ marginBottom: 12 }}>
        {head}
        {top.map(function(v) {
          const c = s.counts[v] || 0
          return (
            <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              <span style={{ fontSize: 11, color: T.text, width: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
              <div style={{ flex: 1, height: 8, background: T.bg, borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: (100 * c / max) + '%', height: '100%', background: T.accent }} />
              </div>
              <span style={{ fontSize: 11, color: T.textMute, width: 48, textAlign: 'right' }}>{c.toLocaleString()}</span>
            </div>
          )
        })}
      </div>
    )
  }
  if (s.type === 'numeric') {
    return (
      <div style={{ marginBottom: 12 }}>
        {head}
        <div style={{ fontSize: 12, color: T.text }}>avg <b>{s.avg}</b> · min {s.min} · max {s.max} · median {s.median}</div>
      </div>
    )
  }
  if (s.type === 'date') {
    return (<div style={{ marginBottom: 12 }}>{head}<div style={{ fontSize: 12, color: T.text }}>{s.min} → {s.max}</div></div>)
  }
  if (s.type === 'open-ended') {
    return (<div style={{ marginBottom: 12 }}>{head}<div style={{ fontSize: 12, color: T.textMute }}>{s.nonNull.toLocaleString()} responses · ~{s.avgWordCount} words avg</div></div>)
  }
  return null
}

export default function SnapshotModal({ snapshot, schemaFields, onClose, onDelete, onKeep, onExtend }: {
  snapshot: SnapshotRow
  schemaFields: SchemaFieldConfig[]
  onClose: () => void
  onDelete: () => void
  onKeep: () => void
  onExtend: () => void
}) {
  const f = snapshot.frozen
  const labelOf = function(field: string) { const m = schemaFields.find(function(x) { return x.field === field }); return (m && m.label) || field }
  const summaries = f ? Object.entries(f.analytics.fieldSummaries) : []

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={function(e) { e.stopPropagation() }} style={{ background: T.bg, width: 640, maxWidth: '100%', maxHeight: '88vh', borderRadius: 16, boxShadow: '0 24px 72px rgba(0,0,0,.28)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ background: T.bgCard, borderBottom: '1px solid ' + T.border, padding: '14px 20px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.accent, textTransform: 'uppercase', letterSpacing: '.07em' }}>Snapshot · frozen</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{snapshot.name}</div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: T.textFaint, lineHeight: 1 }}>{'×'}</button>
          </div>
          <div style={{ fontSize: 11, color: T.textMute, marginTop: 6 }}>
            Captured {f ? fmtDate(f.capturedAt) : fmtDate(snapshot.created_at)}
            {snapshot.source_view_name && <> · from “{snapshot.source_view_name}”</>}
            {f && f.period && <> · {fmtTs(f.period.range[0])}–{fmtTs(f.period.range[1] - 1)}</>}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: 20, overflowY: 'auto' }}>
          {!f && <div style={{ fontSize: 13, color: T.textFaint }}>This snapshot has no captured data.</div>}
          {f && (
            <>
              <div style={{ display: 'flex', gap: 20, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: T.text }}>{f.filteredRowCount.toLocaleString()}</div>
                  <div style={{ fontSize: 11, color: T.textMute }}>records{f.sampled && <span style={{ color: T.amber }}> (estimated)</span>}</div>
                </div>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: T.textFaint }}>{f.totalRowCount.toLocaleString()}</div>
                  <div style={{ fontSize: 11, color: T.textMute }}>of total</div>
                </div>
              </div>
              {summaries.map(function(entry) {
                return <FieldSummaryRow key={entry[0]} field={entry[0]} label={labelOf(entry[0])} s={entry[1]} />
              })}
            </>
          )}
        </div>

        {/* Footer — retention controls */}
        <div style={{ background: T.bgCard, borderTop: '1px solid ' + T.border, padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: T.textMute, flex: 1 }}>
            {snapshot.expires_at ? 'Expires ' + fmtDate(snapshot.expires_at) : 'Kept — no expiry'}
          </span>
          {snapshot.expires_at && <button onClick={onKeep} style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 7, border: '1px solid ' + T.border, background: T.bgCard, color: T.textMid, cursor: 'pointer' }}>Keep forever</button>}
          <button onClick={onExtend} style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 7, border: '1px solid ' + T.border, background: T.bgCard, color: T.textMid, cursor: 'pointer' }}>+30 days</button>
          <button onClick={onDelete} style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 7, border: 'none', background: T.redBg, color: T.red, cursor: 'pointer' }}>Delete</button>
        </div>
      </div>
    </div>
  )
}
