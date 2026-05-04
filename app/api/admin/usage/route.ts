// app/api/admin/usage/route.ts
// GET — aggregated usage stats for admin dashboard

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { resolveOrg } from '@/lib/resolveOrg'
import { estimateCost } from '@/lib/usageLog'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations) as any
  if (!orgData?.is_admin_org) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const service = createServiceRoleClient()
  const days = parseInt(req.nextUrl.searchParams.get('days') || '30')
  const since = new Date(Date.now() - days * 86400000).toISOString()

  // Fetch all usage logs in range
  const { data: logs } = await service
    .from('usage_logs')
    .select('org_id, resource_type, resource_id, event_type, model, tier, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, created_at')
    .gte('created_at', since)
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

  var totalCost = 0
  var totalCalls = rows.length
  var totalInput = 0
  var totalOutput = 0

  for (var r of rows) {
    var cost = estimateCost(r.model, r.input_tokens, r.output_tokens, r.cache_read_tokens)
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
  }

  // Sort by-day chronologically
  var dailyTrend = Object.entries(byDay).sort().map(function(e) { return { date: e[0], ...e[1] } })

  // Top resources by cost
  var topResources = Object.values(byResource).sort(function(a, b) { return b.cost - a.cost }).slice(0, 20)

  // Resolve resource names
  var botIds = topResources.filter(function(r) { return r.resource_type === 'bot' }).map(function(r) { return r.resource_id })
  var sessionIds = topResources.filter(function(r) { return r.resource_type === 'townhall' }).map(function(r) { return r.resource_id })

  var botNames: Record<string, string> = {}
  var sessionNames: Record<string, string> = {}

  if (botIds.length > 0) {
    var { data: bots } = await service.from('bots').select('id, name').in('id', botIds)
    for (var b of bots || []) botNames[b.id] = b.name
  }
  if (sessionIds.length > 0) {
    var { data: sessions } = await service.from('townhall_sessions').select('id, name').in('id', sessionIds)
    for (var s of sessions || []) sessionNames[s.id] = s.name
  }

  var topResourcesNamed = topResources.map(function(r) {
    var name = r.resource_type === 'bot' ? botNames[r.resource_id] : r.resource_type === 'townhall' ? sessionNames[r.resource_id] : r.resource_id
    return { ...r, name: name || r.resource_id.slice(0, 8) }
  })

  // Round costs
  function rc(n: number) { return Math.round(n * 10000) / 10000 }

  return NextResponse.json({
    period: { days, since },
    totals: { calls: totalCalls, input_tokens: totalInput, output_tokens: totalOutput, cost: rc(totalCost) },
    by_type: Object.fromEntries(Object.entries(byType).map(function(e) { return [e[0], { ...e[1], cost: rc(e[1].cost) }] })),
    by_event: Object.fromEntries(Object.entries(byEvent).map(function(e) { return [e[0], { ...e[1], cost: rc(e[1].cost) }] })),
    by_model: Object.fromEntries(Object.entries(byModel).map(function(e) { return [e[0], { ...e[1], cost: rc(e[1].cost) }] })),
    daily_trend: dailyTrend.map(function(d) { return { ...d, cost: rc(d.cost) } }),
    top_resources: topResourcesNamed.map(function(r) { return { ...r, cost: rc(r.cost) } }),
  })
}
