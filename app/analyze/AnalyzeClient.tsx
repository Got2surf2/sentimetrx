'use client'

// app/analyze/AnalyzeClient.tsx
// Dataset card grid with filter bar and create button

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import DatasetCard from '@/components/analyze/DatasetCard'
import DatasetFilterBar from '@/components/analyze/DatasetFilterBar'
import NewCollectionModal from '@/components/analyze/NewCollectionModal'
import type { DatasetWithState } from '@/lib/analyzeTypes'

interface OrgOption { id: string; name: string }
interface Props {
  initialDatasets: DatasetWithState[]
  isAdmin?:        boolean
  allOrgs?:        OrgOption[]
}

interface Filters {
  source:     'all' | 'study' | 'upload' | 'google_reviews' | 'reddit' | 'townhall' | 'substack' | 'collection'
  visibility: 'all' | 'private' | 'public'
  status:     'all' | 'active' | 'archived'
}

const HERMES = '#e8622a'

export default function AnalyzeClient({ initialDatasets, isAdmin = false, allOrgs = [] }: Props) {
  const router = useRouter()
  const [datasets, setDatasets] = useState<DatasetWithState[]>(initialDatasets)
  const [filters,  setFilters]  = useState<Filters>({ source: 'all', visibility: 'all', status: 'all' })
  const [showCollectionModal, setShowCollectionModal] = useState(false)

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

  async function handleTransfer(datasetId: string, studyId: string | null, orgId: string) {
    // Transfer dataset
    await fetch('/api/datasets/' + datasetId, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: orgId }),
    })
    // Transfer linked study too if it exists
    if (studyId) {
      await fetch('/api/studies/' + studyId, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId }),
      })
    }
    // Remove from current view (it now belongs to another org)
    setDatasets(function(prev) { return prev.filter(function(d) { return d.id !== datasetId }) })
  }

  const activeCount   = datasets.filter(function(d) { return d.status === 'active' }).length
  const archivedCount = datasets.filter(function(d) { return d.status === 'archived' }).length

  // Only non-collection, active datasets are eligible for collections
  const eligibleForCollection = datasets.filter(function(d) {
    return d.source !== 'collection' && d.status === 'active'
  })

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
        <div className="flex items-center gap-3">
          {eligibleForCollection.length >= 2 && (
            <button onClick={function() { setShowCollectionModal(true) }}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90"
              style={{ background: '#f0f9ff', color: '#0284c7', border: '1.5px solid #bae6fd' }}>
              + New Collection
            </button>
          )}
          <button onClick={function() { router.push('/analyze/new') }}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
            style={{ background: HERMES }}>
            + New Dataset
          </button>
        </div>
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
                isAdmin={isAdmin}
                allOrgs={allOrgs}
                onTransfer={handleTransfer}
              />
            )
          })}
        </div>
      )}

      {/* New Collection modal */}
      {showCollectionModal && (
        <NewCollectionModal
          datasets={eligibleForCollection}
          onClose={function() { setShowCollectionModal(false) }}
          onCreated={function(ds) { setDatasets(function(prev) { return [ds, ...prev] }) }}
        />
      )}
    </div>
  )
}
