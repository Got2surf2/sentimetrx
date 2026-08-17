'use client'
// app/analyze/[datasetId]/DatasetShell.tsx
// Client wrapper: FilterProvider + DatasetHeader + global FiltersModal + Session save/restore

import { useState, useEffect, useMemo } from 'react'
import { FilterProvider, useFilters } from '@/components/analyze/FilterContext'
import { analyzableFieldsKey } from '@/lib/datasetUtils'
import { RowsProvider, useRows } from '@/components/analyze/RowsContext'
import { filterCount, applyFilters } from '@/lib/filterUtils'
import type { Filters, SerializedFilters } from '@/lib/filterUtils'
import FiltersModal from '@/components/analyze/FiltersModal'
import AskAnaPanel from '@/components/analyze/AskAnaPanel'
import DatasetHeader from './DatasetHeader'
import DatasetMetricStrip from '@/components/analyze/DatasetMetricStrip'
import ViewsBar from '@/components/analyze/ViewsBar'
import ComparisonStrip from '@/components/analyze/ComparisonStrip'
import LottieLoader from '@/components/ui/LottieLoader'

interface DatasetMeta {
  id: string; name: string; source: 'upload' | 'study' | 'google_reviews' | 'reddit' | 'townhall' | 'substack' | 'collection'; visibility: 'private' | 'public'
  status: 'active' | 'archived'; row_count: number; last_synced_at: string | null; study_id?: string | null; description?: string | null; study_name: string | null
}
import type { SchemaFieldConfig as SchemaField } from '@/lib/analyzeTypes'

// Shape returned by GET /api/datasets/[id]/state (saved session filters are serialized)
interface SessionStateResponse { session_state?: { filters?: SerializedFilters } }

interface Props {
  dataset: DatasetMeta
  userName: string
  orgName: string
  schemaFields: SchemaField[]
  primaryDateField?: string
  datasetId: string
  outletCount?: number
  children: React.ReactNode
}

