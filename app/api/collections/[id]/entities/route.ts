// app/api/collections/[id]/entities/route.ts
//
// Brand-glossary editor (shared brand-correction layer, Phase 5). CRUD over the
// brand collection's entity_catalog (scope_type='collection', scope_id=collectionId)
// — the authoritative shared glossary that drives spelling correction across
// Town Hall, the What We Heard readout, and survey exports.
//
// Until now the collection catalog was populated ONLY by dataset discovery + the
// bot→brand rollup, never hand-edited. This lets a user add/curate brand entities
// directly; a manual add is the highest authority (source='manual') so it owns
// its canonical and qualifies for the correction glossary immediately.
//
// Service role + paired (id, org_id) check on the collection per CLAUDE.md
// multi-tenancy invariants — mirrors the bot entities routes.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { slugify } from '@/lib/entityFilter'
import { type Provenance } from '@/lib/correction/provenance'
import { serverError } from '@/lib/apiError'

const ENTITY_FIELDS = 'id, canonical, slug, category, aliases, sample_count, source, hidden, provenance, first_seen_at, last_seen_at'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

interface Params { params: Promise<{ id: string }> }

// Resolve + org-gate the collection. Returns the row or a NextResponse error.
async function gateCollection(service: ReturnType<typeof createServiceRoleClient>, id: string, orgId: string | null, isAdmin: boolean) {
  const { data: col } = await service.from('collections').select('id, org_id, kind').eq('id', id).single()
  if (!col) return { error: NextResponse.json({ error: 'Collection not found' }, { status: 404 }) }
  if (!isAdmin && (col as { org_id: string }).org_id !== orgId) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { col: col as { id: string; org_id: string; kind: string } }
}

export async function GET(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const gate = await gateCollection(service, params.id, orgId, isAdmin)
  if (gate.error) return gate.error

  const includeHidden = new URL(req.url).searchParams.get('include_hidden') === '1'
  let query = service
    .from('entity_catalog')
    .select(ENTITY_FIELDS)
    .eq('scope_type', 'collection').eq('scope_id', params.id)
    .order('sample_count', { ascending: false })
  if (!includeHidden) query = query.eq('hidden', false)
  const { data: entities, error } = await query
  if (error) return serverError(error, 'collections.entities.list', { orgId: gate.col.org_id })

  const { count: hiddenCount } = await service
    .from('entity_catalog')
    .select('id', { count: 'exact', head: true })
    .eq('scope_type', 'collection').eq('scope_id', params.id).eq('hidden', true)

  return NextResponse.json({ entities: entities ?? [], hidden_count: hiddenCount ?? 0 })
}

export async function POST(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const gate = await gateCollection(service, params.id, orgId, isAdmin)
  if (gate.error) return gate.error

  const body = await req.json().catch(() => ({}))
  const canonical = String(body?.canonical ?? '').trim()
  if (!canonical) return NextResponse.json({ error: 'canonical is required' }, { status: 400 })
  if (canonical.length > 200) return NextResponse.json({ error: 'canonical too long' }, { status: 400 })
  const slug = slugify(canonical)
  if (!slug) return NextResponse.json({ error: 'canonical must contain letters or numbers' }, { status: 400 })
  const aliases = Array.isArray(body?.aliases)
    ? Array.from(new Set((body.aliases as unknown[]).map(a => String(a ?? '').trim()).filter(Boolean))).slice(0, 50)
    : []
  const category = typeof body?.category === 'string' && body.category.trim() ? body.category.trim().slice(0, 40) : 'other'

  // Rescue + merge an existing row for this slug (incl. hidden) rather than dup.
  const { data: existing } = await service
    .from('entity_catalog')
    .select('id, aliases, provenance')
    .eq('scope_type', 'collection').eq('scope_id', params.id).eq('slug', slug)
    .maybeSingle()

  if (existing) {
    const merged = Array.from(new Set([...((existing as { aliases: string[] }).aliases ?? []), ...aliases]))
    const provenance = { ...(((existing as { provenance?: Provenance }).provenance ?? {}) as Provenance) }
    provenance.manual = { count: (provenance.manual?.count ?? 0) + 1, refs: provenance.manual?.refs ?? [] }
    const { data: updated, error } = await service
      .from('entity_catalog')
      .update({ canonical, aliases: merged, category, source: 'manual', provenance, hidden: false, last_seen_at: new Date().toISOString() })
      .eq('id', (existing as { id: string }).id).eq('scope_type', 'collection').eq('scope_id', params.id)
      .select(ENTITY_FIELDS).single()
    if (error) return serverError(error, 'collections.entities.merge', { orgId: gate.col.org_id })
    return NextResponse.json({ entity: updated, merged: true })
  }

  const { data: created, error } = await service
    .from('entity_catalog')
    .insert({ scope_type: 'collection', scope_id: params.id, canonical, slug, category, aliases, source: 'manual', provenance: { manual: { count: 1, refs: [] } }, hidden: false, sample_count: 0 })
    .select(ENTITY_FIELDS).single()
  if (error) return serverError(error, 'collections.entities.create', { orgId: gate.col.org_id })
  return NextResponse.json({ entity: created })
}
