'use client'

// components/analyze/ReviewSyncStatus.tsx
// Banner that shows the Google Reviews download state for a dataset:
//   - Before sync: calibrated estimate of reviews we'll actually ingest.
//   - During sync: pending / completed / errored breakdown + ingested count.
//   - After sync: success or partial-completion confirmation, with errors.
//
// Reads from the existing /api/review-sources/[sourceId] endpoint which
// already returns the source + every location's last_synced_at, error_message,
// and Google-reported review_count. We never display Google's raw review_count
// to the user — it's misleadingly high (DataForSEO can only retrieve a
// fraction of what Google reports). All headline numbers in this banner are
// either the calibrated estimate or the actual ingested count.

import { useEffect, useState } from 'react'

interface Location {
  id: string
  name: string
  selected: boolean
  review_count: number | null
  last_synced_at: string | null
  error_message: string | null
}

interface SourceResp {
  source: { id: string; status: string } | null
  locations: Location[]
  datasetRowCount: number
}

const DFS_DEPTH_CAP = 4490
// DataForSEO returns roughly 10–30% of the review_count Google reports for a
// location — the rest sits behind Google's API gating. We use 20% as a
// honest middle-of-road estimate so the banner numbers match what users
// actually see ingested. This is the only place the raw Google count enters
// any user-facing number; downstream we display only this calibrated estimate
// and the actual ingested count.
const TYPICAL_CAPTURE_RATE = 0.20

function estimatedReviewsForLocation(reviewCount: number | null): number {
  const total = reviewCount || 0
  return Math.min(Math.round(total * TYPICAL_CAPTURE_RATE), DFS_DEPTH_CAP)
}

// error_message is also used to stash the in-flight DataForSEO task ref while
// waiting for results. Those serialized refs start with 'pending_task:' so the
// cron knows not to treat them as terminal failures.
function isInFlight(loc: Location): boolean {
  return !loc.last_synced_at && !!loc.error_message && loc.error_message.startsWith('pending_task:')
}
function isHardError(loc: Location): boolean {
  return !!loc.error_message && !loc.error_message.startsWith('pending_task:')
}

interface Props { sourceId: string }

export default function ReviewSyncStatus({ sourceId }: Props) {
  const [data, setData] = useState<SourceResp | null>(null)
  const [showErrors, setShowErrors] = useState(false)

  useEffect(function() {
    let alive = true
    function load() {
      fetch('/api/review-sources/' + sourceId)
        .then(function(r) { return r.ok ? r.json() : null })
        .then(function(d: SourceResp | null) { if (alive && d) setData(d) })
        .catch(function() {})
    }
    load()
    // Re-poll every 20s while the page is open so a sync in progress updates
    // without a manual refresh. Stops when the component unmounts.
    const iv = setInterval(load, 20000)
    return function() { alive = false; clearInterval(iv) }
  }, [sourceId])

  if (!data) return null
  const selected = data.locations.filter(function(l) { return l.selected })
  if (selected.length === 0) return null

  const synced  = selected.filter(function(l) { return !!l.last_synced_at })
  const errored = selected.filter(isHardError).filter(function(l) { return !l.last_synced_at })
  const inFlight = selected.filter(isInFlight)
  const pending = selected.filter(function(l) { return !l.last_synced_at && !l.error_message })

  // Calibrated estimate of how many reviews we expect to actually ingest,
  // not Google's headline count. See estimatedReviewsForLocation above.
  const expected = selected.reduce(function(sum, l) {
    return sum + estimatedReviewsForLocation(l.review_count)
  }, 0)

  const allSynced  = synced.length === selected.length
  const noErrors   = errored.length === 0
  const stillRunning = inFlight.length + pending.length > 0

  let label = ''
  let tone: 'progress' | 'success' | 'warning' | 'idle' = 'idle'

  // Numbers shown to the user: only `expected` (calibrated estimate) and
  // `data.datasetRowCount` (actual ingested). Google's raw review_count is
  // intentionally hidden — it's misleading because DataForSEO can only
  // retrieve a fraction of what Google reports (typically 10–30%).
  if (stillRunning) {
    tone = 'progress'
    label = 'Downloading reviews — ' + synced.length.toLocaleString() + ' of ' + selected.length.toLocaleString() + ' locations done · ' + data.datasetRowCount.toLocaleString() + ' reviews ingested so far (estimated ≈ ' + expected.toLocaleString() + ' total)'
  } else if (allSynced && noErrors) {
    tone = 'success'
    const pct = expected > 0 ? Math.round(data.datasetRowCount / expected * 100) : 100
    label = '✓ Download complete — ' + data.datasetRowCount.toLocaleString() + ' reviews from ' + synced.length.toLocaleString() + ' of ' + selected.length.toLocaleString() + ' locations (' + pct + '% of estimated ' + expected.toLocaleString() + ')'
  } else if (errored.length > 0) {
    tone = 'warning'
    label = 'Download finished with errors — ' + data.datasetRowCount.toLocaleString() + ' reviews from ' + synced.length.toLocaleString() + ' of ' + selected.length.toLocaleString() + ' locations · ' + errored.length.toLocaleString() + ' location' + (errored.length === 1 ? '' : 's') + ' failed'
  } else if (selected.length > 0 && synced.length === 0) {
    tone = 'idle'
    label = 'Ready to download — estimated ≈ ' + expected.toLocaleString() + ' reviews across ' + selected.length.toLocaleString() + ' locations'
  } else {
    return null
  }

  const bg = tone === 'success' ? '#f0fdf4' : tone === 'warning' ? '#fffbeb' : tone === 'progress' ? '#eff6ff' : '#f9fafb'
  const border = tone === 'success' ? '#86efac' : tone === 'warning' ? '#fcd34d' : tone === 'progress' ? '#93c5fd' : '#e5e7eb'
  const color = tone === 'success' ? '#15803d' : tone === 'warning' ? '#b45309' : tone === 'progress' ? '#1d4ed8' : '#374151'

  return (
    <div className="rounded-xl px-4 py-3 text-sm" style={{ background: bg, border: '1px solid ' + border, color: color }}>
      <div className="flex items-center justify-between gap-3">
        <span style={{ fontWeight: 600 }}>{label}</span>
        {errored.length > 0 && (
          <button onClick={function() { setShowErrors(function(v) { return !v }) }}
            className="text-xs font-semibold underline whitespace-nowrap" style={{ color: color }}>
            {showErrors ? 'Hide' : 'Show errors'}
          </button>
        )}
      </div>
      {showErrors && errored.length > 0 && (
        <ul className="mt-2 text-xs flex flex-col gap-1" style={{ color: '#7c2d12' }}>
          {errored.slice(0, 10).map(function(l) {
            return <li key={l.id}><b>{l.name}</b>: {(l.error_message || '').slice(0, 200)}</li>
          })}
          {errored.length > 10 && <li>+{errored.length - 10} more</li>}
        </ul>
      )}
    </div>
  )
}
