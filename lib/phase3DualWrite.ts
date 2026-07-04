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

// Transient-failure retry. The 2026-07-04 load test showed mirror writes
// failing with pooler connection timeouts and never retrying — mirror-fed
// surfaces (dashboards, cohort counts, theme detection) then undercount
// FOREVER for the affected turns. Retry only errors that look transient;
// constraint violations etc. fail immediately as before.
const TRANSIENT_RX = /connect|connection|timeout|timed out|fetch failed|ECONN|reset|socket|EPIPE|ETIMEDOUT/i

async function withRetry<T extends { error: { message: string } | null }>(
  fn: () => PromiseLike<T>,
  label: string,
  attempts = 3,
): Promise<T> {
  let last: T | null = null
  for (let i = 0; i < attempts; i++) {
    try {
      last = await fn()
      if (!last.error || !TRANSIENT_RX.test(last.error.message)) return last
    } catch (e: any) {
      if (!TRANSIENT_RX.test(String(e?.message || e))) throw e
      last = { error: { message: String(e?.message || e) } } as T
    }
    if (i < attempts - 1) await new Promise(r => setTimeout(r, 250 * (i + 1)))
  }
  console.error({ at: 'phase3-dual-write', msg: label + ' failed after ' + attempts + ' attempts', err: last?.error?.message })
  return last as T
}

/**
 * Mirror a bot_conversation_turns insert into conversations + conversation_turns.
 * Fire-and-forget at the call site (returns Promise<void> that always resolves).
 */
