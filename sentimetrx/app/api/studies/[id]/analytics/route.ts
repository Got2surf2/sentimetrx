import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

interface Params { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  var supabase = createClient()
  var authResult = await supabase.auth.getUser()
  if (!authResult.data.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  var url  = new URL(req.url)
  var from = url.searchParams.get('from')
  var to   = url.searchParams.get('to')

  // Verify study exists and user can access it
  var studyResult = await supabase
    .from('studies')
    .select('id, name, bot_name, bot_emoji, status, config')
    .eq('id', params.id)
    .single()

  if (studyResult.error || !studyResult.data) {
    return NextResponse.json({ error: 'Study not found' }, { status: 404 })
  }

  var query = supabase
    .from('responses')
    .select('sentiment, nps_score, experience_score, completed_at, status')
    .eq('study_id', params.id)
    .or('status.eq.complete,status.is.null')
    .order('completed_at', { ascending: true })
    .range(0, 49999)

  if (from) query = query.gte('completed_at', from)
  if (to)   query = query.lte('completed_at', to + 'T23:59:59Z')

  var result = await query

  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })

  var rows = result.data || []

  var total = rows.length

  // Support both old (promoter/passive/detractor) and new (positive/neutral/negative) sentiment values
  var promoters  = rows.filter(function(r) { return r.sentiment === 'positive'  || r.sentiment === 'promoter' }).length
  var passives   = rows.filter(function(r) { return r.sentiment === 'neutral'   || r.sentiment === 'passive' }).length
  var detractors = rows.filter(function(r) { return r.sentiment === 'negative'  || r.sentiment === 'detractor' }).length

  // Average NPS — only rows that actually have an NPS score
  var npsRows = rows.filter(function(r) { return r.nps_score != null })
  var avgNps  = npsRows.length > 0
    ? Math.round(npsRows.reduce(function(s, r) { return s + r.nps_score }, 0) / npsRows.length * 10) / 10
    : 0

  // Average experience score — only rows that actually have a score
  var expRows = rows.filter(function(r) { return r.experience_score != null })
  var avgExp  = expRows.length > 0
    ? Math.round(expRows.reduce(function(s, r) { return s + r.experience_score }, 0) / expRows.length * 10) / 10
    : 0

  // NPS trend by day — only rows with NPS scores
  var npsMap: Record<string, { sum: number; count: number }> = {}
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i]
    if (r.nps_score == null || !r.completed_at) continue
    var date = r.completed_at.slice(0, 10)
    if (!npsMap[date]) npsMap[date] = { sum: 0, count: 0 }
    npsMap[date].sum   += r.nps_score
    npsMap[date].count += 1
  }
  var npsTrend = Object.entries(npsMap)
    .sort(function(a, b) { return a[0].localeCompare(b[0]) })
    .map(function(entry) {
      return {
        date: entry[0],
        avg_nps: Math.round(entry[1].sum / entry[1].count * 10) / 10,
        count: entry[1].count,
      }
    })

  // Volume by day
  var volumeMap: Record<string, number> = {}
  for (var vi = 0; vi < rows.length; vi++) {
    if (!rows[vi].completed_at) continue
    var vdate = rows[vi].completed_at.slice(0, 10)
    volumeMap[vdate] = (volumeMap[vdate] || 0) + 1
  }
  var volumeByDay = Object.entries(volumeMap)
    .sort(function(a, b) { return a[0].localeCompare(b[0]) })
    .map(function(entry) { return { date: entry[0], count: entry[1] } })

  return NextResponse.json({
    summary: { total, promoters, passives, detractors, avgNps, avgExp },
    sentiment: { promoters, passives, detractors },
    npsTrend,
    volumeByDay,
  })
}
