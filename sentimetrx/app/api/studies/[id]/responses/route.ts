import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

interface Params { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url       = new URL(req.url)
  const isCSV     = url.searchParams.get('export') === 'csv'
  const sentiment = url.searchParams.get('sentiment')
  const minNps    = url.searchParams.get('min_nps')
  const maxNps    = url.searchParams.get('max_nps')
  const from      = url.searchParams.get('from')
  const to        = url.searchParams.get('to')
  const limit     = parseInt(url.searchParams.get('limit')  || '50')
  const offset    = parseInt(url.searchParams.get('offset') || '0')

  // Verify the study exists and the user can access it (RLS handles this)
  const { data: study, error: studyError } = await supabase
    .from('studies')
    .select('id, name')
    .eq('id', params.id)
    .single()

  if (studyError || !study) {
    return NextResponse.json({ error: 'Study not found' }, { status: 404 })
  }

  let query = supabase
    .from('responses')
    .select('*', { count: 'exact' })
    .eq('study_id', params.id)
    .order('completed_at', { ascending: false })

  if (sentiment) query = query.eq('sentiment', sentiment)
  if (minNps)    query = query.gte('nps_score', parseInt(minNps))
  if (maxNps)    query = query.lte('nps_score', parseInt(maxNps))
  if (from)      query = query.gte('completed_at', from)
  if (to)        query = query.lte('completed_at', to + 'T23:59:59Z')

  if (!isCSV) {
    query = query.range(offset, offset + limit - 1)
  }

  const { data, error, count } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (isCSV) {
    const rows = data || []
    if (rows.length === 0) {
      return new NextResponse('No data to export', { status: 200 })
    }

    const firstPayload = rows[0].payload || {}
    const psychoKeys   = Object.keys(firstPayload.psychographics || {})
    const demoKeys     = Object.keys(firstPayload.demographics   || {})

    const headers = [
      'response_id', 'completed_at', 'duration_sec',
      'sentiment', 'experience_score', 'nps_score',
      'q1', 'q3', 'q4',
      ...psychoKeys,
      ...demoKeys,
    ]

    const escape = (v: unknown) => {
      const s = v == null ? '' : String(v)
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? '"' + s.replace(/"/g, '""') + '"'
        : s
    }

    const csvRows = rows.map(r => {
      const p = r.payload || {}
      return [
        r.id,
        r.completed_at,
        r.duration_sec ?? '',
        r.sentiment        ?? '',
        r.experience_score ?? '',
        r.nps_score        ?? '',
        escape(p.openEnded?.q1 ?? ''),
        escape(p.openEnded?.q3 ?? ''),
        escape(p.openEnded?.q4 ?? ''),
        ...psychoKeys.map(k => escape(p.psychographics?.[k] ?? '')),
        ...demoKeys.map(k   => escape(p.demographics?.[k]   ?? '')),
      ].join(',')
    })

    const csv = [headers.join(','), ...csvRows].join('\n')

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type':        'text/csv',
        'Content-Disposition': 'attachment; filename="responses-' + params.id + '-' + new Date().toISOString().slice(0,10) + '.csv"',
      },
    })
  }

  return NextResponse.json({ data, count, limit, offset })
}
