// app/analyze/[datasetId]/settings/page.tsx
// Schema & Themes: rename, visibility, schema editor, theme editor, danger zone

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import SettingsClient from './SettingsClient'

export const dynamic = 'force-dynamic'

interface Props { params: { datasetId: string } }

export default async function SettingsPage({ params }: Props) {
  var supabase = createClient()
  var { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  var { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(features, is_admin_org)')
    .eq('id', user.id)
    .single()

  var rawOrg = userData?.organizations
  var orgData = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg as any
  if (!orgData?.features?.analyze) redirect('/dashboard')

  var isAdmin = !!orgData?.is_admin_org

  var [{ data: dataset }, { data: stateRow }] = await Promise.all([
    supabase
      .from('datasets')
      .select('id, name, description, source, visibility, status, row_count, created_by, org_id')
      .eq('id', params.datasetId)
      .single(),
    supabase
      .from('dataset_state')
      .select('schema_config, theme_model')
      .eq('dataset_id', params.datasetId)
      .single(),
  ])

  if (!dataset || !stateRow) notFound()

  var isOwner = dataset.created_by === user.id

  // Fetch all orgs for admin transfer dropdown
  var allOrgs: { id: string; name: string }[] = []
  if (isAdmin) {
    var service = createServiceRoleClient()
    var { data: orgs } = await service
      .from('organizations')
      .select('id, name')
      .neq('id', (dataset as any).org_id)
      .order('name')
    allOrgs = orgs || []
  }

  return (
    <SettingsClient
      dataset={dataset as any}
      schema={stateRow.schema_config || { fields: [], autoDetected: true, version: 1 }}
      themeModel={stateRow.theme_model || null}
      isOwner={isOwner}
      isAdmin={isAdmin}
      allOrgs={allOrgs}
      datasetId={params.datasetId}
    />
  )
}
