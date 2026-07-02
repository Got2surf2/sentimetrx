// app/api/review-sources/[sourceId]/locations/route.ts
// PATCH — clear error messages on failed locations so they can be retried

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ sourceId: string }> }

export async function PATCH(req: Request, props: Params) {
  const params = await props.params;
  try {
    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: userData } = await supabase
      .from('users').select('org_id').eq('id', user.id).single()
    if (!userData?.org_id) return NextResponse.json({ error: 'Org not found' }, { status: 403 })

    const service = createServiceRoleClient()

    const { data: source } = await service
      .from('review_sources').select('id').eq('id', params.sourceId).eq('org_id', userData.org_id).single()
    if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json()

    if (body.clear_errors) {
      await service
        .from('review_source_locations')
        .update({ error_message: null })
        .eq('review_source_id', params.sourceId)
        .not('error_message', 'is', null)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'No action specified' }, { status: 400 })
  } catch (err: any) {
    return serverError(err, 'reviewSources.locations.update')
  }
}
