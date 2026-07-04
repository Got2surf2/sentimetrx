// app/api/townhall/responses/route.ts
// POST — submit post-session demographic & psychographic answers (anonymous, no auth)
//
// Storage: townhall_participant_responses with town_hall_id =
// pulseiq_sessions.id (the row survives from the sql/083 dual-substrate era;
// its legacy session_id column is vestigial since the tranche-2 deletion,
// sql/153). Participant validity is proven by a linked conversation
// (pulseiq_session_conversations → conversations.participant_id). A partial
// unique index enforces one row per participant per session.

import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const { session_id, participant_id, psychographics, demographics } = body

  if (!session_id || !participant_id) {
    return NextResponse.json({ error: 'Missing session_id or participant_id' }, { status: 400 })
  }

  // Public unauthenticated write — rate-limit like the sibling townhall/chat route
  // so it can't be flooded (storage/DoS / theme-detection poisoning). This is an
  // upsert-once-per-participant endpoint, so the per-participant cap is tight; the
  // per-IP backstop is sized for a full venue submitting at the end of a session.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const rlPart = await checkRateLimit('townhall-responses:p:' + participant_id, 10, 60000)
  if (rlPart.limited) return NextResponse.json({ error: 'Rate limited' }, { status: 429 })
  const rlIp = await checkRateLimit('townhall-responses:ip:' + ip, 600, 60000)
  if (rlIp.limited) return NextResponse.json({ error: 'Rate limited' }, { status: 429 })

  const service = createServiceRoleClient()

  const { data: hall } = await service
    .from('pulseiq_sessions')
    .select('id')
    .eq('id', session_id)
    .maybeSingle()
  if (!hall) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }
  const townHallId: string = (hall as any).id

  // Walk pulseiq_session_conversations → conversations and confirm the
  // participant_id matches at least one linked conversation.
  const { data: links } = await service
    .from('pulseiq_session_conversations')
    .select('conversations!inner(participant_id)')
    .eq('town_hall_id', townHallId)
  const found = ((links || []) as any[]).some(r => {
    const c = Array.isArray(r.conversations) ? r.conversations[0] : r.conversations
    return c?.participant_id === participant_id
  })
  if (!found) {
    return NextResponse.json({ error: 'Participant not found in town hall' }, { status: 404 })
  }

  // Upsert. The partial unique index (sql/083) enforces "one row per
  // participant per session", but a partial-index onConflict spec doesn't
  // work via the JS client — manual upsert: try insert, catch the unique
  // violation, then update.
  const insertRow: Record<string, unknown> = {
    participant_id,
    psychographics: psychographics || {},
    demographics: demographics || {},
    submitted_at: new Date().toISOString(),
    town_hall_id: townHallId,
  }

  const { error: insertErr } = await service
    .from('townhall_participant_responses')
    .insert(insertRow)

  if (insertErr) {
    const isDup = /duplicate key value|unique constraint/i.test(insertErr.message || '')
    if (!isDup) {
      console.error({ at: 'townhall/responses', msg: 'insert error', err: insertErr })
      return NextResponse.json({ error: 'Failed to save responses' }, { status: 500 })
    }
    const { error: updateErr } = await service
      .from('townhall_participant_responses')
      .update({
        psychographics: psychographics || {},
        demographics: demographics || {},
        submitted_at: new Date().toISOString(),
      })
      .eq('participant_id', participant_id)
      .eq('town_hall_id', townHallId)
    if (updateErr) {
      console.error({ at: 'townhall/responses', msg: 'update error', err: updateErr })
      return NextResponse.json({ error: 'Failed to update responses' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
