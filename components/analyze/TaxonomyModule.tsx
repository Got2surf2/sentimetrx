'use client'

// components/analyze/TaxonomyModule.tsx
// In-app tag-analytics view. Fetches the roll-up from
// /api/datasets/[id]/taxonomy and renders: KPIs, per-axis mention rates,
// top sub-buckets with sentiment, and severity alerts. The tags are produced
// by the keyword-tier classifier (lib/taxonomyClassify), run self-serve from
// here: the "Classify" button loops POST chunks until the dataset is done.

import { useCallback, useEffect, useState, type ReactElement } from 'react'
import LottieLoader from '@/components/ui/LottieLoader'
import { AXIS_COLOR, DIM_AXIS_LABEL, dimSubLabel, type Axis } from '@/lib/dimensionFields'

interface SubStat { axis: string; sub: string; count: number; rate: number; pos: number; neg: number; posPct: number | null; avgRating: number | null }
interface TextField { field: string; label: string }
interface Rollup {
  classifiedRows: number
  withSignal: number
  overallAvgRating: number | null
  axes: { axis: string; label: string; count: number; rate: number; avgRating: number | null }[]
  subs: SubStat[]
  alerts: { tag: string; count: number }[]
  alertRows: number
  textFields: TextField[]
  defaultField: string | null
  totalRows: number | null     // dataset row count
  rowsWithText: number         // rows with text in the analyzed field — the reconciling denominator
  field: string                // the field this rollup was computed for
}

const TEAL = '#0F7173', ORANGE = '#e8622a', NAVY = '#0D2B45'
const GREEN = '#059669', AMBER = '#D97706', RED = '#DC2626', SLATE = '#8FA3AE'

// Sentinel filterAxis value for the cross-cutting Severity "dimension" — it sits
// in the axis-pill row (red, status not navigation) and opens its alert sub-cards.
const SEVERITY = '__severity__'

// Min mentions for a sub-dimension to surface (same noise-floor idea as Themes' signal
// cutoff). Severity alerts are exempt — a low-count food-safety/pests flag still matters.
const MIN_SUB_COUNT = 35

// Red→green ramp (0..1), mirrors TextMine's CommentsPanel rating colouring.
function rampColor(pct: number): string {
  if (pct <= 0.5) { const g = Math.round(80 + pct * 2 * 120); return `rgb(220,${g},40)` }
  const r = Math.round(220 - (pct - 0.5) * 2 * 180), g = Math.round(160 + (pct - 0.5) * 2 * 40)
  return `rgb(${r},${g},40)`
}
// Colour for a 1–5 rating (null when no rating).
function ratingColor(rating: number | null): string | null {
  if (rating == null || isNaN(rating)) return null
  return rampColor(Math.max(0, Math.min(1, (rating - 1) / 4)))
}

/** ★ avg-rating badge, coloured red→green by the 1–5 value (null = render nothing). */
function StarBadge({ avg, size = 12 }: { avg: number | null; size?: number }) {
  if (avg == null) return null
  return <span title="Average star rating of reviews touching this" style={{ fontSize: size, fontWeight: 700, color: ratingColor(avg) || '#8FA3AE', whiteSpace: 'nowrap' }}>★ {avg.toFixed(1)}</span>
}

function sentimentColor(posPct: number | null): string {
  if (posPct === null) return SLATE
  if (posPct >= 66) return GREEN
  if (posPct >= 40) return AMBER
  return RED
}

interface DrillComment { text: string; rating: number | null; date: string | null; evidence: string[]; tags: { axis: string; sub: string; evidence: string[] }[] }

