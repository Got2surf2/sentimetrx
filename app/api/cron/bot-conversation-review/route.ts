// app/api/cron/bot-conversation-review/route.ts
// Cron endpoint: periodic AI review of bot conversations for theme drift.
// Runs every 4 hours via Vercel Cron. Processes bots with review_interval_hours set
// and next_review_at <= now.

import { createServiceRoleClient } from '@/lib/supabase/server'
import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'
import { checkCronAuth } from '@/lib/cronAuth'
import { isPhase3ReadSafe } from '@/lib/phase3Read'
import { enabledProbes, assignProbe } from '@/lib/researchProbes'
import { fetchAllRows } from '@/lib/townHallAdapter'
import { logError } from '@/lib/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const denied = checkCronAuth(req.headers.get('authorization'))
  if (denied) return denied

  const service = createServiceRoleClient()
  const now = new Date().toISOString()

  // ── Research-probe never_fit sweep (BOTS.md §14.5 step 4) ──────────────
  // Every probe ASSIGNMENT must resolve to exactly one outcome. Assignment
  // is a deterministic hash, so this sweep can RECOMPUTE it after the fact:
  // for each ended session (last turn 2h–7d old) on a probe-carrying agent,
  // a hash-winning probe with no response row means the conversation ended
  // before a natural moment → 'never_fit'. Runs before (and independent of)
  // the review-interval gate below.
  const probeSweep = await sweepNeverFit(service)

  // Find active bots due for review
  const { data: dueBots } = await service
    .from('agents')
    .select('id, name, system_prompt')
    .eq('status', 'active')
    .not('review_interval_hours', 'is', null)
    .lte('next_review_at', now)
    .limit(5)

  if (!dueBots || dueBots.length === 0) {
    return NextResponse.json({ message: 'No bots due for review', processed: 0, probeSweep })
  }

  const results: { botId: string; name: string; sessions: number; drift: boolean }[] = []

  for (const bot of dueBots) {
    try {
      // Get last review timestamp (or 7 days ago for first review)
      const { data: lastReview } = await service
        .from('agent_conversation_reviews')
        .select('reviewed_at')
        .eq('bot_id', bot.id)
        .order('reviewed_at', { ascending: false })
        .limit(1)
        .single()

      const since = lastReview?.reviewed_at || new Date(Date.now() - 7 * 86400000).toISOString()

      // Fetch conversations since last review. READ_PHASE3 sources from
      // the new substrate; the cron is a pure reader (writes go to bots
      // and bot_conversation_reviews, never back to turns).
      // 300 turns × ≤200 chars each comfortably fills the 8K-char
      // transcript cap below — anything past that is discarded.
      const TURN_LIMIT = 300
      let turns: { session_id: string; turn_number: number; role: string; content: string; created_at: string }[] | null = null
      if (isPhase3ReadSafe()) {
        const { data } = await service
          .from('conversation_turns')
          .select('turn_number, role, content, created_at, conversations!inner(session_id, bot_id)')
          .eq('conversations.bot_id', bot.id)
          .gte('created_at', since)
          .order('turn_number', { ascending: true })
          .limit(TURN_LIMIT)
        turns = (data || []).map((r: any) => ({
          session_id: r.conversations?.session_id || '',
          turn_number: r.turn_number,
          role: r.role,
          content: r.content,
          created_at: r.created_at,
        }))
      } else {
        const { data } = await service
          .from('bot_conversation_turns')
          .select('session_id, turn_number, role, content, created_at')
          .eq('bot_id', bot.id)
          .gte('created_at', since)
          .order('session_id')
          .order('turn_number', { ascending: true })
          .limit(TURN_LIMIT)
        turns = data
      }

      if (!turns || turns.length === 0) {
        // No new conversations — just update next_review_at
        const { data: botData } = await service.from('agents').select('review_interval_hours').eq('id', bot.id).single()
        const hours = botData?.review_interval_hours || 24
        await service.from('agents').update({
          last_reviewed_at: now,
          next_review_at: new Date(Date.now() + hours * 3600000).toISOString(),
        }).eq('id', bot.id)
        results.push({ botId: bot.id, name: bot.name, sessions: 0, drift: false })
        continue
      }

      // Group into sessions
      const sessions: Record<string, typeof turns> = {}
      for (const t of turns) {
        if (!sessions[t.session_id]) sessions[t.session_id] = []
        sessions[t.session_id].push(t)
      }
      const sessionCount = Object.keys(sessions).length

      // Build transcript for AI (cap at 8K chars)
      let transcript = ''
      for (const [sid, sess] of Object.entries(sessions)) {
        const block = `\n--- Session ${sid.slice(0, 8)} (${sess.length} turns) ---\n` +
          sess.map(t => `${t.role}: ${t.content.slice(0, 200)}`).join('\n') + '\n'
        if (transcript.length + block.length > 8000) break
        transcript += block
      }

      // AI analysis with theme drift detection
      const aiResult = await callAI({
        tier: 'fast',
        maxTokens: 800,
        timeoutMs: 30000,
        system: `You are reviewing conversations from an AI agent called "${bot.name}". The agent's system prompt is: "${(bot.system_prompt || '').slice(0, 500)}"

Analyze these conversations for:
1. **Theme Drift** — Is the agent staying on-topic per its system prompt? Has the conversation pattern shifted from what's expected? Answer YES or NO clearly at the start.
2. **Common Questions** — Top 3 recurring questions
3. **Knowledge Gaps** — Topics users ask about that the agent can't answer well
4. **Drop-off Patterns** — Where conversations tend to end

Start your response with exactly "DRIFT: YES" or "DRIFT: NO" on the first line, then the analysis.`,
        messages: [{ role: 'user', content: `${sessionCount} conversations (${turns.length} turns) since ${since}:\n${transcript}` }],
      })

      logUsage({ resource_type: 'bot', resource_id: bot.id, event_type: 'review' }, aiResult.usage)

      const themeDrift = /^DRIFT:\s*YES/i.test(aiResult.text)

      // Store review result
      await service.from('agent_conversation_reviews').insert({
        bot_id: bot.id,
        since,
        session_count: sessionCount,
        turn_count: turns.length,
        report: aiResult.text,
        theme_drift: themeDrift,
      })

      // Update bot timestamps
      const { data: botData } = await service.from('agents').select('review_interval_hours').eq('id', bot.id).single()
      const hours = botData?.review_interval_hours || 24
      await service.from('agents').update({
        last_reviewed_at: now,
        next_review_at: new Date(Date.now() + hours * 3600000).toISOString(),
      }).eq('id', bot.id)

      results.push({ botId: bot.id, name: bot.name, sessions: sessionCount, drift: themeDrift })
    } catch (err: any) {
      results.push({ botId: bot.id, name: bot.name, sessions: -1, drift: false })
    }
  }

  return NextResponse.json({ processed: results.length, results, probeSweep })
}

