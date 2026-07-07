'use client'

// components/analyze/RedditWizard.tsx
// Three-step wizard: Search Reddit → Select Threads → Download Comments

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import LottieLoader from '@/components/ui/LottieLoader'
import BrandTagInput from '@/components/analyze/BrandTagInput'

const HERMES = '#E8632A'

// Reddit public JSON API returns max ~500 comments per thread request
const REDDIT_COMMENTS_PER_THREAD = 500

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

type WizardStep = 1 | 2 | 3
type SortMode = 'date' | 'score' | 'comments'

interface Props {
  onBack: () => void
}

export default function RedditWizard({ onBack }: Props) {
  const router = useRouter()
  const [step, setStep] = useState<WizardStep>(1)

  // Step 1: Subreddit entry
  const [keyword, setKeyword] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [threads, setThreads] = useState<RedditThread[]>([])
  const [postSort, setPostSort] = useState('hot')

  // Step 2: Selection + sorting + filter
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sortBy, setSortBy] = useState<SortMode>('date')
  const [threadFilter, setThreadFilter] = useState('')

  // Step 3: Confirm + Download + sample size + progress
  const [datasetName, setDatasetName] = useState('')
  const [brandTag, setBrandTag] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [statusMsg, setStatusMsg] = useState('')
  const [maxCommentsPerThread, setMaxCommentsPerThread] = useState(REDDIT_COMMENTS_PER_THREAD)
  const [dlProgress, setDlProgress] = useState({ threadsDown: 0, threadsTotal: 0, comments: 0 })

  // -- Step 1: Search --------------------------------------------------------

  async function handleSearch() {
    if (!keyword.trim()) return
    setSearching(true)
    setSearchError('')
    setThreads([])
    try {
      var subName = keyword.trim().replace(/^r\//, '').replace(/^\/r\//, '')
      const res = await fetch('/api/reddit-sources/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subreddit: subName, sort: postSort }),
      })
      const resText = await res.text()
      var data: { error?: string; posts?: RedditThread[] }
      try { data = JSON.parse(resText) } catch { data = { error: 'Reddit is temporarily unavailable. Please wait a moment and try again.' } }
      if (!res.ok || data.error) { setSearchError(data.error || 'Subreddit not found. Check the name and try again.'); return }
      if (!data.posts?.length) {
        setSearchError('No posts found in r/' + subName)
        return
      }
      // Sort by date (newest first) by default
      var posts = (data.posts || []) as RedditThread[]
      posts.sort(function(a, b) { return b.created_utc - a.created_utc })
      setThreads(posts)
      // Auto-select all threads
      const all = new Set<string>()
      posts.forEach(function(t: RedditThread) { all.add(t.thread_id) })
      setSelected(all)
      setSortBy('date')
      setDatasetName('Reddit: r/' + subName)
      if (posts.length) setStep(2)
    } catch (err) {
      setSearchError((err as { message?: string })?.message || 'Failed to load subreddit')
    } finally {
      setSearching(false)
    }
  }

  // -- Step 2: Selection + sorting helpers -----------------------------------

  // Sort threads based on current mode
  var sortedThreads = threads.slice().sort(function(a, b) {
    if (sortBy === 'date') return b.created_utc - a.created_utc
    if (sortBy === 'score') return b.score - a.score
    return b.comment_count - a.comment_count
  })

  // Filter threads by search text (matches title, subreddit, author)
  var filterLower = threadFilter.toLowerCase().trim()
  var visibleThreads = filterLower ? sortedThreads.filter(function(t) {
    return t.title.toLowerCase().includes(filterLower) ||
      t.subreddit.toLowerCase().includes(filterLower) ||
      t.author.toLowerCase().includes(filterLower)
  }) : sortedThreads

  function selectAll() {
    const all = new Set<string>(selected)
    visibleThreads.forEach(function(t) { all.add(t.thread_id) })
    setSelected(all)
  }

  function deselectAll() {
    if (!filterLower) { setSelected(new Set()); return }
    var next = new Set(selected)
    visibleThreads.forEach(function(t) { next.delete(t.thread_id) })
    setSelected(next)
  }

  function toggleThread(threadId: string) {
    const next = new Set(selected)
    if (next.has(threadId)) next.delete(threadId)
    else next.add(threadId)
    setSelected(next)
  }

  const LARGE_THRESHOLD = 100
  const selectedThreads = sortedThreads.filter(function(t) { return selected.has(t.thread_id) })
  const unselectedThreads = sortedThreads.filter(function(t) { return !selected.has(t.thread_id) })
  const estimatedComments = selectedThreads.reduce(function(sum, t) { return sum + t.comment_count }, 0)

  // Split visible threads into large (≥100 comments) and small (<100)
  const largeThreads = visibleThreads.filter(function(t) { return t.comment_count >= LARGE_THRESHOLD })
  const smallThreads = visibleThreads.filter(function(t) { return t.comment_count < LARGE_THRESHOLD })
  const largeSelected = largeThreads.filter(function(t) { return selected.has(t.thread_id) })
  const smallSelected = smallThreads.filter(function(t) { return selected.has(t.thread_id) })

  function selectGroup(threads: RedditThread[]) {
    var next = new Set(selected)
    threads.forEach(function(t) { next.add(t.thread_id) })
    setSelected(next)
  }
  function deselectGroup(threads: RedditThread[]) {
    var next = new Set(selected)
    threads.forEach(function(t) { next.delete(t.thread_id) })
    setSelected(next)
  }

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

  // -- Step 3: Sample size helpers -------------------------------------------

  // Realistic download estimate: Reddit API returns max ~500 per thread
  var realisticComments = selectedThreads.reduce(function(sum, t) {
    return sum + Math.min(t.comment_count, maxCommentsPerThread)
  }, 0)

  var recommendedMax = REDDIT_COMMENTS_PER_THREAD

  // -- Step 3: Create --------------------------------------------------------

  async function handleCreate() {
    if (!datasetName.trim() || selectedThreads.length === 0) return
    setCreating(true)
    setCreateError('')
    setDlProgress({ threadsDown: 0, threadsTotal: selectedThreads.length, comments: 0 })
    setStatusMsg('Creating dataset...')

    try {
      // 1. Create source + dataset (no download yet)
      var createRes = await fetch('/api/reddit-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          search_query: keyword.trim(),
          dataset_name: datasetName.trim(),
          threads: selectedThreads,
          max_comments_per_thread: maxCommentsPerThread,
          brand_tag: brandTag.trim() || null,
        }),
      })
      var createData = await createRes.json()
      if (!createRes.ok) { setCreateError(createData.error || 'Failed to create'); setCreating(false); return }

      var sourceId = createData.source_id
      var datasetId = createData.dataset_id
      var totalComments = 0
      var errors: string[] = []

      // 2. Download each thread one by one
      for (var idx = 0; idx < selectedThreads.length; idx++) {
        var thread = selectedThreads[idx]
        setStatusMsg('Downloading thread ' + (idx + 1) + ' of ' + selectedThreads.length + '...')
        setDlProgress({ threadsDown: idx, threadsTotal: selectedThreads.length, comments: totalComments })

        try {
          var dlRes = await fetch('/api/reddit-sources/' + sourceId + '/download-thread', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ thread_id: thread.thread_id, max_comments: maxCommentsPerThread }),
          })
          var dlText = await dlRes.text()
          var dlData: { error?: string; comments?: number }
          try { dlData = JSON.parse(dlText) } catch { dlData = { error: 'Reddit temporarily unavailable (non-JSON response)' } }
          if (dlRes.ok && !dlData.error) {
            totalComments += dlData.comments || 0
          } else {
            errors.push(thread.title.slice(0, 40) + ': ' + (dlData.error || 'failed'))
          }
        } catch (e) {
          errors.push(thread.title.slice(0, 40) + ': ' + ((e as { message?: string })?.message || 'failed'))
        }

        setDlProgress({ threadsDown: idx + 1, threadsTotal: selectedThreads.length, comments: totalComments })
      }

      // 3. Finalize — build schema + compute analytics
      setStatusMsg('Finalizing dataset...')
      try {
        await fetch('/api/reddit-sources/' + sourceId + '/sync', { method: 'POST' })
      } catch {}

      setStatusMsg(
        'Downloaded ' + totalComments.toLocaleString() + ' comments from ' +
        selectedThreads.length + ' threads.' + (errors.length > 0 ? ' (' + errors.length + ' errors)' : '') +
        ' Redirecting...'
      )
      setDlProgress({ threadsDown: selectedThreads.length, threadsTotal: selectedThreads.length, comments: totalComments })

      setTimeout(function() {
        router.push('/analyze/' + datasetId + '/settings?new=1')
      }, 1500)
    } catch (err) {
      setCreateError((err as { message?: string })?.message || 'Failed')
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

  // Shared thread row renderer
  function renderThreadRow(t: RedditThread, isSelected: boolean) {
    return (
      <tr key={t.thread_id}
        onClick={function() { toggleThread(t.thread_id) }}
        style={{ cursor: 'pointer', borderTop: '1px solid ' + (isSelected ? '#f0fdf4' : '#f3f4f6'), opacity: isSelected ? 1 : 0.6, transition: 'all .1s' }}
        onMouseEnter={function(e) { var el = e.currentTarget as HTMLTableRowElement; el.style.background = isSelected ? '#fef2f2' : '#ecfdf5'; if (!isSelected) el.style.opacity = '1' }}
        onMouseLeave={function(e) { var el = e.currentTarget as HTMLTableRowElement; el.style.background = ''; if (!isSelected) el.style.opacity = '0.6' }}>
        <td style={{ padding: '6px 14px', width: 28 }}>
          <input type="checkbox" checked={isSelected} readOnly style={{ accentColor: isSelected ? '#059669' : HERMES, width: 14, height: 14, cursor: 'pointer' }} />
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

      {/* Step 1: Enter subreddit */}
      {step === 1 && (
        <div className="flex flex-col gap-4">
          <div className="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col gap-4">
            <div>
              <h3 className="font-bold text-gray-800 mb-1">Enter a Subreddit</h3>
              <p className="text-xs text-gray-400">Type the subreddit name to load its posts (e.g. politics, FloridaMan, healthcare)</p>
            </div>
            <div className="flex gap-3">
              <div style={{ display: 'flex', alignItems: 'center', flex: 1, border: '1px solid #d1d5db', borderRadius: 12, overflow: 'hidden', transition: 'border-color 0.15s' }}>
                <span style={{ padding: '0 0 0 14px', fontSize: 14, color: '#9ca3af', fontWeight: 600, userSelect: 'none' }}>r/</span>
                <input
                  value={keyword}
                  onChange={function(e) { setKeyword(e.target.value.replace(/\s/g, '')) }}
                  onKeyDown={function(e) { if (e.key === 'Enter') void handleSearch() }}
                  placeholder='politics, FloridaMan, healthcare...'
                  className="flex-1 px-2 py-2.5 text-sm outline-none"
                  style={{ border: 'none' }}
                />
              </div>
              <select value={postSort} onChange={function(e) { setPostSort(e.target.value) }}
                style={{ padding: '0 12px', borderRadius: 12, border: '1px solid #d1d5db', fontSize: 12, fontWeight: 600, color: '#374151', cursor: 'pointer', background: '#f9fafb' }}>
                <option value="hot">Hot</option>
                <option value="new">New</option>
                <option value="top">Top</option>
              </select>
              <button
                onClick={function() { void handleSearch() }}
                disabled={searching || !keyword.trim()}
                className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 transition-all"
                style={{ background: HERMES }}>
                {searching ? 'Loading...' : 'Load Posts'}
              </button>
            </div>
            {/* Centered loading overlay — matches download style */}
            {searching && (
              <div style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 2000,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{
                  background: 'white', borderRadius: 20, padding: '40px 36px', textAlign: 'center',
                  boxShadow: '0 24px 64px rgba(0,0,0,.28)', maxWidth: 440, width: '90%',
                }}>
                  <LottieLoader size={96} message={'Loading r/' + keyword.trim().replace(/^r\//, '') + '...'} />
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
            {/* Header with select/deselect + sort */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-800">Threads</h3>
                <p className="text-xs text-gray-400">{selected.size} of {threads.length} selected · {estimatedComments.toLocaleString()} comments</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button onClick={selectAll}
                  className="text-xs font-semibold hover:underline" style={{ color: selected.size === threads.length ? '#9ca3af' : '#059669' }}>
                  Select All
                </button>
                <span style={{ color: '#d1d5db', fontSize: 10 }}>|</span>
                <button onClick={deselectAll}
                  className="text-xs font-semibold hover:underline" style={{ color: selected.size === 0 ? '#9ca3af' : '#dc2626' }}>
                  Deselect All
                </button>
              </div>
            </div>

            {/* Sort controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>Sort by:</span>
              {([
                { key: 'date' as SortMode, label: 'Newest' },
                { key: 'score' as SortMode, label: 'Top Score' },
                { key: 'comments' as SortMode, label: 'Most Comments' },
              ]).map(function(opt) {
                return (
                  <button key={opt.key} onClick={function() { setSortBy(opt.key) }}
                    style={{
                      fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, cursor: 'pointer',
                      border: '1px solid ' + (sortBy === opt.key ? '#fbd5c2' : '#e5e7eb'),
                      background: sortBy === opt.key ? '#fff4ef' : '#f9fafb',
                      color: sortBy === opt.key ? HERMES : '#6b7280',
                    }}>
                    {opt.label}
                  </button>
                )
              })}
            </div>

            {/* Search within posts */}
            <input
              value={threadFilter}
              onChange={function(e) { setThreadFilter(e.target.value) }}
              placeholder="Filter posts by title..."
              style={{
                width: '100%', padding: '8px 14px', borderRadius: 10,
                border: '1px solid ' + (threadFilter ? '#fbd5c2' : '#e5e7eb'),
                fontSize: 12, outline: 'none', background: threadFilter ? '#fff8f5' : '#f9fafb',
                transition: 'all 0.15s',
              }}
            />
            {threadFilter && (
              <div style={{ fontSize: 11, color: '#6b7280' }}>
                Showing {visibleThreads.length} of {threads.length} posts matching "{threadFilter}"
              </div>
            )}

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

            {/* Thread lists — split by size */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* Large threads (≥100 comments) */}
              {largeThreads.length > 0 && (
                <div style={{ border: '1px solid #dbeafe', borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ background: '#eff6ff', padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8' }}>Large Threads</span>
                      <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 6 }}>{LARGE_THRESHOLD}+ comments · {largeSelected.length} of {largeThreads.length} selected</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={function() { selectGroup(largeThreads) }}
                        style={{ fontSize: 10, fontWeight: 600, color: largeSelected.length === largeThreads.length ? '#9ca3af' : '#059669', background: 'none', border: 'none', cursor: 'pointer' }}>
                        Select All
                      </button>
                      <button onClick={function() { deselectGroup(largeThreads) }}
                        style={{ fontSize: 10, fontWeight: 600, color: largeSelected.length === 0 ? '#9ca3af' : '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}>
                        Deselect All
                      </button>
                    </div>
                  </div>
                  <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <tbody>
                        {largeThreads.map(function(t) { return renderThreadRow(t, selected.has(t.thread_id)) })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Small threads (<100 comments) */}
              {smallThreads.length > 0 && (
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ background: '#f9fafb', padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#6b7280' }}>Smaller Threads</span>
                      <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 6 }}>under {LARGE_THRESHOLD} comments · {smallSelected.length} of {smallThreads.length} selected</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={function() { selectGroup(smallThreads) }}
                        style={{ fontSize: 10, fontWeight: 600, color: smallSelected.length === smallThreads.length ? '#9ca3af' : '#059669', background: 'none', border: 'none', cursor: 'pointer' }}>
                        Select All
                      </button>
                      <button onClick={function() { deselectGroup(smallThreads) }}
                        style={{ fontSize: 10, fontWeight: 600, color: smallSelected.length === 0 ? '#9ca3af' : '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}>
                        Deselect All
                      </button>
                    </div>
                  </div>
                  <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <tbody>
                        {smallThreads.map(function(t) { return renderThreadRow(t, selected.has(t.thread_id)) })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
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
            <BrandTagInput value={brandTag} onChange={setBrandTag} />
            {([
              ['Search query',       keyword],
              ['Threads selected',   selected.size + ' of ' + threads.length],
              ['Estimated comments', estimatedComments.toLocaleString()],
              ['Downloadable',       realisticComments.toLocaleString() + ' (API limit: ' + maxCommentsPerThread + '/thread)'],
              ['Subreddits',         Array.from(new Set(selectedThreads.map(function(t) { return 'r/' + t.subreddit }))).join(', ')],
            ] as [string, string][]).map(function([label, val]) {
              return (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-gray-500">{label}</span>
                  <span className="text-gray-800 font-semibold" style={{ maxWidth: '60%', textAlign: 'right' }}>{val}</span>
                </div>
              )
            })}

            {/* Sample size selector */}
            <div style={{ marginTop: 8, padding: 14, background: '#f9fafb', borderRadius: 10, border: '1px solid #e5e7eb' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>Comments per thread</label>
                <span style={{ fontSize: 11, color: '#059669', fontWeight: 600 }}>Recommended: {recommendedMax}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="range"
                  min={50}
                  max={500}
                  step={50}
                  value={maxCommentsPerThread}
                  onChange={function(e) { setMaxCommentsPerThread(Number(e.target.value)) }}
                  style={{ flex: 1, accentColor: HERMES }}
                />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#111827', minWidth: 36, textAlign: 'right' }}>{maxCommentsPerThread}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontSize: 10, color: '#9ca3af' }}>50</span>
                <span style={{ fontSize: 10, color: '#9ca3af' }}>500 (max)</span>
              </div>
              <p style={{ fontSize: 11, color: '#6b7280', marginTop: 8, lineHeight: 1.5 }}>
                Reddit's public API returns up to ~500 top-level + nested comments per thread.
                Lower values download faster. {realisticComments.toLocaleString()} comments estimated at current setting.
              </p>
            </div>

            <p className="text-xs text-gray-400 mt-1">Each comment becomes one row in your dataset for TextMine analysis.</p>
          </div>

          {/* Download progress — centered overlay */}
          {creating && (
            <div style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 2000,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{
                background: 'white', borderRadius: 20, padding: '40px 36px', textAlign: 'center',
                boxShadow: '0 24px 64px rgba(0,0,0,.28)', maxWidth: 440, width: '90%',
              }}>
                <LottieLoader size={96} message={statusMsg || 'Creating...'} />
                {dlProgress.threadsTotal > 0 && (
                  <div style={{ marginTop: 20 }}>
                    {/* Progress bar */}
                    <div style={{ width: '100%', height: 8, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                      <div style={{
                        width: Math.round((dlProgress.threadsDown / dlProgress.threadsTotal) * 100) + '%',
                        height: '100%', background: HERMES, borderRadius: 4,
                        transition: 'width 0.3s ease',
                      }} />
                    </div>
                    {/* Stats */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280' }}>
                      <span style={{ fontWeight: 600 }}>
                        {dlProgress.threadsDown} of {dlProgress.threadsTotal} threads
                      </span>
                      <span style={{ fontWeight: 700, color: '#111827' }}>
                        {dlProgress.comments.toLocaleString()} comments
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {createError && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{createError}</div>
          )}

          {!creating && (
          <div className="flex gap-3">
            <button onClick={function() { setStep(2) }}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 text-gray-600">Back</button>
            <button onClick={function() { void handleCreate() }} disabled={!datasetName.trim()}
              className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 transition-all"
              style={{ background: HERMES }}>
              Start Download
            </button>
          </div>
          )}
        </div>
      )}
    </div>
  )
}
