// app/api/datasets/[datasetId]/aggregate/route.ts
// Server-side aggregation for charts — eliminates fetching all rows to browser.
// Uses SQL functions on dataset_rows_flat for O(1) chart rendering at any scale.
// The op dispatcher lives in lib/aggregateOps (shared with Ana's query_data
// tool) — this route is auth + parse + dispatch.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { serverError } from '@/lib/apiError'
import { runAggregateOp, type AggregateOpBody } from '@/lib/aggregateOps'

type Params = { params: Promise<{ datasetId: string }> }

async function authCheck(supabase: Awaited<ReturnType<typeof createClient>>) {
  const ctx = await getCallerOrgContext(supabase)
  return { user: ctx.userId ? { id: ctx.userId } : null, orgId: ctx.orgId, isAdmin: ctx.isAdmin }
}

// Aggregation RPCs are O(N) scans; on large datasets a burst of chart specs
// can outlive the default function budget even though each statement stays
// under the DB's 8s timeout. Same budget as the peer dataset routes.
export const maxDuration = 60

export async function POST(req: Request, props: Params) {
  const params = await props.params;
  var supabase = await createClient()
  var auth = await authCheck(supabase)
  if (!auth.user || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  var { data: dsCheck } = await supabase.from('datasets').select('org_id, row_count, source').eq('id', params.datasetId).single()
  if (!dsCheck) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
  if (!auth.isAdmin && dsCheck.org_id !== auth.orgId) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })

  var body: AggregateOpBody
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  var service = createServiceRoleClient()
  var result = await runAggregateOp(
    service,
    params.datasetId,
    { rowCount: Number((dsCheck as { row_count?: number }).row_count) || 0, source: (dsCheck as { source?: string }).source || '' },
    body,
  )
  if (result.errAt) return serverError(result.errRaw, result.errAt, { orgId: auth.orgId })
  return NextResponse.json(result.body, { status: result.status })
}
