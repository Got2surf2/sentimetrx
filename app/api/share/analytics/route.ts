// app/api/share/analytics/route.ts
// Serves filtered-vs-benchmark analytics for shared analytics links.
// No auth required — data is accessed via share token.
// Returns only aggregates — never individual rows.

import { createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const MIN_BENCHMARK_N = 10
const MIN_OUTLIER_N = 10
const MIN_THEME_COUNT = 5

interface SerializedCatFilter { type: 'cat'; values: string[]; excludeBlanks: boolean }
interface SerializedRangeFilter { type: 'range'; values: [number, number]; includeBlanks: boolean }
interface SerializedDateRangeFilter { type: 'daterange'; values: [number, number]; includeBlanks: boolean }
type SerializedFilter = SerializedCatFilter | SerializedRangeFilter | SerializedDateRangeFilter
type SerializedFilters = Record<string, SerializedFilter>

function rowMatchesFilter(data: Record<string, any>, filters: SerializedFilters): boolean {
  return Object.entries(filters).every(([field, f]) => {
    const val = data[field]
    if (f.type === 'cat') {
      const str = (val == null || String(val).trim() === '') ? '(blank)' : String(val)
      if (str === '(blank)' && f.excludeBlanks) return false
      return f.values.includes(str)
    }
    if (f.type === 'range') {
      const n = parseFloat(String(val ?? ''))
      if (isNaN(n)) return f.includeBlanks !== false
      return n >= f.values[0] && n <= f.values[1]
    }
    if (f.type === 'daterange') {
      if (val == null || String(val).trim() === '') return f.includeBlanks !== false
      const d = new Date(String(val))
      if (isNaN(d.getTime())) return f.includeBlanks !== false
      const ts = d.getTime()
      return ts >= f.values[0] && ts <= f.values[1]
    }
    return true
  })
}

function computeStats(values: number[]) {
  if (!values.length) return { n: 0, mean: 0, stddev: 0, median: 0 }
  const n = values.length
  const mean = values.reduce((s, v) => s + v, 0) / n
  const variance = n > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = Math.floor(n / 2)
  const median = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return { n, mean, stddev: Math.sqrt(variance), median }
}

function zScore(filteredMean: number, filteredN: number, benchMean: number, benchStddev: number, benchN: number): { z: number; p: number; significant: boolean; direction: 'above' | 'below' | 'none' } | null {
  if (filteredN < MIN_OUTLIER_N || benchN < MIN_BENCHMARK_N || benchStddev === 0) return null
  const se = Math.sqrt((benchStddev ** 2) / benchN + (benchStddev ** 2) / filteredN)
  if (se === 0) return null
  const z = (filteredMean - benchMean) / se
  // Two-tailed normal approximation
  const p = 2 * (1 - normCDF(Math.abs(z)))
  return { z, p, significant: Math.abs(z) > 1.96, direction: z > 1.96 ? 'above' : z < -1.96 ? 'below' : 'none' }
}

function proportionTest(k: number, n: number, K: number, N: number): { z: number; p: number; significant: boolean; direction: 'over' | 'under' | 'none'; p1: number; p2: number } | null {
  const rn = N - n
  const rk = K - k
  if (n < MIN_OUTLIER_N || rn < MIN_BENCHMARK_N || K < MIN_THEME_COUNT) return null
  const pPool = K / N
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n + 1 / rn))
  if (se === 0) return null
  const p1 = k / n
  const p2 = rk / rn
  const z = (p1 - p2) / se
  const p = 2 * (1 - normCDF(Math.abs(z)))
  return { z, p, significant: Math.abs(z) > 1.96, direction: z > 1.96 ? 'over' : z < -1.96 ? 'under' : 'none', p1, p2 }
}

