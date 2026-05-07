'use client'

// components/analyze/textmine/OpinionPopover.tsx
// Modal showing opinion words associated with a clicked aspect word.
// Two modes:
//   - 'opinions' (default): per-noun clusters with sentiment + sample sentences
//   - 'comments': flat list of every comment containing the aspect word, with
//                 the word highlighted. Toggled by the "View all X comments"
//                 footer button so the user never has to leave this modal.

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { extractOpinions } from '@/lib/opinionMining'

const HERMES = '#E8632A'

const SENT_COLORS = {
  positive: { text: '#059669', bg: '#ecfdf5', border: '#a7f3d0' },
  negative: { text: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  neutral:  { text: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' },
}

// Pick the field most likely to hold a row's date by sniffing the first non-empty
// value. Returns null if no field looks like a date.
function detectDateField(rows: Record<string, unknown>[]): string | null {
  if (rows.length === 0) return null
  const preferred = ['created_at', 'date', 'published_at', 'reviewed_at', 'completed_at', 'submitted_at', 'timestamp', 'posted_at', 'time']
  // First pass: known names
  for (const c of preferred) {
    for (const r of rows) {
      const v = r[c]
      if (typeof v === 'string' && v && !isNaN(Date.parse(v))) return c
    }
  }
  // Second pass: any field whose first non-empty value parses as a plausible date
  const sampled = rows.slice(0, 100)
  for (const k of Object.keys(rows[0] || {})) {
    for (const r of sampled) {
      const v = r[k]
      if (typeof v !== 'string' || !v) continue
      const t = Date.parse(v)
      if (isNaN(t)) break
      const y = new Date(t).getUTCFullYear()
      if (y > 2000 && y < 2100) return k
      break
    }
  }
  return null
}

// Compute count-per-week for rows whose text fields contain `word`. Bucket key
// is the Monday of the week (ISO-style date string).
function weeklyCounts(
  rows: Record<string, unknown>[],
  fieldArr: string[],
  word: string,
  dateField: string,
): { week: string; count: number }[] {
  const target = word.toLowerCase()
  const buckets = new Map<string, number>()
  for (const row of rows) {
    const dateStr = String(row[dateField] || '')
    if (!dateStr || isNaN(Date.parse(dateStr))) continue
    let hit = false
    for (const f of fieldArr) {
      const t = String(row[f] || '').toLowerCase()
      if (t.includes(target)) { hit = true; break }
    }
    if (!hit) continue
    const d = new Date(dateStr)
    const day = d.getUTCDay() || 7
    d.setUTCDate(d.getUTCDate() - day + 1)
    d.setUTCHours(0, 0, 0, 0)
    const key = d.toISOString().slice(0, 10)
    buckets.set(key, (buckets.get(key) || 0) + 1)
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, count]) => ({ week, count }))
}

function FrequencyChart({ buckets }: { buckets: { week: string; count: number }[] }) {
  if (buckets.length < 2) return null
  const W = 460, H = 64, P = 8
  const innerW = W - 2 * P
  const innerH = H - 2 * P
  const maxCount = Math.max(...buckets.map(b => b.count), 1)
  const dx = innerW / Math.max(buckets.length - 1, 1)
  const points = buckets.map((b, i) => ({
    x: P + i * dx,
    y: P + innerH - (b.count / maxCount) * innerH,
    week: b.week,
    count: b.count,
  }))
  const path = points.map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ')
  const fillPath = path + ' L' + points[points.length - 1].x.toFixed(1) + ' ' + (P + innerH) + ' L' + points[0].x.toFixed(1) + ' ' + (P + innerH) + ' Z'
  const first = buckets[0].week
  const last = buckets[buckets.length - 1].week
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.06em', marginBottom: 4 }}>
        Frequency by week
      </div>
      <svg width="100%" height={H} viewBox={'0 0 ' + W + ' ' + H} preserveAspectRatio="none">
        <path d={fillPath} fill={HERMES} fillOpacity={0.12} />
        <path d={path} fill="none" stroke={HERMES} strokeWidth={1.75} />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={HERMES}>
            <title>{p.week}: {p.count}</title>
          </circle>
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#9ca3af', marginTop: 2 }}>
        <span>{first}</span>
        <span>{last}</span>
      </div>
    </div>
  )
}

interface Props {
  word: string
  rows: Record<string, unknown>[]
  fields: string | string[]
  onClose: () => void
}

