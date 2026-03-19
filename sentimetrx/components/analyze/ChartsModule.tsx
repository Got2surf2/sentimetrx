'use client'
// components/analyze/ChartsModule.tsx
// Charts module with labeled drop zones, click-to-assign from sidebar, chart state caching.

import { useState, useEffect, useRef } from 'react'
import { smartOrder, isOrdinalScale, scaleDirectionLabel } from '@/lib/scaleUtils'

// Dynamic Plotly import
var PlotlyRef: any = null
function getPlotly(): Promise<any> {
  if (PlotlyRef) return Promise.resolve(PlotlyRef)
  return import('plotly.js-dist-min').then(function(m) { PlotlyRef = m.default || m; return PlotlyRef })
}

var T = {
  bg: '#f4f5f7', bgCard: '#ffffff', border: '#e5e7eb', borderMid: '#d1d5db',
  text: '#111827', textMid: '#374151', textMute: '#6b7280', textFaint: '#9ca3af',
  accent: '#e8622a', accentBg: '#fff4ef', accentMid: '#fbd5c2',
  green: '#16a34a', greenBg: '#f0fdf4',
  red: '#dc2626', redBg: '#fef2f2', amber: '#d97706',
  blue: '#2563eb', blueBg: '#eff6ff',
  purple: '#7c3aed',
}

var CHART_COLORS = ['#e8622a','#2563eb','#16a34a','#7c3aed','#ea580c','#a21caf','#0d9488','#ca8a04','#db2777','#0891b2','#dc2626','#0284c7','#059669','#d97706','#6366f1','#e11d48','#14b8a6','#9333ea','#65a30d','#f97316']

interface SchemaField { field: string; type: string; label?: string; values?: string[]; min?: number; max?: number }
interface SchemaConfig { fields: SchemaField[]; autoDetected: boolean; version: number }
interface FieldSummary { type: string; nonNull: number; counts?: Record<string, number>; topN?: string[]; histogram?: { min: number; max: number; count: number }[]; min?: number; max?: number; avg?: number; median?: number; stddev?: number; avgWordCount?: number; sample?: string[] }
interface Analytics { totalRows: number; computedAt: string; fieldSummaries: Record<string, FieldSummary> }
interface Props { datasetId: string; schema: SchemaConfig; analytics: Analytics | null; themeModel?: any }

// ─── Chart slot definitions ───────────────────────────────────────────────

interface SlotDef {
  key: string
  label: string
  accepts: string[]  // field types: 'categorical', 'numeric', 'date', 'any'
  required: boolean
}

var CHART_SLOTS: Record<string, SlotDef[]> = {
  bar:          [{ key: 'category', label: 'Category', accepts: ['categorical'], required: true }, { key: 'colorBy', label: 'Color / Stack by', accepts: ['categorical'], required: false }, { key: 'value', label: 'Value (optional)', accepts: ['numeric'], required: false }],
  distribution: [{ key: 'field', label: 'Numeric Field', accepts: ['numeric'], required: true }],
  scatter:      [{ key: 'x', label: 'X Axis', accepts: ['numeric'], required: true }, { key: 'y', label: 'Y Axis', accepts: ['numeric'], required: true }],
  crosstab:     [{ key: 'rows', label: 'Row Variable', accepts: ['categorical'], required: true }, { key: 'cols', label: 'Column Variable', accepts: ['categorical'], required: true }],
  timeseries:   [{ key: 'date', label: 'Date Field', accepts: ['date'], required: true }, { key: 'metric', label: 'Metric', accepts: ['numeric'], required: false }],
  treemap:      [{ key: 'category', label: 'Category', accepts: ['categorical'], required: true }, { key: 'size', label: 'Size (optional)', accepts: ['numeric'], required: false }],
  bubbles:      [{ key: 'category', label: 'Category', accepts: ['categorical'], required: true }, { key: 'size', label: 'Size (optional)', accepts: ['numeric'], required: false }],
  waterfall:    [{ key: 'category', label: 'Category', accepts: ['categorical'], required: true }],
  bullet:       [{ key: 'field', label: 'Numeric Field', accepts: ['numeric'], required: true }],
  funnel:       [{ key: 'category', label: 'Category', accepts: ['categorical'], required: true }],
  gantt:        [{ key: 'category', label: 'Category', accepts: ['categorical'], required: true }, { key: 'range', label: 'Range Field', accepts: ['numeric', 'date'], required: true }],
  driver:       [{ key: 'score', label: 'Score Field', accepts: ['numeric'], required: true }],
  table:        [],
}

