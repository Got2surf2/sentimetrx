'use client'
// components/analyze/FiltersModal.tsx
// Floating modal for global data filtering.
// Per-field: categorical checkboxes, numeric range slider, date range.
// Matches Ana.html's FiltersTab pattern.

import { useState, useEffect, useMemo } from 'react'
import type { Filters, SerializedFilters } from '@/lib/filterUtils'
import { resolveAlias } from '@/lib/aliasUtils'
import { T } from '@/lib/analyzeTheme'
import type { SchemaFieldConfig as SchemaField } from '@/lib/analyzeTypes'

interface Props {
  schema: SchemaField[]
  rows: Record<string, unknown>[]
  filters: Filters
  onApply: (f: Filters) => void
  onClose: () => void
  aliases?: Record<string, string>
}

// Internal pending filter format (serializable — values as arrays not Sets)
interface PendingCat { type: 'cat'; mode: 'include' | 'exclude'; values: string[]; excludeBlanks: boolean }
interface PendingRange { type: 'range'; values: [number, number]; includeBlanks: boolean }
interface PendingDate { type: 'daterange'; values: [number, number]; includeBlanks: boolean }
type PendingFilter = PendingCat | PendingRange | PendingDate
type PendingFilters = Record<string, PendingFilter>

function toPending(filters: Filters): PendingFilters {
  var out: PendingFilters = {}
  Object.entries(filters).forEach(function(e) {
    var field = e[0], f = e[1]
    if (f.type === 'cat') out[field] = { type: 'cat', mode: f.mode, values: Array.from(f.values), excludeBlanks: f.excludeBlanks }
    else if (f.type === 'range') out[field] = { type: 'range', values: [...f.values], includeBlanks: f.includeBlanks }
    else if (f.type === 'daterange') out[field] = { type: 'daterange', values: [...f.values], includeBlanks: f.includeBlanks }
  })
  return out
}

function toReal(pending: PendingFilters): Filters {
  var out: Filters = {}
  Object.entries(pending).forEach(function(e) {
    var field = e[0], f = e[1]
    if (f.type === 'cat') out[field] = { type: 'cat', mode: f.mode, values: new Set(f.values), excludeBlanks: f.excludeBlanks }
    else if (f.type === 'range') out[field] = f
    else if (f.type === 'daterange') out[field] = f
  })
  return out
}

