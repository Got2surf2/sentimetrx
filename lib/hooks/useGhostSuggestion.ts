'use client'

// lib/hooks/useGhostSuggestion.ts
// Client hook that fetches a single inline continuation for the user's
// current input prefix, debounced. Branded as "Ana suggests".
//
// - Debounces 500ms after prefix changes (a typist hits >120 chars/min;
//   firing per-keystroke would burn tokens without benefit).
// - Caches by `${surface}:${prefix}` in a session-lived Map so backspaces
//   and re-types don't re-fire.
// - Honors org AI off-mode via useOrgAiMode (the API also degrades silently
//   on AIDisabledError, but skipping the request avoids the round-trip).
// - Returns an empty suggestion (not loading) when conditions aren't met,
//   so the consumer doesn't need to special-case the off path.

import { useEffect, useRef, useState } from 'react'
import { useOrgAiMode } from '@/lib/hooks/useOrgAiMode'

export type GhostSurface =
  | 'export-instructions'
  | 'bot-system-prompt'
  | 'bot-personality'
  | 'bot-deflection-message'

interface Args {
  surface: GhostSurface
  context: Record<string, unknown>
  prefix:  string
  enabled: boolean
  /** chars before suggestions kick in. Default 6 — avoids noise on "F", "Fo". */
  minPrefixChars?: number
}

interface Result {
  suggestion: string
  loading:    boolean
  /** Called by GhostTextarea when the user accepts or dismisses the current suggestion. */
  clear: () => void
}

const cache = new Map<string, string>()
const DEBOUNCE_MS = 500

export function useGhostSuggestion(args: Args): Result {
  const { surface, context, prefix, enabled, minPrefixChars = 6 } = args
  const orgAi = useOrgAiMode()
  const aiOff = !orgAi.loading && orgAi.mode === 'off'

  const [suggestion, setSuggestion] = useState('')
  const [loading,    setLoading]    = useState(false)
  const reqIdRef = useRef(0)

  // Stringify the context once per render — used as part of the cache key.
  // For the export-instructions surface this is the dataset + themes + audience,
  // which are stable for the lifetime of the open modal.
  const contextKey = JSON.stringify(context)

  function clear() {
    setSuggestion('')
    setLoading(false)
    reqIdRef.current += 1
  }

  useEffect(function() {
    if (!enabled || aiOff) { setSuggestion(''); setLoading(false); return }
    const trimmed = prefix.trimEnd()
    if (trimmed.length < minPrefixChars) { setSuggestion(''); setLoading(false); return }

    const key = surface + ':' + contextKey + ':' + trimmed
    const cached = cache.get(key)
    if (cached !== undefined) { setSuggestion(cached); setLoading(false); return }

    setLoading(true)
    const myId = ++reqIdRef.current
    const t = setTimeout(function() {
      fetch('/api/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surface, context, prefix: trimmed }),
        credentials: 'include',
      })
        .then(function(r) { return r.ok ? r.json() : { suggestion: '' } })
        .then(function(d) {
          // Drop stale responses — prefix has changed since we fired.
          if (myId !== reqIdRef.current) return
          const s = typeof d.suggestion === 'string' ? d.suggestion : ''
          cache.set(key, s)
          setSuggestion(s)
          setLoading(false)
        })
        .catch(function() {
          if (myId !== reqIdRef.current) return
          setSuggestion('')
          setLoading(false)
        })
    }, DEBOUNCE_MS)

    return function() { clearTimeout(t) }
  }, [prefix, enabled, aiOff, surface, contextKey, minPrefixChars, context])

  return { suggestion, loading, clear }
}
