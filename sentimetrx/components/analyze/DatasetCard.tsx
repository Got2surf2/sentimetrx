'use client'

// components/analyze/DatasetCard.tsx
// Compact dataset card matching StudyCard look and feel.
// Shows owner, org, row count, source. Supports rename, archive, visibility toggle, delete.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DatasetWithState } from '@/lib/analyzeTypes'

interface Props {
  dataset:             DatasetWithState
  onDelete:            (id: string) => void
  onRename:            (id: string, name: string) => void
  onToggleVisibility:  (id: string, v: 'private' | 'public') => void
  onToggleArchive:     (id: string, s: 'active' | 'archived') => void
}

const HERMES = '#e8622a'

function timeAgo(iso: string): string {
  const diff  = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins < 2)   return 'just now'
  if (mins < 60)  return mins + 'm ago'
  if (hours < 24) return hours + 'h ago'
  if (days < 30)  return days + 'd ago'
  return new Date(iso).toLocaleDateString()
}

export default function DatasetCard({ dataset, onDelete, onRename, onToggleVisibility, onToggleArchive }: Props) {
  const router = useRouter()
  const [menuOpen,   setMenuOpen]   = useState(false)
  const [renaming,   setRenaming]   = useState(false)
  const [renameVal,  setRenameVal]  = useState(dataset.name)
  const [confirmDel, setConfirmDel] = useState(false)
  const [syncing,    setSyncing]    = useState(false)

  const isStudy    = dataset.source === 'study'
  const isArchived = dataset.status === 'archived'

  async function handleSync() {
    setSyncing(true); setMenuOpen(false)
    try {
      const res  = await fetch('/api/datasets/' + dataset.id + '/sync', { method: 'POST' })
      const data = await res.json()
      if (data.synced === 0) alert('Already up to date — no new responses.')
      else router.refresh()
    } finally { setSyncing(false) }
  }

  function handleRenameSubmit() {
    if (renameVal.trim() && renameVal !== dataset.name) onRename(dataset.id, renameVal.trim())
    setRenaming(false); setMenuOpen(false)
  }

  function handleDelete() {
    if (confirmDel) { onDelete(dataset.id); setMenuOpen(false) }
    else setConfirmDel(true)
  }

  // Source badge
  const sourceBg    = isStudy ? HERMES : '#6b7280'
  const sourceLabel = isStudy ? ('Survey: ' + (dataset.study_name || 'Linked')) : 'Upload'

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-3 relative"
      style={{ opacity: isArchived ? 0.7 : 1 }}>

      {/* Top: name + menu */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {renaming ? (
            <div className="flex gap-2">
              <input value={renameVal} onChange={function(e) { setRenameVal(e.target.value) }} autoFocus
                onKeyDown={function(e) { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') { setRenaming(false); setRenameVal(dataset.name) } }}
                className="flex-1 px-3 py-1 rounded-lg border border-orange-400 text-sm text-gray-800 outline-none min-w-0" />
              <button onClick={handleRenameSubmit} className="text-xs font-bold text-white px-2.5 py-1 rounded-lg flex-shrink-0" style={{ background: HERMES }}>Save</button>
              <button onClick={function() { setRenaming(false); setRenameVal(dataset.name) }} className="text-xs text-gray-400 px-1">✕</button>
            </div>
          ) : (
            <h3 className="font-bold text-gray-800 text-sm leading-snug line-clamp-2">{dataset.name}</h3>
          )}
        </div>

        {/* Three-dot menu */}
        <div className="relative flex-shrink-0">
          <button onClick={function() { setMenuOpen(function(v) { return !v }) }}
            className="text-gray-400 hover:text-gray-600 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors text-base leading-none font-bold">
            ···
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-8 bg-white border border-gray-200 rounded-xl shadow-lg z-20 w-48 py-1">
              <button onClick={function() { setRenaming(true); setMenuOpen(false) }}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Rename</button>
              <button onClick={function() { onToggleVisibility(dataset.id, dataset.visibility === 'private' ? 'public' : 'private'); setMenuOpen(false) }}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                {dataset.visibility === 'private' ? 'Make public' : 'Make private'}
              </button>
              <button onClick={function() { onToggleArchive(dataset.id, isArchived ? 'active' : 'archived'); setMenuOpen(false) }}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                {isArchived ? 'Unarchive' : 'Archive'}
              </button>
              {isStudy && (
                <button onClick={handleSync} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                  {syncing ? 'Syncing...' : 'Sync responses'}
                </button>
              )}
              <div className="h-px bg-gray-100 my-1" />
              <button onClick={handleDelete}
                className={'w-full text-left px-4 py-2 text-sm ' + (confirmDel ? 'text-red-600 font-semibold' : 'text-red-500 hover:bg-red-50')}>
                {confirmDel ? 'Confirm delete?' : 'Delete'}
              </button>
              {confirmDel && (
                <button onClick={function() { setConfirmDel(false) }}
                  className="w-full text-left px-4 py-2 text-xs text-gray-400 hover:bg-gray-50">Cancel</button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Badges */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-white" style={{ background: sourceBg }}>
          {sourceLabel}
        </span>
        <span className={'text-xs font-medium px-2 py-0.5 rounded-full border ' +
          (dataset.visibility === 'public' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-500 border-gray-200')}>
          {dataset.visibility}
        </span>
        {isArchived && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Archived</span>
        )}
      </div>

      {/* Stats row */}
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span className="font-semibold text-gray-600">{dataset.row_count.toLocaleString()} rows</span>
        <span>{timeAgo(dataset.updated_at)}</span>
      </div>

      {/* Owner / org */}
      {(dataset.client_id || dataset.created_by) && (
        <div className="text-xs text-gray-400 flex items-center gap-1.5 border-t border-gray-100 pt-2">
          <span className="w-4 h-4 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-xs font-bold flex-shrink-0">
            {'\u25a0'}
          </span>
          <span className="truncate">
            {dataset.client_id ? ('Client: ' + dataset.client_id) : 'Personal dataset'}
          </span>
        </div>
      )}

      {/* Analyze button */}
      <button
        onClick={function() { router.push('/analyze/' + dataset.id + '/textmine') }}
        disabled={isArchived}
        className="w-full py-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed mt-auto"
        style={{ background: HERMES }}
      >
        {isArchived ? 'Archived' : 'Analyze in Ana \u2192'}
      </button>

      {menuOpen && <div className="fixed inset-0 z-10" onClick={function() { setMenuOpen(false); setConfirmDel(false) }} />}
    </div>
  )
}
