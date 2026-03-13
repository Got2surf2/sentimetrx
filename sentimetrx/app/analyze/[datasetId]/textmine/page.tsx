// app/analyze/[datasetId]/textmine/page.tsx
// TextMine module hook -- Phase 1: wired data pipeline, placeholder UI

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { mergeRowBatches, applySchema } from '@/lib/datasetUtils'
import ModulePlaceholder from '@/components/analyze/ModulePlaceholder'

export const dynamic = 'force-dynamic'

interface Props { params: { datasetId: string } }

export default async function TextMinePage({ params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(features)')
    .eq('id', user.id)
    .single()

  const rawOrg  = userData?.organizations
  const orgData = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg as { features?: { analyze?: boolean } }
  if (!orgData?.features?.analyze) redirect('/dashboard')

  // Use service role client for dataset_rows -- bypasses RLS row/size limits
  // that silently return 0 results for large datasets with many batch records.
  const service = createServiceRoleClient()

  const [{ data: batches, error: batchErr }, { data: stateRow }] = await Promise.all([
    service
      .from('dataset_rows')
      .select('id, batch_index, rows, row_count')
      .eq('dataset_id', params.datasetId)
      .order('batch_index', { ascending: true }),
    service
      .from('dataset_state')
      .select('schema_config, theme_model')
      .eq('dataset_id', params.datasetId)
      .single(),
  ])

  if (batchErr) console.error('[textmine] batch fetch error:', batchErr.message)
  if (!stateRow) notFound()

  const schema     = stateRow.schema_config || { fields: [], autoDetected: true, version: 1 }
  const themeModel = stateRow.theme_model   || { themes: [], aiGenerated: false, version: 1 }

  const rawRows  = mergeRowBatches(batches || [])
  const rows     = applySchema(rawRows, schema)
  const rowCount = rows.length
  const fieldCount = (schema.fields || []).filter(function(f: { type: string }) { return f.type !== 'ignore' }).length

  // Phase 2 drop-in: replace ModulePlaceholder with
  // <TextMineModule rows={rows} schema={schema} themes={themeModel} datasetId={params.datasetId} />

  return (
    <ModulePlaceholder
      module="TextMine"
      message="TextMine is in development. Your data is loaded and ready -- no re-upload needed when it launches."
      rowCount={rowCount}
      fieldCount={fieldCount}
      datasetId={params.datasetId}
    />
  )
}
