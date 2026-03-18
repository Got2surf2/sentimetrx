'use client'
// components/analyze/ChartsModule.tsx
// Full charts module with 13 chart types matching Ana.html.
// Uses Plotly.js for all visualizations. Reads pre-computed analytics
// where possible, fetches rows on demand for cross-field charts.

import { useState, useEffect, useRef } from 'react'

// Dynamic Plotly import — avoids SSR crash
var PlotlyRef: any = null
function getPlotly(): Promise<any> {
  if (PlotlyRef) return Promise.resolve(PlotlyRef)
  return import('plotly.js-dist-min').then(function(m) { PlotlyRef = m.default || m; return PlotlyRef })
}

// ─── Ana theme tokens ──────────────────────────────────────────────────────
var T = {
  bg: '#f4f5f7', bgCard: '#ffffff', border: '#e5e7eb', borderMid: '#d1d5db',
  text: '#111827', textMid: '#374151', textMute: '#6b7280', textFaint: '#9ca3af',
  accent: '#e8622a', accentBg: '#fff4ef', accentMid: '#fbd5c2',
  green: '#16a34a', greenBg: '#f0fdf4',
  red: '#dc2626', amber: '#d97706',
  blue: '#2563eb', blueBg: '#eff6ff',
  purple: '#7c3aed',
}

var CHART_COLORS = ['#e8622a','#2563eb','#16a34a','#7c3aed','#ea580c','#a21caf','#0d9488','#ca8a04','#db2777','#0891b2','#dc2626','#0284c7','#059669','#d97706','#6366f1','#e11d48','#14b8a6','#9333ea','#65a30d','#f97316']

// ─── Types ─────────────────────────────────────────────────────────────────
interface SchemaField {
  field: string
  type: string
  label?: string
  values?: string[]
  min?: number
  max?: number
}
interface SchemaConfig { fields: SchemaField[]; autoDetected: boolean; version: number }
interface FieldSummary {
  type: string
  nonNull: number
  counts?: Record<string, number>
  topN?: string[]
  histogram?: { min: number; max: number; count: number }[]
  min?: number; max?: number; avg?: number; median?: number; stddev?: number
  avgWordCount?: number; sample?: string[]
}
interface Analytics { totalRows: number; computedAt: string; fieldSummaries: Record<string, FieldSummary> }
interface Props {
  datasetId: string
  schema: SchemaConfig
  analytics: Analytics | null
}

// ─── Chart type definitions ────────────────────────────────────────────────
var CHART_TYPE_DEFS = [
  { id: 'bar',          label: 'Bar / Column',   icon: '\u25AD', color: '#e8622a', tip: 'Compare counts or values across categories.', needs: 'Categorical field' },
  { id: 'distribution', label: 'Distribution',   icon: '\uD83D\uDCCA', color: '#7c3aed', tip: 'Histogram or box plot for numeric fields.', needs: 'Numeric field' },
  { id: 'scatter',      label: 'Scatter',        icon: '\u22F9', color: '#0891b2', tip: 'Relationship between two numeric variables.', needs: '2 numeric fields' },
  { id: 'crosstab',     label: 'Crosstab',       icon: '\u229E', color: '#059669', tip: 'Heatmap of two categorical fields.', needs: '2 categorical fields' },
  { id: 'timeseries',   label: 'Time Series',    icon: '\uD83D\uDCC8', color: '#2563eb', tip: 'Track a metric over time.', needs: 'Date + numeric field' },
  { id: 'treemap',      label: 'Treemap',        icon: '\u2B1B', color: '#d97706', tip: 'Hierarchical rectangles sized by measure.', needs: 'Categorical + numeric' },
  { id: 'bubbles',      label: 'Packed Bubbles', icon: '\u25CF', color: '#ec4899', tip: 'Circles sized by numeric measures.', needs: 'Numeric + categorical' },
  { id: 'waterfall',    label: 'Waterfall',      icon: '\u2564', color: '#16a34a', tip: 'Running total contribution per category.', needs: 'Categorical + numeric' },
  { id: 'bullet',       label: 'Bullet / KPI',   icon: '\u29BF', color: '#6366f1', tip: 'Gauge chart with performance bands.', needs: 'Numeric field' },
  { id: 'funnel',       label: 'Funnel',         icon: '\u25BD', color: '#f59e0b', tip: 'Ranked bars in funnel shape.', needs: 'Categorical + numeric' },
  { id: 'gantt',        label: 'Gantt / Range',  icon: '\u27FA', color: '#14b8a6', tip: 'Min-max range bars per category.', needs: 'Categorical + date/numeric' },
  { id: 'driver',       label: 'Score Driver',   icon: '\uD83C\uDFAF', color: '#e8622a', tip: 'Which themes drive higher/lower scores.', needs: 'Themes + score field' },
  { id: 'table',        label: 'Data Table',     icon: '\u229F', color: '#475569', tip: 'Sortable, filterable data table.', needs: 'Any fields' },
]

// ─── Helpers ───────────────────────────────────────────────────────────────
function fl(f: SchemaField): string { return f.label && f.label !== f.field ? f.label : f.field }
function flByName(name: string, schema: SchemaField[]): string {
  var f = schema.find(function(s) { return s.field === name })
  return f ? fl(f) : name
}

function ChartSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void
  options: { v: string; l: string }[]
}) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <select value={value} onChange={function(e) { onChange(e.target.value) }}
        style={{ padding: '6px 10px', fontSize: 12, border: '1px solid ' + T.border, borderRadius: 7, background: T.bgCard, color: T.text, outline: 'none', cursor: 'pointer', minWidth: 120 }}>
        {options.map(function(o) { return <option key={o.v} value={o.v}>{o.l}</option> })}
      </select>
    </div>
  )
}

