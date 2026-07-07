// app/analyze/[datasetId]/taxonomy/page.tsx
// Taxonomy module — the in-app tag-analytics view. Reads the embedded
// per-row verdicts (data._tx, sql/151) via /api/datasets/[id]/taxonomy,
// renders axis/sub rates + sentiment + alerts.

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import TaxonomyModule from '@/components/analyze/TaxonomyModule'

export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ datasetId: string }> }

export default async function TaxonomyPage(props: Props) {
  const { datasetId } = await props.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(features, is_admin_org)')
    .eq('id', user.id)
    .single()
  const orgData = resolveOrg(userData?.organizations)
  if (!orgData?.features?.analyze) redirect('/dashboard')

  return <TaxonomyModule datasetId={datasetId} />
}
