'use client'

// components/analyze/RegulationsWizard.tsx
// Two-step wizard: Search dockets → Create dataset + redirect (download continues on analyze page)

import { useState } from 'react'
import { useRouter } from 'next/navigation'

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
  var [creating, setCreating] = useState(false)

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
        setSelectedDocket(null)
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

  async function handleCreate() {
    if (!selectedDocket || !datasetName.trim()) return
    setCreating(true)
    setError('')

    try {
      var res = await fetch('/api/regulations-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset_name: datasetName,
          docket_id: selectedDocket.id,
          docket_title: selectedDocket.title,
          agency: selectedDocket.agency,
          comment_count: selectedDocket.commentCount > 0 ? selectedDocket.commentCount : 0,
        }),
      })
      var text = await res.text()
      var data: any
      try { data = JSON.parse(text) } catch { throw new Error('Server error: ' + text.slice(0, 200)) }
      if (!res.ok) throw new Error(data.error || 'Failed to create dataset')

      // Redirect to settings — download will auto-start there
      router.push('/analyze/' + data.dataset_id + '/settings')
    } catch (err: any) {
      setError(err.message || 'Failed to create dataset')
      setCreating(false)
    }
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
                  {d.commentCount > 0 && (
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

      {/* Selected docket — configure & create */}
      {selectedDocket && (
        <div className="bg-white border-2 rounded-2xl p-6 flex flex-col gap-4" style={{ borderColor: HERMES }}>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="font-bold text-gray-800">{selectedDocket.title}</h3>
              <p className="text-xs text-gray-400 mt-1">
                {selectedDocket.agency} · {selectedDocket.id}{loadingCount ? ' · Loading comment count...' : selectedDocket.commentCount > 0 ? ' · ' + selectedDocket.commentCount.toLocaleString() + ' comments' : ''}
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

          <p className="text-xs text-gray-400">Comments will download automatically in the background after you create the dataset.</p>

          <button
            onClick={handleCreate}
            disabled={!datasetName.trim() || loadingCount || creating}
            className="px-6 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50 hover:opacity-90 transition-all"
            style={{ background: HERMES }}
          >
            {creating ? 'Creating...' : 'Create Dataset & Start Download'}
          </button>
        </div>
      )}
    </div>
  )
}
