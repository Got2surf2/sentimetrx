'use client'
// components/analyze/ChartsModule.tsx
// Charts module with labeled drop zones, click-to-assign from sidebar, chart state caching.

import { useState, useEffect, useMemo, useRef } from 'react'
import { smartOrder, isOrdinalScale, scaleDirectionLabel, detectScale } from '@/lib/scaleUtils'
import { resolveAlias, aliasedCounts } from '@/lib/aliasUtils'
import { cachedRequest } from '@/lib/clientRequestCache'
import { themeSetForField, buildKwRegex } from '@/lib/themeUtils'
import type { Theme, ThemeModel } from '@/lib/themeUtils'
import { axisOfDimField, isDimField, dimVirtualFields, DIM_AXIS_LABEL_LONG } from '@/lib/dimensionFields'
import { readSession, writeSession } from '@/lib/useSessionState'
import type { TimeBucket} from '@/lib/timeBucket';
import { BUCKET_OPTIONS, autoBucket, bucketKey } from '@/lib/timeBucket'
import { buildPeriodComparison, type PeriodComparison } from '@/lib/periodCompare'
import LottieLoader from '@/components/ui/LottieLoader'
import { injectSignalTier } from '@/lib/signalTier'
import { useRows } from '@/components/analyze/RowsContext'
import { useFilters } from '@/components/analyze/FilterContext'
import { applyFilters } from '@/lib/filterUtils'
import { toNumericOrNull } from '@/lib/numericValue'
import { RATING_GRADIENT } from '@/lib/ratingGradient'
import type { SchemaFieldConfig as SchemaField, SchemaConfig } from '@/lib/analyzeTypes'
import type { ImpactAnalysis, ThemeImpactResult } from '@/lib/themeImpact'

// Minimal shape of the Plotly bundle we call into.
interface PlotlyModule {
  newPlot: (...args: unknown[]) => void
  purge: (el: HTMLElement) => void
  downloadImage: (el: HTMLElement, opts: Record<string, unknown>) => void
}

// Dynamic Plotly import
var PlotlyRef: PlotlyModule | null = null
function getPlotly(): Promise<PlotlyModule> {
  if (PlotlyRef) return Promise.resolve(PlotlyRef)
  return import('plotly.js-dist-min').then(function(m) { PlotlyRef = (m.default || m) as PlotlyModule; return PlotlyRef as PlotlyModule })
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
interface FieldSummary { type: string; nonNull: number; counts?: Record<string, number>; topN?: string[]; histogram?: { min: number; max: number; count: number }[]; min?: number; max?: number; avg?: number; median?: number; stddev?: number; p25?: number; p75?: number; avgWordCount?: number; sample?: string[] }
interface Analytics { totalRows: number; computedAt: string; fieldSummaries: Record<string, FieldSummary> }
interface Props { datasetId: string; schema: SchemaConfig; analytics: Analytics | null; themeModel?: ThemeModel | null; datasetSource?: string; taxonomyEnabled?: boolean; taxonomySuppressed?: boolean }

// Legacy theme blobs may carry `label` (pre-rename) and `color` alongside/instead of `name`.
type ThemeLike = Theme & { label?: string; color?: string }

// Cap on how many categorical values any categorical-axis chart will
// render. Beyond this, labels overlap, bars get too thin to read, and
// treemap tiles become unreadable. Renderers truncate to the top N by
// count and add a "Showing top N of M" subtitle so the operator knows
// the chart isn't lying.
const MAX_CATEGORIES_PER_CHART = 30

function clipBadge(n: number, total: number): string {
  // Inline HTML snippet for Plotly chart titles. Plotly supports basic
  // HTML in title strings, so this renders as a small grey second line.
  if (total <= n) return ''
  return '<br><span style="font-size:11px;color:#9ca3af;font-weight:400">Showing top ' + n + ' of ' + total + ' values</span>'
}

// Percentile with linear interpolation over a SORTED ascending array —
// same formula as lib/analyticsCompute's (server-only, not exported).
function pctl(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  var k = (sorted.length - 1) * p
  var f = Math.floor(k), c = Math.ceil(k)
  if (f === c) return sorted[f]
  return sorted[f] + (sorted[c] - sorted[f]) * (k - f)
}

// Top-N subset for capped categorical charts. The SUBSET is always the top
// `cap` values by count (ties alphabetical) so a clipped chart keeps the
// biggest categories and the "Showing top N of M" badge is truthful; callers
// apply their own DISPLAY ordering to the returned keys afterwards. Several
// charts previously sliced AFTER smartOrder — which is alphabetical for
// nominal fields — silently dropping the largest categories (2026-09-03 audit).
export function topCategoryKeys(counts: Record<string, number>, cap: number): { keys: string[]; total: number } {
  var entries = Object.entries(counts).sort(function(a, b) { return b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0]) })
  return { keys: entries.slice(0, cap).map(function(e) { return e[0] }), total: entries.length }
}

// ─── Chart slot definitions ───────────────────────────────────────────────

interface SlotDef {
  key: string
  label: string
  accepts: string[]  // field types: 'categorical', 'numeric', 'date', 'any'
  required: boolean
}

