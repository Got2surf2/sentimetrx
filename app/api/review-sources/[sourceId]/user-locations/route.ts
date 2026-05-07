// app/api/review-sources/[sourceId]/user-locations/route.ts
// GET    — list user-location assignments for this source
// POST   — assign user to locations
// DELETE — remove user-location assignments

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface Params { params: { sourceId: string } }

export async function GET(_req: Request, { params }: Params) {
  try {
    const supabase = createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: userData } = await supabase
      .from('users').select('org_id, role').eq('id', user.id).single()
    if (!userData?.org_id) return NextResponse.json({ error: 'Org not found' }, { status: 403 })

    // Only owners/admins can view all assignments
    if (!['owner', 'admin', 'platform_admin'].includes(userData.role || '')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const service = createServiceRoleClient()

    // Verify source belongs to org
    const { data: source } = await service
      .from('review_sources').select('id').eq('id', params.sourceId).eq('org_id', userData.org_id).single()
    if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { data: assignments, error } = await service
      .from('user_locations')
      .select('id, user_id, location_id, review_source_locations(name, city, state), users(email, full_name)')
      .eq('review_source_id', params.sourceId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ assignments: assignments || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 })
  }
}

export async function POST(req: Request, { params }: Params) {
  try {
    const supabase = createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: userData } = await supabase
      .from('users').select('org_id, role').eq('id', user.id).single()
    if (!userData?.org_id) return NextResponse.json({ error: 'Org not found' }, { status: 403 })

    if (!['owner', 'admin', 'platform_admin'].includes(userData.role || '')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const service = createServiceRoleClient()

    // Verify source belongs to org
    const { data: source } = await service
      .from('review_sources').select('id').eq('id', params.sourceId).eq('org_id', userData.org_id).single()
    if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json()
    const { user_id, location_ids } = body

    if (!user_id || !location_ids?.length) {
      return NextResponse.json({ error: 'user_id and location_ids are required' }, { status: 400 })
    }

    // Verify target user is in same org
    const { data: targetUser } = await service
      .from('users').select('org_id').eq('id', user_id).single()
    if (targetUser?.org_id !== userData.org_id) {
      return NextResponse.json({ error: 'User not in your organization' }, { status: 400 })
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

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, assigned: location_ids.length }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: Params) {
  try {
    const supabase = createClient()
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
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 })
  }
}
