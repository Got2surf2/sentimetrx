// app/admin/sarina-regression/page.tsx
// Admin tool: run the 22-scenario regression script Arjun authored against
// the live Sarina bot, grade each reply, and surface pass/fail by category.

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import SarinaRegressionClient from './SarinaRegressionClient'

export const dynamic = 'force-dynamic'

const SARINA_BOT_ID = '5c468b90-13fc-46a2-8855-312dc0a1e428'

export default async function SarinaRegressionPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, org_id, organizations(is_admin_org, logo_url, name, features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations)
  if (!orgData?.is_admin_org) redirect('/dashboard')

  return (
    <SarinaRegressionClient
      botId={SARINA_BOT_ID}
      logoUrl={orgData?.logo_url}
      orgName={orgData?.name}
      userEmail={user.email!}
      fullName={userData?.full_name || undefined}
      features={orgData?.features}
    />
  )
}
