// app/api/datasets/[datasetId]/entities/[slug]/route.ts
// PATCH  — update a single catalog entry: toggle hidden, edit canonical /
//          category / aliases. Used by the Manage Entities panel to hide
//          discovered noise or fix a hand-curated entry.
// DELETE — hard-delete a catalog entry. Restricted to source='manual' rows;
//          discovered rows should be soft-deleted via PATCH {hidden:true}
//          so the next discovery run does not resurface them.
//
// Both routes resolve scope from the dataset id and gate by org ownership
// (CLAUDE.md multi-tenancy rule — paired id+org_id on the service-role
// lookup, admin-org bypass).

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { resolveEntityScope } from '@/lib/entityFilter'

export const dynamic = 'force-dynamic'

const CATEGORIES = ['food', 'drink', 'place', 'person', 'brand', 'other']
const MAX_ALIASES_PER_ENTITY = 25

interface Params { params: { datasetId: string; slug: string } }

function normaliseAliases(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of input) {
    if (typeof v !== 'string') continue
    const clean = v.trim().toLowerCase()
    if (clean.length < 2) continue
    if (seen.has(clean)) continue
    seen.add(clean)
    out.push(clean)
    if (out.length >= MAX_ALIASES_PER_ENTITY) break
  }
  return out
}

async function authorise(req: Request, params: Params['params']) {
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const service = createServiceRoleClient()
  const dsQuery = service.from('datasets').select('id, org_id').eq('id', params.datasetId)
  const { data: ds } = isAdmin ? await dsQuery.single() : await dsQuery.eq('org_id', orgId).single()
  if (!ds) return { error: NextResponse.json({ error: 'Dataset not found' }, { status: 404 }) }

  const scope = await resolveEntityScope(service, params.datasetId)
  if (!scope.found) return { error: NextResponse.json({ error: 'Dataset not found' }, { status: 404 }) }

  return { service, scope, userId }
}

export async function PATCH(req: Request, { params }: Params) {
  const auth = await authorise(req, params)
  if ('error' in auth) return auth.error
  const { service, scope } = auth

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const patch: Record<string, unknown> = {}
  if (typeof body.hidden === 'boolean') patch.hidden = body.hidden
  if (typeof body.canonical === 'string' && body.canonical.trim().length >= 2) {
    patch.canonical = body.canonical.trim()
  }
  if (typeof body.category === 'string') {
    const cat = body.category.trim().toLowerCase()
    if (CATEGORIES.includes(cat)) patch.category = cat
  }
  if (Array.isArray(body.aliases)) {
    patch.aliases = normaliseAliases(body.aliases)
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }
  patch.last_seen_at = new Date().toISOString()

  const { data, error } = await service
    .from('entity_catalog')
    .update(patch)
    .eq('scope_type', scope.scopeType)
    .eq('scope_id', scope.scopeId)
    .eq('slug', params.slug)
    .select('slug, canonical, category, aliases, hidden, source')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Entity not found' }, { status: 404 })

  return NextResponse.json({ entity: data })
}

export async function DELETE(req: Request, { params }: Params) {
  const auth = await authorise(req, params)
  if ('error' in auth) return auth.error
  const { service, scope } = auth

  // Hard-delete is for manual entries only. Discovered rows must be soft-
  // deleted (PATCH hidden=true) so the next discovery run doesn't resurface
  // them — hard-deleting a discovered row defeats its own purpose.
  const { data: row } = await service
    .from('entity_catalog')
    .select('source')
    .eq('scope_type', scope.scopeType)
    .eq('scope_id', scope.scopeId)
    .eq('slug', params.slug)
    .single()
  if (!row) return NextResponse.json({ error: 'Entity not found' }, { status: 404 })
  if ((row as any).source !== 'manual') {
    return NextResponse.json({ error: 'Hide discovered entries via PATCH {hidden:true} instead of deleting — hard-delete only applies to manual entries.' }, { status: 400 })
  }

  const { error } = await service
    .from('entity_catalog')
    .delete()
    .eq('scope_type', scope.scopeType)
    .eq('scope_id', scope.scopeId)
    .eq('slug', params.slug)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ deleted: true })
}