function ChartToggle({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: [string, string][]
}) {
  return (
    <div style={{ display: 'inline-flex', background: T.bg, borderRadius: 8, padding: 2, border: '1px solid ' + T.border }}>
      {options.map(function(pair) {
        var active = value === pair[0]
        return (
          <button key={pair[0]} onClick={function() { onChange(pair[0]) }}
            style={{ padding: '4px 12px', fontSize: 11, fontWeight: active ? 700 : 500, borderRadius: 6, background: active ? T.bgCard : 'transparent', color: active ? T.accent : T.textMute, border: 'none', cursor: 'pointer', boxShadow: active ? '0 1px 4px rgba(0,0,0,.08)' : 'none' }}>
            {pair[1]}
          </button>
        )
      })}
    </div>
  )
}

function EmptyChart({ msg }: { msg: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 40px', color: T.textFaint }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>{'\uD83D\uDCCA'}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: T.textMid }}>{msg}</div>
    </div>
  )
}

// ─── Plotly renderer ───────────────────────────────────────────────────────
function PlotlyChart({ traces, layout, style }: { traces: any[]; layout: any; style?: React.CSSProperties }) {
  var ref = useRef<HTMLDivElement>(null)
  var mounted = useRef(false)

  useEffect(function() {
    if (!ref.current || !traces.length) return
    var el = ref.current
    getPlotly().then(function(Plotly) {
      var base = {
        paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
        font: { family: 'Inter,system-ui,sans-serif', color: T.textMute, size: 11 },
        margin: { t: 16, r: 20, b: 48, l: 56 },
        xaxis: { gridcolor: T.border, zerolinecolor: T.borderMid, linecolor: T.border, tickfont: { size: 11 }, automargin: true },
        yaxis: { gridcolor: T.border, zerolinecolor: T.borderMid, linecolor: T.border, tickfont: { size: 11 }, automargin: true },
      }
      var merged = { ...base, ...layout }
      if (merged.xaxis && layout.xaxis) merged.xaxis = { ...base.xaxis, ...layout.xaxis }
      if (merged.yaxis && layout.yaxis) merged.yaxis = { ...base.yaxis, ...layout.yaxis }
      if (!mounted.current) {
        Plotly.newPlot(el, traces, merged, { responsive: true, displayModeBar: false })
        mounted.current = true
      } else {
        Plotly.react(el, traces, merged, { responsive: true, displayModeBar: false })
      }
    })
    return function() {
      if (mounted.current && el) {
        getPlotly().then(function(Plotly) { try { Plotly.purge(el) } catch {} })
        mounted.current = false
      }
    }
  }, [traces, layout])

  return <div ref={ref} style={{ width: '100%', height: 420, ...style }} />
}

// ─── Data fetching (for charts needing raw rows) ───────────────────────────
function useRows(datasetId: string, needed: boolean) {
  var [rows, setRows] = useState<Record<string, unknown>[]>([])
  var [loading, setLoading] = useState(false)
  var [loaded, setLoaded] = useState(false)

  useEffect(function() {
    if (!needed || loaded || loading) return
    setLoading(true)
    var allRows: Record<string, unknown>[] = []
    var page = 0
    var PAGE_SIZE = 500

    var fetchPage = function() {
      fetch('/api/datasets/' + datasetId + '/rows?page=' + page + '&pageSize=' + PAGE_SIZE)
        .then(function(r) { return r.json() })
        .then(function(data) {
          allRows = allRows.concat(data.rows || [])
          if (page >= (data.totalPages || 0) - 1 || (data.rows || []).length < PAGE_SIZE) {
            setRows(allRows)
            setLoaded(true)
            setLoading(false)
          } else {
            page++
            fetchPage()
          }
        })
        .catch(function() { setLoading(false) })
    }
    fetchPage()
  }, [datasetId, needed, loaded, loading])

  return { rows: rows, loading: loading, loaded: loaded }
}

// ═══════════════════════════════════════════════════════════════════════════
// CHART COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function BarChartView({ analytics, schema, datasetId }: { analytics: Analytics; schema: SchemaField[]; datasetId: string }) {
  var catFields = schema.filter(function(f) { return f.type === 'categorical' })
  var [catField, setCatField] = useState(catFields[0]?.field || '')
  var [orient, setOrient] = useState('v')
  if (!catFields.length) return <EmptyChart msg="No categorical fields for bar chart." />
  var summary = analytics.fieldSummaries[catField]
  if (!summary || summary.type !== 'categorical' || !summary.counts) return <EmptyChart msg="No data for this field." />
  var entries = Object.entries(summary.counts).sort(function(a, b) { return b[1] - a[1] }).slice(0, 30)
  var cats = entries.map(function(e) { return e[0] })
  var vals = entries.map(function(e) { return e[1] })
  var traces = orient === 'v'
    ? [{ type: 'bar', x: cats, y: vals, marker: { color: T.accent }, text: vals.map(String), textposition: 'outside', textfont: { size: 11 } }]
    : [{ type: 'bar', orientation: 'h', y: cats, x: vals, marker: { color: T.accent } }]
  var layout = orient === 'v'
    ? { xaxis: { title: flByName(catField, schema), tickangle: cats.length > 8 ? -35 : 0 }, yaxis: { title: 'Count' } }
    : { yaxis: { title: flByName(catField, schema) }, xaxis: { title: 'Count' } }
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <ChartSelect label="Category" value={catField} onChange={setCatField} options={catFields.map(function(f) { return { v: f.field, l: fl(f) } })} />
        <ChartToggle value={orient} onChange={setOrient} options={[['v', 'Vertical'], ['h', 'Horizontal']]} />
      </div>
      <PlotlyChart traces={traces} layout={layout} />
    </div>
  )
}

