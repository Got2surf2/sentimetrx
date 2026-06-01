// app/api/bots/[id]/entities/route.ts
// GET — list entity_catalog rows for a bot (scope_type='bot', scope_id=botId).
// Powers /bots/[id]/entities (docs/BOTS.md § 9.y.4).
//
// Returns visible rows by default; pass ?include_hidden=1 to include
// hidden=true entries (admin "show hidden" toggle).
//
// Service role + paired (id, org_id) check on the agent row per CLAUDE.md
// multi-tenancy invariants. Same gate pattern as the questions route.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

interface Params { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()

  const { data: bot } = await service.from('agents').select('id, org_id').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  if (!isAdmin && (bot as any).org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const includeHidden = req.nextUrl.searchParams.get('include_hidden') === '1'

  let query = service
    .from('entity_catalog')
    .select('id, canonical, slug, category, aliases, sample_count, source, hidden, first_seen_at, last_seen_at')
    .eq('scope_type', 'bot')
    .eq('scope_id', params.id)
    .order('sample_count', { ascending: false })

  if (!includeHidden) query = query.eq('hidden', false)

  const { data: rows, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Latest refresh metadata for the "Last extracted" header strip.
  const { data: lastRefresh } = await service
    .from('entity_catalog_refresh')
    .select('triggered_at, entities_before, entities_after, entities_new, haiku_cost_est_cents, sample_size, duration_ms')
    .eq('scope_type', 'bot')
    .eq('scope_id', params.id)
    .order('triggered_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Hidden count surface for the "Including hidden (N)" toggle label.
  const { count: hiddenCount } = await service
    .from('entity_catalog')
    .select('id', { count: 'exact', head: true })
    .eq('scope_type', 'bot')
    .eq('scope_id', params.id)
    .eq('hidden', true)

  return NextResponse.json({
    entities: rows || [],
    hidden_count: hiddenCount || 0,
    last_refresh: lastRefresh || null,
  })
}
