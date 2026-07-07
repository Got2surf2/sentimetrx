import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import TopNav from '@/components/nav/TopNav'
import GoldSetClient from './GoldSetClient'

export const dynamic = 'force-dynamic'

export default async function ReoGoldSetPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('organizations(is_admin_org)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations)
  if (!orgData?.is_admin_org) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <TopNav isAdmin userEmail={user.email} />
      <div style={{ paddingTop: 56 }} className="flex-1">
        <GoldSetClient />
      </div>
    </div>
  )
}
