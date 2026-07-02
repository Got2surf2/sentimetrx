import 'server-only'

// lib/aiKey.ts
// Per-org AI configuration resolver: mode ('off' | 'platform' | 'byo'),
// provider ('anthropic' | 'openai'), and the BYOK secret. Cached in-
// memory per process for 60s; admin writes call invalidateOrgAiKey()
// to flush.
//
// AIDisabledError is the contract for the off-mode guarantee — every
// outbound AI path imports assertOrgAiEnabled and treats this error
// as a hard refusal (return null for embeddings/moderation; 403 for
// route handlers).

import { createServiceRoleClient } from '@/lib/supabase/server'
import { decryptSecret } from '@/lib/secretbox'

export type AiMode = 'off' | 'platform' | 'byo'
export type AiProvider = 'anthropic' | 'openai'

export interface OrgAiConfig {
  mode:     AiMode
  provider: AiProvider          // BYOK provider; for platform/off this is informational only
  key:      string | undefined  // BYOK secret; undefined unless mode='byo' AND a key is set
}

export class AIDisabledError extends Error {
  code = 'AI_DISABLED' as const
  constructor(orgId: string) {
    super(`AI is disabled for org ${orgId}`)
    this.name = 'AIDisabledError'
  }
}

const TTL_MS = 60_000
const cache = new Map<string, { value: OrgAiConfig; expiresAt: number }>()

const DEFAULT_CONFIG: OrgAiConfig = { mode: 'platform', provider: 'anthropic', key: undefined }

export async function resolveOrgAiConfig(orgId: string): Promise<OrgAiConfig> {
  if (!orgId) return DEFAULT_CONFIG
  const now = Date.now()
  const hit = cache.get(orgId)
  if (hit && hit.expiresAt > now) return hit.value

  try {
    const service = createServiceRoleClient()
    const { data } = await service
      .from('organizations')
      .select('ai_key_mode, ai_provider, ai_api_key')
      .eq('id', orgId)
      .single()
    const row = data as any
    const mode: AiMode = (row?.ai_key_mode as AiMode) || 'platform'
    const provider: AiProvider = (row?.ai_provider as AiProvider) || 'anthropic'
    // Stored key may be an encrypted envelope (enc:v1:…) or legacy plaintext;
    // decryptSecret handles both. undefined if it can't be decrypted.
    const key: string | undefined = mode === 'byo' && row?.ai_api_key ? decryptSecret(row.ai_api_key as string) : undefined
    const value: OrgAiConfig = { mode, provider, key }
    cache.set(orgId, { value, expiresAt: now + TTL_MS })
    return value
  } catch {
    cache.set(orgId, { value: DEFAULT_CONFIG, expiresAt: now + TTL_MS })
    return DEFAULT_CONFIG
  }
}

/** Throws AIDisabledError when the org's mode is 'off'. No-op otherwise. */
export async function assertOrgAiEnabled(orgId: string | undefined): Promise<void> {
  if (!orgId) return
  const cfg = await resolveOrgAiConfig(orgId)
  if (cfg.mode === 'off') throw new AIDisabledError(orgId)
}

export function invalidateOrgAiKey(orgId: string): void {
  cache.delete(orgId)
}

export interface OrgAiKeyStatus {
  mode:     AiMode
  provider: AiProvider
  isSet:    boolean
  setAt:    string | null
  setBy:    string | null
}

/** Admin-only — returns metadata about the org's AI configuration WITHOUT the secret. */
export async function getOrgAiKeyStatus(orgId: string): Promise<OrgAiKeyStatus | null> {
  if (!orgId) return null
  const service = createServiceRoleClient()
  const { data } = await service
    .from('organizations')
    .select('ai_key_mode, ai_provider, ai_api_key, ai_api_key_set_at, ai_api_key_set_by')
    .eq('id', orgId)
    .single()
  if (!data) return null
  const row = data as any
  return {
    mode:     (row.ai_key_mode as AiMode) || 'platform',
    provider: (row.ai_provider as AiProvider) || 'anthropic',
    isSet:    !!row.ai_api_key,
    setAt:    row.ai_api_key_set_at || null,
    setBy:    row.ai_api_key_set_by || null,
  }
}

// ── Back-compat shim ─────────────────────────────────────────────────────────
// Old call sites (callAI) used resolveOrgAiKey(orgId) → string | undefined.
// Kept until those sites migrate to resolveOrgAiConfig.
export async function resolveOrgAiKey(orgId: string): Promise<string | undefined> {
  const cfg = await resolveOrgAiConfig(orgId)
  return cfg.key
}
