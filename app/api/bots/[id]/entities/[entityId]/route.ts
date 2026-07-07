// app/api/bots/[id]/entities/[entityId]/route.ts
// PATCH — update a single entity_catalog row (hide/unhide, edit canonical
// or aliases). Powers row-level actions on /bots/[id]/entities.
//
// docs/BOTS.md § 9.y.4. Service role + paired (id, scope_id=bot_id,
// org_id) check on the agent row per CLAUDE.md multi-tenancy invariants.
// Manual edits flip source='discovered' → 'manual' so a future
// re-discovery run won't trample them (mirrors the dataset-scope pattern
// in sql/073).

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { serverError } from '@/lib/apiError'
import { invalidateEntityCache } from '@/lib/entityMentionDetector'
import { rollupAgentEntitiesToBrand } from '@/lib/correction/rollup'
import { mergeProvenance, type Provenance } from '@/lib/correction/provenance'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string; entityId: string }> }

interface AgentRow { id: string; org_id: string }
interface EntityRow {
  id: string
  scope_type?: string
  scope_id?: string
  source: string
  provenance?: Provenance | null
}

export async function PATCH(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const hidden = typeof body?.hidden === 'boolean' ? body.hidden : undefined
  const canonical = typeof body?.canonical === 'string' ? body.canonical.trim() : undefined
  const aliasesRaw = Array.isArray(body?.aliases) ? body.aliases : undefined
  const aliases = aliasesRaw
    ? aliasesRaw.map((a: unknown) => String(a || '').trim()).filter((a: string) => a.length > 0 && a.length <= 80)
    : undefined

  if (hidden === undefined && canonical === undefined && aliases === undefined) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }
  if (canonical !== undefined && (canonical.length === 0 || canonical.length > 80)) {
    return NextResponse.json({ error: 'Invalid canonical' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  const { data: bot } = await service.from('agents').select('id, org_id').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  if (!isAdmin && (bot as AgentRow).org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Pair entity_catalog row by id + scope to prevent cross-bot updates.
  const { data: existing } = await service
    .from('entity_catalog')
    .select('id, scope_type, scope_id, source, provenance')
    .eq('id', params.entityId)
    .eq('scope_type', 'bot')
    .eq('scope_id', params.id)
    .single()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const patch: Record<string, string | boolean | string[] | Provenance> = {}
  if (hidden !== undefined) patch.hidden = hidden
  if (canonical !== undefined) {
    patch.canonical = canonical
    patch.source = 'manual'   // user-curated content; discovery should leave it alone
  }
  if (aliases !== undefined) {
    patch.aliases = aliases
    patch.source = 'manual'
  }
  // Curating the spelling/aliases is a human act — record manual provenance so
  // this row owns its canonical at the highest authority.
  if (canonical !== undefined || aliases !== undefined) {
    patch.provenance = mergeProvenance(((existing as EntityRow).provenance ?? {}) as Provenance, 'manual', null, 1)
  }

  const { data: updated, error } = await service
    .from('entity_catalog')
    .update(patch)
    .eq('id', params.entityId)
    .eq('scope_type', 'bot')
    .eq('scope_id', params.id)
    .select('id, canonical, slug, category, aliases, sample_count, source, hidden, first_seen_at, last_seen_at')
    .single()
  if (error) return serverError(error, 'bots.entities.update', { orgId: (bot as AgentRow).org_id })

  // Visibility change or term change → catalog needs a fresh load on the next turn.
  invalidateEntityCache(params.id)

  // Phase 3: a curated spelling/alias change rolls up into the brand collection
  // (best-effort; uses the BOT's org so an admin's cross-org edit lands in the
  // right brand). Hide/unhide doesn't need a roll — the rollup only ever adds.
  if (canonical !== undefined || aliases !== undefined) {
    await rollupAgentEntitiesToBrand(service, { agentId: params.id, orgId: (bot as AgentRow).org_id })
  }

  return NextResponse.json({ entity: updated })
}

export async function DELETE(_req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: bot } = await service.from('agents').select('id, org_id').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  if (!isAdmin && (bot as AgentRow).org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Only manual rows can be hard-deleted. Discovered rows should be hidden
  // instead (so re-discovery doesn't resurface noise the admin already
  // rejected — mirrors the dataset-scope rule in sql/073).
  const { data: existing } = await service
    .from('entity_catalog')
    .select('id, source')
    .eq('id', params.entityId)
    .eq('scope_type', 'bot')
    .eq('scope_id', params.id)
    .single()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if ((existing as EntityRow).source !== 'manual') {
    return NextResponse.json({ error: 'Hide discovered entities instead of deleting.' }, { status: 400 })
  }

  const { error } = await service
    .from('entity_catalog')
    .delete()
    .eq('id', params.entityId)
    .eq('scope_type', 'bot')
    .eq('scope_id', params.id)
  if (error) return serverError(error, 'bots.entities.delete', { orgId: (bot as AgentRow).org_id })

  invalidateEntityCache(params.id)
  return NextResponse.json({ ok: true })
}
