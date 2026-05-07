// app/api/datasets/[datasetId]/user-location-filter/route.ts
// GET — returns the current user's allowed location names for a google_reviews dataset
// Returns { locations: string[] } or { locations: null } (null = no restriction / admin)

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface Params { params: { datasetId: string } }

export async function GET(_req: Request, { params }: Params) {
  try {
    const supabase = createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: userData } = await supabase
      .from('users').select('org_id, role').eq('id', user.id).single()
    if (!userData?.org_id) return NextResponse.json({ error: 'Org not found' }, { status: 403 })

    // Owners, admins, platform admins see everything
    if (['owner', 'admin', 'platform_admin'].includes(userData.role || '')) {
      return NextResponse.json({ locations: null })
    }

    const service = createServiceRoleClient()

    // Find the review source linked to this dataset
    const { data: source } = await service
      .from('review_sources')
      .select('id')
      .eq('dataset_id', params.datasetId)
      .eq('org_id', userData.org_id)
      .single()

    // Not a google_reviews dataset or no source found — no restriction
    if (!source) return NextResponse.json({ locations: null })

    // Check if user has location assignments
    const { data: assignments } = await service
      .from('user_locations')
      .select('location_id, review_source_locations(name, city, state)')
      .eq('user_id', user.id)
      .eq('review_source_id', source.id)

    // No assignments = no restriction (user hasn't been scoped yet)
    if (!assignments || assignments.length === 0) {
      return NextResponse.json({ locations: null })
    }

    // Build location labels matching the format used in review rows
    const locationNames = assignments.map(function(a: any) {
      const loc = Array.isArray(a.review_source_locations)
        ? a.review_source_locations[0]
        : a.review_source_locations
      if (!loc) return ''
      const parts = [loc.name]
      if (loc.city && loc.state) parts.push(`${loc.city}, ${loc.state}`)
      else if (loc.city) parts.push(loc.city)
      else if (loc.state) parts.push(loc.state)
      return parts.join(' - ')
    }).filter(Boolean)

    return NextResponse.json({ locations: locationNames })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 })
  }
}
