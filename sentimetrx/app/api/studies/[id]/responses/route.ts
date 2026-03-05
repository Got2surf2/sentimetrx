// app/api/studies/[id]/responses/route.ts
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

interface Params { params: { id: string } }

// GET /api/studies/[id]/responses
// Query params:
//   sentiment, min_nps, max_nps, from, to, limit, offset
//   export=csv
//   labelMode=key|prompt      (default: key)
//   format=standard|datanautix (default: standard)
//   sections=core,openended,psychographics,demographics,meta
export async function GET(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url       = new URL(req.url)
  const isCSV     = url.searchParams.get('export') === 'csv'
  const labelMode = url.searchParams.get('labelMode') || 'key'   // key | prompt
  const format    = url.searchParams.get('format')    || 'standard' // standard | datanautix
  const sectionsP = url.searchParams.get('sections')  || 'core,openended,psychographics,demographics,meta'
  const sections  = new Set(sectionsP.split(',').map((s: string) => s.trim()))

  const sentiment = url.searchParams.get('sentiment')
  const minNps    = url.searchParams.get('min_nps')
  const maxNps    = url.searchParams.get('max_nps')
  const from      = url.searchParams.get('from')
  const to        = url.searchParams.get('to')
  const limit     = parseInt(url.searchParams.get('limit')  || '50')
  const offset    = parseInt(url.searchParams.get('offset') || '0')

  // Fetch study config for question labels
  const { data: study } = await supabase
    .from('studies')
    .select('name, config')
    .eq('id', params.id)
    .single()

  const cfg = study?.config || {}

  // ── Build question label maps ─────────────────────────────────────────────
  // Open-ended: key → prompt text
  // q1 prompt depends on sentiment; use a generic label for mixed exports
  // User-defined export labels (used for labelMode='key' as the preferred column name)
  const oeExportLabels: Record<string, string> = {
    q1: cfg.q1ExportLabel || '',
    q3: cfg.q3ExportLabel || '',
    q4: cfg.q4ExportLabel || '',
  }
  // Full prompt text (used for labelMode='prompt')
  const oeLabels: Record<string, string> = {
    q1: cfg.q1ExportLabel || cfg.promoterQ1 || cfg.passiveQ1 || cfg.detractorQ1 || 'q1',
    q3: cfg.q3ExportLabel || cfg.q3 || 'q3',
    q4: cfg.q4ExportLabel || cfg.q4 || 'q4',
  }

  // Psychographic: key → export label (or question text, or key)
  const psychoPromptMap: Record<string, string> = {}
  for (const pq of cfg.psychographicBank || []) {
    psychoPromptMap[pq.key] = (pq as any).exportLabel || pq.q || pq.key
  }

  // Helpers: get header for a field key
  const oeHeader = (key: string) =>
    labelMode === 'prompt'
      ? oeLabels[key] || key
      : oeExportLabels[key] || key

  // psychoExportLabels: key → user-defined export label (for 'key' mode)
  const psychoExportLabels: Record<string, string> = {}
  for (const pq of cfg.psychographicBank || []) {
    if ((pq as any).exportLabel) psychoExportLabels[pq.key] = (pq as any).exportLabel
  }

  const psychoHeader = (key: string) =>
    labelMode === 'prompt'
      ? (psychoPromptMap[key] || key)
      : (psychoExportLabels[key] || key)

  const demoHeader = (key: string) =>
    labelMode === 'prompt' ? (key.charAt(0).toUpperCase() + key.slice(1)) : key

  // ── Collect all psycho/demo keys across all responses ─────────────────────
  let allPsychoKeys: string[] = []
  let allDemoKeys:   string[] = []

  if (isCSV) {
    const { data: allRows } = await supabase
      .from('responses')
      .select('payload')
      .eq('study_id', params.id)

    const psychoSet = new Set<string>()
    const demoSet   = new Set<string>()
    for (const r of allRows || []) {
      Object.keys(r.payload?.psychographics || {}).forEach((k: string) => psychoSet.add(k))
      Object.keys(r.payload?.demographics   || {}).forEach((k: string) => demoSet.add(k))
    }

    // Order psycho keys by study config order
    const configKeys = (cfg.psychographicBank || []).map((p: any) => p.key)
    allPsychoKeys = [
      ...configKeys.filter((k: string) => psychoSet.has(k)),
      ...Array.from(psychoSet).filter((k: string) => !configKeys.includes(k)),
    ]
    allDemoKeys = Array.from(demoSet)
  }

  // ── Build main query ──────────────────────────────────────────────────────
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

  // ── JSON response ─────────────────────────────────────────────────────────
  if (!isCSV) return NextResponse.json({ data, count, limit, offset })

  const rows = data || []
  if (rows.length === 0) {
    return new NextResponse('No data to export\n', {
      status: 200, headers: { 'Content-Type': 'text/csv' },
    })
  }

  const esc = (v: unknown): string => {
    const s = v == null ? '' : String(v).trim()
    return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  const fmtDate = (d: string) =>
    new Date(d).toLocaleString('en-US', { timeZone: 'America/New_York' })

  // ── Closed-ended metadata columns (shared by both formats) ────────────────
  // Returns [headers, rowFn] for the closed-ended portion
  const closedHeaders = (): string[] => {
    const h: string[] = []
    if (sections.has('core') || format === 'datanautix') {
      h.push(
        labelMode === 'prompt' ? 'Response ID'        : 'response_id',
        labelMode === 'prompt' ? 'Completed At (ET)'  : 'completed_at',
        labelMode === 'prompt' ? 'Duration (sec)'     : 'duration_sec',
        labelMode === 'prompt' ? 'Sentiment'          : 'sentiment',
        labelMode === 'prompt' ? 'Experience Score'   : 'experience_score',
        labelMode === 'prompt' ? 'NPS Score'          : 'nps_score',
      )
    }
    if (sections.has('psychographics') || format === 'datanautix') {
      allPsychoKeys.forEach(k => h.push(psychoHeader(k)))
    }
    if (sections.has('demographics') || format === 'datanautix') {
      allDemoKeys.forEach(k => h.push(demoHeader(k)))
    }
    if (sections.has('meta') && format === 'standard') {
      h.push(
        labelMode === 'prompt' ? 'User Agent'            : 'agent',
        labelMode === 'prompt' ? 'Submission Timestamp'  : 'payload_timestamp',
      )
    }
    return h
  }

  const closedValues = (r: any): string[] => {
    const p   = r.payload || {}
    const row: string[] = []
    if (sections.has('core') || format === 'datanautix') {
      row.push(
        r.id,
        fmtDate(r.completed_at),
        String(r.duration_sec ?? ''),
        r.sentiment          ?? '',
        String(r.experience_score ?? ''),
        String(r.nps_score   ?? ''),
      )
    }
    if (sections.has('psychographics') || format === 'datanautix') {
      allPsychoKeys.forEach(k => row.push(esc(p.psychographics?.[k] ?? '')))
    }
    if (sections.has('demographics') || format === 'datanautix') {
      allDemoKeys.forEach(k => row.push(esc(p.demographics?.[k] ?? '')))
    }
    if (sections.has('meta') && format === 'standard') {
      row.push(esc(p.agent ?? ''), esc(p.timestamp ?? ''))
    }
    return row
  }

  // ── STANDARD format ───────────────────────────────────────────────────────
  if (format === 'standard') {
    const headers: string[] = [...closedHeaders()]
    if (sections.has('openended')) {
      headers.push(oeHeader('q1'), oeHeader('q3'), oeHeader('q4'))
    }

    const csvRows = rows.map(r => {
      const p   = r.payload || {}
      const row = [...closedValues(r)]
      if (sections.has('openended')) {
        row.push(esc(p.openEnded?.q1 ?? ''), esc(p.openEnded?.q3 ?? ''), esc(p.openEnded?.q4 ?? ''))
      }
      return row.join(',')
    })

    return csvResponse(params.id, study?.name, format,
      [headers.join(','), ...csvRows].join('\n'))
  }

  // ── DATANAUTIX format — one row per open-ended answer ─────────────────────
  // Columns: [closed-ended metadata] + question_prompt + response_text
  const dnHeaders = [
    ...closedHeaders(),
    labelMode === 'prompt' ? 'Question Prompt' : 'question_prompt',
    labelMode === 'prompt' ? 'Response Text'   : 'response_text',
  ]

  // The 3 open-ended fields with their prompt labels
  const oeFields: Array<{ key: 'q1' | 'q3' | 'q4'; prompt: string }> = [
    { key: 'q1', prompt: oeLabels.q1 },
    { key: 'q3', prompt: oeLabels.q3 },
    { key: 'q4', prompt: oeLabels.q4 },
  ]

  const dnRows: string[] = []
  for (const r of rows) {
    const p    = r.payload || {}
    const base = closedValues(r)
    for (const { key, prompt } of oeFields) {
      const text = (p.openEnded?.[key] || '').trim()
      if (!text) continue  // skip blank answers
      const questionLabel = labelMode === 'prompt' ? prompt : key
      dnRows.push([...base, esc(questionLabel), esc(text)].join(','))
    }
  }

  if (dnRows.length === 0) {
    return new NextResponse('No data to export\n', {
      status: 200, headers: { 'Content-Type': 'text/csv' },
    })
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
