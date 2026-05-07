// app/api/townhall/expand-terms/route.ts
// POST — Expand a term into similar (lemma/word forms) or associated (semantic) terms

import { NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

export async function POST(req: Request) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { term, mode, context } = body
  if (!term?.trim()) return NextResponse.json({ error: 'Missing term' }, { status: 400 })
  if (!['similar', 'associated'].includes(mode)) return NextResponse.json({ error: 'Mode must be similar or associated' }, { status: 400 })

  const cleanTerm = term.trim().toLowerCase()

  const prompt = mode === 'similar'
    ? `For the word/phrase "${cleanTerm}", list all morphological variants (lemmas, inflections, tenses, plurals, gerunds, etc.).

Example: "immigration" → immigrants, immigrate, immigrating, immigrated, immigrant, immigrations

Only include word forms of the SAME root word. Do NOT include synonyms or related concepts.
All lowercase. Return ONLY a JSON array:
["form1","form2","form3"]`
    : `For the word/phrase "${cleanTerm}", list 6-12 closely associated terms — synonyms, related concepts, and words people commonly use when discussing this topic.
${context ? `\nContext: ${context}` : ''}

Example: "immigration" → border, undocumented, deportation, asylum, visa, refugee, migrant, citizenship, green card

Do NOT include word forms of "${cleanTerm}" itself (no plurals, tenses, etc.). Only semantically related terms.
All lowercase. Return ONLY a JSON array:
["term1","term2","term3"]`

  try {
    const result = await callAI({
      tier: 'fast',
      maxTokens: 300,
      timeoutMs: 5000,
      system: 'Return ONLY raw JSON — no markdown, no backticks.',
      messages: [{ role: 'user', content: prompt }],
    })
    logUsage({ resource_type: 'townhall', event_type: 'expand_terms' }, result.usage)
    const raw = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    const terms = JSON.parse(raw)
    return NextResponse.json({
      terms: Array.isArray(terms) ? terms.map((t: string) => t.toLowerCase().trim()).filter(Boolean) : [],
    })
  } catch {
    return NextResponse.json({ terms: [] })
  }
}
