'use client'

// app/analyze/AnalyzeClient.tsx
// Dataset card grid with filter bar and create button

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import DatasetCard from '@/components/analyze/DatasetCard'
import DatasetFilterBar from '@/components/analyze/DatasetFilterBar'
import type { DatasetWithState } from '@/lib/analyzeTypes'

interface Props { initialDatasets: DatasetWithState[] }

interface Filters {
  source:     'all' | 'study' | 'upload'
  visibility: 'all' | 'private' | 'public'
  status:     'all' | 'active' | 'archived'
}

const HERMES = '#e8622a'

export default function AnalyzeClient({ initialDatasets }: Props) {
  const router = useRouter()
  const [datasets, setDatasets] = useState<DatasetWithState[]>(initialDatasets)
  const [filters,  setFilters]  = useState<Filters>({ source: 'all', visibility: 'all', status: 'all' })

  const filtered = datasets.filter(function(d) {
    if (filters.source !== 'all' && d.source !== filters.source) return false
    if (filters.visibility !== 'all' && d.visibility !== filters.visibility) return false
    if (filters.status !== 'all' && d.status !== filters.status) return false
    return true
  })

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch('/api/datasets/' + id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.ok
  }

  async function handleDelete(id: string) {
    const res = await fetch('/api/datasets/' + id, { method: 'DELETE' })
    if (res.ok) setDatasets(function(prev) { return prev.filter(function(d) { return d.id !== id }) })
  }

  async function handleRename(id: string, name: string) {
    const ok = await patch(id, { name })
    if (ok) setDatasets(function(prev) { return prev.map(function(d) { return d.id === id ? { ...d, name } : d }) })
  }

  async function handleToggleVisibility(id: string, visibility: 'private' | 'public') {
    const ok = await patch(id, { visibility })
    if (ok) setDatasets(function(prev) { return prev.map(function(d) { return d.id === id ? { ...d, visibility } : d }) })
  }

  async function handleToggleArchive(id: string, status: 'active' | 'archived') {
    const ok = await patch(id, { status })
    if (ok) setDatasets(function(prev) { return prev.map(function(d) { return d.id === id ? { ...d, status } : d }) })
  }

  const activeCount   = datasets.filter(function(d) { return d.status === 'active' }).length
  const archivedCount = datasets.filter(function(d) { return d.status === 'archived' }).length

  return (
    <div className="flex flex-col gap-6">

      {/* Page header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-gray-800">Analyze</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {datasets.length === 0
              ? 'No datasets yet'
              : activeCount + ' active' + (archivedCount > 0 ? ' · ' + archivedCount + ' archived' : '')}
          </p>
        </div>
        <button onClick={function() { router.push('/analyze/new') }}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
          style={{ background: HERMES }}>
          + Upload Dataset
        </button>
      </div>

      {/* Filter bar */}
      {datasets.length > 0 && <DatasetFilterBar filters={filters} onChange={setFilters} />}

      {/* Grid or empty state */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'linear-gradient(135deg,#fff3ee,#ffe4d6)' }}>
            <span className="text-2xl">📊</span>
          </div>
          <h3 className="text-lg font-bold text-gray-700 mb-2">
            {datasets.length === 0 ? 'No datasets yet' : 'No datasets match your filters'}
          </h3>
          <p className="text-gray-400 text-sm max-w-xs">
            {datasets.length === 0
              ? 'Upload a CSV or sync a study to get started.'
              : 'Try adjusting your filters.'}
          </p>
          {datasets.length === 0 && (
            <button onClick={function() { router.push('/analyze/new') }}
              className="mt-6 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
              style={{ background: HERMES }}>
              Upload your first dataset
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(function(dataset) {
            return (
              <DatasetCard
                key={dataset.id}
                dataset={dataset}
                onDelete={handleDelete}
                onRename={handleRename}
                onToggleVisibility={handleToggleVisibility}
                onToggleArchive={handleToggleArchive}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
