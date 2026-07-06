'use client'

// app/bots/BotsClient.tsx
// Client component: lists bots as cards, handles create/edit/delete

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import LottieLoader from '@/components/ui/LottieLoader'
import { FavoriteStar } from '@/components/ui/FavoriteStar'

const HERMES = '#E8632A'

interface Bot {
  id: string
  name: string
  slug: string
  status: 'draft' | 'active' | 'paused'
  config: Record<string, unknown>
  system_prompt: string
  knowledge_base: string
  conversation_count: number
  open_questions?: number
  last_session_at: string | null
  created_at: string
  updated_at: string
  org_id?: string
  org_name?: string | null
}

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  draft:  { bg: '#f3f4f6', text: '#6b7280', border: '#e5e7eb', label: 'Draft' },
  active: { bg: '#d1fae5', text: '#059669', border: '#a7f3d0', label: 'Active' },
  paused: { bg: '#fef3c7', text: '#d97706', border: '#fcd34d', label: 'Paused' },
}

export default function BotsClient({ orgId, isAdmin = false, orgFilter = '' }: { orgId: string; isAdmin?: boolean; orgFilter?: string }) {
  const router = useRouter()
  const [bots, setBots] = useState<Bot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [gridCols, setGridCols] = useState(3)
  const [viewportTier, setViewportTier] = useState<'mobile' | 'tablet' | 'desktop'>('desktop')
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [sortMode, setSortMode] = useState<'updated' | 'created' | 'name'>('updated')
  const [query, setQuery] = useState('')

  useEffect(function() {
    if (typeof window === 'undefined') return
    var saved = window.localStorage.getItem('sentimetrx.sort.bots')
    if (saved === 'updated' || saved === 'created' || saved === 'name') setSortMode(saved)
  }, [])

  function changeSort(next: 'updated' | 'created' | 'name') {
    setSortMode(next)
    if (typeof window !== 'undefined') window.localStorage.setItem('sentimetrx.sort.bots', next)
  }

  // Favorites first (sorted by chosen mode within each group), then the rest.
  function sortedBots(): Bot[] {
    function sortKey(b: Bot): string | number {
      if (sortMode === 'name')    return (b.name || '').toLowerCase()
      if (sortMode === 'created') return -new Date(b.created_at).getTime()
      return -new Date(b.updated_at).getTime() // 'updated' default
    }
    var q = query.trim().toLowerCase()
    var copy = q ? bots.filter(function(b) { return (b.name || '').toLowerCase().includes(q) }) : bots.slice()
    copy.sort(function(a, b) {
      var aFav = favoriteIds.has(a.id) ? 0 : 1
      var bFav = favoriteIds.has(b.id) ? 0 : 1
      if (aFav !== bFav) return aFav - bFav
      var ka = sortKey(a); var kb = sortKey(b)
      if (ka < kb) return -1
      if (ka > kb) return 1
      return 0
    })
    return copy
  }
  function firstNonFavIndex(list: Bot[]): number {
    for (var i = 0; i < list.length; i++) { if (!favoriteIds.has(list[i].id)) return i }
    return -1
  }

  useEffect(function() {
    function update() {
      var w = typeof window !== 'undefined' ? window.innerWidth : 1200
      if (w < 700)       setViewportTier('mobile')
      else if (w < 1000) setViewportTier('tablet')
      else               setViewportTier('desktop')
    }
    update()
    window.addEventListener('resize', update)
    return function() { window.removeEventListener('resize', update) }
  }, [])

  // Mobile always shows 1 column; tablets cap at 2; desktop honors the picker.
  var effectiveCols = viewportTier === 'mobile' ? 1
                    : viewportTier === 'tablet' ? Math.min(2, gridCols)
                    : gridCols

  function fetchBots() {
    var qs = orgFilter ? '?org=' + encodeURIComponent(orgFilter) : ''
    fetch('/api/bots' + qs).then(function(r) { return r.json() }).then(function(d) {
      setBots(d.bots || [])
    }).catch(function() {
      setError('Failed to load bots')
    }).finally(function() { setLoading(false) })
  }

  function fetchFavorites() {
    fetch('/api/favorites').then(function(r) { return r.json() }).then(function(d) {
      var s = new Set<string>()
      for (var i = 0; i < (d.favorites || []).length; i++) {
        if (d.favorites[i].resource_type === 'bot') s.add(d.favorites[i].resource_id)
      }
      setFavoriteIds(s)
    }).catch(function() { /* non-fatal */ })
  }

  useEffect(function() { fetchBots(); fetchFavorites() }, [orgFilter])

  async function toggleStatus(bot: Bot) {
    var next: Bot['status'] = bot.status === 'active' ? 'paused' : 'active'
    await fetch('/api/bots/' + bot.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })
    setBots(function(prev) {
      return prev.map(function(b) { return b.id === bot.id ? { ...b, status: next } : b })
    })
  }

  async function deleteBot(bot: Bot) {
    if (!confirm('Delete agent "' + bot.name + '"? This cannot be undone.')) return
    await fetch('/api/bots/' + bot.id, { method: 'DELETE' })
    setBots(function(prev) { return prev.filter(function(b) { return b.id !== bot.id }) })
  }

  function copyLink(bot: Bot) {
    var url = typeof window !== 'undefined' ? window.location.origin + '/b/' + bot.slug : '/b/' + bot.slug
    void navigator.clipboard.writeText(url)
  }

  if (loading) return <div className="flex items-center justify-center py-32"><LottieLoader size={80} /></div>

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>Agents</h1>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>Create and manage branded AI agents trained on your content</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input type="text" value={query} onChange={function(e) { setQuery(e.target.value) }} placeholder="Search by name…"
            style={{ fontSize: 16, padding: '4px 10px', borderRadius: 8, border: '1px solid #e5e7eb', background: 'white', color: '#374151', outline: 'none', width: 180 }} />
          {/* Sort — always visible */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#9ca3af' }}>
            <span>Sort:</span>
            <select value={sortMode}
              onChange={function(e) { changeSort(e.target.value as 'updated' | 'created' | 'name') }}
              style={{ fontSize: 11, padding: '3px 6px', borderRadius: 8, border: '1px solid #e5e7eb', background: 'white', color: '#374151', cursor: 'pointer' }}>
              <option value="updated">Last updated</option>
              <option value="created">Created</option>
              <option value="name">Name</option>
            </select>
          </label>
          {/* Grid toggle — desktop only; mobile/tablet force 1 / 2 cols */}
          <div style={{ display: viewportTier === 'desktop' ? 'flex' : 'none', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10, color: '#9ca3af', marginRight: 2 }}>Grid:</span>
            {[2, 3, 4].map(function(n) {
              return (
                <button key={n} onClick={function() { setGridCols(n) }}
                  style={{
                    fontSize: 10, padding: '3px 8px', borderRadius: 8, fontWeight: 600,
                    background: gridCols === n ? '#fff4ef' : '#f9fafb',
                    border: '1px solid ' + (gridCols === n ? HERMES : '#e5e7eb'),
                    color: gridCols === n ? HERMES : '#6b7280',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}>
                  {n}
                </button>
              )
            })}
          </div>
          <button onClick={function() { fetchBots() }}
            style={{ fontSize: 11, padding: '4px 12px', borderRadius: 16, border: '1px solid #d1d5db', background: 'white', color: '#6b7280', cursor: 'pointer', fontWeight: 600 }}>
            ↻ Refresh
          </button>
          <ImportBotButton onImported={fetchBots} />
          <span style={{ fontSize: 13, color: '#9ca3af' }}>{bots.length} agent{bots.length !== 1 ? 's' : ''}</span>
          <button
            onClick={function() { router.push('/bots/new') }}
            style={{
              padding: '8px 20px', borderRadius: 20, border: 'none',
              background: HERMES, color: 'white', fontSize: 13, fontWeight: 600,
              cursor: 'pointer',
            }}
          >+ New Agent</button>
        </div>
      </div>

      {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 16 }}>{error}</p>}

      {bots.length === 0 && !loading && (
        <div style={{
          textAlign: 'center', padding: '64px 32px',
          background: 'white', borderRadius: 16, border: '2px dashed #e5e7eb',
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>{'\uD83E\uDD16'}</div>
          <p style={{ fontSize: 16, fontWeight: 600, color: '#374151' }}>No agents yet</p>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>Create your first branded AI agent to get started.</p>
          <button
            onClick={function() { router.push('/bots/new') }}
            style={{
              marginTop: 20, padding: '10px 24px', borderRadius: 20, border: 'none',
              background: HERMES, color: 'white', fontSize: 13, fontWeight: 600,
              cursor: 'pointer',
            }}
          >Create Agent</button>
        </div>
      )}

      {/* Card grid — favorites first, then a thin orange divider, then rest */}
      {(function() {
        var sorted = sortedBots()
        var divIdx = firstNonFavIndex(sorted)
        return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + effectiveCols + ', 1fr)', gap: 16 }}>
        {sorted.map(function(bot, i) {
          // Inject the divider row right before the first non-favorite,
          // but only if there's at least one favorite above it.
          var showDivider = i === divIdx && divIdx > 0
          var sc = STATUS_COLORS[bot.status] || STATUS_COLORS.draft
          var cfg = bot.config as any || {}
          var headerGrad = cfg.headerGradient || 'linear-gradient(135deg, #0a1628, #1a2d4a)'
          var avatarGrad = cfg.avatarGradient || 'linear-gradient(135deg, #00b4d8, #0077a8)'
          var avatarText = cfg.avatarTextColor || 'white'
          var avatarLetter = cfg.avatarLetter || bot.name.charAt(0)
          var accentColor = cfg.accentColor || '#00b4d8'
          var websiteLabel = cfg.websiteLabel || ''
          var subtitle = cfg.subtitle || ''
          var created = new Date(bot.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
          var updatedRel = relativeTime(bot.updated_at)
          // Agent-health dot (no fetch): derived from status + recency of the
          // last conversation. Rich health (response rate, depth) lives in the
          // per-agent Report. Gray = paused/idle, green = active this week.
          var lastChatMs = bot.last_session_at ? Date.now() - new Date(bot.last_session_at).getTime() : Infinity
          var healthDot = bot.status !== 'active' ? '#9CA3AF'
            : lastChatMs < 7 * 86400000 ? '#059669'
            : lastChatMs < 14 * 86400000 ? '#D97706'
            : '#9CA3AF'
          var openQ = bot.open_questions || 0

          return (
            <React.Fragment key={bot.id}>
            {showDivider && (
              <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #fbd5c2', margin: '4px 0 0' }} />
            )}
            <div style={{
              background: 'white', borderRadius: 16, border: '1px solid #e5e7eb',
              overflow: 'hidden', display: 'flex', flexDirection: 'column',
              transition: 'box-shadow 0.15s, border-color 0.15s',
            }}
              onMouseEnter={function(e) { (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 18px rgba(0,0,0,0.08)'; (e.currentTarget as HTMLElement).style.borderColor = accentColor + '60' }}
              onMouseLeave={function(e) { (e.currentTarget as HTMLElement).style.boxShadow = ''; (e.currentTarget as HTMLElement).style.borderColor = '#e5e7eb' }}
            >
              {/* Color strip */}
              <div style={{ height: 6, width: '100%', background: headerGrad }} />

              <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
                {/* Top row: avatar + name + status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: '50%',
                    background: avatarGrad,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, fontWeight: 700, color: avatarText, flexShrink: 0,
                  }}>
                    {avatarLetter}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span title="Agent health" style={{ width: 9, height: 9, borderRadius: '50%', background: healthDot, flexShrink: 0 }} />
                      <span style={{ fontSize: 15, fontWeight: 700, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bot.name}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                        background: sc.bg, color: sc.text, border: '1px solid ' + sc.border,
                      }}>{sc.label}</span>
                    </div>
                    {subtitle && (
                      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{subtitle}</div>
                    )}
                  </div>
                  <FavoriteStar resourceType="bot" resourceId={bot.id} initialFavorited={favoriteIds.has(bot.id)} />
                </div>

                {/* Info row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: '#6b7280' }}>
                  <span>/b/{bot.slug}</span>
                  {websiteLabel && <span>{'\u2192'} {websiteLabel}</span>}
                </div>

                {/* Org name \u2014 admin only, helps identify cross-org cards */}
                {isAdmin && bot.org_name && (
                  <div style={{ fontSize: 10, color: '#9ca3af', marginTop: -6 }}>
                    {bot.org_name}
                  </div>
                )}

                {/* Stats row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, flexWrap: 'wrap' }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 18, color: accentColor }}>{bot.conversation_count}</span>
                    <span style={{ color: '#9ca3af', marginLeft: 4 }}>conversation{bot.conversation_count !== 1 ? 's' : ''}</span>
                  </div>
                  {openQ > 0 && (
                    <a href={'/bots/' + bot.id + '/questions'}
                      style={{ fontSize: 11, fontWeight: 600, color: '#92400E', background: '#FEF3C7', padding: '2px 8px', borderRadius: 10, textDecoration: 'none' }}
                      title="Unanswered logged questions">
                      {openQ} open question{openQ !== 1 ? 's' : ''}
                    </a>
                  )}
                </div>

                {/* Dates */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 10, color: '#d1d5db', flexWrap: 'wrap' }}>
                  <span>Created {created}</span>
                  <span style={{ color: '#9ca3af' }} title={new Date(bot.updated_at).toLocaleString()}>Updated {updatedRel}</span>
                  {bot.last_session_at && (
                    <span style={{ color: '#9ca3af' }}>Last chat {(function() {
                      var ms = Date.now() - new Date(bot.last_session_at).getTime()
                      if (ms < 60000) return 'just now'
                      if (ms < 3600000) return Math.floor(ms / 60000) + 'm ago'
                      if (ms < 86400000) return Math.floor(ms / 3600000) + 'h ago'
                      return Math.floor(ms / 86400000) + 'd ago'
                    })()}</span>
                  )}
                </div>

                {/* Copy link */}
                {bot.status === 'active' && (
                  <button
                    onClick={function(e) {
                      e.stopPropagation()
                      copyLink(bot)
                      var span = (e.currentTarget as HTMLElement).querySelector('span')
                      if (span) { span.textContent = 'Copied!'; setTimeout(function() { span!.textContent = '/b/' + bot.slug }, 1500) }
                    }}
                    style={{
                      fontSize: 11, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 5, padding: 0, textAlign: 'left',
                      transition: 'color 0.15s',
                    }}
                    onMouseEnter={function(e) { (e.currentTarget as HTMLElement).style.color = '#059669' }}
                    onMouseLeave={function(e) { (e.currentTarget as HTMLElement).style.color = '#9ca3af' }}
                    title="Click to copy bot link">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    <span>/b/{bot.slug}</span>
                  </button>
                )}

                {/* Action pills */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 'auto', paddingTop: 10, borderTop: '1px solid #f3f4f6' }}>
                  <button
                    onClick={function() { window.open('/b/' + bot.slug, '_blank') }}
                    style={{
                      fontSize: 11, padding: '6px 0', borderRadius: 8, fontWeight: 600,
                      background: accentColor + '15', color: accentColor,
                      border: '1px solid ' + accentColor + '30',
                      cursor: 'pointer', transition: 'all 0.1s',
                    }}>
                    Preview
                  </button>
                  <button
                    onClick={function() { router.push('/bots/' + bot.id + '/conversations') }}
                    style={{
                      fontSize: 11, padding: '6px 0', borderRadius: 8, fontWeight: 600,
                      background: '#f0f9ff', color: '#0369a1',
                      border: '1px solid #bae6fd',
                      cursor: 'pointer', transition: 'all 0.1s',
                    }}>
                    Chats
                  </button>
                  <button
                    onClick={function() { router.push('/bots/new?edit=' + bot.id) }}
                    style={{
                      fontSize: 11, padding: '6px 0', borderRadius: 8, fontWeight: 600,
                      background: '#fff4ef', color: HERMES,
                      border: '1px solid #fbd5c2',
                      cursor: 'pointer', transition: 'all 0.1s',
                    }}>
                    Edit
                  </button>
                  <button
                    onClick={function() { void toggleStatus(bot) }}
                    style={{
                      fontSize: 11, padding: '6px 0', borderRadius: 8, fontWeight: 600,
                      background: bot.status === 'active' ? '#fef3c7' : '#d1fae5',
                      color: bot.status === 'active' ? '#d97706' : '#059669',
                      border: '1px solid ' + (bot.status === 'active' ? '#fcd34d' : '#a7f3d0'),
                      cursor: 'pointer', transition: 'all 0.1s',
                    }}>
                    {bot.status === 'active' ? 'Pause' : 'Activate'}
                  </button>
                </div>

                {/* Analyze in Ana — full-width, mirrors TownHall card pattern */}
                <AnalyzeInAnaButton botId={bot.id} />

                {/* History + Export + Delete — small footer row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10 }}>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <a
                      href={'/bots/' + bot.id + '/report'}
                      style={{ color: '#0F7173', fontWeight: 600, textDecoration: 'none', transition: 'color 0.15s' }}
                      onMouseEnter={function(e) { (e.currentTarget as HTMLElement).style.color = '#0a4f50' }}
                      onMouseLeave={function(e) { (e.currentTarget as HTMLElement).style.color = '#0F7173' }}>
                      Report
                    </a>
                    <a
                      href={'/bots/' + bot.id + '/readout'}
                      style={{ color: '#9ca3af', textDecoration: 'none', transition: 'color 0.15s', whiteSpace: 'nowrap' }}
                      onMouseEnter={function(e) { (e.currentTarget as HTMLElement).style.color = '#374151' }}
                      onMouseLeave={function(e) { (e.currentTarget as HTMLElement).style.color = '#9ca3af' }}>
                      What We Heard
                    </a>
                    <a
                      href={'/bots/' + bot.id + '/questions'}
                      style={{ color: '#9ca3af', textDecoration: 'none', transition: 'color 0.15s' }}
                      onMouseEnter={function(e) { (e.currentTarget as HTMLElement).style.color = '#374151' }}
                      onMouseLeave={function(e) { (e.currentTarget as HTMLElement).style.color = '#9ca3af' }}>
                      Questions
                    </a>
                    <a
                      href={'/bots/' + bot.id + '/entities'}
                      style={{ color: '#9ca3af', textDecoration: 'none', transition: 'color 0.15s' }}
                      onMouseEnter={function(e) { (e.currentTarget as HTMLElement).style.color = '#374151' }}
                      onMouseLeave={function(e) { (e.currentTarget as HTMLElement).style.color = '#9ca3af' }}>
                      Entities
                    </a>
                    <a
                      href={'/bots/' + bot.id + '/probes'}
                      style={{ color: '#9ca3af', textDecoration: 'none', transition: 'color 0.15s' }}
                      onMouseEnter={function(e) { (e.currentTarget as HTMLElement).style.color = '#374151' }}
                      onMouseLeave={function(e) { (e.currentTarget as HTMLElement).style.color = '#9ca3af' }}>
                      Probes
                    </a>
                    <a
                      href={'/bots/' + bot.id + '/history'}
                      style={{ color: '#9ca3af', textDecoration: 'none', transition: 'color 0.15s' }}
                      onMouseEnter={function(e) { (e.currentTarget as HTMLElement).style.color = '#374151' }}
                      onMouseLeave={function(e) { (e.currentTarget as HTMLElement).style.color = '#9ca3af' }}>
                      History
                    </a>
                    <a
                      href={'/api/bots/' + bot.id + '/export'}
                      style={{ color: '#9ca3af', textDecoration: 'none', transition: 'color 0.15s' }}
                      onMouseEnter={function(e) { (e.currentTarget as HTMLElement).style.color = '#374151' }}
                      onMouseLeave={function(e) { (e.currentTarget as HTMLElement).style.color = '#9ca3af' }}>
                      Export JSON
                    </a>
                  </div>
                  <button
                    onClick={function() { void deleteBot(bot) }}
                    style={{
                      fontSize: 10, color: '#d1d5db', background: 'none', border: 'none',
                      cursor: 'pointer', transition: 'color 0.15s',
                    }}
                    onMouseEnter={function(e) { (e.currentTarget as HTMLElement).style.color = '#dc2626' }}
                    onMouseLeave={function(e) { (e.currentTarget as HTMLElement).style.color = '#d1d5db' }}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
            </React.Fragment>
          )
        })}
      </div>
        )
      })()}
    </div>
  )
}

// Relative time helper for "Updated 3d ago" style timestamps.
function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60000) return 'just now'
  if (ms < 3600000) return Math.floor(ms / 60000) + 'm ago'
  if (ms < 86400000) return Math.floor(ms / 3600000) + 'h ago'
  const days = Math.floor(ms / 86400000)
  if (days < 30) return days + 'd ago'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// Hidden <input type=file> + button. Reads the picked JSON, POSTs it to
// /api/bots/import, then refreshes the bot list.
function ImportBotButton({ onImported }: { onImported: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string>('')
  const inputRef = (typeof window !== 'undefined' ? null : null) as any
  return (
    <label
      style={{
        fontSize: 11, padding: '4px 12px', borderRadius: 16, border: '1px solid #d1d5db',
        background: 'white', color: busy ? '#9ca3af' : '#6b7280', cursor: busy ? 'wait' : 'pointer',
        fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4,
      }}
      title={err || 'Import a bot from a previously exported JSON file'}
    >
      <input
        type='file'
        accept='.json,application/json'
        style={{ display: 'none' }}
        disabled={busy}
        onChange={(e) => { void (async function() {
          const file = e.target.files?.[0]
          if (!file) return
          setBusy(true); setErr('')
          try {
            const text = await file.text()
            let json: any
            try { json = JSON.parse(text) } catch { setErr('Not valid JSON'); setBusy(false); return }
            const res = await fetch('/api/bots/import', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(json),
            })
            const data = await res.json()
            if (!res.ok) { setErr(data?.error || ('HTTP ' + res.status)); setBusy(false); return }
            onImported()
          } catch (e: any) {
            setErr(e?.message || 'Import failed')
          } finally {
            setBusy(false)
            ;(e.target as HTMLInputElement).value = ''
          }
        })() }}
      />
      {busy ? 'Importing…' : '↓ Import'}
    </label>
  )
}

// Inline component: Sync this bot's conversations into a Ana dataset and
// jump straight into TextMine. Mirrors the TH-card "Analyze in Ana" pattern.
function AnalyzeInAnaButton({ botId }: { botId: string }) {
  const [loading, setLoading] = useState(false)
  const [status,  setStatus]  = useState('')

  async function handleClick() {
    setLoading(true)
    setStatus('Syncing...')
    try {
      const res = await fetch('/api/bots/' + botId + '/analyze', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setStatus(data.error || 'Failed'); setLoading(false); return }
      window.location.href = '/analyze/' + data.dataset_id + '/textmine' + (data.created ? '?new=1' : '')
    } catch {
      setStatus('Error')
      setLoading(false)
    }
  }

  return (
    <button onClick={() => { void handleClick() }} disabled={loading}
      style={{
        marginTop: 8, padding: '6px 0', borderRadius: 8, fontWeight: 600, fontSize: 11,
        background: '#E8632A', color: 'white', border: 'none',
        cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1, width: '100%',
      }}>
      {loading ? status : '📊 Analyze in Ana'}
    </button>
  )
}