var CHART_TYPE_DEFS = [
  { id: 'bar',          label: 'Bar / Column',   icon: '\u25AD', color: '#e8622a', tip: 'Compare counts or values across categories.' },
  { id: 'distribution', label: 'Distribution',   icon: '\uD83D\uDCCA', color: '#7c3aed', tip: 'Histogram or box plot for numeric fields.' },
  { id: 'scatter',      label: 'Scatter',        icon: '\u22F9', color: '#0891b2', tip: 'Relationship between two numeric variables.' },
  { id: 'crosstab',     label: 'Crosstab',       icon: '\u229E', color: '#059669', tip: 'Heatmap of two categorical fields.' },
  { id: 'timeseries',   label: 'Time Series',    icon: '\uD83D\uDCC8', color: '#2563eb', tip: 'Track a metric over time.' },
  { id: 'treemap',      label: 'Treemap',        icon: '\u2B1B', color: '#d97706', tip: 'Hierarchical rectangles sized by measure.' },
  { id: 'bubbles',      label: 'Packed Bubbles', icon: '\u25CF', color: '#ec4899', tip: 'Circles sized by numeric measures.' },
  { id: 'waterfall',    label: 'Waterfall',      icon: '\u2564', color: '#16a34a', tip: 'Running total contribution per category.' },
  { id: 'bullet',       label: 'Bullet / KPI',   icon: '\u29BF', color: '#6366f1', tip: 'Gauge chart with performance bands.' },
  { id: 'funnel',       label: 'Funnel',         icon: '\u25BD', color: '#f59e0b', tip: 'Ranked bars in funnel shape.' },
  { id: 'gantt',        label: 'Gantt / Range',  icon: '\u27FA', color: '#14b8a6', tip: 'Min-max range bars per category.' },
  { id: 'driver',       label: 'Score Driver',   icon: '\uD83C\uDFAF', color: '#e8622a', tip: 'Which themes drive higher/lower scores.' },
  { id: 'table',        label: 'Data Table',     icon: '\u229F', color: '#475569', tip: 'Sortable, filterable data table.' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────

function fl(f: SchemaField): string { return f.label && f.label !== f.field ? f.label : f.field }
function flByName(name: string, schema: SchemaField[]): string { var f = schema.find(function(s) { return s.field === name }); return f ? fl(f) : name }

function PlotlyChart({ traces, layout, style }: { traces: any[]; layout?: any; style?: React.CSSProperties }) {
  var ref = useRef<HTMLDivElement>(null)
  useEffect(function() {
    if (!ref.current || !traces.length) return
    var base = { paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', font: { family: 'Inter,system-ui,sans-serif', color: T.textMute, size: 11 }, margin: { t: 16, r: 20, b: 48, l: 56 }, xaxis: { gridcolor: T.border, zerolinecolor: T.borderMid }, yaxis: { gridcolor: T.border, zerolinecolor: T.borderMid } }
    var merged = Object.assign({}, base, layout || {})
    getPlotly().then(function(Plotly) { Plotly.newPlot(ref.current, traces, merged, { responsive: true, displayModeBar: false }) })
    return function() { if (ref.current) getPlotly().then(function(Plotly) { try { Plotly.purge(ref.current) } catch {} }) }
  }, [traces, layout])
  return <div ref={ref} style={style || { width: '100%', height: 400 }} />
}

function EmptyChart({ msg }: { msg: string }) {
  return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 40px', color: T.textFaint }}><div style={{ fontSize: 40, marginBottom: 12 }}>{'\uD83D\uDCCA'}</div><div style={{ fontSize: 14, fontWeight: 600, color: T.textMid }}>{msg}</div></div>
}

// ─── Drop Zone component ──────────────────────────────────────────────────

function DropZone({ slot, value, schema, activeSlot, onActivate, onClear }: {
  slot: SlotDef; value: string; schema: SchemaField[]
  activeSlot: string | null; onActivate: () => void; onClear: () => void
}) {
  var isActive = activeSlot === slot.key
  var fieldObj = schema.find(function(f) { return f.field === value })
  var hasValue = !!value && !!fieldObj
  var acceptsLabel = slot.accepts.includes('any') ? 'any field' : slot.accepts.join(' / ')

  return (
    <div onClick={onActivate}
      style={{
        flex: 1, minWidth: 140, padding: '8px 12px', borderRadius: 8,
        background: isActive ? T.accentBg : hasValue ? T.bgCard : T.bg,
        border: '2px ' + (isActive ? 'solid ' + T.accent : hasValue ? 'solid ' + T.border : 'dashed ' + T.borderMid),
        cursor: 'pointer', transition: 'all .12s',
      }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: isActive ? T.accent : T.textFaint, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 3 }}>
        {slot.label}{!slot.required && ' (optional)'}
      </div>
      {hasValue ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{fl(fieldObj!)}</span>
          <button onClick={function(e) { e.stopPropagation(); onClear() }}
            style={{ width: 16, height: 16, borderRadius: 4, background: T.bg, border: '1px solid ' + T.border, color: T.textFaint, fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{'\u00D7'}</button>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: isActive ? T.accent : T.textMute, fontStyle: 'italic' }}>
          {isActive ? 'Click a field in the sidebar...' : 'Click to assign ' + acceptsLabel}
        </div>
      )}
    </div>
  )
}

// ─── Chart Renderers (receive field values as params) ─────────────────────

function renderChart(chartType: string, config: Record<string, string>, analytics: Analytics, schema: SchemaField[], datasetId: string, opts?: { barMode?: string; barStack?: boolean; smartAxes?: boolean }): React.ReactNode {
  var fs = analytics.fieldSummaries
  var useSmartOrder = opts?.smartAxes !== false

  if (chartType === 'bar') {
    var catField = config.category; if (!catField) return <EmptyChart msg="Assign a category field above." />
    var summary = fs[catField]; if (!summary || !summary.counts) return <EmptyChart msg="No data for this field." />
    var rawEntries = Object.entries(summary.counts)
    // Smart axes: order by detected scale, otherwise by count desc
    var orderedKeys = useSmartOrder ? smartOrder(rawEntries.map(function(e) { return e[0] })) : rawEntries.sort(function(a, b) { return b[1] - a[1] }).map(function(e) { return e[0] })
    var entries = orderedKeys.slice(0, 30).map(function(k) { return [k, summary.counts![k] || 0] as [string, number] })
    var cats = entries.map(function(e) { return e[0] })
    var vals = entries.map(function(e) { return e[1] })
    var totalCount = vals.reduce(function(a, b) { return a + b }, 0)
    var displayVals = opts?.barMode === 'percent' ? vals.map(function(v) { return totalCount > 0 ? Math.round(v / totalCount * 1000) / 10 : 0 }) : vals
    var yTitle = opts?.barMode === 'percent' ? '% of Total' : 'Count'

    // Stacked/grouped with colorBy
    var colorByField = config.colorBy
    if (colorByField && fs[colorByField] && fs[colorByField].counts) {
      // Need raw rows for crosstab — show simple bar if no colorBy data
      return <BarStackedInner analytics={analytics} schema={schema} datasetId={datasetId} catField={catField} colorByField={colorByField} barMode={opts?.barMode || 'count'} barStack={opts?.barStack || false} />
    }

    var traces = [{ type: 'bar', x: cats, y: displayVals, marker: { color: T.accent }, text: displayVals.map(function(v) { return String(opts?.barMode === 'percent' ? v + '%' : v) }), textposition: 'outside', textfont: { size: 11 } }]
    return <PlotlyChart traces={traces} layout={{ xaxis: { title: flByName(catField, schema), tickangle: cats.length > 8 ? -35 : 0 }, yaxis: { title: yTitle } }} />
  }

  if (chartType === 'distribution') {
    var field = config.field; if (!field) return <EmptyChart msg="Assign a numeric field above." />
    var sum = fs[field]; if (!sum) return <EmptyChart msg="No data." />
    if (sum.histogram) {
      var hx = sum.histogram.map(function(b) { return (b.min + b.max) / 2 }); var hy = sum.histogram.map(function(b) { return b.count })
      return <PlotlyChart traces={[{ type: 'bar', x: hx, y: hy, marker: { color: T.purple, opacity: 0.8 } }]} layout={{ xaxis: { title: flByName(field, schema) }, yaxis: { title: 'Count' }, bargap: 0.05 }} />
    }
    return <PlotlyChart traces={[{ type: 'box', y: [sum.min, sum.avg, sum.median, sum.max].filter(function(v) { return v != null }), boxpoints: 'all', marker: { color: T.purple }, name: flByName(field, schema) }]} layout={{ yaxis: { title: flByName(field, schema) } }} />
  }

  if (chartType === 'scatter') {
    var xF = config.x, yF = config.y; if (!xF || !yF) return <EmptyChart msg="Assign X and Y fields above." />
    return <ScatterChartInner analytics={analytics} schema={schema} datasetId={datasetId} xField={xF} yField={yF} />
  }

  if (chartType === 'crosstab') {
    var rowF = config.rows, colF = config.cols; if (!rowF || !colF) return <EmptyChart msg="Assign row and column fields above." />
    return <CrosstabInner analytics={analytics} schema={schema} datasetId={datasetId} rowField={rowF} colField={colF} />
  }

  if (chartType === 'timeseries') {
    var dateF = config.date; if (!dateF) return <EmptyChart msg="Assign a date field above." />
    return <TimeSeriesInner analytics={analytics} schema={schema} datasetId={datasetId} dateField={dateF} metricField={config.metric || ''} />
  }

  if (chartType === 'treemap') {
    var catF2 = config.category; if (!catF2) return <EmptyChart msg="Assign a category field above." />
    var s2 = fs[catF2]; if (!s2 || !s2.counts) return <EmptyChart msg="No data." />
    var e2 = (function() { var raw = Object.entries(s2.counts); var keys = useSmartOrder ? smartOrder(raw.map(function(e) { return e[0] })) : raw.sort(function(a, b) { return b[1] - a[1] }).map(function(e) { return e[0] }); return keys.slice(0, 30).map(function(k) { return [k, s2.counts![k] || 0] as [string, number] }) })()
    var labels = e2.map(function(e) { return e[0] }); var values = e2.map(function(e) { return e[1] }); var parents = labels.map(function() { return '' })
    return <PlotlyChart traces={[{ type: 'treemap', labels: labels, values: values, parents: parents, marker: { colors: labels.map(function(_, i) { return CHART_COLORS[i % CHART_COLORS.length] }) }, branchvalues: 'remainder' as const, textinfo: 'label+value' }]} layout={{ margin: { t: 8, r: 8, b: 8, l: 8 } }} />
  }

  if (chartType === 'bubbles') {
    var catF3 = config.category; if (!catF3) return <EmptyChart msg="Assign a category field above." />
    var s3 = fs[catF3]; if (!s3 || !s3.counts) return <EmptyChart msg="No data." />
    var e3 = Object.entries(s3.counts).sort(function(a, b) { return b[1] - a[1] }).slice(0, 20)
    return <PlotlyChart traces={[{ x: e3.map(function(e, i) { return (i % 5) * 2 }), y: e3.map(function(e, i) { return Math.floor(i / 5) * 2 }), mode: 'markers+text', marker: { size: e3.map(function(e) { return Math.max(20, Math.sqrt(e[1]) * 4) }), color: e3.map(function(_, i) { return CHART_COLORS[i % CHART_COLORS.length] }), opacity: 0.8 }, text: e3.map(function(e) { return e[0] + '\n' + e[1] }), textposition: 'center', textfont: { size: 10 } }]} layout={{ showlegend: false, xaxis: { visible: false }, yaxis: { visible: false }, margin: { t: 8, r: 8, b: 8, l: 8 } }} />
  }

  if (chartType === 'waterfall') {
    var catF4 = config.category; if (!catF4) return <EmptyChart msg="Assign a category field above." />
    var s4 = fs[catF4]; if (!s4 || !s4.counts) return <EmptyChart msg="No data." />
    var e4 = (function() { var raw = Object.entries(s4.counts); var keys = useSmartOrder ? smartOrder(raw.map(function(e) { return e[0] })) : raw.sort(function(a, b) { return b[1] - a[1] }).map(function(e) { return e[0] }); return keys.slice(0, 15).map(function(k) { return [k, s4.counts![k] || 0] as [string, number] }) })()
    var wLabels = e4.map(function(e) { return e[0] }).concat(['Total'])
    var wValues = e4.map(function(e) { return e[1] })
    var total = wValues.reduce(function(a, b) { return a + b }, 0)
    var measures: string[] = wValues.map(function() { return 'relative' }).concat(['total'])
    wValues.push(total)
    return <PlotlyChart traces={[{ type: 'waterfall', x: wLabels, y: wValues, measure: measures, connector: { line: { color: T.borderMid } }, increasing: { marker: { color: T.green } }, decreasing: { marker: { color: T.red } }, totals: { marker: { color: T.accent } } }]} layout={{ margin: { t: 12, r: 16, b: 48, l: 56 }, showlegend: false }} />
  }

  if (chartType === 'bullet') {
    var bField = config.field; if (!bField) return <EmptyChart msg="Assign a numeric field above." />
    var bs = fs[bField]; if (!bs || bs.avg == null) return <EmptyChart msg="No numeric data." />
    return <PlotlyChart traces={[{ type: 'indicator', mode: 'number+gauge', value: bs.avg, gauge: { axis: { range: [bs.min || 0, bs.max || 100] }, bar: { color: T.accent }, steps: [{ range: [bs.min || 0, (bs.avg || 0)], color: T.bg }, { range: [(bs.avg || 0), bs.max || 100], color: T.border }] }, title: { text: flByName(bField, schema) } }]} layout={{ margin: { t: 40, r: 30, b: 20, l: 30 }, height: 200 }} style={{ height: 200 }} />
  }

  if (chartType === 'funnel') {
    var catF5 = config.category; if (!catF5) return <EmptyChart msg="Assign a category field above." />
    var s5 = fs[catF5]; if (!s5 || !s5.counts) return <EmptyChart msg="No data." />
    var e5 = (function() { var raw = Object.entries(s5.counts); var keys = useSmartOrder ? smartOrder(raw.map(function(e) { return e[0] })) : raw.sort(function(a, b) { return b[1] - a[1] }).map(function(e) { return e[0] }); return keys.slice(0, 12).map(function(k) { return [k, s5.counts![k] || 0] as [string, number] }) })()
    return <PlotlyChart traces={[{ type: 'funnel', y: e5.map(function(e) { return e[0] }), x: e5.map(function(e) { return e[1] }), marker: { color: e5.map(function(_, i) { return CHART_COLORS[i % CHART_COLORS.length] }) } }]} layout={{ margin: { t: 8, r: 16, b: 8, l: 120 }, showlegend: false }} />
  }

  if (chartType === 'gantt') {
    var gCat = config.category, gRange = config.range; if (!gCat || !gRange) return <EmptyChart msg="Assign category and range fields above." />
    return <GanttInner analytics={analytics} schema={schema} datasetId={datasetId} catField={gCat} rangeField={gRange} />
  }

  if (chartType === 'driver') return <EmptyChart msg="Score Driver requires a theme model and a scored field. Coming soon." />

  if (chartType === 'table') return <TableInner analytics={analytics} schema={schema} datasetId={datasetId} />

  return <EmptyChart msg="Select a chart type." />
}

// ─── Chart sub-components that need raw rows ──────────────────────────────

function useRows(datasetId: string) {
  var [rows, setRows] = useState<Record<string, unknown>[]>([])
  var [loaded, setLoaded] = useState(false)
  var [loading, setLoading] = useState(false)
  useEffect(function() {
    if (loaded || loading) return; setLoading(true)
    var page = 0, PAGE_SIZE = 500, allRows: Record<string, unknown>[] = []
    var fetchPage = function() {
      fetch('/api/datasets/' + datasetId + '/rows?page=' + page + '&pageSize=' + PAGE_SIZE)
        .then(function(r) { return r.json() })
        .then(function(data) {
          allRows = allRows.concat(data.rows || [])
          if (page >= (data.totalPages || 0) - 1 || (data.rows || []).length < PAGE_SIZE) { setRows(allRows); setLoaded(true); setLoading(false) }
          else { page++; fetchPage() }
        }).catch(function() { setLoading(false) })
    }
    fetchPage()
  }, [datasetId])
  return { rows: rows, loaded: loaded, loading: loading }
}

function BarStackedInner({ analytics, schema, datasetId, catField, colorByField, barMode, barStack }: { analytics: Analytics; schema: SchemaField[]; datasetId: string; catField: string; colorByField: string; barMode: string; barStack: boolean }) {
  var { rows, loaded } = useRows(datasetId)
  if (!loaded) return <div style={{ textAlign: 'center', padding: 40, color: T.textMute, fontSize: 13 }}>Loading data...</div>

  // Build crosstab: category × colorBy
  var grid: Record<string, Record<string, number>> = {}
  var colorVals = new Set<string>()
  rows.forEach(function(r) {
    var cat = String(r[catField] || '').trim()
    var col = String(r[colorByField] || '').trim()
    if (!cat || !col) return
    colorVals.add(col)
    if (!grid[cat]) grid[cat] = {}
    grid[cat][col] = (grid[cat][col] || 0) + 1
  })
  var cats = Object.keys(grid).sort(function(a, b) {
    var ta = Object.values(grid[b]).reduce(function(s, v) { return s + v }, 0)
    var tb = Object.values(grid[a]).reduce(function(s, v) { return s + v }, 0)
    return ta - tb
  }).slice(0, 30)
  var colors = Array.from(colorVals).sort()

  var traces = colors.map(function(col, i) {
    var ys = cats.map(function(cat) { return grid[cat] ? (grid[cat][col] || 0) : 0 })
    if (barMode === 'percent') {
      ys = cats.map(function(cat) {
        var total = Object.values(grid[cat] || {}).reduce(function(s, v) { return s + v }, 0)
        return total > 0 ? Math.round((grid[cat] ? (grid[cat][col] || 0) : 0) / total * 1000) / 10 : 0
      })
    }
    return { type: 'bar', name: col, x: cats, y: ys, marker: { color: CHART_COLORS[i % CHART_COLORS.length] } }
  })

  return <PlotlyChart traces={traces} layout={{ barmode: barStack ? 'stack' : 'group', xaxis: { title: flByName(catField, schema), tickangle: cats.length > 8 ? -35 : 0 }, yaxis: { title: barMode === 'percent' ? '% of Category' : 'Count' }, legend: { orientation: 'h', y: -0.2 } }} />
}

function ScatterChartInner({ analytics, schema, datasetId, xField, yField }: { analytics: Analytics; schema: SchemaField[]; datasetId: string; xField: string; yField: string }) {
  var { rows, loaded } = useRows(datasetId)
  if (!loaded) return <div style={{ textAlign: 'center', padding: 40, color: T.textMute, fontSize: 13 }}>Loading data...</div>
  var x: number[] = [], y: number[] = []
  rows.forEach(function(r) { var xv = parseFloat(String(r[xField] || '')), yv = parseFloat(String(r[yField] || '')); if (!isNaN(xv) && !isNaN(yv)) { x.push(xv); y.push(yv) } })
  if (!x.length) return <EmptyChart msg="No numeric pairs found." />
  return <PlotlyChart traces={[{ x: x, y: y, mode: 'markers', type: 'scatter', marker: { color: T.accent, size: 6, opacity: 0.6 } }]} layout={{ xaxis: { title: flByName(xField, schema) }, yaxis: { title: flByName(yField, schema) }, showlegend: false }} />
}

function CrosstabInner({ analytics, schema, datasetId, rowField, colField }: { analytics: Analytics; schema: SchemaField[]; datasetId: string; rowField: string; colField: string }) {
  var { rows, loaded } = useRows(datasetId)
  if (!loaded) return <div style={{ textAlign: 'center', padding: 40, color: T.textMute, fontSize: 13 }}>Loading data...</div>
  var grid: Record<string, Record<string, number>> = {}; var rSet = new Set<string>(); var cSet = new Set<string>()
  rows.forEach(function(r) { var rv = String(r[rowField] || '').trim(), cv = String(r[colField] || '').trim(); if (!rv || !cv) return; rSet.add(rv); cSet.add(cv); if (!grid[rv]) grid[rv] = {}; grid[rv][cv] = (grid[rv][cv] || 0) + 1 })
  var rArr = Array.from(rSet).sort(), cArr = Array.from(cSet).sort()
  var z = rArr.map(function(r) { return cArr.map(function(c) { return grid[r] ? (grid[r][c] || 0) : 0 }) })
  return <PlotlyChart traces={[{ type: 'heatmap', x: cArr, y: rArr, z: z, colorscale: 'YlOrRd', showscale: true }]} layout={{ xaxis: { title: flByName(colField, schema) }, yaxis: { title: flByName(rowField, schema) }, margin: { t: 12, r: 60, b: 60, l: 100 } }} />
}

function TimeSeriesInner({ analytics, schema, datasetId, dateField, metricField }: { analytics: Analytics; schema: SchemaField[]; datasetId: string; dateField: string; metricField: string }) {
  var { rows, loaded } = useRows(datasetId)
  if (!loaded) return <div style={{ textAlign: 'center', padding: 40, color: T.textMute, fontSize: 13 }}>Loading data...</div>
  var grouped: Record<string, number[]> = {}
  rows.forEach(function(r) { var d = String(r[dateField] || '').slice(0, 10); if (!d) return; if (!grouped[d]) grouped[d] = []; if (metricField) { var v = parseFloat(String(r[metricField] || '')); if (!isNaN(v)) grouped[d].push(v) } else { grouped[d].push(1) } })
  var dates = Object.keys(grouped).sort()
  var yVals = dates.map(function(d) { var arr = grouped[d]; return metricField ? arr.reduce(function(a, b) { return a + b }, 0) / arr.length : arr.length })
  return <PlotlyChart traces={[{ x: dates, y: yVals, type: 'scatter', mode: 'lines+markers', line: { color: T.blue, width: 2 }, marker: { size: 5 } }]} layout={{ xaxis: { title: flByName(dateField, schema) }, yaxis: { title: metricField ? 'Avg ' + flByName(metricField, schema) : 'Count' } }} />
}

function GanttInner({ analytics, schema, datasetId, catField, rangeField }: { analytics: Analytics; schema: SchemaField[]; datasetId: string; catField: string; rangeField: string }) {
  var { rows, loaded } = useRows(datasetId)
  if (!loaded) return <div style={{ textAlign: 'center', padding: 40, color: T.textMute, fontSize: 13 }}>Loading data...</div>
  var groups: Record<string, number[]> = {}
  rows.forEach(function(r) { var c = String(r[catField] || '').trim(); var v = parseFloat(String(r[rangeField] || '')); if (c && !isNaN(v)) { if (!groups[c]) groups[c] = []; groups[c].push(v) } })
  var catArr = Object.keys(groups).sort(); var mins = catArr.map(function(c) { return Math.min.apply(null, groups[c]) }); var ranges = catArr.map(function(c) { return Math.max.apply(null, groups[c]) - Math.min.apply(null, groups[c]) })
  return <PlotlyChart traces={[{ type: 'bar', orientation: 'h' as const, y: catArr, x: mins, marker: { color: 'rgba(0,0,0,0)' }, showlegend: false, hoverinfo: 'skip' as const }, { type: 'bar', orientation: 'h' as const, y: catArr, x: ranges, marker: { color: CHART_COLORS.slice(0, catArr.length) }, name: 'Range' }]} layout={{ barmode: 'stack', yaxis: { title: flByName(catField, schema) }, xaxis: { title: flByName(rangeField, schema) }, showlegend: false, margin: { l: 120 } }} />
}

function TableInner({ analytics, schema, datasetId }: { analytics: Analytics; schema: SchemaField[]; datasetId: string }) {
  var [rows, setRows] = useState<Record<string, unknown>[]>([])
  var [page, setPage] = useState(0); var [total, setTotal] = useState(0); var [loading, setLoading] = useState(false)
  useEffect(function() {
    setLoading(true)
    fetch('/api/datasets/' + datasetId + '/rows?page=' + page + '&pageSize=50')
      .then(function(r) { return r.json() })
      .then(function(data) { setRows(data.rows || []); setTotal(data.totalRows || 0); setLoading(false) })
      .catch(function() { setLoading(false) })
  }, [datasetId, page])
  var cols = schema.filter(function(f) { return f.type !== 'ignore' })
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr>{cols.map(function(f) { return <th key={f.field} style={{ padding: '8px 10px', textAlign: 'left', background: T.bg, borderBottom: '2px solid ' + T.border, fontSize: 11, fontWeight: 700, color: T.textMid, whiteSpace: 'nowrap' }}>{fl(f)}</th> })}</tr></thead>
        <tbody>{rows.map(function(r, i) { return <tr key={i}>{cols.map(function(f) { return <td key={f.field} style={{ padding: '6px 10px', borderBottom: '1px solid ' + T.border, color: T.textMid, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(r[f.field] ?? '')}</td> })}</tr> })}</tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', fontSize: 11, color: T.textMute }}>
        <span>{total} total rows</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={function() { setPage(function(p) { return Math.max(0, p - 1) }) }} disabled={page === 0} style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid ' + T.border, background: T.bgCard, cursor: page === 0 ? 'not-allowed' : 'pointer', color: T.textMid, fontSize: 11 }}>{'\u2190'} Prev</button>
          <span style={{ padding: '3px 8px' }}>Page {page + 1}</span>
          <button onClick={function() { setPage(function(p) { return p + 1 }) }} disabled={rows.length < 50} style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid ' + T.border, background: T.bgCard, cursor: rows.length < 50 ? 'not-allowed' : 'pointer', color: T.textMid, fontSize: 11 }}>Next {'\u2192'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Saved Charts ─────────────────────────────────────────────────────────

interface SavedChart { id: string; name: string; chartType: string; config: Record<string, string>; createdAt: string }

// ═══════════════════════════════════════════════════════════════════════════
// MAIN MODULE
// ═══════════════════════════════════════════════════════════════════════════

export default function ChartsModule({ datasetId, schema, analytics, themeModel }: Props) {
  var [activeChart, setActiveChart] = useState('bar')
  var [hovered, setHovered] = useState<string | null>(null)
  var [barMode, setBarMode] = useState<'count' | 'percent'>('count')
  var [barStack, setBarStack] = useState(false)
  var [smartAxes, setSmartAxes] = useState(true)
  var fields = schema.fields.filter(function(f) { return f.type !== 'ignore' && f.type !== 'id' })
  var hasData = analytics && analytics.totalRows > 0

  // Inject virtual "Themes" field if theme model exists
  var hasThemes = themeModel && themeModel.themes && themeModel.themes.length > 0
  var allFields = hasThemes
    ? fields.concat([{ field: '__themes__', type: 'categorical', label: 'Themes (from TextMine)' }])
    : fields

  // Build theme counts for the virtual field
  var enrichedAnalytics = analytics
  if (hasThemes && analytics) {
    var themeCounts: Record<string, number> = {}
    themeModel.themes.forEach(function(t: any) { themeCounts[t.name] = t.count || 0 })
    enrichedAnalytics = Object.assign({}, analytics, {
      fieldSummaries: Object.assign({}, analytics.fieldSummaries, {
        __themes__: { type: 'categorical', nonNull: analytics.totalRows, counts: themeCounts, topN: Object.keys(themeCounts) }
      })
    })
  }

  // Chart config state — cached per chart type
  var [chartConfigs, setChartConfigs] = useState<Record<string, Record<string, string>>>({})
  var [activeSlot, setActiveSlot] = useState<string | null>(null)

  // Initialize default configs
  useEffect(function() {
    var catFields = fields.filter(function(f) { return f.type === 'categorical' })
    var numFields = fields.filter(function(f) { return f.type === 'numeric' })
    var dateFields = fields.filter(function(f) { return f.type === 'date' })
    var defaults: Record<string, Record<string, string>> = {
      bar: { category: catFields[0]?.field || '' },
      distribution: { field: numFields[0]?.field || '' },
      scatter: { x: numFields[0]?.field || '', y: numFields[1]?.field || '' },
      crosstab: { rows: catFields[0]?.field || '', cols: catFields[1]?.field || catFields[0]?.field || '' },
      timeseries: { date: dateFields[0]?.field || '', metric: '' },
      treemap: { category: catFields[0]?.field || '' },
      bubbles: { category: catFields[0]?.field || '' },
      waterfall: { category: catFields[0]?.field || '' },
      bullet: { field: numFields[0]?.field || '' },
      funnel: { category: catFields[0]?.field || '' },
      gantt: { category: catFields[0]?.field || '', range: numFields[0]?.field || '' },
      driver: { score: numFields[0]?.field || '' },
    }
    setChartConfigs(function(prev) {
      var merged: Record<string, Record<string, string>> = {}
      Object.keys(defaults).forEach(function(k) { merged[k] = prev[k] || defaults[k] })
      return merged
    })
  }, [schema])

  var currentConfig = chartConfigs[activeChart] || {}
  var currentSlots = CHART_SLOTS[activeChart] || []

  var assignField = function(fieldName: string) {
    if (!activeSlot) return
    setChartConfigs(function(prev) {
      var updated = Object.assign({}, prev)
      var cfg = Object.assign({}, updated[activeChart] || {})
      cfg[activeSlot] = fieldName
      updated[activeChart] = cfg
      return updated
    })
    // Auto-advance to next empty slot
    var nextEmpty = currentSlots.find(function(s) { return s.key !== activeSlot && !currentConfig[s.key] })
    setActiveSlot(nextEmpty ? nextEmpty.key : null)
  }

  var clearSlot = function(slotKey: string) {
    setChartConfigs(function(prev) {
      var updated = Object.assign({}, prev)
      var cfg = Object.assign({}, updated[activeChart] || {})
      cfg[slotKey] = ''
      updated[activeChart] = cfg
      return updated
    })
  }

  // Saved charts
  var [savedCharts, setSavedCharts] = useState<SavedChart[]>([])
  var [savedExpanded, setSavedExpanded] = useState(true)
  var [showManage, setShowManage] = useState(false)
  var [saveName, setSaveName] = useState('')
  var [showSavePrompt, setShowSavePrompt] = useState(false)

  useEffect(function() {
    fetch('/api/datasets/' + datasetId + '/state')
      .then(function(r) { return r.ok ? r.json() : {} as any })
      .then(function(d) { if (d.saved_charts && Array.isArray(d.saved_charts)) setSavedCharts(d.saved_charts) })
      .catch(function() {})
  }, [datasetId])

  var persistSavedCharts = function(charts: SavedChart[]) {
    setSavedCharts(charts)
    fetch('/api/datasets/' + datasetId + '/state', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ saved_charts: charts }) }).catch(function() {})
  }

  var handleSaveChart = function() {
    if (!saveName.trim()) return
    var chart: SavedChart = { id: 'sc_' + Date.now(), name: saveName.trim(), chartType: activeChart, config: Object.assign({}, currentConfig), createdAt: new Date().toISOString() }
    persistSavedCharts(savedCharts.concat([chart]))
    setSaveName(''); setShowSavePrompt(false)
  }

  var handleLoadSaved = function(sc: SavedChart) {
    setActiveChart(sc.chartType)
    if (sc.config) setChartConfigs(function(prev) { var u = Object.assign({}, prev); u[sc.chartType] = Object.assign({}, sc.config); return u })
  }

  // Field type groups
  var catFields = allFields.filter(function(f) { return f.type === 'categorical' })
  var numFields = allFields.filter(function(f) { return f.type === 'numeric' })
  var dateFields = allFields.filter(function(f) { return f.type === 'date' })
  var openFields = allFields.filter(function(f) { return f.type === 'open-ended' })

  // Which field types the current slot accepts
  var slotAccepts = function(fieldType: string): boolean {
    if (!activeSlot) return false
    var slotDef = currentSlots.find(function(s) { return s.key === activeSlot })
    if (!slotDef) return false
    return slotDef.accepts.includes(fieldType) || slotDef.accepts.includes('any')
  }

  // Auto-select first slot when chart changes
  useEffect(function() {
    var slots = CHART_SLOTS[activeChart] || []
    if (slots.length) setActiveSlot(slots[0].key)
    else setActiveSlot(null)
  }, [activeChart])

  // Download PNG
  var chartBodyRef = useRef<HTMLDivElement>(null)
  var downloadPNG = function() {
    if (!chartBodyRef.current) return
    var plotDiv = chartBodyRef.current.querySelector('.js-plotly-plot') as HTMLElement
    if (plotDiv) {
      getPlotly().then(function(Plotly) {
        Plotly.downloadImage(plotDiv, { format: 'png', width: 1200, height: 700, filename: activeChart + '_chart' })
      })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: T.bg }}>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>

        {/* ─── Left sidebar: Fields ─────────────────────────── */}
        <div style={{ width: 200, flexShrink: 0, borderRight: '1px solid ' + T.border, background: T.bgCard, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>

          {/* Saved Charts */}
          {savedCharts.length > 0 && (
            <div style={{ borderBottom: '1px solid ' + T.border }}>
              <button onClick={function() { setSavedExpanded(function(v) { return !v }) }}
                style={{ width: '100%', padding: '10px 14px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.08em' }}>{savedExpanded ? '\u2212' : '+'} Saved</span>
                <span style={{ fontSize: 10, color: T.textFaint }}>{savedCharts.length}</span>
              </button>
              {savedExpanded && (
                <div style={{ padding: '0 8px 8px', maxHeight: 198, overflowY: 'auto' }}>
                  {savedCharts.map(function(sc) {
                    var ct = CHART_TYPE_DEFS.find(function(c) { return c.id === sc.chartType })
                    return (
                      <div key={sc.id} style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 2 }}>
                        <button onClick={function() { handleLoadSaved(sc) }}
                          style={{ flex: 1, textAlign: 'left', padding: '6px 8px', border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <span style={{ fontSize: 12 }}>{ct ? ct.icon : '\u25A0'}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: T.textMid, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sc.name}</span>
                        </button>
                        <button onClick={function(e) { e.stopPropagation(); if (confirm('Delete "' + sc.name + '"?')) persistSavedCharts(savedCharts.filter(function(c) { return c.id !== sc.id })) }}
                          style={{ padding: '2px 5px', fontSize: 11, color: T.textFaint, background: 'transparent', border: 'none', cursor: 'pointer', flexShrink: 0 }}
                          onMouseEnter={function(e) { (e.currentTarget as HTMLElement).style.color = '#dc2626' }}
                          onMouseLeave={function(e) { (e.currentTarget as HTMLElement).style.color = T.textFaint }}>{'\u2715'}</button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Field groups — click to assign */}
          {[
            { label: 'Categorical', type: 'categorical', list: catFields, color: '#7c3aed', icon: '\u2261' },
            { label: 'Numeric', type: 'numeric', list: numFields, color: '#16a34a', icon: '#' },
            { label: 'Date', type: 'date', list: dateFields, color: '#d97706', icon: '\uD83D\uDCC5' },
            { label: 'Open-ended', type: 'open-ended', list: openFields, color: '#2563eb', icon: '\u2756' },
          ].filter(function(g) { return g.list.length > 0 }).map(function(group) {
            var canAccept = slotAccepts(group.type)
            return (
              <div key={group.type} style={{ padding: '10px 12px', borderBottom: '1px solid ' + T.border, opacity: activeSlot ? (canAccept ? 1 : 0.35) : 1, transition: 'opacity .15s' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: group.color, letterSpacing: '.07em', textTransform: 'uppercase', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>{group.icon}</span> {group.label}
                </div>
                {group.list.map(function(f) {
                  var isAssigned = Object.values(currentConfig).includes(f.field)
                  return (
                    <div key={f.field}
                      onClick={function() { if (canAccept || !activeSlot) assignField(f.field) }}
                      style={{ fontSize: 11, padding: '4px 8px', borderRadius: 5, color: isAssigned ? T.accent : (canAccept || !activeSlot ? T.textMid : T.textFaint), fontWeight: isAssigned ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 1, cursor: canAccept ? 'pointer' : 'default', background: isAssigned ? T.accentBg : 'transparent', transition: 'all .1s' }}
                      title={fl(f)}>
                      {isAssigned && '\u2713 '}{fl(f)}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* ─── Chart body ──────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {/* Drop zones */}
          {currentSlots.length > 0 && (
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              {currentSlots.map(function(slot) {
                return <DropZone key={slot.key} slot={slot} value={currentConfig[slot.key] || ''} schema={allFields} activeSlot={activeSlot} onActivate={function() { setActiveSlot(slot.key) }} onClear={function() { clearSlot(slot.key) }} />
              })}
            </div>
          )}

          {/* Smart Axes toggle — visible when any categorical slot is filled */}
          {hasData && currentSlots.some(function(s) { return s.accepts.includes('categorical') && currentConfig[s.key] }) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: smartAxes ? T.accent : T.textMute, cursor: 'pointer' }}>
                <input type="checkbox" checked={smartAxes} onChange={function() { setSmartAxes(function(v) { return !v }) }} style={{ accentColor: T.accent }} />
                Smart Axes
              </label>
              {smartAxes && (function() {
                var catSlot = currentSlots.find(function(s) { return s.accepts.includes('categorical') && currentConfig[s.key] })
                if (!catSlot) return null
                var fieldName = currentConfig[catSlot.key]
                var fieldObj = allFields.find(function(f) { return f.field === fieldName })
                var vals = fieldObj && fieldObj.values ? fieldObj.values : []
                if (!vals.length) return null
                var dir = scaleDirectionLabel(vals)
                if (!dir) return null
                return <span style={{ fontSize: 10, color: T.textFaint, fontStyle: 'italic' }}>{dir}</span>
              })()}
            </div>
          )}

          {/* Bar chart options */}
          {activeChart === 'bar' && hasData && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'inline-flex', background: T.bg, borderRadius: 8, padding: 2, border: '1px solid ' + T.border }}>
                <button onClick={function() { setBarMode('count') }} style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6, background: barMode === 'count' ? T.bgCard : 'transparent', color: barMode === 'count' ? T.accent : T.textMute, border: 'none', cursor: 'pointer', boxShadow: barMode === 'count' ? '0 1px 4px rgba(0,0,0,.08)' : 'none' }}>Count</button>
                <button onClick={function() { setBarMode('percent') }} style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6, background: barMode === 'percent' ? T.bgCard : 'transparent', color: barMode === 'percent' ? T.accent : T.textMute, border: 'none', cursor: 'pointer', boxShadow: barMode === 'percent' ? '0 1px 4px rgba(0,0,0,.08)' : 'none' }}>Percentage</button>
              </div>
              {currentConfig.colorBy && (
                <div style={{ display: 'inline-flex', background: T.bg, borderRadius: 8, padding: 2, border: '1px solid ' + T.border }}>
                  <button onClick={function() { setBarStack(false) }} style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6, background: !barStack ? T.bgCard : 'transparent', color: !barStack ? T.accent : T.textMute, border: 'none', cursor: 'pointer', boxShadow: !barStack ? '0 1px 4px rgba(0,0,0,.08)' : 'none' }}>Grouped</button>
                  <button onClick={function() { setBarStack(true) }} style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6, background: barStack ? T.bgCard : 'transparent', color: barStack ? T.accent : T.textMute, border: 'none', cursor: 'pointer', boxShadow: barStack ? '0 1px 4px rgba(0,0,0,.08)' : 'none' }}>Stacked</button>
                </div>
              )}
            </div>
          )}

          {/* Action bar */}
          {hasData && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
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
                <>
                  <button onClick={function() { setShowSavePrompt(true) }}
                    style={{ padding: '5px 14px', fontSize: 11, fontWeight: 600, background: T.bg, border: '1px solid ' + T.border, borderRadius: 20, color: T.textMid, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                    {'\u2605'} Save
                  </button>
                  <button onClick={downloadPNG}
                    style={{ padding: '5px 14px', fontSize: 11, fontWeight: 600, background: T.bg, border: '1px solid ' + T.border, borderRadius: 20, color: T.textMid, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                    {'\u2B07'} PNG
                  </button>
                </>
              )}
            </div>
          )}

          {/* Chart render area */}
          <div ref={chartBodyRef}>
            {!hasData && <EmptyChart msg="No data loaded." />}
            {hasData && renderChart(activeChart, currentConfig, enrichedAnalytics!, allFields, datasetId, { barMode: barMode, barStack: barStack, smartAxes: smartAxes })}
          </div>
        </div>

        {/* ─── Right sidebar: Chart types ──────────────────── */}
        <div style={{ width: 200, flexShrink: 0, borderLeft: '1px solid ' + T.border, background: T.bgCard, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
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
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Manage Modal */}
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
              {savedCharts.map(function(sc) {
                var ct = CHART_TYPE_DEFS.find(function(c) { return c.id === sc.chartType })
                return (
                  <div key={sc.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid ' + T.border }}>
                    <span style={{ fontSize: 16 }}>{ct ? ct.icon : '\u25A0'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{sc.name}</div>
                      <div style={{ fontSize: 10, color: T.textFaint }}>{ct ? ct.label : sc.chartType}</div>
                    </div>
                    <button onClick={function() { persistSavedCharts(savedCharts.filter(function(c) { return c.id !== sc.id })) }}
                      style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, background: T.redBg, color: T.red, border: '1px solid ' + T.red + '30', borderRadius: 6, cursor: 'pointer' }}>Delete</button>
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
