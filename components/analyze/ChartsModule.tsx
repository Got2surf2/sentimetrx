'use client'
// components/analyze/ChartsModule.tsx
// Charts module with labeled drop zones, click-to-assign from sidebar, chart state caching.

import { useState, useEffect, useRef } from 'react'
import { smartOrder, isOrdinalScale, scaleDirectionLabel } from '@/lib/scaleUtils'
import { resolveAlias, aliasedCounts } from '@/lib/aliasUtils'
import { readSession, writeSession } from '@/lib/useSessionState'
import { TimeBucket, BUCKET_OPTIONS, autoBucket, bucketKey } from '@/lib/timeBucket'
import LottieLoader from '@/components/ui/LottieLoader'
import { injectSignalTier } from '@/lib/signalTier'
import { useRows } from '@/components/analyze/RowsContext'
import { useFilters } from '@/components/analyze/FilterContext'
import { applyFilters } from '@/lib/filterUtils'
import type { SchemaFieldConfig as SchemaField, SchemaConfig } from '@/lib/analyzeTypes'

// Dynamic Plotly import
var PlotlyRef: any = null
function getPlotly(): Promise<any> {
  if (PlotlyRef) return Promise.resolve(PlotlyRef)
  return import('plotly.js-dist-min').then(function(m) { PlotlyRef = m.default || m; return PlotlyRef })
}

import { T } from '@/lib/analyzeTheme'

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

// SchemaField, SchemaConfig imported from @/lib/analyzeTypes
interface FieldSummary { type: string; nonNull: number; counts?: Record<string, number>; topN?: string[]; histogram?: { min: number; max: number; count: number }[]; min?: number; max?: number; avg?: number; median?: number; stddev?: number; avgWordCount?: number; sample?: string[] }
interface Analytics { totalRows: number; computedAt: string; fieldSummaries: Record<string, FieldSummary> }
interface Props { datasetId: string; schema: SchemaConfig; analytics: Analytics | null; themeModel?: any; datasetSource?: string }

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
  timeseries:   [{ key: 'date', label: 'Date Field', accepts: ['date'], required: true }, { key: 'metric', label: 'Metric', accepts: ['numeric'], required: false }, { key: 'colorBy', label: 'Break down by', accepts: ['categorical'], required: false }],
  treemap:      [{ key: 'category', label: 'Category', accepts: ['categorical'], required: true }, { key: 'size', label: 'Size (optional)', accepts: ['numeric'], required: false }],
  bubbles:      [{ key: 'category', label: 'Category', accepts: ['categorical'], required: true }, { key: 'size', label: 'Size (optional)', accepts: ['numeric'], required: false }],
  waterfall:    [{ key: 'category', label: 'Category', accepts: ['categorical'], required: true }],
  bullet:       [{ key: 'field', label: 'Measure', accepts: ['numeric'], required: true }, { key: 'splitBy', label: 'Split by', accepts: ['categorical'], required: false }],
  funnel:       [{ key: 'category', label: 'Category', accepts: ['categorical'], required: true }],
  gantt:        [{ key: 'category', label: 'Category', accepts: ['categorical'], required: true }, { key: 'range', label: 'Range Field', accepts: ['numeric', 'date'], required: true }],
  driver:       [{ key: 'score', label: 'Score Field', accepts: ['numeric'], required: true }, { key: 'groupBy', label: 'Group by', accepts: ['categorical'], required: false }],
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

// Returns true when a numeric axis represents small-range integer data (e.g. NPS 0-10, rating 1-5)
function isSmallIntRange(min?: number, max?: number): boolean {
  if (min == null || max == null) return false
  return Number.isInteger(min) && Number.isInteger(max) && (max - min) >= 0 && (max - min) <= 20
}

// Module-level drag tracker — stores what's being dragged so dragOver handlers can preview the target
var _chartDrag: { field: string; type: string; label: string } | null = null

// Find the best slot for a dropped field: prefers empty required > empty optional > replace required > replace any
function getSmartSlot(type: string, slots: SlotDef[], config: Record<string, string>): SlotDef | null {
  var match = function(s: SlotDef) { return s.accepts.includes(type) || s.accepts.includes('any') }
  return slots.find(function(s) { return s.required && !config[s.key] && match(s) })
      || slots.find(function(s) { return !config[s.key] && match(s) })
      || slots.find(function(s) { return s.required && match(s) })
      || slots.find(match)
      || null
}

