'use client'
// components/analyze/SyncCadenceControl.tsx
// Lets the user change a Google Reviews source's auto-sync cadence, or
// switch to fully manual (sync only when they click the Sync button).
// Renders inside the dataset's Settings page, just above LocationManager.

import { useEffect, useState } from 'react'

interface Props {
  sourceId: string
}

interface Source {
  id: string
  brand_name: string
  sync_frequency_hours: number
  last_synced_at: string | null
  next_sync_at: string | null
}

const OPTIONS: { value: number; label: string; sub: string }[] = [
  { value:   0, label: 'Manual',   sub: 'Only refresh when I click Sync' },
  { value:   6, label: 'Every 6 hours', sub: '4× per day' },
  { value:  12, label: 'Every 12 hours', sub: '2× per day' },
  { value:  24, label: 'Daily',    sub: 'Every 24 hours (default)' },
  { value:  72, label: 'Every 3 days', sub: 'Lighter touch' },
  { value: 168, label: 'Weekly',   sub: 'Every 7 days' },
]

const HERMES = '#E8632A'

function fmtNextSync(iso: string | null, freq: number): string {
  if (freq === 0) return 'Manual mode — no automatic sync'
  if (!iso) return 'Not scheduled'
  const dt = new Date(iso)
  // Treat far-future sentinel (year 2999) as not-scheduled
  if (dt.getFullYear() > 2100) return 'Not scheduled'
  const ms = dt.getTime() - Date.now()
  if (ms < 0) return 'Due now (next cron will pick it up)'
  const hours = Math.round(ms / 3600000)
  if (hours < 1) return 'In <1 hour'
  if (hours < 24) return `In ${hours}h`
  const days = Math.round(hours / 24)
  return `In ${days}d`
}

export default function SyncCadenceControl({ sourceId }: Props) {
  const [source, setSource] = useState<Source | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(function() {
    fetch('/api/review-sources/' + sourceId)
      .then(function(r) { return r.json() })
      .then(function(d) { if (d.source) setSource(d.source) })
      .catch(function() {})
  }, [sourceId])

  async function changeCadence(hours: number) {
    if (!source || saving) return
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/review-sources/' + sourceId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sync_frequency_hours: hours }),
      })
      if (!res.ok) {
        const d = await res.json().catch(function() { return null })
        throw new Error(d?.error || 'Failed to update')
      }
      setSource(function(prev) { return prev ? { ...prev, sync_frequency_hours: hours } : prev })
      setSavedAt(Date.now())
      setTimeout(function() { setSavedAt(null) }, 2000)
    } catch (e: any) {
      setError(e.message || 'Failed to update')
    } finally {
      setSaving(false)
    }
  }

  if (!source) return null

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-base font-bold text-gray-800">Sync cadence</h2>
          <p className="text-xs text-gray-500 mt-1">
            How often this source pulls new reviews automatically.
            Manual mode disables auto-sync — you'll refresh by clicking Sync in the dataset header.
          </p>
        </div>
        {savedAt && (
          <span className="text-xs font-semibold" style={{ color: HERMES }}>✓ Saved</span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {OPTIONS.map(function(opt) {
          const active = source.sync_frequency_hours === opt.value
          return (
            <button
              key={opt.value}
              onClick={function() { changeCadence(opt.value) }}
              disabled={saving}
              style={{
                padding: '12px 14px', borderRadius: 10, textAlign: 'left',
                background: active ? '#fff4ef' : 'white',
                border: '1.5px solid ' + (active ? HERMES : '#e5e7eb'),
                color: active ? HERMES : '#374151',
                cursor: saving ? 'wait' : 'pointer',
                opacity: saving && !active ? 0.6 : 1,
                transition: 'all 0.12s',
              }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{opt.label}</div>
              <div style={{ fontSize: 11, color: active ? HERMES + 'CC' : '#9ca3af', marginTop: 2 }}>{opt.sub}</div>
            </button>
          )
        })}
      </div>

      <div className="mt-4 flex items-center gap-3 text-xs text-gray-500">
        <span>
          <span className="font-semibold text-gray-700">Last sync:</span>{' '}
          {source.last_synced_at ? new Date(source.last_synced_at).toLocaleString() : 'Never'}
        </span>
        <span className="text-gray-300">·</span>
        <span>
          <span className="font-semibold text-gray-700">Next:</span>{' '}
          {fmtNextSync(source.next_sync_at, source.sync_frequency_hours)}
        </span>
      </div>

      {error && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs">
          {error}
        </div>
      )}
    </div>
  )
}
