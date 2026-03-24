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

var COLOR_PALETTES: Record<string, { name: string; colors: string[] }> = {
  hermes:  { name: 'Hermes',  colors: ['#e8622a','#2563eb','#16a34a','#7c3aed','#ea580c','#a21caf','#0d9488','#ca8a04','#db2777','#0891b2'] },
  ocean:   { name: 'Ocean',   colors: ['#0077b6','#00b4d8','#90e0ef','#023e8a','#48cae4','#0096c7','#caf0f8','#ade8f4','#0077b6','#03045e'] },
  sunset:  { name: 'Sunset',  colors: ['#ff6b6b','#feca57','#ff9ff3','#54a0ff','#5f27cd','#01a3a4','#ee5a24','#009432','#6d214f','#0c2461'] },
  earth:   { name: 'Earth',   colors: ['#606c38','#283618','#dda15e','#bc6c25','#fefae0','#936639','#9b2226','#bb3e03','#005f73','#0a9396'] },
  pastel:  { name: 'Pastel',  colors: ['#a8dadc','#f4a261','#e76f51','#457b9d','#264653','#2a9d8f','#e9c46a','#606c38','#bc6c25','#9b2226'] },
  vivid:   { name: 'Vivid',   colors: ['#ef476f','#ffd166','#06d6a0','#118ab2','#073b4c','#8338ec','#ff006e','#3a86ff','#fb5607','#ffbe0b'] },
  mono:    { name: 'Mono',    colors: ['#111827','#374151','#4b5563','#6b7280','#9ca3af','#d1d5db','#e5e7eb','#f3f4f6','#1f2937','#030712'] },
}

interface SchemaField { field: string; type: string; label?: string; values?: string[]; min?: number; max?: number; remapping?: Record<string, number>; scoreField?: boolean; sqt?: string }
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
  distribution: [{ key: 'field', label: 'Numeric Field', accepts: ['numeric'], required: true }, { key: 'splitBy', label: 'Split by', accepts: ['categorical'], required: false }],
  scatter:      [{ key: 'x', label: 'X Axis', accepts: ['numeric'], required: true }, { key: 'y', label: 'Y Axis', accepts: ['numeric'], required: true }, { key: 'colorBy', label: 'Color by', accepts: ['categorical'], required: false }],
  crosstab:     [{ key: 'rows', label: 'Row Variable', accepts: ['categorical'], required: true }, { key: 'cols', label: 'Column Variable', accepts: ['categorical'], required: true }],
  timeseries:   [{ key: 'date', label: 'Date Field', accepts: ['date'], required: true }, { key: 'metric', label: 'Metric', accepts: ['numeric'], required: false }],
  treemap:      [{ key: 'category', label: 'Category', accepts: ['categorical'], required: true }, { key: 'size', label: 'Size (optional)', accepts: ['numeric'], required: false }],
  bubbles:      [{ key: 'category', label: 'Category', accepts: ['categorical'], required: true }, { key: 'size', label: 'Size (optional)', accepts: ['numeric'], required: false }],
  waterfall:    [{ key: 'category', label: 'Category', accepts: ['categorical'], required: true }],
  bullet:       [{ key: 'field', label: 'Measure', accepts: ['numeric'], required: true }, { key: 'splitBy', label: 'Split by', accepts: ['categorical'], required: false }],
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

