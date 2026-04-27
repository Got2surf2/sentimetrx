'use client'

// components/analyze/RegulationsWizard.tsx
// Two-step wizard: Search dockets → Download comments

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import LottieLoader from '@/components/ui/LottieLoader'

const HERMES = '#E8632A'

interface Docket {
  id: string
  title: string
  agency: string
  docketType: string
  lastModified: string
  commentCount: number
}

interface Props {
  onBack: () => void
}

function formatDate(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function RegulationsWizard({ onBack }: Props) {
  var router = useRouter()

  // Search
  var [query, setQuery] = useState('')
  var [loading, setLoading] = useState(false)
  var [error, setError] = useState('')
  var [dockets, setDockets] = useState<Docket[]>([])
  var [totalResults, setTotalResults] = useState(0)
  var [searchPage, setSearchPage] = useState(1)
  var [hasSearched, setHasSearched] = useState(false)

  // Selected docket
  var [selectedDocket, setSelectedDocket] = useState<Docket | null>(null)
  var [loadingCount, setLoadingCount] = useState(false)
  var [datasetName, setDatasetName] = useState('')

  // Download progress
  var [downloading, setDownloading] = useState(false)
  var [dlProgress, setDlProgress] = useState<{ page: number; totalPages: number; comments: number } | null>(null)

  async function handleSearch(page?: number) {
    var p = page || 1
    setLoading(true)
    setError('')
    try {
      var res = await fetch('/api/regulations-sources/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, page: p }),
      })
      var text = await res.text()
      var data: any
      try { data = JSON.parse(text) } catch { throw new Error(text.slice(0, 200) || 'Invalid response from server') }
      if (!res.ok) throw new Error(data.error || 'Search failed')
      if (p === 1) {
        setDockets(data.dockets)
      } else {
        setDockets(function(prev) { return prev.concat(data.dockets) })
      }
      setTotalResults(data.totalElements)
      setSearchPage(p)
      setHasSearched(true)
    } catch (err: any) {
      setError(err.message || 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleSelectDocket(d: Docket) {
    setSelectedDocket(d)
    setDatasetName(d.agency + ' — ' + d.title.slice(0, 80))

    // Fetch comment count if unknown
    if (d.commentCount < 0) {
      setLoadingCount(true)
      try {
        var res = await fetch('/api/regulations-sources/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ docketId: d.id }),
        })
        var data = await res.json()
        var count = data.commentCount || 0
        var updated = { ...d, commentCount: count }
        setSelectedDocket(updated)
        setDockets(function(prev) { return prev.map(function(x) { return x.id === d.id ? updated : x }) })
      } catch {}
      setLoadingCount(false)
    }
  }

  async function handleDownload() {
    if (!selectedDocket) return
    setDownloading(true)
    setError('')
    setDlProgress({ page: 0, totalPages: 1, comments: 0 })

    try {
      // Create dataset
      var createRes = await fetch('/api/regulations-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset_name: datasetName,
          docket_id: selectedDocket.id,
          docket_title: selectedDocket.title,
          agency: selectedDocket.agency,
          comment_count: selectedDocket.commentCount,
        }),
      })
      var createText = await createRes.text()
      var createData: any
      try { createData = JSON.parse(createText) } catch { throw new Error('Server error: ' + createText.slice(0, 200)) }
      if (!createRes.ok) throw new Error(createData.error || 'Failed to create dataset')
      var datasetId = createData.dataset_id

      // Download comments page by page (25 per page to stay within timeout)
      var page = 1
      var totalComments = 0
      var totalPages = Math.max(Math.ceil((selectedDocket.commentCount > 0 ? selectedDocket.commentCount : 100) / 25), 1)
      // API caps at 200 pages (5000 comments max)
      if (totalPages > 200) totalPages = 200

      while (page <= totalPages) {
        setDlProgress({ page, totalPages, comments: totalComments })

        var dlRes = await fetch('/api/regulations-sources/download-comments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dataset_id: datasetId,
            docket_id: selectedDocket.id,
            page,
          }),
        })
        var dlText = await dlRes.text()
        var dlData: any
        try { dlData = JSON.parse(dlText) } catch { throw new Error('Server error: ' + dlText.slice(0, 200)) }
        if (!dlRes.ok) throw new Error(dlData.error || 'Download failed')
        totalComments += dlData.inserted || 0

        // Update total pages from API response
        if (dlData.lastPage) totalPages = Math.min(dlData.lastPage, 200)

        if ((dlData.inserted || 0) === 0) break
        page++
      }

      // Finalize — compute analytics
      setDlProgress({ page: totalPages, totalPages, comments: totalComments })
      await fetch('/api/regulations-sources/download-comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset_id: datasetId, docket_id: selectedDocket.id, finalize: true }),
      })

      // Navigate to dataset
      router.push('/analyze/' + datasetId + '/settings')
    } catch (err: any) {
      setError(err.message || 'Download failed')
      setDownloading(false)
    }
  }

  // ── Download overlay ──────────────────────────────────────────────
  if (downloading && dlProgress) {
    var pct = dlProgress.totalPages > 0 ? Math.round((dlProgress.page / dlProgress.totalPages) * 100) : 0
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: 'white', borderRadius: 20, padding: '40px 48px', maxWidth: 420, width: '100%', textAlign: 'center' }}>
          <LottieLoader size={64} />
          <h3 style={{ fontSize: 16, fontWeight: 700, marginTop: 16, color: '#111827' }}>
            Downloading comments...
          </h3>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 8 }}>
            Batch {dlProgress.page} of {dlProgress.totalPages} · {dlProgress.comments.toLocaleString()} comments saved
          </p>
          <div style={{ height: 6, background: '#F3F4F6', borderRadius: 3, overflow: 'hidden', marginTop: 16 }}>
            <div style={{ height: '100%', borderRadius: 3, background: HERMES, transition: 'width .5s ease', width: pct + '%' }} />
          </div>
          <p style={{ fontSize: 11, color: '#9CA3AF', marginTop: 8 }}>
            {pct}% complete — rate limited to ~25 comments per batch
          </p>
          {error && <p style={{ fontSize: 12, color: '#EF4444', marginTop: 12 }}>{error}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <button onClick={onBack} className="text-xs text-gray-400 hover:text-gray-600 self-start">← Back to sources</button>

      <div>
        <h2 className="text-xl font-bold text-gray-800">Download Regulations.gov Comments</h2>
        <p className="text-sm text-gray-500 mt-1">Search for a federal docket, then download all public comments for analysis.</p>
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={function(e) { setQuery(e.target.value) }}
          onKeyDown={function(e) { if (e.key === 'Enter' && query.trim()) handleSearch() }}
          placeholder="Search dockets — e.g. 'EPA water quality' or 'FDA-2024-N-0001'"
          className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 text-sm text-gray-800 outline-none focus:border-orange-400 transition-colors"
        />
        <button
          onClick={function() { handleSearch() }}
          disabled={loading || !query.trim()}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-all"
          style={{ background: HERMES }}
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Results */}
      {hasSearched && !loading && dockets.length === 0 && (
        <p className="text-sm text-gray-400">No dockets found. Try a different search term.</p>
      )}

      {dockets.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-gray-400">{totalResults.toLocaleString()} dockets found</p>
          <div style={{ maxHeight: 400, overflowY: 'auto' }} className="flex flex-col gap-1">
            {dockets.map(function(d) {
              var isSelected = selectedDocket?.id === d.id
              return (
                <button
                  key={d.id}
                  onClick={function() { if (isSelected) setSelectedDocket(null); else handleSelectDocket(d) }}
                  className={'flex items-start gap-3 px-4 py-3 rounded-xl border transition-all text-left ' + (isSelected ? 'border-orange-400 bg-orange-50' : 'bg-white border-gray-200 hover:border-orange-400 hover:bg-orange-50')}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 line-clamp-2">{d.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {d.agency} · {d.id} · {d.docketType} · {formatDate(d.lastModified)}
                    </p>
                  </div>
                  {d.commentCount >= 0 && (
                    <div className="flex-shrink-0 text-right">
                      <span className="text-sm font-bold" style={{ color: HERMES }}>{d.commentCount.toLocaleString()}</span>
                      <p className="text-[10px] text-gray-400">comments</p>
                    </div>
                  )}
                </button>
              )
            })}
          </div>
          {dockets.length < totalResults && (
            <button
              onClick={function() { handleSearch(searchPage + 1) }}
              disabled={loading}
              className="text-xs font-semibold px-4 py-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 self-center"
            >
              {loading ? 'Loading...' : 'Load more results'}
            </button>
          )}
        </div>
      )}

      {/* Selected docket — configure & download */}
      {selectedDocket && (
        <div className="bg-white border-2 rounded-2xl p-6 flex flex-col gap-4" style={{ borderColor: HERMES }}>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="font-bold text-gray-800">{selectedDocket.title}</h3>
              <p className="text-xs text-gray-400 mt-1">
                {selectedDocket.agency} · {selectedDocket.id} · {loadingCount ? 'Loading comment count...' : selectedDocket.commentCount >= 0 ? selectedDocket.commentCount.toLocaleString() + ' comments' : ''}
              </p>
              {selectedDocket.commentCount > 5000 && (
                <p className="text-xs text-amber-600 mt-1">
                  Note: API limits downloads to 5,000 comments per docket. Larger dockets will be sampled (most recent first).
                </p>
              )}
            </div>
            <button onClick={function() { setSelectedDocket(null) }} className="text-xs text-gray-400 hover:text-gray-600 ml-3">
              Close
            </button>
          </div>

          <div>
            <label className="text-xs text-gray-500 font-medium mb-1 block">Dataset Name</label>
            <input
              type="text"
              value={datasetName}
              onChange={function(e) { setDatasetName(e.target.value) }}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-300 text-sm text-gray-800 outline-none focus:border-orange-400 transition-colors"
            />
          </div>

          <button
            onClick={handleDownload}
            disabled={!datasetName.trim() || loadingCount}
            className="px-6 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50 hover:opacity-90 transition-all"
            style={{ background: HERMES }}
          >
            {loadingCount ? 'Loading...' : selectedDocket.commentCount > 0
              ? 'Download ' + Math.min(selectedDocket.commentCount, 5000).toLocaleString() + ' Comments'
              : 'Download Comments'}
          </button>
        </div>
      )}
    </div>
  )
}