export default function FiltersModal({ schema, rows, filters, onApply, onClose, aliases = {} }: Props) {
  var [pending, setPending] = useState<PendingFilters>(function() { return toPending(filters) })
  var [dirty, setDirty] = useState(false)

  var filterable = useMemo(function() {
    return schema.filter(function(f) { return f.type === 'categorical' || f.type === 'numeric' || f.type === 'date' })
  }, [schema])

  var filterSections = useMemo(function() {
    var core = filterable.filter(function(f) { return !f.section || f.section === 'core' })
    var custom = filterable.filter(function(f) { return f.section === 'custom' })
    var psycho = filterable.filter(function(f) { return f.section === 'psychographic' })
    var demo = filterable.filter(function(f) { return f.section === 'demographic' })
    var urlParam = filterable.filter(function(f) { return f.section === 'url_param' })
    var out: { key: string; label: string; fields: typeof filterable }[] = []
    if (core.length) out.push({ key: 'core', label: 'Core', fields: core })
    if (custom.length) out.push({ key: 'custom', label: 'Survey Questions', fields: custom })
    if (psycho.length) out.push({ key: 'psychographic', label: 'Psychographic', fields: psycho })
    if (demo.length) out.push({ key: 'demographic', label: 'Demographic', fields: demo })
    if (urlParam.length) out.push({ key: 'url_param', label: 'URL Parameters', fields: urlParam })
    return out
  }, [filterable])
  var hasSections = filterSections.length > 1
  var [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})

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
                var fmtChipDate = function(ts: number) { var d = new Date(ts); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
                var catPrefix = f.type === 'cat' && f.mode === 'exclude' ? 'not ' : ''
                var desc = f.type === 'cat'
                  ? catPrefix + Array.from(f.values).slice(0, 2).map(function(v) { return resolveAlias(field, v, schema) }).join(', ') + (f.values.size > 2 ? ' +' + (f.values.size - 2) : '')
                  : f.type === 'daterange'
                    ? fmtChipDate(f.values[0]) + ' \u2013 ' + fmtChipDate(f.values[1])
                    : f.values[0] + ' \u2013 ' + f.values[1]
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

          {filterSections.map(function(sec) {
            var collapsed = !!collapsedSections[sec.key]
            return (
              <div key={sec.key} style={{ marginBottom: hasSections ? 18 : 0 }}>
                {hasSections && (
                  <button onClick={function() { setCollapsedSections(function(prev) { var n = { ...prev }; n[sec.key] = !collapsed; return n }) }}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 8px', width: '100%' }}>
                    <span style={{ fontSize: 10, color: T.textFaint, transition: 'transform .15s', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', display: 'inline-block' }}>{'\u25BC'}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: T.textMid, letterSpacing: '.06em', textTransform: 'uppercase' }}>{sec.label}</span>
                    <span style={{ fontSize: 10, color: T.textFaint }}>({sec.fields.length})</span>
                  </button>
                )}
                {!collapsed && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
                    {sec.fields.map(function(f) {
              var pf = pending[f.field]
              var isActive = !!filters[f.field]
              var lbl = fieldLabel(f.field)
              // Prefer the live blank count from /filter-options — the rows here
              // are synthetic (one per distinct value) so counting them fabricates
              // blanks for any field with fewer distinct values than the widest.
              var blankCount = f.blanks != null
                ? f.blanks
                : rows.filter(function(r) { var v = r[f.field]; return v == null || String(v).trim() === '' }).length

              // ── Categorical ──────────────────────────────────────────
              if (f.type === 'categorical') {
                var allVals = f.values || Array.from(new Set(rows.map(function(r) { return String(r[f.field] ?? '') }).filter(Boolean))).sort()
                var pfCat = pf && pf.type === 'cat' ? (pf as PendingCat) : null
                // Default to 'exclude' mode for new toggles — that way unchecking
                // one value from "All" creates a denylist, and long-tail values
                // not present in the modal's top-N list still pass the filter.
                var mode: 'include' | 'exclude' = pfCat ? pfCat.mode : 'exclude'
                var pfVals: Set<string> = pfCat ? new Set(pfCat.values) : new Set()
                var excludeBlanks = !!(pfCat && pfCat.excludeBlanks)

                // "I want this in my data" highlight rule:
                //   no filter → all highlighted
                //   exclude mode → highlighted iff NOT in denylist
                //   include mode → highlighted iff in allowlist
                var isHighlighted = function(v: string): boolean {
                  if (!pfCat) return true
                  if (mode === 'exclude') return !pfVals.has(v)
                  return pfVals.has(v)
                }

                // "All" effective state — used to highlight the All button.
                var allSelected = !pfCat
                  || (mode === 'exclude' && pfVals.size === 0)
                  || (mode === 'include' && pfVals.size >= allVals.length)

                var toggleVal = function(v: string) {
                  var willHighlight = !isHighlighted(v)
                  var nextVals = new Set(pfVals)
                  if (mode === 'exclude') {
                    if (willHighlight) nextVals.delete(v); else nextVals.add(v)
                  } else {
                    if (willHighlight) nextVals.add(v); else nextVals.delete(v)
                  }
                  var nowAll = (mode === 'exclude' && nextVals.size === 0)
                            || (mode === 'include' && nextVals.size >= allVals.length)
                  if (nowAll && !excludeBlanks) {
                    removePending(f.field)
                  } else {
                    updatePending(f.field, { type: 'cat', mode: mode, values: Array.from(nextVals), excludeBlanks: excludeBlanks })
                  }
                }

                // "All" — clear the filter entirely (everything passes).
                var selectAllCat = function() { removePending(f.field) }
                // "None" — flip into include mode with empty allowlist (= nothing
                // passes). User then clicks values to add to the allowlist.
                var excludeAllCat = function() {
                  updatePending(f.field, { type: 'cat', mode: 'include', values: [], excludeBlanks: excludeBlanks })
                }

                var modeLabel = pfCat
                  ? (mode === 'exclude'
                      ? 'Excluding ' + pfVals.size + ' value' + (pfVals.size === 1 ? '' : 's')
                      : 'Including only ' + pfVals.size + ' value' + (pfVals.size === 1 ? '' : 's'))
                  : ''

                return (
                  <div key={f.field} style={{ background: T.bgCard, border: (isActive ? '2px solid ' + T.accent : '1px solid ' + T.border), borderRadius: 10, padding: '14px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 6 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.07em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lbl}</div>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        <button onClick={selectAllCat} style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: allSelected ? T.accentBg : 'transparent', border: '1px solid ' + (allSelected ? T.accent : T.borderMid), color: allSelected ? T.accent : T.textMid, cursor: 'pointer' }}>All</button>
                        <button onClick={excludeAllCat} style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: 'transparent', border: '1px solid ' + T.borderMid, color: T.textMid, cursor: 'pointer' }}>None</button>
                      </div>
                    </div>
                    {modeLabel && (
                      <div style={{ fontSize: 10, fontWeight: 600, color: T.accent, marginBottom: 6 }}>{modeLabel}</div>
                    )}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxHeight: 130, overflowY: 'auto' }}>
                      {allVals.map(function(v) {
                        var sel = isHighlighted(v)
                        return (
                          <button key={v} onClick={function() { toggleVal(v) }}
                            style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, background: sel ? T.accentBg : 'transparent', border: '1px solid ' + (sel ? T.accent : T.border), color: sel ? T.accent : T.textMid, cursor: 'pointer', fontWeight: sel ? 600 : 400, transition: 'all .1s' }}>
                            {resolveAlias(f.field, v, schema)}
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
                              if (!pfCat) {
                                // No filter yet — only need to act if user wants
                                // to drop blanks. Use exclude mode so non-blank
                                // long-tail values still pass.
                                if (newExclude) {
                                  updatePending(f.field, { type: 'cat', mode: 'exclude', values: [], excludeBlanks: true })
                                }
                              } else {
                                updatePending(f.field, { type: 'cat', mode: mode, values: Array.from(pfVals), excludeBlanks: newExclude })
                                // If toggling blanks back on collapses to the
                                // identity filter, clear it.
                                if (!newExclude) {
                                  var collapses = (mode === 'exclude' && pfVals.size === 0)
                                              || (mode === 'include' && pfVals.size >= allVals.length)
                                  if (collapses) removePending(f.field)
                                }
                              }
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
                // Prefer the schema's true earliest/latest (dateMin/dateMax) for
                // the slider DOMAIN: the loaded rows may be sampled/truncated and
                // the schema's `values` list is capped at 500 dates, so neither is
                // a reliable source for the range ends. Fall back to row-derived
                // extents when the schema lacks dateMin/dateMax.
                var fdMinTs = f.dateMin ? new Date(f.dateMin).getTime() : NaN
                var fdMaxTs = f.dateMax ? new Date(f.dateMax).getTime() : NaN
                if (!timestamps.length && isNaN(fdMinTs) && isNaN(fdMaxTs)) return null
                var rowMinTs = timestamps.length ? Math.min.apply(null, timestamps) : Infinity
                var rowMaxTs = timestamps.length ? Math.max.apply(null, timestamps) : -Infinity
                var absMinTs = !isNaN(fdMinTs) ? Math.min(fdMinTs, rowMinTs) : rowMinTs
                var absMaxTs = !isNaN(fdMaxTs) ? Math.max(fdMaxTs, rowMaxTs) : rowMaxTs
                var curMinTs = pf && pf.type === 'daterange' ? pf.values[0] : absMinTs
                var curMaxTs = pf && pf.type === 'daterange' ? pf.values[1] : absMaxTs
                var inclBlanksDt = pf ? (pf as PendingDate).includeBlanks !== false : true
                var fmtD = function(ts: number) { return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
                var stepMs = Math.max(86400000, Math.round((absMaxTs - absMinTs) / 200))

                var setDateRange = function(minTs: number, maxTs: number, ib?: boolean) {
                  var incl = ib !== undefined ? ib : inclBlanksDt
                  if (minTs === absMinTs && maxTs === absMaxTs && incl) { removePending(f.field) }
                  else { updatePending(f.field, { type: 'daterange', values: [minTs, maxTs], includeBlanks: incl }) }
                }

                var dtPctLeft = absMaxTs > absMinTs ? ((curMinTs - absMinTs) / (absMaxTs - absMinTs) * 100) : 0
                var dtPctRight = absMaxTs > absMinTs ? (100 - (curMaxTs - absMinTs) / (absMaxTs - absMinTs) * 100) : 0

                var startDrag = function(side: 'left' | 'right') {
                  return function(e: React.MouseEvent | React.TouchEvent) {
                    e.preventDefault()
                    var track = (e.currentTarget as HTMLElement).parentElement as HTMLElement
                    var rect = track.getBoundingClientRect()
                    var getX = function(ev: MouseEvent | TouchEvent): number {
                      return 'touches' in ev ? ev.touches[0].clientX : (ev as MouseEvent).clientX
                    }
                    var onMove = function(ev: MouseEvent | TouchEvent) {
                      var pct = Math.max(0, Math.min(1, (getX(ev) - rect.left) / rect.width))
                      var ts = Math.round(absMinTs + pct * (absMaxTs - absMinTs))
                      ts = Math.round(ts / stepMs) * stepMs
                      ts = Math.max(absMinTs, Math.min(absMaxTs, ts))
                      if (side === 'left') {
                        setDateRange(Math.min(ts, curMaxTs), curMaxTs)
                      } else {
                        setDateRange(curMinTs, Math.max(ts, curMinTs))
                      }
                    }
                    var onUp = function() {
                      document.removeEventListener('mousemove', onMove)
                      document.removeEventListener('mouseup', onUp)
                      document.removeEventListener('touchmove', onMove)
                      document.removeEventListener('touchend', onUp)
                    }
                    document.addEventListener('mousemove', onMove)
                    document.addEventListener('mouseup', onUp)
                    document.addEventListener('touchmove', onMove)
                    document.addEventListener('touchend', onUp)
                  }
                }

                var thumbBase: React.CSSProperties = { position: 'absolute', top: '50%', width: 18, height: 18, borderRadius: '50%', background: '#fff', border: '3px solid ' + T.accent, transform: 'translate(-50%, -50%)', cursor: 'grab', boxShadow: '0 1px 4px rgba(0,0,0,.18)', touchAction: 'none' }
                // When thumbs overlap (within 3%), put left thumb on top so user can drag it right
                var thumbsOverlap = Math.abs(dtPctLeft - (100 - dtPctRight)) < 3
                var leftZ = thumbsOverlap ? 7 : 5
                var rightZ = thumbsOverlap ? 4 : 5

                return (
                  <div key={f.field} style={{ background: T.bgCard, border: (isActive ? '2px solid ' + T.accent : '1px solid ' + T.border), borderRadius: 10, padding: '14px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.07em' }}>{lbl}</div>
                    </div>
                    {/* Selected range — gray, above slider */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: T.textMid, marginBottom: 6, fontWeight: 600 }}>
                      <span>{fmtD(curMinTs)}</span><span>{fmtD(curMaxTs)}</span>
                    </div>
                    {/* Slider track with draggable thumbs */}
                    <div style={{ position: 'relative', height: 28, marginBottom: 6, userSelect: 'none' }}>
                      {/* Gray track */}
                      <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 4, background: T.border, borderRadius: 2, transform: 'translateY(-50%)' }} />
                      {/* Orange active range */}
                      <div style={{ position: 'absolute', top: '50%', left: dtPctLeft + '%', right: dtPctRight + '%', height: 4, background: T.accent, borderRadius: 2, transform: 'translateY(-50%)' }} />
                      {/* Left thumb — drag to change min */}
                      <div style={Object.assign({}, thumbBase, { left: dtPctLeft + '%', zIndex: leftZ })}
                        onMouseDown={startDrag('left')}
                        onTouchStart={startDrag('left')} />
                      {/* Right thumb — drag to change max */}
                      <div style={Object.assign({}, thumbBase, { left: (100 - dtPctRight) + '%', zIndex: rightZ })}
                        onMouseDown={startDrag('right')}
                        onTouchStart={startDrag('right')} />
                    </div>
                    {/* Bounds — orange, below slider */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.accent, fontWeight: 600, marginBottom: 6 }}>
                      <span>{fmtD(absMinTs)}</span>
                      <span style={{ color: T.textFaint, fontWeight: 400 }}>{'\u2192'}</span>
                      <span>{fmtD(absMaxTs)}</span>
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
                )}
              </div>
            )
          })}
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
