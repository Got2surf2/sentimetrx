'use client'

// components/analyze/RowsContext.tsx
// Shared row data context — fetches dataset rows once and shares across all Ana tabs.
// Applies value aliases and signal tier injection so modules don't need to.

import { createContext, useContext, useState, useCallback } from 'react'
import { injectSignalTier } from '@/lib/signalTier'
import type { SchemaFieldConfig as SchemaField } from '@/lib/analyzeTypes'

var SAMPLE_CAP = 50000

interface RowsState {
  rows: Record<string, unknown>[]
  rowsLoaded: boolean
  rowsLoading: boolean
  rowsError: string | null
  totalRows: number
  sampled: boolean
  sampledCount: number
  fetchRows: () => void
}

var RowsContext = createContext<RowsState>({
  rows: [], rowsLoaded: false, rowsLoading: false, rowsError: null,
  totalRows: 0, sampled: false, sampledCount: 0, fetchRows: function() {},
})

export function useRows(): RowsState {
  return useContext(RowsContext)
}

interface ProviderProps {
  datasetId: string
  schemaFields: SchemaField[]
  datasetSource: string
  children: React.ReactNode
}

export function RowsProvider({ datasetId, schemaFields, datasetSource, children }: ProviderProps) {
  var [rows, setRows] = useState<Record<string, unknown>[]>([])
  var [rowsLoaded, setRowsLoaded] = useState(false)
  var [rowsLoading, setRowsLoading] = useState(false)
  var [rowsError, setRowsError] = useState<string | null>(null)
  var [totalRows, setTotalRows] = useState(0)
  var [sampled, setSampled] = useState(false)
  var [sampledCount, setSampledCount] = useState(0)

  var fetchRows = useCallback(function() {
    if (rowsLoaded || rowsLoading) return
    setRowsLoading(true)
    setRowsError(null)
    fetch('/api/datasets/' + datasetId + '/rows?all=true&sampleMax=' + SAMPLE_CAP)
      .then(function(r) {
        if (!r.ok) throw new Error('Failed to load rows')
        return r.json()
      })
      .then(function(data) {
        var loadedRows: Record<string, unknown>[] = data.rows || []

        // Apply value aliases to categorical fields
        var aliasMap: Record<string, Record<string, string>> = {}
        schemaFields.forEach(function(f: any) {
          if (f.valueAliases && Object.keys(f.valueAliases).length > 0) aliasMap[f.field] = f.valueAliases
        })
        if (Object.keys(aliasMap).length > 0) {
          loadedRows.forEach(function(row) {
            for (var field in aliasMap) {
              var val = row[field]
              if (val != null && aliasMap[field][String(val)]) {
                row[field] = aliasMap[field][String(val)]
              }
            }
          })
        }

        // Inject signal tier for Reddit/Substack
        if (datasetSource === 'reddit' || datasetSource === 'substack') {
          loadedRows = injectSignalTier(loadedRows, datasetSource)
        }

        setRows(loadedRows)
        setTotalRows(data.totalRows ?? loadedRows.length)
        setSampled(!!data.sampled)
        setSampledCount(loadedRows.length)
        setRowsLoaded(true)
      })
      .catch(function(e: unknown) {
        setRowsError(e instanceof Error ? e.message : 'Failed to load rows')
      })
      .finally(function() { setRowsLoading(false) })
  }, [datasetId, rowsLoaded, rowsLoading, schemaFields, datasetSource])

  return (
    <RowsContext.Provider value={{ rows: rows, rowsLoaded: rowsLoaded, rowsLoading: rowsLoading, rowsError: rowsError, totalRows: totalRows, sampled: sampled, sampledCount: sampledCount, fetchRows: fetchRows }}>
      {children}
    </RowsContext.Provider>
  )
}
