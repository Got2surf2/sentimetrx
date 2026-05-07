'use client'

// components/analyze/textmine/FrequencyChart.tsx
//
// Shared time-series chart used by both OpinionPopover (per-word) and
// ThemePopover (per-theme). Bucket granularity scales with the data range
// via lib/timeBucket.autoBucket(); SVG sparkline with Y-axis ticks and
// dated X-axis endpoints.

import { useMemo } from 'react'
import { autoBucket, bucketKey, formatBucketLabel, type TimeBucket } from '@/lib/timeBucket'

const HERMES = '#E8632A'

// Pick the field most likely to hold a row's date by sniffing the first non-empty
// value. Returns null if no field looks like a date.
export function detectDateField(rows: Record<string, unknown>[]): string | null {
  if (rows.length === 0) return null
  const preferred = ['created_at', 'date', 'published_at', 'reviewed_at', 'completed_at', 'submitted_at', 'timestamp', 'posted_at', 'time']
  for (const c of preferred) {
    for (const r of rows) {
      const v = r[c]
      if (typeof v === 'string' && v && !isNaN(Date.parse(v))) return c
    }
  }
  // Generic: any field whose first non-empty value parses as a plausible date
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

/**
 * Compute count-per-bucket for rows whose text fields contain any of `targets`
 * (lowercased). Granularity is auto-chosen from the actual matched-row range.
 * Pass a single word as `[word.toLowerCase()]`, or all keywords of a theme.
 */
export function frequencyBuckets(
  rows: Record<string, unknown>[],
  fieldArr: string[],
  targets: string[],
  dateField: string,
): { buckets: { key: string; count: number }[]; granularity: TimeBucket | null } {
  const lowered = targets.map(t => t.toLowerCase()).filter(Boolean)
  if (lowered.length === 0) return { buckets: [], granularity: null }

  // Drop rows dated in the future (almost certainly bad data — predicted
  // timestamps, off-by-year typos, etc). A small grace window of one day
  // catches recent rows whose timezone snaps the date forward.
  const cutoff = Date.now() + 24 * 60 * 60 * 1000
  const matched: Date[] = []
  for (const row of rows) {
    const dateStr = String(row[dateField] || '')
    if (!dateStr || isNaN(Date.parse(dateStr))) continue
    const ts = Date.parse(dateStr)
    if (ts > cutoff) continue
    let hit = false
    for (const f of fieldArr) {
      const t = String(row[f] || '').toLowerCase()
      for (const target of lowered) {
        if (t.includes(target)) { hit = true; break }
      }
      if (hit) break
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

const HEADLINE: Record<TimeBucket, string> = {
  hour: 'Hourly', day: 'Daily', week: 'Weekly', month: 'Monthly', quarter: 'Quarterly', year: 'Annual',
}

interface Props {
  buckets: { key: string; count: number }[]
  granularity: TimeBucket | null
  /** Override the headline color (defaults to HERMES orange). */
  color?: string
}

export default function FrequencyChart({ buckets, granularity, color = HERMES }: Props) {
  if (!granularity || buckets.length < 2) return null
  const W = 480, H = 80, PT = 8, PB = 14, PL = 30, PR = 8
  const innerW = W - PL - PR
  const innerH = H - PT - PB
  const maxCount = Math.max(...buckets.map(b => b.count), 1)
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
  const ticks = [0, niceMax / 2, niceMax]
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '.06em', marginBottom: 4 }}>
        {HEADLINE[granularity]} frequency · {buckets.length} {granularity === 'hour' ? 'hours' : granularity + 's'}
      </div>
      <svg width="100%" height={H} viewBox={'0 0 ' + W + ' ' + H} preserveAspectRatio="none">
        {ticks.map((t, i) => {
          const y = PT + innerH - (t / niceMax) * innerH
          return (
            <g key={i}>
              <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="#e5e7eb" strokeWidth={1} strokeDasharray={i === 0 ? undefined : '2 3'} />
              <text x={PL - 4} y={y + 3} fontSize={9} fill="#9ca3af" textAnchor="end">{compactNum(t)}</text>
            </g>
          )
        })}
        <path d={fillPath} fill={color} fillOpacity={0.12} />
        <path d={path} fill="none" stroke={color} strokeWidth={1.75} />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={color}>
            <title>{formatBucketLabel(p.key, granularity)}: {p.count}</title>
          </circle>
        ))}
        <text x={PL} y={H - 2} fontSize={9} fill="#9ca3af">{formatBucketLabel(buckets[0].key, granularity)}</text>
        <text x={W - PR} y={H - 2} fontSize={9} fill="#9ca3af" textAnchor="end">{formatBucketLabel(buckets[buckets.length - 1].key, granularity)}</text>
      </svg>
    </div>
  )
}
