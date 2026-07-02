// lib/phase3DualWrite.ts
//
// Phase 3 of the agents x PulseIQ convergence (docs/CONVERGENCE.md).
// Best-effort write-through that mirrors bot_conversation_turns inserts
// into the new conversations + conversation_turns tables.
//
// Gated by the DUAL_WRITE_PHASE3 env flag (truthy values: "true", "1").
// When the flag is off, mirrorTurns is a no-op; the live route is
// untouched.
//
// Errors are logged via console.error and NEVER thrown — dual-write must
// not affect the live response. If conversations upsert fails, the turn
// inserts are skipped (no orphan rows). If turn inserts fail, the
// conversations row already exists and the next call covers the gap.
//
// Removed once Phase 3 cuts the read path over to the new tables and
// bot_conversation_turns is dropped.

import type { SupabaseClient } from '@supabase/supabase-js'
import { logError } from '@/lib/log'

/**
 * Row shape used by /api/bots/[id]/chat for bot_conversation_turns inserts.
 * Only fields that exist on conversation_turns are forwarded; extras are
 * silently dropped (so the helper tolerates future bot_conversation_turns
 * additions without exploding the dual-write path).
 */
export interface MirroredTurn {
  bot_id: string
  session_id: string
  turn_number: number
  role: string
  content: string | null
  language?: string | null
  source?: string | null
  content_flags?: unknown
  sentiment?: string | null
  sentiment_score?: number | null
  content_en?: string | null
  /** When set, tags the conversation_turns row with the pulseiq_topics
   *  the turn was assigned to. Used by Phase 5 commit 3 PulseIQ delegation
   *  so cohort-wide response_count can be computed per topic. */
  topic_id?: string | null
}

interface MirrorArgs {
  botId: string
  orgId: string
  sessionId: string
  language?: string | null
  rows: MirroredTurn[]
  /** When set, the helper also auto-links the conversation to the town
   *  hall via pulseiq_session_conversations (idempotent insert). Phase 5
   *  commit 3 — PulseIQ delegation through handleChatTurn. */
  townHallId?: string | null
  /** When set, populates conversations.participant_id on upsert. PulseIQ
   *  delegation passes the original participant id so cohort analysis
   *  can group by participant without parsing the synthesized session_id. */
  participantId?: string | null
}

function isEnabled(): boolean {
  const v = process.env.DUAL_WRITE_PHASE3
  return v === 'true' || v === '1'
}

/**
 * Mirror a bot_conversation_turns insert into conversations + conversation_turns.
 * Fire-and-forget at the call site (returns Promise<void> that always resolves).
 */
export async function mirrorTurns(
  service: SupabaseClient,
  args: MirrorArgs,
): Promise<void> {
  if (!isEnabled()) return
  if (!args.rows || args.rows.length === 0) return

  try {
    const upsertPayload: Record<string, unknown> = {
      bot_id: args.botId,
      session_id: args.sessionId,
      org_id: args.orgId,
      language: args.language ?? null,
      updated_at: new Date().toISOString(),
    }
    if (args.participantId) upsertPayload.participant_id = args.participantId

    const { data: convRow, error: convErr } = await service
      .from('conversations')
      .upsert(upsertPayload, { onConflict: 'bot_id,session_id' })
      .select('id, org_id')
      .single()

    if (convErr || !convRow) {
      console.error({ at: 'phase3-dual-write', msg: 'conversations upsert failed', err: convErr?.message, bot_id: args.botId, session_id: args.sessionId })
      return
    }

    const conversationId = (convRow as { id: string }).id

    // Link to town hall (idempotent — unique index on (town_hall_id,
    // conversation_id) makes this a no-op after first call per session).
    if (args.townHallId) {
      const { error: linkErr } = await service
        .from('pulseiq_session_conversations')
        .upsert(
          {
            town_hall_id: args.townHallId,
            conversation_id: conversationId,
            org_id: args.orgId,
          },
          { onConflict: 'town_hall_id,conversation_id' },
        )
      if (linkErr) {
        console.error({ at: 'phase3-dual-write', msg: 'pulseiq_session_conversations link failed', err: linkErr.message, town_hall_id: args.townHallId, conversation_id: conversationId })
      }
    }

    // Skip rows missing content — conversation_turns.content is NOT NULL.
    // (Bot_conversation_turns also requires content; a null here means a
    // logic error upstream and the live insert will fail too.)
    const turnRows = args.rows
      .filter(r => typeof r.content === 'string' && r.content.length > 0)
      .map(r => ({
        conversation_id: conversationId,
        org_id: args.orgId,
        turn_number: r.turn_number,
        role: r.role,
        content: r.content as string,
        content_en: r.content_en ?? null,
        language: r.language ?? null,
        source: r.source ?? 'normal',
        content_flags: r.content_flags ?? null,
        sentiment: r.sentiment ?? null,
        sentiment_score: r.sentiment_score ?? null,
        topic_id: r.topic_id ?? null,
      }))

    if (turnRows.length === 0) return

    const { error: turnsErr } = await service.from('conversation_turns').insert(turnRows)
    if (turnsErr) {
      console.error({ at: 'phase3-dual-write', msg: 'conversation_turns insert failed', err: turnsErr.message, bot_id: args.botId, session_id: args.sessionId, count: turnRows.length })
    }
  } catch (e: any) {
    console.error({ at: 'phase3-dual-write', msg: 'unexpected error', err: e?.message, bot_id: args.botId, session_id: args.sessionId })
  }
}

