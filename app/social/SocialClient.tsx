'use client'

// app/social/SocialClient.tsx
// Social media moderation dashboard: comment feed, filters, stats bar, moderation actions

import { useState, useEffect, useCallback } from 'react'
import LottieLoader from '@/components/ui/LottieLoader'

const HERMES = '#E8632A'

interface Comment {
  id: string
  platform: string
  post_id: string
  post_text: string | null
  comment_id: string
  author_name: string | null
  author_id: string | null
  text: string
  sentiment: string | null
  flags: Array<{ type: string; severity: string | null }>
  is_hidden: boolean
  is_deleted: boolean
  is_reply: boolean
  our_reply: string | null
  replied_at: string | null
  platform_created_at: string | null
  ingested_at: string
}

interface Stats {
  total: number
  sentiment: { positive: number; negative: number; neutral: number }
  flagged: number
  hidden: number
  replied: number
  responseRate: number
  byPlatform: Record<string, number>
}

interface Connection {
  id: string
  platform: string
  account_name: string
  token_expires_at: string | null
  created_at: string
}

const SENTIMENT_BADGES: Record<string, { bg: string; text: string; label: string }> = {
  positive: { bg: '#d1fae5', text: '#059669', label: 'Positive' },
  negative: { bg: '#fee2e2', text: '#dc2626', label: 'Negative' },
  neutral:  { bg: '#f3f4f6', text: '#6b7280', label: 'Neutral' },
}

const FLAG_COLORS: Record<string, string> = {
  profanity: '#f59e0b',
  slur: '#dc2626',
  threat: '#dc2626',
  sexual: '#9333ea',
  insult: '#f97316',
  spam: '#6b7280',
  auto_delete: '#dc2626',
  auto_hide: '#d97706',
  review: '#7c3aed',
  competitor: '#0369a1',
  intent: '#059669',
  topics: '#0f766e',
  emotion: '#8b5cf6',
  off_topic: '#94a3b8',
}

const FLAG_LABELS: Record<string, string> = {
  profanity: 'Profanity',
  slur: 'Slur',
  threat: 'Threat',
  sexual: 'Sexual',
  insult: 'Insult',
  spam: 'Spam',
  auto_delete: 'Auto-Delete',
  auto_hide: 'Auto-Hide',
  review: 'Review',
  competitor: 'Competitor',
  intent: 'Engagement',
  topics: 'Topic',
  emotion: 'Emotion',
  off_topic: 'Off-Topic',
}

// Only show these flag types on the dashboard (keyword-detected, not content guard internals)
const VISIBLE_FLAGS = new Set(['auto_delete', 'auto_hide', 'review', 'spam', 'competitor', 'intent', 'topics', 'emotion'])

const PLATFORM_ICONS: Record<string, string> = {
  facebook: '\uD83D\uDCD8',
  instagram: '\uD83D\uDCF7',
}

function timeAgo(date: string | null): string {
  if (!date) return ''
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago'
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago'
  return Math.floor(seconds / 86400) + 'd ago'
}

