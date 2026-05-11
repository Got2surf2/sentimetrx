import { createClient, getAuthUser } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

interface Params { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = createClient()
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

  // 404 instead of 403 so the route doesn't leak its existence to callers
  // who aren't super-admin and aren't a member of the target org.
  if (!isAdmin && !sameOrg) return new NextResponse('Not Found', { status: 404 })

  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, role')
    .eq('org_id', params.id)
    .order('full_name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
