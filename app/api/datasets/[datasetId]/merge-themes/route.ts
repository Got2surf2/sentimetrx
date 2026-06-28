// app/api/datasets/[datasetId]/merge-themes/route.ts
// POST — merge per-member theme sets for collections.
// Uses AI to identify shared vs unique themes across member datasets.
//
// Body: { apiKey, memberThemes: [{ label, themes }] }
// Returns: { themes: [...], summary }
//   Each theme has: memberLabels (string[] — which members have it)
//   Unique themes have 1 label, shared themes have 2+.

import { NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

interface Props { params: Promise<{ datasetId: string }> }

export async function POST(request: Request, props: Props) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: dataset } = await supabase
    .from('datasets')
    .select('id, source, org_id')
    .eq('id', params.datasetId)
    .single()
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })

  let body: {
    apiKey?: string
    memberThemes?: { label: string; themes: { name: string; keywords: string[]; description?: string; sentiment?: string }[] }[]
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { apiKey, memberThemes } = body
  // No NO_API_KEY rejection — callAI() falls back to the platform ANTHROPIC_API_KEY
  // when body.apiKey is empty, so a customer org can merge member themes without
  // bringing its own key (usage is logged per-org below for billing/cap). This
  // matches mine-themes; the stale gate here blocked the collection theme-merge
  // ("import component topics") for anyone without a personal key.
  if (!memberThemes || memberThemes.length < 2) {
    return NextResponse.json({ error: 'Need themes from at least 2 members' }, { status: 400 })
  }

  // Build prompt listing each member's themes
  var memberSummary = memberThemes.map(function(m) {
    var themeList = m.themes.map(function(t) {
      return '  - ' + t.name + ' (keywords: ' + t.keywords.slice(0, 8).join(', ') + ')'
    }).join('\n')
    return '### ' + m.label + '\n' + themeList
  }).join('\n\n')

  var allLabels = memberThemes.map(function(m) { return m.label })

  const systemPrompt =
    'You are a qualitative research expert specializing in comparative analysis. Return ONLY raw JSON -- no markdown, no backticks. Start with { and end with }.'

  const userMsg =
    'I have themes mined separately from ' + memberThemes.length + ' datasets in a collection (' + allLabels.join(', ') + ').\n\n' +
    memberSummary + '\n\n' +
    'Merge these into a unified theme list. For each theme:\n' +
    '1. If the same concept appears in multiple members (even with different names/keywords), merge into one theme and list ALL member labels in "memberLabels"\n' +
    '2. If a theme is unique to one member, keep it and set "memberLabels" to just that one label\n' +
    '3. Combine keywords from matching themes across members\n' +
    '4. Use the best/clearest name for merged themes\n\n' +
    'Return:\n' +
    '{"themes":[{"id":"t1","name":"Theme Name","description":"One sentence.",' +
    '"keywords":["keyword1","keyword2",...],' +
    '"sentiment":"positive|negative|neutral|mixed",' +
    '"memberLabels":["' + allLabels[0] + '","' + allLabels[1] + '"],' +
    '"count":0,"percentage":0}],' +
    '"summary":"2-3 sentences comparing the datasets."}'

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

    logUsage({ org_id: (dataset as any).org_id ?? undefined, resource_type: 'dataset', resource_id: params.datasetId, event_type: 'merge_themes' }, result.usage)

    const clean = result.text.replace(/^```json\s*/i, '').replace(/```\s*$/g, '').trim()
    let parsed: { themes?: unknown[]; summary?: string }
    try {
      parsed = JSON.parse(clean)
    } catch {
      return NextResponse.json({ error: 'Could not parse merged themes from AI response' }, { status: 500 })
    }

    if (!parsed || !Array.isArray(parsed.themes) || !parsed.themes.length) {
      return NextResponse.json({ error: 'AI returned no merged themes' }, { status: 500 })
    }

    return NextResponse.json(parsed)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
