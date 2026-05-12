// app/api/admin/orgs/[id]/ai-key/route.ts
// Super-admin only — provision the AI key mode/secret for a customer org.
//
//   GET    — returns status: { mode, isSet, setAt, setBy } (never the key)
//   PUT    — body: { mode: 'platform' | 'byo', api_key?: string }
//              mode='platform' clears any stored key
//              mode='byo' + api_key sets the secret
//              mode='byo' alone (api_key omitted) preserves the existing key
//   DELETE — revert to mode='platform' and null out the stored key
//
// Cache invalidation: invalidateOrgAiKey(orgId) is called on every write
// so the next AI call picks up the change immediately.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { getOrgAiKeyStatus, invalidateOrgAiKey } from '@/lib/aiKey'

export const dynamic = 'force-dynamic'

interface Params { params: { id: string } }

export async function GET(_req: Request, { params }: Params) {
  const denied = await requireAdmin()
  if (denied) return denied
  const status = await getOrgAiKeyStatus(params.id)
  if (!status) return NextResponse.json({ error: 'Org not found' }, { status: 404 })
  return NextResponse.json(status)
}

export async function PUT(req: Request, { params }: Params) {
  const denied = await requireAdmin()
  if (denied) return denied
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const mode = body?.mode
  if (mode !== 'platform' && mode !== 'byo') {
    return NextResponse.json({ error: 'mode must be "platform" or "byo"' }, { status: 400 })
  }
  const apiKey: string | undefined = typeof body?.api_key === 'string' ? body.api_key.trim() : undefined

  const updates: Record<string, unknown> = { ai_key_mode: mode }
  if (mode === 'platform') {
    // Switching back to platform clears any stored secret + metadata.
    updates.ai_api_key = null
    updates.ai_api_key_set_at = null
    updates.ai_api_key_set_by = null
  } else if (apiKey !== undefined) {
    if (apiKey === '') {
      return NextResponse.json({ error: 'api_key cannot be empty when mode=byo' }, { status: 400 })
    }
    updates.ai_api_key = apiKey
    updates.ai_api_key_set_at = new Date().toISOString()
    updates.ai_api_key_set_by = user.id
  }
  // mode='byo' without api_key keeps the existing key in place.

  const service = createServiceRoleClient()
  const { error } = await service.from('organizations').update(updates).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  invalidateOrgAiKey(params.id)
  const status = await getOrgAiKeyStatus(params.id)
  return NextResponse.json(status)
}

export async function DELETE(_req: Request, { params }: Params) {
  const denied = await requireAdmin()
  if (denied) return denied
  const service = createServiceRoleClient()
  const { error } = await service.from('organizations').update({
    ai_key_mode:        'platform',
    ai_api_key:         null,
    ai_api_key_set_at:  null,
    ai_api_key_set_by:  null,
  }).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  invalidateOrgAiKey(params.id)
  const status = await getOrgAiKeyStatus(params.id)
  return NextResponse.json(status)
}
