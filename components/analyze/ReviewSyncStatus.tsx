'use client'

// components/analyze/ReviewSyncStatus.tsx
// Banner that shows the Google Reviews download state for a dataset:
//   - Before sync: expected total review count across selected locations.
//   - During sync: pending / completed / errored breakdown + how many reviews
//     have been ingested so far.
//   - After sync: success or partial-completion confirmation, with the list of
//     errored locations on demand.
//
// Reads from the existing /api/review-sources/[sourceId] endpoint which
// already returns the source + every location's last_synced_at, error_message,
// and Google-reported review_count. DataForSEO caps each location's review
// fetch at 4490 (lib/dataforseo.ts:160) so we cap the per-location estimate
// there too.

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

  const expected = selected.reduce(function(sum, l) {
    return sum + Math.min(l.review_count || 0, DFS_DEPTH_CAP)
  }, 0)

  const allSynced  = synced.length === selected.length
  const noErrors   = errored.length === 0
  const stillRunning = inFlight.length + pending.length > 0

  let label = ''
  let tone: 'progress' | 'success' | 'warning' | 'idle' = 'idle'

  if (stillRunning) {
    tone = 'progress'
    label = 'Downloading reviews — ' + synced.length.toLocaleString() + ' of ' + selected.length.toLocaleString() + ' locations done · ' + data.datasetRowCount.toLocaleString() + ' of ≈' + expected.toLocaleString() + ' reviews ingested so far'
  } else if (allSynced && noErrors) {
    tone = 'success'
    label = '✓ Download complete — ' + data.datasetRowCount.toLocaleString() + ' reviews from ' + synced.length.toLocaleString() + ' of ' + selected.length.toLocaleString() + ' locations (expected ≈ ' + expected.toLocaleString() + ')'
  } else if (errored.length > 0) {
    tone = 'warning'
    label = 'Download finished with errors — ' + data.datasetRowCount.toLocaleString() + ' reviews from ' + synced.length.toLocaleString() + ' of ' + selected.length.toLocaleString() + ' locations · ' + errored.length.toLocaleString() + ' location' + (errored.length === 1 ? '' : 's') + ' failed'
  } else if (selected.length > 0 && synced.length === 0) {
    tone = 'idle'
    label = 'Ready to download ≈ ' + expected.toLocaleString() + ' reviews across ' + selected.length.toLocaleString() + ' locations'
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
