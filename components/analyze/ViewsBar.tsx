'use client'
// components/analyze/ViewsBar.tsx
// Dedicated Saved Views switcher for the Analyze workspace. Lists a dataset's
// saved views + snapshots, loads/freezes them, and saves / renames / shares /
// deletes. Also hosts the relative-period picker (gated on primaryDateField).
// See docs/SAVED_VIEWS.md.

import { useState, useEffect, useCallback } from 'react'
import { useFilters } from './FilterContext'
import { useRows } from './RowsContext'
import { filterCount, serializeFilters, applyFilters, resolvePeriod } from '@/lib/filterUtils'
import type { SerializedFilters, PeriodSpec, PeriodGranularity, PeriodAnchor } from '@/lib/filterUtils'
import { computeAnalyticsFromRows } from '@/lib/analyticsCompute'
import type { SchemaFieldConfig } from '@/lib/analyzeTypes'
import { T } from '@/lib/analyzeTheme'
import SnapshotModal from './SnapshotModal'
import type { SnapshotRow } from './SnapshotModal'

interface SavedView {
  id:            string
  name:          string
  kind:          'view' | 'snapshot'
  visibility:    'private' | 'org'
  expires_at:    string | null
  source_view_name: string | null
  created_at:    string
  filter_config: { filters?: SerializedFilters; period?: PeriodSpec | null } | null
  frozen:        SnapshotRow['frozen']
}

const PERIOD_PRESETS: { label: string; granularity: PeriodGranularity; anchor: PeriodAnchor }[] = [
  { label: 'This month',   granularity: 'month',   anchor: 'current' },
  { label: 'Last month',   granularity: 'month',   anchor: 'last' },
  { label: 'This quarter', granularity: 'quarter', anchor: 'current' },
  { label: 'Last quarter', granularity: 'quarter', anchor: 'last' },
  { label: 'This year',    granularity: 'year',    anchor: 'current' },
  { label: 'Last year',    granularity: 'year',    anchor: 'last' },
]

function periodLabel(p: PeriodSpec | null): string {
  if (!p) return 'All time'
  const m = PERIOD_PRESETS.find(function(x) { return x.granularity === p.primary.granularity && x.anchor === p.primary.anchor })
  return m ? m.label : 'Custom period'
}

const DAY = 86_400_000

