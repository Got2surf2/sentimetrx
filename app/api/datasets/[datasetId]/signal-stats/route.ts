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

  // Overall average of the dataset's rating field — over ALL rated rows (every
  // review with a rating), NOT just the text-bearing "analyzed" subset. This is
  // the standing principle: rating numbers shown to users must tie back to what
  // they'd see on Google and in a downloaded CSV, so rating-only reviews (a star,
  // no comment) ARE counted. (Per-theme / per-dimension ratings remain text-scoped
  // by necessity — you can only attribute a theme to a review with words — so they
  // can sit slightly below this all-reviews headline; that gap is real, not a bug:
  // the people who write comments tend to rate lower.) The schema is read via the
  // RLS user client (org-enforced, like the dates); only then the service-role RPC.
  // Optional: absent for datasets with no rating-type field (open-text surveys).
  let avgRating: number | null = null, ratingMax: number | null = null, ratingLabel: string | null = null
  try {
    const { data: stateRow } = await supabase
      .from('dataset_state').select('schema_config').eq('dataset_id', params.datasetId).maybeSingle()
    const sr = stateRow as { schema_config?: { fields?: Array<{ field: string; label?: string; type?: string; sqt?: string; scoreField?: boolean; valueAliases?: Record<string, string> }> } } | null
    const fields = sr?.schema_config?.fields || []
    const rf = fields.find(f => f.type === 'numeric' && (f.sqt === 'rating' || f.sqt === 'nps' || f.sqt === 'likert' || f.scoreField))
    if (rf) {
      // A "remapped" rating field stores text labels mapped to numbers via
      // valueAliases ({"Highly Satisfied":"5",…}). Its raw value is the label,
      // so numeric_field_stats casts nothing — apply the alias map first.
      // `p_present_field: ''` = no text gate → average over all rated rows.
      const aliases = rf.valueAliases
      const isRemapped = !!aliases && typeof aliases === 'object'
        && Object.values(aliases).some(v => /^-?[0-9]+\.?[0-9]*$/.test(String(v)))
      const { data: ns } = isRemapped
        ? await service.rpc('field_aliased_avg', { p_dataset_id: params.datasetId, p_field: rf.field, p_present_field: '', p_aliases: aliases })
        : await service.rpc('numeric_field_stats', { p_dataset_id: params.datasetId, p_field_key: rf.field })
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
