'use client'

// components/nav/ExportModal.tsx
// Export options modal with:
//   - Label mode: export name (field key) vs prompt text
//   - Format: Standard (1 row/response) vs Datanautix (1 row/open-ended answer)
//   - Section toggles (standard format only)

import { useState } from 'react'

interface Props {
  studyId:    string
  onClose:    () => void
  dateFrom?:  string
  dateTo?:    string
  sentiment?: string
  total?:     number
}

const HERMES = '#E8632A'
type LabelMode = 'key' | 'prompt'
type ExportFmt = 'standard' | 'datanautix'
type Section   = 'core' | 'openended' | 'psychographics' | 'demographics' | 'meta'

const SECTIONS: { key: Section; label: string; desc: string }[] = [
  { key: 'core',           label: 'Core scores',        desc: 'Sentiment, experience score, NPS, date, duration' },
  { key: 'openended',      label: 'Open-ended answers', desc: 'Follow-up Q1, Q3, Q4 verbatim text' },
  { key: 'psychographics', label: 'Psychographics',     desc: 'All psychographic survey answers' },
  { key: 'demographics',   label: 'Demographics',       desc: 'Age, gender, zip and other demographic fields' },
  { key: 'meta',           label: 'Meta / technical',   desc: 'User agent string and submission timestamp' },
]

export default function ExportModal({ studyId, onClose, dateFrom='', dateTo='', sentiment='', total=0 }: Props) {
  const [labelMode,  setLabelMode]  = useState<LabelMode>('key')
  const [exportFmt,  setExportFmt]  = useState<ExportFmt>('standard')
  const [sections,   setSections]   = useState<Set<Section>>(
    new Set(['core', 'openended', 'psychographics', 'demographics'] as Section[])
  )
  const [exporting,  setExporting]  = useState(false)
  const [error,      setError]      = useState('')

  const toggleSection = (s: Section) => {
    setSections(prev => {
      const next = new Set(prev)
      if (next.has(s) && next.size > 1) next.delete(s)
      else next.add(s)
      return next
    })
  }

  const handleExport = async () => {
    setExporting(true)
    setError('')
    try {
      const params = new URLSearchParams()
      params.set('export',    'csv')
      params.set('labelMode', labelMode)
      params.set('format',    exportFmt)
      if (exportFmt === 'standard') params.set('sections', Array.from(sections).join(','))
      if (dateFrom)  params.set('from',      dateFrom)
      if (dateTo)    params.set('to',        dateTo)
      if (sentiment) params.set('sentiment', sentiment)

      const res = await fetch(`/api/studies/${studyId}/responses?${params}`)
      if (!res.ok) { setError('Export failed — please try again.'); return }

      const blob = await res.blob()
      const text = await blob.slice(0, 50).text()
      if (text.startsWith('No data')) { setError('No responses match the current filters.'); return }

      const url = URL.createObjectURL(blob)
      const a   = document.createElement('a')
      a.href    = url
      const cd  = res.headers.get('Content-Disposition') || ''
      a.download = cd.match(/filename="([^"]+)"/)?.[1] || `export-${studyId}.csv`
      a.click()
      URL.revokeObjectURL(url)
      onClose()
    } catch {
      setError('Unexpected error — please try again.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-800">Export CSV</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5 max-h-[70vh] overflow-y-auto">

          {/* ── Column label toggle ─────────────────────────────────── */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Column headers</p>
            <div className="flex items-center bg-gray-100 rounded-xl p-1 w-fit">
              <button onClick={() => setLabelMode('key')}
                className={'text-sm font-medium px-4 py-1.5 rounded-lg transition-all ' +
                  (labelMode === 'key' ? 'text-white shadow-sm' : 'text-gray-500 hover:text-gray-700')}
                style={labelMode === 'key' ? { background: HERMES } : {}}>
                Export name
              </button>
              <button onClick={() => setLabelMode('prompt')}
                className={'text-sm font-medium px-4 py-1.5 rounded-lg transition-all ' +
                  (labelMode === 'prompt' ? 'text-white shadow-sm' : 'text-gray-500 hover:text-gray-700')}
                style={labelMode === 'prompt' ? { background: HERMES } : {}}>
                Prompt text
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              {labelMode === 'key'
                ? 'Uses field keys as headers — e.g. q1, q3, nps_score, personality_type'
                : 'Uses the actual question text as headers — e.g. "What prompted that rating?"'}
            </p>
          </div>

          {/* ── Format toggle ───────────────────────────────────────── */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Export format</p>
            <div className="flex flex-col gap-2">

              <label className={'flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ' +
                (exportFmt === 'standard' ? 'border-orange-300 bg-orange-50' : 'border-gray-200 hover:border-gray-300')}>
                <input type="radio" name="fmt" value="standard" checked={exportFmt === 'standard'}
                  onChange={() => setExportFmt('standard')} className="mt-0.5 accent-orange-500" />
                <div>
                  <p className="text-sm font-semibold text-gray-700">Standard</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    One row per response. All selected fields as columns side by side.
                  </p>
                </div>
              </label>

              <label className={'flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ' +
                (exportFmt === 'datanautix' ? 'border-orange-300 bg-orange-50' : 'border-gray-200 hover:border-gray-300')}>
                <input type="radio" name="fmt" value="datanautix" checked={exportFmt === 'datanautix'}
                  onChange={() => setExportFmt('datanautix')} className="mt-0.5 accent-orange-500" />
                <div>
                  <p className="text-sm font-semibold text-gray-700">Datanautix Ready</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    One row per open-ended answer. Each row repeats the closed-ended metadata
                    (sentiment, NPS, scores, demographics, psychographics) with the Prompt label identifying which question that row answers. Blank answers are excluded.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* ── Section toggles (standard only) ────────────────────── */}
          {exportFmt === 'standard' && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Include sections</p>
              <div className="flex flex-col gap-1.5">
                {SECTIONS.map(({ key, label, desc }) => (
                  <label key={key} className={'flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-all ' +
                    (sections.has(key) ? 'border-orange-200 bg-orange-50' : 'border-gray-100 hover:border-gray-200')}>
                    <input type="checkbox" checked={sections.has(key)} onChange={() => toggleSection(key)}
                      className="accent-orange-500 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-gray-700">{label}</p>
                      <p className="text-xs text-gray-400">{desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Active filters notice */}
          {(dateFrom || dateTo || sentiment) && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
              Active filters will be applied to this export
              {dateFrom && dateTo && ` · ${dateFrom} → ${dateTo}`}
              {sentiment && ` · ${sentiment}s only`}
            </div>
          )}

          {error && <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose}
            className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium transition-colors">
            Cancel
          </button>
          <button onClick={handleExport} disabled={exporting}
            className="px-5 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-50 hover:opacity-90 transition-all"
            style={{ background: HERMES }}>
            {exporting ? 'Exporting…' : '↓ Download CSV'}
          </button>
        </div>
      </div>
    </div>
  )
}
