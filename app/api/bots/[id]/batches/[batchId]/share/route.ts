// app/api/bots/[id]/batches/[batchId]/share/route.ts
// POST — enable/disable the public client-review link for a question batch.
// Body: { enabled: boolean, expires_in_days?: number }. Mints a 24-char URL-safe
// token once (reused on re-enable); the public review page lives at
// /review/<token>, gated purely by token + share_enabled + expiry. Org-member or
// admin gated; service role pairs id with org_id per the multi-tenancy invariant.

import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

const MAX_EXPIRY_DAYS = 365

export async function POST(req: Request, ctx: { params: Promise<{ id: string; batchId: string }> }) {
  const { id: botId, batchId } = await ctx.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: batch } = await service
    .from('question_batches')
    .select('id, org_id, bot_id, share_token, share_enabled')
    .eq('id', batchId).eq('bot_id', botId).single()
  if (!batch) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!isAdmin && batch.org_id !== orgId) return NextResponse.json({ error: 'not found' }, { status: 404 })

  let body: { enabled?: boolean; expires_in_days?: number } = {}
  try { body = await req.json() } catch { /* empty → no-op disable */ }
  const enabled = body.enabled === true

  const token = batch.share_token || randomBytes(18).toString('base64url')
  let expires_at: string | null = null
  if (enabled && body.expires_in_days != null) {
    const days = Math.min(Math.max(1, Math.floor(body.expires_in_days)), MAX_EXPIRY_DAYS)
    expires_at = new Date(Date.now() + days * 86400_000).toISOString()
  }

  const { error } = await service.from('question_batches')
    .update({ share_token: token, share_enabled: enabled, share_expires_at: expires_at })
    .eq('id', batchId).eq('org_id', batch.org_id)
  if (error) return serverError(error, 'bots.batches.share', { orgId: batch.org_id })

  return NextResponse.json({ enabled, token: enabled ? token : null, path: enabled ? `/review/${token}` : null, expires_at })
}