var CHART_SLOTS: Record<string, SlotDef[]> = {
  bar:          [{ key: 'category', label: 'Category', accepts: ['categorical'], required: true }, { key: 'colorBy', label: 'Color / Stack by', accepts: ['categorical'], required: false }, { key: 'value', label: 'Value', accepts: ['numeric'], required: false }],
  distribution: [{ key: 'field', label: 'Numeric Field', accepts: ['numeric'], required: true }, { key: 'splitBy', label: 'Split by', accepts: ['categorical'], required: false }],
  scatter:      [{ key: 'x', label: 'X Axis', accepts: ['numeric'], required: true }, { key: 'y', label: 'Y Axis', accepts: ['numeric'], required: true }, { key: 'colorBy', label: 'Color by', accepts: ['categorical'], required: false }],
  crosstab:     [{ key: 'rows', label: 'Row Variable', accepts: ['categorical'], required: true }, { key: 'cols', label: 'Column Variable', accepts: ['categorical'], required: true }],
  timeseries:   [{ key: 'date', label: 'Date Field', accepts: ['date'], required: true }, { key: 'metric', label: 'Metric', accepts: ['numeric'], required: false }, { key: 'colorBy', label: 'Break down by', accepts: ['categorical'], required: false }],
  treemap:      [{ key: 'category', label: 'Category', accepts: ['categorical'], required: true }, { key: 'size', label: 'Size', accepts: ['numeric'], required: false }],
  bubbles:      [{ key: 'category', label: 'Category', accepts: ['categorical'], required: true }, { key: 'size', label: 'Size', accepts: ['numeric'], required: false }],
  waterfall:    [{ key: 'category', label: 'Category', accepts: ['categorical'], required: true }],
  bullet:       [{ key: 'field', label: 'Measure', accepts: ['numeric'], required: true }, { key: 'splitBy', label: 'Split by', accepts: ['categorical'], required: false }],
  funnel:       [{ key: 'category', label: 'Category', accepts: ['categorical'], required: true }],
  // Range accepts numeric ONLY — the renderer runs values through
  // toNumericOrNull, so a date field produced a silent blank chart.
  gantt:        [{ key: 'category', label: 'Category', accepts: ['categorical'], required: true }, { key: 'range', label: 'Range Field', accepts: ['numeric'], required: true }],
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
var _chartDrag: { field: string; type: string; label: string; dual?: boolean } | null = null

// Find the best slot for a dropped field: prefers empty required > empty optional > replace required > replace any
function getSmartSlot(type: string, slots: SlotDef[], config: Record<string, string>): SlotDef | null {
  var match = function(s: SlotDef) { return s.accepts.includes(type) || s.accepts.includes('any') }
  return slots.find(function(s) { return s.required && !config[s.key] && match(s) })
      || slots.find(function(s) { return !config[s.key] && match(s) })
      || slots.find(function(s) { return s.required && match(s) })
      || slots.find(match)
      || null
}

// ─── Dual-purpose Likert fields ───────────────────────────────────────────
// An auto-quant Likert is a categorical field carrying a numeric `remapping`.
// It is shown ONCE in the pickers — as its raw categorical entry, flagged
// dual-purpose — instead of twice (raw + a "(score)" numeric twin). The SLOT
// resolves which id to store: a value/metric slot (accepts numeric, not
// categorical) stores the numeric twin `__mapped_<field>__`; an axis / category
// / colour slot stores the raw categorical id. Saved configs keep the RESOLVED
// id, so aggregation + saved charts key off the right column (the twin id in a
// value slot is exactly what the old two-entry picker stored, so this is
// backward-compatible with saved charts).
function isDualPurpose(f: { type: string; remapping?: Record<string, number> }): boolean {
  return f.type === 'categorical' && !!f.remapping && Object.keys(f.remapping).length > 0
}
function mappedIdFor(field: string): string { return '__mapped_' + field + '__' }
function isMappedId(id: string): boolean { return id.indexOf('__mapped_') === 0 && id.slice(-2) === '__' }
// A slot that takes a numeric measure but NOT a category → resolve dual-purpose to its numeric twin.
function slotWantsNumericTwin(accepts: string[]): boolean {
  return accepts.indexOf('numeric') !== -1 && accepts.indexOf('categorical') === -1
}
// Does a field satisfy a slot's accepted types? Dual-purpose satisfies numeric slots too.
function fieldMatchesAccepts(f: SchemaField, accepts: string[]): boolean {
  if (accepts.indexOf('any') !== -1) return true
  if (accepts.indexOf(f.type) !== -1) return true
  return isDualPurpose(f) && accepts.indexOf('numeric') !== -1
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
            var dual = isDualPurpose(f)
            // Dual-purpose fields store the raw id in a category slot and the
            // numeric-twin id in a value slot — count either as assigned.
            var isAssigned = Object.values(currentConfig).includes(f.field) || (dual && Object.values(currentConfig).includes(mappedIdFor(f.field)))
            // Dimension fields show the short label (Touchpoint…) but hover the
            // verbose, customer-facing name (Service — who served you…).
            var dimAx = axisOfDimField(f.field)
            var hoverTitle = dual ? 'Dual-purpose scale — drops as a category, or as a numeric score in a value slot' : (dimAx ? DIM_AXIS_LABEL_LONG[dimAx] : fl(f))
            return (
              <div key={f.field}
                draggable={true}
                onDragStart={function(e) {
                  _chartDrag = { field: f.field, type: f.type, label: fl(f), dual: dual }
                  e.dataTransfer.setData('text/field', JSON.stringify({ field: f.field, type: f.type, label: fl(f), section: f.section || 'core', dual: dual }))
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onDragEnd={function() { _chartDrag = null }}
                style={{ fontSize: 11, padding: '4px 8px', borderRadius: 5, color: isAssigned ? T.accent : T.textMid, fontWeight: isAssigned ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 1, background: isAssigned ? T.accentBg : 'transparent', transition: 'all .1s', cursor: 'grab', userSelect: 'none' }}
                title={hoverTitle}>
                {isAssigned && '\u2713 '}{fl(f)}
                {dual && <span style={{ marginLeft: 5, fontSize: 8, fontWeight: 700, color: '#7c3aed', border: '1px solid #7c3aed55', borderRadius: 3, padding: '0 3px', letterSpacing: '.03em', verticalAlign: 'middle' }}>{'#/\u2261'}</span>}
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
  var urlParamFields = fields.filter(function(f) { return f.section === 'url_param' })
  var coreFields = fields.filter(function(f) { return !f.section || f.section === 'core' })

  var asc2 = function(a: SchemaField, b: SchemaField) { var la = a.label || a.field, lb = b.label || b.field; return la.localeCompare(lb) }
  var numFields  = coreFields.filter(function(f) { return f.type === 'numeric' }).sort(asc2)
  // Themes (__themes__) and Dimensions (__dim_*) are DERIVED categories, not schema
  // columns \u2014 pull them out of raw "Categorical" into their own groups so the picker
  // doesn't bury 8 synthetic fields among the real categoricals.
  var catFields  = coreFields.filter(function(f) { return f.type === 'categorical' && f.field !== '__themes__' && !isDimField(f.field) }).sort(asc2)
  var themeFields = coreFields.filter(function(f) { return f.field === '__themes__' })
  var dimFields   = coreFields.filter(function(f) { return isDimField(f.field) }).sort(asc2)
  var dateFields = coreFields.filter(function(f) { return f.type === 'date' }).sort(asc2)
  var openFields = coreFields.filter(function(f) { return f.type === 'open-ended' }).sort(asc2)

  return (
    <>
      <ChartCollapsibleGroup label="Numeric" icon="#" color="#16a34a" fields={numFields} currentConfig={currentConfig} />
      <ChartCollapsibleGroup label="Categorical" icon={'\u2261'} color="#7c3aed" fields={catFields} currentConfig={currentConfig} />
      <ChartCollapsibleGroup label="Themes" icon={'\u2728'} color="#0EA5E9" fields={themeFields} currentConfig={currentConfig} />
      <ChartCollapsibleGroup label="Dimensions" icon={'\ud83c\udff7'} color="#e8622a" fields={dimFields} currentConfig={currentConfig} />
      <ChartCollapsibleGroup label="Open-ended" icon={'\u2756'} color="#2563eb" fields={openFields} currentConfig={currentConfig} />
      <ChartCollapsibleGroup label="Date" icon={'\uD83D\uDCC5'} color="#d97706" fields={dateFields} currentConfig={currentConfig} />
      <ChartCollapsibleGroup label="Survey Questions" icon={'\uD83D\uDCCB'} color="#f59e0b" fields={customFields} currentConfig={currentConfig} />
      <ChartCollapsibleGroup label="Psychographic" icon={'\uD83E\uDDE0'} color="#ec4899" fields={psychoFields} currentConfig={currentConfig} />
      <ChartCollapsibleGroup label="Demographic" icon={'\uD83D\uDC64'} color="#0891b2" fields={demoFields} currentConfig={currentConfig} />
      <ChartCollapsibleGroup label="URL Parameters" icon={'\uD83D\uDD17'} color="#6366f1" fields={urlParamFields} currentConfig={currentConfig} />
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
function catXAxis(cats: string[]): Record<string, unknown> {
  var maxLen = cats.reduce(function(mx, c) { return Math.max(mx, String(c).length) }, 0)
  // For few categories with long labels, wrapping handles it — no rotation needed
  if (cats.length < 5 || maxLen <= 10) return {}
  // For many categories, use smaller font to fit
  return {
    tickfont: { size: cats.length > 10 ? 10 : 11 },
  }
}

// Subset of the Plotly layout object PlotlyChart normalizes (title/axis title
// strings → styled objects); everything else rides through the index signature.
interface AxisLayout { title?: string | { text?: string; standoff?: number; [k: string]: unknown }; [k: string]: unknown }
interface ChartLayout { title?: string | { text?: string; [k: string]: unknown }; xaxis?: AxisLayout; yaxis?: AxisLayout; [k: string]: unknown }

function PlotlyChart({ traces, layout, style }: { traces: Record<string, unknown>[]; layout?: ChartLayout; style?: React.CSSProperties }) {
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
    // getPlotly() is async; by the time the promise resolves the
    // component may have unmounted (user navigated away mid-render)
    // and ref.current is null. newPlot(null) throws "DOM element
    // provided is null or undefined" — Sentry caught this in prod
    // 2026-05-12. Null-check inside the .then.
    // Capture the node in the effect body (not the cleanup) — by cleanup time
    // ref.current may point elsewhere. newPlot keeps its own late ref.current
    // read so an unmount mid-async skips the plot (Sentry 2026-05-12).
    const el = ref.current
    void getPlotly().then(function(Plotly) { if (ref.current) Plotly.newPlot(ref.current, traces, merged, { responsive: true, displayModeBar: false }) })
    return function() {
      if (!el) return
      void getPlotly().then(function(Plotly) { try { Plotly.purge(el) } catch {} })
    }
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
  var urlParamOpts = options.filter(function(o) { return o.section === 'url_param' })
  var hasGroups = customOpts.length > 0 || psychoOpts.length > 0 || demoOpts.length > 0 || urlParamOpts.length > 0

  return (
    <div style={{ minWidth: 140 }}
      onDragOver={function(e) { e.preventDefault(); setDragOver(true) }}
      onDragLeave={function(e) { var rt = e.relatedTarget as Node | null; if (!rt || !e.currentTarget.contains(rt)) setDragOver(false) }}
      onDrop={function(e) {
        e.preventDefault(); e.stopPropagation(); setDragOver(false)
        try {
          var payload = JSON.parse(e.dataTransfer.getData('text/field'))
          var okType = !accepts || accepts.includes(payload.type) || accepts.includes('any')
          // A dual-purpose Likert (categorical payload) is also droppable into a
          // numeric value/metric slot, where it resolves to its numeric twin id.
          var okDual = !!payload.dual && !!accepts && accepts.indexOf('numeric') !== -1
          if (!okType && !okDual) return
          var fieldId = (payload.dual && accepts && slotWantsNumericTwin(accepts)) ? mappedIdFor(payload.field) : payload.field
          onChange(fieldId)
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
          {hasGroups && urlParamOpts.length > 0 && <optgroup label="URL Parameters">{urlParamOpts.map(function(o) { return <option key={o.v} value={o.v}>{o.l}</option> })}</optgroup>}
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
  var rawFs = analytics.fieldSummaries || {}  // seeded/compute-failed datasets can lack summaries entirely
  // Apply value aliases to all field summary counts so every chart gets aliased labels
  var fs: Record<string, FieldSummary> = {}
  Object.entries(rawFs).forEach(function(entry) {
    var key = entry[0], summary = entry[1]
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
    // Subset FIRST (top-N by count, topCategoryKeys — a clipped chart keeps the
    // biggest categories), then apply display ordering to the subset:
    // Themes/dimensions: frequency desc. Smart Axes ON + ordinal: scale order.
    // Smart Axes ON + nominal: frequency desc. Smart Axes OFF: alphabetical.
    var rawKeys = rawEntries.map(function(e) { return e[0] })
    var isOrd = !!(catRemap && Object.keys(catRemap).length >= 2) || isOrdinalScale(rawKeys)
    var top = topCategoryKeys(summary.counts, MAX_CATEGORIES_PER_CHART)
    var orderedKeys = catField === '__themes__' || axisOfDimField(catField)
      ? top.keys
      : useSmartOrder
        ? (isOrd ? smartOrder(top.keys, catRemap) : top.keys)
        : top.keys.slice().sort()
    var totalKeys = top.total
    var entries = orderedKeys.map(function(k) { return [k, summary.counts![k] || 0] as [string, number] })
    var isH = opts?.orient === 'h'
    // Reverse for horizontal so first item (largest/alphabetically first) renders at top
    if (isH) entries.reverse()
    var cats = entries.map(function(e) { return e[0] })
    var vals = entries.map(function(e) { return e[1] })
    // Percentage denominator = ALL categories, not just the shown top-30 — else
    // a clipped chart's bars sum to 100% and each % is inflated (the axis title
    // claims "% of <field>"). clipBadge discloses "showing 30 of N".
    var totalCount = rawEntries.reduce(function(s, e) { return s + e[1] }, 0)
    var isPercent = opts?.barMode === 'percent'
    var displayVals = isPercent ? vals.map(function(v) { return totalCount > 0 ? Math.round(v / totalCount * 1000) / 10 : 0 }) : vals
    var catLabel = flByName(catField, schema)
    var yTitle = isPercent ? '% of ' + catLabel : 'Count'

    // Stacked/grouped with colorBy
    if (colorByField && fs[colorByField] && fs[colorByField].counts) {
      return <BarStackedInner analytics={analytics} schema={schema} datasetId={datasetId} catField={catField} colorByField={colorByField} barMode={opts?.barMode || 'count'} barStack={opts?.barStack || false} smartAxes={useSmartOrder} colors={pal} orient={opts?.orient || 'v'} />
    }

    var hoverTpl = isH
      ? (isPercent ? '%{x:.0f}%<extra>%{y}</extra>' : '%{x}<extra>%{y}</extra>')
      : (isPercent ? '%{y:.0f}%<extra>%{x}</extra>' : '%{y}<extra>%{x}</extra>')
    // Ordinal fields get a rating-aware gradient (low=red…high=green); nominal → single color
    var isOrdField = (catRemap && Object.keys(catRemap).length >= 2) || isOrdinalScale(cats)
    var barColors: string | string[] = primaryColor
    if (isOrdField && cats.length >= 3) {
      barColors = ordinalBarColors(cats, catRemap)
    }
    var wrappedCats = wrapLabels(cats, isH ? 28 : 18)
    var trace: Record<string, unknown> = { type: 'bar', marker: { color: barColors, line: { color: typeof barColors === 'string' ? barColors + '40' : barColors.map(function(c) { return c + '40' }), width: 1 } }, text: displayVals.map(function(v) { return String(isPercent ? Math.round(v) + '%' : v) }), textposition: 'outside', textfont: { size: 11 }, cliponaxis: false, hovertemplate: hoverTpl }
    if (isH) { trace.y = wrappedCats; trace.x = displayVals; trace.orientation = 'h' }
    else { trace.x = wrappedCats; trace.y = displayVals }

    var isCount = opts?.barMode !== 'percent'
    return <PlotlyChart traces={[trace]} layout={{ title: catLabel + clipBadge(MAX_CATEGORIES_PER_CHART, totalKeys), xaxis: { title: isH ? yTitle : '', ...(!isH ? catXAxis(wrappedCats) : {}), ...(isH && isCount ? { tickformat: ',d' } : {}) }, yaxis: { title: isH ? '' : yTitle, ...(!isH && isCount ? { tickformat: ',d' } : {}) }, barcornerradius: 4 }} />
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
      var distShapes: Record<string, unknown>[] = []
      var distAnnotations: Record<string, unknown>[] = []
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
    // No precomputed histogram (seeded/compute-failed summaries) — build a real
    // box from the rows. The old fallback fed [min, avg, median, max] to Plotly
    // AS DATA POINTS and let it derive quartiles from those 4 numbers — a
    // fabricated distribution (2026-09-03 audit).
    return <DistRowsFallbackInner datasetId={datasetId} numField={field} schema={schema} color={primaryColor} />
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
    // Top-N by COUNT (tiles are size-ordered by Plotly anyway) — slicing a
    // smartOrder/alphabetical list dropped the largest categories.
    var top2 = topCategoryKeys(s2.counts, MAX_CATEGORIES_PER_CHART)
    var totalKeys2 = top2.total
    var e2 = top2.keys.map(function(k) { return [k, s2.counts![k] || 0] as [string, number] })
    var labels = e2.map(function(e) { return e[0] }); var values = e2.map(function(e) { return e[1] }); var parents = labels.map(function() { return '' })
    return <PlotlyChart traces={[{ type: 'treemap', labels: labels, values: values, parents: parents, marker: { colors: labels.map(function(_, i) { return pal[i % pal.length] }) }, branchvalues: 'remainder' as const, textinfo: 'label+value' }]} layout={{ title: flByName(catF2, schema) + clipBadge(MAX_CATEGORIES_PER_CHART, totalKeys2), margin: { t: 48, r: 8, b: 8, l: 8 } }} />
  }

  if (chartType === 'bubbles') {
    var catF3 = config.category; if (!catF3) return <EmptyChart msg="Assign a category field above." />
    var s3 = fs[catF3]; if (!s3 || !s3.counts) return <EmptyChart msg="No data." />
    var BUBBLES_CAP = 25
    // Top-N by COUNT (packing places largest first) — slicing a smartOrder
    // (alphabetical for nominal) list dropped the largest categories.
    var top3 = topCategoryKeys(s3.counts, BUBBLES_CAP)
    var totalKeys3 = top3.total
    var e3 = top3.keys.map(function(k) { return [k, s3.counts![k] || 0] as [string, number] })
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
    }]} layout={{ title: flByName(catF3, schema) + clipBadge(BUBBLES_CAP, totalKeys3), showlegend: false, xaxis: { visible: false, zeroline: false }, yaxis: { visible: false, zeroline: false, scaleanchor: 'x' }, margin: { t: 48, r: 8, b: 8, l: 8 } }} />
  }

  if (chartType === 'waterfall') {
    var catF4 = config.category; if (!catF4) return <EmptyChart msg="Assign a category field above." />
    var s4 = fs[catF4]; if (!s4 || !s4.counts) return <EmptyChart msg="No data." />
    var WATERFALL_CAP = 15
    // Subset = top-N by count; display order applied to the SUBSET (scale
    // order with Smart Axes, else alphabetical).
    var top4 = topCategoryKeys(s4.counts, WATERFALL_CAP)
    var totalKeys4 = top4.total
    var f4Obj = schema.find(function(f) { return f.field === catF4 })
    var keys4 = useSmartOrder ? smartOrder(top4.keys, f4Obj?.remapping) : top4.keys.slice().sort()
    var e4 = keys4.map(function(k) { return [k, s4.counts![k] || 0] as [string, number] })
    var wLabels = wrapLabels(e4.map(function(e) { return e[0] }).concat(['Total']), 18)
    var wValues = e4.map(function(e) { return e[1] })
    var total = wValues.reduce(function(a, b) { return a + b }, 0)
    var measures: string[] = wValues.map(function() { return 'relative' }).concat(['total'])
    wValues.push(total)
    return <PlotlyChart traces={[{ type: 'waterfall', x: wLabels, y: wValues, measure: measures, connector: { line: { color: T.borderMid } }, increasing: { marker: { color: T.green } }, decreasing: { marker: { color: T.red } }, totals: { marker: { color: primaryColor } } }]} layout={{ title: flByName(catF4, schema) + clipBadge(WATERFALL_CAP, totalKeys4), xaxis: { ...catXAxis(wLabels) }, margin: { t: 48, r: 16, b: 48, l: 56 }, showlegend: false }} />
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
        <GaugeCard label={flByName(bField, schema)} avg={bs.avg || 0} median={bs.median || bs.avg || 0} min={bs.min || 0} max={bs.max || 100} n={bs.nonNull || 0} overallAvg={null} accentColor={primaryColor} q1={bs.p25 ?? null} q3={bs.p75 ?? null} />
      </div>
    )
  }

  if (chartType === 'funnel') {
    var catF5 = config.category; if (!catF5) return <EmptyChart msg="Assign a category field above." />
    var s5 = fs[catF5]; if (!s5 || !s5.counts) return <EmptyChart msg="No data." />
    var FUNNEL_CAP = 12
    // A funnel is only readable monotonically decreasing — ALWAYS top-N by
    // count, count-desc display, regardless of Smart Axes (which reordered
    // stages by scale/alphabet and produced mid-bulging funnels).
    var top5 = topCategoryKeys(s5.counts, FUNNEL_CAP)
    var totalKeys5 = top5.total
    var e5 = top5.keys.map(function(k) { return [k, s5.counts![k] || 0] as [string, number] })
    return <PlotlyChart traces={[{ type: 'funnel', y: wrapLabels(e5.map(function(e) { return e[0] }), 28), x: e5.map(function(e) { return e[1] }), marker: { color: e5.map(function(_, i) { return pal[i % pal.length] }) } }]} layout={{ title: flByName(catF5, schema) + clipBadge(FUNNEL_CAP, totalKeys5), margin: { t: 48, r: 16, b: 8, l: 120 }, showlegend: false }} />
  }

  if (chartType === 'gantt') {
    var gCat = config.category, gRange = config.range; if (!gCat || !gRange) return <EmptyChart msg="Assign category and range fields above." />
    return <GanttInner analytics={analytics} schema={schema} datasetId={datasetId} catField={gCat} rangeField={gRange} colors={pal} />
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
  themeModel?: ThemeModel | null; schema?: SchemaConfig
  enrichKey?: number           // incremented when source/filter changes → triggers re-enrichment
  themeSourceOverride?: string // overrides themeModel.fieldName
  dimFieldKey?: string // per-question dimension aggregates (sql/164) — rides into every tax_* spec
  activeThemeNames?: Set<string> | null  // null = all active
  datasetSource?: string       // 'reddit' | 'substack' etc for signal_tier injection
  filteredRowIds?: number[] | null  // flat row ids of the filtered view → server dim aggregates honor filters (null = whole dataset)
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs the external RowsContext into the enriched/filtered view (external-system sync is what effects are for)
    setRows(filtered)
    setLoaded(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on filterKey (stable stringify of effectiveFilters) + shared.rowsLoaded, not the churny objects
  }, [shared.rowsLoaded, enrichKey, filterKey])
  // Trigger shared fetch on first render
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only fetch trigger; shared.fetchRows guards its own re-entry
  useEffect(function() { shared.fetchRows() }, [])
  return { rows: rows, loaded: loaded, loading: shared.rowsLoading }
}

// Aggregation hook — fetches pre-computed results from SQL, no raw rows needed

// Response shapes from /api/datasets/[datasetId]/aggregate — one payload per op:
// crosstab/tax_crosstab → grid/rows/cols, group_stats/tax_group_stats → groups,
// date_series/tax_date_series → series (sub only set by tax_date_series, and
// only tax consumers read it), count_by/tax_count_by → counts.
interface AggResult {
  grid?: Record<string, Record<string, number>>
  rows?: string[]
  cols?: string[]
  groups?: Record<string, { n: number; mean: number; median: number; min: number; max: number; stddev?: number; q1?: number | null; q3?: number | null }>
  series?: { sub: string; date: string; count: number; avg: number | null }[]
  counts?: Record<string, number>
  /** true when the server computed this over the deterministic 50K sample and
   *  scaled (dataset above the cap) — the charts carry the "~" affordance. */
  sampled?: boolean
}

// Colour ordinal/Likert bars by the underlying RATING VALUE — low = red, high =
// green — regardless of axis order or orientation. Uses the field's remapping
// when present (Likerts are auto-mapped now), else the recognized scale's rank,
// else falls back to left→right position. `vals` are the raw category values in
// display order (NOT wrapped/aliased labels, so remapping/scale keys match).
var ORD_GRAD = RATING_GRADIENT // best → worst (shared with the Outlet snapshot)
function ordinalBarColors(vals: string[], catRemap?: Record<string, number>): string[] {
  var scaleOrder = detectScale(vals) // ordered worst→best, or null
  var rank = function(v: string, i: number): number {
    if (catRemap && catRemap[v] != null) return catRemap[v]
    if (scaleOrder) { var idx = scaleOrder.indexOf(v); if (idx >= 0) return idx }
    return i
  }
  var rs = vals.map(rank)
  var lo = Math.min.apply(null, rs), hi = Math.max.apply(null, rs)
  return vals.map(function(v, i) {
    var frac = hi > lo ? (rank(v, i) - lo) / (hi - lo) : 0.5 // 1 = best rating
    var g = 1 - frac // 0 = best (green), 1 = worst (red)
    if (g < 0.15) return ORD_GRAD[0]
    if (g < 0.38) return ORD_GRAD[1]
    if (g < 0.62) return ORD_GRAD[2]
    if (g < 0.82) return ORD_GRAD[3]
    return ORD_GRAD[4]
  })
}

var _aggCache: Record<string, AggResult> = {}

function useAggregation(datasetId: string, spec: Record<string, unknown> | null) {
  var [data, setData] = useState<AggResult | null>(null)
  var [loaded, setLoaded] = useState(false)
  // Attach the view's filtered row-id set so the server aggregate honors active
  // filters (null = whole dataset). Done here (one place) so EVERY chart spec —
  // scalar (crosstab/group_stats/date_series/field_counts/numeric_stats, sql/169)
  // AND taxonomy (tax_*, sql/164) — is filter-aware without per-spec plumbing.
  // Previously gated to tax_* only, so scalar charts silently showed full-dataset
  // numbers under a filtered UI (Brief F escalation #1). fieldKey stays tax-only
  // (per-question dimensions, sql/164). rowIds is part of the cache key so the
  // chart re-fetches when filters change.
  var isTax = !!spec && typeof spec.op === 'string' && (spec.op as string).indexOf('tax_') === 0
  var effSpec: Record<string, unknown> | null = spec
  if (spec && (_enrichCtx.filteredRowIds || (isTax && _enrichCtx.dimFieldKey))) {
    effSpec = Object.assign({}, spec,
      _enrichCtx.filteredRowIds ? { rowIds: _enrichCtx.filteredRowIds } : null,
      // per-question dimensions (sql/164): the source-field picker drives
      // dimension charts too; the server falls back to the primary classified
      // field when this question has no classification
      (isTax && _enrichCtx.dimFieldKey) ? { fieldKey: _enrichCtx.dimFieldKey } : null)
  }
  var cacheKey = datasetId + ':' + JSON.stringify(effSpec)
  useEffect(function() {
    if (!effSpec) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async aggregate fetch → state; effects are the correct place for external data
    if (_aggCache[cacheKey]) { setData(_aggCache[cacheKey]); setLoaded(true); return }
    setLoaded(false)
    fetch('/api/datasets/' + datasetId + '/aggregate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(effSpec),
    }).then(function(r) { return r.json() })
      .then(function(d) { _aggCache[cacheKey] = d; setData(d); setLoaded(true) })
      .catch(function() { setLoaded(true) })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on cacheKey (= datasetId + stringified effSpec); effSpec is a fresh object each render so listing it would loop
  }, [datasetId, cacheKey])
  return { data: data, loaded: loaded }
}

// Build a tax_crosstab agg spec when exactly one of (a, b) is a dimension
// field and the other is a real scalar field. Returns null otherwise (e.g.
// dimension × theme, or two dimensions — unsupported in v1). axisIsRow tells
// the route which side of the grid the dimension lands on.
function taxCrosstabSpec(a: string, b: string, limit: number): { op: string; axis: string; field: string; axisIsRow: boolean; limit: number } | null {
  var aDim = axisOfDimField(a), bDim = axisOfDimField(b)
  if (aDim && b && !b.startsWith('__')) return { op: 'tax_crosstab', axis: aDim, field: b, axisIsRow: true, limit: limit }
  if (bDim && a && !a.startsWith('__')) return { op: 'tax_crosstab', axis: bDim, field: a, axisIsRow: false, limit: limit }
  return null
}

// Reads source field, active themes, and mapped fields from _enrichCtx
function enrichRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  var themeModel = _enrichCtx.themeModel
  var schema = _enrichCtx.schema
  if (!rows.length) return rows
  var hasThemes = !!(themeModel && themeModel.themes && themeModel.themes.length > 0)
  var mappedFields = (schema?.fields || []).filter(function(f) { return f.type === 'categorical' && f.remapping && Object.keys(f.remapping).length > 0 })
  if (!hasThemes && !mappedFields.length) return rows

  var allThemes: ThemeLike[] = hasThemes ? themeModel!.themes : []
  var activeNames = _enrichCtx.activeThemeNames  // null = all themes shown
  var themes = activeNames ? allThemes.filter(function(t) { return activeNames!.has((t.name || t.label)!) }) : allThemes
  var openField = hasThemes
    ? (_enrichCtx.themeSourceOverride || themeModel!.fieldName || (schema?.fields || []).find(function(f) { return f.type === 'open-ended' })?.field || '')
    : ''

  // Canonical keyword matcher (themeUtils.buildKwRegex — the SAME patterns
  // TextMine's recount and the SQL counting RPCs use), replacing a raw
  // substring test that both over-matched ("rap" hit "therapy") and missed
  // lemmas ("ran" never matched "running"). Precompiled once, not per row.
  // __themes__ stays winner-take-all single-label — it's one column per row;
  // the simple Themes bar shows the server's multi-label counts.
  var themeRegexes = themes.map(function(t) { return (t.keywords || []).filter(Boolean).map(buildKwRegex) })

  return rows.map(function(row) {
    var enriched = Object.assign({}, row)

    if (hasThemes && openField) {
      var text = String(row[openField] || '').toLowerCase()
      if (!text.trim()) {
        enriched['__themes__'] = ''
      } else {
        var bestTheme = '', bestCount = 0
        themes.forEach(function(t, ti) {
          var hits = 0
          themeRegexes[ti].forEach(function(re) { if (re.test(text)) hits++ })
          if (hits > bestCount) { bestCount = hits; bestTheme = (t.name || t.label)! }
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

// Recompute per-field summaries from the (already filtered + enriched) rows so
// the summary-driven charts — plain Count/% Bar, no-split Distribution, Treemap,
// Packed Bubbles, Waterfall — honor active filters, matching the stacked/Average
// bars (which route through the aggregate API with rowIds). Without this those
// charts read the whole-dataset precomputed fieldSummaries and disagree with the
// rest of the tab under a filter. Numeric fields REUSE the whole-dataset histogram
// bin edges and only recount, so no binning logic is duplicated. Virtual (__*)
// fields are handled elsewhere and skipped here.
//
// `scale` = totalRows/sampledCount (1 when the whole dataset is loaded). Above
// the 50K cap `rows` is the filtered subset of the 50K sample, so COUNT surfaces
// (counts, nonNull, histogram bins) scale up to estimate the filtered population
// — identical to scaleSampledCount on the aggregate path, so the simple bar stays
// in the same units as its own unfiltered state and as the stacked bar. Means /
// median / min / max are direct sample estimates and stay UNSCALED.
export function recomputeFilteredSummaries(
  rows: Record<string, unknown>[], fields: SchemaField[], base: Record<string, FieldSummary>, scale: number,
): Record<string, FieldSummary> {
  var sc = function(n: number) { return scale === 1 ? n : Math.round(n * scale) }
  var out: Record<string, FieldSummary> = {}
  ;(fields || []).forEach(function(f) {
    if (!f.field || f.field.startsWith('__')) return
    if (f.type === 'numeric') {
      var vals: number[] = []
      rows.forEach(function(r) { var v = toNumericOrNull(r[f.field]); if (v !== null) vals.push(v) })
      if (!vals.length) { out[f.field] = { type: 'numeric', nonNull: 0 }; return }
      vals.sort(function(a, b) { return a - b })
      var n = vals.length
      var sum = vals.reduce(function(a, b) { return a + b }, 0)
      var mean = sum / n
      var variance = vals.reduce(function(s, v) { return s + (v - mean) * (v - mean) }, 0) / (n > 1 ? n - 1 : 1)
      var summary: FieldSummary = {
        type: 'numeric', nonNull: sc(n), min: vals[0], max: vals[n - 1], avg: mean,
        median: n % 2 ? vals[(n - 1) / 2] : (vals[n / 2 - 1] + vals[n / 2]) / 2,
        stddev: Math.sqrt(variance),
        p25: pctl(vals, 0.25), p75: pctl(vals, 0.75),
      }
      var baseHist = base[f.field] && base[f.field].histogram
      if (baseHist && baseHist.length) {
        var bins = baseHist.map(function(b) { return { min: b.min, max: b.max, count: 0 } })
        var last = bins.length - 1
        vals.forEach(function(v) {
          for (var i = 0; i < bins.length; i++) {
            if (v >= bins[i].min && (i === last ? v <= bins[i].max : v < bins[i].max)) { bins[i].count++; break }
          }
        })
        summary.histogram = bins.map(function(b) { return { min: b.min, max: b.max, count: sc(b.count) } })
      }
      out[f.field] = summary
    } else {
      var counts: Record<string, number> = {}
      var nn = 0
      rows.forEach(function(r) {
        var s = String(r[f.field] == null ? '' : r[f.field]).trim(); if (!s) return
        counts[s] = (counts[s] || 0) + 1; nn++
      })
      if (scale !== 1) Object.keys(counts).forEach(function(k) { counts[k] = sc(counts[k]) })
      out[f.field] = { type: f.type, nonNull: sc(nn), counts: counts, topN: Object.keys(counts) }
    }
  })
  return out
}

function BarStackedInner({ analytics, schema, datasetId, catField, colorByField, barMode, barStack, smartAxes, colors, orient }: { analytics: Analytics; schema: SchemaField[]; datasetId: string; catField: string; colorByField: string; barMode: string; barStack: boolean; smartAxes?: boolean; colors?: string[]; orient?: string }) {
  // Collections have no dataset_rows_flat, so SQL aggregation returns empty — always use rows
  var isCollection = _enrichCtx.datasetSource === 'collection'
  // Dimension axis on either side → taxonomy crosstab (server-side over stored tags)
  var taxSpec = !isCollection ? taxCrosstabSpec(catField, colorByField, 30) : null
  var aggSpec = taxSpec || (!isCollection && catField && colorByField ? { op: 'crosstab', rowField: catField, colField: colorByField, limit: 30 } : null)
  var { data: aggData, loaded: aggLoaded } = useAggregation(datasetId, aggSpec)
  // Fallback to useRows for virtual fields or collections that aren't in the flat table
  var needsRows = !taxSpec && (isCollection || catField.startsWith('__') || colorByField.startsWith('__'))
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
    Object.values(grid).forEach(function(row: Record<string, number>) { Object.entries(row).forEach(function(e: [string, number]) { colorTotals[e[0]] = (colorTotals[e[0]] || 0) + e[1] }) })
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
        cats.sort(function(a, b) { var ta = Object.values(grid[a]).reduce(function(s, v) { return s + v }, 0); var tb = Object.values(grid[b]).reduce(function(s, v) { return s + v }, 0); return tb !== ta ? tb - ta : a.localeCompare(b) })
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
  // Subset = top-30 categories by row total (display order preserved), with a
  // title badge when clipped — was a display-order slice with no disclosure.
  var totalCats = cats.length
  if (cats.length > 30) {
    var rowTotals: Record<string, number> = {}
    cats.forEach(function(c) { rowTotals[c] = Object.values(grid[c] || {}).reduce(function(s, v) { return s + v }, 0) })
    var keepStack = new Set(cats.slice().sort(function(a, b) { return (rowTotals[b] || 0) - (rowTotals[a] || 0) }).slice(0, 30))
    cats = cats.filter(function(c) { return keepStack.has(c) })
  }
  var isH = orient === 'h'
  if (isH) cats.reverse()
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
    var trace: Record<string, unknown> = { type: 'bar', name: colLabel + ' (' + colPct + '%)', marker: { color: pal[i % pal.length], line: { color: pal[i % pal.length] + '40', width: 1 } }, hovertemplate: stackHoverTpl }
    if (isH) { trace.y = catLabels; trace.x = ys; trace.orientation = 'h' }
    else { trace.x = catLabels; trace.y = ys }
    return trace
  })

  var catLabel = flByName(catField, schema)
  var valLabel = barMode === 'percent' ? 'Percentage' : 'Count'
  var isStackedCount = barMode !== 'percent'
  return <PlotlyChart traces={traces} layout={{ title: catLabel + ' by ' + flByName(colorByField, schema) + clipBadge(30, totalCats), barmode: barStack ? 'stack' : 'group', xaxis: { title: isH ? valLabel : '', ...(!isH ? catXAxis(catLabels) : {}), ...(isH && isStackedCount ? { tickformat: ',d' } : {}) }, yaxis: { title: isH ? '' : valLabel, ...(!isH && isStackedCount ? { tickformat: ',d' } : {}) }, legend: { orientation: 'h' as const, y: -0.2, traceorder: 'normal' as const, title: { text: flByName(colorByField, schema) } }, barcornerradius: 4 }} />
}

// ─── Bar Aggregated Inner (average/sum of numeric value by category) ─────

function BarAggInner({ analytics, schema, datasetId, catField, valueField, smartAxes, colors, orient }: {
  analytics: Analytics; schema: SchemaField[]; datasetId: string; catField: string; valueField: string; smartAxes?: boolean; colors?: string[]; orient?: string
}) {
  var isCollection = _enrichCtx.datasetSource === 'collection'
  var aggDimAxis = axisOfDimField(catField)
  // __mapped_*/__themes__ are client-only virtual fields (computed by enrichRows) —
  // they are NOT keys in the stored JSONB, so the SQL group_stats/tax_group_stats
  // can't read them and return zero groups ("No groups found."). Route those through
  // the enriched client rows instead — which also makes this path filter-aware. The
  // common case: a remapped satisfaction question used as the numeric VALUE ("Rating").
  var catVirtual = catField.startsWith('__') && !aggDimAxis
  var valVirtual = valueField.startsWith('__')
  var needsRows = isCollection || catVirtual || valVirtual
  var spec = needsRows
    ? null
    : (aggDimAxis
        ? { op: 'tax_group_stats', axis: aggDimAxis, valueField: valueField }
        : { op: 'group_stats', groupField: catField, valueField: valueField })
  var agg = useAggregation(datasetId, spec)
  var { rows, loaded: rowsLoaded } = useChartRows(datasetId, needsRows ? (_enrichCtx.enrichKey || 0) : -1)
  var loaded = needsRows ? rowsLoaded : agg.loaded
  if (!loaded) return <div style={{ textAlign: 'center', padding: 40, color: T.textMute, fontSize: 13 }}>Computing averages...</div>

  // Build groups from the aggregation API or from enriched rows (collections + virtual fields)
  var groupsObj: Record<string, { n: number; mean: number; median: number; min: number; max: number }>
  if (!needsRows && agg.data && agg.data.groups) {
    groupsObj = agg.data.groups
  } else {
    var buckets: Record<string, number[]> = {}
    rows.forEach(function(r) {
      var cat = String(r[catField] || '').trim(); if (!cat) return
      var v = toNumericOrNull(r[valueField]); if (v === null) return
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
  // Empty here means no row had BOTH a category and a numeric value in the
  // value field — name the value field so the cause is obvious (usually a
  // non-numeric value field, not a missing category).
  if (groupKeys.length === 0) return <EmptyChart msg={'No numeric values to average in "' + flByName(valueField, schema) + '" for these categories.'} />

  var groups = groupKeys.map(function(k) { return { group: k, ...groupsObj[k] } })

  // Smart Axes ON + ordinal: preserve scale order. ON + nominal: sort by mean. OFF: alphabetical.
  var catFieldObj = schema.find(function(f) { return f.field === catField })
  var catRemap = catFieldObj?.remapping
  var isOrdAgg = !!(catRemap && Object.keys(catRemap).length >= 2) || isOrdinalScale(groups.map(function(g) { return g.group }))
  var sortedGroups = smartAxes
    ? (isOrdAgg
        ? smartOrder(groups.map(function(g) { return g.group }), catRemap).map(function(k) { return groups.find(function(g) { return g.group === k }) }).filter(Boolean) as typeof groups
        : groups.slice().sort(function(a, b) { return b.mean !== a.mean ? b.mean - a.mean : a.group.localeCompare(b.group) }))
    : groups.slice().sort(function(a, b) { return a.group.localeCompare(b.group) })

  var isH = orient === 'h'
  // Subset = top-30 by group SIZE (n) so the biggest categories survive the
  // cap even when the display order is by mean/scale; disclosed in the title.
  var totalGroups = sortedGroups.length
  var displayGroups = sortedGroups
  if (totalGroups > MAX_CATEGORIES_PER_CHART) {
    var keepAgg = new Set(sortedGroups.slice().sort(function(a, b) { return b.n - a.n }).slice(0, MAX_CATEGORIES_PER_CHART).map(function(g) { return g.group }))
    displayGroups = sortedGroups.filter(function(g) { return keepAgg.has(g.group) })
  }
  if (isH) displayGroups = displayGroups.slice().reverse()
  var cats = wrapLabels(displayGroups.map(function(g) { return resolveAlias(catField, g.group, schema) }), isH ? 28 : 18)
  var vals = displayGroups.map(function(g) { return Math.round(g.mean * 100) / 100 })
  var catLabel = flByName(catField, schema)
  var valLabel = 'Avg ' + flByName(valueField, schema)
  var primaryColor = (colors || CHART_COLORS)[0] || '#e8622a'

  // Ordinal gradient like regular bar
  var isOrdField = (catRemap && Object.keys(catRemap).length >= 2) || isOrdinalScale(cats)
  var barColors: string | string[] = primaryColor
  if (isOrdField && cats.length >= 3) {
    // colour by the raw group value's rating (low=red…high=green), not position
    barColors = ordinalBarColors(displayGroups.map(function(g) { return g.group }), catRemap)
  }

  var hoverTpl = isH ? '%{x:.2f}<extra>%{y}</extra>' : '%{y:.2f}<extra>%{x}</extra>'
  var trace: Record<string, unknown> = {
    type: 'bar',
    marker: { color: barColors, line: { color: typeof barColors === 'string' ? barColors + '40' : barColors.map(function(c) { return c + '40' }), width: 1 } },
    text: vals.map(function(v) { return String(v) }),
    textposition: 'outside',
    textfont: { size: 11 },
    hovertemplate: hoverTpl,
  }
  if (isH) { trace.y = cats; trace.x = vals; trace.orientation = 'h' }
  else { trace.x = cats; trace.y = vals }

  // Overall average reference line — count-weighted across ALL groups (not just
  // the displayed top 30), so it reads as the true mean of the value field.
  var totalN = sortedGroups.reduce(function(a, g) { return a + (g.n || 0) }, 0)
  var overallAvg = totalN > 0 ? sortedGroups.reduce(function(a, g) { return a + (g.n || 0) * g.mean }, 0) / totalN : null
  var avgR = overallAvg != null ? Math.round(overallAvg * 100) / 100 : null
  var avgShapes = avgR != null ? [{
    type: 'line', layer: 'above',
    xref: (isH ? 'x' : 'paper') as 'x' | 'paper', x0: isH ? avgR : 0, x1: isH ? avgR : 1,
    yref: (isH ? 'paper' : 'y') as 'paper' | 'y', y0: isH ? 0 : avgR, y1: isH ? 1 : avgR,
    line: { color: '#475569', width: 1.5, dash: 'dash' },
  }] : []
  var avgAnnotations = avgR != null ? [{
    xref: (isH ? 'x' : 'paper') as 'x' | 'paper', x: isH ? avgR : 1,
    yref: (isH ? 'paper' : 'y') as 'paper' | 'y', y: isH ? 1 : avgR,
    text: 'Avg ' + avgR, showarrow: false,
    xanchor: (isH ? 'center' : 'right') as 'center' | 'right', yanchor: 'bottom' as 'bottom',
    font: { size: 10, color: '#475569' }, bgcolor: 'rgba(255,255,255,0.72)',
  }] : []

  return <PlotlyChart traces={[trace]} layout={{
    title: catLabel + clipBadge(MAX_CATEGORIES_PER_CHART, totalGroups),
    xaxis: { title: isH ? valLabel : '', ...(!isH ? catXAxis(cats) : {}) },
    yaxis: { title: isH ? '' : valLabel },
    barcornerradius: 4,
    shapes: avgShapes,
    annotations: avgAnnotations,
  }} />
}

// ─── Gauge Card (SVG arc gauge matching Ana.html style) ───────────────────

function GaugeCard({ label, avg, median, min, max, n, overallAvg, accentColor, q1, q3 }: { label: string; avg: number; median: number; min: number; max: number; n: number; overallAvg: number | null; accentColor?: string; q1?: number | null; q3?: number | null }) {
  var gaugeAccent = accentColor || T.accent
  var range = max - min || 1
  var pct = Math.max(0, Math.min(1, (avg - min) / range))
  var angle = -90 + pct * 180 // -90 to 90 degrees
  // Band boundaries: REAL quartiles when the caller has them, so the legend's
  // "Bottom 25% / Middle 50% / Top 25%" is true of the data. Without quartiles
  // the bands fall back to fixed quarters of the min–max RANGE and the legend
  // says so — the old card always drew range-quarters but labeled them as
  // percentiles (2026-09-03 audit).
  var toAngle = function(v: number) { return -90 + Math.max(0, Math.min(1, (v - min) / range)) * 180 }
  var hasQ = n > 0 && q1 != null && q3 != null && isFinite(q1) && isFinite(q3) && q1 <= q3 && q1 >= min && q3 <= max
  var bandLo = hasQ ? toAngle(q1!) : -45
  var bandHi = hasQ ? toAngle(q3!) : 45
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

        {/* Background bands: below-Q1 pink, IQR amber, above-Q3 green (range
            thirds-of-quarters fallback when quartiles are unavailable) */}
        {bandLo - (-90) > 1 && <path d={arcPath(-90, bandLo, r)} fill="none" stroke="#fecdd3" strokeWidth={14} strokeLinecap="round" />}
        {bandHi - bandLo > 1 && <path d={arcPath(bandLo, bandHi, r)} fill="none" stroke="#fed7aa" strokeWidth={14} strokeLinecap="round" />}
        {90 - bandHi > 1 && <path d={arcPath(bandHi, 90, r)} fill="none" stroke="#bbf7d0" strokeWidth={14} strokeLinecap="round" />}

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
        <text x="20" y="180" style={{ fontSize: 8, fill: T.textFaint }}>{hasQ ? 'Bottom 25%' : 'Low range'}</text>
        <rect x="76" y="172" width="8" height="8" rx="2" fill="#fed7aa" />
        <text x="88" y="180" style={{ fontSize: 8, fill: T.textFaint }}>{hasQ ? 'Middle 50%' : 'Mid range'}</text>
        <rect x="148" y="172" width="8" height="8" rx="2" fill="#bbf7d0" />
        <text x="160" y="180" style={{ fontSize: 8, fill: T.textFaint }}>{hasQ ? 'Top 25%' : 'High range'}</text>
      </svg>
    </div>
  )
}

// Distribution fallback when the summary has no histogram: hand Plotly the raw
// numeric values so the box's quartiles/whiskers are computed from real data.
function DistRowsFallbackInner({ datasetId, numField, schema, color }: { datasetId: string; numField: string; schema: SchemaField[]; color: string }) {
  var { rows, loaded } = useChartRows(datasetId, _enrichCtx.enrichKey || 0)
  if (!loaded) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, padding: 40 }}><LottieLoader size={120} message="Loading chart data…" /></div>
  var vals: number[] = []
  rows.forEach(function(r) { var v = toNumericOrNull(r[numField]); if (v !== null) vals.push(v) })
  if (!vals.length) return <EmptyChart msg="No numeric data." />
  var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals)
  var fieldAlias = flByName(numField, schema)
  return <PlotlyChart traces={[{ type: 'box', y: vals, boxpoints: 'outliers', boxmean: true, marker: { color: color }, name: fieldAlias }]} layout={{ title: fieldAlias, yaxis: { title: fieldAlias, ...(isSmallIntRange(lo, hi) ? { dtick: 1 } : {}) }, showlegend: false }} />
}

function DistSplitInner({ analytics, schema, datasetId, numField, splitByField, colors, smartAxes }: { analytics: Analytics; schema: SchemaField[]; datasetId: string; numField: string; splitByField: string; colors?: string[]; smartAxes?: boolean }) {
  var distDimAxis = axisOfDimField(splitByField)
  var distAgg = useAggregation(datasetId, distDimAxis ? { op: 'tax_group_stats', axis: distDimAxis, valueField: numField } : null)
  var { rows, loaded: distRowsLoaded } = useChartRows(datasetId, distDimAxis ? -1 : (_enrichCtx.enrichKey || 0))
  var loaded = distDimAxis ? distAgg.loaded : distRowsLoaded
  if (!loaded) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, padding: 40 }}><LottieLoader size={120} message="Loading chart data\u2026" /></div>
  var pal = colors || CHART_COLORS
  var numSumD = analytics.fieldSummaries?.[numField]
  var intYD = isSmallIntRange(numSumD?.min, numSumD?.max)
  // Dimension split \u2192 precomputed box per sub (server can't ship raw per-row values).
  if (distDimAxis) {
    var dg = (distAgg.data && distAgg.data.groups) as Record<string, { n: number; mean: number; median: number; min: number; max: number; q1: number | null; q3: number | null }> | undefined
    var dKeys = dg ? Object.keys(dg).filter(function(k) { return dg![k].q1 != null && dg![k].q3 != null }) : []
    if (!dKeys.length) return <EmptyChart msg="No numeric data for this split." />
    var dTotal = dKeys.reduce(function(s, k) { return s + dg![k].n }, 0)
    var dTraces = dKeys.map(function(k, i) {
      var st = dg![k]
      var pct = dTotal > 0 ? Math.round(st.n / dTotal * 100) : 0
      return { type: 'box' as const, name: resolveAlias(splitByField, k, schema) + ' (' + pct + '%)', q1: [st.q1], median: [st.median], q3: [st.q3], lowerfence: [st.min], upperfence: [st.max], mean: [st.mean], marker: { color: pal[i % pal.length] } }
    })
    return <PlotlyChart traces={dTraces} layout={{ title: flByName(numField, schema) + ' by ' + flByName(splitByField, schema), yaxis: { title: flByName(numField, schema), ...(intYD ? { dtick: 1, tick0: numSumD?.min } : {}) }, legend: { orientation: 'v' as const, x: 1.02, y: 1, xanchor: 'left' as const, yanchor: 'top' as const, title: { text: flByName(splitByField, schema) } }, margin: { t: 48, r: 220, b: 56, l: 56 } }} />
  }
  var groups: Record<string, number[]> = {}
  rows.forEach(function(r) {
    var grp = String(r[splitByField] || '').trim()
    var val = toNumericOrNull(r[numField])
    if (!grp || val === null) return
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
  var numSum = analytics.fieldSummaries?.[numField]
  var intY = isSmallIntRange(numSum?.min, numSum?.max)
  var totalND = Object.values(groups).reduce(function(a, arr) { return a + arr.length }, 0)
  var traces = keys.map(function(k, i) {
    var pct = totalND > 0 ? Math.round(groups[k].length / totalND * 100) : 0
    var kLabel = resolveAlias(splitByField, k, schema)
    return { type: 'box' as const, y: groups[k], name: kLabel + ' (' + pct + '%)', marker: { color: pal[i % pal.length] }, boxpoints: 'outliers' as const }
  })
  // Vertical-right legend so it doesn't compete with the rotated x-axis
  // labels for the strip below the plot. With long category names (20+
  // locations) and an `orientation: 'h', y: -0.2` legend, the labels and
  // legend pile on top of each other. Right-side keeps both readable.
  return <PlotlyChart traces={traces} layout={{ title: flByName(numField, schema) + ' by ' + flByName(splitByField, schema), yaxis: { title: flByName(numField, schema), ...(intY ? { dtick: 1, tick0: numSum?.min } : {}) }, legend: { orientation: 'v' as const, x: 1.02, y: 1, xanchor: 'left' as const, yanchor: 'top' as const, title: { text: flByName(splitByField, schema) } }, margin: { t: 48, r: 220, b: 56, l: 56 } }} />
}

function BulletSplitInner({ analytics, schema, datasetId, measureField, splitByField, smartAxes, colors }: { analytics: Analytics; schema: SchemaField[]; datasetId: string; measureField: string; splitByField: string; smartAxes?: boolean; colors?: string[] }) {
  var bulletPal = colors || CHART_COLORS
  var isCollection = _enrichCtx.datasetSource === 'collection'
  var bulletDimAxis = axisOfDimField(splitByField)
  var needsRows = !bulletDimAxis && (isCollection || splitByField.startsWith('__') || measureField.startsWith('__'))
  var aggSpec = bulletDimAxis
    ? { op: 'tax_group_stats', axis: bulletDimAxis, valueField: measureField }
    : (!needsRows && splitByField && measureField ? { op: 'group_stats', groupField: splitByField, valueField: measureField } : null)
  var { data: aggData, loaded: aggLoaded } = useAggregation(datasetId, aggSpec)
  var { rows, loaded: rowsLoaded } = useChartRows(datasetId, needsRows ? (_enrichCtx.enrichKey || 0) : -1)
  var loaded = needsRows ? rowsLoaded : aggLoaded
  var [showAllKPI, setShowAllKPI] = useState(false)
  if (!loaded) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, padding: 40 }}><LottieLoader size={120} message="Loading chart data\u2026" /></div>

  // Build stats from aggregation API or rows. q1/q3 feed the gauge's quartile
  // bands — the tax_group_stats path returns them, plain group_stats doesn't
  // (gauge falls back to labeled range bands).
  var stats: { label: string; avg: number; median: number; min: number; max: number; n: number; q1: number | null; q3: number | null }[] = []
  var totalKPI = 0

  if (!needsRows && aggData && aggData.groups) {
    var aggGroups = aggData.groups as Record<string, { n: number; mean: number; median: number; min: number; max: number; q1?: number | null; q3?: number | null }>
    Object.entries(aggGroups).forEach(function(e) {
      totalKPI += e[1].n
      stats.push({ label: resolveAlias(splitByField, e[0], schema), avg: e[1].mean, median: e[1].median, min: e[1].min, max: e[1].max, n: e[1].n, q1: e[1].q1 ?? null, q3: e[1].q3 ?? null })
    })
  } else {
    var groups: Record<string, number[]> = {}
    rows.forEach(function(r) {
      var grp = String(r[splitByField] || '').trim()
      var val = toNumericOrNull(r[measureField])
      if (!grp || grp === '(blank)' || grp === '' || val === null) return
      if (!groups[grp]) groups[grp] = []
      groups[grp].push(val)
    })
    totalKPI = Object.values(groups).reduce(function(s, v) { return s + v.length }, 0)
    Object.keys(groups).forEach(function(grp) {
      var vs = groups[grp].slice().sort(function(a, b) { return a - b })
      stats.push({ label: resolveAlias(splitByField, grp, schema), avg: vs.reduce(function(a, b) { return a + b }, 0) / vs.length, median: pctl(vs, 0.5), min: vs[0], max: vs[vs.length - 1], n: vs.length, q1: pctl(vs, 0.25), q3: pctl(vs, 0.75) })
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
          return <GaugeCard key={s.label} label={s.label + ' (' + pctB + '%)'} avg={s.avg} median={s.median} min={stats.reduce(function(m, x) { return Math.min(m, x.min) }, Infinity)} max={stats.reduce(function(m, x) { return Math.max(m, x.max) }, -Infinity)} n={s.n} overallAvg={overallAvg} accentColor={bulletPal[si % bulletPal.length]} q1={s.q1} q3={s.q3} />
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
  var [regressionResults, setRegressionResults] = useState<ImpactAnalysis[]>([]) // one per OE field
  var [combinedResult, setCombinedResult] = useState<ImpactAnalysis | null>(null)

  var themeModel = _enrichCtx.themeModel
  var hasThemes = themeModel && themeModel.themes && themeModel.themes.length > 0

  // OE fields available for regression
  var oeFields = schema.filter(function(f) { return f.type === 'open-ended' })
  var [selectedOE, setSelectedOE] = useState<Set<string>>(new Set(oeFields.map(function(f) { return f.field })))

  // Run regression per OE field + combined when mode switches. setState is the
  // output of an expensive regression gated on the inputs below (not derivable
  // cheaply during render), so it stays in an effect.
  useEffect(function() {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- expensive derived analysis, gated on the deps below
    if (mode !== 'regression' || !loaded || !hasThemes || selectedOE.size === 0) { setRegressionResults([]); setCombinedResult(null); return }
    var { computeThemeImpact } = require('@/lib/themeImpact')
    var themeInput = themeModel!.themes.map(function(t) { return { id: t.id || '', name: t.name || '', keywords: t.keywords || [] } })
    var scoreFieldObj = schema.find(function(f) { return f.field === scoreField })
    var oeArr = Array.from(selectedOE)

    // Per-field regressions
    var perField: ImpactAnalysis[] = []
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
    // rows/schema/themeModel/hasThemes added so the regression recomputes when
    // the filtered rows change — without them it went stale under an active filter.
  }, [mode, loaded, selectedOE, scoreField, rows, schema, themeModel, hasThemes])

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
    // Canonical matcher from themeUtils — replaces a local near-duplicate that
    // lacked multi-word gap handling, so driver mention counts disagreed with
    // TextMine's recount over the same themes.
    var themeRegexes = themeModel!.themes.map(function(t) { return (t.keywords || []).filter(Boolean).map(buildKwRegex) })

    for (var fi = 0; fi < oeArr.length; fi++) {
      var oeFld = oeArr[fi]
      var fldObj = schema.find(function(f) { return f.field === oeFld })
      var fldLabel = fldObj?.label || oeFld
      var themeScores: Record<string, number[]> = {}
      themeModel!.themes.forEach(function(t) { themeScores[t.name] = [] })

      rows.forEach(function(r: Record<string, unknown>) {
        var score = parseFloat(String(r[scoreField] || '').replace(/,/g, ''))
        if (isNaN(score)) return
        var text = String(r[oeFld] || '').toLowerCase().trim()
        if (!text) return
        for (var ti = 0; ti < themeModel!.themes.length; ti++) {
          if (themeRegexes[ti].length > 0 && themeRegexes[ti].some(function(re: RegExp) { return re.test(text) })) {
            themeScores[themeModel!.themes[ti].name].push(score)
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

  // One bar of the driver chart; `significant` only set by the regression path.
  interface DriverStat { name: string; avg: number; median: number; n: number; delta: number; themeColor?: string | null; significant?: boolean }
  var chartData: DriverStat[] = stats
  var xLabel = '\u0394 vs overall avg (' + overallAvg.toFixed(1) + ')'
  var xFormat = '+.2f'
  var rInfo = ''
  var isGrouped = false
  var traces: Record<string, unknown>[] = []
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
    regressionResults.forEach(function(r: ImpactAnalysis) { r.impacts.forEach(function(imp: ThemeImpactResult) { allNames.add(imp.themeName) }) })
    var themeNames = Array.from(allNames)
    // Sort by absolute max coefficient across fields
    themeNames.sort(function(a, b) {
      var maxA = 0, maxB = 0
      regressionResults.forEach(function(r: ImpactAnalysis) {
        var ia = r.impacts.find(function(i: ThemeImpactResult) { return i.themeName === a })
        var ib = r.impacts.find(function(i: ThemeImpactResult) { return i.themeName === b })
        if (ia) maxA = Math.max(maxA, Math.abs(ia.coefficient))
        if (ib) maxB = Math.max(maxB, Math.abs(ib.coefficient))
      })
      return maxA - maxB
    })

    var maxAbs = 0.1
    regressionResults.forEach(function(r: ImpactAnalysis, ri: number) {
      var coeffs = themeNames.map(function(tn) {
        var imp = r.impacts.find(function(i: ThemeImpactResult) { return i.themeName === tn })
        return imp ? imp.coefficient : 0
      })
      coeffs.forEach(function(c) { if (Math.abs(c) > maxAbs) maxAbs = Math.abs(c) })
      var baseColor = fieldColors[ri % fieldColors.length]
      var barOpacities = coeffs.map(function(c, ci) {
        var imp = r.impacts.find(function(i: ThemeImpactResult) { return i.themeName === themeNames[ci] })
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
    rInfo = regressionResults.map(function(r: ImpactAnalysis) {
      return (r.fieldLabel || '?') + ': R\u00B2=' + (r.rSquared * 100).toFixed(0) + '%'
    }).join('  \u00B7  ') + '  \u00B7  n=' + (regressionResults[0]?.n || 0).toLocaleString()

    chartData = themeNames.map(function(n) { return { name: n, avg: 0, median: 0, n: 0, delta: 0, themeColor: null } })
    xPad = maxAbs * 0.4

  } else if (useRegression) {
    // Single OE field — single trace
    var singleResult = regressionResults[0]
    chartData = singleResult.impacts.map(function(imp: ThemeImpactResult) {
      return { name: imp.themeName, delta: imp.coefficient, n: imp.mentions, avg: imp.avgScore || 0, significant: imp.significant }
    }) as unknown as typeof chartData
    xLabel = 'Regression coefficient (impact on ' + scoreLabel + ')'
    xFormat = '+.1f'
    rInfo = 'R\u00B2 = ' + (singleResult.rSquared * 100).toFixed(1) + '%  \u00B7  n = ' + singleResult.n.toLocaleString() + '  \u00B7  baseline = ' + singleResult.intercept.toFixed(1)
  }

  if (!isGrouped) {
    if (sortBy === 'delta') chartData.sort(function(a, b) { return a.delta - b.delta })
    else chartData.sort(function(a, b) { return a.n - b.n })

    maxAbs = chartData.reduce(function(m: number, s) { return Math.max(m, Math.abs(s.delta)) }, 0) || 1

    var names = chartData.map(function(s) { return s.name })
    var deltas = chartData.map(function(s) { return parseFloat(s.delta.toFixed(3)) })
    var barClrs = chartData.map(function(s) {
      var sig = useRegression ? (s.significant !== false) : true
      var intensity = sig ? Math.min(1, 0.45 + (Math.abs(s.delta) / maxAbs) * 0.55) : 0.25
      return s.delta >= 0
        ? 'rgba(22,163,74,' + intensity + ')'
        : 'rgba(220,38,38,' + intensity + ')'
    })

    traces = [{
      type: 'bar' as const, y: names, x: deltas, orientation: 'h' as const,
      marker: { color: barClrs, line: { width: 0 } },
      text: chartData.map(function(s) {
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

  var layout: ChartLayout = {
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
            return <button key={pair[0]} onClick={function() { setMode(pair[0] as 'delta' | 'regression') }}
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
            return <button key={pair[0]} onClick={function() { setSortBy(pair[0] as 'delta' | 'count') }}
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
        var sorted = chartData.slice().sort(function(a, b) { return Math.abs(b.delta) - Math.abs(a.delta) })
        var topPos = sorted.find(function(s) { return s.delta > 0 })
        var topNeg = sorted.find(function(s) { return s.delta < 0 })
        var sigCount = useRegression ? chartData.filter(function(s) { return s.significant }).length : 0

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
  rows.forEach(function(r) { var xv = toNumericOrNull(r[xField]), yv = toNumericOrNull(r[yField]); if (xv !== null && yv !== null) { x.push(xv); y.push(yv) } })
  if (!x.length) return <EmptyChart msg="No numeric pairs found." />
  var xSum = analytics.fieldSummaries?.[xField]
  var ySum = analytics.fieldSummaries?.[yField]
  var intX = isSmallIntRange(xSum?.min, xSum?.max)
  var intY = isSmallIntRange(ySum?.min, ySum?.max)
  return <PlotlyChart traces={[{ x: x, y: y, mode: 'markers', type: 'scatter', marker: { color: T.accent, size: 6, opacity: 0.6 } }]} layout={{ title: flByName(xField, schema) + ' vs ' + flByName(yField, schema), xaxis: { title: flByName(xField, schema), ...(intX ? { dtick: 1, tick0: xSum?.min } : {}) }, yaxis: { title: flByName(yField, schema), ...(intY ? { dtick: 1, tick0: ySum?.min } : {}) }, showlegend: false }} />
}

function CrosstabInner({ analytics, schema, datasetId, rowField, colField }: { analytics: Analytics; schema: SchemaField[]; datasetId: string; rowField: string; colField: string }) {
  var isCollection = _enrichCtx.datasetSource === 'collection'
  var taxSpec = !isCollection ? taxCrosstabSpec(rowField, colField, 30) : null
  var needsRows = !taxSpec && (isCollection || rowField.startsWith('__') || colField.startsWith('__'))
  var aggSpec = taxSpec || (!needsRows && rowField && colField ? { op: 'crosstab', rowField: rowField, colField: colField, limit: 30 } : null)
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
  // Cap each dimension at the top-30 values by marginal count \u2014 the rows
  // fallback path was unbounded (a 200-value field drew a 200-row heatmap).
  // Display order (smartOrder) applies to the kept subset; clip disclosed.
  var HEATMAP_CAP = 30
  var rTotals: Record<string, number> = {}, cTotals: Record<string, number> = {}
  Object.keys(grid).forEach(function(rv) { Object.entries(grid[rv]).forEach(function(e) { rTotals[rv] = (rTotals[rv] || 0) + e[1]; cTotals[e[0]] = (cTotals[e[0]] || 0) + e[1] }) })
  var totalR = rSet.size, totalC = cSet.size
  var rKept = Array.from(rSet), cKept = Array.from(cSet)
  if (rKept.length > HEATMAP_CAP) rKept = rKept.sort(function(a, b) { return (rTotals[b] || 0) - (rTotals[a] || 0) }).slice(0, HEATMAP_CAP)
  if (cKept.length > HEATMAP_CAP) cKept = cKept.sort(function(a, b) { return (cTotals[b] || 0) - (cTotals[a] || 0) }).slice(0, HEATMAP_CAP)
  var rArr = smartOrder(rKept, rowFieldObj?.remapping)
  var cArr = smartOrder(cKept, colFieldObj?.remapping)
  var z = rArr.map(function(r) { return cArr.map(function(c) { return grid[r] ? (grid[r][c] || 0) : 0 }) })
  var rLabels = wrapLabels(rArr.map(function(v) { return resolveAlias(rowField, v, schema) }), 22)
  var cLabels = wrapLabels(cArr.map(function(v) { return resolveAlias(colField, v, schema) }), 18)
  var xtClip = (totalR > HEATMAP_CAP || totalC > HEATMAP_CAP) ? clipBadge(HEATMAP_CAP, Math.max(totalR, totalC)) : ''
  return <PlotlyChart traces={[{ type: 'heatmap', x: cLabels, y: rLabels, z: z, colorscale: 'YlOrRd', showscale: true }]} layout={{ title: flByName(rowField, schema) + ' \u00D7 ' + flByName(colField, schema) + xtClip, xaxis: { title: flByName(colField, schema), ...catXAxis(cLabels) }, yaxis: { title: flByName(rowField, schema) }, margin: { t: 48, r: 60, b: 60, l: 100 } }} />
}

function TimeSeriesInner({ analytics, schema, datasetId, dateField, metricField, colorByField, colors }: { analytics: Analytics; schema: SchemaField[]; datasetId: string; dateField: string; metricField: string; colorByField?: string; colors?: string[] }) {
  var [bucketOverride, setBucketOverride] = useState<TimeBucket | 'auto'>('auto')
  var [splitMode, setSplitMode] = useState(false)
  var [compareMode, setCompareMode] = useState<'off' | 'prev' | 'yoy'>('off')
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
  var hasBreakdown = !!(colorByField && colorByField.trim())
  // Skip the SQL date_series aggregation when a breakdown is active.
  // date_series returns one series with no breakdown column so it can't
  // drive multi-line charts. Forcing the rows path also keeps rows in
  // sync with theme-filter toggles — when enrichKey is -1 the
  // useChartRows useEffect short-circuits and stale (pre-toggle) rows
  // survive, which is the bug behind "I unchecked a theme but the line
  // is still showing."
  // Dimension breakdown (colour-by an axis) → server-side date series per sub.
  var tsDimAxis = hasBreakdown ? axisOfDimField(colorByField!) : null
  var taxSeriesSpec = tsDimAxis && dateField ? { op: 'tax_date_series', axis: tsDimAxis, dateField: dateField, metricField: metricField || null, bucket: sqlBucket } : null
  var taxSeries = useAggregation(datasetId, taxSeriesSpec)
  var aggSpec = !isCollection && dateField && !hasBreakdown ? { op: 'date_series', dateField: dateField, metricField: metricField || null, bucket: sqlBucket } : null
  var { data: aggData, loaded: aggLoaded } = useAggregation(datasetId, aggSpec)
  var useRowsFallback = !tsDimAxis && (isCollection || hasBreakdown || !aggLoaded || !(aggData?.series))
  var { rows, loaded: rowsLoaded } = useChartRows(datasetId, useRowsFallback ? (_enrichCtx.enrichKey || 0) : -1)
  var loaded = tsDimAxis ? taxSeries.loaded : ((isCollection || hasBreakdown) ? rowsLoaded : (aggLoaded && aggData?.series ? true : rowsLoaded))
  // Precomputed (sub → date → {n, avg}) from the dimension date-series, used by
  // the breakdown trace builders below in place of raw per-row arrays.
  var catAgg: Record<string, Record<string, { n: number; avg: number | null }>> | null = null
  if (tsDimAxis && taxSeries.data && taxSeries.data.series) {
    catAgg = {}
    taxSeries.data.series.forEach(function(s: { sub: string; date: string; count: number; avg: number | null }) {
      if (!catAgg![s.sub]) catAgg![s.sub] = {}
      catAgg![s.sub][s.date] = { n: s.count, avg: s.avg }
    })
  }
  var [smooth, setSmooth] = useState(false)
  var [window, setWindow] = useState(7)
  if (!loaded) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, padding: 40 }}><LottieLoader size={120} message="Loading chart data\u2026" /></div>

  // ── Build traces — with optional categorical breakdown ──────────────
  var traces: Record<string, unknown>[] = []
  // Period comparison only makes sense on the single-line chart with a
  // calendar-grid bucket (hour/year buckets have no honest prior window).
  var compareActive = compareMode !== 'off' && !hasBreakdown && effectiveBucket !== 'hour' && effectiveBucket !== 'year'
  var periodCmp: PeriodComparison | null = null

  // Pre-compute breakdown groups (used by both combined and split modes)
  var catGroups: Record<string, Record<string, number[]>> = {}
  var sortedDates: string[] = []
  var catNames: string[] = []

  // y value for a (category, bucket) — from the dimension date-series when
  // present, else from the raw per-row arrays.
  // Metric mode: a bucket with no numeric value is a GAP (null), not a false 0.
  // Count mode: a missing bucket is a real 0 (no rows that day).
  var tsBreakdownY = function(cat: string, d: string): number | null {
    if (catAgg) { var a = catAgg[cat] && catAgg[cat][d]; return a ? (metricField ? a.avg : a.n) : (metricField ? null : 0) }
    var arr = catGroups[cat] && catGroups[cat][d]
    if (!arr || arr.length === 0) return metricField ? null : 0
    return metricField ? arr.reduce(function(a, b) { return a + b }, 0) / arr.length : arr.length
  }

  if (hasBreakdown) {
    // Group rows by category value, then by bucketed date. Rows where the
    // breakdown field is empty / null are dropped entirely — they were
    // previously surfaced as a "(blank)" line in the chart, but the Filter
    // Themes sidebar doesn't list "(blank)" so the user couldn't toggle
    // it off. Skipping them keeps chart and sidebar in sync.
    var allDates = new Set<string>()
    if (catAgg) {
      Object.keys(catAgg).forEach(function(cat) { Object.keys(catAgg![cat]).forEach(function(d) { allDates.add(d) }) })
    } else {
      rows.forEach(function(r) {
        var raw = String(r[dateField] || ''); if (!raw) return
        var rawCat = r[colorByField!]
        var cat = String(rawCat ?? '').trim()
        if (!cat) return  // drop unlabeled rows from the breakdown
        var d = bucketKey(raw, effectiveBucket)
        allDates.add(d)
        if (!catGroups[cat]) catGroups[cat] = {}
        if (!catGroups[cat][d]) catGroups[cat][d] = []
        if (metricField) { var v = toNumericOrNull(r[metricField]); if (v !== null) catGroups[cat][d].push(v) } else { catGroups[cat][d].push(1) }
      })
    }
    sortedDates = Array.from(allDates).sort()
    catNames = (catAgg ? Object.keys(catAgg) : Object.keys(catGroups)).sort()
    catNames.forEach(function(cat, ci) {
      var yVals = sortedDates.map(function(d) { return tsBreakdownY(cat, d) })
      traces.push({ x: sortedDates, y: yVals, type: 'scatter', mode: 'lines+markers', line: { color: pal[ci % pal.length], width: 2 }, marker: { size: 4 }, name: cat, showlegend: true })
    })
  } else {
    // Single line — original behavior
    var dates: string[] = []
    var yVals: number[] = []
    var bucketCounts: number[] = []
    var bucketSums: (number | null)[] = []
    if (aggData && aggData.series && aggData.series.length > 0) {
      // Metric mode: skip buckets with no numeric value (a null avg) so the line
      // connects across the gap instead of dropping to a false 0.
      aggData.series.forEach(function(s: { date: string; avg: number | null; count: number }) {
        if (metricField && s.avg == null) return
        dates.push(s.date); yVals.push(metricField ? (s.avg as number) : s.count)
        bucketCounts.push(s.count); bucketSums.push(metricField && s.avg != null ? s.avg * s.count : null)
      })
    } else {
      var grouped: Record<string, number[]> = {}
      rows.forEach(function(r) { var raw = String(r[dateField] || ''); if (!raw) return; var d = bucketKey(raw, effectiveBucket); if (metricField) { var v = toNumericOrNull(r[metricField]); if (v === null) return; (grouped[d] || (grouped[d] = [])).push(v) } else { (grouped[d] || (grouped[d] = [])).push(1) } })
      dates = Object.keys(grouped).sort()
      yVals = dates.map(function(d) { var arr = grouped[d]; return metricField ? arr.reduce(function(a, b) { return a + b }, 0) / arr.length : arr.length })
      bucketCounts = dates.map(function(d) { return grouped[d].length })
      bucketSums = dates.map(function(d) { return metricField ? grouped[d].reduce(function(a, b) { return a + b }, 0) : null })
    }

    // Period-over-period overlay (owner ask: "vs last month", "same quarter
    // last year"). Calendar-exact alignment lives in lib/periodCompare; when
    // the data can't honestly support the comparison it returns null and the
    // chart falls back to the plain line with a note.
    if (compareActive) {
      periodCmp = buildPeriodComparison({
        dates: dates, counts: bucketCounts, sums: metricField ? bucketSums : undefined,
        unit: effectiveBucket as 'day' | 'week' | 'month' | 'quarter',
        mode: compareMode as 'prev' | 'yoy', metric: !!metricField,
      })
    }

    if (periodCmp) {
      traces.push({
        x: periodCmp.x, y: periodCmp.comparison, customdata: periodCmp.comparisonKeys,
        type: 'scatter', mode: 'lines+markers', line: { color: '#9ca3af', width: 2, dash: 'dash' },
        marker: { size: 4 }, name: compareMode === 'yoy' ? 'Same period last year' : 'Previous period',
        showlegend: true, hovertemplate: '%{customdata}: %{y}<extra></extra>',
      })
      traces.push({
        x: periodCmp.x, y: periodCmp.current, type: 'scatter', mode: 'lines+markers',
        line: { color: T.accent, width: 2.5 }, marker: { size: 5 }, name: 'Current period', showlegend: true,
      })
    } else {
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
  }

  var bucketLabel = BUCKET_OPTIONS.find(function(o) { return o.value === effectiveBucket })?.label || 'Daily'

  // Build split chart data if splitMode + breakdown
  var splitCharts: { name: string; traces: Record<string, unknown>[]; color: string }[] = []
  if (hasBreakdown && splitMode && catNames.length > 0) {
    catNames.forEach(function(cat, ci) {
      var yVals = sortedDates.map(function(d) { return tsBreakdownY(cat, d) })
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
          <select value={bucketOverride} onChange={function(e) { setBucketOverride(e.target.value as TimeBucket | 'auto') }}
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
        {!hasBreakdown && effectiveBucket !== 'hour' && effectiveBucket !== 'year' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10, color: T.textFaint }}>Compare:</span>
            <select value={compareMode} onChange={function(e) { setCompareMode(e.target.value as 'off' | 'prev' | 'yoy') }}
              style={{ fontSize: 10, color: T.textMid, border: '1px solid ' + T.border, borderRadius: 8, padding: '2px 6px', background: 'transparent', cursor: 'pointer' }}>
              <option value="off">Off</option>
              <option value="prev">Previous period</option>
              <option value="yoy">Same period last year</option>
            </select>
          </div>
        )}
        {!hasBreakdown && !compareActive && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.textMute, cursor: 'pointer' }}>
            <input type="checkbox" checked={smooth} onChange={function() { setSmooth(function(v) { return !v }) }} style={{ accentColor: T.accent }} />
            Smooth curve
          </label>
        )}
        {!hasBreakdown && !compareActive && smooth && (
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
      {compareActive && periodCmp && (function() {
        var d = periodCmp.delta
        var fmt = function(v: number) { return metricField ? (Math.round(v * 100) / 100).toString() : Math.round(v).toLocaleString() }
        var pct = d.pctChange
        return (
          <div style={{ fontSize: 11, color: T.textMid, marginBottom: 6 }}>
            <strong style={{ color: T.text }}>{fmt(d.currentTotal)}</strong>
            {' vs '}{fmt(d.priorTotal)}{metricField ? ' avg' : ''}
            {pct != null && (
              <span style={{ fontWeight: 700, marginLeft: 6, color: pct >= 0 ? '#0d9488' : '#e11d48' }}>
                {pct >= 0 ? '▲' : '▼'} {Math.abs(Math.round(pct * 10) / 10)}%
              </span>
            )}
            <span style={{ marginLeft: 6 }}>{periodCmp.label}</span>
          </div>
        )
      })()}
      {compareActive && !periodCmp && (
        <div style={{ fontSize: 11, color: T.textMute, marginBottom: 6 }}>
          Not enough history for this comparison — it needs at least 4 {effectiveBucket} buckets per period{compareMode === 'yoy' ? ' and a full year of earlier data' : ''}.
        </div>
      )}
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

function GanttInner({ analytics, schema, datasetId, catField, rangeField, colors }: { analytics: Analytics; schema: SchemaField[]; datasetId: string; catField: string; rangeField: string; colors?: string[] }) {
  var ganttDimAxis = axisOfDimField(catField)
  var agg = useAggregation(datasetId, ganttDimAxis ? { op: 'tax_group_stats', axis: ganttDimAxis, valueField: rangeField } : null)
  var { rows, loaded: rowsLoaded } = useChartRows(datasetId, ganttDimAxis ? -1 : (_enrichCtx.enrichKey || 0))
  var loaded = ganttDimAxis ? agg.loaded : rowsLoaded
  if (!loaded) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, padding: 40 }}><LottieLoader size={120} message="Loading chart data\u2026" /></div>
  var ganttFieldObj = schema.find(function(f) { return f.field === catField })
  var catArr: string[], mins: number[], ranges: number[]
  if (ganttDimAxis && agg.data && agg.data.groups) {
    var g = agg.data.groups as Record<string, { min: number; max: number }>
    catArr = Object.keys(g)
    mins = catArr.map(function(c) { return g[c].min })
    ranges = catArr.map(function(c) { return g[c].max - g[c].min })
  } else {
    var groups: Record<string, number[]> = {}
    rows.forEach(function(r) { var c = String(r[catField] || '').trim(); var v = toNumericOrNull(r[rangeField]); if (c && v !== null) { if (!groups[c]) groups[c] = []; groups[c].push(v) } })
    catArr = smartOrder(Object.keys(groups), ganttFieldObj?.remapping); mins = catArr.map(function(c) { return Math.min.apply(null, groups[c]) }); ranges = catArr.map(function(c) { return Math.max.apply(null, groups[c]) - Math.min.apply(null, groups[c]) })
  }
  if (!catArr.length) return <EmptyChart msg={'No numeric values in "' + flByName(rangeField, schema) + '" to plot as a range.'} />
  var gPal = colors || CHART_COLORS
  return <PlotlyChart traces={[{ type: 'bar', orientation: 'h' as const, y: catArr, x: mins, marker: { color: 'rgba(0,0,0,0)' }, showlegend: false, hoverinfo: 'skip' as const }, { type: 'bar', orientation: 'h' as const, y: catArr, x: ranges, marker: { color: catArr.map(function(_, i) { return gPal[i % gPal.length] }) }, name: 'Range' }]} layout={{ title: flByName(catField, schema), barmode: 'stack', xaxis: { title: flByName(rangeField, schema) }, showlegend: false, margin: { l: 120 } }} />
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
      virtualFields.push({ field: '__mapped_' + f.field + '__', type: 'numeric', label: (f.label || f.field) + ' (score)' })
    }
  })
  var cols = schema.filter(function(f) { return f.type !== 'ignore' && f.hidden !== true }).concat(virtualFields)
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

export default function ChartsModule({ datasetId, schema, analytics, themeModel, datasetSource, taxonomyEnabled, taxonomySuppressed }: Props) {
  var rawOpenFields = schema.fields.filter(function(f) { return f.type === 'open-ended' })
  var _themeKey = 'chartTheme_' + datasetId
  var _displayKey = 'chartDisplay_' + datasetId
  var _activeChartKey = 'activeChart_' + datasetId

  // All session-persisted state initializes to its default to keep server
  // and client first renders in sync. A single post-mount useEffect reads
  // sessionStorage and restores via setters. The chartsRestored gate stops
  // the writer-effects below from clobbering saved state with defaults.
  var [themeSourceField, setThemeSourceField] = useState(function() { return (themeModel && themeModel.fieldName) || rawOpenFields[0]?.field || '' })
  var [activeThemeNames, setActiveThemeNames] = useState<Set<string> | null>(null)
  var [enrichKey, setEnrichKey] = useState(0)
  var [activeChart, setActiveChart] = useState('bar')
  var [hovered, setHovered] = useState<string | null>(null)
  var [barMode, setBarMode] = useState<'count' | 'percent' | 'average'>('count')
  var [barStack, setBarStack] = useState(false)
  var [barOrient, setBarOrient] = useState<'v' | 'h'>('v')
  var [smartAxes, setSmartAxes] = useState(true)
  var [activePalette, setActivePalette] = useState('hermes')
  var [showPalettePicker, setShowPalettePicker] = useState(false)
  var [chartsRestored, setChartsRestored] = useState(false)

  useEffect(function() {
    var savedTheme = readSession<{ themeSourceField?: string; activeThemeNames?: string[] | null }>(_themeKey)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restores persisted UI state from sessionStorage on mount / dataset-key change
    if (savedTheme?.themeSourceField) setThemeSourceField(savedTheme.themeSourceField)
    if (Array.isArray(savedTheme?.activeThemeNames)) setActiveThemeNames(new Set(savedTheme.activeThemeNames))

    var savedChart = readSession<string>(_activeChartKey)
    if (savedChart) setActiveChart(savedChart)

    var savedDisplay = readSession<{ barMode?: 'count' | 'percent' | 'average'; barStack?: boolean; barOrient?: 'v' | 'h'; smartAxes?: boolean; activePalette?: string }>(_displayKey)
    if (savedDisplay) {
      if (savedDisplay.barMode) setBarMode(savedDisplay.barMode)
      if (typeof savedDisplay.barStack === 'boolean') setBarStack(savedDisplay.barStack)
      if (savedDisplay.barOrient) setBarOrient(savedDisplay.barOrient)
      if (typeof savedDisplay.smartAxes === 'boolean') setSmartAxes(savedDisplay.smartAxes)
      if (savedDisplay.activePalette) setActivePalette(savedDisplay.activePalette)
    }
    setChartsRestored(true)
  }, [_themeKey, _displayKey, _activeChartKey])

  useEffect(function() {
    if (!chartsRestored) return
    writeSession(_themeKey, { themeSourceField: themeSourceField, activeThemeNames: activeThemeNames ? Array.from(activeThemeNames) : null })
  }, [chartsRestored, themeSourceField, activeThemeNames, _themeKey])

  useEffect(function() { if (chartsRestored) writeSession(_activeChartKey, activeChart) }, [chartsRestored, activeChart, _activeChartKey])

  useEffect(function() {
    if (!chartsRestored) return
    writeSession(_displayKey, { barMode: barMode, barStack: barStack, barOrient: barOrient, smartAxes: smartAxes, activePalette: activePalette })
  }, [chartsRestored, barMode, barStack, barOrient, smartAxes, activePalette, _displayKey])

  // Filtered row-id set for filter-aware server dimension aggregates. Only loads
  // rows when filters are active (else enrichKey -1 → no fetch, ids null = whole
  // dataset). The ids ride into tax_* specs via useAggregation.
  var { effectiveFilters: _effFilters } = useFilters()
  var _anyFilter = Object.keys(_effFilters || {}).length > 0
  var _sharedRowsMeta = useRows()
  // Sample→population scale for filtered recounts (1 when the whole dataset is loaded).
  var _sampleScale = (_sharedRowsMeta.sampled && _sharedRowsMeta.sampledCount > 0)
    ? _sharedRowsMeta.totalRows / _sharedRowsMeta.sampledCount
    : 1
  var _topRows = useChartRows(datasetId, _anyFilter ? (enrichKey || 0) : -1)
  var _filteredRowIds: number[] | null = (_anyFilter && _topRows.loaded)
    ? (_topRows.rows.map(function(r) { return r._rowId }).filter(function(v: unknown) { return typeof v === 'number' }) as number[])
    : null

  // Per-question theme sets (2026-07-12): the source-field dropdown doesn't
  // just re-target the ACTIVE set's keywords — a question with its OWN stored
  // set (theme_model.fields, per-field model) charts with THAT set. Fallback
  // for a never-mined field = the active set matched against it (pre-map
  // behavior). All theme consumers below read this, never the raw prop.
  // MUST be memoized — themeSetForField returns a fresh object every call, and
  // an unstable identity here feeds the enrichment/effect chain into an
  // infinite update loop that wedges the tab (see git 2a9782ea; do NOT inline).
  var effectiveThemeModel = useMemo(function() {
    return themeSourceField
      ? (themeSetForField(themeModel, [themeSourceField]) || themeModel)
      : themeModel
  }, [themeModel, themeSourceField])

  // Set enrichment context for useRows — must be before any inner component renders.
  // Deliberate module-level bridge: enrichRows() and the inner chart components read
  // it synchronously during this same render pass. Proper fix is a React context
  // (large refactor across every consumer) — out of scope for this warning sweep.
  // eslint-disable-next-line react-hooks/globals -- intentional render-scoped bridge to enrichRows/child charts; set before children render
  _enrichCtx = { themeModel: effectiveThemeModel, schema: schema, enrichKey: enrichKey, themeSourceOverride: themeSourceField || undefined, dimFieldKey: themeSourceField || undefined, activeThemeNames: activeThemeNames, datasetSource: datasetSource, filteredRowIds: _filteredRowIds }
  var currentColors = COLOR_PALETTES[activePalette]?.colors || CHART_COLORS
  var fields = schema.fields.filter(function(f) { return f.type !== 'ignore' && f.type !== 'id' && f.hidden !== true })
  var hasData = analytics && analytics.totalRows > 0

  // Inject virtual "Themes" field if theme model exists
  var hasThemes = effectiveThemeModel && effectiveThemeModel.themes && effectiveThemeModel.themes.length > 0

  // Inject virtual "Dimensions" fields (one per taxonomy axis) when the dataset
  // carries taxonomy classification. Values + averages are computed server-side
  // from the verdicts embedded in data._tx via the tax_* /aggregate ops —
  // gated to google_reviews (where the restaurant taxonomy is meaningful),
  // matching the Dimensions sub-tab gate.
  var hasDimensions = !!taxonomyEnabled || (datasetSource === 'google_reviews' && !taxonomySuppressed)

  // Per-sub counts for the dimension fields, from the same rollup the Dimensions
  // tab uses (so the simple count bar + field picker reconcile exactly). One
  // fetch, only when dimensions apply.
  var [dimSubCounts, setDimSubCounts] = useState<Record<string, Record<string, number>> | null>(null)
  useEffect(function() {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async taxonomy fetch → state (external data sync)
    if (!hasDimensions) { setDimSubCounts(null); return }
    var cancelled = false
    // Per-question (sql/164 companion): the Dimensions GET is per fieldKey —
    // without ?fields= it returns the "pick a field" empty shell, so this
    // fetch was silently empty since the per-field taxonomy split. Follows
    // the same source-field picker as the tax_* chart aggregates.
    fetch('/api/datasets/' + datasetId + '/taxonomy' + (themeSourceField ? '?fields=' + encodeURIComponent(themeSourceField) : ''))
      .then(function(r) { return r.ok ? r.json() : null })
      .then(function(d) {
        if (cancelled || !d || !Array.isArray(d.subs)) return
        var byAxis: Record<string, Record<string, number>> = {}
        d.subs.forEach(function(s: { axis: string; sub: string; count: number }) {
          if (!byAxis[s.axis]) byAxis[s.axis] = {}
          byAxis[s.axis][s.sub] = Number(s.count) || 0
        })
        setDimSubCounts(byAxis)
      })
      .catch(function() { /* dimension count bars degrade to empty until loaded */ })
    return function() { cancelled = true }
  }, [datasetId, hasDimensions, themeSourceField])

  // Live theme counts via the existing server-side endpoint. The persisted
  // theme_model.themes[].count is unreliable — it's often 0 on datasets
  // where AI mining didn't populate it or a sync added rows without a
  // re-count. TextMine recomputes counts client-side via recountThemes
  // because it already has the rows loaded; Charts doesn't, so we ask the
  // server (count_theme_matches SQL → fast for 20K+ row datasets).
  var [liveThemeCounts, setLiveThemeCounts] = useState<Record<string, number> | null>(null)
  // Substantive comment total from /theme-counts (two-count model): the theme
  // prevalence-bar denominator, in lockstep with the substantive numerators in
  // liveThemeCounts. Filter-aware. null until the fetch resolves → fall back to
  // analytics.totalRows so the bars still render.
  var [liveThemeTotal, setLiveThemeTotal] = useState<number | null>(null)
  var themesSig = hasThemes
    ? effectiveThemeModel!.themes.map(function(t: { id?: string; name?: string; keywords?: string[] }) { return (t.id || t.name) + ':' + (t.keywords || []).join('|') }).join(';;')
    : ''
  // Stable signature of the filtered row-id set (content, not identity) so the
  // theme-counts effect re-fetches when the filter changes — including the
  // async null→ids transition once the filtered sample loads.
  var _filterIdSig = _filteredRowIds && _filteredRowIds.length
    ? _filteredRowIds.length + ':' + _filteredRowIds[0] + ':' + _filteredRowIds[_filteredRowIds.length - 1]
    : 'none'
  // Filter-aware real-field summaries, memoized on the filtered-id signature so a
  // large recount runs only when the filter (not every render) changes.
  var filteredRealSummaries = useMemo(function() {
    if (!_anyFilter || !_topRows.loaded || !analytics) return null
    return recomputeFilteredSummaries(_topRows.rows, fields, analytics.fieldSummaries || {}, _sampleScale)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_anyFilter, _topRows.loaded, _filterIdSig, fields, analytics, _sampleScale])
  useEffect(function() {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async theme-counts fetch → state (external data sync)
    if (!hasThemes || !themeSourceField) { setLiveThemeCounts(null); setLiveThemeTotal(null); return }
    var cancelled = false
    var body = JSON.stringify({
      themes: effectiveThemeModel!.themes.map(function(t: { id?: string; name?: string; keywords?: string[] }) { return { id: t.id || t.name, keywords: t.keywords || [] } }),
      fields: [themeSourceField],
      // Filter-aware prevalence bars (sql/170): scope the numerator/denominator
      // to the filtered view so the % bars match the filtered Charts UI (null =
      // whole dataset). In the cache key via `body` → re-fetches on filter change.
      rowIds: _filteredRowIds,
    })
    // Cached across module remounts (tab bounces) — the server recomputes
    // per-theme SQL scans on every request; the body captures every input.
    cachedRequest('theme-counts:' + datasetId + ':' + body, function() {
      return fetch('/api/datasets/' + datasetId + '/theme-counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
      }).then(function(r) {
        if (!r.ok) throw new Error('theme-counts ' + r.status)
        return r.json()
      })
    })
      .then(function(d: { counts?: { id: string; count: number }[]; totalNonEmpty?: number } | null) {
        if (cancelled || !d || !Array.isArray(d.counts)) return
        var counts = d.counts
        var map: Record<string, number> = {}
        effectiveThemeModel!.themes.forEach(function(t: { id?: string; name: string }) {
          var hit = counts.find(function(c) { return c.id === (t.id || t.name) })
          map[t.name] = hit ? hit.count : 0
        })
        setLiveThemeCounts(map)
        // Substantive comment total (two-count-model denominator); 0 is a valid
        // "no substantive comments" answer, so accept any finite number.
        setLiveThemeTotal(typeof d.totalNonEmpty === 'number' ? d.totalNonEmpty : null)
      })
      .catch(function() { /* fall back to stored counts */ })
    return function() { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on themesSig + _filterIdSig (stable content signatures of effectiveThemeModel + _filteredRowIds), not the churny objects
  }, [datasetId, hasThemes, themeSourceField, themesSig, _filterIdSig])
  var allFields = hasThemes
    ? fields.concat([{ field: '__themes__', type: 'categorical', label: 'Themes' }])
    : fields

  // Inject virtual mapped numeric fields for categoricals with remapping
  var mappedFields = fields.filter(function(f) { return f.type === 'categorical' && f.remapping && Object.keys(f.remapping).length > 0 })
  mappedFields.forEach(function(f) {
    allFields = allFields.concat([{ field: '__mapped_' + f.field + '__', type: 'numeric', label: (f.label || f.field) + ' (score)' } as SchemaField])
  })

  // Inject the 7 virtual "Dimension" categorical fields.
  if (hasDimensions) allFields = allFields.concat(dimVirtualFields() as SchemaField[])

  // Build theme counts for the virtual field
  var enrichedAnalytics = analytics
  if (analytics) {
    var extraSummaries: Record<string, FieldSummary> = {}
    if (hasThemes) {
      var themeCounts: Record<string, number> = {}
      effectiveThemeModel!.themes
        .filter(function(t: { name?: string; label?: string }) { return !activeThemeNames || activeThemeNames.has(t.name || t.label || '') })
        .forEach(function(t: { name: string; label?: string; count?: number }) {
          // Prefer live server-counted value over the persisted (often stale) count.
          var live = liveThemeCounts ? liveThemeCounts[t.name] : undefined
          themeCounts[t.name] = live != null ? live : (t.count || 0)
        })
      // Two-count model: theme prevalence bars divide by SUBSTANTIVE comments
      // (filter-aware, from /theme-counts) instead of all rows — in lockstep
      // with the substantive numerators in themeCounts. Falls back to totalRows
      // until the live total resolves (or if the fetch failed).
      var themeDenom = liveThemeTotal != null ? liveThemeTotal : analytics.totalRows
      extraSummaries['__themes__'] = { type: 'categorical', nonNull: themeDenom, counts: themeCounts, topN: Object.keys(themeCounts) }
    }
    // Build summaries for mapped numeric fields from categorical counts + remapping
    mappedFields.forEach(function(f) {
      var catSummary = analytics.fieldSummaries?.[f.field]
      if (!catSummary || !catSummary.counts || !f.remapping) return
      var vals: number[] = []
      Object.entries(catSummary.counts).forEach(function(entry) {
        var numVal = f.remapping![entry[0]]
        if (numVal != null) { for (var i = 0; i < entry[1]; i++) vals.push(numVal) }
      })
      if (!vals.length) return
      vals.sort(function(a, b) { return a - b })
      var sum = vals.reduce(function(a, b) { return a + b }, 0)
      // Discrete histogram (one bin per mapped scale value) so Distribution
      // renders the real bar shape instead of the no-histogram fallback; real
      // quartiles feed the gauge's percentile bands.
      var mValCounts: Record<number, number> = {}
      Object.entries(catSummary.counts).forEach(function(entry) {
        var nv = f.remapping![entry[0]]
        if (nv != null) mValCounts[nv] = (mValCounts[nv] || 0) + entry[1]
      })
      extraSummaries['__mapped_' + f.field + '__'] = {
        type: 'numeric', nonNull: vals.length,
        min: vals[0], max: vals[vals.length - 1],
        avg: sum / vals.length, median: pctl(vals, 0.5),
        p25: pctl(vals, 0.25), p75: pctl(vals, 0.75),
        stddev: Math.sqrt(vals.reduce(function(s, v) { return s + (v - sum / vals.length) * (v - sum / vals.length) }, 0) / vals.length),
        histogram: Object.keys(mValCounts).map(Number).sort(function(a, b) { return a - b }).map(function(v) { return { min: v, max: v, count: mValCounts[v] } }),
      }
    })
    // Dimension fields: counts come from the taxonomy rollup (per-sub mention
    // counts). nonNull is left as totalRows so % bars read as share of rows.
    if (hasDimensions && dimSubCounts) {
      var dsc = dimSubCounts
      Object.keys(dsc).forEach(function(axis) {
        var counts = dsc[axis]
        if (!counts || Object.keys(counts).length === 0) return
        extraSummaries['__dim_' + axis + '__'] = { type: 'categorical', nonNull: analytics.totalRows, counts: counts, topN: Object.keys(counts) }
      })
    }
    // Filter-aware real-field summaries: when a filter is active, override the
    // whole-dataset counts/histograms with recounts over the filtered rows so the
    // summary-driven charts agree with the stacked/Average bars (which filter via
    // rowIds). Applied last; only touches real (non-__) fields.
    if (filteredRealSummaries) {
      Object.assign(extraSummaries, filteredRealSummaries)
    }
    if (Object.keys(extraSummaries).length > 0) {
      enrichedAnalytics = Object.assign({}, analytics, {
        fieldSummaries: Object.assign({}, analytics.fieldSummaries, extraSummaries)
      })
    }
  }

  // Chart config state — cached per chart type, persisted in sessionStorage across module switches
  var _configKey = 'chartConfigs_' + datasetId
  var [chartConfigs, setChartConfigs] = useState<Record<string, Record<string, string>>>({})
  useEffect(function() {
    var saved = readSession<Record<string, Record<string, string>>>(_configKey)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restores persisted chart configs from sessionStorage on dataset-key change
    if (saved) setChartConfigs(saved)
  }, [_configKey])
  useEffect(function() { if (chartsRestored) writeSession(_configKey, chartConfigs) }, [chartsRestored, chartConfigs, _configKey])

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seeds default chart configs once per schema (merges, doesn't clobber existing)
    setChartConfigs(function(prev) {
      var merged: Record<string, Record<string, string>> = {}
      Object.keys(defaults).forEach(function(k) { merged[k] = prev[k] || defaults[k] })
      return merged
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `fields` derives from schema (a fresh filtered array each render); keying on the stable schema prop avoids a loop
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
      .then(function(r) { return r.ok ? r.json() : {} as Record<string, unknown> })
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

  // ── Ana canvas handoff ── the "Open in Charts" chip under an Ask Ana answer
  // applies the exact {chartType, config} behind that answer (same shape a
  // saved chart loads). sessionStorage covers the navigate-then-mount path;
  // the event covers Charts already being open.
  useEffect(function() {
    function applyAnaChart(t: { chartType?: string; config?: Record<string, string> } | null) {
      if (!t || !t.chartType || !CHART_SLOTS[t.chartType]) return
      setActiveChart(t.chartType)
      if (t.config) setChartConfigs(function(prev) { var u = Object.assign({}, prev); u[t.chartType!] = Object.assign({}, t.config); return u })
    }
    try {
      var raw = sessionStorage.getItem('anaChart:' + datasetId)
      if (raw) {
        sessionStorage.removeItem('anaChart:' + datasetId)
        applyAnaChart(JSON.parse(raw))
      }
    } catch {}
    function onAnaChart(e: Event) { applyAnaChart((e as CustomEvent<{ chartType?: string; config?: Record<string, string> }>).detail) }
    window.addEventListener('ana-open-chart', onAnaChart)
    return function() { window.removeEventListener('ana-open-chart', onAnaChart) }
  }, [datasetId])

  // Dimension fields are server-aggregated (via the tax_* /aggregate ops). Most
  // chart types are wired for them; the rest are hidden from the dim pickers
  // because they need per-row/per-point data the aggregation can't provide
  // (scatter colours each point, table lists rows) or are redundant/specialised
  // (score-driver is a theme-keyword regression engine — the avg bar covers it).
  var DIM_WIRED_CHARTS = ['bar', 'crosstab', 'treemap', 'bubbles', 'waterfall', 'funnel', 'bullet', 'gantt', 'distribution', 'timeseries']
  var dimWiredChart = DIM_WIRED_CHARTS.indexOf(activeChart) !== -1
  // Dual-purpose Likerts appear ONCE (their raw categorical entry); the
  // `__mapped_*` numeric twin is resolved per-slot, never listed on its own.
  var pickerFields = (dimWiredChart ? allFields : allFields.filter(function(f) { return !isDimField(f.field) }))
    .filter(function(f) { return !isMappedId(f.field) })

  // Field type groups
  var catFields = pickerFields.filter(function(f) { return f.type === 'categorical' })
  var numFields = pickerFields.filter(function(f) { return f.type === 'numeric' })
  var dateFields = pickerFields.filter(function(f) { return f.type === 'date' })
  var openFields = pickerFields.filter(function(f) { return f.type === 'open-ended' })

  // Smart-drop state for the chart body area
  var [bodyDragOver, setBodyDragOver] = useState(false)

  var handleBodyDrop = function(e: React.DragEvent) {
    e.preventDefault()
    setBodyDragOver(false)
    try {
      var payload = JSON.parse(e.dataTransfer.getData('text/field'))
      var target = getSmartSlot(payload.type, currentSlots, currentConfig)
      if (!target) return
      var fieldId = (payload.dual && slotWantsNumericTwin(target.accepts)) ? mappedIdFor(payload.field) : payload.field
      setChartConfigs(function(prev) {
        var u = Object.assign({}, prev)
        var cfg = Object.assign({}, u[activeChart] || {})
        cfg[target!.key] = fieldId
        u[activeChart] = cfg
        return u
      })
    } catch {}
    // eslint-disable-next-line react-hooks/globals -- module-level drag payload cleared inside the drop event handler (not during render)
    _chartDrag = null
  }

  // Download PNG (or CSV for table)
  var chartBodyRef = useRef<HTMLDivElement>(null)

  var downloadCSV = function() {
    void fetch('/api/datasets/' + datasetId + '/rows?all=true')
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
    // querySelector returns only the first match — that's the source of
    // the split-view bug where only one chart got exported. For 0/many,
    // fall through to the SVG-tiling path (downloadSVGasPNG iterates
    // every SVG and composites them onto one canvas).
    var plotDivs = chartBodyRef.current.querySelectorAll('.js-plotly-plot')
    if (plotDivs.length === 1) {
      void getPlotly().then(function(Plotly) {
        Plotly.downloadImage(plotDivs[0] as HTMLElement, { format: 'png', width: 1200, height: 700, filename: activeChart + '_chart' })
      })
      return
    }
    // 0 charts (SVG-only bullets/gauges) OR many (split view) → tile.
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
            if (slots.length === 0) return <ChartFieldGroups fields={pickerFields} currentConfig={currentConfig} />
            var accepted = new Set(slots.flatMap(function(s) { return s.accepts }))
            var visible = accepted.has('any') ? pickerFields : pickerFields.filter(function(f) { return accepted.has(f.type) || (isDualPurpose(f) && accepted.has('numeric')) })
            return <ChartFieldGroups fields={visible} currentConfig={currentConfig} />
          })()}

          {/* Theme filter — at bottom of sidebar */}
          {hasThemes && (function() {
            var allThemesList: ThemeLike[] = effectiveThemeModel!.themes || []
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
                    {/* Switching the question also switches to ITS stored theme set —
                        clear the theme pill selection (names from the old set would
                        silently filter the new set to nothing). */}
                    <select value={themeSourceField} onChange={function(e) { setThemeSourceField(e.target.value); setActiveThemeNames(null); setEnrichKey(function(k) { return k + 1 }) }}
                      style={{ width: '100%', padding: '4px 8px', fontSize: 11, border: '1px solid ' + T.border, borderRadius: 6, background: T.bgCard, color: T.textMid, outline: 'none', cursor: 'pointer' }}>
                      {rawOpenFields.map(function(f) { return <option key={f.field} value={f.field}>{f.label || f.field}</option> })}
                    </select>
                  </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                  {allThemesList.map(function(t) {
                    var name = (t.name || t.label)!
                    var isActive = !activeThemeNames || activeThemeNames.has(name)
                    var color = t.color || T.accent
                    return (
                      <button key={name} onClick={function() {
                        var next: Set<string>
                        if (!activeThemeNames) {
                          next = new Set(allThemesList.map(function(x) { return (x.name || x.label)! }).filter(function(n: string) { return n !== name }))
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
          {/* Inline field selectors — dropdowns per slot.
              Each categorical option includes its distinct-value count so
              the operator sees cardinality upfront. Renderers further cap
              at MAX_CATEGORIES_PER_CHART (~30) to keep charts readable. */}
          {currentSlots.length > 0 && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              {currentSlots.map(function(slot) {
                var opts = pickerFields.filter(function(f) {
                  return fieldMatchesAccepts(f, slot.accepts)
                }).map(function(f) {
                  // Dual-purpose Likert in a value/metric slot → store & label its
                  // numeric twin id (the "(score)" reading); elsewhere the raw id.
                  var usesTwin = isDualPurpose(f) && slotWantsNumericTwin(slot.accepts)
                  var vId = usesTwin ? mappedIdFor(f.field) : f.field
                  var label = fl(f)
                  if (usesTwin) {
                    label += '  (score)'
                  } else if (f.type === 'categorical') {
                    var counts = analytics?.fieldSummaries?.[f.field]?.counts
                    if (counts) {
                      var n = Object.keys(counts).length
                      if (n > 0) {
                        var tag = n > MAX_CATEGORIES_PER_CHART
                          ? '  (' + n + ' values · top ' + MAX_CATEGORIES_PER_CHART + ' shown)'
                          : '  (' + n + ' values)'
                        label += tag
                      }
                    }
                  }
                  return { v: vId, l: label, section: f.section || 'core' }
                })
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
            {/* Above the 50K cap every server-side chart aggregate is computed
                over the deterministic 50K sample and scaled (sql/169) — same "~"
                doctrine as the metric strip. Dataset-level (not per-chart) since
                it's true of every aggregate on this dataset. */}
            {hasData && analytics!.totalRows > 50000 && (
              <div title="Charts are estimated from a deterministic 50,000-row sample (dataset exceeds the exact-count cap) and scaled to all rows; counts are approximate, averages/medians are direct sample estimates."
                style={{ fontSize: 11, color: T.textFaint, fontStyle: 'italic', padding: '6px 10px 0' }}>
                {'≈'} Estimated from a 50,000-row sample
              </div>
            )}
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
