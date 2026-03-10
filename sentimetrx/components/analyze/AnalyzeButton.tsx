'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  studyId: string
}

const HERMES = '#E8632A'

// Checks if a dataset linked to this study already exists,
// then creates or syncs as appropriate.
export default function AnalyzeButton({ studyId }: Props) {
  const router  = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  async function handleClick() {
    setLoading(true)
    setError('')

    try {
      // Check for an existing dataset linked to this study
      const listRes = await fetch('/api/datasets')
      const listData = await listRes.json()
      const existing = (listData.datasets || []).find(
        (d: any) => d.source === 'study' && d.study_id === studyId
      )

      if (existing) {
        // Dataset already exists -- sync and navigate
        const syncRes = await fetch('/api/datasets/' + existing.id + '/sync', { method: 'POST' })
        const syncData = await syncRes.json()

        if (syncData.synced > 0) {
          // Will show toast on the destination page (pass via URL param)
          router.push('/analyze/' + existing.id + '/textmine?synced=' + syncData.synced)
        } else {
          router.push('/analyze/' + existing.id + '/textmine')
        }
      } else {
        // No existing dataset -- create one
        const createRes = await fetch('/api/datasets', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            name:     'Study Data',  // will be overwritten with study name server-side
            source:   'study',
            study_id: studyId,
            visibility: 'private',
          }),
        })

        if (!createRes.ok) throw new Error('Failed to create dataset')
        const { id } = await createRes.json()

        // Initial sync -- loads all responses
        await fetch('/api/datasets/' + id + '/sync', { method: 'POST' })

        // Navigate to schema editor (isNew=1 shows the confirmation banner)
        router.push('/analyze/' + id + '/settings?new=1')
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button onClick={handleClick} disabled={loading}
        className="text-sm font-medium px-4 py-2 rounded-lg text-white disabled:opacity-60 transition-opacity"
        style={{ background: HERMES }}>
        {loading ? 'Loading...' : 'Analyze in Ana'}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  )
}