function escapeRE(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

/** Bold the matched-evidence phrases inside a comment so the demo shows WHY it was tagged.
 *  Stored evidence is often a fixed-width char window (e.g. "…were ju"), so we snap each
 *  match out to whole-word boundaries — the highlight never cuts a word in half. */
function highlight(text: string, phrases: string[]): Array<string | ReactElement> {
  const cleaned = [...new Set(phrases.map(p => p.trim()).filter(p => p.length >= 2))].sort((a, b) => b.length - a.length)
  if (!cleaned.length) return [text]
  let re: RegExp
  try { re = new RegExp('(' + cleaned.map(escapeRE).join('|') + ')', 'gi') } catch { return [text] }
  const isWord = (ch: string) => /[\p{L}\p{N}]/u.test(ch)
  const out: Array<string | ReactElement> = []
  let last = 0, m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    // Expand the matched span left/right to the nearest word boundaries.
    let s = m.index, e = m.index + m[0].length
    while (s > 0 && isWord(text[s - 1])) s--
    while (e < text.length && isWord(text[e])) e++
    if (s < last) s = last                              // don't backtrack into already-emitted text
    if (s > last) out.push(text.slice(last, s))
    // Layout-NEUTRAL highlight: background + box-shadow underline only — no
    // padding / border-width / font-weight, so toggling the highlight (e.g. when
    // hovering a dimension chip) never changes text metrics → no reflow / no
    // pixel-jump that would bounce the cursor off the chip being hovered.
    if (e > s) out.push(<mark key={s} style={{ background: '#fef3c7', color: '#92400e', borderRadius: 2, boxShadow: 'inset 0 -2px 0 #f59e0b' }}>{text.slice(s, e)}</mark>)
    last = e
    if (re.lastIndex < e) re.lastIndex = e              // skip past the expanded word so the next match can't overlap it
    if (m.index === re.lastIndex) re.lastIndex++
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export default function TaxonomyModule({ datasetId, fields, fieldLabel }: { datasetId: string; fields?: string[]; fieldLabel?: string | null }) {
  // The analyzed open-ended field SET (one or more, from TextMine's ANALYZE
  // selection). Combined into one classification; the view reacts to the set.
  const selFields = fields || []
  const fieldsCsv = selFields.join(',')
  const hasField = selFields.length > 0
  const [data, setData] = useState<Rollup | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Self-serve classifier state.
  const [classifying, setClassifying] = useState(false)
  const [progress, setProgress] = useState<{ scanned: number; total: number | null }>({ scanned: 0, total: null })
  const [classifyErr, setClassifyErr] = useState<string | null>(null)
  // True once a full classify has been attempted this mount — lets the empty
  // state distinguish "not enabled yet" (show the Enable button) from "enabled
  // but the field had no taggable text" (show that instead of the button).
  const [attempted, setAttempted] = useState(false)
  // The field to classify follows the parent's ANALYZE selection (Liked Most /
  // Liked Least) — there's no separate field picker here anymore.

  // Drill-down: clicking a sub-topic / alert opens the comments behind it.
  const [drill, setDrill] = useState<{ qs: string; crumbs: string[] } | null>(null)
  const [drillData, setDrillData] = useState<{ count: number; comments: DrillComment[] } | null>(null)
  const [drillLoading, setDrillLoading] = useState(false)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())  // long comments shown in full
  const [gridCols, setGridCols] = useState(2)  // comment grid column count
  const [hoverTag, setHoverTag] = useState<{ i: number; key: string } | null>(null)  // hovered dimension chip → highlight its span
  const [filterAxis, setFilterAxis] = useState('')  // topic filter
  const [filterSub, setFilterSub] = useState('')    // sub-topic filter
  const toggleExpand = (i: number) => setExpanded(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n })

  useEffect(() => {
    if (!drill) { setDrillData(null); return }
    let alive = true
    setDrillLoading(true); setDrillData(null); setExpanded(new Set())
    // Repeated `fields=` params (not a CSV) — open-ended field NAMES are survey
    // question text and can contain commas, which a CSV param would shred.
    const fieldQs = hasField ? '&' + selFields.map(f => `fields=${encodeURIComponent(f)}`).join('&') : ''
    fetch(`/api/datasets/${datasetId}/taxonomy/rows?${drill.qs}${fieldQs}`)
      .then(r => r.json())
      .then(d => { if (alive) { setDrillData({ count: d.count ?? 0, comments: d.comments ?? [] }); setDrillLoading(false) } })
      .catch(() => { if (alive) { setDrillData({ count: 0, comments: [] }); setDrillLoading(false) } })
    return () => { alive = false }
  }, [drill, datasetId, fieldsCsv])

  // Download the open modal's comments as a CSV (rating, date, comment, evidence).
  const exportCsv = useCallback(() => {
    if (!drill || !drillData) return
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const rows = [
      ['rating', 'date', 'comment', 'matched_evidence'].join(','),
      ...drillData.comments.map(c => [c.rating ?? '', c.date ?? '', c.text, (c.evidence || []).join(' | ')].map(esc).join(',')),
    ].join('\n')
    const slug = drill.crumbs.join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const url = URL.createObjectURL(new Blob([rows], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url; a.download = `${slug || 'dimensions'}.csv`; a.click()
    URL.revokeObjectURL(url)
  }, [drill, drillData])

  const copyComment = useCallback((text: string, i: number) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedIdx(i)
      setTimeout(() => setCopiedIdx(prev => (prev === i ? null : prev)), 1400)
    }).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Per-field: pass the ANALYZE field so the rollup reacts to the toggle.
      // Repeated `fields=` params (not a CSV) — field names can contain commas.
      const qs = hasField ? '?' + selFields.map(f => `fields=${encodeURIComponent(f)}`).join('&') : ''
      const r = await fetch(`/api/datasets/${datasetId}/taxonomy${qs}`)
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
      const j: Rollup = await r.json()
      setData(j)
      setErr(null)
    } catch (e: unknown) {
      setErr(String(e instanceof Error ? e.message : e))
    } finally {
      setLoading(false)
    }
  }, [datasetId, fieldsCsv])

  useEffect(() => { void load() }, [load])

  // Loop POST chunks until the dataset is fully classified, then refresh the
  // roll-up. Idempotent server-side, so an interrupted run resumes safely.
  const runClassifier = useCallback(async (pendingOnly = false) => {
    setClassifying(true)
    setClassifyErr(null)
    setProgress({ scanned: 0, total: null })
    try {
      if (pendingOnly) {
        // Drift fix: classify only the new (untagged) rows. Non-destructive —
        // existing tags untouched. Loops until the pending queue is drained.
        for (let guard = 0; guard < 200; guard++) {
          const r = await fetch(`/api/datasets/${datasetId}/taxonomy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pendingOnly: true, textFields: selFields }),
          })
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
          const j = await r.json()
          if (j.done) break
        }
      } else {
        // cursor is an opaque id keyset cursor (NOT a row count) — progress
        // comes from accumulating each chunk's scanned count.
        let cursor = 0, scanned = 0
        for (;;) {
          const r = await fetch(`/api/datasets/${datasetId}/taxonomy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cursor, textFields: selFields }),
          })
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
          const j = await r.json()
          scanned += j.scanned ?? 0
          setProgress({ scanned, total: j.totalRows ?? null })
          if (j.done || j.nextCursor <= cursor) break  // done, or no forward progress (safety)
          cursor = j.nextCursor
        }
      }
      if (!pendingOnly) setAttempted(true)
      await load()
    } catch (e: unknown) {
      setClassifyErr(String(e instanceof Error ? e.message : e))
    } finally {
      setClassifying(false)
    }
  }, [datasetId, load, fieldsCsv])

  // One-click "Enable Dimensions": flip the dataset's Dimensions flag on (idempotent
  // hygiene so the tab + Charts/Stats dim breakdowns stay available) AND run the
  // keyword classifier. Replaces the old silent auto-classify-on-open with one
  // explicit action — the single place to turn Dimensions on for this dataset.
  const enableAndClassify = useCallback(async () => {
    try {
      await fetch('/api/datasets/' + datasetId, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taxonomy_enabled: true }),
      })
    } catch { /* non-fatal — google_reviews is already dimension-eligible */ }
    await runClassifier(false)
  }, [datasetId, runClassifier])

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}><LottieLoader size={120} message="Loading dimensions…" /></div>
  if (err) return <div style={{ padding: 32, color: RED }}>Couldn’t load dimensions: {err}</div>

  if (classifying) {
    const pct = progress.total ? Math.min(100, Math.round(100 * progress.scanned / progress.total)) : null
    return (
      <div style={{ padding: 40, maxWidth: 560 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: NAVY, marginBottom: 8 }}>Classifying…</h2>
        <p style={{ fontSize: 14, color: '#475569', marginBottom: 16 }}>
          {progress.scanned.toLocaleString()}{progress.total ? ` of ${progress.total.toLocaleString()}` : ''} rows scanned. Keep this tab open — you can leave it running.
        </p>
        <div style={{ background: '#eef2f4', borderRadius: 6, height: 16, overflow: 'hidden' }}>
          <div style={{ width: pct === null ? '100%' : `${pct}%`, height: 16, background: TEAL, borderRadius: 6, transition: 'width .3s', opacity: pct === null ? 0.5 : 1 }} />
        </div>
        {pct !== null && <p style={{ fontSize: 12, color: SLATE, marginTop: 8 }}>{pct}%</p>}
      </div>
    )
  }

  if (!data || data.classifiedRows === 0) {
    // Single setup screen: one "Enable Dimensions" button does enable + classify
    // (no separate Schema-tab toggle step, no silent auto-run).
    return (
      <div style={{ padding: 40, maxWidth: 560 }}>
        {!hasField ? (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: NAVY, marginBottom: 8 }}>Pick a field to analyze</h2>
            <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.5 }}>
              Choose an open-ended field — the <strong>Liked Most / Liked Least</strong> toggle at the top (you can select more than one) — then click <strong>Enable Dimensions</strong>.
            </p>
          </>
        ) : classifyErr ? (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: NAVY, marginBottom: 8 }}>Couldn’t classify</h2>
            <p style={{ color: RED, fontSize: 13, marginBottom: 16 }}>Classification failed: {classifyErr}</p>
            <button onClick={() => { void enableAndClassify() }}
              style={{ background: ORANGE, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              Try again
            </button>
          </>
        ) : attempted ? (
          <p style={{ fontSize: 14, color: SLATE }}>No taggable text found in <strong>{fieldLabel || 'this selection'}</strong>.</p>
        ) : (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: NAVY, marginBottom: 8 }}>Enable Dimensions</h2>
            <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.55, marginBottom: 18 }}>
              Tag every comment in <strong>{fieldLabel || 'this field'}</strong> with consistent dimensions you can compare and filter by. Restaurant datasets (Google reviews, restaurant orgs) get the full menu of dimensions — service, food, drinks, ambiance, value and more, each with sentiment and severity. Every other dataset gets the universal <strong>Emotion</strong> dimension: disappointment, blame, and churn-intent <em>language</em>, each backed by the verbatim phrase that triggered it. Keyword-based, no AI cost, one pass.
            </p>
            <button onClick={() => { void enableAndClassify() }}
              style={{ background: ORANGE, color: '#fff', border: 'none', borderRadius: 8, padding: '11px 22px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              Enable Dimensions
            </button>
          </>
        )}
      </div>
    )
  }

  return (
    <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      {/* Header — matches the Themes view's scale: an h2 + a one-line stat summary.
          No field picker (follows the ANALYZE toggle) and no Re-classify here —
          re-classification is destructive + expensive, so it's not a prominent
          button; new-data classification belongs at the dataset level (see note).
          (No chunky KPI cards — the flagged count now lives on the ⚠ Severity pill.) */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: NAVY, margin: 0 }}>Dimensions</h2>
        <div style={{ fontSize: 12, color: '#64748b', margin: '3px 0 0' }}>
          {fieldLabel && <>Field: <strong style={{ color: NAVY }}>{fieldLabel}</strong> · </>}
          <strong style={{ color: NAVY }}>{(data.rowsWithText || data.classifiedRows).toLocaleString()}</strong> rows with text
          {' · '}{Math.round(100 * data.withSignal / Math.max(1, data.rowsWithText || data.classifiedRows))}% tagged
          {data.overallAvgRating != null && <> · <span style={{ color: ratingColor(data.overallAvgRating) || NAVY, fontWeight: 700 }}>★ {data.overallAvgRating.toFixed(1)}</span> avg rating</>}
          {data.alertRows > 0 && <> · <span style={{ color: RED, fontWeight: 700 }}>{data.alertRows.toLocaleString()} flagged</span></>}
        </div>
      </div>

      {/* Drift nudge — only shown when rows have been added since the last classify.
          Classifies just the NEW rows (non-destructive); this is the contextual,
          drift-triggered replacement for the old always-present Re-classify button. */}
      {(() => {
        // Pending = rows WITH TEXT in this field that don't have tags yet (the
        // actionable count — blank rows are never classifiable, so exclude them).
        const pending = Math.max(0, (data.rowsWithText || 0) - data.classifiedRows)
        if (pending <= 0 || !hasField) return null
        return (
          <div style={{ marginBottom: 20, padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: '#92400e' }}>
              ⚠ <strong>{pending.toLocaleString()}</strong> {fieldLabel || ''} row{pending === 1 ? '' : 's'} aren’t tagged yet (new since the last classify).
            </span>
            <button
              onClick={() => { void runClassifier(true) }}
              title={`Classify only the new rows on ${fieldLabel || 'the selected field(s)'} (existing tags are untouched)`}
              style={{ marginLeft: 'auto', background: ORANGE, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              Classify {pending.toLocaleString()} new row{pending === 1 ? '' : 's'}
            </button>
          </div>
        )
      })()}

      {/* Dimension axis pills (Entities-style: identity dot + label + mention-rate% + ★ rating).
          Pick one to focus the sub-dimension cards below; pick again to clear. */}
      <div style={{ marginBottom: 20, padding: '14px 16px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 1 }}>Dimension</span>
          {(filterAxis || drill) && (
            <button onClick={() => { setFilterAxis(''); setFilterSub(''); setDrill(null) }}
              style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: SLATE, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Clear ✕</button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {data.axes.map(a => {
            const active = filterAxis === a.axis
            const c = AXIS_COLOR[a.axis as Axis] || SLATE
            return (
              <button key={a.axis}
                onClick={() => { setDrill(null); if (active) { setFilterAxis(''); setFilterSub('') } else { setFilterAxis(a.axis); setFilterSub('') } }}
                title={`${a.label} — ${Math.round(a.rate)}% of classified reviews${a.avgRating != null ? ` · ★ ${a.avgRating.toFixed(1)}` : ''}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, lineHeight: 1.3, padding: '5px 11px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap', border: '1px solid ' + (active ? c : '#e2e8f0'), background: active ? c + '14' : '#fff', color: NAVY }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: c, flexShrink: 0 }} />
                <span style={{ fontWeight: 700 }}>{a.label}</span>
                <span style={{ color: TEAL, fontWeight: 700 }}>{Math.round(a.rate)}%</span>
                <StarBadge avg={a.avgRating} size={11} />
              </button>
            )
          })}
          {data.alerts.length > 0 && (() => {
            const active = filterAxis === SEVERITY
            return (
              <button key={SEVERITY}
                onClick={() => { if (active) { setFilterAxis(''); setFilterSub('') } else { setFilterAxis(SEVERITY); setFilterSub(''); setDrill(null) } }}
                title={`Severity — ${data.alertRows.toLocaleString()} reviews flagged at alert / crisis (food safety / pests)`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700, lineHeight: 1.3, padding: '5px 11px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap', border: '1px solid ' + (active ? RED : '#fecaca'), background: active ? RED : '#fef2f2', color: active ? '#fff' : '#b91c1c' }}>
                <span>⚠ Severity</span>
                <span style={{ opacity: active ? 0.85 : 0.6 }}>{data.alertRows.toLocaleString()}</span>
              </button>
            )
          })()}
        </div>
      </div>

      {/* Sub-dimension selected → collapse the cards into a compact pill row right
          under the dimension, so the user can switch sub-dimensions (and re-drill)
          without closing the comments. Card grid below returns null in this state. */}
      {filterAxis && filterAxis !== SEVERITY && filterSub && (() => {
        const focus = data.axes.find(x => x.axis === filterAxis)
        const c = AXIS_COLOR[filterAxis as Axis] || SLATE
        const subs = data.subs.filter(s => s.axis === filterAxis && s.count >= MIN_SUB_COUNT)
          .sort((x, y) => (y.rate - x.rate) || (y.count - x.count))
        return (
          <div style={{ marginBottom: 16, padding: '12px 14px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ width: 9, height: 9, borderRadius: 5, background: c, flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>{focus?.label || filterAxis}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 1 }}>· sub-dimension</span>
              <button onClick={() => { setFilterSub(''); setDrill(null) }}
                title="Back to all sub-dimension cards"
                style={{ marginLeft: 'auto', background: 'transparent', border: 'none', fontSize: 12, fontWeight: 700, color: TEAL, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                ⊞ All sub-dimensions
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {subs.map(s => {
                const sActive = filterSub === s.sub
                const qs = `axis=${encodeURIComponent(s.axis)}&sub=${encodeURIComponent(s.sub)}`
                return (
                  <button key={s.sub}
                    onClick={() => { if (sActive) { setFilterSub(''); setDrill(null) } else { setFilterSub(s.sub); setDrill({ qs, crumbs: ['Dimensions', focus?.label || filterAxis, s.sub] }) } }}
                    title={`${dimSubLabel(s.sub)} — ${s.count.toLocaleString()} review${s.count === 1 ? '' : 's'}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, lineHeight: 1.3, padding: '4px 10px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap', border: '1px solid ' + (sActive ? c : '#e2e8f0'), background: sActive ? c + '14' : '#fff', color: NAVY }}>
                    {sActive && <span style={{ width: 6, height: 6, borderRadius: 3, background: c, flexShrink: 0 }} />}
                    <span style={{ fontWeight: 700 }}>{dimSubLabel(s.sub)}</span>
                    <span style={{ color: SLATE }}>{s.count.toLocaleString()}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* Inline comments panel — driven by the filter above or by clicking a sub-topic / alert. */}
      {drill && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, marginBottom: 24, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                {drill.crumbs.map((c, i) => {
                  const isLast = i === drill.crumbs.length - 1
                  return (
                    <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {i > 0 && <span style={{ color: '#cbd5e1' }}>›</span>}
                      <span style={{ fontSize: 12, fontWeight: isLast ? 700 : 600, color: isLast ? NAVY : SLATE, textTransform: i === 0 ? 'uppercase' : 'none', letterSpacing: i === 0 ? 1 : 0 }}>{c}</span>
                    </span>
                  )
                })}
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: NAVY }}>{drill.crumbs[drill.crumbs.length - 1]}</div>
              {drillData && <div style={{ fontSize: 13, color: SLATE, marginTop: 2 }}>{drillData.count.toLocaleString()} comment{drillData.count === 1 ? '' : 's'} tagged{drillData.count > drillData.comments.length ? ` · showing first ${drillData.comments.length}` : ''}</div>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
              {drillData && drillData.comments.length > 1 && (
                <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #e2e8f0' }} title="Comment columns">
                  {[1, 2, 3, 4].map(n => (
                    <button key={n} onClick={() => setGridCols(n)} title={`${n} column${n > 1 ? 's' : ''}`}
                      style={{ padding: '4px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer', border: 'none', borderRight: n < 4 ? '1px solid #e2e8f0' : 'none', background: gridCols === n ? TEAL : '#fff', color: gridCols === n ? '#fff' : SLATE }}>
                      {n}
                    </button>
                  ))}
                </div>
              )}
              {drillData && drillData.comments.length > 0 && (
                <button onClick={exportCsv} title="Download these comments as CSV" style={{ background: TEAL, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>⤓ Export CSV</button>
              )}
              <button onClick={() => { setDrill(null); setFilterSub('') }} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, width: 36, height: 36, fontSize: 20, cursor: 'pointer', color: NAVY }}>×</button>
            </div>
          </div>
          <div style={{ maxHeight: 460, overflowY: 'auto', padding: 16, background: '#f8fafc' }}>
            {drillLoading && <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}><LottieLoader size={80} message="Loading comments…" /></div>}
            {!drillLoading && drillData && drillData.comments.length === 0 && (
              <p style={{ color: SLATE, fontSize: 13, padding: 16 }}>No comments found for this tag.</p>
            )}
            {!drillLoading && drillData && drillData.comments.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridCols}, 1fr)`, gap: 10, alignItems: 'stretch' }}>
                {drillData.comments.map((c, i) => {
                const LIMIT = 300
                const isLong = c.text.length > LIMIT
                const isOpen = expanded.has(i)
                const shownText = isLong && !isOpen ? c.text.slice(0, LIMIT).trimEnd() + '… ' : c.text
                const accent = ratingColor(c.rating)
                const cardBg = accent ? accent.replace('rgb(', 'rgba(').replace(')', ', 0.07)') : '#fff'
                // Default: highlight the filtered tag's evidence. On hovering another
                // dimension chip, switch the highlight to that dimension's span.
                const hoverEv = hoverTag && hoverTag.i === i ? c.tags.find(t => `${t.axis}:${t.sub}` === hoverTag.key)?.evidence : null
                const activeEvidence = hoverEv && hoverEv.length ? hoverEv : c.evidence
                // A severity drill (qs `alert=<tag>`) maps onto the attribute:<tag> chip.
                const drilledAlert = drill && drill.qs.startsWith('alert=') ? decodeURIComponent(drill.qs.slice(6)) : null
                return (
                  <div key={i} style={{ background: cardBg, border: '1px solid #e2e8f0', borderLeft: '4px solid ' + (accent || '#e2e8f0'), borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column' }}>
                    <p style={{ fontSize: 14, color: '#1e293b', lineHeight: 1.5, margin: '0 0 8px' }}>
                      {highlight(shownText, activeEvidence)}
                      {isLong && <button onClick={() => toggleExpand(i)} style={{ background: 'transparent', border: 'none', color: TEAL, fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: 0 }}>{isOpen ? 'Show less' : 'Show more'}</button>}
                    </p>
                    {c.tags.length > 0 && (
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
                        {c.tags.map(t => {
                          const key = `${t.axis}:${t.sub}`
                          // The picked dimension/sub-dimension pair (or, for an axis-only
                          // "read all" drill, every sub of that dimension; for a severity
                          // drill, the attribute sub matching the alert) is the active match.
                          const isActive = drilledAlert
                            ? (t.axis === 'attribute' && t.sub === drilledAlert)
                            : (filterAxis !== '' && filterAxis !== SEVERITY && t.axis === filterAxis && (filterSub === '' || t.sub === filterSub))
                          const isHover = hoverTag?.i === i && hoverTag.key === key
                          const axisLabel = DIM_AXIS_LABEL[t.axis as Axis] || t.axis
                          return (
                            <span key={key}
                              onMouseEnter={() => setHoverTag({ i, key })}
                              onMouseLeave={() => setHoverTag(null)}
                              title={`Hover to highlight the words that triggered ${axisLabel} · ${dimSubLabel(t.sub)}`}
                              style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, cursor: 'pointer', opacity: (isActive || isHover) ? 1 : 0.7, background: isHover ? '#fef3c7' : (isActive ? '#ccfbf1' : '#f1f5f9'), color: isHover ? '#92400e' : (isActive ? '#0f766e' : '#64748b'), border: '1px solid ' + (isHover ? '#f59e0b' : (isActive ? '#5eead4' : '#e2e8f0')) }}>
                              {axisLabel} · {dimSubLabel(t.sub)}
                            </span>
                          )
                        })}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 'auto' }}>
                      {c.rating != null && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' }}>★ {c.rating}</span>}
                      {c.date && <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 10, background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0' }}>{String(c.date).slice(0, 10)}</span>}
                      <button onClick={() => copyComment(c.text, i)} style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid #e2e8f0', borderRadius: 10, padding: '2px 10px', fontSize: 11, fontWeight: 700, color: copiedIdx === i ? GREEN : SLATE, cursor: 'pointer' }}>{copiedIdx === i ? '✓ Copied' : 'Copy'}</button>
                    </div>
                  </div>
                )
              })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Level-2 sub-dimension cards (theme-card family). No axis picked = the
          top sub-buckets across all axes; pick an axis pill to focus to that axis.
          Each card → drills into the comments tagged with that sub-dimension. */}
      {(() => {
        const axisLabelOf = (ax: string) => data.axes.find(x => x.axis === ax)?.label || DIM_AXIS_LABEL[ax as Axis] || ax

        // Severity "dimension" selected → show its alert sub-types as (red) cards.
        if (filterAxis === SEVERITY) {
          return (
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                <span style={{ width: 10, height: 10, borderRadius: 5, background: RED, alignSelf: 'center' }} />
                <h3 style={{ fontSize: 15, fontWeight: 800, color: NAVY, margin: 0 }}>Severity alerts</h3>
                <span style={{ fontSize: 13, color: SLATE }}>{data.alertRows.toLocaleString()} flagged review{data.alertRows === 1 ? '' : 's'} · counts are per type, so they can exceed this when a review hits more than one</span>
              </div>
              {data.alerts.length === 0 ? (
                <p style={{ fontSize: 13, color: SLATE }}>No severity alerts in this dataset.</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                  {data.alerts.map(a => {
                    const sub = data.subs.find(s => s.axis === 'attribute' && s.sub === a.tag)
                    const qs = `alert=${encodeURIComponent(a.tag)}`
                    const active = drill?.qs === qs
                    return (
                      <div key={a.tag}
                        onClick={() => { if (active) { setDrill(null) } else { setDrill({ qs, crumbs: ['Dimensions', 'Severity alert', a.tag] }) } }}
                        title={`View the ${a.count.toLocaleString()} review${a.count === 1 ? '' : 's'} flagged for ${dimSubLabel(a.tag)}`}
                        style={{ background: active ? '#fef2f2' : '#fff', border: '1px solid ' + (active ? RED : '#fecaca'), borderLeft: '4px solid ' + RED, boxShadow: active ? `0 0 0 1px ${RED}` : 'none', borderRadius: 12, padding: '13px 15px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8 }}
                        onMouseEnter={e => { if (!active) e.currentTarget.style.borderColor = '#fca5a5' }}
                        onMouseLeave={e => { if (!active) e.currentTarget.style.borderColor = '#fecaca' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <span style={{ fontSize: 13 }}>⚠</span>
                          <span style={{ fontSize: 14, fontWeight: 700, color: '#b91c1c', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dimSubLabel(a.tag)}</span>
                          <StarBadge avg={sub ? sub.avgRating : null} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span style={{ fontSize: 18, fontWeight: 800, color: RED }}>{a.count.toLocaleString()}</span>
                          <span style={{ fontSize: 12, color: SLATE }}>flagged · alert / crisis</span>
                          <span style={{ marginLeft: 'auto', color: active ? RED : SLATE, fontSize: 16 }}>›</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        }

        // Initial state: no dimension picked → show ONLY the pills above, with a
        // prompt here. Sub-dimension cards appear once a dimension pill is selected.
        if (!filterAxis) {
          return (
            <div style={{ padding: '20px 2px', fontSize: 13, color: SLATE }}>
              Pick a dimension above to explore its sub-dimensions.
            </div>
          )
        }

        // A sub-dimension is selected → shown as the compact pill row above the
        // comments; don't also render the full card grid here.
        if (filterSub) return null

        const sorted = [...data.subs].sort((x, y) => (y.rate - x.rate) || (y.count - x.count))
        const list = sorted.filter(s => s.axis === filterAxis && s.count >= MIN_SUB_COUNT)
        const focus = data.axes.find(x => x.axis === filterAxis)
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {focus ? (
                <>
                  <span style={{ width: 9, height: 9, borderRadius: 5, background: AXIS_COLOR[focus.axis as Axis] || SLATE, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>{focus.label}</span>
                  <span style={{ fontSize: 12, color: SLATE }}>· {Math.round(focus.rate)}% of reviews</span>
                  <StarBadge avg={focus.avgRating} size={11} />
                  <button
                    onClick={() => setDrill({ qs: `axis=${encodeURIComponent(focus.axis)}`, crumbs: ['Dimensions', focus.label] })}
                    title="Read every comment tagged anywhere on this dimension"
                    style={{ marginLeft: 'auto', background: 'transparent', border: 'none', fontSize: 12, fontWeight: 700, color: TEAL, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    Read all comments ›
                  </button>
                </>
              ) : (
                <>
                  <span style={{ fontSize: 11, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 1 }}>Sub-dimensions</span>
                  <span style={{ fontSize: 12, color: SLATE }}>across all dimensions · pick a chip to focus one</span>
                </>
              )}
            </div>

            {list.length === 0 ? (
              <p style={{ fontSize: 13, color: SLATE }}>No sub-dimensions with at least {MIN_SUB_COUNT} mentions in this dimension.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                {list.map(s => {
                  const c = AXIS_COLOR[s.axis as Axis] || SLATE
                  const qs = `axis=${encodeURIComponent(s.axis)}&sub=${encodeURIComponent(s.sub)}`
                  const active = drill?.qs === qs
                  const axisCount = data.axes.find(x => x.axis === s.axis)?.count || 0
                  // Sub-dimension share = % of the dimension's reviews that mention this sub
                  // (vs s.rate, which is % of ALL classified reviews). Rounded, no decimals.
                  const pctOfDim = axisCount ? Math.round(100 * s.count / axisCount) : 0
                  return (
                    <div key={s.axis + ':' + s.sub}
                      onClick={() => { if (active) { setDrill(null); setFilterSub('') } else { setFilterAxis(s.axis); setFilterSub(s.sub); setDrill({ qs, crumbs: ['Dimensions', axisLabelOf(s.axis), s.sub] }) } }}
                      title={`${dimSubLabel(s.sub)} — ${pctOfDim}% of ${axisLabelOf(s.axis)} mentions · ${s.count.toLocaleString()} review${s.count === 1 ? '' : 's'} · click to read them`}
                      style={{ background: '#fff', border: '1px solid ' + (active ? c : '#e2e8f0'), boxShadow: active ? `0 0 0 1px ${c}` : 'none', borderRadius: 12, padding: '13px 15px', cursor: 'pointer', display: 'flex', flexDirection: 'column', minHeight: 104 }}
                      onMouseEnter={e => { if (!active) e.currentTarget.style.borderColor = '#cbd5e1' }}
                      onMouseLeave={e => { if (!active) e.currentTarget.style.borderColor = '#e2e8f0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 5, background: c, flexShrink: 0 }} />
                        <span style={{ fontSize: 14, fontWeight: 700, color: NAVY, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dimSubLabel(s.sub)}</span>
                        <StarBadge avg={s.avgRating} />
                      </div>
                      {!filterAxis && <div style={{ fontSize: 10, fontWeight: 700, color: c, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>{axisLabelOf(s.axis)}</div>}
                      {s.posPct === null ? (
                        <div style={{ fontSize: 11, color: SLATE, marginBottom: 10 }}>No sentiment signal</div>
                      ) : (
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ display: 'flex', height: 7, borderRadius: 4, overflow: 'hidden', background: '#fee2e2' }}>
                            <div style={{ width: `${s.posPct}%`, background: GREEN }} />
                          </div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: sentimentColor(s.posPct), marginTop: 4 }}>{Math.round(s.posPct)}% positive</div>
                        </div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 'auto' }}>
                        <span style={{ fontSize: 18, fontWeight: 800, color: TEAL }}>{pctOfDim}%</span>
                        <span style={{ fontSize: 12, color: SLATE }}>of {axisLabelOf(s.axis).toLowerCase()} · {s.count.toLocaleString()}</span>
                        <span style={{ marginLeft: 'auto', color: active ? c : SLATE, fontSize: 16 }}>›</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })()}

      <p style={{ marginTop: 28, fontSize: 11, color: SLATE, fontStyle: 'italic' }}>
        Keyword-tier classification into a shared, consistent set of dimensions. Mention rate = % of classified reviews touching the dimension / sub-dimension; sentiment = share of polarised mentions that are positive. Pick a dimension chip — including ⚠ Severity — to open its cards, then click any card to read the comments behind it.
      </p>
    </div>
  )
}
