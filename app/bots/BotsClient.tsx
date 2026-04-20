'use client'

// app/bots/BotsClient.tsx
// Client component: lists bots, handles create/edit/delete

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
  conversation_count: number
  created_at: string
  updated_at: string
}

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  draft:  { bg: '#f3f4f6', text: '#6b7280', label: 'Draft' },
  active: { bg: '#d1fae5', text: '#059669', label: 'Active' },
  paused: { bg: '#fef3c7', text: '#d97706', label: 'Paused' },
}

export default function BotsClient({ orgId }: { orgId: string }) {
  const router = useRouter()
  const [bots, setBots] = useState<Bot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(function() {
    fetch('/api/bots').then(function(r) { return r.json() }).then(function(d) {
      setBots(d.bots || [])
    }).catch(function() {
      setError('Failed to load bots')
    }).finally(function() { setLoading(false) })
  }, [])

  async function toggleStatus(bot: Bot) {
    const next = bot.status === 'active' ? 'paused' : 'active'
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

  if (loading) return <div className="flex items-center justify-center py-32"><LottieLoader size={80} /></div>

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>Bots</h1>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>Create and manage branded AI chatbots trained on your content</p>
        </div>
        <button
          onClick={function() { router.push('/bots/new') }}
          style={{
            padding: '8px 20px', borderRadius: 20, border: 'none',
            background: HERMES, color: 'white', fontSize: 13, fontWeight: 600,
            cursor: 'pointer',
          }}
        >+ New Bot</button>
      </div>

      {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 16 }}>{error}</p>}

      {bots.length === 0 && !loading && (
        <div style={{
          textAlign: 'center', padding: '64px 32px',
          background: 'white', borderRadius: 12, border: '1px solid #e5e7eb',
        }}>
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {bots.map(function(bot) {
          var sc = STATUS_COLORS[bot.status] || STATUS_COLORS.draft
          var botUrl = typeof window !== 'undefined' ? window.location.origin + '/b/' + bot.slug : '/b/' + bot.slug
          return (
            <div key={bot.id} style={{
              background: 'white', borderRadius: 12, border: '1px solid #e5e7eb',
              padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16,
            }}>
              {/* Avatar */}
              <div style={{
                width: 44, height: 44, borderRadius: '50%',
                background: (bot.config as any)?.avatarGradient || 'linear-gradient(135deg, #00b4d8, #0077a8)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, fontWeight: 700, color: (bot.config as any)?.avatarTextColor || 'white',
                flexShrink: 0,
              }}>
                {(bot.config as any)?.avatarLetter || bot.name.charAt(0)}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>{bot.name}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                    background: sc.bg, color: sc.text,
                  }}>{sc.label}</span>
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                  /b/{bot.slug} · {bot.conversation_count} conversation{bot.conversation_count !== 1 ? 's' : ''}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {bot.status === 'active' && (
                  <button
                    onClick={function() { navigator.clipboard.writeText(botUrl) }}
                    style={{
                      padding: '5px 12px', borderRadius: 16, border: '1px solid #e5e7eb',
                      background: 'white', color: '#374151', fontSize: 11, fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >Copy Link</button>
                )}
                <button
                  onClick={function() { toggleStatus(bot) }}
                  style={{
                    padding: '5px 12px', borderRadius: 16, border: '1px solid #e5e7eb',
                    background: 'white', color: bot.status === 'active' ? '#d97706' : '#059669',
                    fontSize: 11, fontWeight: 500, cursor: 'pointer',
                  }}
                >{bot.status === 'active' ? 'Pause' : 'Activate'}</button>
                <button
                  onClick={function() { router.push('/bots/new?edit=' + bot.id) }}
                  style={{
                    padding: '5px 12px', borderRadius: 16, border: '1px solid #e5e7eb',
                    background: 'white', color: '#374151', fontSize: 11, fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >Edit</button>
                <button
                  onClick={function() { deleteBot(bot) }}
                  style={{
                    padding: '5px 12px', borderRadius: 16, border: '1px solid #fecaca',
                    background: '#fef2f2', color: '#dc2626', fontSize: 11, fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >Delete</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
