'use client'

// Ad-hoc report prompt: the user describes exactly what they want, picks a
// format, and Ana writes a focused report over this dataset (or collection).
// POSTs /api/datasets/[id]/ad-hoc-report and downloads/opens the result.

import { useState } from 'react'
import LottieLoader from '@/components/ui/LottieLoader'

export default function AdHocReportModal({ datasetId, datasetName, filters, onClose }: {
  datasetId: string
  datasetName: string
  filters?: Record<string, unknown>   // in-view scope; omit for full-dataset
  onClose: () => void
}) {
  const [prompt, setPrompt] = useState('')
  const [format, setFormat] = useState<'pdf' | 'html'>('pdf')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function generate() {
    const p = prompt.trim()
    if (!p || busy) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/datasets/' + datasetId + '/ad-hoc-report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: p, format, filters }),
      })
      if (!res.ok) {
        const d = await res.json().catch(function() { return {} })
        setError((d as { error?: string }).error || 'Could not generate the report.'); setBusy(false); return
      }
      if (format === 'html') {
        const html = await res.text()
        const w = window.open('', '_blank')
        if (w) { w.document.open(); w.document.write(html); w.document.close() }
      } else {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = (datasetName || 'Report').replace(/[^\w.-]+/g, '_') + '_Report.pdf'
        a.click()
        URL.revokeObjectURL(url)
      }
      setBusy(false); onClose()
    } catch { setError('Network error generating the report.'); setBusy(false) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(15,23,42,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={function(e) { e.stopPropagation() }} style={{ width: '100%', maxWidth: 520, background: 'white', borderRadius: 16, padding: 22, color: '#111827', boxShadow: '0 25px 60px rgba(0,0,0,.3)' }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>📊 Ad-hoc report</div>
        <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 14px' }}>
          Describe exactly what you want. Ana writes a focused report from {filters ? 'the data currently in view' : 'this data'} — grounded in the rows, nothing invented.
        </p>
        <textarea
          value={prompt}
          onChange={function(e) { setPrompt(e.target.value) }}
          disabled={busy}
          rows={4}
          placeholder={'e.g. Summarize the top 5 complaints about wait times, with a count and one verbatim quote for each — and what would most improve the rating.'}
          style={{ width: '100%', boxSizing: 'border-box', fontSize: 16, lineHeight: 1.5, padding: '10px 12px', borderRadius: 10, border: '1px solid #d1d5db', resize: 'vertical', fontFamily: 'inherit' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>Format:</span>
          {(['pdf', 'html'] as const).map(function(f) {
            const active = format === f
            return (
              <button key={f} disabled={busy} onClick={function() { setFormat(f) }}
                style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 8, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit',
                  border: '1px solid ' + (active ? '#0f766e' : '#d1d5db'), background: active ? '#ecfdf5' : 'white', color: active ? '#0f766e' : '#6b7280' }}>
                {f.toUpperCase()}
              </button>
            )
          })}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} disabled={busy} style={{ fontSize: 13, fontWeight: 600, color: '#6b7280', background: 'transparent', border: 'none', cursor: busy ? 'default' : 'pointer', padding: '6px 10px' }}>Cancel</button>
          <button onClick={function() { void generate() }} disabled={busy || !prompt.trim()}
            style={{ fontSize: 13, fontWeight: 700, color: 'white', background: (busy || !prompt.trim()) ? '#9ca3af' : '#0f766e', border: 'none', borderRadius: 10, padding: '8px 18px', cursor: (busy || !prompt.trim()) ? 'default' : 'pointer', fontFamily: 'inherit' }}>
            {busy ? 'Writing…' : 'Generate'}
          </button>
        </div>
        {error && <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 10 }}>{error}</div>}
        {busy && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginTop: 16 }}>
            <LottieLoader size={64} />
            <span style={{ fontSize: 12, color: '#6b7280' }}>Ana is reading the data and writing your report…</span>
          </div>
        )}
      </div>
    </div>
  )
}
