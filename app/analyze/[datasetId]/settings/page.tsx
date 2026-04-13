// app/analyze/[datasetId]/settings/page.tsx
// Schema & Themes: rename, visibility, schema editor, theme editor, danger zone

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import SettingsClient from './SettingsClient'

export const dynamic = 'force-dynamic'

interface Props { params: { datasetId: string } }

export default async function SettingsPage({ params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(features, is_admin_org)')
    .eq('id', user.id)
    .single()

  const rawOrg = userData?.organizations
  const orgData = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg as any
  if (!orgData?.features?.analyze) redirect('/dashboard')

  const isAdmin = !!orgData?.is_admin_org

  const service = isAdmin ? (await import('@/lib/supabase/server')).createServiceRoleClient() : null

  const [{ data: dataset }, { data: stateRow }] = await Promise.all([
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

  const isOwner = dataset.created_by === user.id

  // If google_reviews dataset, look up the review_source_id
  let reviewSourceId: string | null = null
  if (dataset.source === 'google_reviews') {
    const svc = service || (await import('@/lib/supabase/server')).createServiceRoleClient()
    const { data: rs } = await svc
      .from('review_sources')
      .select('id')
      .eq('dataset_id', params.datasetId)
      .single()
    reviewSourceId = rs?.id || null
  }

  // Fetch all orgs for admin transfer dropdown
  let allOrgs: { id: string; name: string }[] = []
  if (isAdmin) {
    const { data: orgs } = await (service || (await import('@/lib/supabase/server')).createServiceRoleClient())
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
      isOwner={isOwner}
      isAdmin={isAdmin}
      allOrgs={allOrgs}
      reviewSourceId={reviewSourceId}
    />
  )
}
