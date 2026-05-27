'use client'

import { useEffect, useState } from 'react'

interface RowVM {
  row_id: number
  row_index: number
  review_text: string
  review_rating: number | null
  unit_name: string
  city: string
  state: string
  legacy_tags: string[]
  taxonomy: {
    axis_touchpoint: string[]
    axis_attribute:  string[]
    axis_product:    string[]
    axis_beverage:   string[]
    axis_ambiance:   string[]
    axis_context:    string[]
    axis_outcome:    string[]
    alert_tags:      string[]
    assertions:      Array<{ axis: string; sub: string; item?: string; polarity: string; confidence: number; severity: string; evidence?: string; source?: 'keyword' | 'llm' | 'both' }>
    classified_by:   string | null
    model_used:      string | null
    prompt_version:  string | null
    created_at:      string
  } | null
}

interface ApiResponse {
  dataset: { id: string; name: string; brand_tag: string | null; row_count: number; created_at: string }
  counts:  { total_rows: number; classified: number; alerts: number }
  page: number
  pageSize: number
  rows: RowVM[]
}

const AXIS_COLOR: Record<string, string> = {
  touchpoint: 'bg-indigo-100 text-indigo-900 border-indigo-200',
  attribute:  'bg-blue-100 text-blue-900 border-blue-200',
  product:    'bg-emerald-100 text-emerald-900 border-emerald-200',
  beverage:   'bg-amber-100 text-amber-900 border-amber-200',
  ambiance:   'bg-violet-100 text-violet-900 border-violet-200',
  context:    'bg-slate-100 text-slate-900 border-slate-200',
  outcome:    'bg-rose-100 text-rose-900 border-rose-200',
}

const POL_COLOR: Record<string, string> = {
  pos: 'text-emerald-700',
  neg: 'text-rose-700',
  neu: 'text-slate-600',
}

const SEV_BADGE: Record<string, string> = {
  alert:  'bg-orange-500 text-white',
  crisis: 'bg-red-600 text-white',
  normal: '',
}

// Per-source visual cue:
//   keyword (Tier 1)  → solid border (default)
//   llm (Tier 2)      → dashed border + tiny "ai" superscript
//   both              → solid border + ✓ tick to show cross-tier confirmation
const SOURCE_STYLE: Record<string, string> = {
  keyword: 'border-solid',
  llm:     'border-dashed',
  both:    'border-solid ring-1 ring-inset ring-emerald-400/40',
}
const SOURCE_BADGE: Record<string, string> = {
  keyword: '',
  llm:     'ⁱ',
  both:    '✓',
}
const SOURCE_LABEL: Record<string, string> = {
  keyword: 'keyword tier',
  llm:     'AI tier',
  both:    'keyword + AI (confirmed by both tiers)',
}

// Case-insensitive substring locate. Returns -1 if not found.
function findEvidenceIndex(text: string, evidence: string): number {
  if (!evidence) return -1
  return text.toLowerCase().indexOf(evidence.toLowerCase())
}

// Wrap the matched evidence span in a <mark>. If no match, return plain text.
function renderWithHighlight(text: string, evidence: string | null): React.ReactNode {
  if (!evidence) return text
  const idx = findEvidenceIndex(text, evidence)
  if (idx < 0) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-amber-200 text-amber-950 rounded px-0.5">{text.slice(idx, idx + evidence.length)}</mark>
      {text.slice(idx + evidence.length)}
    </>
  )
}