export default function SocialClient({ orgId }: { orgId: string }) {
  const [comments, setComments] = useState<Comment[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [connections, setConnections] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)

  // Filters
  const [platform, setPlatform] = useState('')
  const [sentiment, setSentiment] = useState('')
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')

  // Selection for bulk actions
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Reply state
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replyLoading, setReplyLoading] = useState(false)

  // Tab + view mode
  const [tab, setTab] = useState<'feed' | 'settings'>('feed')
  const [viewMode, setViewMode] = useState<'recent' | 'bypost'>('recent')

  const fetchComments = useCallback(function() {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('limit', '50')
    if (platform) params.set('platform', platform)
    if (sentiment) params.set('sentiment', sentiment)
    if (flaggedOnly) params.set('flagged', 'true')
    if (search) params.set('search', search)

    fetch('/api/social/comments?' + params.toString())
      .then(function(r) { return r.json() })
      .then(function(d) {
        setComments(d.comments || [])
        setTotal(d.total || 0)
        setPages(d.pages || 1)
      })
      .finally(function() { setLoading(false) })
  }, [page, platform, sentiment, flaggedOnly, search])

  const fetchStats = useCallback(function() {
    fetch('/api/social/stats')
      .then(function(r) { return r.json() })
      .then(function(d) { setStats(d) })
  }, [])

  const fetchConnections = useCallback(function() {
    fetch('/api/social/connections')
      .then(function(r) { return r.json() })
      .then(function(d) { setConnections(d.connections || []) })
  }, [])

  useEffect(function() {
    fetchComments()
  }, [fetchComments])

  useEffect(function() {
    fetchStats()
    fetchConnections()
  }, [fetchStats, fetchConnections])

  // Actions
  async function handleHide(id: string) {
    await fetch('/api/social/comments/' + id + '/hide', { method: 'POST' })
    fetchComments()
    fetchStats()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this comment? This will remove it from the platform.')) return
    await fetch('/api/social/comments/' + id + '/delete', { method: 'POST' })
    fetchComments()
    fetchStats()
  }

  async function handleReply(id: string) {
    if (!replyText.trim()) return
    setReplyLoading(true)
    await fetch('/api/social/comments/' + id + '/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: replyText }),
    })
    setReplyingTo(null)
    setReplyText('')
    setReplyLoading(false)
    fetchComments()
  }

  async function handleAiReply(id: string) {
    setReplyLoading(true)
    const res = await fetch('/api/social/comments/' + id + '/ai-reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoPost: false }),
    })
    const data = await res.json()
    setReplyingTo(id)
    setReplyText(data.reply || '')
    setReplyLoading(false)
  }

  async function handleBulkAction(action: 'hide' | 'delete') {
    if (selected.size === 0) return
    if (action === 'delete' && !confirm('Delete ' + selected.size + ' comments? This cannot be undone.')) return
    await fetch('/api/social/comments/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, commentIds: Array.from(selected) }),
    })
    setSelected(new Set())
    fetchComments()
    fetchStats()
  }

  async function handleDisconnect(id: string) {
    if (!confirm('Disconnect this account? Comments will be preserved.')) return
    await fetch('/api/social/connections/' + id, { method: 'DELETE' })
    fetchConnections()
  }

  function toggleSelect(id: string) {
    setSelected(function(prev) {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    if (selected.size === comments.length) setSelected(new Set())
    else setSelected(new Set(comments.map(function(c) { return c.id })))
  }

  function renderComment(c: Comment) {
    var sentBadge = SENTIMENT_BADGES[c.sentiment || 'neutral'] || SENTIMENT_BADGES.neutral
    var isReplying = replyingTo === c.id
    var needsReview = !c.is_deleted && !c.is_hidden && Array.isArray(c.flags) && c.flags.some(function(f: any) { return f.type === 'review' })

    return (
      <div key={c.id} style={{
        background: c.is_deleted ? '#fef2f2' : c.is_hidden ? '#fffbeb' : needsReview ? '#fefce8' : 'white',
        borderRadius: 12,
        border: '1px solid ' + (c.is_deleted ? '#fca5a5' : c.is_hidden ? '#fcd34d' : needsReview ? '#fde68a' : '#e5e7eb'),
        borderLeft: c.is_deleted ? '4px solid #dc2626' : c.is_hidden ? '4px solid #d97706' : needsReview ? '4px solid #eab308' : '1px solid #e5e7eb',
        padding: 16,
        opacity: c.is_deleted ? 0.7 : 1,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <input type="checkbox" checked={selected.has(c.id)} onChange={function() { toggleSelect(c.id) }} />
          <span style={{ fontSize: 16 }}>{PLATFORM_ICONS[c.platform] || ''}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{c.author_name || 'Unknown'}</span>
          <span style={{ fontSize: 11, color: '#9ca3af' }}>{timeAgo(c.platform_created_at)}</span>
          <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600, background: sentBadge.bg, color: sentBadge.text }}>{sentBadge.label}</span>
          {Array.isArray(c.flags) && c.flags.map(function(f: any, i: number) {
            var flagColor = FLAG_COLORS[f.type] || '#6b7280'
            var displayText = f.action && (f.type === 'topics' || f.type === 'emotion' || f.type === 'intent') ? f.action : (FLAG_LABELS[f.type] || f.type)
            return <span key={i} title={f.action || ''} style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600, background: flagColor + '15', color: flagColor, border: '1px solid ' + flagColor + '30' }}>{displayText}</span>
          })}
          {c.is_deleted && <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: '#fee2e2', color: '#dc2626' }}>Deleted</span>}
          {c.is_hidden && !c.is_deleted && <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: '#fef3c7', color: '#d97706' }}>Hidden</span>}
          {needsReview && <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: '#fef9c3', color: '#a16207' }}>Needs Review</span>}
          {c.is_reply && <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600, background: '#eff6ff', color: '#3b82f6' }}>Reply</span>}
        </div>
        {/* Post context — only in recent view */}
        {viewMode === 'recent' && c.post_text && (
          <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 6, paddingLeft: 28, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 600 }}>
            Re: {c.post_text}
          </div>
        )}
        {/* Comment text */}
        <div style={{ fontSize: 14, lineHeight: 1.5, paddingLeft: 28, marginBottom: 10, color: c.is_deleted ? '#9ca3af' : '#374151', textDecoration: c.is_deleted ? 'line-through' : 'none', fontStyle: c.is_deleted ? 'italic' : 'normal' }}>
          {c.text}
        </div>
        {/* Our reply */}
        {c.our_reply && (
          <div style={{ paddingLeft: 28, marginBottom: 10 }}>
            <div style={{ padding: '8px 12px', background: '#f0fdf4', borderRadius: 8, borderLeft: '3px solid #22c55e', fontSize: 13, color: '#15803d' }}>
              <span style={{ fontWeight: 600, fontSize: 11 }}>Your reply:</span> {c.our_reply}
            </div>
          </div>
        )}
        {/* Actions */}
        <div style={{ display: 'flex', gap: 6, paddingLeft: 28 }}>
          <ActionBtn label={c.is_hidden ? 'Unhide' : 'Hide'} onClick={function() { handleHide(c.id) }} />
          <ActionBtn label="Delete" onClick={function() { handleDelete(c.id) }} danger />
          <ActionBtn label="Reply" onClick={function() { setReplyingTo(isReplying ? null : c.id); setReplyText('') }} active={isReplying} />
          <ActionBtn label="AI Reply" onClick={function() { handleAiReply(c.id) }} loading={replyLoading && replyingTo === c.id} />
        </div>
        {/* Reply composer */}
        {isReplying && (
          <div style={{ paddingLeft: 28, marginTop: 10, display: 'flex', gap: 8 }}>
            <input value={replyText} onChange={function(e) { setReplyText(e.target.value) }}
              onKeyDown={function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(c.id) } }}
              placeholder="Type your reply..."
              style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, minHeight: 0 }} />
            <button onClick={function() { handleReply(c.id) }} disabled={replyLoading || !replyText.trim()}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: replyLoading || !replyText.trim() ? '#d1d5db' : HERMES, color: 'white' }}>
              {replyLoading ? '...' : 'Send'}
            </button>
          </div>
        )}
      </div>
    )
  }

  if (loading && comments.length === 0) {
    return <div className="flex items-center justify-center py-32"><LottieLoader size={80} /></div>
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>Social Moderation</h1>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>Monitor and moderate comments across Facebook and Instagram</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={function() { setTab('feed') }}
            style={{
              padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
              background: tab === 'feed' ? HERMES : '#f3f4f6',
              color: tab === 'feed' ? 'white' : '#374151',
            }}>
            Feed
          </button>
          <button
            onClick={function() { setTab('settings') }}
            style={{
              padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
              background: tab === 'settings' ? HERMES : '#f3f4f6',
              color: tab === 'settings' ? 'white' : '#374151',
            }}>
            Settings
          </button>
        </div>
      </div>

      {tab === 'settings' ? (
        <SettingsPanel connections={connections} onDisconnect={handleDisconnect} />
      ) : (
        <>
          {/* Stats Bar */}
          {stats && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 24 }}>
              <StatCard label="Today" value={stats.total} />
              <StatCard label="Positive" value={stats.sentiment.positive} color="#059669" />
              <StatCard label="Negative" value={stats.sentiment.negative} color="#dc2626" />
              <StatCard label="Flagged" value={stats.flagged} color="#f59e0b" />
              <StatCard label="Hidden" value={stats.hidden} color="#6b7280" />
              <StatCard label="Response Rate" value={stats.responseRate + '%'} color={HERMES} />
            </div>
          )}

          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              value={platform} onChange={function(e) { setPlatform(e.target.value); setPage(1) }}
              style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, background: 'white' }}>
              <option value="">All Platforms</option>
              <option value="facebook">Facebook</option>
              <option value="instagram">Instagram</option>
            </select>

            <select
              value={sentiment} onChange={function(e) { setSentiment(e.target.value); setPage(1) }}
              style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, background: 'white' }}>
              <option value="">All Sentiment</option>
              <option value="positive">Positive</option>
              <option value="neutral">Neutral</option>
              <option value="negative">Negative</option>
            </select>

            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: '#374151', cursor: 'pointer' }}>
              <input type="checkbox" checked={flaggedOnly} onChange={function(e) { setFlaggedOnly(e.target.checked); setPage(1) }} />
              Flagged only
            </label>

            {/* View mode toggle */}
            <div style={{ display: 'flex', gap: 2, background: '#f3f4f6', borderRadius: 8, padding: 2 }}>
              <button onClick={function() { setViewMode('recent') }}
                style={{ padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
                  background: viewMode === 'recent' ? 'white' : 'transparent', color: viewMode === 'recent' ? '#111827' : '#9ca3af',
                  boxShadow: viewMode === 'recent' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none' }}>
                Recent
              </button>
              <button onClick={function() { setViewMode('bypost') }}
                style={{ padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
                  background: viewMode === 'bypost' ? 'white' : 'transparent', color: viewMode === 'bypost' ? '#111827' : '#9ca3af',
                  boxShadow: viewMode === 'bypost' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none' }}>
                By Post
              </button>
            </div>

            <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
              <input
                value={searchInput}
                onChange={function(e) { setSearchInput(e.target.value) }}
                onKeyDown={function(e) { if (e.key === 'Enter') { setSearch(searchInput); setPage(1) } }}
                placeholder="Search comments..."
                style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, width: 200, minHeight: 0 }}
              />
              <button
                onClick={function() { setSearch(searchInput); setPage(1) }}
                style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, background: 'white', cursor: 'pointer' }}>
                Search
              </button>
            </div>
          </div>

          {/* Bulk Actions */}
          {selected.size > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', marginBottom: 12,
              background: '#eff6ff', borderRadius: 10, border: '1px solid #bfdbfe',
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1d4ed8' }}>{selected.size} selected</span>
              <button onClick={function() { handleBulkAction('hide') }}
                style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12, background: 'white', cursor: 'pointer' }}>
                Hide All
              </button>
              <button onClick={function() { handleBulkAction('delete') }}
                style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #fca5a5', fontSize: 12, background: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}>
                Delete All
              </button>
              <button onClick={function() { setSelected(new Set()) }}
                style={{ padding: '5px 12px', borderRadius: 6, border: 'none', fontSize: 12, background: 'transparent', color: '#6b7280', cursor: 'pointer' }}>
                Clear
              </button>
            </div>
          )}

          {/* No connections prompt */}
          {connections.length === 0 && comments.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: '80px 24px' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>{'\uD83D\uDD17'}</div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 8 }}>Connect Your Social Accounts</h2>
              <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 24, maxWidth: 400, margin: '0 auto 24px' }}>
                Connect your Facebook Page and Instagram Business account to start monitoring and moderating comments.
              </p>
              <a href="/api/social/connect"
                style={{
                  display: 'inline-block', padding: '10px 24px', borderRadius: 10, fontSize: 14, fontWeight: 600,
                  background: '#1877f2', color: 'white', textDecoration: 'none',
                }}>
                Connect Facebook Page
              </a>
            </div>
          )}

          {/* Comment Feed */}
          {comments.length > 0 && viewMode === 'bypost' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {(function() {
                // Group comments by post_id
                var groups: Record<string, { postText: string; comments: Comment[] }> = {}
                for (var gc of comments) {
                  var pid = gc.post_id || 'unknown'
                  if (!groups[pid]) groups[pid] = { postText: gc.post_text || 'Post', comments: [] }
                  groups[pid].comments.push(gc)
                }
                // Sort by most recent comment per post
                var sorted = Object.entries(groups).sort(function(a, b) {
                  var lastA = a[1].comments.reduce(function(max, c) { return c.platform_created_at && c.platform_created_at > max ? c.platform_created_at : max }, '')
                  var lastB = b[1].comments.reduce(function(max, c) { return c.platform_created_at && c.platform_created_at > max ? c.platform_created_at : max }, '')
                  return lastB > lastA ? 1 : -1
                })
                return sorted.map(function(entry) {
                  var postId = entry[0]
                  var group = entry[1]
                  // Compute detailed counts
                  var posCount = group.comments.filter(function(c) { return c.sentiment === 'positive' }).length
                  var negCount = group.comments.filter(function(c) { return c.sentiment === 'negative' }).length
                  var neuCount = group.comments.filter(function(c) { return c.sentiment === 'neutral' }).length
                  var deletedCount = group.comments.filter(function(c) { return c.is_deleted }).length
                  var hiddenCount = group.comments.filter(function(c) { return c.is_hidden && !c.is_deleted }).length
                  var reviewCount = group.comments.filter(function(c) { return !c.is_deleted && !c.is_hidden && Array.isArray(c.flags) && c.flags.some(function(f: any) { return f.type === 'review' }) }).length
                  var offTopicCount = group.comments.filter(function(c) { return Array.isArray(c.flags) && c.flags.some(function(f: any) { return f.type === 'off_topic' }) }).length
                  // Last comment time
                  var lastTime = group.comments.reduce(function(max, c) { return c.platform_created_at && c.platform_created_at > max ? c.platform_created_at : max }, '')
                  return (
                    <details key={postId} style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                      <summary style={{ padding: '14px 16px', cursor: 'pointer', background: '#f9fafb' }}>
                        {/* Top row: post text + last comment time */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: '#111827', flex: 1, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden' }}>{group.postText}</span>
                          <span style={{ fontSize: 10, color: '#9ca3af', flexShrink: 0, marginLeft: 12, whiteSpace: 'nowrap' }}>Last: {timeAgo(lastTime)}</span>
                        </div>
                        {/* Pills row */}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#374151', padding: '2px 8px', borderRadius: 10, background: '#e5e7eb' }}>{group.comments.length} comments</span>
                          {posCount > 0 && <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 10, background: '#d1fae5', color: '#059669' }}>{posCount} positive</span>}
                          {neuCount > 0 && <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 10, background: '#f3f4f6', color: '#6b7280' }}>{neuCount} neutral</span>}
                          {negCount > 0 && <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 10, background: '#fee2e2', color: '#dc2626' }}>{negCount} negative</span>}
                          {deletedCount > 0 && <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 10, background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5' }}>{deletedCount} deleted</span>}
                          {hiddenCount > 0 && <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 10, background: '#fef3c7', color: '#d97706', border: '1px solid #fcd34d' }}>{hiddenCount} hidden</span>}
                          {reviewCount > 0 && <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 10, background: '#fef9c3', color: '#a16207', border: '1px solid #fde68a' }}>{reviewCount} review</span>}
                          {offTopicCount > 0 && <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 10, background: '#f1f5f9', color: '#94a3b8', border: '1px solid #cbd5e1' }}>{offTopicCount} off-topic</span>}
                        </div>
                        {/* Preview: first 3 comments truncated */}
                        <div style={{ marginTop: 8 }}>
                          {group.comments.slice(0, 3).map(function(c, i) {
                            var previewColor = c.is_deleted ? '#dc2626' : c.is_hidden ? '#d97706' : '#6b7280'
                            return <div key={i} style={{ fontSize: 11, color: previewColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%', lineHeight: 1.6 }}>
                              <span style={{ fontWeight: 600 }}>{c.author_name || 'Unknown'}:</span> {c.text}
                            </div>
                          })}
                          {group.comments.length > 3 && <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>+ {group.comments.length - 3} more</div>}
                        </div>
                      </summary>
                      <div style={{ padding: '8px 16px 16px', display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid #e5e7eb' }}>
                        {group.comments.map(function(c) {
                          return renderComment(c)
                        })}
                      </div>
                    </details>
                  )
                })
              })()}
            </div>
          )}

          {comments.length > 0 && viewMode === 'recent' && (
            <>
              <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#6b7280', cursor: 'pointer' }}>
                  <input type="checkbox" checked={selected.size === comments.length && comments.length > 0} onChange={selectAll} />
                  Select all
                </label>
                <span style={{ fontSize: 12, color: '#9ca3af' }}>{total} comments</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {comments.map(function(c) { return renderComment(c) })}
              </div>

              {/* Pagination */}
              {pages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 24 }}>
                  <button disabled={page <= 1} onClick={function() { setPage(page - 1) }}
                    style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, background: 'white', cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? 0.5 : 1 }}>
                    Previous
                  </button>
                  <span style={{ padding: '6px 14px', fontSize: 13, color: '#6b7280' }}>
                    Page {page} of {pages}
                  </span>
                  <button disabled={page >= pages} onClick={function() { setPage(page + 1) }}
                    style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, background: 'white', cursor: page >= pages ? 'default' : 'pointer', opacity: page >= pages ? 0.5 : 1 }}>
                    Next
                  </button>
                </div>
              )}
            </>
          )}

          {/* Empty state when connected but no comments */}
          {connections.length > 0 && comments.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: '60px 24px' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>{'\u2705'}</div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 8 }}>No Comments Yet</h2>
              <p style={{ fontSize: 14, color: '#6b7280' }}>
                Your accounts are connected. Comments will appear here as they come in.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={{ background: 'white', borderRadius: 10, border: '1px solid #e5e7eb', padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || '#111827' }}>
        {value}
      </div>
    </div>
  )
}

