// app/api/bots/[id]/history/route.ts
// GET — list bot_change_log entries for this bot, newest first.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  type OrgRel = { is_admin_org: boolean | null }
  const userRow = userData as { org_id: string | null; organizations: OrgRel | OrgRel[] | null } | null
  const orgRel = userRow?.organizations
  const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!orgRel?.is_admin_org
  const userOrgId = userRow?.org_id ?? null

  const service = createServiceRoleClient()
  const { data: bot } = await service.from('agents').select('id, org_id').eq('id', params.id).single()
  const botRow = bot as { id: string; org_id: string | null } | null
  if (!botRow) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  if (!isAdmin && botRow.org_id !== userOrgId) {
    return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  }

  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 500)

  const { data: rows, error } = await service
    .from('agent_change_log')
    .select('*')
    .eq('bot_id', params.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return serverError(error, 'bots.history', { orgId: botRow.org_id ?? undefined })
  return NextResponse.json({ entries: rows || [] })
}
