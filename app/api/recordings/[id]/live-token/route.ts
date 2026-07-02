// app/api/recordings/[id]/live-token/route.ts
//
// POST /api/recordings/[id]/live-token — mint a short-lived Deepgram token
// so the browser can stream mic audio directly to Deepgram's live WS during
// an in-person meeting, without ever holding our DEEPGRAM_API_KEY. First piece
// of the live-capture front-end (see docs/RECORDINGS.md § 15). The token is
// org-scoped by this auth check and expires in ~60s (valid only at connect).
// CSRF + same-origin are enforced by proxy.ts.

import { NextResponse } from 'next/server'
import { serverError } from '@/lib/apiError'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { grantDeepgramToken } from '@/lib/asr/deepgram'

export const dynamic = 'force-dynamic'

// Recording lifecycle states past which a live capture makes no sense.
const TERMINAL_STATUSES = new Set(['complete', 'failed', 'cancelled'])

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recording_id = (await ctx.params).id
  if (!recording_id) {
    return NextResponse.json({ error: 'missing recording id' }, { status: 400 })
  }

  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: userRow } = await supabase
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()
  const org_id = userRow?.org_id as string | undefined
  if (!org_id) return NextResponse.json({ error: 'org not found' }, { status: 403 })

  const service = createServiceRoleClient()

  // Pair (id, org_id) — a bare id lookup with the service role is a cross-tenant
  // leak per CLAUDE.md multi-tenancy invariants.
  const { data: rec, error: rErr } = await service
    .from('recordings')
    .select('id, org_id, status')
    .eq('id', recording_id)
    .eq('org_id', org_id)
    .single()
  if (rErr || !rec) return NextResponse.json({ error: 'not found' }, { status: 404 })

  if (TERMINAL_STATUSES.has(rec.status as string)) {
    return NextResponse.json(
      { error: `recording is ${rec.status}; live capture unavailable` },
      { status: 409 },
    )
  }

  try {
    const grant = await grantDeepgramToken(60)
    return NextResponse.json({ ok: true, ...grant })
  } catch (e) {
    return serverError(e, 'recordings.liveToken', { orgId: org_id })
  }
}
