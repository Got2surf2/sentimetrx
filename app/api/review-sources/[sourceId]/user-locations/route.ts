// app/api/review-sources/[sourceId]/user-locations/route.ts
// GET    — list user-location assignments for this source
// POST   — assign user to locations
// DELETE — remove user-location assignments

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ sourceId: string }> }

export async function GET(_req: Request, props: Params) {
  const params = await props.params;
  try {
    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: userData } = await supabase
      .from('users').select('org_id, role, organizations(is_admin_org)').eq('id', user.id).single()
    if (!userData?.org_id) return NextResponse.json({ error: 'Org not found' }, { status: 403 })
    const orgRel = (userData as any)?.organizations
    const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!(orgRel as any)?.is_admin_org

    // Only owners/admins can view all assignments
    if (!['owner', 'admin', 'platform_admin'].includes(userData.role || '')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const service = createServiceRoleClient()

    // Verify source belongs to org (admin-org bypass)
    const { data: source } = await service
      .from('review_sources').select('id, org_id').eq('id', params.sourceId).single()
    if (!source || (!isAdmin && (source as any).org_id !== userData.org_id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const { data: assignments, error } = await service
      .from('user_locations')
      .select('id, user_id, location_id, review_source_locations(name, city, state), users(email, full_name)')
      .eq('review_source_id', params.sourceId)

    if (error) return serverError(error, 'reviewSources.userLocations.list', { orgId: userData.org_id })

    return NextResponse.json({ assignments: assignments || [] })
  } catch (err: any) {
    return serverError(err, 'reviewSources.userLocations.list')
  }
}

export async function POST(req: Request, props: Params) {
  const params = await props.params;
  try {
    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: userData } = await supabase
      .from('users').select('org_id, role, organizations(is_admin_org)').eq('id', user.id).single()
    if (!userData?.org_id) return NextResponse.json({ error: 'Org not found' }, { status: 403 })
    const orgRel = (userData as any)?.organizations
    const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!(orgRel as any)?.is_admin_org

    if (!['owner', 'admin', 'platform_admin'].includes(userData.role || '')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const service = createServiceRoleClient()

    // Verify source belongs to org (admin-org bypass — admins can manage cross-org)
    const { data: source } = await service
      .from('review_sources').select('id, org_id').eq('id', params.sourceId).single()
    if (!source || (!isAdmin && (source as any).org_id !== userData.org_id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const sourceOrgId = (source as any).org_id as string

    const body = await req.json()
    const { user_id, location_ids } = body

    if (!user_id || !location_ids?.length) {
      return NextResponse.json({ error: 'user_id and location_ids are required' }, { status: 400 })
    }

    // Target user must belong to the source's org (admin can assign across orgs
    // but the assignment must still be within a single org boundary)
    const { data: targetUser } = await service
      .from('users').select('org_id').eq('id', user_id).single()
    if (targetUser?.org_id !== sourceOrgId) {
      return NextResponse.json({ error: 'User not in this source\'s organization' }, { status: 400 })
    }

    const rows = location_ids.map(function(lid: string) {
      return {
        user_id,
        review_source_id: params.sourceId,
        location_id: lid,
      }
    })

    const { error } = await service
      .from('user_locations')
      .upsert(rows, { onConflict: 'user_id,location_id' })

    if (error) return serverError(error, 'reviewSources.userLocations.assign', { orgId: userData.org_id })

    return NextResponse.json({ ok: true, assigned: location_ids.length }, { status: 201 })
  } catch (err: any) {
    return serverError(err, 'reviewSources.userLocations.assign')
  }
}

export async function DELETE(req: Request, props: Params) {
  const params = await props.params;
  try {
    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: userData } = await supabase
      .from('users').select('org_id, role').eq('id', user.id).single()
    if (!userData?.org_id) return NextResponse.json({ error: 'Org not found' }, { status: 403 })

    if (!['owner', 'admin', 'platform_admin'].includes(userData.role || '')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const body = await req.json()
    const { user_id, location_ids } = body

    if (!user_id) return NextResponse.json({ error: 'user_id is required' }, { status: 400 })

    const service = createServiceRoleClient()

    let query = service
      .from('user_locations')
      .delete()
      .eq('review_source_id', params.sourceId)
      .eq('user_id', user_id)

    // If specific location_ids provided, only delete those; otherwise remove all for this user+source
    if (location_ids?.length) {
      query = query.in('location_id', location_ids)
    }

    const { error } = await query
    if (error) return serverError(error, 'reviewSources.userLocations.remove', { orgId: userData.org_id })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return serverError(err, 'reviewSources.userLocations.remove')
  }
}
