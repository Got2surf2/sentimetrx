'use client'
// app/analyze/[datasetId]/DatasetShell.tsx
// Client wrapper: FilterProvider + DatasetHeader + global FiltersModal
// Filter button sits at the tab level (alongside TextMine/Charts/Statistics).

import { useState, useEffect } from 'react'
import { FilterProvider, useFilters } from '@/components/analyze/FilterContext'
import { filterCount } from '@/lib/filterUtils'
import type { Filters } from '@/lib/filterUtils'
import FiltersModal from '@/components/analyze/FiltersModal'
import DatasetHeader from './DatasetHeader'

interface DatasetMeta {
  id: string; name: string; source: 'upload' | 'study'; visibility: 'private' | 'public'
  status: 'active' | 'archived'; row_count: number; last_synced_at: string | null; study_name: string | null
}
interface SchemaField { field: string; type: string; label?: string; values?: string[]; min?: number; max?: number; sqt?: string | null; scoreField?: boolean }

interface Props {
  dataset: DatasetMeta
  userName: string
  orgName: string
  schemaFields: SchemaField[]
  datasetId: string
  children: React.ReactNode
}

function ShellInner({ dataset, userName, orgName, schemaFields, datasetId, children }: Props) {
  var { filters, setFilters, showFilters, setShowFilters } = useFilters()
  var [rows, setRows] = useState<Record<string, unknown>[]>([])
  var [rowsLoaded, setRowsLoaded] = useState(false)
  var [loadingRows, setLoadingRows] = useState(false)

  // Lazy-load rows when filter modal opens
  useEffect(function() {
    if (!showFilters || rowsLoaded || loadingRows) return
    setLoadingRows(true)
    var PAGE_SIZE = 500, page = 0, allRows: Record<string, unknown>[] = []
    ;(async function() {
      try {
        while (true) {
          var r = await fetch('/api/datasets/' + datasetId + '/rows?page=' + page + '&pageSize=' + PAGE_SIZE)
          if (!r.ok) break
          var data = await r.json()
          var batch: Record<string, unknown>[] = data.rows || []
          allRows = allRows.concat(batch)
          if (page >= (data.totalPages || 0) - 1 || batch.length < PAGE_SIZE) break
          page++
        }
        setRows(allRows)
        setRowsLoaded(true)
      } catch {}
      setLoadingRows(false)
    })()
  }, [showFilters, rowsLoaded, loadingRows, datasetId])

  var fCount = filterCount(filters)

  return (
    <>
      <DatasetHeader dataset={dataset} userName={userName} orgName={orgName} filterCount={fCount} onFilterClick={function() { setShowFilters(true) }} />
      <main style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {children}
      </main>

      {/* Global filter chips bar — below header, above content */}
      {fCount > 0 && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30 }}>
          {/* This is positioned by the parent — chips render inside each module's sub-tab area */}
        </div>
      )}

      {/* Global FiltersModal */}
      {showFilters && (
        rowsLoaded ? (
          <FiltersModal
            schema={schemaFields}
            rows={rows}
            filters={filters}
            onApply={function(f) { setFilters(f) }}
            onClose={function() { setShowFilters(false) }}
          />
        ) : (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={function() { setShowFilters(false) }}>
            <div style={{ background: 'white', borderRadius: 16, padding: '40px 32px', textAlign: 'center', boxShadow: '0 24px 64px rgba(0,0,0,.28)' }}
              onClick={function(e) { e.stopPropagation() }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid #fbd5c2', borderTopColor: '#e8622a', animation: 'spin 0.9s linear infinite', margin: '0 auto 16px' }} />
              <div style={{ fontSize: 13, color: '#6b7280' }}>Loading data for filters...</div>
            </div>
          </div>
        )
      )}
    </>
  )
}

export default function DatasetShell(props: Props) {
  return (
    <FilterProvider>
      <ShellInner {...props} />
    </FilterProvider>
  )
}
