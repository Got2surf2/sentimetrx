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

  return NextResponse.json({ ...stats, dateMin, dateMax })
}