export async function mirrorTurns(
  service: SupabaseClient,
  args: MirrorArgs,
): Promise<void> {
  // PulseIQ conversations (townHallId set) mirror UNCONDITIONALLY — for
  // new-substrate sessions the conversations/conversation_turns rows are
  // the PRIMARY analytics store (cohort counts, theme detection, exports),
  // not a dark-launch experiment. Agent-side dual-write stays flag-gated
  // until the Phase-3 Tier-5 verification window completes.
  if (!args.townHallId && !isEnabled()) return
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

    const { data: convRow, error: convErr } = await withRetry(
      () => service
        .from('conversations')
        .upsert(upsertPayload, { onConflict: 'bot_id,session_id' })
        .select('id, org_id')
        .single(),
      'conversations upsert',
    )

    if (convErr || !convRow) {
      console.error({ at: 'phase3-dual-write', msg: 'conversations upsert failed', err: convErr?.message, bot_id: args.botId, session_id: args.sessionId })
      return
    }

    const conversationId = (convRow as { id: string }).id

    // Link to town hall (idempotent — unique index on (town_hall_id,
    // conversation_id) makes this a no-op after first call per session).
    if (args.townHallId) {
      const { error: linkErr } = await withRetry(
        () => service
          .from('pulseiq_session_conversations')
          .upsert(
            {
              town_hall_id: args.townHallId,
              conversation_id: conversationId,
              org_id: args.orgId,
            },
            { onConflict: 'town_hall_id,conversation_id' },
          ),
        'pulseiq_session_conversations link',
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
        // Denormalized hall routing (sql/156) — lets live surfaces filter
        // by one indexed equality instead of .in(<every conversation id>).
        town_hall_id: args.townHallId ?? null,
      }))

    if (turnRows.length === 0) return

    const { error: turnsErr } = await withRetry(
      () => service.from('conversation_turns').insert(turnRows),
      'conversation_turns insert',
    )
    if (turnsErr) {
      void logError('phase3DualWrite.turnsInsert', turnsErr, { orgId: args.orgId })
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
 * Reconcile the analytics mirror for one town hall: find participant
 * sessions whose synchronous store (bot_conversation_turns) has turns the
 * mirror (conversation_turns) is missing, and re-mirror ONLY the missing
 * turn numbers. Safety net behind the per-write retry above — a turn that
 * exhausts its retries during a load spike is healed by the next cron tick
 * instead of undercounting forever.
 *
 * Bounded: at most maxSessions lagging sessions per call (the cron ticks
 * every 15 min; overflow heals next tick, per the no-queue posture D16).
 * Never throws.
 *
 * Limitation: the sync store has no topic_id (it's attached at mirror
 * time), so healed turns carry no topic tag. Topic COUNTS are unaffected —
 * sql/154 counters increment at write time — only per-topic transcript
 * filtering of the healed turns degrades.
 */
export async function reconcileMirrorForHall(
  service: SupabaseClient,
  args: { townHallId: string; botId: string; orgId: string },
  maxSessions = 20,
): Promise<{ healed: number; lagging: number }> {
  const out = { healed: 0, lagging: 0 }
  try {
    // Stamp-heal: turns mirrored by pre-sql/156 code carry a null
    // town_hall_id (e.g. the window between migration apply and deploy).
    // One idempotent UPDATE per sweep; affects 0 rows when clean.
    const { data: links } = await service
      .from('pulseiq_session_conversations')
      .select('conversation_id')
      .eq('town_hall_id', args.townHallId)
    const linkIds = (links || []).map(l => l.conversation_id)
    if (linkIds.length > 0) {
      const { error: stampErr } = await service
        .from('conversation_turns')
        .update({ town_hall_id: args.townHallId })
        .in('conversation_id', linkIds)
        .is('town_hall_id', null)
      if (stampErr) void logError('phase3DualWrite.reconcile.stamp', stampErr, { orgId: args.orgId })
    }

    // Sync-store per-participant-session turn counts. Cohort sessions use
    // session_id = townHallId + ':' + participantId (chatCore convention).
    const { data: syncTurns, error: syncErr } = await service
      .from('bot_conversation_turns')
      .select('session_id, turn_number, role, content, content_en, language, source, content_flags, sentiment, sentiment_score')
      .eq('bot_id', args.botId)
      .like('session_id', args.townHallId + ':%')
      .order('session_id', { ascending: true })
      .order('turn_number', { ascending: true })
      .limit(5000)
    if (syncErr || !syncTurns || syncTurns.length === 0) {
      if (syncErr) void logError('phase3DualWrite.reconcile.syncRead', syncErr, { orgId: args.orgId })
      return out
    }
    const bySession = new Map<string, typeof syncTurns>()
    for (const t of syncTurns) {
      const arr = bySession.get(t.session_id) || []
      arr.push(t)
      bySession.set(t.session_id, arr)
    }

    for (const [sessionId, turns] of bySession) {
      if (out.lagging >= maxSessions) break
      const { data: convRow } = await service
        .from('conversations')
        .select('id')
        .eq('bot_id', args.botId)
        .eq('session_id', sessionId)
        .maybeSingle()
      // Missing conversations row entirely → one mirrorTurns call rebuilds
      // row + link + all turns.
      if (!convRow) {
        out.lagging++
        await mirrorTurns(service, {
          botId: args.botId, orgId: args.orgId, sessionId,
          language: turns[0]?.language ?? null,
          rows: turns as MirroredTurn[],
          townHallId: args.townHallId,
          participantId: sessionId.slice(args.townHallId.length + 1) || null,
        })
        out.healed += turns.length
        continue
      }
      const { data: mirrored } = await service
        .from('conversation_turns')
        .select('turn_number')
        .eq('conversation_id', (convRow as { id: string }).id)
      const have = new Set((mirrored || []).map(m => m.turn_number))
      const missing = turns.filter(t => !have.has(t.turn_number) && typeof t.content === 'string' && t.content.length > 0)
      if (missing.length === 0) continue
      out.lagging++
      await mirrorTurns(service, {
        botId: args.botId, orgId: args.orgId, sessionId,
        language: missing[0]?.language ?? null,
        rows: missing as MirroredTurn[],
        townHallId: args.townHallId,
        participantId: sessionId.slice(args.townHallId.length + 1) || null,
      })
      out.healed += missing.length
    }
  } catch (e) {
    void logError('phase3DualWrite.reconcile', e, { orgId: args.orgId })
  }
  return out
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
