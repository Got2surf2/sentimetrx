// app/api/datasets/signal-stats-batch/route.ts
// Batch signal-stats endpoint for the /analyze listing page. Avoids
// the N+1 of one fetch per card by doing the lookups server-side in
// parallel, with cache reads bypassing the heavy SQL for any dataset
// whose theme model hasn't changed since last compute.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { computeSignalStats, type SignalStats } from '@/lib/signalStats'

export const dynamic = 'force-dynamic'
// Some uncached datasets can each take 1-4s; with 20 datasets running
// in parallel the worst case is ~5-10s on a cold listing page. Cap at
// 90s so an outlier slow row doesn't drop the whole batch.
export const maxDuration = 90

interface BatchBody { ids?: unknown }

export async function POST(req: Request) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: BatchBody
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : []
  if (ids.length === 0) return NextResponse.json({ stats: {} })

  // Cap at 50 per call to keep the worst-case scan bounded. Listing
  // pages don't typically exceed this; if a user has more we batch
  // client-side.
  const capped = ids.slice(0, 50)
  const service = createServiceRoleClient()

  const results = await Promise.all(
    capped.map(async (id): Promise<[string, SignalStats | null]> => {
      try {
        const s = await computeSignalStats(service, id)
        return [id, s]
      } catch {
        return [id, null]
      }
    }),
  )

  const stats: Record<string, SignalStats> = {}
  for (const [id, s] of results) {
    if (s) stats[id] = s
  }
  return NextResponse.json({ stats })
}
