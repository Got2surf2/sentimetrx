'use client'

// lib/hooks/useOrgAiMode.ts
// Client hook for components that need to hide / disable AI features when
// the caller's org has ai_key_mode='off'. The hook is purely advisory —
// the server-side gate in lib/ai.ts / lib/embeddings.ts / lib/moderation.ts
// is the actual guarantee that no AI traffic leaves the platform.

import { useEffect, useState } from 'react'

export interface OrgAiMode {
  mode:     'off' | 'platform' | 'byo'
  provider: 'anthropic' | 'openai'
  enabled:  boolean
  loading:  boolean
}

const DEFAULT: OrgAiMode = { mode: 'platform', provider: 'anthropic', enabled: true, loading: true }

export function useOrgAiMode(): OrgAiMode {
  const [state, setState] = useState<OrgAiMode>(DEFAULT)
  useEffect(() => {
    let active = true
    fetch('/api/me/ai-mode')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!active || !data) return
        setState({
          mode: data.mode || 'platform',
          provider: data.provider || 'anthropic',
          enabled: data.enabled !== false,
          loading: false,
        })
      })
      .catch(() => active && setState(s => ({ ...s, loading: false })))
    return () => { active = false }
  }, [])
  return state
}
