// app/api/social/connections/[id]/route.ts
// DELETE — disconnect a social account

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

async function getAuth(supabase: Awaited<ReturnType<typeof createClient>>) {
  const user = await getAuthUser(supabase)
  if (!user) return null
  const { data } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  return { userId: user.id, orgId: data?.org_id as string | null }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { error } = await service
    .from('social_connections')
    .delete()
    .eq('id', params.id)
    .eq('org_id', auth.orgId)

  if (error) return serverError(error, 'social.connections.delete', { orgId: auth.orgId })
  return NextResponse.json({ ok: true })
}
