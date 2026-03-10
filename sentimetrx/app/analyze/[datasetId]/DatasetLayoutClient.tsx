'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import TopNav from '@/components/nav/TopNav'

interface DatasetMeta {
  id:             string
  name:           string
  source:         string
  study_id:       string | null
  visibility:     'private' | 'public'
  status:         string
  row_count:      number
  last_synced_at: string | null
  created_by:     string
}

interface Props {
  children:   React.ReactNode
  dataset:    DatasetMeta
  studyName:  string
  datasetId:  string
  user: {
    email:    string
    fullName: string
    isAdmin:  boolean
    userId:   string
  }
  orgName:   string
  logoUrl:   string
  isOwner:   boolean
}

const HERMES = '#E8632A'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2) return 'just now'
  if (mins < 60) return mins + 'm ago'
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return hrs + 'h ago'
  return Math.floor(hrs / 24) + 'd ago'
}

export default function DatasetLayoutClient({
  children, dataset, studyName, datasetId, user, orgName, logoUrl, isOwner
}: Props) {
  const pathname = usePathname()
  const router   = useRouter()
  const [syncing, setSyncing]   = useState(false)
  const [syncMsg, setSyncMsg]   = useState('')

  const tabs = [
    { key: 'textmine',  label: 'TextMine',   href: '/analyze/' + datasetId + '/textmine' },
    { key: 'charts',    label: 'Charts',     href: '/analyze/' + datasetId + '/charts' },
    { key: 'stats',     label: 'Statistics', href: '/analyze/' + datasetId + '/stats' },
    { key: 'settings',  label: 'Settings',   href: '/analyze/' + datasetId + '/settings' },
  ]

  async function handleSync() {
    setSyncing(true)
    setSyncMsg('')
    try {
      const res = await fetch('/api/datasets/' + datasetId + '/sync', { method: 'POST' })
      const data = await res.json()
      if (data.synced > 0) {
        setSyncMsg(data.synced + ' new responses added')
      } else {
        setSyncMsg('Already up to date')
      }
      router.refresh()
    } catch {
      setSyncMsg('Sync failed')
    } finally {
      setSyncing(false)
      setTimeout(() => setSyncMsg(''), 3000)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav
        logoUrl={logoUrl}
        orgName={orgName}
        isAdmin={user.isAdmin}
        userEmail={user.email}
        fullName={user.fullName}
        analyzeEnabled={true}
        currentPage="analyze"
      />

      <div className="pt-14">
        {/* Dataset header */}
        <div className="bg-white border-b border-gray-200 px-5 py-4">
          <div className="max-w-7xl mx-auto">

            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-sm text-gray-400 mb-3">
              <Link href="/analyze" className="hover:text-orange-600 transition-colors">Analyze</Link>
              <span>/</span>
              <span className="text-gray-700 font-medium truncate max-w-xs">{dataset.name}</span>
            </div>

            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3 flex-wrap">
                {/* Dataset name */}
                <h1 className="text-xl font-bold text-gray-900">{dataset.name}</h1>

                {/* Source badge */}
                {dataset.source === 'study' ? (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: '#fff4ef', color: HERMES, border: '1px solid #fbd5c2' }}>
                    {'Survey: ' + studyName}
                  </span>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600 border border-gray-200">
                    Upload
                  </span>
                )}

                {/* Visibility */}
                <span className={"text-xs px-2 py-0.5 rounded-full font-medium " +
                  (dataset.visibility === 'public'
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : 'bg-gray-100 text-gray-500 border border-gray-200')}>
                  {dataset.visibility}
                </span>

                {/* Row count */}
                <span className="text-sm text-gray-500">
                  {dataset.row_count.toLocaleString() + ' rows'}
                </span>

                {/* Last synced */}
                {dataset.last_synced_at && (
                  <span className="text-sm text-gray-400">
                    {'Synced ' + timeAgo(dataset.last_synced_at)}
                  </span>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                {syncMsg && (
                  <span className="text-sm text-gray-500">{syncMsg}</span>
                )}
                {dataset.source === 'study' && (
                  <button onClick={handleSync} disabled={syncing}
                    className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                    {syncing ? 'Syncing...' : 'Sync'}
                  </button>
                )}
                <Link href={'/analyze/' + datasetId + '/settings'}
                  className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                  Settings
                </Link>
              </div>
            </div>

            {/* Module tab bar */}
            <div className="flex items-center gap-1 mt-4 -mb-4">
              {tabs.map(tab => {
                const active = pathname.includes('/' + tab.key)
                return (
                  <Link key={tab.key} href={tab.href}
                    className={"text-sm font-medium px-4 py-2 border-b-2 transition-colors whitespace-nowrap " +
                      (active
                        ? 'border-orange-500 text-orange-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700')}>
                    {tab.label}
                  </Link>
                )
              })}
            </div>
          </div>
        </div>

        {/* Page content */}
        <div className="max-w-7xl mx-auto px-5 py-6">
          {children}
        </div>
      </div>
    </div>
  )
}
