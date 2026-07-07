// app/collections/[id]/glossary/page.tsx
//
// Brand-glossary editor (shared brand-correction layer, Phase 5). Server wrapper:
// auth + collection lookup + org gate; BrandGlossaryClient renders the editor.
// The collection's entity_catalog (scope_type='collection') is the authoritative
// shared glossary that drives spelling correction across products.

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import BrandGlossaryClient from './BrandGlossaryClient'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

interface CollectionRow {
  id: string
  org_id: string
  kind: string | null
  slug: string | null
  dataset_id: string | null
}

export default async function BrandGlossaryPage(props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, full_name, organizations(is_admin_org, logo_url, name, features)')
    .eq('id', user.id)
    .single()
  const orgData = resolveOrg(userData?.organizations)
  const isAdmin = !!orgData?.is_admin_org

  const service = createServiceRoleClient()
  const { data: colData } = await service
    .from('collections')
    .select('id, org_id, kind, slug, dataset_id')
    .eq('id', params.id)
    .single()
  if (!colData) redirect('/dashboard')
  const col = colData as CollectionRow
  if (!isAdmin && col.org_id !== userData?.org_id) redirect('/dashboard')

  let brandName = col.slug || 'Brand'
  if (col.dataset_id) {
    const { data: ds } = await service.from('datasets').select('name').eq('id', col.dataset_id).single()
    const dsRow = ds as { name: string | null } | null
    if (dsRow?.name) brandName = dsRow.name
  }

  return (
    <BrandGlossaryClient
      collectionId={params.id}
      brandName={brandName}
      logoUrl={orgData?.logo_url}
      orgName={orgData?.name}
      isAdmin={isAdmin}
      userEmail={user.email!}
      fullName={userData?.full_name || undefined}
      features={orgData?.features}
    />
  )
}
