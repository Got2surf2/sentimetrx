// app/analyze/[datasetId]/stats/page.tsx
// Statistics module hook.
// Loads ONLY dataset_state.analytics — never touches dataset_rows.
// All statistical inputs come from pre-computed fieldSummaries.

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import ModulePlaceholder from '@/components/analyze/ModulePlaceholder'

export const dynamic = 'force-dynamic'

interface Props { params: { datasetId: string } }

export default async function StatsPage({ params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(features)')
    .eq('id', user.id)
    .single()

  const rawOrg  = userData?.organizations
  const orgData = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg as unknown as { features?: { analyze?: boolean } }
  if (!orgData?.features?.analyze) redirect('/dashboard')

  const service = createServiceRoleClient()

  const { data: stateRow } = await service
    .from('dataset_state')
    .select('schema_config, analytics')
    .eq('dataset_id', params.datasetId)
    .single()

  if (!stateRow) notFound()

  const schema     = stateRow.schema_config || { fields: [], autoDetected: true, version: 1 }
  const analytics  = stateRow.analytics     || null
  const rowCount   = analytics?.totalRows   ?? 0
  const fieldCount = (schema.fields || []).filter(function(f: { type: string }) { return f.type !== 'ignore' }).length

  // Phase 4 drop-in:
  // Replace ModulePlaceholder with:
  // <StatisticsModule
  //   schema={schema}
  //   analytics={analytics}
  //   datasetId={params.datasetId}
  // />
  // StatisticsModule reads analytics.fieldSummaries for distributions/tests.

  return (
    <ModulePlaceholder
      module="Statistics"
      message="Statistics is in development. Your data is loaded and ready -- no re-upload needed when it launches."
      rowCount={rowCount}
      fieldCount={fieldCount}
      datasetId={params.datasetId}
    />
  )
}
