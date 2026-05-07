// app/api/collections/route.ts
// POST /api/collections — create a new collection (virtual grouped dataset)
//
// Body: { name, members: [{ dataset_id, label }] }
// Creates: dataset (source='collection') + collection record + member records + merged schema

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { emptyThemeModel } from '@/lib/datasetUtils'
import type { SchemaFieldConfig, SchemaConfig } from '@/lib/analyzeTypes'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const supabase = createClient()
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

  const orgId = userData?.org_id as string
  if (!orgId) return NextResponse.json({ error: 'Org not found' }, { status: 403 })

  const body = await req.json()
  const { name, members } = body as { name: string; members: { dataset_id: string; label: string }[] }

  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!Array.isArray(members) || members.length < 2) {
    return NextResponse.json({ error: 'At least 2 datasets are required' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  // Verify all member datasets exist and belong to this org
  const memberIds = members.map(function(m) { return m.dataset_id })
  const { data: memberDatasets, error: memErr } = await service
    .from('datasets')
    .select('id, name, row_count, source')
    .in('id', memberIds)
    .eq('org_id', orgId)

  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 })
  if (!memberDatasets || memberDatasets.length !== memberIds.length) {
    return NextResponse.json({ error: 'One or more datasets not found or not in your org' }, { status: 400 })
  }

  // Compute total row count across members
  const totalRows = memberDatasets.reduce(function(sum, d) { return sum + (d.row_count || 0) }, 0)

  // Build merged schema from all member schemas
  const schemaResults = await Promise.all(memberIds.map(function(id) {
    return service.from('dataset_state').select('schema_config').eq('dataset_id', id).single()
  }))

  const fieldMap: Record<string, SchemaFieldConfig> = {}
  // Always add the collection label field first
  fieldMap['_collection_label'] = {
    field: '_collection_label',
    type: 'categorical',
    label: 'Source Dataset',
    section: 'core',
  }

  for (var i = 0; i < schemaResults.length; i++) {
    var sc = schemaResults[i].data?.schema_config as SchemaConfig | null
    if (!sc?.fields) continue
    for (var j = 0; j < sc.fields.length; j++) {
      var f = sc.fields[j]
      if (!fieldMap[f.field]) {
        fieldMap[f.field] = { ...f }
      }
    }
  }

  var mergedSchema: SchemaConfig = {
    fields: Object.values(fieldMap),
    primaryTextField: undefined,
    autoDetected: false,
    version: 1,
  }

  // Find a primary text field from member schemas
  for (var k = 0; k < schemaResults.length; k++) {
    var sc2 = schemaResults[k].data?.schema_config as SchemaConfig | null
    if (sc2?.primaryTextField) {
      mergedSchema.primaryTextField = sc2.primaryTextField
      break
    }
  }

  // 1. Create dataset record
  const { data: dataset, error: dsErr } = await service
    .from('datasets')
    .insert({
      name:        name.trim(),
      description: 'Collection of ' + members.length + ' datasets',
      source:      'collection',
      org_id:      orgId,
      created_by:  user.id,
      visibility:  'private',
      status:      'active',
      row_count:   totalRows,
    })
    .select('id')
    .single()

  if (dsErr) return NextResponse.json({ error: dsErr.message }, { status: 500 })

  // 2. Create dataset_state with merged schema
  const { error: stErr } = await service
    .from('dataset_state')
    .insert({
      dataset_id:    dataset.id,
      schema_config: mergedSchema,
      theme_model:   emptyThemeModel(),
      saved_charts:  [],
      saved_stats:   [],
      filter_state:  {},
      updated_by:    user.id,
    })

  if (stErr) console.error('[collections] state insert error:', stErr.message)

  // 3. Create collection record
  const { data: collection, error: colErr } = await service
    .from('collections')
    .insert({
      dataset_id: dataset.id,
      org_id:     orgId,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (colErr) return NextResponse.json({ error: colErr.message }, { status: 500 })

  // 4. Create member records
  const memberRows = members.map(function(m, idx) {
    return {
      collection_id: collection.id,
      dataset_id:    m.dataset_id,
      label:         m.label.trim(),
      sort_order:    idx,
    }
  })

  const { error: memInsErr } = await service
    .from('collection_members')
    .insert(memberRows)

  if (memInsErr) return NextResponse.json({ error: memInsErr.message }, { status: 500 })

  return NextResponse.json({ id: dataset.id, collection_id: collection.id }, { status: 201 })
}
