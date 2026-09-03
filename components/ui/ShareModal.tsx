'use client'

// components/ui/ShareModal.tsx
// Unified share modal used across surveys, analytics, town halls, campaigns.
// Lists existing active links + create new. Consistent UX everywhere.

import { useState, useEffect } from 'react'

const HERMES = '#E8632A'

export interface ShareModalProps {
  type: 'study' | 'campaign' | 'townhall' | 'analytics'
  targetId: string
  title?: string
  onClose: () => void
  // Analytics-specific
  metadata?: Record<string, unknown>
  // Optional caller-supplied section rendered under the create form
  // (analytics passes its Data Story links list here)
  extra?: React.ReactNode
}

interface ShareLink {
  url: string
  token: string
  expires_at: string
  created_at: string
  last_accessed_at: string | null
}

function formatExpiry(iso: string): string {
  var d = new Date(iso)
  var diffMs = d.getTime() - Date.now()
  if (diffMs < 0) return 'Expired'
  var diffH = Math.round(diffMs / 3600000)
  if (diffH < 24) return diffH + 'h left'
  return Math.round(diffH / 24) + 'd left'
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function fmtAccess(iso: string | null): string {
  if (!iso) return 'Never viewed'
  return 'Viewed ' + new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function ShareModal({ type, targetId, title, onClose, metadata, extra }: ShareModalProps) {
  var [expiry, setExpiry] = useState<string>('7d')
  var [loading, setLoading] = useState(false)
  var [copied, setCopied] = useState<string | null>(null)
  var [error, setError] = useState<string | null>(null)
  var [links, setLinks] = useState<ShareLink[]>([])
  var [linksLoading, setLinksLoading] = useState(true)

  // Load existing active links
  useEffect(function() {
    fetch('/api/share?list_type=' + type + '&list_target_id=' + targetId)
      .then(function(r) { return r.json() })
      .then(function(d) { setLinks(d.links || []) })
      .catch(function() {})
      .finally(function() { setLinksLoading(false) })
  }, [type, targetId])

  async function handleCreate() {
    setLoading(true)
    setError(null)
    try {
      var body: { type: string; target_id: string; expires_in: string; metadata?: Record<string, unknown> } = { type: type, target_id: targetId, expires_in: expiry }
      if (metadata) body.metadata = metadata
      var res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      var data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to create link'); return }
      setLinks(function(prev) {
        return [{ url: data.url, token: data.token, expires_at: data.expires_at, created_at: new Date().toISOString(), last_accessed_at: null }, ...prev]
      })
    } catch { setError('Network error') }
    finally { setLoading(false) }
  }

  function handleCopy(url: string) {
    void navigator.clipboard.writeText(url)
    setCopied(url)
    setTimeout(function() { setCopied(null) }, 2000)
  }

  async function handleDelete(token: string) {
    var res = await fetch('/api/share?token=' + encodeURIComponent(token), { method: 'DELETE' })
    if (res.ok) setLinks(function(prev) { return prev.filter(function(l) { return l.token !== token }) })
  }

  var typeLabel = type === 'study' ? 'Survey' : type === 'campaign' ? 'Campaign' : type === 'townhall' ? 'PulseIQ Session' : 'Analytics'

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.45)' }}
      onClick={onClose}>
      <div style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 480, width: '100%', margin: '0 16px', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.28)' }}
        onClick={function(e) { e.stopPropagation() }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <h3 style={{ fontWeight: 700, fontSize: 15, color: '#111827', margin: 0 }}>Share {title || typeLabel}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: '#9ca3af', cursor: 'pointer' }}>&times;</button>
        </div>
        <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 16px' }}>
          View-only links anyone can access — no login required.
        </p>

        {/* Existing links */}
        {linksLoading ? (
          <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 16 }}>Loading links...</div>
        ) : links.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 6 }}>Active links ({links.length})</div>
            <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {links.map(function(link) {
                // eslint-disable-next-line react-hooks/purity -- relative-time display computed during render; if React recomputes, the elapsed value simply refreshes, which is the desired behaviour. Freezing it in state would need a ticking clock for no benefit
                var isExpired = new Date(link.expires_at).getTime() < Date.now()
                return (
                  <div key={link.token} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: isExpired ? '#fef2f2' : '#f9fafb', border: '1px solid ' + (isExpired ? '#fecaca' : '#e5e7eb'),
                    borderRadius: 10, padding: '8px 12px',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10, color: '#6b7280', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link.url}</div>
                      <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 2 }}>
                        Created {fmtDate(link.created_at)} · {formatExpiry(link.expires_at)} · {fmtAccess(link.last_accessed_at)}
                      </div>
                    </div>
                    <button onClick={function() { handleCopy(link.url) }}
                      style={{
                        fontSize: 10, padding: '4px 10px', borderRadius: 6, fontWeight: 600, border: 'none', cursor: 'pointer', flexShrink: 0,
                        background: copied === link.url ? '#dcfce7' : '#fff4ef',
                        color: copied === link.url ? '#16a34a' : HERMES,
                      }}>
                      {copied === link.url ? 'Copied!' : 'Copy'}
                    </button>
                    <button onClick={function() { void handleDelete(link.token) }}
                      style={{ fontSize: 14, color: '#d1d5db', background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}
                      title="Delete link">
                      &times;
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Create new section */}
        <div style={{ borderTop: links.length > 0 ? '1px solid #f3f4f6' : 'none', paddingTop: links.length > 0 ? 16 : 0 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 8 }}>+ Create new link</div>

          {/* Expiry picker */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {[{ key: '24h', label: '24 hours' }, { key: '7d', label: '7 days' }, { key: '30d', label: '30 days' }].map(function(opt) {
              return (
                <button key={opt.key} onClick={function() { setExpiry(opt.key) }}
                  style={{
                    fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8, cursor: 'pointer', border: '1px solid',
                    background: expiry === opt.key ? HERMES : 'white',
                    color: expiry === opt.key ? 'white' : '#374151',
                    borderColor: expiry === opt.key ? HERMES : '#e5e7eb',
                  }}>
                  {opt.label}
                </button>
              )
            })}
          </div>

          {error && (
            <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12, color: '#dc2626' }}>
              {error}
            </div>
          )}

          <button onClick={function() { void handleCreate() }} disabled={loading}
            style={{
              width: '100%', padding: '10px 0', borderRadius: 10, fontSize: 13, fontWeight: 700, border: 'none',
              cursor: 'pointer', background: HERMES, color: 'white', opacity: loading ? 0.6 : 1,
            }}>
            {loading ? 'Creating...' : 'Create Share Link'}
          </button>
        </div>

        {extra}
      </div>
    </div>
  )
}
