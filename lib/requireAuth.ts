import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function requireAuth() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, supabase, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  return { user, supabase, error: null }
}

export async function requireAdmin(supabase: any, userId: string) {
  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', userId)
    .single()
  const orgData = Array.isArray(userData?.organizations) ? userData.organizations[0] : userData?.organizations
  return { isAdmin: !!orgData?.is_admin_org, orgId: userData?.org_id }
}
