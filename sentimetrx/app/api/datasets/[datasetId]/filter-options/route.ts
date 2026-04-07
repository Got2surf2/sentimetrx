// app/api/datasets/[datasetId]/filter-options/route.ts
// Returns distinct values and numeric ranges for filter UI.
// Uses pre-computed analytics (fieldSummaries) when available — instant, no row scanning.
// Falls back to batch sampling for fields not in analytics.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface Props { params: { datasetId: string } }

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get schema + analytics in one query
  const { data: stateRow } = await supabase
    .from('dataset_state')
    .select('schema_config, analytics')
    .eq('dataset_id', params.datasetId)
    .single()

  if (!stateRow?.schema_config) {
    return NextResponse.json({ error: 'No schema' }, { status: 404 })
  }

  const schema = stateRow.schema_config as { fields: { field: string; type: string; label?: string }[] }
  const analytics = stateRow.analytics as { fieldSummaries?: Record<string, any> } | null
  const summaries = analytics?.fieldSummaries || {}
  const fields = schema.fields || []

  // Build filter options per field — prefer analytics (instant) over batch scanning
  const options: Record<string, { type: string; label: string; values?: string[]; min?: number; max?: number; dateMin?: string; dateMax?: string }> = {}

  // Track fields that need batch-scan fallback
  const needsScan: { field: string; type: string }[] = []

  for (const f of fields) {
    const opt: typeof options[string] = { type: f.type, label: f.label || f.field }
    const summary = summaries[f.field]

    if (f.type === 'categorical' || f.type === 'open-ended') {
      if (summary?.counts && Object.keys(summary.counts).length > 0) {
        // Use pre-computed counts — keys are the distinct values
        opt.values = Object.keys(summary.counts).sort()
      } else {
        needsScan.push(f)
      }
    }

    if (f.type === 'numeric') {
      if (summary?.min != null && summary?.max != null) {
        opt.min = summary.min
        opt.max = summary.max
      } else {
        needsScan.push(f)
      }
    }

    if (f.type === 'date') {
      // Dates rarely have pre-computed ranges — always scan
      needsScan.push(f)
    }

    options[f.field] = opt
  }

  // Batch-scan fallback for fields not covered by analytics
  if (needsScan.length > 0) {
    const MAX_BATCHES = 30
    const { data: batches } = await supabase
      .from('dataset_rows')
      .select('rows')
      .eq('dataset_id', params.datasetId)
      .order('batch_index', { ascending: true })
      .limit(MAX_BATCHES)

    if (batches) {
      const catSets: Record<string, Set<string>> = {}
      const numRanges: Record<string, { min: number; max: number }> = {}
      const dateRanges: Record<string, { min: string; max: string }> = {}

      for (const f of needsScan) {
        if (f.type === 'categorical' || f.type === 'open-ended') catSets[f.field] = new Set()
      }

      for (const batch of batches) {
        const batchRows = (batch as any).rows || []
        for (const row of batchRows) {
          for (const f of needsScan) {
            const val = row[f.field]
            if (val == null || String(val).trim() === '') continue
            const str = String(val).trim()

            if (catSets[f.field] && catSets[f.field].size < 200) {
              catSets[f.field].add(str)
            }
            if (f.type === 'numeric') {
              const n = parseFloat(str)
              if (!isNaN(n)) {
                if (!numRanges[f.field]) numRanges[f.field] = { min: n, max: n }
                else { if (n < numRanges[f.field].min) numRanges[f.field].min = n; if (n > numRanges[f.field].max) numRanges[f.field].max = n }
              }
            }
            if (f.type === 'date') {
              if (!dateRanges[f.field]) dateRanges[f.field] = { min: str, max: str }
              else { if (str < dateRanges[f.field].min) dateRanges[f.field].min = str; if (str > dateRanges[f.field].max) dateRanges[f.field].max = str }
            }
          }
        }
      }

      // Merge scan results into options
      for (const f of needsScan) {
        if (catSets[f.field]) options[f.field].values = Array.from(catSets[f.field]).sort()
        if (numRanges[f.field]) { options[f.field].min = numRanges[f.field].min; options[f.field].max = numRanges[f.field].max }
        if (dateRanges[f.field]) { options[f.field].dateMin = dateRanges[f.field].min; options[f.field].dateMax = dateRanges[f.field].max }
      }
    }
  }

  return NextResponse.json({ fields: options })
}
