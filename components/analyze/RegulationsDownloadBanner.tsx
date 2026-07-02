'use client'

// components/analyze/RegulationsDownloadBanner.tsx
// Shows download progress for regulations.gov datasets and auto-resumes downloading.
// Renders at the top of the settings/analyze page for source=regulations datasets.

import { useState, useEffect, useRef } from 'react'

const HERMES = '#E8632A'

interface Props {
  datasetId: string
  description: string
}

export default function RegulationsDownloadBanner({ datasetId, description }: Props) {
  var meta: any = null
  try { meta = JSON.parse(description) } catch {}

  var [status, setStatus] = useState((meta?.download_status) || 'downloading')
  var [comments, setComments] = useState(0)
  var [page, setPage] = useState(meta?.next_page || 1)
  var [error, setError] = useState('')
  var [totalPages, setTotalPages] = useState(Math.max(Math.ceil((meta?.comment_count || 100) / 10), 1))
  var [useSearch, setUseSearch] = useState(meta?.use_search || false)
  var running = useRef(false)

  useEffect(function() {
    if (!meta?.docket_id || status !== 'downloading' || running.current) return
    running.current = true

    async function downloadLoop() {
      var p = page
      var total = comments
      var maxPage = totalPages

      while (p <= maxPage) {
        try {
          var res = await fetch('/api/regulations-sources/download-comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataset_id: datasetId, docket_id: meta.docket_id, page: p, use_search: useSearch }),
          })
          var text = await res.text()
          var data: any
          try { data = JSON.parse(text) } catch { throw new Error('Server error: ' + text.slice(0, 200)) }
          if (!res.ok) throw new Error(data.error || 'Download failed')

          total += data.inserted || 0
          setComments(total)
          if (data.usedSearch) { useSearch = true; setUseSearch(true) }

          if (data.lastPage) maxPage = Math.min(data.lastPage, 200)
          setTotalPages(maxPage)

          // Only stop if API returned no comment IDs (true end), not just filtered rows
          if ((data.fetched || 0) === 0) break
          p++
          setPage(p)
        } catch (err: any) {
          setError(err.message || 'Download failed')
          running.current = false
          return
        }
      }

      // Finalize
      try {
        await fetch('/api/regulations-sources/download-comments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataset_id: datasetId, docket_id: meta.docket_id, finalize: true }),
        })
      } catch {}

      setStatus('complete')
      running.current = false
      // Reload the page to show the data
      window.location.reload()
    }

    void downloadLoop()
  }, [status])

  if (!meta?.docket_id || meta.download_status === 'complete') return null

  if (status === 'complete') {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-4 flex items-center gap-3">
        <span className="text-green-500 text-lg">&#10003;</span>
        <div>
          <p className="text-sm font-semibold text-green-700">Download complete</p>
          <p className="text-xs text-green-600">{comments.toLocaleString()} comments downloaded from {meta.docket_id}</p>
        </div>
      </div>
    )
  }

  var pct = totalPages > 0 ? Math.round((page / totalPages) * 100) : 0

  return (
    <div className="bg-orange-50 border border-orange-200 rounded-xl px-5 py-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800">Downloading comments from Regulations.gov</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {meta.docket_id} · Batch {page} of {totalPages} · {comments.toLocaleString()} comments saved
          </p>
          <p className="text-xs text-gray-400 mt-1">You can leave this page — download will resume when you come back.</p>
        </div>
      </div>
      <div className="h-1.5 bg-orange-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: pct + '%', background: HERMES }} />
      </div>
      {error && (
        <div className="flex items-center gap-2">
          <p className="text-xs text-red-500 flex-1">{error}</p>
          <button
            onClick={function() { setError(''); setStatus('downloading'); running.current = false }}
            className="text-xs font-semibold px-3 py-1 rounded-lg border border-orange-300 text-orange-600 hover:bg-orange-100"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  )
}
