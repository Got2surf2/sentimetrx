'use client'

// components/analyze/textmine/TrendingWords.tsx
//
// Top words/phrases for a dataset. Each pill is clickable → opens
// TermDetailModal for a deep-dive (count, contexts, frequency, comments).

import { useEffect, useState } from 'react'
import TermDetailModal from './TermDetailModal'

const HERMES = '#E8632A'

interface Term { word: string; count: number }

interface Props {
  datasetId: string
}

export default function TrendingWords({ datasetId }: Props) {
  const [terms, setTerms] = useState<Term[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openTerm, setOpenTerm] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function fetchData() {
      try {
        const res = await fetch('/api/datasets/' + datasetId + '/trending?limit=24', { cache: 'no-store' })
        if (!res.ok) { if (!cancelled) { setError('Failed to load'); setLoading(false) } ; return }
        const data = await res.json()
        if (!cancelled) { setTerms(data.terms || []); setLoading(false) }
      } catch {
        if (!cancelled) { setError('Failed to load'); setLoading(false) }
      }
    }
    fetchData()
    return () => { cancelled = true }
  }, [datasetId])

  if (loading) return <div className="text-xs text-gray-400 px-1 py-2">Loading top terms…</div>
  if (error) return <div className="text-xs text-red-500 px-1 py-2">{error}</div>
  if (terms.length === 0) return null

  const maxCount = terms[0].count
  return (
    <>
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-800">Top words & phrases</h3>
          <span className="text-[10px] text-gray-400">Click any term to drill in</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {terms.map(t => {
            const intensity = t.count / maxCount
            return (
              <button key={t.word} onClick={() => setOpenTerm(t.word)}
                className="text-xs font-semibold px-3 py-1.5 rounded-full inline-flex items-center gap-1.5 transition-colors hover:opacity-80"
                style={{
                  background: 'rgba(232,99,42,' + (0.06 + intensity * 0.16).toFixed(2) + ')',
                  color: HERMES,
                  border: '1px solid rgba(232,99,42,' + (0.15 + intensity * 0.25).toFixed(2) + ')',
                }}>
                {t.word}
                <span className="text-[10px] font-normal" style={{ color: HERMES, opacity: 0.7 }}>{t.count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {openTerm && (
        <TermDetailModal datasetId={datasetId} initialTerm={openTerm} onClose={() => setOpenTerm(null)} />
      )}
    </>
  )
}