/**
 * Mirror a bot_conversation_turns.update({ content_flags }).eq('id', ...) call
 * into the new schema by locating the matching conversation_turns row via
 * (bot_id, session_id, turn_number). Used by the focus-classify post-step in
 * /api/bots/[id]/chat that tags the just-saved assistant turn.
 *
 * If the conversation_turns row hasn't been inserted yet (mirrorTurns is fire-
 * and-forget and may still be in flight), this no-ops silently — the next
 * mirrorTurns call will write the row with the un-updated flags, which is the
 * best we can do without coordinating the two helpers.
 */
export async function mirrorFocusFlagsUpdate(
  service: SupabaseClient,
  args: { botId: string; sessionId: string; turnNumber: number; flags: string[] },
): Promise<void> {
  if (!isEnabled()) return

  try {
    const { data: convRow, error: convRowErr } = await service
      .from('conversations')
      .select('id')
      .eq('bot_id', args.botId)
      .eq('session_id', args.sessionId)
      .maybeSingle()
    if (convRowErr) void logError('phase3DualWrite.mirrorFocusFlagsUpdate', convRowErr)

    if (!convRow) return // dual-write upsert hasn't landed yet; nothing to update

    const { error } = await service
      .from('conversation_turns')
      .update({ content_flags: args.flags })
      .eq('conversation_id', (convRow as { id: string }).id)
      .eq('turn_number', args.turnNumber)

    if (error) {
      console.error({ at: 'phase3-dual-write', msg: 'conversation_turns flags update failed', err: error.message, bot_id: args.botId, session_id: args.sessionId, turn_number: args.turnNumber })
    }
  } catch (e: any) {
    console.error({ at: 'phase3-dual-write', msg: 'unexpected error in flags update', err: e?.message })
  }
}

/**
 * Mirror a bot_conversation_turns.delete().eq('bot_id', ...).eq('session_id', ...)
 * call by removing the matching conversations row (cascade drops the turn rows).
 * Used by the admin "delete session" handler.
 */
export async function mirrorDeleteSession(
  service: SupabaseClient,
  args: { botId: string; sessionId: string },
): Promise<void> {
  if (!isEnabled()) return

  try {
    const { error } = await service
      .from('conversations')
      .delete()
      .eq('bot_id', args.botId)
      .eq('session_id', args.sessionId)

    if (error) {
      console.error({ at: 'phase3-dual-write', msg: 'conversations delete failed', err: error.message, bot_id: args.botId, session_id: args.sessionId })
    }
  } catch (e: any) {
    console.error({ at: 'phase3-dual-write', msg: 'unexpected error in delete', err: e?.message })
  }
}