export default function TaxonomyPilotClient({ datasetId }: { datasetId: string }) {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(25)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  // Cross-highlight: which assertion's evidence to highlight in the review.
  const [hover, setHover] = useState<{ rowId: number; evidence: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/admin/taxonomy-pilot/${datasetId}?page=${page}&pageSize=${pageSize}`)
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<ApiResponse>
      })
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(e.message ?? String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [datasetId, page, pageSize])

  const toggleExpand = (rowId: number) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return next
    })
  }

  if (loading && !data) return <div className="p-8 text-slate-500">Loading…</div>
  if (error) return <div className="p-8 text-rose-700">Error: {error}</div>
  if (!data) return null

  const totalPages = Math.max(1, Math.ceil((data.counts.total_rows ?? 0) / pageSize))

  return (
    <div className="max-w-7xl mx-auto px-6 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">{data.dataset.name}</h1>
        <div className="mt-1 text-sm text-slate-600 flex gap-4 flex-wrap">
          <span>Total rows: <strong>{data.counts.total_rows.toLocaleString()}</strong></span>
          <span>Classified: <strong>{data.counts.classified.toLocaleString()}</strong> ({((data.counts.classified / Math.max(1, data.counts.total_rows)) * 100).toFixed(1)}%)</span>
          <span>Alert/Crisis rows: <strong className="text-orange-700">{data.counts.alerts.toLocaleString()}</strong></span>
          {data.dataset.brand_tag && <span>Brand: <strong>{data.dataset.brand_tag}</strong></span>}
        </div>
        <div className="mt-2 text-[11px] text-slate-500 flex gap-3 flex-wrap items-center">
          <span className="font-semibold">Chip legend:</span>
          <span className="inline-flex items-center gap-1"><span className="px-1.5 py-0.5 rounded border border-solid border-slate-400 bg-slate-100">solid</span> = keyword tier</span>
          <span className="inline-flex items-center gap-1"><span className="px-1.5 py-0.5 rounded border border-dashed border-slate-400 bg-slate-100">dashed<span className="ml-1 opacity-60">ⁱ</span></span> = AI tier only</span>
          <span className="inline-flex items-center gap-1"><span className="px-1.5 py-0.5 rounded border border-solid border-slate-400 bg-slate-100 ring-1 ring-inset ring-emerald-400/40">solid + ring<span className="ml-1 opacity-60">✓</span></span> = both tiers confirm</span>
        </div>
      </div>

      <div className="flex justify-between items-center mb-3">
        <div className="text-sm text-slate-500">
          Page {data.page} of {totalPages} · rows {((data.page - 1) * pageSize) + 1}–{Math.min(data.counts.total_rows, data.page * pageSize)} of {data.counts.total_rows.toLocaleString()}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1 || loading}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded bg-white disabled:opacity-40"
          >Prev</button>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages || loading}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded bg-white disabled:opacity-40"
          >Next</button>
        </div>
      </div>

      <div className="space-y-4">
        {data.rows.map(row => {
          const isOpen = expanded.has(row.row_id)
          const text = row.review_text || ''
          const hoverEvidence = hover?.rowId === row.row_id ? hover.evidence : null
          // Truncation is governed by manual Show more only — auto-expanding on
          // chip hover causes a layout-shift flicker loop because chips sit
          // below the text and get pushed off the cursor when the text grows.
          // If the evidence is in the truncated tail, the highlight just won't
          // render until the user expands manually.
          const truncated = text.length > 240 && !isOpen
          const display = truncated ? text.slice(0, 240) + '…' : text
          return (
            <div key={row.row_id} className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="text-xs text-slate-500">
                  Row {row.row_index + 1} · {row.unit_name || '—'} · {row.city}, {row.state}
                  {row.review_rating !== null && <span className="ml-2">{'★'.repeat(row.review_rating)}{'☆'.repeat(5 - row.review_rating)}</span>}
                </div>
                {row.taxonomy?.alert_tags && row.taxonomy.alert_tags.length > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide ${row.taxonomy.assertions.some(a => a.severity === 'crisis') ? SEV_BADGE.crisis : SEV_BADGE.alert}`}>
                    {row.taxonomy.assertions.some(a => a.severity === 'crisis') ? 'Crisis' : 'Alert'}
                  </span>
                )}
              </div>

              <div className="text-sm text-slate-800 mb-3 whitespace-pre-wrap">
                {renderWithHighlight(display, hoverEvidence)}
                {text.length > 240 && (
                  <button onClick={() => toggleExpand(row.row_id)} className="ml-2 text-xs text-blue-700 hover:underline">
                    {isOpen ? 'Show less' : 'Show more'}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Legacy tags ({row.legacy_tags.length})</div>
                  <div className="flex flex-wrap gap-1">
                    {row.legacy_tags.length === 0 && <span className="text-xs text-slate-400">—</span>}
                    {row.legacy_tags.map((t, i) => (
                      <span key={i} className="text-[11px] px-1.5 py-0.5 rounded border border-slate-300 bg-slate-50 text-slate-700">{t}</span>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                    Sentimetrx assertions
                    {row.taxonomy ? <span className="ml-1 text-slate-400">({row.taxonomy.assertions.length})</span> : <span className="ml-1 text-amber-700">(not classified)</span>}
                  </div>
                  {row.taxonomy ? (
                    <div className="flex flex-wrap gap-1">
                      {row.taxonomy.assertions.length === 0 && <span className="text-xs text-slate-400">no signal</span>}
                      {row.taxonomy.assertions.map((a, i) => {
                        const source = a.source ?? 'llm'
                        const tipLines = [
                          `${a.axis}:${a.sub}${a.item ? ' · ' + a.item : ''}`,
                          `${a.polarity === 'pos' ? 'positive' : a.polarity === 'neg' ? 'negative' : 'neutral'} · ${a.severity} · confidence ${(a.confidence * 100).toFixed(0)}%`,
                          `source: ${SOURCE_LABEL[source]}`,
                        ]
                        if (a.evidence) tipLines.push('', `"${a.evidence}"`)
                        return (
                          <span
                            key={i}
                            className={`text-[11px] px-1.5 py-0.5 rounded border cursor-help transition-shadow ${AXIS_COLOR[a.axis] || 'bg-slate-100 text-slate-800 border-slate-200'} ${SOURCE_STYLE[source]} ${hover?.rowId === row.row_id && hover?.evidence === a.evidence ? 'ring-2 ring-amber-300' : ''}`}
                            title={tipLines.join('\n')}
                            onMouseEnter={() => { if (a.evidence) setHover({ rowId: row.row_id, evidence: a.evidence }) }}
                            onMouseLeave={() => setHover(prev => (prev?.rowId === row.row_id && prev?.evidence === a.evidence ? null : prev))}
                          >
                            <span className="font-mono opacity-70">{a.axis[0]}</span>{':'}<strong>{a.sub}</strong>
                            {a.item && <span className="text-slate-600">·{a.item}</span>}
                            <span className={`ml-1 ${POL_COLOR[a.polarity] || ''}`}>{a.polarity === 'pos' ? '+' : a.polarity === 'neg' ? '−' : '·'}</span>
                            {SOURCE_BADGE[source] && (
                              <span className="ml-1 text-[9px] opacity-60">{SOURCE_BADGE[source]}</span>
                            )}
                            {a.severity !== 'normal' && (
                              <span className={`ml-1 text-[9px] px-1 rounded ${SEV_BADGE[a.severity] || ''}`}>{a.severity}</span>
                            )}
                          </span>
                        )
                      })}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">Run classifier to populate</span>
                  )}
                </div>
              </div>

              {row.taxonomy && (
                <div className="mt-2 text-[10px] text-slate-400 font-mono">
                  {row.taxonomy.classified_by} · prompt {row.taxonomy.prompt_version}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
