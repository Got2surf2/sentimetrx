import { createClient, getAuthUser } from '@/lib/supabase/server'
import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { serverError } from '@/lib/apiError'

interface Params { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()

  const orgData = Array.isArray(userData?.organizations) ? userData.organizations[0] : userData?.organizations as any
  const isAdmin = orgData?.is_admin_org === true
  const sameOrg = userData?.org_id === params.id

  if (!isAdmin && !sameOrg) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, role')
    .eq('org_id', params.id)
    .order('full_name', { ascending: true })

  if (error) return serverError(error, 'orgs.users.list', { orgId: params.id })
  return NextResponse.json(data)
}
