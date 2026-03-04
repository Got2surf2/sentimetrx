// app/api/studies/[id]/responses/route.ts
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

interface Params { params: { id: string } }

// GET /api/studies/[id]/responses
// Query params:
//   sentiment, min_nps, max_nps, from, to, limit, offset
//   export=csv
//   format=flat|nested|raw   (default: flat)
//   sections=core,openended,psychographics,demographics,meta  (comma-separated, default all)
export async function GET(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url       = new URL(req.url)
  const isCSV     = url.searchParams.get('export') === 'csv'
  const format    = url.searchParams.get('format')   || 'flat'  // flat | nested | raw
  const sectionsP = url.searchParams.get('sections') || 'core,openended,psychographics,demographics,meta'
  const sections  = new Set(sectionsP.split(',').map(s => s.trim()))

  const sentiment = url.searchParams.get('sentiment')
  const minNps    = url.searchParams.get('min_nps')
  const maxNps    = url.searchParams.get('max_nps')
  const from      = url.searchParams.get('from')
  const to        = url.searchParams.get('to')
  const limit     = parseInt(url.searchParams.get('limit')  || '50')
  const offset    = parseInt(url.searchParams.get('offset') || '0')

  // Fetch study config so we can use real question labels
  const { data: study } = await supabase
    .from('studies')
    .select('name, config')
    .eq('id', params.id)
    .single()

  const cfg = study?.config || {}

  // Build question labels from study config
  const q1Label = 'Follow-up (Q1)'
  const q3Label = cfg.q3 ? cfg.q3.slice(0, 60).replace(/[,"\n]/g, ' ') : 'Q3'
  const q4Label = cfg.q4 ? cfg.q4.slice(0, 60).replace(/[,"\n]/g, ' ') : 'Q4'

  // Collect all psychographic keys across ALL responses (not just first row)
  // We do a separate lightweight query for this
  let allPsychoKeys: string[] = []
  let allDemoKeys:   string[] = []

  if (isCSV && (sections.has('psychographics') || sections.has('demographics'))) {
    const { data: allRows } = await supabase
      .from('responses')
      .select('payload')
      .eq('study_id', params.id)

    const psychoSet = new Set<string>()
    const demoSet   = new Set<string>()

    for (const r of allRows || []) {
      Object.keys(r.payload?.psychographics || {}).forEach(k => psychoSet.add(k))
      Object.keys(r.payload?.demographics   || {}).forEach(k => demoSet.add(k))
    }

    // Order psycho keys by study config order if available
    const configKeys = (cfg.psychographicBank || []).map((p: any) => p.key)
    allPsychoKeys = [
      ...configKeys.filter((k: string) => psychoSet.has(k)),
      ...[...psychoSet].filter(k => !configKeys.includes(k)),
    ]
    allDemoKeys = [...demoSet]
  }

  // Build main query
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
  if (!isCSV)    query = query.range(offset, offset + limit - 1)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // ── JSON response ────────────────────────────────────────────────────────────
  if (!isCSV) {
    return NextResponse.json({ data, count, limit, offset })
  }

  // ── CSV export ───────────────────────────────────────────────────────────────
  const rows = data || []
  if (rows.length === 0) {
    return new NextResponse('No data to export\n', {
      status: 200,
      headers: { 'Content-Type': 'text/csv' },
    })
  }

  const esc = (v: unknown): string => {
    const s = v == null ? '' : String(v).trim()
    return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  // ── RAW format — one column per top-level payload key, payload as JSON ───────
  if (format === 'raw') {
    const headers = ['response_id', 'completed_at', 'duration_sec',
      'sentiment', 'experience_score', 'nps_score', 'payload_json']
    const csvRows = rows.map(r => [
      r.id, r.completed_at, r.duration_sec ?? '',
      r.sentiment ?? '', r.experience_score ?? '', r.nps_score ?? '',
      esc(JSON.stringify(r.payload)),
    ].join(','))
    return csvResponse(params.id, study?.name, [headers.join(','), ...csvRows].join('\n'))
  }

  // ── NESTED format — grouped sections, payload keys one level deep ────────────
  if (format === 'nested') {
    const headers: string[] = []
    if (sections.has('core')) {
      headers.push('response_id', 'completed_at', 'duration_sec',
        'sentiment', 'experience_score', 'nps_score')
    }
    if (sections.has('openended')) {
      headers.push('followup_q1', 'q3', 'q4')
    }
    if (sections.has('psychographics')) {
      allPsychoKeys.forEach(k => headers.push(`psych_${k}`))
    }
    if (sections.has('demographics')) {
      allDemoKeys.forEach(k => headers.push(`demo_${k}`))
    }
    if (sections.has('meta')) {
      headers.push('agent', 'timestamp')
    }

    const csvRows = rows.map(r => {
      const p   = r.payload || {}
      const row: string[] = []
      if (sections.has('core')) {
        row.push(r.id, r.completed_at, String(r.duration_sec ?? ''),
          r.sentiment ?? '', String(r.experience_score ?? ''), String(r.nps_score ?? ''))
      }
      if (sections.has('openended')) {
        row.push(esc(p.openEnded?.q1 ?? ''), esc(p.openEnded?.q3 ?? ''), esc(p.openEnded?.q4 ?? ''))
      }
      if (sections.has('psychographics')) {
        allPsychoKeys.forEach(k => row.push(esc(p.psychographics?.[k] ?? '')))
      }
      if (sections.has('demographics')) {
        allDemoKeys.forEach(k => row.push(esc(p.demographics?.[k] ?? '')))
      }
      if (sections.has('meta')) {
        row.push(esc(p.agent ?? ''), esc(p.timestamp ?? ''))
      }
      return row.join(',')
    })
    return csvResponse(params.id, study?.name, [headers.join(','), ...csvRows].join('\n'))
  }

  // ── FLAT format (default) — human-readable column names with question text ───
  const headers: string[] = []
  if (sections.has('core')) {
    headers.push(
      'Response ID', 'Completed At', 'Duration (sec)',
      'Sentiment', 'Experience Score', 'NPS Score',
    )
  }
  if (sections.has('openended')) {
    headers.push(q1Label, q3Label, q4Label)
  }
  if (sections.has('psychographics')) {
    // Use friendly label from study config if available
    const psychoLabelMap: Record<string, string> = {}
    for (const pq of cfg.psychographicBank || []) {
      psychoLabelMap[pq.key] = pq.q ? pq.q.slice(0, 60).replace(/[,"\n]/g, ' ') : pq.key
    }
    allPsychoKeys.forEach(k => headers.push(psychoLabelMap[k] || k))
  }
  if (sections.has('demographics')) {
    allDemoKeys.forEach(k => headers.push(k.charAt(0).toUpperCase() + k.slice(1)))
  }
  if (sections.has('meta')) {
    headers.push('User Agent', 'Submission Timestamp')
  }

  const csvRows = rows.map(r => {
    const p   = r.payload || {}
    const row: string[] = []
    if (sections.has('core')) {
      row.push(
        r.id,
        new Date(r.completed_at).toLocaleString('en-US', { timeZone: 'America/New_York' }),
        String(r.duration_sec ?? ''),
        r.sentiment ?? '',
        String(r.experience_score ?? ''),
        String(r.nps_score ?? ''),
      )
    }
    if (sections.has('openended')) {
      row.push(esc(p.openEnded?.q1 ?? ''), esc(p.openEnded?.q3 ?? ''), esc(p.openEnded?.q4 ?? ''))
    }
    if (sections.has('psychographics')) {
      allPsychoKeys.forEach(k => row.push(esc(p.psychographics?.[k] ?? '')))
    }
    if (sections.has('demographics')) {
      allDemoKeys.forEach(k => row.push(esc(p.demographics?.[k] ?? '')))
    }
    if (sections.has('meta')) {
      row.push(esc(p.agent ?? ''), esc(p.timestamp ?? ''))
    }
    return row.join(',')
  })

  return csvResponse(params.id, study?.name, [headers.join(','), ...csvRows].join('\n'))
}

function csvResponse(studyId: string, studyName: string | undefined, csv: string) {
  const safeName = (studyName || studyId).replace(/[^a-z0-9]/gi, '-').toLowerCase()
  const date     = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeName}-${date}.csv"`,
    },
  })
}
