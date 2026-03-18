'use client'

// components/analyze/DatasetCard.tsx
// Mirrors StudyCard pattern -- shows dataset name, source badge, row count, actions

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DatasetWithState } from '@/lib/analyzeTypes'

interface Props {
  dataset:   DatasetWithState
  onDelete:  (id: string) => void
  onRename:  (id: string, name: string) => void
  onToggleVisibility: (id: string, v: 'private' | 'public') => void
}

const HERMES = '#E8632A'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins < 2)   return 'just now'
  if (mins < 60)  return mins + 'm ago'
  if (hours < 24) return hours + 'h ago'
  if (days < 30)  return days + 'd ago'
  return new Date(iso).toLocaleDateString()
}

export default function DatasetCard({ dataset, onDelete, onRename, onToggleVisibility }: Props) {
  const router = useRouter()
  const [menuOpen,    setMenuOpen]    = useState(false)
  const [renaming,    setRenaming]    = useState(false)
  const [renameVal,   setRenameVal]   = useState(dataset.name)
  const [confirmDel,  setConfirmDel]  = useState(false)
  const [syncing,     setSyncing]     = useState(false)

  const isStudy = dataset.source === 'study'
  const href    = '/analyze/' + dataset.id + '/textmine'

  function handleAnalyze() {
    router.push(href)
  }

  async function handleSync() {
    setSyncing(true)
    setMenuOpen(false)
    try {
      const res  = await fetch('/api/datasets/' + dataset.id + '/sync', { method: 'POST' })
      const data = await res.json()
      if (data.synced === 0) {
        alert('Already up to date -- no new responses.')
      } else {
        router.refresh()
      }
    } finally {
      setSyncing(false)
    }
  }

  function handleRenameSubmit() {
    if (renameVal.trim() && renameVal !== dataset.name) {
      onRename(dataset.id, renameVal.trim())
    }
    setRenaming(false)
    setMenuOpen(false)
  }

  function handleDelete() {
    if (confirmDel) {
      onDelete(dataset.id)
      setMenuOpen(false)
    } else {
      setConfirmDel(true)
    }
  }

  const statusText  = dataset.last_synced_at ? ('Synced ' + timeAgo(dataset.last_synced_at)) : 'Never synced'
  const updatedText = 'Updated ' + timeAgo(dataset.updated_at)

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-4 relative">

      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {renaming ? (
            <div className="flex gap-2">
              <input
                value={renameVal}
                onChange={function(e) { setRenameVal(e.target.value) }}
                className="flex-1 px-3 py-1.5 rounded-lg border border-orange-400 text-sm text-gray-800 outline-none"
                autoFocus
              />
              <button onClick={handleRenameSubmit} className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg" style={{ background: HERMES }}>
                Save
              </button>
              <button onClick={function() { setRenaming(false); setRenameVal(dataset.name) }} className="text-xs text-gray-400 px-2">
                Cancel
              </button>
            </div>
          ) : (
            <h3 className="font-bold text-gray-800 text-base truncate">{dataset.name}</h3>
          )}
        </div>

        {/* Three-dot menu */}
        <div className="relative flex-shrink-0">
          <button
            onClick={function() { setMenuOpen(function(v) { return !v }) }}
            className="text-gray-400 hover:text-gray-600 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors text-lg leading-none"
          >
            ...
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-8 bg-white border border-gray-200 rounded-xl shadow-lg z-20 w-44 py-1">
              <button onClick={function() { setRenaming(true); setMenuOpen(false) }}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                Rename
              </button>
              <button onClick={function() { onToggleVisibility(dataset.id, dataset.visibility === 'private' ? 'public' : 'private'); setMenuOpen(false) }}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                {dataset.visibility === 'private' ? 'Make public' : 'Make private'}
              </button>
              {isStudy && (
                <button onClick={handleSync}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
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
                  className="w-full text-left px-4 py-2 text-xs text-gray-400 hover:bg-gray-50">
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Badges row */}
      <div className="flex items-center gap-2 flex-wrap">
        {isStudy ? (
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full text-white" style={{ background: HERMES }}>
            {'Survey: ' + (dataset.study_name || 'Linked study')}
          </span>
        ) : (
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
            Upload
          </span>
        )}
        <span className={'text-xs font-medium px-2 py-0.5 rounded-full border ' +
          (dataset.visibility === 'public' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-500 border-gray-200')}>
          {dataset.visibility}
        </span>
        {dataset.status === 'archived' && (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
            Archived
          </span>
        )}
      </div>

      {/* Stats row */}
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span className="font-semibold text-gray-600">{dataset.row_count.toLocaleString()} rows</span>
        <span>{isStudy ? statusText : updatedText}</span>
      </div>

      {/* Analyze button */}
      <button
        onClick={handleAnalyze}
        className="w-full py-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
        style={{ background: HERMES }}
      >
        Analyze in Ana
      </button>

      {/* Dismiss menu on outside click */}
      {menuOpen && (
        <div className="fixed inset-0 z-10" onClick={function() { setMenuOpen(false); setConfirmDel(false) }} />
      )}
    </div>
  )
}
