// app/analyze/[datasetId]/settings/page.tsx
// Schema & Themes: rename, visibility, schema editor, theme editor, danger zone

import { createClient } from '@/lib/supabase/server'
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
    .select('org_id, organizations(features)')
    .eq('id', user.id)
    .single()

  var rawOrg = userData?.organizations
  var orgData = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg as any
  if (!orgData?.features?.analyze) redirect('/dashboard')

  var [{ data: dataset }, { data: stateRow }] = await Promise.all([
    supabase
      .from('datasets')
      .select('id, name, description, source, visibility, status, row_count, created_by')
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

  return (
    <SettingsClient
      dataset={dataset as any}
      schema={stateRow.schema_config || { fields: [], autoDetected: true, version: 1 }}
      themeModel={stateRow.theme_model || null}
      isOwner={isOwner}
      datasetId={params.datasetId}
    />
  )
}
