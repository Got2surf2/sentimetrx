// app/analyze/[datasetId]/settings/page.tsx
// Dataset settings: rename, visibility, schema editor, danger zone

import { createClient } from '@/lib/supabase/server'
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
    .select('org_id, organizations(features)')
    .eq('id', user.id)
    .single()

  const rawOrg  = userData?.organizations
  const orgData = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg as any
  if (!orgData?.features?.analyze) redirect('/dashboard')

  const [{ data: dataset }, { data: stateRow }] = await Promise.all([
    supabase
      .from('datasets')
      .select('id, name, description, source, visibility, status, row_count, created_by')
      .eq('id', params.datasetId)
      .single(),
    supabase
      .from('dataset_state')
      .select('schema_config')
      .eq('dataset_id', params.datasetId)
      .single(),
  ])

  if (!dataset || !stateRow) notFound()

  const isOwner = dataset.created_by === user.id

  return (
    <SettingsClient
      dataset={dataset as any}
      schema={stateRow.schema_config || { fields: [], autoDetected: true, version: 1 }}
      isOwner={isOwner}
    />
  )
}
