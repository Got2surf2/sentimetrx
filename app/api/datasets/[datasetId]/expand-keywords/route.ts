// app/api/datasets/[datasetId]/expand-keywords/route.ts
// Given a theme name + initial keywords, returns an expanded keyword cluster
// using AI to add synonyms, colloquial variants, and related phrases.

import { NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'

interface Props { params: Promise<{ datasetId: string }> }

export async function POST(request: Request, props: Props) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { apiKey?: string; themeName?: string; keywords?: string[]; context?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { apiKey, themeName, keywords, context } = body

  if (!apiKey) return NextResponse.json({ error: 'NO_API_KEY' }, { status: 400 })
  if (!themeName || !keywords?.length) {
    return NextResponse.json({ error: 'Provide themeName and keywords' }, { status: 400 })
  }

  const systemPrompt = 'You are a qualitative research keyword expansion expert. Return ONLY a JSON array of strings — no markdown, no backticks, no explanation.'

  const userMsg = `Theme: "${themeName}"
Current keywords: ${JSON.stringify(keywords)}
${context ? `Context: ${context}` : ''}

Expand this keyword list to 12-20 terms. Include:
- All current keywords (keep them)
- Synonyms and near-synonyms
- Colloquial/informal variants people use in surveys (e.g. "pricey" for "expensive", "meh" for "mediocre")
- Common misspellings if relevant (e.g. "recieve" for "receive")
- 2-3 word phrases where a single word is too ambiguous
- Antonym-context phrases if the theme is sentiment-specific (e.g. for a "slow service" theme: "took forever", "long wait")

Do NOT include:
- Generic stop words
- Terms that would match unrelated themes
- More than 20 terms total

Return a flat JSON array: ["term1", "term2", ...]`

  try {
    let aiResult
    try {
      aiResult = await callAI({
        tier: 'fast',
        maxTokens: 500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }],
        apiKey,
      })
    } catch (e: any) {
      return NextResponse.json({ error: e.message || 'API error' }, { status: e.status || 500 })
    }

    logUsage({ resource_type: 'dataset', resource_id: params.datasetId, event_type: 'expand_keywords' }, aiResult.usage)

    const rawText = aiResult.text
    const clean = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/g, '').trim()

    let expanded: string[]
    try {
      expanded = JSON.parse(clean)
      if (!Array.isArray(expanded)) throw new Error('Not an array')
    } catch {
      return NextResponse.json({ error: 'Could not parse AI response' }, { status: 500 })
    }

    // Dedupe, lowercase, limit to 20
    const seen = new Set<string>()
    const deduped: string[] = []
    for (const kw of expanded) {
      const k = String(kw).toLowerCase().trim()
      if (k && !seen.has(k) && deduped.length < 20) {
        seen.add(k)
        deduped.push(k)
      }
    }

    return NextResponse.json({ keywords: deduped })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 })
  }
}