function ChartSelect({ label, value, onChange, options, required }: {
  label: string; value: string; onChange: (v: string) => void
  options: { v: string; l: string }[]; required?: boolean
}) {
  return (
    <div style={{ minWidth: 140 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: T.textFaint, letterSpacing: '.07em', textTransform: 'uppercase', marginBottom: 4 }}>
        {label}{!required && ' (optional)'}
      </div>
      <select value={value || ''} onChange={function(e) { onChange(e.target.value) }}
        style={{ width: '100%', padding: '7px 10px', fontSize: 13, border: '1px solid ' + T.border, borderRadius: 7, background: T.bgCard, color: value ? T.text : T.textMute, outline: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
        {!required && <option value="">None</option>}
        {required && !value && <option value="">Select...</option>}
        {options.map(function(o) { return <option key={o.v} value={o.v}>{o.l}</option> })}
      </select>
    </div>
  )
}

// ─── Chart Renderers (receive field values as params) ─────────────────────

function renderChart(chartType: string, config: Record<string, string>, analytics: Analytics, schema: SchemaField[], datasetId: string, opts?: { barMode?: string; barStack?: boolean; smartAxes?: boolean; colors?: string[]; orient?: string }): React.ReactNode {
  var fs = analytics.fieldSummaries
  var useSmartOrder = opts?.smartAxes !== false
  var pal = opts?.colors || CHART_COLORS
  var primaryColor = pal[0] || '#e8622a'

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
    var catLabel = flByName(catField, schema)
    var yTitle = opts?.barMode === 'percent' ? '% of ' + catLabel : 'Count'
    var isH = opts?.orient === 'h'

    // Stacked/grouped with colorBy
    var colorByField = config.colorBy
    if (colorByField && fs[colorByField] && fs[colorByField].counts) {
      return <BarStackedInner analytics={analytics} schema={schema} datasetId={datasetId} catField={catField} colorByField={colorByField} barMode={opts?.barMode || 'count'} barStack={opts?.barStack || false} smartAxes={useSmartOrder} colors={pal} orient={opts?.orient || 'v'} />
    }

    var trace: any = { type: 'bar', marker: { color: primaryColor }, text: displayVals.map(function(v) { return String(opts?.barMode === 'percent' ? v + '%' : v) }), textposition: 'outside', textfont: { size: 11 }, hovertemplate: '%{' + (isH ? 'x' : 'y') + '}<extra>%{' + (isH ? 'y' : 'x') + '}</extra>' }
    if (isH) { trace.y = cats; trace.x = displayVals; trace.orientation = 'h' }
    else { trace.x = cats; trace.y = displayVals }

    return <PlotlyChart traces={[trace]} layout={{ xaxis: { title: isH ? yTitle : catLabel, tickangle: !isH && cats.length > 8 ? -35 : 0 }, yaxis: { title: isH ? catLabel : yTitle } }} />
  }

  if (chartType === 'distribution') {
    var field = config.field; if (!field) return <EmptyChart msg="Assign a numeric field above." />
    var splitByField = config.splitBy
    if (splitByField) {
      return <DistSplitInner analytics={analytics} schema={schema} datasetId={datasetId} numField={field} splitByField={splitByField} colors={pal} />
    }
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
    return <PlotlyChart traces={[{ type: 'treemap', labels: labels, values: values, parents: parents, marker: { colors: labels.map(function(_, i) { return pal[i % pal.length] }) }, branchvalues: 'remainder' as const, textinfo: 'label+value' }]} layout={{ margin: { t: 8, r: 8, b: 8, l: 8 } }} />
  }

  if (chartType === 'bubbles') {
    var catF3 = config.category; if (!catF3) return <EmptyChart msg="Assign a category field above." />
    var s3 = fs[catF3]; if (!s3 || !s3.counts) return <EmptyChart msg="No data." />
    var e3 = Object.entries(s3.counts).sort(function(a, b) { return b[1] - a[1] }).slice(0, 20)
    return <PlotlyChart traces={[{ x: e3.map(function(e, i) { return (i % 5) * 2 }), y: e3.map(function(e, i) { return Math.floor(i / 5) * 2 }), mode: 'markers+text', marker: { size: e3.map(function(e) { return Math.max(20, Math.sqrt(e[1]) * 4) }), color: e3.map(function(_, i) { return pal[i % pal.length] }), opacity: 0.8 }, text: e3.map(function(e) { return e[0] + '\n' + e[1] }), textposition: 'center', textfont: { size: 10 } }]} layout={{ showlegend: false, xaxis: { visible: false }, yaxis: { visible: false }, margin: { t: 8, r: 8, b: 8, l: 8 } }} />
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
    return <PlotlyChart traces={[{ type: 'waterfall', x: wLabels, y: wValues, measure: measures, connector: { line: { color: T.borderMid } }, increasing: { marker: { color: T.green } }, decreasing: { marker: { color: T.red } }, totals: { marker: { color: primaryColor } } }]} layout={{ margin: { t: 12, r: 16, b: 48, l: 56 }, showlegend: false }} />
  }

  if (chartType === 'bullet') {
    var bField = config.field; if (!bField) return <EmptyChart msg="Assign a measure field above." />
    var splitByField = config.splitBy || ''
    if (splitByField) {
      return <BulletSplitInner analytics={analytics} schema={schema} datasetId={datasetId} measureField={bField} splitByField={splitByField} />
    }
    var bs = fs[bField]; if (!bs || bs.avg == null) return <EmptyChart msg="No numeric data." />
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16, maxWidth: 320, margin: '0 auto' }}>
        <GaugeCard label={flByName(bField, schema)} avg={bs.avg || 0} median={bs.median || bs.avg || 0} min={bs.min || 0} max={bs.max || 100} n={bs.nonNull || 0} overallAvg={null} />
      </div>
    )
  }

  if (chartType === 'funnel') {
    var catF5 = config.category; if (!catF5) return <EmptyChart msg="Assign a category field above." />
    var s5 = fs[catF5]; if (!s5 || !s5.counts) return <EmptyChart msg="No data." />
    var e5 = (function() { var raw = Object.entries(s5.counts); var keys = useSmartOrder ? smartOrder(raw.map(function(e) { return e[0] })) : raw.sort(function(a, b) { return b[1] - a[1] }).map(function(e) { return e[0] }); return keys.slice(0, 12).map(function(k) { return [k, s5.counts![k] || 0] as [string, number] }) })()
    return <PlotlyChart traces={[{ type: 'funnel', y: e5.map(function(e) { return e[0] }), x: e5.map(function(e) { return e[1] }), marker: { color: e5.map(function(_, i) { return pal[i % pal.length] }) } }]} layout={{ margin: { t: 8, r: 16, b: 8, l: 120 }, showlegend: false }} />
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

// Module-level enrichment context — set by ChartsModule, read by useRows
var _enrichCtx: { themeModel?: any; schema?: SchemaConfig } = {}

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
          if (page >= (data.totalPages || 0) - 1 || (data.rows || []).length < PAGE_SIZE) {
            var enriched = enrichRows(allRows, _enrichCtx.themeModel, _enrichCtx.schema)
            setRows(enriched); setLoaded(true); setLoading(false)
          }
          else { page++; fetchPage() }
        }).catch(function() { setLoading(false) })
    }
    fetchPage()
  }, [datasetId])
  return { rows: rows, loaded: loaded, loading: loading }
}

