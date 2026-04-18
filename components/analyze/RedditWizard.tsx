'use client'

// components/analyze/RedditWizard.tsx
// Three-step wizard: Search Reddit → Select Threads → Download Comments

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import LottieLoader from '@/components/ui/LottieLoader'

const HERMES = '#E8632A'

interface RedditThread {
  thread_id: string
  subreddit: string
  title: string
  author: string
  selftext: string
  score: number
  comment_count: number
  permalink: string
  created_utc: number
}

interface SubredditResult {
  name: string
  title: string
  description: string
  subscribers: number
}

type WizardStep = 1 | 2 | 3

interface Props {
  onBack: () => void
}

export default function RedditWizard({ onBack }: Props) {
  const router = useRouter()
  const [step, setStep] = useState<WizardStep>(1)

  // Step 1: Search
  const [keyword, setKeyword] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [threads, setThreads] = useState<RedditThread[]>([])
  const [subreddits, setSubreddits] = useState<SubredditResult[]>([])
  const [filterSub, setFilterSub] = useState('')

  // Step 2: Selection
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Step 3: Confirm + Download
  const [datasetName, setDatasetName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [statusMsg, setStatusMsg] = useState('')

  // -- Step 1: Search --------------------------------------------------------

  async function handleSearch(subreddit?: string) {
    if (!keyword.trim()) return
    setSearching(true)
    setSearchError('')
    setThreads([])
    try {
      const res = await fetch('/api/reddit-sources/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: keyword.trim(), subreddit: subreddit || filterSub || undefined }),
      })
      const data = await res.json()
      if (!res.ok) { setSearchError(data.error || 'Search failed'); return }
      if (!data.posts?.length && !data.subreddits?.length) {
        setSearchError('No results found for "' + keyword.trim() + '"')
        return
      }
      setSubreddits(data.subreddits || [])
      setThreads(data.posts || [])
      // Auto-select all threads
      const all = new Set<string>()
      ;(data.posts || []).forEach(function(t: RedditThread) { all.add(t.thread_id) })
      setSelected(all)
      setDatasetName('Reddit: ' + keyword.trim())
      if (data.posts?.length) setStep(2)
    } catch (err: any) {
      setSearchError(err?.message || 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  // -- Step 2: Selection helpers ---------------------------------------------

  function toggleAll() {
    if (selected.size === threads.length) {
      setSelected(new Set())
    } else {
      const all = new Set<string>()
      threads.forEach(function(t) { all.add(t.thread_id) })
      setSelected(all)
    }
  }

  function toggleThread(threadId: string) {
    const next = new Set(selected)
    if (next.has(threadId)) next.delete(threadId)
    else next.add(threadId)
    setSelected(next)
  }

  const selectedThreads = threads.filter(function(t) { return selected.has(t.thread_id) })
  const estimatedComments = selectedThreads.reduce(function(sum, t) { return sum + t.comment_count }, 0)

  // Group threads by subreddit
  const subGroups = threads.reduce(function(acc, t) {
    if (!acc[t.subreddit]) acc[t.subreddit] = []
    acc[t.subreddit].push(t)
    return acc
  }, {} as Record<string, RedditThread[]>)
  const sortedSubs = Object.keys(subGroups).sort()

  function toggleSubreddit(sub: string) {
    const subThreads = subGroups[sub] || []
    const allSelected = subThreads.every(function(t) { return selected.has(t.thread_id) })
    const next = new Set(selected)
    subThreads.forEach(function(t) {
      if (allSelected) next.delete(t.thread_id)
      else next.add(t.thread_id)
    })
    setSelected(next)
  }

  // -- Step 3: Create --------------------------------------------------------

  async function handleCreate() {
    if (!datasetName.trim() || selectedThreads.length === 0) return
    setCreating(true)
    setCreateError('')
    setStatusMsg('Creating dataset and downloading comments...')
    try {
      const res = await fetch('/api/reddit-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          search_query: keyword.trim(),
          dataset_name: datasetName.trim(),
          threads: selectedThreads,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setCreateError(data.error || 'Failed to create'); return }

      setStatusMsg(
        'Downloaded ' + (data.total_comments || 0).toLocaleString() + ' comments from ' +
        (data.total_posts || 0) + ' threads. Redirecting...'
      )

      setTimeout(function() {
        router.push('/analyze/' + data.dataset_id + '/settings')
      }, 1500)
    } catch (err: any) {
      setCreateError(err?.message || 'Failed')
    } finally {
      setCreating(false)
    }
  }

  function formatDate(utc: number): string {
    return new Date(utc * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function formatScore(n: number): string {
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
    return String(n)
  }

  // -- Render ----------------------------------------------------------------

  return (
    <div className="flex flex-col gap-6">
      {/* Step indicator */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-xs text-gray-400 hover:text-gray-600 mr-2">{'\u2190'} Back</button>
        {([1, 2, 3] as WizardStep[]).map(function(s) {
          const labels: Record<WizardStep, string> = { 1: 'Search', 2: 'Select Threads', 3: 'Download' }
          const done = step > s; const current = step === s
          return (
            <div key={s} className="flex items-center gap-2">
              <div className={'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ' + (done ? 'bg-green-500 text-white' : current ? 'text-white' : 'bg-gray-100 text-gray-400')}
                style={current ? { background: HERMES } : {}}>
                {done ? '\u2713' : s}
              </div>
              <span className={'text-sm font-medium ' + (current ? 'text-gray-800' : 'text-gray-400')}>{labels[s]}</span>
              {s < 3 && <div className="w-8 h-px bg-gray-200" />}
            </div>
          )
        })}
      </div>

      {/* Step 1: Search */}
      {step === 1 && (
        <div className="flex flex-col gap-4">
          <div className="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col gap-4">
            <div>
              <h3 className="font-bold text-gray-800 mb-1">Search Reddit</h3>
              <p className="text-xs text-gray-400">Enter keywords to find relevant posts and discussions</p>
            </div>
            <div className="flex gap-3">
              <input
                value={keyword}
                onChange={function(e) { setKeyword(e.target.value) }}
                onKeyDown={function(e) { if (e.key === 'Enter') handleSearch() }}
                placeholder='e.g. "public transit complaints" or "housing crisis Austin"'
                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 text-sm outline-none focus:border-orange-400 transition-colors"
              />
              <button
                onClick={function() { handleSearch() }}
                disabled={searching || !keyword.trim()}
                className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 transition-all"
                style={{ background: HERMES }}>
                {searching ? 'Searching...' : 'Search'}
              </button>
            </div>
            {searching && (
              <div className="flex items-center gap-3 py-2">
                <LottieLoader size={32} message="Searching Reddit..." />
              </div>
            )}

            {/* Subreddit suggestions */}
            {subreddits.length > 0 && threads.length === 0 && (
              <div className="flex flex-col gap-2 mt-2">
                <p className="text-xs font-semibold text-gray-500">Related subreddits — click to search within:</p>
                <div className="flex flex-wrap gap-2">
                  {subreddits.slice(0, 10).map(function(sub) {
                    return (
                      <button key={sub.name}
                        onClick={function() { setFilterSub(sub.name); handleSearch(sub.name) }}
                        className="px-3 py-1.5 rounded-full text-xs font-semibold border border-gray-200 hover:border-orange-400 hover:bg-orange-50 transition-all"
                        style={{ color: '#374151' }}>
                        r/{sub.name}
                        <span className="ml-1.5 text-gray-400">{sub.subscribers >= 1000 ? (sub.subscribers / 1000).toFixed(0) + 'k' : sub.subscribers}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
          {searchError && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{searchError}</div>
          )}
        </div>
      )}

      {/* Step 2: Thread Selection */}
      {step === 2 && (
        <div className="flex flex-col gap-4">
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <span className="text-green-500 text-lg">{'\u2713'}</span>
            <div>
              <p className="text-sm font-semibold text-green-700">Found {threads.length} threads for "{keyword}"</p>
              <p className="text-xs text-green-600">{estimatedComments.toLocaleString()} total comments estimated</p>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-800">Threads</h3>
                <p className="text-xs text-gray-400">{selected.size} of {threads.length} selected · {estimatedComments.toLocaleString()} comments</p>
              </div>
              <button onClick={toggleAll}
                className="text-xs font-semibold hover:underline" style={{ color: HERMES }}>
                {selected.size === threads.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            {/* Subreddit filter pills */}
            {sortedSubs.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {sortedSubs.map(function(sub) {
                  const subThreads = subGroups[sub]
                  const allSel = subThreads.every(function(t) { return selected.has(t.thread_id) })
                  return (
                    <button key={sub} onClick={function() { toggleSubreddit(sub) }}
                      className="px-2.5 py-1 rounded-full text-xs font-semibold transition-all"
                      style={{
                        background: allSel ? '#ecfdf5' : '#f9fafb',
                        color: allSel ? '#059669' : '#6b7280',
                        border: '1px solid ' + (allSel ? '#d1fae5' : '#e5e7eb'),
                      }}>
                      r/{sub} ({subThreads.length})
                    </button>
                  )
                })}
              </div>
            )}

            {/* Selected threads */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ border: '1px solid #d1fae5', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ background: '#ecfdf5', padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#059669' }}>Selected ({selectedThreads.length})</span>
                  <span style={{ fontSize: 11, color: '#6b7280' }}>{estimatedComments.toLocaleString()} comments</span>
                </div>
                <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                  {selectedThreads.length === 0 ? (
                    <div style={{ padding: '24px 14px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No threads selected</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <tbody>
                        {selectedThreads.map(function(t) {
                          return (
                            <tr key={t.thread_id}
                              onClick={function() { toggleThread(t.thread_id) }}
                              style={{ cursor: 'pointer', borderTop: '1px solid #f0fdf4', transition: 'background .1s' }}
                              onMouseEnter={function(e) { (e.currentTarget as HTMLTableRowElement).style.background = '#fef2f2' }}
                              onMouseLeave={function(e) { (e.currentTarget as HTMLTableRowElement).style.background = '' }}>
                              <td style={{ padding: '6px 14px', width: 28 }}>
                                <input type="checkbox" checked readOnly style={{ accentColor: '#059669', width: 14, height: 14, cursor: 'pointer' }} />
                              </td>
                              <td style={{ padding: '6px 6px' }}>
                                <div style={{ fontWeight: 600, color: '#111827', lineHeight: 1.3 }}>{t.title}</div>
                                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                                  r/{t.subreddit} · {formatDate(t.created_utc)} · u/{t.author}
                                </div>
                              </td>
                              <td style={{ padding: '6px 6px', textAlign: 'center', color: '#d97706', fontWeight: 700, fontSize: 12, width: 55, whiteSpace: 'nowrap' }}>
                                {'\u2B06'} {formatScore(t.score)}
                              </td>
                              <td style={{ padding: '6px 14px', textAlign: 'right', color: '#6b7280', fontSize: 12, width: 80, whiteSpace: 'nowrap' }}>
                                {t.comment_count.toLocaleString()} comments
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* Unselected pane */}
              {(function() {
                var unselected = threads.filter(function(t) { return !selected.has(t.thread_id) })
                if (unselected.length === 0) return null
                return (
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
                    <div style={{ background: '#f9fafb', padding: '8px 14px' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#6b7280' }}>Available ({unselected.length})</span>
                    </div>
                    <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <tbody>
                          {unselected.map(function(t) {
                            return (
                              <tr key={t.thread_id}
                                onClick={function() { toggleThread(t.thread_id) }}
                                style={{ cursor: 'pointer', borderTop: '1px solid #f3f4f6', opacity: 0.6, transition: 'all .1s' }}
                                onMouseEnter={function(e) { var el = e.currentTarget as HTMLTableRowElement; el.style.background = '#ecfdf5'; el.style.opacity = '1' }}
                                onMouseLeave={function(e) { var el = e.currentTarget as HTMLTableRowElement; el.style.background = ''; el.style.opacity = '0.6' }}>
                                <td style={{ padding: '6px 14px', width: 28 }}>
                                  <input type="checkbox" checked={false} readOnly style={{ accentColor: HERMES, width: 14, height: 14, cursor: 'pointer' }} />
                                </td>
                                <td style={{ padding: '6px 6px' }}>
                                  <div style={{ fontWeight: 600, color: '#111827', lineHeight: 1.3 }}>{t.title}</div>
                                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                                    r/{t.subreddit} · {formatDate(t.created_utc)} · u/{t.author}
                                  </div>
                                </td>
                                <td style={{ padding: '6px 6px', textAlign: 'center', color: '#d97706', fontWeight: 700, fontSize: 12, width: 55, whiteSpace: 'nowrap' }}>
                                  {'\u2B06'} {formatScore(t.score)}
                                </td>
                                <td style={{ padding: '6px 14px', textAlign: 'right', color: '#6b7280', fontSize: 12, width: 80, whiteSpace: 'nowrap' }}>
                                  {t.comment_count.toLocaleString()} comments
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={function() { setStep(1) }}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 text-gray-600">Back</button>
            <button onClick={function() { setStep(3) }} disabled={selected.size === 0}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 transition-all"
              style={{ background: HERMES }}>Continue</button>
          </div>
        </div>
      )}

      {/* Step 3: Confirm + Download */}
      {step === 3 && (
        <div className="flex flex-col gap-4">
          <div className="bg-white border border-gray-200 rounded-2xl p-5 flex flex-col gap-3">
            <h3 className="font-bold text-gray-800">Download Summary</h3>
            <div className="flex flex-col gap-1.5 mb-2">
              <label className="text-sm font-semibold text-gray-700">Dataset name</label>
              <input value={datasetName} onChange={function(e) { setDatasetName(e.target.value) }}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-300 text-sm outline-none focus:border-orange-400 transition-colors" />
            </div>
            {([
              ['Search query',       keyword],
              ['Threads selected',   selected.size + ' of ' + threads.length],
              ['Estimated comments', estimatedComments.toLocaleString()],
              ['Subreddits',         Array.from(new Set(selectedThreads.map(function(t) { return 'r/' + t.subreddit }))).join(', ')],
              ['Download type',      'On-demand (one-time download)'],
            ] as [string, string][]).map(function([label, val]) {
              return (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-gray-500">{label}</span>
                  <span className="text-gray-800 font-semibold" style={{ maxWidth: '60%', textAlign: 'right' }}>{val}</span>
                </div>
              )
            })}
            <p className="text-xs text-gray-400 mt-1">Each comment becomes one row in your dataset for TextMine analysis.</p>
          </div>

          {creating && (
            <div className="flex flex-col gap-3 items-center py-2">
              <LottieLoader size={64} message={statusMsg || 'Creating...'} />
            </div>
          )}

          {createError && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{createError}</div>
          )}

          <div className="flex gap-3">
            <button onClick={function() { setStep(2) }} disabled={creating}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 text-gray-600 disabled:opacity-50">Back</button>
            <button onClick={handleCreate} disabled={creating || !datasetName.trim()}
              className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 transition-all"
              style={{ background: HERMES }}>
              {creating ? 'Downloading...' : 'Start Download'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
