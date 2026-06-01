// app/api/townhall/suggest-sensitive/route.ts
// POST — AI suggests sensitive/forbidden topics based on description + industry
// Also handles fan-out: expanding a single term into related sub-terms

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
  const { description, industry, org_name, fan_term, existing } = body

  // Fan-out mode: expand a single term into sub-terms
  if (fan_term?.trim()) {
    const prompt = `Expand the sensitive topic "${fan_term.trim()}" into 6-12 specific sub-terms, synonyms, and related concepts that an AI moderator should avoid asking about.

Include: direct synonyms, informal/slang variants, closely related sub-topics, and terms that would steer the conversation into this sensitive area.

All lowercase. Return ONLY a JSON array of strings:
["term1","term2","term3"]`

    try {
      const result = await callAI({
        tier: 'fast',
        maxTokens: 300,
        timeoutMs: 5000,
        system: 'Return ONLY raw JSON — no markdown, no backticks.',
        messages: [{ role: 'user', content: prompt }],
      })
      logUsage({ resource_type: 'townhall', event_type: 'suggest_sensitive' }, result.usage)
      const raw = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
      const terms = JSON.parse(raw)
      return NextResponse.json({ terms: Array.isArray(terms) ? terms.map((t: string) => t.toLowerCase().trim()).filter(Boolean) : [] })
    } catch {
      return NextResponse.json({ terms: [fan_term.trim().toLowerCase()] })
    }
  }

  // Suggest mode: AI recommends sensitive topics based on context
  if (!description?.trim() && !industry) {
    return NextResponse.json({ error: 'Need a description or industry to suggest sensitive topics' }, { status: 400 })
  }

  const existingList = Array.isArray(existing) && existing.length > 0
    ? '\n\nALREADY LISTED (do not repeat): ' + existing.join(', ')
    : ''

  const prompt = `You are a qualitative research expert setting up a PulseIQ discussion. Identify topics that an AI moderator should NEVER bring up or ask about — topics that could make participants uncomfortable, create liability, or derail the discussion.
${industry ? `\nIndustry: ${industry.replace(/_/g, ' ')}` : ''}
${org_name ? `\nOrganization: ${org_name}` : ''}
${description ? `\nEvent description: "${description.trim()}"` : ''}${existingList}

Return 4-8 categories of sensitive topics. For each category, provide the category name and 4-8 specific terms (pre-expanded with synonyms and related concepts, all lowercase).

Return ONLY valid JSON:
{"categories":[{"name":"Category Name","terms":["term1","term2","term3"]}]}`

  try {
    const result = await callAI({
      tier: 'standard',
      maxTokens: 2000,
      timeoutMs: 10000,
      system: 'You are a qualitative research expert. Return ONLY raw JSON — no markdown, no backticks.',
      messages: [{ role: 'user', content: prompt }],
    })
    logUsage({ resource_type: 'townhall', event_type: 'suggest_sensitive' }, result.usage)
    const raw = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    const parsed = JSON.parse(raw)
    const categories = Array.isArray(parsed.categories) ? parsed.categories.map((c: any) => ({
      name: c.name || 'Other',
      terms: Array.isArray(c.terms) ? c.terms.map((t: string) => t.toLowerCase().trim()).filter(Boolean) : [],
    })) : []
    return NextResponse.json({ categories })
  } catch (e: any) {
    return NextResponse.json({ error: 'AI error: ' + (e.message || 'unknown') }, { status: 500 })
  }
}
