import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import AdminClientDetail from './AdminClientDetail'

interface Props { params: { id: string } }

export const dynamic = 'force-dynamic'

export default async function AdminClientPage({ params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()

  const orgData = userData?.organizations
  const isAdmin = Array.isArray(orgData) ? orgData[0]?.is_admin_org : (orgData as any)?.is_admin_org
  if (!isAdmin) redirect('/dashboard')

  const service = createServiceRoleClient()

  const { data: org } = await service
    .from('organizations')
    .select('id, name, slug, plan, is_admin_org, created_at')
    .eq('id', params.id)
    .single()

  if (!org) notFound()

  const { data: members } = await service
    .from('users')
    .select('id, email, full_name, role, created_at')
    .eq('org_id', params.id)
    .order('created_at')

  const { data: studies } = await service
    .from('studies')
    .select('id, guid, name, bot_name, bot_emoji, status, visibility, created_at, created_by')
    .eq('org_id', params.id)
    .order('created_at', { ascending: false })

  const studyIds = (studies || []).map(s => s.id)
  const { data: responsesRaw } = studyIds.length > 0
    ? await service.from('responses').select('study_id').in('study_id', studyIds)
    : { data: [] }

  const studiesWithCounts = (studies || []).map(s => ({
    ...s,
    response_count: (responsesRaw || []).filter(r => r.study_id === s.id).length,
  }))

  const { data: invites } = await service
    .from('invites')
    .select('id, token, email, role, used_at, expires_at, created_at')
    .eq('org_id', params.id)
    .order('created_at', { ascending: false })

  const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://sentimetrx.ai'

  return (
    <AdminClientDetail
      org={org}
      members={members || []}
      studies={studiesWithCounts}
      invites={(invites || []).map(inv => ({
        ...inv,
        invite_url: base + '/invite/' + inv.token,
      }))}
      baseUrl={base}
      currentUserId={user.id}
    />
  )
}