// ── Collapsible sidebar field group (Charts) ──────────────────
function ChartCollapsibleGroup({ label, icon, color, fields, currentConfig }: {
  label: string; icon: string; color: string; fields: SchemaField[]; currentConfig: Record<string, string>
}) {
  var [open, setOpen] = useState(true)
  if (fields.length === 0) return null
  return (
    <div style={{ borderBottom: '1px solid ' + T.border }}>
      <button
        onClick={function() { setOpen(function(v) { return !v }) }}
        style={{ width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <div style={{ fontSize: 10, fontWeight: 700, color: color, letterSpacing: '.07em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>{icon}</span> {label}
        </div>
        <span style={{ fontSize: 10, color: '#9ca3af' }}>{open ? '\u25BE' : '\u25B8'} {fields.length}</span>
      </button>
      {open && (
        <div style={{ padding: '0 12px 8px' }}>
          {fields.map(function(f) {
            var isAssigned = Object.values(currentConfig).includes(f.field)
            return (
              <div key={f.field}
                draggable={true}
                onDragStart={function(e) {
                  _chartDrag = { field: f.field, type: f.type, label: fl(f) }
                  e.dataTransfer.setData('text/field', JSON.stringify({ field: f.field, type: f.type, label: fl(f), section: f.section || 'core' }))
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onDragEnd={function() { _chartDrag = null }}
                style={{ fontSize: 11, padding: '4px 8px', borderRadius: 5, color: isAssigned ? T.accent : T.textMid, fontWeight: isAssigned ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 1, background: isAssigned ? T.accentBg : 'transparent', transition: 'all .1s', cursor: 'grab', userSelect: 'none' }}
                title={fl(f)}>
                {isAssigned && '\u2713 '}{fl(f)}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ChartFieldGroups({ fields, currentConfig }: { fields: SchemaField[]; currentConfig: Record<string, string> }) {
  var psychoFields = fields.filter(function(f) { return f.section === 'psychographic' })
  var demoFields = fields.filter(function(f) { return f.section === 'demographic' })
  var customFields = fields.filter(function(f) { return f.section === 'custom' })
  var coreFields = fields.filter(function(f) { return !f.section || f.section === 'core' })

  var asc2 = function(a: any, b: any) { var la = a.label || a.field, lb = b.label || b.field; return la.localeCompare(lb) }
  var numFields  = coreFields.filter(function(f) { return f.type === 'numeric' }).sort(asc2)
  var catFields  = coreFields.filter(function(f) { return f.type === 'categorical' }).sort(asc2)
  var dateFields = coreFields.filter(function(f) { return f.type === 'date' }).sort(asc2)
  var openFields = coreFields.filter(function(f) { return f.type === 'open-ended' }).sort(asc2)

  return (
    <>
      <ChartCollapsibleGroup label="Numeric" icon="#" color="#16a34a" fields={numFields} currentConfig={currentConfig} />
      <ChartCollapsibleGroup label="Categorical" icon={'\u2261'} color="#7c3aed" fields={catFields} currentConfig={currentConfig} />
      <ChartCollapsibleGroup label="Open-ended" icon={'\u2756'} color="#2563eb" fields={openFields} currentConfig={currentConfig} />
      <ChartCollapsibleGroup label="Date" icon={'\uD83D\uDCC5'} color="#d97706" fields={dateFields} currentConfig={currentConfig} />
      <ChartCollapsibleGroup label="Survey Questions" icon={'\uD83D\uDCCB'} color="#f59e0b" fields={customFields} currentConfig={currentConfig} />
      <ChartCollapsibleGroup label="Psychographic" icon={'\uD83E\uDDE0'} color="#ec4899" fields={psychoFields} currentConfig={currentConfig} />
      <ChartCollapsibleGroup label="Demographic" icon={'\uD83D\uDC64'} color="#0891b2" fields={demoFields} currentConfig={currentConfig} />
    </>
  )
}
function flByName(name: string, schema: SchemaField[]): string { var f = schema.find(function(s) { return s.field === name }); return f ? fl(f) : name }

// Wraps long labels at word boundaries using <br> for Plotly tick labels.
// targetWidth is the max characters per line before wrapping.
function wrapLabel(label: string, targetWidth: number): string {
  if (label.length <= targetWidth) return label
  var words = label.split(/\s+/)
  var lines: string[] = []
  var cur = ''
  for (var i = 0; i < words.length; i++) {
    if (cur && (cur + ' ' + words[i]).length > targetWidth) {
      lines.push(cur)
      cur = words[i]
    } else {
      cur = cur ? cur + ' ' + words[i] : words[i]
    }
  }
  if (cur) lines.push(cur)
  return lines.join('<br>')
}

function wrapLabels(cats: string[], targetWidth: number): string[] {
  return cats.map(function(c) { return wrapLabel(c, targetWidth) })
}

// Returns xaxis overrides that prevent categorical label overlap on vertical bar / waterfall / crosstab.
// Wraps long labels at word boundaries; falls back to rotation only for very dense charts.
function catXAxis(cats: string[]): Record<string, any> {
  var maxLen = cats.reduce(function(mx, c) { return Math.max(mx, String(c).length) }, 0)
  // For few categories with long labels, wrapping handles it — no rotation needed
  if (cats.length < 5 || maxLen <= 10) return {}
  // For many categories, use smaller font to fit
  return {
    tickfont: { size: cats.length > 10 ? 10 : 11 },
  }
}

function PlotlyChart({ traces, layout, style }: { traces: any[]; layout?: any; style?: React.CSSProperties }) {
  var ref = useRef<HTMLDivElement>(null)
  useEffect(function() {
    if (!ref.current || !traces.length) return
    var baseX = { gridcolor: T.border, zerolinecolor: T.borderMid, linecolor: T.border, tickfont: { size: 11 }, automargin: true, title: { standoff: 18 } }
    var baseY = { gridcolor: T.border, zerolinecolor: T.borderMid, linecolor: T.border, tickfont: { size: 11 }, automargin: true, title: { standoff: 18 } }
    var base = { paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', font: { family: 'Inter,system-ui,sans-serif', color: T.textMute, size: 11 }, margin: { t: 48, r: 90, b: 56, l: 56 }, bargap: 0.15, xaxis: baseX, yaxis: baseY }
    var merged = Object.assign({}, base, layout || {})
    // Normalize chart-level title string to styled object
    if (typeof merged.title === 'string') {
      merged.title = { text: merged.title, font: { size: 14, color: T.text, family: 'Inter,system-ui,sans-serif', weight: 600 }, x: 0.5, xanchor: 'center', y: 0.98, yanchor: 'top' }
    }
    // Deep merge axes so caller's title/tickangle don't lose grid settings
    var lx = layout?.xaxis || {}, ly = layout?.yaxis || {}
    // Normalize string titles to { text, standoff } so standoff is preserved
    if (typeof lx.title === 'string') lx = Object.assign({}, lx, { title: { text: lx.title, standoff: 18 } })
    if (typeof ly.title === 'string') ly = Object.assign({}, ly, { title: { text: ly.title, standoff: 18 } })
    merged.xaxis = Object.assign({}, baseX, lx)
    merged.yaxis = Object.assign({}, baseY, ly)
    getPlotly().then(function(Plotly) { Plotly.newPlot(ref.current, traces, merged, { responsive: true, displayModeBar: false }) })
    return function() { if (ref.current) getPlotly().then(function(Plotly) { try { Plotly.purge(ref.current) } catch {} }) }
  }, [traces, layout])
  return <div ref={ref} style={style || { width: '100%', height: 400 }} />
}

function EmptyChart({ msg }: { msg: string }) {
  return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 40px', color: T.textFaint }}><div style={{ fontSize: 40, marginBottom: 12 }}>{'\uD83D\uDCCA'}</div><div style={{ fontSize: 14, fontWeight: 600, color: T.textMid }}>{msg}</div></div>
}

// ─── Chart Slot — grouped dropdown + drag-drop target ────────────────────

function ChartSlot({ label, value, onChange, options, required, accepts }: {
  label: string; value: string; onChange: (v: string) => void
  options: { v: string; l: string; section?: string }[]; required?: boolean; accepts?: string[]
}) {
  var [dragOver, setDragOver] = useState(false)
  var coreOpts  = options.filter(function(o) { return !o.section || o.section === 'core' })
  var customOpts = options.filter(function(o) { return o.section === 'custom' })
  var psychoOpts = options.filter(function(o) { return o.section === 'psychographic' })
  var demoOpts  = options.filter(function(o) { return o.section === 'demographic' })
  var hasGroups = customOpts.length > 0 || psychoOpts.length > 0 || demoOpts.length > 0

  return (
    <div style={{ minWidth: 140 }}
      onDragOver={function(e) { e.preventDefault(); setDragOver(true) }}
      onDragLeave={function(e) { var rt = e.relatedTarget as Node | null; if (!rt || !e.currentTarget.contains(rt)) setDragOver(false) }}
      onDrop={function(e) {
        e.preventDefault(); e.stopPropagation(); setDragOver(false)
        try {
          var payload = JSON.parse(e.dataTransfer.getData('text/field'))
          if (accepts && !accepts.includes(payload.type) && !accepts.includes('any')) return
          onChange(payload.field)
        } catch {}
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, color: T.textFaint, letterSpacing: '.07em', textTransform: 'uppercase', marginBottom: 4 }}>
        {label}{!required && ' (optional)'}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <select
          value={value || ''}
          onChange={function(e) { onChange(e.target.value) }}
          style={{
            flex: 1, padding: '7px 10px', fontSize: 12, fontFamily: 'inherit',
            border: '1.5px solid ' + (dragOver ? T.accent : value ? T.accent : T.border),
            borderRadius: 7,
            background: dragOver ? T.accentBg : value ? T.accentBg : T.bgCard,
            color: value ? T.accent : T.textMute,
            fontWeight: value ? 700 : 400,
            outline: 'none', cursor: 'pointer',
            transition: 'border-color .12s, background .12s',
          }}
        >
          {!required && <option value="">None — or drag</option>}
          {required && !value && <option value="">Select or drag…</option>}
          {coreOpts.map(function(o) { return <option key={o.v} value={o.v}>{o.l}</option> })}
          {hasGroups && customOpts.length > 0 && <optgroup label="Survey Questions">{customOpts.map(function(o) { return <option key={o.v} value={o.v}>{o.l}</option> })}</optgroup>}
          {hasGroups && psychoOpts.length > 0 && <optgroup label="Psychographic">{psychoOpts.map(function(o) { return <option key={o.v} value={o.v}>{o.l}</option> })}</optgroup>}
          {hasGroups && demoOpts.length > 0 && <optgroup label="Demographic">{demoOpts.map(function(o) { return <option key={o.v} value={o.v}>{o.l}</option> })}</optgroup>}
        </select>
        {value && !required && (
          <button onClick={function() { onChange('') }} title="Clear"
            style={{ flexShrink: 0, width: 20, height: 20, borderRadius: '50%', background: T.accent + '22', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: T.accent, fontWeight: 700, padding: 0, lineHeight: 1 }}>
            ×
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Chart Renderers (receive field values as params) ─────────────────────

// resolveAlias and aliasedCounts imported from @/lib/aliasUtils

function renderChart(chartType: string, config: Record<string, string>, analytics: Analytics, schema: SchemaField[], datasetId: string, opts?: { barMode?: string; barStack?: boolean; smartAxes?: boolean; colors?: string[]; orient?: string }): React.ReactNode {
  var rawFs = analytics.fieldSummaries
  // Apply value aliases to all field summary counts so every chart gets aliased labels
  var fs: Record<string, FieldSummary> = {}
  Object.entries(rawFs).forEach(function(entry) {
    var key = entry[0], summary = entry[1] as any
    if (summary.counts) {
      var al = aliasedCounts(key, summary.counts, schema)
      fs[key] = Object.assign({}, summary, { counts: al, topN: summary.topN ? summary.topN.map(function(v: string) { return resolveAlias(key, v, schema) }) : undefined })
    } else {
      fs[key] = summary
    }
  })
  var useSmartOrder = opts?.smartAxes !== false
  var pal = opts?.colors || CHART_COLORS
  var primaryColor = pal[0] || '#e8622a'

  if (chartType === 'bar') {
    var catField = config.category; if (!catField) return <EmptyChart msg="Assign a category field above." />
    var valueField = config.value
    // When a value field is assigned AND mode is average, use aggregation
    var colorByField = config.colorBy
    if (valueField && opts?.barMode !== 'count' && opts?.barMode !== 'percent') {
      if (colorByField) {
        // Can't stack/group averages — ignore colorBy in average mode
        return <><div style={{ fontSize: 11, color: '#d97706', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '6px 12px', marginBottom: 8 }}>Color/Stack not available in Average mode. Showing averages by category only.</div><BarAggInner analytics={analytics} schema={schema} datasetId={datasetId} catField={catField} valueField={valueField} smartAxes={useSmartOrder} colors={pal} orient={opts?.orient || 'v'} /></>
      }
      return <BarAggInner analytics={analytics} schema={schema} datasetId={datasetId} catField={catField} valueField={valueField} smartAxes={useSmartOrder} colors={pal} orient={opts?.orient || 'v'} />
    }
    var summary = fs[catField]; if (!summary || !summary.counts) return <EmptyChart msg="No data for this field." />
    var rawEntries = Object.entries(summary.counts)
    // Smart axes: order by remapping, then detected scale, then alphabetical (Item 20)
    var catFieldObj = schema.find(function(f) { return f.field === catField })
    var catRemap = catFieldObj?.remapping
    // Themes: always sort by frequency descending
    // Smart Axes ON + ordinal field: use smartOrder (preserves scale). Smart Axes ON + nominal field: sort by frequency.
    // Smart Axes OFF: alphabetical.
    var rawKeys = rawEntries.map(function(e) { return e[0] })
    var isOrd = !!(catRemap && Object.keys(catRemap).length >= 2) || isOrdinalScale(rawKeys)
    var orderedKeys = catField === '__themes__'
      ? rawEntries.slice().sort(function(a, b) { return (b[1] as number) - (a[1] as number) }).map(function(e) { return e[0] })
      : useSmartOrder
        ? (isOrd ? smartOrder(rawKeys, catRemap) : rawEntries.slice().sort(function(a, b) { return (b[1] as number) - (a[1] as number) }).map(function(e) { return e[0] }))
        : rawKeys.slice().sort()
    var entries = orderedKeys.slice(0, 30).map(function(k) { return [k, summary.counts![k] || 0] as [string, number] })
    var cats = entries.map(function(e) { return e[0] })
    var vals = entries.map(function(e) { return e[1] })
    var totalCount = vals.reduce(function(a, b) { return a + b }, 0)
    var isPercent = opts?.barMode === 'percent'
    var displayVals = isPercent ? vals.map(function(v) { return totalCount > 0 ? Math.round(v / totalCount * 1000) / 10 : 0 }) : vals
    var catLabel = flByName(catField, schema)
    var yTitle = isPercent ? '% of ' + catLabel : 'Count'
    var isH = opts?.orient === 'h'

    // Stacked/grouped with colorBy
    if (colorByField && fs[colorByField] && fs[colorByField].counts) {
      return <BarStackedInner analytics={analytics} schema={schema} datasetId={datasetId} catField={catField} colorByField={colorByField} barMode={opts?.barMode || 'count'} barStack={opts?.barStack || false} smartAxes={useSmartOrder} colors={pal} orient={opts?.orient || 'v'} />
    }

    var hoverTpl = isH
      ? (isPercent ? '%{x:.0f}%<extra>%{y}</extra>' : '%{x}<extra>%{y}</extra>')
      : (isPercent ? '%{y:.0f}%<extra>%{x}</extra>' : '%{y}<extra>%{x}</extra>')
    // Ordinal fields get a green→grey→red gradient; nominal fields get single color
    var isOrdField = (catRemap && Object.keys(catRemap).length >= 2) || isOrdinalScale(cats)
    var barColors: string | string[] = primaryColor
    if (isOrdField && cats.length >= 3) {
      // Gradient: green (best) → grey (mid) → red (worst)
      // smartOrder returns low→high, so reversed orderedKeys = high→low (Excellent first)
      var ordGrad = ['#059669','#34D399','#94A3B8','#F97316','#DC2626']
      barColors = cats.map(function(_, i) {
        var frac = cats.length <= 1 ? 0 : i / (cats.length - 1)
        if (frac < 0.15) return ordGrad[0]
        if (frac < 0.38) return ordGrad[1]
        if (frac < 0.62) return ordGrad[2]
        if (frac < 0.82) return ordGrad[3]
        return ordGrad[4]
      })
    }
    var wrappedCats = wrapLabels(cats, isH ? 28 : 18)
    var trace: any = { type: 'bar', marker: { color: barColors, line: { color: typeof barColors === 'string' ? barColors + '40' : barColors.map(function(c) { return c + '40' }), width: 1 } }, text: displayVals.map(function(v) { return String(isPercent ? Math.round(v) + '%' : v) }), textposition: 'outside', textfont: { size: 11 }, cliponaxis: false, hovertemplate: hoverTpl }
    if (isH) { trace.y = wrappedCats; trace.x = displayVals; trace.orientation = 'h' }
    else { trace.x = wrappedCats; trace.y = displayVals }

    var isCount = opts?.barMode !== 'percent'
    return <PlotlyChart traces={[trace]} layout={{ title: catLabel, xaxis: { title: isH ? yTitle : '', ...(!isH ? catXAxis(wrappedCats) : {}), ...(isH && isCount ? { tickformat: ',d' } : {}) }, yaxis: { title: isH ? '' : yTitle, ...(!isH && isCount ? { tickformat: ',d' } : {}) }, barcornerradius: 4 }} />
  }

  if (chartType === 'distribution') {
    var field = config.field; if (!field) return <EmptyChart msg="Assign a numeric field above." />
    var splitByField = config.splitBy
    if (splitByField) {
      return <DistSplitInner analytics={analytics} schema={schema} datasetId={datasetId} numField={field} splitByField={splitByField} colors={pal} smartAxes={useSmartOrder} />
    }
    var sum = fs[field]; if (!sum) return <EmptyChart msg="No data." />
    var fieldAlias = flByName(field, schema)
    if (sum.histogram) {
      var hx = sum.histogram.map(function(b) { return (b.min + b.max) / 2 })
      var hy = sum.histogram.map(function(b) { return b.count })
      var intX = isSmallIntRange(sum.min, sum.max)
      var maxY = Math.max.apply(null, hy)
      var distShapes: any[] = []
      var distAnnotations: any[] = []
      if (sum.avg != null) {
        distShapes.push({ type: 'line', x0: sum.avg, x1: sum.avg, y0: 0, y1: 1, yref: 'paper', line: { color: T.accent, width: 2, dash: 'dash' } })
        distAnnotations.push({ x: sum.avg, y: 0.98, yref: 'paper', text: 'Mean ' + sum.avg.toFixed(1), showarrow: false, font: { size: 11, color: T.accent }, xanchor: sum.avg > (sum.max || 0) * 0.7 ? 'right' : 'left', yanchor: 'top', xshift: sum.avg > (sum.max || 0) * 0.7 ? -4 : 4 })
      }
      if (sum.median != null) {
        distShapes.push({ type: 'line', x0: sum.median, x1: sum.median, y0: 0, y1: 1, yref: 'paper', line: { color: T.blue, width: 2, dash: 'dot' } })
        distAnnotations.push({ x: sum.median, y: 0.82, yref: 'paper', text: 'Median ' + sum.median.toFixed(1), showarrow: false, font: { size: 11, color: T.blue }, xanchor: sum.median > (sum.max || 0) * 0.7 ? 'right' : 'left', yanchor: 'top', xshift: sum.median > (sum.max || 0) * 0.7 ? -4 : 4 })
      }
      return <PlotlyChart
        traces={[{ type: 'bar', x: hx, y: hy, marker: { color: primaryColor, opacity: 0.8, line: { color: primaryColor + '60', width: 1 } }, hovertemplate: '%{x}: %{y}<extra></extra>' }]}
        layout={{ title: fieldAlias, xaxis: { title: fieldAlias, ...(intX ? { dtick: 1, tick0: sum.min } : {}) }, yaxis: { title: 'Count', tickformat: ',d' }, bargap: 0.04, barcornerradius: 3, shapes: distShapes, annotations: distAnnotations }}
      />
    }
    return <PlotlyChart traces={[{ type: 'box', y: [sum.min, sum.avg, sum.median, sum.max].filter(function(v) { return v != null }), boxpoints: 'all', marker: { color: primaryColor }, name: fieldAlias }]} layout={{ title: fieldAlias, yaxis: { title: fieldAlias, ...(isSmallIntRange(sum.min, sum.max) ? { dtick: 1 } : {}) } }} />
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
    return <TimeSeriesInner analytics={analytics} schema={schema} datasetId={datasetId} dateField={dateF} metricField={config.metric || ''} colorByField={config.colorBy || ''} colors={opts?.colors || CHART_COLORS} />
  }

  if (chartType === 'treemap') {
    var catF2 = config.category; if (!catF2) return <EmptyChart msg="Assign a category field above." />
    var s2 = fs[catF2]; if (!s2 || !s2.counts) return <EmptyChart msg="No data." />
    var e2 = (function() { var raw = Object.entries(s2.counts); var f2Obj = schema.find(function(f) { return f.field === catF2 }); var keys = useSmartOrder ? smartOrder(raw.map(function(e) { return e[0] }), f2Obj?.remapping) : raw.map(function(e) { return e[0] }).sort(); return keys.slice(0, 30).map(function(k) { return [k, s2.counts![k] || 0] as [string, number] }) })()
    var labels = e2.map(function(e) { return e[0] }); var values = e2.map(function(e) { return e[1] }); var parents = labels.map(function() { return '' })
    return <PlotlyChart traces={[{ type: 'treemap', labels: labels, values: values, parents: parents, marker: { colors: labels.map(function(_, i) { return pal[i % pal.length] }) }, branchvalues: 'remainder' as const, textinfo: 'label+value' }]} layout={{ title: flByName(catF2, schema), margin: { t: 48, r: 8, b: 8, l: 8 } }} />
  }

  if (chartType === 'bubbles') {
    var catF3 = config.category; if (!catF3) return <EmptyChart msg="Assign a category field above." />
    var s3 = fs[catF3]; if (!s3 || !s3.counts) return <EmptyChart msg="No data." />
    var f3Obj = schema.find(function(f) { return f.field === catF3 })
    var e3Keys = smartOrder(Object.keys(s3.counts), f3Obj?.remapping).slice(0, 25)
    var e3 = e3Keys.map(function(k) { return [k, s3.counts![k] || 0] as [string, number] }).sort(function(a, b) { return b[1] - a[1] })
    // Circle-pack layout: place largest first, then find best position for each subsequent circle
    var maxVal = Math.max.apply(null, e3.map(function(e) { return e[1] })) || 1
    var radii = e3.map(function(e) { return 15 + Math.sqrt(e[1] / maxVal) * 55 })
    var placed: { x: number; y: number; r: number }[] = []
    e3.forEach(function(_, i) {
      var r = radii[i]
      if (i === 0) { placed.push({ x: 0, y: 0, r: r }); return }
      // Try candidate positions around each placed circle
      var bestX = 0, bestY = 0, bestDist = Infinity
      for (var pi = 0; pi < placed.length; pi++) {
        for (var angle = 0; angle < 360; angle += 15) {
          var rad = angle * Math.PI / 180
          var cx = placed[pi].x + Math.cos(rad) * (placed[pi].r + r + 2)
          var cy = placed[pi].y + Math.sin(rad) * (placed[pi].r + r + 2)
          var overlaps = false
          for (var j = 0; j < placed.length; j++) {
            var dx = cx - placed[j].x, dy = cy - placed[j].y
            if (Math.sqrt(dx * dx + dy * dy) < placed[j].r + r + 1) { overlaps = true; break }
          }
          if (!overlaps) {
            var dist = Math.sqrt(cx * cx + cy * cy)
            if (dist < bestDist) { bestDist = dist; bestX = cx; bestY = cy }
          }
        }
      }
      placed.push({ x: bestX, y: bestY, r: r })
    })
    var total3 = e3.reduce(function(s, e) { return s + e[1] }, 0)
    return <PlotlyChart traces={[{
      x: placed.map(function(p) { return p.x }), y: placed.map(function(p) { return p.y }),
      mode: 'markers+text' as const,
      marker: { size: radii.map(function(r) { return r * 2 }), color: e3.map(function(_, i) { return pal[i % pal.length] }), opacity: 0.85, line: { color: e3.map(function(_, i) { return pal[i % pal.length] }), width: 1.5 }, sizemode: 'diameter' as const },
      text: e3.map(function(e) { var pct = total3 > 0 ? Math.round(e[1] / total3 * 100) : 0; return e[0] + '\n' + e[1].toLocaleString() + ' (' + pct + '%)' }),
      textposition: 'center' as const, textfont: { size: radii.map(function(r) { return Math.max(8, Math.min(13, r * 0.28)) }) }, hoverinfo: 'text' as const
    }]} layout={{ title: flByName(catF3, schema), showlegend: false, xaxis: { visible: false, zeroline: false }, yaxis: { visible: false, zeroline: false, scaleanchor: 'x' }, margin: { t: 48, r: 8, b: 8, l: 8 } }} />
  }

  if (chartType === 'waterfall') {
    var catF4 = config.category; if (!catF4) return <EmptyChart msg="Assign a category field above." />
    var s4 = fs[catF4]; if (!s4 || !s4.counts) return <EmptyChart msg="No data." />
    var e4 = (function() { var raw = Object.entries(s4.counts); var f4Obj = schema.find(function(f) { return f.field === catF4 }); var keys = useSmartOrder ? smartOrder(raw.map(function(e) { return e[0] }), f4Obj?.remapping) : raw.map(function(e) { return e[0] }).sort(); return keys.slice(0, 15).map(function(k) { return [k, s4.counts![k] || 0] as [string, number] }) })()
    var wLabels = wrapLabels(e4.map(function(e) { return e[0] }).concat(['Total']), 18)
    var wValues = e4.map(function(e) { return e[1] })
    var total = wValues.reduce(function(a, b) { return a + b }, 0)
    var measures: string[] = wValues.map(function() { return 'relative' }).concat(['total'])
    wValues.push(total)
    return <PlotlyChart traces={[{ type: 'waterfall', x: wLabels, y: wValues, measure: measures, connector: { line: { color: T.borderMid } }, increasing: { marker: { color: T.green } }, decreasing: { marker: { color: T.red } }, totals: { marker: { color: primaryColor } } }]} layout={{ title: flByName(catF4, schema), xaxis: { ...catXAxis(wLabels) }, margin: { t: 48, r: 16, b: 48, l: 56 }, showlegend: false }} />
  }

  if (chartType === 'bullet') {
    var bField = config.field; if (!bField) return <EmptyChart msg="Assign a measure field above." />
    var splitByField = config.splitBy || ''
    if (splitByField) {
      return <BulletSplitInner analytics={analytics} schema={schema} datasetId={datasetId} measureField={bField} splitByField={splitByField} smartAxes={useSmartOrder} colors={pal} />
    }
    var bs = fs[bField]; if (!bs || bs.avg == null) return <EmptyChart msg="No numeric data." />
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16, maxWidth: 320, margin: '0 auto' }}>
        <GaugeCard label={flByName(bField, schema)} avg={bs.avg || 0} median={bs.median || bs.avg || 0} min={bs.min || 0} max={bs.max || 100} n={bs.nonNull || 0} overallAvg={null} accentColor={primaryColor} />
      </div>
    )
  }

  if (chartType === 'funnel') {
    var catF5 = config.category; if (!catF5) return <EmptyChart msg="Assign a category field above." />
    var s5 = fs[catF5]; if (!s5 || !s5.counts) return <EmptyChart msg="No data." />
    var e5 = (function() { var raw = Object.entries(s5.counts); var f5Obj = schema.find(function(f) { return f.field === catF5 }); var keys = useSmartOrder ? smartOrder(raw.map(function(e) { return e[0] }), f5Obj?.remapping) : raw.sort(function(a, b) { return b[1] - a[1] }).map(function(e) { return e[0] }); return keys.slice(0, 12).map(function(k) { return [k, s5.counts![k] || 0] as [string, number] }) })()
    return <PlotlyChart traces={[{ type: 'funnel', y: wrapLabels(e5.map(function(e) { return e[0] }), 28), x: e5.map(function(e) { return e[1] }), marker: { color: e5.map(function(_, i) { return pal[i % pal.length] }) } }]} layout={{ title: flByName(catF5, schema), margin: { t: 48, r: 16, b: 8, l: 120 }, showlegend: false }} />
  }

  if (chartType === 'gantt') {
    var gCat = config.category, gRange = config.range; if (!gCat || !gRange) return <EmptyChart msg="Assign category and range fields above." />
    return <GanttInner analytics={analytics} schema={schema} datasetId={datasetId} catField={gCat} rangeField={gRange} />
  }

  if (chartType === 'driver') {
    var dScoreF = config.score; if (!dScoreF) return <EmptyChart msg="Assign a numeric score field above." />
    return <ScoreDriverInner datasetId={datasetId} scoreField={dScoreF} schema={schema} groupByField={config.groupBy || ''} colors={opts?.colors || CHART_COLORS} />
  }

  if (chartType === 'table') return <TableInner analytics={analytics} schema={schema} datasetId={datasetId} />

  return <EmptyChart msg="Select a chart type." />
}

// ─── Chart sub-components that need raw rows ──────────────────────────────

// Module-level enrichment context — set by ChartsModule, read by useRows + enrichRows
var _enrichCtx: {
  themeModel?: any; schema?: SchemaConfig
  enrichKey?: number           // incremented when source/filter changes → triggers re-enrichment
  themeSourceOverride?: string // overrides themeModel.fieldName
  activeThemeNames?: Set<string> | null  // null = all active
  datasetSource?: string       // 'reddit' | 'substack' etc for signal_tier injection
} = {}

// useChartRows: reads from shared RowsContext, applies chart-specific enrichment
// (theme classification + field remapping). No independent fetch.
function useChartRows(datasetId: string, enrichKey: number = 0) {
  var shared = useRows()
  var { effectiveFilters } = useFilters()
  var [rows, setRows] = useState<Record<string, unknown>[]>([])
  var [loaded, setLoaded] = useState(false)
  var filterKey = JSON.stringify(effectiveFilters)
  useEffect(function() {
    if (enrichKey < 0) return // skip when using aggregation API
    if (!shared.rowsLoaded) return
    // Trigger fetch if not loaded yet
    shared.fetchRows()
    var enriched = enrichRows(shared.rows)
    if (_enrichCtx.datasetSource) enriched = injectSignalTier(enriched, _enrichCtx.datasetSource)
    // Apply global filters
    var filtered = applyFilters(enriched, effectiveFilters)
    setRows(filtered)
    setLoaded(true)
  }, [shared.rowsLoaded, enrichKey, filterKey])
  // Trigger shared fetch on first render
  useEffect(function() { shared.fetchRows() }, [])
  return { rows: rows, loaded: loaded, loading: shared.rowsLoading }
}

// Aggregation hook — fetches pre-computed results from SQL, no raw rows needed
var _aggCache: Record<string, any> = {}

function useAggregation(datasetId: string, spec: Record<string, unknown> | null) {
  var [data, setData] = useState<any>(null)
  var [loaded, setLoaded] = useState(false)
  var cacheKey = datasetId + ':' + JSON.stringify(spec)
  useEffect(function() {
    if (!spec) return
    if (_aggCache[cacheKey]) { setData(_aggCache[cacheKey]); setLoaded(true); return }
    setLoaded(false)
    fetch('/api/datasets/' + datasetId + '/aggregate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(spec),
    }).then(function(r) { return r.json() })
      .then(function(d) { _aggCache[cacheKey] = d; setData(d); setLoaded(true) })
      .catch(function() { setLoaded(true) })
  }, [datasetId, cacheKey])
  return { data: data, loaded: loaded }
}

// Reads source field, active themes, and mapped fields from _enrichCtx
function enrichRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  var themeModel = _enrichCtx.themeModel
  var schema = _enrichCtx.schema
  if (!rows.length) return rows
  var hasThemes = !!(themeModel && themeModel.themes && themeModel.themes.length > 0)
  var mappedFields = (schema?.fields || []).filter(function(f) { return f.type === 'categorical' && f.remapping && Object.keys(f.remapping).length > 0 })
  if (!hasThemes && !mappedFields.length) return rows

  var allThemes: any[] = hasThemes ? themeModel.themes : []
  var activeNames = _enrichCtx.activeThemeNames  // null = all themes shown
  var themes = activeNames ? allThemes.filter(function(t: any) { return activeNames!.has(t.name || t.label) }) : allThemes
  var openField = hasThemes
    ? (_enrichCtx.themeSourceOverride || themeModel.fieldName || (schema?.fields || []).find(function(f: any) { return f.type === 'open-ended' })?.field || '')
    : ''

  return rows.map(function(row) {
    var enriched = Object.assign({}, row)

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
          if (hits > bestCount) { bestCount = hits; bestTheme = t.name || t.label }
        })
        enriched['__themes__'] = bestTheme  // '' when unclassified — excluded from groupings
      }
    }

    mappedFields.forEach(function(f) {
      var catVal = String(row[f.field] || '')
      var numVal = f.remapping![catVal]
      enriched['__mapped_' + f.field + '__'] = numVal != null ? numVal : null
    })

    return enriched
  })
}

function BarStackedInner({ analytics, schema, datasetId, catField, colorByField, barMode, barStack, smartAxes, colors, orient }: { analytics: Analytics; schema: SchemaField[]; datasetId: string; catField: string; colorByField: string; barMode: string; barStack: boolean; smartAxes?: boolean; colors?: string[]; orient?: string }) {
  // Collections have no dataset_rows_flat, so SQL aggregation returns empty — always use rows
  var isCollection = _enrichCtx.datasetSource === 'collection'
  var aggSpec = !isCollection && catField && colorByField ? { op: 'crosstab', rowField: catField, colField: colorByField, limit: 30 } : null
  var { data: aggData, loaded: aggLoaded } = useAggregation(datasetId, aggSpec)
  // Fallback to useRows for virtual fields or collections that aren't in the flat table
  var needsRows = isCollection || catField.startsWith('__') || colorByField.startsWith('__')
  var { rows, loaded: rowsLoaded } = useChartRows(datasetId, needsRows ? (_enrichCtx.enrichKey || 0) : -1)
  var loaded = needsRows ? rowsLoaded : aggLoaded
  if (!loaded) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, padding: 40 }}><LottieLoader size={120} message="Loading chart data\u2026" /></div>
  var pal = colors || CHART_COLORS

  // Build crosstab: from aggregation API or from rows
  var grid: Record<string, Record<string, number>> = {}
  var colorVals = new Set<string>()
  var colorTotals: Record<string, number> = {}
  if (!needsRows && aggData && aggData.grid) {
    grid = aggData.grid
    ;(aggData.cols || []).forEach(function(c: string) { colorVals.add(c) })
    Object.values(grid).forEach(function(row: any) { Object.entries(row).forEach(function(e: any) { colorTotals[e[0]] = (colorTotals[e[0]] || 0) + e[1] }) })
  } else {
    rows.forEach(function(r) {
      var cat = String(r[catField] || '').trim()
      var col = String(r[colorByField] || '').trim()
      if (!cat || !col) return
      colorVals.add(col)
      colorTotals[col] = (colorTotals[col] || 0) + 1
      if (!grid[cat]) grid[cat] = {}
      grid[cat][col] = (grid[cat][col] || 0) + 1
    })
  }
  var colorGrandTotal = Object.values(colorTotals).reduce(function(a, b) { return a + b }, 0)

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
      var smartCats = smartOrder(cats)
      if (smartCats.join(',') !== cats.slice().sort().join(',')) {
        cats = smartCats.filter(function(v) { return grid[v] })
      } else {
        cats.sort(function(a, b) { var ta = Object.values(grid[b]).reduce(function(s, v) { return s + v }, 0); var tb = Object.values(grid[a]).reduce(function(s, v) { return s + v }, 0); return ta - tb })
      }
    }
  } else {
    // Signal tier: always use canonical order even without smart axes
    if (catField === 'signal_tier') {
      cats = smartOrder(cats)
    } else {
      cats.sort()
    }
  }
  cats = cats.slice(0, 30)
  var isH = orient === 'h'
  var catLabels = wrapLabels(cats.map(function(c) { return resolveAlias(catField, c, schema) }), isH ? 28 : 18)
  // Order color (stack/group) values — signal tiers use canonical order, others by frequency
  var colorArr = Array.from(colorVals)
  if (colorByField === 'signal_tier') {
    colorArr = smartOrder(colorArr)
  } else {
    colorArr.sort(function(a, b) { return (colorTotals[b] || 0) - (colorTotals[a] || 0) })
  }

  var isBarPercent = barMode === 'percent'
  var traces = colorArr.map(function(col, i) {
    var ys = cats.map(function(cat) { return grid[cat] ? (grid[cat][col] || 0) : 0 })
    if (isBarPercent) {
      ys = cats.map(function(cat) {
        var total = Object.values(grid[cat] || {}).reduce(function(s, v) { return s + v }, 0)
        return total > 0 ? Math.round((grid[cat] ? (grid[cat][col] || 0) : 0) / total * 1000) / 10 : 0
      })
    }
    var colPct = colorGrandTotal > 0 ? Math.round((colorTotals[col] || 0) / colorGrandTotal * 100) : 0
    var colLabel = resolveAlias(colorByField, col, schema)
    var stackHoverTpl = isH
      ? (isBarPercent ? '%{x:.0f}%<br>' + flByName(colorByField, schema) + ': ' + colLabel + '<extra></extra>' : '%{x}<br>' + flByName(colorByField, schema) + ': ' + colLabel + '<extra></extra>')
      : (isBarPercent ? '%{y:.0f}%<br>' + flByName(colorByField, schema) + ': ' + colLabel + '<extra></extra>' : '%{y}<br>' + flByName(colorByField, schema) + ': ' + colLabel + '<extra></extra>')
    var trace: any = { type: 'bar', name: colLabel + ' (' + colPct + '%)', marker: { color: pal[i % pal.length], line: { color: pal[i % pal.length] + '40', width: 1 } }, hovertemplate: stackHoverTpl }
    if (isH) { trace.y = catLabels; trace.x = ys; trace.orientation = 'h' }
    else { trace.x = catLabels; trace.y = ys }
    return trace
  })

  var catLabel = flByName(catField, schema)
  var valLabel = barMode === 'percent' ? 'Percentage' : 'Count'
  var isStackedCount = barMode !== 'percent'
  return <PlotlyChart traces={traces} layout={{ title: catLabel + ' by ' + flByName(colorByField, schema), barmode: barStack ? 'stack' : 'group', xaxis: { title: isH ? valLabel : '', ...(!isH ? catXAxis(catLabels) : {}), ...(isH && isStackedCount ? { tickformat: ',d' } : {}) }, yaxis: { title: isH ? '' : valLabel, ...(!isH && isStackedCount ? { tickformat: ',d' } : {}) }, legend: { orientation: 'h' as const, y: -0.2, traceorder: 'normal' as const, title: { text: flByName(colorByField, schema) } }, barcornerradius: 4 }} />
}

// ─── Bar Aggregated Inner (average/sum of numeric value by category) ─────

function BarAggInner({ analytics, schema, datasetId, catField, valueField, smartAxes, colors, orient }: {
  analytics: Analytics; schema: SchemaField[]; datasetId: string; catField: string; valueField: string; smartAxes?: boolean; colors?: string[]; orient?: string
}) {
  var isCollection = _enrichCtx.datasetSource === 'collection'
  var spec = !isCollection ? { op: 'group_stats', groupField: catField, valueField: valueField } : null
  var agg = useAggregation(datasetId, spec)
  var { rows, loaded: rowsLoaded } = useChartRows(datasetId, isCollection ? (_enrichCtx.enrichKey || 0) : -1)
  var loaded = isCollection ? rowsLoaded : agg.loaded
  if (!loaded) return <div style={{ textAlign: 'center', padding: 40, color: T.textMute, fontSize: 13 }}>Computing averages...</div>

  // Build groups from aggregation API or from rows (collections)
  var groupsObj: Record<string, { n: number; mean: number; median: number; min: number; max: number }>
  if (!isCollection && agg.data && agg.data.groups) {
    groupsObj = agg.data.groups
  } else {
    var buckets: Record<string, number[]> = {}
    rows.forEach(function(r) {
      var cat = String(r[catField] || '').trim(); if (!cat) return
      var v = parseFloat(String(r[valueField] || '')); if (isNaN(v)) return
      if (!buckets[cat]) buckets[cat] = []
      buckets[cat].push(v)
    })
    groupsObj = {}
    Object.entries(buckets).forEach(function(e) {
      var vals = e[1].slice().sort(function(a, b) { return a - b })
      var sum = vals.reduce(function(a, b) { return a + b }, 0)
      groupsObj[e[0]] = { n: vals.length, mean: sum / vals.length, median: vals[Math.floor(vals.length / 2)], min: vals[0], max: vals[vals.length - 1] }
    })
  }
  var groupKeys = Object.keys(groupsObj)
  if (groupKeys.length === 0) return <EmptyChart msg="No groups found." />

  var groups = groupKeys.map(function(k) { return { group: k, ...groupsObj[k] } })

  // Smart Axes ON + ordinal: preserve scale order. ON + nominal: sort by mean. OFF: alphabetical.
  var catFieldObj = schema.find(function(f) { return f.field === catField })
  var catRemap = catFieldObj?.remapping
  var isOrdAgg = !!(catRemap && Object.keys(catRemap).length >= 2) || isOrdinalScale(groups.map(function(g) { return g.group }))
  var sortedGroups = smartAxes
    ? (isOrdAgg
        ? smartOrder(groups.map(function(g) { return g.group }), catRemap).map(function(k) { return groups.find(function(g) { return g.group === k }) }).filter(Boolean) as typeof groups
        : groups.slice().sort(function(a, b) { return b.mean - a.mean }))
    : groups.slice().sort(function(a, b) { return a.group.localeCompare(b.group) })

  var isH = orient === 'h'
  var cats = wrapLabels(sortedGroups.slice(0, 30).map(function(g) { return resolveAlias(catField, g.group, schema) }), isH ? 28 : 18)
  var vals = sortedGroups.slice(0, 30).map(function(g) { return Math.round(g.mean * 100) / 100 })
  var catLabel = flByName(catField, schema)
  var valLabel = 'Avg ' + flByName(valueField, schema)
  var primaryColor = (colors || CHART_COLORS)[0] || '#e8622a'

  // Ordinal gradient like regular bar
  var isOrdField = (catRemap && Object.keys(catRemap).length >= 2) || isOrdinalScale(cats)
  var barColors: string | string[] = primaryColor
  if (isOrdField && cats.length >= 3) {
    var ordGrad = ['#059669','#34D399','#94A3B8','#F97316','#DC2626']
    barColors = cats.map(function(_, i) {
      var frac = cats.length <= 1 ? 0 : i / (cats.length - 1)
      if (frac < 0.15) return ordGrad[0]
      if (frac < 0.38) return ordGrad[1]
      if (frac < 0.62) return ordGrad[2]
      if (frac < 0.82) return ordGrad[3]
      return ordGrad[4]
    })
  }

  var hoverTpl = isH ? '%{x:.2f}<extra>%{y}</extra>' : '%{y:.2f}<extra>%{x}</extra>'
  var trace: any = {
    type: 'bar',
    marker: { color: barColors, line: { color: typeof barColors === 'string' ? barColors + '40' : barColors.map(function(c) { return c + '40' }), width: 1 } },
    text: vals.map(function(v) { return String(v) }),
    textposition: 'outside',
    textfont: { size: 11 },
    hovertemplate: hoverTpl,
  }
  if (isH) { trace.y = cats; trace.x = vals; trace.orientation = 'h' }
  else { trace.x = cats; trace.y = vals }

  return <PlotlyChart traces={[trace]} layout={{
    title: catLabel,
    xaxis: { title: isH ? valLabel : '', ...(!isH ? catXAxis(cats) : {}) },
    yaxis: { title: isH ? '' : valLabel },
    barcornerradius: 4,
  }} />
}

// ─── Gauge Card (SVG arc gauge matching Ana.html style) ───────────────────

function GaugeCard({ label, avg, median, min, max, n, overallAvg, accentColor }: { label: string; avg: number; median: number; min: number; max: number; n: number; overallAvg: number | null; accentColor?: string }) {
  var gaugeAccent = accentColor || T.accent
  var range = max - min || 1
  var pct = Math.max(0, Math.min(1, (avg - min) / range))
  var angle = -90 + pct * 180 // -90 to 90 degrees
  // Arc centered at (100, 100) with r=65 — fully inside 200-wide viewBox
  var r = 65, gx = 100, gy = 100
  var arcPath = function(startAngle: number, endAngle: number, radius: number) {
    var s = (startAngle - 90) * Math.PI / 180
    var e = (endAngle - 90) * Math.PI / 180
    var x1 = gx + radius * Math.cos(s), y1 = gy + radius * Math.sin(s)
    var x2 = gx + radius * Math.cos(e), y2 = gy + radius * Math.sin(e)
    var largeArc = endAngle - startAngle > 180 ? 1 : 0
    return 'M ' + x1 + ' ' + y1 + ' A ' + radius + ' ' + radius + ' 0 ' + largeArc + ' 1 ' + x2 + ' ' + y2
  }
  var vsOverall = overallAvg != null ? avg - overallAvg : null
  var vsColor = vsOverall != null ? (vsOverall >= 0 ? '#16a34a' : '#dc2626') : T.textMid

  // All content lives inside the SVG so it serialises cleanly for PNG export
  return (
    <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, padding: '8px', textAlign: 'center' }}>
      <svg viewBox="0 0 200 205" style={{ width: '100%', maxWidth: 220, margin: '0 auto', display: 'block' }}>
        <defs><style>{'text { font-family: system-ui, -apple-system, Arial, sans-serif; }'}</style></defs>

        {/* Label */}
        <text x="100" y="20" textAnchor="middle" style={{ fontSize: 13, fontWeight: 700, fill: T.text }}>{label}</text>

        {/* Background bands: bottom 25% pink, middle 50% amber, top 25% green */}
        <path d={arcPath(-90, -45, r)} fill="none" stroke="#fecdd3" strokeWidth={14} strokeLinecap="round" />
        <path d={arcPath(-45, 45, r)} fill="none" stroke="#fed7aa" strokeWidth={14} strokeLinecap="round" />
        <path d={arcPath(45, 90, r)} fill="none" stroke="#bbf7d0" strokeWidth={14} strokeLinecap="round" />

        {/* Needle */}
        {(function() {
          var a = (angle - 90) * Math.PI / 180
          var nx = gx + (r - 22) * Math.cos(a), ny = gy + (r - 22) * Math.sin(a)
          return <line x1={gx} y1={gy} x2={nx} y2={ny} stroke={gaugeAccent} strokeWidth={2.5} strokeLinecap="round" />
        })()}
        {/* Center dot */}
        <circle cx={gx} cy={gy} r={4} fill={gaugeAccent} />
        {/* Median marker */}
        {(function() {
          var mPct = Math.max(0, Math.min(1, (median - min) / range))
          var mAngle = (-90 + mPct * 180 - 90) * Math.PI / 180
          var mx = gx + (r + 4) * Math.cos(mAngle), my = gy + (r + 4) * Math.sin(mAngle)
          return <line x1={mx} y1={my} x2={mx} y2={my - 8} stroke="#2563eb" strokeWidth={2} />
        })()}

        {/* Value */}
        <text x={gx} y={gy - 14} textAnchor="middle" style={{ fontSize: 28, fontWeight: 800, fill: T.text }}>{avg.toFixed(1)}</text>
        {/* Scale labels */}
        <text x={gx - r - 8} y={gy + 13} textAnchor="middle" style={{ fontSize: 8, fill: T.textFaint }}>{min.toFixed(1)}</text>
        <text x={gx + r + 8} y={gy + 13} textAnchor="middle" style={{ fontSize: 8, fill: T.textFaint }}>{max.toFixed(1)}</text>

        {/* Stats row */}
        <text x={vsOverall != null ? '40' : '67'} y="130" textAnchor="middle" style={{ fontSize: 9, fill: T.textFaint }}>N</text>
        <text x={vsOverall != null ? '40' : '67'} y="144" textAnchor="middle" style={{ fontSize: 11, fontWeight: 700, fill: T.text }}>{n.toLocaleString()}</text>
        <text x={vsOverall != null ? '100' : '133'} y="130" textAnchor="middle" style={{ fontSize: 9, fill: T.textFaint }}>MEDIAN</text>
        <text x={vsOverall != null ? '100' : '133'} y="144" textAnchor="middle" style={{ fontSize: 11, fontWeight: 700, fill: '#2563eb' }}>{median.toFixed(1)}</text>
        {vsOverall != null && <>
          <text x="160" y="130" textAnchor="middle" style={{ fontSize: 9, fill: T.textFaint }}>VS AVG</text>
          <text x="160" y="144" textAnchor="middle" style={{ fontSize: 11, fontWeight: 700, fill: vsColor }}>{(vsOverall >= 0 ? '+' : '') + vsOverall.toFixed(1)}</text>
        </>}

        {/* Range */}
        <text x="100" y="162" textAnchor="middle" style={{ fontSize: 9, fill: T.textFaint }}>{'RANGE ' + min.toFixed(1) + '–' + max.toFixed(1)}</text>

        {/* Legend */}
        <rect x="8" y="172" width="8" height="8" rx="2" fill="#fecdd3" />
        <text x="20" y="180" style={{ fontSize: 8, fill: T.textFaint }}>Bottom 25%</text>
        <rect x="76" y="172" width="8" height="8" rx="2" fill="#fed7aa" />
        <text x="88" y="180" style={{ fontSize: 8, fill: T.textFaint }}>Middle 50%</text>
        <rect x="148" y="172" width="8" height="8" rx="2" fill="#bbf7d0" />
        <text x="160" y="180" style={{ fontSize: 8, fill: T.textFaint }}>Top 25%</text>
      </svg>
    </div>
  )
}

function DistSplitInner({ analytics, schema, datasetId, numField, splitByField, colors, smartAxes }: { analytics: Analytics; schema: SchemaField[]; datasetId: string; numField: string; splitByField: string; colors?: string[]; smartAxes?: boolean }) {
  var { rows, loaded } = useChartRows(datasetId, _enrichCtx.enrichKey || 0)
  if (!loaded) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, padding: 40 }}><LottieLoader size={120} message="Loading chart data\u2026" /></div>
  var pal = colors || CHART_COLORS
  var groups: Record<string, number[]> = {}
  rows.forEach(function(r) {
    var grp = String(r[splitByField] || '').trim()
    var val = parseFloat(String(r[numField] || ''))
    if (!grp || isNaN(val)) return
    if (!groups[grp]) groups[grp] = []
    groups[grp].push(val)
  })
  // Smart ordering of groups by the split-by field's remapping/values scale
  var splitFieldObj = schema.find(function(f) { return f.field === splitByField })
  var keys: string[]
  if (smartAxes !== false && splitFieldObj?.remapping) {
    var remap = splitFieldObj.remapping
    var orderedByRemap = Object.keys(remap).sort(function(a, b) { return (remap[a] || 0) - (remap[b] || 0) })
    keys = orderedByRemap.filter(function(k) { return groups[k] })
    var extrasSplit = Object.keys(groups).filter(function(k) { return !orderedByRemap.includes(k) }).sort()
    keys = keys.concat(extrasSplit)
  } else if (smartAxes !== false && splitFieldObj?.values?.length) {
    keys = splitFieldObj.values.filter(function(k) { return groups[k] })
    var extrasSplit2 = Object.keys(groups).filter(function(k) { return !splitFieldObj!.values!.includes(k) }).sort()
    keys = keys.concat(extrasSplit2)
  } else if (splitByField === '__themes__') {
    keys = Object.keys(groups).sort(function(a, b) { return groups[b].length - groups[a].length })
  } else {
    keys = smartOrder(Object.keys(groups))
  }
  if (!keys.length) return <EmptyChart msg="No data for this split." />
  // Integer-range ticks on Y-axis when numeric field is a small int range (e.g. NPS 0-10, rating 1-5)
  var numSum = analytics.fieldSummaries[numField]
  var intY = isSmallIntRange(numSum?.min, numSum?.max)
  var totalND = Object.values(groups).reduce(function(a, arr) { return a + arr.length }, 0)
  var traces = keys.map(function(k, i) {
    var pct = totalND > 0 ? Math.round(groups[k].length / totalND * 100) : 0
    var kLabel = resolveAlias(splitByField, k, schema)
    return { type: 'box' as const, y: groups[k], name: kLabel + ' (' + pct + '%)', marker: { color: pal[i % pal.length] }, boxpoints: 'outliers' as const }
  })
  return <PlotlyChart traces={traces} layout={{ title: flByName(numField, schema) + ' by ' + flByName(splitByField, schema), yaxis: { title: flByName(numField, schema), ...(intY ? { dtick: 1, tick0: numSum?.min } : {}) }, legend: { orientation: 'h' as const, y: -0.2, title: { text: flByName(splitByField, schema) } } }} />
}

function BulletSplitInner({ analytics, schema, datasetId, measureField, splitByField, smartAxes, colors }: { analytics: Analytics; schema: SchemaField[]; datasetId: string; measureField: string; splitByField: string; smartAxes?: boolean; colors?: string[] }) {
  var bulletPal = colors || CHART_COLORS
  var isCollection = _enrichCtx.datasetSource === 'collection'
  var needsRows = isCollection || splitByField.startsWith('__') || measureField.startsWith('__')
  var aggSpec = !needsRows && splitByField && measureField ? { op: 'group_stats', groupField: splitByField, valueField: measureField } : null
  var { data: aggData, loaded: aggLoaded } = useAggregation(datasetId, aggSpec)
  var { rows, loaded: rowsLoaded } = useChartRows(datasetId, needsRows ? (_enrichCtx.enrichKey || 0) : -1)
  var loaded = needsRows ? rowsLoaded : aggLoaded
  var [showAllKPI, setShowAllKPI] = useState(false)
  if (!loaded) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, padding: 40 }}><LottieLoader size={120} message="Loading chart data\u2026" /></div>

  // Build stats from aggregation API or rows
  var stats: { label: string; avg: number; median: number; min: number; max: number; n: number }[] = []
  var totalKPI = 0

  if (!needsRows && aggData && aggData.groups) {
    var aggGroups = aggData.groups as Record<string, { n: number; mean: number; median: number; min: number; max: number }>
    Object.entries(aggGroups).forEach(function(e) {
      totalKPI += e[1].n
      stats.push({ label: resolveAlias(splitByField, e[0], schema), avg: e[1].mean, median: e[1].median, min: e[1].min, max: e[1].max, n: e[1].n })
    })
  } else {
    var groups: Record<string, number[]> = {}
    rows.forEach(function(r) {
      var grp = String(r[splitByField] || '').trim()
      var val = parseFloat(String(r[measureField] || ''))
      if (!grp || grp === '(blank)' || grp === '' || isNaN(val)) return
      if (!groups[grp]) groups[grp] = []
      groups[grp].push(val)
    })
    totalKPI = Object.values(groups).reduce(function(s, v) { return s + v.length }, 0)
    Object.keys(groups).forEach(function(grp) {
      var vs = groups[grp].slice().sort(function(a, b) { return a - b })
      stats.push({ label: resolveAlias(splitByField, grp, schema), avg: vs.reduce(function(a, b) { return a + b }, 0) / vs.length, median: vs[Math.floor(vs.length / 2)], min: vs[0], max: vs[vs.length - 1], n: vs.length })
    })
  }

  // Filter out groups below 3% — only for themes
  if (!showAllKPI && splitByField === '__themes__' && totalKPI > 0) {
    stats = stats.filter(function(s) { return s.n / totalKPI >= 0.03 })
  }

  // Sort
  var splitFieldObjB = schema.find(function(f) { return f.field === splitByField })
  if (smartAxes) {
    var orderedKeys = smartOrder(stats.map(function(s) { return s.label }), splitFieldObjB?.remapping)
    stats.sort(function(a, b) { return orderedKeys.indexOf(a.label) - orderedKeys.indexOf(b.label) })
  } else if (splitByField === '__themes__') {
    stats.sort(function(a, b) { return b.n - a.n })
  } else {
    stats.sort(function(a, b) { return b.avg - a.avg })
  }
  if (!stats.length) return <EmptyChart msg="No data for this combination." />

  var totalNB = stats.reduce(function(t, s) { return t + s.n }, 0)
  var overallAvg = totalNB > 0 ? stats.reduce(function(s, x) { return s + x.avg * x.n }, 0) / totalNB : null

  return (
    <div>
      {splitByField === '__themes__' && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.textMute, cursor: 'pointer' }}>
          <input type="checkbox" checked={showAllKPI} onChange={function() { setShowAllKPI(function(v) { return !v }) }} style={{ accentColor: T.accent }} />
          Show all
        </label>
        {!showAllKPI && (
          <span style={{ fontSize: 10, color: T.textFaint }}>Themes below 3% hidden</span>
        )}
      </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
        {stats.map(function(s) {
          var pctB = totalNB > 0 ? Math.round(s.n / totalNB * 100) : 0
          var si = stats.indexOf(s)
          return <GaugeCard key={s.label} label={s.label + ' (' + pctB + '%)'} avg={s.avg} median={s.median} min={stats.reduce(function(m, x) { return Math.min(m, x.min) }, Infinity)} max={stats.reduce(function(m, x) { return Math.max(m, x.max) }, -Infinity)} n={s.n} overallAvg={overallAvg} accentColor={bulletPal[si % bulletPal.length]} />
        })}
      </div>
    </div>
  )
}

