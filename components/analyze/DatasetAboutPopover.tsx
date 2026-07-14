'use client'

// components/analyze/DatasetAboutPopover.tsx
//
// ONE shared "About this dataset" popover, used by two triggers: an (i) on each
// /analyze listing card, and a hover on the dataset name in the analyze banner.
// Trigger-agnostic: the caller owns open state + the anchor rect (so hover and
// click both work); this renders the fixed-position mini-table + click-away and
// fetches /api/datasets/[id]/about once per open. Read-only.

import { useEffect, useRef, useState } from 'react'
import LottieLoader from '@/components/ui/LottieLoader'
import { SUBSTANTIVE_RULE_NOTE } from '@/lib/usefulness'

interface AboutData {
  rows: number
  source: string
  lastSynced: string | null
  dateMin: string | null
  dateMax: string | null
  fieldsByType: Record<string, number>
  fieldCount: number
  verbatimFields: { field: string; label: string; fill: number; substantive: number | null }[]
  ratingFields: { field: string; label: string; n: number | null; avg: number | null; max: number | null }[]
  sampled: boolean
}

interface Props {
  datasetId: string
  datasetName: string
  open: boolean
  anchorRect: DOMRect | null
  onClose: () => void
}

const SOURCE_LABEL: Record<string, string> = {
  upload: 'Uploaded file', study: 'Survey', google_reviews: 'Google reviews', reddit: 'Reddit',
  townhall: 'PulseIQ', substack: 'Substack', collection: 'Collection', bot: 'Agent', recording: 'Town Hall',
}
const TYPE_LABEL: Record<string, string> = {
  'open-ended': 'text', categorical: 'categorical', numeric: 'numeric', date: 'date', id: 'id',
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDate(d: string | null): string {
  if (!d) return '—'
  const m = String(d).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : String(d).slice(0, 10)
}
function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return m + 'm ago'
  const h = Math.floor(m / 60); if (h < 24) return h + 'h ago'
  const d = Math.floor(h / 24); if (d < 30) return d + 'd ago'
  const mo = Math.floor(d / 30); if (mo < 12) return mo + 'mo ago'
  return Math.floor(mo / 12) + 'y ago'
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '3px 0' }}>
      <span style={{ color: '#6b7280', flexShrink: 0 }}>{label}</span>
      <span style={{ color: '#111827', fontWeight: 600, textAlign: 'right' }}>{children}</span>
    </div>
  )
}

export default function DatasetAboutPopover({ datasetId, datasetName, open, anchorRect, onClose }: Props) {
  const [data, setData] = useState<AboutData | null>(null)
  const [done, setDone] = useState(false)   // fetch settled (loader shows until then)
  const fetchedFor = useRef<string | null>(null)

  useEffect(function() {
    if (!open || fetchedFor.current === datasetId) return
    fetchedFor.current = datasetId
    // State is set only inside the async callbacks (not synchronously in the
    // effect body) so this doesn't trip react-hooks/set-state-in-effect.
    fetch('/api/datasets/' + datasetId + '/about')
      .then(function(r) { return r.ok ? r.json() : null })
      .then(function(d) { setData(d as AboutData | null) })
      .catch(function() { setData(null) })
      .finally(function() { setDone(true) })
  }, [open, datasetId])

  if (!open || !anchorRect) return null

  // Anchor below the trigger, clamped to the viewport width.
  const W = 320
  const left = Math.max(8, Math.min(anchorRect.left, (typeof window !== 'undefined' ? window.innerWidth : W + 16) - W - 8))
  const top = anchorRect.bottom + 6

  const fieldBreakdown = Object.entries(data?.fieldsByType || {})
    .filter(([, n]) => n > 0)
    .map(([t, n]) => n + ' ' + (TYPE_LABEL[t] || t))
    .join(', ')

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 2099 }} onClick={onClose} onMouseDown={onClose} />
      <div
        role="dialog"
        onMouseLeave={onClose}
        style={{
          position: 'fixed', top, left, width: W, zIndex: 2100,
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
          boxShadow: '0 16px 48px rgba(0,0,0,.18)', padding: '12px 14px', fontSize: 12, color: '#374151',
          maxHeight: 'min(70vh, 520px)', overflowY: 'auto',
        }}
      >
        <div style={{ fontWeight: 700, color: '#111827', fontSize: 13, marginBottom: 8, lineHeight: 1.3 }}>{datasetName}</div>

        {!done ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}><LottieLoader size={28} /></div>
        ) : !data ? (
          <div style={{ color: '#9ca3af' }}>No details available.</div>
        ) : (
          <>
            <Row label="Rows">{data.rows.toLocaleString()}</Row>
            <Row label="Source">{SOURCE_LABEL[data.source] || data.source}</Row>
            <Row label="Fields">
              {data.fieldCount}{fieldBreakdown ? <span style={{ color: '#9ca3af', fontWeight: 400 }}> · {fieldBreakdown}</span> : null}
            </Row>
            {(data.dateMin || data.dateMax) && (
              <Row label="Date range">{fmtDate(data.dateMin)} – {fmtDate(data.dateMax)}</Row>
            )}
            {data.source !== 'upload' && <Row label="Last synced">{timeAgo(data.lastSynced)}</Row>}

            {data.verbatimFields.length > 0 && (
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #f3f4f6' }}>
                <div style={{ color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', fontSize: 10, letterSpacing: '.05em', marginBottom: 4 }}>
                  Open-ended fields{data.sampled ? ' (≈ sampled)' : ''}
                </div>
                {data.verbatimFields.map(function(f) {
                  const fillPct = data.rows > 0 ? Math.round((f.fill / data.rows) * 100) : 0
                  return (
                    <div key={f.field} style={{ padding: '3px 0' }}>
                      <div style={{ color: '#111827', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={f.label}>{f.label}</div>
                      <div style={{ color: '#6b7280', fontSize: 11 }}>
                        {(data.sampled ? '≈' : '') + f.fill.toLocaleString()} filled ({fillPct}%)
                        {f.substantive != null && (
                          <span title={'Comments carrying usable feedback (the two-count base). ' + SUBSTANTIVE_RULE_NOTE}>
                            {' · '}<strong style={{ color: '#047857' }}>{(data.sampled ? '≈' : '') + f.substantive.toLocaleString()}</strong> comments
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {data.ratingFields.length > 0 && (
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #f3f4f6' }}>
                <div style={{ color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', fontSize: 10, letterSpacing: '.05em', marginBottom: 4 }}>
                  Rating fields
                </div>
                {data.ratingFields.map(function(f) {
                  return (
                    <div key={f.field} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '2px 0' }}>
                      <span style={{ color: '#111827', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={f.label}>{f.label}</span>
                      <span style={{ color: '#6b7280', flexShrink: 0 }}>
                        {f.avg != null && <><span style={{ color: '#d97706' }}>★</span> <strong style={{ color: '#111827' }}>{f.avg.toFixed(1)}</strong>{f.max ? '/' + Math.round(f.max) : ''} </>}
                        {f.n != null && <span>· n={f.n.toLocaleString()}</span>}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
