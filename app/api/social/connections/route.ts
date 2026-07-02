// app/api/social/connections/route.ts
// GET — list connected social accounts for the org

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

async function getAuth(supabase: Awaited<ReturnType<typeof createClient>>) {
  const user = await getAuthUser(supabase)
  if (!user) return null
  const { data } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  return { userId: user.id, orgId: data?.org_id as string | null }
}

export async function GET() {
  const supabase = await createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data, error } = await service
    .from('social_connections')
    .select('id, platform, account_id, account_name, token_expires_at, connected_by, created_at, updated_at')
    .eq('org_id', auth.orgId)
    .order('created_at', { ascending: false })

  if (error) return serverError(error, 'social.connections.list', { orgId: auth.orgId })
  return NextResponse.json({ connections: data || [] })
}
