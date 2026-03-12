// app/api/admin/orgs/[id]/route.ts
// PATCH -- update org features (super-admin only)
// Used by AdminClientDetail.tsx to toggle analyze module per org

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface Params { params: { id: string } }

export async function PATCH(req: Request, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Super-admin check
  const { data: userData } = await supabase
    .from('users')
    .select('organizations(is_admin_org)')
    .eq('id', user.id)
    .single()

  const rawOrg  = userData?.organizations
  const orgData = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg as any
  if (!orgData?.is_admin_org) {
    return NextResponse.json({ error: 'Super-admin only' }, { status: 403 })
  }

  const body = await req.json()
  const { features } = body
  if (!features || typeof features !== 'object') {
    return NextResponse.json({ error: 'features object is required' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  // Merge new features with existing ones (don't overwrite unrelated keys)
  const { data: existing } = await service
    .from('organizations')
    .select('features')
    .eq('id', params.id)
    .single()

  const currentFeatures = existing?.features || {}
  const merged = { ...currentFeatures, ...features }

  const { error } = await service
    .from('organizations')
    .update({ features: merged })
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, features: merged })
}
