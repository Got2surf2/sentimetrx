// app/api/bots/[id]/conversations/reviews/route.ts
// GET — list scheduled review results for a bot

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

interface Params { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: userData } = await service
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  const orgRel = (userData as any)?.organizations
  const isAdmin = Array.isArray(orgRel) ? orgRel[0]?.is_admin_org : (orgRel as any)?.is_admin_org
  const userOrgId = (userData as any)?.org_id as string | null

  const { data: bot } = await service.from('agents').select('id, org_id').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  if (!isAdmin && bot.org_id !== userOrgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: reviews } = await service
    .from('agent_conversation_reviews')
    .select('id, reviewed_at, since, session_count, turn_count, report, theme_drift')
    .eq('bot_id', params.id)
    .order('reviewed_at', { ascending: false })
    .limit(20)

  return NextResponse.json({ reviews: reviews || [] })
}
