// app/api/studies/[id]/responses/route.ts
//
// GET (with no `export` param)         → JSON list for the dashboard
// GET ?export=csv|xlsx                 → file download
// Other params: format=standard|datanautix, labelMode=key|prompt, sections=...
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { dataResponse, parseExportFormat, type ExportFormat } from '@/lib/xlsxExport'
import { resolveBrandGlossary } from '@/lib/correction/glossary'
import { buildReplacements, normalizeText } from '@/lib/correction/normalize'

interface Params { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url       = new URL(req.url)
  // `export` param now accepts csv or xlsx (legacy 'csv' string still works).
  const exportRaw = url.searchParams.get('export')
  const isExport  = exportRaw === 'csv' || exportRaw === 'xlsx'
  const exportFormat: ExportFormat = parseExportFormat(exportRaw)
  const labelMode = url.searchParams.get('labelMode') || 'key'
  const format    = url.searchParams.get('format')    || 'standard'
  const sectionsP = url.searchParams.get('sections')  || 'core,openended,psychographics,demographics,meta'
  const sections  = new Set(sectionsP.split(',').map((s: string) => s.trim()))

  const sentiment = url.searchParams.get('sentiment')
  const minNps    = url.searchParams.get('min_nps')
  const maxNps    = url.searchParams.get('max_nps')
  const fromRaw   = url.searchParams.get('from')
  const toRaw     = url.searchParams.get('to')
  const limit     = parseInt(url.searchParams.get('limit')  || '50')
  const offset    = parseInt(url.searchParams.get('offset') || '0')

  // Hard-validate date inputs to YYYY-MM-DD before any PostgREST .or()
  // interpolation. Without this a comma or paren in `from` would let a
  // caller append arbitrary extra filter clauses to the OR expression.
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
  if (fromRaw && !ISO_DATE.test(fromRaw)) return NextResponse.json({ error: 'Invalid from date (expected YYYY-MM-DD)' }, { status: 400 })
  if (toRaw && !ISO_DATE.test(toRaw)) return NextResponse.json({ error: 'Invalid to date (expected YYYY-MM-DD)' }, { status: 400 })
  const from = fromRaw
  const to = toRaw

  // Fetch study config — user's Supabase client enforces RLS (org membership)
  const { data: study } = await supabase
    .from('studies')
    .select('name, config, org_id, created_by')
    .eq('id', params.id)
    .single()

  if (!study) return NextResponse.json({ error: 'Study not found or access denied' }, { status: 404 })

  // RLS on the studies table already enforces org membership — if the select
  // above succeeded, the user has access. Use service role for responses
  // to avoid client_id mismatch issues with response-level RLS.
  const service = createServiceRoleClient()

  const cfg = study?.config || {}

  // ── Brand spelling correction (shared brand-correction layer, Phase 4) ────
  // When the study is brand-tagged, exported open-ended verbatims are
  // canonicalized against the brand's curated entity glossary (variant→canonical,
  // deterministic). Raw `responses.payload` is never mutated — correction is a
  // derived/display layer applied on read. No-op when there's no brand_tag or the
  // glossary is empty. Only needed for exports.
  let nz: (t: string) => string = (t) => t
  if (isExport) {
    const brandTag = String((cfg as any).brandTag ?? '').trim()
    if (brandTag && study?.org_id) {
      const glossary = await resolveBrandGlossary(service, { orgId: study.org_id, brandTag })
      const repl = buildReplacements(glossary)
      if (repl.length > 0) nz = (t: string) => normalizeText(t, repl)
    }
  }

  // ── Collect all psycho/demo keys across ALL responses ─────────────────────
  let allPsychoKeys: string[] = []
  let allDemoKeys:   string[] = []

