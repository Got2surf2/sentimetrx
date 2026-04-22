// app/api/collections/[id]/route.ts
// GET /api/collections/[id] — returns collection members with their existing theme models
// The [id] here is the collection's dataset_id (not the collections table id)

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface Props { params: { id: string } }

export async function GET(_req: Request, { params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  const orgId = userData?.org_id
  if (!orgId) return NextResponse.json({ error: 'Org not found' }, { status: 403 })

  const service = createServiceRoleClient()

  // Look up collection by its dataset_id
  const { data: collection } = await service
    .from('collections')
    .select('id')
    .eq('dataset_id', params.id)
    .eq('org_id', orgId)
    .single()

  if (!collection) return NextResponse.json({ error: 'Collection not found' }, { status: 404 })

  // Fetch members with their dataset names and theme models
  const { data: members } = await service
    .from('collection_members')
    .select('dataset_id, label, sort_order')
    .eq('collection_id', collection.id)
    .order('sort_order', { ascending: true })

  if (!members?.length) return NextResponse.json({ members: [] })

  // Fetch theme models for each member dataset
  const memberIds = members.map(function(m) { return m.dataset_id })
  const { data: states } = await service
    .from('dataset_state')
    .select('dataset_id, theme_model')
    .in('dataset_id', memberIds)

  const stateMap: Record<string, any> = {}
  ;(states || []).forEach(function(s) { stateMap[s.dataset_id] = s.theme_model })

  const enriched = members.map(function(m) {
    var tm = stateMap[m.dataset_id] || null
    return {
      dataset_id: m.dataset_id,
      label: m.label,
      theme_model: tm,
      has_themes: !!(tm && tm.themes && tm.themes.length > 0),
    }
  })

  return NextResponse.json({ members: enriched })
}
