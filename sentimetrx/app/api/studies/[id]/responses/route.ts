// app/api/studies/[id]/responses/route.ts
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

interface Params { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url       = new URL(req.url)
  const isCSV     = url.searchParams.get('export') === 'csv'
  const labelMode = url.searchParams.get('labelMode') || 'key'
  const format    = url.searchParams.get('format')    || 'standard'
  const sectionsP = url.searchParams.get('sections')  || 'core,openended,psychographics,demographics,meta'
  const sections  = new Set(sectionsP.split(',').map((s: string) => s.trim()))

  const sentiment = url.searchParams.get('sentiment')
  const minNps    = url.searchParams.get('min_nps')
  const maxNps    = url.searchParams.get('max_nps')
  const from      = url.searchParams.get('from')
  const to        = url.searchParams.get('to')
  const limit     = parseInt(url.searchParams.get('limit')  || '50')
  const offset    = parseInt(url.searchParams.get('offset') || '0')

  // Fetch study config for labels
  const { data: study } = await supabase
    .from('studies')
    .select('name, config')
    .eq('id', params.id)
    .single()

  const cfg = study?.config || {}

  // ── Collect all psycho/demo keys across ALL responses ─────────────────────
  let allPsychoKeys: string[] = []
  let allDemoKeys:   string[] = []

  if (isCSV) {
    const { data: allRows } = await supabase
      .from('responses').select('payload').eq('study_id', params.id)

    const psychoSet = new Set<string>()
    const demoSet   = new Set<string>()
    for (const r of allRows || []) {
      Object.keys(r.payload?.psychographics || {}).forEach((k: string) => psychoSet.add(k))
      Object.keys(r.payload?.demographics   || {}).forEach((k: string) => demoSet.add(k))
    }
    const configKeys = (cfg.psychographicBank || []).map((p: any) => p.key)
    allPsychoKeys = [
      ...configKeys.filter((k: string) => psychoSet.has(k)),
      ...Array.from(psychoSet).filter((k: string) => !configKeys.includes(k)),
    ]
    allDemoKeys = Array.from(demoSet)
  }

  // ── Build query ───────────────────────────────────────────────────────────
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
  if (!isCSV) return NextResponse.json({ data, count, limit, offset })

  const rows = data || []
  if (rows.length === 0) {
    return new NextResponse('No data to export\n', { status: 200, headers: { 'Content-Type': 'text/csv' } })
  }

