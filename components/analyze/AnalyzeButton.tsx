'use client'
// components/analyze/AnalyzeButton.tsx
// Study → Analyze bridge.
// First time: creates dataset, syncs responses, auto-builds schema from study config, goes to TextMine.
// Subsequent: syncs new responses, preserves schema/themes, goes to TextMine.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  studyId: string
}

var HERMES = '#E8632A'

export default function AnalyzeButton({ studyId }: Props) {
  var router = useRouter()
  var [loading, setLoading] = useState(false)
  var [status, setStatus] = useState('')
  var [error, setError] = useState('')

  async function handleClick() {
    setLoading(true)
    setError('')
    setStatus('Checking for existing dataset...')

    try {
      // Check for existing dataset linked to this study
      var listRes = await fetch('/api/datasets')
      var listData = await listRes.json()
      var existing = (listData.datasets || []).find(
        function(d: any) { return d.source === 'study' && d.study_id === studyId }
      )

      if (existing) {
        // Dataset exists — sync new responses and navigate
        setStatus('Syncing new responses...')
        var syncRes = await fetch('/api/datasets/' + existing.id + '/sync', { method: 'POST' })
        var syncData = await syncRes.json().catch(function() { return {} as any })

        if (!syncRes.ok) {
          var detail = syncData.detail ? ' — ' + syncData.detail : ''
          throw new Error((syncData.error || 'Sync failed') + detail)
        }

        if (syncData.synced > 0) {
          window.location.href = '/analyze/' + existing.id + '/textmine?synced=' + syncData.synced
        } else {
          window.location.href = '/analyze/' + existing.id + '/textmine'
        }
      } else {
        // First time — fetch study config to get industry for ana_library
        setStatus('Loading study configuration...')
        var studyRes = await fetch('/api/studies/' + studyId)
        var studyData = studyRes.ok ? await studyRes.json() : null
        var studyName = studyData?.name || 'Study Data'
        var industry = studyData?.config?.industry || ''
        var anaLibrary = (industry && industry !== 'other') ? industry : ''

        // Create dataset with industry mapping
        setStatus('Creating dataset...')
        var createRes = await fetch('/api/datasets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: studyName + ' \u2014 Analytics',
            source: 'study',
            study_id: studyId,
            visibility: 'private',
            ana_library: anaLibrary || null,
          }),
        })

        if (!createRes.ok) throw new Error('Failed to create dataset')
        var createData = await createRes.json()
        var datasetId = createData.id

        // Auto-setup schema + industry themes FIRST (before sync, so schema exists)
        setStatus('Building schema from study...')
        var setupRes = await fetch('/api/datasets/' + datasetId + '/auto-setup', { method: 'POST' })
        if (!setupRes.ok) throw new Error('Failed to build schema')

        // Sync responses into dataset rows
        setStatus('Importing responses...')
        var syncRes2 = await fetch('/api/datasets/' + datasetId + '/sync', { method: 'POST' })
        var syncResult = await syncRes2.json().catch(function() { return {} as any })
        if (!syncRes2.ok) {
          var detail = syncResult.detail ? ' — ' + syncResult.detail : ''
          throw new Error((syncResult.error || 'Failed to import responses') + detail)
        }
        if (syncResult.synced === 0) {
          console.warn('[AnalyzeButton] Sync returned 0 rows:', syncResult.debug || syncResult)
        }

        // Compute analytics
        setStatus('Computing analytics...')
        await fetch('/api/datasets/' + datasetId + '/compute', { method: 'POST' }).catch(function() {})

        // Go straight to TextMine — full page load to ensure fresh server data
        window.location.href = '/analyze/' + datasetId + '/textmine?new=1'
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
      setLoading(false)
      setStatus('')
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button onClick={function() { void handleClick() }} disabled={loading}
        style={{ padding: '8px 18px', fontSize: 13, fontWeight: 700, borderRadius: 8, color: 'white', background: loading ? HERMES + 'cc' : HERMES, border: 'none', cursor: loading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'opacity .15s' }}>
        {loading ? (
          <>
            <span style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(255,255,255,.4)', borderTopColor: 'white', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />
            {status || 'Loading...'}
          </>
        ) : 'Analyze in Ana'}
      </button>
      {error && <span style={{ fontSize: 12, color: '#dc2626' }}>{error}</span>}
    </div>
  )
}


