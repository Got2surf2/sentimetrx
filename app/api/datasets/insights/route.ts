// app/api/datasets/insights/route.ts
// AI Insights endpoint — proxies user's API key to Anthropic for statistical storytelling.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  // Auth check — require logged-in user
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { apiKey, prompt } = body

  if (!apiKey || !prompt) {
    return NextResponse.json({ error: 'Missing apiKey or prompt' }, { status: 400 })
  }

  // Cap prompt size to prevent abuse
  if (typeof prompt === 'string' && prompt.length > 100_000) {
    return NextResponse.json({ error: 'Prompt too large' }, { status: 400 })
  }

  try {
    let result
    try {
      result = await callAI({
        tier: 'standard',
        maxTokens: 1500,
        system: 'You are an organizational insights storyteller. Write clear, direct narratives for non-statisticians. No jargon. No bullet points unless separating field sections.',
        messages: [{ role: 'user', content: prompt }],
        apiKey,
      })
    } catch (e: any) {
      const status = e.status || 500
      if (status === 401) return NextResponse.json({ error: 'AUTH_ERROR: ' + e.message }, { status: 401 })
      if (status === 429) return NextResponse.json({ error: 'QUOTA_ERROR: ' + e.message }, { status: 429 })
      return NextResponse.json({ error: e.message }, { status })
    }

    logUsage({ resource_type: 'dataset', event_type: 'insights' }, result.usage)

    return NextResponse.json({ text: result.text })
  } catch (e: unknown) {
    return NextResponse.json({ error: 'Failed to call AI: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 })
  }
}
