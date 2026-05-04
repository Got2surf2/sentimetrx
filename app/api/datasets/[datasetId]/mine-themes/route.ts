// app/api/datasets/[datasetId]/mine-themes/route.ts
// Proxies Claude AI theme mining.
// User provides their own API key -- stored only in their browser, passed per-request.
// Proprietary system prompt stays server-side and never reaches the browser.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

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
    '\n\nIdentify 4-7 distinct themes. For each theme, provide 8-15 keywords that include:\n' +
    '- Core terms that define the theme\n' +
    '- Common synonyms and related phrases respondents might use\n' +
    '- Informal/colloquial variants (e.g. "pricey" for expensive, "meh" for mediocre)\n' +
    '- Short phrases (2-3 words) where a single word is ambiguous\n\n' +
    'Return:\n' +
    '{"themes":[{"id":"t1","name":"Name","description":"One sentence.",' +
    '"keywords":["core term","synonym1","synonym2","informal variant","short phrase"],' +
    '"sentiment":"positive","count":0,"percentage":0,"relatedThemes":[]}],' +
    '"summary":"2-3 sentences.","fieldName":"' + fieldLabel + '"}'

  try {
    let result
    try {
      result = await callAI({
        tier: 'standard',
        maxTokens: 4000,
        timeoutMs: 60000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }],
        apiKey,
      })
    } catch (e: any) {
      const status = e.status || 500
      if (status === 401) return NextResponse.json({ error: 'AUTH_ERROR: ' + e.message }, { status: 401 })
      if (status === 429) return NextResponse.json({ error: 'QUOTA_ERROR: ' + e.message }, { status: 429 })
      return NextResponse.json({ error: 'API_' + status + ': ' + e.message }, { status })
    }

    logUsage({ resource_type: 'dataset', resource_id: params.datasetId, event_type: 'mine_themes' }, result.usage)

    const rawText = result.text

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
