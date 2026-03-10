import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function serviceRole() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

type Params = { params: { orgId: string } }

// PATCH /api/admin/orgs/[orgId]
// Updates org features flags. Super-admin only.
export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify super-admin (is_admin_org on the caller's org)
  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()

  const orgRaw = userData?.organizations as any
  const callerOrg = Array.isArray(orgRaw) ? orgRaw[0] : orgRaw
  if (!callerOrg?.is_admin_org) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const body = await req.json()
  const { features } = body

  if (!features || typeof features !== 'object') {
    return NextResponse.json({ error: 'features object is required' }, { status: 400 })
  }

  const sr = serviceRole()
  const { data, error } = await sr
    .from('organizations')
    .update({ features })
    .eq('id', params.orgId)
    .select('id, name, features')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
