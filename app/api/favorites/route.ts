// app/api/favorites/route.ts
//   GET  — list the caller's favorites, enriched with name/href.
//          Filters out resources outside the caller's org (or all orgs
//          for an admin) so stale favs after an org change disappear.
//   POST — toggle a single (resource_type, resource_id) for the caller.
//          Verifies the resource is visible to the caller before
//          allowing an insert (prevents an admin-only resource being
//          starred by a tenant user via id-guessing).

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

type ResourceType = 'bot' | 'study' | 'dataset' | 'campaign' | 'townhall_session' | 'recording'
const VALID_TYPES: ResourceType[] = ['bot', 'study', 'dataset', 'campaign', 'townhall_session', 'recording']

// resource_type → (table, name field, href builder, timestamp field)
const TYPE_MAP: Record<ResourceType, { table: string; ts: string; href: (id: string) => string }> = {
  bot:              { table: 'bots',              ts: 'updated_at', href: (id) => '/bots/' + id + '/conversations' },
  study:            { table: 'studies',           ts: 'created_at', href: (id) => '/studies/' + id + '/edit' },
  dataset:          { table: 'datasets',          ts: 'created_at', href: (id) => '/analyze/' + id },
  campaign:         { table: 'campaigns',         ts: 'created_at', href: (id) => '/campaigns/' + id },
  townhall_session: { table: 'townhall_sessions', ts: 'created_at', href: (id) => '/townhall/' + id },
  recording:        { table: 'recordings',        ts: 'created_at', href: (id) => '/recordings/' + id + '/report' },
}

async function resolveCaller(supabase: Awaited<ReturnType<typeof createClient>>) {
  const user = await getAuthUser(supabase)
  if (!user) return null
  const { data } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  const orgRel = (data as any)?.organizations
  const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!(orgRel as any)?.is_admin_org
  return { user, orgId: (data as any)?.org_id as string | null, isAdmin }
}

export async function GET() {
  const supabase = await createClient()
  const caller = await resolveCaller(supabase)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: favs, error } = await service
    .from('user_favorites')
    .select('resource_type, resource_id, created_at')
    .eq('user_id', caller.user.id)
    .order('created_at', { ascending: false })
  if (error) return serverError(error, 'favorites.list')

  // Bucket by type, then look up each resource in a single query per type.
  const byType: Record<ResourceType, string[]> = {
    bot: [], study: [], dataset: [], campaign: [], townhall_session: [], recording: [],
  }
  for (const f of favs || []) {
    if (VALID_TYPES.includes(f.resource_type as ResourceType)) {
      byType[f.resource_type as ResourceType].push(f.resource_id)
    }
  }

  type Enriched = { resource_type: ResourceType; resource_id: string; name: string; subtitle?: string; href: string; ts: string | null; created_at: string }
  const enriched: Enriched[] = []

  for (const type of VALID_TYPES) {
    const ids = byType[type]
    if (ids.length === 0) continue
    const cfg = TYPE_MAP[type]
    // Pull the minimum fields needed for each type. Then filter by org
    // (admin sees everything; tenant sees only their org).
    let q = service.from(cfg.table).select('id, org_id, name, ' + cfg.ts).in('id', ids)
    if (!caller.isAdmin) q = q.eq('org_id', caller.orgId as string)
    const { data: rows } = await q
    const rowMap = new Map<string, any>((rows || []).map((r: any) => [r.id, r]))
    // Re-walk favs in created_at-desc order so the response keeps fav order.
    for (const f of favs || []) {
      if (f.resource_type !== type) continue
      const r = rowMap.get(f.resource_id)
      if (!r) continue  // stale or out-of-org — silently drop
      enriched.push({
        resource_type: type,
        resource_id:   f.resource_id,
        name:          r.name || 'Untitled',
        href:          cfg.href(f.resource_id),
        ts:            r[cfg.ts] || null,
        created_at:    f.created_at,
      })
    }
  }

  // Restore overall created_at-desc order (favs interleaved across types).
  enriched.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  return NextResponse.json({ favorites: enriched })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const caller = await resolveCaller(supabase)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const resource_type = body?.resource_type as ResourceType | undefined
  const resource_id   = body?.resource_id as string | undefined
  if (!resource_type || !VALID_TYPES.includes(resource_type)) {
    return NextResponse.json({ error: 'Invalid resource_type' }, { status: 400 })
  }
  if (!resource_id || typeof resource_id !== 'string') {
    return NextResponse.json({ error: 'Missing resource_id' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  // Verify the resource is visible to the caller before allowing a fav.
  // (For un-fav, skip the check — let the caller remove a stale row.)
  const cfg = TYPE_MAP[resource_type]
  const { data: resource } = await service
    .from(cfg.table)
    .select('id, org_id')
    .eq('id', resource_id)
    .single()
  if (!resource) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!caller.isAdmin && (resource as any).org_id !== caller.orgId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Toggle.
  const { data: existing } = await service
    .from('user_favorites')
    .select('user_id')
    .eq('user_id', caller.user.id)
    .eq('resource_type', resource_type)
    .eq('resource_id', resource_id)
    .maybeSingle()

  if (existing) {
    const { error } = await service
      .from('user_favorites')
      .delete()
      .eq('user_id', caller.user.id)
      .eq('resource_type', resource_type)
      .eq('resource_id', resource_id)
    if (error) return serverError(error, 'favorites.remove')
    return NextResponse.json({ favorited: false })
  } else {
    const { error } = await service
      .from('user_favorites')
      .insert({ user_id: caller.user.id, resource_type, resource_id })
    if (error) return serverError(error, 'favorites.add')
    return NextResponse.json({ favorited: true })
  }
}
