// app/api/collections/[id]/entities/[entityId]/route.ts
//
// PATCH (edit canonical/aliases/category, hide/unhide) + DELETE (manual rows only)
// for a brand collection's entity_catalog (Phase 5 — brand-glossary editor).
//
// Service role + paired (id, org_id) check on the collection. Editing the
// canonical/aliases flips source='manual' (highest authority) + stamps manual
// provenance, mirroring the bot + dataset scope rules.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { mergeProvenance, type Provenance } from '@/lib/correction/provenance'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string; entityId: string }> }

async function gateCollection(service: ReturnType<typeof createServiceRoleClient>, id: string, orgId: string | null, isAdmin: boolean) {
  const { data: col } = await service.from('collections').select('id, org_id').eq('id', id).single()
  if (!col) return { error: NextResponse.json({ error: 'Collection not found' }, { status: 404 }) }
  if (!isAdmin && (col as any).org_id !== orgId) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { col }
}

export async function PATCH(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const hidden = typeof body?.hidden === 'boolean' ? body.hidden : undefined
  const canonical = typeof body?.canonical === 'string' ? body.canonical.trim() : undefined
  const category = typeof body?.category === 'string' ? body.category.trim().slice(0, 40) : undefined
  const aliasesRaw = Array.isArray(body?.aliases) ? body.aliases : undefined
  const aliases = aliasesRaw
    ? aliasesRaw.map((a: any) => String(a ?? '').trim()).filter((a: string) => a.length > 0 && a.length <= 80)
    : undefined

  if (hidden === undefined && canonical === undefined && aliases === undefined && category === undefined) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }
  if (canonical !== undefined && (canonical.length === 0 || canonical.length > 200)) {
    return NextResponse.json({ error: 'Invalid canonical' }, { status: 400 })
  }

  const service = createServiceRoleClient()
  const gate = await gateCollection(service, params.id, orgId, isAdmin)
  if (gate.error) return gate.error

  const { data: existing } = await service
    .from('entity_catalog')
    .select('id, source, provenance')
    .eq('id', params.entityId).eq('scope_type', 'collection').eq('scope_id', params.id)
    .single()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const patch: Record<string, any> = {}
  if (hidden !== undefined) patch.hidden = hidden
  if (category !== undefined) patch.category = category
  if (canonical !== undefined) { patch.canonical = canonical; patch.source = 'manual' }
  if (aliases !== undefined) { patch.aliases = aliases; patch.source = 'manual' }
  if (canonical !== undefined || aliases !== undefined) {
    patch.provenance = mergeProvenance(((existing as any).provenance ?? {}) as Provenance, 'manual', null, 1)
  }

  const { data: updated, error } = await service
    .from('entity_catalog')
    .update(patch)
    .eq('id', params.entityId).eq('scope_type', 'collection').eq('scope_id', params.id)
    .select('id, canonical, slug, category, aliases, sample_count, source, hidden, provenance, first_seen_at, last_seen_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ entity: updated })
}

export async function DELETE(_req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const gate = await gateCollection(service, params.id, orgId, isAdmin)
  if (gate.error) return gate.error

  // Only manual rows can be hard-deleted. Discovered/rolled-up rows should be
  // hidden instead (so re-discovery / re-rollup doesn't resurface them).
  const { data: existing } = await service
    .from('entity_catalog')
    .select('id, source')
    .eq('id', params.entityId).eq('scope_type', 'collection').eq('scope_id', params.id)
    .single()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if ((existing as any).source !== 'manual') {
    return NextResponse.json({ error: 'Hide discovered entities instead of deleting.' }, { status: 400 })
  }

  const { error } = await service
    .from('entity_catalog')
    .delete()
    .eq('id', params.entityId).eq('scope_type', 'collection').eq('scope_id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
