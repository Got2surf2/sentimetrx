// app/api/recordings/[id]/share/route.ts
//
// POST /api/recordings/[id]/share — enable/disable the public read-only report
// link (docs/RECORDINGS.md §4.7). Body: { enabled: boolean, expires_in_days?: number }.
//
// Owner (or admin-org) only. Service-role reads/writes pair id with org_id — a
// bare id lookup would be a cross-tenant leak. Enabling mints a 24-char URL-safe
// token (once; reused on re-enable). The public page lives at /th/[token] and is
// gated purely by the token + share_enabled + expiry. CSRF/same-origin enforced
// by proxy.ts (cookie-authed mutating route).

import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { serverError } from '@/lib/apiError'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'

export const dynamic = 'force-dynamic'

const MAX_EXPIRY_DAYS = 365

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recording_id = (await ctx.params).id
  if (!recording_id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()

  // THE gate: pair id with org_id; 404 (not 403) on cross-org so we don't
  // confirm the row exists to a caller who shouldn't see it.
  const { data: rec } = await service
    .from('recordings')
    .select('id, org_id, created_by, status, share_token, share_enabled, share_verbatim, share_audio')
    .eq('id', recording_id)
    .single()
  if (!rec) return NextResponse.json({ error: 'not found' }, { status: 404 })
  // Org-wide: any member of the owning org (or a platform admin) may change the
  // share state — like publishing a public link for a dataset. The org check
  // above is the gate. 404 (not 403) on cross-org so we don't confirm the row.
  if (!isAdmin && rec.org_id !== orgId) return NextResponse.json({ error: 'not found' }, { status: 404 })

  let body: { enabled?: boolean; expires_in_days?: number; show_verbatim?: boolean; include_audio?: boolean } = {}
  try { body = await req.json() } catch { /* empty body → treat as no-op */ }
  const enabled = body.enabled === true

  if (enabled && rec.status !== 'complete') {
    return NextResponse.json({ error: 'Finish analysis before sharing — the report is only available once the recording is complete.' }, { status: 409 })
  }

  // 24-char URL-safe token, minted once and reused so an existing link keeps
  // working across enable/disable cycles.
  const token = rec.share_token || randomBytes(18).toString('base64url')

  let expires_at: string | null = null
  if (enabled && body.expires_in_days != null) {
    const days = Math.min(Math.max(1, Math.floor(body.expires_in_days)), MAX_EXPIRY_DAYS)
    expires_at = new Date(Date.now() + days * 86400_000).toISOString()
  }

  // Polished (default) vs verbatim Q&A on the public page. Only touched when the
  // caller includes the key, so enable/disable calls don't clobber the setting.
  const patch: Record<string, unknown> = {
    share_enabled: enabled,
    share_token: token,
    share_expires_at: enabled ? expires_at : null,
  }
  if ('show_verbatim' in body) patch.share_verbatim = body.show_verbatim === true
  const verbatim = 'show_verbatim' in body ? body.show_verbatim === true : !!rec.share_verbatim

  // Audio is a separate, deliberately opt-in disclosure (sql/185): publishing
  // the written report never implies publishing residents' voices. Same
  // write-only-when-present rule as share_verbatim, so enable/disable of the
  // link can't silently flip it.
  if ('include_audio' in body) patch.share_audio = body.include_audio === true
  const includeAudio = 'include_audio' in body ? body.include_audio === true : !!(rec as { share_audio?: boolean }).share_audio

  const { error: updErr } = await service
    .from('recordings')
    .update(patch)
    .eq('id', recording_id)
    .eq('org_id', rec.org_id)
  if (updErr) return serverError(updErr, 'recordings.share', { orgId: rec.org_id })

  return NextResponse.json({
    ok: true,
    enabled,
    token: enabled ? token : null,
    path: enabled ? `/th/${token}` : null,
    expires_at: enabled ? expires_at : null,
    show_verbatim: verbatim,
    include_audio: includeAudio,
  })
}