function DistributionView({ analytics, schema }: { analytics: Analytics; schema: SchemaField[] }) {
  var numFields = schema.filter(function(f) { return f.type === 'numeric' })
  var [field, setField] = useState(numFields[0]?.field || '')
  var [mode, setMode] = useState('histogram')
  if (!numFields.length) return <EmptyChart msg="No numeric fields for distribution." />
  var summary = analytics.fieldSummaries[field]
  if (!summary || summary.type !== 'numeric') return <EmptyChart msg="No data for this field." />
  var traces: any[] = []
  if (mode === 'histogram' && summary.histogram) {
    var x = summary.histogram.map(function(b) { return (b.min + b.max) / 2 })
    var y = summary.histogram.map(function(b) { return b.count })
    traces = [{ type: 'bar', x: x, y: y, marker: { color: T.purple }, width: summary.histogram.length > 0 ? (summary.histogram[0].max - summary.histogram[0].min) * 0.9 : 1 }]
  } else {
    traces = [{ type: 'box', y: [summary.min, summary.avg, summary.median, summary.max].filter(function(v) { return v != null }), boxpoints: 'all', marker: { color: T.purple }, name: flByName(field, schema) }]
  }
  var layout = { xaxis: { title: flByName(field, schema) }, yaxis: { title: mode === 'histogram' ? 'Count' : '' } }
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <ChartSelect label="Field" value={field} onChange={setField} options={numFields.map(function(f) { return { v: f.field, l: fl(f) } })} />
        <ChartToggle value={mode} onChange={setMode} options={[['histogram', 'Histogram'], ['box', 'Box Plot']]} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 16 }}>
        {[['Count', String(summary.nonNull)], ['Mean', String(summary.avg)], ['Median', String(summary.median)], ['Min', String(summary.min)], ['Max', String(summary.max)]].map(function(pair) {
          return (
            <div key={pair[0]} style={{ padding: '8px 12px', background: T.bg, borderRadius: 8, border: '1px solid ' + T.border }}>
              <div style={{ fontSize: 10, color: T.textFaint, fontWeight: 700, textTransform: 'uppercase' }}>{pair[0]}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>{pair[1]}</div>
            </div>
          )
        })}
      </div>
      <PlotlyChart traces={traces} layout={layout} />
    </div>
  )
}

function ScatterView({ analytics, schema, datasetId }: { analytics: Analytics; schema: SchemaField[]; datasetId: string }) {
  var numFields = schema.filter(function(f) { return f.type === 'numeric' })
  var [xField, setXField] = useState(numFields[0]?.field || '')
  var [yField, setYField] = useState(numFields[1]?.field || numFields[0]?.field || '')
  var needsRows = numFields.length >= 2
  var { rows, loading, loaded } = useRows(datasetId, needsRows)
  if (numFields.length < 2) return <EmptyChart msg="Need at least 2 numeric fields for scatter." />
  if (loading) return <EmptyChart msg="Loading data..." />
  if (!loaded) return <EmptyChart msg="Waiting for data..." />
  var xVals: number[] = [], yVals: number[] = []
  rows.forEach(function(r) {
    var x = parseFloat(String(r[xField] ?? '')), y = parseFloat(String(r[yField] ?? ''))
    if (!isNaN(x) && !isNaN(y)) { xVals.push(x); yVals.push(y) }
  })
  var traces = [{ type: 'scatter', mode: 'markers', x: xVals, y: yVals, marker: { color: T.accent, size: 6, opacity: 0.6 } }]
  var layout = { xaxis: { title: flByName(xField, schema) }, yaxis: { title: flByName(yField, schema) } }
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <ChartSelect label="X Axis" value={xField} onChange={setXField} options={numFields.map(function(f) { return { v: f.field, l: fl(f) } })} />
        <ChartSelect label="Y Axis" value={yField} onChange={setYField} options={numFields.map(function(f) { return { v: f.field, l: fl(f) } })} />
      </div>
      <PlotlyChart traces={traces} layout={layout} />
    </div>
  )
}

function CrosstabView({ analytics, schema, datasetId }: { analytics: Analytics; schema: SchemaField[]; datasetId: string }) {
  var catFields = schema.filter(function(f) { return f.type === 'categorical' })
  var [rowField, setRowField] = useState(catFields[0]?.field || '')
  var [colField, setColField] = useState(catFields[1]?.field || catFields[0]?.field || '')
  var needsRows = catFields.length >= 2
  var { rows, loading, loaded } = useRows(datasetId, needsRows)
  if (catFields.length < 2) return <EmptyChart msg="Need at least 2 categorical fields for crosstab." />
  if (loading) return <EmptyChart msg="Loading data..." />
  if (!loaded) return <EmptyChart msg="Waiting for data..." />
  var rowVals = Array.from(new Set(rows.map(function(r) { return String(r[rowField] ?? '') }).filter(Boolean))).sort()
  var colVals = Array.from(new Set(rows.map(function(r) { return String(r[colField] ?? '') }).filter(Boolean))).sort()
  var matrix = rowVals.map(function(rv) { return colVals.map(function(cv) { return rows.filter(function(r) { return String(r[rowField] ?? '') === rv && String(r[colField] ?? '') === cv }).length }) })
  var traces = [{ type: 'heatmap', z: matrix, x: colVals, y: rowVals, colorscale: [[0, '#fff4ef'], [1, T.accent]], showscale: true }]
  var layout = { xaxis: { title: flByName(colField, schema) }, yaxis: { title: flByName(rowField, schema) } }
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <ChartSelect label="Rows" value={rowField} onChange={setRowField} options={catFields.map(function(f) { return { v: f.field, l: fl(f) } })} />
        <ChartSelect label="Columns" value={colField} onChange={setColField} options={catFields.map(function(f) { return { v: f.field, l: fl(f) } })} />
      </div>
      <PlotlyChart traces={traces} layout={layout} />
    </div>
  )
}

