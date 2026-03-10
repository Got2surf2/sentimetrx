import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DatasetLayoutClient from './DatasetLayoutClient'

export const dynamic = 'force-dynamic'

interface Props {
  children:  React.ReactNode
  params:    { datasetId: string }
}

export default async function DatasetLayout({ children, params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, role, org_id, organizations(id, name, is_admin_org, logo_url, features)')
    .eq('id', user.id)
    .single()

  const orgRaw  = userData?.organizations as any
  const orgData = Array.isArray(orgRaw) ? orgRaw[0] : orgRaw
  if (!orgData?.features?.analyze) redirect('/dashboard')

  // Fetch dataset metadata
  const { data: dataset } = await supabase
    .from('datasets')
    .select('id, name, source, study_id, visibility, status, row_count, last_synced_at, created_by')
    .eq('id', params.datasetId)
    .single()

  if (!dataset) redirect('/analyze')

  // Fetch linked study name if applicable
  let studyName = ''
  if (dataset.source === 'study' && dataset.study_id) {
    const { data: study } = await supabase
      .from('studies')
      .select('name')
      .eq('id', dataset.study_id)
      .single()
    studyName = study?.name ?? ''
  }

  return (
    <DatasetLayoutClient
      dataset={dataset}
      studyName={studyName}
      datasetId={params.datasetId}
      user={{
        email:    user.email!,
        fullName: userData?.full_name ?? '',
        isAdmin:  !!orgData?.is_admin_org,
        userId:   user.id,
      }}
      orgName={orgData?.name ?? ''}
      logoUrl={orgData?.logo_url ?? ''}
      isOwner={dataset.created_by === user.id}
    >
      {children}
    </DatasetLayoutClient>
  )
}
