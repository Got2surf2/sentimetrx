// app/admin/entity-pos-preview/page.tsx
// SPIKE: Side-by-side comparison of Claude NER vs POS noun-phrase extraction.
// No catalog writes — pure preview tool.

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg, effectiveFeatures } from '@/lib/resolveOrg'
import type { ModuleFeatures } from '@/lib/types'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'
import PosPreviewClient from './PosPreviewClient'

export const dynamic = 'force-dynamic'

export default async function PosPreviewPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, org_id, features, organizations(is_admin_org, logo_url, name, features)')
    .eq('id', user.id)
    .single()
  const orgData = resolveOrg(userData?.organizations)
  if (!orgData?.is_admin_org) redirect('/dashboard')
  const features = effectiveFeatures(orgData?.features, userData?.features as ModuleFeatures | null | undefined)

  // Pull every dataset across orgs for the dropdown.
  const service = createServiceRoleClient()
  const { data: datasets } = await service
    .from('datasets')
    .select('id, name, source, brand_tag, org_id, row_count')
    .order('created_at', { ascending: false })
    .limit(200)

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <TopNav
        logoUrl={orgData?.logo_url || ''}
        orgName={orgData?.name}
        isAdmin
        userEmail={user.email}
        fullName={userData?.full_name}
        features={features}
        currentPage="admin"
      />
      <SubHeader crumbs={[{ label: 'Settings & Admin', href: '/admin/hub' }, { label: 'Entity POS Preview' }]} />
      <div style={{ paddingTop: 112 }} className="flex-1">
        <PosPreviewClient datasets={(datasets || []) as DatasetRow[]} />
      </div>
    </div>
  )
}

type DatasetRow = {
  id:        string
  name:      string
  source:    string | null
  brand_tag: string | null
  org_id:    string | null
  row_count: number | null
}
