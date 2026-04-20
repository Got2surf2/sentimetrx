import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import QuestionsClient from './QuestionsClient'

export const dynamic = 'force-dynamic'

export default async function AdminQuestionsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, full_name, organizations(is_admin_org, logo_url, name)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations) as any
  if (!orgData?.is_admin_org) redirect('/dashboard')

  return (
    <QuestionsClient
      userEmail={user.email || ''}
      logoUrl={orgData?.logo_url || ''}
      orgName={orgData?.name || ''}
      fullName={userData?.full_name || ''}
    />
  )
}
