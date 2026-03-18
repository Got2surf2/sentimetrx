'use client'
// components/analyze/StatsModule.tsx
// Statistics module — 5 panels matching Ana.html.
// Loads raw rows from the API, applies filters, runs all computations client-side.

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'

// Dynamic Plotly import — avoids SSR crash
var PlotlyRef: any = null
function getPlotly(): Promise<any> {
  if (PlotlyRef) return Promise.resolve(PlotlyRef)
  return import('plotly.js-dist-min').then(function(m) { PlotlyRef = m.default || m; return PlotlyRef })
}

function PlotlyChart({ data, layout, style }: { data: any[]; layout?: any; style?: React.CSSProperties }) {
  var ref = useRef<HTMLDivElement>(null)
  useEffect(function() {
    if (!ref.current || !data.length) return
    var T2 = { bg: '#f4f5f7', border: '#e5e7eb', borderMid: '#d1d5db', textMute: '#6b7280' }
    var base = { paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', font: { family: 'Inter,system-ui,sans-serif', color: T2.textMute, size: 11 }, margin: { t: 16, r: 20, b: 48, l: 56 }, xaxis: { gridcolor: T2.border, zerolinecolor: T2.borderMid, linecolor: T2.border }, yaxis: { gridcolor: T2.border, zerolinecolor: T2.borderMid, linecolor: T2.border } }
    var merged = Object.assign({}, base, layout || {})
    getPlotly().then(function(Plotly) {
      Plotly.newPlot(ref.current, data, merged, { responsive: true, displayModeBar: false })
    })
    return function() { if (ref.current) getPlotly().then(function(Plotly) { try { Plotly.purge(ref.current) } catch {} }) }
  }, [data, layout])
  return <div ref={ref} style={style || { width: '100%', height: 260 }} />
}

import {
  mean, std, median, quantile, skewness, kurtosis, shapiroWilk,
  pearsonR, spearmanR, welchTTest, mannWhitneyU, oneWayANOVA,
  chiSquareStat, olsRegression, getNum, probit,
  fmt2, fmt4, fmtN, fmtP, sigLabel,
  descBL, descBL_naive, corrBL, corrBL_naive,
  ttestBL, ttestBL_naive, anovaBL, anovaBL_naive,
  chiBL, chiBL_naive, regrBL, regrBL_naive,
} from '@/lib/statsUtils'
import { applyFilters, filterCount } from '@/lib/filterUtils'
import { useFilters } from '@/components/analyze/FilterContext'
import type { SchemaConfig, SchemaFieldConfig } from '@/lib/analyzeTypes'

var T = {
  bg: '#f4f5f7', bgCard: '#ffffff', border: '#e5e7eb', borderMid: '#d1d5db',
  text: '#111827', textMid: '#374151', textMute: '#6b7280', textFaint: '#9ca3af',
  accent: '#e8622a', accentBg: '#fff4ef', accentMid: '#fbd5c2',
  green: '#16a34a', greenBg: '#f0fdf4', greenMid: '#bbf7d0',
  red: '#dc2626', redBg: '#fef2f2',
  amber: '#d97706', amberBg: '#fffbeb', amberMid: '#fde68a',
  blue: '#2563eb', blueBg: '#eff6ff',
  purple: '#7c3aed',
}

interface Props {
  datasetId: string
  schema: SchemaConfig
}

// ─── Shared UI helpers ────────────────────────────────────────────────────────

function SigBadge({ p }: { p: number }) {
  var s = sigLabel(p)
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: s.bg, color: s.color, border: '1px solid ' + s.border }}>{s.stars}</span>
}

function StatRow({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid ' + T.border }}>
      <span style={{ fontSize: 12, color: T.textMute }}>{label}</span>
      <div style={{ textAlign: 'right' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: T.text, fontFamily: 'monospace' }}>{value}</span>
        {sub && <span style={{ fontSize: 11, color: T.textFaint, marginLeft: 6 }}>{sub}</span>}
      </div>
    </div>
  )
}

function PanelHeader({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div style={{ marginBottom: 24, paddingBottom: 18, borderBottom: '1px solid ' + T.border }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: T.accentBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: T.accent, border: '1px solid ' + T.accentMid, flexShrink: 0 }}>{icon}</div>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: T.text, letterSpacing: '-.3px', margin: 0 }}>{title}</h2>
          <p style={{ fontSize: 12, color: T.textMute, margin: '2px 0 0' }}>{desc}</p>
        </div>
      </div>
    </div>
  )
}

function FieldPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ padding: '5px 14px', fontSize: 12, fontWeight: active ? 700 : 500, background: active ? T.accentBg : 'transparent', border: '1px solid ' + (active ? T.accent : T.border), color: active ? T.accent : T.textMid, borderRadius: 20, cursor: 'pointer', transition: 'all .12s', whiteSpace: 'nowrap' }}>
      {label}
    </button>
  )
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,.06)', ...style }}>{children}</div>
}

function StatsEmpty({ icon, msg, sub }: { icon: string; msg: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 40px', gap: 12, color: T.textFaint }}>
      <div style={{ fontSize: 40 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: T.textMid }}>{msg}</div>
      {sub && <div style={{ fontSize: 13, color: T.textMute, textAlign: 'center', maxWidth: 360, lineHeight: 1.6 }}>{sub}</div>}
    </div>
  )
}

function DSSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }) {
  return (
    <div style={{ flex: 1, minWidth: 150 }}>
      {label && <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 5 }}>{label}</div>}
      <select value={value} onChange={function(e) { onChange(e.target.value) }}
        style={{ width: '100%', padding: '7px 10px', fontSize: 13, border: '1px solid ' + T.border, borderRadius: 7, background: T.bgCard, color: T.text, outline: 'none', cursor: 'pointer' }}>
        {options.map(function(o) { return <option key={o.v} value={o.v}>{o.l}</option> })}
      </select>
    </div>
  )
}

