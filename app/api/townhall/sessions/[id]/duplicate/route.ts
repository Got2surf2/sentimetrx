// app/api/townhall/sessions/[id]/duplicate/route.ts
// POST — duplicate a Town Hall session (copies config + discussion guide into new setup session)

import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

interface Params { params: { id: string } }

export async function POST(_req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceRoleClient()

  // Fetch the source session
  const { data: source } = await db
    .from('townhall_sessions')
    .select('name, config, discussion_guide, org_id')
    .eq('id', params.id)
    .single()

  if (!source) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  // Strip archived flag if present
  const config = { ...source.config }
  delete config.archived

  // Create duplicate
  const { data, error } = await db
    .from('townhall_sessions')
    .insert({
      org_id: source.org_id,
      created_by: user.id,
      name: source.name + ' (Copy)',
      config,
      discussion_guide: source.discussion_guide,
      status: 'setup',
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
