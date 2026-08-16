'use client'
// components/analyze/StatsModule.tsx
// Statistics module — 5 panels matching Ana.html.
// Loads raw rows from the API, applies filters, runs all computations client-side.

import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from 'react'
import { readSession, writeSession } from '@/lib/useSessionState'
import { themeSetForField, type Theme, type ThemeModel } from '@/lib/themeUtils'
import LottieLoader from '@/components/ui/LottieLoader'
import { injectSignalTier } from '@/lib/signalTier'

// Dynamic Plotly import — avoids SSR crash
interface PlotlyLib {
  newPlot: (el: HTMLElement, data: unknown[], layout?: unknown, config?: unknown) => void
  purge: (el: HTMLElement) => void
}
var PlotlyRef: PlotlyLib | null = null
function getPlotly(): Promise<PlotlyLib> {
  if (PlotlyRef) return Promise.resolve(PlotlyRef)
  return import('plotly.js-dist-min').then(function(m) { PlotlyRef = m.default || m; return PlotlyRef! })
}

function PlotlyChart({ data, layout, style }: { data: unknown[]; layout?: Record<string, unknown>; style?: React.CSSProperties }) {
  var ref = useRef<HTMLDivElement>(null)
  useEffect(function() {
    if (!ref.current || !data.length) return
    var T2 = { bg: '#f4f5f7', border: '#e5e7eb', borderMid: '#d1d5db', textMute: '#6b7280' }
    var base = { paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', font: { family: 'Inter,system-ui,sans-serif', color: T2.textMute, size: 11 }, margin: { t: 16, r: 20, b: 48, l: 56 }, xaxis: { gridcolor: T2.border, zerolinecolor: T2.borderMid, linecolor: T2.border }, yaxis: { gridcolor: T2.border, zerolinecolor: T2.borderMid, linecolor: T2.border } }
    var merged = Object.assign({}, base, layout || {})
    // Same null-ref guard as ChartsModule's PlotlyChart — getPlotly()
    // is async, ref.current can be null if the user navigated away
    // before the dynamic import resolved.
    void getPlotly().then(function(Plotly) {
      if (ref.current) Plotly.newPlot(ref.current, data, merged, { responsive: true, displayModeBar: false })
    })
    return function() {
      const el = ref.current
      if (!el) return
      void getPlotly().then(function(Plotly) { try { Plotly.purge(el) } catch {} })
    }
  }, [data, layout])
  return <div ref={ref} style={style || { width: '100%', height: 260 }} />
}

import {
  mean, std, median, quantile, skewness, kurtosis, shapiroWilk,
  pearsonR, spearmanR, welchTTest, mannWhitneyU, oneWayANOVA,
  chiSquareStat, olsRegression, getNum, probit,
  logisticRegression, pruneCollinear, type LogisticResult,
  welchTTestFromStats, anovaFromStats, chiSquareFromTable,
  fmt2, fmt4, fmtN, fmtP, sigLabel,
  descBL, descBL_naive, corrBL, corrBL_naive,
  ttestBL, ttestBL_naive, anovaBL, anovaBL_naive,
  mwBL, mwBL_naive,
  chiBL, chiBL_naive, regrBL,
  bootstrapCI, type MCResult,
  type TTestResult, type ANOVAResult, type ChiSquareResult, type MannWhitneyResult,
} from '@/lib/statsUtils'
import { buildRegVars, buildDesign, type RegVar, type OutcomeSpec, type PredictorSpec } from '@/lib/regressionDesign'
import { axisOfDimField, isDimField, dimVirtualFields, dimFieldName, DIM_AXES, DIM_AXIS_LABEL } from '@/lib/dimensionFields'
import { applyFilters, filterCount } from '@/lib/filterUtils'
import { useFilters } from '@/components/analyze/FilterContext'
import { useRows } from '@/components/analyze/RowsContext'
import type { SchemaConfig, SchemaFieldConfig } from '@/lib/analyzeTypes'
import { smartOrder } from '@/lib/scaleUtils'

// Module-level drag tracker — allows dragOver handlers to preview the drop target without dataTransfer
var _statsDrag: { field: string; type: string; label: string; dual?: boolean } | null = null

// ─── Dual-purpose Likert fields ───────────────────────────────────────────
// An auto-quant Likert is a categorical field with a numeric `remapping`; it
// carries a numeric twin id `__mapped_<field>__`. In the sidebar it is shown
// ONCE (its raw categorical entry, flagged dual-purpose) instead of once per
// group; a numeric-accepting slot resolves the drop to the twin id, a
// categorical slot keeps the raw id. Type-scoped dropdowns already list one
// correct entry each (raw in categorical selects, the "(score)" twin in numeric
// selects), so the stored ids are unchanged and backward-compatible.
function isDualPurposeCfg(f: { type: string; remapping?: Record<string, number> }): boolean {
  return f.type === 'categorical' && !!f.remapping && Object.keys(f.remapping).length > 0
}
function mappedIdFor(field: string): string { return '__mapped_' + field + '__' }
function isMappedId(id: string): boolean { return id.indexOf('__mapped_') === 0 && id.slice(-2) === '__' }
function rawFieldFromMapped(id: string): string { return id.slice('__mapped_'.length, -2) }

import { T } from '@/lib/analyzeTheme'

type ThemeT = typeof T

// OLS regression result shape (mirrors olsRegression() in lib/statsUtils)
interface RegressionCoef { name: string; beta: number; se: number; t: number; p: number; ci: [number, number] }
interface RegressionResult {
  coefs: RegressionCoef[]; R2: number; R2adj: number; F: number; Fp: number
  n: number; p: number; SSE: number; SST: number; MSE: number
  yhat: number[]; resid: number[]; names: string[]
}

interface Props {
  datasetId: string
  schema: SchemaConfig
  themeModel?: ThemeModel | null
  datasetSource?: string
  taxonomyEnabled?: boolean
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

function FieldPill({ label, active, onClick, title }: { label: string; active: boolean; onClick: () => void; title?: string }) {
  return (
    <button onClick={onClick} title={title} style={{ padding: '5px 14px', fontSize: 12, fontWeight: active ? 700 : 500, background: active ? T.accentBg : 'transparent', border: '1px solid ' + (active ? T.accent : T.border), color: active ? T.accent : T.textMid, borderRadius: 20, cursor: 'pointer', transition: 'all .12s', whiteSpace: 'nowrap' }}>
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

function DSSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string; s?: string }[] }) {
  var [dragOver, setDragOver] = useState(false)
  var coreOpts   = options.filter(function(o) { return !o.s || o.s === 'core' })
  var customOpts = options.filter(function(o) { return o.s === 'custom' })
  var psychoOpts = options.filter(function(o) { return o.s === 'psychographic' })
  var demoOpts   = options.filter(function(o) { return o.s === 'demographic' })
  var urlParamOpts = options.filter(function(o) { return o.s === 'url_param' })
  var hasGroups  = customOpts.length > 0 || psychoOpts.length > 0 || demoOpts.length > 0 || urlParamOpts.length > 0
  return (
    <div style={{ flex: 1, minWidth: 150 }}
      onDragOver={function(e) { e.preventDefault(); setDragOver(true) }}
      onDragLeave={function(e) { var rt = e.relatedTarget as Node | null; if (!rt || !e.currentTarget.contains(rt)) setDragOver(false) }}
      onDrop={function(e) {
        e.preventDefault(); e.stopPropagation(); setDragOver(false)
        try {
          var payload = JSON.parse(e.dataTransfer.getData('text/field'))
          // A dual-purpose Likert resolves to whichever id THIS select lists —
          // the raw id in a categorical select, its numeric twin in a numeric one.
          var candidates = payload.dual ? [payload.field, mappedIdFor(payload.field)] : [payload.field]
          var matchId = candidates.find(function(id) { return options.some(function(o) { return o.v === id }) })
          if (matchId) onChange(matchId)
        } catch {}
      }}
    >
      {label && <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 5 }}>{label}</div>}
      <select value={value} onChange={function(e) { onChange(e.target.value) }}
        style={{ width: '100%', padding: '7px 10px', fontSize: 13, border: '1.5px solid ' + (dragOver ? T.accent : T.border), borderRadius: 7, background: dragOver ? T.accentBg : T.bgCard, color: T.text, outline: 'none', cursor: 'pointer', transition: 'border-color .1s, background .1s' }}>
        {coreOpts.map(function(o) { return <option key={o.v} value={o.v}>{o.l}</option> })}
        {hasGroups && customOpts.length > 0 && <optgroup label="Survey Questions">{customOpts.map(function(o) { return <option key={o.v} value={o.v}>{o.l}</option> })}</optgroup>}
        {hasGroups && psychoOpts.length > 0 && <optgroup label="Psychographic">{psychoOpts.map(function(o) { return <option key={o.v} value={o.v}>{o.l}</option> })}</optgroup>}
        {hasGroups && demoOpts.length > 0 && <optgroup label="Demographic">{demoOpts.map(function(o) { return <option key={o.v} value={o.v}>{o.l}</option> })}</optgroup>}
        {hasGroups && urlParamOpts.length > 0 && <optgroup label="URL Parameters">{urlParamOpts.map(function(o) { return <option key={o.v} value={o.v}>{o.l}</option> })}</optgroup>}
      </select>
    </div>
  )
}