function BottomLine({ text, naiveText }: { text: string; naiveText?: string }) {
  var [mode, setMode] = useState('expert')
  if (!text) return null
  var shown = mode === 'naive' && naiveText ? naiveText : text
  return (
    <div style={{ marginTop: 18, marginBottom: 6, background: T.accentBg, border: '1px solid ' + T.accentMid, borderLeft: '3px solid ' + T.accent, borderRadius: 8, padding: '12px 16px 16px', fontSize: 13, lineHeight: 1.7, color: T.textMid }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: T.accent }}>{'\u25C6'} Bottom Line</div>
        {naiveText && (
          <div style={{ display: 'flex', gap: 3, background: T.bg, borderRadius: 7, padding: '2px 3px', border: '1px solid ' + T.border }}>
            <button onClick={function() { setMode('expert') }} style={{ fontSize: 10, fontWeight: 600, padding: '2px 9px', borderRadius: 5, border: 'none', background: mode === 'expert' ? T.accent : 'transparent', color: mode === 'expert' ? 'white' : T.textFaint, cursor: 'pointer', transition: 'all .12s' }}>Expert</button>
            <button onClick={function() { setMode('naive') }} style={{ fontSize: 10, fontWeight: 600, padding: '2px 9px', borderRadius: 5, border: 'none', background: mode === 'naive' ? T.accent : 'transparent', color: mode === 'naive' ? 'white' : T.textFaint, cursor: 'pointer', transition: 'all .12s' }}>Plain English</button>
          </div>
        )}
      </div>
      {shown}
    </div>
  )
}

// ─── SUB-PANELS ───────────────────────────────────────────────────────────────

