'use client'

// components/analyze/DataStoryLinks.tsx
// The Share modal's Data Story section: every short link minted for this
// dataset (sql/198 data_stories), with copy / extend (+7 days, revives an
// expired link) / revoke. Rendered only when links exist — a dataset that
// never generated a story keeps its Share modal unchanged.

import { useState, useEffect } from 'react'

const HERMES = '#E8632A'

interface StoryRow {
  id: string
  slug: string
  title: string
  created_at: string
  expires_at: string
  revoked_at: string | null
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function expiryLabel(iso: string): string {
  var diffMs = new Date(iso).getTime() - Date.now()
  if (diffMs < 0) return 'Expired'
  var diffH = Math.round(diffMs / 3600000)
  if (diffH < 24) return diffH + 'h left'
  return Math.round(diffH / 24) + 'd left'
}

export default function DataStoryLinks({ datasetId }: { datasetId: string }) {
  var [stories, setStories] = useState<StoryRow[]>([])
  var [copied, setCopied] = useState<string | null>(null)
  var [busy, setBusy] = useState<string | null>(null)

  useEffect(function() {
    var cancelled = false
    fetch('/api/datasets/' + datasetId + '/story')
      .then(function(r) { return r.ok ? r.json() : { stories: [] } })
      .then(function(d) { if (!cancelled) setStories(d.stories || []) })
      .catch(function() {})
    return function() { cancelled = true }
  }, [datasetId])

  function copyLink(slug: string) {
    void navigator.clipboard.writeText(window.location.origin + '/story/' + slug)
    setCopied(slug)
    setTimeout(function() { setCopied(null) }, 2000)
  }

  async function manage(id: string, action: 'revoke' | 'extend') {
    setBusy(id)
    try {
      var res = await fetch('/api/datasets/' + datasetId + '/story', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId: id, action: action }),
      })
      var d = await res.json()
      if (res.ok) {
        setStories(function(prev) {
          return prev.map(function(s) {
            if (s.id !== id) return s
            return action === 'revoke' ? { ...s, revoked_at: d.revoked_at } : { ...s, expires_at: d.expires_at }
          })
        })
      }
    } catch { /* the list simply doesn't change */ }
    setBusy(null)
  }

  if (!stories.length) return null

  return (
    <div style={{ borderTop: '1px solid #f3f4f6', marginTop: 16, paddingTop: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 6 }}>Data Story links ({stories.length})</div>
      <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {stories.map(function(s) {
          var revoked = !!s.revoked_at
          // eslint-disable-next-line react-hooks/purity -- relative-time display computed during render, same pattern as ShareModal's link list
          var expired = !revoked && new Date(s.expires_at).getTime() < Date.now()
          var dead = revoked || expired
          return (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: dead ? '#fef2f2' : '#f9fafb', border: '1px solid ' + (dead ? '#fecaca' : '#e5e7eb'),
              borderRadius: 10, padding: '8px 12px', opacity: revoked ? 0.7 : 1,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: '#6b7280', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>/story/{s.slug}</div>
                <div style={{ fontSize: 9, color: revoked ? '#dc2626' : '#9ca3af', marginTop: 2 }}>
                  {revoked ? 'Revoked ' + fmtDate(s.revoked_at as string) : 'Created ' + fmtDate(s.created_at) + ' · ' + expiryLabel(s.expires_at)}
                </div>
              </div>
              {!revoked && (
                <button onClick={function() { copyLink(s.slug) }}
                  style={{
                    fontSize: 10, padding: '4px 10px', borderRadius: 6, fontWeight: 600, border: 'none', cursor: 'pointer', flexShrink: 0,
                    background: copied === s.slug ? '#dcfce7' : '#fff4ef',
                    color: copied === s.slug ? '#16a34a' : HERMES,
                  }}>
                  {copied === s.slug ? 'Copied!' : 'Copy'}
                </button>
              )}
              {!revoked && (
                <button onClick={function() { void manage(s.id, 'extend') }} disabled={busy === s.id}
                  title={expired ? 'Revive this link for 7 more days' : 'Add 7 days to this link'}
                  style={{ fontSize: 10, padding: '4px 8px', borderRadius: 6, fontWeight: 600, border: '1px solid #e5e7eb', background: 'white', color: '#374151', cursor: 'pointer', flexShrink: 0, opacity: busy === s.id ? 0.5 : 1 }}>
                  +7d
                </button>
              )}
              {!revoked && (
                <button onClick={function() { void manage(s.id, 'revoke') }} disabled={busy === s.id}
                  style={{ fontSize: 14, color: '#d1d5db', background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}
                  title="Revoke this link — anyone holding it loses access">
                  &times;
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
