import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import SessionDetailClient from './SessionDetailClient'

export const dynamic = 'force-dynamic'

export default async function SessionDetailPage({ params }: { params: { sessionId: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, role, client_id, org_id, organizations(id, name, is_admin_org, logo_url, features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations) as any
  if (orgData?.features?.townhall === false) redirect('/dashboard')
  const isAdmin = !!orgData?.is_admin_org
  const features = orgData?.features || {}

  return (
    <SessionDetailClient
      sessionId={params.sessionId}
      logoUrl={orgData?.logo_url}
      analyzeEnabled={!!features.analyze}
      campaignsEnabled={!!features.campaigns}
      features={features}
      user={{
        email: user.email || '',
        fullName: userData?.full_name || undefined,
        clientName: orgData?.name || '',
        isAdmin,
      }}
    />
  )
}
