import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg, effectiveFeatures } from '@/lib/resolveOrg'
import TopNav from '@/components/nav/TopNav'
import DownloadMonitor from '@/components/downloads/DownloadMonitor'
import type { RedditSource, ReviewSource, DatasetRow, Recording } from '@/components/downloads/DownloadMonitor'

export const dynamic = 'force-dynamic'

// Supabase join `organizations(name)` arrives as either a single object or a
// one-element array depending on the relationship cardinality inferred at query
// time; the rows carry arbitrary source-specific columns beyond that.
type OrgRef = { name?: string | null }
type RowWithOrg = Record<string, unknown> & { organizations?: OrgRef | OrgRef[] | null }

export default async function DownloadsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, full_name, features, organizations(is_admin_org, logo_url, name, features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations)
  if (!orgData?.is_admin_org) redirect('/dashboard')
  const features = effectiveFeatures(orgData?.features, userData?.features)

  const service = createServiceRoleClient()

  // Reddit sources
  const { data: redditSources } = await service
    .from('reddit_sources')
    .select('id, status, total_posts, total_comments, error_message, updated_at, created_at, org_id, organizations(name)')
    .order('updated_at', { ascending: false })
    .limit(50)

  // Google Reviews sources
  const { data: reviewSources } = await service
    .from('review_sources')
    .select('id, brand_name, status, sync_frequency_hours, last_synced_at, next_sync_at, error_message, created_at, org_id, organizations(name)')
    .order('updated_at', { ascending: false })
    .limit(50)

  // Google Reviews locations with pending tasks
  const { data: pendingLocations } = await service
    .from('review_source_locations')
    .select('id, review_source_id, name, total_pulled, last_synced_at, error_message')
    .eq('selected', true)
    .like('error_message', 'pending_task:%')
    .limit(50)

  // Substack datasets
  const { data: substackDatasets } = await service
    .from('datasets')
    .select('id, name, source, row_count, created_at, org_id, organizations(name)')
    .eq('source', 'substack')
    .order('created_at', { ascending: false })
    .limit(50)

  // Regulations datasets
  const { data: regDatasets } = await service
    .from('datasets')
    .select('id, name, source, row_count, created_at, org_id, organizations(name)')
    .eq('source', 'regulations')
    .order('created_at', { ascending: false })
    .limit(50)

  // Uploaded CSV datasets
  const { data: uploadDatasets } = await service
    .from('datasets')
    .select('id, name, source, status, row_count, created_at, updated_at, org_id, organizations(name)')
    .eq('source', 'upload')
    .order('created_at', { ascending: false })
    .limit(50)

  // Recordings — § 5.6. Same shape as the other sources: status, recent rows,
  // error_message visible, owning org named. Active jobs (anything not in a
  // terminal state) sort first via a partial index already on the table.
  const { data: recordings } = await service
    .from('recordings')
    .select('id, name, status, session_type, meeting_date, asr_vendor_chosen, source_duration_sec, cost_cents, error_message, dataset_id, created_at, started_at, completed_at, org_id, organizations(name)')
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <TopNav
        logoUrl={orgData?.logo_url || ''}
        orgName={orgData?.name}
        isAdmin
        userEmail={user.email}
        fullName={userData?.full_name}
        features={features}
        currentPage="admin"
      />
      <div style={{ paddingTop: 56 }} className="flex-1">
        <DownloadMonitor
          redditSources={(redditSources || []).map((s: RowWithOrg) => ({ ...s, orgName: (Array.isArray(s.organizations) ? s.organizations[0] : s.organizations)?.name || '' })) as unknown as RedditSource[]}
          reviewSources={(reviewSources || []).map((s: RowWithOrg) => ({ ...s, orgName: (Array.isArray(s.organizations) ? s.organizations[0] : s.organizations)?.name || '' })) as unknown as ReviewSource[]}
          pendingLocations={pendingLocations || []}
          substackDatasets={(substackDatasets || []).map((d: RowWithOrg) => ({ ...d, orgName: (Array.isArray(d.organizations) ? d.organizations[0] : d.organizations)?.name || '' })) as unknown as DatasetRow[]}
          regDatasets={(regDatasets || []).map((d: RowWithOrg) => ({ ...d, orgName: (Array.isArray(d.organizations) ? d.organizations[0] : d.organizations)?.name || '' })) as unknown as DatasetRow[]}
          uploadDatasets={(uploadDatasets || []).map((d: RowWithOrg) => ({ ...d, orgName: (Array.isArray(d.organizations) ? d.organizations[0] : d.organizations)?.name || '' })) as unknown as DatasetRow[]}
          recordings={(recordings || []).map((r: RowWithOrg) => ({ ...r, orgName: (Array.isArray(r.organizations) ? r.organizations[0] : r.organizations)?.name || '' })) as unknown as Recording[]}
          showOrgColumn={true}
          subtitle="Active, queued, and failed downloads across all orgs"
        />
      </div>
    </div>
  )
}
