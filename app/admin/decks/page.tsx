import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg, effectiveFeatures } from '@/lib/resolveOrg'
import { deckLastModified } from '@/lib/deckLastModified'
import TopNav from '@/components/nav/TopNav'
import DecksClient from './DecksClient'

export const dynamic = 'force-dynamic'

export default async function DecksPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, full_name, features, organizations(is_admin_org, logo_url, name, features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations) as any
  if (!orgData?.is_admin_org) redirect('/dashboard')
  const features = effectiveFeatures(orgData?.features, (userData as any)?.features)

  // Fetch the most recent download timestamp per (deck_name, deck_variant).
  // We grab the last 200 rows and reduce in memory — simpler than a SQL view
  // and the table is tiny.
  const service = createServiceRoleClient()
  const { data: logs, error: logsError } = await service
    .from('deck_download_log')
    .select('deck_name, deck_variant, downloaded_at')
    .order('downloaded_at', { ascending: false })
    .limit(200)

  const lastDownloaded: Record<string, string> = {}
  for (const row of (logs || []) as any[]) {
    const key = row.deck_variant ? `${row.deck_name}:${row.deck_variant}` : row.deck_name
    if (!lastDownloaded[key]) lastDownloaded[key] = row.downloaded_at
  }

  // Diagnostic: total rows in the log table. If 0 even after a download,
  // the table probably is not in place / the helper is failing silently.
  const { count: totalDownloads } = await service
    .from('deck_download_log')
    .select('*', { count: 'exact', head: true })

  const tableStatus: 'ok' | 'missing' | 'error' = logsError
    ? (logsError.code === '42P01' ? 'missing' : 'error')
    : 'ok'

  // Per-deck "last modified" — looks up each route file's last commit time
  // (or mtime fallback). This way each deck card shows when its own content
  // was last touched, not just the latest deploy time.
  const lastUpdated: Record<string, string | null> = {
    'pitch-deck':                  deckLastModified('app/api/pitch-deck/route.ts'),
    'rollup-deck:short':           deckLastModified('app/api/rollup-deck/route.ts'),
    'rollup-deck:long':            deckLastModified('app/api/rollup-deck/route.ts'),
    'project-insight-deck':        deckLastModified('app/api/project-insight-deck/route.ts'),
    'architecture-deck':           deckLastModified('app/api/architecture-deck/route.ts'),
    'engineering-reality-deck':    deckLastModified('app/api/engineering-reality-deck/route.ts'),
    'restaurant-expansion-deck:darden':  deckLastModified('app/api/restaurant-expansion-deck/route.ts'),
    'restaurant-expansion-deck:bloomin': deckLastModified('app/api/restaurant-expansion-deck/route.ts'),
    'pulseiq-deck':                      deckLastModified('app/api/pulseiq-deck/route.ts'),
    'nowocats-approach-deck':            deckLastModified('app/api/nowocats-approach-deck/route.ts'),
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <TopNav
        logoUrl={orgData?.logo_url || ''}
        orgName={orgData?.name}
        isAdmin
        userEmail={user.email}
        fullName={userData?.full_name}
        features={features}
        currentPage="decks"
      />
      <div style={{ paddingTop: 56 }} className="flex-1">
        <DecksClient
          lastDownloaded={lastDownloaded}
          lastUpdated={lastUpdated}
          totalDownloads={totalDownloads ?? 0}
          tableStatus={tableStatus}
        />
      </div>
    </div>
  )
}
