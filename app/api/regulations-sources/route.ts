// POST — create a dataset from a regulations.gov docket
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { buildRegulationsSchema, emptyThemeModel } from '@/lib/datasetUtils'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  if (!userData?.org_id) return NextResponse.json({ error: 'Org not found' }, { status: 403 })

  const body = await req.json()
  const { dataset_name, docket_id, docket_title, agency, comment_count, brand_tag } = body
  if (!dataset_name || !docket_id) return NextResponse.json({ error: 'dataset_name and docket_id required' }, { status: 400 })

  const service = createServiceRoleClient()

  // Store download progress in description so the UI can resume
  const downloadMeta = {
    docket_id,
    docket_title,
    agency,
    comment_count: comment_count || 0,
    download_status: 'downloading',
    next_page: 1,
  }

  // Create dataset
  const { data: dataset, error: dsErr } = await service.from('datasets').insert({
    name: dataset_name,
    org_id: userData.org_id,
    created_by: user.id,
    source: 'regulations',
    row_count: 0,
    description: JSON.stringify(downloadMeta),
    brand_tag: (brand_tag && brand_tag.trim()) || null,
  }).select('id').single()
  if (dsErr) return NextResponse.json({ error: dsErr.message }, { status: 500 })

  // Create dataset_state with schema
  const schema = buildRegulationsSchema()
  await service.from('dataset_state').insert({
    dataset_id: dataset.id,
    schema_config: schema,
    theme_model: emptyThemeModel(),
  })

  return NextResponse.json({ dataset_id: dataset.id })
}
