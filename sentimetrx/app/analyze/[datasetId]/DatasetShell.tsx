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
  var [chipsExpanded, setChipsExpanded] = useState(false)

  // Build aliases from schema
  var aliases: Record<string, string> = {}
  schemaFields.forEach(function(f) { if (f.label && f.label !== f.field) aliases[f.field] = f.label })

  return (
    <>
      <DatasetHeader dataset={dataset} userName={userName} orgName={orgName} filterCount={fCount} onFilterClick={function() { setShowFilters(true) }} />

      {/* Global filter chips bar — visible on ALL tabs when filters active */}
      {fCount > 0 && (
        <div style={{ background: '#fff4ef', borderBottom: '1px solid #fbd5c2', padding: '6px 20px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: chipsExpanded ? 'wrap' : 'nowrap', overflow: chipsExpanded ? 'visible' : 'hidden', maxHeight: chipsExpanded ? 'none' : 32 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#e8622a', textTransform: 'uppercase', letterSpacing: '.07em', flexShrink: 0 }}>Filtered:</span>
          {Object.entries(filters).map(function(entry) {
            var field = entry[0], f = entry[1]
            var label = aliases[field] || field
            var desc = ''
            if (f.type === 'cat') { var vals = Array.from(f.values); desc = vals.length <= 2 ? vals.join(', ') : vals.length + ' values' }
            else if (f.type === 'range') desc = f.values[0] + '\u2013' + f.values[1]
            else if (f.type === 'daterange') { var fmt = function(ts: number) { var d = new Date(ts); return (d.getMonth() + 1) + '/' + d.getDate() }; desc = fmt(f.values[0]) + '\u2013' + fmt(f.values[1]) }
            return (
              <span key={field} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 20, background: 'white', border: '1px solid #fbd5c2', color: '#374151', whiteSpace: 'nowrap', flexShrink: 0 }}>
                <span style={{ color: '#e8622a', fontWeight: 700 }}>{label}:</span> {desc}
                <button onClick={function() { setFilters(function(prev) { var next: Record<string, any> = {}; Object.keys(prev).forEach(function(k) { if (k !== field) next[k] = prev[k] }); return next as any }) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 12, lineHeight: 1, padding: 0 }}>{'\u00D7'}</button>
              </span>
            )
          })}
          {fCount > 3 && (
            <button onClick={function() { setChipsExpanded(function(v) { return !v }) }}
              style={{ fontSize: 10, fontWeight: 700, color: '#e8622a', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
              {chipsExpanded ? '\u2212 Less' : '+' + (fCount - 3) + ' more'}
            </button>
          )}
          <button onClick={function() { setShowFilters(true) }}
            style={{ fontSize: 10, fontWeight: 700, color: '#e8622a', background: 'none', border: '1px solid #fbd5c2', borderRadius: 6, cursor: 'pointer', padding: '2px 8px', marginLeft: 'auto', flexShrink: 0 }}>
            Edit
          </button>
          <button onClick={function() { setFilters({}) }}
            style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
            Clear all
          </button>
        </div>
      )}

      <main style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {children}
      </main>

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
