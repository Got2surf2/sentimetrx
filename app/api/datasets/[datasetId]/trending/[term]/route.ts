// app/api/datasets/[datasetId]/trending/[term]/route.ts
// GET — deep-dive data for one term. Powers the dataset analytics modal:
// total occurrences, top co-occurring "context" words, comments containing
// the term (paginated), and a frequency-by-week series if the dataset's
// rows have a usable date.
//
// `term` may contain a space (bigrams like "tree canopy") — URL-encoded
// in the path and decoded here.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { contextTermsFor, tokenize } from '@/lib/trendingWords'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const MAX_ROWS = 10000
const MAX_COMMENTS = 50

interface Params { params: { datasetId: string; term: string } }

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userRow } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  const orgId = userRow?.org_id
  if (!orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const service = createServiceRoleClient()

  const { data: dataset } = await service.from('datasets').select('org_id').eq('id', params.datasetId).single()
  if (!dataset) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (dataset.org_id !== orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const term = decodeURIComponent(params.term).toLowerCase().trim()
  if (!term) return NextResponse.json({ error: 'Missing term' }, { status: 400 })

  const { data: stateRow } = await service
    .from('dataset_state')
    .select('schema_config')
    .eq('dataset_id', params.datasetId)
    .single()

  const fields = ((stateRow?.schema_config as any)?.fields || []) as { field: string; type?: string }[]
  const textFields = fields.filter(f => f.type === 'open-ended').map(f => f.field)
  // Heuristic: a date field is one whose type is 'date', or has a label/key
  // hinting at a timestamp. Use the first match for the weekly series.
  const dateFieldDef = fields.find(f => (f.type === 'date'))
  const dateField = dateFieldDef?.field || null

  // Pull rows. We still cap to MAX_ROWS — for very large datasets this
  // gives a representative sample rather than a stale full count.
  const { data: rows } = await service
    .from('dataset_rows_flat')
    .select('data, created_at')
    .eq('dataset_id', params.datasetId)
    .limit(MAX_ROWS)

  // Compile all text + per-row reference for matching/comments/weekly.
  const matchingRows: { text: string; date: string | null; rowData: Record<string, unknown> }[] = []
  const allMatchingTexts: string[] = []

  for (const r of rows || []) {
    const data = r.data as Record<string, unknown>
    const combined = textFields.map(f => (typeof data?.[f] === 'string' ? data[f] as string : '')).join(' ')
    if (!combined.trim()) continue
    const toks = tokenize(combined)
    const matches = term.includes(' ')
      ? combined.toLowerCase().includes(term)
      : toks.includes(term)
    if (!matches) continue
    let date: string | null = null
    if (dateField && data[dateField]) {
      const d = String(data[dateField])
      if (!isNaN(Date.parse(d))) date = new Date(d).toISOString()
    }
    if (!date && r.created_at) date = r.created_at
    matchingRows.push({ text: combined, date, rowData: data })
    allMatchingTexts.push(combined)
  }

  const totalCount = matchingRows.length

  // Context words — top co-occurring terms across matching rows.
  const contexts = contextTermsFor(term, allMatchingTexts, { n: 12, minCount: 2 })

  // Weekly frequency — bucket matching rows by ISO week.
  const weekly: { week: string; count: number }[] = []
  if (matchingRows.some(r => r.date)) {
    const buckets = new Map<string, number>()
    for (const r of matchingRows) {
      if (!r.date) continue
      const d = new Date(r.date)
      // Week start = Monday. ISO-style.
      const day = d.getUTCDay() || 7
      d.setUTCDate(d.getUTCDate() - day + 1)
      d.setUTCHours(0, 0, 0, 0)
      const key = d.toISOString().slice(0, 10)
      buckets.set(key, (buckets.get(key) || 0) + 1)
    }
    weekly.push(...Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([week, count]) => ({ week, count })))
  }

  // Comments — most recent first if dated, otherwise insertion order.
  const comments = matchingRows
    .slice()
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, MAX_COMMENTS)
    .map(r => ({ text: r.text, date: r.date }))

  return NextResponse.json({
    term,
    totalCount,
    contexts,
    weekly,
    comments,
    sampleSize: rows?.length || 0,
    dateField,
  })
}
