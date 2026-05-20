'use client'

// app/analyze/AnalyzeClient.tsx
// Dataset card grid with filter bar and create button

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import DatasetCard, { type SignalStatsBrief } from '@/components/analyze/DatasetCard'
import DatasetFilterBar from '@/components/analyze/DatasetFilterBar'
import NewCollectionModal from '@/components/analyze/NewCollectionModal'
import type { DatasetWithState } from '@/lib/analyzeTypes'

interface OrgOption { id: string; name: string }
interface Props {
  initialDatasets: DatasetWithState[]
  isAdmin?:        boolean
  allOrgs?:        OrgOption[]
  userOrgId?:      string
}

interface Filters {
  source:     'all' | 'study' | 'upload' | 'google_reviews' | 'reddit' | 'townhall' | 'substack' | 'collection'
  visibility: 'all' | 'private' | 'public'
  status:     'all' | 'active' | 'archived'
}

const HERMES = '#e8622a'

export default function AnalyzeClient({ initialDatasets, isAdmin = false, allOrgs = [], userOrgId }: Props) {
  const router = useRouter()
  const [datasets, setDatasets] = useState<DatasetWithState[]>(initialDatasets)
  const [filters,  setFilters]  = useState<Filters>({ source: 'all', visibility: 'all', status: 'all' })
  const [showCollectionModal, setShowCollectionModal] = useState(false)
  // Brand drill-in: when set, the grid shows only that brand-collection's
  // member datasets instead of the flat listing. Cleared by "Back to all".
  const [drillIn, setDrillIn] = useState<{ collectionId: string; name: string } | null>(null)
  // Phase C: batched signal stats. `undefined` means "not yet fetched"
  // for that dataset (cards render skeleton); after the batch returns,
  // the entry is either a SignalStatsBrief or null (no themes).
  const [signalStatsMap, setSignalStatsMap] = useState<Record<string, SignalStatsBrief | null>>({})
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [sortMode, setSortMode] = useState<'updated' | 'created' | 'name'>('updated')

  useEffect(function() {
    fetch('/api/favorites').then(function(r) { return r.json() }).then(function(d) {
      const s = new Set<string>()
      for (const f of (d.favorites || [])) {
        if (f.resource_type === 'dataset') s.add(f.resource_id)
      }
      setFavoriteIds(s)
    }).catch(function() { /* non-fatal */ })
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('sentimetrx.sort.analyze')
      if (saved === 'updated' || saved === 'created' || saved === 'name') setSortMode(saved)
    }
  }, [])

  function changeSort(next: 'updated' | 'created' | 'name') {
    setSortMode(next)
    if (typeof window !== 'undefined') window.localStorage.setItem('sentimetrx.sort.analyze', next)
  }

  useEffect(function() {
    const ids = initialDatasets.map(function(d) { return d.id })
    if (ids.length === 0) return
    let cancelled = false
    // 50/batch matches the server-side cap; chunk if a user has more
    // than that on their listing.
    const CHUNK = 50
    async function run() {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK)
        try {
          const res = await fetch('/api/datasets/signal-stats-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: slice }),
          })
          if (!res.ok) continue
          const data = await res.json()
          if (cancelled || !data?.stats) continue
          setSignalStatsMap(function(prev) {
            const next: Record<string, SignalStatsBrief | null> = { ...prev }
            for (const id of slice) {
              next[id] = (data.stats as Record<string, SignalStatsBrief>)[id] || null
            }
            return next
          })
        } catch { /* silent */ }
      }
    }
    void run()
    return function() { cancelled = true }
  }, [initialDatasets])

  // A brand is "active" only with ≥2 members: it then shows as a Brand
  // card with members hidden behind drill-in. With 0-1 members the brand
  // card is hidden and its lone dataset (if any) shows as a normal card —
  // the brand identity still persists in the DB, ready to activate when a
  // 2nd dataset joins. Standalone datasets and manual collections are
  // unaffected. Drilling in flips the grid to that brand's members.
  const activeBrandIds = new Set(
    datasets
      .filter(function(d) { return d.collection_kind === 'brand' && (d.member_count ?? 0) >= 2 })
      .map(function(d) { return d.collection_id })
  )
  const scoped = datasets.filter(function(d) {
    if (drillIn) return d.brand_collection_id === drillIn.collectionId
    if (d.collection_kind === 'brand') return activeBrandIds.has(d.collection_id)
    if (d.brand_collection_id) return !activeBrandIds.has(d.brand_collection_id)
    return true
  })

  // Datasets carry created_at but no canonical updated_at — use last_sync_at
  // if present (DataforSEO/Reddit/etc. cards bump it on every sync), falling
  // back to created_at.
  function sortKey(d: DatasetWithState): string | number {
    if (sortMode === 'name')    return (d.name || '').toLowerCase()
    if (sortMode === 'created') return -new Date(d.created_at).getTime()
    const last = (d as any).last_sync_at as string | undefined
    return -new Date(last || d.created_at).getTime()
  }
  const filtered = scoped.filter(function(d) {
    if (filters.source !== 'all' && d.source !== filters.source) return false
    if (filters.visibility !== 'all' && d.visibility !== filters.visibility) return false
    if (filters.status !== 'all' && d.status !== filters.status) return false
    return true
  }).sort(function(a, b) {
    const af = favoriteIds.has(a.id) ? 0 : 1
    const bf = favoriteIds.has(b.id) ? 0 : 1
    if (af !== bf) return af - bf
    const ka = sortKey(a); const kb = sortKey(b)
    if (ka < kb) return -1
    if (ka > kb) return 1
    return 0
  })
  const firstNonFavIndexDS = (list: DatasetWithState[]): number => {
    for (let i = 0; i < list.length; i++) { if (!favoriteIds.has(list[i].id)) return i }
    return -1
  }

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

  // Only non-collection, active datasets are eligible for collections.
  // Admins can mix datasets from any org they're viewing — the API
  // verifies all members share one org_id (the collection's home org).
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
          <button onClick={function() { router.push('/downloads') }}
            className="px-4 py-2.5 rounded-xl text-sm font-medium transition-all hover:opacity-90"
            style={{ background: '#f9fafb', color: '#374151', border: '1.5px solid #e5e7eb' }}>
            📥 Downloads
          </button>
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

      {/* Brand drill-in header */}
      {drillIn && (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={function() { setDrillIn(null) }}
            className="px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:opacity-90"
            style={{ background: '#eef2ff', color: '#4338ca', border: '1.5px solid #c7d2fe' }}>
            ← Back to all datasets
          </button>
          <span className="text-sm text-gray-600">
            <span style={{ fontWeight: 700, color: '#111827' }}>🏷 {drillIn.name}</span>
            {' · '}{filtered.length} {filtered.length === 1 ? 'dataset' : 'datasets'}
          </span>
        </div>
      )}

      {/* Filter bar + sort dropdown */}
      {datasets.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <DatasetFilterBar filters={filters} onChange={setFilters} />
          <label className="flex items-center gap-1.5 text-xs text-gray-400">
            <span>Sort:</span>
            <select value={sortMode} onChange={e => changeSort(e.target.value as 'updated' | 'created' | 'name')}
              className="px-2 py-1 rounded-lg bg-white border border-gray-200 text-gray-700 text-xs outline-none cursor-pointer">
              <option value="updated">Last updated</option>
              <option value="created">Created</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>
      )}

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
          {(function() {
            const divIdx = firstNonFavIndexDS(filtered)
            return filtered.map(function(dataset, i) {
              return (
                <React.Fragment key={dataset.id}>
                  {i === divIdx && divIdx > 0 && (
                    <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #fbd5c2', margin: '4px 0 0' }} />
                  )}
                  <DatasetCard
                    dataset={dataset}
                    onDelete={handleDelete}
                    onRename={handleRename}
                    onToggleVisibility={handleToggleVisibility}
                    onToggleArchive={handleToggleArchive}
                    isAdmin={isAdmin}
                    allOrgs={allOrgs}
                    onTransfer={handleTransfer}
                    signalStats={signalStatsMap[dataset.id]}
                    onDrillIn={function(collectionId, name) { setDrillIn({ collectionId: collectionId, name: name }) }}
                    initialFavorited={favoriteIds.has(dataset.id)}
                  />
                </React.Fragment>
              )
            })
          })()}
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
