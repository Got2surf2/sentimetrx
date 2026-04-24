// app/api/cron/bot-conversation-review/route.ts
// Cron endpoint: periodic AI review of bot conversations for theme drift.
// Runs every 4 hours via Vercel Cron. Processes bots with review_interval_hours set
// and next_review_at <= now.

import { createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { callAI } from '@/lib/ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceRoleClient()
  const now = new Date().toISOString()

  // Find active bots due for review
  const { data: dueBots } = await service
    .from('bots')
    .select('id, name, system_prompt')
    .eq('status', 'active')
    .not('review_interval_hours', 'is', null)
    .lte('next_review_at', now)
    .limit(5)

  if (!dueBots || dueBots.length === 0) {
    return NextResponse.json({ message: 'No bots due for review', processed: 0 })
  }

  const results: { botId: string; name: string; sessions: number; drift: boolean }[] = []

  for (const bot of dueBots) {
    try {
      // Get last review timestamp (or 7 days ago for first review)
      const { data: lastReview } = await service
        .from('bot_conversation_reviews')
        .select('reviewed_at')
        .eq('bot_id', bot.id)
        .order('reviewed_at', { ascending: false })
        .limit(1)
        .single()

      const since = lastReview?.reviewed_at || new Date(Date.now() - 7 * 86400000).toISOString()

      // Fetch conversations since last review
      const { data: turns } = await service
        .from('bot_conversation_turns')
        .select('session_id, turn_number, role, content, created_at')
        .eq('bot_id', bot.id)
        .gte('created_at', since)
        .order('session_id')
        .order('turn_number', { ascending: true })
        .limit(1000)

      if (!turns || turns.length === 0) {
        // No new conversations — just update next_review_at
        const { data: botData } = await service.from('bots').select('review_interval_hours').eq('id', bot.id).single()
        const hours = botData?.review_interval_hours || 24
        await service.from('bots').update({
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

      const themeDrift = /^DRIFT:\s*YES/i.test(aiResult.text)

      // Store review result
      await service.from('bot_conversation_reviews').insert({
        bot_id: bot.id,
        since,
        session_count: sessionCount,
        turn_count: turns.length,
        report: aiResult.text,
        theme_drift: themeDrift,
      })

      // Update bot timestamps
      const { data: botData } = await service.from('bots').select('review_interval_hours').eq('id', bot.id).single()
      const hours = botData?.review_interval_hours || 24
      await service.from('bots').update({
        last_reviewed_at: now,
        next_review_at: new Date(Date.now() + hours * 3600000).toISOString(),
      }).eq('id', bot.id)

      results.push({ botId: bot.id, name: bot.name, sessions: sessionCount, drift: themeDrift })
    } catch (err: any) {
      results.push({ botId: bot.id, name: bot.name, sessions: -1, drift: false })
    }
  }

  return NextResponse.json({ processed: results.length, results })
}
