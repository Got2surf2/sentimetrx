// app/analyze/[datasetId]/stats/page.tsx
// Statistics module — loads schema, renders StatsModule which loads rows client-side.

import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import StatsModule from '@/components/analyze/StatsModule'

export const dynamic = 'force-dynamic'

interface Props { params: { datasetId: string } }

export default async function StatsPage({ params }: Props) {
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

  var { data: stateRow } = await supabase
    .from('dataset_state')
    .select('schema_config')
    .eq('dataset_id', params.datasetId)
    .single()

  if (!stateRow) notFound()

  var schema = stateRow.schema_config || { fields: [], autoDetected: true, version: 1 }

  return <StatsModule datasetId={params.datasetId} schema={schema} />
}
