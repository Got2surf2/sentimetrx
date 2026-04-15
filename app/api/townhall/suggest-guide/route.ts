// app/api/townhall/suggest-guide/route.ts
// POST — AI generates a full discussion guide from event description + industry

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { callAI } from '@/lib/ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

export async function POST(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { description, industry, org_name, topic_count } = body
  if (!description?.trim()) return NextResponse.json({ error: 'Need an event description to generate topics' }, { status: 400 })

  const count = Math.max(2, Math.min(8, topic_count || 4))

  const prompt = `You are a qualitative research expert designing a discussion guide for a town hall.
${industry ? `\nIndustry: ${industry.replace(/_/g, ' ')}` : ''}
${org_name ? `\nOrganization: ${org_name}` : ''}

Event description: "${description.trim()}"

Generate ${count} discussion topics that cover the key themes from this event. For each topic provide:
- **label**: Short topic name (2-4 words)
- **description**: One sentence context for the AI moderator
- **opening_question**: A warm, conversational question (max 30 words)
- **follow_up_angles**: 3-4 follow-up probes the AI can use
- **keywords**: 12-15 keywords for text matching including core terms, lemma variants, synonyms, related concepts, and informal terms (all lowercase)

Make topics distinct — don't overlap. Cover the breadth of the event description.

Return ONLY valid JSON:
{"topics":[{"label":"...","description":"...","opening_question":"...","follow_up_angles":["..."],"keywords":["..."]}]}`

  try {
    const result = await callAI({
      tier: 'standard',
      maxTokens: 4000,
      timeoutMs: 15000,
      system: 'You are a qualitative research expert. Return ONLY raw JSON — no markdown, no backticks.',
      messages: [{ role: 'user', content: prompt }],
    })
    const raw = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    const parsed = JSON.parse(raw)
    const topics = Array.isArray(parsed.topics) ? parsed.topics.map((t: any) => ({
      label: t.label || '',
      description: t.description || '',
      opening_question: t.opening_question || '',
      follow_up_angles: Array.isArray(t.follow_up_angles) ? t.follow_up_angles : [],
      keywords: Array.isArray(t.keywords) ? t.keywords.map((k: string) => k.toLowerCase().trim()).filter(Boolean) : [],
    })) : []
    return NextResponse.json({ topics })
  } catch (e: any) {
    return NextResponse.json({ error: 'AI error: ' + (e.message || 'unknown') }, { status: 500 })
  }
}
