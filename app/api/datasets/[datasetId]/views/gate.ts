// Shared org-access gate for the saved-views routes. Mirrors the dataset_state
// route: resolve the caller, then refuse a cross-org dataset before any read or
// service-role write. Returns the dataset's own org_id so saved_views queries
// can pair id+org_id (the multi-tenancy invariant) and still work for admins.

import { NextResponse } from 'next/server'
import type { createClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'

const NOT_AVAILABLE = "This resource isn't available to your account."

export interface GateOk {
  userId: string
  orgId: string
  isAdmin: boolean
  datasetOrgId: string
}

export async function gateDataset(
  supabase: Awaited<ReturnType<typeof createClient>>,
  datasetId: string,
): Promise<NextResponse | GateOk> {
  const ctx = await getCallerOrgContext(supabase)
  if (!ctx.userId || !ctx.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: dataset } = await supabase.from('datasets').select('org_id').eq('id', datasetId).single()
  if (!dataset) return NextResponse.json({ error: NOT_AVAILABLE }, { status: 404 })
  if (!ctx.isAdmin && dataset.org_id !== ctx.orgId) return NextResponse.json({ error: NOT_AVAILABLE }, { status: 404 })

  return { userId: ctx.userId, orgId: ctx.orgId, isAdmin: ctx.isAdmin, datasetOrgId: dataset.org_id as string }
}

export { NOT_AVAILABLE }
