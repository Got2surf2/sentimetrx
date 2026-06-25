'use client'
// components/analyze/textmine/DimensionCompareTab.tsx
// Dimensions × Compare cell. The dimension analog of the theme/entity Compare —
// same chrome and same horizontal-bar layout (By Group / By Dimension view
// modes, over/under-index ★ markers, sort-by-impact, show-all), differing only
// in the unit being compared and the data source (server crosstab ops).
//
// Two levels:
//   • Default "All dimensions" — compares the seven top-level axes (Touchpoint,
//     Product, …) across the chosen field (`tax_axis_crosstab`). Clicking a
//     row/card drills into that axis.
//   • A single axis — compares that axis's level-2 sub-buckets (Steak, Server, …)
//     across the field (`tax_crosstab`). Clicking a bar drills into Comments.
//
// The breakdown-field selector ("Break down by:") sits top-left to match the
// other Compare views; the dimension/axis selector is the data-type-specific one.

import { useState, useEffect, useMemo } from 'react'
import { T } from '@/lib/analyzeTheme'
import LottieLoader from '@/components/ui/LottieLoader'
import { sigTest } from '@/lib/statsUtils'
import { DIM_AXES, DIM_AXIS_LABEL, AXIS_COLOR, dimSubLabel, type Axis } from '@/lib/dimensionFields'

const MAX_VISIBLE = 15  // top sub-buckets / groups shown before "Show all"

type AxisSel = Axis | 'all'

