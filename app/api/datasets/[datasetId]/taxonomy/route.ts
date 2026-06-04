// app/api/datasets/[datasetId]/taxonomy/route.ts
// GET  — the tag-analytics roll-up for the in-app Taxonomy tab. Reads the
//        persisted dataset_row_taxonomy rows and returns axis/sub mention
//        rates, sentiment, and alert counts.
// POST — self-serve classifier. Runs one chunk of the keyword-tier classifier
//        over the dataset's rows starting at a cursor; the client loops until
//        `done`. Keyword-only (no AI cost), idempotent on (dataset_id, row_id).
// Both org-gated: pair the dataset's org_id (multi-tenancy invariant);
// non-admins must own the dataset.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { computeTaxonomyRollup } from '@/lib/taxonomyRollup'
import { classifyDatasetKeyword } from '@/lib/taxonomyClassify'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

// Rows scanned per POST. Keyword matching is pure-CPU and fast; the DB round
// trips dominate. 10K keeps a single chunk comfortably inside maxDuration
// while minimising the number of client round trips on large datasets.
const CHUNK = 10000

interface Params { params: Promise<{ datasetId: string }> }

/** Resolve the dataset and enforce org ownership. Returns the dataset row or a NextResponse error. */
async function gateDataset(datasetId: string, select: string) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { orgId, isAdmin } = await getCallerOrgContext(supabase)
  const { data: dataset } = await supabase
    .from('datasets').select(select).eq('id', datasetId).single()
  if (!dataset) return { error: NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 }) }
  if (!isAdmin && (dataset as any).org_id !== orgId) {
    return { error: NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 }) }
  }
  return { dataset: dataset as any }
}

export async function GET(_req: Request, props: Params) {
  const { datasetId } = await props.params
  const gate = await gateDataset(datasetId, 'org_id')
  if (gate.error) return gate.error

  const service = createServiceRoleClient()
  const rollup = await computeTaxonomyRollup({ service, datasetId, orgId: gate.dataset.org_id as string })
  return NextResponse.json(rollup)
}

export async function POST(req: Request, props: Params) {
  const { datasetId } = await props.params
  const gate = await gateDataset(datasetId, 'org_id, row_count')
  if (gate.error) return gate.error
  const { dataset } = gate

  const body = await req.json().catch(() => ({}))
  const cursor = Number.isFinite(body?.cursor) ? Math.max(0, Math.floor(body.cursor)) : 0

  const service = createServiceRoleClient()
  const r = await classifyDatasetKeyword({
    service, datasetId, orgId: dataset.org_id as string,
    brand: 'core', offset: cursor, limit: CHUNK,
  })

  return NextResponse.json({
    classifiedThisCall: r.classified,
    scanned:            r.total,
    nextCursor:         r.nextOffset,
    done:               r.reachedEnd,
    totalRows:          (dataset.row_count as number) ?? null,
  })
}
