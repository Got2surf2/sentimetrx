'use client'
// components/analyze/FiltersModal.tsx
// Floating modal for global data filtering.
// Per-field: categorical checkboxes, numeric range slider, date range.
// Matches Ana.html's FiltersTab pattern.

import { useState, useEffect, useMemo } from 'react'
import type { Filters, SerializedFilters } from '@/lib/filterUtils'

var T = {
  bg: '#f4f5f7', bgCard: '#ffffff', border: '#e5e7eb', borderMid: '#d1d5db',
  text: '#111827', textMid: '#374151', textMute: '#6b7280', textFaint: '#9ca3af',
  accent: '#e8622a', accentBg: '#fff4ef', accentMid: '#fbd5c2',
  green: '#16a34a', red: '#dc2626', redBg: '#fef2f2',
  blue: '#2563eb', blueBg: '#eff6ff',
}

interface SchemaField { field: string; type: string; label?: string; values?: string[]; min?: number; max?: number }

interface Props {
  schema: SchemaField[]
  rows: Record<string, unknown>[]
  filters: Filters
  onApply: (f: Filters) => void
  onClose: () => void
  aliases?: Record<string, string>
}

// Internal pending filter format (serializable — values as arrays not Sets)
interface PendingCat { type: 'cat'; values: string[]; excludeBlanks: boolean }
interface PendingRange { type: 'range'; values: [number, number]; includeBlanks: boolean }
interface PendingDate { type: 'daterange'; values: [number, number]; includeBlanks: boolean }
type PendingFilter = PendingCat | PendingRange | PendingDate
type PendingFilters = Record<string, PendingFilter>

function toPending(filters: Filters): PendingFilters {
  var out: PendingFilters = {}
  Object.entries(filters).forEach(function(e) {
    var field = e[0], f = e[1]
    if (f.type === 'cat') out[field] = { type: 'cat', values: Array.from(f.values), excludeBlanks: f.excludeBlanks }
    else if (f.type === 'range') out[field] = { type: 'range', values: [...f.values], includeBlanks: f.includeBlanks }
    else if (f.type === 'daterange') out[field] = { type: 'daterange', values: [...f.values], includeBlanks: f.includeBlanks }
  })
  return out
}

function toReal(pending: PendingFilters): Filters {
  var out: Filters = {}
  Object.entries(pending).forEach(function(e) {
    var field = e[0], f = e[1]
    if (f.type === 'cat') out[field] = { type: 'cat', values: new Set(f.values), excludeBlanks: f.excludeBlanks }
    else if (f.type === 'range') out[field] = f as any
    else if (f.type === 'daterange') out[field] = f as any
  })
  return out
}