function ScoreDriverInner({ datasetId, scoreField, schema, groupByField, colors }: { datasetId: string; scoreField: string; schema: SchemaField[]; groupByField: string; colors?: string[] }) {
  var pal = colors || CHART_COLORS
  var { rows, loaded } = useChartRows(datasetId, _enrichCtx.enrichKey || 0)
  var [minN, setMinN] = useState(3)
  var [sortBy, setSortBy] = useState<'delta' | 'count'>('delta')
  var [mode, setMode] = useState<'delta' | 'regression'>('delta')
  var [regressionResults, setRegressionResults] = useState<any[]>([]) // one per OE field
  var [combinedResult, setCombinedResult] = useState<any>(null)

  var themeModel = _enrichCtx.themeModel
  var hasThemes = themeModel && themeModel.themes && themeModel.themes.length > 0

  // OE fields available for regression
  var oeFields = schema.filter(function(f) { return f.type === 'open-ended' })
  var [selectedOE, setSelectedOE] = useState<Set<string>>(new Set(oeFields.map(function(f) { return f.field })))

  // Run regression per OE field + combined when mode switches
  useEffect(function() {
    if (mode !== 'regression' || !loaded || !hasThemes || selectedOE.size === 0) { setRegressionResults([]); setCombinedResult(null); return }
    var { computeThemeImpact } = require('@/lib/themeImpact')
    var themeInput = themeModel.themes.map(function(t: any) { return { id: t.id || '', name: t.name || '', keywords: t.keywords || [] } })
    var scoreFieldObj = schema.find(function(f) { return f.field === scoreField })
    var oeArr = Array.from(selectedOE)

    // Per-field regressions
    var perField: any[] = []
    for (var oi = 0; oi < oeArr.length; oi++) {
      var fieldObj = schema.find(function(f) { return f.field === oeArr[oi] })
      var r = computeThemeImpact({
        themes: themeInput, rows: rows, scoreField: scoreField,
        textFields: [oeArr[oi]], scoreRemapping: scoreFieldObj?.remapping,
      }, fieldObj?.label || oeArr[oi])
      if (r) perField.push(r)
    }
    setRegressionResults(perField)

    // Combined regression (all OE fields together)
    if (oeArr.length > 1) {
      var combined = computeThemeImpact({
        themes: themeInput, rows: rows, scoreField: scoreField,
        textFields: oeArr, scoreRemapping: scoreFieldObj?.remapping,
      }, 'Combined')
      setCombinedResult(combined)
    } else {
      setCombinedResult(null)
    }
  }, [mode, loaded, selectedOE, scoreField])

  if (!loaded) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, padding: 40 }}><LottieLoader size={120} message="Loading chart data\u2026" /></div>

  var groupField = groupByField || (hasThemes ? '__themes__' : '')
  if (!groupField) return <EmptyChart msg="Add themes in TextMine, or assign a categorical 'Group by' field to see score drivers." />

  // Compute overall average
  var allScores: number[] = []
  rows.forEach(function(r) {
    var score = parseFloat(String(r[scoreField] || '').replace(/,/g, ''))
    if (isNaN(score)) return
    allScores.push(score)
  })

  if (!allScores.length) return <EmptyChart msg="No numeric data in the selected score field." />

  var overallAvg = allScores.reduce(function(a, b) { return a + b }, 0) / allScores.length
  var scoreLabel = schema.find(function(f) { return f.field === scoreField })?.label || scoreField

  // Compute mean delta — per OE field if multiple selected and themes available
  var oeArr = Array.from(selectedOE)
  var perFieldDeltas: { fieldLabel: string; stats: { name: string; avg: number; n: number; delta: number }[] }[] = []

  if (hasThemes && oeArr.length > 0) {
    // Build keyword regexes for theme matching
    var { expandLemma } = require('@/lib/lemmas')
    var buildKwRe = function(kw: string) {
      var forms = expandLemma(kw)
      var seen: Record<string, boolean> = {}; var alts: string[] = []
      for (var i = 0; i < forms.length; i++) { var alt = forms[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\w*'; if (!seen[alt]) { seen[alt] = true; alts.push(alt) } }
      var esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\w*'; if (!seen[esc]) alts.push(esc)
      return new RegExp('(?<![a-z])(?:' + alts.join('|') + ')', 'i')
    }
    var themeRegexes = themeModel.themes.map(function(t: any) { return (t.keywords || []).filter(Boolean).map(buildKwRe) })

    for (var fi = 0; fi < oeArr.length; fi++) {
      var oeFld = oeArr[fi]
      var fldObj = schema.find(function(f) { return f.field === oeFld })
      var fldLabel = fldObj?.label || oeFld
      var themeScores: Record<string, number[]> = {}
      themeModel.themes.forEach(function(t: any) { themeScores[t.name] = [] })

      rows.forEach(function(r: any) {
        var score = parseFloat(String(r[scoreField] || '').replace(/,/g, ''))
        if (isNaN(score)) return
        var text = String(r[oeFld] || '').toLowerCase().trim()
        if (!text) return
        for (var ti = 0; ti < themeModel.themes.length; ti++) {
          if (themeRegexes[ti].length > 0 && themeRegexes[ti].some(function(re: RegExp) { return re.test(text) })) {
            themeScores[themeModel.themes[ti].name].push(score)
          }
        }
      })

      var fieldStats = Object.entries(themeScores)
        .filter(function(e) { return e[1].length >= minN })
        .map(function(e) {
          var avg = e[1].reduce(function(a, b) { return a + b }, 0) / e[1].length
          return { name: e[0], avg: avg, n: e[1].length, delta: avg - overallAvg }
        })
      perFieldDeltas.push({ fieldLabel: fldLabel, stats: fieldStats })
    }
  }

  // Fallback: original groupField-based delta (for non-theme groupBy)
  var groups: Record<string, number[]> = {}
  if (!hasThemes || oeArr.length === 0) {
    rows.forEach(function(r) {
      var score = parseFloat(String(r[scoreField] || '').replace(/,/g, ''))
      if (isNaN(score)) return
      var grp = String(r[groupField] || '').trim()
      if (!grp || grp === 'Unclassified') return
      if (!groups[grp]) groups[grp] = []
      groups[grp].push(score)
    })
  }

  var stats = hasThemes && perFieldDeltas.length > 0
    ? perFieldDeltas[0].stats.map(function(s) { return { ...s, median: 0, themeColor: null } })
    : Object.entries(groups)
      .map(function(entry) {
        var name = entry[0], scores = entry[1]
        var avg = scores.reduce(function(a, b) { return a + b }, 0) / scores.length
        return { name: name, avg: avg, median: 0, n: scores.length, delta: avg - overallAvg, themeColor: null }
      })
      .filter(function(s) { return s.n >= minN })

  if (!stats.length && perFieldDeltas.every(function(d) { return d.stats.length === 0 })) return <EmptyChart msg={'No groups with ' + minN + '+ responses. Lower the min filter.'} />

  var chartData = stats
  var xLabel = '\u0394 vs overall avg (' + overallAvg.toFixed(1) + ')'
  var xFormat = '+.2f'
  var rInfo = ''
  var isGrouped = false
  var traces: any[] = []
  var maxAbs = 0.1
  var xPad = 0.1

  var useRegression = mode === 'regression' && regressionResults.length > 0

  // Mean delta with multiple OE fields — grouped bars
  if (!useRegression && perFieldDeltas.length > 1) {
    isGrouped = true
    var fieldColors = pal.slice(0, 4)
    var allNames = new Set<string>()
    perFieldDeltas.forEach(function(fd) { fd.stats.forEach(function(s) { allNames.add(s.name) }) })
    var themeNames = Array.from(allNames)
    themeNames.sort(function(a, b) {
      var maxA = 0, maxB = 0
      perFieldDeltas.forEach(function(fd) {
        var sa = fd.stats.find(function(s) { return s.name === a })
        var sb = fd.stats.find(function(s) { return s.name === b })
        if (sa) maxA = Math.max(maxA, Math.abs(sa.delta))
        if (sb) maxB = Math.max(maxB, Math.abs(sb.delta))
      })
      return maxA - maxB
    })

    perFieldDeltas.forEach(function(fd, fi) {
      var deltas = themeNames.map(function(tn) {
        var s = fd.stats.find(function(st) { return st.name === tn })
        return s ? parseFloat(s.delta.toFixed(3)) : 0
      })
      deltas.forEach(function(d) { if (Math.abs(d) > maxAbs) maxAbs = Math.abs(d) })
      traces.push({
        type: 'bar' as const, orientation: 'h' as const,
        y: themeNames, x: deltas, name: fd.fieldLabel,
        marker: { color: fieldColors[fi % fieldColors.length] },
        text: deltas.map(function(d) { return (d >= 0 ? '+' : '') + d.toFixed(1) }),
        textposition: 'outside' as const, textfont: { size: 9 },
        hovertemplate: '<b>%{y}</b><br>\u0394: %{x:+.2f}<br>' + fd.fieldLabel + '<extra></extra>',
      })
    })
    xFormat = '+.1f'
    chartData = themeNames.map(function(n) { return { name: n, avg: 0, median: 0, n: 0, delta: 0, themeColor: null } })
    xPad = maxAbs * 0.4
  } else if (useRegression && regressionResults.length > 1) {
    // Grouped bars — one trace per OE field
    isGrouped = true
    var fieldColors = pal.slice(0, 4)
    // Collect all theme names across all regressions
    var allNames = new Set<string>()
    regressionResults.forEach(function(r: any) { r.impacts.forEach(function(imp: any) { allNames.add(imp.themeName) }) })
    var themeNames = Array.from(allNames)
    // Sort by absolute max coefficient across fields
    themeNames.sort(function(a, b) {
      var maxA = 0, maxB = 0
      regressionResults.forEach(function(r: any) {
        var ia = r.impacts.find(function(i: any) { return i.themeName === a })
        var ib = r.impacts.find(function(i: any) { return i.themeName === b })
        if (ia) maxA = Math.max(maxA, Math.abs(ia.coefficient))
        if (ib) maxB = Math.max(maxB, Math.abs(ib.coefficient))
      })
      return maxA - maxB
    })

    var maxAbs = 0.1
    regressionResults.forEach(function(r: any, ri: number) {
      var coeffs = themeNames.map(function(tn) {
        var imp = r.impacts.find(function(i: any) { return i.themeName === tn })
        return imp ? imp.coefficient : 0
      })
      coeffs.forEach(function(c) { if (Math.abs(c) > maxAbs) maxAbs = Math.abs(c) })
      var baseColor = fieldColors[ri % fieldColors.length]
      var barOpacities = coeffs.map(function(c, ci) {
        var imp = r.impacts.find(function(i: any) { return i.themeName === themeNames[ci] })
        return imp && imp.significant ? 1.0 : 0.3
      })
      traces.push({
        type: 'bar' as const, orientation: 'h' as const,
        y: themeNames, x: coeffs, name: r.fieldLabel || ('Field ' + (ri + 1)),
        marker: { color: baseColor, opacity: barOpacities },
        text: coeffs.map(function(c) { return (c >= 0 ? '+' : '') + c.toFixed(1) }),
        textposition: 'outside' as const, textfont: { size: 9 },
        hovertemplate: '<b>%{y}</b><br>Coefficient: %{x:+.2f}<br>' + (r.fieldLabel || '') + '<extra></extra>',
      })
    })
    xLabel = 'Regression coefficient (impact on ' + scoreLabel + ')'
    xFormat = '+.1f'
    rInfo = regressionResults.map(function(r: any) {
      return (r.fieldLabel || '?') + ': R\u00B2=' + (r.rSquared * 100).toFixed(0) + '%'
    }).join('  \u00B7  ') + '  \u00B7  n=' + (regressionResults[0]?.n || 0).toLocaleString()

    chartData = themeNames.map(function(n) { return { name: n, avg: 0, median: 0, n: 0, delta: 0, themeColor: null } })
    xPad = maxAbs * 0.4

  } else if (useRegression) {
    // Single OE field — single trace
    var singleResult = regressionResults[0]
    chartData = singleResult.impacts.map(function(imp: any) {
      return { name: imp.themeName, delta: imp.coefficient, n: imp.mentions, avg: imp.avgScore || 0, significant: imp.significant }
    })
    xLabel = 'Regression coefficient (impact on ' + scoreLabel + ')'
    xFormat = '+.1f'
    rInfo = 'R\u00B2 = ' + (singleResult.rSquared * 100).toFixed(1) + '%  \u00B7  n = ' + singleResult.n.toLocaleString() + '  \u00B7  baseline = ' + singleResult.intercept.toFixed(1)
  }

  if (!isGrouped) {
    if (sortBy === 'delta') chartData.sort(function(a: any, b: any) { return a.delta - b.delta })
    else chartData.sort(function(a: any, b: any) { return a.n - b.n })

    maxAbs = chartData.reduce(function(m: number, s: any) { return Math.max(m, Math.abs(s.delta)) }, 0) || 1

    var names = chartData.map(function(s: any) { return s.name })
    var deltas = chartData.map(function(s: any) { return parseFloat(s.delta.toFixed(3)) })
    var barClrs = chartData.map(function(s: any) {
      var sig = useRegression ? (s.significant !== false) : true
      var intensity = sig ? Math.min(1, 0.45 + (Math.abs(s.delta) / maxAbs) * 0.55) : 0.25
      return s.delta >= 0
        ? 'rgba(22,163,74,' + intensity + ')'
        : 'rgba(220,38,38,' + intensity + ')'
    })

    traces = [{
      type: 'bar' as const, y: names, x: deltas, orientation: 'h' as const,
      marker: { color: barClrs, line: { width: 0 } },
      text: chartData.map(function(s: any) {
        var label = (s.delta >= 0 ? '+' : '') + s.delta.toFixed(1)
        if (useRegression && s.significant === false) label += ' (ns)'
        else if (useRegression) label += ' *'
        return label + '  n=' + s.n
      }),
      textposition: 'outside' as const, textfont: { size: 10 },
      hovertemplate: '<b>%{y}</b><br>' + (useRegression ? 'Coefficient' : 'Delta') + ': %{x:+.1f}<extra></extra>',
    }]
    xPad = maxAbs * 0.35
  }

  var layout: any = {
    xaxis: { title: xLabel, range: [-(maxAbs + (xPad || maxAbs * 0.35)), maxAbs + (xPad || maxAbs * 0.35)], zeroline: true, zerolinewidth: 2, zerolinecolor: T.textMid, tickformat: xFormat },
    yaxis: { automargin: true },
    margin: { t: 20, r: 100, b: 60, l: 20 },
    barmode: isGrouped ? 'group' : undefined,
    legend: isGrouped ? { orientation: 'h' as const, y: -0.15 } : undefined,
    shapes: [{ type: 'line' as const, x0: 0, x1: 0, y0: -0.5, y1: chartData.length - 0.5, line: { color: T.textMid, width: 1.5, dash: 'dash' as const } }],
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: T.textMute }}>Mode:</span>
          {([['delta', 'Mean Delta'], ['regression', 'Regression']] as [string, string][]).map(function(pair) {
            return <button key={pair[0]} onClick={function() { setMode(pair[0] as any) }}
              style={{ padding: '2px 9px', fontSize: 11, borderRadius: 20, border: '1px solid ' + (mode === pair[0] ? T.accent : T.border), background: mode === pair[0] ? T.accentBg : 'transparent', color: mode === pair[0] ? T.accent : T.textMid, cursor: 'pointer', fontWeight: mode === pair[0] ? 700 : 400 }}>
              {pair[1]}
            </button>
          })}
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: T.textMute }}>Min:</span>
          {[1, 3, 5, 10].map(function(v) {
            return <button key={v} onClick={function() { setMinN(v) }}
              style={{ padding: '2px 9px', fontSize: 11, borderRadius: 20, border: '1px solid ' + (minN === v ? T.accent : T.border), background: minN === v ? T.accentBg : 'transparent', color: minN === v ? T.accent : T.textMid, cursor: 'pointer', fontWeight: minN === v ? 700 : 400 }}>
              {v}+
            </button>
          })}
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: T.textMute }}>Sort:</span>
          {([['delta', 'By impact'], ['count', 'By volume']] as [string, string][]).map(function(pair) {
            return <button key={pair[0]} onClick={function() { setSortBy(pair[0] as any) }}
              style={{ padding: '2px 9px', fontSize: 11, borderRadius: 20, border: '1px solid ' + (sortBy === pair[0] ? T.accent : T.border), background: sortBy === pair[0] ? T.accentBg : 'transparent', color: sortBy === pair[0] ? T.accent : T.textMid, cursor: 'pointer', fontWeight: sortBy === pair[0] ? 700 : 400 }}>
              {pair[1]}
            </button>
          })}
        </div>
        <span style={{ fontSize: 11, color: T.textFaint, marginLeft: 'auto' }}>
          {chartData.length} group{chartData.length !== 1 ? 's' : ''} {'\u00B7'} {allScores.length.toLocaleString()} responses {'\u00B7'} overall avg {overallAvg.toFixed(1)}
        </span>
      </div>

      {/* OE field selector — shown when themes exist and multiple OE fields available */}
      {hasThemes && oeFields.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: T.textMute }}>Text fields:</span>
          {oeFields.map(function(f) {
            var active = selectedOE.has(f.field)
            return <button key={f.field} onClick={function() {
              var next = new Set(selectedOE)
              if (active) next.delete(f.field); else next.add(f.field)
              if (next.size > 0) setSelectedOE(next)
            }}
              style={{ padding: '2px 9px', fontSize: 10, borderRadius: 20, border: '1px solid ' + (active ? '#93C5FD' : T.border), background: active ? '#EFF6FF' : 'transparent', color: active ? '#1E40AF' : T.textMid, cursor: 'pointer', fontWeight: active ? 700 : 400 }}>
              {active ? '\u2713 ' : ''}{f.label || f.field}
            </button>
          })}
        </div>
      )}

      {/* R² info for regression mode */}
      {mode === 'regression' && rInfo && (
        <div style={{ fontSize: 11, color: '#1E40AF', background: '#EFF6FF', border: '1px solid #93C5FD', borderRadius: 8, padding: '6px 12px', marginBottom: 10 }}>
          {rInfo}
        </div>
      )}

      <PlotlyChart
        traces={traces}
        layout={layout}
        style={{ height: Math.max(320, chartData.length * 38 + 110), width: '100%' }}
      />
      <div style={{ display: 'flex', gap: 20, justifyContent: 'center', fontSize: 10, color: T.textMute, marginTop: 6 }}>
        {!useRegression && !isGrouped && (
          <>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(22,163,74,.8)', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} />Drives score up</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(220,38,38,.8)', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} />Drives score down</span>
            <span>Dashed line = overall avg ({overallAvg.toFixed(1)})</span>
          </>
        )}
        {!useRegression && isGrouped && (
          <span>Bars show {'\u0394'} from overall avg ({overallAvg.toFixed(1)}) {'\u00B7'} Left of zero = below avg {'\u00B7'} Right = above avg</span>
        )}
        {useRegression && (
          <>
            <span>Bars left of zero = lowers score {'\u00B7'} right of zero = raises score</span>
            <span>Faded = not significant (p{'>'}0.05)</span>
          </>
        )}
      </div>

      {/* Plain language + expert summaries */}
      {(function() {
        var sorted = chartData.slice().sort(function(a: any, b: any) { return Math.abs(b.delta) - Math.abs(a.delta) })
        var topPos = sorted.find(function(s: any) { return s.delta > 0 })
        var topNeg = sorted.find(function(s: any) { return s.delta < 0 })
        var sigCount = useRegression ? chartData.filter(function(s: any) { return s.significant }).length : 0

        // Plain language
        var plain: string[] = []
        if (topPos) plain.push('"' + topPos.name + '" has the strongest positive impact on ' + scoreLabel + ' (' + (topPos.delta >= 0 ? '+' : '') + topPos.delta.toFixed(1) + ' points).')
        if (topNeg) plain.push('"' + topNeg.name + '" is the biggest detractor (' + topNeg.delta.toFixed(1) + ' points).')
        if (useRegression && regressionResults.length > 0) {
          var r2 = isGrouped ? regressionResults[0].rSquared : (regressionResults[0]?.rSquared || 0)
          plain.push('Together, the themes explain ' + Math.round(r2 * 100) + '% of the variation in ' + scoreLabel + '.')
        }

        // Expert
        var expert = ''
        if (useRegression && regressionResults.length > 0) {
          var r = regressionResults[0]
          expert = 'OLS regression (n=' + (r.n || 0).toLocaleString() + ', R\u00B2=' + (r.rSquared * 100).toFixed(1) + '%). ' + sigCount + ' of ' + chartData.length + ' predictors significant at \u03B1=0.05.'
          if (topPos) expert += ' Largest positive: ' + topPos.name + ' (\u03B2=' + (topPos.delta >= 0 ? '+' : '') + topPos.delta.toFixed(2) + ').'
          if (topNeg) expert += ' Largest negative: ' + topNeg.name + ' (\u03B2=' + topNeg.delta.toFixed(2) + ').'
        }

        if (!plain.length && !expert) return null

        return (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {plain.length > 0 && (
              <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#15803D', marginBottom: 4 }}>PLAIN LANGUAGE</div>
                <div style={{ fontSize: 12, color: '#166534', lineHeight: 1.5 }}>{plain.join(' ')}</div>
              </div>
            )}
            {expert && (
              <div style={{ background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#6D28D9', marginBottom: 4 }}>TECHNICAL</div>
                <div style={{ fontSize: 11, color: '#4C1D95', lineHeight: 1.5, fontFamily: 'monospace' }}>{expert}</div>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}

function ScatterChartInner({ analytics, schema, datasetId, xField, yField }: { analytics: Analytics; schema: SchemaField[]; datasetId: string; xField: string; yField: string }) {
  var { rows, loaded } = useChartRows(datasetId, _enrichCtx.enrichKey || 0)
  if (!loaded) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, padding: 40 }}><LottieLoader size={120} message="Loading chart data\u2026" /></div>
  var x: number[] = [], y: number[] = []
  rows.forEach(function(r) { var xv = parseFloat(String(r[xField] || '')), yv = parseFloat(String(r[yField] || '')); if (!isNaN(xv) && !isNaN(yv)) { x.push(xv); y.push(yv) } })
  if (!x.length) return <EmptyChart msg="No numeric pairs found." />
  var xSum = analytics.fieldSummaries[xField]
  var ySum = analytics.fieldSummaries[yField]
  var intX = isSmallIntRange(xSum?.min, xSum?.max)
  var intY = isSmallIntRange(ySum?.min, ySum?.max)
  return <PlotlyChart traces={[{ x: x, y: y, mode: 'markers', type: 'scatter', marker: { color: T.accent, size: 6, opacity: 0.6 } }]} layout={{ title: flByName(xField, schema) + ' vs ' + flByName(yField, schema), xaxis: { title: flByName(xField, schema), ...(intX ? { dtick: 1, tick0: xSum?.min } : {}) }, yaxis: { title: flByName(yField, schema), ...(intY ? { dtick: 1, tick0: ySum?.min } : {}) }, showlegend: false }} />
}

function CrosstabInner({ analytics, schema, datasetId, rowField, colField }: { analytics: Analytics; schema: SchemaField[]; datasetId: string; rowField: string; colField: string }) {
  var isCollection = _enrichCtx.datasetSource === 'collection'
  var needsRows = isCollection || rowField.startsWith('__') || colField.startsWith('__')
  var aggSpec = !needsRows && rowField && colField ? { op: 'crosstab', rowField: rowField, colField: colField, limit: 30 } : null
  var { data: aggData, loaded: aggLoaded } = useAggregation(datasetId, aggSpec)
  var { rows, loaded: rowsLoaded } = useChartRows(datasetId, needsRows ? (_enrichCtx.enrichKey || 0) : -1)
  var loaded = needsRows ? rowsLoaded : aggLoaded
  if (!loaded) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, padding: 40 }}><LottieLoader size={120} message="Loading chart data\u2026" /></div>
  var grid: Record<string, Record<string, number>> = {}; var rSet = new Set<string>(); var cSet = new Set<string>()
  if (!needsRows && aggData && aggData.grid) {
    grid = aggData.grid
    ;(aggData.rows || []).forEach(function(r: string) { rSet.add(r) })
    ;(aggData.cols || []).forEach(function(c: string) { cSet.add(c) })
  } else {
    rows.forEach(function(r) { var rv = String(r[rowField] || '').trim(), cv = String(r[colField] || '').trim(); if (!rv || !cv) return; rSet.add(rv); cSet.add(cv); if (!grid[rv]) grid[rv] = {}; grid[rv][cv] = (grid[rv][cv] || 0) + 1 })
  }
  var rowFieldObj = schema.find(function(f) { return f.field === rowField })
  var colFieldObj = schema.find(function(f) { return f.field === colField })
  var rArr = smartOrder(Array.from(rSet), rowFieldObj?.remapping)
  var cArr = smartOrder(Array.from(cSet), colFieldObj?.remapping)
  var z = rArr.map(function(r) { return cArr.map(function(c) { return grid[r] ? (grid[r][c] || 0) : 0 }) })
  var rLabels = wrapLabels(rArr.map(function(v) { return resolveAlias(rowField, v, schema) }), 22)
  var cLabels = wrapLabels(cArr.map(function(v) { return resolveAlias(colField, v, schema) }), 18)
  return <PlotlyChart traces={[{ type: 'heatmap', x: cLabels, y: rLabels, z: z, colorscale: 'YlOrRd', showscale: true }]} layout={{ title: flByName(rowField, schema) + ' \u00D7 ' + flByName(colField, schema), xaxis: { title: flByName(colField, schema), ...catXAxis(cLabels) }, yaxis: { title: flByName(rowField, schema) }, margin: { t: 48, r: 60, b: 60, l: 100 } }} />
}

function TimeSeriesInner({ analytics, schema, datasetId, dateField, metricField, colorByField, colors }: { analytics: Analytics; schema: SchemaField[]; datasetId: string; dateField: string; metricField: string; colorByField?: string; colors?: string[] }) {
  var [bucketOverride, setBucketOverride] = useState<TimeBucket | 'auto'>('auto')
  var [splitMode, setSplitMode] = useState(false)
  var pal = colors || CHART_COLORS

  // Determine smart bucket from field summary date counts
  var dateSummary = analytics?.fieldSummaries?.[dateField]
  var dateCounts = dateSummary?.counts || {}
  var dateKeys = Object.keys(dateCounts).sort()
  var smartBucket: TimeBucket = 'day'
  if (dateKeys.length >= 2) {
    smartBucket = autoBucket(dateKeys[0], dateKeys[dateKeys.length - 1])
  }
  // hour bucket not supported in SQL function — fall back to day
  var effectiveBucket: TimeBucket = bucketOverride === 'auto' ? smartBucket : bucketOverride
  var sqlBucket: string = effectiveBucket === 'hour' ? 'day' : effectiveBucket

  var isCollection = _enrichCtx.datasetSource === 'collection'
  var aggSpec = !isCollection && dateField ? { op: 'date_series', dateField: dateField, metricField: metricField || null, bucket: sqlBucket } : null
  var { data: aggData, loaded: aggLoaded } = useAggregation(datasetId, aggSpec)
  var useRowsFallback = isCollection || !aggLoaded || !(aggData?.series)
  var { rows, loaded: rowsLoaded } = useChartRows(datasetId, useRowsFallback ? (_enrichCtx.enrichKey || 0) : -1)
  var loaded = isCollection ? rowsLoaded : (aggLoaded && aggData?.series ? true : rowsLoaded)
  var [smooth, setSmooth] = useState(false)
  var [window, setWindow] = useState(7)
  if (!loaded) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, padding: 40 }}><LottieLoader size={120} message="Loading chart data\u2026" /></div>

  // ── Build traces — with optional categorical breakdown ──────────────
  var traces: any[] = []
  var hasBreakdown = !!(colorByField && colorByField.trim())

  // Pre-compute breakdown groups (used by both combined and split modes)
  var catGroups: Record<string, Record<string, number[]>> = {}
  var sortedDates: string[] = []
  var catNames: string[] = []

  if (hasBreakdown) {
    // Group rows by category value, then by bucketed date
    var allDates = new Set<string>()
    rows.forEach(function(r) {
      var raw = String(r[dateField] || ''); if (!raw) return
      var d = bucketKey(raw, effectiveBucket)
      var cat = String(r[colorByField!] || '(blank)')
      allDates.add(d)
      if (!catGroups[cat]) catGroups[cat] = {}
      if (!catGroups[cat][d]) catGroups[cat][d] = []
      if (metricField) { var v = parseFloat(String(r[metricField] || '')); if (!isNaN(v)) catGroups[cat][d].push(v) } else { catGroups[cat][d].push(1) }
    })
    sortedDates = Array.from(allDates).sort()
    catNames = Object.keys(catGroups).sort()
    catNames.forEach(function(cat, ci) {
      var yVals = sortedDates.map(function(d) {
        var arr = catGroups[cat][d]
        if (!arr || arr.length === 0) return 0
        return metricField ? arr.reduce(function(a, b) { return a + b }, 0) / arr.length : arr.length
      })
      traces.push({ x: sortedDates, y: yVals, type: 'scatter', mode: 'lines+markers', line: { color: pal[ci % pal.length], width: 2 }, marker: { size: 4 }, name: cat, showlegend: true })
    })
  } else {
    // Single line — original behavior
    var dates: string[] = []
    var yVals: number[] = []
    if (aggData && aggData.series && aggData.series.length > 0) {
      aggData.series.forEach(function(s: any) { dates.push(s.date); yVals.push(metricField ? (s.avg || 0) : s.count) })
    } else {
      var grouped: Record<string, number[]> = {}
      rows.forEach(function(r) { var raw = String(r[dateField] || ''); if (!raw) return; var d = bucketKey(raw, effectiveBucket); if (!grouped[d]) grouped[d] = []; if (metricField) { var v = parseFloat(String(r[metricField] || '')); if (!isNaN(v)) grouped[d].push(v) } else { grouped[d].push(1) } })
      dates = Object.keys(grouped).sort()
      yVals = dates.map(function(d) { var arr = grouped[d]; return metricField ? arr.reduce(function(a, b) { return a + b }, 0) / arr.length : arr.length })
    }

    // Moving average smoothing
    var smoothed = yVals
    if (smooth && yVals.length > window) {
      smoothed = yVals.map(function(_, i) {
        var start = Math.max(0, i - Math.floor(window / 2))
        var end = Math.min(yVals.length, i + Math.ceil(window / 2))
        var slice = yVals.slice(start, end)
        return slice.reduce(function(a, b) { return a + b }, 0) / slice.length
      })
    }

    if (smooth) {
      traces.push({ x: dates, y: yVals, type: 'scatter', mode: 'markers', marker: { color: T.blue, size: 4, opacity: 0.3 }, name: 'Raw', showlegend: true })
      traces.push({ x: dates, y: smoothed, type: 'scatter', mode: 'lines', line: { color: T.accent, width: 3, shape: 'spline' }, name: window + '-day avg', showlegend: true })
    } else {
      traces.push({ x: dates, y: yVals, type: 'scatter', mode: 'lines+markers', line: { color: T.blue, width: 2 }, marker: { size: 5 } })
    }
  }

  var bucketLabel = BUCKET_OPTIONS.find(function(o) { return o.value === effectiveBucket })?.label || 'Daily'

  // Build split chart data if splitMode + breakdown
  var splitCharts: { name: string; traces: any[]; color: string }[] = []
  if (hasBreakdown && splitMode && catNames.length > 0) {
    catNames.forEach(function(cat, ci) {
      var yVals = sortedDates.map(function(d) {
        var arr = catGroups[cat] ? catGroups[cat][d] : null
        if (!arr || arr.length === 0) return 0
        return metricField ? arr.reduce(function(a, b) { return a + b }, 0) / arr.length : arr.length
      })
      splitCharts.push({
        name: cat,
        color: pal[ci % pal.length],
        traces: [{ x: sortedDates, y: yVals, type: 'scatter', mode: 'lines+markers', line: { color: pal[ci % pal.length], width: 2 }, marker: { size: 4 }, showlegend: false }],
      })
    })
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10, color: T.textFaint }}>Group by:</span>
          <select value={bucketOverride} onChange={function(e) { setBucketOverride(e.target.value as any) }}
            style={{ fontSize: 10, color: T.textMid, border: '1px solid ' + T.border, borderRadius: 8, padding: '2px 6px', background: 'transparent', cursor: 'pointer' }}>
            <option value="auto">Auto ({bucketLabel})</option>
            {BUCKET_OPTIONS.filter(function(o) { return o.value !== 'hour' }).map(function(o) {
              return <option key={o.value} value={o.value}>{o.label}</option>
            })}
          </select>
        </div>
        {hasBreakdown && (
          <div style={{ display: 'flex', background: T.bg, borderRadius: 12, padding: 2, border: '1px solid ' + T.border }}>
            {[['combined', 'Combined'], ['split', 'Split']].map(function(pair) {
              var isSplit = pair[0] === 'split'
              var active = splitMode === isSplit
              return <button key={pair[0]} onClick={function() { setSplitMode(isSplit) }}
                style={{ fontSize: 10, fontWeight: active ? 700 : 500, padding: '2px 10px', borderRadius: 10, background: active ? T.bgCard : 'transparent', color: active ? T.text : T.textMute, border: 'none', cursor: 'pointer' }}>
                {pair[1]}
              </button>
            })}
          </div>
        )}
        {!hasBreakdown && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.textMute, cursor: 'pointer' }}>
            <input type="checkbox" checked={smooth} onChange={function() { setSmooth(function(v) { return !v }) }} style={{ accentColor: T.accent }} />
            Smooth curve
          </label>
        )}
        {!hasBreakdown && smooth && (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: T.textFaint }}>Window:</span>
            {[3, 7, 14, 30].map(function(w) {
              return <button key={w} onClick={function() { setWindow(w) }}
                style={{ padding: '2px 8px', fontSize: 10, borderRadius: 12, border: '1px solid ' + (window === w ? T.accent : T.border), background: window === w ? T.accentBg : 'transparent', color: window === w ? T.accent : T.textMid, cursor: 'pointer', fontWeight: window === w ? 700 : 400 }}>
                {w}d
              </button>
            })}
          </div>
        )}
      </div>
      {hasBreakdown && splitMode && splitCharts.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {splitCharts.map(function(sc) {
            return (
              <div key={sc.name} style={{ border: '1px solid ' + T.border, borderRadius: 10, padding: '10px 12px', background: T.bgCard }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: sc.color, marginBottom: 4 }}>{sc.name}</div>
                <PlotlyChart traces={sc.traces} layout={{
                  xaxis: { title: '', tickfont: { size: 9 } },
                  yaxis: { title: metricField ? 'Avg' : 'Count', titlefont: { size: 10 }, tickfont: { size: 9 } },
                  height: 200, margin: { t: 10, b: 40, l: 40, r: 10 },
                }} />
              </div>
            )
          })}
        </div>
      ) : (
        <PlotlyChart traces={traces} layout={{ title: metricField ? flByName(metricField, schema) + ' over Time' : flByName(dateField, schema), xaxis: { title: flByName(dateField, schema) }, yaxis: { title: metricField ? 'Avg ' + flByName(metricField, schema) : 'Count' }, legend: { orientation: 'h' as const, y: -0.15 } }} />
      )}
    </div>
  )
}