  const esc = (v: unknown): string => {
    const s = v == null ? '' : String(v).trim()
    return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const fmtDate = (d: string) => {
    const s = new Date(d).toLocaleString('en-US', { timeZone: 'America/New_York' })
    return `"${s}"`  // always quote — locale date strings contain commas
  }

  // ── Label helpers ─────────────────────────────────────────────────────────
  // For open-ended columns: user label > prompt text > key
  const oeLabel = (key: 'q1' | 'q3' | 'q4'): string => {
    const exportLabel = cfg[`${key}ExportLabel` as keyof typeof cfg] as string | undefined
    if (labelMode === 'key')    return exportLabel || key
    // prompt mode: use full question text, fall back to export label, then key
    const prompt =
      key === 'q1' ? (cfg.promoterQ1 || cfg.passiveQ1 || cfg.detractorQ1 || key)
    : key === 'q3' ? (cfg.q3 || key)
    : (cfg.q4 || key)
    return exportLabel || prompt
  }

  // For psychographic columns: user export label > question text > key
  const psychoLabel = (key: string): string => {
    const pq = (cfg.psychographicBank || []).find((p: any) => p.key === key)
    if (!pq) return key
    const exportLabel = (pq as any).exportLabel as string | undefined
    if (labelMode === 'key') return exportLabel || key
    return exportLabel || pq.q || key
  }

  // For demo columns: capitalise in prompt mode
  const demoLabel = (key: string): string =>
    labelMode === 'prompt' ? key.charAt(0).toUpperCase() + key.slice(1) : key

  // Core column definitions — SINGLE source of truth for header+value
  // Each entry: { header, value(row) }
  type Col = { header: string; value: (r: any) => string }

  const buildColumns = (forDatanautix = false): Col[] => {
    const cols: Col[] = []

    if (sections.has('core') || forDatanautix) {
      cols.push(
        { header: labelMode === 'prompt' ? 'Response ID'       : 'response_id',       value: r => r.id },
        { header: labelMode === 'prompt' ? 'Completed At (ET)' : 'completed_at',      value: r => fmtDate(r.completed_at) },
        { header: labelMode === 'prompt' ? 'Duration (sec)'    : 'duration_sec',      value: r => String(r.duration_sec ?? '') },
        { header: labelMode === 'prompt' ? 'Sentiment'         : 'sentiment',         value: r => r.sentiment ?? '' },
        { header: labelMode === 'prompt' ? 'Experience Score'  : 'experience_score',  value: r => String(r.experience_score ?? '') },
        { header: labelMode === 'prompt' ? (study?.config?.npsLabel || 'NPS Score') : (study?.config?.npsLabel || 'nps_score'), value: r => String(r.nps_score ?? '') },
      )
    }

    // Open-ended right after core scores (natural reading order)
    if (sections.has('openended') && !forDatanautix) {
      cols.push(
        { header: oeLabel('q1'), value: r => esc(r.payload?.openEnded?.q1 ?? '') },
        { header: oeLabel('q3'), value: r => esc(r.payload?.openEnded?.q3 ?? '') },
        { header: oeLabel('q4'), value: r => esc(r.payload?.openEnded?.q4 ?? '') },
      )
    }

    if (sections.has('psychographics') || forDatanautix) {
      allPsychoKeys.forEach(k => cols.push({
        header: psychoLabel(k),
        value:  r => esc(r.payload?.psychographics?.[k] ?? ''),
      }))
    }

    if (sections.has('demographics') || forDatanautix) {
      allDemoKeys.forEach(k => cols.push({
        header: demoLabel(k),
        value:  r => esc(r.payload?.demographics?.[k] ?? ''),
      }))
    }

    if (sections.has('meta') && !forDatanautix) {
      cols.push(
        { header: labelMode === 'prompt' ? 'User Agent'           : 'agent',             value: r => esc(r.payload?.agent ?? '') },
        { header: labelMode === 'prompt' ? 'Submission Timestamp' : 'payload_timestamp', value: r => esc(r.payload?.timestamp ?? '') },
      )
    }

    return cols
  }

  // ── STANDARD format ───────────────────────────────────────────────────────
  if (format === 'standard') {
    const cols    = buildColumns()
    const headers = cols.map(c => c.header)
    const csvRows = rows.map(r => cols.map(c => c.value(r)).join(','))
    return csvResponse(params.id, study?.name, format,
      [headers.join(','), ...csvRows].join('\n'))
  }

  // ── DATANAUTIX format — one row per non-blank open-ended answer ───────────
  const closedCols = buildColumns(true)

  // The 3 open-ended fields — use user label for the prompt identifier column
  const oeFields: Array<{ key: 'q1' | 'q3' | 'q4' }> = [
    { key: 'q1' }, { key: 'q3' }, { key: 'q4' },
  ]

  const dnHeaders = [
    ...closedCols.map(c => c.header),
    labelMode === 'prompt' ? 'Question Prompt' : 'question_prompt',
    labelMode === 'prompt' ? 'Response Text'   : 'response_text',
  ]

  const dnRows: string[] = []
  for (const r of rows) {
    const base = closedCols.map(c => c.value(r))
    for (const { key } of oeFields) {
      const text = (r.payload?.openEnded?.[key] || '').trim()
      if (!text) continue
      // Always use the user-defined export label (or prompt text) — never the raw key
      const questionLabel = oeLabel(key)
      dnRows.push([...base, esc(questionLabel), esc(text)].join(','))
    }
  }

  if (dnRows.length === 0) {
    return new NextResponse('No data to export\n', { status: 200, headers: { 'Content-Type': 'text/csv' } })
  }

  return csvResponse(params.id, study?.name, format,
    [dnHeaders.join(','), ...dnRows].join('\n'))
}

function csvResponse(studyId: string, studyName: string | undefined, format: string, csv: string) {
  const safeName = (studyName || studyId).replace(/[^a-z0-9]/gi, '-').toLowerCase()
  const date     = new Date().toISOString().slice(0, 10)
  const suffix   = format === 'datanautix' ? '-datanautix' : ''
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeName}${suffix}-${date}.csv"`,
    },
  })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  // Auth check: use user client to verify identity, then use service role to delete
  const userClient = createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify ownership using user client (respects RLS on studies table)
  const { data: study } = await userClient
    .from('studies')
    .select('id, created_by, org_id')
    .eq('id', params.id)
    .single()

  if (!study) return NextResponse.json({ error: 'Study not found' }, { status: 404 })

  const { data: profile } = await userClient
    .from('profiles')
    .select('role, org_id')
    .eq('id', user.id)
    .single()

  const isOwner = study.created_by === user.id
  const isAdmin = profile?.role === 'admin' && profile?.org_id === study.org_id
  if (!isOwner && !isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const ids: string[] = body?.ids
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'No response IDs provided' }, { status: 400 })
  }

  // Use service role client to bypass RLS for the actual delete
  const { createServiceRoleClient } = await import('@/lib/supabase/server')
  const serviceSupabase = createServiceRoleClient()
  const { error, count } = await serviceSupabase
    .from('responses')
    .delete({ count: 'exact' })
    .eq('study_id', params.id)
    .in('id', ids)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deleted: count ?? ids.length })
}