function TimeSeriesView({ analytics, schema, datasetId }: { analytics: Analytics; schema: SchemaField[]; datasetId: string }) {
  var dateFields = schema.filter(function(f) { return f.type === 'date' })
  var numFields = schema.filter(function(f) { return f.type === 'numeric' })
  var [dateField, setDateField] = useState(dateFields[0]?.field || '')
  var [metric, setMetric] = useState('count')
  var needsRows = dateFields.length > 0 && metric !== 'count'
  var { rows, loading, loaded } = useRows(datasetId, needsRows)
  if (!dateFields.length) return <EmptyChart msg="No date fields for time series." />
  // Count-based from analytics
  var dateSummary = analytics.fieldSummaries[dateField]
  if (metric === 'count' && dateSummary && dateSummary.type === 'date' && dateSummary.counts) {
    var dates = Object.keys(dateSummary.counts).sort()
    var counts = dates.map(function(d) { return (dateSummary.counts || {})[d] || 0 })
    var traces = [{ type: 'scatter', mode: 'lines+markers', x: dates, y: counts, line: { color: T.blue, width: 2 }, marker: { size: 4 } }]
    var layout = { xaxis: { title: flByName(dateField, schema) }, yaxis: { title: 'Count' } }
    return (
      <div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <ChartSelect label="Date field" value={dateField} onChange={setDateField} options={dateFields.map(function(f) { return { v: f.field, l: fl(f) } })} />
          <ChartSelect label="Metric" value={metric} onChange={setMetric} options={[{ v: 'count', l: 'Count' }].concat(numFields.map(function(f) { return { v: 'avg:' + f.field, l: 'Avg ' + fl(f) } }))} />
        </div>
        <PlotlyChart traces={traces} layout={layout} />
      </div>
    )
  }
  if (loading) return <EmptyChart msg="Loading data..." />
  return <EmptyChart msg="Select a date field and metric." />
}

function TreemapView({ analytics, schema }: { analytics: Analytics; schema: SchemaField[] }) {
  var catFields = schema.filter(function(f) { return f.type === 'categorical' })
  var [catField, setCatField] = useState(catFields[0]?.field || '')
  if (!catFields.length) return <EmptyChart msg="No categorical fields for treemap." />
  var summary = analytics.fieldSummaries[catField]
  if (!summary || summary.type !== 'categorical' || !summary.counts) return <EmptyChart msg="No data." />
  var entries = Object.entries(summary.counts).sort(function(a, b) { return b[1] - a[1] }).slice(0, 40)
  var labels = entries.map(function(e) { return e[0] })
  var values = entries.map(function(e) { return e[1] })
  var parents = labels.map(function() { return '' })
  var traces = [{ type: 'treemap', labels: labels, values: values, parents: parents, marker: { colors: labels.map(function(_, i) { return CHART_COLORS[i % CHART_COLORS.length] }) }, branchvalues: 'remainder' as const, textinfo: 'label+value' }]
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'flex-end' }}>
        <ChartSelect label="Category" value={catField} onChange={setCatField} options={catFields.map(function(f) { return { v: f.field, l: fl(f) } })} />
      </div>
      <PlotlyChart traces={traces} layout={{ margin: { t: 10, r: 10, b: 10, l: 10 } }} />
    </div>
  )
}

function BubblesView({ analytics, schema }: { analytics: Analytics; schema: SchemaField[] }) {
  var catFields = schema.filter(function(f) { return f.type === 'categorical' })
  var [catField, setCatField] = useState(catFields[0]?.field || '')
  if (!catFields.length) return <EmptyChart msg="No categorical fields for bubbles." />
  var summary = analytics.fieldSummaries[catField]
  if (!summary || summary.type !== 'categorical' || !summary.counts) return <EmptyChart msg="No data." />
  var entries = Object.entries(summary.counts).sort(function(a, b) { return b[1] - a[1] }).slice(0, 30)
  var labels = entries.map(function(e) { return e[0] })
  var values = entries.map(function(e) { return e[1] })
  var maxVal = Math.max.apply(null, values)
  var sizes = values.map(function(v) { return 15 + (v / maxVal) * 60 })
  var traces = [{ type: 'scatter', mode: 'markers+text', x: labels.map(function(_, i) { return (i % 6) * 2 }), y: labels.map(function(_, i) { return Math.floor(i / 6) * 2 }), text: labels, marker: { size: sizes, color: labels.map(function(_, i) { return CHART_COLORS[i % CHART_COLORS.length] }), opacity: 0.8 }, textposition: 'middle center', textfont: { size: 9, color: 'white' } }]
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'flex-end' }}>
        <ChartSelect label="Category" value={catField} onChange={setCatField} options={catFields.map(function(f) { return { v: f.field, l: fl(f) } })} />
      </div>
      <PlotlyChart traces={traces} layout={{ xaxis: { visible: false }, yaxis: { visible: false }, showlegend: false }} />
    </div>
  )
}

