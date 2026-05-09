// app/api/bots/[id]/conversations/insights-deck/route.ts
// POST — generate a StoryTime-style PPTX from bot conversations
// Slides: KPIs, common questions, audience profile, conversation patterns, quotes, recommendations

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'
import { renderDeck, type DeckSpec, type SlideSpec } from '@/lib/pptx/slideRenderer'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface Params { params: { id: string } }

export async function POST(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  const orgRel = (userData as any)?.organizations
  const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!(orgRel as any)?.is_admin_org
  const userOrgId = (userData as any)?.org_id as string | null

  const service = createServiceRoleClient()

  const { data: bot } = await service
    .from('bots')
    .select('id, name, system_prompt, personality, config, conversation_count, org_id')
    .eq('id', params.id)
    .single()

  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  if (!isAdmin && (bot as any).org_id !== userOrgId) {
    return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  }

  // Fetch all conversation turns (cap at 2000)
  const { data: turns } = await service
    .from('bot_conversation_turns')
    .select('session_id, turn_number, role, content, language, created_at')
    .eq('bot_id', params.id)
    .order('session_id')
    .order('turn_number', { ascending: true })
    .limit(2000)

  if (!turns || turns.length === 0) {
    return NextResponse.json({ error: 'No conversations to analyze' }, { status: 400 })
  }

  // Group by session
  const sessions: Record<string, typeof turns> = {}
  for (const t of turns) {
    if (!sessions[t.session_id]) sessions[t.session_id] = []
    sessions[t.session_id].push(t)
  }
  const sessionCount = Object.keys(sessions).length
  const totalTurns = turns.length
  const userTurns = turns.filter(t => t.role === 'user')
  const botTurns = turns.filter(t => t.role === 'assistant')

  // Compute basic stats
  const avgTurnsPerSession = Math.round(totalTurns / sessionCount)
  const avgUserWords = userTurns.length > 0
    ? Math.round(userTurns.reduce((s, t) => s + t.content.split(/\s+/).length, 0) / userTurns.length)
    : 0
  const avgBotWords = botTurns.length > 0
    ? Math.round(botTurns.reduce((s, t) => s + t.content.split(/\s+/).length, 0) / botTurns.length)
    : 0

  // Session lengths for drop-off analysis
  const sessionLengths = Object.values(sessions).map(s => s.length)
  const shortSessions = sessionLengths.filter(l => l <= 2).length
  const medSessions = sessionLengths.filter(l => l > 2 && l <= 8).length
  const longSessions = sessionLengths.filter(l => l > 8).length

  // Languages
  const langCounts: Record<string, number> = {}
  for (const t of userTurns) {
    langCounts[t.language] = (langCounts[t.language] || 0) + 1
  }

  // Date range
  const dates = turns.map(t => new Date(t.created_at).getTime()).sort()
  const firstDate = new Date(dates[0]).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const lastDate = new Date(dates[dates.length - 1]).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  // Build transcript for AI (cap at 10K chars)
  let transcript = ''
  for (const [sid, sess] of Object.entries(sessions)) {
    const block = `\n--- Session ${sid.slice(0, 8)} (${sess.length} turns) ---\n` +
      sess.map(t => `${t.role}: ${t.content.slice(0, 250)}`).join('\n') + '\n'
    if (transcript.length + block.length > 10000) break
    transcript += block
  }

  // Pick representative user quotes (longest, most substantive)
  const userQuotes = userTurns
    .filter(t => t.content.length > 30)
    .sort((a, b) => b.content.length - a.content.length)
    .slice(0, 20)

  // AI analysis — structured JSON output
  const aiResult = await callAI({
    tier: 'standard',
    maxTokens: 2000,
    timeoutMs: 45000,
    system: `You are analyzing ${sessionCount} conversations (${totalTurns} turns) with an AI agent called "${bot.name}".
${(bot as any).personality ? `Agent personality: ${(bot as any).personality}` : ''}
${bot.system_prompt ? `Agent purpose: ${(bot.system_prompt || '').slice(0, 300)}` : ''}

The transcript labels every line with either "user:" (real human participant) or "assistant:" (the AI agent itself). When the spec says "user quote", it means a line prefixed with "user:". NEVER lift, paraphrase, or attribute an "assistant:" line as a user quote — those are the agent's own responses, not what users said.

Analyze the conversations and return a JSON object with these exact keys:
{
  "common_questions": ["top 5 most frequent questions or topics users ask about"],
  "audience_profile": "2-3 sentence demographic/psychographic inference based on vocabulary, topics, and communication style — generation, education level, likely interests, economic indicators",
  "conversation_patterns": ["5 bullet points about how users interact — engagement depth, question types, follow-up behavior"],
  "drop_off_insights": "2-3 sentences about where and why conversations tend to end",
  "knowledge_gaps": ["3-5 topics users ask about that the agent struggles to answer well"],
  "personality_effectiveness": "2-3 sentences evaluating how well the agent's personality/tone lands with users",
  "recommendations": ["4-5 actionable recommendations to improve the agent"],
  "top_quotes": ["6 most insightful USER quotes — copy exact text from lines beginning with 'user:'. Minimum 20 words each. Do NOT include any line from 'assistant:'."]
}

Return ONLY valid JSON, no markdown.`,
    messages: [{ role: 'user', content: transcript }],
  })

  logUsage({ resource_type: 'bot', resource_id: params.id, event_type: 'insights_deck' }, aiResult.usage)

  // Parse AI response
  let analysis: any = {}
  try {
    const cleaned = aiResult.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    analysis = JSON.parse(cleaned)
  } catch {
    // Fallback: try to extract what we can
    analysis = {
      common_questions: ['Analysis parsing failed — regenerate report'],
      audience_profile: aiResult.text.slice(0, 300),
      conversation_patterns: [],
      drop_off_insights: '',
      knowledge_gaps: [],
      personality_effectiveness: '',
      recommendations: [],
      top_quotes: [],
    }
  }

  // Build slides
  const slides: SlideSpec[] = []

  // 1. Overview KPIs
  slides.push({
    type: 'kpi_grid',
    title: 'Conversation Overview',
    subtitle: firstDate + ' — ' + lastDate,
    kpis: [
      { value: String(sessionCount), label: 'Conversations', color: '0D2B45' },
      { value: String(totalTurns), label: 'Total Turns', color: '0F7173' },
      { value: String(avgTurnsPerSession), label: 'Avg Turns / Session', color: 'E85A1A' },
      { value: String(avgUserWords), label: 'Avg User Words', color: '0F7173' },
      { value: String(avgBotWords), label: 'Avg Agent Words', color: 'E8B84B' },
    ],
  })

  // 2. Engagement distribution
  slides.push({
    type: 'bar_chart',
    title: 'Conversation Depth',
    subtitle: 'Distribution of session lengths',
    data: [
      { label: 'Quick (1-2 turns)', value: shortSessions, color: '9CA3AF' },
      { label: 'Medium (3-8 turns)', value: medSessions, color: '0F7173' },
      { label: 'Deep (9+ turns)', value: longSessions, color: '059669' },
    ],
    insight: analysis.drop_off_insights || undefined,
  })

  // 3. Common questions
  if (analysis.common_questions?.length > 0) {
    slides.push({
      type: 'bullets',
      title: 'Most Common Questions & Topics',
      subtitle: 'What users are asking about most',
      bullets: analysis.common_questions.slice(0, 6),
    })
  }

  // 4. Audience profile
  if (analysis.audience_profile) {
    slides.push({
      type: 'two_column',
      title: 'Audience Profile',
      subtitle: 'Inferred from conversation patterns and language',
      left: {
        heading: 'Who\'s Talking',
        text: analysis.audience_profile,
      },
      right: {
        heading: 'Conversation Patterns',
        bullets: (analysis.conversation_patterns || []).slice(0, 4),
      },
    })
  }

  // 5. User quotes
  // Defense against the AI accidentally lifting assistant lines as user quotes
  // (Anna pptx bug: a bot persona line ended up on this slide). Only keep
  // AI-returned quotes that match an actual user turn; backfill from the
  // deterministic longest-user-turn pool when the AI under-delivers.
  const norm = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
  const userTurnNorms = userTurns.map(t => norm(t.content))
  function matchesUserTurn(q: string): boolean {
    const nq = norm(q)
    if (nq.length < 20) return false
    // Substring check both directions — catches quotes the AI may have
    // truncated, plus quotes that exactly equal a turn.
    return userTurnNorms.some(u => u.includes(nq) || nq.includes(u))
  }
  const aiQuotes: string[] = Array.isArray(analysis.top_quotes) ? analysis.top_quotes : []
  const validatedQuotes = aiQuotes.filter(q => typeof q === 'string' && matchesUserTurn(q))
  let quotes = validatedQuotes.slice(0, 6)
  if (quotes.length < 3) {
    const seen = new Set(quotes.map(norm))
    for (const t of userQuotes) {
      const candidate = t.content.length > 320 ? t.content.slice(0, 320).replace(/\s+\S*$/, '') + '…' : t.content
      const key = norm(candidate)
      if (seen.has(key)) continue
      quotes.push(candidate)
      seen.add(key)
      if (quotes.length >= 6) break
    }
  }
  if (quotes.length > 0) {
    slides.push({
      type: 'quotes',
      title: 'What Users Are Saying',
      subtitle: 'Representative quotes from conversations',
      quotes: quotes.map((q: string) => ({ text: q })),
    })
  }

  // 6. Knowledge gaps
  if (analysis.knowledge_gaps?.length > 0) {
    slides.push({
      type: 'bullets',
      title: 'Knowledge Gaps',
      subtitle: 'Topics where the agent needs more training content',
      bullets: analysis.knowledge_gaps.slice(0, 5),
      insight: analysis.personality_effectiveness || undefined,
    })
  }

  // 7. Recommendations
  if (analysis.recommendations?.length > 0) {
    slides.push({
      type: 'bullets',
      title: 'Recommendations',
      subtitle: 'Actionable improvements for this agent',
      bullets: analysis.recommendations.slice(0, 5),
    })
  }

  // 8. Language breakdown (if multilingual)
  const langEntries = Object.entries(langCounts).sort((a, b) => b[1] - a[1])
  if (langEntries.length > 1) {
    slides.push({
      type: 'bar_chart',
      title: 'Language Distribution',
      subtitle: 'Languages used in conversations',
      data: langEntries.slice(0, 8).map(([lang, count]) => ({
        label: lang.toUpperCase(),
        value: count,
        color: '0F7173',
      })),
    })
  }

  const deck: DeckSpec = {
    title: bot.name + ' — Conversation Insights',
    subtitle: sessionCount + ' conversations analyzed (' + firstDate + ' — ' + lastDate + ')',
    slides,
  }

  const buffer = await renderDeck(deck, bot.name)

  const fileName = bot.name.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_') + '_Insights.pptx'

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': 'attachment; filename="' + fileName + '"',
    },
  })
}
