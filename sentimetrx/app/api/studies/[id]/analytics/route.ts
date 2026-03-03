import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

interface Params { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url  = new URL(req.url)
  const from = url.searchParams.get('from')
  const to   = url.searchParams.get('to')

  // Verify study exists and user can access it
  const { data: study, error: studyError } = await supabase
    .from('studies')
    .select('id, name, bot_name, bot_emoji, status')
    .eq('id', params.id)
    .single()

  if (studyError || !study) {
    return NextResponse.json({ error: 'Study not found' }, { status: 404 })
  }

  let query = supabase
    .from('responses')
    .select('sentiment, nps_score, experience_score, completed_at')
    .eq('study_id', params.id)
    .order('completed_at', { ascending: true })

  if (from) query = query.gte('completed_at', from)
  if (to)   query = query.lte('completed_at', to + 'T23:59:59Z')

  const { data: responses, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = responses || []

  const total      = rows.length
  const promoters  = rows.filter(r => r.sentiment === 'promoter').length
  const passives   = rows.filter(r => r.sentiment === 'passive').length
  const detractors = rows.filter(r => r.sentiment === 'detractor').length
  const avgNps     = total > 0
    ? Math.round(rows.reduce((s, r) => s + (r.nps_score || 0), 0) / total * 10) / 10
    : 0
  const avgExp     = total > 0
    ? Math.round(rows.reduce((s, r) => s + (r.experience_score || 0), 0) / total * 10) / 10
    : 0

  const npsMap: Record<string, { sum: number; count: number }> = {}
  for (const r of rows) {
    const date = r.completed_at.slice(0, 10)
    if (!npsMap[date]) npsMap[date] = { sum: 0, count: 0 }
    npsMap[date].sum   += r.nps_score || 0
    npsMap[date].count += 1
  }
  const npsTrend = Object.entries(npsMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { sum, count }]) => ({
      date,
      avg_nps: Math.round(sum / count * 10) / 10,
      count,
    }))

  const volumeMap: Record<string, number> = {}
  for (const r of rows) {
    const date = r.completed_at.slice(0, 10)
    volumeMap[date] = (volumeMap[date] || 0) + 1
  }
  const volumeByDay = Object.entries(volumeMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }))

  return NextResponse.json({
    summary: { total, promoters, passives, detractors, avgNps, avgExp },
    sentiment: { promoters, passives, detractors },
    npsTrend,
    volumeByDay,
  })
}
