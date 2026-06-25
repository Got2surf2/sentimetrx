'use client'
// components/analyze/textmine/DimensionCompareTab.tsx
// Dimensions × Compare cell. Slices a taxonomy axis by a categorical field —
// the dimension analog of the theme/entity Compare. For the chosen axis + group
// field it pulls the server `tax_crosstab` (sub-bucket × field-value counts) and
// renders a sub × group matrix: each cell is the sub's mention rate within that
// group, with an over/under-index marker (binomial sig test) vs the baseline.
// Clicking a cell drills into the Comments filter for that sub.

import { useState, useEffect, useMemo } from 'react'
import { T } from '@/lib/analyzeTheme'
import LottieLoader from '@/components/ui/LottieLoader'
import { sigTest } from '@/lib/statsUtils'
import { DIM_AXES, DIM_AXIS_LABEL, AXIS_COLOR, dimSubLabel, type Axis } from '@/lib/dimensionFields'

const MAX_COLS = 8   // top groups by volume shown
const MAX_ROWS = 20  // top sub-buckets by volume shown

export default function DimensionCompareTab({ datasetId, catFields, fieldLabel, onDrillDimension }: {
  datasetId: string
  catFields: string[]
  fieldLabel: (f: string) => string
  onDrillDimension: (axis: string, sub: string) => void
}) {
  const [axis, setAxis] = useState<Axis>('product')
  const [field, setField] = useState<string>(catFields[0] || '')
  const [grid, setGrid] = useState<Record<string, Record<string, number>>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(function() {
    if (!field) return
    let cancelled = false
    setLoading(true); setError('')
    fetch('/api/datasets/' + datasetId + '/aggregate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'tax_crosstab', axis: axis, field: field, axisIsRow: true, limit: 50 }),
    })
      .then(function(r) { return r.ok ? r.json() : Promise.reject(new Error('Failed to load crosstab')) })
      .then(function(d) { if (!cancelled) setGrid(d.grid || {}) })
      .catch(function(e) { if (!cancelled) setError(e?.message || 'Failed to load crosstab') })
      .finally(function() { if (!cancelled) setLoading(false) })
    return function() { cancelled = true }
  }, [datasetId, axis, field])

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
    const topCols = Object.keys(colTotals).sort(function(a, b) { return colTotals[b] - colTotals[a] }).slice(0, MAX_COLS)
    const topSubs = subs.sort(function(a, b) { return subTotals[b] - subTotals[a] }).slice(0, MAX_ROWS)
    const maxRate = topSubs.reduce(function(m, s) {
      return topCols.reduce(function(mm, c) {
        const r = colTotals[c] ? (grid[s][c] || 0) / colTotals[c] : 0
        return r > mm ? r : mm
      }, m)
    }, 0) || 1
    return { topCols, topSubs, colTotals, subTotals, grand, maxRate, nCols: Object.keys(colTotals).length }
  }, [grid])

  const color = AXIS_COLOR[axis]

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 24 }} className="fadein">
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: T.text, margin: 0 }}>Dimension Compare</h2>
        <p style={{ fontSize: 12, color: T.textMid, margin: '3px 0 0' }}>How a dimension&apos;s sub-buckets split across a categorical field. Cells show the mention rate within each group; <strong style={{ color: '#059669' }}>▲</strong>/<strong style={{ color: '#dc2626' }}>▼</strong> flag groups that over/under-index vs the baseline. Click a cell to read its comments.</p>
      </div>

      {/* Pickers */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.05em' }}>Dimension</span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {DIM_AXES.map(function(a) {
              const sel = axis === a
              return (
                <button key={a} onClick={function() { setAxis(a) }}
                  style={{ padding: '3px 10px', fontSize: 11, fontWeight: sel ? 700 : 500, borderRadius: 16, border: '1.5px solid ' + (sel ? AXIS_COLOR[a] : T.border), background: sel ? AXIS_COLOR[a] + '14' : 'white', color: sel ? AXIS_COLOR[a] : T.textMid, cursor: 'pointer' }}>
                  {DIM_AXIS_LABEL[a]}
                </button>
              )
            })}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.05em' }}>By</span>
          <select value={field} onChange={function(e) { setField(e.target.value) }}
            style={{ padding: '4px 8px', fontSize: 12, fontWeight: 600, background: T.bg, color: T.textMid, border: '1px solid ' + T.border, borderRadius: 16, cursor: 'pointer', maxWidth: 220 }}>
            {catFields.map(function(f) { return <option key={f} value={f}>{fieldLabel(f)}</option> })}
          </select>
        </div>
      </div>

      {!catFields.length ? (
        <div style={{ padding: 24, color: T.textMute, fontSize: 13 }}>No categorical fields available for comparison.</div>
      ) : loading ? (
        <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}><LottieLoader size={26} /></div>
      ) : error ? (
        <div style={{ padding: 24, color: T.red, fontSize: 13 }}>{error}</div>
      ) : !model.topSubs.length ? (
        <div style={{ padding: 24, color: T.textMute, fontSize: 13 }}>No <strong>{DIM_AXIS_LABEL[axis]}</strong> mentions tagged for this dataset.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: 480 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 12px 6px 0', color: T.textFaint, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em' }}>{DIM_AXIS_LABEL[axis]}</th>
                {model.topCols.map(function(c) {
                  return (
                    <th key={c} style={{ padding: '6px 10px', color: T.textMid, fontWeight: 700, textAlign: 'center', minWidth: 72 }}>
                      <div style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c}>{c}</div>
                      <div style={{ fontSize: 9, color: T.textFaint, fontWeight: 500 }}>n={model.colTotals[c].toLocaleString()}</div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {model.topSubs.map(function(s) {
                return (
                  <tr key={s} style={{ borderTop: '1px solid ' + T.border }}>
                    <td style={{ padding: '6px 12px 6px 0', fontWeight: 600, color: T.textMid, whiteSpace: 'nowrap' }}>
                      {dimSubLabel(s)} <span style={{ color: T.textFaint, fontWeight: 500 }}>{model.subTotals[s].toLocaleString()}</span>
                    </td>
                    {model.topCols.map(function(c) {
                      const cell = grid[s][c] || 0
                      const rate = model.colTotals[c] ? cell / model.colTotals[c] : 0
                      const sig = sigTest(cell, model.colTotals[c] || 0, model.subTotals[s] || 0, model.grand || 0)
                      const dir = sig ? sig.dir : 'ns'
                      const mark = dir === 'over' ? '▲' : dir === 'under' ? '▼' : ''
                      const markColor = dir === 'over' ? '#059669' : dir === 'under' ? '#dc2626' : T.textFaint
                      return (
                        <td key={c} style={{ padding: '5px 10px', textAlign: 'center', cursor: cell ? 'pointer' : 'default' }}
                          onClick={cell ? function() { onDrillDimension(axis, s) } : undefined}
                          title={cell ? dimSubLabel(s) + ' in ' + c + ': ' + cell.toLocaleString() + ' (' + (rate * 100).toFixed(1) + '% of group)' : ''}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: cell ? T.textMid : T.textFaint }}>
                              {(rate * 100).toFixed(0)}% {mark && <span style={{ color: markColor, fontSize: 9 }}>{mark}</span>}
                            </span>
                            <div style={{ width: 48, height: 4, background: T.border, borderRadius: 2, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: Math.round(rate / model.maxRate * 100) + '%', background: color, borderRadius: 2 }} />
                            </div>
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
          {model.nCols > model.topCols.length && (
            <p style={{ fontSize: 11, color: T.textFaint, marginTop: 10 }}>Showing the top {model.topCols.length} groups by volume of {model.nCols} total.</p>
          )}
        </div>
      )}
    </div>
  )
}
