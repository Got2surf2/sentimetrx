'use client'

// lib/hooks/useOrgAiMode.ts
//
// Client hook surfacing the caller's AI state. Two layers now:
//   - org ceiling     : ai_key_mode on the org (off | platform | byo)
//   - user opt-in     : users.ai_enabled (per-user explicit decision)
//
// The user-level opt-in lives server-side (users.ai_enabled) and every
// flip is audited via ai_consent_audit. localStorage is kept as a
// fast-read cache only — DatasetHeader writes it after a successful
// PATCH so other surfaces (TextMine, Stats) that still read
// localStorage stay in sync without their own fetch.

import { useCallback, useEffect, useState } from 'react'

export interface OrgAiMode {
  // Org ceiling (kept for backwards-compat with existing consumers)
  mode:     'off' | 'platform' | 'byo'
  provider: 'anthropic' | 'openai'
  enabled:  boolean       // mode !== 'off' (org-wide availability)
  // User-level opt-in
  userEnabled: boolean
  effective:   boolean    // userEnabled AND enabled
  loading:  boolean
  setUserEnabled: (next: boolean) => Promise<{ ok: boolean; error?: string }>
}

const DEFAULT: Omit<OrgAiMode, 'setUserEnabled'> = {
  mode: 'platform', provider: 'anthropic', enabled: true,
  userEnabled: false, effective: false, loading: true,
}

function writeLocalStorageCache(userEnabled: boolean): void {
  try { localStorage.setItem('sentimetrx_ai_enabled', userEnabled ? '1' : '0') } catch { /* ignore */ }
}

export function useOrgAiMode(): OrgAiMode {
  const [state, setState] = useState<Omit<OrgAiMode, 'setUserEnabled'>>(DEFAULT)

  useEffect(function() {
    let active = true
    fetch('/api/me/ai-mode')
      .then(function(r) { return r.ok ? r.json() : null })
      .then(function(data) {
        if (!active || !data) {
          if (active) setState(function(s) { return { ...s, loading: false } })
          return
        }
        const orgMode = (data.orgMode || data.mode || 'platform') as OrgAiMode['mode']
        const provider = (data.orgProvider || data.provider || 'anthropic') as OrgAiMode['provider']
        const userEnabled = !!data.userEnabled
        const enabled = orgMode !== 'off'
        const effective = !!data.effective
        setState({ mode: orgMode, provider, enabled, userEnabled, effective, loading: false })
        // Sync localStorage cache for older consumers that still read it.
        writeLocalStorageCache(userEnabled)
      })
      .catch(function() { if (active) setState(function(s) { return { ...s, loading: false } }) })
    return function() { active = false }
  }, [])

  const setUserEnabled = useCallback(async function(next: boolean) {
    try {
      const res = await fetch('/api/me/ai-mode', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(function() { return null })) as { error?: string } | null
        return { ok: false, error: data?.error || 'Failed to update AI preference' }
      }
      const data = (await res.json()) as { userEnabled: boolean }
      const userEnabled = !!data.userEnabled
      setState(function(s) {
        return { ...s, userEnabled, effective: userEnabled && s.enabled }
      })
      writeLocalStorageCache(userEnabled)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error)?.message || 'Network error' }
    }
  }, [])

  return { ...state, setUserEnabled }
}