function enrichRows(rows: Record<string, unknown>[], themeModel?: any, schema?: SchemaConfig): Record<string, unknown>[] {
  if (!rows.length) return rows
  var hasThemes = themeModel && themeModel.themes && themeModel.themes.length > 0
  var mappedFields = (schema?.fields || []).filter(function(f) { return f.type === 'categorical' && f.remapping && Object.keys(f.remapping).length > 0 })
  if (!hasThemes && !mappedFields.length) return rows

  // Build theme lookup
  var themes = hasThemes ? themeModel.themes : []
  var openField = hasThemes ? (themeModel.fieldName || (schema?.fields || []).find(function(f) { return f.type === 'open-ended' })?.field || '') : ''

  return rows.map(function(row) {
    var enriched = Object.assign({}, row)

    // Inject __themes__ — primary matching theme
    if (hasThemes && openField) {
      var text = String(row[openField] || '').toLowerCase()
      if (!text.trim()) {
        enriched['__themes__'] = ''
      } else {
        var bestTheme = '', bestCount = 0
        themes.forEach(function(t: any) {
          var hits = 0
          ;(t.keywords || []).forEach(function(kw: string) {
            if (text.includes(kw.toLowerCase())) hits++
          })
          if (hits > bestCount) { bestCount = hits; bestTheme = t.name }
        })
        enriched['__themes__'] = bestTheme || 'Unclassified'
      }
    }

    // Inject __mapped_FieldName__ — numeric value from categorical remapping
    mappedFields.forEach(function(f) {
      var catVal = String(row[f.field] || '')
      var numVal = f.remapping![catVal]
      enriched['__mapped_' + f.field + '__'] = numVal != null ? numVal : null
    })

    return enriched
  })
}

