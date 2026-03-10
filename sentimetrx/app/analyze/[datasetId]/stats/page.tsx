import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ModulePlaceholder from '@/components/analyze/ModulePlaceholder'
import { mergeRowBatches } from '@/lib/datasetUtils'

export const dynamic = 'force-dynamic'

interface Props { params: { datasetId: string } }

export default async function StatsPage({ params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: batches } = await supabase
    .from('dataset_rows')
    .select('id, dataset_id, rows, row_count, batch_index, source_ref, created_at')
    .eq('dataset_id', params.datasetId)
    .order('batch_index', { ascending: true })

  const { data: state } = await supabase
    .from('dataset_state')
    .select('schema_config, saved_stats')
    .eq('dataset_id', params.datasetId)
    .single()

  const rows       = mergeRowBatches(batches || [])
  const schema     = state?.schema_config as any
  const fieldCount = schema?.fields?.length ?? 0
  const schemaReady = schema && !schema.autoDetected && fieldCount > 0

  // PHASE 2 DROP-IN POINT:
  // Replace <ModulePlaceholder ... /> with:
  // <StatisticsModule rows={rows} schema={schema} savedStats={state?.saved_stats} datasetId={params.datasetId} />

  return (
    <ModulePlaceholder
      datasetId={params.datasetId}
      moduleName="Statistics"
      message="Welch's t-test, ANOVA, chi-square, OLS regression, Pearson/Spearman correlation — in development."
      rowCount={rows.length}
      fieldCount={fieldCount}
      schemaReady={!!schemaReady}
    />
  )
}
