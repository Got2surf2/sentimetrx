// app/analyze/[datasetId]/layout.tsx
// Shared layout — wraps all dataset module pages in DatasetShell (FilterProvider + header + global filter modal)

import type { ReactNode } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import TopNav from '@/components/nav/TopNav'
import DatasetShell from './DatasetShell'

export const dynamic = 'force-dynamic'

interface Props {
  children: ReactNode
  params: { datasetId: string }
}

export default async function DatasetLayout({ children, params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, org_id, organizations(id, name, is_admin_org, logo_url, features)')
    .eq('id', user.id)
    .single()

  const rawOrg  = userData?.organizations
  const orgData = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg as any

  if (!orgData?.features?.analyze) redirect('/dashboard')

  const [{ data: dataset }, { data: stateRow }] = await Promise.all([
    supabase
      .from('datasets')
      .select('id, name, source, study_id, visibility, status, row_count, last_synced_at, updated_at, studies(name)')
      .eq('id', params.datasetId)
      .eq('org_id', userData?.org_id)
      .single(),
    supabase
      .from('dataset_state')
      .select('schema_config')
      .eq('dataset_id', params.datasetId)
      .single(),
  ])

  if (!dataset) notFound()

  const studyName = (dataset as any).studies?.name ?? null
  const schemaFields = stateRow?.schema_config?.fields || []

  return (
    <div className="min-h-screen bg-gray-50" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <TopNav
        logoUrl={orgData?.logo_url    || ''}
        orgName={orgData?.name        || ''}
        isAdmin={!!orgData?.is_admin_org}
        userEmail={user.email         || ''}
        fullName={userData?.full_name  || ''}
        analyzeEnabled={true}
        currentPage="analyze"
      />
      <div style={{ paddingTop: 56, display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        <DatasetShell
          dataset={{
            id:             dataset.id,
            name:           dataset.name,
            source:         dataset.source as 'upload' | 'study',
            visibility:     dataset.visibility as 'private' | 'public',
            status:         dataset.status as 'active' | 'archived',
            row_count:      dataset.row_count,
            last_synced_at: dataset.last_synced_at,
            study_name:     studyName,
          }}
          userName={userData?.full_name || user.email || ''}
          orgName={orgData?.name || ''}
          schemaFields={schemaFields}
          datasetId={params.datasetId}
        >
          {children}
        </DatasetShell>
      </div>
    </div>
  )
}


