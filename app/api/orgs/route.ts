import { createClient, getAuthUser } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { serverError } from '@/lib/apiError'

export async function GET() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('organizations(is_admin_org)')
    .eq('id', user.id)
    .single()

  type OrgAdminFlag = { is_admin_org: boolean | null }
  const orgs = userData?.organizations as OrgAdminFlag | OrgAdminFlag[] | null | undefined
  const org = Array.isArray(orgs) ? orgs[0] : orgs
  if (!org?.is_admin_org) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, slug, plan')
    .order('name', { ascending: true })

  if (error) return serverError(error, 'orgs.list')
  return NextResponse.json(data)
}
