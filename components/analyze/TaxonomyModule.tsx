'use client'

// components/analyze/TaxonomyModule.tsx
// In-app tag-analytics view. Fetches the roll-up from
// /api/datasets/[id]/taxonomy and renders: KPIs, per-axis mention rates,
// top sub-buckets with sentiment, and severity alerts. The tags are produced
// by the keyword-tier classifier (lib/taxonomyClassify), run self-serve from
// here: the "Classify" button loops POST chunks until the dataset is done.

import { useCallback, useEffect, useState, type ReactElement, type CSSProperties } from 'react'
import LottieLoader from '@/components/ui/LottieLoader'

interface SubStat { axis: string; sub: string; count: number; rate: number; pos: number; neg: number; posPct: number | null }
interface TextField { field: string; label: string }
interface Rollup {
  classifiedRows: number
  withSignal: number
  axes: { axis: string; label: string; count: number; rate: number }[]
  subs: SubStat[]
  alerts: { tag: string; count: number }[]
  alertRows: number
  textFields: TextField[]
  defaultField: string | null
}

const TEAL = '#0F7173', ORANGE = '#e8622a', NAVY = '#0D2B45'
const GREEN = '#059669', AMBER = '#D97706', RED = '#DC2626', SLATE = '#8FA3AE'

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

function pillStyle(active: boolean, color: string): CSSProperties {
  return {
    fontSize: 11, fontWeight: 600, lineHeight: 1.3, padding: '2px 9px', borderRadius: 999,
    border: '1px solid ' + (active ? color : '#cbd5e1'),
    background: active ? color : '#fff',
    color: active ? '#fff' : NAVY,
    cursor: 'pointer', whiteSpace: 'nowrap',
  }
}

function sentimentColor(posPct: number | null): string {
  if (posPct === null) return SLATE
  if (posPct >= 66) return GREEN
  if (posPct >= 40) return AMBER
  return RED
}

function Pill({ posPct }: { posPct: number | null }) {
  if (posPct === null) return <span style={{ fontSize: 11, color: SLATE }}>—</span>
  const c = sentimentColor(posPct)
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: c, borderRadius: 10, padding: '2px 8px' }}>
      {posPct}% pos
    </span>
  )
}

