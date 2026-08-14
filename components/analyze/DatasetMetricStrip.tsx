'use client'

// components/analyze/DatasetMetricStrip.tsx
//
// Slim metric strip rendered below the orange Hermes header on every
// tab of /analyze/[id]. Communicates the buyer-friendly framing the
// product wants to lead with: a small dataset that "feels small" by
// row count alone gets its real size from the signal/theme-fit pair.
//
//   480 comments  ·  12,400 signals  ·  Theme fit  Tight  79% ▓▓▓▓▓▓▓▓░░
//
// Data fetched once per mount from /api/datasets/[id]/signal-stats.
// Skeleton + small Lottie spinner stands in until the response lands
// (the underlying RPC takes 1–4s on collection datasets).

import { useEffect, useState, type CSSProperties } from 'react'
import LottieLoader from '@/components/ui/LottieLoader'
import { SUBSTANTIVE_RULE_NOTE } from '@/lib/usefulness'

interface SignalStats {
  records: number
  signals: number
  inThemes: number
  themeFitPct: number
  themeFitBand: 'Tight' | 'Mixed' | 'Diffuse'
  /** Substantive-scoped theme fit (sql/179) — the LEAD number; the all-based
   *  trio above stays for the hover. Optional so a cache written before the
   *  twin landed still renders (falls back to the all-based number). */
  substantiveRecords?: number
  inThemesSubstantive?: number
  themeFitPctSubstantive?: number
  themeFitBandSubstantive?: 'Tight' | 'Mixed' | 'Diffuse'
  themeCount: number
  /** counts estimated from the deterministic 50K sample and scaled — set for
   *  datasets above the sampling cap; rendered with "~" + a tooltip note */
  sampled?: boolean
  dateMin?: string | null
  dateMax?: string | null
  avgRating?: number | null
  ratingMax?: number | null
  ratingLabel?: string | null
  /** avg rating estimated over the deterministic 50K sample (large datasets) */
  ratingSampled?: boolean
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
  // Result is KEYED by the field it was fetched for — a key mismatch (pill
  // switched, response not back yet) renders the skeleton, no state reset
  // needed. `stats: null` = fetch finished with nothing to show.
  const [result, setResult] = useState<{ key: string; stats: SignalStats | null } | null>(null)
  // Per-field theme sets: the strip follows TextMine's active Text pill
  // ('dataset-active-field-changed' carries the themeFieldKey). '' = the
  // dataset's active (top-level) set — the default on every other tab.
  const [fieldKey, setFieldKey] = useState('')

  useEffect(function() {
    function onFieldChange(e: Event) {
      const k = (e as CustomEvent<{ fieldKey?: string }>).detail?.fieldKey
      setFieldKey(typeof k === 'string' ? k : '')
    }
    window.addEventListener('dataset-active-field-changed', onFieldChange)
    return function() { window.removeEventListener('dataset-active-field-changed', onFieldChange) }
  }, [])

  useEffect(function() {
    let cancelled = false
    function fetchStats() {
      fetch('/api/datasets/' + datasetId + '/signal-stats' + (fieldKey ? '?field=' + encodeURIComponent(fieldKey) : ''))
        .then(function(r) { return r.ok ? r.json() : null })
        .then(function(d) {
          if (cancelled) return
          setResult({ key: fieldKey, stats: (d && typeof d.records === 'number') ? d as SignalStats : null })
        })
        .catch(function() { if (!cancelled) setResult({ key: fieldKey, stats: null }) })
    }
    fetchStats()
    // Re-fetch when themes change in-session: on a fresh upload the strip
    // mounts with zero themes (renders nothing) and mining now happens in the
    // same visit — without this it stayed invisible until a full reload.
    // 'dataset-themes-saved' fires on every theme-model persist (TextMine);
    // 'ana-themes-changed' on Ana theme edits.
    window.addEventListener('dataset-themes-saved', fetchStats)
    window.addEventListener('ana-themes-changed', fetchStats)
    return function() {
      cancelled = true
      window.removeEventListener('dataset-themes-saved', fetchStats)
      window.removeEventListener('ana-themes-changed', fetchStats)
    }
  }, [datasetId, fieldKey])

  const loaded = result != null && result.key === fieldKey
  const stats = loaded ? result!.stats : null

  // Loading placeholder — also covers a pill switch awaiting that set's
  // stats (non-active sets are uncached, ~1-4s on large datasets).
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

