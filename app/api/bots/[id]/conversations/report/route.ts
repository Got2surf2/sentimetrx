// app/api/bots/[id]/conversations/report/route.ts
// POST — on-demand AI analysis of recent conversations
// Analyzes: common questions, patterns, drop-off points, theme consistency

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

interface Params { params: { id: string } }

export async function POST(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify user owns this bot
  const { data: bot } = await supabase
    .from('bots')
    .select('id, name, system_prompt')
    .eq('id', params.id)
    .single()
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })

  let body: any = {}
  try { body = await req.json() } catch {}
  const since = body.since || new Date(Date.now() - 7 * 86400000).toISOString() // default: last 7 days

  // Fetch recent conversations
  const { data: turns } = await supabase
    .from('bot_conversation_turns')
    .select('session_id, turn_number, role, content, created_at')
    .eq('bot_id', params.id)
    .gte('created_at', since)
    .order('session_id')
    .order('turn_number', { ascending: true })
    .limit(1000)

  if (!turns || turns.length === 0) {
    return NextResponse.json({ report: 'No conversations found in the specified time period.' })
  }

  // Group into sessions
  const sessions: Record<string, { turns: typeof turns }> = {}
  for (const t of turns) {
    if (!sessions[t.session_id]) sessions[t.session_id] = { turns: [] }
    sessions[t.session_id].turns.push(t)
  }

  const sessionCount = Object.keys(sessions).length
  const totalTurns = turns.length

  // Build transcript summary for AI analysis (cap at ~8000 chars to stay within budget)
  let transcript = ''
  let charBudget = 8000
  for (const [sid, sess] of Object.entries(sessions)) {
    const block = `\n--- Session ${sid.slice(0, 8)} (${sess.turns.length} turns) ---\n` +
      sess.turns.map(t => `${t.role}: ${t.content.slice(0, 200)}`).join('\n') + '\n'
    if (transcript.length + block.length > charBudget) break
    transcript += block
  }

  const result = await callAI({
    tier: 'fast',
    maxTokens: 800,
    timeoutMs: 30000,
    system: `You are analyzing conversations from an AI agent called "${bot.name}". The agent's purpose is described by this system prompt: "${(bot.system_prompt || '').slice(0, 500)}"

Analyze the conversations and provide a structured report with these sections:
1. **Common Questions** — Top 3-5 recurring questions or topics users ask about
2. **Conversation Patterns** — Average length, engagement patterns, where users tend to disengage
3. **Drop-off Points** — Where conversations tend to end prematurely (if any patterns)
4. **Theme Consistency** — Whether the agent stays on-topic or drifts, and any gaps in its knowledge base
5. **Recommendations** — 2-3 actionable suggestions to improve the agent

Be concise. Use bullet points. This is for a dashboard display.`,
    messages: [{ role: 'user', content: `Here are ${sessionCount} recent conversations (${totalTurns} total turns) since ${since}:\n${transcript}\n\nPlease analyze these conversations.` }],
  })

  logUsage({ resource_type: 'bot', resource_id: params.id, event_type: 'report' }, result.usage)

  // Extract actionable items if requested
  if (body.extract_actions && body.report_text) {
    try {
      var actionResult = await callAI({
        tier: 'fast',
        maxTokens: 500,
        timeoutMs: 15000,
        system: 'Extract actionable improvement items from this AI agent report. For each item, decide if it should be a "fact" (knowledge to add), "faq" (question + answer pair), or "guardrail" (rule the agent must follow).\n\nReturn a JSON array of objects:\n[{"type":"fact|faq|guardrail","title":"short title","content":"the content to add"}]\n\nOnly include items that are specific and actionable — skip vague suggestions. Max 5 items. Return ONLY the JSON array, no explanation.',
        messages: [{ role: 'user', content: body.report_text }],
      })
      logUsage({ resource_type: 'bot', resource_id: params.id, event_type: 'report' }, actionResult.usage)
      var actionsText = (actionResult.text || '').trim()
      var jsonMatch = actionsText.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        var parsed = JSON.parse(jsonMatch[0])
        return NextResponse.json({ actions: parsed })
      }
    } catch {}
    return NextResponse.json({ actions: [] })
  }

  return NextResponse.json({
    report: result.text,
    stats: { session_count: sessionCount, total_turns: totalTurns, since },
  })
}
