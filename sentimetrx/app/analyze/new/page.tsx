import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import UploadClient from './UploadClient'

export const dynamic = 'force-dynamic'

export default async function NewDatasetPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, org_id, organizations(features)')
    .eq('id', user.id)
    .single()

  const orgRaw  = userData?.organizations as any
  const orgData = Array.isArray(orgRaw) ? orgRaw[0] : orgRaw
  if (!orgData?.features?.analyze) redirect('/dashboard')

  return <UploadClient userEmail={user.email!} fullName={userData?.full_name ?? ''} />
}