function ActionBtn({ label, onClick, danger, active, loading }: {
  label: string; onClick: () => void; danger?: boolean; active?: boolean; loading?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
        border: '1px solid ' + (danger ? '#fca5a5' : active ? HERMES : '#e5e7eb'),
        background: danger ? '#fef2f2' : active ? HERMES : 'white',
        color: danger ? '#dc2626' : active ? 'white' : '#374151',
      }}>
      {loading ? '...' : label}
    </button>
  )
}

function SettingsPanel({ connections, onDisconnect }: { connections: Connection[]; onDisconnect: (id: string) => void }) {
  return (
    <div>
      {/* Connected Accounts */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 12 }}>Connected Accounts</h2>

        {connections.length === 0 ? (
          <div style={{ background: 'white', borderRadius: 10, border: '1px solid #e5e7eb', padding: 24, textAlign: 'center' }}>
            <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 16 }}>No accounts connected yet.</p>
            <a href="/api/social/connect"
              style={{
                display: 'inline-block', padding: '10px 24px', borderRadius: 10, fontSize: 14, fontWeight: 600,
                background: '#1877f2', color: 'white', textDecoration: 'none',
              }}>
              Connect Facebook Page
            </a>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {connections.map(function(conn) {
              const expiresIn = conn.token_expires_at
                ? Math.max(0, Math.floor((new Date(conn.token_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
                : null

              return (
                <div key={conn.id} style={{
                  background: 'white', borderRadius: 10, border: '1px solid #e5e7eb', padding: 16,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 20 }}>{PLATFORM_ICONS[conn.platform] || ''}</span>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{conn.account_name}</div>
                      <div style={{ fontSize: 12, color: '#9ca3af' }}>
                        {conn.platform} {expiresIn !== null && (' \u00B7 Token expires in ' + expiresIn + ' days')}
                      </div>
                    </div>
                  </div>
                  <button onClick={function() { onDisconnect(conn.id) }}
                    style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #fca5a5', fontSize: 12, fontWeight: 600, background: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}>
                    Disconnect
                  </button>
                </div>
              )
            })}

            <a href="/api/social/connect"
              style={{
                display: 'inline-block', padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                background: '#1877f2', color: 'white', textDecoration: 'none', textAlign: 'center', marginTop: 8,
              }}>
              + Connect Another Page
            </a>
          </div>
        )}
      </div>

      {/* Alert Rules placeholder */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 12 }}>Alert Rules</h2>
        <AlertRulesPanel />
      </div>

      {/* Auto-config placeholder */}
      <div>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 12 }}>Automation</h2>
        <AutoConfigPanel />
      </div>
    </div>
  )
}

