// app/api/datasets/[datasetId]/about/route.ts
// Read-only "About this dataset" summary for the shared DatasetAboutPopover
// (analyze banner + listing cards). Everything here is cheap: schema/analytics
// are already stored on dataset_state; the only scan is one sampled_signal_counts
// pass (sql/166/179) over the open-ended fields with NO themes — it returns each
// field's non-empty AND substantive (sql/178) counts in a single bounded visit
// (exact <=50K, deterministic sample above), so the popover can show fill-rate
// and "% substantive" per verbatim field without a full scan.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { sampledSignalCounts, scaleSampledCount, SIGNAL_SAMPLE_CAP } from '@/lib/sampledSignalCounts'
import type { SchemaConfig, DatasetAnalytics, NumericSummary } from '@/lib/analyzeTypes'

interface Props { params: Promise<{ datasetId: string }> }

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const RATING_SQT = new Set(['rating', 'nps', 'likert'])

export async function GET(_req: Request, props: Props) {
  const { datasetId } = await props.params
  const supabase = await createClient()
  const { orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: ds } = await service
    .from('datasets')
    .select('id, org_id, source, row_count, last_synced_at, description')
    .eq('id', datasetId)
    .single()
  if (!ds) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
  const dataset = ds as { org_id: string; source: string; row_count: number | null; last_synced_at: string | null; description: string | null }
  if (!isAdmin && dataset.org_id !== orgId) {
    return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
  }

  const { data: stateRow } = await service
    .from('dataset_state')
    .select('schema_config, analytics')
    .eq('dataset_id', datasetId)
    .maybeSingle()
  const schema = (stateRow as { schema_config?: SchemaConfig } | null)?.schema_config
  const analytics = (stateRow as { analytics?: { fieldSummaries?: DatasetAnalytics['fieldSummaries'] } } | null)?.analytics
  const summaries = analytics?.fieldSummaries || {}
  const rows = dataset.row_count || 0

  const fields = (schema?.fields || []).filter(f => f.status !== 'ignored')
  const fieldsByType: Record<string, number> = {}
  for (const f of fields) fieldsByType[f.type] = (fieldsByType[f.type] || 0) + 1

  const openEnded = fields.filter(f => f.type === 'open-ended').map(f => f.field)

  // Non-empty + substantive counts per open-ended field, in one sampled pass
  // (single-dataset only; collections are virtual — fall back to stored fill).
  const fillByField: Record<string, number> = {}
  const substantiveByField: Record<string, number> = {}
  let sampled = false
  if (openEnded.length && dataset.source !== 'collection') {
    try {
      const s = await sampledSignalCounts(service, datasetId, openEnded, [])
      sampled = rows > SIGNAL_SAMPLE_CAP
      openEnded.forEach((f, i) => {
        fillByField[f] = scaleSampledCount(s.recordsPerField[i] || 0, rows, s.scanned)
        substantiveByField[f] = scaleSampledCount(s.recordsSubstantivePerField[i] || 0, rows, s.scanned)
      })
    } catch { /* fall back to stored fill below */ }
  }

  const verbatimFields = openEnded.map(f => {
    const sum = summaries[f]
    const fill = fillByField[f] ?? (sum && 'nonNull' in sum ? sum.nonNull : 0)
    const label = fields.find(x => x.field === f)?.label || f
    return { field: f, label, fill, substantive: substantiveByField[f] ?? null }
  })

  const ratingFields = fields
    .filter(f => f.sqt && RATING_SQT.has(f.sqt))
    .map(f => {
      const sum = summaries[f.field] as NumericSummary | undefined
      return {
        field: f.field,
        label: f.label || f.field,
        n: sum && 'nonNull' in sum ? sum.nonNull : (f.nonNullCount ?? null),
        avg: sum?.type === 'numeric' ? sum.avg : null,
        max: sum?.type === 'numeric' ? sum.max : (f.max ?? null),
      }
    })

  // Date range: the stored download window (review sources encode it in the
  // description JSON), else a date field's summary/schema extent.
  let dateMin: string | null = null, dateMax: string | null = null
  try {
    const parsed = dataset.description ? JSON.parse(dataset.description) : null
    if (parsed?.start_date) dateMin = parsed.start_date
    if (parsed?.end_date) dateMax = parsed.end_date
  } catch { /* not JSON */ }
  if (!dateMin || !dateMax) {
    const dateField = fields.find(f => f.type === 'date')
    if (dateField) {
      const sum = summaries[dateField.field]
      if (sum?.type === 'date') { dateMin = dateMin || sum.min; dateMax = dateMax || sum.max }
      dateMin = dateMin || dateField.dateMin || null
      dateMax = dateMax || dateField.dateMax || null
    }
  }

  return NextResponse.json({
    rows,
    source: dataset.source,
    lastSynced: dataset.last_synced_at,
    dateMin, dateMax,
    fieldsByType,
    fieldCount: fields.length,
    verbatimFields,
    ratingFields,
    sampled,
  })
}