export default function ViewsBar({ datasetId, primaryDateField, schemaFields }: { datasetId: string; primaryDateField?: string; schemaFields: SchemaFieldConfig[] }) {
  const { filters, effectiveFilters, period, setPeriod, activeView, loadView, clearActiveView, isViewDirty } = useFilters()
  const { rows, rowsLoaded, sampled, totalRows, fetchRows } = useRows()
  const [views, setViews] = useState<SavedView[]>([])
  const [snaps, setSnaps] = useState<SavedView[]>([])
  const [open, setOpen] = useState(false)
  const [periodOpen, setPeriodOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [naming, setNaming] = useState<null | 'view' | 'snapshot'>(null)
  const [draftName, setDraftName] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [pendingFreeze, setPendingFreeze] = useState<string | null>(null)
  const [openSnap, setOpenSnap] = useState<SnapshotRow | null>(null)
  const [notice, setNotice] = useState('')

  const baseUrl = '/api/datasets/' + datasetId + '/views'
  const flash = useCallback(function(msg: string) { setNotice(msg); setTimeout(function() { setNotice('') }, 3000) }, [])

  const refresh = useCallback(function() {
    fetch(baseUrl)
      .then(function(r) { return r.ok ? r.json() : { views: [] } })
      .then(function(d) {
        const all: SavedView[] = d.views || []
        setViews(all.filter(function(v) { return v.kind === 'view' }))
        setSnaps(all.filter(function(v) { return v.kind === 'snapshot' }))
      })
      .catch(function() {})
  }, [baseUrl])

  useEffect(function() { refresh() }, [refresh])

  function handleGone() {
    flash('That item is no longer available.')
    clearActiveView()
    setOpenSnap(null)
    refresh()
  }

  function currentConfig() {
    return { filters: serializeFilters(filters), period: period }
  }

  // ── Views ───────────────────────────────────────────────────────────────
  function saveNew() {
    const name = draftName.trim()
    if (!name) return
    setBusy(true)
    fetch(baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'view', name: name, filter_config: currentConfig() }) })
      .then(function(r) { if (!r.ok) throw new Error(); return r.json() })
      .then(function(created: SavedView) { loadView(created); setNaming(null); setDraftName(''); refresh(); flash('Saved “' + name + '”.') })
      .catch(function() { flash('Could not save the view.') })
      .finally(function() { setBusy(false) })
  }

  function updateActive() {
    if (!activeView) return
    setBusy(true)
    const cfg = currentConfig()
    fetch(baseUrl + '/' + activeView.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filter_config: cfg }) })
      .then(function(r) { if (r.status === 404) return handleGone(); if (!r.ok) throw new Error()
        loadView({ id: activeView.id, name: activeView.name, filter_config: cfg }); refresh(); flash('Updated “' + activeView.name + '”.') })
      .catch(function() { flash('Could not update the view.') })
      .finally(function() { setBusy(false) })
  }

  function rename(v: SavedView) {
    const name = renameDraft.trim()
    if (!name) { setRenaming(null); return }
    fetch(baseUrl + '/' + v.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name }) })
      .then(function(r) { if (r.status === 404) return handleGone(); if (!r.ok) throw new Error()
        if (activeView && activeView.id === v.id) loadView({ id: v.id, name: name, filter_config: v.filter_config }); setRenaming(null); refresh() })
      .catch(function() { flash('Could not rename.') })
  }

  function toggleVisibility(v: SavedView) {
    const next = v.visibility === 'org' ? 'private' : 'org'
    fetch(baseUrl + '/' + v.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visibility: next }) })
      .then(function(r) { if (r.status === 404) return handleGone(); if (!r.ok) throw new Error(); refresh() })
      .catch(function() { flash('Could not change sharing.') })
  }

  function remove(v: SavedView) {
    if (!window.confirm('Delete “' + v.name + '”? This cannot be undone.')) return
    fetch(baseUrl + '/' + v.id, { method: 'DELETE' })
      .then(function(r) { if (r.status === 404) return handleGone(); if (!r.ok) throw new Error()
        if (activeView && activeView.id === v.id) clearActiveView(); setOpenSnap(null); refresh() })
      .catch(function() { flash('Could not delete.') })
  }

  // ── Snapshots (freeze captures client-computed aggregates — §5) ──────────
  function startFreeze() {
    setNaming('snapshot')
    setDraftName((activeView && !isViewDirty ? activeView.name : 'Snapshot') + ' · ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
  }

  function submitFreeze() {
    const name = draftName.trim()
    if (!name) return
    setNaming(null)
    if (rowsLoaded && rows.length >= 0) runCapture(name)
    else { setPendingFreeze(name); fetchRows() }
  }

  // Once rows are in memory, capture the frozen aggregates over the filtered set.
  useEffect(function() {
    if (pendingFreeze && rowsLoaded) { runCapture(pendingFreeze); setPendingFreeze(null) }
  }, [pendingFreeze, rowsLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  function runCapture(name: string) {
    setBusy(true)
    const schema = { fields: schemaFields, autoDetected: false, version: 1 }
    const filtered = applyFilters(rows, effectiveFilters)
    const analytics = computeAnalyticsFromRows(filtered, schema)
    const frozen = {
      capturedAt:       new Date().toISOString(),
      filteredRowCount: filtered.length,
      totalRowCount:    totalRows || rows.length,
      sampled:          sampled,
      period:           period ? { range: resolvePeriod(period.primary, { now: Date.now() }) } : null,
      filters:          serializeFilters(filters),
      analytics:        analytics,
    }
    fetch(baseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      kind: 'snapshot', name: name, filter_config: currentConfig(), frozen: frozen,
      source_view_name: (activeView && !isViewDirty) ? activeView.name : undefined,
    }) })
      .then(function(r) { if (!r.ok) throw new Error(); refresh(); flash('Froze “' + name + '”.') })
      .catch(function() { flash('Could not freeze a snapshot.') })
      .finally(function() { setBusy(false); setDraftName('') })
  }

  function patchExpiry(snap: SnapshotRow, expires_at: string | null) {
    fetch(baseUrl + '/' + snap.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expires_at: expires_at }) })
      .then(function(r) { if (r.status === 404) return handleGone(); if (!r.ok) throw new Error()
        setOpenSnap(function(s) { return s ? Object.assign({}, s, { expires_at: expires_at }) : s }); refresh() })
      .catch(function() { flash('Could not update retention.') })
  }

  function selectPreset(g: PeriodGranularity, a: PeriodAnchor) {
    if (!primaryDateField) return
    setPeriod({ field: primaryDateField, primary: { granularity: g, anchor: a } })
    setPeriodOpen(false)
  }

  const hasState = filterCount(filters) > 0 || !!period
  const activeLabel = activeView ? activeView.name + (isViewDirty ? ' (modified)' : '') : (hasState ? 'Unsaved view' : 'No filters')
  const pill = { fontSize: 11, fontWeight: 700 as const, padding: '4px 12px', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' as const }

  return (
    <div data-testid="views-bar" style={{ background: T.bgCard, borderBottom: '1px solid ' + T.border, padding: '6px 20px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, position: 'relative', zIndex: 30 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: T.textMute, textTransform: 'uppercase', letterSpacing: '.07em', flexShrink: 0 }}>View</span>

      <button onClick={function() { setOpen(function(v) { return !v }) }}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 7, border: '1px solid ' + T.border, background: activeView ? T.accentBg : T.bgCard, color: activeView ? T.accent : T.text, cursor: 'pointer', fontFamily: 'inherit' }}>
        <span>{activeLabel}</span><span style={{ fontSize: 9, color: T.textFaint }}>{'▼'}</span>
      </button>

      {primaryDateField && (
        <div style={{ position: 'relative' }}>
          <button onClick={function() { setPeriodOpen(function(v) { return !v }) }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 7, border: '1px solid ' + (period ? T.accentMid : T.border), background: period ? T.accentBg : T.bgCard, color: period ? T.accent : T.textMid, cursor: 'pointer', fontFamily: 'inherit' }}>
            <span>{'🗓 ' + periodLabel(period)}</span><span style={{ fontSize: 9, color: T.textFaint }}>{'▼'}</span>
          </button>
          {periodOpen && (
            <>
              <div onClick={function() { setPeriodOpen(false) }} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, width: 170, background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 10, boxShadow: '0 16px 48px rgba(0,0,0,.18)', zIndex: 50, padding: 5 }}>
                <button onClick={function() { setPeriod(null); setPeriodOpen(false) }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: !period ? T.accentBg : 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: !period ? 700 : 500, color: !period ? T.accent : T.text, padding: '6px 10px', borderRadius: 6 }}>All time</button>
                {PERIOD_PRESETS.map(function(p) {
                  const on = !!period && period.primary.granularity === p.granularity && period.primary.anchor === p.anchor
                  return (<button key={p.label} onClick={function() { selectPreset(p.granularity, p.anchor) }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', background: on ? T.accentBg : 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: on ? 700 : 500, color: on ? T.accent : T.text, padding: '6px 10px', borderRadius: 6 }}>{p.label}</button>)
                })}
              </div>
            </>
          )}
        </div>
      )}

      {activeView && isViewDirty && (<button disabled={busy} onClick={updateActive} style={{ ...pill, background: T.accent, color: 'white', border: 'none' }}>Update</button>)}
      {!naming && hasState && (
        <button disabled={busy} onClick={function() { setNaming('view'); setDraftName('') }} style={{ ...pill, background: T.bgCard, color: T.accent, border: '1px solid ' + T.accentMid }}>{activeView ? 'Save as new' : 'Save view'}</button>
      )}
      {!naming && hasState && (
        <button disabled={busy} onClick={startFreeze} style={{ ...pill, background: T.bgCard, color: T.textMid, border: '1px solid ' + T.border }}>📸 Freeze</button>
      )}
      {naming && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input autoFocus value={draftName} onChange={function(e) { setDraftName(e.target.value) }}
            onKeyDown={function(e) { if (e.key === 'Enter') (naming === 'snapshot' ? submitFreeze() : saveNew()); if (e.key === 'Escape') setNaming(null) }}
            placeholder={naming === 'snapshot' ? 'Name this snapshot' : 'Name this view'}
            style={{ fontSize: 16, padding: '4px 10px', borderRadius: 7, border: '1px solid ' + T.border, outline: 'none', fontFamily: 'inherit', width: 220 }} />
          <button disabled={busy || !draftName.trim()} onClick={naming === 'snapshot' ? submitFreeze : saveNew} style={{ ...pill, background: T.accent, color: 'white', border: 'none', opacity: draftName.trim() ? 1 : 0.5 }}>{naming === 'snapshot' ? 'Freeze' : 'Save'}</button>
          <button onClick={function() { setNaming(null) }} style={{ ...pill, background: 'none', color: T.textMute, border: 'none' }}>Cancel</button>
        </span>
      )}

      {notice && <span style={{ fontSize: 11, color: T.textMute, marginLeft: 4 }}>{notice}</span>}

      {open && (
        <>
          <div onClick={function() { setOpen(false) }} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{ position: 'absolute', top: '100%', left: 56, marginTop: 4, width: 320, maxHeight: 400, overflowY: 'auto', background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, boxShadow: '0 16px 48px rgba(0,0,0,.18)', zIndex: 50, padding: 6 }}>
            {views.length === 0 && (<div style={{ fontSize: 12, color: T.textFaint, padding: '14px 12px', textAlign: 'center' }}>No saved views yet. Filter, then “Save view”.</div>)}
            {views.map(function(v) {
              const isActive = !!activeView && activeView.id === v.id
              if (renaming === v.id) {
                return (
                  <div key={v.id} style={{ display: 'flex', gap: 6, padding: '6px 8px' }}>
                    <input autoFocus value={renameDraft} onChange={function(e) { setRenameDraft(e.target.value) }}
                      onKeyDown={function(e) { if (e.key === 'Enter') rename(v); if (e.key === 'Escape') setRenaming(null) }}
                      style={{ flex: 1, fontSize: 16, padding: '4px 8px', borderRadius: 6, border: '1px solid ' + T.border, outline: 'none', fontFamily: 'inherit' }} />
                    <button onClick={function() { rename(v) }} style={{ ...pill, background: T.accent, color: 'white', border: 'none' }}>Save</button>
                  </div>
                )
              }
              return (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 8, background: isActive ? T.accentBg : 'transparent' }}>
                  <button onClick={function() { loadView(v); setOpen(false) }} style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: isActive ? 700 : 500, color: isActive ? T.accent : T.text, padding: 0 }}>
                    {v.name}
                    {v.filter_config && v.filter_config.period && <span style={{ fontSize: 9, fontWeight: 700, color: T.textFaint, marginLeft: 6 }}>{'🗓'}</span>}
                    {v.visibility === 'org' && <span style={{ fontSize: 9, fontWeight: 700, color: T.textFaint, marginLeft: 6 }}>SHARED</span>}
                  </button>
                  <button title={v.visibility === 'org' ? 'Shared — click to make private' : 'Private — click to share'} onClick={function() { toggleVisibility(v) }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: T.textFaint, padding: 2 }}>{v.visibility === 'org' ? '👥' : '🔒'}</button>
                  <button title="Rename" onClick={function() { setRenaming(v.id); setRenameDraft(v.name) }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: T.textFaint, padding: 2 }}>{'✎'}</button>
                  <button title="Delete" onClick={function() { remove(v) }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: T.textFaint, padding: 2 }}>{'×'}</button>
                </div>
              )
            })}

            {snaps.length > 0 && (
              <>
                <div style={{ fontSize: 9, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.07em', padding: '8px 8px 4px' }}>Snapshots</div>
                {snaps.map(function(s) {
                  return (
                    <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 8 }}>
                      <button onClick={function() { setOpenSnap(s as unknown as SnapshotRow); setOpen(false) }} style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 500, color: T.text, padding: 0 }}>
                        📸 {s.name}
                      </button>
                      <button title="Delete" onClick={function() { remove(s) }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: T.textFaint, padding: 2 }}>{'×'}</button>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </>
      )}

      {openSnap && (
        <SnapshotModal snapshot={openSnap} schemaFields={schemaFields}
          onClose={function() { setOpenSnap(null) }}
          onDelete={function() { remove(openSnap as unknown as SavedView) }}
          onKeep={function() { patchExpiry(openSnap, null) }}
          onExtend={function() { patchExpiry(openSnap, new Date(Date.now() + 30 * DAY).toISOString()) }}
        />
      )}
    </div>
  )
}
