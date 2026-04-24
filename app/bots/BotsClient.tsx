'use client'

// app/bots/BotsClient.tsx
// Client component: lists bots as cards, handles create/edit/delete

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import LottieLoader from '@/components/ui/LottieLoader'

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
  created_at: string
  updated_at: string
}

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  draft:  { bg: '#f3f4f6', text: '#6b7280', border: '#e5e7eb', label: 'Draft' },
  active: { bg: '#d1fae5', text: '#059669', border: '#a7f3d0', label: 'Active' },
  paused: { bg: '#fef3c7', text: '#d97706', border: '#fcd34d', label: 'Paused' },
}

export default function BotsClient({ orgId }: { orgId: string }) {
  const router = useRouter()
  const [bots, setBots] = useState<Bot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [gridCols, setGridCols] = useState(3)

  useEffect(function() {
    fetch('/api/bots').then(function(r) { return r.json() }).then(function(d) {
      setBots(d.bots || [])
    }).catch(function() {
      setError('Failed to load bots')
    }).finally(function() { setLoading(false) })
  }, [])

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
    if (!confirm('Delete "' + bot.name + '"? This cannot be undone.')) return
    await fetch('/api/bots/' + bot.id, { method: 'DELETE' })
    setBots(function(prev) { return prev.filter(function(b) { return b.id !== bot.id }) })
  }

  function copyLink(bot: Bot) {
    var url = typeof window !== 'undefined' ? window.location.origin + '/b/' + bot.slug : '/b/' + bot.slug
    navigator.clipboard.writeText(url)
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
          {/* Grid toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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
          <span style={{ fontSize: 13, color: '#9ca3af' }}>{bots.length} bot{bots.length !== 1 ? 's' : ''}</span>
          <button
            onClick={function() { router.push('/bots/new') }}
            style={{
              padding: '8px 20px', borderRadius: 20, border: 'none',
              background: HERMES, color: 'white', fontSize: 13, fontWeight: 600,
              cursor: 'pointer',
            }}
          >+ New Bot</button>
        </div>
      </div>

      {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 16 }}>{error}</p>}

      {bots.length === 0 && !loading && (
        <div style={{
          textAlign: 'center', padding: '64px 32px',
          background: 'white', borderRadius: 16, border: '2px dashed #e5e7eb',
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>{'\uD83E\uDD16'}</div>
          <p style={{ fontSize: 16, fontWeight: 600, color: '#374151' }}>No bots yet</p>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>Create your first branded chatbot to get started.</p>
          <button
            onClick={function() { router.push('/bots/new') }}
            style={{
              marginTop: 20, padding: '10px 24px', borderRadius: 20, border: 'none',
              background: HERMES, color: 'white', fontSize: 13, fontWeight: 600,
              cursor: 'pointer',
            }}
          >Create Bot</button>
        </div>
      )}

      {/* Card grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + gridCols + ', 1fr)', gap: 16 }}>
        {bots.map(function(bot) {
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

          return (
            <div key={bot.id} style={{
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
                </div>

                {/* Info row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: '#6b7280' }}>
                  <span>/b/{bot.slug}</span>
                  {websiteLabel && <span>{'\u2192'} {websiteLabel}</span>}
                </div>

                {/* Stats row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12 }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: 18, color: accentColor }}>{bot.conversation_count}</span>
                    <span style={{ color: '#9ca3af', marginLeft: 4 }}>conversation{bot.conversation_count !== 1 ? 's' : ''}</span>
                  </div>
                </div>

                {/* Created date */}
                <div style={{ fontSize: 10, color: '#d1d5db' }}>Created {created}</div>

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
                    onClick={function() { toggleStatus(bot) }}
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

                {/* Delete — small, below pills */}
                <div style={{ textAlign: 'right' }}>
                  <button
                    onClick={function() { deleteBot(bot) }}
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
          )
        })}
      </div>
    </div>
  )
}
