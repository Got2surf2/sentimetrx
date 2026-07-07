// app/api/review-sources/[sourceId]/sync/route.ts
// POST — manually trigger a review sync for a source

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { serverError } from '@/lib/apiError'
import { syncReviewSource } from '@/lib/reviewSync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface Params { params: Promise<{ sourceId: string }> }

export async function POST(_req: Request, props: Params) {
  const params = await props.params;
  try {
    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: userData } = await supabase
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    const orgId = userData?.org_id
    if (!orgId) return NextResponse.json({ error: 'Org not found' }, { status: 403 })

    const service = createServiceRoleClient()

    // Verify ownership
    const { data: source } = await service
      .from('review_sources')
      .select('id, status')
      .eq('id', params.sourceId)
      .eq('org_id', orgId)
      .single()
    if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // A paused source must not be synced (no DataForSEO spend, no re-ingest).
    if (source.status === 'paused') {
      return NextResponse.json({ error: 'Source is paused' }, { status: 409 })
    }

    const result = await syncReviewSource(params.sourceId, service)

    return NextResponse.json(result)
  } catch (err: unknown) {
    return serverError(err, 'reviewSources.sync')
  }
}