// Highlight every case-insensitive occurrence of `word` in `text`.
function highlightWord(text: string, word: string): React.ReactNode[] {
  if (!word) return [text]
  const re = new RegExp('(' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi')
  const parts = text.split(re)
  return parts.map(function(p, i) {
    if (p.toLowerCase() === word.toLowerCase()) {
      return <mark key={i} style={{ background: '#fef3c7', color: '#92400e', padding: '0 2px', borderRadius: 2, fontWeight: 600 }}>{p}</mark>
    }
    return <span key={i}>{p}</span>
  })
}

export default function OpinionPopover({ word, rows, fields, onClose }: Props) {
  const [view, setView] = useState<'opinions' | 'comments'>('opinions')

  const fieldArr = Array.isArray(fields) ? fields : [fields]

  const result = useMemo(function() {
    return extractOpinions(rows, fields, word)
  }, [rows, fields, word])

  // Frequency-by-week sparkline (legacy Ana parity).
  // Auto-detects a date field on the rows; renders nothing when no date is available.
  const dateField = useMemo(() => detectDateField(rows), [rows])
  const weekly = useMemo(() => {
    if (!dateField) return []
    return weeklyCounts(rows, fieldArr, word, dateField)
  }, [rows, fieldArr, word, dateField])

  // Pre-compute the matching comments for the comments view (only when needed)
  const matchingComments = useMemo(function() {
    if (view !== 'comments') return []
    const target = word.toLowerCase()
    const out: string[] = []
    for (const row of rows) {
      for (const f of fieldArr) {
        const t = String(row[f] || '').trim()
        if (t && t.toLowerCase().includes(target)) {
          out.push(t)
          break // one entry per row max, even if multiple fields match
        }
      }
    }
    return out
  }, [view, rows, fieldArr, word])

  let content: React.ReactNode

  if (view === 'comments') {
    content = matchingComments.length === 0 ? (
      <p style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', padding: '20px 0' }}>
        No comments found containing "{word}".
      </p>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>
          {matchingComments.length.toLocaleString()} comment{matchingComments.length !== 1 ? 's' : ''} containing "{word}"
        </div>
        {matchingComments.map(function(t, i) {
          return (
            <div key={i} style={{ padding: '10px 12px', background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.55, whiteSpace: 'pre-wrap' as const }}>
                {highlightWord(t, word)}
              </div>
            </div>
          )
        })}
      </div>
    )
  } else if (!result.opinions.length) {
    content = (
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <p style={{ fontSize: 13, color: '#9ca3af' }}>No opinion words found near "{word}" in the data.</p>
        <p style={{ fontSize: 11, color: '#d1d5db', marginTop: 4 }}>{result.totalMentions} mentions found, but no adjectives/descriptors nearby.</p>
      </div>
    )
  } else {
    const total = result.sentimentSummary.positive + result.sentimentSummary.negative + result.sentimentSummary.neutral
    const posPct = total > 0 ? Math.round(result.sentimentSummary.positive / total * 100) : 0
    const negPct = total > 0 ? Math.round(result.sentimentSummary.negative / total * 100) : 0

    content = (
      <>
        {/* Sentiment bar */}
        <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
          {posPct > 0 && <div style={{ width: posPct + '%', background: '#059669', transition: 'width .3s' }} />}
          {negPct > 0 && <div style={{ width: negPct + '%', background: '#dc2626', transition: 'width .3s' }} />}
          <div style={{ flex: 1, background: '#e5e7eb' }} />
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 12, marginBottom: 16, color: '#6b7280' }}>
          <span><span style={{ color: '#059669', fontWeight: 700 }}>{posPct}%</span> positive</span>
          <span><span style={{ color: '#dc2626', fontWeight: 700 }}>{negPct}%</span> negative</span>
          <span style={{ marginLeft: 'auto', color: '#9ca3af' }}>{result.totalMentions.toLocaleString()} mentions</span>
        </div>

        {/* Opinion list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {result.opinions.slice(0, 20).map(function(op) {
            const sc = SENT_COLORS[op.sentiment]
            return (
              <div key={op.opinion} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px', borderRadius: 10, background: sc.bg, border: '1px solid ' + sc.border }}>
                <div style={{ minWidth: 90 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: sc.text }}>{op.opinion}</span>
                  <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 6 }}>{op.count}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {op.samples.slice(0, 2).map(function(s, i) {
                    return <p key={i} style={{ fontSize: 11, color: '#6b7280', margin: '0 0 2px', lineHeight: 1.4 }}>"{s}"</p>
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </>
    )
  }

  // Render via portal to escape any ancestor transforms that break position:fixed
  const modal = (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={onClose}>
      <div style={{ background: 'white', borderRadius: 16, padding: '24px 28px', boxShadow: '0 24px 64px rgba(0,0,0,.2)', maxWidth: 520, width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
        onClick={function(e) { e.stopPropagation() }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: '#111827', margin: 0 }}>
              {view === 'comments'
                ? 'Comments mentioning "' + word + '"'
                : (result.mode === 'nouns' ? 'What people call "' + word + '"' : 'Opinions about "' + word + '"')}
            </h3>
          </div>
          <button onClick={onClose} style={{ background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 18, color: '#6b7280', width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{'×'}</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {/* Frequency-by-week sparkline at the very top — visible across both views */}
          <FrequencyChart buckets={weekly} />
          {content}
        </div>

        {/* Footer — toggle between opinions and comments view */}
        {result.opinions.length > 0 && (
          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12, marginTop: 12, display: 'flex', gap: 8 }}>
            <button onClick={function() { setView(view === 'opinions' ? 'comments' : 'opinions') }}
              style={{ flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 700, color: '#2563eb', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, cursor: 'pointer' }}>
              {view === 'opinions' ? 'View all "' + word + '" comments' : '← Back to opinion clusters'}
            </button>
            <button onClick={onClose}
              style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, color: '#6b7280', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 8, cursor: 'pointer' }}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )

  if (typeof document !== 'undefined') {
    return createPortal(modal, document.body)
  }
  return modal
}
