// app/analyze/[datasetId]/textmine/page.tsx
// TextMine module page.
// Loads dataset_state server-side (schema, theme_model, analytics) -- never raw rows.
// Passes to TextMineModule which fetches rows client-side via paginated rows API.

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import TextMineModule from '@/components/analyze/TextMineModule'

export const dynamic = 'force-dynamic'

interface Props { params: { datasetId: string }; searchParams?: { editThemes?: string } }

export default async function TextMinePage({ params, searchParams }: Props) {
  const supabase = createClient()
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
      .select('source, ana_library')
      .eq('id', params.datasetId)
      .single(),
  ])

  if (!stateRow) notFound()

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
        datasetSource={(dataset?.source as 'upload' | 'study' | 'google_reviews' | 'reddit' | 'townhall' | 'substack') || 'upload'}
        anaLibrary={dataset?.ana_library || null}
        initialOpenEditor={!!searchParams?.editThemes}
      />
    </div>
  )
}
