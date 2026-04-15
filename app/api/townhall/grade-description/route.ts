// app/api/townhall/grade-description/route.ts
// POST — AI grades the event description for completeness (1-5 scale)

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { callAI } from '@/lib/ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 10

export async function POST(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { description, industry } = body
  if (!description?.trim()) return NextResponse.json({ score: 0, suggestion: 'Add a description to help the AI moderate effectively.' })

  const prompt = `You are evaluating a town hall event description for completeness. The AI moderator uses this description to understand context, set tone, and guide the conversation.
${industry ? `\nIndustry: ${industry.replace(/_/g, ' ')}` : ''}

Description: "${description.trim()}"

Rate 1-5 on how well the description covers these criteria:
- WHO: Is the target audience defined? (employees, residents, patients, students, etc.)
- WHAT: Is the purpose/topic clear? (feedback on X, input for Y, discussion about Z)
- WHY: Is there a stated goal? (improve something, plan something, decide something)
- SCOPE: Are there boundaries? (time period, location, specific services/programs)
- CONTEXT: Is there enough background for an AI moderator to ask intelligent follow-ups?

Score guide:
1 = Too vague, AI will produce generic responses
2 = Missing several key elements
3 = Adequate but could be more specific
4 = Good — covers most elements
5 = Excellent — AI has everything it needs

Return ONLY valid JSON:
{"score":3,"suggestion":"One short sentence about the most impactful thing to add."}`

  try {
    const result = await callAI({
      tier: 'fast',
      maxTokens: 200,
      timeoutMs: 5000,
      system: 'Return ONLY raw JSON — no markdown, no backticks.',
      messages: [{ role: 'user', content: prompt }],
    })
    const raw = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    const parsed = JSON.parse(raw)
    return NextResponse.json({
      score: Math.max(1, Math.min(5, parsed.score || 1)),
      suggestion: parsed.suggestion || '',
    })
  } catch {
    return NextResponse.json({ score: 0, suggestion: '' })
  }
}
