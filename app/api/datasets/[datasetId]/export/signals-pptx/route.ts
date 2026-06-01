// app/api/datasets/[datasetId]/export/signals-pptx/route.ts
// POST — generate a signal-tier analysis PPTX for Reddit/Substack datasets.
// Slides: overview KPIs, tier distribution, per-tier quotes, theme×tier cross-tab, AI insights.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'
import { injectSignalTier, SIGNAL_TIER_ORDER_REDDIT, SIGNAL_TIER_ORDER_SUBSTACK } from '@/lib/signalTier'
import { buildKwRegex } from '@/lib/themeUtils'
import { renderDeck, type DeckSpec, type SlideSpec } from '@/lib/pptx/slideRenderer'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface Params { params: { datasetId: string } }

// Tier colors (without # prefix for PPTX)
const TIER_COLORS: Record<string, string> = {
  Mainstream: '059669', Controversial: 'D97706', Fringe: 'DC2626', Noise: '9CA3AF',
  Resonant: '059669', Discussed: 'D97706', 'Low Engagement': 'DC2626', Ignored: '9CA3AF',
}

export async function POST(req: Request, { params }: Params) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Cross-org gate: the dataset lookup uses the service role (bypasses RLS),
  // so any authed user could export another org's dataset by id without this.
  // Admin-org may export any (Phase E). Multi-tenancy invariant.
  const { orgId, isAdmin } = await getCallerOrgContext(supabase)

  const service = createServiceRoleClient()

  // Load dataset
  const { data: dataset } = await service
    .from('datasets').select('id, name, source, row_count, org_id').eq('id', params.datasetId).single()
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  if (!isAdmin && (dataset as any).org_id !== orgId) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })

  const source = dataset.source as string
  if (source !== 'reddit' && source !== 'substack') {
    return NextResponse.json({ error: 'Signal tiers only available for Reddit and Substack datasets' }, { status: 400 })
  }

  // Load themes
  const { data: stateRow } = await service
    .from('dataset_state').select('theme_model').eq('dataset_id', params.datasetId).single()
  const themes: { id: string; name: string; keywords: string[] }[] = (stateRow?.theme_model as any)?.themes || []

  // Fetch rows — collections union from member datasets (cap at 10K)
  const allRows: Record<string, any>[] = []
  const FLAT_PAGE = 1000

  let flatDatasetIds: string[] = [params.datasetId]
  if (dataset.source === 'collection') {
    const { data: col } = await service.from('collections').select('id').eq('dataset_id', params.datasetId).single()
    if (col) {
      const { data: members } = await service.from('collection_members').select('dataset_id').eq('collection_id', col.id).order('sort_order', { ascending: true })
      if (members && members.length > 0) flatDatasetIds = members.map(m => m.dataset_id)
    }
  }

  for (const dsId of flatDatasetIds) {
    let offset = 0
    while (allRows.length < 10000) {
      const { data: flatRows } = await service
        .from('dataset_rows_flat').select('data')
        .eq('dataset_id', dsId)
        .order('row_index', { ascending: true })
        .range(offset, offset + FLAT_PAGE - 1)
      if (!flatRows || flatRows.length === 0) break
      for (const fr of flatRows) allRows.push((fr as any).data || fr)
      if (flatRows.length < FLAT_PAGE) break
      offset += FLAT_PAGE
    }
    if (allRows.length >= 10000) break
  }

  if (allRows.length === 0) {
    return NextResponse.json({ error: 'No rows found' }, { status: 400 })
  }

  // Inject signal tiers
  const rows = injectSignalTier(allRows, source)
  const tierOrder = source === 'reddit' ? SIGNAL_TIER_ORDER_REDDIT : SIGNAL_TIER_ORDER_SUBSTACK
  const textField = source === 'reddit' ? 'body' : 'body'
  const scoreField = source === 'reddit' ? 'score' : 'likes'
  const groupField = source === 'reddit' ? 'thread_title' : 'post_title'

  // Count per tier
  const tierCounts: Record<string, number> = {}
  const tierRows: Record<string, Record<string, any>[]> = {}
  for (const t of tierOrder) { tierCounts[t] = 0; tierRows[t] = [] }
  for (const r of rows) {
    const tier = String(r.signal_tier)
    if (tierCounts[tier] !== undefined) {
      tierCounts[tier]++
      tierRows[tier].push(r)
    }
  }
  const total = rows.length

  // Pick top quotes per tier (by score, max 4 per tier)
  function topQuotes(tierName: string, max: number): { text: string; attribution?: string }[] {
    const sorted = [...tierRows[tierName]].sort((a, b) => Math.abs(Number(b[scoreField]) || 0) - Math.abs(Number(a[scoreField]) || 0))
    const quotes: { text: string; attribution?: string }[] = []
    for (const r of sorted) {
      const txt = String(r[textField] || '').trim()
      if (txt.length < 20) continue
      const score = Number(r[scoreField]) || 0
      const group = String(r[groupField] || '').slice(0, 60)
      quotes.push({
        text: txt.length > 300 ? txt.slice(0, 297) + '...' : txt,
        attribution: group + (score ? ' (' + scoreField + ': ' + score + ')' : ''),
      })
      if (quotes.length >= max) break
    }
    return quotes
  }

  // Theme × tier cross-tab
  const themeTierCounts: { theme: string; tiers: Record<string, number> }[] = []
  for (const theme of themes.slice(0, 8)) {
    const kws = theme.keywords || []
    if (kws.length === 0) continue
    // Build combined regex from all keywords
    const parts = kws.map((kw: string) => { try { return buildKwRegex(kw).source } catch { return null } }).filter(Boolean)
    if (parts.length === 0) continue
    const regex = new RegExp(parts.join('|'), 'i')
    const tiers: Record<string, number> = {}
    for (const t of tierOrder) tiers[t] = 0
    for (const r of rows) {
      const txt = String(r[textField] || '')
      if (regex.test(txt)) {
        const tier = String(r.signal_tier)
        if (tiers[tier] !== undefined) tiers[tier]++
      }
    }
    const totalMentions = Object.values(tiers).reduce((s, v) => s + v, 0)
    if (totalMentions > 0) {
      themeTierCounts.push({ theme: theme.name, tiers })
    }
  }

  // Build slides
  const slides: SlideSpec[] = []

  // 1. Overview KPIs
  const topTier = tierOrder[0]
  const bottomTier = tierOrder[tierOrder.length - 1]
  slides.push({
    type: 'kpi_grid',
    title: 'Signal Tier Overview',
    subtitle: source === 'reddit' ? 'Reddit engagement classification by community voting patterns' : 'Substack engagement classification by reader endorsement patterns',
    kpis: [
      { value: total.toLocaleString(), label: 'Total Comments', sub: dataset.name, color: '0D2B45' },
      { value: tierCounts[topTier].toLocaleString(), label: topTier, sub: Math.round(tierCounts[topTier] / total * 100) + '% of total', color: TIER_COLORS[topTier] },
      { value: tierCounts[tierOrder[1]].toLocaleString(), label: tierOrder[1], sub: Math.round(tierCounts[tierOrder[1]] / total * 100) + '% of total', color: TIER_COLORS[tierOrder[1]] },
      { value: tierCounts[tierOrder[2]].toLocaleString(), label: tierOrder[2], sub: Math.round(tierCounts[tierOrder[2]] / total * 100) + '% of total', color: TIER_COLORS[tierOrder[2]] },
      { value: tierCounts[bottomTier].toLocaleString(), label: bottomTier, sub: Math.round(tierCounts[bottomTier] / total * 100) + '% of total', color: TIER_COLORS[bottomTier] },
    ],
  })

  // 2. Tier distribution bar chart
  slides.push({
    type: 'bar_chart',
    title: 'Signal Tier Distribution',
    subtitle: 'Comments classified by ' + (source === 'reddit' ? 'community vote score' : 'reader likes') + ' within each thread',
    data: tierOrder.map(t => ({ label: t, value: tierCounts[t], color: TIER_COLORS[t] })),
    insight: source === 'reddit'
      ? 'Mainstream comments represent community consensus. Controversial signals debate. Fringe captures actively rejected perspectives. Noise is low-signal content.'
      : 'Resonant comments represent strong reader endorsement. Discussed signals active conversation. Low Engagement has minimal traction. Ignored receives no interaction.',
  })

  // 3. Per-tier quote slides (top 2 tiers get their own slides)
  for (const tier of tierOrder.slice(0, 3)) {
    const quotes = topQuotes(tier, 4)
    if (quotes.length > 0) {
      slides.push({
        type: 'quotes',
        title: tier + ' — Representative Comments',
        subtitle: tierCounts[tier].toLocaleString() + ' comments (' + Math.round(tierCounts[tier] / total * 100) + '%)',
        quotes,
      })
    }
  }

  // 4. Theme × Tier cross-tab (if themes exist)
  if (themeTierCounts.length > 0) {
    slides.push({
      type: 'table',
      title: 'Themes by Signal Tier',
      subtitle: 'How themes distribute across engagement levels',
      columns: ['Theme', ...tierOrder],
      rows: themeTierCounts.map(tc => [
        tc.theme,
        ...tierOrder.map(t => {
          const n = tc.tiers[t]
          const themeTotal = Object.values(tc.tiers).reduce((s, v) => s + v, 0)
          return n + ' (' + Math.round(n / themeTotal * 100) + '%)'
        }),
      ]),
    })
  }

  // 5. AI-generated strategic insights
  const tierSummary = tierOrder.map(t =>
    t + ': ' + tierCounts[t] + ' (' + Math.round(tierCounts[t] / total * 100) + '%)'
  ).join(', ')

  // Sample top quotes for AI context
  const aiSamples = tierOrder.map(t => {
    const qs = topQuotes(t, 2)
    return t + ':\n' + qs.map(q => '  "' + q.text.slice(0, 150) + '"').join('\n')
  }).join('\n\n')

  try {
    const aiResult = await callAI({
      tier: 'fast',
      maxTokens: 600,
      timeoutMs: 20000,
      system: 'You are a research analyst writing 4-5 concise strategic bullet points about a ' + source + ' dataset\'s signal tier distribution. Each bullet should be one sentence — an actionable insight, not a restatement of numbers. Focus on what the distribution reveals about community sentiment, what the high-signal content tells us, and what organizations should pay attention to.',
      messages: [{ role: 'user', content: 'Dataset: ' + dataset.name + '\nDistribution: ' + tierSummary + '\n\nSample comments:\n' + aiSamples }],
    })

    logUsage({ resource_type: 'dataset', resource_id: params.datasetId, event_type: 'signals_pptx' }, aiResult.usage)

    const bullets = aiResult.text.split('\n')
      .map(l => l.replace(/^[-•*]\s*/, '').replace(/^\d+\.\s*/, '').trim())
      .filter(l => l.length > 10)
      .slice(0, 5)

    if (bullets.length > 0) {
      slides.push({
        type: 'bullets',
        title: 'Strategic Insights',
        subtitle: 'AI-generated analysis of signal distribution',
        bullets,
      })
    }
  } catch {
    // Skip AI slide if it fails
  }

  // 6. Methodology slide
  slides.push({
    type: 'two_column',
    title: 'Signal Tier Methodology',
    subtitle: 'How tiers are computed',
    left: {
      heading: source === 'reddit' ? 'Reddit Tiers' : 'Substack Tiers',
      bullets: source === 'reddit' ? [
        'Mainstream: Top 30% by vote score within each thread',
        'Controversial: Middle 40% by vote score',
        'Fringe: Negative net score (actively downvoted)',
        'Noise: Bottom 30% with non-negative score',
      ] : [
        'Resonant: Top 30% by likes within each post',
        'Discussed: Middle 40% by likes OR 3+ replies',
        'Low Engagement: Below 30th percentile with some activity',
        'Ignored: Zero likes and zero replies',
      ],
    },
    right: {
      heading: 'Key Principles',
      bullets: [
        'Percentiles computed within each thread/post, not globally',
        'Prevents high-traffic threads from dominating',
        'Every thread has its own signal distribution',
        'Tier assignment is relative to conversation context',
      ],
    },
  })

  const deck: DeckSpec = {
    title: 'Signal Tier Analysis',
    subtitle: dataset.name + ' — ' + (source === 'reddit' ? 'Reddit' : 'Substack') + ' Signal Classification',
    slides,
  }

  const buffer = await renderDeck(deck, dataset.name)

  // Write to ~/Downloads
  const fileName = dataset.name.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_') + '_Signal_Tiers.pptx'
  const downloadPath = require('path').join(require('os').homedir(), 'Downloads', fileName)
  require('fs').writeFileSync(downloadPath, buffer)

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': 'attachment; filename="' + fileName + '"',
    },
  })
}
