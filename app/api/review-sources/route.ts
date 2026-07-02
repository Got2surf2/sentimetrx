// app/api/review-sources/route.ts
// GET  /api/review-sources — list all review sources for user's org
// POST /api/review-sources — create a new review source + dataset + kick off initial sync

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { serverError } from '@/lib/apiError'
import { emptySchemaConfig, emptyThemeModel } from '@/lib/datasetUtils'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  try {
    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: userData } = await supabase
      .from('users')
      .select('org_id, organizations(features)')
      .eq('id', user.id)
      .single()

    const rawOrg  = userData?.organizations
    const orgData = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg as any
    if (!orgData?.features?.analyze) {
      return NextResponse.json({ error: 'Analyze module not enabled' }, { status: 403 })
    }

    const orgId = userData?.org_id
    if (!orgId) return NextResponse.json({ error: 'Org not found' }, { status: 403 })

    const service = createServiceRoleClient()
    const { data: sources, error } = await service
      .from('review_sources')
      .select('*, review_source_locations(count)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })

    if (error) return serverError(error, 'reviewSources.list', { orgId })

    return NextResponse.json({ sources: sources || [] })
  } catch (err: any) {
    return serverError(err, 'reviewSources.list')
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: userData } = await supabase
      .from('users')
      .select('org_id, organizations(features)')
      .eq('id', user.id)
      .single()

    const rawOrg  = userData?.organizations
    const orgData = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg as any
    if (!orgData?.features?.analyze) {
      return NextResponse.json({ error: 'Analyze module not enabled' }, { status: 403 })
    }

    const orgId = userData?.org_id
    if (!orgId) return NextResponse.json({ error: 'Org not found' }, { status: 403 })

    const body = await req.json()
    const { brand_name, locations, dataset_name, sync_frequency_hours, start_date, end_date, brand_tag } = body

    if (!brand_name?.trim()) return NextResponse.json({ error: 'brand_name is required' }, { status: 400 })
    if (!locations?.length) return NextResponse.json({ error: 'At least one location is required' }, { status: 400 })

    // Platform the reviews are pulled from. dataset.source stays 'google_reviews'
    // for every review-sync dataset — it's the discriminator the analyze UI keys
    // off; the authoritative platform lives on review_sources.source.
    const platform: 'google' | 'tripadvisor' = body.source === 'tripadvisor' ? 'tripadvisor' : 'google'

    const service = createServiceRoleClient()

    // 1. Create dataset
    const dsName = (dataset_name || `${brand_name.trim()} Reviews`).trim()
    const { data: dataset, error: dsErr } = await service
      .from('datasets')
      .insert({
        name:        dsName,
        description: JSON.stringify({ type: 'google_reviews', platform, brand: brand_name.trim(), locations: locations.length, start_date: start_date || null, end_date: end_date || null }),
        source:      'google_reviews',
        org_id:      orgId,
        created_by:  user.id,
        visibility:  'private',
        status:      'active',
        row_count:   0,
        // A Google Reviews dataset always has a brand — default the brand
        // tag to the brand name so it lands in a brand-collection.
        brand_tag:   (brand_tag && brand_tag.trim()) || brand_name.trim(),
      })
      .select('id')
      .single()

    if (dsErr) return serverError(dsErr, 'reviewSources.create.dataset', { orgId })

    // 2. Create dataset_state
    await service.from('dataset_state').insert({
      dataset_id:    dataset.id,
      schema_config: emptySchemaConfig(),
      theme_model:   emptyThemeModel(),
      saved_charts:  [],
      saved_stats:   [],
      filter_state:  {},
      updated_by:    user.id,
    })

    // 3. Create review source
    const { data: source, error: srcErr } = await service
      .from('review_sources')
      .insert({
        org_id:                orgId,
        dataset_id:            dataset.id,
        brand_name:            brand_name.trim(),
        source:                platform,
        status:                'pending',
        sync_frequency_hours:  sync_frequency_hours || 24,
        created_by:            user.id,
      })
      .select('id')
      .single()

    if (srcErr) return serverError(srcErr, 'reviewSources.create.source', { orgId })

    // 4. Insert all locations — dedupe by place_id first. Location discovery can
    // return the same physical place twice (e.g. a legacy + current Google listing
    // sharing a place_id), which would violate the UNIQUE(review_source_id, place_id)
    // constraint and fail the whole insert. Keep the first occurrence of each place_id.
    const seenPlaceIds = new Set<string>()
    const locationRows = locations.reduce(function(rows: any[], loc: any) {
      if (!loc.place_id || seenPlaceIds.has(loc.place_id)) return rows
      seenPlaceIds.add(loc.place_id)
      rows.push({
        review_source_id: source.id,
        place_id:         loc.place_id,
        name:             loc.name || '',
        address:          loc.address || null,
        city:             loc.city || null,
        state:            loc.state || null,
        zip:              loc.zip || null,
        rating:           loc.rating ?? null,
        review_count:     loc.review_count || 0,
        selected:         true,
      })
      return rows
    }, [])

    const { error: locErr } = await service
      .from('review_source_locations')
      .insert(locationRows)

    if (locErr) return serverError(locErr, 'reviewSources.create.locations', { orgId })

    // 5. Mark source as active with immediate sync — cron or UI polling will pick it up
    await service.from('review_sources').update({
      status: 'active',
      next_sync_at: new Date().toISOString(),
    }).eq('id', source.id)

    return NextResponse.json({
      source_id:  source.id,
      dataset_id: dataset.id,
      locations:  locations.length,
      status:     'active',
    }, { status: 201 })
  } catch (err: any) {
    return serverError(err, 'reviewSources.create')
  }
}
