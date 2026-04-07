// app/api/datasets/insights/route.ts
// AI Insights endpoint — proxies user's API key to Anthropic for statistical storytelling.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
        system: 'You are an organizational insights storyteller. Write clear, direct narratives for non-statisticians. No jargon. No bullet points unless separating field sections.',
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      const errMsg = data.error?.message || 'API error'
      if (res.status === 401) return NextResponse.json({ error: 'AUTH_ERROR: ' + errMsg }, { status: 401 })
      if (res.status === 429) return NextResponse.json({ error: 'QUOTA_ERROR: ' + errMsg }, { status: 429 })
      return NextResponse.json({ error: errMsg }, { status: res.status })
    }

    const text = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
    return NextResponse.json({ text })
  } catch (e: unknown) {
    return NextResponse.json({ error: 'Failed to call AI: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 })
  }
}
