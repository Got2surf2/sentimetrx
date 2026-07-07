// app/api/admin/orgs/[id]/ai-key/route.ts
// Super-admin only — provision the AI key mode/provider/secret for a customer org.
//
//   GET    — returns status: { mode, provider, isSet, setAt, setBy } (never the key)
//   PUT    — body: { mode: 'off'|'platform'|'byo', provider?: 'anthropic'|'openai', api_key?: string }
//              mode='off'      → no AI calls allowed for this org (server enforces)
//              mode='platform' → use Sentimetrx env keys (default)
//              mode='byo' + provider + api_key → set the secret
//              mode='byo' alone (api_key omitted) → preserves existing key but
//                                                   still updates provider if passed
//   DELETE — revert to mode='platform' and null out the stored key
//
// Cache invalidation: invalidateOrgAiKey(orgId) is called on every write
// so the next AI call picks up the change immediately.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { getOrgAiKeyStatus, invalidateOrgAiKey } from '@/lib/aiKey'
import { encryptSecret } from '@/lib/secretbox'
import { recordAdminAction } from '@/lib/orgTransfer'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

export async function GET(_req: Request, props: Params) {
  const params = await props.params;
  const denied = await requireAdmin()
  if (denied) return denied
  const status = await getOrgAiKeyStatus(params.id)
  if (!status) return NextResponse.json({ error: 'Org not found' }, { status: 404 })
  return NextResponse.json(status)
}

export async function PUT(req: Request, props: Params) {
  const params = await props.params;
  const denied = await requireAdmin()
  if (denied) return denied
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { mode?: unknown; provider?: unknown; api_key?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const mode = body?.mode
  if (mode !== 'off' && mode !== 'platform' && mode !== 'byo') {
    return NextResponse.json({ error: 'mode must be "off", "platform", or "byo"' }, { status: 400 })
  }
  const provider: 'anthropic' | 'openai' | undefined = body?.provider === 'anthropic' || body?.provider === 'openai' ? body.provider : undefined
  const apiKey: string | undefined = typeof body?.api_key === 'string' ? body.api_key.trim() : undefined

  const updates: Record<string, unknown> = { ai_key_mode: mode }

  if (mode === 'off' || mode === 'platform') {
    // Switching out of BYO clears any stored secret + metadata.
    updates.ai_api_key = null
    updates.ai_api_key_set_at = null
    updates.ai_api_key_set_by = null
  } else {
    // mode === 'byo'
    if (!provider) {
      return NextResponse.json({ error: 'provider is required for mode=byo' }, { status: 400 })
    }
    updates.ai_provider = provider
    if (apiKey !== undefined) {
      if (apiKey === '') {
        return NextResponse.json({ error: 'api_key cannot be empty when mode=byo' }, { status: 400 })
      }
      updates.ai_api_key = encryptSecret(apiKey)
      updates.ai_api_key_set_at = new Date().toISOString()
      updates.ai_api_key_set_by = user.id
    }
    // mode='byo' without api_key keeps the existing key in place (provider rotation only).
  }

  const service = createServiceRoleClient()
  const { error } = await service.from('organizations').update(updates).eq('id', params.id)
  if (error) return serverError(error, 'admin.orgs.aiKey.put', { orgId: params.id })

  // Audit: an admin changed a customer org's AI-key config (credential-sensitive).
  await recordAdminAction({
    service, actionType: 'org.ai_key_set', resourceType: 'org', resourceId: params.id,
    targetOrgId: params.id, initiatedBy: user.id, initiatedByEmail: user.email || null,
    metadata: { mode, provider: provider || null, key_changed: apiKey !== undefined },
  })

  invalidateOrgAiKey(params.id)
  const status = await getOrgAiKeyStatus(params.id)
  return NextResponse.json(status)
}

export async function DELETE(_req: Request, props: Params) {
  const params = await props.params;
  const denied = await requireAdmin()
  if (denied) return denied
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = createServiceRoleClient()
  const { error } = await service.from('organizations').update({
    ai_key_mode:        'platform',
    ai_api_key:         null,
    ai_api_key_set_at:  null,
    ai_api_key_set_by:  null,
  }).eq('id', params.id)
  if (error) return serverError(error, 'admin.orgs.aiKey.delete', { orgId: params.id })
  await recordAdminAction({
    service, actionType: 'org.ai_key_delete', resourceType: 'org', resourceId: params.id,
    targetOrgId: params.id, initiatedBy: user.id, initiatedByEmail: user.email || null,
  })
  invalidateOrgAiKey(params.id)
  const status = await getOrgAiKeyStatus(params.id)
  return NextResponse.json(status)
}
