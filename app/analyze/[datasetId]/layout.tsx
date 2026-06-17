// app/analyze/[datasetId]/layout.tsx
// Shared layout — wraps all dataset module pages in DatasetShell (FilterProvider + header + global filter modal)

import type { ReactNode } from 'react'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import TopNav from '@/components/nav/TopNav'
import DatasetShell from './DatasetShell'

export const dynamic = 'force-dynamic'

interface Props {
  children: ReactNode
  params: Promise<{ datasetId: string }>
}

export default async function DatasetLayout(props: Props) {
  const params = await props.params;

  const {
    children
  } = props;

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, org_id, organizations(id, name, is_admin_org, logo_url, features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations) as any

  if (!orgData?.features?.analyze) redirect('/dashboard')

  // Don't add an explicit `.eq('org_id', userData?.org_id)` here. The RLS
  // policy on datasets is `(org_id = current_org_id() OR is_platform_admin())`,
  // which already gates non-admins to their own org AND lets platform admins
  // read across orgs. The explicit filter was breaking the admin path after a
  // dataset transfer (admin's org_id no longer matches the dataset's org_id),
  // producing a spurious 404 even though the admin has policy-level access.
  const datasetQuery = supabase
    .from('datasets')
    .select('id, name, source, study_id, description, visibility, status, row_count, last_synced_at, updated_at, org_id, studies(name)')
    .eq('id', params.datasetId)

  const [{ data: dataset }, { data: stateRow }] = await Promise.all([
    datasetQuery.single(),
    supabase
      .from('dataset_state')
      .select('schema_config')
      .eq('dataset_id', params.datasetId)
      .single(),
  ])

  if (!dataset) notFound()

  // For collections, compute live row count from members
  let rowCount = dataset.row_count
  if (dataset.source === 'collection') {
    const { data: col } = await supabase.from('collections').select('id').eq('dataset_id', dataset.id).single()
    if (col) {
      const { data: members } = await supabase.from('collection_members').select('dataset_id').eq('collection_id', col.id)
      if (members && members.length > 0) {
        const { data: memberDs } = await supabase.from('datasets').select('row_count').in('id', members.map(m => m.dataset_id))
        if (memberDs) rowCount = memberDs.reduce((s, d) => s + (d.row_count || 0), 0)
      }
    }
  }

  const studyName = (dataset as any).studies?.name ?? null
  const schemaFields = (stateRow?.schema_config?.fields || []) as import('@/lib/analyzeTypes').SchemaFieldConfig[]

  // Outlet count for the multi-location report tab (only meaningful for review
  // brands). Cheap count off review_source_locations; service-role avoids RLS
  // edge cases since dataset access is already gated above.
  let outletCount = 0
  if (dataset.source === 'google_reviews') {
    const svc = createServiceRoleClient()
    const { data: src } = await svc.from('review_sources').select('id').eq('dataset_id', dataset.id).maybeSingle()
    if (src) {
      const { count } = await svc
        .from('review_source_locations')
        .select('id', { count: 'exact', head: true })
        .eq('review_source_id', src.id)
      outletCount = count || 0
    }
  }

  return (
    <div className="min-h-screen bg-gray-50" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <TopNav
        logoUrl={orgData?.logo_url    || ''}
        orgName={orgData?.name        || ''}
        isAdmin={!!orgData?.is_admin_org}
        userEmail={user.email         || ''}
        fullName={userData?.full_name  || ''}
        analyzeEnabled={true}
        campaignsEnabled={!!orgData?.features?.campaigns}
        features={orgData?.features || {}}
        currentPage="analyze"
        datasetName={dataset.name}
      />
      <div style={{ paddingTop: 56, display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        <DatasetShell
          dataset={{
            id:             dataset.id,
            name:           dataset.name,
            source:         dataset.source as 'upload' | 'study' | 'google_reviews' | 'reddit' | 'townhall' | 'substack' | 'collection',
            visibility:     dataset.visibility as 'private' | 'public',
            status:         dataset.status as 'active' | 'archived',
            row_count:      rowCount,
            last_synced_at: dataset.last_synced_at,
            study_id:       dataset.study_id,
            description:    dataset.description,
            study_name:     studyName,
          }}
          userName={userData?.full_name || user.email || ''}
          orgName={orgData?.name || ''}
          schemaFields={schemaFields}
          datasetId={params.datasetId}
          outletCount={outletCount}
        >
          {children}
        </DatasetShell>
      </div>
    </div>
  )
}