function BarStackedInner({ analytics, schema, datasetId, catField, colorByField, barMode, barStack, smartAxes, colors, orient }: { analytics: Analytics; schema: SchemaField[]; datasetId: string; catField: string; colorByField: string; barMode: string; barStack: boolean; smartAxes?: boolean; colors?: string[]; orient?: string }) {
  var { rows, loaded } = useRows(datasetId)
  if (!loaded) return <div style={{ textAlign: 'center', padding: 40, color: T.textMute, fontSize: 13 }}>Loading data...</div>
  var pal = colors || CHART_COLORS

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

  // Smart axes ordering
  var cats = Object.keys(grid)
  if (smartAxes) {
    var fieldObj = schema.find(function(f) { return f.field === catField })
    var orderedVals = fieldObj?.values
    if (fieldObj?.remapping) {
      var remap = fieldObj.remapping
      orderedVals = Object.keys(remap).sort(function(a, b) { return (remap[a] || 0) - (remap[b] || 0) })
    }
    if (orderedVals && orderedVals.length > 0) {
      cats = orderedVals.filter(function(v) { return grid[v] })
      var extras = Object.keys(grid).filter(function(v) { return !orderedVals!.includes(v) }).sort()
      cats = cats.concat(extras)
    } else {
      cats.sort(function(a, b) { var ta = Object.values(grid[b]).reduce(function(s, v) { return s + v }, 0); var tb = Object.values(grid[a]).reduce(function(s, v) { return s + v }, 0); return ta - tb })
    }
  } else {
    cats.sort(function(a, b) { var ta = Object.values(grid[b]).reduce(function(s, v) { return s + v }, 0); var tb = Object.values(grid[a]).reduce(function(s, v) { return s + v }, 0); return ta - tb })
  }
  cats = cats.slice(0, 30)
  var colorArr = Array.from(colorVals).sort()

  var isH = orient === 'h'
  var traces = colorArr.map(function(col, i) {
    var ys = cats.map(function(cat) { return grid[cat] ? (grid[cat][col] || 0) : 0 })
    if (barMode === 'percent') {
      ys = cats.map(function(cat) {
        var total = Object.values(grid[cat] || {}).reduce(function(s, v) { return s + v }, 0)
        return total > 0 ? Math.round((grid[cat] ? (grid[cat][col] || 0) : 0) / total * 1000) / 10 : 0
      })
    }
    var trace: any = { type: 'bar', name: col, marker: { color: pal[i % pal.length] }, hovertemplate: '%{' + (isH ? 'x' : 'y') + '}<br>' + flByName(colorByField, schema) + ': ' + col + '<extra></extra>' }
    if (isH) { trace.y = cats; trace.x = ys; trace.orientation = 'h' }
    else { trace.x = cats; trace.y = ys }
    return trace
  })

  var catLabel = flByName(catField, schema)
  var valLabel = barMode === 'percent' ? '% of ' + catLabel : 'Count'
  return <PlotlyChart traces={traces} layout={{ barmode: barStack ? 'stack' : 'group', xaxis: { title: isH ? valLabel : catLabel, tickangle: !isH && cats.length > 8 ? -35 : 0 }, yaxis: { title: isH ? catLabel : valLabel }, legend: { orientation: 'h', y: -0.2, title: { text: flByName(colorByField, schema) } } }} />
}

// ─── Gauge Card (SVG arc gauge matching Ana.html style) ───────────────────