export default function DimensionCompareTab({ datasetId, catFields, fieldLabel, onDrillDimension }: {
  datasetId: string
  catFields: string[]
  fieldLabel: (f: string) => string
  onDrillDimension: (axis: string, sub: string) => void
}) {
  const [axis, setAxis] = useState<AxisSel>('all')
  const [field, setField] = useState<string>(catFields[0] || '')
  const [viewMode, setViewMode] = useState<'group' | 'sub'>('group')
  const [smartAxes, setSmartAxes] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [grid, setGrid] = useState<Record<string, Record<string, number>>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const isAll = axis === 'all'

  // Keep the selected field valid as the available list changes.
  useEffect(function() {
    if (catFields.length && !catFields.includes(field)) setField(catFields[0])
  }, [catFields, field])

  useEffect(function() {
    if (!field) return
    let cancelled = false
    setLoading(true); setError('')
    const body = isAll
      ? { op: 'tax_axis_crosstab', field: field, axisIsRow: true }
      : { op: 'tax_crosstab', axis: axis, field: field, axisIsRow: true, limit: 50 }
    fetch('/api/datasets/' + datasetId + '/aggregate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function(r) { return r.ok ? r.json() : Promise.reject(new Error('Failed to load comparison')) })
      .then(function(d) { if (!cancelled) setGrid(d.grid || {}) })
      .catch(function(e) { if (!cancelled) setError(e?.message || 'Failed to load comparison') })
      .finally(function() { if (!cancelled) setLoading(false) })
    return function() { cancelled = true }
  }, [datasetId, axis, field, isAll])

  // Level-aware label/color/noun for the unit being compared.
  function labelFor(k: string): string { return isAll ? (DIM_AXIS_LABEL[k as Axis] || k) : dimSubLabel(k) }
  function colorFor(k: string): string { return isAll ? (AXIS_COLOR[k as Axis] || T.accent) : AXIS_COLOR[axis as Axis] }
  const unitNoun = isAll ? 'dimension' : DIM_AXIS_LABEL[axis as Axis]
  const unitNounPlural = isAll ? 'dimensions' : DIM_AXIS_LABEL[axis as Axis] + ' buckets'

  const model = useMemo(function() {
    const subs = Object.keys(grid)
    const colTotals: Record<string, number> = {}
    const subTotals: Record<string, number> = {}
    let grand = 0
    subs.forEach(function(s) {
      let st = 0
      Object.keys(grid[s]).forEach(function(c) {
        const v = grid[s][c]
        colTotals[c] = (colTotals[c] || 0) + v
        st += v; grand += v
      })
      subTotals[s] = st
    })
    const allCols = Object.keys(colTotals).sort(function(a, b) { return colTotals[b] - colTotals[a] })
    const allSubs = subs.slice().sort(function(a, b) {
      return smartAxes ? (subTotals[b] - subTotals[a]) : labelFor(a).localeCompare(labelFor(b))
    })
    return { allCols, allSubs, colTotals, subTotals, grand }
    // labelFor depends on axis; recompute when axis changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, smartAxes, axis])

  const visibleSubs = showAll ? model.allSubs : model.allSubs.slice(0, MAX_VISIBLE)
  const hiddenSubs = model.allSubs.length - visibleSubs.length
  const visibleCols = showAll ? model.allCols : model.allCols.slice(0, MAX_VISIBLE)
  const hiddenCols = model.allCols.length - visibleCols.length

  // One bar row — label + share bar + over/under ★ + % + n. Mirrors the row in
  // EntityCompareTab so the three Compare views read identically.
  function barRow(key: string, label: string, cell: number, groupTotal: number, rowTotal: number, maxRate: number, barColor: string, onClick: () => void) {
    const rate = groupTotal ? cell / groupTotal : 0
    const sig = sigTest(cell, groupTotal, rowTotal, model.grand)
    const sigColor = sig && sig.dir === 'over' ? '#16a34a' : sig && sig.dir === 'under' ? '#dc2626' : null
    return (
      <div key={key} onClick={cell ? onClick : undefined}
        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, cursor: cell ? 'pointer' : 'default' }}>
        <span style={{ fontSize: 11, color: T.textMid, width: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }} title={label}>{label}</span>
        <div style={{ flex: 1, height: 10, background: T.bg, borderRadius: 5, overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 5, transition: 'width .5s', width: Math.max(maxRate > 0 ? rate / maxRate * 100 : 0, rate > 0 ? 2 : 0) + '%', background: barColor }} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 800, color: sigColor || 'transparent', flexShrink: 0, width: 14, textAlign: 'center' }}
          title={sig && sigColor ? (label + ' ' + (sig.dir === 'over' ? 'over' : 'under') + '-indexes here (' + Math.round(sig.p1 * 100) + '% vs ' + Math.round(sig.p2 * 100) + '% baseline, z=' + sig.z.toFixed(1) + ')') : ''}>
          {sigColor ? '★' : ''}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: T.text, width: 40, textAlign: 'right', flexShrink: 0 }}>{Math.round(rate * 100)}%</span>
        <span style={{ fontSize: 10, color: T.textFaint, width: 52, textAlign: 'right', flexShrink: 0 }}>n={cell.toLocaleString()}</span>
      </div>
    )
  }

  // Clicking a unit: at the top level drill INTO the axis; within an axis open
  // its Comments.
  function unitClick(key: string) {
    if (isAll) { setAxis(key as Axis); setViewMode('group') }
    else onDrillDimension(axis, key)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* ── Top bar: breakdown-field (left) + dimension axis + view toggle ── */}
      <div style={{ flexShrink: 0, padding: '16px 24px', borderBottom: '1px solid ' + T.border, background: T.bgCard }}>
        <div style={{ marginBottom: 12 }}>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: T.text, margin: 0 }}>Dimension Compare</h2>
          <p style={{ fontSize: 12, color: T.textMid, margin: '3px 0 0' }}>{isAll
            ? <>How each dimension splits across a categorical field. Bars show the mention rate within each group; <strong style={{ color: '#16a34a' }}>★</strong> flags groups that over/under-index. Click a dimension to drill into its sub-buckets.</>
            : <>How <strong style={{ color: AXIS_COLOR[axis as Axis] }}>{DIM_AXIS_LABEL[axis as Axis]}</strong>&apos;s sub-buckets split across a categorical field. Click a bar to read its comments.</>
          }</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            {/* Break down by — leftmost, matching theme/entity Compare */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: T.textMid }}>Break down by:</span>
              {catFields.length === 0 && <span style={{ fontSize: 11, color: T.textFaint, fontStyle: 'italic' }}>no comparable fields</span>}
              {catFields.map(function(f) {
                const on = field === f
                return (
                  <button key={f} onClick={function() { setField(f) }}
                    style={{ fontSize: 11, fontWeight: on ? 700 : 500, padding: '4px 11px', borderRadius: 16, background: on ? T.accentBg : T.bg, color: on ? T.accent : T.textMute, border: '1px solid ' + (on ? T.accent + '60' : T.border), cursor: 'pointer', fontFamily: 'inherit' }}>
                    {fieldLabel(f)}
                  </button>
                )
              })}
            </div>
            {/* Dimension (axis) — All + the seven axes */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: T.textMid }}>Dimension:</span>
              {(['all'] as AxisSel[]).concat(DIM_AXES as unknown as AxisSel[]).map(function(a) {
                const sel = axis === a
                const c = a === 'all' ? T.accent : AXIS_COLOR[a as Axis]
                return (
                  <button key={a} onClick={function() { setAxis(a) }}
                    style={{ padding: '4px 11px', fontSize: 11, fontWeight: sel ? 700 : 500, borderRadius: 16, border: '1px solid ' + (sel ? c : T.border), background: sel ? c + '14' : T.bg, color: sel ? c : T.textMute, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {a === 'all' ? 'All' : DIM_AXIS_LABEL[a as Axis]}
                  </button>
                )
              })}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.textMute, cursor: 'pointer' }}>
              <input type="checkbox" checked={smartAxes} onChange={function() { setSmartAxes(!smartAxes) }} style={{ accentColor: T.accent }} />
              Sort by impact
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.textMute, cursor: 'pointer' }}>
              <input type="checkbox" checked={showAll} onChange={function() { setShowAll(function(v) { return !v }) }} style={{ accentColor: T.accent }} />
              Show all
            </label>
            <div style={{ display: 'inline-flex', background: T.bg, borderRadius: 8, padding: 2, border: '1px solid ' + T.border }}>
              {(['group', 'sub'] as const).map(function(m) {
                return (
                  <button key={m} onClick={function() { setViewMode(m) }}
                    style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6, background: viewMode === m ? T.bgCard : 'transparent', color: viewMode === m ? T.accent : T.textMute, border: 'none', cursor: 'pointer', boxShadow: viewMode === m ? '0 1px 4px rgba(0,0,0,.08)' : 'none', fontFamily: 'inherit', textTransform: 'capitalize' }}>
                    By {m === 'group' ? 'Group' : (isAll ? 'Dimension' : DIM_AXIS_LABEL[axis as Axis])}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Scrollable results ──────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }} className="fadein">
        {!catFields.length ? (
          <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, padding: '40px 24px', textAlign: 'center', color: T.textFaint }}>
            <p style={{ fontSize: 13, margin: 0 }}>No categorical fields available to compare against.</p>
          </div>
        ) : loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><LottieLoader size={120} message="Loading comparison…" /></div>
        ) : error ? (
          <div style={{ padding: 24, color: T.red, fontSize: 13 }}>{error}</div>
        ) : !model.allSubs.length ? (
          <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, padding: '40px 24px', textAlign: 'center', color: T.textFaint }}>
            <p style={{ fontSize: 13, margin: 0 }}>No {unitNoun} mentions tagged for this dataset.</p>
          </div>
        ) : viewMode === 'group' ? (
          /* ── By Group: one card per field-value, unit bars within ── */
          <div>
            {visibleCols.map(function(c) {
              const groupTotal = model.colTotals[c] || 0
              const ordered = model.allSubs
                .map(function(s) { return { s: s, cell: grid[s][c] || 0 } })
                .filter(function(x) { return x.cell > 0 })
                .sort(function(a, b) { return b.cell - a.cell })
              const maxRate = ordered.reduce(function(m, x) { return Math.max(m, groupTotal ? x.cell / groupTotal : 0) }, 0) || 1
              const pct = model.grand ? Math.round(groupTotal / model.grand * 100) : 0
              return (
                <div key={c} style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 10, padding: '16px 18px', marginBottom: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 14 }}>
                    <span style={{ color: T.accent }}>{c}</span>
                    <span style={{ fontSize: 12, fontWeight: 400, color: T.textMute, marginLeft: 6 }}>({pct}% of {unitNoun} mentions · {groupTotal.toLocaleString()})</span>
                  </div>
                  {ordered.length === 0 && (
                    <div style={{ fontSize: 11, color: T.textFaint, fontStyle: 'italic' }}>No {unitNoun} mentions in this group.</div>
                  )}
                  {ordered.map(function(x) {
                    return barRow(x.s, labelFor(x.s), x.cell, groupTotal, model.subTotals[x.s] || 0, maxRate, colorFor(x.s), function() { unitClick(x.s) })
                  })}
                </div>
              )
            })}
            {hiddenCols > 0 && (
              <p style={{ fontSize: 11, color: T.textFaint, marginTop: 4 }}>{hiddenCols} more group{hiddenCols === 1 ? '' : 's'} hidden — turn on “Show all”.</p>
            )}
          </div>
        ) : (
          /* ── By Dimension / By Sub: one card per unit, group bars within ── */
          <div>
            {visibleSubs.map(function(s) {
              const rowTotal = model.subTotals[s] || 0
              const c0 = colorFor(s)
              const ordered = model.allCols
                .map(function(c) { return { c: c, cell: grid[s][c] || 0, groupTotal: model.colTotals[c] || 0 } })
                .filter(function(x) { return x.cell > 0 })
                .sort(function(a, b) { return b.cell - a.cell })
              const maxRate = ordered.reduce(function(m, x) { return Math.max(m, x.groupTotal ? x.cell / x.groupTotal : 0) }, 0) || 1
              const pct = model.grand ? Math.round(rowTotal / model.grand * 100) : 0
              return (
                <div key={s} style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 10, padding: '16px 18px', marginBottom: 12, borderLeft: '4px solid ' + c0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: T.text, flex: 1 }}>
                      {labelFor(s)}
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: c0 + '18', color: c0, border: '1px solid ' + c0 + '40', marginLeft: 8 }}>{isAll ? 'dimension' : DIM_AXIS_LABEL[axis as Axis]}</span>
                      <span style={{ fontSize: 12, fontWeight: 400, color: T.textMute, marginLeft: 6 }}>({pct}% of {unitNoun} mentions · {rowTotal.toLocaleString()})</span>
                    </span>
                    <button onClick={function() { unitClick(s) }}
                      style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: c0 + '18', color: c0, border: '1px solid ' + c0 + '50', cursor: 'pointer', flexShrink: 0 }}>
                      {isAll ? 'Drill in →' : 'View comments →'}
                    </button>
                  </div>
                  {ordered.map(function(x) {
                    return barRow(x.c, x.c, x.cell, x.groupTotal, rowTotal, maxRate, c0, function() { unitClick(s) })
                  })}
                </div>
              )
            })}
            {hiddenSubs > 0 && (
              <p style={{ fontSize: 11, color: T.textFaint, marginTop: 4 }}>{hiddenSubs} more {unitNounPlural} hidden — turn on “Show all”.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
