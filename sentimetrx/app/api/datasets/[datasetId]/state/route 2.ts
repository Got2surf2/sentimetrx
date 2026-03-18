// app/api/datasets/[datasetId]/state/route.ts
// GET -- full dataset_state record
// PUT -- replace entire state (the "Save" action)

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface Params { params: { datasetId: string } }

async function authCheck(supabase: ReturnType<typeof createClient>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null }
  return { user }
}

export async function GET(_req: Request, { params }: Params) {
  const supabase = createClient()
  const { user } = await authCheck(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('dataset_state')
    .select('*')
    .eq('dataset_id', params.datasetId)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json({ state: data })
}

export async function PUT(req: Request, { params }: Params) {
  const supabase = createClient()
  const { user } = await authCheck(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { schema_config, theme_model, saved_charts, saved_stats, filter_state } = body

  const service = createServiceRoleClient()
  const { error } = await service
    .from('dataset_state')
    .update({
      schema_config: schema_config,
      theme_model:   theme_model,
      saved_charts:  saved_charts || [],
      saved_stats:   saved_stats  || [],
      filter_state:  filter_state || {},
      updated_at:    new Date().toISOString(),
      updated_by:    user.id,
    })
    .eq('dataset_id', params.datasetId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
