// app/api/recordings/[id]/live-transcript/route.ts
//
// POST /api/recordings/[id]/live-transcript — Town Hall live capture (§ 15).
// Persists the FULL real-time (Deepgram live) transcript on Stop, so it can be
// compared later against the post-processed batch transcript to evaluate how
// much the high-quality pass changed/improved. This is the raw live ASR — NOT
// the authoritative transcript (that lives in recording_transcripts).

import { NextResponse } from 'next/server'
import { serverError } from '@/lib/apiError'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const TERMINAL_STATUSES = new Set(['complete', 'failed', 'cancelled'])
const MAX_CHARS = 500000 // generous cap; a long meeting's transcript fits easily

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recording_id = (await ctx.params).id
  if (!recording_id) return NextResponse.json({ error: 'missing recording id' }, { status: 400 })

  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: userRow } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  const org_id = userRow?.org_id as string | undefined
  if (!org_id) return NextResponse.json({ error: 'org not found' }, { status: 403 })

  const service = createServiceRoleClient()
  // Pair (id, org_id) — bare id with service role is a cross-tenant leak.
  const { data: rec, error: rErr } = await service
    .from('recordings')
    .select('id, org_id, status')
    .eq('id', recording_id)
    .eq('org_id', org_id)
    .single()
  if (rErr || !rec) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (TERMINAL_STATUSES.has(rec.status as string)) {
    return NextResponse.json({ error: `recording is ${rec.status}` }, { status: 409 })
  }

  let transcript: string
  try {
    const body = (await req.json()) as { transcript?: string }
    transcript = (body.transcript ?? '').trim().slice(0, MAX_CHARS)
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (!transcript) return NextResponse.json({ error: 'empty transcript' }, { status: 422 })

  const { error: updErr } = await service
    .from('recordings')
    .update({ live_transcript: transcript })
    .eq('id', recording_id)
    .eq('org_id', org_id)
  if (updErr) return serverError(updErr, 'recordings.liveTranscript', { orgId: org_id })

  return NextResponse.json({ ok: true })
}
