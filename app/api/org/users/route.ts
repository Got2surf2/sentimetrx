// app/api/org/users/route.ts
// GET — list users in the caller's own org. Any authed user.
//
// Split out of /api/admin/orgs/[id]/users so that filter-bar nav components
// (used by every authed user) stop calling an /api/admin/* path. The admin
// path now requires super-admin and only serves cross-org reads.

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()

  const orgId = userData?.org_id as string | null
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // RLS already scopes users to caller's org for non-admins; explicit
  // .eq('org_id', orgId) makes the contract clear and survives any future
  // RLS relaxation.
  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, role')
    .eq('org_id', orgId)
    .order('full_name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
