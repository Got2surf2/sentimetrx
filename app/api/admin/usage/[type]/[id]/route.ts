// app/api/admin/usage/[type]/[id]/route.ts
// GET — usage detail for a single (resource_type, resource_id).
// Returns: totals, by_event, by_model, daily_trend, resource_name, org_name.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { estimateCost } from '@/lib/usageLog'
import { requireAdmin } from '@/lib/auth/requireAdmin'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const VALID_TYPES = new Set(['bot', 'townhall', 'social', 'dataset', 'study', 'system'])

export async function GET(req: NextRequest, props: { params: Promise<{ type: string; id: string }> }) {
  const params = await props.params;
  const denied = await requireAdmin()
  if (denied) return denied

  if (!VALID_TYPES.has(params.type)) {
    return NextResponse.json({ error: 'Invalid resource_type' }, { status: 400 })
  }

  const service = createServiceRoleClient()
  const fromParam = req.nextUrl.searchParams.get('from')
  const toParam   = req.nextUrl.searchParams.get('to')

  // `from`/`to` (YYYY-MM-DD) take precedence over `days`. `to` is inclusive (end of day).
  let since: string
  let until: string | null = null
  let days: number
  if (fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam)) {
    since = new Date(fromParam + 'T00:00:00Z').toISOString()
    if (toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
      until = new Date(new Date(toParam + 'T00:00:00Z').getTime() + 86400000).toISOString()
    }
    const sinceMs = new Date(since).getTime()
    const untilMs = until ? new Date(until).getTime() : Date.now()
    days = Math.max(1, Math.round((untilMs - sinceMs) / 86400000))
  } else {
    days = parseInt(req.nextUrl.searchParams.get('days') || '30')
    since = new Date(Date.now() - days * 86400000).toISOString()
  }

  let logsQuery = service
    .from('usage_logs')
    .select('org_id, event_type, model, tier, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, created_at')
    .eq('resource_type', params.type)
    .eq('resource_id', params.id)
    .gte('created_at', since)
  if (until) logsQuery = logsQuery.lt('created_at', until)
  const { data: logs } = await logsQuery
    .order('created_at', { ascending: false })
    .limit(50000)

  const rows = logs || []

  var byEvent: Record<string, { calls: number; input: number; output: number; cost: number }> = {}
  var byModel: Record<string, { calls: number; input: number; output: number; cost: number }> = {}
  var byDay: Record<string, { calls: number; cost: number }> = {}
  var orgIdSeen: string | null = null

  var totalCost = 0
  var totalInput = 0
  var totalOutput = 0

  for (var r of rows) {
    if (!orgIdSeen && r.org_id) orgIdSeen = r.org_id
    var cost = estimateCost(r.model, r.input_tokens, r.output_tokens, r.cache_read_tokens)
    totalCost  += cost
    totalInput  += r.input_tokens
    totalOutput += r.output_tokens

    if (!byEvent[r.event_type]) byEvent[r.event_type] = { calls: 0, input: 0, output: 0, cost: 0 }
    byEvent[r.event_type].calls++
    byEvent[r.event_type].input  += r.input_tokens
    byEvent[r.event_type].output += r.output_tokens
    byEvent[r.event_type].cost   += cost

    if (!byModel[r.model]) byModel[r.model] = { calls: 0, input: 0, output: 0, cost: 0 }
    byModel[r.model].calls++
    byModel[r.model].input  += r.input_tokens
    byModel[r.model].output += r.output_tokens
    byModel[r.model].cost   += cost

    var day = r.created_at.slice(0, 10)
    if (!byDay[day]) byDay[day] = { calls: 0, cost: 0 }
    byDay[day].calls++
    byDay[day].cost += cost
  }

  // Resolve resource + org names
  var resourceName: string = params.id.slice(0, 8)
  var resourceHref: string | undefined
  if (params.type === 'bot') {
    var { data: bot } = await service.from('agents').select('name, slug').eq('id', params.id).maybeSingle()
    if (bot?.name) resourceName = bot.name
    if (bot?.slug) resourceHref = '/bots/' + params.id
  } else if (params.type === 'townhall') {
    var { data: th } = await service.from('pulseiq_sessions').select('name').eq('id', params.id).maybeSingle()
    if (th?.name) resourceName = th.name
  } else if (params.type === 'study') {
    var { data: st } = await service.from('studies').select('name, id').eq('id', params.id).maybeSingle()
    if (st?.name) resourceName = st.name
    if (st?.id)   resourceHref = '/studies/' + params.id
  } else if (params.type === 'dataset') {
    var { data: ds } = await service.from('datasets').select('name').eq('id', params.id).maybeSingle()
    if (ds?.name) resourceName = ds.name
    resourceHref = '/analyze/' + params.id
  }

  var orgName: string | null = null
  if (orgIdSeen) {
    var { data: org } = await service.from('organizations').select('name').eq('id', orgIdSeen).maybeSingle()
    if (org?.name) orgName = org.name
  }

  var dailyTrend = Object.entries(byDay).sort().map(function(e) { return { date: e[0], ...e[1] } })

  function rc(n: number) { return Math.round(n * 10000) / 10000 }

  return NextResponse.json({
    period: { days, since, until },
    resource: {
      type: params.type,
      id:   params.id,
      name: resourceName,
      href: resourceHref || null,
    },
    org: orgIdSeen ? { id: orgIdSeen, name: orgName } : null,
    totals: { calls: rows.length, input_tokens: totalInput, output_tokens: totalOutput, cost: rc(totalCost) },
    by_event:    Object.fromEntries(Object.entries(byEvent).map(function(e) { return [e[0], { ...e[1], cost: rc(e[1].cost) }] })),
    by_model:    Object.fromEntries(Object.entries(byModel).map(function(e) { return [e[0], { ...e[1], cost: rc(e[1].cost) }] })),
    daily_trend: dailyTrend.map(function(d) { return { ...d, cost: rc(d.cost) } }),
  })
}
