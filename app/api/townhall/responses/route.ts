// app/api/townhall/responses/route.ts
// POST — submit post-session demographic & psychographic answers (anonymous, no auth)
//
// Substrate-aware (Gap #5b, 2026-05-22): `session_id` from the client
// can resolve to EITHER a legacy `townhall_sessions.id` OR a phase-3
// `pulseiq_events.id` (because /api/townhall/join returns the underlying
// row id and phase-3 town halls now flow through that same route).
//
// Validation paths:
//   - Legacy → participant must have at least one row in townhall_turns
//     for this session_id + participant_id pair.
//   - Phase-3 → participant_id must match a `conversations.participant_id`
//     where the conversation is linked to the town hall via
//     `pulseiq_event_conversations`.
//
// Storage path (per sql/083 migration):
//   - Legacy row: session_id = townhall_sessions.id, town_hall_id = null
//   - Phase-3 row: session_id = null, town_hall_id = pulseiq_events.id
//   - CHECK constraint enforces at-least-one. Partial unique indexes
//     enforce one-row-per-participant-per-session in both worlds.

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

  // Resolve substrate. Legacy first (more common today), then phase-3.
  const { data: legacySession } = await service
    .from('townhall_sessions')
    .select('id')
    .eq('id', session_id)
    .maybeSingle()

  let substrate: 'legacy' | 'phase3' = 'legacy'
  let townHallId: string | null = null

  if (legacySession) {
    substrate = 'legacy'
  } else {
    const { data: hall } = await service
      .from('pulseiq_events')
      .select('id')
      .eq('id', session_id)
      .maybeSingle()
    if (!hall) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    substrate = 'phase3'
    townHallId = (hall as any).id
  }

  // Validate participant existence in the appropriate substrate.
  if (substrate === 'legacy') {
    const { count } = await service
      .from('townhall_turns')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', session_id)
      .eq('participant_id', participant_id)
    if (!count || count === 0) {
      return NextResponse.json({ error: 'Participant not found in session' }, { status: 404 })
    }
  } else {
    // Phase-3: walk pulseiq_event_conversations → conversations and confirm
    // the participant_id matches at least one linked conversation.
    const { data: links } = await service
      .from('pulseiq_event_conversations')
      .select('conversations!inner(participant_id)')
      .eq('town_hall_id', townHallId)
    const found = ((links || []) as any[]).some(r => {
      const c = Array.isArray(r.conversations) ? r.conversations[0] : r.conversations
      return c?.participant_id === participant_id
    })
    if (!found) {
      return NextResponse.json({ error: 'Participant not found in town hall' }, { status: 404 })
    }
  }

  // Upsert with the appropriate column populated. Partial unique index
  // (sql/083) enforces "one row per participant per session" within
  // each substrate. The legacy onConflict spec doesn't work for partial
  // indexes via the JS client — fall back to manual upsert: try insert,
  // catch the unique violation, then update.
  const insertRow: Record<string, unknown> = {
    participant_id,
    psychographics: psychographics || {},
    demographics: demographics || {},
    submitted_at: new Date().toISOString(),
  }
  if (substrate === 'legacy') {
    insertRow.session_id = session_id
  } else {
    insertRow.town_hall_id = townHallId
  }

  const { error: insertErr } = await service
    .from('townhall_participant_responses')
    .insert(insertRow)

  if (insertErr) {
    const isDup = /duplicate key value|unique constraint/i.test(insertErr.message || '')
    if (!isDup) {
      console.error({ at: 'townhall/responses', msg: 'insert error', substrate, err: insertErr })
      return NextResponse.json({ error: 'Failed to save responses' }, { status: 500 })
    }
    // Update path — match the right substrate column.
    const updateBase = service
      .from('townhall_participant_responses')
      .update({
        psychographics: psychographics || {},
        demographics: demographics || {},
        submitted_at: new Date().toISOString(),
      })
      .eq('participant_id', participant_id)
    const { error: updateErr } = substrate === 'legacy'
      ? await updateBase.eq('session_id', session_id)
      : await updateBase.eq('town_hall_id', townHallId!)
    if (updateErr) {
      console.error({ at: 'townhall/responses', msg: 'update error', substrate, err: updateErr })
      return NextResponse.json({ error: 'Failed to update responses' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