function GaugeCard({ label, avg, median, min, max, n, overallAvg }: { label: string; avg: number; median: number; min: number; max: number; n: number; overallAvg: number | null }) {
  var range = max - min || 1
  var pct = Math.max(0, Math.min(1, (avg - min) / range))
  var angle = -90 + pct * 180 // -90 to 90 degrees
  var r = 60, cx = 80, cy = 75
  var arcPath = function(startAngle: number, endAngle: number, radius: number) {
    var s = (startAngle - 90) * Math.PI / 180
    var e = (endAngle - 90) * Math.PI / 180
    var x1 = cx + radius * Math.cos(s), y1 = cy + radius * Math.sin(s)
    var x2 = cx + radius * Math.cos(e), y2 = cy + radius * Math.sin(e)
    var largeArc = endAngle - startAngle > 180 ? 1 : 0
    return 'M ' + x1 + ' ' + y1 + ' A ' + radius + ' ' + radius + ' 0 ' + largeArc + ' 1 ' + x2 + ' ' + y2
  }
  // Quartile ranges for color bands
  var p25 = min + range * 0.25, p50 = min + range * 0.5, p75 = min + range * 0.75
  var vsOverall = overallAvg != null ? avg - overallAvg : null
  var vsColor = vsOverall != null ? (vsOverall >= 0 ? '#16a34a' : '#dc2626') : T.textMid

  return (
    <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, padding: '16px 18px', textAlign: 'center' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 8 }}>{label}</div>
      <svg viewBox="0 0 160 100" style={{ width: '100%', maxWidth: 200, margin: '0 auto', display: 'block' }}>
        {/* Background bands: bottom 25% (pink), middle 50% (amber), top 25% (green) */}
        <path d={arcPath(-90, -45, r)} fill="none" stroke="#fecdd3" strokeWidth={14} strokeLinecap="round" />
        <path d={arcPath(-45, 45, r)} fill="none" stroke="#fed7aa" strokeWidth={14} strokeLinecap="round" />
        <path d={arcPath(45, 90, r)} fill="none" stroke="#bbf7d0" strokeWidth={14} strokeLinecap="round" />
        {/* Needle */}
        {(function() {
          var a = (angle - 90) * Math.PI / 180
          var nx = cx + (r - 20) * Math.cos(a), ny = cy + (r - 20) * Math.sin(a)
          return <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={T.accent} strokeWidth={2.5} strokeLinecap="round" />
        })()}
        {/* Center dot */}
        <circle cx={cx} cy={cy} r={4} fill={T.accent} />
        {/* Median marker */}
        {(function() {
          var mPct = Math.max(0, Math.min(1, (median - min) / range))
          var mAngle = (-90 + mPct * 180 - 90) * Math.PI / 180
          var mx = cx + (r + 2) * Math.cos(mAngle), my = cy + (r + 2) * Math.sin(mAngle)
          return <line x1={mx} y1={my} x2={mx + 0} y2={my - 6} stroke="#2563eb" strokeWidth={2} />
        })()}
        {/* Value */}
        <text x={cx} y={cy - 14} textAnchor="middle" style={{ fontSize: 28, fontWeight: 800, fill: T.text }}>{avg.toFixed(1)}</text>
        {/* Scale labels */}
        <text x={cx - r - 6} y={cy + 12} textAnchor="middle" style={{ fontSize: 8, fill: T.textFaint }}>{min.toFixed(1)}</text>
        <text x={cx + r + 6} y={cy + 12} textAnchor="middle" style={{ fontSize: 8, fill: T.textFaint }}>{max.toFixed(1)}</text>
      </svg>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, fontSize: 11, marginTop: 4 }}>
        <div><span style={{ color: T.textFaint }}>N</span> <strong style={{ color: T.text }}>{n.toLocaleString()}</strong></div>
        <div><span style={{ color: T.textFaint }}>MEDIAN</span> <strong style={{ color: '#2563eb' }}>{median.toFixed(1)}</strong></div>
        {vsOverall != null && <div><span style={{ color: T.textFaint }}>VS OVERALL</span> <strong style={{ color: vsColor }}>{(vsOverall >= 0 ? '+' : '') + vsOverall.toFixed(2)}</strong></div>}
      </div>
      <div style={{ fontSize: 10, color: T.textFaint, marginTop: 6 }}>
        RANGE <strong style={{ color: T.textMid }}>{min.toFixed(1)}–{max.toFixed(1)}</strong>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, fontSize: 8, color: T.textFaint, marginTop: 6 }}>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#fecdd3', marginRight: 2, verticalAlign: 'middle' }} />Bottom 25%</span>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#fed7aa', marginRight: 2, verticalAlign: 'middle' }} />Middle 50%</span>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#bbf7d0', marginRight: 2, verticalAlign: 'middle' }} />Top 25%</span>
      </div>
    </div>
  )
}

function DistSplitInner({ analytics, schema, datasetId, numField, splitByField, colors }: { analytics: Analytics; schema: SchemaField[]; datasetId: string; numField: string; splitByField: string; colors?: string[] }) {
  var { rows, loaded } = useRows(datasetId)
  if (!loaded) return <div style={{ textAlign: 'center', padding: 40, color: T.textMute, fontSize: 13 }}>Loading data...</div>
  var pal = colors || CHART_COLORS
  var groups: Record<string, number[]> = {}
  rows.forEach(function(r) {
    var grp = String(r[splitByField] || '').trim()
    var val = parseFloat(String(r[numField] || ''))
    if (!grp || isNaN(val)) return
    if (!groups[grp]) groups[grp] = []
    groups[grp].push(val)
  })
  var keys = Object.keys(groups).sort()
  if (!keys.length) return <EmptyChart msg="No data for this split." />
  var traces = keys.map(function(k, i) {
    return { type: 'box' as const, y: groups[k], name: k, marker: { color: pal[i % pal.length] }, boxpoints: 'outliers' as const }
  })
  return <PlotlyChart traces={traces} layout={{ yaxis: { title: flByName(numField, schema) }, legend: { orientation: 'h' as const, y: -0.2, title: { text: flByName(splitByField, schema) } } }} />
}

