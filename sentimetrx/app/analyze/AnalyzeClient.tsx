'use client'

import { useState } from 'react'
import Link from 'next/link'
import TopNav from '@/components/nav/TopNav'
import DatasetCard from '@/components/analyze/DatasetCard'
import DatasetFilterBar from '@/components/analyze/DatasetFilterBar'
import type { Dataset, DatasetListFilters } from '@/lib/analyzeTypes'

interface Props {
  user: {
    email:    string
    fullName: string
    role:     string
    isAdmin:  boolean
    userId:   string
  }
  orgName:      string
  orgId:        string
  logoUrl:      string
  datasets:     Dataset[]
  studyNameMap: Record<string, string>
}

const HERMES = '#E8632A'

const DEFAULT_FILTERS: DatasetListFilters = {
  source:     'all',
  visibility: 'all',
  status:     'active',
}

export default function AnalyzeClient({ user, orgName, logoUrl, datasets: initial, studyNameMap }: Props) {
  const [datasets, setDatasets]   = useState<Dataset[]>(initial)
  const [filters, setFilters]     = useState<DatasetListFilters>(DEFAULT_FILTERS)

  const filtered = datasets.filter(d => {
    if (filters.source !== 'all' && d.source !== filters.source) return false
    if (filters.visibility !== 'all' && d.visibility !== filters.visibility) return false
    if (filters.status !== 'all' && d.status !== filters.status) return false
    return true
  })

  async function handleDelete(id: string) {
    const res = await fetch('/api/datasets/' + id, { method: 'DELETE' })
    if (res.ok) setDatasets(prev => prev.filter(d => d.id !== id))
  }

  async function handleToggleVisibility(id: string, current: 'private' | 'public') {
    const next = current === 'private' ? 'public' : 'private'
    const res = await fetch('/api/datasets/' + id, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ visibility: next }),
    })
    if (res.ok) {
      setDatasets(prev => prev.map(d => d.id === id ? { ...d, visibility: next } : d))
    }
  }

  async function handleArchive(id: string) {
    const res = await fetch('/api/datasets/' + id, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status: 'archived' }),
    })
    if (res.ok) {
      setDatasets(prev => prev.map(d => d.id === id ? { ...d, status: 'archived' } : d))
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

      <main className="pt-14">
        <div className="max-w-7xl mx-auto px-5 py-8">

          {/* Page header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Analyze</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {datasets.length + ' dataset' + (datasets.length === 1 ? '' : 's')}
              </p>
            </div>
            <Link href="/analyze/new"
              className="text-sm font-medium px-4 py-2 rounded-lg text-white shadow-sm transition-opacity hover:opacity-90"
              style={{ background: HERMES }}>
              + Upload Dataset
            </Link>
          </div>

          {/* Filter bar */}
          <DatasetFilterBar filters={filters} onChange={setFilters} />

          {/* Dataset grid */}
          {filtered.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
              {filtered.map(d => (
                <DatasetCard
                  key={d.id}
                  dataset={d}
                  studyName={d.study_id ? studyNameMap[d.study_id] : undefined}
                  onDelete={handleDelete}
                  onToggleVisibility={handleToggleVisibility}
                  onArchive={handleArchive}
                />
              ))}
            </div>
          ) : (
            <EmptyState hasAny={datasets.length > 0} />
          )}
        </div>
      </main>
    </div>
  )
}

function EmptyState({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: '#fff4ef' }}>
        <span className="text-2xl">📊</span>
      </div>
      <h3 className="font-semibold text-gray-700 text-lg">
        {hasAny ? 'No datasets match your filters' : 'No datasets yet'}
      </h3>
      <p className="text-sm text-gray-400 mt-1 max-w-xs">
        {hasAny
          ? 'Try adjusting your filters above.'
          : 'Upload a dataset or sync a study to get started.'}
      </p>
      {!hasAny && (
        <Link href="/analyze/new"
          className="mt-4 text-sm font-medium px-4 py-2 rounded-lg text-white"
          style={{ background: '#E8632A' }}>
          Upload Dataset
        </Link>
      )}
    </div>
  )
}
