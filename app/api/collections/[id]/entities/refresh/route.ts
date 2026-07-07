// app/api/collections/[id]/entities/refresh/route.ts
//
// POST — "Pull from agents": roll every agent linked to this brand (agents whose
// brand_tag resolves to this collection's slug) up into the brand collection's
// entity_catalog. The per-agent rollup is the shared, authority-aware
// rollupAgentEntitiesToBrand (Phase 3); this just fans it out so the brand
// glossary editor (Phase 5) can refresh in one click. Idempotent.
//
// Service role + paired (id, org_id) gate on the collection.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { slugify } from '@/lib/entityFilter'
import { rollupAgentEntitiesToBrand } from '@/lib/correction/rollup'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

interface CollectionRow { id: string; org_id: string; slug: string | null; kind: string | null }
interface AgentRow { id: string; brand_tag: string | null }

export async function POST(_req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: col } = await service.from('collections').select('id, org_id, slug, kind').eq('id', params.id).single<CollectionRow>()
  if (!col) return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
  if (!isAdmin && col.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const colOrg = col.org_id
  const colSlug = col.slug
  if (!colSlug) return NextResponse.json({ error: 'Not a brand collection' }, { status: 400 })

  // Agents in this org tagged to this brand (slugified brand_tag == collection slug).
  const { data: agents } = await service
    .from('agents').select('id, brand_tag')
    .eq('org_id', colOrg).not('brand_tag', 'is', null)
    .returns<AgentRow[]>()
  const linked = (agents ?? []).filter(a => slugify(String(a.brand_tag ?? '')) === colSlug)

  let agentsPulled = 0
  let pushed = 0
  for (const a of linked) {
    const r = await rollupAgentEntitiesToBrand(service, { agentId: a.id, orgId: colOrg, brandTag: a.brand_tag })
    if (r) { agentsPulled += 1; pushed += r.pushed }
  }

  return NextResponse.json({ agents: agentsPulled, pushed })
}
