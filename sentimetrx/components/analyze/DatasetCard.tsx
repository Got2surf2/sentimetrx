'use client'

import Link from 'next/link'
import type { Dataset } from '@/lib/analyzeTypes'

interface Props {
  dataset:    Dataset
  studyName?: string   // passed in if source === 'study'
  onDelete:   (id: string) => void
  onToggleVisibility: (id: string, current: 'private' | 'public') => void
  onArchive:  (id: string) => void
}

const HERMES = '#E8632A'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return mins + 'm ago'
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return hrs + 'h ago'
  const days = Math.floor(hrs / 24)
  return days + 'd ago'
}

export default function DatasetCard({ dataset, studyName, onDelete, onToggleVisibility, onArchive }: Props) {
  const href = '/analyze/' + dataset.id + '/textmine'

  function handleDelete(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (confirm('Delete "' + dataset.name + '"? This cannot be undone.')) {
      onDelete(dataset.id)
    }
  }

  function handleVisibility(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    onToggleVisibility(dataset.id, dataset.visibility)
  }

  function handleArchive(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    onArchive(dataset.id)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow relative flex flex-col gap-3">

      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <Link href={href} className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 text-base leading-tight truncate hover:text-orange-600 transition-colors">
            {dataset.name}
          </h3>
        </Link>

        {/* Visibility pill */}
        <span className={"text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 " +
          (dataset.visibility === 'public'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-gray-100 text-gray-500 border border-gray-200')}>
          {dataset.visibility}
        </span>
      </div>

      {/* Source badge */}
      <div className="flex items-center gap-2">
        {dataset.source === 'study' ? (
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: '#fff4ef', color: HERMES, border: '1px solid #fbd5c2' }}>
            {'Survey: ' + (studyName || 'Linked Study')}
          </span>
        ) : (
          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600 border border-gray-200">
            Upload
          </span>
        )}
        {dataset.status === 'archived' && (
          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-50 text-amber-700 border border-amber-200">
            Archived
          </span>
        )}
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 text-sm text-gray-500">
        <span>{dataset.row_count.toLocaleString() + ' rows'}</span>
        {dataset.last_synced_at && (
          <span>{'Synced ' + timeAgo(dataset.last_synced_at)}</span>
        )}
        {!dataset.last_synced_at && (
          <span>{'Added ' + timeAgo(dataset.created_at)}</span>
        )}
      </div>

      {/* Action row */}
      <div className="flex items-center justify-between pt-1 border-t border-gray-100">
        <Link href={href}
          className="text-sm font-medium px-3 py-1.5 rounded-lg transition-colors text-white"
          style={{ background: HERMES }}>
          Analyze
        </Link>

        <div className="flex items-center gap-1">
          <button onClick={handleVisibility}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 transition-colors">
            {dataset.visibility === 'private' ? 'Make public' : 'Make private'}
          </button>
          <button onClick={handleArchive}
            className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 transition-colors">
            Archive
          </button>
          <button onClick={handleDelete}
            className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors">
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
