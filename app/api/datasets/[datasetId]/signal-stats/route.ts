// app/api/datasets/[datasetId]/signal-stats/route.ts
// Returns cache-aware signal stats for a single dataset.
// All computation + caching logic lives in lib/signalStats.ts so the
// batch endpoint at /api/datasets/signal-stats-batch reuses it.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { computeSignalStats } from '@/lib/signalStats'

interface Props { params: { datasetId: string } }

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(_req: Request, { params }: Props) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const stats = await computeSignalStats(service, params.datasetId)
  return NextResponse.json(stats)
}