function BottomLine({ text, naiveText, naiveNode }: { text: string; naiveText?: string; naiveNode?: ReactNode }) {
  var [mode, setMode] = useState('naive')
  if (!text) return null
  var hasNaive = !!(naiveText || naiveNode)
  var shown = mode === 'naive' && hasNaive ? (naiveNode ?? naiveText) : text
  return (
    <div style={{ marginTop: 18, marginBottom: 6, minHeight: 90, background: T.accentBg, border: '1px solid ' + T.accentMid, borderLeft: '3px solid ' + T.accent, borderRadius: 8, padding: '12px 16px 16px', fontSize: 13, lineHeight: 1.7, color: T.textMid }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: T.accent }}>{'\u25C6'} Bottom Line</div>
        {hasNaive && (
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

// Plain-English render for a LINEAR regression Bottom Line — a colour-coded
// block that mirrors the logistic one (bold factor names; red = linked to a
// LOWER outcome, green = HIGHER; muted = no clear effect). No per-factor % here:
// OLS betas aren't standardized, so their magnitudes aren't comparable across
// differently-scaled predictors — only the sign (direction) is safe to show.
function regrBLNode(res: RegressionResult | null, out: string, aliases: Record<string, string>): ReactNode {
  if (!res) return null
  var label = function(name: string) { return aliases[name] || name }
  if (res.Fp >= 0.05) return "We tried to predict " + out + " from these factors, but the model isn't reliable — it doesn't do meaningfully better than just guessing the average, so there's no trustworthy pattern to read into here."
  var r2 = Math.round(res.R2 * 100)
  var r2str = r2 < 10 ? 'only a small slice' : r2 < 30 ? 'a fair amount' : r2 < 60 ? 'a lot' : 'most'
  var body = res.coefs.slice(1)
  var sig = body.filter(function(c) { return c.p < 0.05 })
  var down = sig.filter(function(c) { return c.beta < 0 })
  var up = sig.filter(function(c) { return c.beta > 0 })
  var nonSig = body.filter(function(c) { return c.p >= 0.05 })
  var row = function(heading: string, color: string, items: RegressionResult['coefs']) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, color: color, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap', minWidth: 108 }}>{heading}</span>
        <span style={{ flex: 1, minWidth: 140 }}>
          {items.map(function(c, i) {
            return (
              <span key={c.name}>
                <strong style={{ color: color }}>{label(c.name)}</strong>
                {i < items.length - 1 ? <span style={{ color: T.textFaint }}>, </span> : null}
              </span>
            )
          })}
        </span>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div>
        We looked at what drives <strong>{out}</strong>, across {res.n.toLocaleString()} responses. The overall pattern is real, not a fluke.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {down.length > 0 && row('Linked to lower', T.red, down)}
        {up.length > 0 && row('Linked to higher', T.green, up)}
        {sig.length === 0 && <div style={{ color: T.textFaint }}>No single factor stands out on its own, though together they carry a real signal.</div>}
        {nonSig.length > 0 && row('No clear effect', T.textFaint, nonSig)}
      </div>
      <div style={{ color: T.textFaint }}>
        Together these explain {r2str} of why {out} varies from one response to the next ({r2}%) — the rest comes down to things we didn&rsquo;t measure.
      </div>
    </div>
  )
}

// ─── SUB-PANELS ───────────────────────────────────────────────────────────────

function DescriptivesPanel({ numFields, data, mcResults, mcRunning, confidenceLevel, datasetId }: { numFields: SchemaFieldConfig[]; data: Record<string, unknown>[]; mcResults: Record<string, MCResult>; mcRunning: boolean; confidenceLevel: number; datasetId: string }) {
  // Defaults-only init to keep server/client first render identical;
  // sessionStorage restore happens in useEffect post-mount.
  var _dk = 'statsDesc_' + datasetId
  var [sel, setSel] = useState(numFields[0]?.field || '')
  var [descRestored, setDescRestored] = useState(false)
  useEffect(function() {
    var saved = readSession<{ sel?: string }>(_dk)
    if (saved?.sel) setSel(saved.sel)
    setDescRestored(true)
  }, [_dk])
  useEffect(function() { if (!sel && numFields.length) setSel(numFields[0].field) }, [numFields.length])
  useEffect(function() { if (descRestored) writeSession(_dk, { sel: sel }) }, [descRestored, sel, _dk])
  var selLabel = (function() { var f = numFields.find(function(nf) { return nf.field === sel }); return f && f.label ? f.label : sel })()

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
      {stats && <BottomLine text={descBL(selLabel, stats)} naiveText={descBL_naive(selLabel, stats)} />}
      <div style={{ maxWidth: 320, marginBottom: 20 }}>
        <DSSelect label="Numeric field" value={sel} onChange={setSel} options={numFields.map(function(f) { return { v: f.field, l: f.label || f.field, s: (f as SchemaFieldConfig & { subCategory?: string }).subCategory } })} />
      </div>
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 18px', borderBottom: '1px solid ' + T.border, fontSize: 13, fontWeight: 700, color: T.text }}>{selLabel} <span style={{ fontWeight: 400, color: T.textFaint, fontSize: 11 }}>{'\u2014'} {stats.n} observations</span></div>
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
              {(function() {
                var nbins = Math.min(40, Math.max(10, Math.ceil(Math.sqrt(stats.n))))
                var binW  = stats.range / nbins
                // Normal curve clamped to actual data range — no phantom values beyond observed min/max
                var curveX: number[] = [], curveY: number[] = []
                var lo = stats.min, hi = stats.max
                for (var i = 0; i <= 120; i++) {
                  var xv = lo + (hi - lo) * i / 120
                  var z  = (xv - stats.mn) / (stats.sd || 1)
                  var py = (1 / ((stats.sd || 1) * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * z * z)
                  curveX.push(xv)
                  curveY.push(py * stats.n * (binW > 0 ? binW : 1))
                }
                return (
                  <PlotlyChart
                    data={[
                      { x: stats.vals, type: 'histogram', name: 'Count', nbinsx: nbins, marker: { color: T.accent, opacity: 0.75, line: { color: T.accentMid, width: 0.5 } }, hovertemplate: 'Count: %{y}<extra></extra>' },
                      { x: curveX, y: curveY, type: 'scatter', mode: 'lines', name: 'Normal', line: { color: T.purple, width: 2, dash: 'solid' }, hovertemplate: 'Expected: %{y:.1f}<extra></extra>' },
                    ]}
                    layout={{ xaxis: { title: { text: selLabel, font: { size: 11 } }, range: [lo - 1, hi + 1] }, yaxis: { title: { text: 'Count', font: { size: 11 } } }, bargap: 0.02, showlegend: true, legend: { x: 0.75, y: 0.98, font: { size: 10 } }, margin: { t: 10, r: 16, b: 44, l: 48 } }}
                    style={{ height: 220, width: '100%' }}
                  />
                )
              })()}
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

            {/* Bootstrap CI card — Monte Carlo confidence intervals */}
            <Card style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase' }}>
                  Bootstrap CI <span style={{ fontSize: 9, fontWeight: 400, marginLeft: 4 }}>(Monte Carlo, {confidenceLevel}%)</span>
                </div>
                {mcRunning && <span style={{ fontSize: 10, color: T.textMute }}>Computing…</span>}
              </div>
              {mcResults[sel] && !isNaN(mcResults[sel].meanCI[0]) ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {([
                    { label: 'Mean CI', lo: mcResults[sel].meanCI[0], hi: mcResults[sel].meanCI[1] },
                    { label: 'Median CI', lo: mcResults[sel].medianCI[0], hi: mcResults[sel].medianCI[1] },
                    { label: 'Std Dev CI', lo: mcResults[sel].stdCI[0], hi: mcResults[sel].stdCI[1] },
                  ] as { label: string; lo: number; hi: number }[]).map(function(ci) {
                    return (
                      <div key={ci.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 0', borderBottom: '1px solid ' + T.border }}>
                        <span style={{ color: T.textMute }}>{ci.label}</span>
                        <span style={{ fontFamily: 'monospace', fontWeight: 600, color: T.text }}>
                          [{fmt2(ci.lo)}, {fmt2(ci.hi)}]
                        </span>
                      </div>
                    )
                  })}
                  <div style={{ fontSize: 10, color: T.textFaint, marginTop: 2 }}>
                    2,000 bootstrap resamples · percentile method
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: T.textFaint, fontStyle: 'italic' }}>
                  {mcRunning ? 'Computing bootstrap CIs…' : 'n < 10 or no data'}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

function CorrelationsPanel({ numFields, data, aliases, datasetId }: { numFields: SchemaFieldConfig[]; data: Record<string, unknown>[]; aliases: Record<string, string>; datasetId: string }) {
  var _ck = 'statsCorr_' + datasetId
  var [corrType, setCorrType] = useState('pearson')
  var [selCell, setSelCell] = useState<{ i: number; j: number; f1: string; f2: string; r: number; p: number; n: number } | null>(null)
  var [excluded, setExcluded] = useState<Set<string>>(function() { return new Set() })
  var [corrRestored, setCorrRestored] = useState(false)
  useEffect(function() {
    var saved = readSession<{ corrType?: string; excluded?: string[] }>(_ck)
    if (saved?.corrType) setCorrType(saved.corrType)
    if (Array.isArray(saved?.excluded)) setExcluded(new Set(saved.excluded))
    setCorrRestored(true)
  }, [_ck])
  useEffect(function() {
    if (!corrRestored) return
    writeSession(_ck, { corrType: corrType, excluded: Array.from(excluded) })
  }, [corrRestored, corrType, excluded, _ck])

  var activeFields = numFields.filter(function(f) { return !excluded.has(f.field) })

  function toggleField(field: string) {
    setSelCell(null)
    setExcluded(function(prev) {
      var next = new Set(prev); if (next.has(field)) next.delete(field); else next.add(field); return next
    })
  }

  var matrix = useMemo(function() {
    if (activeFields.length < 2) return null
    var fields = activeFields.map(function(f) { return f.field })
    var fn = corrType === 'pearson' ? pearsonR : spearmanR
    var mat = fields.map(function(f1) {
      return fields.map(function(f2) {
        if (f1 === f2) return { r: 1, p: 0, n: getNum(f1, data).length }
        var v1 = getNum(f1, data), v2 = getNum(f2, data), n = Math.min(v1.length, v2.length)
        return fn(v1.slice(0, n), v2.slice(0, n))
      })
    })
    return { fields: fields, mat: mat }
  }, [activeFields, data, corrType])

  var cellBg = function(r: number) {
    if (isNaN(r) || r === 1) return T.bg
    var a = Math.abs(r)
    if (r > 0) return 'rgb(' + Math.round(255 - a * 200) + ',' + Math.round(240 - a * 100) + ',' + Math.round(255 - a * 200) + ')'
    return 'rgb(' + Math.round(255 - a * 10) + ',' + Math.round(240 - a * 180) + ',' + Math.round(235 - a * 180) + ')'
  }

  if (numFields.length < 2) return <StatsEmpty icon={'\u229E'} msg="Need at least 2 numeric fields" sub="Activate more numeric fields or map Likert scales to numbers in the Schema tab." />

  return (
    <div>
      <PanelHeader icon={'\u2295'} title="Correlation Matrix" desc={'Pearson r or Spearman \u03C1 between selected numeric variables. Click any cell to see details.'} />
      {selCell && <BottomLine text={corrBL(aliases[selCell.f1] || selCell.f1, aliases[selCell.f2] || selCell.f2, selCell.r, selCell.p, selCell.n, corrType)} naiveText={corrBL_naive(aliases[selCell.f1] || selCell.f1, aliases[selCell.f2] || selCell.f2, selCell.r, selCell.p, selCell.n)} />}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: T.textMute, textTransform: 'uppercase', letterSpacing: '.07em' }}>Method:</span>
        {[['pearson', 'Pearson r'], ['spearman', 'Spearman \u03C1']].map(function(pair) {
          return <FieldPill key={pair[0]} label={pair[1]} active={corrType === pair[0]} onClick={function() { setCorrType(pair[0]); setSelCell(null) }} />
        })}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: T.textMute, textTransform: 'uppercase', letterSpacing: '.07em', flexShrink: 0 }}>Fields:</span>
        {numFields.map(function(f) {
          var isExcluded = excluded.has(f.field)
          var lbl = aliases[f.field] || f.label || f.field
          return (
            <button key={f.field} onClick={function() { toggleField(f.field) }}
              style={{ padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 20, border: '1px solid ' + (isExcluded ? T.border : T.blue), background: isExcluded ? T.bg : T.blueBg, color: isExcluded ? T.textFaint : T.blue, cursor: 'pointer', textDecoration: isExcluded ? 'line-through' : 'none', opacity: isExcluded ? 0.6 : 1 }}>
              {lbl}
            </button>
          )
        })}
        {excluded.size > 0 && <button onClick={function() { setExcluded(new Set()); setSelCell(null) }} style={{ padding: '3px 8px', fontSize: 10, fontWeight: 700, borderRadius: 20, border: '1px solid ' + T.border, background: 'transparent', color: T.textMute, cursor: 'pointer' }}>Reset</button>}
      </div>
      {activeFields.length < 2 && <StatsEmpty icon={'\u229E'} msg="Select at least 2 fields" sub="Re-enable fields above to build the matrix." />}
      {matrix && (
        <div style={{ display: 'grid', gridTemplateColumns: selCell ? '1fr 1fr' : '1fr', gap: 20 }}>
          <Card style={{ padding: 0, overflow: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr>
                <th style={{ padding: '10px 12px', fontSize: 10, color: T.textFaint, background: T.bg, minWidth: 100, textAlign: 'left' }} />
                {matrix!.fields.map(function(f) { var lbl = aliases[f] || f; return <th key={f} style={{ padding: '10px 10px', fontSize: 10, fontWeight: 700, color: T.textMute, textTransform: 'uppercase', background: T.bg, textAlign: 'center', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={lbl}>{lbl.slice(0, 10)}</th> })}
              </tr></thead>
              <tbody>{matrix!.fields.map(function(f1, i) {
                return (
                  <tr key={f1}>
                    <td style={{ padding: '8px 12px', fontSize: 11, fontWeight: 600, color: T.textMute, background: T.bg, borderRight: '1px solid ' + T.border, whiteSpace: 'nowrap', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis' }} title={aliases[f1] || f1}>{(aliases[f1] || f1).slice(0, 14)}</td>
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
              <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 12 }}>{aliases[selCell.f1] || selCell.f1} {'\u00D7'} {aliases[selCell.f2] || selCell.f2}</div>
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
                    layout={{ xaxis: { title: { text: aliases[selCell.f1] || selCell.f1, font: { size: 11 } } }, yaxis: { title: { text: aliases[selCell.f2] || selCell.f2, font: { size: 11 } } }, showlegend: false, margin: { t: 8, r: 12, b: 46, l: 50 } }}
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

// Group-test result — discriminated on `type`. syncResult computes from raw
// rows (`groups`), dimResult arrives server-aggregated (`boxStats` instead).
type GroupBoxStats = Record<string, { q1: number | null; median: number; q3: number | null; min: number; max: number; mean: number }>
type GroupTestResult =
  | { type: 'ttest'; res: TTestResult | null; g1: string; g2: string; groups?: Record<string, number[]>; boxStats?: GroupBoxStats }
  | { type: 'anova'; res: ANOVAResult | null; groups?: Record<string, number[]>; boxStats?: GroupBoxStats }
  | { type: 'mw'; res: MannWhitneyResult | null; g1: string; g2: string; groups: Record<string, number[]>; boxStats?: undefined }
  | { type: 'chisq'; res: ChiSquareResult | null; groups?: undefined; boxStats?: undefined }
  | { type: 'mw_unsupported'; res?: undefined; groups?: undefined; boxStats?: undefined }

function GroupTestsPanel({ numFields, catFields, data, aliases, datasetId, dimFieldKey, filteredRowIds }: { numFields: SchemaFieldConfig[]; catFields: SchemaFieldConfig[]; data: Record<string, unknown>[]; aliases: Record<string, string>; datasetId: string; dimFieldKey?: string; filteredRowIds?: number[] | null }) {
  var _gk = 'statsGroup_' + datasetId
  var [testType, setTestType] = useState('auto')
  var [numF, setNumF] = useState(numFields[0]?.field || '')
  var [catF, setCatF] = useState(catFields[0]?.field || '')
  var [catF2, setCatF2] = useState(catFields[1]?.field || catFields[0]?.field || '')
  var [groupRestored, setGroupRestored] = useState(false)
  useEffect(function() {
    var saved = readSession<{ testType?: string; numF?: string; catF?: string; catF2?: string }>(_gk)
    if (saved?.testType) setTestType(saved.testType)
    if (saved?.numF) setNumF(saved.numF)
    if (saved?.catF) setCatF(saved.catF)
    if (saved?.catF2) setCatF2(saved.catF2)
    setGroupRestored(true)
  }, [_gk])
  var [panelDragOver, setPanelDragOver] = useState(false)

  useEffect(function() {
    if (!groupRestored) return
    writeSession(_gk, { testType: testType, numF: numF, catF: catF, catF2: catF2 })
  }, [groupRestored, testType, numF, catF, catF2, _gk])
  useEffect(function() { if (!numF && numFields.length) setNumF(numFields[0].field) }, [numFields.length])
  useEffect(function() { if (!catF && catFields.length) setCatF(catFields[0].field) }, [catFields.length])

  // A dimension (taxonomy axis) on the group/variable side is aggregated
  // server-side: t-test/ANOVA from per-sub summary stats, chi-square from a
  // server crosstab. Mann-Whitney needs raw ranks \u2192 unsupported for dimensions.
  var groupDimAxis = testType !== 'chisq' ? axisOfDimField(catF) : null
  var chiDimA = testType === 'chisq' ? axisOfDimField(catF) : null
  var chiDimB = testType === 'chisq' ? axisOfDimField(catF2) : null
  var dimInvolved = !!groupDimAxis || !!chiDimA || !!chiDimB

  var syncResult = useMemo(function(): GroupTestResult | null {
    if (dimInvolved) return null
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
      // For 2-group tests with >2 groups, use only the first two groups
      if (eff === 'mw') {
        var mwK = gKeys.slice(0, 2)
        return { type: 'mw', res: mannWhitneyU(groups[mwK[0]], groups[mwK[1]]), g1: mwK[0], g2: mwK[1], groups: groups }
      }
      if (eff === 'ttest') {
        var ttK = gKeys.slice(0, 2)
        return { type: 'ttest', res: welchTTest(groups[ttK[0]], groups[ttK[1]]), g1: ttK[0], g2: ttK[1], groups: groups }
      }
      return { type: 'anova', res: oneWayANOVA(groups), groups: groups }
    } catch { return null }
  }, [testType, numF, catF, catF2, data, dimInvolved])

  // Server-aggregated result when a dimension is involved.
  var [dimResult, setDimResult] = useState<GroupTestResult | null>(null)
  useEffect(function() {
    if (!dimInvolved) { setDimResult(null); return }
    var cancelled = false
    var post = function(body: Record<string, unknown>) { return fetch('/api/datasets/' + datasetId + '/aggregate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function(r) { return r.json() }) }
    void (async function() {
      try {
        if (testType === 'chisq') {
          var axis = chiDimA || chiDimB
          var other = chiDimA ? catF2 : catF
          if (!axis || !other || isDimField(other)) { if (!cancelled) setDimResult(null); return }  // both-dim unsupported
          var d = await post({ op: 'tax_crosstab', axis: axis, field: other, axisIsRow: !!chiDimA, limit: 50, fieldKey: dimFieldKey, rowIds: filteredRowIds })
          if (cancelled) return
          var grid: Record<string, Record<string, number>> = d.grid || {}
          var rkeys = Object.keys(grid)
          var cset = new Set<string>(); rkeys.forEach(function(rk) { Object.keys(grid[rk]).forEach(function(c) { cset.add(c) }) })
          var res = chiSquareFromTable(grid, rkeys, Array.from(cset))
          setDimResult(res ? { type: 'chisq', res: res } : null)
          return
        }
        if (!numF || !groupDimAxis) { if (!cancelled) setDimResult(null); return }
        var dg = await post({ op: 'tax_group_stats', axis: groupDimAxis, valueField: numF, fieldKey: dimFieldKey, rowIds: filteredRowIds })
        if (cancelled) return
        var groups = (dg.groups || {}) as Record<string, { n: number; mean: number; median: number; min: number; max: number; stddev: number; q1: number | null; q3: number | null }>
        var gKeys = Object.keys(groups).filter(function(k) { return groups[k].n >= 2 })
        if (gKeys.length < 2) { setDimResult(null); return }
        var eff = testType === 'auto' ? (gKeys.length === 2 ? 'ttest' : 'anova') : testType
        var boxStats: Record<string, { q1: number | null; median: number; q3: number | null; min: number; max: number; mean: number }> = {}
        gKeys.forEach(function(k) { var s = groups[k]; boxStats[k] = { q1: s.q1, median: s.median, q3: s.q3, min: s.min, max: s.max, mean: s.mean } })
        if (eff === 'mw') { setDimResult({ type: 'mw_unsupported' }); return }
        if (eff === 'ttest') {
          var k2 = gKeys.slice(0, 2)
          var tr = welchTTestFromStats({ mean: groups[k2[0]].mean, sd: groups[k2[0]].stddev, n: groups[k2[0]].n }, { mean: groups[k2[1]].mean, sd: groups[k2[1]].stddev, n: groups[k2[1]].n })
          setDimResult(tr ? { type: 'ttest', res: tr, g1: k2[0], g2: k2[1], boxStats: boxStats } : null)
          return
        }
        var statsIn: Record<string, { mean: number; sd: number; n: number }> = {}
        gKeys.forEach(function(k) { statsIn[k] = { mean: groups[k].mean, sd: groups[k].stddev, n: groups[k].n } })
        var ar = anovaFromStats(statsIn)
        setDimResult(ar ? { type: 'anova', res: ar, boxStats: boxStats } : null)
      } catch { if (!cancelled) setDimResult(null) }
    })()
    return function() { cancelled = true }
  }, [dimInvolved, testType, catF, catF2, numF, groupDimAxis, chiDimA, chiDimB, datasetId, dimFieldKey, filteredRowIds])

  // const so the `result && result.res` narrowings survive into the JSX IIFEs below
  const result: GroupTestResult | null = dimInvolved ? dimResult : syncResult

  if (!catFields.length) return <StatsEmpty icon={'\u2297'} msg="No categorical fields active" />
  if (!numFields.length && testType !== 'chisq') return <StatsEmpty icon={'\u2297'} msg="No numeric fields active" sub="Select Chi-square to compare two categorical fields." />

  var handlePanelDrop = function(e: React.DragEvent) {
    e.preventDefault(); setPanelDragOver(false)
    try {
      var payload = JSON.parse(e.dataTransfer.getData('text/field'))
      if (payload.type === 'numeric' && numFields.some(function(f) { return f.field === payload.field })) {
        setNumF(payload.field)
      } else if (payload.type === 'categorical' && catFields.some(function(f) { return f.field === payload.field })) {
        if (testType === 'chisq') setCatF(payload.field)
        else setCatF(payload.field)
      }
    } catch {}
    _statsDrag = null
  }

  return (
    <div
      onDragOver={function(e) { e.preventDefault(); if (!panelDragOver) setPanelDragOver(true) }}
      onDragLeave={function(e) { var rt = e.relatedTarget as Node | null; if (!rt || !e.currentTarget.contains(rt)) setPanelDragOver(false) }}
      onDrop={handlePanelDrop}
    >
      {panelDragOver && _statsDrag && (function() {
        var drag = _statsDrag!
        var canAccept = (drag.type === 'numeric' && numFields.some(function(f) { return f.field === drag.field }))
                     || (drag.type === 'categorical' && catFields.some(function(f) { return f.field === drag.field }))
        var slotName = drag.type === 'numeric' ? 'Outcome' : 'Group by'
        return (
          <div style={{ marginBottom: 14, padding: '8px 14px', background: canAccept ? T.accentBg : '#fef2f2', border: '1.5px dashed ' + (canAccept ? T.accent : '#fca5a5'), borderRadius: 8, fontSize: 12, color: canAccept ? T.accent : '#991b1b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15 }}>{canAccept ? '↓' : '✕'}</span>
            <span>{canAccept ? <><strong>{drag.label}</strong> → <strong>{slotName}</strong> — release to assign</> : <>No slot accepts <strong>{drag.type}</strong> fields here</>}</span>
          </div>
        )
      })()}
      <PanelHeader icon={'\u2297'} title="Group Tests" desc={"Compare distributions across groups: Welch\u2019s t-test, one-way ANOVA, Mann-Whitney U, and Chi-square."} />
      {result && result.res && (function() {
        var numLabel = aliases[numF] || numF
        var catLabel = aliases[catF] || catF
        var catLabel2 = aliases[catF2] || catF2
        return <BottomLine
          text={result.type === 'ttest' ? ttestBL(result.res, numLabel) : result.type === 'anova' ? anovaBL(result.res, numLabel) : result.type === 'mw' ? mwBL(result.res, numLabel, result.g1 || '', result.g2 || '') : result.type === 'chisq' ? chiBL(result.res, catLabel, catLabel2) : ''}
          naiveText={result.type === 'ttest' ? ttestBL_naive(result.res, numLabel) : result.type === 'anova' ? anovaBL_naive(result.res, numLabel) : result.type === 'mw' ? mwBL_naive(result.res, numLabel, result.g1 || '', result.g2 || '') : result.type === 'chisq' ? chiBL_naive(result.res, catLabel, catLabel2) : ''}
        />
      })()}
      <Card style={{ padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {([
            ['auto', 'Auto-select', 'Automatically picks the best test based on your data'],
            ['ttest', 't-test', 'Compare means of 2 groups — use when you have one numeric outcome and one categorical grouping with exactly 2 groups'],
            ['anova', 'ANOVA', 'Compare means across 3+ groups — use when your grouping variable has more than 2 categories'],
            ['mw', 'Mann-Whitney', 'Non-parametric alternative to t-test — use when data is not normally distributed or has outliers'],
            ['chisq', 'Chi-square', 'Test association between two categorical variables — use when both variables are categories (not numeric)'],
          ] as [string, string, string][]).map(function(pair) {
            return <FieldPill key={pair[0]} label={pair[1]} active={testType === pair[0]} onClick={function() { setTestType(pair[0]) }} title={pair[2]} />
          })}
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {testType !== 'chisq' ? (
            <>
              <DSSelect label="Outcome (numeric)" value={numF} onChange={setNumF} options={numFields.map(function(f) { return { v: f.field, l: f.label || f.field, s: f.section || 'core' } })} />
              <DSSelect label="Group by (categorical)" value={catF} onChange={setCatF} options={catFields.map(function(f) { return { v: f.field, l: f.label || f.field, s: f.section || 'core' } })} />
            </>
          ) : (
            <>
              <DSSelect label="Row variable" value={catF} onChange={setCatF} options={catFields.map(function(f) { return { v: f.field, l: f.label || f.field, s: f.section || 'core' } })} />
              <DSSelect label="Column variable" value={catF2} onChange={setCatF2} options={catFields.map(function(f) { return { v: f.field, l: f.label || f.field, s: f.section || 'core' } })} />
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
                <StatRow label={'Mean (' + result.g1 + ')'} value={fmtN(result.res.ma)} />
                <StatRow label={'Mean (' + result.g2 + ')'} value={fmtN(result.res.mb)} />
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

      {/* Mann-Whitney needs raw ranks — not available for server-aggregated dimensions */}
      {result && result.type === 'mw_unsupported' && (
        <Card style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 13, color: T.textMid }}>
            Mann-Whitney U needs the raw values to rank, which aren&rsquo;t available for Dimensions (they&rsquo;re aggregated on the server). Use <strong>t-test</strong> or <strong>ANOVA</strong> to compare a numeric outcome across this dimension.
          </div>
        </Card>
      )}

      {/* Box plots for numeric group comparisons — raw arrays, or precomputed from dimension stats */}
      {result && result.res && result.type !== 'chisq' && (result.groups || result.boxStats) && (
        <Card style={{ padding: '14px 16px', marginTop: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>Group Distributions</div>
          <PlotlyChart
            data={(function() {
              var pal = [T.accent, T.blue, T.green, T.purple, T.amber, T.red]
              if (result.boxStats) {
                var bs = result.boxStats as Record<string, { q1: number; median: number; q3: number; min: number; max: number; mean: number }>
                return Object.keys(bs).slice(0, 10).map(function(key, i) {
                  var st = bs[key]
                  return { type: 'box', name: key.slice(0, 20), q1: [st.q1], median: [st.median], q3: [st.q3], lowerfence: [st.min], upperfence: [st.max], mean: [st.mean], marker: { color: pal[i % pal.length] } }
                })
              }
              var grps = result.groups as Record<string, number[]>
              var catFieldObj = catFields.find(function(f) { return f.field === catF })
              var orderedKeys = smartOrder(Object.keys(grps), catFieldObj?.remapping).slice(0, 10)
              return orderedKeys.map(function(key, i) {
                return { y: grps[key], type: 'box', name: key.slice(0, 20), marker: { color: pal[i % pal.length] }, boxpoints: 'outliers', jitter: 0.3, pointpos: -1.8 }
              })
            })()}
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

var MAX_PREDICTORS = 12

// Logistic regression over ANY field type (numeric, categorical → one-hot or
// ordinal, or theme → mentioned/not) predicting a binary outcome. Self-contained:
// owns its picker + binarization state; delegates the math to
// buildDesign → pruneCollinear → logisticRegression.
function LogisticPanel({ fields, data, themeModel, themeSourceField, aliases, datasetId }: {
  fields: SchemaFieldConfig[]; data: Record<string, unknown>[]; themeModel: ThemeModel | null | undefined; themeSourceField: string; aliases: Record<string, string>; datasetId: string
}) {
  var _lk = 'statsLogit_' + datasetId
  var regVars = useMemo(function() { return buildRegVars(fields, themeModel, themeSourceField) }, [fields, themeModel, themeSourceField])
  var varByKey = useMemo(function() { var m: Record<string, RegVar> = {}; regVars.forEach(function(v) { m[v.key] = v }); return m }, [regVars])
  var numericVars = regVars.filter(function(v) { return v.kind === 'numeric' })
  var catVars = regVars.filter(function(v) { return v.kind === 'categorical' })
  var themeVars = regVars.filter(function(v) { return v.kind === 'theme' })

  var [outcomeKey, setOutcomeKey] = useState<string>('')
  var [preds, setPreds] = useState<Set<string>>(function() { return new Set() })
  var [ordinal, setOrdinal] = useState<Set<string>>(function() { return new Set() })
  var [cuts, setCuts] = useState<Record<string, number>>({})
  var [levels, setLevels] = useState<Record<string, string>>({})
  var [restored, setRestored] = useState(false)
  useEffect(function() {
    var s = readSession<{ outcomeKey?: string; preds?: string[]; ordinal?: string[]; cuts?: Record<string, number>; levels?: Record<string, string> }>(_lk)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restores persisted picker state from sessionStorage on mount / dataset-key change
    if (s?.outcomeKey) setOutcomeKey(s.outcomeKey)
    if (Array.isArray(s?.preds)) setPreds(new Set(s.preds))
    // Recognized ranked Likert scales default to ordinal (quantitative); the user
    // can flip any to one-hot. Seed only on a fresh session (no saved value).
    if (Array.isArray(s?.ordinal)) setOrdinal(new Set(s.ordinal))
    else setOrdinal(new Set(regVars.filter(function(v) { return v.ordinalable }).map(function(v) { return v.key })))
    if (s?.cuts) setCuts(s.cuts)
    if (s?.levels) setLevels(s.levels)
    setRestored(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore + one-time ordinal seed on dataset-key change only; regVars captured intentionally
  }, [_lk])
  useEffect(function() {
    if (!restored) return
    writeSession(_lk, { outcomeKey: outcomeKey, preds: Array.from(preds), ordinal: Array.from(ordinal), cuts: cuts, levels: levels })
  }, [restored, outcomeKey, preds, ordinal, cuts, levels, _lk])
  // Default outcome = a rating/satisfaction field (categorical w/ remapping), else first numeric.
  useEffect(function() {
    if (!restored || outcomeKey || !regVars.length) return
    var pref = regVars.find(function(v) { return v.kind === 'categorical' && !!(v.ordinalMap || v.remapping) }) || numericVars[0] || regVars[0]
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time default outcome once restore completes
    if (pref) setOutcomeKey(pref.key)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time default; must not re-fire on numericVars identity
  }, [restored, regVars])

  var MAX_LOGIT_PREDS = 12
  var togglePred = function(k: string) {
    setPreds(function(prev) { var n = new Set(prev); if (n.has(k)) n.delete(k); else if (n.size < MAX_LOGIT_PREDS) n.add(k); return n })
  }
  var toggleOrd = function(k: string) { setOrdinal(function(prev) { var n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n }) }

  var fl = function(v: RegVar) { return aliases[v.label] || v.label }
  // A ranked map for a quantitative outcome/threshold: stored remapping or a
  // scaleUtils-recognized Likert scale.
  var qmap = function(v: RegVar): Record<string, number> | undefined { return v.ordinalMap || v.remapping }
  var isQuant = function(v: RegVar): boolean { return v.kind === 'numeric' || !!qmap(v) }
  var defaultCut = function(v: RegVar): number {
    var m = qmap(v); if (m) return Math.max.apply(null, Object.values(m)) // strict top box
    var nums = getNum(v.field!, data); return nums.length ? median(nums) : 0
  }
  var topLevel = function(v: RegVar): string {
    var freq: Record<string, number> = {}; data.forEach(function(r) { var s = String(r[v.field!] || '').trim(); if (s) freq[s] = (freq[s] || 0) + 1 })
    return Object.keys(freq).sort(function(a, b) { return freq[b] - freq[a] })[0] || ''
  }
  // A recognized ranked (Likert) categorical defaults to ordinal/quant (it's in
  // the `ordinal` set, seeded below); the user can flip it to one-hot. A
  // non-ordinalable categorical is always one-hot.
  var encodingFor = function(v: RegVar): 'ordinal' | 'onehot' {
    if (v.kind !== 'categorical' || !v.ordinalable) return 'onehot'
    return ordinal.has(v.key) ? 'ordinal' : 'onehot'
  }

  var fit = useMemo(function() {
    var ov = varByKey[outcomeKey]; if (!ov) return null
    var predVars = Array.from(preds).map(function(k) { return varByKey[k] }).filter(Boolean) as RegVar[]
    predVars = predVars.filter(function(v) { return v.key !== outcomeKey })
    if (!predVars.length) return { empty: 'pick' as const }
    var spec: OutcomeSpec
    if (ov.kind === 'theme') spec = { v: ov }
    else if (isQuant(ov)) spec = { v: ov, cut: cuts[ov.key] != null ? cuts[ov.key] : defaultCut(ov) }
    else spec = { v: ov, level: levels[ov.key] || topLevel(ov) }
    var predSpecs: PredictorSpec[] = predVars.map(function(v) { return { v: v, encoding: encodingFor(v) } })
    var d = buildDesign(data, spec, predSpecs)
    if (!d) return { empty: 'nodata' as const }
    if (d.nPos < 3 || d.nNeg < 3) return { empty: 'class' as const, d: d }
    if (d.n <= d.colNames.length + 1) return { empty: 'few' as const, d: d }
    var prune = pruneCollinear(d.X, d.colNames, 10)
    if (!prune.keptNames.length) return { empty: 'nocols' as const, d: d }
    var X = d.X.map(function(row) { return prune.keptIdx.map(function(i) { return row[i] }) })
    var res = logisticRegression(d.y, X, prune.keptNames)
    if (!res) return { empty: 'fit' as const, d: d }
    return { res: res, dropped: prune.dropped, d: d }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the encode/spec helper closures are pure over these state deps; listing them (recreated each render) would recompute the fit every render
  }, [varByKey, outcomeKey, preds, ordinal, cuts, levels, data])

  var outcomeVar = varByKey[outcomeKey] || null
  var res = fit && 'res' in fit ? fit.res : null
  var dropped: { name: string; vif: number }[] = fit && 'dropped' in fit && Array.isArray(fit.dropped) ? fit.dropped : []

  // Expert register — one dense odds-ratio sentence.
  var logitBL = function(): string {
    if (!res || !fit || !('d' in fit) || !fit.d) return ''
    var label = fit.d.outcomeLabel
    var ps = res.coefs.filter(function(c) { return c.name !== 'Intercept' })
    if (res.separation && !res.regularized) return 'The model could not be estimated reliably (separation) — coefficients are not trustworthy. Drop a predictor or add data.'
    var sig = ps.filter(function(c) { return c.p < 0.05 })
    if (!sig.length) return 'None of the ' + ps.length + ' terms significantly shifts the odds that a response has ' + label + ' (all p ≥ 0.05).'
    var top = sig.slice().sort(function(a, b) { return Math.abs(Math.log(b.or)) - Math.abs(Math.log(a.or)) })[0]
    var pct = Math.round(Math.abs((top.or - 1) * 100))
    var lever = aliases[top.name] || top.name
    return sig.length + ' of ' + ps.length + ' terms significantly affect the odds that a response has ' + label + '. Strongest: ' + lever + ' ' + (top.or >= 1 ? 'multiplies' : 'cuts') + ' the odds ' + fmt2(top.or) + '× (' + (top.or >= 1 ? '+' : '−') + pct + '%). McFadden pseudo-R² = ' + fmt2(res.pseudoR2) + '.'
  }

  // Plain-English register — a scannable, colour-coded block (bold factor names;
  // red = lowers the odds of the outcome, green = raises them, each with its own
  // % effect) instead of one run-on paragraph.
  var logitBLNode = function(): ReactNode {
    if (!res || !fit || !('d' in fit) || !fit.d) return null
    var label = fit.d.outcomeLabel
    var ps = res.coefs.filter(function(c) { return c.name !== 'Intercept' })
    if (res.separation && !res.regularized) return "The model can't be read reliably yet — there isn't enough contrast in the data. Add more responses or drop a factor."
    var sig = ps.filter(function(c) { return c.p < 0.05 })
    if (!sig.length) return 'Nothing here clearly moves the needle — none of the ' + ps.length + ' factors makes a real difference to whether a response reaches ' + label + '.'
    var nameOf = function(c: typeof ps[number]) { return aliases[c.name] || c.name }
    var pctOf = function(c: typeof ps[number]) { return Math.round(Math.abs((c.or - 1) * 100)) }
    var byMag = function(a: typeof ps[number], b: typeof ps[number]) { return pctOf(b) - pctOf(a) }
    var down = sig.filter(function(c) { return c.or < 1 }).sort(byMag)
    var up = sig.filter(function(c) { return c.or >= 1 }).sort(byMag)
    var nonSig = ps.filter(function(c) { return c.p >= 0.05 })
    var strength = res.pseudoR2 < 0.1 ? 'only a small part' : res.pseudoR2 < 0.2 ? 'a modest part' : res.pseudoR2 < 0.4 ? 'a good part' : 'most'
    var row = function(heading: string, color: string, items: typeof ps, showPct: boolean) {
      return (
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: color, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap', minWidth: 108 }}>{heading}</span>
          <span style={{ flex: 1, minWidth: 140 }}>
            {items.map(function(c, i) {
              return (
                <span key={c.name}>
                  <strong style={{ color: color }}>{nameOf(c)}</strong>
                  {showPct ? <span style={{ color: color, fontWeight: 700 }}>{' '}{c.or < 1 ? '−' : '+'}{pctOf(c)}%</span> : null}
                  {i < items.length - 1 ? <span style={{ color: T.textFaint }}>, </span> : null}
                </span>
              )
            })}
          </span>
        </div>
      )
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <div>
          We looked at what makes a response reach <strong>{label}</strong>, across {fit.d.n.toLocaleString()} responses.{' '}
          <strong>{sig.length}</strong> of the {ps.length} factors genuinely move the needle — a real pattern, not a fluke.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {down.length > 0 && row('Lower the odds', T.red, down, true)}
          {up.length > 0 && row('Raise the odds', T.green, up, true)}
          {nonSig.length > 0 && row('No clear effect', T.textFaint, nonSig, false)}
        </div>
        <div style={{ color: T.textFaint }}>
          Together these explain {strength} of the story — the rest comes down to things we didn&rsquo;t measure.
        </div>
      </div>
    )
  }

  var predGroup = function(title: string, vars: RegVar[], withOrd: boolean) {
    if (!vars.length) return null
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 4 }}>{title}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {vars.map(function(v) {
            var sel = preds.has(v.key), isOut = v.key === outcomeKey
            return (
              <div key={v.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button onClick={isOut ? undefined : function() { togglePred(v.key) }} disabled={isOut}
                  title={isOut ? 'Currently the outcome' : undefined}
                  style={{ flex: 1, padding: '5px 9px', fontSize: 12, textAlign: 'left', fontWeight: sel ? 700 : 400, background: sel ? T.accentBg : 'transparent', border: '1px solid ' + (sel ? T.accent : T.border), color: isOut ? T.textFaint : sel ? T.accent : T.textMid, borderRadius: 7, cursor: isOut ? 'not-allowed' : 'pointer', opacity: isOut ? 0.4 : 1, display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ width: 13, height: 13, borderRadius: 3, background: sel ? T.accent : T.border, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: 'white' }}>{sel ? '✓' : ''}</span>
                  {fl(v)}
                </button>
                {withOrd && sel && v.ordinalable && (
                  <button onClick={function() { toggleOrd(v.key) }}
                    title={ordinal.has(v.key) ? 'Ranked → single quantitative column (this scale is recognized). Click for one-hot dummies instead.' : 'One-hot: a dummy per level vs the modal baseline. Click to treat as a ranked quantitative scale.'}
                    style={{ fontSize: 9, fontWeight: 700, padding: '3px 6px', borderRadius: 5, cursor: 'pointer', border: '1px solid ' + T.border, background: ordinal.has(v.key) ? T.accent : T.bg, color: ordinal.has(v.key) ? 'white' : T.textFaint, flexShrink: 0 }}>
                    {ordinal.has(v.key) ? 'quant' : '1-hot'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (!regVars.length) return <StatsEmpty icon={'⟋'} msg="No fields available" sub="Activate some fields to model." />

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20 }}>
      {/* Variable selector */}
      <Card style={{ padding: 16, alignSelf: 'start' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>Outcome (predict)</div>
        <select value={outcomeKey} onChange={function(e) { setOutcomeKey(e.target.value) }}
          style={{ width: '100%', padding: '7px 10px', fontSize: 13, border: '1.5px solid ' + T.border, borderRadius: 7, background: T.bgCard, color: T.text, outline: 'none', cursor: 'pointer' }}>
          {numericVars.length > 0 && <optgroup label="Numeric">{numericVars.map(function(v) { return <option key={v.key} value={v.key}>{fl(v)}</option> })}</optgroup>}
          {catVars.length > 0 && <optgroup label="Categorical">{catVars.map(function(v) { return <option key={v.key} value={v.key}>{fl(v)}{v.ordinalable ? ' (ranked)' : ''}</option> })}</optgroup>}
          {themeVars.length > 0 && <optgroup label="Themes">{themeVars.map(function(v) { return <option key={v.key} value={v.key}>{fl(v)}</option> })}</optgroup>}
        </select>
        {outcomeVar && (
          <div style={{ marginTop: 8, marginBottom: 16 }}>
            {outcomeVar.kind === 'theme' ? (
              <div style={{ fontSize: 11, color: T.textFaint }}>= 1 when the response mentions this theme.</div>
            ) : isQuant(outcomeVar) ? (
              <label style={{ fontSize: 11, color: T.textFaint, display: 'flex', alignItems: 'center', gap: 6 }}>
                = 1 when ≥
                <input type="number" step="any" key={outcomeKey}
                  defaultValue={cuts[outcomeKey] != null ? cuts[outcomeKey] : defaultCut(outcomeVar)}
                  onBlur={function(e) { var val = parseFloat(e.target.value); setCuts(function(prev) { var n = Object.assign({}, prev); if (!isNaN(val)) n[outcomeKey] = val; return n }) }}
                  style={{ width: 70, fontSize: 16, padding: '3px 6px', border: '1px solid ' + T.border, borderRadius: 6, background: T.bgCard, color: T.text }} />
                {qmap(outcomeVar) ? '(top box)' : ''}
              </label>
            ) : (
              <label style={{ fontSize: 11, color: T.textFaint, display: 'flex', flexDirection: 'column', gap: 3 }}>
                = 1 when value is
                <select value={levels[outcomeKey] || topLevel(outcomeVar)} onChange={function(e) { var val = e.target.value; setLevels(function(prev) { var n = Object.assign({}, prev); n[outcomeKey] = val; return n }) }}
                  style={{ fontSize: 14, padding: '4px 6px', border: '1px solid ' + T.border, borderRadius: 6, background: T.bgCard, color: T.text }}>
                  {(outcomeVar.values || []).map(function(lv) { return <option key={lv} value={lv}>{lv}</option> })}
                </select>
              </label>
            )}
          </div>
        )}
        <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>Predictors ({preds.size}/{MAX_LOGIT_PREDS})</div>
        {predGroup('Numeric', numericVars, false)}
        {predGroup('Categorical', catVars, true)}
        {predGroup('Themes', themeVars, false)}
      </Card>

      {/* Results */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!res ? (
          <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: T.textMid, fontSize: 13, padding: 40, textAlign: 'center' }}>
            {(function() {
              var e = fit && 'empty' in fit ? fit.empty : 'pick'
              var nInfo = fit && 'd' in fit && fit.d ? ' (only ' + fit.d.n + ' rows have every selected field answered)' : ''
              if (e === 'pick') return 'Pick an outcome and at least one predictor to fit a logistic model.'
              if (e === 'class') return 'The outcome doesn’t split into two groups here — one class has fewer than 3 responses after binarizing. Adjust the cutoff or pick a different outcome.'
              if (e === 'few') return '⚠ Too many predictors for the data. Each predictor must be answered on the SAME rows, so adding more shrinks the usable sample' + nInfo + '. Remove some predictors, or prefer ranked (quant) encoding over one-hot to use fewer columns.'
              if (e === 'nocols') return 'Every predictor was dropped as redundant (perfectly collinear). Pick more distinct predictors.'
              if (e === 'fit') return '⚠ The model couldn’t be estimated with these predictors' + nInfo + ' — usually too many terms for the sample, or a predictor perfectly separates the outcome. Remove a predictor (or switch a one-hot categorical to ranked/quant) and it will fit.'
              return 'Pick an outcome and at least one predictor.'
            })()}
          </div>
        ) : (
          <>
            {fit && 'd' in fit && fit.d && (
              <Card style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: T.textMid }}>Modeling <b style={{ color: T.text }}>P({fit.d.outcomeLabel})</b></span>
                <span style={{ fontSize: 11, color: T.textFaint, marginLeft: 'auto', fontFamily: 'monospace' }}>{fit.d.nPos} pos / {fit.d.nNeg} neg</span>
              </Card>
            )}
            {res.separation && (
              <div style={{ fontSize: 12, color: T.amber, background: T.amberBg, border: '1px solid ' + T.amber, borderRadius: 10, padding: '9px 14px' }}>
                {res.regularized
                  ? '⚠ A predictor nearly determines the outcome (quasi-separation), so the model was stabilized with a ridge penalty just to return an estimate — the exact odds ratios and p-values here are NOT reliable. This usually means a predictor is really the outcome in disguise (e.g. predicting overall satisfaction from its own sub-scores). Use the direction/ranking as a hint, and drop the near-deterministic predictor for a trustworthy model.'
                  : '⚠ (Quasi-)separation or non-convergence — a predictor may perfectly split the outcome, so the numbers below are unreliable. Remove that predictor or add data.'}
              </div>
            )}
            {dropped.length > 0 && (
              <div style={{ fontSize: 12, color: T.textMid, background: T.bg, border: '1px solid ' + T.border, borderRadius: 10, padding: '9px 14px' }}>
                <b style={{ color: T.text }}>Dropped for collinearity (VIF &gt; 10):</b> {dropped.map(function(dd) { return (aliases[dd.name] || dd.name) + ' (' + (dd.vif === Infinity ? '∞' : fmtN(dd.vif)) + ')' }).join(', ')}.
              </div>
            )}
            <BottomLine text={logitBL()} naiveNode={logitBLNode()} />
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '11px 16px', borderBottom: '1px solid ' + T.border, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Model Fit</span>
                <SigBadge p={res.lrP} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)' }}>
                {[
                  { l: 'Pseudo R²', v: fmt2(res.pseudoR2), c: res.pseudoR2 > 0.3 ? T.green : res.pseudoR2 > 0.1 ? T.amber : T.textMid },
                  { l: 'LR χ²', v: fmtN(res.lr), c: T.textMid },
                  { l: 'p-value', v: fmtP(res.lrP).replace('p = ', '').replace('p < ', '<'), c: res.lrP < 0.001 ? T.green : res.lrP < 0.05 ? T.amber : T.red },
                  { l: 'AIC', v: fmtN(res.aic), c: T.textMid },
                  { l: 'n', v: String(res.n), c: T.textMid },
                ].map(function(s, i) {
                  return (
                    <div key={i} style={{ padding: '14px 12px', borderRight: i < 4 ? '1px solid ' + T.border : 'none', textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: s.c || T.textMid, fontFamily: 'monospace' }}>{s.v}</div>
                      <div style={{ fontSize: 10, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.07em', marginTop: 3 }}>{s.l}</div>
                    </div>
                  )
                })}
              </div>
            </Card>
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '11px 16px', borderBottom: '1px solid ' + T.border }}><span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Coefficients (odds ratios)</span></div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr>
                    {['Term', 'Odds Ratio', '95% CI', 'β', 'z', 'p', ''].map(function(h) {
                      return <th key={h} style={{ padding: '7px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: T.textFaint, background: T.bg, borderBottom: '1px solid ' + T.border }}>{h}</th>
                    })}
                  </tr></thead>
                  <tbody>{res.coefs.map(function(c, i) {
                    var isInt = c.name === 'Intercept'
                    return (
                      <tr key={i} style={{ background: !isInt && c.p < 0.05 ? T.greenBg + '80' : 'transparent' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 600, color: T.text, borderBottom: '1px solid ' + T.border, fontSize: 12.5 }}>{aliases[c.name] || c.name}</td>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: isInt ? T.textFaint : (c.or > 1 ? T.green : T.red), borderBottom: '1px solid ' + T.border }}>{isInt ? '—' : fmt2(c.or) + '×'}</td>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 11, color: T.textFaint, borderBottom: '1px solid ' + T.border }}>{isInt ? '—' : '[' + fmt2(c.orCI[0]) + ', ' + fmt2(c.orCI[1]) + ']'}</td>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12, color: T.textMid, borderBottom: '1px solid ' + T.border }}>{fmtN(c.beta)}</td>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12, color: T.textMid, borderBottom: '1px solid ' + T.border }}>{fmt2(c.z)}</td>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12, color: T.textMid, borderBottom: '1px solid ' + T.border }}>{fmtP(c.p).replace('p ', '')}</td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid ' + T.border }}>{isInt ? null : <SigBadge p={c.p} />}</td>
                      </tr>
                    )
                  })}</tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}

function RegressionPanel({ numFields, catFields, data, aliases, datasetId, themeModel, themeSourceField }: { numFields: SchemaFieldConfig[]; catFields: SchemaFieldConfig[]; data: Record<string, unknown>[]; aliases: Record<string, string>; datasetId: string; themeModel?: ThemeModel | null; themeSourceField?: string }) {
  var _rk = 'statsReg_' + datasetId
  var [outcomes, setOutcomes] = useState<Set<string>>(function() { return new Set() })
  var [predictors, setPredictors] = useState<Set<string>>(function() { return new Set() })
  var [activeOutcome, setActiveOutcome] = useState<string>('')
  var [outcomesOpen, setOutcomesOpen] = useState(true)
  var [regMode, setRegMode] = useState<'linear' | 'logistic'>('linear')
  var [regRestored, setRegRestored] = useState(false)
  useEffect(function() {
    var saved = readSession<{ outcomes?: string[]; predictors?: string[]; activeOutcome?: string; regMode?: 'linear' | 'logistic' }>(_rk)
    if (Array.isArray(saved?.outcomes)) setOutcomes(new Set(saved.outcomes))
    if (Array.isArray(saved?.predictors)) setPredictors(new Set(saved.predictors))
    if (saved?.activeOutcome) setActiveOutcome(saved.activeOutcome)
    if (saved?.regMode) setRegMode(saved.regMode)
    setRegRestored(true)
  }, [_rk])
  useEffect(function() {
    if (!regRestored) return
    writeSession(_rk, { outcomes: Array.from(outcomes), predictors: Array.from(predictors), activeOutcome: activeOutcome, regMode: regMode })
  }, [regRestored, outcomes, predictors, activeOutcome, regMode, _rk])

  var fl2 = function(f: SchemaFieldConfig) { return aliases[f.field] || f.label || f.field }

  var toggleOutcome = function(f: string) {
    setOutcomes(function(prev) {
      var n = new Set(prev)
      if (n.has(f)) {
        n.delete(f)
        if (activeOutcome === f) setActiveOutcome(Array.from(n)[0] || '')
      } else {
        n.add(f)
        if (!activeOutcome) setActiveOutcome(f)
        setOutcomesOpen(false)  // collapse after first pick
      }
      return n
    })
    setPredictors(function(prev) { var n = new Set(prev); n.delete(f); return n })
  }

  var toggleP = function(f: string) {
    setPredictors(function(prev) {
      var n = new Set(prev)
      if (n.has(f)) { n.delete(f) }
      else if (n.size < MAX_PREDICTORS) { n.add(f) }
      return n
    })
  }

  var results = useMemo(function() {
    var out: Record<string, RegressionResult> = {}
    if (!outcomes.size || !predictors.size) return out
    outcomes.forEach(function(oc) {
      var preds = Array.from(predictors).filter(function(p) { return p !== oc })
      if (!preds.length) return
      var filtered = data.filter(function(r) {
        return !isNaN(parseFloat(String(r[oc] || '').replace(/,/g, ''))) &&
          preds.every(function(p) { return !isNaN(parseFloat(String(r[p] || '').replace(/,/g, ''))) })
      })
      if (filtered.length < preds.length + 2) return
      var y = filtered.map(function(r) { return parseFloat(String(r[oc]).replace(/,/g, '')) })
      var X = filtered.map(function(r) { return preds.map(function(p) { return parseFloat(String(r[p]).replace(/,/g, '')) }) })
      var res = olsRegression(y, X, preds)
      if (res) out[oc] = res
    })
    return out
  }, [outcomes, predictors, data])

  // Keep activeOutcome in sync if its OLS result was removed
  useEffect(function() {
    var keys = Object.keys(results)
    if (keys.length && (!activeOutcome || !results[activeOutcome])) setActiveOutcome(keys[0])
  }, [results])

  var activeResult = results[activeOutcome] || null
  var outcomeFields = numFields.filter(function(f) { return !predictors.has(f.field) })
  var predictorFields = numFields.filter(function(f) { return !outcomes.has(f.field) })

  // Per-field diagnostics — used for warning icons on problem fields
  var fieldDiag = useMemo(function() {
    var diag: Record<string, string> = {}
    numFields.forEach(function(f) {
      var vals = getNum(f.field, data)
      if (vals.length < 3) {
        diag[f.field] = 'Only ' + vals.length + ' valid numeric value(s) — insufficient for regression'
      } else if (vals.length < data.length * 0.1) {
        diag[f.field] = Math.round(vals.length / Math.max(data.length, 1) * 100) + '% of rows have valid values (' + vals.length + ' of ' + data.length + ')'
      } else {
        var mn = vals.reduce(function(s, v) { return s + v }, 0) / vals.length
        var vr = vals.reduce(function(s, v) { return s + (v - mn) ** 2 }, 0) / vals.length
        if (vr === 0) diag[f.field] = 'Zero variance — all values are identical (' + vals[0] + ')'
      }
    })
    return diag
  }, [numFields, data])

  // Pearson r between each predictor and the selected outcome(s) — used for correlation signal badges
  var corrMap = useMemo(function() {
    var map: Record<string, { r: number; n: number }> = {}
    if (!outcomes.size) return map
    var ocArr = Array.from(outcomes)
    predictorFields.forEach(function(f) {
      var bestR = 0, bestN = 0
      ocArr.forEach(function(oc) {
        var xs: number[] = [], ys: number[] = []
        data.forEach(function(r) {
          var x = parseFloat(String(r[f.field] || '').replace(/,/g, ''))
          var y = parseFloat(String(r[oc] || '').replace(/,/g, ''))
          if (!isNaN(x) && !isNaN(y)) { xs.push(x); ys.push(y) }
        })
        if (xs.length < 3) return
        var res = pearsonR(xs, ys)
        if (!isNaN(res.r) && Math.abs(res.r) > Math.abs(bestR)) { bestR = res.r; bestN = res.n }
      })
      if (bestN >= 3) map[f.field] = { r: bestR, n: bestN }
    })
    return map
  }, [outcomes, predictorFields, data])

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <PanelHeader
          icon={'\u27CB'}
          title={regMode === "logistic" ? "Logistic Regression" : "OLS Linear Regression"}
          desc={regMode === "logistic"
            ? "Maximum-likelihood logistic regression for a binary outcome. Highly collinear predictors (VIF > 10) are dropped automatically so each effect is attributed cleanly. Coefficients are shown as odds ratios."
            : "Ordinary least squares regression. Select one or more outcome variables and any number of predictors — a separate model is fitted for each outcome."} />
        {/* Linear / Logistic mode toggle */}
        <div style={{ display: "flex", background: T.bg, border: "1px solid " + T.border, borderRadius: 9, padding: 3, flexShrink: 0 }}>
          {(["linear", "logistic"] as const).map(function(m) {
            var on = regMode === m
            return (
              <button key={m} onClick={function() { setRegMode(m) }}
                style={{ padding: "5px 14px", fontSize: 12, fontWeight: on ? 700 : 500, borderRadius: 6, border: "none", cursor: "pointer", background: on ? T.bgCard : "transparent", color: on ? T.accent : T.textMute, boxShadow: on ? "0 1px 4px rgba(0,0,0,.08)" : "none" }}>
                {m === "linear" ? "Linear" : "Logistic"}
              </button>
            )
          })}
        </div>
      </div>

      {regMode === 'logistic' ? (
        <LogisticPanel fields={numFields.concat(catFields).filter(function(f) { return !isMappedId(f.field) })} data={data} themeModel={themeModel} themeSourceField={themeSourceField || ''} aliases={aliases} datasetId={datasetId} />
      ) : numFields.length < 2 ? (
        <StatsEmpty icon={'\u27CB'} msg="Need at least 2 numeric fields" sub="Activate more numeric fields or map categorical values to numbers." />
      ) : (<>
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20, marginBottom: 20 }}>
        {/* ── Variable selector ── */}
        <Card style={{ padding: 16 }}>
          {/* Outcomes */}
          <button
            onClick={function() { setOutcomesOpen(function(v) { return !v }) }}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: outcomesOpen ? 6 : 14 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase' }}>
              Outcomes {outcomes.size > 0 ? '(' + outcomes.size + ')' : ''}
            </span>
            <span style={{ fontSize: 11, color: outcomesOpen ? T.textFaint : T.accent, fontWeight: 600 }}>
              {outcomesOpen ? '\u25BE' : (outcomes.size > 0 ? Array.from(outcomes).map(function(oc) { return (aliases[oc] || oc).slice(0, 12) }).join(', ') + ' \u25B8' : '\u25B8')}
            </span>
          </button>
          {outcomesOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 18 }}>
              {outcomeFields.map(function(f) {
                var sel = outcomes.has(f.field)
                var warn = fieldDiag[f.field]
                return (
                  <button key={f.field} onClick={warn ? undefined : function() { toggleOutcome(f.field) }}
                    title={warn || undefined}
                    style={{ padding: '6px 10px', fontSize: 12, textAlign: 'left', fontWeight: sel ? 700 : 400, background: sel ? T.accentBg : 'transparent', border: '1px solid ' + (warn ? T.amber : sel ? T.accent : T.border), color: warn ? T.textFaint : sel ? T.accent : T.textMid, borderRadius: 7, cursor: warn ? 'not-allowed' : 'pointer', opacity: warn ? 0.45 : 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 14, height: 14, borderRadius: 3, background: warn ? T.amber : sel ? T.accent : T.border, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: 'white' }}>{warn ? '⚠' : sel ? '\u2713' : ''}</span>
                    {fl2(f)}
                  </button>
                )
              })}
            </div>
          )}

          {/* Predictors */}
          <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 4 }}>
            Predictors ({predictors.size}/{MAX_PREDICTORS})
          </div>
          {predictors.size >= MAX_PREDICTORS && (
            <div style={{ fontSize: 10, color: T.amber, marginBottom: 6 }}>Max {MAX_PREDICTORS} reached. Deselect one to add another.</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {predictorFields.slice().sort(function(a, b) {
              var ca = corrMap[a.field], cb = corrMap[b.field]
              var absA = ca ? Math.abs(ca.r) : 0, absB = cb ? Math.abs(cb.r) : 0
              return absB - absA
            }).map(function(f) {
              var sel = predictors.has(f.field), atLimit = !sel && predictors.size >= MAX_PREDICTORS
              var warn = fieldDiag[f.field]
              var corr = !warn && outcomes.size > 0 ? corrMap[f.field] : undefined
              var corrColor = corr ? (Math.abs(corr.r) >= 0.4 ? T.green : Math.abs(corr.r) >= 0.2 ? T.amber : T.textFaint) : T.textFaint
              var disabled = warn || atLimit
              return (
                <button key={f.field} onClick={disabled ? undefined : function() { toggleP(f.field) }}
                  title={warn || (atLimit ? 'Max ' + MAX_PREDICTORS + ' predictors. Deselect one first.' : undefined)}
                  style={{ padding: '6px 10px', fontSize: 12, textAlign: 'left', fontWeight: sel ? 700 : 400, background: sel ? T.greenBg : 'transparent', border: '1px solid ' + (warn ? T.amber : sel ? T.green : T.border), color: disabled ? T.textFaint : sel ? T.green : T.textMid, borderRadius: 7, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 14, height: 14, borderRadius: 3, background: warn ? T.amber : sel ? T.green : T.border, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: 'white' }}>{warn ? '⚠' : sel ? '\u2713' : ''}</span>
                  {fl2(f)}
                  {corr && (
                    <span title={'Pearson r = ' + corr.r.toFixed(3) + ' (n=' + corr.n + ')'} style={{ fontSize: 10, fontWeight: 700, color: corrColor, marginLeft: 'auto', fontFamily: 'monospace' }}>
                      r{corr.r >= 0 ? '+' : ''}{corr.r.toFixed(2)}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </Card>

        {/* ── Results area ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {outcomes.size === 0 || predictors.size === 0 ? (
            <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.textFaint, fontSize: 13, padding: 40 }}>
              Select at least one outcome and one predictor to run regression.
            </div>
          ) : (
            <>
              {/* Outcome tabs — shown only when >1 outcome selected */}
              {outcomes.size > 1 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {Array.from(outcomes).map(function(oc) {
                    var isActive = activeOutcome === oc
                    var ln = results[oc]
                    var badge = ln ? { txt: 'R²=' + fmt2(ln.R2), col: ln.R2 > 0.5 ? T.green : ln.R2 > 0.25 ? T.amber : T.textFaint } : null
                    return (
                      <button key={oc} onClick={function() { setActiveOutcome(oc) }}
                        style={{ padding: '5px 14px', fontSize: 12, fontWeight: isActive ? 700 : 500, borderRadius: 20, cursor: 'pointer', border: '1px solid ' + (isActive ? T.accent : T.border), background: isActive ? T.accentBg : T.bg, color: isActive ? T.accent : T.textMid, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {aliases[oc] || oc}
                        {badge ? (
                          <span style={{ fontSize: 10, fontWeight: 700, color: badge.col }}>{badge.txt}</span>
                        ) : (
                          <span style={{ fontSize: 10, color: T.red }}>✗</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}

              {activeResult ? (
                <>
                  {<BottomLine text={regrBL(activeResult, aliases[activeOutcome] || activeOutcome, aliases)} naiveNode={regrBLNode(activeResult, aliases[activeOutcome] || activeOutcome, aliases)} />}
                  <Card style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '11px 16px', borderBottom: '1px solid ' + T.border, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Model Fit — {aliases[activeOutcome] || activeOutcome}</span>
                      <SigBadge p={activeResult.Fp} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)' }}>
                      {[
                        { l: 'R\u00B2', v: fmt2(activeResult.R2), c: activeResult.R2 > 0.5 ? T.green : activeResult.R2 > 0.25 ? T.amber : T.textMid },
                        { l: 'Adj. R\u00B2', v: fmt2(activeResult.R2adj), c: T.textMid },
                        { l: 'F stat', v: fmtN(activeResult.F), c: T.textMid },
                        { l: 'p-value', v: fmtP(activeResult.Fp).replace('p = ', '').replace('p < ', '<'), c: activeResult.Fp < 0.001 ? T.green : activeResult.Fp < 0.05 ? T.amber : T.red },
                        { l: 'n', v: String(activeResult.n), c: T.textMid },
                      ].map(function(s, i) {
                        return (
                          <div key={i} style={{ padding: '14px 12px', borderRight: i < 4 ? '1px solid ' + T.border : 'none', textAlign: 'center' }}>
                            <div style={{ fontSize: 18, fontWeight: 800, color: s.c || T.textMid, fontFamily: 'monospace' }}>{s.v}</div>
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
                      <tbody>{activeResult.coefs.map(function(c: RegressionCoef, i: number) {
                        return (
                          <tr key={i} style={{ background: c.p < 0.05 ? T.greenBg + '80' : 'transparent' }}>
                            <td style={{ padding: '8px 12px', fontWeight: 600, color: T.text, borderBottom: '1px solid ' + T.border, fontSize: 13 }}>{aliases[c.name] || c.name}</td>
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
                </>
              ) : (
                <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.textFaint, fontSize: 13, padding: 40 }}>
                  Insufficient data for this outcome/predictor combination.
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Residual diagnostic plots (OLS only) */}
      {regMode === 'linear' && activeResult && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 4 }}>
          <Card style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>Residuals vs. Fitted</div>
            <PlotlyChart
              data={[
                { x: activeResult.yhat, y: activeResult.resid, mode: 'markers', type: 'scatter', marker: { color: T.accent, size: 5, opacity: 0.5 } },
                { x: [Math.min.apply(null, activeResult.yhat), Math.max.apply(null, activeResult.yhat)], y: [0, 0], mode: 'lines', line: { color: T.red, width: 1.5, dash: 'dash' }, showlegend: false },
              ]}
              layout={{ xaxis: { title: { text: 'Fitted', font: { size: 11 } } }, yaxis: { title: { text: 'Residuals', font: { size: 11 } } }, showlegend: false, margin: { t: 8, r: 12, b: 44, l: 50 } }}
              style={{ height: 280, width: '100%' }}
            />
          </Card>
          <Card style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>Q-Q Plot (Residuals)</div>
            {(function() {
              var sr = activeResult.resid.slice().sort(function(a: number, b: number) { return a - b })
              var n = sr.length, th = sr.map(function(_: number, i: number) { return probit((i + 1 - 0.375) / (n + 0.25)) })
              var sm = mean(sr), ss = std(sr)
              return (
                <PlotlyChart
                  data={[
                    { x: th, y: sr, mode: 'markers', type: 'scatter', marker: { color: T.purple, size: 4, opacity: 0.65 } },
                    { x: [Math.min.apply(null, th), Math.max.apply(null, th)], y: [Math.min.apply(null, th) * ss + sm, Math.max.apply(null, th) * ss + sm], mode: 'lines', line: { color: T.amber, width: 1.5, dash: 'dot' }, showlegend: false },
                  ]}
                  layout={{ xaxis: { title: { text: 'Theoretical quantiles', font: { size: 11 } } }, yaxis: { title: { text: 'Sample quantiles', font: { size: 11 } } }, showlegend: false, margin: { t: 8, r: 12, b: 44, l: 50 } }}
                  style={{ height: 280, width: '100%' }}
                />
              )
            })()}
          </Card>
        </div>
      )}
      </>)}
    </div>
  )
}

type AutoFinding = {
  type: 'correlation' | 'group_effect' | 'distribution'
  title: string
  detail: string
  magnitude: number
  p: number
  badge: string
  badgeColor: string
  badgeBg: string
  // Table columns (2026-08-16). The list used to bury the effect size mid-
  // sentence, so the "sorted by effect size" ordering wasn't scannable. These
  // carry the SAME numbers the prose already quoted — nothing is recomputed.
  effect?: number        // signed r · Cohen's d · eta² · skewness
  effectLabel?: string   // 'r' | 'd' | 'η²' | 'skew'
  n?: number
  sub?: string           // the group-effect highest/lowest detail, shown muted under the relationship
}

// Auto "what drives the rating" analysis: a linear model of a target rating on
// the other numeric fields (the quantified Likert sub-scores), ranked by
// STANDARDIZED coefficient (β·σx/σy) so effects are comparable across scales.
// Linear (not logistic) on the continuous rating → no separation, so predicting
// overall satisfaction from its sub-scores is well-posed here.
function KeyDriversCard({ numFields, data, aliases }: { numFields: SchemaFieldConfig[]; data: Record<string, unknown>[]; aliases: Record<string, string> }) {
  var lbl = function(f: SchemaFieldConfig) { return aliases[f.field] || f.label || f.field }
  var num = function(v: unknown) { return parseFloat(String(v == null ? '' : v).replace(/,/g, '')) }
  var [target, setTarget] = useState('')
  useEffect(function() {
    if (target || !numFields.length) return
    var score = function(f: SchemaFieldConfig) {
      var s = (lbl(f) + ' ' + f.field).toLowerCase(); var sc = 0
      if (/overall/.test(s)) sc += 4
      if (/rating|satisf|csat/.test(s)) sc += 3
      if (/recommend|\bnps\b|loyalty|return/.test(s)) sc += 2
      if (/score/.test(s)) sc += 1
      return sc
    }
    var ranked = numFields.slice().sort(function(a, b) { return score(b) - score(a) })
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time auto-detect of the rating target on mount
    setTarget(ranked[0] && score(ranked[0]) > 0 ? ranked[0].field : numFields[0].field)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time default target
  }, [numFields])

  var model = useMemo(function() {
    if (!target) return null
    var preds = numFields.filter(function(f) { return f.field !== target })
    if (!preds.length) return null
    // Rank by each field's simple correlation with the target — robust to the
    // heavy multicollinearity among survey sub-scores (a joint OLS would go
    // singular). Each pair uses its own complete cases, so no single missing
    // sub-question shrinks the whole sample.
    var drivers = preds.map(function(p) {
      var xs: number[] = [], ys: number[] = []
      data.forEach(function(r) { var x = num(r[p.field]), y = num(r[target]); if (!isNaN(x) && !isNaN(y)) { xs.push(x); ys.push(y) } })
      if (xs.length < 10) return null
      var cr = pearsonR(xs, ys)
      if (isNaN(cr.r)) return null
      return { field: p.field, r: cr.r, p: cr.p, n: cr.n }
    }).filter(Boolean) as Array<{ field: string; r: number; p: number; n: number }>
    if (!drivers.length) return { few: true as const, n: 0, k: preds.length }
    drivers.sort(function(a, b) { return Math.abs(b.r) - Math.abs(a.r) })
    return { drivers: drivers, n: Math.max.apply(null, drivers.map(function(d) { return d.n })) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- num is a pure helper over these deps
  }, [target, numFields, data])

  if (numFields.length < 2) return null
  var tf = numFields.find(function(f) { return f.field === target })
  var fit = (model && 'drivers' in model ? model : null) as { drivers: Array<{ field: string; r: number; p: number; n: number }>; n: number } | null
  var few = (model && 'few' in model ? model : null) as { n: number; k: number } | null
  var maxR = fit && fit.drivers.length ? Math.max.apply(null, fit.drivers.map(function(d) { return Math.abs(d.r) })) : 1
  var summary = (function() {
    if (!fit) return ''
    var tName = tf ? lbl(tf) : 'the target'
    var sig = fit.drivers.filter(function(d) { return d.p < 0.05 })
    if (!sig.length) return 'No field tracks ' + tName + ' significantly in this data.'
    var pos = sig.filter(function(d) { return d.r > 0 }).slice(0, 2)
    var neg = sig.filter(function(d) { return d.r < 0 }).slice(0, 1)
    var parts: string[] = []
    if (pos.length) parts.push((pos.length > 1 ? 'the strongest are ' : 'the strongest is ') + pos.map(function(d) { return aliases[d.field] || d.field }).join(' and '))
    if (neg.length) parts.push((aliases[neg[0].field] || neg[0].field) + ' moves opposite (higher there → lower ' + tName + ')')
    return sig.length + ' of ' + fit.drivers.length + ' fields track ' + tName + ' significantly — ' + parts.join('; ') + '.'
  })()

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid ' + T.border, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: T.text }}>{'🎯'} Key drivers of</span>
        <select value={target} onChange={function(e) { setTarget(e.target.value) }}
          style={{ fontSize: 13, fontWeight: 700, padding: '4px 8px', border: '1px solid ' + T.border, borderRadius: 6, background: T.bgCard, color: T.accent, cursor: 'pointer' }}>
          {numFields.map(function(f) { return <option key={f.field} value={f.field}>{lbl(f)}</option> })}
        </select>
        {fit && <span style={{ fontSize: 11, color: T.textFaint, marginLeft: 'auto', fontFamily: 'monospace' }}>n={fit.n}</span>}
      </div>
      <div style={{ padding: '14px 16px' }}>
        {!model ? (
          <div style={{ fontSize: 13, color: T.textFaint }}>Pick a numeric target with at least one other numeric field.</div>
        ) : few ? (
          <div style={{ fontSize: 13, color: T.textFaint }}>Not enough paired data to correlate any field with this target — activate more numeric fields or map Likert scales to numbers in the Schema tab.</div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: T.textMid, marginBottom: 14, lineHeight: 1.6 }}>{summary}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {fit!.drivers.slice(0, 8).map(function(d) {
                var w = Math.round(Math.abs(d.r) / (maxR || 1) * 100)
                var pos = d.r >= 0, sig = d.p < 0.05
                return (
                  <div key={d.field} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 150, fontSize: 12, fontWeight: sig ? 700 : 400, color: sig ? T.text : T.textFaint, textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={aliases[d.field] || d.field}>{aliases[d.field] || d.field}</span>
                    <div style={{ flex: 1, height: 16, background: T.bg, borderRadius: 4, position: 'relative', overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: w + '%', background: sig ? (pos ? T.green : T.red) : T.border, opacity: sig ? 1 : 0.5, borderRadius: 4 }} />
                    </div>
                    <span style={{ width: 52, fontSize: 11, fontFamily: 'monospace', color: sig ? (pos ? T.green : T.red) : T.textFaint, textAlign: 'right', flexShrink: 0 }}>r{pos ? '+' : ''}{d.r.toFixed(2)}</span>
                  </div>
                )
              })}
            </div>
            <div style={{ fontSize: 10, color: T.textFaint, marginTop: 10 }}>Bars = strength of correlation with the target (Pearson r); green tracks together, red moves opposite. Grey = not significant (p {'≥'} 0.05). Correlation shows association, not proof of cause.</div>
          </>
        )}
      </div>
    </Card>
  )
}

function AutoInsightsPanel({ numFields, catFields, data, aliases }: { numFields: SchemaFieldConfig[]; catFields: SchemaFieldConfig[]; data: Record<string, unknown>[]; aliases: Record<string, string> }) {
  var [findings, setFindings] = useState<AutoFinding[] | null>(null)
  var [running, setRunning] = useState(false)
  var [aiReport, setAiReport] = useState<string | null>(null)
  var [aiLoading, setAiLoading] = useState(false)
  var [apiKey, setApiKey] = useState('')
  var [aiEnabled, setAiEnabled] = useState(false)
  var [summaryCopied, setSummaryCopied] = useState(false)

  useEffect(function() {
    try {
      var k = localStorage.getItem('sentimetrx_tm_apikey') || ''
      if (k) setApiKey(k)
      setAiEnabled(localStorage.getItem('sentimetrx_ai_enabled') === '1')
    } catch {}
    var iv = setInterval(function() {
      try { setAiEnabled(localStorage.getItem('sentimetrx_ai_enabled') === '1'); setApiKey(localStorage.getItem('sentimetrx_tm_apikey') || '') } catch {}
    }, 2000)
    return function() { clearInterval(iv) }
  }, [])

  var fLbl = function(f: string) { return aliases[f] || f }

  var runAnalysis = useCallback(function() {
    if (!data.length || !numFields.length) return
    setRunning(true); setAiReport(null)

    // Run analysis in chunked setTimeout batches to avoid freezing the UI
    setTimeout(function() {
      var fs: AutoFinding[] = []

      // ── 1. Pairwise Pearson correlations (chunked) ──────────────
      for (var i = 0; i < numFields.length; i++) {
        for (var j = i + 1; j < numFields.length; j++) {
          var fi = numFields[i].field, fj = numFields[j].field
          var vi = getNum(fi, data), vj = getNum(fj, data), nn = Math.min(vi.length, vj.length)
          if (nn < 10) continue
          var cr = pearsonR(vi.slice(0, nn), vj.slice(0, nn))
          if (isNaN(cr.r) || isNaN(cr.p) || cr.p >= 0.05 || Math.abs(cr.r) < 0.15) continue
          var strength = Math.abs(cr.r) > 0.7 ? 'strong' : Math.abs(cr.r) > 0.4 ? 'moderate' : 'weak'
          var dir = cr.r > 0 ? 'positive' : 'negative'
          fs.push({
            type: 'correlation',
            title: fLbl(fi) + ' \u2194 ' + fLbl(fj),
            detail: strength.charAt(0).toUpperCase() + strength.slice(1) + ' ' + dir + ' correlation — r\u202f=\u202f' + cr.r.toFixed(2) + ', n\u202f=\u202f' + cr.n,
            magnitude: Math.abs(cr.r),
            p: cr.p,
            effect: cr.r, effectLabel: 'r', n: cr.n,
            badge: strength + ' ' + dir,
            badgeColor: cr.r > 0 ? T.green : T.blue,
            badgeBg: cr.r > 0 ? T.greenBg : T.blueBg,
          })
        }
      }

      // ── 2. Group differences (categorical × numeric) ─────────────
      setTimeout(function() {
        catFields.forEach(function(cf) {
          numFields.forEach(function(nf) {
            var groups: Record<string, number[]> = {}
            data.forEach(function(r) {
              var v = parseFloat(String(r[nf.field] || '').replace(/,/g, '')); if (isNaN(v)) return
              var k = String(r[cf.field] ?? '(blank)').trim(); if (!k) return
              if (!groups[k]) groups[k] = []; groups[k].push(v)
            })
            var keys = Object.keys(groups).filter(function(k) { return groups[k].length >= 3 })
            if (keys.length < 2 || keys.length > 12) return

            var p: number, magnitude: number, detail: string
            var effVal = 0, effLbl = '', effN = 0, effSub = ''
            if (keys.length === 2) {
              var tr = welchTTest(groups[keys[0]], groups[keys[1]]); if (!tr) return
              p = tr.p; magnitude = Math.min(Math.abs(tr.d) * 0.3, 0.99)
              var hiK = tr.ma >= tr.mb ? keys[0] : keys[1], loK = tr.ma >= tr.mb ? keys[1] : keys[0]
              detail = fLbl(cf.field) + ' drives ' + fLbl(nf.field) + ' — ' + hiK + ' avg\u202f' + (tr.ma >= tr.mb ? tr.ma : tr.mb).toFixed(1) + ' vs ' + loK + ' avg\u202f' + (tr.ma >= tr.mb ? tr.mb : tr.ma).toFixed(1) + " (Cohen's d\u202f=\u202f" + tr.d.toFixed(2) + ')'
              effVal = tr.d; effLbl = 'd'
              effN = groups[keys[0]].length + groups[keys[1]].length
              effSub = hiK + ' ' + (tr.ma >= tr.mb ? tr.ma : tr.mb).toFixed(1) + ' vs ' + loK + ' ' + (tr.ma >= tr.mb ? tr.mb : tr.ma).toFixed(1)
            } else {
              var ar = oneWayANOVA(groups); if (!ar) return
              p = ar.p; magnitude = ar.eta2
              var sorted = keys.slice().sort(function(a, b) { return mean(groups[b]) - mean(groups[a]) })
              detail = fLbl(cf.field) + ' groups differ on ' + fLbl(nf.field) + ' — highest: ' + sorted[0] + ' (' + mean(groups[sorted[0]]).toFixed(1) + '), lowest: ' + sorted[sorted.length - 1] + ' (' + mean(groups[sorted[sorted.length - 1]]).toFixed(1) + '), \u03B7\u00B2\u202f=\u202f' + ar.eta2.toFixed(2)
              effVal = ar.eta2; effLbl = '\u03B7\u00B2'
              effN = keys.reduce(function(t, k) { return t + groups[k].length }, 0)
              effSub = 'highest ' + sorted[0] + ' (' + mean(groups[sorted[0]]).toFixed(1) + ') \u00B7 lowest ' + sorted[sorted.length - 1] + ' (' + mean(groups[sorted[sorted.length - 1]]).toFixed(1) + ')'
            }
            if (p >= 0.05) return
            var eff = magnitude > 0.14 ? 'large effect' : magnitude > 0.06 ? 'medium effect' : 'small effect'
            fs.push({
              type: 'group_effect',
              title: fLbl(cf.field) + ' \u2192 ' + fLbl(nf.field),
              detail: detail,
              magnitude: magnitude,
              p: p,
              effect: effVal, effectLabel: effLbl, n: effN, sub: effSub,
              badge: eff,
              badgeColor: magnitude > 0.14 ? T.accent : magnitude > 0.06 ? T.amber : T.textMid,
              badgeBg: magnitude > 0.14 ? T.accentBg : magnitude > 0.06 ? T.amberBg : T.bg,
            })
          })
        })

        // ── 3. Distribution flags (skew) ────────────────────────────
        setTimeout(function() {
          numFields.forEach(function(nf) {
            var vals = getNum(nf.field, data)
            if (vals.length < 20) return
            var sk = skewness(vals)
            if (Math.abs(sk) < 1.5) return
            var dir = sk > 0 ? 'right' : 'left'
            fs.push({
              type: 'distribution',
              title: fLbl(nf.field) + ' is heavily ' + dir + '-skewed',
              detail: (dir === 'right' ? 'Most values are low with a long tail upward' : 'Most values are high with a long tail downward') + ' — skewness\u202f=\u202f' + sk.toFixed(2) + '. Consider log-transforming before regression.',
              magnitude: Math.min(Math.abs(sk) / 6, 0.5),
              p: 1,
              effect: sk, effectLabel: 'skew', n: vals.length,
              sub: dir === 'right' ? 'long tail upward — consider log-transforming' : 'long tail downward — consider log-transforming',
              badge: dir + '-skewed',
              badgeColor: T.amber,
              badgeBg: T.amberBg,
            })
          })

          fs.sort(function(a, b) {
            var aScore = (a.type === 'distribution' ? 0 : 1) * 10 + a.magnitude
            var bScore = (b.type === 'distribution' ? 0 : 1) * 10 + b.magnitude
            return bScore - aScore
          })

          setFindings(fs)
          setRunning(false)
        }, 0)
      }, 0)
    }, 0)
  }, [data, numFields, catFields, aliases])

  // Auto-run when data loads
  useEffect(function() {
    if (data.length > 0 && numFields.length > 0 && findings === null) runAnalysis()
  }, [data.length, numFields.length])

  var generateNarrative = async function() {
    if (!findings || !findings.length || !apiKey || !aiEnabled) return
    setAiLoading(true); setAiReport(null)
    try {
      var top = findings.filter(function(f) { return f.type !== 'distribution' }).slice(0, 12)
      var lines = top.map(function(f, i) {
        return (i + 1) + '. [' + f.type + '] ' + f.title + ': ' + f.detail + ' (' + fmtP(f.p) + ')'
      }).join('\n')
      var prompt = 'You are a data analyst writing for a business audience. Below are statistically significant findings from a dataset.\n\nFindings:\n' + lines + '\n\nWrite a concise executive summary in 3-5 sentences. Lead with the most important relationship. Use plain English without jargon. End with one concrete recommendation.'
      var res = await fetch('/api/datasets/insights', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey, prompt: prompt }),
      })
      var d = await res.json()
      setAiReport(d.text || d.error || 'No response')
    } catch (e: unknown) { setAiReport('Error: ' + (e instanceof Error ? e.message : String(e))) }
    setAiLoading(false)
  }

  // ── Deterministic plain-English summary (no AI needed) — returns bullet array ─
  var buildSummary = function(fs: AutoFinding[]): string[] {
    if (!fs.length) return ['No statistically significant relationships were found in the current data.']
    var corrs = fs.filter(function(f) { return f.type === 'correlation' })
    var grps = fs.filter(function(f) { return f.type === 'group_effect' })
    var dists = fs.filter(function(f) { return f.type === 'distribution' })
    var bullets: string[] = []

    // Opening
    var total = corrs.length + grps.length
    bullets.push('The analysis found ' + (total === 1 ? 'one' : total) + ' statistically significant pattern' + (total !== 1 ? 's' : '') + ' in your data.')

    // Top correlations (up to 3)
    corrs.slice(0, 3).forEach(function(f, i) {
      var parts = f.title.split(' \u2194 ')
      var a = parts[0] || '', b = parts[1] || ''
      var rMatch = f.detail.match(/r\u202f=\u202f(-?[\d.]+)/)
      var r = rMatch ? parseFloat(rMatch[1]) : 0
      var strength = Math.abs(r) > 0.7 ? 'strongly' : Math.abs(r) > 0.4 ? 'moderately' : 'weakly'
      var direction = r > 0 ? 'higher ' + a + ' is associated with higher ' + b : 'higher ' + a + ' is associated with lower ' + b
      if (i === 0) bullets.push(a + ' and ' + b + ' are ' + strength + ' correlated (r\u202f=\u202f' + r.toFixed(2) + ') \u2014 ' + direction + '.')
      else bullets.push(a + ' and ' + b + ' show a ' + (Math.abs(r) > 0.4 ? 'meaningful' : 'weaker') + ' relationship (r\u202f=\u202f' + r.toFixed(2) + ').')
    })

    // Top group effects (up to 3)
    grps.slice(0, 3).forEach(function(f) {
      var parts = f.title.split(' \u2192 ')
      var cat = parts[0] || '', num = parts[1] || ''
      var effStr = f.magnitude > 0.14 ? 'a large difference' : f.magnitude > 0.06 ? 'a meaningful difference' : 'a small but significant difference'
      var hiMatch = f.detail.match(/highest:\s*([^,()]+)/)
      var loMatch = f.detail.match(/lowest:\s*([^,()]+)/)
      if (hiMatch && loMatch) {
        bullets.push(cat + ' is associated with ' + effStr + ' in ' + num + ' \u2014 ' + hiMatch[1].trim() + ' scores highest while ' + loMatch[1].trim() + ' scores lowest.')
      } else {
        bullets.push(cat + ' groups show ' + effStr + ' in ' + num + '.')
      }
    })

    // Distribution flags
    if (dists.length) {
      var distNames = dists.map(function(f) { return f.title.replace(' is heavily right-skewed', '').replace(' is heavily left-skewed', '') })
      bullets.push((dists.length === 1 ? distNames[0] + ' has' : distNames.slice(0, 2).join(' and ') + ' have') + ' a skewed distribution, which may affect regression results \u2014 consider log-transforming before modeling.')
    }

    if (corrs.length + grps.length > 6) bullets.push('Additional significant relationships exist \u2014 see the full findings list below.')

    return bullets
  }

  var typeLabel: Record<AutoFinding['type'], string> = { correlation: 'Correlation', group_effect: 'Group Effect', distribution: 'Distribution' }
  var typeIcon: Record<AutoFinding['type'], string> = { correlation: '\u2295', group_effect: '\u2297', distribution: '\u223F' }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: T.text, margin: '0 0 4px' }}>{'\u2726'} Auto-Insights</h2>
          <p style={{ fontSize: 13, color: T.textMid, margin: 0, lineHeight: 1.6 }}>Automatically scans all fields for significant correlations, group differences, and distribution anomalies.</p>
        </div>
        <button onClick={runAnalysis} disabled={running}
          style={{ flexShrink: 0, padding: '8px 18px', fontSize: 12, fontWeight: 700, background: T.bg, color: T.textMid, border: '1px solid ' + T.border, borderRadius: 20, cursor: running ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>
          {running ? 'Scanning\u2026' : '\u21BA Re-run'}
        </button>
      </div>

      {/* Key drivers — auto linear model of the rating on the other fields */}
      <KeyDriversCard numFields={numFields} data={data} aliases={aliases} />

      {/* AI status banner — shown at top always */}
      {!aiEnabled && (
        <div style={{ padding: '10px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#92400e', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{'\u26A0'}</span>{apiKey ? 'AI is turned off — enable it in the header to generate a narrative summary.' : 'Add an API key via the AI button in the header to unlock narrative summaries.'}
        </div>
      )}

      {/* Running spinner */}
      {running && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, padding: '48px 0' }}>
          <LottieLoader size={120} message={'Scanning ' + numFields.length + ' numeric \u00D7 ' + catFields.length + ' categorical fields\u2026'} />
        </div>
      )}

      {/* No findings */}
      {!running && findings !== null && findings.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: T.textFaint, fontSize: 13 }}>No significant relationships found (p &lt; 0.05) in the current data.</div>
      )}

      {/* Plain-English Summary (no AI required) */}
      {!running && findings !== null && (function() {
        var bullets = buildSummary(findings)
        var copySummary = function() {
          var text = bullets.map(function(b) { return '\u2022 ' + b }).join('\n')
          navigator.clipboard.writeText(text).then(function() {
            setSummaryCopied(true); setTimeout(function() { setSummaryCopied(false) }, 2000)
          }).catch(function() {})
        }
        return (
          <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 12, padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.07em' }}>Summary</div>
              <button onClick={copySummary}
                style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, border: '1px solid ' + T.border, background: summaryCopied ? T.greenBg : T.bg, color: summaryCopied ? T.green : T.textMid, cursor: 'pointer', transition: 'all .15s' }}>
                {summaryCopied ? '\u2713 Copied' : '\u29C9 Copy'}
              </button>
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {bullets.map(function(b, i) {
                return (
                  <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, color: T.textMid, lineHeight: 1.6 }}>
                    <span style={{ flexShrink: 0, width: 6, height: 6, borderRadius: '50%', background: T.accent, marginTop: 6 }} />
                    {b}
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })()}

      {/* Findings list */}
      {!running && findings !== null && findings.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.07em' }}>{findings.length} finding{findings.length !== 1 ? 's' : ''} — sorted by effect size</div>
          {/* Dense table, not stacked cards (2026-08-16). At 100+ findings the
              cards wasted ~80% of the vertical space, and the prose line
              repeated the badge and title while burying the effect size
              mid-sentence — so the "sorted by effect size" ordering was not
              scannable. Presentation only: nothing here changes what is
              computed, sorted or filtered. */}
          <div style={{ background: T.bgCard, border: '1px solid ' + T.border, borderRadius: 10, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr>
                {[
                  { h: '#', a: 'left' }, { h: 'Type', a: 'left' }, { h: 'Relationship', a: 'left' },
                  { h: 'Strength', a: 'left' }, { h: 'Effect', a: 'right' }, { h: 'Sig.', a: 'left' }, { h: 'n', a: 'right' },
                ].map(function(c) {
                  return <th key={c.h} style={{ padding: '7px 12px', textAlign: c.a as 'left' | 'right', fontSize: 10, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: T.textFaint, background: T.bg, borderBottom: '1px solid ' + T.border, whiteSpace: 'nowrap' }}>{c.h}</th>
                })}
              </tr></thead>
              <tbody>{findings.map(function(f, i) {
                return (
                  <tr key={i}>
                    <td style={{ padding: '8px 12px', color: T.textFaint, fontSize: 11, fontWeight: 700, borderBottom: '1px solid ' + T.border, verticalAlign: 'top' }}>{i + 1}</td>
                    <td style={{ padding: '8px 12px', color: T.textFaint, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid ' + T.border, whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                      {typeIcon[f.type]} {typeLabel[f.type]}
                    </td>
                    {/* Group-effect extra detail stays visible as a muted second
                        line rather than an expander — everything on screen. */}
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid ' + T.border, verticalAlign: 'top', minWidth: 220 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>{f.title}</div>
                      {f.sub && <div style={{ fontSize: 11, color: T.textFaint, marginTop: 2, lineHeight: 1.4 }}>{f.sub}</div>}
                    </td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid ' + T.border, verticalAlign: 'top' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: f.badgeBg, color: f.badgeColor, border: '1px solid ' + f.badgeColor + '44', whiteSpace: 'nowrap' }}>{f.badge}</span>
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: T.text, borderBottom: '1px solid ' + T.border, whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                      {f.effect == null ? '—' : (
                        <>{f.effect.toFixed(2)}<span style={{ color: T.textFaint, fontWeight: 400, fontSize: 10, marginLeft: 4 }}>{f.effectLabel}</span></>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid ' + T.border, verticalAlign: 'top' }}>{f.p < 1 ? <SigBadge p={f.p} /> : <span style={{ color: T.textFaint, fontSize: 11 }}>—</span>}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: T.textMid, borderBottom: '1px solid ' + T.border, verticalAlign: 'top' }}>{f.n == null ? '—' : f.n.toLocaleString()}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* AI Narrative */}
      {!running && findings !== null && findings.length > 0 && (
        <div style={{ borderTop: '1px solid ' + T.border, paddingTop: 18 }}>
          <div style={{ fontSize: 11, color: T.textFaint, marginBottom: 10 }}>Want a more polished narrative? Generate one with AI.</div>
          <button onClick={function() { void generateNarrative() }} disabled={aiLoading || !aiEnabled || !apiKey}
            style={{ padding: '10px 22px', fontSize: 13, fontWeight: 700, background: (!aiEnabled || !apiKey || aiLoading) ? T.bg : T.accent, color: (!aiEnabled || !apiKey || aiLoading) ? T.textFaint : 'white', border: 'none', borderRadius: 10, cursor: (!aiEnabled || !apiKey || aiLoading) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
            {aiLoading ? <><LottieLoader size={18} /> Writing summary&hellip;</> : '\u2726 Generate Narrative Summary'}
          </button>
          {aiReport && (
            <div style={{ marginTop: 14, background: T.accentBg, border: '1px solid ' + T.accentMid, borderRadius: 12, padding: '18px 20px' }}>
              <div style={{ fontSize: 13, color: T.textMid, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{aiReport}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Outlier Analysis Panel ───────────────────────────────────────────────────

interface OutlierRow {
  key: string; n: number; grpMean: number; grpStd: number
  delta: number; pct: number; p: number; d: number
  isOutlier: boolean; direction: 'positive' | 'negative'
}

function OutlierAnalysisPanel({ numFields, catFields, data, datasetId }: {
  numFields: SchemaFieldConfig[]; catFields: SchemaFieldConfig[]; data: Record<string, unknown>[]; datasetId: string
}) {
  var _ok = 'statsOutlier_' + datasetId
  var [quantField, setQuantField]       = useState(numFields[0]?.field || '')
  var [catField,   setCatField]         = useState(catFields[0]?.field  || '')
  var [showAll,    setShowAll]          = useState(false)
  var [threshold,  setThreshold]        = useState(0.05)
  var [copied,     setCopied]           = useState(false)
  var [outlierRestored, setOutlierRestored] = useState(false)
  useEffect(function() {
    var saved = readSession<{ quantField?: string; catField?: string; showAll?: boolean; threshold?: number }>(_ok)
    if (saved?.quantField) setQuantField(saved.quantField)
    if (saved?.catField)   setCatField(saved.catField)
    if (typeof saved?.showAll === 'boolean') setShowAll(saved.showAll)
    if (typeof saved?.threshold === 'number') setThreshold(saved.threshold)
    setOutlierRestored(true)
  }, [_ok])
  var [outlierDragOver, setOutlierDragOver] = useState(false)
  var [apiKey, setApiKey] = useState('')
  var [aiEnabled, setAiEnabled] = useState(false)
  var [aiLoading, setAiLoading] = useState(false)
  var [aiReport, setAiReport] = useState<string | null>(null)

  useEffect(function() {
    if (!outlierRestored) return
    writeSession(_ok, { quantField: quantField, catField: catField, showAll: showAll, threshold: threshold })
  }, [outlierRestored, quantField, catField, showAll, threshold, _ok])
  useEffect(function() { if (!quantField && numFields.length) setQuantField(numFields[0].field) }, [numFields.length])
  useEffect(function() { if (!catField   && catFields.length)  setCatField(catFields[0].field)   }, [catFields.length])

  useEffect(function() {
    try {
      var k = localStorage.getItem('sentimetrx_tm_apikey') || ''
      if (k) setApiKey(k)
      setAiEnabled(localStorage.getItem('sentimetrx_ai_enabled') === '1')
    } catch {}
    var iv = setInterval(function() {
      try { setAiEnabled(localStorage.getItem('sentimetrx_ai_enabled') === '1'); setApiKey(localStorage.getItem('sentimetrx_tm_apikey') || '') } catch {}
    }, 2000)
    return function() { clearInterval(iv) }
  }, [])

  // Reset stale AI report when the user changes which fields they're analyzing
  useEffect(function() { setAiReport(null) }, [quantField, catField, threshold])

  var generateOutlierNarrative = async function() {
    if (!results || !apiKey || !aiEnabled) return
    var snap = results
    setAiLoading(true); setAiReport(null)
    try {
      var qLabel = numFields.find(function(f) { return f.field === quantField })?.label || quantField
      var cLabel = catFields.find(function(f) { return f.field === catField })?.label || catField
      var outliers = snap.rows.filter(function(r) { return r.isOutlier })
      var topLines = outliers.slice(0, 15).map(function(r) {
        var dir = r.direction === 'positive' ? 'HIGH' : 'LOW'
        return '- ' + r.key + ' (n=' + r.n + '): ' + dir + ', mean=' + fmt2(r.grpMean) + ' vs overall ' + fmt2(snap.overallMean) + ' (Δ=' + (r.delta >= 0 ? '+' : '') + fmt2(r.delta) + ', ' + (r.pct >= 0 ? '+' : '') + r.pct.toFixed(1) + '%, ' + fmtP(r.p) + ')'
      }).join('\n')
      var prompt = 'You are a data analyst writing for a business audience. Below are groups whose ' + qLabel + ' is statistically above or below the overall mean (broken down by ' + cLabel + '). Threshold: p < ' + threshold + '. N = ' + snap.totalN.toLocaleString() + '.\n\nOutlier groups:\n' + topLines + '\n\nWrite a concise executive summary in 3-5 sentences. Lead with the most extreme outlier. Use plain English without jargon. End with one concrete recommendation.'
      var res = await fetch('/api/datasets/insights', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey, prompt: prompt }),
      })
      var d = await res.json()
      setAiReport(d.text || d.error || 'No response')
    } catch (e: unknown) { setAiReport('Error: ' + (e instanceof Error ? e.message : String(e))) }
    setAiLoading(false)
  }

  var results = useMemo(function() {
    if (!quantField || !catField || !data.length) return null

    var groups: Record<string, number[]> = {}
    data.forEach(function(row) {
      var cat = String(row[catField] ?? '').trim()
      if (!cat) return
      var num = getNum(quantField, [row])
      if (!num.length) return
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(num[0])
    })

    var groupKeys = Object.keys(groups).filter(function(k) { return groups[k].length >= 3 })
    if (groupKeys.length < 2) return null

    var allVals = groupKeys.flatMap(function(k) { return groups[k] })
    var overallMean = mean(allVals)

    var rows: OutlierRow[] = groupKeys.map(function(key) {
      var vals = groups[key]
      var grpMean = mean(vals)
      var grpStd  = std(vals)
      var otherVals = groupKeys.filter(function(k) { return k !== key }).flatMap(function(k) { return groups[k] })
      var test = welchTTest(vals, otherVals)
      var delta = grpMean - overallMean
      var pct   = overallMean !== 0 ? (delta / Math.abs(overallMean)) * 100 : 0
      return {
        key, n: vals.length, grpMean, grpStd,
        delta, pct,
        p:   test ? test.p : 1,
        d:   test ? Math.abs(test.d) : 0,
        isOutlier: !!(test && test.p < threshold),
        direction: delta >= 0 ? 'positive' : 'negative',
      }
    })

    rows.sort(function(a, b) { return b.grpMean - a.grpMean })

    var outlierCount = rows.filter(function(r) { return r.isOutlier }).length
    return { rows, overallMean, totalN: allVals.length, outlierCount }
  }, [quantField, catField, data, threshold])

  var displayed = results
    ? (showAll ? results.rows : results.rows.filter(function(r) { return r.isOutlier }))
    : []

  function handleCopy() {
    if (!results) return
    var qLabel = numFields.find(function(f) { return f.field === quantField })?.label || quantField
    var cLabel = catFields.find(function(f) { return f.field === catField  })?.label || catField
    var header = 'Outlier Analysis\n' + qLabel + ' by ' + cLabel + '\nOverall mean: ' + fmt2(results.overallMean) + '  |  N = ' + results.totalN + '\nThreshold: p < ' + threshold + '\n\n'
    var colH = 'Group'.padEnd(30) + 'N'.padStart(6) + 'Mean'.padStart(10) + 'vs Avg'.padStart(10) + '%'.padStart(8) + 'p-value'.padStart(10) + '  Flag\n'
    var sep  = '-'.repeat(76) + '\n'
    var body = (showAll ? results.rows : results.rows.filter(function(r) { return r.isOutlier }))
      .map(function(r) {
        var flag = r.isOutlier ? (r.direction === 'positive' ? '▲ HIGH' : '▼ LOW') : ''
        return r.key.slice(0, 29).padEnd(30)
          + String(r.n).padStart(6)
          + fmt2(r.grpMean).padStart(10)
          + (r.delta >= 0 ? '+' : '') + fmt2(r.delta).padStart(9)
          + (r.pct   >= 0 ? '+' : '') + r.pct.toFixed(1).padStart(6) + '%'
          + fmtP(r.p).padStart(10)
          + '  ' + flag
      }).join('\n')
    void navigator.clipboard.writeText(header + colH + sep + body).then(function() {
      setCopied(true); setTimeout(function() { setCopied(false) }, 2000)
    })
  }

  var qOpts = numFields.map(function(f) { return { v: f.field, l: f.label || f.field, s: f.section || 'core' } })
  var cOpts = catFields.map(function(f) { return { v: f.field, l: f.label || f.field, s: f.section || 'core' } })

  var handleOutlierDrop = function(e: React.DragEvent) {
    e.preventDefault(); setOutlierDragOver(false)
    try {
      var payload = JSON.parse(e.dataTransfer.getData('text/field'))
      if (payload.type === 'numeric' && numFields.some(function(f) { return f.field === payload.field })) setQuantField(payload.field)
      else if (payload.type === 'categorical' && catFields.some(function(f) { return f.field === payload.field })) setCatField(payload.field)
    } catch {}
    _statsDrag = null
  }

  return (
    <div
      onDragOver={function(e) { e.preventDefault(); if (!outlierDragOver) setOutlierDragOver(true) }}
      onDragLeave={function(e) { var rt = e.relatedTarget as Node | null; if (!rt || !e.currentTarget.contains(rt)) setOutlierDragOver(false) }}
      onDrop={handleOutlierDrop}
    >
      {outlierDragOver && _statsDrag && (function() {
        var drag = _statsDrag!
        var canAccept = (drag.type === 'numeric' && numFields.some(function(f) { return f.field === drag.field }))
                     || (drag.type === 'categorical' && catFields.some(function(f) { return f.field === drag.field }))
        var slotName = drag.type === 'numeric' ? 'Quantitative Variable' : 'Group By'
        return (
          <div style={{ marginBottom: 14, padding: '8px 14px', background: canAccept ? T.accentBg : '#fef2f2', border: '1.5px dashed ' + (canAccept ? T.accent : '#fca5a5'), borderRadius: 8, fontSize: 12, color: canAccept ? T.accent : '#991b1b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15 }}>{canAccept ? '↓' : '✕'}</span>
            <span>{canAccept ? <><strong>{drag.label}</strong> → <strong>{slotName}</strong> — release to assign</> : <>No slot accepts <strong>{drag.type}</strong> fields here</>}</span>
          </div>
        )
      })()}
      <PanelHeader icon={'\u25CE'} title="Outlier Analysis" desc="Identify groups that are statistically above or below the overall mean." />

      {/* Controls */}
      <Card style={{ padding: '14px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <DSSelect label='Quantitative Variable' value={quantField} onChange={setQuantField} options={qOpts} />
          <DSSelect label='Group By'              value={catField}   onChange={setCatField}   options={cOpts} />
          <div style={{ flex: '0 0 auto' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textFaint, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 5 }}>Threshold</div>
            <select value={threshold} onChange={function(e) { setThreshold(parseFloat(e.target.value)) }}
              style={{ padding: '7px 10px', fontSize: 13, border: '1px solid ' + T.border, borderRadius: 7, background: T.bgCard, color: T.text, outline: 'none', cursor: 'pointer' }}>
              <option value={0.1}>p &lt; 0.10</option>
              <option value={0.05}>p &lt; 0.05</option>
              <option value={0.01}>p &lt; 0.01</option>
              <option value={0.001}>p &lt; 0.001</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Results */}
      {!results ? (
        <StatsEmpty icon='\u25CE' msg='Select a numeric and a categorical field' sub='Groups with fewer than 3 responses are excluded.' />
      ) : displayed.length === 0 && !showAll ? (
        <Card style={{ padding: '40px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.textMid, marginBottom: 6 }}>No significant outliers at p &lt; {threshold}</div>
          <div style={{ fontSize: 13, color: T.textMute, marginBottom: 16 }}>All groups are statistically similar to the overall mean at this threshold.</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={function() { setShowAll(true) }} style={{ padding: '7px 18px', fontSize: 13, fontWeight: 600, border: '1px solid ' + T.accent, borderRadius: 8, background: T.accentBg, color: T.accent, cursor: 'pointer' }}>
              View all groups
            </button>
            <span style={{ fontSize: 12, color: T.textMute, alignSelf: 'center' }}>or try a looser threshold (0.10) above</span>
          </div>
        </Card>
      ) : (
        <Card>
          {/* Table header */}
          <div style={{ padding: '10px 16px', borderBottom: '1px solid ' + T.border, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, color: T.textMute }}>
                Overall mean: <strong style={{ color: T.text }}>{fmt2(results.overallMean)}</strong>
                <span style={{ margin: '0 8px', color: T.border }}>|</span>
                N = <strong style={{ color: T.text }}>{results.totalN.toLocaleString()}</strong>
                <span style={{ margin: '0 8px', color: T.border }}>|</span>
                {results.outlierCount} outlier{results.outlierCount !== 1 ? 's' : ''} found
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: T.textMid, cursor: 'pointer', userSelect: 'none' }}>
                <input type='checkbox' checked={showAll} onChange={function(e) { setShowAll(e.target.checked) }} style={{ accentColor: T.accent }} />
                Show all groups
              </label>
              <button onClick={handleCopy}
                style={{ padding: '5px 12px', fontSize: 11, fontWeight: 700, border: '1px solid ' + (copied ? T.green : T.border), borderRadius: 7, background: copied ? T.greenBg : T.bg, color: copied ? T.green : T.textMid, cursor: 'pointer', transition: 'all .15s' }}>
                {copied ? '\u2713 Copied' : '\uD83D\uDCCB Copy'}
              </button>
            </div>
          </div>

          {/* Column headers */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 56px 90px 90px 72px 80px', gap: 0, padding: '7px 16px', background: T.bg, borderBottom: '1px solid ' + T.border, fontSize: 10, fontWeight: 700, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.06em' }}>
            <div>Group</div>
            <div style={{ textAlign: 'right' }}>N</div>
            <div style={{ textAlign: 'right' }}>Mean</div>
            <div style={{ textAlign: 'right' }}>vs Avg</div>
            <div style={{ textAlign: 'right' }}>p-value</div>
            <div style={{ textAlign: 'center' }}>Status</div>
          </div>

          {/* Rows */}
          {displayed.map(function(r, i) {
            var isPos = r.direction === 'positive'
            var rowBg = !r.isOutlier ? 'transparent'
              : isPos ? 'rgba(22,163,74,.06)' : 'rgba(220,38,38,.05)'
            var flagColor = isPos ? T.green : T.red
            var flagBg    = isPos ? T.greenBg : T.redBg
            var flagBorder= isPos ? T.greenMid : '#fecaca'
            return (
              <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '1fr 56px 90px 90px 72px 80px', gap: 0, padding: '9px 16px', background: rowBg, borderBottom: i < displayed.length - 1 ? '1px solid ' + T.border : 'none', alignItems: 'center', transition: 'background .1s' }}>
                {/* Group name */}
                <div style={{ fontSize: 13, fontWeight: r.isOutlier ? 700 : 400, color: r.isOutlier ? (isPos ? T.green : T.red) : T.textMid, wordBreak: 'break-word', paddingRight: 8 }}>{r.key}</div>
                {/* N */}
                <div style={{ textAlign: 'right', fontSize: 12, color: T.textMute, fontFamily: 'monospace' }}>{r.n}</div>
                {/* Mean */}
                <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: T.text, fontFamily: 'monospace' }}>{fmt2(r.grpMean)}</div>
                {/* Delta */}
                <div style={{ textAlign: 'right', fontSize: 12, fontFamily: 'monospace', color: r.delta > 0 ? T.green : r.delta < 0 ? T.red : T.textMute }}>
                  {r.delta >= 0 ? '+' : ''}{fmt2(r.delta)}
                  <span style={{ fontSize: 10, color: T.textFaint, marginLeft: 2 }}>({r.pct >= 0 ? '+' : ''}{r.pct.toFixed(1)}%)</span>
                </div>
                {/* p-value */}
                <div style={{ textAlign: 'right' }}>
                  <SigBadge p={r.p} />
                </div>
                {/* Status badge */}
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  {r.isOutlier ? (
                    <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 20, background: flagBg, color: flagColor, border: '1px solid ' + flagBorder, whiteSpace: 'nowrap' }}>
                      {isPos ? '\u25B2 HIGH' : '\u25BC LOW'}
                    </span>
                  ) : (
                    <span style={{ fontSize: 10, color: T.textFaint }}>—</span>
                  )}
                </div>
              </div>
            )
          })}
        </Card>
      )}

      {/* AI Summary — only shown when there are real results to summarize */}
      {results && results.outlierCount > 0 && (
        <div style={{ borderTop: '1px solid ' + T.border, paddingTop: 14 }}>
          {!aiEnabled && (
            <div style={{ padding: '10px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#92400e', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span>{'⚠'}</span>{apiKey ? 'AI is turned off — enable it in the header to summarize outliers.' : 'Add an API key via the AI button in the header to enable summaries.'}
            </div>
          )}
          <button onClick={function() { void generateOutlierNarrative() }} disabled={aiLoading || !aiEnabled || !apiKey}
            style={{ padding: '10px 22px', fontSize: 13, fontWeight: 700, background: (!aiEnabled || !apiKey || aiLoading) ? T.bg : T.accent, color: (!aiEnabled || !apiKey || aiLoading) ? T.textFaint : 'white', border: 'none', borderRadius: 10, cursor: (!aiEnabled || !apiKey || aiLoading) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
            {aiLoading ? <><LottieLoader size={18} /> Summarizing&hellip;</> : '✦ Summarize Outliers'}
          </button>
          {aiReport && (
            <div style={{ marginTop: 14, background: T.accentBg, border: '1px solid ' + T.accentMid, borderRadius: 12, padding: '18px 20px' }}>
              <div style={{ fontSize: 13, color: T.textMid, lineHeight: 1.8, whiteSpace: 'pre-wrap' as const }}>{aiReport}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN STATS MODULE — left sidebar (fields), right sidebar (analysis types)
// ═══════════════════════════════════════════════════════════════════════════════

var ANALYSIS_TYPES = [
  { id: 'descriptives', label: 'Descriptives', icon: '\u2211', color: '#e8622a', tip: 'Summary statistics and distributions.' },
  { id: 'correlations', label: 'Correlations', icon: '\u2295', color: '#2563eb', tip: 'Relationships between numeric variables.' },
  { id: 'grouptests', label: 'Group Tests', icon: '\u2297', color: '#16a34a', tip: 't-test, ANOVA, Mann-Whitney, Chi-square.' },
  { id: 'regression', label: 'Regression', icon: '\u27CB', color: '#7c3aed', tip: 'Linear (OLS) & logistic regression.' },
  { id: 'insights', label: '\u2726 Auto-Insights', icon: '\u2726', color: '#e8622a', tip: 'Auto-scan for significant correlations, group effects, and distribution flags.' },
  { id: 'outliers', label: 'Outlier Analysis', icon: '\u25CE', color: '#0891b2', tip: 'Flag groups that are statistically above or below the overall mean.' },
]

function fl(f: SchemaFieldConfig): string { return f.label && f.label !== f.field ? f.label : f.field }

// ── Collapsible sidebar field group ────────────────────────────
function CollapsibleGroup({ label, icon, color, fields, T, fl: flFn, defaultOpen, diag }: {
  label: string; icon: string; color: string; fields: SchemaFieldConfig[]; T: ThemeT; fl: (f: SchemaFieldConfig) => string; defaultOpen?: boolean; diag?: Record<string, string>
}) {
  var [open, setOpen] = useState(defaultOpen !== false)
  if (fields.length === 0) return null
  var goodFields = fields.filter(function(f) { return !diag || !diag[f.field] })
  var weakFields = fields.filter(function(f) { return diag && diag[f.field] })
  return (
    <div style={{ borderBottom: '1px solid ' + T.border }}>
      <button
        onClick={function() { setOpen(function(v) { return !v }) }}
        style={{ width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <div style={{ fontSize: 10, fontWeight: 700, color: color, letterSpacing: '.07em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>{icon}</span> {label}
        </div>
        <span style={{ fontSize: 10, color: T.textFaint, display: 'flex', alignItems: 'center', gap: 4 }}>
          {weakFields.length > 0 && <span style={{ color: T.textFaint, opacity: 0.6 }}>{weakFields.length} weak</span>}
          {open ? '\u25BE' : '\u25B8'} {fields.length}
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 12px 8px' }}>
          {goodFields.map(function(f) {
            var dual = isDualPurposeCfg(f)
            return (
              <div key={f.field}
                draggable={true}
                onDragStart={function(e) {
                  _statsDrag = { field: f.field, type: f.type, label: flFn(f), dual: dual }
                  e.dataTransfer.setData('text/field', JSON.stringify({ field: f.field, type: f.type, label: flFn(f), section: f.section || 'core', dual: dual }))
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onDragEnd={function() { _statsDrag = null }}
                style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, color: T.textMid, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 1, cursor: 'grab', userSelect: 'none' }}
                title={dual ? 'Dual-purpose scale — category, or a numeric score in a numeric slot' : flFn(f)}>
                {flFn(f)}
                {dual && <span style={{ marginLeft: 5, fontSize: 8, fontWeight: 700, color: '#7c3aed', border: '1px solid #7c3aed55', borderRadius: 3, padding: '0 3px', letterSpacing: '.03em', verticalAlign: 'middle' }}>{'#/≡'}</span>}
              </div>
            )
          })}
          {weakFields.length > 0 && goodFields.length > 0 && (
            <div style={{ height: 1, background: T.border, margin: '4px 0 5px' }} />
          )}
          {weakFields.map(function(f) {
            var reason = diag![f.field]
            return (
              <div key={f.field} title={reason}
                style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, color: T.textFaint, fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 1, opacity: 0.55, fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ flexShrink: 0, fontSize: 9 }}>⚠</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{flFn(f)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FieldSidebarGroups({ fields, T, fl: flFn, isAssigned, diag }: {
  fields: SchemaFieldConfig[]; T: ThemeT; fl: (f: SchemaFieldConfig) => string; isAssigned?: (f: SchemaFieldConfig) => boolean; diag?: Record<string, string>
}) {
  var psychoFields = fields.filter(function(f) { return f.section === 'psychographic' })
  var demoFields = fields.filter(function(f) { return f.section === 'demographic' })
  var customFields = fields.filter(function(f) { return f.section === 'custom' })
  var urlParamFields = fields.filter(function(f) { return f.section === 'url_param' })
  var coreFields = fields.filter(function(f) { return !f.section || f.section === 'core' })

  var numFields = coreFields.filter(function(f) { return f.type === 'numeric' })
  var catFields = coreFields.filter(function(f) { return f.type === 'categorical' })
  var dateFields = coreFields.filter(function(f) { return f.type === 'date' })
  var openFields = coreFields.filter(function(f) { return f.type === 'open-ended' })

  return (
    <>
      <CollapsibleGroup label="Numeric" icon="#" color="#16a34a" fields={numFields} T={T} fl={flFn} diag={diag} />
      <CollapsibleGroup label="Categorical" icon={'\u2261'} color="#7c3aed" fields={catFields} T={T} fl={flFn} diag={diag} />
      <CollapsibleGroup label="Open-ended" icon={'\u2756'} color="#2563eb" fields={openFields} T={T} fl={flFn} />
      <CollapsibleGroup label="Date" icon={'\uD83D\uDCC5'} color="#d97706" fields={dateFields} T={T} fl={flFn} />
      <CollapsibleGroup label="Survey Questions" icon={'\uD83D\uDCCB'} color="#f59e0b" fields={customFields} T={T} fl={flFn} diag={diag} />
      <CollapsibleGroup label="Psychographic" icon={'\uD83E\uDDE0'} color="#ec4899" fields={psychoFields} T={T} fl={flFn} diag={diag} />
      <CollapsibleGroup label="Demographic" icon={'\uD83D\uDC64'} color="#0891b2" fields={demoFields} T={T} fl={flFn} diag={diag} />
      <CollapsibleGroup label="URL Parameters" icon={'\uD83D\uDD17'} color="#6366f1" fields={urlParamFields} T={T} fl={flFn} diag={diag} />
    </>
  )
}

export default function StatsModule({ datasetId, schema, themeModel, datasetSource, taxonomyEnabled }: Props) {
  // Defaults-only init for SSR-safety; restore from sessionStorage post-mount.
  var _statKey = 'stats_' + datasetId

  var [activePanel, setActivePanel] = useState('descriptives')
  var [hovered, setHovered] = useState<string | null>(null)
  var [validityOpen, setValidityOpen] = useState(false)
  var [confidenceLevel, setConfidenceLevel] = useState(99.5)
  var [pendingCap, setPendingCap] = useState(385)
  var [pendingConfidence, setPendingConfidence] = useState(99.5)
  var shared = useRows()
  var { effectiveFilters: filters } = useFilters()

  var STATS_HARD_CAP = 5000
  var [sampleCap, setSampleCap] = useState(2000)
  var [statsRestored, setStatsRestored] = useState(false)

  useEffect(function() {
    var saved = readSession<{ activePanel?: string; confidenceLevel?: number; sampleCap?: number }>(_statKey)
    if (saved?.activePanel) setActivePanel(saved.activePanel)
    if (typeof saved?.confidenceLevel === 'number') {
      setConfidenceLevel(saved.confidenceLevel)
      setPendingConfidence(saved.confidenceLevel)
    }
    if (typeof saved?.sampleCap === 'number') {
      setSampleCap(saved.sampleCap)
      setPendingCap(saved.sampleCap)
    }
    setStatsRestored(true)
  }, [_statKey])

  useEffect(function() {
    if (!statsRestored) return
    writeSession(_statKey, { activePanel: activePanel, confidenceLevel: confidenceLevel, sampleCap: sampleCap })
  }, [statsRestored, activePanel, confidenceLevel, sampleCap, _statKey])

  // Trigger shared row fetch on mount
  useEffect(function() { shared.fetchRows() }, [])

  // Subsample from shared rows based on sampleCap
  var rows = useMemo(function() {
    if (!shared.rowsLoaded) return []
    var effectiveCap = sampleCap === 0 ? STATS_HARD_CAP : sampleCap
    if (shared.rows.length <= effectiveCap) return shared.rows
    // Fisher-Yates subsample
    var copy = shared.rows.slice()
    for (var i = copy.length - 1; i > 0 && i >= copy.length - effectiveCap; i--) {
      var j = Math.floor(Math.random() * (i + 1))
      var tmp = copy[i]; copy[i] = copy[j]; copy[j] = tmp
    }
    return copy.slice(copy.length - effectiveCap)
  }, [shared.rows, shared.rowsLoaded, sampleCap])
  var rowsLoaded = shared.rowsLoaded
  var rowsLoading = shared.rowsLoading
  var samplingMeta = shared.rowsLoaded ? { sampled: shared.sampled || rows.length < shared.rows.length, sampleSize: rows.length, totalRows: shared.totalRows } : null

  // MC state
  var [mcResults, setMcResults] = useState<Record<string, MCResult>>({})
  var [mcRunning, setMcRunning] = useState(false)

  var allSchemaFields = useMemo(function() {
    return schema.fields.filter(function(f) { return f.type !== 'ignore' && f.type !== 'id' && f.hidden !== true })
  }, [schema.fields])

  var schemaOpenFields = useMemo(function() { return schema.fields.filter(function(f) { return f.type === 'open-ended' }) }, [schema.fields])
  var _stk = 'statsTheme_' + datasetId
  var [themeSourceField, setThemeSourceField] = useState(function() { return (themeModel && themeModel.fieldName) || schema.fields.find(function(f) { return f.type === 'open-ended' })?.field || '' })
  var [activeThemeNames, setActiveThemeNames] = useState<Set<string> | null>(null)
  var [themeEnrichKey, setThemeEnrichKey] = useState(0)
  var [statsThemeRestored, setStatsThemeRestored] = useState(false)
  useEffect(function() {
    var saved = readSession<{ themeSourceField?: string; activeThemeNames?: string[] }>(_stk)
    if (saved?.themeSourceField) setThemeSourceField(saved.themeSourceField)
    if (Array.isArray(saved?.activeThemeNames)) setActiveThemeNames(new Set(saved.activeThemeNames))
    setStatsThemeRestored(true)
  }, [_stk])
  useEffect(function() {
    if (!statsThemeRestored) return
    writeSession(_stk, { themeSourceField: themeSourceField, activeThemeNames: activeThemeNames ? Array.from(activeThemeNames) : null })
  }, [statsThemeRestored, themeSourceField, activeThemeNames, _stk])

  // Per-question theme sets (2026-07-12): the source-verbatim picker doesn't
  // just re-target the ACTIVE set's keywords — a question with its OWN stored
  // set (theme_model.fields) computes with THAT set. Fallback for a
  // never-mined field = the active set matched against it (pre-map behavior).
  // MUST be memoized: themeSetForField returns a FRESH object every call
  // (stripFieldEntries spreads), and this value feeds the enrichedData memo,
  // whose identity feeds the bootstrap-CI effect. Unmemoized, every render
  // invalidated the chain → setMcResults → render → … an infinite update loop
  // that wedged the Statistics tab (soft navigations off /stats never committed;
  // caught by the e2e smoke suite). Do NOT inline this — see git 2a9782ea.
  var effectiveThemeModel = useMemo(function() {
    return themeSourceField
      ? (themeSetForField(themeModel, [themeSourceField]) || themeModel)
      : themeModel
  }, [themeModel, themeSourceField])
  var hasThemes = !!(effectiveThemeModel && effectiveThemeModel.themes && effectiveThemeModel.themes.length > 0)

  var filteredData = useMemo(function() {
    return applyFilters(rows, filters)
  }, [rows, filters])

  // Filtered row-id set for the server dimension tests (GroupTestsPanel posts
  // tax_crosstab/tax_group_stats to /aggregate). Mirrors ChartsModule exactly:
  // derived from the FULL loaded sample (shared.rows, up to 50K) — NOT the
  // stats subsample — and ONLY when filters are active (else null = whole
  // dataset, the pre-fix behavior). Without this the Stats-tab dimension
  // t-test/ANOVA/chi-square ran over the entire dataset while the sibling
  // Charts tab filtered the same RPCs (perf review §7 Brief F, class-d drop).
  var dimFilteredRowIds = useMemo(function() {
    if (!Object.keys(filters || {}).length || !shared.rowsLoaded) return null
    return applyFilters(shared.rows, filters)
      .map(function(r) { return (r as { _rowId?: number })._rowId })
      .filter(function(v): v is number { return typeof v === 'number' })
  }, [shared.rows, shared.rowsLoaded, filters])

  // Inject __themes__ and remapped-numeric columns — memoised so stable refs don't re-trigger effects
  var enrichedData = useMemo(function() {
    var mappedFields = allSchemaFields.filter(function(f) { return f.type === 'categorical' && f.remapping && Object.keys(f.remapping).length > 0 })
    if (!hasThemes && mappedFields.length === 0) return filteredData
    if (filteredData.length === 0) return filteredData
    var openField = hasThemes ? (themeSourceField || effectiveThemeModel!.fieldName || allSchemaFields.find(function(f) { return f.type === 'open-ended' })?.field || '') : ''
    var activeThemes = hasThemes ? (activeThemeNames ? effectiveThemeModel!.themes.filter(function(t: { name?: string; label?: string }) { return (activeThemeNames as Set<string>).has(t.name || t.label || '') }) : effectiveThemeModel!.themes) : []
    return filteredData.map(function(row) {
      var enriched = Object.assign({}, row)
      if (hasThemes && openField) {
        var text = String(row[openField] || '').toLowerCase()
        if (!text.trim()) {
          enriched['__themes__'] = ''
        } else {
          var bestTheme = '', bestCount = 0
          activeThemes.forEach(function(t: Theme) {
            var hits = 0
            ;(t.keywords || []).forEach(function(kw: string) {
              if (text.includes(kw.toLowerCase())) hits++
            })
            if (hits > bestCount) { bestCount = hits; bestTheme = t.name }
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
  }, [filteredData, hasThemes, allSchemaFields, effectiveThemeModel, themeSourceField, activeThemeNames, themeEnrichKey])

  var mappedFields = useMemo(function() {
    return allSchemaFields.filter(function(f) { return f.type === 'categorical' && f.remapping && Object.keys(f.remapping).length > 0 })
  }, [allSchemaFields])

  var allFields = useMemo(function() {
    var af = allSchemaFields.slice()
    if (hasThemes) af = af.concat([{ field: '__themes__', type: 'categorical', label: 'Themes' } as SchemaFieldConfig])
    mappedFields.forEach(function(f) {
      af = af.concat([{ field: '__mapped_' + f.field + '__', type: 'numeric', label: (f.label || f.field) + ' (score)' } as SchemaFieldConfig])
    })
    return af
  }, [allSchemaFields, hasThemes, mappedFields])

  var asc = useCallback(function(a: SchemaFieldConfig, b: SchemaFieldConfig) { return fl(a).localeCompare(fl(b)) }, [])
  var numFields  = useMemo(function() { return allFields.filter(function(f) { return f.type === 'numeric' }).sort(asc) }, [allFields, asc])
  var catFields  = useMemo(function() { return allFields.filter(function(f) { return f.type === 'categorical' }).sort(asc) }, [allFields, asc])
  var dateFields = useMemo(function() { return allFields.filter(function(f) { return f.type === 'date' }).sort(asc) }, [allFields, asc])
  var openFields = useMemo(function() { return allFields.filter(function(f) { return f.type === 'open-ended' }).sort(asc) }, [allFields, asc])

  // Dimension (taxonomy axis) fields are server-aggregated and only the Group
  // Tests panel can use them (t-test/ANOVA from per-sub stats, chi-square from a
  // crosstab). They are spliced ONLY into that panel's categorical list — not the
  // global catFields — so the row-based panels never see fields they can't compute.
  var hasDimensions = datasetSource === 'google_reviews' || !!taxonomyEnabled
  var groupTestCatFields = useMemo(function() {
    return hasDimensions ? catFields.concat(dimVirtualFields() as SchemaFieldConfig[]) : catFields
  }, [catFields, hasDimensions])

  var aliases = useMemo(function() {
    var out: Record<string, string> = {}
    schema.fields.forEach(function(f) { if (f.label && f.label !== f.field) out[f.field] = f.label })
    if (hasThemes) out['__themes__'] = 'Themes'
    mappedFields.forEach(function(f) { out['__mapped_' + f.field + '__'] = (f.label || f.field) })
    if (hasDimensions) DIM_AXES.forEach(function(a) { out[dimFieldName(a)] = DIM_AXIS_LABEL[a] })
    return out
  }, [schema.fields, hasThemes, mappedFields, hasDimensions])

  // Per-field quality flags for the left sidebar — dims fields with no analytical value
  var sidebarDiag = useMemo(function() {
    var diag: Record<string, string> = {}
    if (!enrichedData.length) return diag
    numFields.forEach(function(f) {
      var vals = enrichedData.map(function(r) { return parseFloat(String(r[f.field] ?? '').replace(/,/g, '')) }).filter(function(v) { return !isNaN(v) })
      if (vals.length < 3) { diag[f.field] = 'Only ' + vals.length + ' valid value(s)'; return }
      if (vals.length < enrichedData.length * 0.1) { diag[f.field] = Math.round(vals.length / enrichedData.length * 100) + '% coverage (' + vals.length + ' rows)'; return }
      var mn = vals.reduce(function(s, v) { return s + v }, 0) / vals.length
      var vr = vals.reduce(function(s, v) { return s + (v - mn) ** 2 }, 0) / vals.length
      if (vr === 0) diag[f.field] = 'Zero variance — all values identical'
    })
    catFields.forEach(function(f) {
      var vals = enrichedData.map(function(r) { return String(r[f.field] ?? '').trim() }).filter(function(v) { return v !== '' })
      var unique = new Set(vals)
      if (unique.size === 0) diag[f.field] = 'No values'
      else if (unique.size === 1) diag[f.field] = 'Only 1 category — no variation'
    })
    return diag
  }, [enrichedData, numFields, catFields])

  // Compute bootstrap CIs after enrichedData is ready — stable deps prevent re-trigger loops
  useEffect(function() {
    if (!enrichedData.length) return
    setMcRunning(true)
    var tid = setTimeout(function() {
      var results: Record<string, MCResult> = {}
      numFields.forEach(function(f) {
        var vals = enrichedData
          .map(function(r) { return r[f.field] })
          .filter(function(v) { return typeof v === 'number' && isFinite(v as number) }) as number[]
        if (vals.length >= 10) {
          results[f.field] = bootstrapCI(vals)
        }
      })
      setMcResults(results)
      setMcRunning(false)
    }, 0)
    return function() { clearTimeout(tid) }
  }, [enrichedData, numFields])

  // Apply pending settings — reloads data only if cap changed
  var isDirty = pendingConfidence !== confidenceLevel || pendingCap !== sampleCap
  var applySettings = function() {
    setConfidenceLevel(pendingConfidence)
    if (pendingCap !== sampleCap) {
      setSampleCap(pendingCap) // useMemo recomputes subsample automatically
    }
  }

  // ── Confidence / MOE helpers ──────────────────────────────────────────────
  var Z_TABLE: Record<number, number> = {
    90: 1.6449, 91: 1.6954, 92: 1.7507, 93: 1.8119, 94: 1.8808,
    95: 1.9600, 96: 2.0537, 97: 2.1701, 98: 2.3263, 99: 2.5758,
  }
  var z        = Z_TABLE[confidenceLevel] ?? 1.96
  var zPending = Z_TABLE[pendingConfidence] ?? 1.96
  var reqN     = Math.ceil(z * z * 100)    // min n for ±5% MOE at applied confidence
  var analysisN = samplingMeta ? samplingMeta.sampleSize : rows.length
  var moePct   = analysisN > 0 ? (z * Math.sqrt(0.25 / analysisN) * 100).toFixed(1) : null
  var meetsReq = analysisN >= reqN
  // Pending MOE preview (what it will be after Apply)
  var pendingMoe = pendingCap > 0 ? (zPending * Math.sqrt(0.25 / pendingCap) * 100).toFixed(1) : '0.0'
  var perfWarning = pendingCap === 0 || pendingCap > 50_000

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>

        {/* ─── Left sidebar: Fields ─────────────────────────── */}
        <div style={{ width: 200, flexShrink: 0, borderRight: '1px solid ' + T.border, background: T.bgCard, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>

          {/* Status */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid ' + T.border }}>
            {rowsLoading && <span style={{ fontSize: 11, color: T.textMute, display: 'flex', alignItems: 'center', gap: 4 }}><LottieLoader size={14} /> Loading…</span>}
            {!rowsLoading && !rowsLoaded && <span style={{ fontSize: 11, color: T.textFaint }}>No data loaded</span>}
            {rowsLoaded && samplingMeta && !samplingMeta.sampled && (
              <span style={{ fontSize: 11, color: T.green }}>{'\u2714'} {samplingMeta.sampleSize.toLocaleString()} rows</span>
            )}
            {rowsLoaded && samplingMeta?.sampled && (
              <span style={{ fontSize: 11, color: T.textMute }}>
                {'\u2714'} {samplingMeta.sampleSize.toLocaleString()} <span style={{ color: T.textFaint }}>of {samplingMeta.totalRows.toLocaleString()}</span>
              </span>
            )}
          </div>

          {/* Field groups — filtered to types relevant for the active panel */}
          {(function() {
            var needsNum = true
            var needsCat = activePanel === 'grouptests' || activePanel === 'insights' || activePanel === 'outliers'
            var sidebarFields = [...(needsNum ? numFields : []), ...(needsCat ? catFields : [])]
            // Dual-purpose Likerts: when BOTH the raw categorical and its numeric
            // twin would show (a panel that lists both types), drop the twin so
            // the field appears ONCE (raw, dual-flagged) — a numeric slot resolves
            // it back to the twin on drop. On numeric-only panels the raw isn't
            // present, so the twin stays as the field's single numeric entry.
            var present = new Set(sidebarFields.map(function(f) { return f.field }))
            var deduped = sidebarFields.filter(function(f) { return !(isMappedId(f.field) && present.has(rawFieldFromMapped(f.field))) })
            return <FieldSidebarGroups fields={deduped} T={T} fl={fl} diag={sidebarDiag} />
          })()}

          {/* Themes section — source picker + toggle chips */}
          {hasThemes && (function() {
            var allThemesList: { name?: string; label?: string; color?: string }[] = effectiveThemeModel!.themes || []
            return (
              <div style={{ borderTop: '1px solid ' + T.border }}>
                <div style={{ padding: '8px 12px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: T.purple, letterSpacing: '.07em', textTransform: 'uppercase', marginBottom: 6 }}>
                    {'\uD83C\uDFF7'} Themes
                  </div>
                  {schemaOpenFields.length > 1 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 10, color: T.textFaint, marginBottom: 3 }}>Source verbatim:</div>
                      <select value={themeSourceField} onChange={function(e) { setThemeSourceField(e.target.value); setActiveThemeNames(null); setThemeEnrichKey(function(k) { return k + 1 }) }}
                        style={{ width: '100%', padding: '5px 8px', fontSize: 11, border: '1px solid ' + T.border, borderRadius: 6, background: T.bgCard, color: T.textMid, outline: 'none', cursor: 'pointer' }}>
                        {schemaOpenFields.map(function(f) { return <option key={f.field} value={f.field}>{f.label || f.field}</option> })}
                      </select>
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ fontSize: 10, color: T.textFaint }}>Filter themes:</span>
                    <div style={{ display: 'flex', gap: 3 }}>
                      <button onClick={function() { setActiveThemeNames(null); setThemeEnrichKey(function(k) { return k + 1 }) }}
                        style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, border: '1px solid ' + T.border, background: 'transparent', color: T.textMute, cursor: 'pointer' }}>All</button>
                      <button onClick={function() { setActiveThemeNames(new Set()); setThemeEnrichKey(function(k) { return k + 1 }) }}
                        style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, border: '1px solid ' + T.border, background: 'transparent', color: T.textMute, cursor: 'pointer' }}>None</button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {allThemesList.map(function(t) {
                      // every stored theme carries a name (or legacy label) — assert non-null
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
                          setThemeEnrichKey(function(k) { return k + 1 })
                        }}
                        style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, border: '1px solid ' + (isActive ? color : T.border), background: isActive ? color + '22' : 'transparent', color: isActive ? color : T.textFaint, cursor: 'pointer', fontWeight: isActive ? 600 : 400, transition: 'all .1s' }}>
                          {name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })()}
        </div>

        {/* ─── Main content ─────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>


          {/* ── Loading spinner ── */}
          {rowsLoading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, padding: 60 }}>
              <LottieLoader size={120} message="Loading data for statistical analysis..." />
            </div>
          )}

          {/* ── Sampled-dataset notice ── */}
          {rowsLoaded && samplingMeta?.sampled && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              background: '#eff6ff', border: '1px solid #bfdbfe',
              borderRadius: 10, padding: '10px 14px', marginBottom: 20,
              fontSize: 12, color: '#1e40af', lineHeight: 1.5,
            }}>
              <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>📊</span>
              <div>
                <strong>Sampled dataset</strong> — analysis is based on {samplingMeta.sampleSize.toLocaleString()} systematically-sampled rows from {samplingMeta.totalRows.toLocaleString()} total responses.
                {' '}Worst-case ±{moePct}% at {confidenceLevel}% CI.
              </div>
            </div>
          )}

          {/* ── Analysis panels ── */}
          {rowsLoaded && (
            <>
              {activePanel === 'descriptives' && <DescriptivesPanel numFields={numFields} data={enrichedData} mcResults={mcResults} mcRunning={mcRunning} confidenceLevel={confidenceLevel} datasetId={datasetId} />}
              {activePanel === 'correlations' && <CorrelationsPanel numFields={numFields} data={enrichedData} aliases={aliases} datasetId={datasetId} />}
              {activePanel === 'grouptests' && <GroupTestsPanel numFields={numFields} catFields={groupTestCatFields} data={enrichedData} aliases={aliases} datasetId={datasetId} dimFieldKey={themeSourceField || undefined} filteredRowIds={dimFilteredRowIds} />}
              {activePanel === 'regression' && <RegressionPanel numFields={numFields} catFields={catFields} data={enrichedData} aliases={aliases} datasetId={datasetId} themeModel={effectiveThemeModel} themeSourceField={themeSourceField} />}
              {activePanel === 'insights' && <AutoInsightsPanel numFields={numFields} catFields={catFields} data={enrichedData} aliases={aliases} />}
              {activePanel === 'outliers' && <OutlierAnalysisPanel numFields={numFields} catFields={catFields} data={enrichedData} datasetId={datasetId} />}
            </>
          )}
        </div>

        {/* ─── Right sidebar: Validity + Analysis types ─────── */}
        <div style={{ width: 200, flexShrink: 0, borderLeft: '1px solid ' + T.border, background: T.bgCard, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>

          {/* Statistical Validity + Sample Settings */}
          <div style={{ borderBottom: '1px solid ' + T.border, flexShrink: 0 }}>
            {/* Header row — always visible, click to expand/collapse */}
            <button
              onClick={function() { setValidityOpen(function(v) { return !v }) }}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer' }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                Statistical Validity
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: T.accent }}>{confidenceLevel}%</span>
                {analysisN > 0 && <span style={{ fontSize: 10, color: T.textMid }}>{analysisN.toLocaleString()}</span>}
                <span style={{ fontSize: 10, color: T.textFaint }}>{validityOpen ? '\u25BE' : '\u25B8'}</span>
              </span>
            </button>

            {validityOpen && (
              <div style={{ padding: '0 14px 14px' }}>
                {/* Confidence level slider — pending value */}
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: T.textMute }}>Confidence level</span>
                    <span style={{ fontSize: 14, fontWeight: 800, color: T.accent }}>{pendingConfidence}%</span>
                  </div>
                  <input type="range" min={90} max={99} step={1} value={pendingConfidence}
                    onChange={function(e) {
                      var newConf = parseInt(e.target.value)
                      setPendingConfidence(newConf)
                      var zz: Record<number, number> = { 90: 1.6449, 91: 1.6954, 92: 1.7507, 93: 1.8119, 94: 1.8808, 95: 1.9600, 96: 2.0537, 97: 2.1701, 98: 2.3263, 99: 2.5758 }
                      var nz = zz[newConf] ?? 1.96
                      setPendingCap(Math.ceil(nz * nz * 100))
                    }}
                    style={{ width: '100%', accentColor: T.accent, cursor: 'pointer', height: 4 }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: T.textFaint, marginTop: 2 }}>
                    <span>90%</span><span>99%</span>
                  </div>
                </div>

                {/* Sample size input */}
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, color: T.textMute, marginBottom: 4 }}>Rows to analyze</div>
                  <input
                    type="number" min={0} value={pendingCap}
                    onChange={function(e) {
                      var newCap = Math.max(0, parseInt(e.target.value) || 0)
                      setPendingCap(newCap)
                      if (newCap > 0) {
                        var targetZ = 0.05 * Math.sqrt(newCap) / 0.5
                        var zMap: Record<number, number> = { 90: 1.6449, 91: 1.6954, 92: 1.7507, 93: 1.8119, 94: 1.8808, 95: 1.9600, 96: 2.0537, 97: 2.1701, 98: 2.3263, 99: 2.5758 }
                        var best = 95, bestDiff = Infinity
                        Object.entries(zMap).forEach(function([lv, zv]) { var d = Math.abs(zv - targetZ); if (d < bestDiff) { bestDiff = d; best = parseInt(lv) } })
                        setPendingConfidence(best)
                      }
                    }}
                    style={{ width: '100%', padding: '6px 8px', fontSize: 12, border: '1px solid ' + T.border, borderRadius: 6, outline: 'none', color: T.text, background: T.bgCard, boxSizing: 'border-box' }}
                  />
                  <div style={{ fontSize: 10, color: T.textFaint, marginTop: 3 }}>
                    {pendingCap === 0 ? 'All rows (may be slow on large datasets)' : 'Preview: ±' + pendingMoe + '% MOE'}
                  </div>
                </div>

                {/* Performance warning */}
                {perfWarning && (
                  <div style={{ fontSize: 10, background: T.amberBg, color: T.amber, border: '1px solid ' + T.amberMid, borderRadius: 6, padding: '5px 7px', marginBottom: 8, lineHeight: 1.45 }}>
                    {'\u26A0'} {pendingCap === 0 ? 'Full dataset' : pendingCap.toLocaleString() + ' rows'} may slow down correlation and bootstrap calculations in your browser.
                  </div>
                )}

                {/* Apply button */}
                <button
                  onClick={applySettings}
                  disabled={!isDirty}
                  style={{
                    width: '100%', padding: '7px', borderRadius: 7, fontWeight: 700, fontSize: 12, cursor: isDirty ? 'pointer' : 'default',
                    background: isDirty ? T.accent : T.border, color: isDirty ? 'white' : T.textFaint,
                    border: 'none', opacity: isDirty ? 1 : 0.5, transition: 'all .15s',
                  }}>
                  {isDirty ? 'Apply' : '\u2714 Applied'}
                </button>

                {/* Loaded sample readout */}
                {analysisN > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10, paddingTop: 10, borderTop: '1px solid ' + T.border }}>
                    <div style={{ fontSize: 10, color: T.textMute, display: 'flex', justifyContent: 'space-between' }}>
                      <span>Loaded</span>
                      <span style={{ fontWeight: 700, color: T.textMid }}>{analysisN.toLocaleString()}</span>
                    </div>
                    <div style={{ fontSize: 10, color: T.textMute, display: 'flex', justifyContent: 'space-between' }}>
                      <span>Actual MOE</span>
                      <span style={{ fontWeight: 700, color: meetsReq ? T.green : T.amber }}>±{moePct}%</span>
                    </div>
                    <div style={{ fontSize: 10, color: T.textMute, display: 'flex', justifyContent: 'space-between' }}>
                      <span>Min. for ±5%</span>
                      <span style={{ fontWeight: 700, color: T.textMid }}>{reqN.toLocaleString()}</span>
                    </div>
                    <div style={{
                      fontSize: 10, padding: '3px 6px', borderRadius: 5,
                      background: meetsReq ? T.greenBg : T.amberBg,
                      color: meetsReq ? T.green : T.amber,
                      border: '1px solid ' + (meetsReq ? T.greenMid : T.amberMid),
                    }}>
                      {meetsReq ? '\u2714 Sufficient' : '\u26A0 Need ' + (reqN - analysisN).toLocaleString() + ' more'}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ padding: '14px 14px 8px', borderBottom: '1px solid ' + T.border, flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: T.textFaint, textTransform: 'uppercase', letterSpacing: '.08em' }}>Analysis Type</div>
          </div>
          <div style={{ padding: '8px 0', flex: 1 }}>
            {ANALYSIS_TYPES.map(function(at) {
              var isActive = activePanel === at.id
              var isHov = hovered === at.id
              return (
                <button key={at.id}
                  onClick={function() { setActivePanel(at.id) }}
                  onMouseEnter={function() { setHovered(at.id) }}
                  onMouseLeave={function() { setHovered(null) }}
                  style={{ width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', background: isActive ? (at.color + '14') : (isHov ? T.bg : 'transparent'), cursor: 'pointer', borderLeft: '3px solid ' + (isActive ? at.color : 'transparent'), transition: 'all .12s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, width: 28, height: 28, borderRadius: 7, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: isActive ? at.color : (isHov ? at.color + '22' : T.bg), color: isActive ? 'white' : at.color, flexShrink: 0 }}>{at.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: isActive ? 700 : 500, color: isActive ? at.color : T.textMid }}>{at.label}</span>
                  </div>
                  {(isHov || isActive) && (
                    <div style={{ paddingLeft: 36, marginTop: 3 }}>
                      <div style={{ fontSize: 10, color: T.textMute, lineHeight: 1.45 }}>{at.tip}</div>
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}


