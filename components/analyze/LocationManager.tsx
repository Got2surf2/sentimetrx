'use client'

// components/analyze/LocationManager.tsx
// Shows sync status per location, toggle on/off, manual sync trigger
// Auto-polls sync in batches when unsynced locations exist

import { useState, useEffect, useRef } from 'react'

const HERMES = '#E8632A'

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
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [autoSyncing, setAutoSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number; reviews: number } | null>(null)
  const autoSyncRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(function() {
    loadSource(true)
  }, [sourceId])

  function loadSource(autoStart?: boolean) {
    fetch('/api/review-sources/' + sourceId)
      .then(function(r) { return r.json() })
      .then(function(data) {
        setSource(data.source)
        setLocations(data.locations || [])
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
    setSyncProgress({ done: alreadySynced, total: totalSelected, reviews: 0 })

    let totalReviews = 0
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
        const errored = data.locations_errored || 0
        const remaining = data.locations_remaining || 0
        const errors = data.errors || []
        setSyncProgress({ done: done, total: totalSelected, reviews: totalReviews })

        // Show errors inline but keep going
        if (errors.length > 0) {
          setSyncResult('Warning: ' + errors.join('; ').slice(0, 200))
        }

        if (remaining === 0) {
          const errTotal = totalSelected - done
          setSyncResult('Download complete! ' + totalReviews.toLocaleString() + ' reviews from ' + done + ' locations.' +
            (errTotal > 0 ? ' (' + errTotal + ' locations had errors)' : ''))
          break
        }

        // If this batch synced 0 locations AND had errors, something is systematically wrong — stop
        if (data.locations_synced === 0 && errored > 0) {
          setSyncResult('Download stopped — API errors: ' + errors.join('; ').slice(0, 300))
          break
        }

        // Brief pause between batches
        await new Promise(function(r) { setTimeout(r, 2000) })
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

  const totalPulled = locations.reduce(function(sum, l) { return sum + l.total_pulled }, 0)
  const selectedCount = locations.filter(function(l) { return l.selected }).length
  const syncedCount = locations.filter(function(l) { return l.selected && l.last_synced_at }).length
  const errorCount = locations.filter(function(l) { return l.error_message }).length
  const unsyncedCount = selectedCount - syncedCount

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-gray-800">Google Reviews — {source.brand_name}</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {syncedCount}/{selectedCount} locations synced · {totalPulled.toLocaleString()} reviews pulled
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

      {/* Download progress bar */}
      {(autoSyncing || syncProgress) && syncProgress && (
        <div className="flex flex-col gap-2">
          <div className="flex justify-between text-xs text-gray-500">
            <span>Downloading reviews... {syncProgress.done}/{syncProgress.total} locations ({syncProgress.reviews.toLocaleString()} reviews)</span>
            <span>{Math.round((syncProgress.done / syncProgress.total) * 100)}%</span>
          </div>
          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{
              width: Math.round((syncProgress.done / syncProgress.total) * 100) + '%',
              background: HERMES
            }} />
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
          {locations.filter(function(l) { return l.error_message }).map(function(l) {
            return <p key={l.id} className="text-red-500">{l.name}: {l.error_message}</p>
          })}
        </div>
      )}

      <div style={{ maxHeight: 300, overflowY: 'auto' }} className="flex flex-col gap-1">
        {locations.map(function(loc) {
          return (
            <div key={loc.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors text-sm">
              <div className={'w-2 h-2 rounded-full flex-shrink-0 ' + (loc.error_message ? 'bg-red-400' : loc.last_synced_at ? 'bg-green-400' : 'bg-gray-300')} />
              <div className="flex-1 min-w-0">
                <p className="text-gray-700 truncate">{loc.name}</p>
                <p className="text-xs text-gray-400 truncate">{loc.address || [loc.city, loc.state].filter(Boolean).join(', ')}</p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0 text-xs text-gray-400">
                {loc.rating != null && <span className="text-yellow-600 font-semibold">{loc.rating} ★</span>}
                <span>{loc.total_pulled.toLocaleString()} pulled</span>
                {loc.last_synced_at && <span>{new Date(loc.last_synced_at).toLocaleDateString()}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