function GanttInner({ analytics, schema, datasetId, catField, rangeField }: { analytics: Analytics; schema: SchemaField[]; datasetId: string; catField: string; rangeField: string }) {
  var { rows, loaded } = useChartRows(datasetId, _enrichCtx.enrichKey || 0)
  if (!loaded) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, padding: 40 }}><LottieLoader size={120} message="Loading chart data\u2026" /></div>
  var groups: Record<string, number[]> = {}
  rows.forEach(function(r) { var c = String(r[catField] || '').trim(); var v = parseFloat(String(r[rangeField] || '')); if (c && !isNaN(v)) { if (!groups[c]) groups[c] = []; groups[c].push(v) } })
  var ganttFieldObj = schema.find(function(f) { return f.field === catField })
  var catArr = smartOrder(Object.keys(groups), ganttFieldObj?.remapping); var mins = catArr.map(function(c) { return Math.min.apply(null, groups[c]) }); var ranges = catArr.map(function(c) { return Math.max.apply(null, groups[c]) - Math.min.apply(null, groups[c]) })
  return <PlotlyChart traces={[{ type: 'bar', orientation: 'h' as const, y: catArr, x: mins, marker: { color: 'rgba(0,0,0,0)' }, showlegend: false, hoverinfo: 'skip' as const }, { type: 'bar', orientation: 'h' as const, y: catArr, x: ranges, marker: { color: CHART_COLORS.slice(0, catArr.length) }, name: 'Range' }]} layout={{ title: flByName(catField, schema), barmode: 'stack', xaxis: { title: flByName(rangeField, schema) }, showlegend: false, margin: { l: 120 } }} />
}

