// app/api/datasets/[datasetId]/mine-themes/route.ts
// Proxies Claude AI theme mining.
// User provides their own API key -- stored only in their browser, passed per-request.
// Proprietary system prompt stays server-side and never reaches the browser.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface Props { params: { datasetId: string } }

export async function POST(request: Request, { params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Check dataset access (RLS will enforce org membership)
  const { data: dataset } = await supabase
    .from('datasets')
    .select('id')
    .eq('id', params.datasetId)
    .single()
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })

  let body: {
    apiKey?: string
    texts?: string[]
    fieldName?: string
    schemaCtx?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { apiKey, texts, fieldName, schemaCtx } = body

  if (!apiKey || typeof apiKey !== 'string') {
    return NextResponse.json({ error: 'NO_API_KEY' }, { status: 400 })
  }
  if (!texts || !texts.length) {
    return NextResponse.json({ error: 'No text provided' }, { status: 400 })
  }

  // Proprietary prompt -- never sent to browser
  const systemPrompt =
    'You are a qualitative research expert. Return ONLY raw JSON -- no markdown, no backticks. Start with { and end with }.'

  const corpusText = texts.map(function(t, i) { return (i + 1) + '. ' + t }).join('\n')
  const fieldLabel = fieldName || 'responses'
  const schemaLine = schemaCtx ? '\n\nSchema: ' + schemaCtx : ''
  const userMsg =
    'Thematic analysis on ' + texts.length + ' responses for field \'' + fieldLabel + '\'.' +
    schemaLine + '\n\nResponses:\n' + corpusText +
    '\n\nIdentify 4-7 distinct themes. Return:\n' +
    '{"themes":[{"id":"t1","name":"Name","description":"One sentence.",' +
    '"keywords":["k1","k2","k3"],"sentiment":"positive","count":0,"percentage":0,"relatedThemes":[]}],' +
    '"summary":"2-3 sentences.","fieldName":"' + fieldLabel + '"}'

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
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }],
      }),
    })

    if (!res.ok) {
      let errMsg = 'Unknown error'
      try {
        const errData = await res.json()
        errMsg = errData?.error?.message || errMsg
      } catch { /* ignore */ }
      if (res.status === 401) return NextResponse.json({ error: 'AUTH_ERROR: ' + errMsg }, { status: 401 })
      if (res.status === 429) return NextResponse.json({ error: 'QUOTA_ERROR: ' + errMsg }, { status: 429 })
      return NextResponse.json({ error: 'API_' + res.status + ': ' + errMsg }, { status: res.status })
    }

    const data = await res.json()
    const rawText = (data.content || []).map(function(b: { text?: string }) {
      return b.text || ''
    }).join('')

    const clean = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/g, '').trim()
    let parsed: { themes?: unknown[]; summary?: string; fieldName?: string }
    try {
      parsed = JSON.parse(clean)
    } catch {
      return NextResponse.json({ error: 'Could not parse themes from AI response' }, { status: 500 })
    }

    if (!parsed || !Array.isArray(parsed.themes) || !parsed.themes.length) {
      return NextResponse.json({ error: 'AI returned no themes' }, { status: 500 })
    }

    return NextResponse.json(parsed)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
