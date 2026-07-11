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
  // Live progress while the bulk payload streams in (0 until the response
  // starts). A ≥50K-row sample is tens of MB, which used to sit behind a
  // blind spinner long enough to look hung. rowsProgressRows counts rows as
  // they arrive (each carries a "_rowId" marker); rowsExpected is the known
  // denominator (min(dataset row_count, 50K sample cap)) for a % display.
  rowsProgressBytes: number
  rowsProgressRows: number
  rowsExpected: number
  fetchRows: () => void
}

var RowsContext = createContext<RowsState>({
  rows: [], rowsLoaded: false, rowsLoading: false, rowsError: null,
  totalRows: 0, sampled: false, sampledCount: 0,
  rowsProgressBytes: 0, rowsProgressRows: 0, rowsExpected: 0, fetchRows: function() {},
})

export function useRows(): RowsState {
  return useContext(RowsContext)
}

interface ProviderProps {
  datasetId: string
  schemaFields: SchemaField[]
  datasetSource: string
  // Dataset row_count when the caller knows it — enables "N of M rows · %"
  // progress instead of raw MB while the bulk payload streams in.
  expectedRows?: number
  children: React.ReactNode
}

export function RowsProvider({ datasetId, schemaFields, datasetSource, expectedRows, children }: ProviderProps) {
  var [rows, setRows] = useState<Record<string, unknown>[]>([])
  var [rowsLoaded, setRowsLoaded] = useState(false)
  var [rowsLoading, setRowsLoading] = useState(false)
  var [rowsError, setRowsError] = useState<string | null>(null)
  var [totalRows, setTotalRows] = useState(0)
  var [sampled, setSampled] = useState(false)
  var [sampledCount, setSampledCount] = useState(0)
  var [rowsProgressBytes, setRowsProgressBytes] = useState(0)
  var [rowsProgressRows, setRowsProgressRows] = useState(0)
  var rowsExpected = expectedRows && expectedRows > 0 ? Math.min(expectedRows, SAMPLE_CAP) : 0

  var fetchRows = useCallback(function() {
    if (rowsLoaded || rowsLoading) return
    setRowsLoading(true)
    setRowsError(null)
    // withRowIds=true attaches `_rowId` (the flat row id) to each row so Charts can
    // pass the filtered row-id set to server-side dimension aggregates (view-level).
    fetch('/api/datasets/' + datasetId + '/rows?all=true&withRowIds=true&sampleMax=' + SAMPLE_CAP)
      .then(async function(r) {
        if (!r.ok) throw new Error('Failed to load rows')
        // Stream the body so the UI can show real progress while the bulk
        // payload arrives; fall back to plain json() when streaming isn't
        // available. Updates throttle to every 2MB to avoid render churn.
        if (!r.body || typeof TextDecoder === 'undefined') return r.json()
        var reader = r.body.getReader()
        var decoder = new TextDecoder()
        var parts: string[] = []
        var received = 0
        var lastReported = 0
        // Rows counted as they stream: every row object carries one "_rowId"
        // key (withRowIds=true above). The 7-char tail carry handles a marker
        // split across chunk boundaries (the 8-char token can never sit fully
        // inside the 7-char tail, so no double counting).
        var MARKER = '"_rowId"'
        var rowsSeen = 0
        var tail = ''
        for (;;) {
          var chunk = await reader.read()
          if (chunk.done) break
          received += chunk.value.byteLength
          var text = decoder.decode(chunk.value, { stream: true })
          parts.push(text)
          var scan = tail + text
          var idx = scan.indexOf(MARKER)
          while (idx !== -1) { rowsSeen++; idx = scan.indexOf(MARKER, idx + MARKER.length) }
          tail = scan.slice(-(MARKER.length - 1))
          if (received - lastReported > 2 * 1024 * 1024) {
            lastReported = received
            setRowsProgressBytes(received)
            setRowsProgressRows(rowsSeen)
          }
        }
        parts.push(decoder.decode())
        setRowsProgressBytes(received)
        setRowsProgressRows(rowsSeen)
        return JSON.parse(parts.join(''))
      })
      .then(function(data) {
        var loadedRows: Record<string, unknown>[] = data.rows || []

        // Apply value aliases to categorical fields
        var aliasMap: Record<string, Record<string, string>> = {}
        schemaFields.forEach(function(f: SchemaField) {
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
    <RowsContext.Provider value={{ rows: rows, rowsLoaded: rowsLoaded, rowsLoading: rowsLoading, rowsError: rowsError, totalRows: totalRows, sampled: sampled, sampledCount: sampledCount, rowsProgressBytes: rowsProgressBytes, rowsProgressRows: rowsProgressRows, rowsExpected: rowsExpected, fetchRows: fetchRows }}>
      {children}
    </RowsContext.Provider>
  )
}
