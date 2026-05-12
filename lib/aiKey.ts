import 'server-only'

// lib/aiKey.ts
// Per-org Anthropic key resolver. Used by callAI() — when a request
// carries a usage.org_id and the caller didn't pass an explicit apiKey,
// we look up the org's ai_key_mode + ai_api_key and return the BYO key
// if the org is configured that way. Otherwise callAI falls back to
// ANTHROPIC_API_KEY env (platform absorbs the cost).
//
// Cached in-memory per process for 60s so a chat conversation doesn't
// hit Supabase on every turn. Invalidated when the admin UI changes
// the key via /api/admin/orgs/[id]/ai-key (it calls invalidateOrgAiKey).

import { createServiceRoleClient } from '@/lib/supabase/server'

const TTL_MS = 60_000
const cache = new Map<string, { value: string | undefined; expiresAt: number }>()

export async function resolveOrgAiKey(orgId: string): Promise<string | undefined> {
  if (!orgId) return undefined
  const now = Date.now()
  const hit = cache.get(orgId)
  if (hit && hit.expiresAt > now) return hit.value

  try {
    const service = createServiceRoleClient()
    const { data } = await service
      .from('organizations')
      .select('ai_key_mode, ai_api_key')
      .eq('id', orgId)
      .single()
    const value = (data as any)?.ai_key_mode === 'byo' && (data as any)?.ai_api_key
      ? ((data as any).ai_api_key as string)
      : undefined
    cache.set(orgId, { value, expiresAt: now + TTL_MS })
    return value
  } catch {
    // On lookup failure: don't error the AI call, just fall back to env.
    cache.set(orgId, { value: undefined, expiresAt: now + TTL_MS })
    return undefined
  }
}

export function invalidateOrgAiKey(orgId: string): void {
  cache.delete(orgId)
}

export interface OrgAiKeyStatus {
  mode:      'platform' | 'byo'
  isSet:     boolean
  setAt:     string | null
  setBy:     string | null
}

/** Admin-only — returns metadata about the org's AI key WITHOUT the secret. */
export async function getOrgAiKeyStatus(orgId: string): Promise<OrgAiKeyStatus | null> {
  if (!orgId) return null
  const service = createServiceRoleClient()
  const { data } = await service
    .from('organizations')
    .select('ai_key_mode, ai_api_key, ai_api_key_set_at, ai_api_key_set_by')
    .eq('id', orgId)
    .single()
  if (!data) return null
  return {
    mode:  ((data as any).ai_key_mode as 'platform' | 'byo') || 'platform',
    isSet: !!(data as any).ai_api_key,
    setAt: (data as any).ai_api_key_set_at || null,
    setBy: (data as any).ai_api_key_set_by || null,
  }
}