export default function FiltersModal({ schema, rows, filters, onApply, onClose, aliases = {} }: Props) {
  var [pending, setPending] = useState<PendingFilters>(function() { return toPending(filters) })
  var [dirty, setDirty] = useState(false)

  var filterable = useMemo(function() {
    return schema.filter(function(f) { return f.type === 'categorical' || f.type === 'numeric' || f.type === 'date' })
  }, [schema])

  var numericRanges = useMemo(function() {
    var ranges: Record<string, [number, number]> = {}
    filterable.filter(function(f) { return f.type === 'numeric' }).forEach(function(f) {
      var vals = rows.map(function(r) { return parseFloat(String(r[f.field] ?? '')) }).filter(function(v) { return !isNaN(v) })
      if (vals.length) ranges[f.field] = [Math.min.apply(null, vals), Math.max.apply(null, vals)]
    })
    return ranges
  }, [filterable, rows])

  function fieldLabel(field: string): string {
    var f = schema.find(function(s) { return s.field === field })
    return (f && f.label && f.label !== f.field ? f.label : aliases[field]) || field
  }

  function updatePending(field: string, update: PendingFilter) {
    setPending(function(prev) { return { ...prev, [field]: update } })
    setDirty(true)
  }

  function removePending(field: string) {
    setPending(function(prev) { var n = { ...prev }; delete n[field]; return n })
    setDirty(true)
  }

  function handleApply() {
    onApply(toReal(pending))
    onClose()
  }

  function handleClear() {
    setPending({})
    onApply({})
    setDirty(false)
  }

  var activeCount = Object.keys(filters).length

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}>
      <div style={{ background: T.bg, width: 560, maxWidth: '100%', maxHeight: '88vh', borderRadius: 16, boxShadow: '0 24px 72px rgba(0,0,0,.28)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        onClick={function(e) { e.stopPropagation() }}>

        {/* Header */}
        <div style={{ background: T.bgCard, borderBottom: '1px solid ' + T.border, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: T.text, flexShrink: 0 }}>Filters</span>
            <span style={{ fontSize: 11, color: T.textMute }}>Applies globally across all tabs</span>
            {activeCount > 0 && !dirty && (
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: T.accentBg, color: T.accent, border: '1px solid ' + T.accentMid, flexShrink: 0 }}>
                {activeCount} active
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            {activeCount > 0 && (
              <button onClick={handleClear}
                style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 7, background: T.redBg, color: T.red, border: '1px solid ' + T.red + '30', cursor: 'pointer' }}>
                Clear all
              </button>
            )}
            <button onClick={handleApply} disabled={!dirty}
              style={{ fontSize: 12, fontWeight: 700, padding: '6px 16px', borderRadius: 8, background: dirty ? T.accent : '#e5e7eb', color: dirty ? 'white' : '#9ca3af', border: 'none', cursor: dirty ? 'pointer' : 'not-allowed', transition: 'all .15s' }}>
              Apply Filters
            </button>
            <button onClick={onClose}
              style={{ fontSize: 20, fontWeight: 400, background: 'transparent', border: 'none', cursor: 'pointer', color: T.textMute, lineHeight: 1, padding: '0 4px', flexShrink: 0 }}>
              {'\u00D7'}
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>

          {/* Active filter chips */}
          {activeCount > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 20, padding: '10px 14px', background: T.accentBg, borderRadius: 10, border: '1px solid ' + T.accentMid }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: T.accent, alignSelf: 'center', marginRight: 4 }}>Active:</span>
              {Object.entries(filters).map(function(e) {
                var field = e[0], f = e[1]
                var lbl = fieldLabel(field)
                var desc = f.type === 'cat'
                  ? Array.from(f.values).slice(0, 2).join(', ') + (f.values.size > 2 ? ' +' + (f.values.size - 2) : '')
                  : f.values[0] + '\u2013' + f.values[1]
                return (
                  <span key={field} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, padding: '3px 10px', background: 'white', borderRadius: 12, border: '1px solid ' + T.accentMid, color: T.text }}>
                    {lbl}: {desc}
                    <button onClick={function() { removePending(field); onApply(toReal(function() { var n = toPending(filters); delete n[field]; return n }())) }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textFaint, padding: 0, fontSize: 13, lineHeight: 1 }}>{'\u00D7'}</button>
                  </span>
                )
              })}
            </div>
          )}

          {filterable.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: T.textFaint, fontSize: 13 }}>
              No filterable fields. Add categorical or numeric fields to your schema.
            </div>
          )}

          {/* Filter cards grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
            {filterable.map(function(f) {
              var pf = pending[f.field]
              var isActive = !!filters[f.field]
              var lbl = fieldLabel(f.field)
              var blankCount = rows.filter(function(r) { var v = r[f.field]; return v == null || String(v).trim() === '' }).length

              // ── Categorical ──────────────────────────────────────────
              if (f.type === 'categorical') {
                var allVals = f.values || Array.from(new Set(rows.map(function(r) { return String(r[f.field] ?? '') }).filter(Boolean))).sort()
                var selectedVals = pf && pf.type === 'cat' ? new Set(pf.values) : null
                var allSelected = !selectedVals || selectedVals.size === allVals.length
                var excludeBlanks = pf && (pf as PendingCat).excludeBlanks === true

                fvar toggleVal = function(v: string) { {
                  var cur = selectedVals ? new Set(selectedVals) : new Set(allVals)
                  if (cur.has(v)) cur.delete(v); else cur.add(v)
                  if (cur.size === allVals.length && !excludeBlanks) { removePending(f.field) }
                  else { updatePending(f.field, { type: 'cat', values: Array.from(cur), excludeBlanks: excludeBlanks }) }
                }

                var selectAllCat = function() { removePending(f.field) }
                var excludeAllCat = function() { updatePending(f.field, { type: 'cat', values: [], excludeBlanks: excludeBlanks }) }

                return (
                  <div key={f.field} style={{ background: T.bgCard, border: (isActive ? '2px solid ' + T.accent : '1px solid ' + T.border), borderRadius: 10, padding: '14px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 6 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.07em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lbl}</div>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        <button onClick={selectAllCat} style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: allSelected ? T.accentBg : 'transparent', border: '1px solid ' + (allSelected ? T.accent : T.borderMid), color: allSelected ? T.accent : T.textMid, cursor: 'pointer' }}>All</button>
                        <button onClick={excludeAllCat} style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: 'transparent', border: '1px solid ' + T.borderMid, color: T.textMid, cursor: 'pointer' }}>None</button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 130, overflowY: 'auto' }}>
                      {allVals.map(function(v) {
                        var sel = allSelected || (selectedVals != null && selectedVals.has(v))
                        return (
                          <button key={v} onClick={function() { toggleVal(v) }}
                            style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, background: sel ? T.accentBg : 'transparent', border: '1px solid ' + (sel ? T.accent : T.border), color: sel ? T.accent : T.textMid, cursor: 'pointer', fontWeight: sel ? 600 : 400, transition: 'all .1s' }}>
                            {v}
                          </button>
                        )
                      })}
                    </div>
                    {blankCount > 0 && (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid ' + T.border }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 11, color: excludeBlanks ? T.red : T.textMid }}>
                          <input type="checkbox" checked={!excludeBlanks}
                            onChange={function() {
                              var newExclude = !excludeBlanks
                              if (!selectedVals && !newExclude) { removePending(f.field) }
                              else { updatePending(f.field, { type: 'cat', values: selectedVals ? Array.from(selectedVals) : [...allVals], excludeBlanks: newExclude }) }
                            }}
                            style={{ width: 12, height: 12, accentColor: T.accent, cursor: 'pointer' }} />
                          Include blanks <span style={{ color: T.textFaint }}>({blankCount})</span>
                        </label>
                      </div>
                    )}
                  </div>
                )
              }

              // ── Numeric ──────────────────────────────────────────────
              if (f.type === 'numeric' && numericRanges[f.field]) {
                var range = numericRanges[f.field]
                var absMin = range[0], absMax = range[1]
                var curMin = pf && pf.type === 'range' ? pf.values[0] : absMin
                var curMax = pf && pf.type === 'range' ? pf.values[1] : absMax
                var inclBlanks = pf ? (pf as PendingRange).includeBlanks !== false : true

                var setNumRange = function(min: number, max: number, ib?: boolean) {
                  var incl = ib !== undefined ? ib : inclBlanks
                  if (min === absMin && max === absMax && incl) { removePending(f.field) }
                  else { updatePending(f.field, { type: 'range', values: [min, max], includeBlanks: incl }) }
                }

                var pctLeft = ((curMin - absMin) / (absMax - absMin || 1) * 100)
                var pctRight = (100 - (curMax - absMin) / (absMax - absMin || 1) * 100)

                return (
                  <div key={f.field} style={{ background: T.bgCard, border: (isActive ? '2px solid ' + T.accent : '1px solid ' + T.border), borderRadius: 10, padding: '14px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.07em' }}>{lbl}</div>
                      {isActive && <span style={{ fontSize: 10, color: T.accent, fontWeight: 700 }}>{curMin} \u2013 {curMax}</span>}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: T.textMid, marginBottom: 4 }}>
                      <span>{absMin}</span><span>{absMax}</span>
                    </div>
                    <div style={{ position: 'relative', height: 20, marginBottom: 8 }}>
                      <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 4, background: T.border, borderRadius: 2, transform: 'translateY(-50%)' }} />
                      <div style={{ position: 'absolute', top: '50%', left: pctLeft + '%', right: pctRight + '%', height: 4, background: T.accent, borderRadius: 2, transform: 'translateY(-50%)' }} />
                      <input type="range" min={absMin} max={absMax} step={(absMax - absMin) / 100 || 1} value={curMin}
                        onChange={function(e) { setNumRange(Math.min(Number(e.target.value), curMax), curMax) }}
                        style={{ position: 'absolute', width: '100%', top: 0, height: '100%', opacity: 0, cursor: 'pointer', zIndex: 2 }} />
                      <input type="range" min={absMin} max={absMax} step={(absMax - absMin) / 100 || 1} value={curMax}
                        onChange={function(e) { setNumRange(curMin, Math.max(Number(e.target.value), curMin)) }}
                        style={{ position: 'absolute', width: '100%', top: 0, height: '100%', opacity: 0, cursor: 'pointer', zIndex: 2 }} />
                    </div>
                    {blankCount > 0 && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 11, color: inclBlanks ? T.textMid : T.red }}>
                        <input type="checkbox" checked={inclBlanks}
                          onChange={function(e) { setNumRange(curMin, curMax, e.target.checked) }}
                          style={{ width: 12, height: 12, accentColor: T.accent, cursor: 'pointer' }} />
                        Include blanks <span style={{ color: T.textFaint }}>({blankCount})</span>
                      </label>
                    )}
                  </div>
                )
              }

              // ── Date ─────────────────────────────────────────────────
              if (f.type === 'date') {
                var dateVals = rows.map(function(r) { return String(r[f.field] ?? '') }).filter(Boolean)
                var timestamps = dateVals.map(function(v) { var d = new Date(v); return isNaN(d.getTime()) ? 0 : d.getTime() }).filter(function(t) { return t > 0 })
                if (!timestamps.length) return null
                var absMinTs = Math.min.apply(null, timestamps), absMaxTs = Math.max.apply(null, timestamps)
                var curMinTs = pf && pf.type === 'daterange' ? pf.values[0] : absMinTs
                var curMaxTs = pf && pf.type === 'daterange' ? pf.values[1] : absMaxTs
                var inclBlanksDt = pf ? (pf as PendingDate).includeBlanks !== false : true
                var fmtDate = function(ts: number) { var d = new Date(ts); return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear() }
                var stepMs = Math.max(86400000, Math.round((absMaxTs - absMinTs) / 200))

                var setDateRange = function(minTs: number, maxTs: number, ib?: boolean) {
                  var incl = ib !== undefined ? ib : inclBlanksDt
                  if (minTs === absMinTs && maxTs === absMaxTs && incl) { removePending(f.field) }
                  else { updatePending(f.field, { type: 'daterange', values: [minTs, maxTs], includeBlanks: incl }) }
                }

                var dtPctLeft = absMaxTs > absMinTs ? ((curMinTs - absMinTs) / (absMaxTs - absMinTs) * 100) : 0
                var dtPctRight = absMaxTs > absMinTs ? (100 - (curMaxTs - absMinTs) / (absMaxTs - absMinTs) * 100) : 0

                return (
                  <div key={f.field} style={{ background: T.bgCard, border: (isActive ? '2px solid ' + T.accent : '1px solid ' + T.border), borderRadius: 10, padding: '14px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.07em' }}>{lbl}</div>
                      {isActive && <span style={{ fontSize: 10, color: T.accent, fontWeight: 700 }}>{fmtDate(curMinTs)} \u2013 {fmtDate(curMaxTs)}</span>}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.textFaint, marginBottom: 4 }}>
                      <span>{fmtDate(absMinTs)}</span><span>{fmtDate(absMaxTs)}</span>
                    </div>
                    <div style={{ position: 'relative', height: 20, marginBottom: 8 }}>
                      <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 4, background: T.border, borderRadius: 2, transform: 'translateY(-50%)' }} />
                      <div style={{ position: 'absolute', top: '50%', left: dtPctLeft + '%', right: dtPctRight + '%', height: 4, background: T.accent, borderRadius: 2, transform: 'translateY(-50%)' }} />
                      <input type="range" min={absMinTs} max={absMaxTs} step={stepMs} value={curMinTs}
                        onChange={function(e) { setDateRange(Math.min(Number(e.target.value), curMaxTs), curMaxTs) }}
                        style={{ position: 'absolute', width: '100%', top: 0, height: '100%', opacity: 0, cursor: 'pointer', zIndex: 2 }} />
                      <input type="range" min={absMinTs} max={absMaxTs} step={stepMs} value={curMaxTs}
                        onChange={function(e) { setDateRange(curMinTs, Math.max(Number(e.target.value), curMinTs)) }}
                        style={{ position: 'absolute', width: '100%', top: 0, height: '100%', opacity: 0, cursor: 'pointer', zIndex: 2 }} />
                    </div>
                    {blankCount > 0 && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 11, color: inclBlanksDt ? T.textMid : T.red }}>
                        <input type="checkbox" checked={inclBlanksDt}
                          onChange={function(e) { setDateRange(curMinTs, curMaxTs, e.target.checked) }}
                          style={{ width: 12, height: 12, accentColor: T.accent, cursor: 'pointer' }} />
                        Include blanks <span style={{ color: T.textFaint }}>({blankCount})</span>
                      </label>
                    )}
                  </div>
                )
              }

              return null
            })}
          </div>
        </div>

        {/* Footer */}
        <div style={{ background: T.bgCard, borderTop: '1px solid ' + T.border, padding: '10px 20px', flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose}
            style={{ fontSize: 12, fontWeight: 600, padding: '7px 18px', background: T.bg, color: T.textMid, border: '1px solid ' + T.border, borderRadius: 8, cursor: 'pointer' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
