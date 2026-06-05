// app/api/datasets/[datasetId]/signal-stats/route.ts
// Returns cache-aware signal stats for a single dataset.
// All computation + caching logic lives in lib/signalStats.ts so the
// batch endpoint at /api/datasets/signal-stats-batch reuses it.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { computeSignalStats } from '@/lib/signalStats'

interface Props { params: Promise<{ datasetId: string }> }

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(_req: Request, props: Props) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const stats = await computeSignalStats(service, params.datasetId)

  // Date range covered by the dataset, from its stored download window
  // (instant — no row scan). Read via the RLS-enforced user client so it
  // can't reach another org's dataset. description is a JSON string set by
  // the review-sources create route ({ ..., start_date, end_date }).
  let dateMin: string | null = null, dateMax: string | null = null
  const { data: dsRow } = await supabase
    .from('datasets').select('description').eq('id', params.datasetId).maybeSingle()
  try {
    const desc = (dsRow as { description?: string } | null)?.description
    const parsed = desc ? JSON.parse(desc) : null
    if (parsed?.start_date) dateMin = parsed.start_date
    if (parsed?.end_date) dateMax = parsed.end_date
  } catch { /* description not JSON — leave the range unset */ }

  // Overall average of the dataset's rating field — the baseline the per-theme /
  // per-dimension ratings compare against. The schema is read via the RLS user
  // client (org-enforced, like the dates); only when that succeeds do we run the
  // service-role numeric_field_stats. Optional: absent for datasets with no
  // rating-type field (open-text surveys) — the strip omits it then.
  let avgRating: number | null = null, ratingMax: number | null = null, ratingLabel: string | null = null
  try {
    const { data: stateRow } = await supabase
      .from('dataset_state').select('schema_config').eq('dataset_id', params.datasetId).maybeSingle()
    const fields = ((stateRow as { schema_config?: { fields?: Array<{ field: string; label?: string; type?: string; sqt?: string; scoreField?: boolean }> } } | null)?.schema_config?.fields) || []
    const rf = fields.find(f => f.type === 'numeric' && (f.sqt === 'rating' || f.sqt === 'nps' || f.sqt === 'likert' || f.scoreField))
    if (rf) {
      const { data: ns } = await service.rpc('numeric_field_stats', { p_dataset_id: params.datasetId, p_field_key: rf.field })
      const row = Array.isArray(ns) ? ns[0] : null
      if (row && Number(row.n) > 0 && row.avg_val != null) {
        avgRating = Math.round(Number(row.avg_val) * 100) / 100
        ratingMax = row.max_val != null ? Number(row.max_val) : null
        ratingLabel = rf.label || rf.field
      }
    }
  } catch { /* rating field not detectable — leave avgRating unset */ }

  return NextResponse.json({ ...stats, dateMin, dateMax, avgRating, ratingMax, ratingLabel })
}
