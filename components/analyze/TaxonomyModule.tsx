'use client'

// components/analyze/TaxonomyModule.tsx
// In-app tag-analytics view. Fetches the roll-up from
// /api/datasets/[id]/taxonomy and renders: KPIs, per-axis mention rates,
// top sub-buckets with sentiment, and severity alerts. The tags are produced
// by the keyword-tier classifier (lib/taxonomyClassify), run self-serve from
// here: the "Classify" button loops POST chunks until the dataset is done.

import { useCallback, useEffect, useState, type ReactElement } from 'react'
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

interface DrillComment { text: string; rating: number | null; date: string | null; evidence: string[] }

function escapeRE(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

/** Bold the matched-evidence phrases inside a comment so the demo shows WHY it was tagged. */
function highlight(text: string, phrases: string[]): Array<string | ReactElement> {
  const cleaned = [...new Set(phrases.map(p => p.trim()).filter(p => p.length >= 2))].sort((a, b) => b.length - a.length)
  if (!cleaned.length) return [text]
  let re: RegExp
  try { re = new RegExp('(' + cleaned.map(escapeRE).join('|') + ')', 'gi') } catch { return [text] }
  const out: Array<string | ReactElement> = []
  let last = 0, m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<mark key={m.index} style={{ background: '#fff3cd', padding: '0 2px', borderRadius: 3 }}>{m[0]}</mark>)
    last = m.index + m[0].length
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
  const [drill, setDrill] = useState<{ qs: string; label: string } | null>(null)
  const [drillData, setDrillData] = useState<{ count: number; comments: DrillComment[] } | null>(null)
  const [drillLoading, setDrillLoading] = useState(false)

  useEffect(() => {
    if (!drill) { setDrillData(null); return }
    let alive = true
    setDrillLoading(true); setDrillData(null)
    fetch(`/api/datasets/${datasetId}/taxonomy/rows?${drill.qs}`)
      .then(r => r.json())
      .then(d => { if (alive) { setDrillData({ count: d.count ?? 0, comments: d.comments ?? [] }); setDrillLoading(false) } })
      .catch(() => { if (alive) { setDrillData({ count: 0, comments: [] }); setDrillLoading(false) } })
    return () => { alive = false }
  }, [drill, datasetId])

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

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}><LottieLoader size={120} message="Loading taxonomy…" /></div>
  if (err) return <div style={{ padding: 32, color: RED }}>Couldn’t load taxonomy: {err}</div>

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
        <h2 style={{ fontSize: 20, fontWeight: 800, color: NAVY, marginBottom: 8 }}>No taxonomy yet</h2>
        <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.5, marginBottom: 20 }}>
          This dataset hasn’t been classified against the 7-axis taxonomy yet. Run the classifier to tag every row by touchpoint, attribute, product, ambiance, and more — then this tab fills with mention rates, sentiment, and severity alerts. It’s free (no AI) and takes a few minutes on large datasets.
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
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 18px', minWidth: 150 }}>
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
                onClick={() => setDrill({ qs: `axis=${encodeURIComponent(s.axis)}&sub=${encodeURIComponent(s.sub)}`, label: `${s.axis} · ${s.sub}` })}
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

      {/* Alerts */}
      {data.alerts.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 800, color: RED, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            ⚠ Severity alerts <span style={{ color: SLATE, fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>· reviews flagged alert / crisis</span>
          </h3>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {data.alerts.map(a => (
              <div
                key={a.tag}
                onClick={() => setDrill({ qs: `alert=${encodeURIComponent(a.tag)}`, label: a.tag })}
                title="View the flagged comments"
                style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 14px', cursor: 'pointer' }}
              >
                <span style={{ fontWeight: 700, color: RED }}>{a.tag}</span>
                <span style={{ color: '#991b1b', marginLeft: 8, fontWeight: 700 }}>{a.count}</span>
                <span style={{ color: '#fca5a5', marginLeft: 6 }}>›</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p style={{ marginTop: 28, fontSize: 11, color: SLATE, fontStyle: 'italic' }}>
        Keyword-tier classification on the shared 7-axis taxonomy. Mention rate = % of classified reviews touching the axis/sub; sentiment = share of polarised mentions that are positive. Click any sub-topic or alert to read the comments behind it.
      </p>

      {/* Comment drill-down drawer */}
      {drill && (
        <>
          <div onClick={() => setDrill(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', zIndex: 40 }} />
          <div style={{ position: 'fixed', top: 0, right: 0, height: '100%', width: 'min(520px, 92vw)', background: '#fff', boxShadow: '-8px 0 24px rgba(0,0,0,0.12)', zIndex: 41, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: SLATE, textTransform: 'uppercase', letterSpacing: 1 }}>Comments</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: NAVY }}>{drill.label}</div>
                {drillData && <div style={{ fontSize: 12, color: SLATE, marginTop: 2 }}>{drillData.count.toLocaleString()} tagged{drillData.count > drillData.comments.length ? ` · showing ${drillData.comments.length}` : ''}</div>}
              </div>
              <button onClick={() => setDrill(null)} style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, width: 32, height: 32, fontSize: 18, cursor: 'pointer', color: NAVY }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              {drillLoading && <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}><LottieLoader size={90} message="Loading comments…" /></div>}
              {!drillLoading && drillData && drillData.comments.length === 0 && (
                <p style={{ color: SLATE, fontSize: 13, padding: 16 }}>No comments found for this tag.</p>
              )}
              {!drillLoading && drillData && drillData.comments.map((c, i) => (
                <div key={i} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                    {c.rating != null && <span style={{ fontSize: 12, fontWeight: 700, color: AMBER }}>★ {c.rating}</span>}
                    {c.date && <span style={{ fontSize: 12, color: SLATE }}>{c.date}</span>}
                  </div>
                  <p style={{ fontSize: 14, color: '#1e293b', lineHeight: 1.5, margin: 0 }}>{highlight(c.text, c.evidence)}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
