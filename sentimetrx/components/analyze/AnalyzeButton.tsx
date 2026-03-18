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
        var syncData = await syncRes.json()

        if (syncData.synced > 0) {
          router.push('/analyze/' + existing.id + '/textmine?synced=' + syncData.synced)
        } else {
          router.push('/analyze/' + existing.id + '/textmine')
        }
      } else {
        // First time — create dataset
        setStatus('Creating dataset...')
        var createRes = await fetch('/api/datasets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Study Data',
            source: 'study',
            study_id: studyId,
            visibility: 'private',
          }),
        })

        if (!createRes.ok) throw new Error('Failed to create dataset')
        var createData = await createRes.json()
        var datasetId = createData.id

        // Initial sync
        setStatus('Importing responses...')
        await fetch('/api/datasets/' + datasetId + '/sync', { method: 'POST' })

        // Auto-setup schema from study config
        setStatus('Building schema from study...')
        var setupRes = await fetch('/api/datasets/' + datasetId + '/auto-setup', { method: 'POST' })
        if (setupRes.ok) {
          var setupData = await setupRes.json()
          if (setupData.needsReview) {
            // Schema built but needs user review (e.g. missing question types)
            router.push('/analyze/' + datasetId + '/settings?new=1')
            return
          }
        }

        // Compute analytics
        setStatus('Computing analytics...')
        await fetch('/api/datasets/' + datasetId + '/compute', { method: 'POST' }).catch(function() {})

        // Go straight to TextMine
        router.push('/analyze/' + datasetId + '/textmine?new=1')
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
      setLoading(false)
      setStatus('')
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button onClick={handleClick} disabled={loading}
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
