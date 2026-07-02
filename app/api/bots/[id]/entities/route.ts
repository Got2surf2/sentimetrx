// app/api/bots/[id]/entities/route.ts
// GET — list entity_catalog rows for a bot (scope_type='bot', scope_id=botId).
// Powers /bots/[id]/entities (docs/BOTS.md § 9.y.4).
//
// Returns visible rows by default; pass ?include_hidden=1 to include
// hidden=true entries (admin "show hidden" toggle).
//
// Service role + paired (id, org_id) check on the agent row per CLAUDE.md
// multi-tenancy invariants. Same gate pattern as the questions route.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { serverError } from '@/lib/apiError'
import { slugify } from '@/lib/entityFilter'
import { rollupAgentEntitiesToBrand } from '@/lib/correction/rollup'
import { mergeProvenance, type Provenance } from '@/lib/correction/provenance'

const ENTITY_FIELDS = 'id, canonical, slug, category, aliases, sample_count, source, hidden, first_seen_at, last_seen_at'

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
  if (error) return serverError(error, 'bots.entities.list', { orgId: (bot as any).org_id })

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

// POST — manually create an entity_catalog row (source='manual'). Manual rows
// are NEVER overwritten or removed by re-discovery (lib/entityDiscovery.ts +
// lib/botEntityExtraction.ts both skip/preserve source='manual'), so a curated
// entity the NER never caught (e.g. a panel member) sticks. If the slug already
// exists (even hidden), we unhide it, flip it to manual, and merge the aliases
// rather than erroring — so "add" is idempotent and also rescues a hidden row.
export async function POST(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: bot } = await service.from('agents').select('id, org_id').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  if (!isAdmin && (bot as { org_id: string }).org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as { canonical?: unknown; aliases?: unknown; category?: unknown }
  const canonical = typeof body.canonical === 'string' ? body.canonical.trim() : ''
  if (!canonical) return NextResponse.json({ error: 'canonical is required' }, { status: 400 })
  if (canonical.length > 200) return NextResponse.json({ error: 'canonical too long' }, { status: 400 })
  const slug = slugify(canonical)
  if (!slug) return NextResponse.json({ error: 'canonical must contain letters or numbers' }, { status: 400 })

  const aliases = Array.isArray(body.aliases)
    ? Array.from(new Set((body.aliases as unknown[]).map(a => String(a ?? '').trim()).filter(Boolean))).slice(0, 50)
    : []
  const category = typeof body.category === 'string' && body.category.trim() ? body.category.trim().slice(0, 40) : 'other'

  // Existing row for this slug (incl. hidden)? Rescue + merge instead of duplicating.
  const { data: existing } = await service
    .from('entity_catalog')
    .select('id, aliases, provenance')
    .eq('scope_type', 'bot').eq('scope_id', params.id).eq('slug', slug)
    .maybeSingle()

  if (existing) {
    const merged = Array.from(new Set([...((existing as { aliases: string[] }).aliases ?? []), ...aliases]))
    // Record human provenance — manual is the highest authority, so this row now
    // owns its canonical outright.
    const provenance = mergeProvenance(((existing as any).provenance ?? {}) as Provenance, 'manual', null, 1)
    const { data: updated, error } = await service
      .from('entity_catalog')
      .update({ canonical, aliases: merged, category, source: 'manual', provenance, hidden: false, last_seen_at: new Date().toISOString() })
      .eq('id', (existing as { id: string }).id).eq('scope_type', 'bot').eq('scope_id', params.id)
      .select(ENTITY_FIELDS).single()
    if (error) return serverError(error, 'bots.entities.create', { orgId: (bot as { org_id: string }).org_id })
    // Phase 3: a manually-curated entity rolls up into the brand collection.
    await rollupAgentEntitiesToBrand(service, { agentId: params.id, orgId: (bot as { org_id: string }).org_id })
    return NextResponse.json({ entity: updated, merged: true })
  }

  const { data: created, error } = await service
    .from('entity_catalog')
    .insert({ scope_type: 'bot', scope_id: params.id, canonical, slug, category, aliases, source: 'manual', provenance: { manual: { count: 1, refs: [] } }, hidden: false, sample_count: 0 })
    .select(ENTITY_FIELDS).single()
  if (error) return serverError(error, 'bots.entities.create', { orgId: (bot as { org_id: string }).org_id })
  await rollupAgentEntitiesToBrand(service, { agentId: params.id, orgId: (bot as { org_id: string }).org_id })
  return NextResponse.json({ entity: created })
}