interface DrillComment { text: string; rating: number | null; date: string | null; evidence: string[]; tags: { axis: string; sub: string }[] }

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
    if (e > s) out.push(<mark key={s} style={{ background: '#fef3c7', color: '#92400e', padding: '1px 3px', borderRadius: 3, borderBottom: '2px solid #f59e0b', fontWeight: 600 }}>{text.slice(s, e)}</mark>)
    last = e
    if (re.lastIndex < e) re.lastIndex = e              // skip past the expanded word so the next match can't overlap it
    if (m.index === re.lastIndex) re.lastIndex++
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export default function TaxonomyModule({ datasetId }: { datasetId: string }) {
  const [data, setData] = useState<Rollup | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Self-serve classifier state.
  const [classifying, setClassifying] = useState(false)
  const [progress, setProgress] = useState<{ scanned: number; total: number | null }>({ scanned: 0, total: null })
  const [classifyErr, setClassifyErr] = useState<string | null>(null)
  const [field, setField] = useState('')  // which column to classify (user pick)

  // Drill-down: clicking a sub-topic / alert opens the comments behind it.
  const [drill, setDrill] = useState<{ qs: string; crumbs: string[] } | null>(null)
  const [drillData, setDrillData] = useState<{ count: number; comments: DrillComment[] } | null>(null)
  const [drillLoading, setDrillLoading] = useState(false)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())  // long comments shown in full
  const [gridCols, setGridCols] = useState(2)  // comment grid column count
  const [filterAxis, setFilterAxis] = useState('')  // topic filter
  const [filterSub, setFilterSub] = useState('')    // sub-topic filter
  const toggleExpand = (i: number) => setExpanded(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n })

  useEffect(() => {
    if (!drill) { setDrillData(null); return }
    let alive = true
    setDrillLoading(true); setDrillData(null); setExpanded(new Set())
    fetch(`/api/datasets/${datasetId}/taxonomy/rows?${drill.qs}`)
      .then(r => r.json())
      .then(d => { if (alive) { setDrillData({ count: d.count ?? 0, comments: d.comments ?? [] }); setDrillLoading(false) } })
      .catch(() => { if (alive) { setDrillData({ count: 0, comments: [] }); setDrillLoading(false) } })
    return () => { alive = false }
  }, [drill, datasetId])

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
      const r = await fetch(`/api/datasets/${datasetId}/taxonomy`)
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
      const j: Rollup = await r.json()
      setData(j)
      setField(prev => prev || j.defaultField || '')
      setErr(null)
    } catch (e: any) {
      setErr(String(e.message || e))
    } finally {
      setLoading(false)
    }
  }, [datasetId])

  useEffect(() => { void load() }, [load])

  // Loop POST chunks until the dataset is fully classified, then refresh the
  // roll-up. Idempotent server-side, so an interrupted run resumes safely.
  const runClassifier = useCallback(async () => {
    setClassifying(true)
    setClassifyErr(null)
    setProgress({ scanned: 0, total: null })
    try {
      let cursor = 0
      for (;;) {
        const r = await fetch(`/api/datasets/${datasetId}/taxonomy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cursor, textField: field || undefined }),
        })
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
        const j = await r.json()
        setProgress({ scanned: j.nextCursor, total: j.totalRows ?? null })
        if (j.done || j.nextCursor <= cursor) break  // done, or no forward progress (safety)
        cursor = j.nextCursor
      }
      await load()
    } catch (e: any) {
      setClassifyErr(String(e.message || e))
    } finally {
      setClassifying(false)
    }
  }, [datasetId, load, field])

  // Reusable text-field picker (empty state + re-classify). Hidden when no
  // candidate text columns were detected (POST then falls back to review_text).
  const fieldPicker = (compact: boolean) =>
    data && data.textFields && data.textFields.length > 0 ? (
      <select
        value={field}
        onChange={e => setField(e.target.value)}
        aria-label="Field to classify"
        style={{ fontSize: compact ? 13 : 16, padding: compact ? '0 10px' : '9px 12px', height: compact ? '100%' : undefined, borderRadius: compact ? 10 : 8, border: '1px solid #cbd5e1', background: '#fff', color: NAVY, fontWeight: compact ? 700 : 500, minWidth: compact ? 0 : 280 }}
      >
        {data.textFields.map(f => <option key={f.field} value={f.field}>{f.label}</option>)}
      </select>
    ) : null

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
    return (
      <div style={{ padding: 40, maxWidth: 560 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: NAVY, marginBottom: 8 }}>No dimensions yet</h2>
        <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.5, marginBottom: 20 }}>
          This dataset hasn’t been sorted into dimensions yet. Run the classifier to tag every row by service, food, drinks, ambiance, and more — then this tab fills with mention rates, sentiment, and severity alerts. It’s free (no AI) and takes a few minutes on large datasets.
        </p>
        {data && data.textFields && data.textFields.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 6 }}>Field to classify</label>
            {fieldPicker(false)}
            <p style={{ fontSize: 12, color: SLATE, marginTop: 6 }}>The column holding the written feedback — e.g. the review or comment text.</p>
          </div>
        )}
        <button
          onClick={runClassifier}
          style={{ background: ORANGE, color: '#fff', border: 'none', borderRadius: 8, padding: '12px 22px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
        >
          Classify this dataset
        </button>
        {classifyErr && <p style={{ color: RED, fontSize: 13, marginTop: 14 }}>Classification failed: {classifyErr}</p>}
      </div>
    )
  }

  const maxAxis = Math.max(1, ...data.axes.map(a => a.rate))
  const kpi = (label: string, value: string | number, color: string) => (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 18px', minWidth: 150, textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginTop: 2 }}>{label}</div>
    </div>
  )

  return (
    <div style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      {/* KPIs */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 24 }}>
        {kpi('reviews classified', data.classifiedRows.toLocaleString(), TEAL)}
        {kpi('with a signal', `${Math.round(100 * data.withSignal / Math.max(1, data.classifiedRows))}%`, NAVY)}
        {kpi('severity alerts', data.alertRows, data.alertRows ? RED : SLATE)}
        <div style={{ marginLeft: 'auto', alignSelf: 'stretch', display: 'flex', gap: 8 }}>
          {fieldPicker(true)}
          <button
            onClick={runClassifier}
            title="Re-run the classifier (on the selected field) to pick up newly synced rows"
            style={{ background: '#fff', color: NAVY, border: '1px solid #e2e8f0', borderRadius: 10, padding: '0 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            Re-classify
          </button>
        </div>
      </div>
      {classifyErr && <p style={{ color: RED, fontSize: 13, marginTop: -12, marginBottom: 16 }}>Classification failed: {classifyErr}</p>}

      {/* Filter by topic / sub-topic — pills. Topics show first; pick one to reveal its sub-topics. */}
      <div style={{ marginBottom: 20, padding: '14px 16px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 1 }}>Dimension</span>
          {(filterAxis || drill) && (
            <button onClick={() => { setFilterAxis(''); setFilterSub(''); setDrill(null) }}
              style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: SLATE, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Clear ✕</button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {data.axes.map(a => {
            const active = filterAxis === a.axis
            return (
              <button key={a.axis}
                onClick={() => { if (active) { setFilterAxis(''); setFilterSub(''); setDrill(null) } else { setFilterAxis(a.axis); setFilterSub(''); setDrill(null) } }}
                style={pillStyle(active, NAVY)}>
                {a.label} <span style={{ opacity: 0.55, fontWeight: 600 }}>{a.rate}%</span>
              </button>
            )
          })}
        </div>
        {filterAxis && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 1, margin: '16px 0 8px' }}>Sub-dimension</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {data.subs.filter(s => s.axis === filterAxis).length === 0 && (
                <span style={{ fontSize: 13, color: SLATE }}>No sub-dimensions surfaced for this dimension.</span>
              )}
              {data.subs.filter(s => s.axis === filterAxis).map(s => {
                const active = filterSub === s.sub
                return (
                  <button key={s.sub}
                    onClick={() => { if (active) { setFilterSub(''); setDrill(null) } else { setFilterSub(s.sub); setDrill({ qs: `axis=${encodeURIComponent(filterAxis)}&sub=${encodeURIComponent(s.sub)}`, crumbs: ['Dimensions',filterAxis, s.sub] }) } }}
                    style={pillStyle(active, TEAL)}>
                    {s.sub} <span style={{ opacity: 0.55, fontWeight: 600 }}>{s.count}</span>
                  </button>
                )
              })}
            </div>
          </>
        )}
        {data.alerts.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 700, color: RED, textTransform: 'uppercase', letterSpacing: 1, margin: '16px 0 8px' }}>
              ⚠ Severity <span style={{ color: SLATE, fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>· flagged alert / crisis</span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {data.alerts.map(a => {
                const active = drill?.qs === `alert=${encodeURIComponent(a.tag)}`
                return (
                  <button key={a.tag}
                    onClick={() => { if (active) { setDrill(null) } else { setFilterAxis(''); setFilterSub(''); setDrill({ qs: `alert=${encodeURIComponent(a.tag)}`, crumbs: ['Dimensions','Severity alert', a.tag] }) } }}
                    style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.3, padding: '2px 9px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap', border: '1px solid ' + (active ? RED : '#fecaca'), background: active ? RED : '#fef2f2', color: active ? '#fff' : '#b91c1c' }}>
                    {a.tag} <span style={{ opacity: 0.6, fontWeight: 600 }}>{a.count}</span>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>

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
                return (
                  <div key={i} style={{ background: cardBg, border: '1px solid #e2e8f0', borderLeft: '4px solid ' + (accent || '#e2e8f0'), borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column' }}>
                    <p style={{ fontSize: 14, color: '#1e293b', lineHeight: 1.5, margin: '0 0 8px' }}>
                      {highlight(shownText, c.evidence)}
                      {isLong && <button onClick={() => toggleExpand(i)} style={{ background: 'transparent', border: 'none', color: TEAL, fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: 0 }}>{isOpen ? 'Show less' : 'Show more'}</button>}
                    </p>
                    {c.tags.length > 0 && (
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
                        {c.tags.map(t => {
                          const isActive = t.axis === filterAxis && t.sub === filterSub
                          return (
                            <span key={t.axis + ':' + t.sub} title={isActive ? 'The tag you filtered on' : `Also tagged ${t.axis} · ${t.sub}`}
                              style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: isActive ? '#ccfbf1' : '#f1f5f9', color: isActive ? '#0f766e' : '#64748b', border: '1px solid ' + (isActive ? '#5eead4' : '#e2e8f0') }}>
                              {t.axis} · {t.sub}
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

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Axes */}
        <div style={{ flex: '1 1 420px', minWidth: 360 }}>
          <h3 style={{ fontSize: 14, fontWeight: 800, color: NAVY, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            By axis <span style={{ color: SLATE, fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>· % of reviews</span>
          </h3>
          {data.axes.map(a => (
            <div key={a.axis} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                <span style={{ fontWeight: 600, color: NAVY }}>{a.label}</span>
                <span style={{ fontWeight: 700, color: TEAL }}>{a.rate}%</span>
              </div>
              <div style={{ background: '#eef2f4', borderRadius: 4, height: 14 }}>
                <div style={{ width: `${100 * a.rate / maxAxis}%`, height: 14, background: TEAL, borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </div>

        {/* Top sub-buckets */}
        <div style={{ flex: '1 1 420px', minWidth: 360 }}>
          <h3 style={{ fontSize: 14, fontWeight: 800, color: NAVY, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            Top sub-topics <span style={{ color: SLATE, fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>· rate &amp; sentiment</span>
          </h3>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
            {data.subs.slice(0, 18).map((s, i) => (
              <div
                key={s.axis + ':' + s.sub}
                onClick={() => { setFilterAxis(s.axis); setFilterSub(s.sub); setDrill({ qs: `axis=${encodeURIComponent(s.axis)}&sub=${encodeURIComponent(s.sub)}`, crumbs: ['Dimensions',s.axis, s.sub] }) }}
                title="View the comments tagged with this"
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderTop: i ? '1px solid #f1f5f9' : 'none', cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ flex: 1, fontSize: 13 }}>
                  <span style={{ color: SLATE }}>{s.axis} · </span>
                  <span style={{ fontWeight: 700, color: NAVY }}>{s.sub}</span>
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: TEAL, width: 48, textAlign: 'right' }}>{s.rate}%</span>
                <span style={{ width: 70, textAlign: 'right' }}><Pill posPct={s.posPct} /></span>
                <span style={{ color: SLATE, fontSize: 16 }}>›</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p style={{ marginTop: 28, fontSize: 11, color: SLATE, fontStyle: 'italic' }}>
        Keyword-tier classification into a shared, consistent set of dimensions. Mention rate = % of classified reviews touching the dimension/sub-dimension; sentiment = share of polarised mentions that are positive. Filter by dimension / sub-dimension above, or click any sub-dimension or alert, to read the comments behind it.
      </p>
    </div>
  )
}
