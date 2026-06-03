// app/api/datasets/[datasetId]/taxonomy/route.ts
// GET — the tag-analytics roll-up for the in-app Taxonomy tab. Reads the
// persisted dataset_row_taxonomy rows and returns axis/sub mention rates,
// sentiment, and alert counts. Org-gated: pairs the dataset's org_id on the
// read (multi-tenancy invariant); non-admins must own the dataset.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { computeTaxonomyRollup } from '@/lib/taxonomyRollup'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

interface Params { params: Promise<{ datasetId: string }> }

export async function GET(_req: Request, props: Params) {
  const { datasetId } = await props.params
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orgId, isAdmin } = await getCallerOrgContext(supabase)
  const { data: dataset } = await supabase
    .from('datasets').select('org_id').eq('id', datasetId).single()
  if (!dataset) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
  if (!isAdmin && dataset.org_id !== orgId) {
    return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
  }

  const service = createServiceRoleClient()
  const rollup = await computeTaxonomyRollup({ service, datasetId, orgId: dataset.org_id as string })
  return NextResponse.json(rollup)
}
