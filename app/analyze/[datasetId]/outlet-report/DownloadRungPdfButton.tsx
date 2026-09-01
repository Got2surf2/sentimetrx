'use client'

// "Download PDF" for a rolled-up hierarchy rung (Network / Region / District).
// Same POST-the-page's-data contract as DownloadPdfButton: the server page
// computed the HierarchyReport, serialized the document payload, and this
// button just posts it back to be typeset. Replaces the print dialog
// (2026-09-02 — the last "print to PDF" surface).

import { useState } from 'react'
import type { HierarchyPdfPayload } from '@/lib/outletPdfPayload'

export default function DownloadRungPdfButton({ datasetId, payload }: { datasetId: string; payload: HierarchyPdfPayload }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function download() {
    setBusy(true); setFailed(false)
    try {
      const res = await fetch(`/api/datasets/${datasetId}/hierarchy-report-pdf`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(String(res.status))
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = `${(payload.name || 'Network').replace(/[^a-z0-9]+/gi, '_')}_${(payload.levelLabel || 'Rollup').replace(/[^a-z0-9]+/gi, '_')}_Report.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => { void download() }}
      disabled={busy}
      aria-busy={busy}
      className={`rounded-md px-3 py-1.5 text-sm font-semibold text-white ${busy ? 'cursor-not-allowed bg-gray-400' : 'bg-gray-800 hover:bg-gray-700'}`}
    >
      {busy ? 'Building PDF…' : failed ? 'Download PDF — retry' : 'Download PDF'}
    </button>
  )
}
