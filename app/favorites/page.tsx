// app/favorites/page.tsx
// Cross-resource favorites page. Uses the same enrichment logic as /m so
// the desktop and mobile favorites views mirror each other. Sections by
// resource type; empty state when the user has none.

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import TopNav from '@/components/nav/TopNav'
import FavoritesClient from './FavoritesClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Sentimetrx — Favorites' }

interface EnrichedFav {
  resource_type: 'bot' | 'study' | 'dataset' | 'campaign' | 'townhall_session'
  resource_id:   string
  name:          string
  subtitle?:     string
  href:          string
  ts:            string | null
  created_at:    string
  raw:           Record<string, any>   // full DB row for rich card rendering
}

export default async function FavoritesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/favorites')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, org_id, organizations(id, name, is_admin_org, logo_url, features)')
    .eq('id', user.id)
    .single()
  const orgData = resolveOrg(userData?.organizations) as any
  const isAdmin = !!orgData?.is_admin_org
  const orgId   = (userData as any)?.org_id as string | null

  const service = createServiceRoleClient()
  const { data: favs } = await service
    .from('user_favorites')
    .select('resource_type, resource_id, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  // Enrich — same pattern as /m. Tenant users only see resources in their org.
  const TYPE_MAP: Record<string, { table: string; tsField: string; href: (id: string, r: any) => string; subtitle: (r: any) => string | undefined }> = {
    bot:              { table: 'bots',              tsField: 'updated_at', href: (id) => '/bots/' + id + '/conversations', subtitle: (r) => r.slug ? '/b/' + r.slug : undefined },
    study:            { table: 'studies',           tsField: 'created_at', href: (id) => '/studies/' + id + '/edit',       subtitle: (r) => (r.response_count || 0).toLocaleString() + ' responses' },
    dataset:          { table: 'datasets',          tsField: 'created_at', href: (id) => '/analyze/' + id,                 subtitle: (r) => [r.row_count ? r.row_count.toLocaleString() + ' rows' : '', r.source].filter(Boolean).join(' · ') || undefined },
    campaign:         { table: 'campaigns',         tsField: 'created_at', href: (id) => '/campaigns/' + id,               subtitle: (r) => r.status || 'draft' },
    townhall_session: { table: 'pulseiq_sessions',  tsField: 'created_at', href: (id) => '/townhall/' + id,                subtitle: (r) => r.status || 'draft' },
  }

  const byType: Record<string, string[]> = {}
  for (const f of (favs || []) as Array<{ resource_type: string; resource_id: string }>) {
    if (!byType[f.resource_type]) byType[f.resource_type] = []
    byType[f.resource_type].push(f.resource_id)
  }

  const rowMaps: Record<string, Map<string, any>> = {}
  await Promise.all(Object.entries(byType).map(async function([type, ids]) {
    const cfg = TYPE_MAP[type]
    if (!cfg) { rowMaps[type] = new Map(); return }
    let q: any = service.from(cfg.table).select('*').in('id', ids)
    if (!isAdmin) q = q.eq('org_id', orgId)
    const { data } = await q
    rowMaps[type] = new Map((data || []).map((r: any) => [r.id, r]))
  }))

  const enriched: EnrichedFav[] = []
  for (const f of (favs || []) as Array<{ resource_type: string; resource_id: string; created_at: string }>) {
    const cfg = TYPE_MAP[f.resource_type]
    if (!cfg) continue
    const r = rowMaps[f.resource_type]?.get(f.resource_id)
    if (!r) continue
    enriched.push({
      resource_type: f.resource_type as EnrichedFav['resource_type'],
      resource_id:   f.resource_id,
      name:          r.name || 'Untitled',
      subtitle:      cfg.subtitle(r),
      href:          cfg.href(f.resource_id, r),
      ts:            r[cfg.tsField] || null,
      created_at:    f.created_at,
      raw:           r,
    })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav
        logoUrl={orgData?.logo_url || ''}
        orgName={orgData?.name}
        isAdmin={isAdmin}
        userEmail={user.email}
        fullName={(userData as any)?.full_name}
        features={orgData?.features || {}}
        currentPage="favorites"
      />
      <div style={{ paddingTop: 56 }}>
        <FavoritesClient favorites={enriched} />
      </div>
    </div>
  )
}
