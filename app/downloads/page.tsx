import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg, effectiveFeatures } from '@/lib/resolveOrg'
import TopNav from '@/components/nav/TopNav'
import DownloadMonitor from '@/components/downloads/DownloadMonitor'

// User-facing single-org Download Monitor. Same UI as /admin/downloads
// but scoped to the caller's org. Org column hidden (only one org).
// Editing actions (frequency, pause/resume) PATCH the same review-sources
// route, which already authorizes by org owner.

export const dynamic = 'force-dynamic'

export default async function UserDownloadsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, full_name, features, organizations(is_admin_org, logo_url, name, features)')
    .eq('id', user.id)
    .single()

  if (!userData?.org_id) redirect('/dashboard')

  const orgData = resolveOrg(userData?.organizations) as any
  const features = effectiveFeatures(orgData?.features, (userData as any)?.features)

  const service = createServiceRoleClient()
  const orgId = userData.org_id

  const [redditRes, reviewRes, substackRes, regRes, uploadRes] = await Promise.all([
    service.from('reddit_sources')
      .select('id, status, total_posts, total_comments, error_message, updated_at, created_at, org_id')
      .eq('org_id', orgId)
      .order('updated_at', { ascending: false })
      .limit(50),
    service.from('review_sources')
      .select('id, brand_name, status, sync_frequency_hours, last_synced_at, next_sync_at, error_message, created_at, org_id')
      .eq('org_id', orgId)
      .order('updated_at', { ascending: false })
      .limit(50),
    service.from('datasets')
      .select('id, name, source, row_count, created_at, org_id')
      .eq('source', 'substack').eq('org_id', orgId)
      .order('created_at', { ascending: false }).limit(50),
    service.from('datasets')
      .select('id, name, source, row_count, created_at, org_id')
      .eq('source', 'regulations').eq('org_id', orgId)
      .order('created_at', { ascending: false }).limit(50),
    service.from('datasets')
      .select('id, name, source, status, row_count, created_at, updated_at, org_id')
      .eq('source', 'upload').eq('org_id', orgId)
      .order('created_at', { ascending: false }).limit(50),
  ])

  const reviewSourceIds = (reviewRes.data || []).map(s => s.id)
  const { data: pendingLocations } = reviewSourceIds.length > 0
    ? await service.from('review_source_locations')
        .select('id, review_source_id, name, total_pulled, last_synced_at, error_message')
        .in('review_source_id', reviewSourceIds)
        .eq('selected', true)
        .like('error_message', 'pending_task:%')
        .limit(200)
    : { data: [] as any[] }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <TopNav
        logoUrl={orgData?.logo_url || ''}
        orgName={orgData?.name}
        isAdmin={!!orgData?.is_admin_org}
        userEmail={user.email}
        fullName={userData?.full_name}
        features={features}
        currentPage="downloads"
      />
      <div style={{ paddingTop: 56 }} className="flex-1">
        <DownloadMonitor
          redditSources={redditRes.data || []}
          reviewSources={reviewRes.data || []}
          pendingLocations={pendingLocations || []}
          substackDatasets={substackRes.data || []}
          regDatasets={regRes.data || []}
          uploadDatasets={uploadRes.data || []}
          showOrgColumn={false}
          subtitle="Active, queued, and failed downloads for this organization"
        />
      </div>
    </div>
  )
}
