'use client'

// components/analyze/DatasetMetricStrip.tsx
//
// Slim metric strip rendered below the orange Hermes header on every
// tab of /analyze/[id]. Communicates the buyer-friendly framing the
// product wants to lead with: a small dataset that "feels small" by
// row count alone gets its real size from the signal/theme-fit pair.
//
//   480 records  ·  12,400 signals  ·  Theme fit  Tight  79% ▓▓▓▓▓▓▓▓░░
//
// Data fetched once per mount from /api/datasets/[id]/signal-stats.
// Skeleton + small Lottie spinner stands in until the response lands
// (the underlying RPC takes 1–4s on collection datasets).

import { useEffect, useState, type CSSProperties } from 'react'
import LottieLoader from '@/components/ui/LottieLoader'

interface SignalStats {
  records: number
  signals: number
  inThemes: number
  themeFitPct: number
  themeFitBand: 'Tight' | 'Mixed' | 'Diffuse'
  themeCount: number
  dateMin?: string | null
  dateMax?: string | null
  avgRating?: number | null
  ratingMax?: number | null
  ratingLabel?: string | null
}

// `embedded` strips the component's own bar wrapper (border/background/padding)
// so it can sit inside a shared row alongside the ViewsBar — the metrics + view
// switcher share ONE row instead of stacking two (reclaims a row on every tab).
interface Props { datasetId: string; embedded?: boolean }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDate(d: string): string {
  const m = String(d).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : String(d).slice(0, 10)
}

const BAND_STYLES: Record<SignalStats['themeFitBand'], { fg: string; bg: string; border: string }> = {
  Tight:   { fg: '#047857', bg: '#ecfdf5', border: '#a7f3d0' },
  Mixed:   { fg: '#92400e', bg: '#fffbeb', border: '#fde68a' },
  Diffuse: { fg: '#9f1239', bg: '#fff1f2', border: '#fecdd3' },
}

export default function DatasetMetricStrip({ datasetId, embedded }: Props) {
  const [stats, setStats] = useState<SignalStats | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(function() {
    let cancelled = false
    fetch('/api/datasets/' + datasetId + '/signal-stats')
      .then(function(r) { return r.ok ? r.json() : null })
      .then(function(d) {
        if (cancelled) return
        if (d && typeof d.records === 'number') setStats(d as SignalStats)
        setLoaded(true)
      })
      .catch(function() { if (!cancelled) setLoaded(true) })
    return function() { cancelled = true }
  }, [datasetId])

  // Loading placeholder
  if (!loaded) {
    const loadStyle: CSSProperties = embedded
      ? { display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, minWidth: 0 }
      : { background: '#fafafa', borderBottom: '1px solid #e8e8ec', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, fontSize: 12 }
    return (
      <div style={loadStyle}>
        <span style={{ display: 'inline-block', height: 14, width: 220, background: '#e5e7eb', borderRadius: 7 }} />
        <span style={{ color: '#9ca3af' }}>·</span>
        <span style={{ display: 'inline-block', height: 14, width: 180, background: '#e5e7eb', borderRadius: 7 }} />
        <LottieLoader size={18} />
      </div>
    )
  }

  // No themes / no signal — render nothing rather than an empty strip
  if (!stats || stats.themeCount === 0 || stats.records === 0) {
    return null
  }

  const band = BAND_STYLES[stats.themeFitBand]
  const barFill = Math.max(0, Math.min(100, stats.themeFitPct))
  const outerStyle: CSSProperties = embedded
    ? { display: 'flex', alignItems: 'center', gap: 14, fontSize: 12, color: '#374151', flexWrap: 'wrap', minWidth: 0 }
    : { background: '#fafafa', borderBottom: '1px solid #e8e8ec', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0, fontSize: 12, color: '#374151', flexWrap: 'wrap' }

  return (
    <div style={outerStyle}>
      <span>
        <strong style={{ color: '#111827' }}>{stats.records.toLocaleString()}</strong>{' '}
        <span style={{ color: '#6b7280' }}>records</span>
      </span>
      <span style={{ color: '#d1d5db' }}>·</span>
      <span title="Sum of per-theme record matches. A row mentioning multiple themes contributes to multiple counts.">
        <strong style={{ color: '#111827' }}>{stats.signals.toLocaleString()}</strong>{' '}
        <span style={{ color: '#6b7280' }}>signals</span>
      </span>
      <span style={{ color: '#d1d5db' }}>·</span>
      <span
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
        title={
          stats.themeFitPct + '% of records (' + stats.inThemes.toLocaleString() +
          ' of ' + stats.records.toLocaleString() + ') match at least one of the ' +
          stats.themeCount + ' themes. ' +
          (stats.themeFitBand === 'Tight'
            ? 'Tight: themes capture most of the signal — ready to action.'
            : stats.themeFitBand === 'Mixed'
              ? 'Mixed: multi-topic dataset, partial theme coverage.'
              : 'Diffuse: lots of unstructured content; consider adding themes or segmenting by source.')
        }
      >
        <span style={{ color: '#6b7280' }}>Theme fit</span>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: band.bg, color: band.fg, border: '1px solid ' + band.border }}>
          {stats.themeFitBand}
        </span>
        <strong style={{ color: '#111827' }}>{stats.themeFitPct}%</strong>
        <span aria-hidden style={{ display: 'inline-block', height: 8, width: 80, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
          <span style={{ display: 'block', height: '100%', width: barFill + '%', background: band.fg }} />
        </span>
      </span>
      <span style={{ color: '#d1d5db' }}>·</span>
      <span>
        <strong style={{ color: '#111827' }}>{stats.themeCount}</strong>{' '}
        <span style={{ color: '#6b7280' }}>themes</span>
      </span>
      {stats.avgRating != null && (function() {
        // green/amber/red by rating relative to its scale max (default 5)
        const max = stats.ratingMax && stats.ratingMax > 0 ? stats.ratingMax : 5
        const frac = stats.avgRating! / max
        const color = frac >= 0.7 ? '#047857' : frac >= 0.5 ? '#92400e' : '#9f1239'
        return (
          <>
            <span style={{ color: '#d1d5db' }}>·</span>
            <span title={'Average ' + (stats.ratingLabel || 'rating') + ' across ALL reviews with a rating (out of ' + max + '), including rating-only reviews with no comment — so it ties back to the rating shown on Google and in a downloaded export. Per-theme and per-dimension ratings are computed only over reviews that have comment text, so they can sit slightly below this number (comment-leavers tend to rate lower).'} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: color }}>{'★'}</span>
              <strong style={{ color: '#111827' }}>{stats.avgRating!.toFixed(1)}</strong>
              <span style={{ color: '#6b7280' }}>avg rating</span>
            </span>
          </>
        )
      })()}
      {stats.dateMin && stats.dateMax && (
        <>
          <span style={{ color: '#d1d5db' }}>·</span>
          <span title="Date range covered by this dataset">
            <span style={{ color: '#6b7280' }}>{'📅'} </span>
            <strong style={{ color: '#111827' }}>{fmtDate(stats.dateMin)} – {fmtDate(stats.dateMax)}</strong>
          </span>
        </>
      )}
    </div>
  )
}