function WaterfallView({ analytics, schema }: { analytics: Analytics; schema: SchemaField[] }) {
  var catFields = schema.filter(function(f) { return f.type === 'categorical' })
  var [catField, setCatField] = useState(catFields[0]?.field || '')
  if (!catFields.length) return <EmptyChart msg="No categorical fields for waterfall." />
  var summary = analytics.fieldSummaries[catField]
  if (!summary || summary.type !== 'categorical' || !summary.counts) return <EmptyChart msg="No data." />
  var entries = Object.entries(summary.counts).sort(function(a, b) { return b[1] - a[1] })
  var labels = entries.map(function(e) { return e[0] }).concat(['Total'])
  var values = entries.map(function(e) { return e[1] })
  var total = values.reduce(function(a, b) { return a + b }, 0)
  var measures: string[] = values.map(function() { return 'relative' }).concat(['total'])
  values.push(total)
  var traces = [{ type: 'waterfall', x: labels, y: values, measure: measures, connector: { line: { color: T.borderMid } }, increasing: { marker: { color: T.green } }, decreasing: { marker: { color: T.red } }, totals: { marker: { color: T.accent } } }]
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'flex-end' }}>
        <ChartSelect label="Category" value={catField} onChange={setCatField} options={catFields.map(function(f) { return { v: f.field, l: fl(f) } })} />
      </div>
      <PlotlyChart traces={traces} layout={{ xaxis: { title: flByName(catField, schema) }, yaxis: { title: 'Count' }, showlegend: false }} />
    </div>
  )
}

function BulletView({ analytics, schema }: { analytics: Analytics; schema: SchemaField[] }) {
  var numFields = schema.filter(function(f) { return f.type === 'numeric' })
  var [field, setField] = useState(numFields[0]?.field || '')
  if (!numFields.length) return <EmptyChart msg="No numeric fields for bullet chart." />
  var summary = analytics.fieldSummaries[field]
  if (!summary || summary.type !== 'numeric') return <EmptyChart msg="No data." />
  var avg = summary.avg ?? 0, min = summary.min ?? 0, max = summary.max ?? 0, med = summary.median ?? 0
  var traces = [{ type: 'indicator', mode: 'number+gauge', value: avg, title: { text: flByName(field, schema) + ' (Mean)' }, gauge: { axis: { range: [min, max] }, bar: { color: T.accent }, steps: [{ range: [min, med], color: '#f0fdf4' }, { range: [med, max], color: '#fef2f2' }], threshold: { line: { color: T.blue, width: 3 }, thickness: 0.8, value: med } } }]
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'flex-end' }}>
        <ChartSelect label="Field" value={field} onChange={setField} options={numFields.map(function(f) { return { v: f.field, l: fl(f) } })} />
      </div>
      <PlotlyChart traces={traces} layout={{ margin: { t: 60 } }} style={{ height: 280 }} />
    </div>
  )
}

function FunnelView({ analytics, schema }: { analytics: Analytics; schema: SchemaField[] }) {
  var catFields = schema.filter(function(f) { return f.type === 'categorical' })
  var [catField, setCatField] = useState(catFields[0]?.field || '')
  if (!catFields.length) return <EmptyChart msg="No categorical fields for funnel." />
  var summary = analytics.fieldSummaries[catField]
  if (!summary || summary.type !== 'categorical' || !summary.counts) return <EmptyChart msg="No data." />
  var entries = Object.entries(summary.counts).sort(function(a, b) { return b[1] - a[1] }).slice(0, 15)
  var traces = [{ type: 'funnel', y: entries.map(function(e) { return e[0] }), x: entries.map(function(e) { return e[1] }), marker: { color: entries.map(function(_, i) { return CHART_COLORS[i % CHART_COLORS.length] }) } }]
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'flex-end' }}>
        <ChartSelect label="Category" value={catField} onChange={setCatField} options={catFields.map(function(f) { return { v: f.field, l: fl(f) } })} />
      </div>
      <PlotlyChart traces={traces} layout={{ margin: { l: 120 }, showlegend: false }} />
    </div>
  )
}

function GanttView({ analytics, schema, datasetId }: { analytics: Analytics; schema: SchemaField[]; datasetId: string }) {
  var catFields = schema.filter(function(f) { return f.type === 'categorical' })
  var numFields = schema.filter(function(f) { return f.type === 'numeric' })
  var [catField, setCatField] = useState(catFields[0]?.field || '')
  var [numField, setNumField] = useState(numFields[0]?.field || '')
  var { rows, loading, loaded } = useRows(datasetId, catFields.length > 0 && numFields.length > 0)
  if (!catFields.length || !numFields.length) return <EmptyChart msg="Need a categorical + numeric field for range chart." />
  if (loading) return <EmptyChart msg="Loading data..." />
  if (!loaded) return <EmptyChart msg="Waiting for data..." />
  var groups: Record<string, number[]> = {}
  rows.forEach(function(r) {
    var cat = String(r[catField] ?? ''); var num = parseFloat(String(r[numField] ?? ''))
    if (cat && !isNaN(num)) { if (!groups[cat]) groups[cat] = []; groups[cat].push(num) }
  })
  var cats = Object.keys(groups).sort()
  var mins = cats.map(function(c) { return Math.min.apply(null, groups[c]) })
  var maxs = cats.map(function(c) { return Math.max.apply(null, groups[c]) })
  var ranges = cats.map(function(_, i) { return maxs[i] - mins[i] })
  var traces = [
    { type: 'bar', orientation: 'h' as const, y: cats, x: mins, marker: { color: 'rgba(0,0,0,0)' }, showlegend: false, hoverinfo: 'skip' as const },
    { type: 'bar', orientation: 'h' as const, y: cats, x: ranges, marker: { color: CHART_COLORS.slice(0, cats.length) }, name: 'Range' }
  ]
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <ChartSelect label="Category" value={catField} onChange={setCatField} options={catFields.map(function(f) { return { v: f.field, l: fl(f) } })} />
        <ChartSelect label="Numeric" value={numField} onChange={setNumField} options={numFields.map(function(f) { return { v: f.field, l: fl(f) } })} />
      </div>
      <PlotlyChart traces={traces} layout={{ barmode: 'stack', showlegend: false, yaxis: { title: flByName(catField, schema) }, xaxis: { title: flByName(numField, schema) } }} />
    </div>
  )
}

