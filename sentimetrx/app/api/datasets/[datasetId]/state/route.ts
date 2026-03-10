import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function serviceRole() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

type Params = { params: { datasetId: string } }

// GET /api/datasets/[datasetId]/state
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('dataset_state')
    .select('*')
    .eq('dataset_id', params.datasetId)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}

// PUT /api/datasets/[datasetId]/state
// Full replace of state record. This is the Save action.
export async function PUT(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify user has access to this dataset
  const { data: dataset } = await supabase
    .from('datasets')
    .select('id')
    .eq('id', params.datasetId)
    .single()

  if (!dataset) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const { schema_config, theme_model, saved_charts, saved_stats, filter_state } = body

  const sr = serviceRole()
  const { data, error } = await sr
    .from('dataset_state')
    .update({
      schema_config: schema_config ?? {},
      theme_model:   theme_model   ?? {},
      saved_charts:  saved_charts  ?? [],
      saved_stats:   saved_stats   ?? [],
      filter_state:  filter_state  ?? {},
      updated_at:    new Date().toISOString(),
      updated_by:    user.id,
    })
    .eq('dataset_id', params.datasetId)
    .select('id, updated_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