function ShellInner({ dataset, userName, orgName, schemaFields, primaryDateField, datasetId, outletCount, children }: Props) {
  const { filters, setFilters, lockedFilters, setLockedFilters, effectiveFilters, showFilters, setShowFilters } = useFilters()
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [rowsLoaded, setRowsLoaded] = useState(false)
  const [loadingRows, setLoadingRows] = useState(false)
  const [chipsExpanded, setChipsExpanded] = useState(false)
  const [sessionSaving, setSessionSaving] = useState(false)
  const [sessionSaved, setSessionSaved] = useState(false)
  const [askAnaOpen, setAskAnaOpen] = useState(false)

  // Build aliases from schema
  const aliases: Record<string, string> = {}
  schemaFields.forEach(function(f) { if (f.label && f.label !== f.field) aliases[f.field] = f.label })

  // Restore session (filters) on mount
  useEffect(function() {
    fetch('/api/datasets/' + datasetId + '/state')
      .then(function(r) { return r.ok ? (r.json() as Promise<SessionStateResponse>) : ({} as SessionStateResponse) })
      .then(function(d: SessionStateResponse) {
        if (d.session_state && d.session_state.filters) {
          // Restore filters from session — need to reconstruct Sets from arrays
          const restored: Filters = {}
          Object.entries(d.session_state.filters).forEach(function(entry) {
            const field = entry[0], f = entry[1]
            if (f.type === 'cat') {
              // Old saved sessions (pre-mode) default to 'include' to preserve
              // their original behavior; new ones round-trip whatever was saved.
              restored[field] = { type: 'cat', mode: f.mode || 'include', values: new Set(f.values || []), excludeBlanks: f.excludeBlanks || false }
            } else {
              restored[field] = f
            }
          })
          if (Object.keys(restored).length > 0) setFilters(restored)
        }
      })
      .catch(function() {})
  }, [datasetId])

  // Load location-scoped access filter for google_reviews datasets
  useEffect(function() {
    if (dataset.source !== 'google_reviews') return
    fetch('/api/datasets/' + datasetId + '/user-location-filter')
      .then(function(r) { return r.ok ? r.json() : { locations: null } })
      .then(function(data: { locations: string[] | null }) {
        if (data.locations && data.locations.length > 0) {
          setLockedFilters({
            location: { type: 'cat', mode: 'include', values: new Set(data.locations), excludeBlanks: true }
          })
        }
      })
      .catch(function() {})
  }, [datasetId, dataset.source])

  // Fetch lightweight filter options when filter modal opens (not all rows)
  useEffect(function() {
    if (!showFilters || rowsLoaded || loadingRows) return
    setLoadingRows(true)
    void (async function() {
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

        // Also update schema fields with values from the endpoint. PREFER the
        // server's list over any detection-time `sf.values` — /filter-options
        // returns up to 500 distinct values (exact ≤50K, deterministic-sample
        // above), which is authoritative and fixes the "missing values" bug
        // where a rare value absent from the loaded sample never appeared.
        schemaFields.forEach(function(sf) {
          const opt = fieldOpts[sf.field]
          if (opt?.values) sf.values = opt.values
          if (opt?.min != null && sf.min == null) sf.min = opt.min
          if (opt?.max != null && sf.max == null) sf.max = opt.max
          if (opt?.dateMin != null) sf.dateMin = opt.dateMin
          if (opt?.dateMax != null) sf.dateMax = opt.dateMax
          if (opt?.blanks != null) sf.blanks = opt.blanks
          sf.valuesCapped = !!opt?.valuesCapped
          sf.sampled = !!opt?.sampled
        })

        setRows(syntheticRows)
        setRowsLoaded(true)
      } catch {}
      setLoadingRows(false)
    })()
  }, [showFilters, rowsLoaded, loadingRows, datasetId])

  const fCount = filterCount(filters) + filterCount(lockedFilters)

  // Compute filtered row count from RowsContext.
  // When the rows context is sampled (large datasets cap at 50k), we filter
  // the sample but scale up by totalRows / sampledCount so the displayed
  // numerator is comparable to dataset.row_count (the denominator). Without
  // the scale-up, "X of Y" mixed units: a sample-subset count next to a
  // full-dataset total, which made filter drops look ~10× more dramatic
  // than they actually were on big datasets.
  var { rows: ctxRows, rowsLoaded: ctxLoaded, sampled: ctxSampled, sampledCount: ctxSampledCount, totalRows: ctxTotalRows } = useRows()
  var filteredRowCount = useMemo(function() {
    // effectiveFilters folds in lockedFilters + the resolved relative period, so
    // a period-only selection updates the count even when fCount (explicit chips) is 0.
    if (!ctxLoaded || !ctxRows.length || Object.keys(effectiveFilters).length === 0) return null
    var matched = applyFilters(ctxRows, effectiveFilters).length
    if (ctxSampled && ctxSampledCount > 0 && ctxTotalRows > ctxSampledCount) {
      return Math.round(matched * (ctxTotalRows / ctxSampledCount))
    }
    return matched
  }, [ctxRows, ctxLoaded, ctxSampled, ctxSampledCount, ctxTotalRows, effectiveFilters])


  // Serialize the active filters (Sets → arrays for JSON) — the wire shape the
  // export / ask-ana / ad-hoc-report routes apply. Computed at render so the
  // "Report" picker can pass the in-view scope to an ad-hoc report.
  const serializeFilters = function(): SerializedFilters {
    const out: SerializedFilters = {}
    Object.entries(filters).forEach(function(entry) {
      const field = entry[0], f = entry[1]
      if (f.type === 'cat') out[field] = { type: 'cat', mode: f.mode, values: Array.from(f.values), excludeBlanks: f.excludeBlanks }
      else out[field] = f
    })
    return out
  }
  const serializedFilters = serializeFilters()

  // Save session handler
  const handleSaveSession = function() {
    setSessionSaving(true)
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
      <div style={{ marginRight: askAnaOpen ? 420 : 0, transition: 'margin-right .25s ease', display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <DatasetHeader dataset={dataset} userName={userName} orgName={orgName} outletCount={outletCount} filterCount={fCount} inViewFilters={Object.keys(serializedFilters).length ? serializedFilters : undefined} filteredRowCount={filteredRowCount} filteredRowCountIsEstimate={ctxSampled && ctxSampledCount > 0 && ctxTotalRows > ctxSampledCount} onFilterClick={function() { setShowFilters(true) }} onSaveSession={handleSaveSession} sessionSaving={sessionSaving} sessionSaved={sessionSaved} onAskAna={function() { setAskAnaOpen(function(v) { return !v }) }} askAnaOpen={askAnaOpen} />

      {/* Metric strip (comments / theme-fit / themes) + Saved Views switcher
          share ONE row to save vertical space — visible on every tab. A compact
          "Sampled" chip leads the row when the dataset exceeds the 50K cap (no
          longer a full-width banner — same signal, one fewer row). Metrics flex
          left, the view/period/save controls sit right (both wrap on narrow
          widths). docs/SAVED_VIEWS.md */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', background: '#fff', borderBottom: '1px solid #e8e8ec', padding: '6px 20px', flexShrink: 0, position: 'relative', zIndex: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', minWidth: 0 }}>
          {ctxSampled && ctxSampledCount > 0 && ctxTotalRows > ctxSampledCount && (
            <span title={'Sampled view — analyzing a representative ' + ctxSampledCount.toLocaleString() + ' of ' + ctxTotalRows.toLocaleString() + ' rows. Charts, statistics and theme counts are estimates scaled to the full dataset (deterministic 50K sample, ARCHITECTURE.md D6).'}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0, cursor: 'help', fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 10, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}>
              <span style={{ fontSize: 12 }}>{'◱'}</span> Sampled {Math.round(ctxSampledCount / ctxTotalRows * 100)}%
              <span style={{ color: '#4b6584', fontWeight: 600 }}>· {ctxSampledCount.toLocaleString()}/{ctxTotalRows.toLocaleString()}</span>
            </span>
          )}
          <DatasetMetricStrip datasetId={dataset.id} embedded />
        </div>
        <ViewsBar datasetId={datasetId} primaryDateField={primaryDateField} schemaFields={schemaFields} embedded />
      </div>

      {/* Period comparison strip — only when a period has a comparison offset */}
      <ComparisonStrip />

      {/* Global filter chips bar — visible on ALL tabs */}
      {fCount > 0 && (function() {
        var filterEntries = Object.entries(filters)
        var MAX_COLLAPSED = 4
        var visibleEntries = chipsExpanded ? filterEntries : filterEntries.slice(0, MAX_COLLAPSED)
        var hiddenCount = filterEntries.length - MAX_COLLAPSED
        return (
        <div style={{ background: '#fff4ef', borderBottom: '1px solid #fbd5c2', padding: '6px 20px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#e8622a', textTransform: 'uppercase', letterSpacing: '.07em', flexShrink: 0 }}>Filtered:</span>
          {visibleEntries.map(function(entry) {
            const field = entry[0], f = entry[1]
            const label = aliases[field] || field
            let desc = ''
            if (f.type === 'cat') { const vals = Array.from(f.values); const pre = f.mode === 'exclude' ? 'not ' : ''; desc = vals.length <= 2 ? pre + vals.join(', ') : pre + vals.length + ' values' }
            else if (f.type === 'range') desc = f.values[0] + '\u2013' + f.values[1]
            else if (f.type === 'daterange') { const fmt = function(ts: number) { const d = new Date(ts); return (d.getMonth() + 1) + '/' + d.getDate() }; desc = fmt(f.values[0]) + '\u2013' + fmt(f.values[1]) }
            return (
              <span key={field} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 20, background: 'white', border: '1px solid #fbd5c2', color: '#374151', whiteSpace: 'nowrap', flexShrink: 0 }}>
                <span style={{ color: '#e8622a', fontWeight: 700 }}>{label}:</span> {desc}
                <button onClick={function() { setFilters(function(prev) { const next: Filters = {}; Object.keys(prev).forEach(function(k) { if (k !== field) next[k] = prev[k] }); return next }) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 12, lineHeight: 1, padding: 0 }}>{'\u00D7'}</button>
              </span>
            )
          })}
          {hiddenCount > 0 && (
            <button onClick={function() { setChipsExpanded(function(v: boolean) { return !v }) }}
              style={{ fontSize: 10, fontWeight: 700, color: '#e8622a', background: 'white', border: '1px solid #fbd5c2', borderRadius: 20, cursor: 'pointer', padding: '2px 10px', flexShrink: 0 }}>
              {chipsExpanded ? '\u2212 Less' : '+ ' + hiddenCount + ' more'}
            </button>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexShrink: 0 }}>
            <button onClick={function() { setShowFilters(true) }}
              style={{ fontSize: 10, fontWeight: 700, color: '#e8622a', background: 'none', border: '1px solid #fbd5c2', borderRadius: 6, cursor: 'pointer', padding: '2px 8px' }}>
              Edit
            </button>
            <button onClick={function() { setFilters({}) }}
              style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}>
              Clear all
            </button>
          </div>
        </div>
        )
      })()}

      <main style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {children}
      </main>

      </div>

      {/* Ask Ana slide-out panel */}
      {askAnaOpen && (
        <AskAnaPanel
          datasetId={datasetId}
          datasetName={dataset.name}
          datasetSource={dataset.source}
          datasetRowCount={dataset.row_count}
          filters={filters}
          onClose={function() { setAskAnaOpen(false) }}
          onThemesChanged={function() { window.dispatchEvent(new Event('ana-themes-changed')) }}
        />
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
              <LottieLoader size={72} message="Loading data for filters..." />
            </div>
          </div>
        )
      )}
    </>
  )
}