function AlertRulesPanel() {
  const [rules, setRules] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(function() {
    fetch('/api/social/alerts').then(function(r) { return r.json() }).then(function(d) {
      setRules(d.rules || [])
    }).finally(function() { setLoading(false) })
  }, [])

  async function addRule(ruleType: string) {
    const defaults: Record<string, any> = {
      hate_speech: { config: {}, channels: [] },
      negative_spike: { config: { threshold: 10, window_minutes: 30 }, channels: [] },
      keyword: { config: { keywords: [] }, channels: [] },
      volume_spike: { config: { threshold: 50, window_minutes: 30 }, channels: [] },
    }
    const def = defaults[ruleType] || { config: {}, channels: [] }
    const res = await fetch('/api/social/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rule_type: ruleType, ...def }),
    })
    const newRule = await res.json()
    setRules(function(prev) { return [newRule, ...prev] })
  }

  async function toggleRule(id: string, enabled: boolean) {
    await fetch('/api/social/alerts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, enabled: !enabled }),
    })
    setRules(function(prev) { return prev.map(function(r) { return r.id === id ? { ...r, enabled: !enabled } : r }) })
  }

  async function deleteRule(id: string) {
    await fetch('/api/social/alerts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setRules(function(prev) { return prev.filter(function(r) { return r.id !== id }) })
  }

  const RULE_LABELS: Record<string, string> = {
    hate_speech: 'Hate Speech / Threats',
    negative_spike: 'Negative Sentiment Spike',
    keyword: 'Keyword Trigger',
    volume_spike: 'High Volume Spike',
  }

  if (loading) return <div style={{ fontSize: 13, color: '#9ca3af' }}>Loading...</div>

  return (
    <div>
      {rules.map(function(r) {
        return (
          <div key={r.id} style={{
            background: 'white', borderRadius: 10, border: '1px solid #e5e7eb', padding: 14, marginBottom: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{RULE_LABELS[r.rule_type] || r.rule_type}</span>
              <span style={{
                marginLeft: 8, padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600,
                background: r.enabled ? '#d1fae5' : '#f3f4f6', color: r.enabled ? '#059669' : '#6b7280',
              }}>
                {r.enabled ? 'Active' : 'Paused'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={function() { toggleRule(r.id, r.enabled) }}
                style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 11, background: 'white', cursor: 'pointer' }}>
                {r.enabled ? 'Pause' : 'Enable'}
              </button>
              <button onClick={function() { deleteRule(r.id) }}
                style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #fca5a5', fontSize: 11, background: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}>
                Remove
              </button>
            </div>
          </div>
        )
      })}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {['hate_speech', 'negative_spike', 'keyword', 'volume_spike'].map(function(type) {
          return (
            <button key={type} onClick={function() { addRule(type) }}
              style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12, background: 'white', cursor: 'pointer' }}>
              + {RULE_LABELS[type]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function AutoConfigPanel() {
  const [config, setConfig] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(function() {
    fetch('/api/social/auto-config').then(function(r) { return r.json() }).then(function(d) {
      setConfig(d.config)
    }).finally(function() { setLoading(false) })
  }, [])

  async function update(key: string, value: any) {
    const newConfig = { ...config, [key]: value }
    setConfig(newConfig)
    await fetch('/api/social/auto-config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    })
  }

  if (loading || !config) return <div style={{ fontSize: 13, color: '#9ca3af' }}>Loading...</div>

  return (
    <div style={{ background: 'white', borderRadius: 10, border: '1px solid #e5e7eb', padding: 20 }}>
      {/* Auto-reply */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>Auto-Reply (AI)</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={config.auto_reply_enabled} onChange={function(e) { update('auto_reply_enabled', e.target.checked) }} />
            <span style={{ fontSize: 12, color: '#6b7280' }}>Enabled</span>
          </label>
        </div>
        {config.auto_reply_enabled && (
          <select
            value={config.auto_reply_mode}
            onChange={function(e) { update('auto_reply_mode', e.target.value) }}
            style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, background: 'white' }}>
            <option value="all">Reply to all comments</option>
            <option value="positive_neutral">Reply to positive/neutral only</option>
            <option value="queue">Queue for human review</option>
          </select>
        )}
      </div>

      {/* Auto-hide */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>Auto-Hide Flagged</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={config.auto_hide_enabled} onChange={function(e) { update('auto_hide_enabled', e.target.checked) }} />
            <span style={{ fontSize: 12, color: '#6b7280' }}>Enabled</span>
          </label>
        </div>
        {config.auto_hide_enabled && (
          <select
            value={config.auto_hide_severity}
            onChange={function(e) { update('auto_hide_severity', e.target.value) }}
            style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, background: 'white' }}>
            <option value="severe">Severe only (threats, slurs, sexual)</option>
            <option value="rude">Severe + rude (includes insults)</option>
          </select>
        )}
      </div>
    </div>
  )
}
