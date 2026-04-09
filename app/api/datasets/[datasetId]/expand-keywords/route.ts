// app/api/datasets/[datasetId]/expand-keywords/route.ts
// Given a theme name + initial keywords, returns an expanded keyword cluster
// using AI to add synonyms, colloquial variants, and related phrases.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface Props { params: { datasetId: string } }

export async function POST(request: Request, { params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
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
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }],
      }),
    })

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}))
      const errMsg = (errData as any)?.error?.message || 'API error'
      return NextResponse.json({ error: errMsg }, { status: res.status })
    }

    const data = await res.json()
    const rawText = (data.content || []).map((b: any) => b.text || '').join('')
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
    const result: string[] = []
    for (const kw of expanded) {
      const k = String(kw).toLowerCase().trim()
      if (k && !seen.has(k) && result.length < 20) {
        seen.add(k)
        result.push(k)
      }
    }

    return NextResponse.json({ keywords: result })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 })
  }
}
