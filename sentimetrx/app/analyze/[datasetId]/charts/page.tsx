// app/analyze/[datasetId]/charts/page.tsx
// Charts module — loads schema + analytics, renders ChartsModule.

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import ChartsModule from '@/components/analyze/ChartsModule'

export const dynamic = 'force-dynamic'

interface Props { params: { datasetId: string } }

export default async function ChartsPage({ params }: Props) {
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

  var service = createServiceRoleClient()

  var { data: stateRow } = await service
    .from('dataset_state')
    .select('schema_config, analytics, saved_charts')
    .eq('dataset_id', params.datasetId)
    .single()

  if (!stateRow) notFound()

  var schema = stateRow.schema_config || { fields: [], autoDetected: true, version: 1 }
  var analytics = stateRow.analytics || null

  return <ChartsModule datasetId={params.datasetId} schema={schema} analytics={analytics} />
}
