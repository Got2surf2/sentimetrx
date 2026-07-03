// app/api/admin/usage/route.ts
// GET — aggregated usage stats for admin dashboard

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { estimateCost } from '@/lib/usageLog'
import { requireAdmin } from '@/lib/auth/requireAdmin'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

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

  // Fetch all usage logs in range
  let logsQuery = service
    .from('usage_logs')
    .select('org_id, resource_type, resource_id, event_type, model, tier, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_cents, created_at')
    .gte('created_at', since)
  if (until) logsQuery = logsQuery.lt('created_at', until)
  const { data: logs } = await logsQuery
    .order('created_at', { ascending: false })
    .limit(10000)

  const rows = logs || []

  // Aggregate by resource_type
  var byType: Record<string, { calls: number; input: number; output: number; cache_read: number; cost: number }> = {}
  // Aggregate by event_type
  var byEvent: Record<string, { calls: number; input: number; output: number; cost: number }> = {}
  // Aggregate by model
  var byModel: Record<string, { calls: number; input: number; output: number; cost: number }> = {}
  // Aggregate by day
  var byDay: Record<string, { calls: number; cost: number }> = {}
  // Per-resource breakdown
  var byResource: Record<string, { resource_type: string; resource_id: string; calls: number; input: number; output: number; cost: number }> = {}
  // Per-org breakdown (key is org_id; '' bucket holds rows with no org)
  var byOrg: Record<string, { org_id: string; calls: number; input: number; output: number; cost: number }> = {}

  var totalCost = 0
  var totalCalls = rows.length
  var totalInput = 0
  var totalOutput = 0

  for (var r of rows) {
    // Token-derived cost, plus any flat cost (e.g. ASR transcription) stored on the row.
    var cost = estimateCost(r.model, r.input_tokens, r.output_tokens, r.cache_read_tokens) + ((r.cost_cents || 0) / 100)
    totalCost += cost
    totalInput += r.input_tokens
    totalOutput += r.output_tokens

    // By type
    if (!byType[r.resource_type]) byType[r.resource_type] = { calls: 0, input: 0, output: 0, cache_read: 0, cost: 0 }
    byType[r.resource_type].calls++
    byType[r.resource_type].input += r.input_tokens
    byType[r.resource_type].output += r.output_tokens
    byType[r.resource_type].cache_read += r.cache_read_tokens
    byType[r.resource_type].cost += cost

    // By event
    if (!byEvent[r.event_type]) byEvent[r.event_type] = { calls: 0, input: 0, output: 0, cost: 0 }
    byEvent[r.event_type].calls++
    byEvent[r.event_type].input += r.input_tokens
    byEvent[r.event_type].output += r.output_tokens
    byEvent[r.event_type].cost += cost

    // By model
    if (!byModel[r.model]) byModel[r.model] = { calls: 0, input: 0, output: 0, cost: 0 }
    byModel[r.model].calls++
    byModel[r.model].input += r.input_tokens
    byModel[r.model].output += r.output_tokens
    byModel[r.model].cost += cost

    // By day
    var day = r.created_at.slice(0, 10)
    if (!byDay[day]) byDay[day] = { calls: 0, cost: 0 }
    byDay[day].calls++
    byDay[day].cost += cost

    // By resource
    if (r.resource_id) {
      var key = r.resource_type + ':' + r.resource_id
      if (!byResource[key]) byResource[key] = { resource_type: r.resource_type, resource_id: r.resource_id, calls: 0, input: 0, output: 0, cost: 0 }
      byResource[key].calls++
      byResource[key].input += r.input_tokens
      byResource[key].output += r.output_tokens
      byResource[key].cost += cost
    }

    // By org
    var orgKey = r.org_id || ''
    if (!byOrg[orgKey]) byOrg[orgKey] = { org_id: orgKey, calls: 0, input: 0, output: 0, cost: 0 }
    byOrg[orgKey].calls++
    byOrg[orgKey].input += r.input_tokens
    byOrg[orgKey].output += r.output_tokens
    byOrg[orgKey].cost += cost
  }

  // Sort by-day chronologically
  var dailyTrend = Object.entries(byDay).sort().map(function(e) { return { date: e[0], ...e[1] } })

  // All resources by cost (UI used to slice to 20 — now returns the full list and the client filters/exports)
  var topResources = Object.values(byResource).sort(function(a, b) { return b.cost - a.cost })

  // Resolve resource names
  var botIds = topResources.filter(function(r) { return r.resource_type === 'bot' }).map(function(r) { return r.resource_id })
  var sessionIds = topResources.filter(function(r) { return r.resource_type === 'townhall' }).map(function(r) { return r.resource_id })
  var studyIds = topResources.filter(function(r) { return r.resource_type === 'study' }).map(function(r) { return r.resource_id })
  var datasetIds = topResources.filter(function(r) { return r.resource_type === 'dataset' }).map(function(r) { return r.resource_id })

  var botNames: Record<string, string> = {}
  var sessionNames: Record<string, string> = {}
  var studyNames: Record<string, string> = {}
  var datasetNames: Record<string, string> = {}

  if (botIds.length > 0) {
    var { data: bots } = await service.from('agents').select('id, name').in('id', botIds)
    for (var b of bots || []) botNames[b.id] = b.name
  }
  if (sessionIds.length > 0) {
    var { data: sessions } = await service.from('pulseiq_sessions').select('id, name').in('id', sessionIds)
    for (var s of sessions || []) sessionNames[s.id] = s.name
  }
  if (studyIds.length > 0) {
    var { data: studies } = await service.from('studies').select('id, name').in('id', studyIds)
    for (var st of studies || []) studyNames[st.id] = st.name
  }
  if (datasetIds.length > 0) {
    var { data: datasets } = await service.from('datasets').select('id, name').in('id', datasetIds)
    for (var ds of datasets || []) datasetNames[ds.id] = ds.name
  }

  function nameFor(r: { resource_type: string; resource_id: string }): string {
    if (r.resource_type === 'bot') return botNames[r.resource_id] || r.resource_id.slice(0, 8)
    if (r.resource_type === 'townhall') return sessionNames[r.resource_id] || r.resource_id.slice(0, 8)
    if (r.resource_type === 'study') return studyNames[r.resource_id] || r.resource_id.slice(0, 8)
    if (r.resource_type === 'dataset') return datasetNames[r.resource_id] || r.resource_id.slice(0, 8)
    return r.resource_id.slice(0, 8)
  }

  var topResourcesNamed = topResources.map(function(r) {
    return { ...r, name: nameFor(r) }
  })

  // Resolve org names for per-org rollup
  var orgList = Object.values(byOrg).sort(function(a, b) { return b.cost - a.cost })
  var orgIds = orgList.map(function(o) { return o.org_id }).filter(Boolean)
  var orgNames: Record<string, string> = {}
  if (orgIds.length > 0) {
    var { data: orgsData } = await service.from('organizations').select('id, name').in('id', orgIds)
    for (var o of orgsData || []) orgNames[o.id] = o.name
  }
  var byOrgNamed = orgList.map(function(o) {
    return {
      org_id: o.org_id,
      name:   o.org_id ? (orgNames[o.org_id] || o.org_id.slice(0, 8)) : '(no org)',
      calls:  o.calls,
      input:  o.input,
      output: o.output,
      cost:   o.cost,
    }
  })

  // Round costs
  function rc(n: number) { return Math.round(n * 10000) / 10000 }

  return NextResponse.json({
    period: { days, since, until },
    totals: { calls: totalCalls, input_tokens: totalInput, output_tokens: totalOutput, cost: rc(totalCost) },
    by_type: Object.fromEntries(Object.entries(byType).map(function(e) { return [e[0], { ...e[1], cost: rc(e[1].cost) }] })),
    by_event: Object.fromEntries(Object.entries(byEvent).map(function(e) { return [e[0], { ...e[1], cost: rc(e[1].cost) }] })),
    by_model: Object.fromEntries(Object.entries(byModel).map(function(e) { return [e[0], { ...e[1], cost: rc(e[1].cost) }] })),
    daily_trend: dailyTrend.map(function(d) { return { ...d, cost: rc(d.cost) } }),
    top_resources: topResourcesNamed.map(function(r) { return { ...r, cost: rc(r.cost) } }),
    by_org: byOrgNamed.map(function(o) { return { ...o, cost: rc(o.cost) } }),
  })
}
