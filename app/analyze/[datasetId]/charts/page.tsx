// app/analyze/[datasetId]/charts/page.tsx
// Charts module — loads schema + analytics + theme_model, renders ChartsModule.

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import ChartsModule from '@/components/analyze/ChartsModule'

export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ datasetId: string }> }

export default async function ChartsPage(props: Props) {
  const params = await props.params;
  var supabase = await createClient()
  var { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  var { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(features)')
    .eq('id', user.id)
    .single()

  var orgData = resolveOrg(userData?.organizations) as any
  if (!orgData?.features?.analyze) redirect('/dashboard')

  var service = createServiceRoleClient()

  var { data: stateRow } = await service
    .from('dataset_state')
    .select('schema_config, analytics, theme_model')
    .eq('dataset_id', params.datasetId)
    .single()

  if (!stateRow) notFound()

  var schema = stateRow.schema_config || { fields: [], autoDetected: true, version: 1 }
  var analytics = stateRow.analytics || null
  var themeModel = stateRow.theme_model || null

  // Inject signal_tier for Reddit/Substack datasets
  var { data: dataset } = await service.from('datasets').select('source').eq('id', params.datasetId).single()
  if (dataset?.source === 'reddit' || dataset?.source === 'substack') {
    schema = { ...schema, fields: [...(schema.fields || []), { field: 'signal_tier', type: 'categorical', label: 'Signal Tier' }] }
  }

  return <ChartsModule datasetId={params.datasetId} schema={schema} analytics={analytics} themeModel={themeModel} datasetSource={dataset?.source} taxonomyEnabled={!!orgData?.features?.taxonomy} />
}
