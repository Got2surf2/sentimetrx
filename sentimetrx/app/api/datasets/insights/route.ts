// app/api/datasets/insights/route.ts
// AI Insights endpoint — proxies user's API key to Anthropic for statistical storytelling.

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  var body = await req.json()
  var { apiKey, prompt } = body

  if (!apiKey || !prompt) {
    return NextResponse.json({ error: 'Missing apiKey or prompt' }, { status: 400 })
  }

  try {
    var res = await fetch('https://api.anthropic.com/v1/messages', {
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

    var data = await res.json()

    if (!res.ok) {
      var errMsg = data.error?.message || 'API error'
      if (res.status === 401) return NextResponse.json({ error: 'AUTH_ERROR: ' + errMsg }, { status: 401 })
      if (res.status === 429) return NextResponse.json({ error: 'QUOTA_ERROR: ' + errMsg }, { status: 429 })
      return NextResponse.json({ error: errMsg }, { status: res.status })
    }

    var text = (data.content || []).filter(function(b: any) { return b.type === 'text' }).map(function(b: any) { return b.text }).join('\n')
    return NextResponse.json({ text: text })
  } catch (e: unknown) {
    return NextResponse.json({ error: 'Failed to call AI: ' + (e instanceof Error ? e.message : String(e)) }, { status: 500 })
  }
}
