'use client'

// components/analyze/LocationManager.tsx
// Shows sync status per location, toggle on/off, manual sync trigger
// Auto-polls sync in batches when unsynced locations exist

import { useState, useEffect, useRef } from 'react'
import LottieLoader from '@/components/ui/LottieLoader'

const HERMES = '#E8632A'

function notifyCompletion(title: string, body: string) {
  // Update page title
  document.title = '\u2705 ' + title
  // Browser notification (if permission granted)
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(title, { body: body, icon: '/favicon.ico' })
  }
}

function requestNotifyPermission() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission()
  }
}

interface Location {
  id: string
  place_id: string
  name: string
  address: string | null
  city: string | null
  state: string | null
  rating: number | null
  review_count: number
  selected: boolean
  total_pulled: number
  last_synced_at: string | null
  error_message: string | null
}

interface Source {
  id: string
  brand_name: string
  status: string
  sync_frequency_hours: number
  last_synced_at: string | null
  next_sync_at: string | null
  error_message: string | null
}

interface Props {
  sourceId: string
}

export default function LocationManager({ sourceId }: Props) {
  const [source, setSource] = useState<Source | null>(null)
  const [locations, setLocations] = useState<Location[]>([])
  const [datasetRowCount, setDatasetRowCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [autoSyncing, setAutoSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number; reviews: number; currentLocation: string | null; pendingLocations: string[] } | null>(null)
  const autoSyncRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const originalTitle = useRef(typeof document !== 'undefined' ? document.title : '')

  useEffect(function() {
    loadSource(true)
  }, [sourceId])

  function loadSource(autoStart?: boolean) {
    fetch('/api/review-sources/' + sourceId)
      .then(function(r) { return r.json() })
      .then(function(data) {
        setSource(data.source)
        setLocations(data.locations || [])
        if (data.datasetRowCount != null) setDatasetRowCount(data.datasetRowCount)
        // Only auto-start on initial mount, never on refresh after stop
        if (autoStart) {
          const unsynced = (data.locations || []).filter(function(l: Location) { return l.selected && !l.last_synced_at && !l.error_message })
          if (unsynced.length > 0 && !autoSyncRef.current) {
            startAutoSync(data.locations || [])
          }
        }
      })
      .catch(function() {})
      .finally(function() { setLoading(false) })
  }

  async function startAutoSync(locs: Location[]) {
    const totalSelected = locs.filter(function(l) { return l.selected }).length
    const alreadySynced = locs.filter(function(l) { return l.selected && l.last_synced_at }).length
    if (alreadySynced >= totalSelected) return

    setAutoSyncing(true)
    autoSyncRef.current = true
    setSyncProgress({ done: alreadySynced, total: totalSelected, reviews: 0, currentLocation: null, pendingLocations: [] })
    requestNotifyPermission()

    let totalReviews = 0
    let totalExpected = 0
    let totalWithComments = 0
    let totalWithoutComments = 0
    let done = alreadySynced

    while (autoSyncRef.current) {
      try {
        abortRef.current = new AbortController()
        const res = await fetch('/api/review-sources/' + sourceId + '/sync', { method: 'POST', signal: abortRef.current.signal })
        const text = await res.text()
        let data: any
        try { data = JSON.parse(text) } catch {
          setSyncResult('Sync error: Server returned non-JSON — ' + text.slice(0, 200))
          break
        }
        if (!res.ok) {
          setSyncResult('Sync error: ' + (data.error || 'Unknown error'))
          break
        }
        totalReviews += data.synced || 0
        done += data.locations_synced || 0
        totalExpected += data.expected_reviews || 0
        totalWithComments += data.with_comments || 0
        totalWithoutComments += data.without_comments || 0
        const errored = data.locations_errored || 0
        const submitted = data.locations_submitted || 0
        const remaining = data.locations_remaining || 0
        const errors = data.errors || []
        const currentLoc = data.processing_location || null
        const pendingLocs = data.pending_locations || []
        setSyncProgress({ done: done, total: totalSelected, reviews: totalReviews, currentLocation: currentLoc, pendingLocations: pendingLocs })
        document.title = '\u23F3 Downloading ' + done + '/' + totalSelected + ' (' + totalReviews.toLocaleString() + ' reviews)'

        // Show status
        if (errors.length > 0) {
          setSyncResult('Warning: ' + errors.join('; ').slice(0, 200))
        } else if (submitted > 0 && data.locations_synced === 0) {
          setSyncResult('Submitted ' + submitted + ' tasks to DataForSEO, waiting for results...')
        }

        if (remaining === 0) {
          const errTotal = totalSelected - done
          var summary = 'Download complete! ' + totalReviews.toLocaleString() + ' reviews from ' + done + ' locations.'
          summary += ' (With comments: ' + totalWithComments.toLocaleString() + ' | Rating only: ' + totalWithoutComments.toLocaleString() + ')'
          if (totalExpected > totalReviews) {
            summary += ' Note: ' + (totalExpected - totalReviews).toLocaleString() + ' older reviews exceed the per-location API limit of 4,490.'
          }
          if (errTotal > 0) summary += ' — ' + errTotal + ' locations had errors'
          setSyncResult(summary)
          notifyCompletion('Download complete', totalReviews.toLocaleString() + ' reviews from ' + done + ' locations')
          break
        }

        // If nothing was synced, submitted, or is pending — only errors remain, stop
        if (data.locations_synced === 0 && submitted === 0 && errored > 0) {
          setSyncResult('Download stopped — API errors: ' + errors.join('; ').slice(0, 300))
          break
        }

        // Refresh location data to show updated per-restaurant counts
        try {
          var refreshRes = await fetch('/api/review-sources/' + sourceId)
          var refreshData = await refreshRes.json()
          if (refreshData.locations) setLocations(refreshData.locations)
        } catch {}

        // Wait before next call — DataForSEO needs 30-90s to process tasks
        await new Promise(function(r) { setTimeout(r, 10000) })
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          setSyncResult('Download stopped.')
        } else {
          setSyncResult('Sync error: ' + (err?.message || 'Network error'))
        }
        break
      }
    }

    autoSyncRef.current = false
    setAutoSyncing(false)
    document.title = originalTitle.current
    // Refresh location data
    loadSource()
  }

  function stopAutoSync() {
    autoSyncRef.current = false
    if (abortRef.current) abortRef.current.abort()
  }

  async function handleSync() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/review-sources/' + sourceId + '/sync', { method: 'POST' })
      const text = await res.text()
      let data: any
      try { data = JSON.parse(text) } catch {
        setSyncResult('Sync failed: Server returned non-JSON — ' + text.slice(0, 200))
        return
      }
      if (res.ok) {
        const remaining = data.locations_remaining || 0
        setSyncResult('Synced ' + data.synced + ' new reviews. Total: ' + data.total.toLocaleString() + (remaining > 0 ? ' (' + remaining + ' locations remaining)' : ''))
        loadSource()
      } else {
        setSyncResult('Sync failed: ' + (data.error || 'Unknown error'))
      }
    } catch (err: any) {
      setSyncResult('Sync failed: ' + (err?.message || 'Unknown error'))
    } finally {
      setSyncing(false)
    }
  }

  async function handlePauseResume() {
    if (!source) return
    const newStatus = source.status === 'active' ? 'paused' : 'active'
    await fetch('/api/review-sources/' + sourceId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    setSource(function(prev) { return prev ? { ...prev, status: newStatus } : prev })
  }

  if (loading) return <div className="bg-white border border-gray-200 rounded-2xl p-6 text-sm text-gray-400">Loading locations...</div>
  if (!source) return null

  const selected = locations.filter(function(l) { return l.selected })
  const totalPulled = locations.reduce(function(sum, l) { return sum + l.total_pulled }, 0)
  const totalEstimated = selected.reduce(function(sum, l) { return sum + l.review_count }, 0)
  const selectedCount = selected.length
  const syncedCount = selected.filter(function(l) { return l.last_synced_at }).length
  const pendingCount = selected.filter(function(l) { return l.error_message?.startsWith('pending_task:') }).length
  const errorCount = selected.filter(function(l) { return l.error_message && !l.error_message.startsWith('pending_task:') }).length
  const queuedCount = selectedCount - syncedCount - pendingCount - errorCount
  const unsyncedCount = selectedCount - syncedCount

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-gray-800">Google Reviews — {source.brand_name}</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {syncedCount}/{selectedCount} locations synced · {datasetRowCount.toLocaleString()} reviews in dataset
            {totalPulled > datasetRowCount && (
              <span className="text-gray-400"> ({totalPulled.toLocaleString()} pulled, {(totalPulled - datasetRowCount).toLocaleString()} outside date range)</span>
            )}
            {source.last_synced_at && (
              <span> · Last synced {new Date(source.last_synced_at).toLocaleDateString()}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handlePauseResume}
            className={'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ' +
              (source.status === 'active'
                ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                : 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100')}>
            {source.status === 'active' ? 'Pause Sync' : 'Resume Sync'}
          </button>
          {autoSyncing ? (
            <button onClick={stopAutoSync}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white hover:opacity-90 transition-all bg-red-500">
              Stop Download
            </button>
          ) : (
            <button onClick={unsyncedCount > 0 ? function() { startAutoSync(locations) } : handleSync}
              disabled={syncing}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50 hover:opacity-90 transition-all"
              style={{ background: HERMES }}>
              {syncing ? 'Syncing...' : unsyncedCount > 0 ? 'Download Reviews (' + unsyncedCount + ' left)' : 'Sync Now'}
            </button>
          )}
        </div>
      </div>

      {/* Location status bar */}
      {selectedCount > 0 && (
        <div>
          <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: '#f3f4f6' }}>
            {syncedCount > 0 && <div style={{ width: (syncedCount / selectedCount * 100) + '%', background: '#22c55e', transition: 'width .5s ease' }} />}
            {pendingCount > 0 && <div style={{ width: (pendingCount / selectedCount * 100) + '%', background: '#eab308', transition: 'width .5s ease' }} />}
            {queuedCount > 0 && <div style={{ width: (queuedCount / selectedCount * 100) + '%', background: '#f97316', transition: 'width .5s ease' }} />}
            {errorCount > 0 && <div style={{ width: (errorCount / selectedCount * 100) + '%', background: '#ef4444', transition: 'width .5s ease' }} />}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 11, color: '#6b7280' }}>
            {syncedCount > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#22c55e', display: 'inline-block' }} />{syncedCount} completed</span>}
            {pendingCount > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#eab308', display: 'inline-block' }} />{pendingCount} in progress</span>}
            {queuedCount > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#f97316', display: 'inline-block' }} />{queuedCount} queued</span>}
            {errorCount > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#ef4444', display: 'inline-block' }} />{errorCount} failed</span>}
          </div>
        </div>
      )}

      {/* Download progress */}
      {autoSyncing && syncProgress && (
        <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 12, padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <LottieLoader size={36} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>
                Downloading reviews... {syncProgress.done}/{syncProgress.total} locations
              </div>
              {syncProgress.currentLocation && (
                <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                  Processing: <strong style={{ color: HERMES }}>{syncProgress.currentLocation}</strong>
                </div>
              )}
              {!syncProgress.currentLocation && syncProgress.pendingLocations.length > 0 && (
                <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                  Waiting for: {syncProgress.pendingLocations.slice(0, 3).join(', ')}{syncProgress.pendingLocations.length > 3 ? ' +' + (syncProgress.pendingLocations.length - 3) + ' more' : ''}
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: HERMES }}>{syncProgress.reviews.toLocaleString()}</div>
              <div style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 600 }}>of {totalEstimated.toLocaleString()} reviews</div>
            </div>
          </div>
          <div style={{ height: 6, background: '#FED7AA', borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
            <div style={{ height: '100%', borderRadius: 3, transition: 'width .5s ease', background: HERMES, width: Math.round((syncProgress.done / syncProgress.total) * 100) + '%' }} />
          </div>
          <div style={{ fontSize: 11, color: '#78716C', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{Math.round((syncProgress.done / syncProgress.total) * 100)}% complete</span>
            <span style={{ fontStyle: 'italic' }}>You can navigate away — we'll notify you when it's done</span>
          </div>
        </div>
      )}

      {source.status === 'paused' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-xs text-amber-700">
          Automatic sync is paused. Click "Resume Sync" to re-enable.
        </div>
      )}

      {source.error_message && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-xs text-red-600">{source.error_message}</div>
      )}

      {syncResult && (
        <div className={'rounded-xl px-4 py-2 text-xs ' + (syncResult.includes('error') || syncResult.includes('failed') || syncResult.includes('stopped') || syncResult.includes('Warning') ? 'bg-red-50 border border-red-200 text-red-600' : 'bg-green-50 border border-green-200 text-green-700')}>
          {syncResult}
        </div>
      )}

      {errorCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-600 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="font-semibold">{errorCount} location(s) failed:</p>
            <button onClick={async function() {
              await fetch('/api/review-sources/' + sourceId + '/locations', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clear_errors: true }),
              })
              loadSource()
            }} className="text-xs font-semibold px-3 py-1 rounded-lg bg-white border border-red-200 text-red-600 hover:bg-red-50">
              Retry Failed
            </button>
          </div>
          {locations.filter(function(l) { return l.error_message && !l.error_message.startsWith('pending_task:') }).map(function(l) {
            return <p key={l.id} className="text-red-500">{l.name}: {l.error_message}</p>
          })}
        </div>
      )}

      <div style={{ maxHeight: 300, overflowY: 'auto' }} className="flex flex-col gap-1">
        {locations.map(function(loc) {
          return (
            <div key={loc.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors text-sm">
              <div className={'w-2 h-2 rounded-full flex-shrink-0 ' + (loc.error_message && !loc.error_message.startsWith('pending_task:') ? 'bg-red-400' : loc.error_message?.startsWith('pending_task:') ? 'bg-amber-400 animate-pulse' : loc.last_synced_at ? 'bg-green-400' : 'bg-gray-300')} />
              <div className="flex-1 min-w-0">
                <p className="text-gray-700 truncate">{loc.name}</p>
                <p className="text-xs text-gray-400 truncate">{loc.address || [loc.city, loc.state].filter(Boolean).join(', ')}</p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0 text-xs text-gray-400">
                {loc.rating != null && <span className="text-yellow-600 font-semibold">{loc.rating} ★</span>}
                <span>{loc.total_pulled.toLocaleString()} of {loc.review_count.toLocaleString()}</span>
                {loc.last_synced_at && <span>{new Date(loc.last_synced_at).toLocaleDateString()}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
