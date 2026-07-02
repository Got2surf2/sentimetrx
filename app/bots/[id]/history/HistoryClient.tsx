'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import TopNav from '@/components/nav/TopNav'
import LottieLoader from '@/components/ui/LottieLoader'
import type { ModuleFeatures } from '@/lib/types'

interface Entry {
  id: string
  bot_id: string
  org_id: string
  actor_id: string | null
  actor_email: string | null
  action: string
  summary: string
  before: any
  after: any
  metadata: Record<string, any>
  created_at: string
}

interface Props {
  botId: string
  botName: string
  botSlug: string
  botCreatedAt: string
  botUpdatedAt: string
  logoUrl?: string
  orgName?: string
  isAdmin: boolean
  userEmail: string
  fullName?: string
  features?: ModuleFeatures
}

const ACTION_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  create: { bg: '#d1fae5', text: '#065f46', label: 'Created' },
  update: { bg: '#dbeafe', text: '#1e40af', label: 'Updated' },
  status_change: { bg: '#fef3c7', text: '#92400e', label: 'Status' },
  delete: { bg: '#fee2e2', text: '#991b1b', label: 'Deleted' },
  knowledge_added: { bg: '#ede9fe', text: '#5b21b6', label: 'KB added' },
  knowledge_cleared: { bg: '#fecaca', text: '#7f1d1d', label: 'KB cleared' },
  import: { bg: '#e0e7ff', text: '#3730a3', label: 'Imported' },
}

function formatRelative(iso: string) {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60000) return 'just now'
  if (ms < 3600000) return Math.floor(ms / 60000) + ' min ago'
  if (ms < 86400000) return Math.floor(ms / 3600000) + ' h ago'
  const days = Math.floor(ms / 86400000)
  if (days < 30) return days + ' d ago'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function HistoryClient({
  botId, botName, botSlug, botCreatedAt, botUpdatedAt,
  logoUrl, orgName, isAdmin, userEmail, fullName, features,
}: Props) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  useEffect(() => {
    fetch('/api/bots/' + botId + '/history')
      .then(r => r.json())
      .then(d => {
        if (d?.error) setError(d.error)
        else setEntries(Array.isArray(d?.entries) ? d.entries : [])
      })
      .catch(() => setError('Failed to load history'))
      .finally(() => setLoading(false))
  }, [botId])

  return (
    <div className='min-h-screen bg-gray-50'>
      <TopNav logoUrl={logoUrl} orgName={orgName} isAdmin={isAdmin} userEmail={userEmail} fullName={fullName} currentPage='bots' features={features} />

      <div className='max-w-4xl mx-auto px-4 py-8'>
        <div className='mb-2 text-xs text-gray-500'>
          <Link href='/bots' className='hover:underline'>Agents</Link> / <span className='text-gray-700'>{botName}</span> / History
        </div>
        <div className='flex items-end justify-between mb-6 flex-wrap gap-3'>
          <div>
            <h1 className='text-2xl font-semibold text-gray-900'>{botName} — change history</h1>
            <p className='text-sm text-gray-600 mt-1'>
              /b/{botSlug} &nbsp;·&nbsp; Created {new Date(botCreatedAt).toLocaleDateString()} &nbsp;·&nbsp; Last updated {formatRelative(botUpdatedAt)}
            </p>
          </div>
          <div className='flex gap-2'>
            <a
              href={'/api/bots/' + botId + '/export'}
              className='px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-white'
            >Export JSON</a>
            <Link
              href={'/bots/new?edit=' + botId}
              className='px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-white'
            >Edit agent</Link>
          </div>
        </div>

        {loading && <div className='flex justify-center py-16'><LottieLoader size={64} /></div>}
        {error && <div className='bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm'>{error}</div>}

        {!loading && !error && entries.length === 0 && (
          <div className='bg-white border border-dashed border-gray-300 rounded-lg p-10 text-center text-gray-500'>
            <div className='text-sm'>No change events recorded yet.</div>
            <div className='text-xs mt-1'>The change log started on 2026-05-19. Earlier mutations are not retroactively visible.</div>
          </div>
        )}

        {!loading && !error && entries.length > 0 && (
          <div className='bg-white border border-gray-200 rounded-lg divide-y divide-gray-200'>
            {entries.map(e => {
              const style = ACTION_STYLES[e.action] || { bg: '#f3f4f6', text: '#374151', label: e.action }
              const isOpen = !!expanded[e.id]
              const hasDiff = !!(e.before && Object.keys(e.before).length > 0) || !!(e.after && Object.keys(e.after).length > 0)
              return (
                <div key={e.id} className='p-4'>
                  <div className='flex items-start gap-3'>
                    <span
                      className='px-2 py-0.5 rounded-md text-xs font-semibold whitespace-nowrap'
                      style={{ background: style.bg, color: style.text }}
                    >{style.label}</span>
                    <div className='flex-1 min-w-0'>
                      <div className='text-sm text-gray-900'>{e.summary}</div>
                      <div className='text-xs text-gray-500 mt-0.5'>
                        {formatRelative(e.created_at)} ·{' '}
                        <span title={new Date(e.created_at).toLocaleString()}>{new Date(e.created_at).toLocaleString()}</span>
                        {' · '}
                        {e.actor_email ? <span>{e.actor_email}</span> : <span className='italic'>system / unknown</span>}
                      </div>
                    </div>
                    {hasDiff && (
                      <button
                        onClick={() => setExpanded(prev => ({ ...prev, [e.id]: !prev[e.id] }))}
                        className='text-xs text-blue-700 hover:underline whitespace-nowrap'
                      >{isOpen ? 'Hide' : 'Show diff'}</button>
                    )}
                  </div>
                  {isOpen && hasDiff && (
                    <div className='mt-3 grid grid-cols-2 gap-3 text-xs'>
                      <div>
                        <div className='font-semibold text-gray-600 mb-1'>Before</div>
                        <pre className='bg-red-50 border border-red-200 rounded p-2 overflow-auto max-h-64 whitespace-pre-wrap'>{JSON.stringify(e.before || {}, null, 2)}</pre>
                      </div>
                      <div>
                        <div className='font-semibold text-gray-600 mb-1'>After</div>
                        <pre className='bg-emerald-50 border border-emerald-200 rounded p-2 overflow-auto max-h-64 whitespace-pre-wrap'>{JSON.stringify(e.after || {}, null, 2)}</pre>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <p className='mt-6 text-xs text-gray-500'>
          Showing up to 100 most-recent events. Entries are immutable — they remain until the bot itself is deleted (cascade).
        </p>
      </div>
    </div>
  )
}
