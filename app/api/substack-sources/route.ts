// app/api/substack-sources/route.ts
// POST — create dataset + download comments from selected Substack posts

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { buildSubstackSchema, emptyThemeModel } from '@/lib/datasetUtils'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  try {
    var supabase = createClient()
    var { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    var { data: userData } = await supabase
      .from('users').select('org_id, organizations(features)')
      .eq('id', user.id).single()

    var rawOrg = userData?.organizations
    var orgData = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg as any
    if (!orgData?.features?.analyze) {
      return NextResponse.json({ error: 'Analyze module not enabled' }, { status: 403 })
    }

    var orgId = userData?.org_id
    if (!orgId) return NextResponse.json({ error: 'Org not found' }, { status: 403 })

    var body = await req.json()
    var { publication_url, dataset_name, publication_name } = body

    if (!publication_url?.trim()) return NextResponse.json({ error: 'publication_url is required' }, { status: 400 })

    var service = createServiceRoleClient()

    // Create dataset
    var dsName = (dataset_name || 'Substack: ' + (publication_name || publication_url)).trim()
    var { data: dataset, error: dsErr } = await service
      .from('datasets')
      .insert({
        name: dsName,
        description: JSON.stringify({ type: 'substack', publication: publication_url }),
        source: 'substack',
        org_id: orgId,
        created_by: user.id,
        visibility: 'private',
        status: 'active',
        row_count: 0,
      })
      .select('id')
      .single()

    if (dsErr || !dataset) return NextResponse.json({ error: dsErr?.message || 'Failed to create dataset' }, { status: 500 })

    // Create dataset_state with Substack schema
    var schema = buildSubstackSchema()
    await service.from('dataset_state').insert({
      dataset_id: dataset.id,
      schema_config: schema,
      theme_model: emptyThemeModel(),
      saved_charts: [],
      saved_stats: [],
      filter_state: {},
      updated_by: user.id,
    })

    return NextResponse.json({
      dataset_id: dataset.id,
      status: 'created',
    }, { status: 201 })
  } catch (err: any) {
    console.error('[substack-sources] create error:', err)
    return NextResponse.json({ error: err?.message || 'Failed to create substack source' }, { status: 500 })
  }
}