// Recompute deterministic probe assignments for ended sessions and record
// 'never_fit' where no outcome row exists. Best-effort: any error logs and
// moves on; un-swept sessions stay inside the 7-day window for the next run.
async function sweepNeverFit(service: ReturnType<typeof createServiceRoleClient>): Promise<{ agents: number; neverFit: number }> {
  let agentsSwept = 0
  let neverFit = 0
  try {
    const { data: probeBots, error: botsErr } = await service
      .from('agents')
      .select('id, org_id, research_probes')
      .neq('research_probes', '[]')
    if (botsErr) { void logError('probeSweep.bots', botsErr); return { agents: 0, neverFit: 0 } }
    const twoHoursAgo = Date.now() - 2 * 3600_000
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString()
    for (const pb of probeBots || []) {
      const probes = enabledProbes(pb as { research_probes?: unknown })
      if (probes.length === 0) continue
      agentsSwept++
      // Last-activity per session over the window (paged past the 1000-row
      // PostgREST cap; 50K turns/week/agent is far above current traffic).
      const turns = await fetchAllRows<{ session_id: string; created_at: string }>((from, to) =>
        service
          .from('bot_conversation_turns')
          .select('session_id, created_at')
          .eq('bot_id', pb.id)
          .gte('created_at', sevenDaysAgo)
          .order('created_at', { ascending: true })
          .range(from, to),
      )
      const lastActivity = new Map<string, string>()
      for (const t of turns) {
        const prev = lastActivity.get(t.session_id)
        if (!prev || t.created_at > prev) lastActivity.set(t.session_id, t.created_at)
      }
      const candidates: { session_id: string; probe_id: string; probe_version: number }[] = []
      for (const [sid, last] of lastActivity) {
        if (new Date(last).getTime() > twoHoursAgo) continue  // still live-ish
        const assigned = assignProbe(probes, sid, new Date(last))
        if (assigned) candidates.push({ session_id: sid, probe_id: assigned.id, probe_version: assigned.version ?? 1 })
      }
      if (candidates.length === 0) continue
      const { data: existing, error: exErr } = await service
        .from('agent_probe_responses')
        .select('session_id')
        .eq('agent_id', pb.id)
        .in('session_id', candidates.map(c => c.session_id))
      if (exErr) { void logError('probeSweep.existing', exErr, { orgId: (pb as { org_id: string }).org_id }); continue }
      const have = new Set((existing || []).map(r => r.session_id))
      const rows = candidates
        .filter(c => !have.has(c.session_id))
        .map(c => ({ org_id: (pb as { org_id: string }).org_id, agent_id: pb.id, ...c, outcome: 'never_fit' }))
      if (rows.length === 0) continue
      const { error: insErr } = await service
        .from('agent_probe_responses')
        .upsert(rows, { onConflict: 'agent_id,session_id,probe_id', ignoreDuplicates: true })
      if (insErr) { void logError('probeSweep.insert', insErr, { orgId: (pb as { org_id: string }).org_id }); continue }
      neverFit += rows.length
    }
  } catch (e) {
    void logError('probeSweep', e)
  }
  return { agents: agentsSwept, neverFit }
}
