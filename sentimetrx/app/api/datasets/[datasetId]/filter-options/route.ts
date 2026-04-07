// app/api/datasets/[datasetId]/filter-options/route.ts
// Returns distinct values and numeric ranges for filter UI — lightweight alternative
// to fetching all rows. Reads batch records and extracts unique values per field.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface Props { params: { datasetId: string } }

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get dataset state for schema
  const { data: stateRow } = await supabase
    .from('dataset_state')
    .select('schema_config')
    .eq('dataset_id', params.datasetId)
    .single()

  if (!stateRow?.schema_config) {
    return NextResponse.json({ error: 'No schema' }, { status: 404 })
  }

  const schema = stateRow.schema_config as { fields: { field: string; type: string; label?: string }[] }
  const fields = schema.fields || []

  // Fetch batches — each batch has a `rows` array of records
  // Cap at 20 batches (~200 rows each = ~4000 rows) to stay fast
  const MAX_BATCHES = 20
  const { data: batches, error } = await supabase
    .from('dataset_rows')
    .select('rows')
    .eq('dataset_id', params.datasetId)
    .order('batch_index', { ascending: true })
    .limit(MAX_BATCHES)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Build filter options per field by scanning batch rows
  const catValues: Record<string, Set<string>> = {}
  const numRanges: Record<string, { min: number; max: number }> = {}
  const dateRanges: Record<string, { min: string; max: string }> = {}

  for (const f of fields) {
    if (f.type === 'categorical' || f.type === 'open-ended') catValues[f.field] = new Set()
  }

  for (let bi = 0; bi < (batches || []).length; bi++) {
    const batchRows = (batches![bi] as any).rows || []
    for (let ri = 0; ri < batchRows.length; ri++) {
      const row = batchRows[ri]
      for (const f of fields) {
        const val = row[f.field]
        if (val == null || String(val).trim() === '') continue
        const str = String(val).trim()

        if ((f.type === 'categorical' || f.type === 'open-ended') && catValues[f.field]) {
          if (catValues[f.field].size < 200) catValues[f.field].add(str)
        }

        if (f.type === 'numeric') {
          const n = parseFloat(str)
          if (!isNaN(n)) {
            if (!numRanges[f.field]) numRanges[f.field] = { min: n, max: n }
            else {
              if (n < numRanges[f.field].min) numRanges[f.field].min = n
              if (n > numRanges[f.field].max) numRanges[f.field].max = n
            }
          }
        }

        if (f.type === 'date') {
          if (!dateRanges[f.field]) dateRanges[f.field] = { min: str, max: str }
          else {
            if (str < dateRanges[f.field].min) dateRanges[f.field].min = str
            if (str > dateRanges[f.field].max) dateRanges[f.field].max = str
          }
        }
      }
    }
  }

  // Assemble response
  const options: Record<string, { type: string; label: string; values?: string[]; min?: number; max?: number; dateMin?: string; dateMax?: string }> = {}
  for (const f of fields) {
    const opt: typeof options[string] = { type: f.type, label: f.label || f.field }
    if (catValues[f.field]) opt.values = Array.from(catValues[f.field]).sort()
    if (numRanges[f.field]) { opt.min = numRanges[f.field].min; opt.max = numRanges[f.field].max }
    if (dateRanges[f.field]) { opt.dateMin = dateRanges[f.field].min; opt.dateMax = dateRanges[f.field].max }
    options[f.field] = opt
  }

  return NextResponse.json({ fields: options })
}