function normCDF(z: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911
  const sg = z < 0 ? -1 : 1
  z = Math.abs(z)
  const t = 1 / (1 + p * z)
  return 0.5 * (1 + sg * (1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z)))
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 })

  const service = createServiceRoleClient()

  // Validate token
  const { data: link } = await service
    .from('shared_links')
    .select('*')
    .eq('token', token)
    .single()

  if (!link) return NextResponse.json({ error: 'Invalid share link' }, { status: 404 })
  if (link.type !== 'analytics') return NextResponse.json({ error: 'Not an analytics link' }, { status: 400 })
  if (new Date(link.expires_at) < new Date()) return NextResponse.json({ error: 'This share link has expired' }, { status: 410 })

  // Record access
  service.from('shared_links').update({ last_accessed_at: new Date().toISOString() }).eq('token', token).then(() => {})

  const meta = link.metadata as {
    dataset_id: string
    filters: SerializedFilters
    label: string
    primary?: { field: string; label: string; values: string[] }
    inViewValues?: string[]
    dateRange?: { field: string; label: string; min: string; max: string }
    includeThemes?: boolean
  }
  if (!meta?.dataset_id) return NextResponse.json({ error: 'Invalid analytics metadata' }, { status: 400 })

  // Fetch dataset info
  const { data: dataset } = await service
    .from('datasets')
    .select('id, name, source, row_count')
    .eq('id', meta.dataset_id)
    .single()
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })

  // Fetch schema for field labels and types
  const { data: stateRow } = await service
    .from('dataset_state')
    .select('schema_config, theme_model')
    .eq('dataset_id', meta.dataset_id)
    .single()

  const schema = stateRow?.schema_config as { fields: { field: string; type: string; label?: string; section?: string }[] } | null
  const fields = schema?.fields || []
  const numericFields = fields.filter(f => f.type === 'numeric')
  const fieldLabels: Record<string, string> = {}
  fields.forEach(f => { fieldLabels[f.field] = f.label || f.field })

  // Fetch all rows (paginated with 1000-row pages)
  // For collections: union rows from member datasets with _collection_label
  const allRows: Record<string, any>[] = []
  const PAGE_SIZE = 1000

  let flatDatasetIds: string[] = [meta.dataset_id]
  let collectionLabels: Record<string, string> = {}

  if (dataset.source === 'collection') {
    const { data: col } = await service.from('collections').select('id').eq('dataset_id', meta.dataset_id).single()
    if (col) {
      const { data: members } = await service.from('collection_members').select('dataset_id, label').eq('collection_id', col.id).order('sort_order', { ascending: true })
      if (members && members.length > 0) {
        flatDatasetIds = members.map(m => m.dataset_id)
        members.forEach(m => { collectionLabels[m.dataset_id] = m.label })
      }
    }
  }

  for (const dsId of flatDatasetIds) {
    let page = 0
    const label = collectionLabels[dsId] || undefined
    while (true) {
      const { data: rows } = await service
        .from('dataset_rows_flat')
        .select('data')
        .eq('dataset_id', dsId)
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      if (!rows || rows.length === 0) break
      for (const r of rows) {
        const row = r.data as Record<string, any>
        if (label) row._collection_label = label
        allRows.push(row)
      }
      if (rows.length < PAGE_SIZE) break
      page++
    }
  }

  // Step 1: Apply active filters to get "in view" rows
  var filters = meta.filters || {}
  var inViewRows: Record<string, any>[] = []
  for (const row of allRows) {
    if (Object.keys(filters).length === 0 || rowMatchesFilter(row, filters)) inViewRows.push(row)
  }

  // Step 2: From in-view rows, split by primary field into primary vs comparison
  var filteredRows: Record<string, any>[] = []
  var benchmarkRows: Record<string, any>[] = []
  if (meta.primary && meta.primary.field && meta.primary.values.length > 0) {
    var pField = meta.primary.field
    var pValues = new Set(meta.primary.values)
    var inViewSet = meta.inViewValues ? new Set(meta.inViewValues) : null
    for (const row of inViewRows) {
      var val = String(row[pField] ?? '')
      if (pValues.has(val)) filteredRows.push(row)
      else if (!inViewSet || inViewSet.has(val)) benchmarkRows.push(row)
    }
  } else {
    // No primary selection — all in-view rows are "filtered"
    filteredRows = inViewRows
  }

  // Compute numeric stats for each numeric field
  const numericResults: Record<string, {
    filtered: { n: number; mean: number; stddev: number; median: number }
    benchmark: { n: number; mean: number; stddev: number; median: number }
    outlier: { z: number; p: number; significant: boolean; direction: string } | null
    label: string
  }> = {}

  for (const f of numericFields) {
    const fVals = filteredRows.map(r => parseFloat(String(r[f.field] ?? ''))).filter(v => !isNaN(v))
    const bVals = benchmarkRows.map(r => parseFloat(String(r[f.field] ?? ''))).filter(v => !isNaN(v))
    const fStats = computeStats(fVals)
    const bStats = computeStats(bVals)
    const outlier = zScore(fStats.mean, fStats.n, bStats.mean, bStats.stddev, bStats.n)
    numericResults[f.field] = { filtered: fStats, benchmark: bStats, outlier, label: fieldLabels[f.field] || f.field }
  }

  // Compute theme frequencies and outlier flags
  const themeModel = stateRow?.theme_model as { themes?: { id: string; name: string; description?: string; keywords: string[]; sentiment?: string }[]; fieldName?: string; fieldNames?: string[] } | null
  const themes = themeModel?.themes || []
  const textFields = themeModel?.fieldNames || (themeModel?.fieldName ? [themeModel.fieldName] : fields.filter(f => f.type === 'open-ended').map(f => f.field))

  function rowMatchesTheme(row: Record<string, any>, keywords: string[]): boolean {
    const pattern = new RegExp('(?:^|\\W)(?:' + keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\w*', 'i')
    for (const tf of textFields) {
      const text = row[tf]
      if (text && typeof text === 'string' && pattern.test(text)) return true
    }
    return false
  }

  const totalFiltered = filteredRows.length
  const totalBenchmark = benchmarkRows.length
  const totalAll = allRows.length

  const themeResults: {
    name: string; description: string; sentiment: string; keywords: string[]
    filtered: { count: number; rate: number }
    benchmark: { count: number; rate: number }
    outlier: { z: number; p: number; significant: boolean; direction: string; p1: number; p2: number } | null
  }[] = []

  for (const theme of themes) {
    if (!theme.keywords?.length) continue
    const fCount = filteredRows.filter(r => rowMatchesTheme(r, theme.keywords)).length
    const bCount = benchmarkRows.filter(r => rowMatchesTheme(r, theme.keywords)).length
    const totalThemeCount = fCount + bCount
    const outlier = proportionTest(fCount, totalFiltered, totalThemeCount, totalAll)

    themeResults.push({
      name: theme.name,
      description: theme.description || '',
      sentiment: theme.sentiment || 'neutral',
      keywords: (theme.keywords || []).slice(0, 5),
      filtered: { count: fCount, rate: totalFiltered > 0 ? fCount / totalFiltered : 0 },
      benchmark: { count: bCount, rate: totalBenchmark > 0 ? bCount / totalBenchmark : 0 },
      outlier,
    })
  }

  // Sort themes by filtered rate descending
  themeResults.sort((a, b) => b.filtered.rate - a.filtered.rate)

  // Build summaries for the shared page
  var filterFieldSummary: Record<string, string> = {}
  for (const [field, f] of Object.entries(filters)) {
    if (f.type === 'cat') filterFieldSummary[fieldLabels[field] || field] = f.values.join(', ')
    else if (f.type === 'range') filterFieldSummary[fieldLabels[field] || field] = f.values[0] + ' - ' + f.values[1]
  }

  var primarySummary = meta.primary ? {
    field: meta.primary.label || meta.primary.field,
    values: meta.primary.values,
    comparisonValues: (meta.inViewValues || []).filter(function(v) { return !meta.primary!.values.includes(v) }),
  } : null

  // Count responses with comments (non-empty text in open-ended fields)
  const openEndedFields = fields.filter(f => f.type === 'open-ended')
  let commentCount = 0
  for (const row of filteredRows) {
    for (const oe of openEndedFields) {
      const val = row[oe.field]
      if (val && typeof val === 'string' && val.trim().length > 0) { commentCount++; break }
    }
  }

  // Get theme analysis prompt/field labels
  const themeFieldLabels = textFields.map(function(tf) {
    const f = fields.find(function(ff) { return ff.field === tf })
    return f?.label || tf
  })

  // Completion funnel with intermediate stages
  const completedCount = filteredRows.filter(r => String(r.status || '').toLowerCase() === 'complete').length
  const funnelStages: { label: string; count: number }[] = [{ label: 'Started', count: totalFiltered }]

  // Rating stage: has experience_score or nps_score
  const ratingFields = fields.filter(f => f.field === 'experience_score' || f.field === 'nps_score')
  if (ratingFields.length > 0) {
    const hasRating = filteredRows.filter(r => ratingFields.some(f => r[f.field] != null && String(r[f.field]).trim() !== '')).length
    if (hasRating > 0) funnelStages.push({ label: ratingFields.find(f => f.field === 'experience_score')?.label || 'Rating', count: hasRating })
  }

  // Conversation stage: has any open-ended response
  const oeFields = fields.filter(f => f.type === 'open-ended')
  if (oeFields.length > 0) {
    const hasConvo = filteredRows.filter(r => oeFields.some(f => { var v = r[f.field]; return v && typeof v === 'string' && v.trim().length > 0 })).length
    if (hasConvo > 0) funnelStages.push({ label: 'Conversation', count: hasConvo })
  }

  // Custom questions (collapsed into one group): has any custom field answered
  const customFields = fields.filter(f => f.section === 'custom')
  if (customFields.length > 0) {
    const hasCustom = filteredRows.filter(r => customFields.some(f => { var v = r[f.field]; return v != null && String(v).trim() !== '' })).length
    if (hasCustom > 0) funnelStages.push({ label: 'Survey Questions (' + customFields.length + ')', count: hasCustom })
  }

  // Psychographics (collapsed into one group)
  const psychoFields = fields.filter(f => f.section === 'psychographic')
  if (psychoFields.length > 0) {
    const hasPsycho = filteredRows.filter(r => psychoFields.some(f => { var v = r[f.field]; return v != null && String(v).trim() !== '' })).length
    if (hasPsycho > 0) funnelStages.push({ label: 'Psychographics (' + psychoFields.length + ')', count: hasPsycho })
  }

  // Demographics (collapsed into one group)
  const demoFields = fields.filter(f => f.section === 'demographic')
  if (demoFields.length > 0) {
    const hasDemo = filteredRows.filter(r => demoFields.some(f => { var v = r[f.field]; return v != null && String(v).trim() !== '' })).length
    if (hasDemo > 0) funnelStages.push({ label: 'Demographics', count: hasDemo })
  }

  funnelStages.push({ label: 'Completed', count: completedCount })
  const completion = { started: totalFiltered, completed: completedCount, stages: funnelStages }

  // Exclude duration_sec from numeric KPIs (replaced by completion funnel)
  const filteredNumeric: typeof numericResults = {}
  for (const [k, v] of Object.entries(numericResults)) {
    if (k !== 'duration_sec') filteredNumeric[k] = v
  }

  return NextResponse.json({
    label: meta.label || 'Filtered View',
    datasetName: dataset.name,
    filtered: { n: totalFiltered },
    benchmark: { n: totalBenchmark },
    total: { n: totalAll },
    inView: { n: inViewRows.length },
    commentCount: commentCount,
    themeFieldLabels: themeFieldLabels,
    filterSummary: filterFieldSummary,
    primarySummary: primarySummary,
    numeric: filteredNumeric,
    completion: completion,
    themes: themeResults,
    includeThemes: !!meta.includeThemes,
    dateRange: meta.dateRange || null,
    expires_at: link.expires_at,
  })
}
