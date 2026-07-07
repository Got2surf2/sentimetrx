'use client'

// components/analyze/SubstackWizard.tsx
// Three-step wizard: Enter Substack URL → Select Posts → Download Comments

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import LottieLoader from '@/components/ui/LottieLoader'
import type { SubstackPost } from '@/lib/substack'
import BrandTagInput from '@/components/analyze/BrandTagInput'

const HERMES = '#E8632A'

interface Publication {
  name: string
  description: string
  author_name: string
  base_url: string
}

interface FetchPostsResponse {
  posts: SubstackPost[]
  publication?: Publication | null
  base_url: string
  has_more: boolean
}

type WizardStep = 1 | 2 | 3

interface Props {
  onBack: () => void
}

function formatDate(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function SubstackWizard({ onBack }: Props) {
  var router = useRouter()
  var [step, setStep] = useState<WizardStep>(1)

  // Step 1: Enter URL
  var [urlInput, setUrlInput] = useState('')
  var [loading, setLoading] = useState(false)
  var [error, setError] = useState('')
  var [publication, setPublication] = useState<Publication | null>(null)
  var [posts, setPosts] = useState<SubstackPost[]>([])
  var [baseUrl, setBaseUrl] = useState('')
  var [hasMore, setHasMore] = useState(false)
  var [loadingMore, setLoadingMore] = useState(false)

  // Step 2: Select posts + sort + filter
  var [selected, setSelected] = useState<Set<number>>(new Set())
  var [sortBy, setSortBy] = useState<'date' | 'comments' | 'likes'>('date')
  var [postFilter, setPostFilter] = useState('')

  // Step 3: Download
  var [datasetName, setDatasetName] = useState('')
  var [brandTag, setBrandTag] = useState('')
  var [creating, setCreating] = useState(false)
  var [createError, setCreateError] = useState('')
  var [statusMsg, setStatusMsg] = useState('')
  var [dlProgress, setDlProgress] = useState({ postsDown: 0, postsTotal: 0, comments: 0 })

  // Step 1: Fetch publication + posts
  // Try fetching posts from a URL, return null on failure
  async function tryFetchPosts(url: string): Promise<FetchPostsResponse | null> {
    try {
      var res = await fetch('/api/substack-sources/fetch-posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url }),
      })
      if (!res.ok) return null
      var data = await res.json()
      return data.posts?.length ? data : null
    } catch { return null }
  }

  async function handleFetch() {
    if (!urlInput.trim()) return
    setLoading(true)
    setError('')
    setPosts([])
    setPublication(null)

    var input = urlInput.trim()

    // Try the input as-is first
    var data = await tryFetchPosts(input)

    // If that failed, try variations
    if (!data) {
      var variations: string[] = []
      var cleaned = input.replace(/^https?:\/\//, '').replace(/\.substack\.com.*/, '').replace(/^www\./, '').replace(/\.com.*/, '')
      // Try without "the" prefix
      if (cleaned.startsWith('the')) variations.push(cleaned.slice(3))
      // Try with "the" prefix
      if (!cleaned.startsWith('the')) variations.push('the' + cleaned)
      // Try as custom domain
      if (!input.includes('.')) {
        variations.push('www.' + cleaned + '.com')
        variations.push(cleaned + '.com')
      }

      for (var v of variations) {
        data = await tryFetchPosts(v)
        if (data) break
      }
    }

    if (data) {
      setPublication(data.publication || null)
      setPosts(data.posts)
      setBaseUrl(data.base_url)
      setHasMore(data.has_more)
      setDatasetName((data.publication?.name || input) + ' — Comments')
      setStep(2)
    } else {
      setError('Publication not found. Tips:\n• Use the full URL from your browser (e.g., www.thebulwark.com)\n• Or the exact Substack subdomain (e.g., mattyglesias)\n• Paid-only publications with no free posts won\'t return results')
    }

    setLoading(false)
  }

  // Load more posts
  async function handleLoadMore() {
    setLoadingMore(true)
    try {
      var res = await fetch('/api/substack-sources/fetch-posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: baseUrl, offset: posts.length }),
      })
      var data = await res.json()
      if (res.ok && data.posts?.length) {
        setPosts(function(prev) { return [...prev, ...data.posts] })
        setHasMore(data.has_more)
      } else {
        setHasMore(false)
      }
    } catch {}
    setLoadingMore(false)
  }

  // Toggle post selection
  function togglePost(id: number) {
    setSelected(function(prev) {
      var next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Sort posts
  var sortedPosts = posts.slice().sort(function(a, b) {
    if (sortBy === 'date') return new Date(b.post_date).getTime() - new Date(a.post_date).getTime()
    if (sortBy === 'comments') return b.comment_count - a.comment_count
    return b.reaction_count - a.reaction_count
  })

  // Filter posts by title
  var filterLower = postFilter.toLowerCase().trim()
  var visiblePosts = filterLower ? sortedPosts.filter(function(p) {
    return p.title.toLowerCase().includes(filterLower) || (p.subtitle || '').toLowerCase().includes(filterLower)
  }) : sortedPosts

  // Split into large (10+ comments) and smaller
  var LARGE_THRESHOLD = 10
  var largePosts = visiblePosts.filter(function(p) { return p.comment_count >= LARGE_THRESHOLD })
  var smallPosts = visiblePosts.filter(function(p) { return p.comment_count < LARGE_THRESHOLD })

  function selectAll() {
    var next = new Set(selected)
    visiblePosts.forEach(function(p) { if (p.comment_count > 0 && p.audience === 'everyone') next.add(p.id) })
    setSelected(next)
  }
  function deselectAll() {
    if (!filterLower) { setSelected(new Set()); return }
    var next = new Set(selected)
    visiblePosts.forEach(function(p) { next.delete(p.id) })
    setSelected(next)
  }
  function selectGroup(group: SubstackPost[]) {
    var next = new Set(selected)
    group.forEach(function(p) { if (p.comment_count > 0 && p.audience === 'everyone') next.add(p.id) })
    setSelected(next)
  }
  function deselectGroup(group: SubstackPost[]) {
    var next = new Set(selected)
    group.forEach(function(p) { next.delete(p.id) })
    setSelected(next)
  }

  // Step 3: Create dataset + download comments
  async function handleCreate() {
    setCreating(true)
    setCreateError('')
    setStatusMsg('Creating dataset...')

    try {
      // Create dataset
      var createRes = await fetch('/api/substack-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publication_url: baseUrl,
          dataset_name: datasetName.trim() || 'Substack Comments',
          publication_name: publication?.name || '',
          brand_tag: brandTag.trim() || null,
        }),
      })
      var createData = await createRes.json()
      if (!createRes.ok) throw new Error(createData.error || 'Failed to create dataset')

      var datasetId = createData.dataset_id

      // Download comments post by post
      var selectedPosts = posts.filter(function(p) { return selected.has(p.id) })
      setDlProgress({ postsDown: 0, postsTotal: selectedPosts.length, comments: 0 })
      var totalComments = 0

      for (var i = 0; i < selectedPosts.length; i++) {
        var post = selectedPosts[i]
        setStatusMsg('Downloading comments from "' + (post.title.length > 40 ? post.title.slice(0, 40) + '...' : post.title) + '"')

        try {
          var dlRes = await fetch('/api/substack-sources/download-comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dataset_id: datasetId,
              base_url: baseUrl,
              post_id: post.id,
              post_title: post.title,
              post_date: post.post_date,
            }),
          })
          var dlData = await dlRes.json()
          if (dlRes.ok) totalComments += (dlData.comments || 0)
        } catch {}

        setDlProgress({ postsDown: i + 1, postsTotal: selectedPosts.length, comments: totalComments })
      }

      // Build schema
      setStatusMsg('Finalizing...')
      await fetch('/api/datasets/' + datasetId + '/compute', { method: 'POST' }).catch(function() {})

      // Navigate to Schema page first — auto-redirects to TextMine after save
      window.location.href = '/analyze/' + datasetId + '/settings?new=1'
    } catch (e: unknown) {
      setCreateError((e instanceof Error ? e.message : '') || 'Download failed')
      setCreating(false)
    }
  }

  // Count selected posts with comments
  var selectedWithComments = posts.filter(function(p) { return selected.has(p.id) && p.comment_count > 0 }).length
  var estimatedComments = posts.filter(function(p) { return selected.has(p.id) }).reduce(function(sum, p) { return sum + p.comment_count }, 0)

  return (
    <div className="max-w-2xl mx-auto">
      {/* Step indicator */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={step === 1 ? onBack : function() { setStep(step === 3 ? 2 : 1 as WizardStep) }}
          className="text-sm text-gray-400 hover:text-gray-600">{'\u2190'} Back</button>
        <div className="flex gap-2">
          {[1, 2, 3].map(function(s) {
            return <div key={s} style={{ width: 32, height: 4, borderRadius: 2, background: s <= step ? HERMES : '#e5e7eb', transition: 'background .2s' }} />
          })}
        </div>
        <span className="text-xs text-gray-400 ml-auto">Step {step} of 3</span>
      </div>

      {/* ═══ Step 1: Enter URL ═══ */}
      {step === 1 && (
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-bold text-gray-800">Enter Substack Publication</h2>
          <p className="text-sm text-gray-500">Paste a Substack URL or enter the publication name (e.g. "mattyglesias" or "slowboring.com")</p>

          <div className="flex gap-3">
            <input
              value={urlInput}
              onChange={function(e) { setUrlInput(e.target.value) }}
              onKeyDown={function(e) { if (e.key === 'Enter') void handleFetch() }}
              placeholder="e.g. mattyglesias or https://www.slowboring.com"
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:border-orange-400"
            />
            <button onClick={function() { void handleFetch() }} disabled={loading || !urlInput.trim()}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: HERMES }}>
              {loading ? 'Loading...' : 'Fetch Posts'}
            </button>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600" style={{ whiteSpace: 'pre-line' }}>{error}</div>
          )}
        </div>
      )}

      {/* ═══ Step 2: Select Posts ═══ */}
      {step === 2 && (function() {
        var ROSE = '#e11d48'
        var largeSelected = largePosts.filter(function(p) { return selected.has(p.id) })
        var smallSelected = smallPosts.filter(function(p) { return selected.has(p.id) })

        function renderPostRow(post: SubstackPost) {
          var isSelected = selected.has(post.id)
          var isFree = post.audience === 'everyone'
          var hasComments = post.comment_count > 0
          var canSelect = isFree && hasComments
          return (
            <button key={post.id} onClick={function() { if (canSelect) togglePost(post.id) }}
              disabled={!canSelect}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', textAlign: 'left',
                padding: '8px 14px', background: isSelected ? '#fff1f2' : !canSelect ? '#f9fafb' : 'white',
                border: 'none', borderTop: '1px solid ' + (isSelected ? '#fecdd3' : '#f3f4f6'),
                opacity: canSelect ? 1 : 0.5, cursor: canSelect ? 'pointer' : 'default', transition: 'all .1s',
              }}
              onMouseEnter={function(e) { if (canSelect) (e.currentTarget as HTMLElement).style.background = isSelected ? '#ffe4e6' : '#f0fdf4' }}
              onMouseLeave={function(e) { if (canSelect) (e.currentTarget as HTMLElement).style.background = isSelected ? '#fff1f2' : 'white' }}>
              <div style={{ width: 16, height: 16, borderRadius: 3, border: '2px solid ' + (isSelected ? ROSE : '#d1d5db'), background: isSelected ? ROSE : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                {isSelected && <span style={{ color: 'white', fontSize: 10, fontWeight: 900 }}>{'\u2713'}</span>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', lineHeight: 1.3 }}>{post.title}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 3, fontSize: 11, color: '#9ca3af' }}>
                  <span>{formatDate(post.post_date)}</span>
                  <span style={{ fontWeight: 600, color: hasComments ? '#111827' : '#9ca3af' }}>{post.comment_count} comments</span>
                  <span>{'\u2764'} {post.reaction_count}</span>
                  {post.restacks > 0 && <span>{'\u21BB'} {post.restacks}</span>}
                  {!isFree && <span style={{ fontSize: 10, fontWeight: 700, color: '#d97706', background: '#fffbeb', padding: '1px 6px', borderRadius: 8 }}>Paid</span>}
                </div>
              </div>
            </button>
          )
        }

        return (
        <div className="flex flex-col gap-4">
          {publication && (
            <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18, color: ROSE }}>{'\u2713'}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: ROSE }}>{publication.name}</div>
                <div style={{ fontSize: 11, color: '#6b7280' }}>{publication.author_name ? 'by ' + publication.author_name + ' · ' : ''}{posts.length} posts loaded · ~{estimatedComments.toLocaleString()} comments estimated</div>
              </div>
            </div>
          )}

          <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 16, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Header with select/deselect */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>Posts</div>
                <div style={{ fontSize: 11, color: '#9ca3af' }}>{selected.size} of {posts.length} selected · {estimatedComments.toLocaleString()} comments</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button onClick={selectAll} style={{ fontSize: 11, fontWeight: 600, color: '#059669', background: 'none', border: 'none', cursor: 'pointer' }}>Select All</button>
                <span style={{ color: '#d1d5db', fontSize: 10 }}>|</span>
                <button onClick={deselectAll} style={{ fontSize: 11, fontWeight: 600, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}>Deselect All</button>
              </div>
            </div>

            {/* Sort controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>Sort by:</span>
              {([
                { key: 'date' as const, label: 'Newest' },
                { key: 'comments' as const, label: 'Most Comments' },
                { key: 'likes' as const, label: 'Most Likes' },
              ]).map(function(opt) {
                return (
                  <button key={opt.key} onClick={function() { setSortBy(opt.key) }}
                    style={{
                      fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, cursor: 'pointer',
                      border: '1px solid ' + (sortBy === opt.key ? '#fecdd3' : '#e5e7eb'),
                      background: sortBy === opt.key ? '#fff1f2' : '#f9fafb',
                      color: sortBy === opt.key ? ROSE : '#6b7280',
                    }}>
                    {opt.label}
                  </button>
                )
              })}
            </div>

            {/* Filter box */}
            <input
              value={postFilter}
              onChange={function(e) { setPostFilter(e.target.value) }}
              placeholder="Filter posts by title..."
              style={{
                width: '100%', padding: '8px 14px', borderRadius: 10,
                border: '1px solid ' + (postFilter ? '#fecdd3' : '#e5e7eb'),
                fontSize: 12, outline: 'none', background: postFilter ? '#fff8f5' : '#f9fafb',
                transition: 'all 0.15s',
              }}
            />
            {postFilter && (
              <div style={{ fontSize: 11, color: '#6b7280' }}>
                Showing {visiblePosts.length} of {posts.length} posts matching "{postFilter}"
              </div>
            )}

            {/* Large posts (10+ comments) */}
            {largePosts.length > 0 && (
              <div style={{ border: '1px solid #fecdd3', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ background: '#fff1f2', padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: ROSE }}>Popular Posts</span>
                    <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 6 }}>{LARGE_THRESHOLD}+ comments · {largeSelected.length} of {largePosts.length} selected</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={function() { selectGroup(largePosts) }}
                      style={{ fontSize: 10, fontWeight: 600, color: '#059669', background: 'none', border: 'none', cursor: 'pointer' }}>Select All</button>
                    <button onClick={function() { deselectGroup(largePosts) }}
                      style={{ fontSize: 10, fontWeight: 600, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}>Deselect All</button>
                  </div>
                </div>
                <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                  {largePosts.map(renderPostRow)}
                </div>
              </div>
            )}

            {/* Small posts (<10 comments) */}
            {smallPosts.length > 0 && (
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ background: '#f9fafb', padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#6b7280' }}>Smaller Posts</span>
                    <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 6 }}>under {LARGE_THRESHOLD} comments · {smallSelected.length} of {smallPosts.length} selected</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={function() { selectGroup(smallPosts) }}
                      style={{ fontSize: 10, fontWeight: 600, color: '#059669', background: 'none', border: 'none', cursor: 'pointer' }}>Select All</button>
                    <button onClick={function() { deselectGroup(smallPosts) }}
                      style={{ fontSize: 10, fontWeight: 600, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}>Deselect All</button>
                  </div>
                </div>
                <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                  {smallPosts.map(renderPostRow)}
                </div>
              </div>
            )}
          </div>

          {/* Load more */}
          {hasMore && (
            <button onClick={function() { void handleLoadMore() }} disabled={loadingMore}
              style={{ fontSize: 13, fontWeight: 600, color: ROSE, background: 'none', border: 'none', cursor: 'pointer' }}>
              {loadingMore ? 'Loading more...' : 'Load more posts'}
            </button>
          )}

          {/* Continue */}
          <div className="flex gap-3 mt-2">
            <button onClick={function() { setStep(1) }}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 text-gray-600">Back</button>
            <button onClick={function() { setStep(3) }} disabled={selected.size === 0}
              className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: HERMES }}>
              Next: Download {selected.size} post{selected.size !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
        )
      })()}

      {/* ═══ Step 3: Download ═══ */}
      {step === 3 && (
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-bold text-gray-800">Download Comments</h2>

          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="mb-3">
              <label className="text-xs font-semibold text-gray-500 uppercase">Dataset Name</label>
              <input value={datasetName} onChange={function(e) { setDatasetName(e.target.value) }}
                className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-orange-400" />
            </div>
            <div className="mb-3">
              <BrandTagInput value={brandTag} onChange={setBrandTag} />
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-lg font-bold text-gray-800">{selectedWithComments}</div>
                <div className="text-xs text-gray-400">Posts</div>
              </div>
              <div>
                <div className="text-lg font-bold text-gray-800">{estimatedComments.toLocaleString()}</div>
                <div className="text-xs text-gray-400">Est. Comments</div>
              </div>
              <div>
                <div className="text-lg font-bold text-gray-800">{publication?.name || '—'}</div>
                <div className="text-xs text-gray-400">Publication</div>
              </div>
            </div>
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
                <LottieLoader size={96} message={statusMsg || 'Downloading...'} />
                {dlProgress.postsTotal > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <div style={{ width: '100%', height: 8, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                      <div style={{
                        width: Math.round((dlProgress.postsDown / dlProgress.postsTotal) * 100) + '%',
                        height: '100%', background: '#e11d48', borderRadius: 4,
                        transition: 'width 0.3s ease',
                      }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280' }}>
                      <span style={{ fontWeight: 600 }}>
                        {dlProgress.postsDown} of {dlProgress.postsTotal} posts
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
                style={{ background: '#e11d48' }}>
                Start Download
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
