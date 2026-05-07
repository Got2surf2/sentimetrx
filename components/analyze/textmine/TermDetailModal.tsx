'use client'

// components/analyze/textmine/TermDetailModal.tsx
//
// Click-a-word deep-dive modal (legacy Ana parity).
// Fetches /api/datasets/[id]/trending/[term] and renders:
//   - Total count + the term inline
//   - "Context" tags (top co-occurring words; clicking one swaps the modal
//     to that term — chained drill-down)
//   - Frequency-by-week chart (only when dataset has a date)
//   - Sample comments with the term highlighted

import { useEffect, useState, useCallback } from 'react'

const HERMES = '#E8632A'

interface Props {
  datasetId: string
  initialTerm: string
  onClose: () => void
}

interface ContextTag { word: string; count: number }
interface WeeklyBucket { week: string; count: number }

interface DetailData {
  term: string
  totalCount: number
  contexts: ContextTag[]
  weekly: WeeklyBucket[]
  comments: { text: string; date: string | null }[]
  sampleSize: number
  dateField: string | null
}

// Highlight occurrences of `term` (and its tokens, for bigrams) in text.
function highlightText(text: string, term: string): JSX.Element {
  const t = term.toLowerCase()
  // Build a regex that matches any occurrence — the whole bigram OR each unigram inside.
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const tokens = t.includes(' ') ? [t, ...t.split(/\s+/)] : [t]
  const re = new RegExp('\\b(' + tokens.map(escape).join('|') + ')\\b', 'gi')
  const parts = text.split(re)
  return (
    <>
      {parts.map((p, i) => {
        const isMatch = i % 2 === 1
        return isMatch
          ? <mark key={i} style={{ background: '#fed7aa', color: '#9a3412', padding: '0 2px', borderRadius: 2 }}>{p}</mark>
          : <span key={i}>{p}</span>
      })}
    </>
  )
}

function FrequencyChart({ buckets }: { buckets: WeeklyBucket[] }) {
  if (buckets.length < 2) return null
  const maxCount = Math.max(...buckets.map(b => b.count), 1)
  const W = 320, H = 80, P = 12
  const innerW = W - 2 * P
  const innerH = H - 2 * P
  const dx = innerW / Math.max(buckets.length - 1, 1)
  const points = buckets.map((b, i) => {
    const x = P + i * dx
    const y = P + innerH - (b.count / maxCount) * innerH
    return { x, y, ...b }
  })
  const path = points.map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ')
  return (
    <div>
      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">Frequency by week</p>
      <svg width={W} height={H} style={{ overflow: 'visible' }}>
        <path d={path} fill="none" stroke={HERMES} strokeWidth={2} />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill={HERMES}>
            <title>{p.week}: {p.count}</title>
          </circle>
        ))}
        {/* Axis labels */}
        <text x={P} y={H - 1} fontSize={9} fill="#9ca3af">{points[0].week.slice(5)}</text>
        <text x={W - P} y={H - 1} fontSize={9} fill="#9ca3af" textAnchor="end">{points[points.length - 1].week.slice(5)}</text>
      </svg>
    </div>
  )
}

export default function TermDetailModal({ datasetId, initialTerm, onClose }: Props) {
  const [term, setTerm] = useState(initialTerm)
  const [data, setData] = useState<DetailData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchTerm = useCallback(async (t: string) => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/datasets/' + datasetId + '/trending/' + encodeURIComponent(t), { cache: 'no-store' })
      if (!res.ok) { setError('Failed to load'); setLoading(false); return }
      const d = await res.json()
      setData(d)
    } catch {
      setError('Failed to load')
    } finally {
      setLoading(false)
    }
  }, [datasetId])

  useEffect(() => { fetchTerm(term) }, [term, fetchTerm])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="font-bold text-gray-800">
            {data ? data.totalCount.toLocaleString() : '…'}
            <span className="ml-2 inline-block px-2 py-0.5 rounded text-sm font-semibold" style={{ background: '#fff4ef', color: HERMES, border: '1px solid #fbd5c2' }}>
              {term}
            </span>
            <span className="ml-2 text-xs font-normal text-gray-400">comments mention this term</span>
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5 overflow-y-auto">
          {loading && <p className="text-sm text-gray-400">Loading…</p>}
          {error && <p className="text-sm text-red-500">{error}</p>}

          {data && !loading && (
            <>
              {/* Context tags */}
              {data.contexts.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-2">Often appears with</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.contexts.map(c => (
                      <button key={c.word} onClick={() => setTerm(c.word)}
                        className="text-xs font-semibold px-3 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 inline-flex items-center gap-1.5 transition-colors">
                        {c.word}
                        <span className="text-[10px] font-normal text-gray-400">{c.count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Weekly frequency */}
              {data.weekly.length >= 2 && <FrequencyChart buckets={data.weekly} />}

              {/* Comments */}
              {data.comments.length > 0 ? (
                <div>
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-2">Sample comments ({data.comments.length})</p>
                  <div className="flex flex-col gap-2">
                    {data.comments.map((c, i) => (
                      <div key={i} className="bg-gray-50 rounded-xl p-3 text-sm text-gray-700 leading-relaxed">
                        {highlightText(c.text, term)}
                        {c.date && <p className="text-[10px] text-gray-400 mt-1.5">{new Date(c.date).toLocaleDateString()}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              ) : data.totalCount === 0 ? (
                <p className="text-sm text-gray-400">No comments contain this term.</p>
              ) : null}

              {data.sampleSize > 0 && data.totalCount === 0 && (
                <p className="text-[10px] text-gray-400">Searched {data.sampleSize.toLocaleString()} sampled rows.</p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 flex justify-between items-center flex-shrink-0">
          <p className="text-[10px] text-gray-400">
            {data?.sampleSize ? 'Drawn from a sample of ' + data.sampleSize.toLocaleString() + ' rows' : ''}
          </p>
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-medium">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
