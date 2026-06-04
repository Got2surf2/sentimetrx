// app/analyze/[datasetId]/report/page.tsx
//
// Back-compat redirect. The Town Hall report moved to /recordings/[id]/report
// (keyed by recording_id) when recordings was promoted to a top-level product.
// Old links/bookmarks pointed here (keyed by dataset_id) — resolve the recording
// via recordings.dataset_id and 307 to the canonical URL. Non-recording datasets
// fall back to the standard /analyze dataset page.

import { redirect } from 'next/navigation'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'

export const dynamic = 'force-dynamic'

export default async function LegacyReportRedirect(props: { params: Promise<{ datasetId: string }> }) {
  const params = await props.params
  const supabase = await createClient()
  const ctx = await getUserContext(supabase)
  if (!ctx) redirect('/login')

  const service = createServiceRoleClient()
  // Resolve the recording from its dataset mirror, org-scoped (admin-org sees all).
  let q = service.from('recordings').select('id, org_id').eq('dataset_id', params.datasetId)
  if (!ctx.isAdminOrg) q = q.eq('org_id', ctx.orgId)
  const { data: rec } = await q.maybeSingle()

  if (rec?.id) redirect(`/recordings/${rec.id}/report`)
  // Not a recording dataset — send to the normal dataset page.
  redirect(`/analyze/${params.datasetId}`)
}
