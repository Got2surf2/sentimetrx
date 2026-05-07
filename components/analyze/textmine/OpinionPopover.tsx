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
import { autoBucket, bucketKey, formatBucketLabel, type TimeBucket } from '@/lib/timeBucket'

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

// Compute count-per-bucket for rows whose text fields contain `word`. Bucket
// granularity (hour/day/week/month/quarter/year) is auto-chosen from the data
// span via lib/timeBucket — short windows get fine buckets, multi-year ranges
// get coarser ones so the chart stays readable.
function frequencyBuckets(
  rows: Record<string, unknown>[],
  fieldArr: string[],
  word: string,
  dateField: string,
): { buckets: { key: string; count: number }[]; granularity: TimeBucket | null } {
  const target = word.toLowerCase()
  // First pass: collect dates of matching rows so we can pick granularity
  // based on actual matched-data range (not whole dataset range — sparser).
  const matched: Date[] = []
  for (const row of rows) {
    const dateStr = String(row[dateField] || '')
    if (!dateStr || isNaN(Date.parse(dateStr))) continue
    let hit = false
    for (const f of fieldArr) {
      const t = String(row[f] || '').toLowerCase()
      if (t.includes(target)) { hit = true; break }
    }
    if (!hit) continue
    matched.push(new Date(dateStr))
  }
  if (matched.length === 0) return { buckets: [], granularity: null }

  let min = matched[0], max = matched[0]
  for (const d of matched) { if (d < min) min = d; if (d > max) max = d }
  const granularity = autoBucket(min, max)

  const counts = new Map<string, number>()
  for (const d of matched) {
    const key = bucketKey(d, granularity)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const buckets = Array.from(counts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, count]) => ({ key, count }))
  return { buckets, granularity }
}

function FrequencyChart({
  buckets,
  granularity,
}: {
  buckets: { key: string; count: number }[]
  granularity: TimeBucket | null
}) {
  if (!granularity || buckets.length < 2) return null
  // Layout: left gutter for y-axis labels, then plot area.
  const W = 480, H = 80, PT = 8, PB = 14, PL = 30, PR = 8
  const innerW = W - PL - PR
  const innerH = H - PT - PB
  const maxCount = Math.max(...buckets.map(b => b.count), 1)
  // Round y-axis max up to a "nice" number for cleaner labels.
  const niceMax = niceCeiling(maxCount)
  const dx = innerW / Math.max(buckets.length - 1, 1)
  const points = buckets.map((b, i) => ({
    x: PL + i * dx,
    y: PT + innerH - (b.count / niceMax) * innerH,
    key: b.key,
    count: b.count,
  }))
  const path = points.map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ')
  const fillPath = path + ' L' + points[points.length - 1].x.toFixed(1) + ' ' + (PT + innerH) + ' L' + points[0].x.toFixed(1) + ' ' + (PT + innerH) + ' Z'
  const headlineLabels: Record<TimeBucket, string> = {
    hour: 'Hourly', day: 'Daily', week: 'Weekly', month: 'Monthly', quarter: 'Quarterly', year: 'Annual',
  }
  // Y-axis tick values: 0, mid, max (3 ticks).
  const ticks = [0, niceMax / 2, niceMax]
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.06em', marginBottom: 4 }}>
        {headlineLabels[granularity]} frequency · {buckets.length} {granularity === 'hour' ? 'hours' : granularity + 's'}
      </div>
      <svg width="100%" height={H} viewBox={'0 0 ' + W + ' ' + H} preserveAspectRatio="none">
        {/* Y-axis gridlines + labels */}
        {ticks.map((t, i) => {
          const y = PT + innerH - (t / niceMax) * innerH
          return (
            <g key={i}>
              <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="#e5e7eb" strokeWidth={1} strokeDasharray={i === 0 ? undefined : '2 3'} />
              <text x={PL - 4} y={y + 3} fontSize={9} fill="#9ca3af" textAnchor="end">{compactNum(t)}</text>
            </g>
          )
        })}
        <path d={fillPath} fill={HERMES} fillOpacity={0.12} />
        <path d={path} fill="none" stroke={HERMES} strokeWidth={1.75} />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={HERMES}>
            <title>{formatBucketLabel(p.key, granularity)}: {p.count}</title>
          </circle>
        ))}
        {/* X-axis endpoints */}
        <text x={PL} y={H - 2} fontSize={9} fill="#9ca3af">{formatBucketLabel(buckets[0].key, granularity)}</text>
        <text x={W - PR} y={H - 2} fontSize={9} fill="#9ca3af" textAnchor="end">{formatBucketLabel(buckets[buckets.length - 1].key, granularity)}</text>
      </svg>
    </div>
  )
}

// Round n up to the nearest "nice" number for axis labels (1, 2, 5, 10 × 10^k).
function niceCeiling(n: number): number {
  if (n <= 0) return 1
  const exp = Math.floor(Math.log10(n))
  const f = n / Math.pow(10, exp)
  const niceF = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10
  return niceF * Math.pow(10, exp)
}

// Format a count compactly: 1234 → "1.2k", 1500000 → "1.5M".
function compactNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '') + 'k'
  return String(Math.round(n))
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

  // Frequency time-series sparkline (legacy Ana parity).
  // Auto-detects a date field on the rows. Bucket granularity scales with the
  // data span — daily for short windows, monthly/quarterly for multi-year data.
  // Renders nothing when no date is available.
  const dateField = useMemo(() => detectDateField(rows), [rows])
  const freq = useMemo(() => {
    if (!dateField) return { buckets: [] as { key: string; count: number }[], granularity: null as TimeBucket | null }
    return frequencyBuckets(rows, fieldArr, word, dateField)
  }, [rows, fieldArr, word, dateField])

  // Denominator for % share — number of rows with non-empty text in any
  // analyzed field (matches what the user thinks of as "comments").
  const totalCommentsWithText = useMemo(() => {
    let n = 0
    for (const row of rows) {
      for (const f of fieldArr) {
        const v = row[f]
        if (typeof v === 'string' && v.trim()) { n++; break }
      }
    }
    return n
  }, [rows, fieldArr])

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
          <span style={{ marginLeft: 'auto', color: '#9ca3af' }}>
            {result.totalMentions.toLocaleString()} mentions
            {totalCommentsWithText > 0 && (
              <span style={{ marginLeft: 4, color: '#6b7280', fontWeight: 600 }}>
                · {((result.totalMentions / totalCommentsWithText) * 100).toFixed(1)}% of comments
              </span>
            )}
          </span>
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
          {/* Frequency time-series sparkline at the very top — visible across both views */}
          <FrequencyChart buckets={freq.buckets} granularity={freq.granularity} />
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