function BulletSplitInner({ analytics, schema, datasetId, measureField, splitByField }: { analytics: Analytics; schema: SchemaField[]; datasetId: string; measureField: string; splitByField: string }) {
  var { rows, loaded } = useRows(datasetId)
  if (!loaded) return <div style={{ textAlign: 'center', padding: 40, color: T.textMute, fontSize: 13 }}>Loading data...</div>

  var groups: Record<string, number[]> = {}
  rows.forEach(function(r) {
    var grp = String(r[splitByField] || '(blank)').trim()
    var val = parseFloat(String(r[measureField] || ''))
    if (!grp || isNaN(val)) return
    if (!groups[grp]) groups[grp] = []
    groups[grp].push(val)
  })

  var groupKeys = Object.keys(groups).sort()
  if (!groupKeys.length) return <EmptyChart msg="No data for this combination." />

  // Overall stats for vs comparison
  var allVals = Object.values(groups).flat()
  var overallAvg = allVals.length > 0 ? allVals.reduce(function(a, b) { return a + b }, 0) / allVals.length : null

  var stats = groupKeys.map(function(grp) {
    var vs = groups[grp].slice().sort(function(a, b) { return a - b })
    var avg = vs.reduce(function(a, b) { return a + b }, 0) / vs.length
    var med = vs[Math.floor(vs.length / 2)]
    return { label: grp, avg: avg, median: med, min: vs[0], max: vs[vs.length - 1], n: vs.length }
  })

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
      {stats.map(function(s) {
        return <GaugeCard key={s.label} label={s.label} avg={s.avg} median={s.median} min={stats.reduce(function(m, x) { return Math.min(m, x.min) }, Infinity)} max={stats.reduce(function(m, x) { return Math.max(m, x.max) }, -Infinity)} n={s.n} overallAvg={overallAvg} />
      })}
    </div>
  )
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
  var { rows: allRows, loaded } = useRows(datasetId)
  var [page, setPage] = useState(0)
  var PAGE = 50
  if (!loaded) return <div style={{ textAlign: 'center', padding: 40, color: T.textMute, fontSize: 13 }}>Loading data...</div>
  var total = allRows.length
  var rows = allRows.slice(page * PAGE, (page + 1) * PAGE)
  // Use allFields from enrichment context — includes __themes__ and __mapped__
  var virtualFields: SchemaField[] = []
  if (_enrichCtx.themeModel?.themes?.length) virtualFields.push({ field: '__themes__', type: 'categorical', label: 'Themes' })
  ;(_enrichCtx.schema?.fields || []).forEach(function(f) {
    if (f.type === 'categorical' && f.remapping && Object.keys(f.remapping).length > 0) {
      virtualFields.push({ field: '__mapped_' + f.field + '__', type: 'numeric', label: (f.label || f.field) + ' (mapped)' })
    }
  })
  var cols = schema.filter(function(f) { return f.type !== 'ignore' }).concat(virtualFields)
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr>{cols.map(function(f) { return <th key={f.field} style={{ padding: '8px 10px', textAlign: 'left', background: T.bg, borderBottom: '2px solid ' + T.border, fontSize: 11, fontWeight: 700, color: T.textMid, whiteSpace: 'nowrap' }}>{fl(f)}</th> })}</tr></thead>
        <tbody>{rows.map(function(r, i) { return <tr key={i}>{cols.map(function(f) { var val = r[f.field]; return <td key={f.field} style={{ padding: '6px 10px', borderBottom: '1px solid ' + T.border, color: T.textMid, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val != null ? String(val) : ''}</td> })}</tr> })}</tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', fontSize: 11, color: T.textMute }}>
        <span>{total.toLocaleString()} total rows</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={function() { setPage(function(p) { return Math.max(0, p - 1) }) }} disabled={page === 0} style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid ' + T.border, background: T.bgCard, cursor: page === 0 ? 'not-allowed' : 'pointer', color: T.textMid, fontSize: 11 }}>{'\u2190'} Prev</button>
          <span style={{ padding: '3px 8px' }}>Page {page + 1} of {Math.ceil(total / PAGE)}</span>
          <button onClick={function() { setPage(function(p) { return p + 1 }) }} disabled={(page + 1) * PAGE >= total} style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid ' + T.border, background: T.bgCard, cursor: (page + 1) * PAGE >= total ? 'not-allowed' : 'pointer', color: T.textMid, fontSize: 11 }}>Next {'\u2192'}</button>
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
  // Set enrichment context for useRows — must be before any inner component renders
  _enrichCtx = { themeModel: themeModel, schema: schema }

  var [activeChart, setActiveChart] = useState('bar')
  var [hovered, setHovered] = useState<string | null>(null)
  var [barMode, setBarMode] = useState<'count' | 'percent'>('count')
  var [barStack, setBarStack] = useState(false)
  var [barOrient, setBarOrient] = useState<'v' | 'h'>('v')
  var [smartAxes, setSmartAxes] = useState(true)
  var [activePalette, setActivePalette] = useState('hermes')
  var [showPalettePicker, setShowPalettePicker] = useState(false)
  var currentColors = COLOR_PALETTES[activePalette]?.colors || CHART_COLORS
  var fields = schema.fields.filter(function(f) { return f.type !== 'ignore' && f.type !== 'id' })
  var hasData = analytics && analytics.totalRows > 0

  // Inject virtual "Themes" field if theme model exists
  var hasThemes = themeModel && themeModel.themes && themeModel.themes.length > 0
  var allFields = hasThemes
    ? fields.concat([{ field: '__themes__', type: 'categorical', label: 'Themes' }])
    : fields

  // Inject virtual mapped numeric fields for categoricals with remapping
  var mappedFields = fields.filter(function(f) { return f.type === 'categorical' && f.remapping && Object.keys(f.remapping).length > 0 })
  mappedFields.forEach(function(f) {
    allFields = allFields.concat([{ field: '__mapped_' + f.field + '__', type: 'numeric', label: (f.label || f.field) + ' (mapped)' } as any])
  })

  // Build theme counts for the virtual field
  var enrichedAnalytics = analytics
  if (analytics) {
    var extraSummaries: Record<string, any> = {}
    if (hasThemes) {
      var themeCounts: Record<string, number> = {}
      themeModel.themes.forEach(function(t: any) { themeCounts[t.name] = t.count || 0 })
      extraSummaries['__themes__'] = { type: 'categorical', nonNull: analytics.totalRows, counts: themeCounts, topN: Object.keys(themeCounts) }
    }
    // Build summaries for mapped numeric fields from categorical counts + remapping
    mappedFields.forEach(function(f) {
      var catSummary = analytics.fieldSummaries[f.field]
      if (!catSummary || !catSummary.counts || !f.remapping) return
      var vals: number[] = []
      Object.entries(catSummary.counts).forEach(function(entry) {
        var numVal = f.remapping![entry[0]]
        if (numVal != null) { for (var i = 0; i < entry[1]; i++) vals.push(numVal) }
      })
      if (!vals.length) return
      vals.sort(function(a, b) { return a - b })
      var sum = vals.reduce(function(a, b) { return a + b }, 0)
      extraSummaries['__mapped_' + f.field + '__'] = {
        type: 'numeric', nonNull: vals.length,
        min: vals[0], max: vals[vals.length - 1],
        avg: sum / vals.length, median: vals[Math.floor(vals.length / 2)],
        stddev: Math.sqrt(vals.reduce(function(s, v) { return s + (v - sum / vals.length) * (v - sum / vals.length) }, 0) / vals.length)
      }
    })
    if (Object.keys(extraSummaries).length > 0) {
      enrichedAnalytics = Object.assign({}, analytics, {
        fieldSummaries: Object.assign({}, analytics.fieldSummaries, extraSummaries)
      })
    }
  }

  // Chart config state — cached per chart type
  var [chartConfigs, setChartConfigs] = useState<Record<string, Record<string, string>>>({})

  // Update a specific slot in a chart config
  var updateSlot = function(slotKey: string, value: string) {
    setChartConfigs(function(prev) {
      var u = Object.assign({}, prev)
      var cfg = Object.assign({}, u[activeChart] || {})
      cfg[slotKey] = value
      u[activeChart] = cfg
      return u
    })
  }

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
                <span style={{ fontSize: 10, fontWeight: 800, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.08em' }}>Saved Graphs</span>
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

          {/* Fields header */}
          <div style={{ padding: '10px 14px 4px' }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.08em' }}>Fields</div>
            <div style={{ fontSize: 10, color: T.textFaint, fontStyle: 'italic', marginTop: 2 }}>Fields available for this chart type</div>
          </div>

          {/* Field groups — reference only */}
          {[
            { label: 'Categorical', type: 'categorical', list: catFields, color: '#7c3aed', icon: '\u2261' },
            { label: 'Numeric', type: 'numeric', list: numFields, color: '#16a34a', icon: '#' },
            { label: 'Date', type: 'date', list: dateFields, color: '#d97706', icon: '\uD83D\uDCC5' },
            { label: 'Open-ended', type: 'open-ended', list: openFields, color: '#2563eb', icon: '\u2756' },
          ].filter(function(g) { return g.list.length > 0 }).map(function(group) {
            return (
              <div key={group.type} style={{ padding: '10px 12px', borderBottom: '1px solid ' + T.border }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: group.color, letterSpacing: '.07em', textTransform: 'uppercase', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>{group.icon}</span> {group.label}
                </div>
                {group.list.map(function(f) {
                  var isAssigned = Object.values(currentConfig).includes(f.field)
                  return (
                    <div key={f.field}
                      style={{ fontSize: 11, padding: '4px 8px', borderRadius: 5, color: isAssigned ? T.accent : T.textMid, fontWeight: isAssigned ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 1, background: isAssigned ? T.accentBg : 'transparent', transition: 'all .1s' }}
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
          {/* Inline field selectors — dropdowns per slot */}
          {currentSlots.length > 0 && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              {currentSlots.map(function(slot) {
                var opts = allFields.filter(function(f) {
                  return slot.accepts.includes(f.type) || slot.accepts.includes('any')
                }).map(function(f) { return { v: f.field, l: fl(f) } })
                return <ChartSelect key={slot.key} label={slot.label} value={currentConfig[slot.key] || ''} required={slot.required}
                  onChange={function(v) { setChartConfigs(function(prev) { var u = Object.assign({}, prev); var cfg = Object.assign({}, u[activeChart] || {}); cfg[slot.key] = v; u[activeChart] = cfg; return u }) }}
                  options={opts} />
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
              <div style={{ display: 'inline-flex', background: T.bg, borderRadius: 8, padding: 2, border: '1px solid ' + T.border }}>
                <button onClick={function() { setBarOrient('v') }} style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6, background: barOrient === 'v' ? T.bgCard : 'transparent', color: barOrient === 'v' ? T.accent : T.textMute, border: 'none', cursor: 'pointer', boxShadow: barOrient === 'v' ? '0 1px 4px rgba(0,0,0,.08)' : 'none' }}>Vertical</button>
                <button onClick={function() { setBarOrient('h') }} style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6, background: barOrient === 'h' ? T.bgCard : 'transparent', color: barOrient === 'h' ? T.accent : T.textMute, border: 'none', cursor: 'pointer', boxShadow: barOrient === 'h' ? '0 1px 4px rgba(0,0,0,.08)' : 'none' }}>Horizontal</button>
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
                  <div style={{ position: 'relative' }}>
                    <button onClick={function() { setShowPalettePicker(function(v) { return !v }) }}
                      style={{ padding: '5px 14px', fontSize: 11, fontWeight: 600, background: T.bg, border: '1px solid ' + T.border, borderRadius: 20, color: T.textMid, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                      {'\uD83C\uDFA8'} Colors
                    </button>
                    {showPalettePicker && (
                      <div style={{ position: 'absolute', top: 32, right: 0, background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 30, padding: '12px', width: 220 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>Color Palette</div>
                        {Object.entries(COLOR_PALETTES).map(function(entry) {
                          var key = entry[0], p = entry[1]
                          var isActive = activePalette === key
                          return (
                            <button key={key} onClick={function() { setActivePalette(key); setShowPalettePicker(false) }}
                              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, background: isActive ? T.accentBg : 'transparent', border: isActive ? '1.5px solid ' + T.accent : '1.5px solid transparent', cursor: 'pointer', marginBottom: 4 }}>
                              <span style={{ fontSize: 11, fontWeight: isActive ? 700 : 500, color: isActive ? T.accent : T.textMid, width: 50, textAlign: 'left' }}>{p.name}</span>
                              <div style={{ display: 'flex', gap: 2 }}>
                                {p.colors.slice(0, 6).map(function(c, i) {
                                  return <span key={i} style={{ width: 14, height: 14, borderRadius: 3, background: c, display: 'inline-block', border: '1px solid rgba(0,0,0,.1)' }} />
                                })}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}
                    {showPalettePicker && <div style={{ position: 'fixed', inset: 0, zIndex: 29 }} onClick={function() { setShowPalettePicker(false) }} />}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Chart render area */}
          <div ref={chartBodyRef}>
            {!hasData && <EmptyChart msg="No data loaded." />}
            {hasData && renderChart(activeChart, currentConfig, enrichedAnalytics!, allFields, datasetId, { barMode: barMode, barStack: barStack, smartAxes: smartAxes, colors: currentColors, orient: barOrient })}
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
