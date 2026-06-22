// app/analyze/[datasetId]/textmine/page.tsx
// TextMine module page.
// Loads dataset_state server-side (schema, theme_model, analytics) -- never raw rows.
// Passes to TextMineModule which fetches rows client-side via paginated rows API.

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { resolveOrg, orgTaxonomyEnabled } from '@/lib/resolveOrg'
import TextMineModule from '@/components/analyze/TextMineModule'

export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ datasetId: string }>; searchParams?: Promise<{ editThemes?: string }> }

export default async function TextMinePage(props: Props) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Feature gate check
  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations) as any
  if (!orgData?.features?.analyze) redirect('/dashboard')

  const service = createServiceRoleClient()

  const [{ data: stateRow }, { data: dataset }] = await Promise.all([
    service
      .from('dataset_state')
      .select('schema_config, theme_model, analytics')
      .eq('dataset_id', params.datasetId)
      .single(),
    service
      .from('datasets')
      .select('source, ana_library, taxonomy_enabled')
      .eq('id', params.datasetId)
      .single(),
  ])

  if (!stateRow) notFound()

  // Outlet count gates the Outlets sub-tab link (google_reviews + ≥5 outlets),
  // mirroring the dataset-shell tab gate.
  let outletCount = 0
  if (dataset?.source === 'google_reviews') {
    const { data: src } = await service.from('review_sources').select('id').eq('dataset_id', params.datasetId).maybeSingle()
    if (src) {
      const { count } = await service.from('review_source_locations').select('id', { count: 'exact', head: true }).eq('review_source_id', src.id)
      outletCount = count || 0
    }
  }

  const schema = stateRow.schema_config || { fields: [], autoDetected: true, version: 1 }
  const analytics = stateRow.analytics || null
  const themeModel = stateRow.theme_model && (stateRow.theme_model as any).themes?.length > 0
    ? stateRow.theme_model
    : null

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TextMineModule
        datasetId={params.datasetId}
        schema={schema}
        analytics={analytics}
        savedThemeModel={themeModel}
        datasetSource={(dataset?.source as 'upload' | 'study' | 'google_reviews' | 'reddit' | 'townhall' | 'substack' | 'collection') || 'upload'}
        taxonomyEnabled={orgTaxonomyEnabled(orgData?.features) || !!dataset?.taxonomy_enabled}
        anaLibrary={dataset?.ana_library || null}
        initialOpenEditor={!!searchParams?.editThemes}
        outletCount={outletCount}
      />
    </div>
  )
}
