'use client'
// components/ui/FavoriteStar.tsx
// Single shared star button used wherever a user can favorite a resource
// (bots, surveys, datasets). Parent hydrates the initial state; the
// component toggles on click via POST /api/favorites.

import { useState } from 'react'

type ResourceType = 'bot' | 'study' | 'dataset' | 'campaign' | 'townhall_session' | 'recording'

interface Props {
  resourceType:     ResourceType
  resourceId:       string
  initialFavorited: boolean
  size?:            number
  // Optional label for screen readers (defaults to "Favorite").
  label?:           string
}

export function FavoriteStar({ resourceType, resourceId, initialFavorited, size = 18, label }: Props) {
  const [favorited, setFavorited] = useState(initialFavorited)
  const [pending, setPending]     = useState(false)

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    if (pending) return
    setPending(true)
    const prev = favorited
    setFavorited(!prev)  // optimistic
    try {
      const res = await fetch('/api/favorites', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ resource_type: resourceType, resource_id: resourceId }),
      })
      if (!res.ok) { setFavorited(prev); return }
      const j = await res.json()
      if (typeof j?.favorited === 'boolean') setFavorited(j.favorited)
    } catch {
      setFavorited(prev)
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label || (favorited ? 'Remove from favorites' : 'Add to favorites')}
      aria-pressed={favorited}
      disabled={pending}
      style={{
        background: 'transparent',
        border:     'none',
        padding:    4,
        cursor:     pending ? 'default' : 'pointer',
        display:    'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color:      favorited ? '#e8622a' : '#9ca3af',
        opacity:    pending ? 0.6 : 1,
        transition: 'color 0.15s',
        lineHeight: 0,
      }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill={favorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
      </svg>
    </button>
  )
}
