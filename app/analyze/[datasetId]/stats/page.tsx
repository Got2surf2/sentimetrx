// app/analyze/[datasetId]/stats/page.tsx
// Statistics module — loads schema + theme_model, renders StatsModule.

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { resolveOrg, orgTaxonomyEnabled } from '@/lib/resolveOrg'
import StatsModule from '@/components/analyze/StatsModule'

export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ datasetId: string }> }

export default async function StatsPage(props: Props) {
  const params = await props.params;
  var supabase = await createClient()
  var { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  var { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(features, is_admin_org)')
    .eq('id', user.id)
    .single()

  var orgData = resolveOrg(userData?.organizations)
  if (!orgData?.features?.analyze) redirect('/dashboard')

  var service = createServiceRoleClient()

  var { data: stateRow } = await service
    .from('dataset_state')
    .select('schema_config, theme_model')
    .eq('dataset_id', params.datasetId)
    .single()

  if (!stateRow) notFound()

  var schema = stateRow.schema_config || { fields: [], autoDetected: true, version: 1 }
  var themeModel = stateRow.theme_model || null

  // Inject signal_tier for Reddit/Substack datasets
  var { data: dataset } = await service.from('datasets').select('source, taxonomy_enabled, name').eq('id', params.datasetId).single()
  if (dataset?.source === 'reddit' || dataset?.source === 'substack') {
    schema = { ...schema, fields: [...(schema.fields || []), { field: 'signal_tier', type: 'categorical', label: 'Signal Tier' }] }
  }

  return <StatsModule datasetId={params.datasetId} datasetName={dataset?.name} schema={schema} themeModel={themeModel} datasetSource={dataset?.source} taxonomyEnabled={orgTaxonomyEnabled(orgData?.features) || !!dataset?.taxonomy_enabled} />
}