export default function DatasetShell(props: Props) {
  // The rows API DROPS columns the schema marks ignore/hidden (sql/186,
  // rows/route.ts) — so the payload's shape depends on the schema, and a field
  // re-enabled in the Schema tab is simply ABSENT from rows fetched before that
  // change. RowsProvider's fetch is a one-shot (`if (rowsLoaded) return`) and
  // `router.refresh()` after a schema save re-renders the server layout without
  // remounting it, so the stale payload used to survive: selecting the
  // re-enabled field read as "no content" and TextMine bounced the choice back
  // to the first open field.
  //
  // Keying the provider on the analyzable field set remounts it — and only it —
  // when that set actually changes, so the rows are refetched WITH the column.
  // A string key means prop-identity churn can't trigger a remount, and an
  // unchanged schema produces an identical key (zero behaviour change on every
  // normal render). FilterProvider sits OUTSIDE, so filters survive the remount.
  const analyzableKey = analyzableFieldsKey(props.schemaFields)
  return (
    <FilterProvider>
      <RowsProvider key={analyzableKey} datasetId={props.datasetId} schemaFields={props.schemaFields} datasetSource={props.dataset.source} expectedRows={props.dataset.row_count}>
        <ShellInner {...props} />
      </RowsProvider>
    </FilterProvider>
  )
}