  // A "comment" IS a substantive answer — non-substantive ("N/A"/"Nothing"/
  // one-word) answers are ignored exactly like blanks. So the strip shows ONE
  // comment count (substantive) and the theme fit divides by it. A cache written
  // before sql/179 lacks the substantive fields → fall back to the all-based
  // numbers so the strip never blanks during rollout.
  const hasSubstantive = typeof stats.themeFitPctSubstantive === 'number' && typeof stats.substantiveRecords === 'number'
  // ...and a SECOND guard on the DATA, not just the cache shape. A dataset
  // whose `substantive` flag was never stamped (ingested outside the stamping
  // path — a direct-write script, a legacy import) counts zero substantive
  // rows. Rendering that as "0 comments · 0% of 49,033 answered · Diffuse 0%"
  // reads as a damning verdict on the data when the truth is a missing
  // backfill, and it flatly contradicts the theme cards below, which count the
  // same rows in the thousands (2026-08-13). Fall back to the all-based numbers
  // and drop the substantive share rather than assert a zero we can't defend.
  const substantiveUsable = hasSubstantive && stats.substantiveRecords! > 0
  const commentCount = substantiveUsable ? stats.substantiveRecords! : stats.records
  const inThemes = substantiveUsable ? stats.inThemesSubstantive! : stats.inThemes
  const fitPct = substantiveUsable ? stats.themeFitPctSubstantive! : stats.themeFitPct
  const fitBand = (substantiveUsable ? stats.themeFitBandSubstantive : stats.themeFitBand) || stats.themeFitBand
  const band = BAND_STYLES[fitBand]
  const barFill = Math.max(0, Math.min(100, fitPct))
  const outerStyle: CSSProperties = embedded
    ? { display: 'flex', alignItems: 'center', gap: 14, fontSize: 12, color: '#374151', flexWrap: 'wrap', minWidth: 0 }
    : { background: '#fafafa', borderBottom: '1px solid #e8e8ec', padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0, fontSize: 12, color: '#374151', flexWrap: 'wrap' }

  // Model A (owner 2026-07-14): above the cap we treat the deterministic 50K
  // sample AS the view — the comment/theme counts are EXACT counts of that
  // sample (no scaling to the full dataset, so no "~"). The "◱ Sampled" chip in
  // the header row is the disclosure; the tooltip says the counts are over the
  // sample. (Rating avg keeps its own "~" — it's a ties-to-Google carve-out.)
  const approx = ''
  const sampledNote = stats.sampled
    ? ' These are exact counts over the deterministic 50,000-row sample (the dataset exceeds the exact-count cap, so the sample is the current view).'
    : ''

  // Substantive share of answered comments — the "% substantive" the AI-mined
  // banner used to carry (now folded here so there's one comment count, not two).
  const answered = stats.records || 0
  // Null when the substantive breakdown isn't usable — showing "100% of N
  // answered" off the fallback would imply we measured something we didn't.
  const substPct = substantiveUsable && answered > 0 ? Math.round((commentCount / answered) * 100) : null

  return (
    <div style={outerStyle}>
      <span title={substantiveUsable
        ? commentCount.toLocaleString() + ' of ' + answered.toLocaleString() + ' answered comments carry usable feedback. ' + SUBSTANTIVE_RULE_NOTE + sampledNote
        : commentCount.toLocaleString() + ' answered comments. The usable-feedback breakdown isn’t available for this dataset, so this is the answered count.' + sampledNote}>
        <strong style={{ color: '#111827' }}>{approx}{commentCount.toLocaleString()}</strong>{' '}
        <span style={{ color: '#6b7280' }}>comments</span>
        {substPct != null && (
          <span style={{ color: '#9ca3af' }}> · {substPct}% of {answered.toLocaleString()} answered</span>
        )}
      </span>
      <span style={{ color: '#d1d5db' }}>·</span>
      <span
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
        title={
          fitPct + '% of comments (' + approx + inThemes.toLocaleString() +
          ' of ' + approx + commentCount.toLocaleString() + ') match at least one of the ' +
          stats.themeCount + ' themes. ' + SUBSTANTIVE_RULE_NOTE + sampledNote + ' ' +
          (fitBand === 'Tight'
            ? 'Tight: themes capture most of the signal — ready to action.'
            : fitBand === 'Mixed'
              ? 'Mixed: multi-topic dataset, partial theme coverage.'
              : 'Diffuse: lots of unstructured content; consider adding themes or segmenting by source.')
        }
      >
        <span style={{ color: '#6b7280' }}>Theme fit</span>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: band.bg, color: band.fg, border: '1px solid ' + band.border }}>
          {fitBand}
        </span>
        <strong style={{ color: '#111827' }}>{fitPct}%</strong>
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
            <span title={'Average ' + (stats.ratingLabel || 'rating') + ' across ALL reviews with a rating (out of ' + max + '), including rating-only reviews with no comment — so it ties back to the rating shown on Google and in a downloaded export. Per-theme and per-dimension ratings are computed only over reviews that have comment text, so they can sit slightly below this number (comment-leavers tend to rate lower).' + (stats.ratingSampled ? ' Estimated from a deterministic 50,000-row sample (dataset exceeds the exact-count cap).' : '')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: color }}>{'★'}</span>
              <strong style={{ color: '#111827' }}>{stats.ratingSampled ? '~' : ''}{stats.avgRating!.toFixed(1)}</strong>
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
