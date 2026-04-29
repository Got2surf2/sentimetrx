import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

interface Params { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const authResult = await supabase.auth.getUser()
  if (!authResult.data.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url  = new URL(req.url)
  const from = url.searchParams.get('from')
  const to   = url.searchParams.get('to')

  // Verify study exists and user can access it
  const studyResult = await supabase
    .from('studies')
    .select('id, name, bot_name, bot_emoji, status, config')
    .eq('id', params.id)
    .single()

  if (studyResult.error || !studyResult.data) {
    return NextResponse.json({ error: 'Study not found' }, { status: 404 })
  }

  // Fetch ALL responses (including partial) — partial responses still have valid closed-end data
  let query = supabase
    .from('responses')
    .select('sentiment, nps_score, experience_score, completed_at, status')
    .eq('study_id', params.id)
    .order('completed_at', { ascending: true })
    .range(0, 49999)

  // Date filters: include rows with null completed_at (partials) alongside date-matched rows
  if (from && to) {
    query = query.or('and(completed_at.gte.' + from + ',completed_at.lte.' + to + 'T23:59:59Z),completed_at.is.null')
  } else if (from) {
    query = query.or('completed_at.gte.' + from + ',completed_at.is.null')
  } else if (to) {
    query = query.or('completed_at.lte.' + to + 'T23:59:59Z,completed_at.is.null')
  }

  const result = await query

  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })

  const rows = result.data || []

  const totalAll = rows.length
  const totalComplete = rows.filter(function(r) { return r.status === 'complete' || r.status == null }).length
  const total = totalAll

  // Support both old (promoter/passive/detractor) and new (positive/neutral/negative) sentiment values
  const promoters  = rows.filter(function(r) { return r.sentiment === 'positive'  || r.sentiment === 'promoter' }).length
  const passives   = rows.filter(function(r) { return r.sentiment === 'neutral'   || r.sentiment === 'passive' }).length
  const detractors = rows.filter(function(r) { return r.sentiment === 'negative'  || r.sentiment === 'detractor' }).length
  const sentimentTotal = promoters + passives + detractors

  // Average NPS — only rows that actually have an NPS score
  const npsRows = rows.filter(function(r) { return r.nps_score != null })
  const avgNps  = npsRows.length > 0
    ? Math.round(npsRows.reduce(function(s, r) { return s + r.nps_score }, 0) / npsRows.length * 10) / 10
    : 0

  // Average experience score — only rows that actually have a score
  const expRows = rows.filter(function(r) { return r.experience_score != null })
  const avgExp  = expRows.length > 0
    ? Math.round(expRows.reduce(function(s, r) { return s + r.experience_score }, 0) / expRows.length * 10) / 10
    : 0

  // NPS trend by day — only rows with NPS scores
  const npsMap: Record<string, { sum: number; count: number }> = {}
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (r.nps_score == null || !r.completed_at) continue
    const date = r.completed_at.slice(0, 10)
    if (!npsMap[date]) npsMap[date] = { sum: 0, count: 0 }
    npsMap[date].sum   += r.nps_score
    npsMap[date].count += 1
  }
  const npsTrend = Object.entries(npsMap)
    .sort(function(a, b) { return a[0].localeCompare(b[0]) })
    .map(function(entry) {
      return {
        date: entry[0],
        avg_nps: Math.round(entry[1].sum / entry[1].count * 10) / 10,
        count: entry[1].count,
      }
    })

  // Volume by day
  const volumeMap: Record<string, number> = {}
  for (let vi = 0; vi < rows.length; vi++) {
    if (!rows[vi].completed_at) continue
    const vdate = rows[vi].completed_at.slice(0, 10)
    volumeMap[vdate] = (volumeMap[vdate] || 0) + 1
  }
  const volumeByDay = Object.entries(volumeMap)
    .sort(function(a, b) { return a[0].localeCompare(b[0]) })
    .map(function(entry) { return { date: entry[0], count: entry[1] } })

  return NextResponse.json({
    summary: { total, totalAll, totalComplete, promoters, passives, detractors, sentimentTotal, avgNps, avgExp },
    sentiment: { promoters, passives, detractors },
    npsTrend,
    volumeByDay,
  })
}
