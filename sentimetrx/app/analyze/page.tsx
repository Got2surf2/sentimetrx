import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AnalyzeClient from './AnalyzeClient'

export const dynamic = 'force-dynamic'

export default async function AnalyzePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Get user + org features
  const { data: userData } = await supabase
    .from('users')
    .select('full_name, role, client_id, org_id, organizations(id, name, is_admin_org, logo_url, features)')
    .eq('id', user.id)
    .single()

  const orgRaw  = userData?.organizations as any
  const orgData = Array.isArray(orgRaw) ? orgRaw[0] : orgRaw

  // Gate: redirect if Analyze not enabled
  if (!orgData?.features?.analyze) redirect('/dashboard')

  const isAdmin = !!orgData?.is_admin_org

  // Fetch all datasets visible to this user's org
 const { data: datasets } = await supabase
    .from('datasets')
    .select('id, name, description, source, study_id, org_id, client_id, visibility, status, row_count, last_synced_at, created_at, updated_at, created_by')   .order('created_at', { ascending: false })

  // Fetch study names for study-linked datasets
  const studyIds = (datasets || [])
    .filter(d => d.source === 'study' && d.study_id)
    .map(d => d.study_id as string)

  const { data: studies } = studyIds.length > 0
    ? await supabase.from('studies').select('id, name').in('id', studyIds)
    : { data: [] }

  const studyNameMap: Record<string, string> = {}
  for (const s of (studies || [])) studyNameMap[s.id] = s.name

  return (
    <AnalyzeClient
      user={{
        email:    user.email!,
        fullName: userData?.full_name ?? '',
        role:     userData?.role ?? '',
        isAdmin,
        userId:   user.id,
      }}
      orgName={orgData?.name ?? ''}
      orgId={orgData?.id ?? ''}
      logoUrl={orgData?.logo_url ?? ''}
      datasets={datasets || []}
      studyNameMap={studyNameMap}
    />
  )
}
