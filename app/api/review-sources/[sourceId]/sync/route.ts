// app/api/review-sources/[sourceId]/sync/route.ts
// POST — manually trigger a review sync for a source

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { syncReviewSource } from '@/lib/reviewSync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface Params { params: { sourceId: string } }

export async function POST(_req: Request, { params }: Params) {
  try {
    const supabase = createClient()
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
      .select('id')
      .eq('id', params.sourceId)
      .eq('org_id', orgId)
      .single()
    if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const result = await syncReviewSource(params.sourceId, service)

    return NextResponse.json(result)
  } catch (err: any) {
    console.error('[review-sources/sync] error:', err)
    return NextResponse.json({ error: err?.message || 'Sync failed' }, { status: 500 })
  }
}
