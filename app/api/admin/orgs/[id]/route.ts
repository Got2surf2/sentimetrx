// app/api/admin/orgs/[id]/route.ts
// PATCH -- update org features (super-admin only)
// Used by AdminClientDetail.tsx to toggle analyze module per org

import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'

export const dynamic = 'force-dynamic'

interface Params { params: { id: string } }

export async function PATCH(req: Request, { params }: Params) {
  const denied = await requireAdmin()
  if (denied) return denied

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


