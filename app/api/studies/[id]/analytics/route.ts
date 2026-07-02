import { createClient, getAuthUser } from '@/lib/supabase/server'
import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { serverError } from '@/lib/apiError'

interface Params { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url  = new URL(req.url)
  const from = url.searchParams.get('from')
  const to   = url.searchParams.get('to')

  // Hard-validate dates to YYYY-MM-DD before any PostgREST .or() interpolation.
  // A comma or paren in the input would otherwise let a caller append
  // arbitrary extra filter clauses to the OR expression.
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
  if (from && !ISO_DATE.test(from)) return NextResponse.json({ error: 'Invalid from date (expected YYYY-MM-DD)' }, { status: 400 })
  if (to && !ISO_DATE.test(to)) return NextResponse.json({ error: 'Invalid to date (expected YYYY-MM-DD)' }, { status: 400 })

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

  // Date filters on completed_at. completed_at is now always set (partials
  // carry their last-activity time), so partials are date-filtered like
  // completed responses — no null-bypass clause needed.
  if (from) query = query.gte('completed_at', from)
  if (to)   query = query.lte('completed_at', to + 'T23:59:59Z')

  const result = await query

  if (result.error) return serverError(result.error, 'studies.analytics')

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

  // Rating trend by day — use whichever score field has data (NPS or experience)
  const useNps = npsRows.length > expRows.length
  const ratingMap: Record<string, { sum: number; count: number }> = {}
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const score = useNps ? r.nps_score : r.experience_score
    if (score == null || !r.completed_at) continue
    const date = r.completed_at.slice(0, 10)
    if (!ratingMap[date]) ratingMap[date] = { sum: 0, count: 0 }
    ratingMap[date].sum   += score
    ratingMap[date].count += 1
  }
  const npsTrend = Object.entries(ratingMap)
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