  if (isExport) {
    const { data: allRows } = await service
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

  const statusF  = url.searchParams.get('status')

  // ── Build query ───────────────────────────────────────────────────────────
  let query = service
    .from('responses')
    .select('*', { count: 'exact' })
    .eq('study_id', params.id)
    .order('completed_at', { ascending: false, nullsFirst: false })

  if (statusF) {
    if (statusF === 'complete') {
      query = query.or('status.eq.complete,status.is.null')
    } else {
      query = query.eq('status', statusF)
    }
  }

  if (sentiment) query = query.eq('sentiment', sentiment)
  if (minNps)    query = query.gte('nps_score', parseInt(minNps))
  if (maxNps)    query = query.lte('nps_score', parseInt(maxNps))
  // completed_at is now always set (partials carry their last-activity time),
  // so date filters apply uniformly — no null-bypass clause needed.
  if (from) query = query.gte('completed_at', from)
  if (to)   query = query.lte('completed_at', to + 'T23:59:59Z')
  if (!isExport) query = query.range(offset, offset + limit - 1)
  if (isExport)  query = query.range(0, 49999)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!isExport) {
    const [allRes, completeRes] = await Promise.all([
      service.from('responses').select('id', { count: 'exact', head: true }).eq('study_id', params.id),
      service.from('responses').select('id', { count: 'exact', head: true }).eq('study_id', params.id).or('status.eq.complete,status.is.null'),
    ])
    return NextResponse.json({ data, count, limit, offset, totalAll: allRes.count || 0, totalComplete: completeRes.count || 0 })
  }

  const rows = data || []
  if (rows.length === 0) {
    return new NextResponse('No data to export\n', { status: 200, headers: { 'Content-Type': 'text/csv' } })
  }

  const fmtDate = (d: string): string =>
    new Date(d).toLocaleString('en-US', { timeZone: 'America/New_York' })

  // ── Label helpers ─────────────────────────────────────────────────────────
  const oeLabel = (key: 'q1' | 'q2' | 'q3' | 'q4'): string => {
    const exportLabel = cfg[`${key}ExportLabel` as keyof typeof cfg] as string | undefined
    if (labelMode === 'key') return exportLabel || key
    const prompt =
      key === 'q1' ? (cfg.promoterQ1 || cfg.passiveQ1 || cfg.detractorQ1 || key)
    : key === 'q2' ? (cfg.ratingFollowUp || cfg.experienceFollowUp || key)
    : key === 'q3' ? (cfg.q3 || key)
    : (cfg.q4 || key)
    return exportLabel || prompt
  }

  const psychoLabel = (key: string): string => {
    const pq = (cfg.psychographicBank || []).find((p: any) => p.key === key)
    if (!pq) return key
    const exportLabel = (pq as any).exportLabel as string | undefined
    if (labelMode === 'key') return exportLabel || key
    return exportLabel || pq.q || key
  }

  const demoLabel = (key: string): string =>
    labelMode === 'prompt' ? key.charAt(0).toUpperCase() + key.slice(1) : key

  // Column definitions return RAW values; CSV/XLSX writers do the escaping.
  type Col = { header: string; value: (r: any) => unknown }

  const buildColumns = (forDatanautix = false): Col[] => {
    const cols: Col[] = []

    if (sections.has('core') || forDatanautix) {
      cols.push(
        { header: labelMode === 'prompt' ? 'Sentiment'         : 'sentiment',         value: r => r.sentiment ?? '' },
        { header: labelMode === 'prompt' ? 'Experience Score'  : 'experience_score',  value: r => r.experience_score ?? '' },
        { header: labelMode === 'prompt' ? (study?.config?.npsLabel || 'NPS Score') : (study?.config?.npsLabel || 'nps_score'), value: r => r.nps_score ?? '' },
      )
    }

    if (sections.has('openended') && !forDatanautix) {
      cols.push(
        { header: oeLabel('q1'), value: r => nz(r.payload?.openEnded?.q1 ?? '') },
        { header: oeLabel('q2'), value: r => nz(r.payload?.openEnded?.q2 ?? '') },
        { header: oeLabel('q3'), value: r => nz(r.payload?.openEnded?.q3 ?? '') },
        { header: oeLabel('q4'), value: r => nz(r.payload?.openEnded?.q4 ?? '') },
      )
    }

    if (sections.has('psychographics') || forDatanautix) {
      allPsychoKeys.forEach(k => cols.push({
        header: psychoLabel(k),
        value:  r => r.payload?.psychographics?.[k] ?? '',
      }))
    }

    if (sections.has('demographics') || forDatanautix) {
      allDemoKeys.forEach(k => cols.push({
        header: demoLabel(k),
        value:  r => r.payload?.demographics?.[k] ?? '',
      }))
    }

    if (sections.has('meta') && !forDatanautix) {
      cols.push(
        { header: labelMode === 'prompt' ? 'User Agent'           : 'agent',             value: r => r.payload?.agent ?? '' },
        { header: labelMode === 'prompt' ? 'Submission Timestamp' : 'payload_timestamp', value: r => r.payload?.timestamp ?? '' },
      )
    }

    if (sections.has('core') || forDatanautix) {
      cols.push(
        { header: labelMode === 'prompt' ? 'Status'            : 'status',            value: r => r.status || 'complete' },
        { header: labelMode === 'prompt' ? 'Response ID'       : 'response_id',       value: r => r.id },
        { header: labelMode === 'prompt' ? 'Completed At (ET)' : 'completed_at',      value: r => r.completed_at ? fmtDate(r.completed_at) : '' },
        { header: labelMode === 'prompt' ? 'Duration (sec)'    : 'duration_sec',      value: r => r.duration_sec ?? '' },
      )
    }

    return cols
  }

