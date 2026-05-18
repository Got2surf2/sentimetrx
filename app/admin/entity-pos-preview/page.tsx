// app/admin/entity-pos-preview/page.tsx
// SPIKE: Side-by-side comparison of Claude NER vs POS noun-phrase extraction.
// No catalog writes — pure preview tool.

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import PosPreviewClient from './PosPreviewClient'

export const dynamic = 'force-dynamic'

export default async function PosPreviewPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  const orgData = resolveOrg(userData?.organizations) as any
  if (!orgData?.is_admin_org) redirect('/dashboard')

  // Pull every dataset across orgs for the dropdown.
  const service = createServiceRoleClient()
  const { data: datasets } = await service
    .from('datasets')
    .select('id, name, source, brand_tag, org_id, row_count')
    .order('created_at', { ascending: false })
    .limit(200)

  return <PosPreviewClient datasets={(datasets || []) as any} />
}