function TableInner({ analytics, schema, datasetId }: { analytics: Analytics; schema: SchemaField[]; datasetId: string }) {
  var { rows: allRows, loaded } = useChartRows(datasetId, _enrichCtx.enrichKey || 0)
  var [page, setPage] = useState(0)
  var PAGE = 50
  if (!loaded) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, padding: 40 }}><LottieLoader size={120} message="Loading chart data\u2026" /></div>
  var total = allRows.length
  var rows = allRows.slice(page * PAGE, (page + 1) * PAGE)
  // Use allFields from enrichment context — includes __themes__ and __mapped__
  var virtualFields: SchemaField[] = []
  if (_enrichCtx.themeModel?.themes?.length) virtualFields.push({ field: '__themes__', type: 'categorical', label: 'Themes' })
  ;(_enrichCtx.schema?.fields || []).forEach(function(f) {
    if (f.type === 'categorical' && f.remapping && Object.keys(f.remapping).length > 0) {
      virtualFields.push({ field: '__mapped_' + f.field + '__', type: 'numeric', label: (f.label || f.field) })
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

export default function ChartsModule({ datasetId, schema, analytics, themeModel, datasetSource }: Props) {
  var rawOpenFields = schema.fields.filter(function(f) { return f.type === 'open-ended' })
  var _themeKey = 'chartTheme_' + datasetId
  var _savedTheme = readSession<any>(_themeKey)
  var [themeSourceField, setThemeSourceField] = useState(function() { return _savedTheme?.themeSourceField || (themeModel && themeModel.fieldName) || rawOpenFields[0]?.field || '' })
  var [activeThemeNames, setActiveThemeNames] = useState<Set<string> | null>(function() { return _savedTheme?.activeThemeNames ? new Set(_savedTheme.activeThemeNames) : null })
  var [enrichKey, setEnrichKey] = useState(0)

  useEffect(function() {
    writeSession(_themeKey, { themeSourceField: themeSourceField, activeThemeNames: activeThemeNames ? Array.from(activeThemeNames) : null })
  }, [themeSourceField, activeThemeNames, _themeKey])

  // Set enrichment context for useRows — must be before any inner component renders
  _enrichCtx = { themeModel: themeModel, schema: schema, enrichKey: enrichKey, themeSourceOverride: themeSourceField || undefined, activeThemeNames: activeThemeNames, datasetSource: datasetSource }

  var [activeChart, setActiveChart] = useState(function() { return readSession<string>('activeChart_' + datasetId) || 'bar' })
  useEffect(function() { writeSession('activeChart_' + datasetId, activeChart) }, [activeChart, datasetId])
  var [hovered, setHovered] = useState<string | null>(null)
  // Display options — restore from sessionStorage
  var _displayKey = 'chartDisplay_' + datasetId
  var _savedDisplay = readSession<any>(_displayKey)
  var [barMode, setBarMode] = useState<'count' | 'percent' | 'average'>(_savedDisplay?.barMode || 'count')
  var [barStack, setBarStack] = useState(_savedDisplay?.barStack || false)
  var [barOrient, setBarOrient] = useState<'v' | 'h'>(_savedDisplay?.barOrient || 'v')
  var [smartAxes, setSmartAxes] = useState(_savedDisplay?.smartAxes !== undefined ? _savedDisplay.smartAxes : true)
  var [activePalette, setActivePalette] = useState(_savedDisplay?.activePalette || 'hermes')
  var [showPalettePicker, setShowPalettePicker] = useState(false)
  useEffect(function() {
    writeSession(_displayKey, { barMode: barMode, barStack: barStack, barOrient: barOrient, smartAxes: smartAxes, activePalette: activePalette })
  }, [barMode, barStack, barOrient, smartAxes, activePalette, _displayKey])
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
    allFields = allFields.concat([{ field: '__mapped_' + f.field + '__', type: 'numeric', label: (f.label || f.field) } as any])
  })

  // Build theme counts for the virtual field
  var enrichedAnalytics = analytics
  if (analytics) {
    var extraSummaries: Record<string, any> = {}
    if (hasThemes) {
      var themeCounts: Record<string, number> = {}
      themeModel.themes
        .filter(function(t: any) { return !activeThemeNames || activeThemeNames.has(t.name || t.label) })
        .forEach(function(t: any) { themeCounts[t.name] = t.count || 0 })
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

  // Chart config state — cached per chart type, persisted in sessionStorage across module switches
  var _configKey = 'chartConfigs_' + datasetId
  var [chartConfigs, setChartConfigs] = useState<Record<string, Record<string, string>>>(function() { return readSession<Record<string, Record<string, string>>>(_configKey) || {} })
  useEffect(function() { writeSession(_configKey, chartConfigs) }, [chartConfigs, _configKey])

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

  // Smart-drop state for the chart body area
  var [bodyDragOver, setBodyDragOver] = useState(false)

  var handleBodyDrop = function(e: React.DragEvent) {
    e.preventDefault()
    setBodyDragOver(false)
    try {
      var payload = JSON.parse(e.dataTransfer.getData('text/field'))
      var target = getSmartSlot(payload.type, currentSlots, currentConfig)
      if (!target) return
      setChartConfigs(function(prev) {
        var u = Object.assign({}, prev)
        var cfg = Object.assign({}, u[activeChart] || {})
        cfg[target!.key] = payload.field
        u[activeChart] = cfg
        return u
      })
    } catch {}
    _chartDrag = null
  }

  // Download PNG (or CSV for table)
  var chartBodyRef = useRef<HTMLDivElement>(null)

  var downloadCSV = function() {
    fetch('/api/datasets/' + datasetId + '/rows?all=true')
      .then(function(r) { return r.json() })
      .then(function(data) {
        var allRows: Record<string, unknown>[] = data.rows || []
        if (!allRows.length) return
        var cols = Object.keys(allRows[0])
        var lines = [cols.join(',')]
        allRows.forEach(function(row) {
          lines.push(cols.map(function(c) {
            var v = String(row[c] ?? '')
            return v.includes(',') || v.includes('"') || v.includes('\n') ? '"' + v.replace(/"/g, '""') + '"' : v
          }).join(','))
        })
        var blob = new Blob([lines.join('\n')], { type: 'text/csv' })
        var url = URL.createObjectURL(blob)
        var a = document.createElement('a'); a.download = 'dataset.csv'; a.href = url
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
        URL.revokeObjectURL(url)
      })
  }

  var downloadSVGasPNG = function() {
    if (!chartBodyRef.current) return
    var svgEls = Array.from(chartBodyRef.current.querySelectorAll('svg')) as SVGElement[]
    if (!svgEls.length) return

    // Grid layout: max 4 columns, consistent cell size
    var COLS = Math.min(svgEls.length, 4)
    var ROWS = Math.ceil(svgEls.length / COLS)
    var CELL_W = 250, CELL_H = 265, PAD = 14, MARGIN = 20
    var scale = 2

    var totalW = MARGIN * 2 + COLS * CELL_W + (COLS - 1) * PAD
    var totalH = MARGIN * 2 + ROWS * CELL_H + (ROWS - 1) * PAD

    var canvas = document.createElement('canvas')
    canvas.width = totalW * scale; canvas.height = totalH * scale
    var ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, canvas.width, canvas.height)

    var drawRoundRect = function(x: number, y: number, w: number, h: number, rad: number) {
      ctx.beginPath(); ctx.moveTo(x + rad, y)
      ctx.lineTo(x + w - rad, y); ctx.arcTo(x + w, y, x + w, y + rad, rad)
      ctx.lineTo(x + w, y + h - rad); ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad)
      ctx.lineTo(x + rad, y + h); ctx.arcTo(x, y + h, x, y + h - rad, rad)
      ctx.lineTo(x, y + rad); ctx.arcTo(x, y, x + rad, y, rad); ctx.closePath()
    }

    var pending = svgEls.length
    svgEls.forEach(function(svgEl, idx) {
      var col = idx % COLS, row = Math.floor(idx / COLS)
      var cx = (MARGIN + col * (CELL_W + PAD)) * scale
      var cy = (MARGIN + row * (CELL_H + PAD)) * scale

      // Draw card background
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = scale
      drawRoundRect(cx, cy, CELL_W * scale, CELL_H * scale, 12 * scale)
      ctx.fill(); ctx.stroke()

      var clone = svgEl.cloneNode(true) as SVGElement
      clone.setAttribute('width', String(CELL_W)); clone.setAttribute('height', String(CELL_H))
      // Inject font-family into defs so it applies during blob render
      var svgNS = 'http://www.w3.org/2000/svg'
      var defs = clone.querySelector('defs') as Element | null
      if (!defs) { defs = document.createElementNS(svgNS, 'defs'); clone.insertBefore(defs, clone.firstChild) }
      var styleEl = document.createElementNS(svgNS, 'style')
      styleEl.textContent = 'text { font-family: system-ui, -apple-system, Arial, sans-serif; }'
      defs.insertBefore(styleEl, defs.firstChild)

      var svgStr = new XMLSerializer().serializeToString(clone)
      var blob = new Blob([svgStr], { type: 'image/svg+xml' })
      var url = URL.createObjectURL(blob)
      var img = new window.Image()
      var capX = cx, capY = cy
      img.onload = function() {
        ctx.drawImage(img, capX, capY, CELL_W * scale, CELL_H * scale)
        URL.revokeObjectURL(url)
        pending--
        if (pending === 0) {
          var a = document.createElement('a'); a.download = activeChart + '_chart.png'; a.href = canvas.toDataURL('image/png')
          document.body.appendChild(a); a.click(); document.body.removeChild(a)
        }
      }
      img.src = url
    })
  }

  var downloadPNG = function() {
    if (!chartBodyRef.current) return
    if (activeChart === 'table') { downloadCSV(); return }
    var plotDiv = chartBodyRef.current.querySelector('.js-plotly-plot') as HTMLElement
    if (plotDiv) {
      getPlotly().then(function(Plotly) {
        Plotly.downloadImage(plotDiv, { format: 'png', width: 1200, height: 700, filename: activeChart + '_chart' })
      })
      return
    }
    // Fallback for SVG-based charts (bullet/KPI gauges)
    downloadSVGasPNG()
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
            <div style={{ fontSize: 10, color: T.textFaint, fontStyle: 'italic', marginTop: 2 }}>Drag to slot or use dropdown below</div>
          </div>

          {/* Field groups — filtered to types accepted by the current chart's slots */}
          {(function() {
            var slots = CHART_SLOTS[activeChart] || []
            if (slots.length === 0) return <ChartFieldGroups fields={allFields} currentConfig={currentConfig} />
            var accepted = new Set(slots.flatMap(function(s) { return s.accepts }))
            var visible = accepted.has('any') ? allFields : allFields.filter(function(f) { return accepted.has(f.type) })
            return <ChartFieldGroups fields={visible} currentConfig={currentConfig} />
          })()}

          {/* Theme filter — at bottom of sidebar */}
          {hasThemes && (function() {
            var allThemesList: any[] = themeModel.themes || []
            return (
              <div style={{ borderTop: '1px solid ' + T.border, padding: '8px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: T.textFaint, letterSpacing: '.07em', textTransform: 'uppercase' }}>{'\uD83C\uDFF7'} Filter Themes</span>
                  <div style={{ display: 'flex', gap: 3 }}>
                    <button onClick={function() { setActiveThemeNames(null); setEnrichKey(function(k) { return k + 1 }) }}
                      style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, border: '1px solid ' + T.border, background: 'transparent', color: T.textMute, cursor: 'pointer' }}>All</button>
                    <button onClick={function() { setActiveThemeNames(new Set()); setEnrichKey(function(k) { return k + 1 }) }}
                      style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, border: '1px solid ' + T.border, background: 'transparent', color: T.textMute, cursor: 'pointer' }}>None</button>
                  </div>
                </div>
                {rawOpenFields.length > 1 && (
                  <div style={{ marginBottom: 6 }}>
                    <select value={themeSourceField} onChange={function(e) { setThemeSourceField(e.target.value); setEnrichKey(function(k) { return k + 1 }) }}
                      style={{ width: '100%', padding: '4px 8px', fontSize: 11, border: '1px solid ' + T.border, borderRadius: 6, background: T.bgCard, color: T.textMid, outline: 'none', cursor: 'pointer' }}>
                      {rawOpenFields.map(function(f) { return <option key={f.field} value={f.field}>{f.label || f.field}</option> })}
                    </select>
                  </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                  {allThemesList.map(function(t: any) {
                    var name = t.name || t.label
                    var isActive = !activeThemeNames || activeThemeNames.has(name)
                    var color = t.color || T.accent
                    return (
                      <button key={name} onClick={function() {
                        var next: Set<string>
                        if (!activeThemeNames) {
                          next = new Set(allThemesList.map(function(x: any) { return x.name || x.label }).filter(function(n: string) { return n !== name }))
                        } else {
                          next = new Set(activeThemeNames)
                          if (next.has(name)) next.delete(name); else next.add(name)
                        }
                        setActiveThemeNames(next.size === allThemesList.length ? null : next)
                        setEnrichKey(function(k) { return k + 1 })
                      }}
                      style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, border: '1px solid ' + (isActive ? color : T.border), background: isActive ? color + '22' : 'transparent', color: isActive ? color : T.textFaint, cursor: 'pointer', fontWeight: isActive ? 600 : 400, transition: 'all .1s' }}>
                        {name}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </div>

        {/* ─── Chart body ──────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}
          onDragOver={function(e) { e.preventDefault(); if (!bodyDragOver) setBodyDragOver(true) }}
          onDragLeave={function(e) { var rt = e.relatedTarget as Node | null; if (!rt || !e.currentTarget.contains(rt)) setBodyDragOver(false) }}
          onDrop={handleBodyDrop}
        >
          {/* Inline field selectors — dropdowns per slot */}
          {currentSlots.length > 0 && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              {currentSlots.map(function(slot) {
                var opts = allFields.filter(function(f) {
                  return slot.accepts.includes(f.type) || slot.accepts.includes('any')
                }).map(function(f) { return { v: f.field, l: fl(f), section: f.section || 'core' } })
                  .sort(function(a, b) { return a.l.localeCompare(b.l) })
                return <ChartSlot key={slot.key} label={slot.label} value={currentConfig[slot.key] || ''} required={slot.required}
                  accepts={slot.accepts}
                  onChange={function(v) { setChartConfigs(function(prev) { var u = Object.assign({}, prev); var cfg = Object.assign({}, u[activeChart] || {}); cfg[slot.key] = v; u[activeChart] = cfg; return u }) }}
                  options={opts} />
              })}
            </div>
          )}

          {/* Smart-drop hint banner — shown while dragging over chart body */}
          {bodyDragOver && currentSlots.length > 0 && (function() {
            var drag = _chartDrag
            if (!drag) return null
            var target = getSmartSlot(drag.type, currentSlots, currentConfig)
            if (!target) return (
              <div style={{ marginBottom: 12, padding: '8px 14px', background: '#fef2f2', border: '1.5px dashed #fca5a5', borderRadius: 8, fontSize: 12, color: '#991b1b', fontWeight: 600 }}>
                No slot accepts <strong>{drag.type}</strong> fields for this chart type
              </div>
            )
            var isReplace = !!currentConfig[target.key]
            return (
              <div style={{ marginBottom: 12, padding: '8px 14px', background: T.accentBg, border: '1.5px dashed ' + T.accent, borderRadius: 8, fontSize: 12, color: T.accent, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16 }}>↓</span>
                <span>
                  <strong>{drag.label}</strong>
                  {' '}{isReplace ? 'will replace' : 'will be assigned to'}{' '}
                  <strong>{target.label}</strong>
                  <span style={{ fontWeight: 400, color: T.textMute }}> — release to drop</span>
                </span>
              </div>
            )
          })()}

          {/* Smart Axes toggle — visible when any categorical slot is filled */}
          {hasData && currentSlots.some(function(s) { return s.accepts.includes('categorical') && currentConfig[s.key] }) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: smartAxes ? T.accent : T.textMute, cursor: 'pointer' }}>
                <input type="checkbox" checked={smartAxes} onChange={function() { setSmartAxes(function(v: boolean) { return !v }) }} style={{ accentColor: T.accent }} />
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
                {currentConfig.value && <button onClick={function() { setBarMode('average') }} style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6, background: barMode === 'average' ? T.bgCard : 'transparent', color: barMode === 'average' ? '#059669' : T.textMute, border: 'none', cursor: 'pointer', boxShadow: barMode === 'average' ? '0 1px 4px rgba(0,0,0,.08)' : 'none', fontStyle: barMode !== 'average' ? 'italic' : 'normal' }}>Average {barMode !== 'average' ? '\u2190' : ''}</button>}
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
                    {'\u2B07'} {activeChart === 'table' ? 'CSV' : 'PNG'}
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
