// components/nav/ExportModal.tsx
// Export options modal — used by both Responses and Analytics pages
'use client'

import { useState } from 'react'

interface Props {
  studyId:   string
  onClose:   () => void
  // current date filter to pre-populate
  dateFrom?: string
  dateTo?:   string
  // current sentiment filter (responses page)
  sentiment?: string
}

const HERMES = '#E8632A'

type Format   = 'flat' | 'nested' | 'raw'
type Section  = 'core' | 'openended' | 'psychographics' | 'demographics' | 'meta'

const FORMAT_INFO: Record<Format, { label: string; desc: string }> = {
  flat:   { label: 'Flat (recommended)',  desc: 'Human-readable column names, question text as headers, all data in one row per response' },
  nested: { label: 'Nested / grouped',    desc: 'Prefixed columns (psych_*, demo_*), good for programmatic processing' },
  raw:    { label: 'Raw JSON',            desc: 'Core fields + full payload as a JSON blob in one column' },
}

const SECTION_INFO: Record<Section, { label: string; desc: string }> = {
  core:            { label: 'Core scores',       desc: 'Response ID, date, duration, sentiment, experience score, NPS' },
  openended:       { label: 'Open-ended answers', desc: 'Follow-up Q1, Q3, Q4 verbatim text' },
  psychographics:  { label: 'Psychographics',    desc: 'All psychographic survey answers' },
  demographics:    { label: 'Demographics',      desc: 'Age, gender, zip and any other demographic fields' },
  meta:            { label: 'Meta / technical',  desc: 'User agent string and submission timestamp' },
}

export default function ExportModal({ studyId, onClose, dateFrom='', dateTo='', sentiment='' }: Props) {
  const [format,   setFormat]   = useState<Format>('flat')
  const [sections, setSections] = useState<Set<Section>>(
    new Set(['core', 'openended', 'psychographics', 'demographics'] as Section[])
  )
  const [exporting, setExporting] = useState(false)
  const [error,     setError]     = useState('')

  const toggleSection = (s: Section) => {
    setSections(prev => {
      const next = new Set(prev)
      if (next.has(s)) { if (next.size > 1) next.delete(s) } // keep at least one
      else next.add(s)
      return next
    })
  }

  const handleExport = async () => {
    setExporting(true)
    setError('')
    try {
      const params = new URLSearchParams()
      params.set('export',   'csv')
      params.set('format',   format)
      params.set('sections', Array.from(sections).join(','))
      if (dateFrom) params.set('from', dateFrom)
      if (dateTo)   params.set('to',   dateTo)
      if (sentiment) params.set('sentiment', sentiment)

      const res = await fetch(`/api/studies/${studyId}/responses?${params}`)
      if (!res.ok) { setError('Export failed — please try again.'); return }

      const blob = await res.blob()
      const text = await blob.text()
      if (text.startsWith('No data')) { setError('No responses match the current filters.'); return }

      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      // Filename comes from Content-Disposition header
      const cd   = res.headers.get('Content-Disposition') || ''
      const fn   = cd.match(/filename="([^"]+)"/)?.[1] || `export-${studyId}.csv`
      a.download = fn
      a.click()
      URL.revokeObjectURL(url)
      onClose()
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-800">Export CSV</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5">

          {/* Format */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Format</p>
            <div className="flex flex-col gap-2">
              {(Object.keys(FORMAT_INFO) as Format[]).map(f => (
                <label key={f} className={'flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ' +
                  (format === f ? 'border-orange-300 bg-orange-50' : 'border-gray-200 hover:border-gray-300')}>
                  <input type="radio" name="format" value={f} checked={format === f}
                    onChange={() => setFormat(f)} className="mt-0.5 accent-orange-500" />
                  <div>
                    <p className="text-sm font-medium text-gray-700">{FORMAT_INFO[f].label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{FORMAT_INFO[f].desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Sections — only relevant for flat/nested */}
          {format !== 'raw' && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Include sections</p>
              <div className="flex flex-col gap-1.5">
                {(Object.keys(SECTION_INFO) as Section[]).map(s => (
                  <label key={s} className={'flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-all ' +
                    (sections.has(s) ? 'border-orange-200 bg-orange-50' : 'border-gray-100 hover:border-gray-200')}>
                    <input type="checkbox" checked={sections.has(s)} onChange={() => toggleSection(s)}
                      className="accent-orange-500" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-700">{SECTION_INFO[s].label}</p>
                      <p className="text-xs text-gray-400">{SECTION_INFO[s].desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Active filters notice */}
          {(dateFrom || dateTo || sentiment) && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
              Export will respect your active filters
              {dateFrom && dateTo && ` (${dateFrom} → ${dateTo})`}
              {sentiment && ` · ${sentiment}s only`}
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
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