  const safeName = (study?.name || params.id).replace(/[^a-z0-9]/gi, '-').toLowerCase()
  const date     = new Date().toISOString().slice(0, 10)
  const suffix   = format === 'datanautix' ? '-datanautix' : ''
  const fileBase = safeName + suffix + '-' + date

  // ── STANDARD format ───────────────────────────────────────────────────────
  if (format === 'standard') {
    const cols = buildColumns()
    return dataResponse(exportFormat, fileBase, [{
      name: 'Responses',
      headers: cols.map(c => c.header),
      rows: rows.map(r => cols.map(c => c.value(r))),
    }])
  }

  // ── DATANAUTIX format — one row per non-blank open-ended answer ───────────
  const closedCols = buildColumns(true)

  const oeFields: Array<{ key: 'q1' | 'q2' | 'q3' | 'q4' }> = [
    { key: 'q1' }, { key: 'q2' }, { key: 'q3' }, { key: 'q4' },
  ]

  const dnHeaders = [
    ...closedCols.map(c => c.header),
    labelMode === 'prompt' ? 'Question Prompt' : 'question_prompt',
    labelMode === 'prompt' ? 'Response Text'   : 'response_text',
  ]

  const dnRows: unknown[][] = []
  for (const r of rows) {
    const base = closedCols.map(c => c.value(r))
    for (const { key } of oeFields) {
      const raw = (r.payload?.openEnded?.[key] || '').trim()
      if (!raw) continue
      dnRows.push([...base, oeLabel(key), nz(raw)])
    }
  }

  if (dnRows.length === 0) {
    return new NextResponse('No data to export\n', { status: 200, headers: { 'Content-Type': 'text/csv' } })
  }

  return dataResponse(exportFormat, fileBase, [{
    name: 'Datanautix',
    headers: dnHeaders,
    rows: dnRows,
  }])
}

export async function DELETE(req: NextRequest, props: Params) {
  const params = await props.params;
  // Auth check: use user client to verify identity, then use service role to delete
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: study } = await userClient
    .from('studies')
    .select('id, created_by, org_id')
    .eq('id', params.id)
    .single()

  if (!study) return NextResponse.json({ error: 'Study not found' }, { status: 404 })

  const { data: profile } = await userClient
    .from('users')
    .select('role, org_id')
    .eq('id', user.id)
    .single()

  const isOwner = study.created_by === user.id
  const isAdmin = (profile?.role === 'platform_admin' || profile?.role === 'owner') && profile?.org_id === study.org_id
  if (!isOwner && !isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const ids: string[] = body?.ids
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'No response IDs provided' }, { status: 400 })
  }

  const serviceSupabase = createServiceRoleClient()
  const { error, count } = await serviceSupabase
    .from('responses')
    .delete({ count: 'exact' })
    .eq('study_id', params.id)
    .in('id', ids)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try { await serviceSupabase.rpc('refresh_study_response_stats') } catch {}

  return NextResponse.json({ deleted: count ?? ids.length })
}
