'use client'
// app/analyze/[datasetId]/DatasetShell.tsx
// Client wrapper: FilterProvider + DatasetHeader + global FiltersModal + Session save/restore

import { useState, useEffect } from 'react'
import { FilterProvider, useFilters } from '@/components/analyze/FilterContext'
import { filterCount } from '@/lib/filterUtils'
import type { Filters } from '@/lib/filterUtils'
import FiltersModal from '@/components/analyze/FiltersModal'
import DatasetHeader from './DatasetHeader'
import LottieLoader from '@/components/ui/LottieLoader'

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
  const { filters, setFilters, showFilters, setShowFilters } = useFilters()
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [rowsLoaded, setRowsLoaded] = useState(false)
  const [loadingRows, setLoadingRows] = useState(false)
  const [chipsExpanded, setChipsExpanded] = useState(false)
  const [sessionSaving, setSessionSaving] = useState(false)
  const [sessionSaved, setSessionSaved] = useState(false)

  // Build aliases from schema
  const aliases: Record<string, string> = {}
  schemaFields.forEach(function(f) { if (f.label && f.label !== f.field) aliases[f.field] = f.label })

  // Restore session (filters) on mount
  useEffect(function() {
    fetch('/api/datasets/' + datasetId + '/state')
      .then(function(r) { return r.ok ? r.json() : {} as any })
      .then(function(d) {
        if (d.session_state && d.session_state.filters) {
          // Restore filters from session — need to reconstruct Sets from arrays
          const restored: Filters = {}
          Object.entries(d.session_state.filters).forEach(function(entry) {
            const field = entry[0], f = entry[1] as any
            if (f.type === 'cat') {
              restored[field] = { type: 'cat', values: new Set(f.values || []), excludeBlanks: f.excludeBlanks || false }
            } else {
              restored[field] = f
            }
          })
          if (Object.keys(restored).length > 0) setFilters(restored)
        }
      })
      .catch(function() {})
  }, [datasetId])

  // Fetch lightweight filter options when filter modal opens (not all rows)
  useEffect(function() {
    if (!showFilters || rowsLoaded || loadingRows) return
    setLoadingRows(true)
    ;(async function() {
      try {
        const r = await fetch('/api/datasets/' + datasetId + '/filter-options')
        if (!r.ok) throw new Error('Failed')
        const data = await r.json()
        const fieldOpts = data.fields || {}

        // Build synthetic rows that FiltersModal can use for distinct values and ranges
        // Each distinct value becomes one "row" so Set extraction and min/max work
        const syntheticRows: Record<string, unknown>[] = []
        const allValues: Record<string, string[]> = {}
        for (const key of Object.keys(fieldOpts)) {
          const opt = fieldOpts[key]
          if (opt.values) allValues[key] = opt.values
          if (opt.min != null) allValues[key] = [String(opt.min), String(opt.max)]
          if (opt.dateMin) allValues[key] = [opt.dateMin, opt.dateMax]
        }
        // Build enough rows to cover all distinct values per field
        const maxLen = Math.max(1, ...Object.values(allValues).map(function(v) { return v.length }))
        for (let i = 0; i < maxLen; i++) {
          const row: Record<string, unknown> = {}
          for (const key of Object.keys(allValues)) {
            const vals = allValues[key]
            if (i < vals.length) row[key] = vals[i]
          }
          syntheticRows.push(row)
        }

        // Also update schema fields with values from the endpoint
        schemaFields.forEach(function(sf) {
          const opt = fieldOpts[sf.field]
          if (opt?.values && !sf.values) sf.values = opt.values
          if (opt?.min != null && sf.min == null) sf.min = opt.min
          if (opt?.max != null && sf.max == null) sf.max = opt.max
        })

        setRows(syntheticRows)
        setRowsLoaded(true)
      } catch {}
      setLoadingRows(false)
    })()
  }, [showFilters, rowsLoaded, loadingRows, datasetId])

  const fCount = filterCount(filters)

  // Save session handler
  const handleSaveSession = function() {
    setSessionSaving(true)
    // Serialize filters (Sets → arrays for JSON)
    const serializedFilters: Record<string, any> = {}
    Object.entries(filters).forEach(function(entry) {
      const field = entry[0], f = entry[1]
      if (f.type === 'cat') {
        serializedFilters[field] = { type: 'cat', values: Array.from(f.values), excludeBlanks: f.excludeBlanks }
      } else {
        serializedFilters[field] = f
      }
    })

    const sessionState = {
      filters: serializedFilters,
      savedAt: new Date().toISOString(),
    }

    fetch('/api/datasets/' + datasetId + '/state', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_state: sessionState }),
    })
      .then(function() { setSessionSaved(true); setTimeout(function() { setSessionSaved(false) }, 3000) })
      .catch(function() {})
      .finally(function() { setSessionSaving(false) })
  }

  return (
    <>
      <DatasetHeader dataset={dataset} userName={userName} orgName={orgName} filterCount={fCount} onFilterClick={function() { setShowFilters(true) }} onSaveSession={handleSaveSession} sessionSaving={sessionSaving} sessionSaved={sessionSaved} />

      {/* Global filter chips bar — visible on ALL tabs */}
      {fCount > 0 && (
        <div style={{ background: '#fff4ef', borderBottom: '1px solid #fbd5c2', padding: '6px 20px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: chipsExpanded ? 'wrap' : 'nowrap', overflow: chipsExpanded ? 'visible' : 'hidden', maxHeight: chipsExpanded ? 'none' : 32 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#e8622a', textTransform: 'uppercase', letterSpacing: '.07em', flexShrink: 0 }}>Filtered:</span>
          {Object.entries(filters).map(function(entry) {
            const field = entry[0], f = entry[1]
            const label = aliases[field] || field
            let desc = ''
            if (f.type === 'cat') { const vals = Array.from(f.values); desc = vals.length <= 2 ? vals.join(', ') : vals.length + ' values' }
            else if (f.type === 'range') desc = f.values[0] + '\u2013' + f.values[1]
            else if (f.type === 'daterange') { const fmt = function(ts: number) { const d = new Date(ts); return (d.getMonth() + 1) + '/' + d.getDate() }; desc = fmt(f.values[0]) + '\u2013' + fmt(f.values[1]) }
            return (
              <span key={field} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 20, background: 'white', border: '1px solid #fbd5c2', color: '#374151', whiteSpace: 'nowrap', flexShrink: 0 }}>
                <span style={{ color: '#e8622a', fontWeight: 700 }}>{label}:</span> {desc}
                <button onClick={function() { setFilters(function(prev) { const next: Record<string, any> = {}; Object.keys(prev).forEach(function(k) { if (k !== field) next[k] = prev[k] }); return next as any }) }}
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
              <LottieLoader size={72} message="Loading data for filters..." />
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
