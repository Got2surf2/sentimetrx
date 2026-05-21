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
}

interface MirrorArgs {
  botId: string
  orgId: string
  sessionId: string
  language?: string | null
  rows: MirroredTurn[]
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
    const { data: convRow, error: convErr } = await service
      .from('conversations')
      .upsert(
        {
          bot_id: args.botId,
          session_id: args.sessionId,
          org_id: args.orgId,
          language: args.language ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'bot_id,session_id' },
      )
      .select('id')
      .single()

    if (convErr || !convRow) {
      console.error({ at: 'phase3-dual-write', msg: 'conversations upsert failed', err: convErr?.message, bot_id: args.botId, session_id: args.sessionId })
      return
    }

    const conversationId = (convRow as { id: string }).id

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
