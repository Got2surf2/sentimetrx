// app/api/collections/route.ts
// POST /api/collections — create a new collection (virtual grouped dataset)
//
// Body: { name, members: [{ dataset_id, label }] }
// Creates: dataset (source='collection') + collection record + member records + merged schema

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { emptyThemeModel } from '@/lib/datasetUtils'
import type { SchemaFieldConfig, SchemaConfig } from '@/lib/analyzeTypes'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orgId: callerOrgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!callerOrgId) return NextResponse.json({ error: 'Org not found' }, { status: 403 })

  // Feature gate uses the caller's own org features (not the target org).
  const { data: callerOrgRow } = await supabase
    .from('organizations').select('features').eq('id', callerOrgId).single()
  if (!(callerOrgRow as any)?.features?.analyze) {
    return NextResponse.json({ error: 'Analyze module not enabled' }, { status: 403 })
  }

  const body = await req.json()
  const { name, members } = body as { name: string; members: { dataset_id: string; label: string }[] }

  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!Array.isArray(members) || members.length < 2) {
    return NextResponse.json({ error: 'At least 2 datasets are required' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  // Fetch all member datasets without an upfront org filter; we need
  // to inspect their org_ids to enforce the same-org rule and decide
  // where the collection lives.
  const memberIds = members.map(function(m) { return m.dataset_id })
  const { data: memberDatasets, error: memErr } = await service
    .from('datasets')
    .select('id, name, row_count, source, org_id')
    .in('id', memberIds)

  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 })
  if (!memberDatasets || memberDatasets.length !== memberIds.length) {
    return NextResponse.json({ error: 'One or more datasets not found' }, { status: 400 })
  }

  // All members must share a single org — that org becomes the
  // collection's home. Mixing orgs is rejected because the resulting
  // collection couldn't legitimately belong to any one tenant.
  const orgIds = Array.from(new Set(memberDatasets.map((d: any) => d.org_id).filter(Boolean)))
  if (orgIds.length === 0) {
    return NextResponse.json({ error: 'Member datasets have no org_id' }, { status: 400 })
  }
  if (orgIds.length > 1) {
    return NextResponse.json({ error: 'All collection members must belong to the same organization' }, { status: 400 })
  }
  const collectionOrgId = orgIds[0] as string

  // Authorize: non-admins can only build collections in their own org.
  // Admins (Phase E) can build a collection in any org's home.
  if (!isAdmin && collectionOrgId !== callerOrgId) {
    return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
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

  // 1. Create dataset record in the collection's home org (members' org).
  //    For non-admin callers this equals callerOrgId by the check above;
  //    for admins building cross-org collections it's the target org.
  const { data: dataset, error: dsErr } = await service
    .from('datasets')
    .insert({
      name:        name.trim(),
      description: 'Collection of ' + members.length + ' datasets',
      source:      'collection',
      org_id:      collectionOrgId,
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
      org_id:     collectionOrgId,
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
