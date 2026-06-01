// app/api/admin/orgs/[id]/users/route.ts
// GET — super-admin: list users in any org by id. Own-org callers should
// use /api/org/users instead; that path is gated by the caller's own org
// and does not require admin.

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { NextRequest, NextResponse } from 'next/server'

interface Params { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, props: Params) {
  const params = await props.params;
  const denied = await requireAdmin()
  if (denied) return denied

  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, role')
    .eq('org_id', params.id)
    .order('full_name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
