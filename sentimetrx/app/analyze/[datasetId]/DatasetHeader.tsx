'use client'

// app/analyze/[datasetId]/DatasetHeader.tsx
// Dataset name, source badge, row count, sync, module tab bar

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'

interface DatasetMeta {
  id:             string
  name:           string
  source:         'upload' | 'study'
  visibility:     'private' | 'public'
  status:         'active' | 'archived'
  row_count:      number
  last_synced_at: string | null
  study_name:     string | null
}

interface Props {
  dataset: DatasetMeta
}

const HERMES = '#E8632A'

const TABS = [
  { key: 'textmine',  label: 'TextMine' },
  { key: 'charts',    label: 'Charts' },
  { key: 'stats',     label: 'Statistics' },
  { key: 'settings',  label: 'Settings' },
]

function timeAgo(iso: string): string {
  const diff  = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins < 2)   return 'just now'
  if (mins < 60)  return mins + 'm ago'
  if (hours < 24) return hours + 'h ago'
  return days + 'd ago'
}

export default function DatasetHeader({ dataset }: Props) {
  const router   = useRouter()
  const pathname = usePathname()
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  const activeTab = TABS.find(function(t) { return pathname.endsWith('/' + t.key) })?.key || 'textmine'

  async function handleSync() {
    setSyncing(true)
    setSyncMsg('')
    try {
      const res  = await fetch('/api/datasets/' + dataset.id + '/sync', { method: 'POST' })
      const data = await res.json()
      if (data.synced === 0) {
        setSyncMsg('Already up to date')
      } else {
        setSyncMsg(data.synced + ' new rows added')
        router.refresh()
      }
    } finally {
      setSyncing(false)
      setTimeout(function() { setSyncMsg('') }, 3000)
    }
  }

  return (
    <div className="bg-white border-b border-gray-200 px-4">
      <div className="max-w-6xl mx-auto">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-gray-400 pt-3 pb-1">
          <Link href="/analyze" className="hover:text-gray-600 transition-colors">Analyze</Link>
          <span>/</span>
          <span className="text-gray-600 font-medium truncate max-w-48">{dataset.name}</span>
        </div>

        {/* Main header row */}
        <div className="flex items-center justify-between gap-4 py-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-lg font-bold text-gray-800">{dataset.name}</h1>

            {/* Source badge */}
            {dataset.source === 'study' && dataset.study_name ? (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full text-white" style={{ background: HERMES }}>
                {'Survey: ' + dataset.study_name}
              </span>
            ) : (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                Upload
              </span>
            )}

            {/* Visibility */}
            <span className={'text-xs font-medium px-2 py-0.5 rounded-full border ' +
              (dataset.visibility === 'public' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-400 border-gray-200')}>
              {dataset.visibility}
            </span>

            {/* Row count */}
            <span className="text-xs text-gray-400 font-semibold">{dataset.row_count.toLocaleString()} rows</span>

            {/* Last synced (study datasets only) */}
            {dataset.source === 'study' && dataset.last_synced_at && (
              <span className="text-xs text-gray-400">Synced {timeAgo(dataset.last_synced_at)}</span>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {syncMsg && (
              <span className="text-xs text-green-600 font-medium">{syncMsg}</span>
            )}
            {dataset.source === 'study' && (
              <button
                onClick={handleSync}
                disabled={syncing}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50 transition-all hover:opacity-90"
                style={{ background: HERMES }}
              >
                {syncing ? 'Syncing...' : 'Sync'}
              </button>
            )}
          </div>
        </div>

        {/* Module tab bar */}
        <div className="flex items-center gap-1 pb-0">
          {TABS.map(function(tab) {
            const isActive = activeTab === tab.key
            const href     = '/analyze/' + dataset.id + '/' + tab.key
            return (
              <Link
                key={tab.key}
                href={href}
                className={'px-4 py-2.5 text-sm font-semibold border-b-2 transition-all ' +
                  (isActive ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300')}
              >
                {tab.label}
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
