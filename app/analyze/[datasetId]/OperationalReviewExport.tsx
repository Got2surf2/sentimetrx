'use client'

import { useState } from 'react'

// Client control for the "Export operational review" download. Competitors are
// typed at generation time (the deck triggers a one-time live competitor pull),
// so this can't be a plain server-rendered <a href>. On click it navigates the
// browser to the operational-review-deck route, which streams the merged
// Operational Review PPTX (diligence framing + improvement detail + dimensions).
export default function OperationalReviewExport({ datasetId }: { datasetId: string }) {
  const [competitors, setCompetitors] = useState('')

  function onExport() {
    const c = competitors.trim()
    const qs = c ? `?competitors=${encodeURIComponent(c)}` : ''
    window.location.href = `/api/datasets/${datasetId}/operational-review-deck${qs}`
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={competitors}
        onChange={(e) => setCompetitors(e.target.value)}
        placeholder="Competitors (comma-separated, optional)"
        style={{ fontSize: '16px' }}
        className="w-64 rounded-md border border-gray-300 px-2 py-1 text-gray-900 placeholder:text-gray-400"
      />
      <button
        type="button"
        onClick={onExport}
        className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gray-700"
      >
        Export operational review
      </button>
    </div>
  )
}