function DriverView({ analytics, schema, datasetId }: { analytics: Analytics; schema: SchemaField[]; datasetId: string }) {
  var numFields = schema.filter(function(f) { return f.type === 'numeric' })
  var [scoreField, setScoreField] = useState(numFields[0]?.field || '')
  // Score driver needs theme data from dataset_state — stub for now
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'flex-end' }}>
        <ChartSelect label="Score field" value={scoreField} onChange={setScoreField} options={numFields.map(function(f) { return { v: f.field, l: fl(f) } })} />
      </div>
      <div style={{ textAlign: 'center', padding: 40, color: T.textMute, fontSize: 13 }}>
        Score Driver analysis requires theme model data. Apply themes in TextMine first, then return here.
      </div>
    </div>
  )
}

function TableView({ analytics, schema, datasetId }: { analytics: Analytics; schema: SchemaField[]; datasetId: string }) {
  var [page, setPage] = useState(0)
  var [rows, setRows] = useState<Record<string, unknown>[]>([])
  var [total, setTotal] = useState(0)
  var [loading, setLoading] = useState(false)
  var [sortField, setSortField] = useState<string | null>(null)
  var [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  var PAGE_SIZE = 50
  var cols = schema.filter(function(f) { return f.type !== 'ignore' && f.type !== 'id' })

  useEffect(function() {
    setLoading(true)
    fetch('/api/datasets/' + datasetId + '/rows?page=' + (page + 1) + '&pageSize=' + PAGE_SIZE)
      .then(function(r) { return r.json() })
      .then(function(data) { setRows(data.rows || []); setTotal(data.totalRows || 0); setLoading(false) })
      .catch(function() { setLoading(false) })
  }, [datasetId, page])

  var displayRows = sortField ? [...rows].sort(function(a, b) {
    var av = String(a[sortField!] ?? ''), bv = String(b[sortField!] ?? '')
    var cmp = av.localeCompare(bv, undefined, { numeric: true })
    return sortDir === 'asc' ? cmp : -cmp
  }) : rows

  var totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: T.textMute }}>{total.toLocaleString()} rows</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button onClick={function() { setPage(function(p) { return Math.max(0, p - 1) }) }} disabled={page === 0}
            style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, background: T.bg, border: '1px solid ' + T.border, borderRadius: 6, color: T.textMid, cursor: page === 0 ? 'not-allowed' : 'pointer', opacity: page === 0 ? 0.5 : 1 }}>
            {'\u2190'} Prev
          </button>
          <span style={{ fontSize: 11, color: T.textMute, padding: '4px 8px' }}>{page + 1} / {totalPages}</span>
          <button onClick={function() { setPage(function(p) { return Math.min(totalPages - 1, p + 1) }) }} disabled={page >= totalPages - 1}
            style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, background: T.bg, border: '1px solid ' + T.border, borderRadius: 6, color: T.textMid, cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer', opacity: page >= totalPages - 1 ? 0.5 : 1 }}>
            Next {'\u2192'}
          </button>
        </div>
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid ' + T.border, borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: T.bg }}>
              {cols.map(function(c) {
                var isSorted = sortField === c.field
                return (
                  <th key={c.field} onClick={function() { if (sortField === c.field) { setSortDir(function(d) { return d === 'asc' ? 'desc' : 'asc' }) } else { setSortField(c.field); setSortDir('asc') } }}
                    style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: isSorted ? T.accent : T.textMid, borderBottom: '1px solid ' + T.border, whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}>
                    {fl(c)} {isSorted ? (sortDir === 'asc' ? '\u25B2' : '\u25BC') : ''}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={cols.length} style={{ padding: 20, textAlign: 'center', color: T.textMute }}>Loading...</td></tr>}
            {!loading && displayRows.map(function(row, i) {
              return (
                <tr key={i} style={{ borderBottom: '1px solid ' + T.border }}>
                  {cols.map(function(c) {
                    return (
                      <td key={c.field} style={{ padding: '6px 12px', color: T.text, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {String(row[c.field] ?? '')}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN CHARTS MODULE
// ═══════════════════════════════════════════════════════════════════════════

// ─── Field relevance per chart type (from Ana.html) ────────────────────────
var CHART_FIELD_RELEVANCE: Record<string, { cat?: boolean; num?: boolean | 'optional'; date?: boolean; open?: boolean; all?: boolean }> = {
  bar: { cat: true, num: 'optional' },
  distribution: { num: true },
  scatter: { num: true },
  crosstab: { cat: true },
  timeseries: { date: true, num: 'optional' },
  treemap: { cat: true, num: 'optional' },
  bubbles: { cat: true, num: 'optional' },
  waterfall: { cat: true },
  bullet: { num: true },
  funnel: { cat: true },
  gantt: { cat: true, num: true },
  driver: { num: true },
  table: { all: true },
}

interface SavedChart {
  id: string
  name: string
  chartType: string
  createdAt: string
}

export default function ChartsModule({ datasetId, schema, analytics }: Props) {
  var [activeChart, setActiveChart] = useState('bar')
  var [hovered, setHovered] = useState<string | null>(null)
  var fields = schema.fields.filter(function(f) { return f.type !== 'ignore' && f.type !== 'id' })
  var hasData = analytics && analytics.totalRows > 0

  // Saved charts state
  var [savedCharts, setSavedCharts] = useState<SavedChart[]>([])
  var [savedExpanded, setSavedExpanded] = useState(true)
  var [showManage, setShowManage] = useState(false)
  var [saveName, setSaveName] = useState('')
  var [showSavePrompt, setShowSavePrompt] = useState(false)

  // Load saved charts from dataset_state
  useEffect(function() {
    fetch('/api/datasets/' + datasetId + '/state')
      .then(function(r) { return r.ok ? r.json() : {} as any })
      .then(function(d) { if (d.saved_charts && Array.isArray(d.saved_charts)) setSavedCharts(d.saved_charts) })
      .catch(function() {})
  }, [datasetId])

  var persistSavedCharts = function(charts: SavedChart[]) {
    setSavedCharts(charts)
    fetch('/api/datasets/' + datasetId + '/state', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saved_charts: charts }),
    }).catch(function() {})
  }

  var handleSaveChart = function() {
    if (!saveName.trim()) return
    var chart: SavedChart = { id: 'sc_' + Date.now(), name: saveName.trim(), chartType: activeChart, createdAt: new Date().toISOString() }
    persistSavedCharts(savedCharts.concat([chart]))
    setSaveName('')
    setShowSavePrompt(false)
  }

  var handleDeleteSaved = function(id: string) {
    persistSavedCharts(savedCharts.filter(function(c) { return c.id !== id }))
  }

  // Group fields by type for left sidebar
  var catFields = fields.filter(function(f) { return f.type === 'categorical' })
  var numFields = fields.filter(function(f) { return f.type === 'numeric' })
  var dateFields = fields.filter(function(f) { return f.type === 'date' })
  var openFields = fields.filter(function(f) { return f.type === 'open-ended' })

  var relevance = CHART_FIELD_RELEVANCE[activeChart] || {}
  var isRelevant = function(type: string): boolean {
    if (relevance.all) return true
    if (type === 'categorical' && relevance.cat) return true
    if (type === 'numeric' && (relevance.num === true || relevance.num === 'optional')) return true
    if (type === 'date' && relevance.date) return true
    if (type === 'open-ended' && relevance.open) return true
    return false
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: T.bg }}>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>

        {/* ─── Left sidebar: Fields + Saved Charts ─────────────────── */}
        <div style={{ width: 200, flexShrink: 0, borderRight: '1px solid ' + T.border, background: T.bgCard, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>

          {/* Saved Charts (collapsible) */}
          {savedCharts.length > 0 && (
            <div style={{ borderBottom: '1px solid ' + T.border }}>
              <button onClick={function() { setSavedExpanded(function(v) { return !v }) }}
                style={{ width: '100%', padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.08em' }}>{savedExpanded ? '\u2212' : '+'} Saved Charts</span>
                <span style={{ fontSize: 10, color: T.textFaint }}>{savedCharts.length}</span>
              </button>
              {savedExpanded && (
                <div style={{ padding: '0 8px 8px' }}>
                  {savedCharts.map(function(sc) {
                    var ct = CHART_TYPE_DEFS.find(function(c) { return c.id === sc.chartType })
                    return (
                      <button key={sc.id} onClick={function() { setActiveChart(sc.chartType) }}
                        style={{ width: '100%', textAlign: 'left', padding: '6px 8px', border: 'none', background: activeChart === sc.chartType ? T.accentBg : 'transparent', borderRadius: 6, cursor: 'pointer', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12 }}>{ct ? ct.icon : '\u25A0'}</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: T.textMid, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sc.name}</span>
                      </button>
                    )
                  })}
                  <button onClick={function() { setShowManage(true) }}
                    style={{ width: '100%', padding: '4px 8px', fontSize: 10, fontWeight: 600, color: T.accent, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', marginTop: 2 }}>
                    Manage saved charts...
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Field groups */}
          {[
            { label: 'Categorical', type: 'categorical', list: catFields, color: '#7c3aed', icon: '\u2261' },
            { label: 'Numeric', type: 'numeric', list: numFields, color: '#16a34a', icon: '#' },
            { label: 'Date', type: 'date', list: dateFields, color: '#d97706', icon: '\uD83D\uDCC5' },
            { label: 'Open-ended', type: 'open-ended', list: openFields, color: '#2563eb', icon: '\u2756' },
          ].filter(function(g) { return g.list.length > 0 }).map(function(group) {
            var relevant = isRelevant(group.type)
            return (
              <div key={group.type} style={{ padding: '10px 12px', borderBottom: '1px solid ' + T.border, opacity: relevant ? 1 : 0.35, transition: 'opacity .15s' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: group.color, letterSpacing: '.07em', textTransform: 'uppercase', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>{group.icon}</span> {group.label}
                  {!relevant && <span style={{ fontSize: 9, fontWeight: 400, color: T.textFaint, marginLeft: 'auto' }}>n/a</span>}
                </div>
                {group.list.map(function(f) {
                  return (
                    <div key={f.field}
                      style={{ fontSize: 11, padding: '4px 8px', borderRadius: 5, color: relevant ? T.textMid : T.textFaint, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 1 }}
                      title={f.field}>
                      {fl(f)}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* ─── Chart body ──────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          {/* Save button */}
          {hasData && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              {showSavePrompt ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input value={saveName} onChange={function(e) { setSaveName(e.target.value) }}
                    onKeyDown={function(e) { if (e.key === 'Enter') handleSaveChart(); if (e.key === 'Escape') setShowSavePrompt(false) }}
                    autoFocus placeholder="Chart name..."
                    style={{ padding: '5px 10px', fontSize: 12, border: '1.5px solid ' + T.accent, borderRadius: 7, outline: 'none', width: 200 }} />
                  <button onClick={handleSaveChart} disabled={!saveName.trim()}
                    style={{ padding: '5px 12px', fontSize: 11, fontWeight: 700, background: saveName.trim() ? T.accent : T.borderMid, color: saveName.trim() ? 'white' : T.textFaint, border: 'none', borderRadius: 7, cursor: saveName.trim() ? 'pointer' : 'not-allowed' }}>Save</button>
                  <button onClick={function() { setShowSavePrompt(false); setSaveName('') }}
                    style={{ padding: '5px 8px', fontSize: 12, background: 'transparent', border: 'none', color: T.textFaint, cursor: 'pointer' }}>{'\u2715'}</button>
                </div>
              ) : (
                <button onClick={function() { setShowSavePrompt(true) }}
                  style={{ padding: '5px 14px', fontSize: 11, fontWeight: 600, background: T.bg, border: '1px solid ' + T.border, borderRadius: 20, color: T.textMid, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {'\u2605'} Save Chart
                </button>
              )}
            </div>
          )}
          {!hasData && <EmptyChart msg="No data loaded. Upload a dataset or sync a study first." />}
          {hasData && activeChart === 'bar' && <BarChartView analytics={analytics!} schema={fields} datasetId={datasetId} />}
          {hasData && activeChart === 'distribution' && <DistributionView analytics={analytics!} schema={fields} />}
          {hasData && activeChart === 'scatter' && <ScatterView analytics={analytics!} schema={fields} datasetId={datasetId} />}
          {hasData && activeChart === 'crosstab' && <CrosstabView analytics={analytics!} schema={fields} datasetId={datasetId} />}
          {hasData && activeChart === 'timeseries' && <TimeSeriesView analytics={analytics!} schema={fields} datasetId={datasetId} />}
          {hasData && activeChart === 'treemap' && <TreemapView analytics={analytics!} schema={fields} />}
          {hasData && activeChart === 'bubbles' && <BubblesView analytics={analytics!} schema={fields} />}
          {hasData && activeChart === 'waterfall' && <WaterfallView analytics={analytics!} schema={fields} />}
          {hasData && activeChart === 'bullet' && <BulletView analytics={analytics!} schema={fields} />}
          {hasData && activeChart === 'funnel' && <FunnelView analytics={analytics!} schema={fields} />}
          {hasData && activeChart === 'gantt' && <GanttView analytics={analytics!} schema={fields} datasetId={datasetId} />}
          {hasData && activeChart === 'driver' && <DriverView analytics={analytics!} schema={fields} datasetId={datasetId} />}
          {hasData && activeChart === 'table' && <TableView analytics={analytics!} schema={fields} datasetId={datasetId} />}
        </div>

        {/* ─── Chart type picker sidebar (right) ───────────────────── */}
        <div style={{ width: 220, flexShrink: 0, borderLeft: '1px solid ' + T.border, background: T.bgCard, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <div style={{ padding: '14px 14px 8px', borderBottom: '1px solid ' + T.border, flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.08em' }}>Chart Type</div>
          </div>
          <div style={{ padding: '8px 0', flex: 1 }}>
            {CHART_TYPE_DEFS.map(function(ct) {
              var isActive = activeChart === ct.id
              var isHov = hovered === ct.id
              return (
                <button key={ct.id}
                  onClick={function() { setActiveChart(ct.id) }}
                  onMouseEnter={function() { setHovered(ct.id) }}
                  onMouseLeave={function() { setHovered(null) }}
                  style={{ width: '100%', textAlign: 'left', padding: '9px 14px', border: 'none', background: isActive ? (ct.color + '14') : (isHov ? T.bg : 'transparent'), cursor: 'pointer', borderLeft: '3px solid ' + (isActive ? ct.color : 'transparent'), transition: 'all .12s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, width: 28, height: 28, borderRadius: 7, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: isActive ? ct.color : (isHov ? ct.color + '22' : T.bg), color: isActive ? 'white' : ct.color, flexShrink: 0 }}>{ct.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: isActive ? 700 : 500, color: isActive ? ct.color : T.textMid }}>{ct.label}</span>
                  </div>
                  {(isHov || isActive) && (
                    <div style={{ paddingLeft: 36, marginTop: 3 }}>
                      <div style={{ fontSize: 10, color: T.textMute, lineHeight: 1.45, marginBottom: 3 }}>{ct.tip}</div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: ct.color + 'cc', background: ct.color + '11', padding: '1px 6px', borderRadius: 6, display: 'inline-block' }}>Needs: {ct.needs}</div>
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* ─── Manage Saved Charts Modal ─────────────────────────────── */}
      {showManage && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={function() { setShowManage(false) }}>
          <div style={{ background: T.bgCard, borderRadius: 16, width: 420, maxHeight: '70vh', boxShadow: '0 24px 64px rgba(0,0,0,.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            onClick={function(e) { e.stopPropagation() }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid ' + T.border, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: T.text }}>Manage Saved Charts</span>
              <button onClick={function() { setShowManage(false) }} style={{ background: 'transparent', border: 'none', fontSize: 18, color: T.textMute, cursor: 'pointer' }}>{'\u00D7'}</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
              {savedCharts.length === 0 && (
                <div style={{ textAlign: 'center', padding: 30, color: T.textFaint, fontSize: 13 }}>No saved charts yet.</div>
              )}
              {savedCharts.map(function(sc) {
                var ct = CHART_TYPE_DEFS.find(function(c) { return c.id === sc.chartType })
                return (
                  <div key={sc.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid ' + T.border }}>
                    <span style={{ fontSize: 16 }}>{ct ? ct.icon : '\u25A0'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sc.name}</div>
                      <div style={{ fontSize: 10, color: T.textFaint }}>{ct ? ct.label : sc.chartType}</div>
                    </div>
                    <button onClick={function() { handleDeleteSaved(sc.id) }}
                      style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, background: T.redBg, color: T.red, border: '1px solid ' + T.red + '30', borderRadius: 6, cursor: 'pointer' }}>
                      Delete
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
