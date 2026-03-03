import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

interface Params { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url       = new URL(req.url)
  const exportFmt = url.searchParams.get('export')
  const sentiment = url.searchParams.get('sentiment')
  const minNps    = url.searchParams.get('min_nps')
  const maxNps    = url.searchParams.get('max_nps')
  const from      = url.searchParams.get('from')
  const to        = url.searchParams.get('to')
  const limit     = parseInt(url.searchParams.get('limit')  || '50')
  const offset    = parseInt(url.searchParams.get('offset') || '0')

  const { data: study, error: studyError } = await supabase
    .from('studies').select('id, name, config').eq('id', params.id).single()
  if (studyError || !study) return NextResponse.json({ error: 'Study not found' }, { status: 404 })

  let query = supabase.from('responses').select('*', { count: 'exact' })
    .eq('study_id', params.id).order('completed_at', { ascending: false })
  if (sentiment) query = query.eq('sentiment', sentiment)
  if (minNps)    query = query.gte('nps_score', parseInt(minNps))
  if (maxNps)    query = query.lte('nps_score', parseInt(maxNps))
  if (from)      query = query.gte('completed_at', from)
  if (to)        query = query.lte('completed_at', to + 'T23:59:59Z')
  if (!exportFmt) query = query.range(offset, offset + limit - 1)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!exportFmt) return NextResponse.json({ data, count, limit, offset })

  const rows       = data || []
  const cfg        = (study as any).config || {}
  const psychoBank = (cfg.psychographicBank || []) as any[]
  const psychoKeys = psychoBank.map((p: any) => p.key as string)

  const q1Label = (cfg.q1ExportLabel || (cfg.ratingPrompt || '').slice(0, 60) || 'Opening Rating') as string
  const q3Label = (cfg.q3ExportLabel || (cfg.q3 || '').slice(0, 60) || 'Open Ended Q1') as string
  const q4Label = (cfg.q4ExportLabel || (cfg.q4 || '').slice(0, 60) || 'Open Ended Q2') as string

  const psychoLabels: Record<string, string> = {}
  for (const p of psychoBank) {
    psychoLabels[p.key] = p.exportLabel || (p.q || '').slice(0, 60) || p.key
  }

  const esc = (v: unknown): string => {
    const s = v == null ? '' : String(v)
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? '"' + s.replace(/"/g, '""') + '"'
      : s
  }

  const baseRow = (r: any) => [
    r.id, r.completed_at, r.duration_sec ?? '',
    r.sentiment ?? '', r.experience_score ?? '', r.nps_score ?? '',
  ]

  const psychoRow = (r: any) => {
    const p = r.payload || {}
    return psychoKeys.map((k: string) => esc(p.psychographics?.[k] ?? ''))
  }

  if (exportFmt === 'csv') {
    const headers = [
      'respondent_id', 'completed_at', 'duration_sec',
      'sentiment', 'experience_score', 'nps_score',
      q1Label, q3Label, q4Label,
      ...psychoKeys.map((k: string) => psychoLabels[k] || k),
    ]
    const csvRows = (rows as any[]).map(r => {
      const p = r.payload || {}
      return [...baseRow(r), esc(p.openEnded?.q1 ?? ''), esc(p.openEnded?.q3 ?? ''), esc(p.openEnded?.q4 ?? ''), ...psychoRow(r)].join(',')
    })
    const csv = [headers.join(','), ...csvRows].join('\n')
    return new NextResponse(csv, { status: 200, headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="responses-standard-${new Date().toISOString().slice(0,10)}.csv"` } })
  }

  if (exportFmt === 'csv_flat') {
    const qualPrompts = [{ key: 'q1', label: q1Label }, { key: 'q3', label: q3Label }, { key: 'q4', label: q4Label }]
    const headers = [
      'respondent_id', 'completed_at', 'duration_sec',
      'sentiment', 'experience_score', 'nps_score',
      'qual_prompt', 'qual_response',
      ...psychoKeys.map((k: string) => psychoLabels[k] || k),
    ]
    const csvRows: string[] = []
    for (const r of rows as any[]) {
      const p = r.payload || {}
      for (const pr of qualPrompts) {
        const resp = p.openEnded?.[pr.key]
        if (!resp) continue
        csvRows.push([...baseRow(r), esc(pr.label), esc(resp), ...psychoRow(r)].join(','))
      }
    }
    const csv = [headers.join(','), ...csvRows].join('\n')
    return new NextResponse(csv, { status: 200, headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="responses-flattened-${new Date().toISOString().slice(0,10)}.csv"` } })
  }

  return NextResponse.json({ error: 'Invalid export format' }, { status: 400 })
}
