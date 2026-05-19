// app/m/page.tsx
// Mobile status surface — the PWA's home screen.
//
// Server component. Authenticates the request, scopes everything to the
// caller's org (admin orgs see everything via service-role), and renders a
// tight one-screen summary: counts + the few most recent items per category.
// Heavy workflows (TextMine, builders, admin tables) deep-link back to the
// desktop UI rather than reimplementing them here.

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import MobileStatusClient from './MobileStatusClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Sentimetrx — Status' }

interface RecentItem {
  id:        string
  name:      string
  subtitle?: string
  href:      string
  ts?:       string | null
}

export default async function MobilePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/m')

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, full_name, organizations(is_admin_org, name)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations) as { is_admin_org?: boolean; name?: string } | null
  const isAdmin = !!orgData?.is_admin_org
  const orgId = userData?.org_id as string | null
  const orgName = orgData?.name || 'No organization'

  const service = createServiceRoleClient()
  // Admin org bypass mirrors the rest of the codebase: admin sees everything;
  // everyone else is filtered to their own org_id. The CLAUDE.md multi-tenancy
  // rule wants the filter present on every service-role read.
  const scopeFilter = function<T>(q: T): T {
    if (isAdmin) return q
    // @ts-ignore — Supabase query builder typing varies by call
    return q.eq('org_id', orgId) as T
  }

  // Run every count + recent-items query in parallel — the page blocks on
  // the slowest one, which is much faster than serial reads on Vercel.
  const [
    datasetsCount, datasetsRecent,
    botsCount, botsRecent,
    studiesCount, studiesRecent,
    campaignsCount, campaignsRecent,
    townhallCount, townhallRecent,
  ] = await Promise.all([
    scopeFilter(service.from('datasets').select('id', { count: 'exact', head: true })),
    scopeFilter(service.from('datasets').select('id, name, row_count, source, created_at').order('created_at', { ascending: false }).limit(5)),
    scopeFilter(service.from('bots').select('id', { count: 'exact', head: true })),
    scopeFilter(service.from('bots').select('id, name, slug, updated_at').order('updated_at', { ascending: false }).limit(5)),
    scopeFilter(service.from('studies').select('id', { count: 'exact', head: true })),
    scopeFilter(service.from('studies').select('id, name, response_count, created_at').order('created_at', { ascending: false }).limit(5)),
    scopeFilter(service.from('campaigns').select('id', { count: 'exact', head: true })),
    scopeFilter(service.from('campaigns').select('id, name, status, created_at').order('created_at', { ascending: false }).limit(5)),
    scopeFilter(service.from('townhall_sessions').select('id', { count: 'exact', head: true })),
    scopeFilter(service.from('townhall_sessions').select('id, name, status, started_at, created_at').order('created_at', { ascending: false }).limit(5)),
  ])

  // Bundle each section into a {count, recent[]} shape for the client.
  const sections: Array<{ key: string; label: string; href: string; count: number; recent: RecentItem[] }> = [
    {
      key:    'datasets',
      label:  'Datasets',
      href:   '/analyze',
      count:  datasetsCount.count || 0,
      recent: (datasetsRecent.data || []).map(function(d: any): RecentItem {
        return {
          id:       d.id,
          name:     d.name || 'Untitled',
          subtitle: (d.row_count ? d.row_count.toLocaleString() + ' rows' : '0 rows') + (d.source ? ' · ' + d.source : ''),
          href:     '/analyze/' + d.id,
          ts:       d.created_at,
        }
      }),
    },
    {
      key:    'bots',
      label:  'Agents',
      href:   '/bots',
      count:  botsCount.count || 0,
      recent: (botsRecent.data || []).map(function(b: any): RecentItem {
        return {
          id:       b.id,
          name:     b.name || b.slug || 'Untitled',
          subtitle: b.slug ? '/b/' + b.slug : undefined,
          href:     '/bots/' + b.id,
          ts:       b.updated_at,
        }
      }),
    },
    {
      key:    'studies',
      label:  'Surveys',
      href:   '/studies',
      count:  studiesCount.count || 0,
      recent: (studiesRecent.data || []).map(function(s: any): RecentItem {
        return {
          id:       s.id,
          name:     s.name || 'Untitled',
          subtitle: (s.response_count || 0).toLocaleString() + ' responses',
          href:     '/studies/' + s.id,
          ts:       s.created_at,
        }
      }),
    },
    {
      key:    'campaigns',
      label:  'Campaigns',
      href:   '/campaigns',
      count:  campaignsCount.count || 0,
      recent: (campaignsRecent.data || []).map(function(c: any): RecentItem {
        return {
          id:       c.id,
          name:     c.name || 'Untitled',
          subtitle: c.status || 'draft',
          href:     '/campaigns/' + c.id,
          ts:       c.created_at,
        }
      }),
    },
    {
      key:    'townhall',
      label:  'PulseIQ',
      href:   '/townhall',
      count:  townhallCount.count || 0,
      recent: (townhallRecent.data || []).map(function(t: any): RecentItem {
        return {
          id:       t.id,
          name:     t.name || 'Untitled',
          subtitle: t.status || 'draft',
          href:     '/townhall/' + t.id,
          ts:       t.started_at || t.created_at,
        }
      }),
    },
  ]

  return (
    <MobileStatusClient
      user={{ name: userData?.full_name || user.email || 'User', email: user.email || '' }}
      org={{ name: orgName, isAdmin: isAdmin }}
      sections={sections}
    />
  )
}
