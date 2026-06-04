'use client'

// components/analyze/TaxonomyModule.tsx
// In-app tag-analytics view. Fetches the roll-up from
// /api/datasets/[id]/taxonomy and renders: KPIs, per-axis mention rates,
// top sub-buckets with sentiment, and severity alerts. The tags are produced
// by the keyword-tier classifier (lib/taxonomyClassify), run self-serve from
// here: the "Classify" button loops POST chunks until the dataset is done.

import { useCallback, useEffect, useState } from 'react'
import LottieLoader from '@/components/ui/LottieLoader'

interface SubStat { axis: string; sub: string; count: number; rate: number; pos: number; neg: number; posPct: number | null }
interface Rollup {
  classifiedRows: number
  withSignal: number
  axes: { axis: string; label: string; count: number; rate: number }[]
  subs: SubStat[]
  alerts: { tag: string; count: number }[]
  alertRows: number
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

export default function TaxonomyModule({ datasetId }: { datasetId: string }) {
  const [data, setData] = useState<Rollup | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Self-serve classifier state.
  const [classifying, setClassifying] = useState(false)
  const [progress, setProgress] = useState<{ scanned: number; total: number | null }>({ scanned: 0, total: null })
  const [classifyErr, setClassifyErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/datasets/${datasetId}/taxonomy`)
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
      setData(await r.json())
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
          body: JSON.stringify({ cursor }),
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
  }, [datasetId, load])

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}><LottieLoader size={120} message="Loading taxonomy…" /></div>
  if (err) return <div style={{ padding: 32, color: RED }}>Couldn’t load taxonomy: {err}</div>

  if (classifying) {
    const pct = progress.total ? Math.min(100, Math.round(100 * progress.scanned / progress.total)) : null
    return (
      <div style={{ padding: 40, maxWidth: 560 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: NAVY, marginBottom: 8 }}>Classifying reviews…</h2>
        <p style={{ fontSize: 14, color: '#475569', marginBottom: 16 }}>
          {progress.scanned.toLocaleString()}{progress.total ? ` of ${progress.total.toLocaleString()}` : ''} reviews scanned. Keep this tab open — you can leave it running.
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
          This dataset hasn’t been classified against the 7-axis taxonomy yet. Run the classifier to tag every review by touchpoint, attribute, product, ambiance, and more — then this tab fills with mention rates, sentiment, and severity alerts. It’s free (no AI) and takes a few minutes on large datasets.
        </p>
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
        <button
          onClick={runClassifier}
          title="Re-run the classifier to pick up newly synced reviews"
          style={{ marginLeft: 'auto', alignSelf: 'stretch', background: '#fff', color: NAVY, border: '1px solid #e2e8f0', borderRadius: 10, padding: '0 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
        >
          Re-classify
        </button>
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
              <div key={s.axis + ':' + s.sub} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderTop: i ? '1px solid #f1f5f9' : 'none' }}>
                <span style={{ flex: 1, fontSize: 13 }}>
                  <span style={{ color: SLATE }}>{s.axis} · </span>
                  <span style={{ fontWeight: 700, color: NAVY }}>{s.sub}</span>
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: TEAL, width: 48, textAlign: 'right' }}>{s.rate}%</span>
                <span style={{ width: 70, textAlign: 'right' }}><Pill posPct={s.posPct} /></span>
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
              <div key={a.tag} style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 14px' }}>
                <span style={{ fontWeight: 700, color: RED }}>{a.tag}</span>
                <span style={{ color: '#991b1b', marginLeft: 8, fontWeight: 700 }}>{a.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p style={{ marginTop: 28, fontSize: 11, color: SLATE, fontStyle: 'italic' }}>
        Keyword-tier classification on the shared 7-axis taxonomy. Mention rate = % of classified reviews touching the axis/sub; sentiment = share of polarised mentions that are positive.
      </p>
    </div>
  )
}
