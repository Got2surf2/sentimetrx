// app/api/townhall/suggest-topic/route.ts
// POST — AI generates keywords, description, opening question, and follow-up angles for a topic label

import { NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

export async function POST(req: Request) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { label, industry, event_description, org_name } = body
  if (!label?.trim()) return NextResponse.json({ error: 'Missing topic label' }, { status: 400 })

  const context = [
    industry ? `Industry: ${industry.replace(/_/g, ' ')}` : '',
    org_name ? `Organization: ${org_name}` : '',
    event_description ? `Event: ${event_description}` : '',
  ].filter(Boolean).join('\n')

  const prompt = `You are a qualitative research expert setting up a PulseIQ discussion topic.

Topic label: "${label.trim()}"
${context ? '\n' + context : ''}

Generate a complete topic definition with:

1. **description**: One sentence describing what this topic covers (for AI context, not shown to participants)
2. **opening_question**: A warm, conversational opening question to ask participants about this topic (max 30 words)
3. **follow_up_angles**: 3-5 follow-up angles the AI moderator can use to probe deeper (short phrases)
4. **keywords**: 12-20 keywords for text matching, including:
   - Core terms (the obvious words)
   - Lemma variants (e.g. "wait" covers "waiting", "waited")
   - Synonyms (e.g. "cost" → "price", "expense", "fee", "charge")
   - Related concepts (e.g. "parking" for a transportation topic)
   - Informal/colloquial variants (e.g. "pricey", "rip-off")
   All lowercase, single words or short phrases.

Return ONLY valid JSON:
{"description":"...","opening_question":"...","follow_up_angles":["...","...","..."],"keywords":["word1","word2","word3"]}`

  try {
    const result = await callAI({
      tier: 'standard',
      maxTokens: 1500,
      timeoutMs: 10000,
      system: 'You are a qualitative research expert. Return ONLY raw JSON — no markdown, no backticks, no explanation.',
      messages: [{ role: 'user', content: prompt }],
    })

    logUsage({ resource_type: 'townhall', event_type: 'suggest_topic' }, result.usage)

    const raw = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    const parsed = JSON.parse(raw)

    return NextResponse.json({
      description: parsed.description || '',
      opening_question: parsed.opening_question || '',
      follow_up_angles: Array.isArray(parsed.follow_up_angles) ? parsed.follow_up_angles : [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map((k: string) => k.toLowerCase().trim()).filter(Boolean) : [],
    })
  } catch (e: any) {
    return NextResponse.json({ error: 'AI error: ' + (e.message || 'unknown') }, { status: 500 })
  }
}
