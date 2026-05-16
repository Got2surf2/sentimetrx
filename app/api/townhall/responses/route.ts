// app/api/townhall/responses/route.ts
// POST — submit post-session demographic & psychographic answers (anonymous, no auth)

import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { session_id, participant_id, psychographics, demographics } = body

  if (!session_id || !participant_id) {
    return NextResponse.json({ error: 'Missing session_id or participant_id' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  // Validate: participant must have turns in this session
  const { count } = await service
    .from('townhall_turns')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', session_id)
    .eq('participant_id', participant_id)

  if (!count || count === 0) {
    return NextResponse.json({ error: 'Participant not found in session' }, { status: 404 })
  }

  // Upsert (participant may submit partial then complete)
  const { error } = await service
    .from('townhall_participant_responses')
    .upsert({
      session_id,
      participant_id,
      psychographics: psychographics || {},
      demographics: demographics || {},
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'session_id,participant_id' })

  if (error) {
    console.error({ at: 'townhall/responses', msg: "upsert error", err: error })
    return NextResponse.json({ error: 'Failed to save responses' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