function DescriptivesPanel({ numFields, data }: { numFields: SchemaFieldConfig[]; data: Record<string, unknown>[] }) {
  var [sel, setSel] = useState(numFields[0]?.field || '')
  useEffect(function() { if (!sel && numFields.length) setSel(numFields[0].field) }, [numFields.length])

  var stats = useMemo(function() {
    if (!sel || !data.length) return null
    var vals = getNum(sel, data); if (!vals.length) return null
    var mn = mean(vals), med = median(vals), sd_ = std(vals), q1 = quantile(vals, 0.25), q3 = quantile(vals, 0.75)
    var vmin = Math.min.apply(null, vals), vmax = Math.max.apply(null, vals)
    var skew = skewness(vals), kurt = kurtosis(vals), sw = shapiroWilk(vals.slice(0, 5000))
    return { n: vals.length, mn: mn, med: med, sd: sd_, q1: q1, q3: q3, min: vmin, max: vmax, range: vmax - vmin, iqr: q3 - q1, skew: skew, kurt: kurt, sw: sw, cv: Math.abs(mn) > 0 ? sd_ / Math.abs(mn) * 100 : NaN, vals: vals }
  }, [sel, data])

  if (!numFields.length) return <StatsEmpty icon={'\uD83D\uDCCA'} msg="No numeric fields active" sub="Load data with numeric columns, or use the Schema tab to map categorical values to numbers." />

  return (
    <div>
      <PanelHeader icon={'\u2211'} title="Descriptive Statistics" desc="Summary statistics, distribution shape, and normality tests for each numeric variable." />
      {stats && <BottomLine text={descBL(sel, stats)} naiveText={descBL_naive(sel, stats)} />}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        {numFields.map(function(f) { return <FieldPill key={f.field} label={f.label || f.field} active={sel === f.field} onClick={function() { setSel(f.field) }} /> })}
      </div>
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 18px', borderBottom: '1px solid ' + T.border, fontSize: 13, fontWeight: 700, color: T.text }}>{sel} <span style={{ fontWeight: 400, color: T.textFaint, fontSize: 11 }}>{'\u2014'} {stats.n} observations</span></div>
            <div style={{ padding: '2px 16px 12px' }}>
              <StatRow label="Mean" value={fmtN(stats.mn)} />
              <StatRow label="Median" value={fmtN(stats.med)} />
              <StatRow label="Std. Dev." value={fmtN(stats.sd)} />
              <StatRow label="Variance" value={fmtN(stats.sd ** 2)} />
              <StatRow label="Min" value={fmtN(stats.min)} />
              <StatRow label="Max" value={fmtN(stats.max)} />
              <StatRow label="Range" value={fmtN(stats.range)} />
              <StatRow label="Q1 (25th pct)" value={fmtN(stats.q1)} />
              <StatRow label="Q3 (75th pct)" value={fmtN(stats.q3)} />
              <StatRow label="IQR" value={fmtN(stats.iqr)} />
              <StatRow label="CV (%)" value={isNaN(stats.cv) ? '\u2014' : fmtN(stats.cv) + '%'} />
              <StatRow label="Skewness" value={fmtN(stats.skew)} sub={Math.abs(stats.skew) < 0.5 ? 'symmetric' : stats.skew > 0 ? 'right tail' : 'left tail'} />
              <StatRow label="Excess Kurtosis" value={fmtN(stats.kurt)} sub={Math.abs(stats.kurt) < 1 ? 'mesokurtic' : stats.kurt > 0 ? 'leptokurtic' : 'platykurtic'} />
            </div>
            <div style={{ padding: '10px 16px 14px', borderTop: '1px solid ' + T.border, background: T.bg }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>Shapiro-Wilk Normality</div>
              {stats.sw && !isNaN(stats.sw.W) ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  <StatRow label="W statistic" value={fmt4(stats.sw.W)} />
                  <StatRow label={fmtP(stats.sw.p)} value={<SigBadge p={stats.sw.p} />} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: stats.sw.p > 0.05 ? T.green : T.red }}>{stats.sw.p > 0.05 ? '\u2713 Normal' : '\u2717 Non-normal'}</span>
                </div>
              ) : <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>n &lt; 3</div>}
            </div>
          </Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>Distribution</div>
              <PlotlyChart
                data={[{ x: stats.vals, type: 'histogram', marker: { color: T.accent, opacity: 0.8, line: { color: T.accentMid, width: 1 } }, nbinsx: Math.min(50, Math.ceil(Math.sqrt(stats.n))) }]}
                layout={{ xaxis: { title: { text: sel, font: { size: 11 } } }, yaxis: { title: { text: 'Count', font: { size: 11 } } }, bargap: 0.04, showlegend: false, margin: { t: 10, r: 16, b: 44, l: 48 } }}
                style={{ height: 220, width: '100%' }}
              />
            </Card>
            <Card style={{ padding: '14px 16px', background: T.bg }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {[
                  { l: 'Mean', v: fmtN(stats.mn), c: T.accent }, { l: 'Median', v: fmtN(stats.med), c: T.purple },
                  { l: 'SD', v: fmtN(stats.sd), c: T.amber }, { l: 'Skew', v: fmtN(stats.skew), c: Math.abs(stats.skew) < 0.5 ? T.green : T.amber },
                  { l: 'Kurt', v: fmtN(stats.kurt), c: T.textMid }, { l: 'n', v: stats.n.toLocaleString(), c: T.blue },
                ].map(function(s) {
                  return (
                    <div key={s.l} style={{ textAlign: 'center', padding: '10px 6px', background: T.bgCard, borderRadius: 8, border: '1px solid ' + T.border }}>
                      <div style={{ fontSize: 17, fontWeight: 800, color: s.c, fontFamily: 'monospace' }}>{s.v}</div>
                      <div style={{ fontSize: 10, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.07em', marginTop: 3 }}>{s.l}</div>
                    </div>
                  )
                })}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

function CorrelationsPanel({ numFields, data }: { numFields: SchemaFieldConfig[]; data: Record<string, unknown>[] }) {
  var [corrType, setCorrType] = useState('pearson')
  var [selCell, setSelCell] = useState<{ i: number; j: number; f1: string; f2: string; r: number; p: number; n: number } | null>(null)

  var matrix = useMemo(function() {
    if (numFields.length < 2) return null
    var fields = numFields.map(function(f) { return f.field })
    var fn = corrType === 'pearson' ? pearsonR : spearmanR
    var mat = fields.map(function(f1) {
      return fields.map(function(f2) {
        if (f1 === f2) return { r: 1, p: 0, n: getNum(f1, data).length }
        var v1 = getNum(f1, data), v2 = getNum(f2, data), n = Math.min(v1.length, v2.length)
        return fn(v1.slice(0, n), v2.slice(0, n))
      })
    })
    return { fields: fields, mat: mat }
  }, [numFields, data, corrType])

  var cellBg = function(r: number) {
    if (isNaN(r) || r === 1) return T.bg
    var a = Math.abs(r)
    if (r > 0) return 'rgb(' + Math.round(255 - a * 200) + ',' + Math.round(240 - a * 100) + ',' + Math.round(255 - a * 200) + ')'
    return 'rgb(' + Math.round(255 - a * 10) + ',' + Math.round(240 - a * 180) + ',' + Math.round(235 - a * 180) + ')'
  }

  if (numFields.length < 2) return <StatsEmpty icon={'\u229E'} msg="Need at least 2 numeric fields" sub="Activate more numeric fields or map Likert scales to numbers in the Schema tab." />

  return (
    <div>
      <PanelHeader icon={'\u2295'} title="Correlation Matrix" desc={'Pearson r or Spearman \u03C1 between all active numeric variables. Click any cell to see details.'} />
      {selCell && <BottomLine text={corrBL(selCell.f1, selCell.f2, selCell.r, selCell.p, selCell.n, corrType)} naiveText={corrBL_naive(selCell.f1, selCell.f2, selCell.r, selCell.p, selCell.n)} />}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: T.textMute, textTransform: 'uppercase', letterSpacing: '.07em' }}>Method:</span>
        {[['pearson', 'Pearson r'], ['spearman', 'Spearman \u03C1']].map(function(pair) {
          return <FieldPill key={pair[0]} label={pair[1]} active={corrType === pair[0]} onClick={function() { setCorrType(pair[0]); setSelCell(null) }} />
        })}
      </div>
      {matrix && (
        <div style={{ display: 'grid', gridTemplateColumns: selCell ? '1fr 1fr' : '1fr', gap: 20 }}>
          <Card style={{ padding: 0, overflow: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr>
                <th style={{ padding: '10px 12px', fontSize: 10, color: T.textFaint, background: T.bg, minWidth: 100, textAlign: 'left' }} />
                {matrix!.fields.map(function(f) { return <th key={f} style={{ padding: '10px 10px', fontSize: 10, fontWeight: 700, color: T.textMute, textTransform: 'uppercase', background: T.bg, textAlign: 'center', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f}>{f.slice(0, 10)}</th> })}
              </tr></thead>
              <tbody>{matrix!.fields.map(function(f1, i) {
                return (
                  <tr key={f1}>
                    <td style={{ padding: '8px 12px', fontSize: 11, fontWeight: 600, color: T.textMute, background: T.bg, borderRight: '1px solid ' + T.border, whiteSpace: 'nowrap', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis' }} title={f1}>{f1.slice(0, 14)}</td>
                    {matrix!.fields.map(function(f2, j) {
                      var cell = matrix!.mat[i][j], isDiag = i === j, isSel = selCell && selCell.i === i && selCell.j === j
                      return (
                        <td key={f2} onClick={function() { if (!isDiag) setSelCell({ i: i, j: j, f1: f1, f2: f2, r: cell.r, p: cell.p, n: cell.n }) }}
                          style={{ padding: '11px 10px', textAlign: 'center', background: isDiag ? T.bg : cellBg(cell.r), cursor: isDiag ? 'default' : 'pointer', outline: isSel ? '2px solid ' + T.accent : 'none', outlineOffset: -2, userSelect: 'none' }}>
                          <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: isDiag ? T.textFaint : T.text }}>{isDiag ? '\u2014' : fmt2(cell.r)}</div>
                          {!isDiag && cell.p < 0.05 && <div style={{ fontSize: 9, color: T.accent, marginTop: 1 }}>{sigLabel(cell.p).stars}</div>}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}</tbody>
            </table>
          </Card>
          {selCell && (
            <Card style={{ padding: '16px 18px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 12 }}>{selCell.f1} {'\u00D7'} {selCell.f2}</div>
              <div style={{ display: 'flex', gap: 16, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                {[
                  { l: corrType === 'pearson' ? 'r' : '\u03C1', v: fmt2(selCell.r), c: Math.abs(selCell.r) > 0.5 ? T.green : T.amber },
                  { l: 'p', v: fmtP(selCell.p).replace('p = ', '').replace('p < ', '<'), c: selCell.p < 0.05 ? T.green : T.textFaint },
                  { l: 'R\u00B2', v: fmt2(selCell.r ** 2), c: T.accent },
                  { l: 'n', v: String(selCell.n), c: T.textMid },
                ].map(function(s) {
                  return (
                    <div key={s.l} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 17, fontWeight: 800, fontFamily: 'monospace', color: s.c }}>{s.v}</div>
                      <div style={{ fontSize: 10, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.07em' }}>{s.l}</div>
                    </div>
                  )
                })}
                <SigBadge p={selCell.p} />
              </div>
              <div style={{ fontSize: 12, color: T.textMid, lineHeight: 1.6 }}>
                {Math.abs(selCell.r) < 0.1 ? 'Negligible' : Math.abs(selCell.r) < 0.3 ? 'Weak' : Math.abs(selCell.r) < 0.5 ? 'Moderate' : Math.abs(selCell.r) < 0.7 ? 'Strong' : 'Very strong'}
                {' '}{selCell.r > 0 ? 'positive' : 'negative'} correlation.
                {selCell.p < 0.05 ? ' Statistically significant.' : ' Not statistically significant.'}
              </div>
              {/* Scatter plot */}
              {(function() {
                var v1 = getNum(selCell.f1, data), v2 = getNum(selCell.f2, data)
                var n = Math.min(v1.length, v2.length)
                var x = v1.slice(0, n), y = v2.slice(0, n)
                var mx = mean(x), my = mean(y)
                var slope = x.reduce(function(s, v, i) { return s + (v - mx) * (y[i] - my) }, 0) / (x.reduce(function(s, v) { return s + (v - mx) ** 2 }, 0) || 1)
                var int_ = my - slope * mx
                var xmn = Math.min.apply(null, x), xmx = Math.max.apply(null, x)
                return (
                  <PlotlyChart
                    data={[
                      { x: x, y: y, mode: 'markers', type: 'scatter', marker: { color: T.accent, size: 5, opacity: 0.5 }, name: 'Data' },
                      { x: [xmn, xmx], y: [int_ + slope * xmn, int_ + slope * xmx], mode: 'lines', line: { color: T.red, width: 2, dash: 'dot' }, showlegend: false },
                    ]}
                    layout={{ xaxis: { title: { text: selCell.f1, font: { size: 11 } } }, yaxis: { title: { text: selCell.f2, font: { size: 11 } } }, showlegend: false, margin: { t: 8, r: 12, b: 46, l: 50 } }}
                    style={{ height: 260, width: '100%', marginTop: 12 }}
                  />
                )
              })()}
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

function GroupTestsPanel({ numFields, catFields, data }: { numFields: SchemaFieldConfig[]; catFields: SchemaFieldConfig[]; data: Record<string, unknown>[] }) {
  var [testType, setTestType] = useState('auto')
  var [numF, setNumF] = useState(numFields[0]?.field || '')
  var [catF, setCatF] = useState(catFields[0]?.field || '')
  var [catF2, setCatF2] = useState(catFields[1]?.field || catFields[0]?.field || '')

  useEffect(function() { if (!numF && numFields.length) setNumF(numFields[0].field) }, [numFields.length])
  useEffect(function() { if (!catF && catFields.length) setCatF(catFields[0].field) }, [catFields.length])

  var result = useMemo(function() {
    try {
      if (testType === 'chisq') { if (!catF || !catF2) return null; return { type: 'chisq', res: chiSquareStat(catF, catF2, data) } }
      if (!numF || !catF) return null
      var groups: Record<string, number[]> = {}
      data.forEach(function(r) {
        var gv = String(r[catF] || '').trim(), nv = parseFloat(String(r[numF] || '').replace(/,/g, ''))
        if (gv && !isNaN(nv)) { if (!groups[gv]) groups[gv] = []; groups[gv].push(nv) }
      })
      var gKeys = Object.keys(groups).filter(function(k) { return groups[k].length >= 2 })
      if (gKeys.length < 2) return null
      var eff = testType === 'auto' ? (gKeys.length === 2 ? 'ttest' : 'anova') : testType
      if (eff === 'mw' && gKeys.length === 2) return { type: 'mw', res: mannWhitneyU(groups[gKeys[0]], groups[gKeys[1]]), g1: gKeys[0], g2: gKeys[1], groups: groups }
      if (eff === 'ttest' && gKeys.length === 2) return { type: 'ttest', res: welchTTest(groups[gKeys[0]], groups[gKeys[1]]), g1: gKeys[0], g2: gKeys[1], groups: groups }
      return { type: 'anova', res: oneWayANOVA(groups), groups: groups }
    } catch { return null }
  }, [testType, numF, catF, catF2, data])

  if (!catFields.length) return <StatsEmpty icon={'\u2297'} msg="No categorical fields active" />
  if (!numFields.length && testType !== 'chisq') return <StatsEmpty icon={'\u2297'} msg="No numeric fields active" sub="Select Chi-square to compare two categorical fields." />

  return (
    <div>
      <PanelHeader icon={'\u2297'} title="Group Tests" desc={"Compare distributions across groups: Welch\u2019s t-test, one-way ANOVA, Mann-Whitney U, and Chi-square."} />
      {result && result.res && <BottomLine
        text={result.type === 'ttest' ? ttestBL(result.res, numF) : result.type === 'anova' ? anovaBL(result.res, numF) : result.type === 'chisq' ? chiBL(result.res, catF, catF2) : ''}
        naiveText={result.type === 'ttest' ? ttestBL_naive(result.res, numF) : result.type === 'anova' ? anovaBL_naive(result.res, numF) : result.type === 'chisq' ? chiBL_naive(result.res, catF, catF2) : ''}
      />}
      <Card style={{ padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {[['auto', 'Auto-select'], ['ttest', 't-test'], ['anova', 'ANOVA'], ['mw', 'Mann-Whitney'], ['chisq', 'Chi-square']].map(function(pair) {
            return <FieldPill key={pair[0]} label={pair[1]} active={testType === pair[0]} onClick={function() { setTestType(pair[0]) }} />
          })}
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {testType !== 'chisq' ? (
            <>
              <DSSelect label="Outcome (numeric)" value={numF} onChange={setNumF} options={numFields.map(function(f) { return { v: f.field, l: f.label || f.field } })} />
              <DSSelect label="Group by (categorical)" value={catF} onChange={setCatF} options={catFields.map(function(f) { return { v: f.field, l: f.label || f.field } })} />
            </>
          ) : (
            <>
              <DSSelect label="Row variable" value={catF} onChange={setCatF} options={catFields.map(function(f) { return { v: f.field, l: f.label || f.field } })} />
              <DSSelect label="Column variable" value={catF2} onChange={setCatF2} options={catFields.map(function(f) { return { v: f.field, l: f.label || f.field } })} />
            </>
          )}
        </div>
      </Card>

      {result && result.res && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '11px 16px', borderBottom: '1px solid ' + T.border, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>
              {result.type === 'ttest' ? "Welch\u2019s t-test" : result.type === 'mw' ? 'Mann-Whitney U' : result.type === 'anova' ? 'One-way ANOVA' : 'Chi-square Test'}
            </span>
            <SigBadge p={result.res.p} />
          </div>
          <div style={{ padding: '4px 16px 12px' }}>
            {result.type === 'ttest' && result.res && (
              <>
                <StatRow label="t statistic" value={fmtN(result.res.t)} />
                <StatRow label="Degrees of freedom" value={fmt2(result.res.df)} />
                <StatRow label="p-value" value={<SigBadge p={result.res.p} />} />
                <StatRow label="Cohen's d" value={fmt2(result.res.d)} sub={Math.abs(result.res.d) < 0.2 ? 'small' : Math.abs(result.res.d) < 0.8 ? 'medium' : 'large'} />
                <StatRow label={'Mean (' + (result as any).g1 + ')'} value={fmtN(result.res.ma)} />
                <StatRow label={'Mean (' + (result as any).g2 + ')'} value={fmtN(result.res.mb)} />
              </>
            )}
            {result.type === 'mw' && result.res && (
              <>
                <StatRow label="U statistic" value={fmtN(result.res.U)} />
                <StatRow label="Z (normal approx.)" value={fmt2(result.res.z)} />
                <StatRow label="p-value" value={<SigBadge p={result.res.p} />} />
              </>
            )}
            {result.type === 'anova' && result.res && (
              <>
                <StatRow label="F statistic" value={fmtN(result.res.F)} />
                <StatRow label="df (between, within)" value={result.res.dfB + ', ' + result.res.dfW} />
                <StatRow label="p-value" value={<SigBadge p={result.res.p} />} />
                <StatRow label={'\u03B7\u00B2 (effect size)'} value={fmt4(result.res.eta2)} sub={result.res.eta2 < 0.01 ? 'negligible' : result.res.eta2 < 0.06 ? 'small' : result.res.eta2 < 0.14 ? 'medium' : 'large'} />
              </>
            )}
            {result.type === 'chisq' && result.res && (
              <>
                <StatRow label={'\u03C7\u00B2 statistic'} value={fmtN(result.res.chi2)} />
                <StatRow label="Degrees of freedom" value={String(result.res.df)} />
                <StatRow label="p-value" value={<SigBadge p={result.res.p} />} />
                <StatRow label={"Cram\u00E9r\u2019s V"} value={fmt2(result.res.V)} sub={result.res.V < 0.1 ? 'negligible' : result.res.V < 0.3 ? 'weak' : result.res.V < 0.5 ? 'moderate' : 'strong'} />
                <StatRow label="N" value={result.res.N.toLocaleString()} />
              </>
            )}
          </div>
        </Card>
      )}

      {/* Box plots for numeric group comparisons */}
      {result && result.res && result.type !== 'chisq' && result.groups && (
        <Card style={{ padding: '14px 16px', marginTop: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>Group Distributions</div>
          <PlotlyChart
            data={Object.entries(result.groups as Record<string, number[]>).slice(0, 10).map(function(entry, i) {
              var pal = [T.accent, T.blue, T.green, T.purple, T.amber, T.red]
              return { y: entry[1], type: 'box', name: entry[0].slice(0, 20), marker: { color: pal[i % pal.length] }, boxpoints: 'outliers', jitter: 0.3, pointpos: -1.8 }
            })}
            layout={{ yaxis: { title: { text: numF, font: { size: 11 } } }, showlegend: false, margin: { t: 8, r: 12, b: 40, l: 50 } }}
            style={{ height: 280, width: '100%' }}
          />
        </Card>
      )}

      {!result && (
        <div style={{ textAlign: 'center', padding: 40, color: T.textFaint, fontSize: 13 }}>
          Select fields above to run a group test. Need at least 2 groups with 2+ observations each.
        </div>
      )}
    </div>
  )
}

function RegressionPanel({ numFields, data }: { numFields: SchemaFieldConfig[]; data: Record<string, unknown>[] }) {
  var [outcome, setOutcome] = useState(numFields[0]?.field || '')
  var [predictors, setPredictors] = useState<Set<string>>(new Set())

  useEffect(function() { if (!outcome && numFields.length) setOutcome(numFields[0].field) }, [numFields.length])

  var toggleP = function(f: string) {
    setPredictors(function(prev) { var n = new Set(prev); if (n.has(f)) n.delete(f); else if (n.size < 6) n.add(f); return n })
  }

  var result = useMemo(function() {
    if (!outcome || !predictors.size) return null
    var preds = Array.from(predictors).filter(function(p) { return p !== outcome }); if (!preds.length) return null
    var rows = data.filter(function(r) { return !isNaN(parseFloat(String(r[outcome] || '').replace(/,/g, ''))) && preds.every(function(p) { return !isNaN(parseFloat(String(r[p] || '').replace(/,/g, ''))) }) })
    if (rows.length < preds.length + 2) return null
    var y = rows.map(function(r) { return parseFloat(String(r[outcome]).replace(/,/g, '')) })
    var X = rows.map(function(r) { return preds.map(function(p) { return parseFloat(String(r[p]).replace(/,/g, '')) }) })
    return olsRegression(y, X, preds)
  }, [outcome, predictors, data])

  if (numFields.length < 2) return <StatsEmpty icon={'\u27CB'} msg="Need at least 2 numeric fields" sub="Activate more numeric fields or map categorical values to numbers." />

  return (
    <div>
      <PanelHeader icon={'\u27CB'} title="OLS Linear Regression" desc="Ordinary least squares regression with coefficient table, fit statistics, and residual diagnostics." />
      {result && <BottomLine text={regrBL(result, outcome)} naiveText={regrBL_naive(result, outcome)} />}
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20, marginBottom: 20 }}>
        <Card style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>Outcome</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 18 }}>
            {numFields.map(function(f) {
              return (
                <button key={f.field} onClick={function() { setOutcome(f.field); setPredictors(function(p) { var n = new Set(p); n.delete(f.field); return n }) }}
                  style={{ padding: '6px 10px', fontSize: 12, textAlign: 'left', fontWeight: outcome === f.field ? 700 : 400, background: outcome === f.field ? T.accentBg : 'transparent', border: '1px solid ' + (outcome === f.field ? T.accent : T.border), color: outcome === f.field ? T.accent : T.textMid, borderRadius: 7, cursor: 'pointer' }}>
                  {f.label || f.field}
                </button>
              )
            })}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>Predictors ({predictors.size}/6)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {numFields.filter(function(f) { return f.field !== outcome }).map(function(f) {
              var sel = predictors.has(f.field), disabled = !sel && predictors.size >= 6
              return (
                <button key={f.field} onClick={function() { if (!disabled) toggleP(f.field) }}
                  style={{ padding: '6px 10px', fontSize: 12, textAlign: 'left', fontWeight: sel ? 700 : 400, background: sel ? T.greenBg : 'transparent', border: '1px solid ' + (sel ? T.green : T.border), color: disabled ? T.textFaint : sel ? T.green : T.textMid, borderRadius: 7, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 14, height: 14, borderRadius: 3, background: sel ? T.green : T.border, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: 'white' }}>{sel ? '\u2713' : ''}</span>
                  {f.label || f.field}
                </button>
              )
            })}
          </div>
        </Card>
        {result ? (
          <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '11px 16px', borderBottom: '1px solid ' + T.border, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Model Fit {'\u2014'} {outcome}</span>
                <SigBadge p={result.Fp} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)' }}>
                {[
                  { l: 'R\u00B2', v: fmt2(result.R2), c: result.R2 > 0.5 ? T.green : result.R2 > 0.25 ? T.amber : T.textMid },
                  { l: 'Adj. R\u00B2', v: fmt2(result.R2adj), c: T.textMid },
                  { l: 'F stat', v: fmtN(result.F), c: T.textMid },
                  { l: 'p-value', v: null, c: null },
                  { l: 'n', v: String(result.n), c: T.textMid },
                ].map(function(s, i) {
                  return (
                    <div key={i} style={{ padding: '14px 12px', borderRight: i < 4 ? '1px solid ' + T.border : 'none', textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: s.c || T.textMid, fontFamily: 'monospace' }}>{s.v !== null ? s.v : <SigBadge p={result.Fp} />}</div>
                      <div style={{ fontSize: 10, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.07em', marginTop: 3 }}>{s.l}</div>
                    </div>
                  )
                })}
              </div>
            </Card>
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '11px 16px', borderBottom: '1px solid ' + T.border }}><span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Coefficients</span></div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr>
                  {['Variable', '\u03B2', 'Std Err', 't', 'p', '95% CI', ''].map(function(h) {
                    return <th key={h} style={{ padding: '7px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: T.textFaint, background: T.bg, borderBottom: '1px solid ' + T.border }}>{h}</th>
                  })}
                </tr></thead>
                <tbody>{result.coefs.map(function(c: any, i: number) {
                  return (
                    <tr key={i} style={{ background: c.p < 0.05 ? T.greenBg + '80' : 'transparent' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 600, color: T.text, borderBottom: '1px solid ' + T.border, fontSize: 13 }}>{c.name}</td>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12, color: T.textMid, borderBottom: '1px solid ' + T.border }}>{fmtN(c.beta)}</td>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12, color: T.textMid, borderBottom: '1px solid ' + T.border }}>{fmtN(c.se)}</td>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12, color: T.textMid, borderBottom: '1px solid ' + T.border }}>{fmt2(c.t)}</td>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12, color: T.textMid, borderBottom: '1px solid ' + T.border }}>{fmtP(c.p).replace('p ', '')}</td>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 11, color: T.textFaint, borderBottom: '1px solid ' + T.border }}>[{fmtN(c.ci[0])}, {fmtN(c.ci[1])}]</td>
                      <td style={{ padding: '8px 10px', borderBottom: '1px solid ' + T.border }}><SigBadge p={c.p} /></td>
                    </tr>
                  )
                })}</tbody>
              </table>
            </Card>
          </div>
          {/* Residual diagnostic plots */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
            <Card style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>Residuals vs. Fitted</div>
              <PlotlyChart
                data={[
                  { x: result.yhat, y: result.resid, mode: 'markers', type: 'scatter', marker: { color: T.accent, size: 5, opacity: 0.5 } },
                  { x: [Math.min.apply(null, result.yhat), Math.max.apply(null, result.yhat)], y: [0, 0], mode: 'lines', line: { color: T.red, width: 1.5, dash: 'dash' }, showlegend: false },
                ]}
                layout={{ xaxis: { title: { text: 'Fitted', font: { size: 11 } } }, yaxis: { title: { text: 'Residuals', font: { size: 11 } } }, showlegend: false, margin: { t: 8, r: 12, b: 44, l: 50 } }}
                style={{ height: 240, width: '100%' }}
              />
            </Card>
            <Card style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>Q-Q Plot (Residuals)</div>
              {(function() {
                var sr = result.resid.slice().sort(function(a: number, b: number) { return a - b })
                var n = sr.length, th = sr.map(function(_: number, i: number) { return probit((i + 1 - 0.375) / (n + 0.25)) })
                var sm = mean(sr), ss = std(sr)
                return (
                  <PlotlyChart
                    data={[
                      { x: th, y: sr, mode: 'markers', type: 'scatter', marker: { color: T.purple, size: 4, opacity: 0.65 } },
                      { x: [Math.min.apply(null, th), Math.max.apply(null, th)], y: [Math.min.apply(null, th) * ss + sm, Math.max.apply(null, th) * ss + sm], mode: 'lines', line: { color: T.amber, width: 1.5, dash: 'dot' }, showlegend: false },
                    ]}
                    layout={{ xaxis: { title: { text: 'Theoretical quantiles', font: { size: 11 } } }, yaxis: { title: { text: 'Sample quantiles', font: { size: 11 } } }, showlegend: false, margin: { t: 8, r: 12, b: 44, l: 50 } }}
                    style={{ height: 240, width: '100%' }}
                  />
                )
              })()}
            </Card>
          </div>
          </>
        ) : (
          <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.textFaint, fontSize: 13, padding: 40 }}>
            Select an outcome and at least one predictor to run regression.
          </div>
        )}
      </div>
    </div>
  )
}

function InsightsPanel({ numFields, catFields, data, aliases }: { numFields: SchemaFieldConfig[]; catFields: SchemaFieldConfig[]; data: Record<string, unknown>[]; aliases: Record<string, string> }) {
  var [numField, setNumField] = useState(numFields[0]?.field || '')
  var [selectedCats, setSelectedCats] = useState<string[]>([])
  var [loading, setLoading] = useState(false)
  var [report, setReport] = useState<string | null>(null)
  var [apiKey, setApiKey] = useState('')
  var [aiEnabled, setAiEnabled] = useState(false)

  useEffect(function() {
    try {
      var k = localStorage.getItem('sentimetrx_tm_apikey') || ''
      if (k) setApiKey(k)
      var ai = localStorage.getItem('sentimetrx_ai_enabled') === '1'
      setAiEnabled(ai)
    } catch {}
    var interval = setInterval(function() {
      try { setAiEnabled(localStorage.getItem('sentimetrx_ai_enabled') === '1'); setApiKey(localStorage.getItem('sentimetrx_tm_apikey') || '') } catch {}
    }, 2000)
    return function() { clearInterval(interval) }
  }, [])

  var fLbl = function(f: string) { return aliases[f] || f }
  var toggleCat = function(f: string) { setSelectedCats(function(prev) { return prev.includes(f) ? prev.filter(function(x) { return x !== f }) : prev.concat([f]) }) }

  var groupStats = useMemo(function() {
    if (!numField || !selectedCats.length) return []
    return selectedCats.map(function(catF) {
      var groups: Record<string, number[]> = {}
      data.forEach(function(r) {
        var v = parseFloat(String(r[numField] || '')); if (isNaN(v)) return
        var k = String(r[catF] ?? '(blank)'); if (!groups[k]) groups[k] = []; groups[k].push(v)
      })
      var keys = Object.keys(groups).sort()
      var stats = keys.map(function(k) { var vs = groups[k]; return { key: k, n: vs.length, mean: mean(vs) } })
      var testNote = ''
      if (keys.length === 2) { var res = welchTTest(groups[keys[0]], groups[keys[1]]); if (res) testNote = res.p < 0.05 ? 'Significant difference (p=' + res.p.toFixed(3) + ').' : 'No significant difference (p=' + res.p.toFixed(3) + ').' }
      else if (keys.length > 2) { var anova = oneWayANOVA(groups); if (anova) testNote = anova.p < 0.05 ? 'Groups differ (ANOVA p=' + anova.p.toFixed(3) + ').' : 'Groups do not differ (ANOVA p=' + anova.p.toFixed(3) + ').' }
      return { catF: catF, keys: keys, stats: stats, testNote: testNote }
    })
  }, [data, numField, selectedCats])

  var generate = async function() {
    if (!numField || !selectedCats.length || !aiEnabled || !apiKey) return
    setLoading(true); setReport(null)
    try {
      var nLabel = fLbl(numField)
      var sections = groupStats.map(function(gs) {
        var cLabel = fLbl(gs.catF)
        var statLines = gs.stats.map(function(s) { return s.key + ': avg=' + s.mean.toFixed(2) + ' (n=' + s.n + ')' }).join('; ')
        return 'Field: \'' + cLabel + '\' (' + gs.keys.length + ' groups). ' + statLines + '. ' + gs.testNote
      }).join('\n')

      var prompt = 'You are an organizational insights storyteller writing for non-statisticians.\nMetric: \'' + nLabel + '\'\nData:\n' + sections + '\n\nWrite a clear narrative (plain English, no bullet points). For each field, name the highest and lowest groups and whether the difference matters. End with one Key Takeaway sentence.'

      var res = await fetch('/api/datasets/insights', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey, prompt: prompt }),
      })
      var d = await res.json()
      setReport(d.text || d.error || 'No response')
    } catch (e: unknown) { setReport('Error: ' + (e instanceof Error ? e.message : String(e))) }
    setLoading(false)
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: T.text, margin: '0 0 4px' }}>{'\u2726'} Insights</h2>
        <p style={{ fontSize: 13, color: T.textMid, margin: 0, lineHeight: 1.6 }}>Pick a numeric metric and fields to compare. AI tells the story in plain English.</p>
      </div>
      {!aiEnabled && <div style={{ padding: '12px 16px', background: T.amberBg, border: '1px solid ' + T.amberMid, borderRadius: 10, fontSize: 13, color: T.amber, fontWeight: 600 }}>AI is off {'\u2014'} enable it using the toggle in the top bar to use Insights.</div>}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 200 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.06em' }}>Metric (numeric)</label>
          <select value={numField} onChange={function(e) { setNumField(e.target.value) }}
            style={{ padding: '8px 10px', fontSize: 13, border: '1px solid ' + T.border, borderRadius: 8, background: T.bgCard, color: T.text, minWidth: 180 }}>
            {numFields.map(function(f) { return <option key={f.field} value={f.field}>{fLbl(f.field)}</option> })}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 240 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.06em' }}>Compare across (pick 1 or more)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {catFields.map(function(f) {
              var sel = selectedCats.includes(f.field)
              return <button key={f.field} onClick={function() { toggleCat(f.field) }}
                style={{ padding: '6px 14px', fontSize: 12, fontWeight: sel ? 700 : 500, borderRadius: 20, background: sel ? T.accent : T.bgCard, color: sel ? 'white' : T.textMid, border: '1px solid ' + (sel ? T.accent : T.border), cursor: 'pointer' }}>
                {fLbl(f.field)}
              </button>
            })}
          </div>
        </div>
      </div>
      {groupStats.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groupStats.map(function(gs) {
            return (
              <div key={gs.catF} style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 8 }}>{fLbl(gs.catF)}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {gs.stats.slice().sort(function(a, b) { return b.mean - a.mean }).map(function(s) {
                    var isHi = s.mean === Math.max.apply(null, gs.stats.map(function(x) { return x.mean }))
                    var isLo = s.mean === Math.min.apply(null, gs.stats.map(function(x) { return x.mean }))
                    return (
                      <div key={s.key} style={{ padding: '7px 12px', borderRadius: 8, minWidth: 100, textAlign: 'center', background: isHi ? T.greenBg : isLo ? T.redBg : T.bg, border: '1px solid ' + (isHi ? T.greenMid : isLo ? T.red + '44' : T.border) }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: T.text }}>{s.mean.toFixed(2)}</div>
                        <div style={{ fontSize: 11, color: T.textMid, marginTop: 1 }}>{s.key}</div>
                        <div style={{ fontSize: 10, color: T.textFaint }}>n={s.n}</div>
                      </div>
                    )
                  })}
                </div>
                {gs.testNote && <div style={{ marginTop: 8, fontSize: 11, color: T.textFaint, fontStyle: 'italic' }}>{gs.testNote}</div>}
              </div>
            )
          })}
        </div>
      )}
      <button onClick={generate} disabled={loading || !numField || !selectedCats.length || !aiEnabled || !apiKey}
        style={{ alignSelf: 'flex-start', padding: '10px 22px', fontSize: 13, fontWeight: 700, background: (loading || !numField || !selectedCats.length || !aiEnabled || !apiKey) ? T.bg : T.accent, color: (loading || !numField || !selectedCats.length || !aiEnabled || !apiKey) ? T.textFaint : 'white', border: 'none', borderRadius: 10, cursor: (loading || !numField || !selectedCats.length || !aiEnabled || !apiKey) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
        {loading ? 'Generating\u2026' : '\u2726 Generate Insights'}
      </button>
      {report && (
        <div style={{ background: T.accentBg, border: '1px solid ' + T.accentMid, borderRadius: 12, padding: '18px 20px' }}>
          <div style={{ fontSize: 13, color: T.textMid, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{report}</div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN STATS MODULE
// ═══════════════════════════════════════════════════════════════════════════════

var SUB_TABS = [
  { id: 'descriptives', label: 'Descriptives' },
  { id: 'correlations', label: 'Correlations' },
  { id: 'grouptests', label: 'Group Tests' },
  { id: 'regression', label: 'Regression' },
  { id: 'insights', label: '\u2726 Insights' },
]

export default function StatsModule({ datasetId, schema }: Props) {
  var [subTab, setSubTab] = useState('descriptives')
  var [rows, setRows] = useState<Record<string, unknown>[]>([])
  var [rowsLoaded, setRowsLoaded] = useState(false)
  var [rowsLoading, setRowsLoading] = useState(false)
  var { filters } = useFilters()

  // Load rows
  useEffect(function() {
    if (rowsLoaded || rowsLoading) return
    setRowsLoading(true)
    var PAGE_SIZE = 500, page = 0, allRows: Record<string, unknown>[] = []
    var cancelled = false
    ;(async function() {
      try {
        while (!cancelled) {
          var r = await fetch('/api/datasets/' + datasetId + '/rows?page=' + page + '&pageSize=' + PAGE_SIZE)
          if (!r.ok) break
          var data = await r.json()
          var batch: Record<string, unknown>[] = data.rows || []
          allRows = allRows.concat(batch)
          if (page >= (data.totalPages || 0) - 1 || batch.length < PAGE_SIZE) break
          page++
        }
        if (!cancelled) { setRows(allRows); setRowsLoaded(true) }
      } catch {} 
      if (!cancelled) setRowsLoading(false)
    })()
    return function() { cancelled = true }
  }, [datasetId])

  var filteredData = applyFilters(rows, filters)

  var numFields = schema.fields.filter(function(f) { return f.type === 'numeric' })
  var catFields = schema.fields.filter(function(f) { return f.type === 'categorical' })
  var aliases: Record<string, string> = {}
  schema.fields.forEach(function(f) { if (f.label && f.label !== f.field) aliases[f.field] = f.label })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* Sub-tab bar */}
      <div style={{ background: T.bgCard, borderBottom: '1px solid ' + T.border, height: 40, display: 'flex', alignItems: 'stretch', paddingLeft: 8, flexShrink: 0 }}>
        {SUB_TABS.map(function(tab) {
          var isActive = subTab === tab.id
          return (
            <button key={tab.id} onClick={function() { setSubTab(tab.id) }}
              style={{ padding: '0 18px', height: '100%', fontSize: 13, fontWeight: isActive ? 700 : 500, color: isActive ? T.accent : T.textMid, background: 'transparent', border: 'none', borderBottom: '2px solid ' + (isActive ? T.accent : 'transparent'), cursor: 'pointer', flexShrink: 0, transition: 'color .12s' }}>
              {tab.label}
            </button>
          )
        })}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px' }}>
          {rowsLoading && <span style={{ fontSize: 11, color: T.textMute }}>Loading rows...</span>}
          {rowsLoaded && <span style={{ fontSize: 11, color: T.green }}>{'\u2714'} {rows.length.toLocaleString()} rows</span>}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {!rowsLoaded ? (
          <div style={{ textAlign: 'center', padding: 60, color: T.textMute, fontSize: 13 }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', border: '3px solid ' + T.accentMid, borderTopColor: T.accent, animation: 'spin 0.9s linear infinite', margin: '0 auto 12px' }} />
            Loading data for statistical analysis...
          </div>
        ) : (
          <>
            {subTab === 'descriptives' && <DescriptivesPanel numFields={numFields} data={filteredData} />}
            {subTab === 'correlations' && <CorrelationsPanel numFields={numFields} data={filteredData} />}
            {subTab === 'grouptests' && <GroupTestsPanel numFields={numFields} catFields={catFields} data={filteredData} />}
            {subTab === 'regression' && <RegressionPanel numFields={numFields} data={filteredData} />}
            {subTab === 'insights' && <InsightsPanel numFields={numFields} catFields={catFields} data={filteredData} aliases={aliases} />}
          </>
        )}
      </div>
    </div>
  )
}
