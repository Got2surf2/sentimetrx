'use client'

// app/analyze/AnalyzeClient.tsx
// Dataset card grid with filter bar and create button

import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import DatasetCard from '@/components/analyze/DatasetCard'
import DatasetFilterBar from '@/components/analyze/DatasetFilterBar'
import NewCollectionModal from '@/components/analyze/NewCollectionModal'
import ManageMembersModal from '@/components/analyze/ManageMembersModal'
import type { DatasetWithState } from '@/lib/analyzeTypes'

interface OrgOption { id: string; name: string }
interface Props {
  initialDatasets: DatasetWithState[]
  isAdmin?:        boolean
  allOrgs?:        OrgOption[]
  userOrgId?:      string
}

interface Filters {
  source:     'all' | 'study' | 'upload' | 'bot' | 'google_reviews' | 'recording' | 'townhall' | 'collection' | 'other'
  visibility: 'all' | 'private' | 'public'
  status:     'all' | 'active' | 'archived'
}

// Sources that have their own pill; anything else falls under the "Other" pill.
const NAMED_SOURCES = ['study', 'upload', 'bot', 'google_reviews', 'recording', 'townhall', 'collection']

const HERMES = '#e8622a'

export default function AnalyzeClient({ initialDatasets, isAdmin = false, allOrgs = [], userOrgId }: Props) {
  const router = useRouter()
  const [datasets, setDatasets] = useState<DatasetWithState[]>(initialDatasets)
  const [filters,  setFilters]  = useState<Filters>({ source: 'all', visibility: 'all', status: 'all' })
  const [query,    setQuery]    = useState('')
  const [showCollectionModal, setShowCollectionModal] = useState(false)
  // Add-datasets-to-existing-collection modal state (null = closed).
  const [manageCollection, setManageCollection] = useState<{ datasetId: string; name: string; orgId: string } | null>(null)
  // Tracked as a ref, not state: the modal calls onChanged() then onClose()
  // synchronously in one save(), and onClose must read the just-set value.
  // A useState round-trip wouldn't have flushed yet, so onClose would read a
  // stale `false` and skip the reload — the add succeeded but the grid never
  // refreshed, which read to the user as "Save changes does nothing."
  const manageDirtyRef = useRef(false)
  // Brand drill-in: when set, the grid shows only that brand-collection's
  // member datasets instead of the flat listing. Cleared by "Back to all".
  const [drillIn, setDrillIn] = useState<{ collectionId: string; name: string } | null>(null)
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

  // Re-sync the list whenever the server re-renders (e.g. router.refresh() after
  // a collection recompute, or any navigation back to /analyze). Without this
  // the seeded useState keeps the stale rows — the "Members updated — refresh"
  // badge never clears and refreshed row_count/updated_at never show, so the
  // refresh button looks like it silently does nothing. initialDatasets only
  // changes identity on a server re-render, so local archive/delete optimistic
  // updates between refreshes aren't clobbered.
  useEffect(function() { setDatasets(initialDatasets) }, [initialDatasets])

  function changeSort(next: 'updated' | 'created' | 'name') {
    setSortMode(next)
    if (typeof window !== 'undefined') window.localStorage.setItem('sentimetrx.sort.analyze', next)
  }

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
    const last = (d as { last_sync_at?: string }).last_sync_at
    return -new Date(last || d.created_at).getTime()
  }
  const nameQ = query.trim().toLowerCase()
  const filtered = scoped.filter(function(d) {
    if (nameQ && !(d.name || '').toLowerCase().includes(nameQ)) return false
    if (filters.source === 'other') {
      // "Other" = any source without its own pill (reddit, substack, collection, regulations, …).
      if (NAMED_SOURCES.includes(d.source)) return false
    } else if (filters.source !== 'all' && d.source !== filters.source) return false
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
    if (res.ok) { setDatasets(function(prev) { return prev.filter(function(d) { return d.id !== id }) }); return }
    // Surface the server reason instead of silently doing nothing.
    const msg = await res.json().then(function(d) { return d?.error }).catch(function() { return null })
    alert(msg || 'Could not delete this. Please try again.')
  }

  // Open the "Add datasets" modal for a collection — fetch its current members
  // first so they're excluded from the picker.
  function handleManageMembers(collectionDatasetId: string, name: string) {
    manageDirtyRef.current = false
    // Carry the collection's org so the picker only offers SAME-ORG datasets —
    // in the all-orgs admin view the unfiltered list offered other orgs'
    // datasets, and the add then 400'd on the same-org tenancy rule with the
    // error buried below the fold (owner-hit 2026-09-04, local admin view).
    const ds = datasets.find(function(d) { return d.id === collectionDatasetId })
    setManageCollection({ datasetId: collectionDatasetId, name: name, orgId: ds?.org_id || '' })
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
          <div className="flex items-center gap-3 flex-wrap">
            <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name…"
              style={{ fontSize: '16px' }}
              className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-700 outline-none w-52" />
            <DatasetFilterBar filters={filters} onChange={setFilters} />
          </div>
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
                    onDelete={(id) => { void handleDelete(id) }}
                    onRename={(id, name) => { void handleRename(id, name) }}
                    onToggleVisibility={(id, visibility) => { void handleToggleVisibility(id, visibility) }}
                    onToggleArchive={(id, status) => { void handleToggleArchive(id, status) }}
                    isAdmin={isAdmin}
                    allOrgs={allOrgs}
                    onTransfer={handleTransfer}
                    onDrillIn={function(collectionId, name) { setDrillIn({ collectionId: collectionId, name: name }) }}
                    onManageMembers={handleManageMembers}
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

      {/* Manage members (full add + remove) for an existing collection */}
      {manageCollection && (
        <ManageMembersModal
          collectionDatasetId={manageCollection.datasetId}
          collectionName={manageCollection.name}
          eligibleDatasets={manageCollection.orgId
            ? eligibleForCollection.filter(function(d) { return d.org_id === manageCollection.orgId })
            : eligibleForCollection}
          onChanged={function() { manageDirtyRef.current = true }}
          onClose={function() { const dirty = manageDirtyRef.current; setManageCollection(null); if (dirty) window.location.reload() }}
        />
      )}
    </div>
  )
}
